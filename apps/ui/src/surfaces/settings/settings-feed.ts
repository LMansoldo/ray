// Adaptador local de estado das Configurações (T-406): status dos provedores,
// config por função, permissões, medidores, versão, atalhos e features.
// Mesmo padrão do state-feed.ts do T-405. loadSettingsState hidrata dos
// comandos core registrados (core/src/lib.rs): get_provider_statuses (fluxo
// de persistência de credenciais — docs/credential-persistence.md),
// get_permission_status (TCC real do macOS), get_shortcuts (mapa ativo no
// SO), get_app_settings (features persistidas via sidecar) e getVersion
// (@tauri-apps/api/app). Cada consulta é OPCIONAL e nunca rejeita: falha
// individual cai de volta na base do feed injetável (readSettingsState),
// cujo padrão é um placeholder RESTRITIVO — as abas nunca exibem um estado
// "conectado" inventado sem verificação real.
import { invoke } from '@tauri-apps/api/core'
import { getVersion } from '@tauri-apps/api/app'
import {
  DEFAULT_FEATURE_TOGGLES,
  DEFAULT_SHORTCUTS,
  FEATURE_TOGGLE_NAMES,
} from '../../../../../contracts/settings'
import type { FeatureToggles, ShortcutMap } from '../../../../../contracts/settings'
import type { GetCredentialsResponse } from '../../../../../contracts/ipc'
import type { OnboardingPermissionId, OnboardingPermissionState } from '../onboarding/types'
import type { ProviderSlotId, ProviderConnectionStatus, SettingsState } from './types'

/** Fonte de estado das Configurações: reavaliada a cada leitura, sem cache. */
export type SettingsStateFeed = () => SettingsState

export const RESTRICTIVE_PLACEHOLDER: SettingsState = {
  platform: 'macos',
  providerStatus: {
    deepseek: 'notConfigured',
    anthropic: 'notConfigured',
    gemini: 'notConfigured',
    openai: 'notConfigured',
    chatgpt: 'notConfigured',
    openrouter: 'notConfigured',
    generic: 'notConfigured',
  },
  functionConfig: { TRANSCRIPTION: null, ANALYSIS: null, TRANSLATION: null },
  metersVisible: true,
  permissions: {
    microphone: 'notGranted',
    screenRecording: 'notGranted',
    accessibility: 'notGranted',
    speechRecognition: 'notGranted',
  },
  appVersion: '0.0.0',
  shortcuts: DEFAULT_SHORTCUTS,
  features: { ...DEFAULT_FEATURE_TOGGLES },
}

let activeFeed: SettingsStateFeed = () => RESTRICTIVE_PLACEHOLDER

/** Injeta uma fonte de estado (usada pelos testes e, no futuro, pelo core). */
export function setSettingsStateFeed(feed: SettingsStateFeed): void {
  activeFeed = feed
}

/** Volta ao placeholder restritivo. */
export function resetSettingsStateFeed(): void {
  activeFeed = () => RESTRICTIVE_PLACEHOLDER
}

/** Lê o estado atual, reavaliando o feed a cada chamada (sem cache). */
export function readSettingsState(): SettingsState {
  return activeFeed()
}

const PERMISSION_IDS: OnboardingPermissionId[] = [
  'microphone',
  'screenRecording',
  'accessibility',
  'speechRecognition',
]

/** Normaliza o mapa do core para o contrato local (mesma regra do onboarding:
 *  apenas 'granted' conta como concedida; 'denied' vira 'notGranted'). */
function toPermissionState(
  map: Record<OnboardingPermissionId, OnboardingPermissionState>,
  core: Record<string, unknown>,
): void {
  for (const id of PERMISSION_IDS) {
    map[id] = core[id] === 'granted' ? 'granted' : 'notGranted'
  }
}

/**
 * Validação frouxa da forma de um mapa de atalhos vindo do core: um objeto
 * cujos valores são null ou { enabled, modifiers, key }. Qualquer outra
 * forma descarta a resposta inteira (mantém a base).
 */
