// Canal de ações declaradas da superfície Configurações (T-406) — a fronteira
// de SAÍDA do estado da UI. Comandos que o núcleo já registra saem direto por
// invoke() (save_feature_toggles, apply_shortcuts, save_overlay_template);
// ações sem comando core ainda saem pelo canal pub/sub local (mesmo padrão de
// navigation.ts T-402, restart.ts T-405 e lib/glass/opacity.ts T-400). A UI
// NUNCA inventa um nome de comando por conta própria (general.md: o contrato
// é a fronteira).
//
// ADR-003: o único segredo que cruza esta fronteira é `credentialSave.secret`,
// injetado por ação, efêmero — nunca persistido nem logado aqui.
import { invoke } from '@tauri-apps/api/core'
import type { AiFunction, ProviderConnectionMode, ProviderKind } from '../../../../../contracts/ipc'
import type {
  FeatureToggleName,
  ShortcutBinding,
  ShortcutCommand,
  SttLanguage,
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
  | { type: 'sttLanguageChange'; language: SttLanguage }
  | { type: 'functionProviderChange'; function: AiFunction; kind: ProviderKind; model: string }
  | { type: 'shortcutChange'; command: ShortcutCommand; binding: ShortcutBinding }
  | { type: 'shortcutReset' }
  | { type: 'metersVisibilityChange'; visible: boolean }
  | { type: 'logFolderOpen' }
  | { type: 'logCopy' }
  | { type: 'overlayTemplateChange'; enabled: boolean; template: string }

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

/**
 * Persiste o template de overlay customizado via comando core registrado
 * (save_overlay_template em core/src/lib.rs). O comando emite o evento global
 * 'ray:overlay-template-changed' em caso de ok — a janela do overlay troca de
 * card ao vivo, sem reinício. Validação de tamanho fica ANTES desta chamada
 * (a aba mostra o erro e não invoca o comando).
 */
export async function saveOverlayTemplate(enabled: boolean, template: string): Promise<void> {
  await invoke('save_overlay_template', { enabled, template })
}
