import { describe, it, expect, afterEach } from 'vitest'
import { render, cleanup, fireEvent } from '@testing-library/svelte'
import Settings from './Settings.svelte'
import { setSettingsStateFeed, resetSettingsStateFeed } from './settings-feed'
import { onSettingsAction } from './settings-actions'
import type { SettingsAction } from './settings-actions'
import type { SettingsState } from './types'
import { DEFAULT_SHORTCUTS } from '../../../../../contracts/settings'

// Contrato T-406 / RF-301, RF-302, RF-303, RF-404 — aba Modelos: cada função
// (Transcrição/Análise/Tradução) tem seleção de provedor/modelo independente,
// com estado vazio explícito quando nada está configurado (SRS 4.3). A
// Tradução NÃO é premium: segue o mesmo padrão das demais, sem paywall
// (RF-303). A Transcrição tem a camada Local on-device (RF-301): Apple Speech
// no macOS, Whisper embutido no Windows/Linux. O provider ativo por função
// (RF-404) vem do feed; a TROCA sai pela fronteira declarada (settings-actions)
// — a persistência real é coverageMap (nenhum comando core existe).

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

describe('Modelos — seletor por função (RF-301/302/303/404)', () => {
  it('renderiza os três seletores: Transcrição, Análise e Tradução', async () => {
    const { container } = render(Settings)
    await openTab(container, 'models')

    const transcription = container.querySelector('[data-function-selector="TRANSCRIPTION"]')
    const analysis = container.querySelector('[data-function-selector="ANALYSIS"]')
    const translation = container.querySelector('[data-function-selector="TRANSLATION"]')

    expect(transcription?.textContent).toContain('Transcrição')
    expect(analysis?.textContent).toContain('Análise')
    expect(translation?.textContent).toContain('Tradução')
  })

  it('estado vazio explícito em cada função quando nada está configurado (SRS 4.3)', async () => {
    const { container } = render(Settings)
    await openTab(container, 'models')

    for (const fn of ['TRANSCRIPTION', 'ANALYSIS', 'TRANSLATION'] as const) {
      const selector = container.querySelector(`[data-function-selector="${fn}"]`)
      const empty = selector?.querySelector('[data-function-empty]')
      expect(empty, `estado vazio de ${fn}`).not.toBeNull()
      expect(empty?.textContent).toContain('Nenhum provedor configurado')

      const select = selector?.querySelector('[data-function-provider-select]')
      expect(select?.textContent, `placeholder de ${fn}`).toContain('Selecionar provedor')
    }
  })

  it('função configurada exibe provider e modelo do feed, sem estado vazio', async () => {
    setSettingsStateFeed(() =>
      baseState({
        providerStatus: {
          ...baseState().providerStatus,
          openai: 'connected',
        },
        functionConfig: {
          TRANSCRIPTION: { kind: 'OPENAI', model: 'whisper-1' },
          ANALYSIS: null,
          TRANSLATION: null,
        },
      }),
    )
    const { container } = render(Settings)
    await openTab(container, 'models')

    const selector = container.querySelector('[data-function-selector="TRANSCRIPTION"]')
    expect(selector?.querySelector('[data-function-empty]')).toBeNull()
    expect(selector?.textContent).toContain('OpenAI')

    const select = selector?.querySelector(
      '[data-function-provider-select]',
    ) as HTMLSelectElement
    expect(select?.value).toBe('OPENAI')

    const modelInput = selector?.querySelector(
      '[data-function-model-input]',
    ) as HTMLInputElement
    expect(modelInput?.value).toBe('whisper-1')
  })

  it('Transcrição oferece a camada Local on-device por plataforma (RF-301)', async () => {
    setSettingsStateFeed(() => baseState())
    const macos = render(Settings)
    await openTab(macos.container, 'models')
    const macosSelector = macos.container.querySelector('[data-function-selector="TRANSCRIPTION"]')
    expect(macosSelector?.textContent).toContain('Local on-device')
    expect(macosSelector?.textContent).toContain('Apple Speech')
    expect(macosSelector?.textContent).not.toContain('Whisper embutido')

    cleanup()
    setSettingsStateFeed(() => baseState({ platform: 'windows' }))
    const windows = render(Settings)
    await openTab(windows.container, 'models')
    const windowsSelector = windows.container.querySelector(
      '[data-function-selector="TRANSCRIPTION"]',
    )
    expect(windowsSelector?.textContent).toContain('Local on-device')
    expect(windowsSelector?.textContent).toContain('Whisper embutido')
    expect(windowsSelector?.textContent).not.toContain('Apple Speech')
  })

  it('Tradução não é premium: sem paywall, mesmo padrão das demais (RF-303)', async () => {
    setSettingsStateFeed(() => baseState())
    const { container } = render(Settings)
    await openTab(container, 'models')

    const translation = container.querySelector('[data-function-selector="TRANSLATION"]')
    expect(translation?.textContent, 'nenhuma menção a premium').not.toMatch(/premium/i)
    expect(translation?.querySelector('[data-function-empty]')?.textContent).toContain(
      'Nenhum provedor configurado',
    )
  })

  it('trocar o provider de uma função despacha functionProviderChange (RF-404)', async () => {
    setSettingsStateFeed(() =>
      baseState({
        providerStatus: {
          ...baseState().providerStatus,
          deepseek: 'connected',
          gemini: 'connected',
          generic: 'disconnected',
        },
        functionConfig: {
          TRANSCRIPTION: null,
          ANALYSIS: { kind: 'GEMINI', model: 'gemini-2.0-flash' },
          TRANSLATION: null,
        },
      }),
    )
    const actions: SettingsAction[] = []
    const unsubscribe = onSettingsAction((action: SettingsAction) => actions.push(action))
    const { container } = render(Settings)
    await openTab(container, 'models')

    const selector = container.querySelector('[data-function-selector="ANALYSIS"]')
    const select = selector?.querySelector('[data-function-provider-select]')
    if (!select) {
      throw new Error('seletor de provider da Análise não encontrado')
    }

    // Opções = provedores configurados no feed; OpenAI (não configurado) fica de fora
    expect(select.textContent).toContain('DeepSeek')
    expect(select.textContent).toContain('Google Gemini')
    expect(select.textContent).toContain('Endpoint compatível com OpenAI')
    expect(select.querySelector('option[value="OPENAI"]')).toBeNull()

    await fireEvent.change(select, { target: { value: 'DEEPSEEK' } })

    expect(actions).toEqual([
      {
        type: 'functionProviderChange',
        function: 'ANALYSIS',
        kind: 'DEEPSEEK',
        model: 'gemini-2.0-flash',
      },
    ])
    unsubscribe()
  })
})
