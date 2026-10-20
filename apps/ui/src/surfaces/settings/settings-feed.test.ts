import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  setSettingsStateFeed,
  resetSettingsStateFeed,
  readSettingsState,
  loadSettingsState,
} from './settings-feed'
import type { SettingsState } from './types'
import {
  DEFAULT_STT_LANGUAGE,
  DEFAULT_FEATURE_TOGGLES,
  DEFAULT_SHORTCUTS,
} from '../../../../../contracts/settings'

// Contrato T-406: adaptador local de estado das Configurações — mesmo padrão
// do state-feed.ts do T-405. loadSettingsState hidrata dos comandos core
// registrados (core/src/lib.rs): get_provider_statuses, get_permission_status,
// get_shortcuts, get_app_settings + getVersion (@tauri-apps/api/app). Cada
// consulta é opcional (falha → base do feed) e loadSettingsState NUNCA
// rejeita. O feed padrão continua um placeholder RESTRITIVO: nada
// configurado, tudo ausente — as abas nunca exibem um estado "conectado"
// inventado sem verificação real.

const { invokeMock, getVersionMock } = vi.hoisted(() => ({
  invokeMock: vi.fn<(command: string, args?: unknown) => Promise<unknown>>(),
  getVersionMock: vi.fn<() => Promise<string>>(),
}))

vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }))
vi.mock('@tauri-apps/api/app', () => ({ getVersion: getVersionMock }))

// Node 25 expõe um localStorage global experimental SEM métodos, que sombreia
// o do jsdom (window === globalThis no vitest). Instalamos um Storage em
// memória para exercitar a leitura real da preferência de medidores.
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

describe('settings-feed — placeholder restritivo (sem comando core)', () => {
  it('o padrão declara tudo não configurado (nunca inventa estado)', () => {
    const state = readSettingsState()

    expect(state.platform).toBe('macos')
    expect(state.appVersion).toBe('0.0.0')

    for (const [slot, status] of Object.entries(state.providerStatus)) {
      expect(status, `provider ${slot} deve nascer não configurado`).toBe('notConfigured')
    }

    expect(state.functionConfig).toEqual({
      TRANSCRIPTION: null,
      ANALYSIS: null,
      TRANSLATION: null,
    })

    expect(state.metersVisible).toBe(true)

    for (const [id, permission] of Object.entries(state.permissions)) {
      expect(permission, `permissão ${id} deve nascer não concedida`).toBe('notGranted')
    }

    expect(state.shortcuts).toEqual(DEFAULT_SHORTCUTS)
    expect(state.features).toEqual(DEFAULT_FEATURE_TOGGLES)
    expect(state.overlayTemplateEnabled).toBe(false)
    expect(state.overlayTemplate).toBe('')
  })
})

describe('settings-feed — injeção e leitura', () => {
  afterEach(() => {
    resetSettingsStateFeed()
  })

  it('a leitura reavalia o feed a cada chamada (sem cache)', () => {
    const state: SettingsState = {
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
    }

    setSettingsStateFeed(() => state)
    expect(readSettingsState().permissions.microphone).toBe('granted')

    state.permissions.microphone = 'notGranted'
    expect(readSettingsState().permissions.microphone).toBe('notGranted')
  })

  it('resetSettingsStateFeed() volta ao placeholder restritivo', () => {
    setSettingsStateFeed(() => ({
      platform: 'windows',
      providerStatus: {
        deepseek: 'connected',
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
        speechRecognition: 'notRequired',
      },
      appVersion: '2.1.3',
      shortcuts: DEFAULT_SHORTCUTS,
      features: { ...DEFAULT_FEATURE_TOGGLES },
      sttLanguage: DEFAULT_STT_LANGUAGE,
      overlayTemplateEnabled: false,
      overlayTemplate: '',
    }))
    expect(readSettingsState().providerStatus.deepseek).toBe('connected')

    resetSettingsStateFeed()

    expect(readSettingsState().providerStatus.deepseek).toBe('notConfigured')
    expect(readSettingsState().appVersion).toBe('0.0.0')
  })
})

