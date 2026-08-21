import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, cleanup, fireEvent } from '@testing-library/svelte'
import Assistants from './Assistants.svelte'
import { setAssistantsStateFeed, resetAssistantsStateFeed } from './assistants-feed'
import type { AssistantsStateFeed } from './assistants-feed'
import { onAssistantAction } from './assistant-actions'
import type { AssistantAction } from './assistant-actions'
import type { AssistantView, AssistantsState } from './types'

// Contrato T-407 / RF-336, RF-337 — biblioteca de assistentes: lista com
// busca, filtro por categoria, paginação e a acessibilidade de importação de
// prompts. Cada linha mostra nome, categoria e prompt (RF-336 verbatim). A
// lista e o ativo entram pelo feed (assistants-feed.ts) — nenhum comando core
// de listagem existe (core/src/lib.rs registra apenas set_stealth/
// toggle_window/suggest/transcribe_pending_pcm). A seleção (RF-337) despacha
// assistantSelect pelo canal declarado e reflete o ativo localmente (o
// "carrega o prompt no grafo" é metade core — coverageMap com coveredBy
// vazio). A UI NUNCA inventa um comando invoke() (frontend.md): o mock de
// '@tauri-apps/api/core' é uma GUARDA — nenhum fluxo desta superfície pode
// chamá-lo hoje.

const { invokeMock } = vi.hoisted(() => ({
  invokeMock: vi
    .fn<(command: string, args?: unknown) => Promise<unknown>>()
    .mockResolvedValue(undefined),
}))

vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }))

const SAMPLE: AssistantView[] = [
  { id: 'a1', name: 'Generalista', category: 'GENERAL', prompt: 'Você é um assistente geral.' },
  { id: 'a2', name: 'Reuniões executivas', category: 'MEETINGS', prompt: 'Resuma decisões e ações.' },
  { id: 'a3', name: 'Resumo de vendas', category: 'SALES', prompt: 'Sugira perguntas para qualificar.' },
  { id: 'a4', name: 'Tradução ao vivo', category: 'TRANSLATION', prompt: 'Traduza mantendo o tom.' },
  { id: 'a5', name: 'Preparação de entrevista', category: 'INTERVIEW', prompt: 'Destaque pontos fortes.' },
  { id: 'a6', name: 'Estudo dirigido', category: 'STUDY', prompt: 'Crie flashcards e resumos.' },
  { id: 'a7', name: 'Custom de vendas', category: 'CUSTOM', prompt: 'Prompt personalizado.' },
]

function makeAssistants(count: number): AssistantView[] {
  return Array.from({ length: count }, (_, index) => {
    const number = index + 1
    return {
      id: `g${number}`,
      name: `Assistente ${number}`,
      category: number % 2 === 0 ? 'MEETINGS' : 'SALES',
      prompt: `Prompt do Assistente ${number}`,
    }
  })
}

function feedState(overrides: Partial<AssistantsState> = {}): AssistantsState {
  return { assistants: SAMPLE, activeAssistantId: 'a1', ...overrides }
}

function renderLibrary(feed?: AssistantsState) {
  if (feed) {
    setAssistantsStateFeed(() => feed)
  }
  return render(Assistants)
}

function rows(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>('[data-assistant-row]'))
}

function rowById(container: HTMLElement, id: string): HTMLElement {
  const row = container.querySelector<HTMLElement>(`[data-assistant-row="${id}"]`)
  if (!row) {
    throw new Error(`linha de assistente ${id} não encontrada`)
  }
  return row
}

function searchInput(container: HTMLElement): HTMLElement {
  const input = container.querySelector<HTMLElement>('[data-assistant-search]')
  if (!input) {
    throw new Error('campo de busca não encontrado')
  }
  return input
}

function categoryFilter(container: HTMLElement): HTMLElement {
  const select = container.querySelector<HTMLElement>('[data-assistant-category-filter]')
  if (!select) {
    throw new Error('filtro de categoria não encontrado')
  }
  return select
}

function prevButton(container: HTMLElement): HTMLButtonElement {
  const button = container.querySelector('[data-assistant-prev]')
  expect(button, 'o botão Anterior deve existir').not.toBeNull()
  return button as HTMLButtonElement
}

