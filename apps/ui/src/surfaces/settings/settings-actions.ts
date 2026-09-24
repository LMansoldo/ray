// Canal de ações declaradas da superfície Configurações (T-406) — a fronteira
// de SAÍDA do estado da UI. Como nenhum comando core existe ainda para
// credenciais/atalhos/features/logs (core/src/lib.rs registra apenas
// set_stealth/toggle_window/suggest/transcribe_pending_pcm), as ações saem por
// este canal pub/sub local (mesmo padrão de navigation.ts T-402, restart.ts
// T-405 e lib/glass/opacity.ts T-400). Quando os comandos core existirem, este
// canal passa a chamá-los via invoke() — a UI NUNCA inventa um nome de comando
// por conta própria (general.md: o contrato é a fronteira).
//
// ADR-003: o único segredo que cruza esta fronteira é `credentialSave.secret`,
// injetado por ação, efêmero — nunca persistido nem logado aqui.
import type { AiFunction, ProviderConnectionMode, ProviderKind } from '../../../../../contracts/ipc'
import type {
  FeatureToggleName,
  ShortcutBinding,
  ShortcutCommand,
} from '../../../../../contracts/settings'
import type { ProviderSlotId } from './types'

/** União exata das ações declaradas da superfície Configurações. */
export type SettingsAction =
  | {
      type: 'credentialSave'
      /** Slot embutido ou slot de modelo personalizado ('custom-<id>'). */
      slot: ProviderSlotId | `custom-${string}`
      kind: ProviderKind
      connectionMode: ProviderConnectionMode
      baseUrl?: string
      secret: string
    }
  | { type: 'featureToggleChange'; name: FeatureToggleName; enabled: boolean }
  | { type: 'functionProviderChange'; function: AiFunction; kind: ProviderKind; model: string }
  | { type: 'shortcutChange'; command: ShortcutCommand; binding: ShortcutBinding }
  | { type: 'shortcutReset' }
  | { type: 'metersVisibilityChange'; visible: boolean }
  | { type: 'logFolderOpen' }
  | { type: 'logCopy' }

type SettingsActionListener = (action: SettingsAction) => void

const listeners = new Set<SettingsActionListener>()

/** Observa ações da superfície; o retorno cancela a inscrição. */
export function onSettingsAction(listener: SettingsActionListener): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** Emite uma ação para todos os inscritos. */
export function dispatchSettingsAction(action: SettingsAction): void {
  for (const listener of listeners) {
    listener(action)
  }
}
