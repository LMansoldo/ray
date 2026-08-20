import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, cleanup, fireEvent } from '@testing-library/svelte'
import AppBar from './AppBar.svelte'
import { onAppBarNavigate, type AppBarDestination } from './navigation'
import type { AppBarProps } from './types'

// Contrato T-401 / RF-010: barra flutuante compacta com grip para arrastar,
// botão Home, indicador de status, botão stealth e "Iniciar Configuração"
// (onboarding). RF-502: ativação rápida do stealth pela app bar com
// sinalização clara do estado. RF-504: ocultar a janela ("panic hide") via
// toggle_window — o mesmo comando do menu da bandeja (RF-010: "Alternável
// por atalho, com o mesmo comportamento do menu da bandeja"). RF-508: aviso
// de uso responsável e conformidade legal ao ativar o stealth (SRS §7).
//
// O seam do invoke(): '@tauri-apps/api/core' é mockado com vi.hoisted +
// vi.mock(factory) — o factory intercepta antes da resolução (padrão
// T-402/T-406). Nenhum comando novo é inventado: set_stealth e toggle_window
// são exatamente os comandos que core/src/lib.rs registra (a assinatura
// invoke('set_stealth', { windowLabel, excluded }) espelha o `fn
// set_stealth(window_label: String, excluded: bool)` do core).
//
// O estado inicial do stealth entra por prop (stealthExcluded): NÃO existe
// comando de leitura de estado no core — o clique alterna otimista e quem
// monta a barra (App shell) informa o estado ao montar. O canal de navegação
// (navigation.ts) segue o padrão pub/sub local de home/navigation.ts (T-402)
// e onboarding/restart.ts (T-405): a barra só emite o destino; quem monta as
// janelas decide o roteamento.

const { invokeMock } = vi.hoisted(() => ({
  invokeMock: vi
    .fn<(command: string, args?: unknown) => Promise<unknown>>()
    .mockResolvedValue(undefined),
}))

vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }))

// Props tipadas contra a fonte única de tipos da superfície (types.ts), não
// via ComponentProps<AppBar>: sob o svelte-check, a importação de um .svelte
// por um .ts resolve para o shape legado { $on?; $set? } e ComponentProps
// degrada para never (ver decisions.md T-402).
type Props = AppBarProps

// Sem props: windowLabel cai no padrão 'main' (label da única janela,
// tauri.conf.json) e stealthExcluded em false.
const baseProps: Props = {}

// Fragmentos do aviso RF-508 (SRS §7): uso responsável e conformidade legal.
// O texto completo é liberdade do GREEN; os fragmentos são o contrato.
const NOTICE_FRAGMENTS: RegExp[] = [
  /conformidade/i, // RF-508: conformidade legal ao ativar o stealth
  /consentimento/i, // SRS 7.1: recomendar a obtenção do consentimento necessário
  /responsável/i, // SRS 7.2: alertar sobre uso responsável
  /responsabilidade do usuário/i, // SRS 7.3: conformidade é responsabilidade do usuário
]

// Regra do repo: sem emojis na UI.
const EMOJI_PATTERN = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/u

let unsubscribeNavigation: (() => void) | undefined

afterEach(() => {
  unsubscribeNavigation?.()
  unsubscribeNavigation = undefined
  invokeMock.mockClear()
  cleanup()
})

function subscribeNavigation(): AppBarDestination[] {
  const destinations: AppBarDestination[] = []
  // Anotação explícita: no RED o módulo ausente tira a inferência contextual
  // e gera implicit-any (precedente T-406); no GREEN a anotação permanece.
  unsubscribeNavigation = onAppBarNavigate((destination: AppBarDestination) =>
    destinations.push(destination),
  )
  return destinations
}

function statusIndicator(container: HTMLElement): Element {
  const indicator = container.querySelector('[data-appbar-status]')
  expect(indicator, 'o indicador de status deve existir').not.toBeNull()
  return indicator as Element
}

