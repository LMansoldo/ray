// ring.c — anel de audio estereo intercalado.
//
// O produtor e o tap da saida do sistema (IOProc do dispositivo de saida
// padrao); o consumidor e o DoIOOperation de leitura de entrada do HAL. Todas
// as operacoes rodam sob o mutex do dispositivo; as secoes criticas so copiam
// memoria e ajustam indices (nunca alocam), para respeitar a thread de tempo
// real do CoreAudio.

#include "ray_driver.h"
#include <stdlib.h>
#include <string.h>

void RayRingBuffer_Init(RayRingBuffer *ring, uint32_t capacityFrames)
{
    ring->capacityFrames = capacityFrames;
    ring->storage = (float *)calloc((size_t)capacityFrames * kRayChannelCount, sizeof(float));
    ring->readFrame = 0;
    ring->writeFrame = 0;
}

void RayRingBuffer_Free(RayRingBuffer *ring)
{
    free(ring->storage);
    ring->storage = NULL;
    ring->capacityFrames = 0;
    ring->readFrame = 0;
    ring->writeFrame = 0;
}

// Escreve frames novos; quando nao ha espaco, descarta os mais antigos
// (o stream e ao vivo, latencia constante importa mais do que integridade).
void RayRingBuffer_Write(RayRingBuffer *ring, const float *interleaved, uint32_t frames)
{

    if (ring->storage == NULL || frames == 0) {
        return;
    }
    if (frames > ring->capacityFrames) {
        // mantem apenas a cauda mais recente
        interleaved += (size_t)(frames - ring->capacityFrames) * kRayChannelCount;
        frames = ring->capacityFrames;
    }
    if (ring->writeFrame + frames > ring->capacityFrames) {
        ring->readFrame = 0;
        ring->writeFrame = 0;
    }
    if (ring->writeFrame + frames > ring->capacityFrames) {
        return; // defensivo: frames > capacidade ja foi tratado acima
    }
    memcpy(ring->storage + (size_t)ring->writeFrame * kRayChannelCount,
           interleaved, (size_t)frames * kRayChannelCount * sizeof(float));
    ring->writeFrame += frames;
    if (ring->writeFrame - ring->readFrame > ring->capacityFrames) {
        ring->readFrame = ring->writeFrame - ring->capacityFrames;
    }
}

// Le ate `frames` frames; frames ausentes saem como silencio.
void RayRingBuffer_Read(RayRingBuffer *ring, float *interleaved, uint32_t frames)
{
    uint32_t available;

    if (ring->storage == NULL || frames == 0) {
        return;
    }
    available = ring->writeFrame - ring->readFrame;
    if (available > frames) {
        available = frames;
    }
    if (available > 0) {
        memcpy(interleaved,
               ring->storage + (size_t)ring->readFrame * kRayChannelCount,
               (size_t)available * kRayChannelCount * sizeof(float));
        ring->readFrame += available;
    }
    if (available < frames) {
        memset(interleaved + (size_t)available * kRayChannelCount, 0,
               (size_t)(frames - available) * kRayChannelCount * sizeof(float));
    }
}
