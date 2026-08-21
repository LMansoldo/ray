import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, cleanup, fireEvent, act, waitFor } from '@testing-library/svelte'
import Overlay from './Overlay.svelte'
import type { OverlayProps } from './types'
import { onOverlayAction, type OverlayAction } from './overlay-actions'
import type { SuggestStreamEvent } from '../../../../../contracts/ipc'

// Contrato T-403 / RF-012 + RF-331/332 + T-303: o overlay é a superfície de
// uso em tempo real. Ele consome os eventos Tauri de streaming (ponte T-303:
// o core reemite cada SuggestStreamEvent via app.emit) e exibe o card de
// insight com os tokens aparecendo AO VIVO, em ordem exata de chegada —
// start → token* → done/error, sem bufferizar e achatar (frontend.md).
//
// O seam dos eventos: '@tauri-apps/api/event' é mockado com vi.hoisted +
// vi.mock(factory) — o factory intercepta antes da resolução (padrão
// T-402/T-406) e captura o handler registrado via listen(). O teste age como
// a fonte de eventos Tauri: entrega { event, id, payload } com o payload do
// union SuggestStreamEvent (contracts/ipc.ts:130) 1:1.
//
// Nome do evento pinado: 'suggest-stream' — o core (GREEN do T-303) precisa
// emitir exatamente este nome; nenhum nome foi estabelecido no repo ainda
// (suggest_with_emitter é todo!() em core/src/lib.rs).
//
// Reposicionamento (RF-012/RF-507, parte UI): o overlay renderiza na posição
// recebida por prop (controlada pelo core) e responde à mudança dela. O
// comando core de reposicionar NÃO existe (core/src/lib.rs registra apenas
// set_stealth/toggle_window/suggest/transcribe_pending_pcm; windows.rs tem
// calculate_overlay_displacement sem #[tauri::command]) — fica no coverageMap
// com coveredBy vazio.

interface StreamListenerEvent {
  event: string
  id: number
  payload: unknown
}

const { listenMock, emitSuggestEvent, resetStreamListeners } = vi.hoisted(() => {
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
  return { listenMock, emitSuggestEvent, resetStreamListeners }
})

vi.mock('@tauri-apps/api/event', () => ({ listen: listenMock }))

// Props tipadas contra a fonte única de tipos da superfície (types.ts), não
// via ComponentProps<Overlay>: shape legado do svelte-check degrada para
// never (ver decisions.md T-402).
type Props = OverlayProps

// Sem props: position cai no padrão { x: 0, y: 0 }.
const baseProps: Props = {}

// Entrega um evento como a ponte T-303 faria e aguarda o flush dos efeitos
// Svelte (act) — o estado do stream muta dentro do handler de listen().
async function emit(event: SuggestStreamEvent): Promise<void> {
  await act(() => emitSuggestEvent(event))
}

// Regra do repo: sem emojis na UI.
const EMOJI_PATTERN = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/u

function overlayRoot(container: HTMLElement): HTMLElement {
  const root = container.querySelector('[data-overlay]')
  expect(root, 'a raiz do overlay deve existir').not.toBeNull()
  return root as HTMLElement
}

let unsubscribeAction: (() => void) | undefined

afterEach(() => {
  unsubscribeAction?.()
  unsubscribeAction = undefined
  resetStreamListeners()
  listenMock.mockClear()
  cleanup()
})

describe('Overlay — superfície e assinatura do stream (RF-012, T-303)', () => {
  it('renderiza a raiz, aplica a posição padrão e assina o stream uma única vez', () => {
    const { container } = render(Overlay, { props: baseProps })

    const root = overlayRoot(container)
    expect(root.style.transform).toMatch(/translate\(0(px)?,\s*0(px)?\)/)

    expect(listenMock, 'deve assinar os eventos de streaming').toHaveBeenCalledTimes(1)
    expect(listenMock.mock.calls[0]?.[0], 'nome do evento Tauri pinado').toBe('suggest-stream')
  })

  it('sem eventos, nenhum card de insight é exibido', () => {
    const { container } = render(Overlay, { props: baseProps })
    expect(container.querySelector('[data-insight-card]')).toBeNull()
  })
})

