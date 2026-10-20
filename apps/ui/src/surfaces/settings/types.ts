// Tipos da superfície Configurações (T-406, RF-301..1004). O estado real
// (status dos provedores, permissões, atalhos, features, versão do app)
// chega pelo adaptador local injetável (settings-feed.ts), que hidrata dos
// comandos core registrados (core/src/lib.rs: get_provider_statuses,
// get_permission_status, get_shortcuts, get_app_settings) — cada falha
// individual cai de volta na base restritiva.
//
// Os campos de domínio reusam os tipos do contrato (contracts/settings.ts,
// contracts/ipc.ts) e do onboarding (T-405, DRY) — nunca são redefinidos aqui.
import type { AiFunction, ProviderKind } from '../../../../../contracts/ipc'
import type { FeatureToggles, ShortcutMap, SttLanguage } from '../../../../../contracts/settings'
import type {
  OnboardingPermissionId,
  OnboardingPermissionState,
  OnboardingPlatform,
} from '../onboarding/types'

/** As 8 abas da superfície Configurações (backlog T-406 + Overlay customizado). */
export type SettingsTabId =
  | 'aiSources'
  | 'models'
  | 'audioScreen'
  | 'permissions'
  | 'features'
  | 'overlay'
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
export type ProviderConnectionStatus = 'connected' | 'saved' | 'disconnected' | 'notConfigured'

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
  /** Toggles de recursos (RF-700) — hidratados de get_app_settings. */
  features: FeatureToggles
  /** Locale de reconhecimento de fala — hidratado de get_app_settings. */
  sttLanguage: SttLanguage
  /** Overlay customizado (template HTML+CSS) — hidratado de get_app_settings. */
  overlayTemplateEnabled: boolean
  overlayTemplate: string
}
