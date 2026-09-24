import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, cleanup, act, waitFor, fireEvent } from '@testing-library/svelte'
import OverlayWindow from './OverlayWindow.svelte'

// Contrato RF-012/RF-331 (janela flutuante): o texto do assistente mora numa
// janela Tauri PRÓPRIA, externa à main — mesmo modelo do Notch e da AppBar.
// Este componente é o root da janela 'overlay' e fala com o núcleo por
// comandos exclusivos (show_overlay/hide_window/move_window/
// set_window_opacity do label 'overlay') e eventos globais (ray:meeting-*,
// ray:analysis-hint, suggest-stream, ray:shortcut, ray:features-changed).
// Drag/resize por mouse (alça no topo, grip no canto) usa a Window API
// (@tauri-apps/api/window): startDragging, startResizeDragging. O tamanho da
// janela pertence ao container Tauri (bordas nativas/grip) — NUNCA há
// resize_window: o conteúdo sempre preenche a largura/altura da janela.
// Atalhos: moveModal* movem a janela; previousResponse/nextResponse E
// notchPreviousInsight/notchNextInsight navegam o histórico (ray:insight-nav);
// overlayScroll* viram ray:overlay-scroll (rolagem do DIGA ISSO);
// increaseOpacity/decreaseOpacity aplicam ao PRÓPRIO overlay.
//
// Seam: '@tauri-apps/api/event' é mockado com vi.hoisted + vi.mock (padrão
// Overlay.test.ts), '@tauri-apps/api/core' com um invoke espião e
// '@tauri-apps/api/window' com uma instância única espiada — o teste age como
// o núcleo e observa os comandos/métodos pedidos.

interface StreamListenerEvent {
  event: string
  id: number
  payload: unknown
}

const { listenMock, invokeMock, emitTauriEvent, resetListeners, windowApi, windowInstance } =
  vi.hoisted(() => {
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
    // ao núcleo (show_overlay/hide_window/move_window).
    const invokeMock = vi.fn<(cmd: string, args?: Record<string, unknown>) => Promise<unknown>>()
    invokeMock.mockResolvedValue(undefined)
    function emitTauriEvent(eventName: string, payload: unknown): void {
      const list = handlers.get(eventName) ?? []
      list.forEach((handler) => handler({ event: eventName, id: 1, payload }))
    }
    function resetListeners(): void {
      handlers.clear()
    }
    // Instância única da janela 'overlay' (getCurrentWindow é estável por app).
    const windowInstance = {
      label: 'overlay',
      startDragging: vi.fn(() => Promise.resolve()),
      startResizeDragging: vi.fn(() => Promise.resolve()),
    }
    const windowApi = { getCurrentWindow: vi.fn(() => windowInstance) }
    return { listenMock, invokeMock, emitTauriEvent, resetListeners, windowApi, windowInstance }
  })

vi.mock('@tauri-apps/api/event', () => ({ listen: listenMock }))
vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }))
vi.mock('@tauri-apps/api/window', () => ({ getCurrentWindow: windowApi.getCurrentWindow }))

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
  windowInstance.startDragging.mockClear()
  windowInstance.startResizeDragging.mockClear()
})

