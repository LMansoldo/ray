import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, cleanup, fireEvent, waitFor } from '@testing-library/svelte'
import Settings from './Settings.svelte'
import { setSettingsStateFeed, resetSettingsStateFeed } from './settings-feed'
import { onSettingsAction } from './settings-actions'
import type { SettingsAction } from './settings-actions'
import type { SettingsState } from './types'
import { DEFAULT_FEATURE_TOGGLES, DEFAULT_SHORTCUTS } from '../../../../../contracts/settings'

// Contrato T-406 / RF-401, RF-402, RF-403, RF-406 — aba Fontes de IA:
// BYOK com os quatro modos de conexão sob uma abstração comum:
//   Chave de API:        DeepSeek, Anthropic, Google Gemini, OpenAI
//   Login por assinatura: ChatGPT (sem chave de API)
//   Agregador:           OpenRouter
//   Endpoint compatível: modelos locais/auto-hospedados, endpoint base configurável
// Filtro Todos / Local / Nuvem (RF-402); campo dedicado de chave por provedor;
// DeepSeek como card dedicado (RF-406); status de conexão (RF-403) lido do
// feed. Salvar sai pelo canal settings-actions; o comando core
// delete_credential existe (core/src/lib.rs): "Excluir" remove a credencial
// do cofre+banco e emite 'ray:credentials-changed' para recarregar status.

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

const PROVIDER_CARDS: Array<[string, string]> = [
  ['deepseek', 'DeepSeek'],
  ['anthropic', 'Anthropic'],
  ['gemini', 'Google Gemini'],
  ['openai', 'OpenAI'],
  ['chatgpt', 'ChatGPT'],
  ['openrouter', 'OpenRouter'],
  ['generic', 'Endpoint compatível com OpenAI'],
]

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

function typeKey(container: HTMLElement, slot: string, value: string): void {
  const input = container.querySelector(`[data-provider-key-input="${slot}"]`)
  if (!input) {
    throw new Error(`campo de chave do card ${slot} não encontrado`)
  }
  fireEvent.input(input, { target: { value } })
}

function clickSave(container: HTMLElement, slot: string): void {
  const save = container.querySelector(`[data-provider-save="${slot}"]`)
  if (!save) {
    throw new Error(`botão Salvar do card ${slot} não encontrado`)
  }
  fireEvent.click(save)
}

afterEach(() => {
  cleanup()
  resetSettingsStateFeed()
  // mockReset limpa a implementação baseline — reestabelecemos o resolved
  // undefined (invoke real SEMPRE devolve Promise).
  invokeMock.mockReset().mockResolvedValue(undefined)
  emitMock.mockClear()
})

describe('Fontes de IA — quatro modos de conexão (RF-401)', () => {
  it('renderiza os 7 cards de provedor com os títulos do contrato', () => {
    const { container } = render(Settings)

    for (const [slot, title] of PROVIDER_CARDS) {
      const card = container.querySelector(`[data-provider-card="${slot}"]`)
      expect(card, `card ${slot} deve existir`).not.toBeNull()
      expect(card?.textContent, `título do card ${slot}`).toContain(title)
    }
  })

  it('DeepSeek é um card dedicado com campo de chave próprio (RF-406)', () => {
    const { container } = render(Settings)

    const deepseek = container.querySelector('[data-provider-card="deepseek"]')
    expect(deepseek?.textContent).toContain('DeepSeek')
    expect(container.querySelector('[data-provider-key-input="deepseek"]')).not.toBeNull()
  })

  it('cada provedor com chave de API tem um campo dedicado de chave (RF-402)', () => {
    const { container } = render(Settings)

    for (const slot of ['deepseek', 'anthropic', 'gemini', 'openai', 'openrouter']) {
      expect(
        container.querySelector(`[data-provider-key-input="${slot}"]`),
        `campo de chave dedicado para ${slot}`,
      ).not.toBeNull()
    }
  })

  it('ChatGPT (login por assinatura) NÃO tem campo de chave de API', () => {
    const { container } = render(Settings)

    const chatgpt = container.querySelector('[data-provider-card="chatgpt"]')
    expect(chatgpt?.textContent).toContain('ChatGPT')
    expect(container.querySelector('[data-provider-key-input="chatgpt"]')).toBeNull()
    expect(container.querySelector('[data-provider-save="chatgpt"]')).toBeNull()
  })

  it('o endpoint compatível com OpenAI tem endpoint base configurável (RF-401)', () => {
    const { container } = render(Settings)

    const generic = container.querySelector('[data-provider-card="generic"]')
    expect(generic?.textContent).toContain('Endpoint compatível com OpenAI')
    expect(container.querySelector('[data-provider-baseurl-input]')).not.toBeNull()
  })
})

