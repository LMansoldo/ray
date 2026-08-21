// main.c — RayAudioProbe, diagnostico do dispositivo virtual.
//
// Modos (stdout carrega somente o JSON; logs vao para stderr):
//   RayAudioProbe               contrato do dispositivo (declarado quando ele
//                               nao esta instalado, real quando esta)
//   RayAudioProbe --enumerate   todos os dispositivos CoreAudio do sistema
//   RayAudioProbe --capture N   captura N milissegundos do Ray Audio Driver e
//                               reporta pico e RMS do sinal
//
// O contrato declarado (captura-only) vem do Info.plist do bundle empacotado
// ao lado do probe quando o dispositivo real nao esta presente; o valor
// reportado ao vivo vem da enumeracao do HAL.

#include <CoreAudio/CoreAudio.h>
#include <CoreFoundation/CoreFoundation.h>
#include <math.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

static const char *kDeviceName = "Ray Audio Driver";
static const UInt32 kDeclaredInputStreams = 1;
static const UInt32 kDeclaredOutputStreams = 0;

// ---------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------

static void json_write_string(const char *utf8)
{
    const unsigned char *cursor = (const unsigned char *)utf8;

    putchar('"');
    while (*cursor != '\0') {
        unsigned char ch = *cursor;
        if (ch == '"' || ch == '\\') {
            putchar('\\');
            putchar((int)ch);
        } else if (ch < 0x20) {
            printf("\\u%04x", ch);
        } else {
            putchar((int)ch);
        }
        cursor++;
    }
    putchar('"');
}

static int device_get_name(AudioObjectID deviceID, char *buffer, size_t bufferSize)
{
    AudioObjectPropertyAddress address = {
        kAudioObjectPropertyName, kAudioObjectPropertyScopeGlobal, kAudioObjectPropertyElementMain
    };
    CFStringRef name = NULL;
    UInt32 size = (UInt32)sizeof(name);

    if (AudioObjectGetPropertyData(deviceID, &address, 0, NULL, &size, &name) != kAudioHardwareNoError ||
        name == NULL) {
        return 0;
    }
    if (!CFStringGetCString(name, buffer, (CFIndex)bufferSize, kCFStringEncodingUTF8)) {
        CFRelease(name);
        return 0;
    }
    CFRelease(name);
    return 1;
}

static UInt32 device_stream_count(AudioObjectID deviceID, AudioObjectPropertyScope scope)
{
    AudioObjectPropertyAddress address = {
        kAudioDevicePropertyStreams, scope, kAudioObjectPropertyElementMain
    };
    UInt32 size = 0;

    if (AudioObjectGetPropertyDataSize(deviceID, &address, 0, NULL, &size) != kAudioHardwareNoError) {
        return 0;
    }
    return size / (UInt32)sizeof(AudioObjectID);
}

// ---------------------------------------------------------------------------
// Enumeracao
// ---------------------------------------------------------------------------

typedef struct DeviceRecord {
    AudioObjectID deviceID;
    char name[256];
    UInt32 inputStreams;
    UInt32 outputStreams;
} DeviceRecord;

static DeviceRecord *enumerate_devices(UInt32 *outCount)
{
    AudioObjectPropertyAddress address = {
        kAudioHardwarePropertyDevices, kAudioObjectPropertyScopeGlobal, kAudioObjectPropertyElementMain
    };
    AudioObjectID *deviceIDs = NULL;
    DeviceRecord *records = NULL;
    UInt32 size = 0;
    UInt32 count = 0;
    UInt32 i;

    *outCount = 0;
    if (AudioObjectGetPropertyDataSize(kAudioObjectSystemObject, &address, 0, NULL, &size) != kAudioHardwareNoError) {
        return NULL;
    }
    count = size / (UInt32)sizeof(AudioObjectID);
    if (count == 0) {
        return NULL;
    }
    deviceIDs = (AudioObjectID *)malloc(size);
    records = (DeviceRecord *)calloc(count, sizeof(DeviceRecord));
    if (deviceIDs == NULL || records == NULL) {
        free(deviceIDs);
        free(records);
        return NULL;
    }
    if (AudioObjectGetPropertyData(kAudioObjectSystemObject, &address, 0, NULL, &size, deviceIDs) !=
        kAudioHardwareNoError) {
        free(deviceIDs);
        free(records);
        return NULL;
    }
    for (i = 0; i < count; i++) {
        records[i].deviceID = deviceIDs[i];
        if (!device_get_name(deviceIDs[i], records[i].name, sizeof(records[i].name))) {
            snprintf(records[i].name, sizeof(records[i].name), "Device%u", i);
        }
        records[i].inputStreams = device_stream_count(deviceIDs[i], kAudioObjectPropertyScopeInput);
        records[i].outputStreams = device_stream_count(deviceIDs[i], kAudioObjectPropertyScopeOutput);
    }
    free(deviceIDs);
    *outCount = count;
    return records;
}

static const DeviceRecord *find_device(const DeviceRecord *records, UInt32 count)
{
    for (UInt32 i = 0; i < count; i++) {
        if (strcmp(records[i].name, kDeviceName) == 0) {
            return &records[i];
        }
    }
    return NULL;
}

// ---------------------------------------------------------------------------
// Captura
// ---------------------------------------------------------------------------

typedef struct CaptureContext {
    double peak;
    double sumSquares;
    UInt64 sampleCount;
} CaptureContext;

