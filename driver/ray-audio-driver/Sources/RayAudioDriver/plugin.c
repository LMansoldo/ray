// plugin.c — fabrica do plugin e implementacao da interface
// AudioServerPlugInDriverInterface (HAL).
//
// O host carrega o bundle .driver de /Library/Audio/Plug-Ins/HAL, resolve o
// simbolo AudioServerPlugInMain e consulta os objetos do plugin pela mesma
// API baseada em propriedades do HAL. O Ray fornece um unico dispositivo
// captura-only (RF-204): um stream de entrada de 48 kHz estereo e nenhum
// stream de saida.

#include "ray_driver.h"
#include <CoreFoundation/CFPlugInCOM.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

// Formato nativo do stream de entrada: 48 kHz, 2 canais, float, nao
// intercalado (o formato que o DoIOOperation de leitura entrega ao cliente).
static const AudioStreamBasicDescription kInputFormat = {
    .mSampleRate = kRaySampleRate,
    .mFormatID = kAudioFormatLinearPCM,
    .mFormatFlags = kAudioFormatFlagIsFloat | kAudioFormatFlagIsPacked | kAudioFormatFlagIsNonInterleaved,
    .mBytesPerPacket = 4,
    .mFramesPerPacket = 1,
    .mBytesPerFrame = 4,
    .mChannelsPerFrame = kRayChannelCount,
    .mBitsPerChannel = 32,
};

// declaracoes antecipadas (HasProperty consulta GetPropertyDataSize)
static OSStatus RayDriver_GetPropertyDataSize(AudioServerPlugInDriverRef inDriver,
                                              AudioObjectID inObjectID,
                                              pid_t inClientProcessID,
                                              const AudioObjectPropertyAddress *inAddress,
                                              UInt32 inQualifierDataSize,
                                              const void *inQualifierData,
                                              UInt32 *outDataSize);

// ===========================================================================
// Controle de vida
// ===========================================================================

static UInt32 gRefCount = 1;

static HRESULT RayDriver_QueryInterface(void *inDriver, REFIID inUUID, LPVOID *outInterface)
{
    CFUUIDRef requested;
    Boolean matches;

    (void)inDriver;
    requested = CFUUIDCreateFromUUIDBytes(kCFAllocatorDefault, inUUID);
    matches = requested != NULL && CFEqual(requested, kAudioServerPlugInDriverInterfaceUUID);
    if (requested != NULL) {
        CFRelease(requested);
    }
    if (matches) {
        *outInterface = &gDriverInterface;
        return kAudioHardwareNoError;
    }
    *outInterface = NULL;
    return E_NOINTERFACE;
}

static ULONG RayDriver_AddRef(void *inDriver)
{
    (void)inDriver;
    return ++gRefCount;
}

static ULONG RayDriver_Release(void *inDriver)
{
    (void)inDriver;
    if (gRefCount > 1) {
        return --gRefCount;
    }
    return gRefCount; // o plugin e um singleton do processo; nunca libera
}

// ===========================================================================
// Ciclo de vida do dispositivo
// ===========================================================================

static OSStatus RayDriver_Initialize(AudioServerPlugInDriverRef inDriver, AudioServerPlugInHostRef inHost)
{
    (void)inDriver;
    (void)inHost;
    return kAudioHardwareNoError;
}

static OSStatus RayDriver_CreateDevice(AudioServerPlugInDriverRef inDriver,
                                       CFDictionaryRef inDescription,
                                       const AudioServerPlugInClientInfo *inClientInfo,
                                       AudioObjectID *outDeviceObjectID)
{
    (void)inDriver;
    (void)inDescription;
    (void)inClientInfo;
    return RayDevice_Create() == kAudioHardwareNoError
               ? ((*outDeviceObjectID = kRayDeviceObjectID), kAudioHardwareNoError)
               : kAudioHardwareIllegalOperationError;
}

static OSStatus RayDriver_DestroyDevice(AudioServerPlugInDriverRef inDriver, AudioObjectID inDeviceObjectID)
{
    (void)inDriver;
    if (inDeviceObjectID != kRayDeviceObjectID) {
        return kAudioHardwareBadObjectError;
    }
    RayDevice_Destroy();
    return kAudioHardwareNoError;
}