describe('Overlay — tokens ao vivo no card, em ordem (RF-331/332)', () => {
  it('o start exibe o card com contexto, ELES DISSERAM e DIGA ISSO', async () => {
    const { container } = render(Overlay, { props: baseProps })

    await emit({
      type: 'start',
      suggestionId: 's-1',
      contextLabel: 'Reunião de vendas',
      theySaid: 'Qual o preço?',
    })

    await waitFor(() => {
      expect(container.querySelector('[data-insight-card]')).not.toBeNull()
    })
    expect(container.querySelector('[data-insight-context]')?.textContent).toContain(
      'Reunião de vendas',
    )
    expect(container.querySelector('[data-insight-they-said]')?.textContent).toContain(
      'Qual o preço?',
    )
    expect(container.querySelector('[data-insight-say-this]')?.textContent).toContain('DIGA ISSO')
    expect(
      container.querySelector('[data-insight-card]')?.getAttribute('data-insight-status'),
    ).toBe('streaming')
  })

  it('acumula os tokens em ordem exata no DIGA ISSO, sem re-assinar o stream', async () => {
    const { container } = render(Overlay, { props: baseProps })

    await emit({ type: 'start', suggestionId: 's-1', contextLabel: 'Reunião' })
    await emit({ type: 'token', text: 'Olá' })
    await emit({ type: 'token', text: ' **mundo**' })
    await emit({ type: 'token', text: '!' })

    const view = container.querySelector('[data-markdown-view]')
    expect(view, 'o DIGA ISSO usa o renderizador T-408').not.toBeNull()
    // Ordem exata: qualquer reordenação dos tokens muda a string. O '\n'
    // final é a quebra de bloco que o renderizador T-408 (marked) emite após
    // cada parágrafo — correção do pin com prova em decisions.md.
    expect(view?.textContent).toBe('Olá mundo!\n')
    expect(
      container.querySelector('[data-insight-say-this] strong')?.textContent,
      'o markdown acumulado é processado pelo renderizador',
    ).toBe('mundo')
    expect(listenMock, 'uma assinatura por montagem, nunca por evento').toHaveBeenCalledTimes(1)
  })

  it('o done encerra; tokens após o done são ignorados', async () => {
    const { container } = render(Overlay, { props: baseProps })

    await emit({ type: 'start', suggestionId: 's-1' })
    await emit({ type: 'token', text: 'Olá' })
    await emit({ type: 'done', providerKind: 'DEEPSEEK', model: 'deepseek-chat' })

    expect(
      container.querySelector('[data-insight-card]')?.getAttribute('data-insight-status'),
    ).toBe('done')

    await emit({ type: 'token', text: ' **ignorado**' })
    expect(container.querySelector('[data-markdown-view]')?.textContent).toBe('Olá\n')
  })

  it('erro no meio do stream: erro exibido sem perder a ordem nem o texto acumulado', async () => {
    const { container } = render(Overlay, { props: baseProps })

    await emit({ type: 'start', suggestionId: 's-1', contextLabel: 'Reunião' })
    await emit({ type: 'token', text: 'Olá' })
    await emit({ type: 'error', error: { code: 'AGENT_ERROR', message: 'provedor falhou' } })

    const error = container.querySelector('[data-insight-error]')
    expect(error, 'o erro deve aparecer no card').not.toBeNull()
    expect(error?.textContent).toContain('provedor falhou')
    expect(
      container.querySelector('[data-insight-card]')?.getAttribute('data-insight-status'),
    ).toBe('error')
    expect(container.querySelector('[data-markdown-view]')?.textContent).toBe('Olá\n')

    // A máquina de estados não quebra: eventos após o erro não afetam o card.
    await emit({ type: 'token', text: ' **depois do erro**' })
    expect(container.querySelector('[data-markdown-view]')?.textContent).toBe('Olá\n')
  })
})