describe('settings-feed — hidratação do core (loadSettingsState)', () => {
  afterEach(() => {
    resetSettingsStateFeed()
    invokeMock.mockReset()
    getVersionMock.mockReset()
    window.localStorage.removeItem('ray_audio_meters')
    window.localStorage.removeItem('ray_models')
  })

  /** Roteia o invokeMock: comandos em `overrides` resolvem; o resto rejeita
   *  (simula sidecar/core ausente — cada falha cai na base). */
  function mockInvoke(overrides: Record<string, unknown> = {}): void {
    invokeMock.mockImplementation(async (command: string) => {
      if (command in overrides) {
        return overrides[command]
      }
      throw new Error(`core não responde: ${command}`)
    })
  }

  function offlineApp(): void {
    getVersionMock.mockRejectedValue(new Error('fora do Tauri'))
  }

  it('nunca rejeita: com core inteiramente fora, devolve a base intacta', async () => {
    offlineApp()
    invokeMock.mockRejectedValue(new Error('sidecar not started'))

    const state = await loadSettingsState()

    expect(state).toEqual(readSettingsState())
    expect(state.appVersion).toBe('0.0.0')
    expect(state.features).toEqual(DEFAULT_FEATURE_TOGGLES)
    expect(state.metersVisible).toBe(true)
  })

  it('status de provedor continuam de get_provider_statuses (salvo ≠ conectado)', async () => {
    offlineApp()
    mockInvoke({
      get_provider_statuses: {
        credentials: [
          {
            id: 'c1',
            slot: 'deepseek',
            kind: 'DEEPSEEK',
            connectionMode: 'API_KEY',
            secretRef: 'vault:deepseek',
            lastValidatedAt: '2026-01-01T00:00:00Z',
          },
          {
            id: 'c2',
            slot: 'openrouter',
            kind: 'OPENROUTER',
            connectionMode: 'AGGREGATOR',
            secretRef: 'vault:openrouter',
            lastValidatedAt: undefined,
          },
        ],
      },
    })

    const state = await loadSettingsState()

    expect(state.providerStatus.deepseek).toBe('connected')
    expect(state.providerStatus.openrouter).toBe('saved')
    expect(state.providerStatus.anthropic).toBe('notConfigured')
  })

  it('hidrata permissões de get_permission_status (só granted conta)', async () => {
    offlineApp()
    mockInvoke({
      get_provider_statuses: { credentials: [] },
      get_permission_status: {
        microphone: 'granted',
        screenRecording: 'denied',
        accessibility: 'notGranted',
        speechRecognition: 'granted',
      },
    })

    const state = await loadSettingsState()

    expect(state.permissions).toEqual({
      microphone: 'granted',
      screenRecording: 'notGranted',
      accessibility: 'notGranted',
      speechRecognition: 'granted',
    })
  })

  it('get_permission_status inválido/ausente preserva as permissões da base', async () => {
    offlineApp()
    mockInvoke({
      get_provider_statuses: { credentials: [] },
      get_permission_status: undefined,
    })

    const state = await loadSettingsState()

    expect(state.permissions).toEqual(readSettingsState().permissions)
  })

  it('hidrata atalhos de get_shortcuts (valores null ou {enabled,modifiers,key})', async () => {
    offlineApp()
    mockInvoke({
      get_provider_statuses: { credentials: [] },
      get_shortcuts: {
        ...DEFAULT_SHORTCUTS,
        askOrSend: { enabled: false, modifiers: ['Ctrl'], key: 'Q' },
      },
    })

    const state = await loadSettingsState()

    expect(state.shortcuts.askOrSend).toEqual({ enabled: false, modifiers: ['Ctrl'], key: 'Q' })
    expect(state.shortcuts.captureScreen).toEqual(DEFAULT_SHORTCUTS.captureScreen)
  })

  it('get_shortcuts com forma inválida é descartado (mantém a base)', async () => {
    offlineApp()
    mockInvoke({
      get_provider_statuses: { credentials: [] },
      get_shortcuts: { askOrSend: 'Cmd+Enter' },
    })

    const state = await loadSettingsState()

    expect(state.shortcuts).toEqual(DEFAULT_SHORTCUTS)
  })

  it('hidrata features de get_app_settings (só chaves booleanas do contrato)', async () => {
    offlineApp()
    mockInvoke({
      get_provider_statuses: { credentials: [] },
      get_app_settings: { features: { autoScroll: false, chaveDesconhecida: true } },
    })

    const state = await loadSettingsState()

    expect(state.features).toEqual({ ...DEFAULT_FEATURE_TOGGLES, autoScroll: false })
  })

  it('get_app_settings rejeitando mantém DEFAULT_FEATURE_TOGGLES', async () => {
    offlineApp()
    mockInvoke({ get_provider_statuses: { credentials: [] } })

    const state = await loadSettingsState()

    expect(state.features).toEqual(DEFAULT_FEATURE_TOGGLES)
  })

  it('hidrata o locale de STT de get_app_settings; valor fora do contrato cai no default', async () => {
    offlineApp()
    mockInvoke({
      get_provider_statuses: { credentials: [] },
      get_app_settings: { features: {}, sttLanguage: 'en-US' },
    })
    expect((await loadSettingsState()).sttLanguage).toBe('en-US')

    mockInvoke({
      get_provider_statuses: { credentials: [] },
      get_app_settings: { features: {}, sttLanguage: 'es-ES' },
    })
    expect((await loadSettingsState()).sttLanguage).toBe(DEFAULT_STT_LANGUAGE)

    mockInvoke({ get_provider_statuses: { credentials: [] } })
    expect((await loadSettingsState()).sttLanguage).toBe(DEFAULT_STT_LANGUAGE)
  })

  it('hidrata o overlay customizado de get_app_settings; valor fora do contrato cai no default', async () => {
    offlineApp()
    mockInvoke({
      get_provider_statuses: { credentials: [] },
      get_app_settings: {
        features: {},
        overlayTemplateEnabled: true,
        overlayTemplate: '<div data-ray-body>{{bodyHtml}}</div>',
      },
    })
    const ligado = await loadSettingsState()
    expect(ligado.overlayTemplateEnabled).toBe(true)
    expect(ligado.overlayTemplate).toBe('<div data-ray-body>{{bodyHtml}}</div>')

    // Leitura tolerante: flag não-booleano e template não-string caem nos
    // defaults do contrato (desligado, vazio = built-in).
    mockInvoke({
      get_provider_statuses: { credentials: [] },
      get_app_settings: { features: {}, overlayTemplateEnabled: 'sim', overlayTemplate: 42 },
    })
    const invalido = await loadSettingsState()
    expect(invalido.overlayTemplateEnabled).toBe(false)
    expect(invalido.overlayTemplate).toBe('')

    // Sidecar fora: defaults.
    mockInvoke({ get_provider_statuses: { credentials: [] } })
    const ausente = await loadSettingsState()
    expect(ausente.overlayTemplateEnabled).toBe(false)
    expect(ausente.overlayTemplate).toBe('')
  })

  it('hidrata a versão real do app via getVersion()', async () => {
    getVersionMock.mockResolvedValue('3.1.4')
    mockInvoke({ get_provider_statuses: { credentials: [] } })

    const state = await loadSettingsState()

    expect(state.appVersion).toBe('3.1.4')
  })

  it('medidores vêm da preferência local ray_audio_meters (ausente = visível)', async () => {
    offlineApp()
    mockInvoke({ get_provider_statuses: { credentials: [] } })

    window.localStorage.setItem('ray_audio_meters', '0')
    expect((await loadSettingsState()).metersVisible).toBe(false)

    window.localStorage.setItem('ray_audio_meters', '1')
    expect((await loadSettingsState()).metersVisible).toBe(true)

    window.localStorage.removeItem('ray_audio_meters')
    expect((await loadSettingsState()).metersVisible).toBe(true)
  })
})
