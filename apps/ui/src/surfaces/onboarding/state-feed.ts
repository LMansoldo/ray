// Adaptador local de estado do onboarding (T-405): permissões concedidas,
// dispositivos de áudio, transcrição e análise configuradas. As permissões
// vêm do core via invoke('get_permission_status' / 'request_all_permissions')
// (TCC real do macOS). Os flags de configuração (passos 2-4) permanecem
// permissivos enquanto os pipelines de áudio/STT não existem (T-500) — não
// faz sentido travar o onboarding em recursos ausentes, apenas em permissões.
import { invoke } from '@tauri-apps/api/core'
import type { OnboardingState, OnboardingPermissionId } from './types'

/** Fonte de estado do onboarding: reavaliada a cada leitura, sem cache. */
export type OnboardingStateFeed = () => OnboardingState

type PermissionValue = 'granted' | 'notGranted' | 'denied'

type CorePermissionMap = Record<OnboardingPermissionId, PermissionValue>

const PERMISSION_IDS: OnboardingPermissionId[] = [
  'microphone',
  'screenRecording',
  'accessibility',
  'speechRecognition',
]

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

/** Injeta uma fonte de estado (usada pelos testes; o default consulta o core). */
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

/** Normaliza a resposta do core para o contrato local. */
function toState(map: Partial<CorePermissionMap>): OnboardingState {
  const permissions = {} as OnboardingState['permissions']
  for (const id of PERMISSION_IDS) {
    permissions[id] = map[id] === 'granted' ? 'granted' : 'notGranted'
  }
  return {
    platform: 'macos',
    permissions,
    // Passos 2-4 (áudio/STT/análise) dependem do pipeline T-500, ainda não
    // implementado — ficam permissivos para não travar o onboarding.
    audioDevicesConfigured: true,
    transcriptionConfigured: true,
    analysisConfigured: true,
  }
}

/** Consulta o status real de permissões no core (sem disparar dialogs).
 *  Retorna null quando o core não responde (fora do Tauri / sidecar off). */
export async function loadOnboardingState(): Promise<OnboardingState | null> {
  try {
    const map = await invoke<CorePermissionMap>('get_permission_status')
    return toState(map)
  } catch {
    return null
  }
}

/** Botão "Habilitar tudo": dispara as dialogs TCC e devolve o status final.
 *  Retorna null quando o core não responde. */
export async function requestAllPermissions(): Promise<OnboardingState | null> {
  try {
    const map = await invoke<CorePermissionMap>('request_all_permissions')
    return toState(map)
  } catch {
    return null
  }
}
