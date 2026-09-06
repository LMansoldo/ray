import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, cleanup, fireEvent } from '@testing-library/svelte'
import Home from './Home.svelte'
import { onHomeNavigate, type HomeDestination } from './navigation'
import type { HomeProps } from './types'

// Contrato T-402 / RF-011: tela principal com busca de sessões, acesso a
// configurações, card do assistente atual, card de memória em tempo real,
// ações de conversa e sessões recentes. O uso completo é o default — não
// existe conceito de plano/free tier/trial na superfície.
// RF-802: busca de sessões passadas + lista de recentes. RF-339: card de
// memória.
//
// As sessões chegam por props no seam do invoke(): o comando de listagem de
// sessões ainda NÃO existe no core (core/src/lib.rs registra apenas
// set_stealth/toggle_window/suggest/transcribe_pending_pcm) — a lista é
// fornecida localmente nos testes, e o DoD "a home lista sessões reais"
// permanece descoberto no coverageMap. Nenhum comando novo é inventado aqui.

const { invokeMock } = vi.hoisted(() => ({
  invokeMock: vi
    .fn<(command: string, args?: unknown) => Promise<unknown>>()
    .mockResolvedValue(undefined),
}))

vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }))

// Props tipadas contra a fonte única de tipos da superfície (types.ts), não
// via ComponentProps<Home>: sob o svelte-check, a importação de um .svelte
// por um .ts resolve para o shape legado { $on?; $set? } e ComponentProps
// degrada para never (ver decisions.md).
type Props = HomeProps

// Sessões no formato de exibição da superfície (view model de UI, não o
// shape do comando core — esse ainda não foi declarado).
const baseProps: Props = {
  sessions: [
    { id: 'sess-1', title: 'Reunião de planejamento' },
    { id: 'sess-2', title: '1:1 com Ana' },
    { id: 'sess-3', title: 'Daily standup' },
  ],
  assistant: { name: 'Copiloto de Reuniões', category: 'MEETINGS' },
  memoryItems: [{ id: 'm1', text: 'Você perguntou sobre o roadmap ontem' }],
  sessionId: 'sess-1',
  assistantId: 'asst-1',
  context: [{ speaker: 'SELF', text: 'olá', startMs: 0 }],
  credential: { kind: 'OPENAI', connectionMode: 'API_KEY', secret: 'ref:key-1' },
}

let unsubscribeNavigation: (() => void) | undefined

afterEach(() => {
  unsubscribeNavigation?.()
  unsubscribeNavigation = undefined
  invokeMock.mockClear()
  cleanup()
})

function subscribeNavigation(): HomeDestination[] {
  const destinations: HomeDestination[] = []
  unsubscribeNavigation = onHomeNavigate((destination) => destinations.push(destination))
  return destinations
}

describe('Home — elementos da tela principal (RF-011)', () => {
  it('renderiza a busca de sessões', () => {
    const { getByPlaceholderText, container } = render(Home, { props: baseProps })
    expect(getByPlaceholderText('Buscar sessões')).toBeDefined()
    expect(container.querySelector('[data-home-search]')).not.toBeNull()
  })

  it('renderiza o card do assistente atual (RF-011)', () => {
    const { container, getByText } = render(Home, { props: baseProps })
    expect(container.querySelector('[data-assistant-card]')).not.toBeNull()
    expect(getByText('Copiloto de Reuniões')).toBeDefined()
    expect(getByText('MEETINGS')).toBeDefined()
  })

  it('renderiza o card de memória com os itens atuais (RF-339)', () => {
    const { container, getByText } = render(Home, { props: baseProps })
    expect(container.querySelector('[data-memory-card]')).not.toBeNull()
    expect(getByText('Você perguntou sobre o roadmap ontem')).toBeDefined()
  })

  it('o card de memória acompanha itens novos (RF-339, tempo real)', async () => {
    const { rerender, getByText } = render(Home, { props: baseProps })
    await rerender({
      ...baseProps,
      memoryItems: [...baseProps.memoryItems, { id: 'm2', text: 'Reunião das 15h adiada' }],
    })
    expect(getByText('Reunião das 15h adiada')).toBeDefined()
  })

  it('o card de memória vazio mostra um estado próprio', () => {
    const { getByText } = render(Home, { props: { ...baseProps, memoryItems: [] } })
    expect(getByText('Nenhuma memória recente')).toBeDefined()
  })

  it('compõe as três ações de conversa (RF-333)', () => {
    const { getByRole } = render(Home, { props: baseProps })
    expect(getByRole('button', { name: 'Analisar Conversa' })).toBeDefined()
    expect(getByRole('button', { name: 'Capturar Tela' })).toBeDefined()
    expect(getByRole('button', { name: 'Perguntar Algo' })).toBeDefined()
  })

  it('repassa os dados da sessão às ações: "Analisar Conversa" dispara suggest', async () => {
    const { getByRole } = render(Home, { props: baseProps })
    await fireEvent.click(getByRole('button', { name: 'Analisar Conversa' }))

    expect(invokeMock).toHaveBeenCalledTimes(1)
    const call = invokeMock.mock.calls[0]
    expect(call?.[0]).toBe('suggest')
    expect(call?.[1]).toEqual({
      req: expect.objectContaining({
        sessionId: 'sess-1',
        assistantId: 'asst-1',
        trigger: 'ANALYZE_CONVERSATION',
      }),
    })
  })
})