describe('Fontes de IA — filtro Todos / Local / Nuvem (RF-402)', () => {
  it('Todos mostra os 7 cards (estado inicial)', () => {
    const { container } = render(Settings)
    expect(container.querySelectorAll('[data-provider-card]')).toHaveLength(7)
  })

  it('Local mostra apenas o endpoint compatível (modelos locais)', async () => {
    const { container } = render(Settings)

    const local = container.querySelector('[data-provider-filter="local"]')
    if (!local) {
      throw new Error('filtro Local não encontrado')
    }
    await fireEvent.click(local)

    const cards = container.querySelectorAll('[data-provider-card]')
    expect(cards).toHaveLength(1)
    expect(cards[0].getAttribute('data-provider-card')).toBe('generic')
    expect(container.querySelector('[data-provider-card="deepseek"]')).toBeNull()
  })

  it('Nuvem mostra todos exceto o endpoint compatível', async () => {
    const { container } = render(Settings)

    const cloud = container.querySelector('[data-provider-filter="cloud"]')
    if (!cloud) {
      throw new Error('filtro Nuvem não encontrado')
    }
    await fireEvent.click(cloud)

    expect(container.querySelectorAll('[data-provider-card]')).toHaveLength(6)
    expect(container.querySelector('[data-provider-card="generic"]')).toBeNull()
    expect(container.querySelector('[data-provider-card="deepseek"]')).not.toBeNull()
  })
})

describe('Fontes de IA — status de conexão (RF-403, metade UI)', () => {
  it('exibe Conectado / Não Conectado / Não configurado conforme o feed', () => {
    setSettingsStateFeed(() =>
      baseState({
        providerStatus: {
          deepseek: 'connected',
          anthropic: 'disconnected',
          gemini: 'notConfigured',
          openai: 'notConfigured',
          chatgpt: 'notConfigured',
          openrouter: 'notConfigured',
          generic: 'notConfigured',
        },
      }),
    )
    const { container } = render(Settings)

    expect(container.querySelector('[data-provider-status="deepseek"]')?.textContent?.trim()).toBe(
      'Conectado',
    )
    expect(
      container.querySelector('[data-provider-status="anthropic"]')?.textContent?.trim(),
    ).toBe('Não Conectado')
    expect(container.querySelector('[data-provider-status="gemini"]')?.textContent?.trim()).toBe(
      'Não configurado',
    )
  })
})

describe('Fontes de IA — salvar credencial pela fronteira declarada', () => {
  it('Salvar despacha credentialSave com slot/kind/modo/segredo digitado', () => {
    const actions: SettingsAction[] = []
    const unsubscribe = onSettingsAction((action: SettingsAction) => actions.push(action))
    const { container } = render(Settings)

    typeKey(container, 'deepseek', 'sk-deepseek-abc')
    clickSave(container, 'deepseek')

    expect(actions).toEqual([
      {
        type: 'credentialSave',
        slot: 'deepseek',
        kind: 'DEEPSEEK',
        connectionMode: 'API_KEY',
        secret: 'sk-deepseek-abc',
      },
    ])
    unsubscribe()
  })

  it('OpenRouter (agregador, RF-401) despacha connectionMode AGGREGATOR', () => {
    const actions: SettingsAction[] = []
    const unsubscribe = onSettingsAction((action: SettingsAction) => actions.push(action))
    const { container } = render(Settings)

    typeKey(container, 'openrouter', 'sk-or-live')
    clickSave(container, 'openrouter')

    expect(actions).toEqual([
      {
        type: 'credentialSave',
        slot: 'openrouter',
        kind: 'OPENROUTER',
        connectionMode: 'AGGREGATOR',
        secret: 'sk-or-live',
      },
    ])
    unsubscribe()
  })

  it('o endpoint compatível despacha o endpoint base configurado', () => {
    const actions: SettingsAction[] = []
    const unsubscribe = onSettingsAction((action: SettingsAction) => actions.push(action))
    const { container } = render(Settings)

    typeKey(container, 'generic', 'sk-local-xyz')
    const baseUrl = container.querySelector('[data-provider-baseurl-input]')
    if (!baseUrl) {
      throw new Error('campo de endpoint base não encontrado')
    }
    fireEvent.input(baseUrl, { target: { value: 'http://localhost:8000/v1' } })
    clickSave(container, 'generic')

    expect(actions).toEqual([
      {
        type: 'credentialSave',
        slot: 'generic',
        kind: 'GENERIC',
        connectionMode: 'COMPATIBLE_ENDPOINT',
        baseUrl: 'http://localhost:8000/v1',
        secret: 'sk-local-xyz',
      },
    ])
    unsubscribe()
  })

  it('Salvar com campo de chave vazio não despacha nada', () => {
    const actions: SettingsAction[] = []
    const unsubscribe = onSettingsAction((action: SettingsAction) => actions.push(action))
    const { container } = render(Settings)

    clickSave(container, 'deepseek')

    expect(actions).toEqual([])
    unsubscribe()
  })

  it('nenhuma ação de credencial inventa um comando invoke()', () => {
    const actions: SettingsAction[] = []
    const unsubscribe = onSettingsAction((action: SettingsAction) => actions.push(action))
    const { container } = render(Settings)

    typeKey(container, 'deepseek', 'sk-deepseek-abc')
    clickSave(container, 'deepseek')

    expect(actions).toHaveLength(1)
    // Comandos core registrados (core/src/lib.rs) são permitidos — inclusive
    // os de hidratação do feed; a regra proíbe inventar nomes fora do
    // contrato (general.md).
    const calledCommands = invokeMock.mock.calls.map((call) => call[0])
    for (const command of calledCommands) {
      expect(
        [
          'get_provider_statuses',
          'get_permission_status',
          'get_shortcuts',
          'get_app_settings',
        ],
        `comando não registrado: ${command}`,
      ).toContain(command)
    }
    unsubscribe()
  })
})

