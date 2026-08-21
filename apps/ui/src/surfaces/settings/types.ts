// Tipos da superfície Configurações (T-406, RF-301..1004). O estado real
// (status dos provedores, config por função, permissões, atalhos, versão do
// app) chega por um adaptador local injetável (settings-feed.ts): o comando
// core que forneceria esse estado ainda não existe — core/src/lib.rs registra
// apenas set_stealth/toggle_window/suggest/transcribe_pending_pcm.
//
// Os campos de domínio reusam os tipos do contrato (contracts/settings.ts,
// contracts/ipc.ts) e do onboarding (T-405, DRY) — nunca são redefinidos aqui.
import type { AiFunction, ProviderKind } from '../../../../../contracts/ipc'
import type { ShortcutMap } from '../../../../../contracts/settings'
import type {
  OnboardingPermissionId,
  OnboardingPermissionState,
  OnboardingPlatform,
} from '../onboarding/types'

/** As 7 abas da superfície Configurações, na ordem do backlog T-406. */
export type SettingsTabId =
  | 'aiSources'
  | 'models'
  | 'audioScreen'
  | 'permissions'
  | 'features'
  | 'shortcuts'
  | 'help'

/**
 * Slots de provedor exibidos na aba Fontes de IA (RF-401/406): os quatro
 * modos de conexão BYOK sob uma abstração comum — chave de API (deepseek,
 * anthropic, gemini, openai), login por assinatura (chatgpt), agregador
 * (openrouter) e endpoint compatível com OpenAI (generic, local).
 */
export type ProviderSlotId =
  | 'deepseek'
  | 'anthropic'
  | 'gemini'
  | 'openai'
  | 'chatgpt'
  | 'openrouter'
  | 'generic'

/**
 * Status de conexão de um provedor (RF-403). 'notConfigured' é adição nossa:
 * o RF-403 lista só Conectado/Não Conectado, mas o estado "nunca configurado"
 * precisa ser distinguível do "configurado e falhou" (decisão registrada no
 * RED — ver decisions.md).
 */
export type ProviderConnectionStatus = 'connected' | 'disconnected' | 'notConfigured'

/** Configuração ativa de uma função (RF-404): provedor + modelo. */
export interface SettingsFunctionConfig {
  kind: ProviderKind
  model: string
}

/** Estado completo da superfície Configurações, lido do feed local. */
export interface SettingsState {
  platform: OnboardingPlatform
  providerStatus: Record<ProviderSlotId, ProviderConnectionStatus>
  functionConfig: Record<AiFunction, SettingsFunctionConfig | null>
  metersVisible: boolean
  permissions: Record<OnboardingPermissionId, OnboardingPermissionState>
  appVersion: string
  shortcuts: ShortcutMap
}
