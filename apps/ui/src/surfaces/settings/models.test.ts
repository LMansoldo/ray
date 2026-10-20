import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, cleanup, fireEvent } from '@testing-library/svelte'
import { tick } from 'svelte'
import Settings from './Settings.svelte'
import { setSettingsStateFeed, resetSettingsStateFeed } from './settings-feed'
import { onSettingsAction } from './settings-actions'
import type { SettingsAction } from './settings-actions'
import type { SettingsState } from './types'
import {
  DEFAULT_FEATURE_TOGGLES,
  DEFAULT_SHORTCUTS,
  DEFAULT_STT_LANGUAGE,
} from '../../../../../contracts/settings'

// Contrato T-406 / RF-301, RF-302, RF-303, RF-404 — aba Modelos: cada função
// (Transcrição/Análise/Tradução) tem seleção de provedor/modelo independente,
// com estado vazio explícito quando nada está configurado (SRS 4.3). A
// Tradução NÃO é premium: segue o mesmo padrão das demais, sem paywall
// (RF-303). A Transcrição tem a camada Local on-device (RF-301): Apple Speech
// no macOS, Whisper embutido no Windows/Linux. O provider ativo por função
// (RF-404) vem do feed; a TROCA sai pela fronteira declarada (settings-actions)
// E persiste localmente em 'ray_models' (JSON por função; null quando a
// função está sem provedor), emitindo 'ray:models-changed' para o app.

const { emitMock, invokeMock } = vi.hoisted(() => ({
  emitMock: vi.fn<(event: string, payload?: unknown) => Promise<void>>().mockResolvedValue(undefined),
  invokeMock: vi
    .fn<(command: string, args?: unknown) => Promise<unknown>>()
    .mockResolvedValue(undefined),
}))

vi.mock('@tauri-apps/api/event', () => ({
  emit: emitMock,
  listen: vi.fn().mockResolvedValue(() => {}),
}))
vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }))
vi.mock('@tauri-apps/api/app', () => ({ getVersion: vi.fn().mockResolvedValue('1.2.3') }))

// Node 25 expõe um localStorage global experimental SEM métodos, que sombreia
// o do jsdom (window === globalThis no vitest). Instalamos um Storage em
// memória para exercitar a persistência real das preferências de modelos.
function installMemoryStorage(): void {
  const store = new Map<string, string>()
  const storage: Storage = {
    get length() {
      return store.size
    },
    clear: () => store.clear(),
    getItem: (key) => (store.has(key) ? (store.get(key) as string) : null),
    key: (index) => Array.from(store.keys())[index] ?? null,
    removeItem: (key) => void store.delete(key),
    setItem: (key, value) => void store.set(key, value),
  }
  Object.defineProperty(window, 'localStorage', { value: storage, configurable: true })
}
installMemoryStorage()

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
    sttLanguage: DEFAULT_STT_LANGUAGE,
    overlayTemplateEnabled: false,
    overlayTemplate: '',
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
  emitMock.mockClear()
  invokeMock.mockClear()
  window.localStorage.removeItem('ray_models')
  window.localStorage.removeItem('ray_audio_meters')
  window.localStorage.removeItem('ray_custom_models')
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

