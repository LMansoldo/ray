import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, cleanup, fireEvent, act, waitFor } from '@testing-library/svelte'
import Notch from './Notch.svelte'
import type { SuggestStreamEvent } from '../../../../../contracts/ipc'

// Contrato T-404 / RF-013 + RF-334 + RF-704 + RF-701: o Notch é a superfície
// COMPACTA de insights em tempo real durante sessões ativas (RF-704), com o
// histórico navegável para insight anterior e próximo (RF-334). Ele consome a
// MESMA família de eventos Tauri do T-403 ('suggest-stream', ponte T-303:
// o core reemite cada SuggestStreamEvent via app.emit) e exibe o insight ao
// vivo com o renderizador read-only do T-408 (ADR-011: nunca o editor).
//
// O seam dos eventos: '@tauri-apps/api/event' é mockado com vi.hoisted +
// vi.mock(factory) — o factory intercepta antes da resolução (padrão
// T-402/T-403/T-406) e captura o handler registrado via listen(). O teste é
// a fonte de eventos Tauri: entrega { event, id, payload } com o payload do
// union SuggestStreamEvent (contracts/ipc.ts:130) 1:1.
//
// Material por plataforma (RF-013): a decisão é do T-400 (lib/glass/platform
// — resolveGlassMode/detectGlassSupport). O mock troca APENAS a detecção de
// suporte; o resolveGlassMode REAL decide o modo, de forma que o teste pina o
// CONSUMO da camada T-400 (macOS → native/vibrancy; Windows → backdrop, o
// equivalente Mica/Acrylic; Linux → backdrop com compositor, degradando para
// solid/semi-opaco sem ele), nunca uma cópia da lógica. A janela Tauri
// secundária em si (transparente, sempre-no-topo, excluída de captura) é
// config do CORE — tauri.conf.json define apenas 'main' — e fica no
// coverageMap com coveredBy vazio; idem os atalhos globais de navegação
// (RF-334 "via atalhos": core/shortcuts.rs não entrega eventos à UI).
//
// Navegação (RF-334): posições = histórico (0..length-1) + ao vivo (length).
// 'Anterior' volta 1, 'Próximo' avança 1 — ambos com CLAMP nas pontas (sem
// crash em nenhuma extremidade): no mais antigo 'Anterior' desabilita e não
// sai do lugar; no ao vivo 'Próximo' desabilita e não sai do lugar. Um novo
// `start` devolve a exibição ao ao vivo (RF-704: sugestões em tempo real são
// a experiência primária). Um insight com `error` NÃO entra no histórico.

interface StreamListenerEvent {
  event: string
  id: number
  payload: unknown
}

const { listenMock, emitSuggestEvent, resetStreamListeners, detectGlassSupportMock } = vi.hoisted(
  () => {
    const listenMock = vi.fn<
      (eventName: string, handler: (event: StreamListenerEvent) => void) => Promise<() => void>
    >()
    const handlers = new Map<string, Array<(event: StreamListenerEvent) => void>>()
    listenMock.mockImplementation((eventName, handler) => {
      const list = handlers.get(eventName) ?? []
      list.push(handler)
      handlers.set(eventName, list)
      const unlisten = vi.fn(() => {
        const index = list.indexOf(handler)
        if (index >= 0) list.splice(index, 1)
      })
      return Promise.resolve(unlisten)
    })
    function emitSuggestEvent(event: SuggestStreamEvent): void {
      const list = handlers.get('suggest-stream') ?? []
      list.forEach((handler) => handler({ event: 'suggest-stream', id: 1, payload: event }))
    }
    function resetStreamListeners(): void {
      handlers.clear()
    }
    // jsdom não tem vibrancy nativa (navigator.platform === '') nem
    // backdrop-filter: o padrão resolve para o fallback 'solid' (SRS 8.3).
    const detectGlassSupportMock = vi.fn(() => ({
      nativeVibrancyAvailable: false,
      backdropFilterSupported: false,
    }))
    return { listenMock, emitSuggestEvent, resetStreamListeners, detectGlassSupportMock }
  },
)

