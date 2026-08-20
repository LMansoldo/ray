// Adaptador local de estado das Configurações (T-406): status dos provedores,
// config por função, permissões, medidores, versão e atalhos. Mesmo padrão do
// state-feed.ts do T-405. O comando core que forneceria esse estado ainda não
// existe (core/src/lib.rs registra apenas set_stealth/toggle_window/suggest/
// transcribe_pending_pcm) — quando existir, o feed padrão passa a lê-lo via
// invoke(). Por ora o padrão é um placeholder RESTRITIVO: nada configurado,
// tudo ausente — as abas nunca exibem um estado "conectado" inventado sem
// verificação real.
import { DEFAULT_SHORTCUTS } from '../../../../../contracts/settings'
import type { SettingsState } from './types'

/** Fonte de estado das Configurações: reavaliada a cada leitura, sem cache. */
export type SettingsStateFeed = () => SettingsState

const RESTRICTIVE_PLACEHOLDER: SettingsState = {
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