function stealthNotice(container: HTMLElement): Element | null {
  return container.querySelector('[data-stealth-notice]')
}

describe('AppBar — elementos da barra flutuante (RF-010)', () => {
  it('renderiza grip, Home, indicador de status, stealth, Iniciar Configuração e Ocultar', () => {
    const { container, getByRole } = render(AppBar, { props: baseProps })

    expect(container.querySelector('[data-appbar]'), 'raiz da barra').not.toBeNull()
    expect(container.querySelector('[data-appbar-grip]'), 'grip de arrastar').not.toBeNull()
    expect(getByRole('button', { name: 'Home' }), 'botão Home').toBeDefined()
    expect(container.querySelector('[data-appbar-status]'), 'indicador de status').not.toBeNull()
    expect(getByRole('button', { name: /stealth/i }), 'botão stealth').toBeDefined()
    expect(getByRole('button', { name: 'Iniciar Configuração' })).toBeDefined()
    expect(getByRole('button', { name: 'Ocultar' }), 'botão de ocultar (panic hide)').toBeDefined()
  })

  it('o grip é região de arraste nativa da janela (data-tauri-drag-region)', () => {
    const { container } = render(AppBar, { props: baseProps })
    const grip = container.querySelector('[data-appbar-grip]')
    expect(grip, 'o grip deve existir').not.toBeNull()
    // Tauri 2: o atributo declarativo torna o elemento alça de arraste da
    // janela — o único mecanismo disponível (o core não registra comando de
    // drag; frontend.md proíbe a UI de inventar um).
    expect(
      grip?.hasAttribute('data-tauri-drag-region'),
      'o grip deve carregar data-tauri-drag-region',
    ).toBe(true)
  })

  it('começa com o stealth inativo e sem aviso', () => {
    const { container } = render(AppBar, { props: baseProps })
    expect(statusIndicator(container).textContent).toContain('Stealth inativo')
    expect(stealthNotice(container), 'sem aviso antes de ativar').toBeNull()
  })
})

describe('AppBar — stealth alterna visivelmente (RF-502)', () => {
  it('o clique ativa: set_stealth com excluded=true e o indicador muda', async () => {
    const { container, getByRole } = render(AppBar, { props: baseProps })
    await fireEvent.click(getByRole('button', { name: /stealth/i }))

    expect(invokeMock).toHaveBeenCalledTimes(1)
    const call = invokeMock.mock.calls[0]
    expect(call?.[0]).toBe('set_stealth')
    expect(call?.[1]).toEqual({ windowLabel: 'main', excluded: true })
    expect(statusIndicator(container).textContent).toContain('Stealth ativo')
  })

  it('ativar exibe o aviso de uso responsável e conformidade legal (RF-508, SRS §7)', async () => {
    const { container, getByRole } = render(AppBar, { props: baseProps })
    await fireEvent.click(getByRole('button', { name: /stealth/i }))

    const aviso = stealthNotice(container)
    expect(aviso, 'o aviso RF-508 deve aparecer ao ativar o stealth').not.toBeNull()
    for (const fragment of NOTICE_FRAGMENTS) {
      expect(aviso?.textContent, `o aviso deve mencionar "${String(fragment)}"`).toMatch(fragment)
    }
  })

  it('o segundo clique desativa: set_stealth com excluded=false e o aviso some', async () => {
    const { container, getByRole } = render(AppBar, { props: baseProps })
    const botao = getByRole('button', { name: /stealth/i })
    await fireEvent.click(botao)
    await fireEvent.click(botao)

    expect(invokeMock).toHaveBeenCalledTimes(2)
    expect(invokeMock.mock.calls[0]).toEqual(['set_stealth', { windowLabel: 'main', excluded: true }])
    expect(invokeMock.mock.calls[1]).toEqual(['set_stealth', { windowLabel: 'main', excluded: false }])
    expect(statusIndicator(container).textContent).toContain('Stealth inativo')
    expect(stealthNotice(container), 'o aviso some ao desativar').toBeNull()
  })

  it('monta já ativo quando stealthExcluded=true, sem re-disparar o comando', async () => {
    const { container, getByRole } = render(AppBar, {
      props: { ...baseProps, stealthExcluded: true },
    })

    expect(statusIndicator(container).textContent).toContain('Stealth ativo')
    expect(stealthNotice(container), 'aviso presente quando monta ativo').not.toBeNull()
    expect(invokeMock, 'montar não pode re-aplicar o stealth sozinho').not.toHaveBeenCalled()

    await fireEvent.click(getByRole('button', { name: /stealth/i }))
    expect(invokeMock).toHaveBeenCalledTimes(1)
    expect(invokeMock.mock.calls[0]).toEqual(['set_stealth', { windowLabel: 'main', excluded: false }])
    expect(statusIndicator(container).textContent).toContain('Stealth inativo')
  })
})