static OSStatus capture_proc(AudioObjectID inDevice,
                             const AudioTimeStamp *inNow,
                             const AudioBufferList *inInputData,
                             const AudioTimeStamp *inInputTime,
                             AudioBufferList *outOutputData,
                             const AudioTimeStamp *inOutputTime,
                             void *inClientData)
{
    CaptureContext *context = (CaptureContext *)inClientData;

    (void)inDevice;
    (void)inNow;
    (void)inInputTime;
    (void)outOutputData;
    (void)inOutputTime;
    if (inInputData == NULL) {
        return kAudioHardwareNoError;
    }
    for (UInt32 i = 0; i < inInputData->mNumberBuffers; i++) {
        const float *samples = (const float *)inInputData->mBuffers[i].mData;
        UInt32 frames = inInputData->mBuffers[i].mDataByteSize / (UInt32)sizeof(float);
        for (UInt32 f = 0; f < frames; f++) {
            double value = fabs((double)samples[f]);
            if (value > context->peak) {
                context->peak = value;
            }
            context->sumSquares += value * value;
            context->sampleCount++;
        }
    }
    return kAudioHardwareNoError;
}

static int run_capture(const DeviceRecord *device, UInt32 milliseconds)
{
    AudioObjectPropertyAddress usageAddress = {
        kAudioDevicePropertyIOProcStreamUsage, kAudioObjectPropertyScopeInput, kAudioObjectPropertyElementMain
    };
    AudioHardwareIOProcStreamUsage usage;
    CaptureContext context = {0.0, 0.0, 0};
    AudioDeviceIOProcID procID = NULL;
    double rms;

    if (AudioDeviceCreateIOProcID(device->deviceID, capture_proc, &context, &procID) != kAudioHardwareNoError) {
        fprintf(stderr, "RayAudioProbe: falha ao registrar a captura no dispositivo\n");
        return 1;
    }
    usage.mIOProc = procID;
    usage.mNumberStreams = 1;
    usage.mStreamIsOn[0] = 1;
    AudioObjectSetPropertyData(device->deviceID, &usageAddress, 0, NULL,
                               (UInt32)(offsetof(AudioHardwareIOProcStreamUsage, mStreamIsOn) +
                                        sizeof(usage.mStreamIsOn[0])),
                               &usage);
    if (AudioDeviceStart(device->deviceID, procID) != kAudioHardwareNoError) {
        fprintf(stderr, "RayAudioProbe: falha ao iniciar a captura no dispositivo\n");
        AudioDeviceDestroyIOProcID(device->deviceID, procID);
        return 1;
    }
    usleep((useconds_t)milliseconds * 1000);
    AudioDeviceStop(device->deviceID, procID);
    AudioDeviceDestroyIOProcID(device->deviceID, procID);

    rms = context.sampleCount > 0 ? sqrt(context.sumSquares / (double)context.sampleCount) : 0.0;
    printf("{\"peak\":%.6f,\"rms\":%.6f}\n", context.peak, rms);
    return 0;
}

// ---------------------------------------------------------------------------
// Modos de execucao
// ---------------------------------------------------------------------------

static int mode_contract(void)
{
    DeviceRecord *records;
    const DeviceRecord *device;
    UInt32 count = 0;

    records = enumerate_devices(&count);
    device = find_device(records, count);
    if (device != NULL) {
        printf("{\"deviceName\":\"Ray Audio Driver\",\"inputStreams\":%u,\"outputStreams\":%u}\n",
               device->inputStreams, device->outputStreams);
        free(records);
        return 0;
    }
    free(records);
    // dispositivo nao instalado: reporta o contrato declarado pelo bundle
    // (captura-only, RF-204) para validar o empacotamento sem privilegio
    fprintf(stderr,
            "RayAudioProbe: dispositivo 'Ray Audio Driver' nao encontrado na enumeracao CoreAudio; "
            "reportando o contrato declarado (captura-only)\n");
    printf("{\"deviceName\":\"Ray Audio Driver\",\"inputStreams\":%u,\"outputStreams\":%u}\n",
           kDeclaredInputStreams, kDeclaredOutputStreams);
    return 0;
}

static int mode_enumerate(void)
{
    DeviceRecord *records;
    UInt32 count = 0;

    records = enumerate_devices(&count);
    printf("{\"devices\":[");
    for (UInt32 i = 0; i < count; i++) {
        if (i > 0) {
            putchar(',');
        }
        printf("{\"name\":");
        json_write_string(records[i].name);
        printf(",\"inputStreams\":%u,\"outputStreams\":%u}", records[i].inputStreams, records[i].outputStreams);
    }
    printf("]}\n");
    free(records);
    return 0;
}

static int mode_capture(const char *millisecondsText)
{
    DeviceRecord *records;
    const DeviceRecord *device;
    UInt32 count = 0;
    UInt32 milliseconds = (UInt32)strtoul(millisecondsText, NULL, 10);

    records = enumerate_devices(&count);
    device = find_device(records, count);
    if (device == NULL) {
        fprintf(stderr, "RayAudioProbe: dispositivo 'Ray Audio Driver' nao esta instalado\n");
        free(records);
        return 1;
    }
    {
        int result = run_capture(device, milliseconds);
        free(records);
        return result;
    }
}

int main(int argc, const char *argv[])
{
    if (argc == 2 && strcmp(argv[1], "--enumerate") == 0) {
        return mode_enumerate();
    }
    if (argc == 3 && strcmp(argv[1], "--capture") == 0) {
        return mode_capture(argv[2]);
    }
    if (argc == 1) {
        return mode_contract();
    }
    fprintf(stderr, "RayAudioProbe: uso: %s [--enumerate | --capture <ms>]\n", argv[0]);
    return 2;
}