vi.mock('@tauri-apps/api/event', () => ({ listen: listenMock }))

vi.mock('../../lib/glass/platform', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/glass/platform')>()
  return { ...actual, detectGlassSupport: detectGlassSupportMock }
})

// Entrega um evento como a ponte T-303 faria e aguarda o flush dos efeitos
// Svelte (act) — o estado do stream muta dentro do handler de listen().
async function emit(event: SuggestStreamEvent): Promise<void> {
  await act(() => emitSuggestEvent(event))
}

// Conclui um insight (start → token → done), como no fluxo real do stream.
async function completeInsight(id: string, text: string): Promise<void> {
  await emit({ type: 'start', suggestionId: id })
  await emit({ type: 'token', text })
  await emit({ type: 'done', providerKind: 'DEEPSEEK' })
}

// Regra do repo: sem emojis na UI.
const EMOJI_PATTERN = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/u

function notchRoot(container: HTMLElement): HTMLElement {
  const root = container.querySelector('[data-notch]')
  expect(root, 'a raiz do Notch deve existir').not.toBeNull()
  return root as HTMLElement
}

function insight(container: HTMLElement): Element | null {
  return container.querySelector('[data-notch-insight]')
}

function markdownText(container: HTMLElement): string | undefined {
  return container.querySelector('[data-notch-insight] [data-markdown-view]')?.textContent ?? undefined
}

function notchBody(container: HTMLElement): HTMLElement {
  const body = container.querySelector('[data-notch-body]')
  expect(body, 'o corpo rolável do Notch deve existir').not.toBeNull()
  return body as HTMLElement
}

function prevButton(container: HTMLElement): HTMLButtonElement {
  const button = container.querySelector('[data-notch-prev]')
  expect(button, 'o botão Anterior deve existir').not.toBeNull()
  return button as HTMLButtonElement
}

function nextButton(container: HTMLElement): HTMLButtonElement {
  const button = container.querySelector('[data-notch-next]')
  expect(button, 'o botão Próximo deve existir').not.toBeNull()
  return button as HTMLButtonElement
}

beforeEach(() => {
  detectGlassSupportMock.mockReturnValue({
    nativeVibrancyAvailable: false,
    backdropFilterSupported: false,
  })
})

afterEach(() => {
  resetStreamListeners()
  listenMock.mockClear()
  detectGlassSupportMock.mockClear()
  cleanup()
})

describe('Notch — superfície e assinatura do stream (RF-013, RF-704, T-303)', () => {
  it('renderiza a raiz compacta, resolve o material pelo T-400 e assina o stream uma única vez', () => {
    const { container } = render(Notch)

    const root = notchRoot(container)
    expect(root.getAttribute('data-notch-material'), 'jsdom: sem vibrancy nem backdrop → solid').toBe(
      'solid',
    )
    expect(detectGlassSupportMock, 'o material vem da detecção do T-400, não de valor fixo').toHaveBeenCalled()

    expect(listenMock, 'deve assinar os eventos de streaming').toHaveBeenCalledTimes(1)
    expect(listenMock.mock.calls[0]?.[0], 'nome do evento Tauri pinado').toBe('suggest-stream')
  })

  it('sem eventos: nenhum insight, navegação desabilitada e cliques não quebram', async () => {
    const { container, getByRole } = render(Notch)

    expect(getByRole('button', { name: 'Anterior' }), 'RF-334: navegação anterior').toBeDefined()
    expect(getByRole('button', { name: 'Próximo' }), 'RF-334: navegação próxima').toBeDefined()
    expect(insight(container)).toBeNull()
    expect(prevButton(container).disabled).toBe(true)
    expect(nextButton(container).disabled).toBe(true)

    await fireEvent.click(prevButton(container))
    await fireEvent.click(nextButton(container))
    expect(insight(container), 'cliques sem histórico não quebram nem criam insight').toBeNull()
  })
})

