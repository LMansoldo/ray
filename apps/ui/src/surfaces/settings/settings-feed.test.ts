import { describe, it, expect, afterEach } from 'vitest'
import {
  setSettingsStateFeed,
  resetSettingsStateFeed,
  readSettingsState,
} from './settings-feed'
import type { SettingsState } from './types'
import { DEFAULT_SHORTCUTS } from '../../../../../contracts/settings'

// Contrato T-406: adaptador local de estado das Configurações — mesmo padrão
// do state-feed.ts do T-405. O comando core que forneceria esse estado ainda
// não existe (core/src/lib.rs registra apenas set_stealth/toggle_window/
// suggest/transcribe_pending_pcm) — quando existir, o feed padrão passa a
// lê-lo via invoke(). Por ora o padrão é um placeholder RESTRITIVO: nada
// configurado, tudo ausente — as abas nunca exibem um estado "conectado"
// inventado sem verificação real.

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
    }))
    expect(readSettingsState().providerStatus.deepseek).toBe('connected')

    resetSettingsStateFeed()

    expect(readSettingsState().providerStatus.deepseek).toBe('notConfigured')
    expect(readSettingsState().appVersion).toBe('0.0.0')
  })
})