static OSStatus RayDriver_AddDeviceClient(AudioServerPlugInDriverRef inDriver,
                                          AudioObjectID inDeviceObjectID,
                                          const AudioServerPlugInClientInfo *inClientInfo)
{
    (void)inDriver;
    (void)inClientInfo;
    if (inDeviceObjectID != kRayDeviceObjectID) {
        return kAudioHardwareBadObjectError;
    }
    return kAudioHardwareNoError;
}

static OSStatus RayDriver_RemoveDeviceClient(AudioServerPlugInDriverRef inDriver,
                                             AudioObjectID inDeviceObjectID,
                                             const AudioServerPlugInClientInfo *inClientInfo)
{
    (void)inDriver;
    (void)inClientInfo;
    if (inDeviceObjectID != kRayDeviceObjectID) {
        return kAudioHardwareBadObjectError;
    }
    return kAudioHardwareNoError;
}

static OSStatus RayDriver_PerformDeviceConfigurationChange(AudioServerPlugInDriverRef inDriver,
                                                           AudioObjectID inDeviceObjectID,
                                                           UInt64 inChangeAction,
                                                           void *inChangeInfo)
{
    (void)inDriver;
    (void)inDeviceObjectID;
    (void)inChangeAction;
    (void)inChangeInfo;
    return kAudioHardwareNoError;
}

static OSStatus RayDriver_AbortDeviceConfigurationChange(AudioServerPlugInDriverRef inDriver,
                                                         AudioObjectID inDeviceObjectID,
                                                         UInt64 inChangeAction,
                                                         void *inChangeInfo)
{
    (void)inDriver;
    (void)inDeviceObjectID;
    (void)inChangeAction;
    (void)inChangeInfo;
    return kAudioHardwareNoError;
}

// ===========================================================================
// Propriedades — utilidades
// ===========================================================================

// O escopo efetivo da consulta: o HAL pode passar o escopo no endereco
// (mScope) ou nos dados de qualificador (ex.: kAudioDevicePropertyStreams).
static AudioObjectPropertyScope RayDriver_EffectiveScope(const AudioObjectPropertyAddress *inAddress,
                                                         UInt32 inQualifierDataSize,
                                                         const void *inQualifierData)
{
    if (inQualifierDataSize >= sizeof(AudioObjectPropertyScope) && inQualifierData != NULL) {
        return *(const AudioObjectPropertyScope *)inQualifierData;
    }
    return inAddress->mScope;
}

// Embalagem generica de UInt32 (tambem usada para AudioClassID).
static OSStatus RayDriver_GetUInt32(UInt32 value, UInt32 inDataSize, UInt32 *outDataSize, void *outData)
{
    *outDataSize = sizeof(UInt32);
    if (inDataSize < sizeof(UInt32)) {
        return kAudioHardwareBadPropertySizeError;
    }
    *(UInt32 *)outData = value;
    return kAudioHardwareNoError;
}

// Embalagem de CFString com retencao (o chamador libera o objeto retornado).
static OSStatus RayDriver_GetCFString(CFStringRef value, UInt32 inDataSize, UInt32 *outDataSize, void *outData)
{
    *outDataSize = sizeof(CFStringRef);
    if (inDataSize < sizeof(CFStringRef)) {
        return kAudioHardwareBadPropertySizeError;
    }
    *(CFStringRef *)outData = value;
    CFRetain(value);
    return kAudioHardwareNoError;
}

static OSStatus RayDriver_GetFloat64(Float64 value, UInt32 inDataSize, UInt32 *outDataSize, void *outData)
{
    *outDataSize = sizeof(Float64);
    if (inDataSize < sizeof(Float64)) {
        return kAudioHardwareBadPropertySizeError;
    }
    *(Float64 *)outData = value;
    return kAudioHardwareNoError;
}

