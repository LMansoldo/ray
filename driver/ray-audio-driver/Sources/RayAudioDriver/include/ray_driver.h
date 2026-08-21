#ifndef RAY_AUDIO_DRIVER_H
#define RAY_AUDIO_DRIVER_H

// ray_driver.h — estado compartilhado do plugin Ray Audio Driver.
//
// O plugin implementa a interface AudioServerPlugInDriverInterface (HAL) e
// fornece um unico dispositivo virtual captura-only: um stream de entrada
// estereo de 48 kHz que espelha o audio do dispositivo de saida padrao do
// sistema (CA-5), nunca um stream de saida (RF-204).

#include <CoreAudio/AudioServerPlugIn.h>
#include <CoreAudio/CoreAudio.h>
#include <CoreFoundation/CoreFoundation.h>
#include <AudioToolbox/AudioConverter.h>
#include <pthread.h>
#include <stdint.h>

// IDs dos objetos do plugin. O AudioPlugIn em si usa o ID reservado
// kAudioObjectPlugInObject; o dispositivo e o stream usam IDs proprios
// (a responsabilidade de definir os IDs dos objetos fornecidos e do plugin).
enum {
    kRayDeviceObjectID = 0x52617944, // 'RayD'
    kRayInputStreamID  = 0x52617949, // 'RayI'
};

#define kRayDeviceUID      CFSTR("dev.ray.audio-driver.DeviceUID")
#define kRayDeviceModelUID CFSTR("dev.ray.audio-driver.ModelUID")
#define kRayDeviceName     CFSTR("Ray Audio Driver")
#define kRayManufacturer   CFSTR("Ray Audio")
#define kRayInputStreamName CFSTR("Ray Audio Driver Input")

#define kRaySampleRate        48000.0
#define kRayChannelCount      2u
#define kRayRingBufferFrames  (kRaySampleRate * 4) // 4 segundos de audio

// Anel de audio estereo intercalado (2 floats por frame), com sobrescrita dos
// frames mais antigos quando cheio (latencia constante para o fluxo vivo).
typedef struct RayRingBuffer {
    float *storage;
    uint32_t capacityFrames;
    uint32_t readFrame;
    uint32_t writeFrame;
} RayRingBuffer;

// Tap da saida do sistema: um IOProc registrado no dispositivo de saida
// padrao que converte (AudioConverter) o sinal tocado para o formato do
// dispositivo virtual e o escreve no anel.
typedef struct RayTap {
    Boolean active;
    AudioObjectID outputDeviceID;
    AudioDeviceIOProcID ioProcID;
    AudioConverterRef converter;
    AudioStreamBasicDescription inputFormat;  // formato do dispositivo de saida
    AudioStreamBasicDescription outputFormat; // 48 kHz, estereo, float, intercalado
    AudioBufferList *captured;                // copia dos buffers do ultimo ciclo
    uint32_t capturedFrames;
    float *convertedScratch;                  // saida do conversor
    uint32_t convertedCapacityFrames;
    struct RayDevice *device;
} RayTap;

typedef struct RayDevice {
    AudioObjectID deviceObjectID;
    AudioObjectID streamObjectID;
    CFStringRef configurationApplication; // app que reivindicou o dispositivo (pode ser NULL)
    pthread_mutex_t lock;
    uint32_t ioClientCount;
    uint64_t sampleTimeFrames;
    Boolean ioRunning;
    RayRingBuffer ring;
    float *readScratch; // buffer de deintercalacao do DoIOOperation
    RayTap tap;
} RayDevice;

extern RayDevice gDevice;
extern AudioServerPlugInDriverInterface gDriverInterface;

// device.c
OSStatus RayDevice_Create(void);
void RayDevice_Destroy(void);
OSStatus RayDevice_StartIO(uint32_t inClientID);
OSStatus RayDevice_StopIO(uint32_t inClientID);
void RayDevice_ReadInput(uint32_t inFrameCount, void *ioMainBuffer);
void RayDevice_GetZeroTimeStamp(Float64 *outSampleTime, UInt64 *outHostTime, UInt64 *outSeed);

// ring.c
void RayRingBuffer_Init(RayRingBuffer *ring, uint32_t capacityFrames);
void RayRingBuffer_Free(RayRingBuffer *ring);
void RayRingBuffer_Write(RayRingBuffer *ring, const float *interleaved, uint32_t frames);
void RayRingBuffer_Read(RayRingBuffer *ring, float *interleaved, uint32_t frames);

// tap.c
OSStatus RayTap_Start(RayTap *tap, RayDevice *device);
void RayTap_Stop(RayTap *tap);

// plugin.c
void *AudioServerPlugInMain(CFAllocatorRef allocator, CFUUIDRef requestedTypeUUID);

#endif // RAY_AUDIO_DRIVER_H
