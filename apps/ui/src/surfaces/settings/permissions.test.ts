import { describe, it, expect, afterEach } from 'vitest'
import { render, cleanup, fireEvent } from '@testing-library/svelte'
import Settings from './Settings.svelte'
import { setSettingsStateFeed, resetSettingsStateFeed } from './settings-feed'
import type { SettingsState } from './types'
import { DEFAULT_SHORTCUTS } from '../../../../../contracts/settings'

// Contrato T-406 / RF-103, RF-104, RF-335 — aba Permissões: o mesmo
// mapeamento permissão→função do onboarding (T-405), relido do feed desta
// superfície:
//   Microfone          → captura de voz (canal VOCÊ)
//   Captura de Tela    → Capturar Tela + contexto visual
//   Acessibilidade     → Analisar Seleção (RF-335)
//   Reconhecimento de Fala → STT on-device (macOS) / Whisper embutido
//                            (Windows/Linux, sem permissão de sistema)
// RF-104: estado por permissão, CTA "Conceder permissões ausentes" quando
// algo falta e orientação de reinício do app.

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

describe('Permissões — mapeamento permissão→função (RF-103 / RF-335)', () => {
  it('renderiza o mapeamento de cada permissão', async () => {
    const { container } = render(Settings)
    await openTab(container, 'permissions')

    const microphone = container.querySelector('[data-permission-row="microphone"]')
    expect(microphone?.textContent).toContain('Microfone')
    expect(microphone?.textContent).toContain('canal VOCÊ')

    const screen = container.querySelector('[data-permission-row="screenRecording"]')
    expect(screen?.textContent).toContain('Captura de Tela')
    expect(screen?.textContent).toContain('Capturar Tela')
    expect(screen?.textContent).toContain('contexto visual')

    // RF-335: Analisar Seleção depende da permissão de Acessibilidade
    const accessibility = container.querySelector('[data-permission-row="accessibility"]')
    expect(accessibility?.textContent).toContain('Analisar Seleção')
  })

  it('no macOS, Reconhecimento de Fala é STT on-device', async () => {
    const { container } = render(Settings)
    await openTab(container, 'permissions')

    const speech = container.querySelector('[data-permission-row="speechRecognition"]')
    expect(speech?.textContent).toContain('STT on-device')
    expect(speech?.textContent).not.toContain('Whisper embutido')
  })

  it('no Windows, STT é Whisper embutido e não exige permissão de sistema', async () => {
    setSettingsStateFeed(() =>
      baseState({
        platform: 'windows',
        permissions: {
          ...baseState().permissions,
          speechRecognition: 'notRequired',
        },
      }),
    )
    const { container } = render(Settings)
    await openTab(container, 'permissions')

    const speech = container.querySelector('[data-permission-row="speechRecognition"]')
    expect(speech?.textContent).toContain('Whisper embutido')
    expect(speech?.textContent).not.toContain('STT on-device')
    expect(speech?.getAttribute('data-permission-state')).toBe('notRequired')
  })
})

describe('Permissões — concessão e reinício (RF-104)', () => {
  it('exibe o estado de cada permissão conforme o feed', async () => {
    setSettingsStateFeed(() =>
      baseState({
        permissions: {
          microphone: 'granted',
          screenRecording: 'notGranted',
          accessibility: 'granted',
          speechRecognition: 'notGranted',
        },
      }),
    )
    const { container } = render(Settings)
    await openTab(container, 'permissions')

    for (const [id, state] of [
      ['microphone', 'granted'],
      ['screenRecording', 'notGranted'],
      ['accessibility', 'granted'],
      ['speechRecognition', 'notGranted'],
    ] as const) {
      const row = container.querySelector(`[data-permission-row="${id}"]`)
      expect(row?.getAttribute('data-permission-state'), `estado da permissão ${id}`).toBe(state)
    }
  })

  it('oferece "Conceder permissões ausentes" e orienta reinício só quando algo falta', async () => {
    setSettingsStateFeed(() =>
      baseState({
        permissions: { ...baseState().permissions, accessibility: 'notGranted' },
      }),
    )
    const first = render(Settings)
    await openTab(first.container, 'permissions')

    expect(first.getByRole('button', { name: 'Conceder permissões ausentes' })).toBeDefined()
    const guidance = first.container.querySelector('[data-settings-restart-guidance]')
    expect(guidance, 'a orientação de reinício deve existir').not.toBeNull()
    expect(guidance?.textContent).toMatch(/reinici/i)

    cleanup()
    setSettingsStateFeed(() => baseState())
    const second = render(Settings)
    await openTab(second.container, 'permissions')

    expect(second.queryByRole('button', { name: 'Conceder permissões ausentes' })).toBeNull()
    expect(second.container.querySelector('[data-settings-restart-guidance]')).toBeNull()
  })
})
