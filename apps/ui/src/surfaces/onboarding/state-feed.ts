// Adaptador local de estado do onboarding (T-405): permissões concedidas,
// dispositivos de áudio, transcrição e análise configuradas. O comando core
// que forneceria esse estado ainda não existe (core/src/lib.rs registra
// apenas set_stealth/toggle_window/suggest/transcribe_pending_pcm) — quando
// existir, o feed padrão passa a lê-lo via invoke(). Por ora o padrão é um
// placeholder restritivo (tudo ausente): o fluxo nunca avança sem verificação.
import type { OnboardingState } from './types'

/** Fonte de estado do onboarding: reavaliada a cada leitura, sem cache. */
export type OnboardingStateFeed = () => OnboardingState

const RESTRICTIVE_PLACEHOLDER: OnboardingState = {
  platform: 'macos',
  permissions: {
    microphone: 'notGranted',
    screenRecording: 'notGranted',
    accessibility: 'notGranted',
    speechRecognition: 'notGranted',
  },
  audioDevicesConfigured: false,
  transcriptionConfigured: false,
  analysisConfigured: false,
}

let activeFeed: OnboardingStateFeed = () => RESTRICTIVE_PLACEHOLDER

/** Injeta uma fonte de estado (usada pelos testes e, no futuro, pelo core). */
export function setOnboardingStateFeed(feed: OnboardingStateFeed): void {
  activeFeed = feed
}

/** Volta ao placeholder restritivo. */
export function resetOnboardingStateFeed(): void {
  activeFeed = () => RESTRICTIVE_PLACEHOLDER
}

/** Lê o estado atual, reavaliando o feed a cada chamada (sem cache). */
export function readOnboardingState(): OnboardingState {
  return activeFeed()
}
