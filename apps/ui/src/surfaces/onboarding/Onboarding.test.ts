import { describe, it, expect, afterEach } from 'vitest'
import { render, cleanup, fireEvent } from '@testing-library/svelte'
import { tick } from 'svelte'
import Onboarding from './Onboarding.svelte'
import { setOnboardingStateFeed, resetOnboardingStateFeed } from './state-feed'
import { dispatchOnboardingRestart } from './restart'
import type { OnboardingState } from './types'

// Contrato T-405 / RF-101..104: fluxo de onboarding em 6 passos ordenados
// (permissões, áudio, transcrição, análise, comunidade [opcional], trial),
// progressão travada pelo estado de conclusão de cada passo (contrato: "cada
// passo reflete o estado real"), cartão do trial no passo 6 (RF-902) e
// reinício via Ajuda → Reiniciar Integração (RF-102 / RF-1003 — aqui
// disparado pelo dispatch local; o menu Ajuda em si é T-406).
//
// O estado real (permissões concedidas, dispositivos, provider configurado)
// NÃO é legível pela UI hoje: core/src/lib.rs registra apenas set_stealth /
// toggle_window / suggest / transcribe_pending_pcm — nenhum comando expõe
// permissões, dispositivos ou providers. O estado entra por um adaptador
// local (state-feed.ts) que os testes injetam; a metade "reflete o estado
// real" permanece descoberta no coverageMap até o comando core existir.

function grantedState(overrides: Partial<OnboardingState> = {}): OnboardingState {
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
    ...overrides,
  }
}

function currentStep(container: HTMLElement): string | undefined {
  return (
    container.querySelector('[data-onboarding-step]')?.getAttribute('data-onboarding-step') ??
    undefined
  )
}

async function clickAdvance(container: HTMLElement): Promise<void> {
  const next = container.querySelector('[data-onboarding-next]')
  if (!next) {
    throw new Error('botão Avançar não encontrado')
  }
  await fireEvent.click(next)
}

// Avança ATÉ o passo indicado, clicando Avançar a diferença a partir do
// passo atual (o helper original clicava `step - 1` vezes independente da
// posição, o que quebrava chamadas sequenciais — ver decisions.md).
async function advanceTo(container: HTMLElement, step: number): Promise<void> {
  for (let current = Number(currentStep(container) ?? 1); current < step; current += 1) {
    await clickAdvance(container)
  }
}

afterEach(() => {
  cleanup()
  resetOnboardingStateFeed()
})

describe('Onboarding — fluxo ordenado (RF-101)', () => {
  it('renderiza os 6 passos na ordem do RF-101 e começa no passo 1', () => {
    setOnboardingStateFeed(() => grantedState())
    const { container, getByRole } = render(Onboarding)

    const items = Array.from(container.querySelectorAll('[data-onboarding-step-item]'))
    expect(items.map((item) => item.textContent?.trim())).toEqual([
      'Verificação de permissões',
      'Configuração de áudio',
      'Transcrição',
      'Análise de texto e imagem',
      'Comunidade e ajuda',
      'Trial de 7 dias',
    ])

    expect(currentStep(container)).toBe('1')
    expect(container.querySelector('[data-onboarding-step]')?.textContent).toContain(
      'Verificação de permissões',
    )
    expect(getByRole('button', { name: 'Avançar' })).toBeDefined()
  })

  it('com todas as etapas completas, avança passo a passo até o 6', async () => {
    setOnboardingStateFeed(() => grantedState())
    const { container } = render(Onboarding)

    await advanceTo(container, 2)
    expect(currentStep(container)).toBe('2')
    expect(container.querySelector('[data-onboarding-step]')?.textContent).toContain(
      'Configuração de áudio',
    )
    expect(
      container.querySelector('[data-onboarding-step-status]')?.textContent?.trim(),
    ).toBe('Configurado')

    await advanceTo(container, 3)
    expect(currentStep(container)).toBe('3')
    await advanceTo(container, 5)
    expect(currentStep(container)).toBe('5')
    await advanceTo(container, 6)
    expect(currentStep(container)).toBe('6')
  })

  it('o passo 6 renderiza o cartão do trial de 7 dias (RF-902)', async () => {
    setOnboardingStateFeed(() => grantedState())
    const { container, getByRole } = render(Onboarding)

    await advanceTo(container, 6)
    expect(container.querySelector('[data-trial-card]'), 'o cartão do trial deve existir').not.toBeNull()
    expect(getByRole('button', { name: 'Iniciar teste de 7 dias' })).toBeDefined()
  })
})