static OSStatus RayDriver_GetASBD(const AudioStreamBasicDescription *value,
                                  UInt32 inDataSize,
                                  UInt32 *outDataSize,
                                  void *outData)
{
    *outDataSize = sizeof(AudioStreamBasicDescription);
    if (inDataSize < sizeof(AudioStreamBasicDescription)) {
        return kAudioHardwareBadPropertySizeError;
    }
    memcpy(outData, value, sizeof(AudioStreamBasicDescription));
    return kAudioHardwareNoError;
}

// ===========================================================================
// Propriedades do AudioPlugIn (kAudioObjectPlugInObject)
// ===========================================================================

static OSStatus RayDriver_GetPlugInPropertyData(const AudioObjectPropertyAddress *inAddress,
                                                UInt32 inQualifierDataSize,
                                                const void *inQualifierData,
                                                UInt32 inDataSize,
                                                UInt32 *outDataSize,
                                                void *outData)
{
    switch (inAddress->mSelector) {
        case kAudioObjectPropertyBaseClass:
            return RayDriver_GetUInt32(kAudioPlugInClassID, inDataSize, outDataSize, outData);
        case kAudioObjectPropertyClass:
            return RayDriver_GetUInt32(kAudioPlugInClassID, inDataSize, outDataSize, outData);
        case kAudioObjectPropertyManufacturer:
            return RayDriver_GetCFString(kRayManufacturer, inDataSize, outDataSize, outData);
        case kAudioPlugInPropertyResourceBundle:
            // sem bundle de recursos separado: o proprio bundle e o recurso
            return RayDriver_GetCFString(CFSTR(""), inDataSize, outDataSize, outData);
        case kAudioPlugInPropertyDeviceList: {
            if (inDataSize < sizeof(AudioObjectID)) {
                return kAudioHardwareBadPropertySizeError;
            }
            *outDataSize = sizeof(AudioObjectID);
            *(AudioObjectID *)outData = kRayDeviceObjectID;
            return kAudioHardwareNoError;
        }
        case kAudioPlugInPropertyTranslateUIDToDevice: {
            CFStringRef uid;
            if (inQualifierDataSize < sizeof(CFStringRef) || inQualifierData == NULL) {
                return kAudioHardwareBadPropertySizeError;
            }
            uid = *(const CFStringRef *)inQualifierData;
            if (uid != NULL && CFEqual(uid, kRayDeviceUID)) {
                return RayDriver_GetUInt32(kRayDeviceObjectID, inDataSize, outDataSize, outData);
            }
            return kAudioHardwareUnknownPropertyError;
        }
        default:
            return kAudioHardwareUnknownPropertyError;
    }
}

static OSStatus RayDriver_GetPlugInPropertyDataSize(const AudioObjectPropertyAddress *inAddress,
                                                    UInt32 inQualifierDataSize,
                                                    const void *inQualifierData,
                                                    UInt32 *outDataSize)
{
    switch (inAddress->mSelector) {
        case kAudioObjectPropertyBaseClass:
        case kAudioObjectPropertyClass:
        case kAudioPlugInPropertyTranslateUIDToDevice:
            *outDataSize = sizeof(AudioObjectID);
            return kAudioHardwareNoError;
        case kAudioObjectPropertyManufacturer:
        case kAudioPlugInPropertyResourceBundle:
            *outDataSize = sizeof(CFStringRef);
            return kAudioHardwareNoError;
        case kAudioPlugInPropertyDeviceList:
            *outDataSize = sizeof(AudioObjectID);
            return kAudioHardwareNoError;
        default:
            (void)inQualifierDataSize;
            (void)inQualifierData;
            return kAudioHardwareUnknownPropertyError;
    }
}

// ===========================================================================
// Propriedades do dispositivo (kRayDeviceObjectID)
// ===========================================================================

static UInt32 RayDriver_StreamConfigurationByteSize(UInt32 bufferCount)
{
    return (UInt32)(offsetof(AudioBufferList, mBuffers) + (size_t)bufferCount * sizeof(AudioBuffer));
}

