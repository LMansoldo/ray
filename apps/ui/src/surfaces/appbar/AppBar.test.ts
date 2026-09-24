import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, cleanup, fireEvent } from '@testing-library/svelte'
import AppBar from './AppBar.svelte'
import type { AppBarProps } from './types'

// Contrato T-401 / RF-010: barra flutuante compacta (150x80) com grip para
// arrastar, grid 3x2 de botoes so-icone e a BOLA do stealth como indicador
// de estado (laranja = ativo; apagada = inativo). Sem texto na barra.
// RF-502: ativacao rapida do stealth com sinalizacao clara do estado.
// RF-504: ocultar a janela main ("panic hide") via hide_window.
// RF-508: o aviso de uso responsavel viaja NO TOOLTIP da bola do stealth
// (a barra compacta nao tem texto visivel).
//
// Navegacao cross-window: invoke('show_window', { windowLabel: 'main' }) +
// emit('ray:navigate', { surface: dest }). Nao ha mais pub/sub in-process.
// O seam e mockado via vi.hoisted + vi.mock para garantir a interceptacao
// antes da resolucao de modulo (padrao T-402/T-406).

const { invokeMock } = vi.hoisted(() => ({
  invokeMock: vi
    .fn<(command: string, args?: unknown) => Promise<unknown>>()
    .mockResolvedValue(undefined),
}))
vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }))

const { emitMock } = vi.hoisted(() => ({
  emitMock: vi
    .fn<(event: string, payload?: unknown) => Promise<void>>()
    .mockResolvedValue(undefined),
}))
vi.mock('@tauri-apps/api/event', () => ({ emit: emitMock }))


type Props = AppBarProps

const baseProps: Props = {}

const NOTICE_FRAGMENTS: RegExp[] = [
  /conformidade/i,
  /consentimento/i,
  /responsável/i,
  /responsabilidade do usuário/i,
]

const EMOJI_PATTERN = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/u

afterEach(() => {
  invokeMock.mockClear()
  emitMock.mockClear()
  cleanup()
})

function stealthBall(container: HTMLElement): Element {
  const el = container.querySelector('[data-appbar-stealth]')
  expect(el, 'a bola do stealth deve existir').not.toBeNull()
  return el as Element
}

function stealthState(container: HTMLElement): string {
  const state = stealthBall(container).getAttribute('data-stealth-active')
  expect(state, 'estado do stealth deve estar refletido na bola').not.toBeNull()
  return state as string
}

function stealthTooltip(container: HTMLElement): string {
  return stealthBall(container).getAttribute('title') ?? ''
}

describe('AppBar — elementos da barra flutuante (RF-010)', () => {
  it('renderiza grip, Home, bola do stealth, Iniciar Configuracao e Ocultar', () => {
    const { container, getByRole } = render(AppBar, { props: baseProps })

    expect(container.querySelector('[data-appbar]'), 'raiz da barra').not.toBeNull()
    expect(container.querySelector('[data-appbar-grip]'), 'grip de arrastar').not.toBeNull()
    expect(getByRole('button', { name: 'Home' }), 'botao Home').toBeDefined()
    expect(getByRole('button', { name: 'Assistentes' }), 'botao Assistentes').toBeDefined()
    expect(getByRole('button', { name: 'Configuracoes' }), 'botao Configuracoes').toBeDefined()
    expect(container.querySelector('[data-appbar-stealth]'), 'bola do stealth').not.toBeNull()
    expect(getByRole('button', { name: 'Iniciar Configuracao' })).toBeDefined()
    expect(getByRole('button', { name: 'Ocultar' }), 'botao de ocultar').toBeDefined()
  })

  it('a barra nao tem texto de status — so a bola indica o estado (barra 150x80)', () => {
    const { container } = render(AppBar, { props: baseProps })
    expect(container.querySelector('[data-appbar-status]')).toBeNull()
    expect(container.textContent ?? '').not.toContain('Stealth ativo')
    expect(container.textContent ?? '').not.toContain('Stealth inativo')
  })

  it('o grip existe como indicador visual de arraste', () => {
    const { container } = render(AppBar, { props: baseProps })
    expect(container.querySelector('[data-appbar-grip]')).not.toBeNull()
  })

  it('a barra inteira e regiao de arraste nativa (data-tauri-drag-region)', () => {
    const { container } = render(AppBar, { props: baseProps })
    const nav = container.querySelector('[data-appbar]')
    expect(nav?.hasAttribute('data-tauri-drag-region')).toBe(true)
  })

  it('comeca com stealth ativo (bola acesa) e o aviso RF-508 no tooltip', () => {
    const { container } = render(AppBar, { props: baseProps })
    expect(stealthState(container)).toBe('true')
    const tooltip = stealthTooltip(container)
    for (const fragment of NOTICE_FRAGMENTS) {
      expect(tooltip).toMatch(fragment)
    }
    expect(invokeMock).not.toHaveBeenCalled()
  })
})