describe('Fontes de IA — excluir credencial (delete_credential)', () => {
  it('não oferece Excluir enquanto o slot não está configurado', () => {
    const { container } = render(Settings)

    expect(container.querySelector('[data-provider-delete="deepseek"]')).toBeNull()
    expect(container.querySelector('[data-provider-delete="generic"]')).toBeNull()
  })

  it('aparece ao lado de Salvar quando o status não é "Não configurado"', () => {
    setSettingsStateFeed(() =>
      baseState({
        providerStatus: {
          ...baseState().providerStatus,
          deepseek: 'saved',
          openai: 'connected',
        },
      }),
    )
    const { container } = render(Settings)

    for (const slot of ['deepseek', 'openai']) {
      const del = container.querySelector(`[data-provider-delete="${slot}"]`)
      expect(del, `botão Excluir de ${slot}`).not.toBeNull()
      expect(del?.textContent?.trim()).toBe('Excluir')
      // Ao lado de Salvar: mesma .key-row
      expect(del?.closest('.key-row')?.querySelector(`[data-provider-save="${slot}"]`)).not.toBeNull()
    }
    expect(container.querySelector('[data-provider-delete="anthropic"]')).toBeNull()
  })

  it('Excluir invoca delete_credential, limpa o campo e emite ray:credentials-changed', async () => {
    setSettingsStateFeed(() =>
      baseState({
        providerStatus: { ...baseState().providerStatus, deepseek: 'saved' },
      }),
    )
    const { container } = render(Settings)

    typeKey(container, 'deepseek', 'sk-deepseek-abc')
    const del = container.querySelector('[data-provider-delete="deepseek"]')
    if (!del) {
      throw new Error('botão Excluir do deepseek não encontrado')
    }
    await fireEvent.click(del)

    expect(invokeMock).toHaveBeenCalledWith('delete_credential', { slot: 'deepseek' })
    await waitFor(() => {
      expect(emitMock).toHaveBeenCalledWith('ray:credentials-changed', {
        slot: 'deepseek',
        valid: undefined,
      })
    })
    const input = container.querySelector('[data-provider-key-input="deepseek"]') as HTMLInputElement
    expect(input.value, 'o campo de chave é limpo após excluir').toBe('')
  })

  it('Excluir com core indisponível não emite recarga nem quebra a UI', async () => {
    invokeMock.mockImplementation(async (command: string) => {
      if (command === 'delete_credential') {
        throw new Error('sidecar not started')
      }
      return undefined
    })
    setSettingsStateFeed(() =>
      baseState({
        providerStatus: { ...baseState().providerStatus, deepseek: 'saved' },
      }),
    )
    const { container } = render(Settings)

    const del = container.querySelector('[data-provider-delete="deepseek"]')
    if (!del) {
      throw new Error('botão Excluir do deepseek não encontrado')
    }
    await fireEvent.click(del)

    expect(invokeMock).toHaveBeenCalledWith('delete_credential', { slot: 'deepseek' })
    expect(emitMock).not.toHaveBeenCalledWith('ray:credentials-changed', {
      slot: 'deepseek',
      valid: undefined,
    })
    await waitFor(() => {
      expect(
        (container.querySelector('[data-provider-delete="deepseek"]') as HTMLButtonElement).disabled,
        'botão reabilita após a falha',
      ).toBe(false)
    })
  })
})