describe('Notch — insight ao vivo em tempo real (RF-704, T-303, T-408)', () => {
  it('o start exibe o insight ao vivo e o texto é renderizado pelo renderizador T-408', async () => {
    const { container } = render(Notch)

    await emit({ type: 'start', suggestionId: 's-1', contextLabel: 'Reunião de vendas' })
    await emit({ type: 'token', text: 'Olá **mundo**' })

    await waitFor(() => {
      expect(insight(container)).not.toBeNull()
    })
    expect(insight(container)?.getAttribute('data-notch-status')).toBe('streaming')
    const body = notchBody(container)
    expect(body.querySelector('[data-markdown-view]'), 'o Notch usa o renderizador T-408').not.toBeNull()
    expect(body.querySelector('strong')?.textContent, 'o markdown é processado, não cru').toBe('mundo')
    // O '\n' final é a quebra de bloco que o renderizador T-408 (marked)
    // emite após cada parágrafo (pin com prova em decisions.md, T-403).
    expect(body.querySelector('[data-markdown-view]')?.textContent).toBe('Olá mundo\n')
  })

  it('acumula os tokens em ordem exata, sem re-assinar o stream', async () => {
    const { container } = render(Notch)

    await emit({ type: 'start', suggestionId: 's-1' })
    await emit({ type: 'token', text: 'Olá' })
    await emit({ type: 'token', text: ' **mundo**' })
    await emit({ type: 'token', text: '!' })

    expect(markdownText(container)).toBe('Olá mundo!\n')
    expect(listenMock, 'uma assinatura por montagem, nunca por evento').toHaveBeenCalledTimes(1)
  })

  it('o done encerra o insight; tokens após o done são ignorados', async () => {
    const { container } = render(Notch)

    await emit({ type: 'start', suggestionId: 's-1' })
    await emit({ type: 'token', text: 'Olá' })
    await emit({ type: 'done', providerKind: 'DEEPSEEK', model: 'deepseek-chat' })

    expect(insight(container)?.getAttribute('data-notch-status')).toBe('done')

    await emit({ type: 'token', text: ' **ignorado**' })
    expect(markdownText(container)).toBe('Olá\n')
  })

  it('erro no meio do stream: exibido no Notch, texto preservado, terminal', async () => {
    const { container } = render(Notch)

    await emit({ type: 'start', suggestionId: 's-1', contextLabel: 'Reunião' })
    await emit({ type: 'token', text: 'Olá' })
    await emit({ type: 'error', error: { code: 'AGENT_ERROR', message: 'provedor falhou' } })

    const error = container.querySelector('[data-notch-error]')
    expect(error, 'o erro deve aparecer no Notch').not.toBeNull()
    expect(error?.textContent).toContain('provedor falhou')
    expect(insight(container)?.getAttribute('data-notch-status')).toBe('error')
    expect(markdownText(container)).toBe('Olá\n')

    await emit({ type: 'token', text: ' **depois do erro**' })
    expect(markdownText(container)).toBe('Olá\n')
  })

  it('um novo start substitui o insight anterior', async () => {
    const { container } = render(Notch)

    await emit({ type: 'start', suggestionId: 's-1' })
    await emit({ type: 'token', text: 'Olá' })
    await emit({ type: 'start', suggestionId: 's-2' })
    await emit({ type: 'token', text: 'Novo' })

    expect(markdownText(container)).toBe('Novo\n')
  })
})