describe('AppBar — stealth alterna visivelmente (RF-502)', () => {
  it('clique desativa: set_stealth com excluded=false e a bola apaga', async () => {
    const { container, getByRole } = render(AppBar, { props: baseProps })
    await fireEvent.click(getByRole('button', { name: /stealth/i }))

    expect(invokeMock).toHaveBeenCalledTimes(1)
    expect(invokeMock.mock.calls[0]).toEqual(['set_stealth', { windowLabel: 'main', excluded: false }])
    expect(stealthState(container)).toBe('false')
    expect(stealthTooltip(container)).toMatch(/inativo/)
  })

  it('reativar restaura o aviso RF-508 no tooltip (SRS §7)', async () => {
    const { container, getByRole } = render(AppBar, { props: baseProps })
    const botao = getByRole('button', { name: /stealth/i })
    await fireEvent.click(botao)
    await fireEvent.click(botao)

    const tooltip = stealthTooltip(container)
    for (const fragment of NOTICE_FRAGMENTS) {
      expect(tooltip).toMatch(fragment)
    }
    expect(invokeMock.mock.calls[0]).toEqual(['set_stealth', { windowLabel: 'main', excluded: false }])
    expect(invokeMock.mock.calls[1]).toEqual(['set_stealth', { windowLabel: 'main', excluded: true }])
  })

  it('segundo clique reativa: set_stealth com excluded=true e a bola acende', async () => {
    const { container, getByRole } = render(AppBar, { props: baseProps })
    const botao = getByRole('button', { name: /stealth/i })
    await fireEvent.click(botao)
    await fireEvent.click(botao)

    expect(invokeMock).toHaveBeenCalledTimes(2)
    expect(invokeMock.mock.calls[0]).toEqual(['set_stealth', { windowLabel: 'main', excluded: false }])
    expect(invokeMock.mock.calls[1]).toEqual(['set_stealth', { windowLabel: 'main', excluded: true }])
    expect(stealthState(container)).toBe('true')
  })

  it('monta inativo quando stealthExcluded=false, sem re-disparar o comando', async () => {
    const { container, getByRole } = render(AppBar, {
      props: { ...baseProps, stealthExcluded: false },
    })

    expect(stealthState(container)).toBe('false')
    expect(invokeMock).not.toHaveBeenCalled()

    await fireEvent.click(getByRole('button', { name: /stealth/i }))
    expect(invokeMock.mock.calls[0]).toEqual(['set_stealth', { windowLabel: 'main', excluded: true }])
  })
})

describe('AppBar — navegacao cross-window (RF-010)', () => {
  it('botao Home mostra a janela main e emite ray:navigate com surface=home', async () => {
    const { getByRole } = render(AppBar, { props: baseProps })
    await fireEvent.click(getByRole('button', { name: 'Home' }))

    expect(invokeMock).toHaveBeenCalledWith('show_window', { windowLabel: 'main' })
    expect(emitMock).toHaveBeenCalledWith('ray:navigate', { surface: 'home' })
  })

  it('botao Assistentes mostra a janela main e emite ray:navigate com surface=assistants', async () => {
    const { getByRole } = render(AppBar, { props: baseProps })
    await fireEvent.click(getByRole('button', { name: 'Assistentes' }))

    expect(invokeMock).toHaveBeenCalledWith('show_window', { windowLabel: 'main' })
    expect(emitMock).toHaveBeenCalledWith('ray:navigate', { surface: 'assistants' })
  })

  it('botao Configuracoes mostra a janela main e emite ray:navigate com surface=settings', async () => {
    const { getByRole } = render(AppBar, { props: baseProps })
    await fireEvent.click(getByRole('button', { name: 'Configuracoes' }))

    expect(invokeMock).toHaveBeenCalledWith('show_window', { windowLabel: 'main' })
    expect(emitMock).toHaveBeenCalledWith('ray:navigate', { surface: 'settings' })
  })

  it('botao Onboarding mostra a janela main e emite ray:navigate com surface=onboarding', async () => {
    const { getByRole } = render(AppBar, { props: baseProps })
    await fireEvent.click(getByRole('button', { name: 'Iniciar Configuracao' }))

    expect(invokeMock).toHaveBeenCalledWith('show_window', { windowLabel: 'main' })
    expect(emitMock).toHaveBeenCalledWith('ray:navigate', { surface: 'onboarding' })
  })

  it('Ocultar chama hide_window na janela main sem emitir eventos (RF-504)', async () => {
    const { getByRole } = render(AppBar, { props: baseProps })
    await fireEvent.click(getByRole('button', { name: 'Ocultar' }))

    expect(invokeMock).toHaveBeenCalledTimes(1)
    expect(invokeMock.mock.calls[0]).toEqual(['hide_window', { windowLabel: 'main' }])
    expect(emitMock).not.toHaveBeenCalled()
  })

  it('windowLabel prop controla apenas o stealth, nao a navegacao', async () => {
    const { getByRole } = render(AppBar, { props: { windowLabel: 'outra-janela' } })
    await fireEvent.click(getByRole('button', { name: /stealth/i }))

    expect(invokeMock.mock.calls[0]).toEqual([
      'set_stealth',
      { windowLabel: 'outra-janela', excluded: false },
    ])
    invokeMock.mockClear()

    await fireEvent.click(getByRole('button', { name: 'Home' }))
    expect(invokeMock).toHaveBeenCalledWith('show_window', { windowLabel: 'main' })
    expect(emitMock).toHaveBeenCalledWith('ray:navigate', { surface: 'home' })
  })
})

describe('AppBar — regras gerais do repo', () => {
  it('a saida renderizada nao contem emojis', () => {
    const { container } = render(AppBar, { props: baseProps })
    expect(EMOJI_PATTERN.test(container.textContent ?? '')).toBe(false)
  })
})