static OSStatus RayDriver_GetDevicePropertyData(const AudioObjectPropertyAddress *inAddress,
                                                UInt32 inQualifierDataSize,
                                                const void *inQualifierData,
                                                UInt32 inDataSize,
                                                UInt32 *outDataSize,
                                                void *outData)
{
    AudioObjectPropertyScope scope = RayDriver_EffectiveScope(inAddress, inQualifierDataSize, inQualifierData);

    switch (inAddress->mSelector) {
        case kAudioObjectPropertyBaseClass:
            return RayDriver_GetUInt32(kAudioDeviceClassID, inDataSize, outDataSize, outData);
        case kAudioObjectPropertyClass:
            return RayDriver_GetUInt32(kAudioDeviceClassID, inDataSize, outDataSize, outData);
        case kAudioObjectPropertyManufacturer:
            return RayDriver_GetCFString(kRayManufacturer, inDataSize, outDataSize, outData);
        case kAudioObjectPropertyName:
            return RayDriver_GetCFString(kRayDeviceName, inDataSize, outDataSize, outData);
        case kAudioObjectPropertyModelName:
            return RayDriver_GetCFString(kRayDeviceModelUID, inDataSize, outDataSize, outData);
        case kAudioDevicePropertyDeviceUID:
            return RayDriver_GetCFString(kRayDeviceUID, inDataSize, outDataSize, outData);
        case kAudioDevicePropertyTransportType:
            return RayDriver_GetUInt32(kAudioDeviceTransportTypeVirtual, inDataSize, outDataSize, outData);
        case kAudioDevicePropertyConfigurationApplication: {
            CFStringRef value = gDevice.configurationApplication;
            if (value == NULL) {
                value = CFSTR("");
            }
            return RayDriver_GetCFString(value, inDataSize, outDataSize, outData);
        }
        case kAudioDevicePropertyDeviceIsAlive:
            return RayDriver_GetUInt32(1, inDataSize, outDataSize, outData);
        case kAudioDevicePropertyDeviceIsRunning:
            return RayDriver_GetUInt32(gDevice.ioClientCount > 0, inDataSize, outDataSize, outData);
        case kAudioDevicePropertyDeviceCanBeDefaultDevice:
            return RayDriver_GetUInt32(1, inDataSize, outDataSize, outData);
        case kAudioDevicePropertyLatency:
            return RayDriver_GetUInt32(0, inDataSize, outDataSize, outData);
        case kAudioDevicePropertyActualSampleRate:
            return RayDriver_GetFloat64(kRaySampleRate, inDataSize, outDataSize, outData);
        case kAudioDevicePropertyNominalSampleRate:
            return RayDriver_GetFloat64(kRaySampleRate, inDataSize, outDataSize, outData);
        case kAudioDevicePropertyAvailableNominalSampleRates: {
            if (inDataSize < sizeof(Float64)) {
                return kAudioHardwareBadPropertySizeError;
            }
            *outDataSize = sizeof(Float64);
            *(Float64 *)outData = kRaySampleRate;
            return kAudioHardwareNoError;
        }
        case kAudioObjectPropertyOwnedObjects: {
            if (inDataSize < sizeof(AudioObjectID)) {
                return kAudioHardwareBadPropertySizeError;
            }
            *outDataSize = sizeof(AudioObjectID);
            *(AudioObjectID *)outData = kRayInputStreamID;
            return kAudioHardwareNoError;
        }
        case kAudioDevicePropertyStreams: {
            if (scope == kAudioObjectPropertyScopeInput) {
                return RayDriver_GetUInt32(kRayInputStreamID, inDataSize, outDataSize, outData);
            }
            if (scope == kAudioObjectPropertyScopeOutput) {
                // captura-only (RF-204): nenhuma stream de saida
                *outDataSize = 0;
                return kAudioHardwareNoError;
            }
            return kAudioHardwareBadPropertySizeError;
        }
        case kAudioDevicePropertyStreamConfiguration: {
            UInt32 bufferCount = (scope == kAudioObjectPropertyScopeInput) ? 1 : 0;
            UInt32 byteSize = RayDriver_StreamConfigurationByteSize(bufferCount);
            if (inDataSize < byteSize) {
                return kAudioHardwareBadPropertySizeError;
            }
            *outDataSize = byteSize;
            memset(outData, 0, byteSize);
            ((AudioBufferList *)outData)->mNumberBuffers = bufferCount;
            if (bufferCount > 0) {
                ((AudioBufferList *)outData)->mBuffers[0].mNumberChannels = kRayChannelCount;
            }
            return kAudioHardwareNoError;
        }
        default:
            return kAudioHardwareUnknownPropertyError;
    }
}

