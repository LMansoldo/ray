// tap.c — tap da saida do sistema (CA-5).
//
// Para um dispositivo capture-only receber o audio da reuniao, o plugin
// registra um IOProc no dispositivo de saida padrao do sistema e converte o
// sinal tocado (via AudioConverter) para o formato do dispositivo virtual,
// escrevendo o resultado no anel. O tap vive enquanto houver ao menos uma
// sessao de captura ativa (StartIO/StopIO em device.c).
//
// Disciplina de tempo real: o IOProc so copia memoria, alimenta o conversor
// e escreve no anel sob o mutex do dispositivo — nunca aloca, nunca loga,
// nunca chama o HAL.

#include "ray_driver.h"
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

static void RayTap_LogError(const char *message)
{
    // O plugin roda dentro do processo do CoreAudio; o stderr e o unico canal
    // seguro de diagnostico sem APIs de log do sistema.
    fprintf(stderr, "Ray Audio Driver: %s\n", message);
}

static OSStatus RayTap_CopyOutputFormat(AudioObjectID inDeviceID, AudioStreamBasicDescription *outFormat)
{
    AudioObjectPropertyAddress streamsAddress = {
        kAudioDevicePropertyStreams, kAudioObjectPropertyScopeOutput, kAudioObjectPropertyElementMain
    };
    AudioObjectPropertyAddress formatAddress = {
        kAudioStreamPropertyVirtualFormat, kAudioObjectPropertyScopeGlobal, kAudioObjectPropertyElementMain
    };
    AudioObjectID *streams = NULL;
    UInt32 size = 0;
    UInt32 formatSize = (UInt32)sizeof(*outFormat);
    OSStatus result;

    result = AudioObjectGetPropertyDataSize(inDeviceID, &streamsAddress, 0, NULL, &size);
    if (result != kAudioHardwareNoError || size < sizeof(AudioObjectID)) {
        return kAudioHardwareBadStreamError;
    }
    streams = (AudioObjectID *)malloc(size);
    if (streams == NULL) {
        return kAudioHardwareIllegalOperationError;
    }
    result = AudioObjectGetPropertyData(inDeviceID, &streamsAddress, 0, NULL, &size, streams);
    if (result != kAudioHardwareNoError) {
        free(streams);
        return result;
    }
    result = AudioObjectGetPropertyData(streams[0], &formatAddress, 0, NULL, &formatSize, outFormat);
    free(streams);
    return result;
}

static OSStatus RayTap_ConverterInputProc(AudioConverterRef inConverter,
                                          UInt32 *ioNumberDataPackets,
                                          AudioBufferList *ioData,
                                          AudioStreamPacketDescription **outPacketDescriptions,
                                          void *inUserData)
{
    RayTap *tap = (RayTap *)inUserData;
    UInt32 availableFrames;
    UInt32 buffers;
    UInt32 i;

    (void)inConverter;
    (void)outPacketDescriptions;
    availableFrames = tap->capturedFrames;
    if (*ioNumberDataPackets > availableFrames) {
        *ioNumberDataPackets = availableFrames;
    }
    buffers = tap->captured->mNumberBuffers;
    if (buffers > ioData->mNumberBuffers) {
        buffers = ioData->mNumberBuffers;
    }
    for (i = 0; i < buffers; i++) {
        ioData->mBuffers[i].mData = tap->captured->mBuffers[i].mData;
        ioData->mBuffers[i].mDataByteSize =
            (UInt32)(*ioNumberDataPackets) * tap->inputFormat.mBytesPerFrame;
    }
    return kAudioHardwareNoError;
}

static OSStatus RayTap_IOProc(AudioObjectID inDevice,
                              const AudioTimeStamp *inNow,
                              const AudioBufferList *inInputData,
                              const AudioTimeStamp *inInputTime,
                              AudioBufferList *outOutputData,
                              const AudioTimeStamp *inOutputTime,
                              void *inClientData)
{
    RayTap *tap = (RayTap *)inClientData;
    RayDevice *device = tap->device;
    AudioBufferList converted;
    UInt32 frames;
    UInt32 i;
    OSStatus result;

    (void)inDevice;
    (void)inNow;
    (void)inInputData;
    (void)inInputTime;
    (void)inOutputTime;
    if (outOutputData == NULL || outOutputData->mNumberBuffers == 0 || !tap->active) {
        return kAudioHardwareNoError;
    }
    pthread_mutex_lock(&device->lock);
    for (i = 0; i < outOutputData->mNumberBuffers && i < tap->captured->mNumberBuffers; i++) {
        tap->captured->mBuffers[i].mDataByteSize = outOutputData->mBuffers[i].mDataByteSize;
        memcpy(tap->captured->mBuffers[i].mData,
               outOutputData->mBuffers[i].mData,
               outOutputData->mBuffers[i].mDataByteSize);
    }
    if (tap->inputFormat.mBytesPerFrame > 0) {
        tap->capturedFrames = outOutputData->mBuffers[0].mDataByteSize / tap->inputFormat.mBytesPerFrame;
    } else {
        tap->capturedFrames = 0;
    }
    frames = tap->convertedCapacityFrames;
    converted.mNumberBuffers = 1;
    converted.mBuffers[0].mNumberChannels = kRayChannelCount;
    converted.mBuffers[0].mDataByteSize = (UInt32)(frames * kRayChannelCount * sizeof(float));
    converted.mBuffers[0].mData = tap->convertedScratch;
    result = AudioConverterFillComplexBuffer(tap->converter,
                                             RayTap_ConverterInputProc,
                                             tap,
                                             &frames,
                                             &converted,
                                             NULL);
    if (result == kAudioHardwareNoError && frames > 0) {
        RayRingBuffer_Write(&device->ring, (const float *)converted.mBuffers[0].mData, frames);
    }
    pthread_mutex_unlock(&device->lock);
    return kAudioHardwareNoError;
}

