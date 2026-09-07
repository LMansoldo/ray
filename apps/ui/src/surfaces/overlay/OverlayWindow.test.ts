import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, cleanup, act, waitFor } from '@testing-library/svelte'
import OverlayWindow from './OverlayWindow.svelte'

// Contrato RF-012/RF-331 (janela flutuante): o texto do assistente mora numa
// janela Tauri PRÓPRIA, externa à main — mesmo modelo do Notch e da AppBar.
// Este componente é o root da janela 'overlay' e fala com o núcleo por
// comandos exclusivos (show_overlay/hide_window/move_window/resize_window) e
// eventos globais (ray:meeting-*, ray:analysis-hint, suggest-stream,
// ray:shortcut, ray:features-changed).
//
// Seam: '@tauri-apps/api/event' é mockado com vi.hoisted + vi.mock (padrão
// Overlay.test.ts) e '@tauri-apps/api/core' com um invoke espião — o teste
// age como o núcleo e observa os comandos pedidos.

interface StreamListenerEvent {
  event: string
  id: number
  payload: unknown
}

const { listenMock, invokeMock, emitTauriEvent, resetListeners } = vi.hoisted(() => {
  const listenMock = vi.fn<
    (eventName: string, handler: (event: StreamListenerEvent) => void) => Promise<() => void>
  >()
  const handlers = new Map<string, Array<(event: StreamListenerEvent) => void>>()
  listenMock.mockImplementation((eventName, handler) => {
    const list = handlers.get(eventName) ?? []
    list.push(handler)
    handlers.set(eventName, list)
    return Promise.resolve(() => {
      const index = list.indexOf(handler)
      if (index >= 0) list.splice(index, 1)
    })
  })
  // O invoke é um espião: o teste observa os comandos que o componente pede
  // ao núcleo (show_overlay/hide_window/move_window/resize_window).
  const invokeMock = vi.fn<(cmd: string, args?: Record<string, unknown>) => Promise<unknown>>()
  invokeMock.mockResolvedValue(undefined)
  function emitTauriEvent(eventName: string, payload: unknown): void {
    const list = handlers.get(eventName) ?? []
    list.forEach((handler) => handler({ event: eventName, id: 1, payload }))
  }
  function resetListeners(): void {
    handlers.clear()
  }
  return { listenMock, invokeMock, emitTauriEvent, resetListeners }
})

vi.mock('@tauri-apps/api/event', () => ({ listen: listenMock }))
vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }))

// jsdom não tem ResizeObserver — o componente usa um para redimensionar a
// janela ao conteúdo. O stub captura o callback para o teste disparar.
const { resizeObserverStub, fireResize } = vi.hoisted(() => {
  let callback: ResizeObserverCallback | null = null
  class ResizeObserverStub {
    constructor(cb: ResizeObserverCallback) {
      callback = cb
    }
    observe(): void {}
    disconnect(): void {
      callback = null
    }
    unobserve(): void {}
  }
  function fireResize(): void {
    callback?.([], {} as ResizeObserver)
  }
  return { resizeObserverStub: ResizeObserverStub, fireResize }
})

// Regra do repo: sem emojis na UI.
const EMOJI_PATTERN = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/u

function invokeCalls(): Array<{ cmd: string; args?: Record<string, unknown> }> {
  return invokeMock.mock.calls.map(([cmd, args]) => ({ cmd, args }))
}

function hasInvoke(cmd: string, args?: Record<string, unknown>): boolean {
  return invokeCalls().some(
    (call) =>
      call.cmd === cmd &&
      (args === undefined || JSON.stringify(call.args) === JSON.stringify(args)),
  )
}

async function emit(eventName: string, payload: unknown): Promise<void> {
  await act(() => emitTauriEvent(eventName, payload))
}

beforeEach(() => {
  invokeMock.mockReset()
  invokeMock.mockResolvedValue(undefined)
  vi.stubGlobal('ResizeObserver', resizeObserverStub)
})

afterEach(() => {
  resetListeners()
  listenMock.mockClear()
  vi.unstubAllGlobals()
  cleanup()
})

