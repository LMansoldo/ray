import { describe, it, expect } from 'vitest'
import {
  ASSISTANT_CATEGORIES,
  ASSISTANT_CATEGORY_LABELS,
  ASSISTANTS_PAGE_SIZE,
  filterAssistantsByCategory,
  paginateAssistants,
  searchAssistants,
} from './library'
import type { AssistantCategoryFilter, AssistantView } from './types'
import type { AssistantCategory } from '../../../../../contracts/ipc'

// Contrato T-407 / RF-336: lógica pura da biblioteca de assistentes — busca,
// filtro por categoria (AssistantCategory de contracts/ipc.ts, 7 valores na
// ordem do contrato) e paginação. Funções puras e síncronas: a lista filtrada/
// fatiada é derivável sem efeito colateral; o componente (Assistants.svelte)
// aplica busca + categoria + página em sequência. A "ALL" é o valor sem
// filtro de categoria. Os labels de categoria são os nomes em inglês que o
// próprio RF-336 usa ("General, Meetings, Sales, Translation, …"); o restante
// da copy pinada é PT (FLAG de i18n RNF-502 — mecanismo indecidido no repo).

const SAMPLE: AssistantView[] = [
  { id: 'a1', name: 'Generalista', category: 'GENERAL', prompt: 'Você é um assistente geral.', source: 'USER' },
  { id: 'a2', name: 'Reuniões executivas', category: 'MEETINGS', prompt: 'Resuma decisões e ações.', source: 'USER' },
  { id: 'a3', name: 'Resumo de vendas', category: 'SALES', prompt: 'Sugira perguntas para qualificar.', source: 'USER' },
  { id: 'a4', name: 'Tradução ao vivo', category: 'TRANSLATION', prompt: 'Traduza mantendo o tom.', source: 'USER' },
  { id: 'a5', name: 'Preparação de entrevista', category: 'INTERVIEW', prompt: 'Destaque pontos fortes.', source: 'USER' },
  { id: 'a6', name: 'Estudo dirigido', category: 'STUDY', prompt: 'Crie flashcards e resumos.', source: 'USER' },
  { id: 'a7', name: 'Custom de vendas', category: 'CUSTOM', prompt: 'Prompt personalizado.', source: 'USER' },
]

function makeAssistants(count: number): AssistantView[] {
  return Array.from({ length: count }, (_, index) => {
    const number = index + 1
    return {
      id: `g${number}`,
      name: `Assistente ${number}`,
      category: number % 2 === 0 ? 'MEETINGS' : 'SALES',
      prompt: `Prompt do Assistente ${number}`,
      source: 'USER',
    }
  })
}

describe('library — constantes do contrato (RF-336)', () => {
  it('a paginação usa 6 assistentes por página', () => {
    expect(ASSISTANTS_PAGE_SIZE).toBe(6)
  })

  it('expõe as 7 categorias na ordem do contrato (contracts/ipc.ts)', () => {
    expect(ASSISTANT_CATEGORIES).toEqual([
      'GENERAL',
      'MEETINGS',
      'SALES',
      'TRANSLATION',
      'INTERVIEW',
      'STUDY',
      'CUSTOM',
    ] satisfies AssistantCategory[])
  })

  it('rotula todas as categorias com os nomes do RF-336 (inglês)', () => {
    expect(ASSISTANT_CATEGORY_LABELS).toEqual({
      GENERAL: 'General',
      MEETINGS: 'Meetings',
      SALES: 'Sales',
      TRANSLATION: 'Translation',
      INTERVIEW: 'Interview',
      STUDY: 'Study',
      CUSTOM: 'Custom',
    } satisfies Record<AssistantCategory, string>)
  })
})