static OSStatus RayDriver_GetDevicePropertyDataSize(const AudioObjectPropertyAddress *inAddress,
                                                    UInt32 inQualifierDataSize,
                                                    const void *inQualifierData,
                                                    UInt32 *outDataSize)
{
    AudioObjectPropertyScope scope = RayDriver_EffectiveScope(inAddress, inQualifierDataSize, inQualifierData);

    switch (inAddress->mSelector) {
        case kAudioObjectPropertyBaseClass:
        case kAudioObjectPropertyClass:
        case kAudioDevicePropertyTransportType:
        case kAudioDevicePropertyDeviceIsAlive:
        case kAudioDevicePropertyDeviceIsRunning:
        case kAudioDevicePropertyDeviceCanBeDefaultDevice:
        case kAudioDevicePropertyLatency:
            *outDataSize = sizeof(UInt32);
            return kAudioHardwareNoError;
        case kAudioObjectPropertyManufacturer:
        case kAudioObjectPropertyName:
        case kAudioObjectPropertyModelName:
        case kAudioDevicePropertyDeviceUID:
        case kAudioDevicePropertyConfigurationApplication:
            *outDataSize = sizeof(CFStringRef);
            return kAudioHardwareNoError;
        case kAudioDevicePropertyActualSampleRate:
        case kAudioDevicePropertyNominalSampleRate:
        case kAudioDevicePropertyAvailableNominalSampleRates:
            *outDataSize = sizeof(Float64);
            return kAudioHardwareNoError;
        case kAudioObjectPropertyOwnedObjects:
        case kAudioDevicePropertyStreams:
            *outDataSize = sizeof(AudioObjectID);
            return kAudioHardwareNoError;
        case kAudioDevicePropertyStreamConfiguration:
            *outDataSize = RayDriver_StreamConfigurationByteSize(
                (scope == kAudioObjectPropertyScopeInput) ? 1 : 0);
            return kAudioHardwareNoError;
        default:
            return kAudioHardwareUnknownPropertyError;
    }
}

// ===========================================================================
// Propriedades do stream de entrada (kRayInputStreamID)
// ===========================================================================

static OSStatus RayDriver_GetStreamPropertyData(const AudioObjectPropertyAddress *inAddress,
                                                UInt32 inQualifierDataSize,
                                                const void *inQualifierData,
                                                UInt32 inDataSize,
                                                UInt32 *outDataSize,
                                                void *outData)
{
    (void)inQualifierDataSize;
    (void)inQualifierData;
    switch (inAddress->mSelector) {
        case kAudioObjectPropertyBaseClass:
            return RayDriver_GetUInt32(kAudioStreamClassID, inDataSize, outDataSize, outData);
        case kAudioObjectPropertyClass:
            return RayDriver_GetUInt32(kAudioStreamClassID, inDataSize, outDataSize, outData);
        case kAudioObjectPropertyManufacturer:
            return RayDriver_GetCFString(kRayManufacturer, inDataSize, outDataSize, outData);
        case kAudioObjectPropertyName:
            return RayDriver_GetCFString(kRayInputStreamName, inDataSize, outDataSize, outData);
        case kAudioStreamPropertyDirection:
            return RayDriver_GetUInt32(1, inDataSize, outDataSize, outData); // 1 = entrada
        case kAudioStreamPropertyTerminalType:
            return RayDriver_GetUInt32(kAudioStreamTerminalTypeMicrophone, inDataSize, outDataSize, outData);
        case kAudioStreamPropertyStartingChannel:
            return RayDriver_GetUInt32(1, inDataSize, outDataSize, outData);
        case kAudioStreamPropertyLatency:
            return RayDriver_GetUInt32(0, inDataSize, outDataSize, outData);
        case kAudioStreamPropertyIsActive:
            return RayDriver_GetUInt32(1, inDataSize, outDataSize, outData);
        case kAudioStreamPropertyVirtualFormat:
            return RayDriver_GetASBD(&kInputFormat, inDataSize, outDataSize, outData);
        case kAudioStreamPropertyPhysicalFormat:
            return RayDriver_GetASBD(&kInputFormat, inDataSize, outDataSize, outData);
        default:
            return kAudioHardwareUnknownPropertyError;
    }
}