function nextButton(container: HTMLElement): HTMLButtonElement {
  const button = container.querySelector('[data-assistant-next]')
  expect(button, 'o botão Próximo deve existir').not.toBeNull()
  return button as HTMLButtonElement
}

function pageIndicator(container: HTMLElement): string {
  const page = container.querySelector('[data-assistant-page]')
  if (!page) {
    throw new Error('indicador de página não encontrado')
  }
  return page.textContent ?? ''
}

async function typeSearch(container: HTMLElement, value: string): Promise<void> {
  await fireEvent.input(searchInput(container), { target: { value } })
}

async function selectCategory(container: HTMLElement, value: string): Promise<void> {
  await fireEvent.change(categoryFilter(container), { target: { value } })
}

afterEach(() => {
  cleanup()
  resetAssistantsStateFeed()
  invokeMock.mockClear()
})

describe('biblioteca — renderização (RF-336)', () => {
  it('monta a raiz com a lista do feed: nome, categoria e prompt por linha', () => {
    const { container } = renderLibrary(feedState())

    expect(container.querySelector('[data-assistants]')).not.toBeNull()
    expect(container.querySelector('[data-assistant-library]')).not.toBeNull()
    expect(rows(container)).toHaveLength(6)

    const first = rowById(container, 'a1')
    expect(first.querySelector('[data-assistant-name]')?.textContent).toBe('Generalista')
    expect(first.querySelector('[data-assistant-category]')?.textContent).toBe('General')
    expect(first.querySelector('[data-assistant-prompt]')?.textContent).toBe(
      'Você é um assistente geral.',
    )

    const last = rowById(container, 'a6')
    expect(last.querySelector('[data-assistant-name]')?.textContent).toBe('Estudo dirigido')
    expect(last.querySelector('[data-assistant-category]')?.textContent).toBe('Study')
    expect(last.querySelector('[data-assistant-prompt]')?.textContent).toBe(
      'Crie flashcards e resumos.',
    )
  })

  it('sem feed mostra o estado vazio restritivo (nunca inventa assistentes)', () => {
    const { container } = renderLibrary()

    const empty = container.querySelector('[data-assistant-empty]')
    expect(empty, 'estado vazio deve existir com o feed padrão restritivo').not.toBeNull()
    expect(empty!.textContent).toBe('Nenhum assistente encontrado')
  })

  it('marca exatamente o assistente ativo do feed', () => {
    const { container } = renderLibrary(feedState({ activeAssistantId: 'a3' }))

    expect(rowById(container, 'a3').getAttribute('data-assistant-active')).toBe('true')
    expect(rowById(container, 'a1').getAttribute('data-assistant-active')).toBeNull()
    const activeRows = rows(container).filter(
      (row) => row.getAttribute('data-assistant-active') === 'true',
    )
    expect(activeRows).toHaveLength(1)
  })

  it('lê o feed uma única vez na montagem', () => {
    const state = feedState()
    const feed = vi.fn<AssistantsStateFeed>(() => state)
    setAssistantsStateFeed(feed)

    render(Assistants)

    expect(feed).toHaveBeenCalledTimes(1)
  })
})

describe('biblioteca — busca (RF-336)', () => {
  it('filtrar por texto reduz as linhas ao nome que casa', async () => {
    const { container } = renderLibrary(feedState())
    await typeSearch(container, 'vendas')

    expect(rows(container).map((row) => row.getAttribute('data-assistant-row'))).toEqual([
      'a3',
      'a7',
    ])
  })

  it('a busca não diferencia maiúsculas de minúsculas', async () => {
    const { container } = renderLibrary(feedState())
    await typeSearch(container, 'VENDAS')

    expect(rows(container)).toHaveLength(2)
  })

  it('busca sem resultado mostra o estado vazio', async () => {
    const { container } = renderLibrary(feedState())
    await typeSearch(container, 'xyz')

    expect(rows(container)).toHaveLength(0)
    expect(container.querySelector('[data-assistant-empty]')?.textContent).toBe(
      'Nenhum assistente encontrado',
    )
  })

  it('limpar a busca restaura a lista completa', async () => {
    const { container } = renderLibrary(feedState())
    await typeSearch(container, 'vendas')
    expect(rows(container)).toHaveLength(2)

    await typeSearch(container, '')

    expect(rows(container)).toHaveLength(6)
  })
})