describe('Modelos — persistência local e evento (ray:models-changed)', () => {
  it('trocar o provedor persiste em ray_models e emite o mapa por função', async () => {
    setSettingsStateFeed(() =>
      baseState({
        providerStatus: {
          ...baseState().providerStatus,
          deepseek: 'connected',
        },
        functionConfig: {
          TRANSCRIPTION: null,
          ANALYSIS: { kind: 'OPENAI', model: 'gpt-4o' },
          TRANSLATION: null,
        },
      }),
    )
    const { container } = render(Settings)
    await openTab(container, 'models')

    const selector = container.querySelector('[data-function-selector="ANALYSIS"]')
    const select = selector?.querySelector('[data-function-provider-select]')
    if (!select) {
      throw new Error('seletor de provider da Análise não encontrado')
    }
    await fireEvent.change(select, { target: { value: 'DEEPSEEK' } })

    const expected = {
      TRANSCRIPTION: null,
      ANALYSIS: { kind: 'DEEPSEEK', model: 'gpt-4o' },
      TRANSLATION: null,
    }
    expect(JSON.parse(window.localStorage.getItem('ray_models') ?? 'null')).toEqual(expected)
    expect(emitMock).toHaveBeenCalledWith('ray:models-changed', expected)
  })

  it('editar o modelo persiste na mesma chave (sem precisar trocar provedor)', async () => {
    setSettingsStateFeed(() =>
      baseState({
        providerStatus: {
          ...baseState().providerStatus,
          deepseek: 'connected',
        },
        functionConfig: {
          TRANSCRIPTION: null,
          ANALYSIS: { kind: 'DEEPSEEK', model: 'deepseek-chat' },
          TRANSLATION: null,
        },
      }),
    )
    const { container } = render(Settings)
    await openTab(container, 'models')

    const selector = container.querySelector('[data-function-selector="ANALYSIS"]')
    const input = selector?.querySelector('[data-function-model-input]')
    if (!input) {
      throw new Error('campo de modelo da Análise não encontrado')
    }
    await fireEvent.input(input, { target: { value: 'deepseek-reasoner' } })

    const expected = {
      TRANSCRIPTION: null,
      ANALYSIS: { kind: 'DEEPSEEK', model: 'deepseek-reasoner' },
      TRANSLATION: null,
    }
    expect(JSON.parse(window.localStorage.getItem('ray_models') ?? 'null')).toEqual(expected)
    expect(emitMock).toHaveBeenCalledWith('ray:models-changed', expected)
  })

  it('seleção vazia persiste null para a função', async () => {
    setSettingsStateFeed(() =>
      baseState({
        providerStatus: {
          ...baseState().providerStatus,
          deepseek: 'connected',
        },
      }),
    )
    const { container } = render(Settings)
    await openTab(container, 'models')

    const selector = container.querySelector('[data-function-selector="ANALYSIS"]')
    const select = selector?.querySelector('[data-function-provider-select]')
    if (!select) {
      throw new Error('seletor de provider da Análise não encontrado')
    }
    await fireEvent.change(select, { target: { value: '' } })

    expect(JSON.parse(window.localStorage.getItem('ray_models') ?? 'null')).toEqual({
      TRANSCRIPTION: null,
      ANALYSIS: null,
      TRANSLATION: null,
    })
  })

  it('a preferência local semeia os seletores sobre o functionConfig do feed', async () => {
    window.localStorage.setItem(
      'ray_models',
      JSON.stringify({
        TRANSCRIPTION: null,
        ANALYSIS: { kind: 'GEMINI', model: 'gemini-2.0-flash' },
        TRANSLATION: null,
      }),
    )
    setSettingsStateFeed(() =>
      baseState({
        providerStatus: {
          ...baseState().providerStatus,
          gemini: 'connected',
        },
        functionConfig: {
          TRANSCRIPTION: null,
          ANALYSIS: { kind: 'OPENAI', model: 'gpt-4o' },
          TRANSLATION: null,
        },
      }),
    )
    const { container } = render(Settings)
    await openTab(container, 'models')

    const selector = container.querySelector('[data-function-selector="ANALYSIS"]')
    const select = selector?.querySelector(
      '[data-function-provider-select]',
    ) as HTMLSelectElement | null
    const input = selector?.querySelector(
      '[data-function-model-input]',
    ) as HTMLInputElement | null
    expect(select?.value, 'localStorage vence o functionConfig').toBe('GEMINI')
    expect(input?.value).toBe('gemini-2.0-flash')
  })
})