static OSStatus RayDriver_GetStreamPropertyDataSize(const AudioObjectPropertyAddress *inAddress,
                                                    UInt32 inQualifierDataSize,
                                                    const void *inQualifierData,
                                                    UInt32 *outDataSize)
{
    (void)inQualifierDataSize;
    (void)inQualifierData;
    switch (inAddress->mSelector) {
        case kAudioObjectPropertyBaseClass:
        case kAudioObjectPropertyClass:
        case kAudioStreamPropertyDirection:
        case kAudioStreamPropertyTerminalType:
        case kAudioStreamPropertyStartingChannel:
        case kAudioStreamPropertyLatency:
        case kAudioStreamPropertyIsActive:
            *outDataSize = sizeof(UInt32);
            return kAudioHardwareNoError;
        case kAudioObjectPropertyManufacturer:
        case kAudioObjectPropertyName:
            *outDataSize = sizeof(CFStringRef);
            return kAudioHardwareNoError;
        case kAudioStreamPropertyVirtualFormat:
        case kAudioStreamPropertyPhysicalFormat:
            *outDataSize = sizeof(AudioStreamBasicDescription);
            return kAudioHardwareNoError;
        default:
            return kAudioHardwareUnknownPropertyError;
    }
}

// ===========================================================================
// Propriedades — despacho e acesso
// ===========================================================================

static Boolean RayDriver_HasProperty(AudioServerPlugInDriverRef inDriver,
                                     AudioObjectID inObjectID,
                                     pid_t inClientProcessID,
                                     const AudioObjectPropertyAddress *inAddress)
{
    OSStatus result;
    UInt32 size = 0;

    (void)inDriver;
    result = RayDriver_GetPropertyDataSize(inDriver, inObjectID, inClientProcessID, inAddress, 0, NULL, &size);
    return result == kAudioHardwareNoError;
}

static OSStatus RayDriver_IsPropertySettable(AudioServerPlugInDriverRef inDriver,
                                             AudioObjectID inObjectID,
                                             pid_t inClientProcessID,
                                             const AudioObjectPropertyAddress *inAddress,
                                             Boolean *outIsSettable)
{
    (void)inDriver;
    (void)inClientProcessID;
    if (inObjectID == kRayDeviceObjectID &&
        inAddress->mSelector == kAudioDevicePropertyConfigurationApplication) {
        *outIsSettable = true;
        return kAudioHardwareNoError;
    }
    *outIsSettable = false;
    return kAudioHardwareNoError;
}

static OSStatus RayDriver_GetPropertyDataSize(AudioServerPlugInDriverRef inDriver,
                                              AudioObjectID inObjectID,
                                              pid_t inClientProcessID,
                                              const AudioObjectPropertyAddress *inAddress,
                                              UInt32 inQualifierDataSize,
                                              const void *inQualifierData,
                                              UInt32 *outDataSize)
{
    (void)inDriver;
    (void)inClientProcessID;
    switch (inObjectID) {
        case kAudioObjectPlugInObject:
            return RayDriver_GetPlugInPropertyDataSize(inAddress, inQualifierDataSize, inQualifierData, outDataSize);
        case kRayDeviceObjectID:
            return RayDriver_GetDevicePropertyDataSize(inAddress, inQualifierDataSize, inQualifierData, outDataSize);
        case kRayInputStreamID:
            return RayDriver_GetStreamPropertyDataSize(inAddress, inQualifierDataSize, inQualifierData, outDataSize);
        default:
            return kAudioHardwareBadObjectError;
    }
}