describe('biblioteca — filtro por categoria (RF-336)', () => {
  it('oferece "Todas" e as 7 categorias do contrato, na ordem, com os nomes do RF-336', () => {
    const { container } = renderLibrary(feedState())
    const options = Array.from(categoryFilter(container).querySelectorAll('option'))

    expect(options.map((option) => option.value)).toEqual([
      'ALL',
      'GENERAL',
      'MEETINGS',
      'SALES',
      'TRANSLATION',
      'INTERVIEW',
      'STUDY',
      'CUSTOM',
    ])
    expect(options[0].textContent).toBe('Todas')
    expect(options.find((option) => option.value === 'MEETINGS')?.textContent).toBe('Meetings')
    expect(options.find((option) => option.value === 'CUSTOM')?.textContent).toBe('Custom')
  })

  it('selecionar uma categoria filtra as linhas', async () => {
    const { container } = renderLibrary(feedState())
    await selectCategory(container, 'SALES')

    expect(rows(container).map((row) => row.getAttribute('data-assistant-row'))).toEqual(['a3'])
  })

  it('voltar para "Todas" restaura a lista', async () => {
    const { container } = renderLibrary(feedState())
    await selectCategory(container, 'SALES')
    expect(rows(container)).toHaveLength(1)

    await selectCategory(container, 'ALL')

    expect(rows(container)).toHaveLength(6)
  })

  it('busca e categoria combinam (interseção)', async () => {
    const { container } = renderLibrary(feedState())
    await selectCategory(container, 'CUSTOM')
    await typeSearch(container, 'vendas')

    expect(rows(container).map((row) => row.getAttribute('data-assistant-row'))).toEqual(['a7'])
  })
})

describe('biblioteca — paginação (RF-336)', () => {
  it('mostra a primeira página com 6 linhas e o indicador de página', () => {
    const { container, getByRole } = renderLibrary(feedState({ assistants: makeAssistants(13) }))

    expect(rows(container)).toHaveLength(6)
    expect(pageIndicator(container)).toBe('1 de 3')
    expect(prevButton(container).disabled).toBe(true)
    expect(nextButton(container).disabled).toBe(false)
    expect(getByRole('button', { name: 'Anterior' })).not.toBeNull()
    expect(getByRole('button', { name: 'Próximo' })).not.toBeNull()
  })

  it('"Próximo" avança e "Anterior" volta pelas páginas', async () => {
    const { container } = renderLibrary(feedState({ assistants: makeAssistants(13) }))

    await fireEvent.click(nextButton(container))
    expect(pageIndicator(container)).toBe('2 de 3')
    expect(rows(container)).toHaveLength(6)
    expect(rows(container)[0].getAttribute('data-assistant-row')).toBe('g7')
    expect(prevButton(container).disabled).toBe(false)

    await fireEvent.click(nextButton(container))
    expect(pageIndicator(container)).toBe('3 de 3')
    expect(rows(container)).toHaveLength(1)
    expect(rows(container)[0].getAttribute('data-assistant-row')).toBe('g13')
    expect(nextButton(container).disabled).toBe(true)

    await fireEvent.click(prevButton(container))
    expect(pageIndicator(container)).toBe('2 de 3')
  })

  it('clique além dos limites não muda a página (guard além do atributo disabled)', async () => {
    const { container } = renderLibrary(feedState({ assistants: makeAssistants(13) }))

    await fireEvent.click(prevButton(container))
    expect(pageIndicator(container)).toBe('1 de 3')
    expect(rows(container)).toHaveLength(6)

    await fireEvent.click(nextButton(container))
    await fireEvent.click(nextButton(container))
    expect(pageIndicator(container)).toBe('3 de 3')

    await fireEvent.click(nextButton(container))
    expect(pageIndicator(container)).toBe('3 de 3')
    expect(rows(container)).toHaveLength(1)
  })

  it('lista com uma única página desabilita os dois controles', async () => {
    const { container } = renderLibrary(feedState({ assistants: makeAssistants(4) }))

    expect(pageIndicator(container)).toBe('1 de 1')
    expect(prevButton(container).disabled).toBe(true)
    expect(nextButton(container).disabled).toBe(true)

    await fireEvent.click(nextButton(container))
    expect(pageIndicator(container)).toBe('1 de 1')
  })

  it('buscar reseta para a primeira página do resultado filtrado', async () => {
    const { container } = renderLibrary(feedState({ assistants: makeAssistants(13) }))
    await fireEvent.click(nextButton(container))
    expect(pageIndicator(container)).toBe('2 de 3')

    await typeSearch(container, 'assistente 1')

    expect(pageIndicator(container)).toBe('1 de 1')
    expect(rows(container).map((row) => row.getAttribute('data-assistant-row'))).toEqual([
      'g1',
      'g10',
      'g11',
      'g12',
      'g13',
    ])
  })

  it('filtrar por categoria reseta para a primeira página', async () => {
    const { container } = renderLibrary(feedState({ assistants: makeAssistants(13) }))
    await fireEvent.click(nextButton(container))
    expect(pageIndicator(container)).toBe('2 de 3')

    await selectCategory(container, 'MEETINGS')

    expect(pageIndicator(container)).toBe('1 de 1')
    expect(rows(container).map((row) => row.getAttribute('data-assistant-row'))).toEqual([
      'g2',
      'g4',
      'g6',
      'g8',
      'g10',
      'g12',
    ])
  })
})

