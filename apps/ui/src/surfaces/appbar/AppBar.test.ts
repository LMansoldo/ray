import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, cleanup, fireEvent } from '@testing-library/svelte'
import AppBar from './AppBar.svelte'
import type { AppBarProps } from './types'

// Contrato T-401 / RF-010 (proposta estilo macOS aprovada em
// ray-appbar-macos-mock.html): toolbar horizontal com traffic lights — o
// vermelho é o "Ocultar" funcional (RF-504), amarelo/verde são decorativos —
// segmented control de navegação (Home/Assistentes/Configurações, segmento
// ativo destacado), chip do stealth com LED laranja (aceso = ativo) e botão
// de onboarding. Sem grip de pontos: a barra inteira é drag region nativa.
// RF-502: ativacao rapida do stealth com sinalizacao clara do estado.
// RF-504: ocultar a janela main ("panic hide") via hide_window.
// RF-508: o aviso de uso responsavel viaja NO TOOLTIP do chip do stealth
// (a barra não tem texto de estado "ativo/inativo" visível).
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

describe('AppBar — elementos da barra estilo macOS (RF-010)', () => {
  it('renderiza traffic lights, segmentos, chip do stealth, onboarding e Ocultar', () => {
    const { container, getByRole } = render(AppBar, { props: baseProps })

    expect(container.querySelector('[data-appbar]'), 'raiz da barra').not.toBeNull()
    expect(container.querySelector('[data-appbar-lights]'), 'traffic lights').not.toBeNull()
    expect(getByRole('button', { name: 'Home' }), 'segmento Home').toBeDefined()
    expect(getByRole('button', { name: 'Assistentes' }), 'segmento Assistentes').toBeDefined()
    expect(getByRole('button', { name: 'Configuracoes' }), 'segmento Configuracoes').toBeDefined()
    expect(container.querySelector('[data-appbar-stealth]'), 'chip do stealth').not.toBeNull()
    expect(getByRole('button', { name: 'Iniciar Configuracao' })).toBeDefined()
    expect(getByRole('button', { name: 'Ocultar' }), 'traffic light vermelho (Ocultar)').toBeDefined()
  })

  it('amarelo e verde sao decorativos — so o vermelho e botao', () => {
    const { container } = render(AppBar, { props: baseProps })
    const lights = container.querySelector('[data-appbar-lights]')
    expect(lights?.querySelectorAll('button')).toHaveLength(1)
    expect(lights?.querySelectorAll('.appbar__light')).toHaveLength(3)
  })

  it('o estado do stealth aparece no LED e no tooltip, nao em texto de status', () => {
    const { container } = render(AppBar, { props: baseProps })
    expect(container.querySelector('[data-appbar-status]')).toBeNull()
    expect(container.textContent ?? '').not.toContain('Stealth ativo')
    expect(container.textContent ?? '').not.toContain('Stealth inativo')
  })

  it('a barra inteira e regiao de arraste nativa (data-tauri-drag-region)', () => {
    const { container } = render(AppBar, { props: baseProps })
    const nav = container.querySelector('[data-appbar]')
    expect(nav?.hasAttribute('data-tauri-drag-region')).toBe(true)
  })

  it('comeca com Home destacada e stealth ativo (LED aceso) com o aviso RF-508 no tooltip', () => {
    const { container } = render(AppBar, { props: baseProps })
    expect(container.querySelector('.appbar__segment--on')?.getAttribute('aria-label')).toBe('Home')
    expect(stealthState(container)).toBe('true')
    const tooltip = stealthTooltip(container)
    for (const fragment of NOTICE_FRAGMENTS) {
      expect(tooltip).toMatch(fragment)
    }
    expect(invokeMock).not.toHaveBeenCalled()
  })

  it('clicar em um segmento move o destaque para ele', async () => {
    const { container, getByRole } = render(AppBar, { props: baseProps })
    await fireEvent.click(getByRole('button', { name: 'Assistentes' }))
    expect(container.querySelector('.appbar__segment--on')?.getAttribute('aria-label')).toBe('Assistentes')
  })
})

describe('AppBar — stealth alterna visivelmente (RF-502)', () => {
  it('clique desativa: set_stealth com excluded=false e a bola apaga', async () => {
    const { container, getByRole } = render(AppBar, { props: baseProps })
    await fireEvent.click(getByRole('button', { name: /stealth/i }))

    expect(invokeMock).toHaveBeenCalledTimes(1)
    expect(invokeMock.mock.calls[0]).toEqual(['set_stealth', { excluded: false }])
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
    expect(invokeMock.mock.calls[0]).toEqual(['set_stealth', { excluded: false }])
    expect(invokeMock.mock.calls[1]).toEqual(['set_stealth', { excluded: true }])
  })

  it('segundo clique reativa: set_stealth com excluded=true e a bola acende', async () => {
    const { container, getByRole } = render(AppBar, { props: baseProps })
    const botao = getByRole('button', { name: /stealth/i })
    await fireEvent.click(botao)
    await fireEvent.click(botao)

    expect(invokeMock).toHaveBeenCalledTimes(2)
    expect(invokeMock.mock.calls[0]).toEqual(['set_stealth', { excluded: false }])
    expect(invokeMock.mock.calls[1]).toEqual(['set_stealth', { excluded: true }])
    expect(stealthState(container)).toBe('true')
  })

  it('monta inativo quando stealthExcluded=false, sem re-disparar o comando', async () => {
    const { container, getByRole } = render(AppBar, {
      props: { ...baseProps, stealthExcluded: false },
    })

    expect(stealthState(container)).toBe('false')
    expect(invokeMock).not.toHaveBeenCalled()

    await fireEvent.click(getByRole('button', { name: /stealth/i }))
    expect(invokeMock.mock.calls[0]).toEqual(['set_stealth', { excluded: true }])
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

  it('stealth é GLOBAL: set_stealth sem windowLabel; navegação segue fixa na main', async () => {
    const { getByRole } = render(AppBar)
    await fireEvent.click(getByRole('button', { name: /stealth/i }))

    // Modo global: o core aplica em TODAS as janelas (windows::STEALTH_WINDOWS).
    expect(invokeMock.mock.calls[0]).toEqual(['set_stealth', { excluded: false }])

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
