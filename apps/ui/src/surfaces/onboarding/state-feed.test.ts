import { describe, it, expect, afterEach } from 'vitest'
import {
  readOnboardingState,
  resetOnboardingStateFeed,
  setOnboardingStateFeed,
} from './state-feed'
import type { OnboardingState } from './types'

// Contrato T-405: o estado do onboarding (permissões, dispositivos, provider
// configurado) chega à superfície por um adaptador local injetável — o
// comando core que o alimentaria ainda não existe (core/src/lib.rs registra
// apenas set_stealth/toggle_window/suggest/transcribe_pending_pcm). Os
// testes injetam feeds para dirigir cenários de estado; o feed padrão é um
// placeholder restritivo (tudo ausente), nunca um estado que deixe o fluxo
// avançar sem verificação.

function completeState(): OnboardingState {
  return {
    platform: 'macos',
    permissions: {
      microphone: 'granted',
      screenRecording: 'granted',
      accessibility: 'granted',
      speechRecognition: 'granted',
    },
    audioDevicesConfigured: true,
    transcriptionConfigured: true,
    analysisConfigured: true,
  }
}

afterEach(() => {
  resetOnboardingStateFeed()
})

describe('state-feed — adaptador local de estado do onboarding (T-405)', () => {
  it('por padrão devolve um placeholder restritivo, com tudo ausente', () => {
    resetOnboardingStateFeed()
    const state = readOnboardingState()

    expect(state.platform).toBe('macos')
    expect(state.permissions).toEqual({
      microphone: 'notGranted',
      screenRecording: 'notGranted',
      accessibility: 'notGranted',
      speechRecognition: 'notGranted',
    })
    expect(state.audioDevicesConfigured).toBe(false)
    expect(state.transcriptionConfigured).toBe(false)
    expect(state.analysisConfigured).toBe(false)
  })

  it('aceita um feed injetado e volta ao placeholder após o reset', () => {
    setOnboardingStateFeed(() => completeState())
    expect(readOnboardingState()).toEqual(completeState())

    resetOnboardingStateFeed()
    expect(readOnboardingState().permissions.microphone).toBe('notGranted')
  })

  it('reavalia o feed a cada leitura, sem cache entre chamadas', () => {
    let reads = 0
    setOnboardingStateFeed(() => {
      reads += 1
      return { ...completeState(), analysisConfigured: false }
    })

    readOnboardingState()
    readOnboardingState()
    expect(reads).toBe(2)
  })
})
