import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, cleanup, fireEvent } from '@testing-library/svelte'
import AppBar from './AppBar.svelte'
import type { AppBarProps } from './types'

// Contrato T-401 / RF-010: barra flutuante compacta com grip para arrastar,
// botao Home, indicador de status, botao stealth e botoes de navegacao.
// RF-502: ativacao rapida do stealth com sinalizacao clara do estado.
// RF-504: ocultar a janela main ("panic hide") via hide_window.
// RF-508: aviso de uso responsavel e conformidade legal ao ativar o stealth.
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

function statusIndicator(container: HTMLElement): Element {
  const el = container.querySelector('[data-appbar-status]')
  expect(el, 'o indicador de status deve existir').not.toBeNull()
  return el as Element
}

function stealthNotice(container: HTMLElement): Element | null {
  return container.querySelector('[data-stealth-notice]')
}

describe('AppBar — elementos da barra flutuante (RF-010)', () => {
  it('renderiza grip, Home, indicador de status, stealth, Iniciar Configuracao e Ocultar', () => {
    const { container, getByRole } = render(AppBar, { props: baseProps })

    expect(container.querySelector('[data-appbar]'), 'raiz da barra').not.toBeNull()
    expect(container.querySelector('[data-appbar-grip]'), 'grip de arrastar').not.toBeNull()
    expect(getByRole('button', { name: 'Home' }), 'botao Home').toBeDefined()
    expect(container.querySelector('[data-appbar-status]'), 'indicador de status').not.toBeNull()
    expect(getByRole('button', { name: /stealth/i }), 'botao stealth').toBeDefined()
    expect(getByRole('button', { name: 'Iniciar Configuracao' })).toBeDefined()
    expect(getByRole('button', { name: 'Ocultar' }), 'botao de ocultar').toBeDefined()
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

  it('comeca com stealth inativo e sem aviso', () => {
    const { container } = render(AppBar, { props: baseProps })
    expect(statusIndicator(container).textContent).toContain('Stealth inativo')
    expect(stealthNotice(container)).toBeNull()
  })
})

describe('AppBar — stealth alterna visivelmente (RF-502)', () => {
  it('clique ativa: set_stealth com excluded=true e indicador muda', async () => {
    const { container, getByRole } = render(AppBar, { props: baseProps })
    await fireEvent.click(getByRole('button', { name: /stealth/i }))

    expect(invokeMock).toHaveBeenCalledTimes(1)
    expect(invokeMock.mock.calls[0]).toEqual(['set_stealth', { windowLabel: 'main', excluded: true }])
    expect(statusIndicator(container).textContent).toContain('Stealth ativo')
  })

  it('ativar exibe aviso RF-508 (SRS §7)', async () => {
    const { container, getByRole } = render(AppBar, { props: baseProps })
    await fireEvent.click(getByRole('button', { name: /stealth/i }))

    const aviso = stealthNotice(container)
    expect(aviso).not.toBeNull()
    for (const fragment of NOTICE_FRAGMENTS) {
      expect(aviso?.textContent).toMatch(fragment)
    }
  })

  it('segundo clique desativa: set_stealth com excluded=false e aviso some', async () => {
    const { container, getByRole } = render(AppBar, { props: baseProps })
    const botao = getByRole('button', { name: /stealth/i })
    await fireEvent.click(botao)
    await fireEvent.click(botao)

    expect(invokeMock).toHaveBeenCalledTimes(2)
    expect(invokeMock.mock.calls[0]).toEqual(['set_stealth', { windowLabel: 'main', excluded: true }])
    expect(invokeMock.mock.calls[1]).toEqual(['set_stealth', { windowLabel: 'main', excluded: false }])
    expect(statusIndicator(container).textContent).toContain('Stealth inativo')
    expect(stealthNotice(container)).toBeNull()
  })

  it('monta ja ativo quando stealthExcluded=true, sem re-disparar o comando', async () => {
    const { container, getByRole } = render(AppBar, {
      props: { ...baseProps, stealthExcluded: true },
    })

    expect(statusIndicator(container).textContent).toContain('Stealth ativo')
    expect(stealthNotice(container)).not.toBeNull()
    expect(invokeMock).not.toHaveBeenCalled()

    await fireEvent.click(getByRole('button', { name: /stealth/i }))
    expect(invokeMock.mock.calls[0]).toEqual(['set_stealth', { windowLabel: 'main', excluded: false }])
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
      { windowLabel: 'outra-janela', excluded: true },
    ])
    invokeMock.mockClear()

    await fireEvent.click(getByRole('button', { name: 'Home' }))
    expect(invokeMock).toHaveBeenCalledWith('show_window', { windowLabel: 'main' })
    expect(emitMock).toHaveBeenCalledWith('ray:navigate', { surface: 'home' })
  })
})

describe('AppBar — regras gerais do repo', () => {
  it('a saida renderizada nao contem emojis, nem com aviso visivel', async () => {
    const { container, getByRole } = render(AppBar, { props: baseProps })
    expect(EMOJI_PATTERN.test(container.textContent ?? '')).toBe(false)

    await fireEvent.click(getByRole('button', { name: /stealth/i }))
    expect(EMOJI_PATTERN.test(container.textContent ?? '')).toBe(false)
  })
})
