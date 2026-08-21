import { describe, it, expect, afterEach } from 'vitest'
import { render, cleanup, fireEvent } from '@testing-library/svelte'
import Settings from './Settings.svelte'
import { setSettingsStateFeed, resetSettingsStateFeed } from './settings-feed'
import { onSettingsAction } from './settings-actions'
import type { SettingsAction } from './settings-actions'
import type { SettingsState } from './types'
import { DEFAULT_SHORTCUTS } from '../../../../../contracts/settings'

// Contrato T-406 / RF-206 — aba Áudio e Tela: medidores de áudio por canal
// com opção de ocultar. O estado vem do feed (o comando core de áudio ainda
// não existe); a mudança sai pela fronteira declarada (settings-actions).

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
})

describe('Áudio e Tela — opção de ocultar medidores (RF-206)', () => {
  it('renderiza a opção "Mostrar medidores de áudio" refletindo o feed', async () => {
    const { container } = render(Settings)
    await openTab(container, 'audioScreen')

    const toggle = container.querySelector('[data-meters-toggle]') as HTMLInputElement
    expect(toggle, 'a opção de medidores deve existir').not.toBeNull()
    expect(toggle.type).toBe('checkbox')
    expect(toggle.checked).toBe(true)
    expect(container.querySelector('[data-settings-panel="audioScreen"]')?.textContent).toContain(
      'Mostrar medidores de áudio',
    )
  })

  it('fica desmarcada quando o feed declara medidores ocultos', async () => {
    setSettingsStateFeed(() => baseState({ metersVisible: false }))
    const { container } = render(Settings)
    await openTab(container, 'audioScreen')

    const toggle = container.querySelector('[data-meters-toggle]') as HTMLInputElement
    expect(toggle.checked).toBe(false)
  })

  it('alternar despacha metersVisibilityChange pela fronteira declarada', async () => {
    const actions: SettingsAction[] = []
    const unsubscribe = onSettingsAction((action: SettingsAction) => actions.push(action))
    const { container } = render(Settings)
    await openTab(container, 'audioScreen')

    const toggle = container.querySelector('[data-meters-toggle]')
    if (!toggle) {
      throw new Error('opção de medidores não encontrada')
    }
    await fireEvent.click(toggle)

    expect(actions).toEqual([{ type: 'metersVisibilityChange', visible: false }])
    unsubscribe()
  })
})