describe('Onboarding — progressão travada pelo estado (RF-101 / contrato)', () => {
  it('não avança além do passo 1 enquanto uma permissão estiver ausente', async () => {
    setOnboardingStateFeed(() => ({
      ...grantedState(),
      permissions: { ...grantedState().permissions, microphone: 'notGranted' },
    }))
    const { container } = render(Onboarding)

    await clickAdvance(container)
    expect(currentStep(container)).toBe('1')
  })

  it('não avança além do passo 2 sem áudio configurado', async () => {
    setOnboardingStateFeed(() => ({ ...grantedState(), audioDevicesConfigured: false }))
    const { container } = render(Onboarding)

    await advanceTo(container, 2)
    expect(currentStep(container)).toBe('2')
    expect(
      container.querySelector('[data-onboarding-step-status]')?.textContent?.trim(),
    ).toBe('Não configurado')

    await clickAdvance(container)
    expect(currentStep(container)).toBe('2')
  })

  it('não avança além do passo 3 sem transcrição configurada', async () => {
    setOnboardingStateFeed(() => ({ ...grantedState(), transcriptionConfigured: false }))
    const { container } = render(Onboarding)

    await advanceTo(container, 3)
    expect(currentStep(container)).toBe('3')
    await clickAdvance(container)
    expect(currentStep(container)).toBe('3')
  })

  it('não avança além do passo 4 sem análise configurada', async () => {
    setOnboardingStateFeed(() => ({ ...grantedState(), analysisConfigured: false }))
    const { container } = render(Onboarding)

    await advanceTo(container, 4)
    expect(currentStep(container)).toBe('4')
    await clickAdvance(container)
    expect(currentStep(container)).toBe('4')
  })

  it('o passo 5 é opcional: Pular leva direto ao passo 6', async () => {
    setOnboardingStateFeed(() => grantedState())
    const { container, getByRole } = render(Onboarding)

    await advanceTo(container, 5)
    expect(currentStep(container)).toBe('5')
    expect(getByRole('button', { name: 'Pular' })).toBeDefined()

    const skip = container.querySelector('[data-onboarding-skip]')
    if (!skip) {
      throw new Error('botão Pular não encontrado')
    }
    await fireEvent.click(skip)
    expect(currentStep(container)).toBe('6')
  })
})

describe('Onboarding — permissões por plataforma (RF-103)', () => {
  it('no macOS, Reconhecimento de Fala é exigido (STT on-device)', async () => {
    setOnboardingStateFeed(() => ({
      ...grantedState(),
      permissions: { ...grantedState().permissions, speechRecognition: 'notGranted' },
    }))
    const { container } = render(Onboarding)

    await clickAdvance(container)
    expect(currentStep(container)).toBe('1')

    const speech = container.querySelector('[data-permission-row="speechRecognition"]')
    expect(speech?.textContent).toContain('STT on-device')
    expect(speech?.textContent).not.toContain('Whisper embutido')
    expect(speech?.getAttribute('data-permission-state')).toBe('notGranted')
  })

  it('no Windows, STT é Whisper embutido e não exige permissão de sistema', async () => {
    setOnboardingStateFeed(() => ({
      ...grantedState(),
      platform: 'windows',
      permissions: { ...grantedState().permissions, speechRecognition: 'notRequired' },
    }))
    const { container } = render(Onboarding)

    await clickAdvance(container)
    expect(currentStep(container)).toBe('2')

    const speech = container.querySelector('[data-permission-row="speechRecognition"]')
    expect(speech?.textContent).toContain('Whisper embutido')
    expect(speech?.textContent).not.toContain('STT on-device')
    expect(speech?.getAttribute('data-permission-state')).toBe('notRequired')
  })

  it('o passo 1 renderiza o mapeamento permissão→função de cada item', () => {
    setOnboardingStateFeed(() => grantedState())
    const { container } = render(Onboarding)

    const microphone = container.querySelector('[data-permission-row="microphone"]')
    expect(microphone?.textContent).toContain('Microfone')
    expect(microphone?.textContent).toContain('canal VOCÊ')

    const screen = container.querySelector('[data-permission-row="screenRecording"]')
    expect(screen?.textContent).toContain('Captura de Tela')
    expect(screen?.textContent).toContain('Capturar Tela')
    expect(screen?.textContent).toContain('contexto visual')

    const accessibility = container.querySelector('[data-permission-row="accessibility"]')
    expect(accessibility?.textContent).toContain('Analisar Seleção')
  })
})

describe('Onboarding — concessão e reinício do app (RF-104)', () => {
  it('detecta o estado de cada permissão', () => {
    setOnboardingStateFeed(() => ({
      ...grantedState(),
      permissions: {
        microphone: 'granted',
        screenRecording: 'notGranted',
        accessibility: 'granted',
        speechRecognition: 'notGranted',
      },
    }))
    const { container } = render(Onboarding)

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

  it('oferece "Conceder permissões ausentes" apenas quando algo falta', () => {
    setOnboardingStateFeed(() => ({
      ...grantedState(),
      permissions: { ...grantedState().permissions, accessibility: 'notGranted' },
    }))
    const first = render(Onboarding)
    expect(first.getByRole('button', { name: 'Conceder permissões ausentes' })).toBeDefined()

    cleanup()
    setOnboardingStateFeed(() => grantedState())
    const second = render(Onboarding)
    expect(second.queryByRole('button', { name: 'Conceder permissões ausentes' })).toBeNull()
  })

  it('orienta o reinício do app quando uma permissão é exigida, e some quando completo', () => {
    setOnboardingStateFeed(() => ({
      ...grantedState(),
      permissions: { ...grantedState().permissions, screenRecording: 'notGranted' },
    }))
    const first = render(Onboarding)
    const guidance = first.container.querySelector('[data-onboarding-restart-guidance]')
    expect(guidance, 'a orientação de reinício deve existir').not.toBeNull()
    expect(guidance?.textContent).toMatch(/reinici/i)

    cleanup()
    setOnboardingStateFeed(() => grantedState())
    const second = render(Onboarding)
    expect(second.container.querySelector('[data-onboarding-restart-guidance]')).toBeNull()
  })
})

describe('Onboarding — reinício da integração (RF-102 / RF-1003)', () => {
  it('volta ao passo 1 quando Reiniciar Integração é disparado de qualquer passo', async () => {
    setOnboardingStateFeed(() => grantedState())
    const { container } = render(Onboarding)

    await advanceTo(container, 3)
    expect(currentStep(container)).toBe('3')

    dispatchOnboardingRestart()
    await tick()

    expect(currentStep(container)).toBe('1')
  })
})