describe('Home — sessões recentes e busca (RF-011 / RF-802)', () => {
  it('lista as sessões recentes', () => {
    const { container, getByText } = render(Home, { props: baseProps })
    const section = container.querySelector('[data-recent-sessions]')
    expect(section, 'a seção de sessões recentes deve existir').not.toBeNull()
    expect(getByText('Sessões recentes')).toBeDefined()
    expect(section?.textContent).toContain('Reunião de planejamento')
    expect(section?.textContent).toContain('1:1 com Ana')
    expect(section?.textContent).toContain('Daily standup')
  })

  it('abre o detalhe da sessão ao clicar na linha (RF-802)', async () => {
    invokeMock.mockImplementation((command: string) => {
      if (command === 'get_session') {
        return Promise.resolve({
          id: 'sess-1',
          assistantName: 'Copiloto de Reuniões',
          startedAt: '2026-09-01T12:00:00.000Z',
          transcript: [
            { speaker: 'SELF', text: 'bom dia', startMs: 0 },
            { speaker: 'OTHERS', text: 'hello there', startMs: 1500 },
          ],
        })
      }
      return Promise.resolve(undefined)
    })
    const { container, getByText } = render(Home, { props: baseProps })
    const row = container.querySelector('[data-recent-session="sess-2"]')
    expect(row, 'linha clicável da sessão').not.toBeNull()
    await fireEvent.click(row as HTMLElement)

    expect(invokeMock).toHaveBeenCalledWith('get_session', { sessionId: 'sess-2' })
    expect(container.querySelector('[data-session-detail]')).not.toBeNull()
    expect(getByText('bom dia')).toBeDefined()
    expect(getByText('hello there')).toBeDefined()

    // Voltar fecha o detalhe e devolve a lista.
    await fireEvent.click(container.querySelector('[data-session-detail-back]') as HTMLElement)
    expect(container.querySelector('[data-session-detail]')).toBeNull()
    expect(container.querySelector('[data-recent-sessions]')).not.toBeNull()
  })

  it('a busca filtra a lista de sessões, sem diferenciar maiúsculas', async () => {
    const { getByPlaceholderText, getByText, queryByText } = render(Home, {
      props: baseProps,
    })
    await fireEvent.input(getByPlaceholderText('Buscar sessões'), {
      target: { value: 'ANA' },
    })

    expect(getByText('1:1 com Ana')).toBeDefined()
    expect(queryByText('Reunião de planejamento')).toBeNull()
    expect(queryByText('Daily standup')).toBeNull()
  })

  it('mostra estado vazio quando a busca não encontra nada', async () => {
    const { getByPlaceholderText, getByText, queryByText } = render(Home, {
      props: baseProps,
    })
    await fireEvent.input(getByPlaceholderText('Buscar sessões'), {
      target: { value: 'xyz' },
    })

    expect(getByText('Nenhuma sessão encontrada')).toBeDefined()
    expect(queryByText('Reunião de planejamento')).toBeNull()
    expect(queryByText('1:1 com Ana')).toBeNull()
    expect(queryByText('Daily standup')).toBeNull()
  })
})

describe('Home — navegação entre superfícies (RF-011)', () => {
  it('dispara navegação para configurações', async () => {
    const destinations = subscribeNavigation()
    const { getByRole } = render(Home, { props: baseProps })
    await fireEvent.click(getByRole('button', { name: 'Configurações' }))
    expect(destinations).toEqual(['settings'])
  })

  it('dispara navegação para a biblioteca de assistentes', async () => {
    const destinations = subscribeNavigation()
    const { getByRole } = render(Home, { props: baseProps })
    await fireEvent.click(getByRole('button', { name: 'Assistentes' }))
    expect(destinations).toEqual(['assistants'])
  })
})