describe('Notch — histórico navegável (RF-334)', () => {
  it('cada done entra no histórico; Anterior volta um insight e Próximo volta ao vivo', async () => {
    const { container, getByRole } = render(Notch)

    await completeInsight('s-1', 'Primeiro **insight**')
    await completeInsight('s-2', 'Segundo insight')
    await emit({ type: 'start', suggestionId: 's-3' })
    await emit({ type: 'token', text: 'Terceiro insight' })

    // Ao vivo: o insight corrente em streaming, Próximo desabilitado.
    expect(markdownText(container)).toBe('Terceiro insight\n')
    expect(insight(container)?.getAttribute('data-notch-status')).toBe('streaming')
    expect(nextButton(container).disabled).toBe(true)

    // Anterior → insight concluído mais recente (status done, histórico).
    await fireEvent.click(getByRole('button', { name: 'Anterior' }))
    expect(markdownText(container)).toBe('Segundo insight\n')
    expect(insight(container)?.getAttribute('data-notch-status')).toBe('done')
    expect(prevButton(container).disabled).toBe(false)
    expect(nextButton(container).disabled).toBe(false)

    // Anterior → insight mais antigo, renderizado pelo T-408 (markdown).
    await fireEvent.click(getByRole('button', { name: 'Anterior' }))
    expect(markdownText(container)).toBe('Primeiro insight\n')
    expect(
      container.querySelector('[data-notch-insight] [data-markdown-view] strong')?.textContent,
      'o histórico também usa o renderizador read-only do T-408',
    ).toBe('insight')

    // Limite inferior: no mais antigo, Anterior desabilita e não sai do lugar.
    expect(prevButton(container).disabled).toBe(true)
    await fireEvent.click(prevButton(container))
    expect(markdownText(container)).toBe('Primeiro insight\n')

    // Próximo → de volta pelo histórico até o ao vivo.
    await fireEvent.click(getByRole('button', { name: 'Próximo' }))
    expect(markdownText(container)).toBe('Segundo insight\n')
    await fireEvent.click(getByRole('button', { name: 'Próximo' }))
    expect(markdownText(container)).toBe('Terceiro insight\n')
    expect(insight(container)?.getAttribute('data-notch-status')).toBe('streaming')

    // Limite superior: no ao vivo, Próximo desabilita e não sai do lugar.
    expect(nextButton(container).disabled).toBe(true)
    await fireEvent.click(nextButton(container))
    expect(markdownText(container)).toBe('Terceiro insight\n')
  })

  it('limites sem stream ativo: anterior no mais antigo e próximo no ao vivo não saem do lugar', async () => {
    const { container, getByRole } = render(Notch)

    await completeInsight('s-1', 'Primeiro')
    await completeInsight('s-2', 'Segundo')

    // Ao vivo = insight concluído mais novo; Próximo desabilitado.
    expect(markdownText(container)).toBe('Segundo\n')
    expect(nextButton(container).disabled).toBe(true)

    // Volta pela lista concluída: o mais recente, depois o mais antigo.
    await fireEvent.click(getByRole('button', { name: 'Anterior' }))
    expect(markdownText(container)).toBe('Segundo\n')
    await fireEvent.click(getByRole('button', { name: 'Anterior' }))
    expect(markdownText(container)).toBe('Primeiro\n')

    // Fim inferior: clamp, sem crash, mesmo clicando no desabilitado.
    expect(prevButton(container).disabled).toBe(true)
    await fireEvent.click(prevButton(container))
    expect(markdownText(container)).toBe('Primeiro\n')

    // Fim superior: de volta ao ao vivo, Próximo desabilita; clique não quebra.
    await fireEvent.click(getByRole('button', { name: 'Próximo' }))
    expect(markdownText(container)).toBe('Segundo\n')
    await fireEvent.click(getByRole('button', { name: 'Próximo' }))
    expect(markdownText(container)).toBe('Segundo\n')
    expect(nextButton(container).disabled).toBe(true)
    await fireEvent.click(nextButton(container))
    expect(markdownText(container)).toBe('Segundo\n')
  })

  it('um novo start durante a navegação devolve a exibição ao ao vivo (RF-704)', async () => {
    const { container, getByRole } = render(Notch)

    await completeInsight('s-1', 'Primeiro')
    await completeInsight('s-2', 'Segundo')
    await fireEvent.click(getByRole('button', { name: 'Anterior' }))
    await fireEvent.click(getByRole('button', { name: 'Anterior' }))
    expect(markdownText(container)).toBe('Primeiro\n')

    await emit({ type: 'start', suggestionId: 's-3' })
    await emit({ type: 'token', text: 'Terceiro' })

    expect(markdownText(container)).toBe('Terceiro\n')
    expect(nextButton(container).disabled, 'de volta ao vivo, Próximo desabilita').toBe(true)
  })

  it('um insight com erro não entra no histórico', async () => {
    const { container, getByRole } = render(Notch)

    await emit({ type: 'start', suggestionId: 's-1' })
    await emit({ type: 'token', text: 'Falhou' })
    await emit({ type: 'error', error: { code: 'AGENT_ERROR', message: 'provedor falhou' } })

    // Nenhum insight concluído: navegação vazia.
    expect(prevButton(container).disabled).toBe(true)
    expect(nextButton(container).disabled).toBe(true)

    await completeInsight('s-2', 'Deu certo')

    await fireEvent.click(getByRole('button', { name: 'Anterior' }))
    expect(markdownText(container), 'o erro não vira histórico; só o insight concluído aparece').toBe(
      'Deu certo\n',
    )
  })
})

