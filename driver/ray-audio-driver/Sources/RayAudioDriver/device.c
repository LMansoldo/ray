// device.c — estado e IO do dispositivo virtual Ray Audio Driver.
//
// O dispositivo tem um unico stream de entrada (captura-only, RF-204): o HAL
// inicia e para a captura via StartIO/StopIO, e le o audio do anel via
// DoIOOperation(kAudioServerPlugInIOOperationReadInput). O anel e alimentado
// pelo tap da saida do sistema (tap.c).

#include "ray_driver.h"
#include <string.h>

RayDevice gDevice;

static void RayDevice_InitRingLocked(RayDevice *device)
{
    if (device->ring.storage == NULL) {
        RayRingBuffer_Init(&device->ring, kRayRingBufferFrames);
    }
    if (device->readScratch == NULL) {
        // capacidade folgada: o HAL pode pedir ciclos maiores que o nominal
        device->readScratch = (float *)malloc((size_t)kRayRingBufferFrames * kRayChannelCount * sizeof(float));
    }
}

OSStatus RayDevice_Create(void)
{
    OSStatus result = kAudioHardwareNoError;

    pthread_mutex_lock(&gDevice.lock);
    if (gDevice.deviceObjectID == 0) {
        gDevice.deviceObjectID = kRayDeviceObjectID;
        gDevice.streamObjectID = kRayInputStreamID;
        RayDevice_InitRingLocked(&gDevice);
    }
    pthread_mutex_unlock(&gDevice.lock);
    return result;
}

void RayDevice_Destroy(void)
{
    pthread_mutex_lock(&gDevice.lock);
    RayTap_Stop(&gDevice.tap);
    if (gDevice.readScratch != NULL) {
        free(gDevice.readScratch);
        gDevice.readScratch = NULL;
    }
    RayRingBuffer_Free(&gDevice.ring);
    gDevice.ioClientCount = 0;
    gDevice.sampleTimeFrames = 0;
    gDevice.ioRunning = false;
    pthread_mutex_unlock(&gDevice.lock);
}

// Primeira sessao de captura liga o tap da saida do sistema; as chamadas ao
// HAL cliente ficam fora do mutex (StartIO nao roda na thread de tempo real,
// mas nao ha motivo para segurar o lock durante chamadas externas).
OSStatus RayDevice_StartIO(uint32_t inClientID)
{
    OSStatus result = kAudioHardwareNoError;
    Boolean first = false;

    (void)inClientID;
    pthread_mutex_lock(&gDevice.lock);
    if (gDevice.ioClientCount == 0) {
        first = true;
    }
    gDevice.ioClientCount++;
    pthread_mutex_unlock(&gDevice.lock);

    if (first) {
        result = RayTap_Start(&gDevice.tap, &gDevice);
        pthread_mutex_lock(&gDevice.lock);
        gDevice.ioRunning = (result == kAudioHardwareNoError);
        pthread_mutex_unlock(&gDevice.lock);
    }
    return result;
}

OSStatus RayDevice_StopIO(uint32_t inClientID)
{
    OSStatus result = kAudioHardwareNoError;
    Boolean last = false;

    (void)inClientID;
    pthread_mutex_lock(&gDevice.lock);
    if (gDevice.ioClientCount > 0) {
        gDevice.ioClientCount--;
        last = (gDevice.ioClientCount == 0);
    }
    pthread_mutex_unlock(&gDevice.lock);

    if (last) {
        RayTap_Stop(&gDevice.tap);
        pthread_mutex_lock(&gDevice.lock);
        gDevice.ioRunning = false;
        pthread_mutex_unlock(&gDevice.lock);
    }
    return result;
}

// Copia do anel para o buffer do cliente no formato nativo do stream
// (2 canais, float, nao intercalado).
void RayDevice_ReadInput(uint32_t inFrameCount, void *ioMainBuffer)
{
    AudioBufferList *buffers = (AudioBufferList *)ioMainBuffer;
    RayDevice *device = &gDevice;
    float *left;
    float *right;

    if (buffers == NULL || inFrameCount == 0 || buffers->mNumberBuffers < kRayChannelCount) {
        return;
    }
    pthread_mutex_lock(&device->lock);
    if (device->readScratch != NULL) {
        RayRingBuffer_Read(&device->ring, device->readScratch, inFrameCount);
    }
    device->sampleTimeFrames += inFrameCount;
    pthread_mutex_unlock(&device->lock);

    left = (float *)buffers->mBuffers[0].mData;
    right = (float *)buffers->mBuffers[1].mData;
    if (device->readScratch != NULL) {
        for (uint32_t i = 0; i < inFrameCount; i++) {
            left[i] = device->readScratch[(size_t)i * 2];
            right[i] = device->readScratch[(size_t)i * 2 + 1];
        }
    } else {
        // anel nao alocado: entrega silencio em vez de memoria nao inicializada
        memset(left, 0, (size_t)inFrameCount * sizeof(float));
        memset(right, 0, (size_t)inFrameCount * sizeof(float));
    }
}

void RayDevice_GetZeroTimeStamp(Float64 *outSampleTime, UInt64 *outHostTime, UInt64 *outSeed)
{
    pthread_mutex_lock(&gDevice.lock);
    *outSampleTime = (Float64)gDevice.sampleTimeFrames;
    *outHostTime = AudioGetCurrentHostTime();
    *outSeed = 0;
    pthread_mutex_unlock(&gDevice.lock);
}
