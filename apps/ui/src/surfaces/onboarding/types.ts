// Tipos da superfície Onboarding (T-405, RF-101..104). O estado real
// (permissões concedidas, dispositivos de áudio, transcrição e análise
// configuradas) chega por um adaptador local injetável (state-feed.ts): o
// comando core que forneceria esse estado ainda não existe — core/src/lib.rs
// registra apenas set_stealth/toggle_window/suggest/transcribe_pending_pcm.

/** Plataformas suportadas pelo fluxo de onboarding (RF-103). */
export type OnboardingPlatform = 'macos' | 'windows' | 'linux'

/** Permissões de sistema mapeadas no passo 1 (RF-103). */
export type OnboardingPermissionId =
  | 'microphone'
  | 'screenRecording'
  | 'accessibility'
  | 'speechRecognition'

/** Estado de uma permissão no fluxo (RF-104). */
export type OnboardingPermissionState = 'granted' | 'notGranted' | 'notRequired'

/** Estado completo do onboarding, lido do adaptador local de estado. */
export interface OnboardingState {
  platform: OnboardingPlatform
  permissions: Record<OnboardingPermissionId, OnboardingPermissionState>
  audioDevicesConfigured: boolean
  transcriptionConfigured: boolean
  analysisConfigured: boolean
}