describe('Notch — robustez do stream (frontend.md, T-303)', () => {
  it('um done sem start prévio é tolerado: sem insight, sem entrada no histórico', async () => {
    const { container } = render(Notch)

    await emit({ type: 'done', providerKind: 'DEEPSEEK' })
    expect(insight(container)).toBeNull()
    expect(prevButton(container).disabled).toBe(true)
    expect(nextButton(container).disabled).toBe(true)

    // A máquina de estados segue íntegra: um start depois funciona.
    await emit({ type: 'start', suggestionId: 's-1' })
    await emit({ type: 'token', text: 'Olá' })
    expect(markdownText(container)).toBe('Olá\n')
  })

  it('payload inválido no evento é ignorado sem crash (Type Safety)', async () => {
    const { container } = render(Notch)

    const handler = listenMock.mock.calls[0]?.[1]
    await act(() => handler?.({ event: 'suggest-stream', id: 1, payload: null }))
    await act(() =>
      handler?.({ event: 'suggest-stream', id: 2, payload: { type: 'nao-conheco' } }),
    )

    expect(insight(container)).toBeNull()
  })

  it('desmontar cancela a assinatura do stream (unlisten)', async () => {
    const { unmount } = render(Notch)
    const unlisten = await listenMock.mock.results[0]?.value

    unmount()
    expect(unlisten, 'o unmount deve cancelar a assinatura').toHaveBeenCalled()
  })
})

describe('Notch — material por plataforma (RF-013, T-400)', () => {
  it('macOS: vibrancy nativa (native) quando disponível', () => {
    detectGlassSupportMock.mockReturnValue({
      nativeVibrancyAvailable: true,
      backdropFilterSupported: false,
    })
    const { container } = render(Notch)

    expect(notchRoot(container).getAttribute('data-notch-material')).toBe('native')
  })

  it('Windows: vidro equivalente a Mica/Acrylic via backdrop-filter (backdrop)', () => {
    detectGlassSupportMock.mockReturnValue({
      nativeVibrancyAvailable: false,
      backdropFilterSupported: true,
    })
    const { container } = render(Notch)

    expect(notchRoot(container).getAttribute('data-notch-material')).toBe('backdrop')
  })

  it('Linux: HUD translúcido quando o compositor suporta backdrop-filter', () => {
    detectGlassSupportMock.mockReturnValue({
      nativeVibrancyAvailable: false,
      backdropFilterSupported: true,
    })
    const { container } = render(Notch)

    expect(notchRoot(container).getAttribute('data-notch-material')).toBe('backdrop')
  })

  it('Linux sem compositor: degrada para fundo semi-opaco (solid)', () => {
    detectGlassSupportMock.mockReturnValue({
      nativeVibrancyAvailable: false,
      backdropFilterSupported: false,
    })
    const { container } = render(Notch)

    expect(notchRoot(container).getAttribute('data-notch-material')).toBe('solid')
  })
})

