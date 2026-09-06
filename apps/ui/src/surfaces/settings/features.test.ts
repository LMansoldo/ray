import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, cleanup, fireEvent, waitFor } from '@testing-library/svelte'
import Settings from './Settings.svelte'
import { setSettingsStateFeed, resetSettingsStateFeed } from './settings-feed'
import { onSettingsAction } from './settings-actions'
import type { SettingsAction } from './settings-actions'
import type { SettingsState } from './types'
import {
  FEATURE_TOGGLE_NAMES,
  DEFAULT_FEATURE_TOGGLES,
  DEFAULT_SHORTCUTS,
} from '../../../../../contracts/settings'

// Contrato T-406 / RF-700 — aba Recursos: toggles de recursos de sessão
// DIRIGIDOS pelos tipos do contrato (contracts/settings.ts T-003): os nomes
// canônicos vêm de FEATURE_TOGGLE_NAMES e o estado inicial de
// DEFAULT_FEATURE_TOGGLES (tudo ligado — nenhum RF-700 documenta um toggle
// nascendo desligado), hidratável do feed (get_app_settings). Cada toggle é
// uma linha [data-feature-toggle="<nome>"] contendo um checkbox; alternar
// despacha featureToggleChange pela fronteira declarada, persiste no core
// via invoke('save_feature_toggles') e emite 'ray:features-changed' com o
// mapa completo.

const { invokeMock, emitMock } = vi.hoisted(() => ({
  invokeMock: vi.fn<(command: string, args?: unknown) => Promise<unknown>>().mockResolvedValue(undefined),
  emitMock: vi.fn<(event: string, payload?: unknown) => Promise<void>>().mockResolvedValue(undefined),
}))

vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }))
vi.mock('@tauri-apps/api/event', () => ({
  emit: emitMock,
  listen: vi.fn().mockResolvedValue(() => {}),
}))
vi.mock('@tauri-apps/api/app', () => ({ getVersion: vi.fn().mockResolvedValue('1.2.3') }))

const FEATURE_LABELS: Record<string, string> = {
  autoScroll: 'Rolagem Automática',
  selectToPrompt: 'Selecionar para Prompt',
  sessionTimer: 'Temporizador de Sessão',
  notchExperience: 'Experiência do Notch',
  autoCompaction: 'Compactação automática',
  quickScreenshotAnalysis: 'Análise Rápida de Screenshots',
}

function baseState(overrides: Partial<SettingsState> = {}): SettingsState {
  return {
    platform: 'macos',
    providerStatus: {
      deepseek: 'notConfigured',
      anthropic: 'notConfigured',
      gemini: 'notConfigured',
      openai: 'notConfigured',
      chatgpt: 'notConfigured',
      openrouter: 'notConfigured',
      generic: 'notConfigured',
    },
    functionConfig: { TRANSCRIPTION: null, ANALYSIS: null, TRANSLATION: null },
    metersVisible: true,
    permissions: {
      microphone: 'granted',
      screenRecording: 'granted',
      accessibility: 'granted',
      speechRecognition: 'granted',
    },
    appVersion: '0.0.0',
    shortcuts: DEFAULT_SHORTCUTS,
    features: { ...DEFAULT_FEATURE_TOGGLES },
    ...overrides,
  }
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
  invokeMock.mockReset().mockResolvedValue(undefined)
  emitMock.mockClear()
  window.localStorage.removeItem?.('ray_models')
  window.localStorage.removeItem?.('ray_audio_meters')
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

  it('o estado hidratado do feed (get_app_settings) reflete nos checkboxes', async () => {
    setSettingsStateFeed(() =>
      baseState({ features: { ...DEFAULT_FEATURE_TOGGLES, autoScroll: false } }),
    )
    const { container } = render(Settings)
    await openTab(container, 'features')

    await waitFor(() => {
      const checkbox = container.querySelector(
        '[data-feature-toggle="autoScroll"] input[type="checkbox"]',
      ) as HTMLInputElement
      expect(checkbox.checked).toBe(false)
    })
  })
})

describe('Recursos — persistência e evento (save_feature_toggles / ray:features-changed)', () => {
  it('alternar persiste o mapa completo via invoke(save_feature_toggles)', async () => {
    const { container } = render(Settings)
    await openTab(container, 'features')

    const checkbox = container.querySelector(
      '[data-feature-toggle="autoScroll"] input[type="checkbox"]',
    )
    if (!checkbox) {
      throw new Error('checkbox do toggle autoScroll não encontrado')
    }
    await fireEvent.click(checkbox)

    expect(invokeMock).toHaveBeenCalledWith('save_feature_toggles', {
      features: { ...DEFAULT_FEATURE_TOGGLES, autoScroll: false },
    })
  })

  it('alternar emite ray:features-changed com o mapa corrente', async () => {
    const { container } = render(Settings)
    await openTab(container, 'features')

    const checkbox = container.querySelector(
      '[data-feature-toggle="sessionTimer"] input[type="checkbox"]',
    )
    if (!checkbox) {
      throw new Error('checkbox do toggle sessionTimer não encontrado')
    }
    await fireEvent.click(checkbox)

    expect(emitMock).toHaveBeenCalledWith('ray:features-changed', {
      ...DEFAULT_FEATURE_TOGGLES,
      sessionTimer: false,
    })
  })
})
