import { describe, it, expect, afterEach } from 'vitest'
import { render, cleanup, fireEvent } from '@testing-library/svelte'
import Settings from './Settings.svelte'
import { onSettingsAction } from './settings-actions'
import type { SettingsAction } from './settings-actions'
import {
  FEATURE_TOGGLE_NAMES,
  DEFAULT_FEATURE_TOGGLES,
} from '../../../../../contracts/settings'

// Contrato T-406 / RF-700 — aba Recursos: toggles de recursos de sessão
// DIRIGIDOS pelos tipos do contrato (contracts/settings.ts T-003): os nomes
// canônicos vêm de FEATURE_TOGGLE_NAMES e o estado inicial de
// DEFAULT_FEATURE_TOGGLES (tudo ligado — nenhum RF-700 documenta um toggle
// nascendo desligado). Os rótulos PT vêm dos comentários do contrato
// (RF-701..706). Cada toggle é uma linha [data-feature-toggle="<nome>"]
// contendo um checkbox; alternar despacha featureToggleChange pela fronteira
// declarada; a persistência real é coverageMap (nenhum comando core existe).

const FEATURE_LABELS: Record<string, string> = {
  autoScroll: 'Rolagem Automática',
  selectToPrompt: 'Selecionar para Prompt',
  sessionTimer: 'Temporizador de Sessão',
  notchExperience: 'Experiência do Notch',
  autoCompaction: 'Compactação automática',
  quickScreenshotAnalysis: 'Análise Rápida de Screenshots',
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
})

describe('Recursos — toggles dirigidos pelo contrato (RF-700 / contracts/settings.ts)', () => {
  it('renderiza exatamente os toggles de FEATURE_TOGGLE_NAMES, na ordem do contrato', async () => {
    const { container } = render(Settings)
    await openTab(container, 'features')

    const toggles = Array.from(container.querySelectorAll('[data-feature-toggle]'))
    expect(toggles.map((toggle) => toggle.getAttribute('data-feature-toggle'))).toEqual([
      ...FEATURE_TOGGLE_NAMES,
    ])
    expect(toggles.map((toggle) => toggle.textContent?.trim())).toEqual(
      FEATURE_TOGGLE_NAMES.map((name) => FEATURE_LABELS[name]),
    )
  })

  it('o estado inicial de cada toggle vem de DEFAULT_FEATURE_TOGGLES', async () => {
    const { container } = render(Settings)
    await openTab(container, 'features')

    for (const name of FEATURE_TOGGLE_NAMES) {
      const row = container.querySelector(`[data-feature-toggle="${name}"]`)
      const checkbox = row?.querySelector('input[type="checkbox"]') as HTMLInputElement
      expect(checkbox, `checkbox do toggle ${name}`).not.toBeNull()
      expect(checkbox.checked, `toggle de ${name} nasce conforme o contrato`).toBe(
        DEFAULT_FEATURE_TOGGLES[name],
      )
    }
  })

  it('alternar um toggle despacha featureToggleChange com o novo valor', async () => {
    const actions: SettingsAction[] = []
    const unsubscribe = onSettingsAction((action: SettingsAction) => actions.push(action))
    const { container } = render(Settings)
    await openTab(container, 'features')

    const checkbox = container.querySelector(
      '[data-feature-toggle="autoScroll"] input[type="checkbox"]',
    )
    if (!checkbox) {
      throw new Error('checkbox do toggle autoScroll não encontrado')
    }
    await fireEvent.click(checkbox)

    expect(actions).toEqual([{ type: 'featureToggleChange', name: 'autoScroll', enabled: false }])
    unsubscribe()
  })
})