OSStatus RayTap_Start(RayTap *tap, RayDevice *device)
{
    AudioObjectPropertyAddress defaultAddress = {
        kAudioHardwarePropertyDefaultOutputDevice, kAudioObjectPropertyScopeGlobal, kAudioObjectPropertyElementMain
    };
    AudioObjectID outputDeviceID = kAudioObjectUnknown;
    UInt32 size = (UInt32)sizeof(outputDeviceID);
    UInt32 bufferCount;
    UInt32 i;
    OSStatus result;

    if (tap->active) {
        return kAudioHardwareNoError;
    }
    tap->device = device;
    result = AudioObjectGetPropertyData(kAudioObjectSystemObject, &defaultAddress, 0, NULL, &size, &outputDeviceID);
    if (result != kAudioHardwareNoError || outputDeviceID == kAudioObjectUnknown) {
        RayTap_LogError("nao ha dispositivo de saida padrao para capturar");
        return kAudioHardwareBadDeviceError;
    }
    result = RayTap_CopyOutputFormat(outputDeviceID, &tap->inputFormat);
    if (result != kAudioHardwareNoError) {
        RayTap_LogError("formato do dispositivo de saida indisponivel");
        return result;
    }
    tap->outputFormat.mSampleRate = kRaySampleRate;
    tap->outputFormat.mFormatID = kAudioFormatLinearPCM;
    tap->outputFormat.mFormatFlags = kAudioFormatFlagIsFloat | kAudioFormatFlagIsPacked;
    tap->outputFormat.mBytesPerPacket = kRayChannelCount * 4;
    tap->outputFormat.mFramesPerPacket = 1;
    tap->outputFormat.mBytesPerFrame = kRayChannelCount * 4;
    tap->outputFormat.mChannelsPerFrame = kRayChannelCount;
    tap->outputFormat.mBitsPerChannel = 32;

    result = AudioConverterNew(&tap->inputFormat, &tap->outputFormat, &tap->converter);
    if (result != kAudioHardwareNoError) {
        RayTap_LogError("conversor de formato indisponivel para a saida padrao");
        return result;
    }

    bufferCount = (tap->inputFormat.mFormatFlags & kAudioFormatFlagIsNonInterleaved) ? kRayChannelCount : 1;
    if (bufferCount > 2) {
        bufferCount = 2; // o tap captura ate 2 canais
    }
    tap->captured = (AudioBufferList *)calloc(1, sizeof(AudioBufferList) + (bufferCount - 1) * sizeof(AudioBuffer));
    if (tap->captured == NULL) {
        AudioConverterDispose(tap->converter);
        tap->converter = NULL;
        return kAudioHardwareIllegalOperationError;
    }
    tap->captured->mNumberBuffers = bufferCount;
    for (i = 0; i < bufferCount; i++) {
        // 1 segundo de capacidade por buffer cobre qualquer ciclo do sistema
        tap->captured->mBuffers[i].mNumberChannels = 1;
        tap->captured->mBuffers[i].mDataByteSize = (UInt32)kRaySampleRate * 4;
        tap->captured->mBuffers[i].mData = malloc(tap->captured->mBuffers[i].mDataByteSize);
        if (tap->captured->mBuffers[i].mData == NULL) {
            while (i > 0) {
                i--;
                free(tap->captured->mBuffers[i].mData);
            }
            free(tap->captured);
            tap->captured = NULL;
            AudioConverterDispose(tap->converter);
            tap->converter = NULL;
            return kAudioHardwareIllegalOperationError;
        }
    }
    tap->convertedCapacityFrames = kRaySampleRate; // 1 segundo
    tap->convertedScratch = (float *)malloc((size_t)tap->convertedCapacityFrames * kRayChannelCount * sizeof(float));
    if (tap->convertedScratch == NULL) {
        RayTap_Stop(tap);
        return kAudioHardwareIllegalOperationError;
    }

    result = AudioDeviceCreateIOProcID(outputDeviceID, RayTap_IOProc, tap, &tap->ioProcID);
    if (result != kAudioHardwareNoError) {
        RayTap_LogError("registro do tap na saida padrao falhou");
        RayTap_Stop(tap);
        return result;
    }
    tap->outputDeviceID = outputDeviceID;
    tap->active = true;
    return kAudioHardwareNoError;
}

void RayTap_Stop(RayTap *tap)
{
    if (tap->active) {
        AudioDeviceDestroyIOProcID(tap->outputDeviceID, tap->ioProcID);
        tap->active = false;
    }
    if (tap->converter != NULL) {
        AudioConverterDispose(tap->converter);
        tap->converter = NULL;
    }
    if (tap->captured != NULL) {
        for (UInt32 i = 0; i < tap->captured->mNumberBuffers; i++) {
            free(tap->captured->mBuffers[i].mData);
        }
        free(tap->captured);
        tap->captured = NULL;
    }
    if (tap->convertedScratch != NULL) {
        free(tap->convertedScratch);
        tap->convertedScratch = NULL;
    }
    tap->capturedFrames = 0;
    tap->outputDeviceID = kAudioObjectUnknown;
    tap->ioProcID = NULL;
}