static OSStatus RayDriver_GetPropertyData(AudioServerPlugInDriverRef inDriver,
                                          AudioObjectID inObjectID,
                                          pid_t inClientProcessID,
                                          const AudioObjectPropertyAddress *inAddress,
                                          UInt32 inQualifierDataSize,
                                          const void *inQualifierData,
                                          UInt32 inDataSize,
                                          UInt32 *outDataSize,
                                          void *outData)
{
    (void)inDriver;
    (void)inClientProcessID;
    switch (inObjectID) {
        case kAudioObjectPlugInObject:
            return RayDriver_GetPlugInPropertyData(inAddress, inQualifierDataSize, inQualifierData,
                                                   inDataSize, outDataSize, outData);
        case kRayDeviceObjectID:
            return RayDriver_GetDevicePropertyData(inAddress, inQualifierDataSize, inQualifierData,
                                                   inDataSize, outDataSize, outData);
        case kRayInputStreamID:
            return RayDriver_GetStreamPropertyData(inAddress, inQualifierDataSize, inQualifierData,
                                                   inDataSize, outDataSize, outData);
        default:
            return kAudioHardwareBadObjectError;
    }
}

static OSStatus RayDriver_SetPropertyData(AudioServerPlugInDriverRef inDriver,
                                          AudioObjectID inObjectID,
                                          pid_t inClientProcessID,
                                          const AudioObjectPropertyAddress *inAddress,
                                          UInt32 inQualifierDataSize,
                                          const void *inQualifierData,
                                          UInt32 inDataSize,
                                          const void *inData)
{
    (void)inDriver;
    (void)inClientProcessID;
    (void)inQualifierDataSize;
    (void)inQualifierData;
    if (inObjectID != kRayDeviceObjectID ||
        inAddress->mSelector != kAudioDevicePropertyConfigurationApplication) {
        return kAudioHardwareUnknownPropertyError;
    }
    if (inDataSize < sizeof(CFStringRef)) {
        return kAudioHardwareBadPropertySizeError;
    }
    pthread_mutex_lock(&gDevice.lock);
    if (gDevice.configurationApplication != NULL) {
        CFRelease(gDevice.configurationApplication);
        gDevice.configurationApplication = NULL;
    }
    if (*(const CFStringRef *)inData != NULL) {
        gDevice.configurationApplication = *(const CFStringRef *)inData;
        CFRetain(gDevice.configurationApplication);
    }
    pthread_mutex_unlock(&gDevice.lock);
    return kAudioHardwareNoError;
}

// ===========================================================================
// IO
// ===========================================================================

static OSStatus RayDriver_StartIO(AudioServerPlugInDriverRef inDriver,
                                  AudioObjectID inDeviceObjectID,
                                  UInt32 inClientID)
{
    (void)inDriver;
    if (inDeviceObjectID != kRayDeviceObjectID) {
        return kAudioHardwareBadObjectError;
    }
    return RayDevice_StartIO(inClientID);
}

static OSStatus RayDriver_StopIO(AudioServerPlugInDriverRef inDriver,
                                 AudioObjectID inDeviceObjectID,
                                 UInt32 inClientID)
{
    (void)inDriver;
    if (inDeviceObjectID != kRayDeviceObjectID) {
        return kAudioHardwareBadObjectError;
    }
    return RayDevice_StopIO(inClientID);
}

static OSStatus RayDriver_GetZeroTimeStamp(AudioServerPlugInDriverRef inDriver,
                                           AudioObjectID inDeviceObjectID,
                                           UInt32 inClientID,
                                           Float64 *outSampleTime,
                                           UInt64 *outHostTime,
                                           UInt64 *outSeed)
{
    (void)inDriver;
    (void)inClientID;
    if (inDeviceObjectID != kRayDeviceObjectID) {
        return kAudioHardwareBadObjectError;
    }
    RayDevice_GetZeroTimeStamp(outSampleTime, outHostTime, outSeed);
    return kAudioHardwareNoError;
}