describe('Overlay — robustez do stream (frontend.md, T-303)', () => {
  it('um done sem start prévio é tolerado: sem card, sem crash', async () => {
    const { container } = render(Overlay, { props: baseProps })

    await emit({ type: 'done', providerKind: 'DEEPSEEK' })
    expect(container.querySelector('[data-insight-card]')).toBeNull()

    // A máquina de estados segue íntegra: um start depois funciona.
    await emit({ type: 'start', suggestionId: 's-1' })
    await emit({ type: 'token', text: 'Olá' })
    expect(container.querySelector('[data-markdown-view]')?.textContent).toBe('Olá\n')
  })

  it('payload inválido no evento é ignorado sem crash (Type Safety)', async () => {
    const { container } = render(Overlay, { props: baseProps })

    const handler = listenMock.mock.calls[0]?.[1]
    await act(() => handler?.({ event: 'suggest-stream', id: 1, payload: null }))
    await act(() =>
      handler?.({ event: 'suggest-stream', id: 2, payload: { type: 'nao-conheco' } }),
    )

    expect(container.querySelector('[data-insight-card]')).toBeNull()
  })

  it('um novo start substitui a sugestão anterior (contexto e texto)', async () => {
    const { container } = render(Overlay, { props: baseProps })

    await emit({ type: 'start', suggestionId: 's-1', contextLabel: 'Reunião de vendas' })
    await emit({ type: 'token', text: 'Olá' })
    await emit({ type: 'start', suggestionId: 's-2', contextLabel: 'Suporte técnico' })
    await emit({ type: 'token', text: 'Novo' })

    expect(container.querySelector('[data-insight-context]')?.textContent).toContain(
      'Suporte técnico',
    )
    expect(container.querySelector('[data-markdown-view]')?.textContent).toBe('Novo\n')
  })

  it('desmontar cancela a assinatura do stream (unlisten)', async () => {
    const { unmount } = render(Overlay, { props: baseProps })
    const unlisten = await listenMock.mock.results[0]?.value

    unmount()
    expect(unlisten, 'o unmount deve cancelar a assinatura').toHaveBeenCalled()
  })
})

describe('Overlay — nunca o editor completo no streaming (ADR-011)', () => {
  it('o DIGA ISSO usa MarkdownView e nunca monta o editor Milkdown', async () => {
    const { container } = render(Overlay, { props: baseProps })

    await emit({ type: 'start', suggestionId: 's-1' })
    await emit({ type: 'token', text: 'Olá **mundo**' })

    await waitFor(() => {
      expect(container.querySelector('[data-markdown-view]')).not.toBeNull()
    })
    expect(container.querySelector('.ProseMirror'), 'nunca ProseMirror no overlay').toBeNull()
    expect(container.querySelector('[data-markdown-editor]'), 'nunca o editor no overlay').toBeNull()
  })
})

describe('Overlay — ação contextual (RF-331)', () => {
  it('Ver caso de uso despacha viewUseCase com o suggestionId ativo', async () => {
    const received: OverlayAction[] = []
    unsubscribeAction = onOverlayAction((action: OverlayAction) => received.push(action))

    const { container, getByRole } = render(Overlay, { props: baseProps })
    await emit({ type: 'start', suggestionId: 's-7', contextLabel: 'Reunião' })
    await waitFor(() => {
      expect(container.querySelector('[data-insight-card]')).not.toBeNull()
    })

    await fireEvent.click(getByRole('button', { name: 'Ver caso de uso' }))
    expect(received).toEqual([{ type: 'viewUseCase', suggestionId: 's-7' }])
  })
})

describe('Overlay — posição (RF-012 / RF-507, parte UI)', () => {
  it('renderiza na posição recebida por prop e responde à mudança dela', async () => {
    const { container, rerender } = render(Overlay, { props: baseProps })
    const root = overlayRoot(container)

    await rerender({ position: { x: 50, y: -30 } })
    expect(root.style.transform).toMatch(/translate\(50px,\s*-30px\)/)

    await rerender({ position: { x: -10, y: 20 } })
    expect(root.style.transform).toMatch(/translate\(-10px,\s*20px\)/)
  })
})

describe('Overlay — regras gerais do repo', () => {
  it('a saída renderizada não contém emojis, inclusive durante o stream', async () => {
    const { container } = render(Overlay, { props: baseProps })

    await emit({
      type: 'start',
      suggestionId: 's-1',
      contextLabel: 'Reunião de vendas',
      theySaid: 'Qual o preço?',
    })
    await emit({ type: 'token', text: 'Sugiro **responder** com clareza' })

    await waitFor(() => {
      expect(container.querySelector('[data-markdown-view]')?.textContent).toContain(
        'Sugiro responder',
      )
    })
    expect(EMOJI_PATTERN.test(container.textContent ?? '')).toBe(false)
  })
})