describe('Notch — rolagem automática (RF-701)', () => {
  function withScrollMetrics(container: HTMLElement): {
    body: HTMLElement
    setScrollHeight: (height: number) => void
  } {
    const body = notchBody(container)
    let scrollHeight = 1000
    Object.defineProperty(body, 'scrollHeight', {
      configurable: true,
      get: () => scrollHeight,
    })
    Object.defineProperty(body, 'clientHeight', { configurable: true, get: () => 200 })
    return { body, setScrollHeight: (height: number) => (scrollHeight = height) }
  }

  it('acompanha a resposta mais recente: rola até o fim quando o conteúdo cresce', async () => {
    const { container } = render(Notch)
    await emit({ type: 'start', suggestionId: 's-1' })
    await waitFor(() => {
      expect(insight(container)).not.toBeNull()
    })
    const { body, setScrollHeight } = withScrollMetrics(container)

    // Conteúdo cresce a cada token: o fim passa de 800 para 900/1000 e a
    // rolagem segue (scrollTop = scrollHeight - clientHeight).
    await emit({ type: 'token', text: 'A' })
    expect(body.scrollTop, 'deve rolar até o fim (scrollHeight - clientHeight)').toBe(800)

    setScrollHeight(1100)
    await emit({ type: 'token', text: 'B' })
    expect(body.scrollTop).toBe(900)

    setScrollHeight(1200)
    await emit({ type: 'token', text: 'C' })
    expect(body.scrollTop).toBe(1000)
  })

  it('pausa quando o usuário rola para cima e retoma ao voltar ao fim', async () => {
    const { container } = render(Notch)
    await emit({ type: 'start', suggestionId: 's-1' })
    await waitFor(() => {
      expect(insight(container)).not.toBeNull()
    })
    const { body, setScrollHeight } = withScrollMetrics(container)

    await emit({ type: 'token', text: 'A' })
    expect(body.scrollTop).toBe(800)

    // Usuário rola para cima (fim = 800): a rolagem automática pausa.
    await fireEvent.scroll(body, { target: { scrollTop: 300 } })
    setScrollHeight(1200)
    await emit({ type: 'token', text: 'B' })
    expect(body.scrollTop, 'pausada: conteúdo novo não move a rolagem').toBe(300)

    // Usuário volta ao fim (fim = 1000): retoma.
    await fireEvent.scroll(body, { target: { scrollTop: 1000 } })
    setScrollHeight(1300)
    await emit({ type: 'token', text: 'C' })
    expect(body.scrollTop, 'retomada: segue o fim de novo').toBe(1100)
  })
})

describe('Notch — nunca o editor completo no streaming (ADR-011)', () => {
  it('usa MarkdownView ao vivo E no histórico; nunca monta o editor Milkdown', async () => {
    const { container, getByRole } = render(Notch)

    await completeInsight('s-1', 'Olá **mundo**')
    await emit({ type: 'start', suggestionId: 's-2' })
    await emit({ type: 'token', text: 'Atual **ao vivo**' })

    await waitFor(() => {
      expect(container.querySelector('[data-notch-insight] [data-markdown-view]')).not.toBeNull()
    })
    expect(container.querySelector('.ProseMirror'), 'nunca ProseMirror no Notch').toBeNull()
    expect(container.querySelector('[data-markdown-editor]'), 'nunca o editor no Notch').toBeNull()

    await fireEvent.click(getByRole('button', { name: 'Anterior' }))
    await fireEvent.click(getByRole('button', { name: 'Anterior' }))
    expect(markdownText(container)).toBe('Olá mundo\n')
    expect(
      container.querySelector('[data-notch-insight] [data-markdown-view] strong')?.textContent,
    ).toBe('mundo')
    expect(container.querySelector('.ProseMirror'), 'nunca ProseMirror no histórico').toBeNull()
    expect(container.querySelector('[data-markdown-editor]'), 'nunca o editor no histórico').toBeNull()
  })
})

describe('Notch — regras gerais do repo', () => {
  it('a saída renderizada não contém emojis, inclusive durante o stream', async () => {
    const { container } = render(Notch)

    await emit({ type: 'start', suggestionId: 's-1', contextLabel: 'Reunião de vendas' })
    await emit({ type: 'token', text: 'Sugiro **responder** com clareza' })

    await waitFor(() => {
      expect(markdownText(container)).toContain('Sugiro responder')
    })
    expect(EMOJI_PATTERN.test(container.textContent ?? '')).toBe(false)
  })
})