describe('OverlayWindow — janela flutuante do assistente (RF-012)', () => {
  it('renderiza o root próprio e o Overlay dentro dele', () => {
    const { container } = render(OverlayWindow)
    expect(container.querySelector('[data-overlay-window]')).not.toBeNull()
    expect(container.querySelector('[data-overlay]')).not.toBeNull()
  })

  it('reunião iniciada mostra a janela flutuante com o botão de encerrar', async () => {
    const { container } = render(OverlayWindow)
    await emit('ray:meeting-started', null)
    await waitFor(() => expect(hasInvoke('show_overlay')).toBe(true))
    expect(container.querySelector('[data-overlay-stop-meeting]')).not.toBeNull()
  })

  it('reunião encerrada oculta a janela e remove o botão de encerrar', async () => {
    const { container } = render(OverlayWindow)
    await emit('ray:meeting-started', null)
    await emit('ray:meeting-stopped', null)
    await waitFor(() => expect(hasInvoke('hide_window', { windowLabel: 'overlay' })).toBe(true))
    expect(container.querySelector('[data-overlay-stop-meeting]')).toBeNull()
  })

  it('aviso do núcleo (ray:analysis-hint) abre a janela e é exibido', async () => {
    const { container } = render(OverlayWindow)
    await emit('ray:analysis-hint', { text: 'Configure uma API key.' })
    await waitFor(() => expect(hasInvoke('show_overlay')).toBe(true))
    const hint = container.querySelector('[data-overlay-hint]')
    expect(hint).not.toBeNull()
    expect(hint?.textContent).toContain('Configure uma API key.')
  })

  it('insight em streaming abre a janela (resposta sempre no overlay, RF-333/706)', async () => {
    render(OverlayWindow)
    await emit('suggest-stream', { type: 'start', suggestionId: 's-1' })
    await waitFor(() => expect(hasInvoke('show_overlay')).toBe(true))
  })

  it('moveModal* move a JANELA por move_window (RF-507) — não há mais transform in-page', async () => {
    render(OverlayWindow)
    await emit('ray:shortcut', { action: 'moveModalLeft' })
    await emit('ray:shortcut', { action: 'moveModalDown' })
    await waitFor(() =>
      expect(hasInvoke('move_window', { windowLabel: 'overlay', dx: -28, dy: 0 })).toBe(true),
    )
    expect(hasInvoke('move_window', { windowLabel: 'overlay', dx: 0, dy: 28 })).toBe(true)
  })

  it('previousResponse/nextResponse viram evento DOM ray:insight-nav (consumido pelo Overlay)', async () => {
    const { container } = render(OverlayWindow)
    const navEvents: Array<CustomEvent<{ dir?: string }>> = []
    const onNav = (event: Event): void => {
      navEvents.push(event as CustomEvent<{ dir?: string }>)
    }
    window.addEventListener('ray:insight-nav', onNav)
    try {
      await emit('ray:shortcut', { action: 'previousResponse' })
      await emit('ray:shortcut', { action: 'nextResponse' })
      expect(navEvents.map((event) => event.detail?.dir)).toEqual(['prev', 'next'])
    } finally {
      window.removeEventListener('ray:insight-nav', onNav)
    }
    expect(container.querySelector('[data-overlay]')).not.toBeNull()
  })

  it('NÃO invoca comandos que pertencem à janela main (atalhos duplicados não disparam duas vezes)', async () => {
    render(OverlayWindow)
    await emit('ray:shortcut', { action: 'toggleActionBar' })
    await emit('ray:shortcut', { action: 'toggleWindowVisibility' })
    await emit('ray:shortcut', { action: 'toggleAlwaysOnTop' })
    await emit('ray:shortcut', { action: 'toggleMicCapture' })
    await new Promise((resolve) => setTimeout(resolve, 0))
    const cmds = invokeCalls().map((call) => call.cmd)
    expect(cmds).not.toContain('toggle_window')
    expect(cmds).not.toContain('set_always_on_top')
    expect(cmds).not.toContain('set_window_opacity')
    expect(cmds).not.toContain('toggle_mic_capture')
  })

  it('redimensiona a janela à altura do conteúdo (resize_window)', async () => {
    render(OverlayWindow)
    fireResize()
    await waitFor(() => expect(hasInvoke('resize_window')).toBe(true))
    const call = invokeCalls().find((c) => c.cmd === 'resize_window')
    expect(call?.args?.windowLabel).toBe('overlay')
    expect(typeof call?.args?.height).toBe('number')
  })

  it('stealth-unsupported abre a janela com o aviso de limitação (ADR-008)', async () => {
    const { container } = render(OverlayWindow)
    await emit('stealth-unsupported', null)
    await waitFor(() => expect(hasInvoke('show_overlay')).toBe(true))
    expect(container.querySelector('[data-overlay-hint]')?.textContent).toContain('Stealth')
  })

  it('raiz e conteúdo sem emojis (regra geral do repo)', () => {
    const { container } = render(OverlayWindow)
    expect(EMOJI_PATTERN.test(container.textContent ?? '')).toBe(false)
  })
})
