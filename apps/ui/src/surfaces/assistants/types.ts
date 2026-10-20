// Tipos locais da superfície Assistentes (T-407). AssistantView é o view
// model de UI que o RF-336 nomeia ("cada assistente tem nome, categoria e
// prompt") — NÃO é o shape de comando core (nenhum comando de listagem
// existe em core/src/lib.rs; precedente T-402). A categoria vem do contrato
// contracts/ipc.ts, fonte da verdade do domínio (ADR-010).
import type { AssistantCategory } from '../../../../../contracts/ipc'

/** Assistente como exibido na biblioteca (RF-336: nome, categoria e prompt). */
export interface AssistantView {
  id: string
  name: string
  category: AssistantCategory
  prompt: string
  /** Origem: BUILTIN (seed, não deletável) ou USER (criado, deletável). */
  source: 'USER' | 'BUILTIN'
}

/** Estado da biblioteca entregue pelo feed (assistants-feed.ts). */
export interface AssistantsState {
  assistants: AssistantView[]
  activeAssistantId: string | null
}

/** Filtro de categoria: uma categoria do contrato ou "todas" ('ALL'). */
export type AssistantCategoryFilter = AssistantCategory | 'ALL'
