import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, cleanup, fireEvent } from '@testing-library/svelte'
import Settings from './Settings.svelte'
import { resetSettingsStateFeed } from './settings-feed'

// Contrato T-406: Settings.svelte é a raiz da superfície Configurações, sem
// props (evita o problema ComponentProps<SvelteComponent> → never do T-402 —
// ver decisions.md). Contrato de DOM por data-attrs: 7 abas na ordem do
// backlog T-406, exatamente UM painel ativo por vez.
//
// As 7 abas (SRS seções 3–4): Fontes de IA (RF-401/402/403/406), Modelos
// (RF-301/302/303/404), Áudio e Tela (RF-206), Permissões (RF-103/104/335),
// Recursos (RF-700), Atalhos (RF-601/602/604), Ajuda (RF-1001..1004).

vi.mock('@tauri-apps/api/event', () => ({
  emit: vi.fn().mockResolvedValue(undefined),
  listen: vi.fn().mockResolvedValue(() => {}),
}))
vi.mock('@tauri-apps/api/app', () => ({ getVersion: vi.fn().mockResolvedValue('1.2.3') }))

const TAB_TITLES: Array<[string, string]> = [
  ['aiSources', 'Fontes de IA'],
  ['models', 'Modelos'],
  ['audioScreen', 'Áudio e Tela'],
  ['permissions', 'Permissões'],
  ['features', 'Recursos'],
  ['shortcuts', 'Atalhos'],
  ['help', 'Ajuda'],
]

function activePanel(container: HTMLElement): string | undefined {
  return container.querySelector('[data-settings-panel]')?.getAttribute('data-settings-panel') ?? undefined
}

async function openTab(container: HTMLElement, tab: string): Promise<void> {
  const button = container.querySelector(`[data-settings-tab="${tab}"]`)
  if (!button) {
    throw new Error(`aba ${tab} não encontrada`)
  }
  await fireEvent.click(button)
}

afterEach(() => {
  cleanup()
  resetSettingsStateFeed()
  window.localStorage.removeItem?.('ray_models')
  window.localStorage.removeItem?.('ray_audio_meters')
})

describe('Settings — estrutura de abas (backlog T-406)', () => {
  it('renderiza as 7 abas na ordem do contrato', () => {
    const { container } = render(Settings)

    const tabs = Array.from(container.querySelectorAll('[data-settings-tab]'))
    expect(tabs.map((tab) => [tab.getAttribute('data-settings-tab'), tab.textContent?.trim()])).toEqual(
      TAB_TITLES,
    )
  })

  it('cada aba é um botão acessível com o título como nome', () => {
    const { getByRole } = render(Settings)

    for (const [, title] of TAB_TITLES) {
      expect(getByRole('button', { name: title }), `aba ${title}`).toBeDefined()
    }
  })

  it('abre na aba Fontes de IA com exatamente um painel ativo', () => {
    const { container } = render(Settings)

    expect(activePanel(container)).toBe('aiSources')
    expect(container.querySelectorAll('[data-settings-panel]')).toHaveLength(1)
  })

  it('clicar em uma aba troca o painel ativo (uma de cada vez)', async () => {
    const { container } = render(Settings)

    for (const [tab] of TAB_TITLES.slice(1)) {
      await openTab(container, tab)
      expect(activePanel(container), `painel ativo após clicar em ${tab}`).toBe(tab)
      expect(container.querySelectorAll('[data-settings-panel]')).toHaveLength(1)
    }
  })

  it('renderiza com o feed padrão (placeholder restritivo) sem quebrar', async () => {
    const { container } = render(Settings)

    // Fontes de IA: todos os cards presentes, todos "Não configurado"
    expect(container.querySelectorAll('[data-provider-card]')).toHaveLength(7)
    const statuses = Array.from(container.querySelectorAll('[data-provider-status]'))
    expect(statuses.length).toBe(7)
    for (const status of statuses) {
      expect(status.textContent?.trim(), 'status restritivo padrão').toBe('Não configurado')
    }
  })
})