static OSStatus RayDriver_WillDoIOOperation(AudioServerPlugInDriverRef inDriver,
                                            AudioObjectID inDeviceObjectID,
                                            UInt32 inClientID,
                                            UInt32 inOperationID,
                                            Boolean *outWillDo,
                                            Boolean *outWillDoInPlace)
{
    (void)inDriver;
    (void)inDeviceObjectID;
    (void)inClientID;
    if (inOperationID == kAudioServerPlugInIOOperationReadInput) {
        // transferencia do anel para o buffer do cliente, no proprio buffer
        *outWillDo = true;
        *outWillDoInPlace = true;
    } else {
        *outWillDo = false;
        *outWillDoInPlace = false;
    }
    return kAudioHardwareNoError;
}

static OSStatus RayDriver_BeginIOOperation(AudioServerPlugInDriverRef inDriver,
                                           AudioObjectID inDeviceObjectID,
                                           UInt32 inClientID,
                                           UInt32 inOperationID,
                                           UInt32 inIOBufferFrameSize,
                                           const AudioServerPlugInIOCycleInfo *inIOCycleInfo)
{
    (void)inDriver;
    (void)inDeviceObjectID;
    (void)inClientID;
    (void)inOperationID;
    (void)inIOBufferFrameSize;
    (void)inIOCycleInfo;
    return kAudioHardwareNoError;
}

static OSStatus RayDriver_DoIOOperation(AudioServerPlugInDriverRef inDriver,
                                        AudioObjectID inDeviceObjectID,
                                        AudioObjectID inStreamObjectID,
                                        UInt32 inClientID,
                                        UInt32 inOperationID,
                                        UInt32 inIOBufferFrameSize,
                                        const AudioServerPlugInIOCycleInfo *inIOCycleInfo,
                                        void *ioMainBuffer,
                                        void *ioSecondaryBuffer)
{
    (void)inDriver;
    (void)inStreamObjectID;
    (void)inClientID;
    (void)inIOCycleInfo;
    (void)ioSecondaryBuffer;
    if (inDeviceObjectID != kRayDeviceObjectID) {
        return kAudioHardwareBadObjectError;
    }
    if (inOperationID == kAudioServerPlugInIOOperationReadInput) {
        RayDevice_ReadInput(inIOBufferFrameSize, ioMainBuffer);
    }
    return kAudioHardwareNoError;
}

static OSStatus RayDriver_EndIOOperation(AudioServerPlugInDriverRef inDriver,
                                         AudioObjectID inDeviceObjectID,
                                         UInt32 inClientID,
                                         UInt32 inOperationID,
                                         UInt32 inIOBufferFrameSize,
                                         const AudioServerPlugInIOCycleInfo *inIOCycleInfo)
{
    (void)inDriver;
    (void)inDeviceObjectID;
    (void)inClientID;
    (void)inOperationID;
    (void)inIOBufferFrameSize;
    (void)inIOCycleInfo;
    return kAudioHardwareNoError;
}

// ===========================================================================
// Fabrica
// ===========================================================================

void *AudioServerPlugInMain(CFAllocatorRef allocator, CFUUIDRef requestedTypeUUID)
{
    (void)allocator;
    if (!CFEqual(requestedTypeUUID, kAudioServerPlugInTypeUUID)) {
        return NULL;
    }
    return &gDriverInterface;
}

AudioServerPlugInDriverInterface gDriverInterface = {
    NULL, // _reserved (parte padrao da heranca IUnknown)
    RayDriver_QueryInterface,
    RayDriver_AddRef,
    RayDriver_Release,
    RayDriver_Initialize,
    RayDriver_CreateDevice,
    RayDriver_DestroyDevice,
    RayDriver_AddDeviceClient,
    RayDriver_RemoveDeviceClient,
    RayDriver_PerformDeviceConfigurationChange,
    RayDriver_AbortDeviceConfigurationChange,
    RayDriver_HasProperty,
    RayDriver_IsPropertySettable,
    RayDriver_GetPropertyDataSize,
    RayDriver_GetPropertyData,
    RayDriver_SetPropertyData,
    RayDriver_StartIO,
    RayDriver_StopIO,
    RayDriver_GetZeroTimeStamp,
    RayDriver_WillDoIOOperation,
    RayDriver_BeginIOOperation,
    RayDriver_DoIOOperation,
    RayDriver_EndIOOperation,
};