describe('Modelos — modelos personalizados (URL + modelo + key)', () => {
  const SECRET = 'sk-custom-secret-1'
  let nextId = 0
  /** Crypto determinístico: ids previsíveis para as asserções de slot. */
  function installDeterministicId(): void {
    Object.defineProperty(globalThis, 'crypto', {
      value: {
        randomUUID: () => `id${String(++nextId).padStart(2, '0')}aaaa-bbbb-cccc-dddd-eeee`,
      },
      configurable: true,
    })
  }

  beforeEach(() => {
    installDeterministicId()
  })

  function fillCustomForm(container: HTMLElement, overrides: Record<string, string> = {}): void {
    const fields: Array<[string, string]> = [
      ['[data-custom-label-input]', 'Meu servidor local'],
      ['[data-custom-baseurl-input]', 'https://api.exemplo.com'],
      ['[data-custom-model-name-input]', 'llama-3'],
      ['[data-custom-key-input]', SECRET],
    ]
    for (const [selector, value] of fields) {
      const input = container.querySelector(selector)
      if (!input) {
        throw new Error(`campo ${selector} não encontrado`)
      }
      fireEvent.input(input, { target: { value: overrides[selector] ?? value } })
    }
  }

  async function addCustomModel(container: HTMLElement): Promise<string> {
    fillCustomForm(container)
    const add = container.querySelector('[data-custom-model-add]')
    if (!add) {
      throw new Error('botão de adicionar modelo não encontrado')
    }
    await fireEvent.click(add)
    await tick()
    const stored = JSON.parse(window.localStorage.getItem('ray_custom_models') ?? '[]') as Array<{
      id: string
    }>
    expect(stored).toHaveLength(1)
    return stored[0].id
  }

  it('renderiza o formulário: nome, URL, modelo, chave e formato', async () => {
    setSettingsStateFeed(() => baseState())
    const { container } = render(Settings)
    await openTab(container, 'models')

    expect(container.querySelector('[data-custom-models]')).not.toBeNull()
    for (const selector of [
      '[data-custom-label-input]',
      '[data-custom-baseurl-input]',
      '[data-custom-model-name-input]',
      '[data-custom-key-input]',
      '[data-custom-format-select]',
      '[data-custom-model-add]',
    ]) {
      expect(container.querySelector(selector), `campo ${selector}`).not.toBeNull()
    }
  })

  it('adicionar despacha credentialSave no slot próprio e persiste metadados SEM a chave', async () => {
    setSettingsStateFeed(() => baseState())
    const actions: SettingsAction[] = []
    const unsubscribe = onSettingsAction((action: SettingsAction) => actions.push(action))
    const { container } = render(Settings)
    await openTab(container, 'models')

    const id = await addCustomModel(container)

    // A key cruza a fronteira declarada exatamente uma vez (App.svelte é a
    // ponte que invoca save_credential no core — vault nativo, ADR-003).
    expect(actions).toEqual([
      {
        type: 'credentialSave',
        slot: `custom-${id}`,
        kind: 'GENERIC',
        connectionMode: 'COMPATIBLE_ENDPOINT',
        secret: SECRET,
        baseUrl: 'https://api.exemplo.com',
      },
    ])

    const stored = JSON.parse(
      window.localStorage.getItem('ray_custom_models') ?? '[]',
    ) as Array<Record<string, string>>
    expect(stored[0]).toEqual({
      id,
      slot: `custom-${id}`,
      label: 'Meu servidor local',
      baseUrl: 'https://api.exemplo.com',
      model: 'llama-3',
      kind: 'GENERIC',
    })
    expect(JSON.stringify(stored), 'a chave nunca é persistida (ADR-003)').not.toContain(SECRET)

    // O modelo aparece nos seletores por função.
    const select = container.querySelector(
      '[data-function-selector="ANALYSIS"] [data-function-provider-select]',
    )
    expect(select?.querySelector(`option[value="custom:${id}"]`)).not.toBeNull()
    expect(select?.textContent).toContain('Meu servidor local')
    unsubscribe()
  })

  it('formato Anthropic salva com connectionMode API_KEY', async () => {
    setSettingsStateFeed(() => baseState())
    const actions: SettingsAction[] = []
    const unsubscribe = onSettingsAction((action: SettingsAction) => actions.push(action))
    const { container } = render(Settings)
    await openTab(container, 'models')

    fillCustomForm(container)
    const format = container.querySelector(
      '[data-custom-format-select]',
    ) as HTMLSelectElement
    await fireEvent.change(format, { target: { value: 'ANTHROPIC' } })
    await tick()
    await fireEvent.click(container.querySelector('[data-custom-model-add]')!)
    await tick()

    expect(actions).toHaveLength(1)
    expect(actions[0]).toMatchObject({ type: 'credentialSave', kind: 'ANTHROPIC', connectionMode: 'API_KEY' })
    unsubscribe()
  })

  it('atribuir um modelo personalizado a uma função persiste kind/model/customId', async () => {
    setSettingsStateFeed(() => baseState())
    const { container } = render(Settings)
    await openTab(container, 'models')

    const id = await addCustomModel(container)

    const select = container.querySelector(
      '[data-function-selector="ANALYSIS"] [data-function-provider-select]',
    ) as HTMLSelectElement
    await fireEvent.change(select, { target: { value: `custom:${id}` } })

    const expected = {
      TRANSCRIPTION: null,
      ANALYSIS: { kind: 'GENERIC', model: 'llama-3', customId: id },
      TRANSLATION: null,
    }
    expect(JSON.parse(window.localStorage.getItem('ray_models') ?? 'null')).toEqual(expected)
    expect(emitMock).toHaveBeenCalledWith('ray:models-changed', expected)
  })

  it('excluir remove os metadados, invoca delete_credential e limpa a atribuição da função', async () => {
    setSettingsStateFeed(() => baseState())
    const { container } = render(Settings)
    await openTab(container, 'models')

    const id = await addCustomModel(container)
    const select = container.querySelector(
      '[data-function-selector="ANALYSIS"] [data-function-provider-select]',
    ) as HTMLSelectElement
    await fireEvent.change(select, { target: { value: `custom:${id}` } })

    const del = container.querySelector(`[data-custom-model-delete="${id}"]`)
    if (!del) {
      throw new Error('botão de excluir não encontrado')
    }
    await fireEvent.click(del)

    const deleteCall = invokeMock.mock.calls.find(([command]) => command === 'delete_credential')
    expect(deleteCall?.[1]).toEqual({ slot: `custom-${id}` })
    expect(window.localStorage.getItem('ray_custom_models')).toBe('[]')
    expect(JSON.parse(window.localStorage.getItem('ray_models') ?? 'null')).toEqual({
      TRANSCRIPTION: null,
      ANALYSIS: null,
      TRANSLATION: null,
    })
  })

  it('preferência persistida com customId semeia o seletor na recarga', async () => {
    window.localStorage.setItem(
      'ray_custom_models',
      JSON.stringify([
        {
          id: 'abc12345',
          slot: 'custom-abc12345',
          label: 'Meu servidor local',
          baseUrl: 'https://api.exemplo.com',
          model: 'llama-3',
          kind: 'GENERIC',
        },
      ]),
    )
    window.localStorage.setItem(
      'ray_models',
      JSON.stringify({
        TRANSCRIPTION: null,
        ANALYSIS: { kind: 'GENERIC', model: 'llama-3', customId: 'abc12345' },
        TRANSLATION: null,
      }),
    )
    setSettingsStateFeed(() => baseState())
    const { container } = render(Settings)
    await openTab(container, 'models')

    const select = container.querySelector(
      '[data-function-selector="ANALYSIS"] [data-function-provider-select]',
    ) as HTMLSelectElement
    expect(select?.value).toBe('custom:abc12345')
    const input = container.querySelector(
      '[data-function-selector="ANALYSIS"] [data-function-model-input]',
    ) as HTMLInputElement
    expect(input?.value).toBe('llama-3')
  })
})
