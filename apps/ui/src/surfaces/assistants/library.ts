// Lógica pura da biblioteca de assistentes (T-407 / RF-336): busca, filtro
// por categoria e paginação. Funções puras e síncronas — o componente
// (Assistants.svelte) aplica busca + categoria + página em sequência. 'ALL'
// é o valor sem filtro de categoria. Os labels de categoria são os nomes em
// inglês do próprio RF-336 ("General, Meetings, Sales, Translation, ...");
// o restante da copy pinada é PT (FLAG de i18n RNF-502 — mecanismo
// indecidido no repo).
import type { AssistantCategory } from '../../../../../contracts/ipc'
import type { AssistantCategoryFilter, AssistantView } from './types'

/** Assistentes exibidos por página (RF-336). */
export const ASSISTANTS_PAGE_SIZE = 6

/** As 7 categorias na ordem do contrato (contracts/ipc.ts). */
export const ASSISTANT_CATEGORIES: AssistantCategory[] = [
  'GENERAL',
  'MEETINGS',
  'SALES',
  'TRANSLATION',
  'INTERVIEW',
  'STUDY',
  'CUSTOM',
]

/** Nomes de exibição das categorias, em inglês (RF-336). */
export const ASSISTANT_CATEGORY_LABELS: Record<AssistantCategory, string> = {
  GENERAL: 'General',
  MEETINGS: 'Meetings',
  SALES: 'Sales',
  TRANSLATION: 'Translation',
  INTERVIEW: 'Interview',
  STUDY: 'Study',
  CUSTOM: 'Custom',
}

/** Resultado de uma página: itens da página + total de páginas (sempre >= 1). */
export interface AssistantPage {
  items: AssistantView[]
  totalPages: number
}

/** Filtra por substring do NOME, case-insensitive; query vazia = todos. */
export function searchAssistants(
  assistants: readonly AssistantView[],
  query: string,
): AssistantView[] {
  const needle = query.trim().toLowerCase()
  if (needle === '') {
    return [...assistants]
  }
  return assistants.filter((assistant) => assistant.name.toLowerCase().includes(needle))
}

/** Filtra por categoria exata; 'ALL' devolve todos (sem filtro). */
export function filterAssistantsByCategory(
  assistants: readonly AssistantView[],
  category: AssistantCategoryFilter,
): AssistantView[] {
  if (category === 'ALL') {
    return [...assistants]
  }
  return assistants.filter((assistant) => assistant.category === category)
}

/**
 * Fatia a página 1-based. Página fora do intervalo devolve itens vazios,
 * sem clamp na função pura — os controles do componente é que guardam
 * (precedente Notch T-404).
 */
export function paginateAssistants(
  assistants: readonly AssistantView[],
  page: number,
  pageSize: number,
): AssistantPage {
  const totalPages = Math.max(1, Math.ceil(assistants.length / pageSize))
  if (page < 1 || page > totalPages) {
    return { items: [], totalPages }
  }
  const start = (page - 1) * pageSize
  return { items: assistants.slice(start, start + pageSize), totalPages }
}