describe('library — busca (searchAssistants)', () => {
  it('query vazia devolve todos na mesma ordem', () => {
    expect(searchAssistants(SAMPLE, '')).toEqual(SAMPLE)
  })

  it('query só de espaços devolve todos', () => {
    expect(searchAssistants(SAMPLE, '   ')).toEqual(SAMPLE)
  })

  it('busca por substring do nome, sem diferenciar maiúsculas', () => {
    expect(searchAssistants(SAMPLE, 'vendas').map((assistant: AssistantView) => assistant.id)).toEqual(['a3', 'a7'])
    expect(searchAssistants(SAMPLE, 'VENDAS').map((assistant: AssistantView) => assistant.id)).toEqual(['a3', 'a7'])
  })

  it('busca que casa um único assistente devolve só ele', () => {
    expect(searchAssistants(SAMPLE, 'Reuniões').map((assistant: AssistantView) => assistant.id)).toEqual(['a2'])
  })

  it('sem resultado devolve lista vazia', () => {
    expect(searchAssistants(SAMPLE, 'xyz')).toEqual([])
  })
})

describe('library — filtro por categoria (filterAssistantsByCategory)', () => {
  it("'ALL' devolve todos (sem filtro)", () => {
    expect(filterAssistantsByCategory(SAMPLE, 'ALL' satisfies AssistantCategoryFilter)).toEqual(
      SAMPLE,
    )
  })

  it('filtra por categoria exata', () => {
    expect(filterAssistantsByCategory(SAMPLE, 'SALES').map((assistant: AssistantView) => assistant.id)).toEqual(['a3'])
    expect(filterAssistantsByCategory(SAMPLE, 'CUSTOM').map((assistant: AssistantView) => assistant.id)).toEqual(['a7'])
    expect(filterAssistantsByCategory(SAMPLE, 'MEETINGS').map((assistant: AssistantView) => assistant.id)).toEqual(['a2'])
  })

  it('categoria sem representante devolve lista vazia', () => {
    expect(
      filterAssistantsByCategory(
        makeAssistants(2),
        'TRANSLATION' satisfies AssistantCategoryFilter,
      ),
    ).toEqual([])
  })
})

describe('library — paginação (paginateAssistants)', () => {
  it('fatiamento correto com página 1-based e tamanho de página do contrato', () => {
    const thirteen = makeAssistants(13)

    const first = paginateAssistants(thirteen, 1, ASSISTANTS_PAGE_SIZE)
    expect(first.totalPages).toBe(3)
    expect(first.items.map((assistant: AssistantView) => assistant.id)).toEqual(['g1', 'g2', 'g3', 'g4', 'g5', 'g6'])

    const second = paginateAssistants(thirteen, 2, ASSISTANTS_PAGE_SIZE)
    expect(second.items.map((assistant: AssistantView) => assistant.id)).toEqual(['g7', 'g8', 'g9', 'g10', 'g11', 'g12'])

    const third = paginateAssistants(thirteen, 3, ASSISTANTS_PAGE_SIZE)
    expect(third.items.map((assistant: AssistantView) => assistant.id)).toEqual(['g13'])
  })

  it('lista vazia tem exatamente 1 página (nunca 0)', () => {
    expect(paginateAssistants([], 1, ASSISTANTS_PAGE_SIZE)).toEqual({
      items: [],
      totalPages: 1,
    })
  })

  it('divisão exata não cria página fantasma', () => {
    const twelve = makeAssistants(12)
    expect(paginateAssistants(twelve, 1, ASSISTANTS_PAGE_SIZE).totalPages).toBe(2)
    expect(paginateAssistants(twelve, 2, ASSISTANTS_PAGE_SIZE).items).toHaveLength(6)
  })

  it('página fora do intervalo devolve itens vazios (sem clamp na função pura)', () => {
    const thirteen = makeAssistants(13)
    expect(paginateAssistants(thirteen, 0, ASSISTANTS_PAGE_SIZE).items).toEqual([])
    expect(paginateAssistants(thirteen, 4, ASSISTANTS_PAGE_SIZE).items).toEqual([])
  })
})