describe('AppBar — windowLabel segue o label da janela', () => {
  it('usa "main" por padrão (label da janela em tauri.conf.json)', async () => {
    const { getByRole } = render(AppBar, { props: baseProps })
    await fireEvent.click(getByRole('button', { name: 'Ocultar' }))

    expect(invokeMock).toHaveBeenCalledTimes(1)
    expect(invokeMock.mock.calls[0]).toEqual(['toggle_window', { windowLabel: 'main' }])
  })

  it('propaga windowLabel próprio aos dois comandos', async () => {
    const { getByRole } = render(AppBar, { props: { windowLabel: 'janela-secundaria' } })
    await fireEvent.click(getByRole('button', { name: /stealth/i }))
    await fireEvent.click(getByRole('button', { name: 'Ocultar' }))

    expect(invokeMock).toHaveBeenCalledTimes(2)
    expect(invokeMock.mock.calls[0]).toEqual([
      'set_stealth',
      { windowLabel: 'janela-secundaria', excluded: true },
    ])
    expect(invokeMock.mock.calls[1]).toEqual([
      'toggle_window',
      { windowLabel: 'janela-secundaria' },
    ])
  })
})

describe('AppBar — navegação e ocultação (RF-010 / RF-504)', () => {
  it('o botão Home abre a superfície Home (T-402)', async () => {
    const destinations = subscribeNavigation()
    const { getByRole } = render(AppBar, { props: baseProps })
    await fireEvent.click(getByRole('button', { name: 'Home' }))

    expect(destinations).toEqual(['home'])
    expect(invokeMock, 'abrir a Home não é comando do core').not.toHaveBeenCalled()
  })

  it('Iniciar Configuração abre o onboarding (T-405)', async () => {
    const destinations = subscribeNavigation()
    const { getByRole } = render(AppBar, { props: baseProps })
    await fireEvent.click(getByRole('button', { name: 'Iniciar Configuração' }))

    expect(destinations).toEqual(['onboarding'])
    expect(invokeMock, 'abrir o onboarding não é comando do core').not.toHaveBeenCalled()
  })

  it('Ocultar chama toggle_window (panic hide, RF-504), sem navegar', async () => {
    const destinations = subscribeNavigation()
    const { getByRole } = render(AppBar, { props: baseProps })
    await fireEvent.click(getByRole('button', { name: 'Ocultar' }))

    expect(invokeMock).toHaveBeenCalledTimes(1)
    expect(invokeMock.mock.calls[0]).toEqual(['toggle_window', { windowLabel: 'main' }])
    expect(destinations, 'ocultar a janela não navega').toEqual([])
  })
})

describe('AppBar — regras gerais do repo', () => {
  it('a saída renderizada não contém emojis, nem com o aviso visível', async () => {
    const { container, getByRole } = render(AppBar, { props: baseProps })
    expect(EMOJI_PATTERN.test(container.textContent ?? '')).toBe(false)

    await fireEvent.click(getByRole('button', { name: /stealth/i }))
    expect(EMOJI_PATTERN.test(container.textContent ?? '')).toBe(false)
  })
})