afterEach(() => {
  resetListeners()
  listenMock.mockClear()
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

  it('erro no stream também abre a janela — falha nunca é silenciosa', async () => {
    const { container } = render(OverlayWindow)
    await emit('suggest-stream', {
      type: 'error',
      error: { code: 'AGENT_ERROR', message: 'provedor falhou' },
    })
    await waitFor(() => expect(hasInvoke('show_overlay')).toBe(true))
    // O card de insight exibe o estado de erro (o core garante start antes
    // do error em falhas pré-stream; erros pós-start já têm card aberto).
    expect(container.querySelector('[data-overlay-window]')).not.toBeNull()
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

  it('notchPreviousInsight/notchNextInsight TAMBÉM navegam o overlay (ray:insight-nav)', async () => {
    render(OverlayWindow)
    const navEvents: Array<CustomEvent<{ dir?: string }>> = []
    const onNav = (event: Event): void => {
      navEvents.push(event as CustomEvent<{ dir?: string }>)
    }
    window.addEventListener('ray:insight-nav', onNav)
    try {
      await emit('ray:shortcut', { action: 'notchPreviousInsight' })
      await emit('ray:shortcut', { action: 'notchNextInsight' })
      expect(navEvents.map((event) => event.detail?.dir)).toEqual(['prev', 'next'])
    } finally {
      window.removeEventListener('ray:insight-nav', onNav)
    }
  })

  it('overlayScrollUp/overlayScrollDown viram evento DOM ray:overlay-scroll (consumido pelo InsightCard)', async () => {
    render(OverlayWindow)
    const scrollEvents: Array<CustomEvent<{ dir?: string }>> = []
    const onScroll = (event: Event): void => {
      scrollEvents.push(event as CustomEvent<{ dir?: string }>)
    }
    window.addEventListener('ray:overlay-scroll', onScroll)
    try {
      await emit('ray:shortcut', { action: 'overlayScrollUp' })
      await emit('ray:shortcut', { action: 'overlayScrollDown' })
      expect(scrollEvents.map((event) => event.detail?.dir)).toEqual(['up', 'down'])
    } finally {
      window.removeEventListener('ray:overlay-scroll', onScroll)
    }
  })

  it('atalhos de opacidade aplicam set_window_opacity no PRÓPRIO overlay (mesmos limites da main)', async () => {
    render(OverlayWindow)
    await emit('ray:shortcut', { action: 'decreaseOpacity' })
    await emit('ray:shortcut', { action: 'decreaseOpacity' })
    await emit('ray:shortcut', { action: 'increaseOpacity' })
    await waitFor(() =>
      expect(
        hasInvoke('set_window_opacity', { windowLabel: 'overlay', opacity: 0.9 }),
      ).toBe(true),
    )
    // Passo de 0.1 e piso 0.35: 1.0 → 0.9 → 0.8 → 0.9.
    expect(
      invokeCalls().filter((call) => call.cmd === 'set_window_opacity').map((call) => call.args),
    ).toEqual([
      { windowLabel: 'overlay', opacity: 0.9 },
      { windowLabel: 'overlay', opacity: 0.8 },
      { windowLabel: 'overlay', opacity: 0.9 },
    ])
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

  it('NUNCA invoca resize_window — o tamanho é do container Tauri e o conteúdo sempre preenche', async () => {
    render(OverlayWindow)
    await emit('ray:meeting-started', null)
    await emit('suggest-stream', { type: 'start', suggestionId: 's-1' })
    await emit('suggest-stream', { type: 'token', text: 'código longo…' })
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(invokeCalls().filter((call) => call.cmd === 'resize_window')).toHaveLength(0)
  })

  // ── Drag/resize por mouse: alça no topo, grip no canto inferior ─────────

  it('alça de arraste dispara startDragging no pointerdown esquerdo', async () => {
    const { container } = render(OverlayWindow)
    const handle = container.querySelector('[data-overlay-drag-handle]')
    expect(handle).not.toBeNull()
    await act(() => fireEvent.pointerDown(handle as HTMLElement, { button: 0 }))
    expect(windowInstance.startDragging).toHaveBeenCalledTimes(1)
  })

  it('pointerdown com botão não-primário não inicia drag', async () => {
    const { container } = render(OverlayWindow)
    const handle = container.querySelector('[data-overlay-drag-handle]') as HTMLElement
    await act(() => fireEvent.pointerDown(handle, { button: 2 }))
    expect(windowInstance.startDragging).not.toHaveBeenCalled()
  })

  it('grip de resize dispara startResizeDragging ao sudeste (resize do container)', async () => {
    const { container } = render(OverlayWindow)
    const grip = container.querySelector('[data-overlay-resize-handle]')
    expect(grip).not.toBeNull()
    await act(() => fireEvent.pointerDown(grip as HTMLElement, { button: 0 }))
    expect(windowInstance.startResizeDragging).toHaveBeenCalledWith('SouthEast')
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