describe('biblioteca — seleção de assistente (RF-337)', () => {
  it('clicar numa linha despacha assistantSelect e marca o ativo otimisticamente', async () => {
    const received: AssistantAction[] = []
    const unsubscribe = onAssistantAction((action: AssistantAction) => received.push(action))
    const { container } = renderLibrary(feedState({ activeAssistantId: 'a1' }))
    expect(rowById(container, 'a1').getAttribute('data-assistant-active')).toBe('true')

    await fireEvent.click(rowById(container, 'a2'))

    expect(received).toEqual([{ type: 'assistantSelect', assistantId: 'a2' }])
    expect(rowById(container, 'a2').getAttribute('data-assistant-active')).toBe('true')
    expect(rowById(container, 'a1').getAttribute('data-assistant-active')).toBeNull()
    unsubscribe()
  })
})

describe('biblioteca — importação e criador (RF-336, RF-338)', () => {
  it('exibe o botão de importação de prompts e despacha o pedido de import', async () => {
    const received: AssistantAction[] = []
    const unsubscribe = onAssistantAction((action: AssistantAction) => received.push(action))
    const { getByRole } = renderLibrary(feedState())

    await fireEvent.click(getByRole('button', { name: /importar prompt/i }))

    expect(received).toEqual([{ type: 'promptImportRequest' }])
    unsubscribe()
  })

  it("'Novo assistente' abre o criador (a biblioteca sai de cena)", async () => {
    const { container, getByRole } = renderLibrary(feedState())
    expect(container.querySelector('[data-assistant-creator]')).toBeNull()

    await fireEvent.click(getByRole('button', { name: /novo assistente/i }))

    expect(container.querySelector('[data-assistant-creator]')).not.toBeNull()
    expect(container.querySelector('[data-assistant-library]')).toBeNull()
  })

  it('nenhum fluxo da biblioteca chama invoke() (não existem comandos core)', async () => {
    const { container, getByRole } = renderLibrary(feedState({ assistants: makeAssistants(13) }))

    await typeSearch(container, 'assistente')
    await selectCategory(container, 'SALES')
    await fireEvent.click(nextButton(container))
    await fireEvent.click(rowById(container, 'g13'))
    await fireEvent.click(getByRole('button', { name: /importar prompt/i }))
    await fireEvent.click(getByRole('button', { name: /novo assistente/i }))

    expect(invokeMock).not.toHaveBeenCalled()
  })
})