function isShortcutMapShape(value: unknown): value is ShortcutMap {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false
  }
  for (const binding of Object.values(value)) {
    if (binding === null) {
      continue
    }
    if (!binding || typeof binding !== 'object' || Array.isArray(binding)) {
      return false
    }
    const candidate = binding as Record<string, unknown>
    if (
      typeof candidate.enabled !== 'boolean' ||
      !Array.isArray(candidate.modifiers) ||
      typeof candidate.key !== 'string'
    ) {
      return false
    }
  }
  return true
}

/**
 * Carrega o estado de Settings do core. A base é o estado do feed
 * (readSettingsState — injetável em testes); cada consulta abaixo é
 * opcional: encontrada e válida, tem precedência sobre a base; ausente
 * (sidecar/core fora do Tauri) ou inválida, preserva a base. Nunca
 * rejeita.
 */
export async function loadSettingsState(): Promise<SettingsState> {
  const base: SettingsState = readSettingsState()

  // Status dos provedores (get_provider_statuses): salvo ≠ conectado —
  // chave existe no banco+cofre; 'connected' exige validação bem-sucedida
  // contra o provedor (RF-403).
  let credentials: GetCredentialsResponse = { credentials: [] }
  try {
    const creds = await invoke<GetCredentialsResponse>('get_provider_statuses')
    if (creds && Array.isArray(creds.credentials)) {
      credentials = creds
    }
  } catch {
    // sidecar não pronto — mantém a base
  }

  const providerStatus: Record<ProviderSlotId, ProviderConnectionStatus> = {
    ...base.providerStatus,
  }
  for (const credential of credentials.credentials) {
    if (!(credential.slot in providerStatus)) {
      continue
    }
    providerStatus[credential.slot as ProviderSlotId] = credential.lastValidatedAt
      ? 'connected'
      : 'saved'
  }

  const state: SettingsState = { ...base, providerStatus }

  // Permissões reais do core (RF-103) — sem disparar dialogs.
  try {
    const corePermissions = await invoke<Record<string, unknown>>('get_permission_status')
    if (corePermissions && typeof corePermissions === 'object') {
      const permissions = { ...base.permissions }
      toPermissionState(permissions, corePermissions)
      state.permissions = permissions
    }
  } catch {
    // core indisponível — mantém a base
  }

  // Atalhos ativos no SO (RF-601 — a aba Atalhos hidrata deste mapa).
  try {
    const coreShortcuts = await invoke<ShortcutMap>('get_shortcuts')
    if (isShortcutMapShape(coreShortcuts)) {
      state.shortcuts = { ...base.shortcuts, ...coreShortcuts }
    }
  } catch {
    // core indisponível — mantém a base
  }

  // Features persistidas (RF-700) — só chaves booleanas do contrato.
  try {
    const settings = await invoke<{ features?: unknown }>('get_app_settings')
    if (settings && typeof settings === 'object' && settings.features &&
        typeof settings.features === 'object' && !Array.isArray(settings.features)) {
      const persisted = settings.features as Record<string, unknown>
      const features: FeatureToggles = { ...DEFAULT_FEATURE_TOGGLES, ...base.features }
      for (const name of FEATURE_TOGGLE_NAMES) {
        if (typeof persisted[name] === 'boolean') {
          features[name] = persisted[name] as boolean
        }
      }
      state.features = features
    }
  } catch {
    // sidecar não pronto — mantém a base (defaults do contrato)
  }

  // Versão real do app (plugin app do Tauri).
  try {
    state.appVersion = await getVersion()
  } catch {
    // fora do Tauri — mantém a base
  }

  // Medidores (RF-206): preferência local persistida; ausente = visível.
  // (A chave 'ray_audio_meters' é allowlistada no teste de integridade; a
  // chamada opcional tolera ambientes sem Storage utilitável.)
  state.metersVisible = window.localStorage.getItem?.('ray_audio_meters') !== '0'

  return state
}
