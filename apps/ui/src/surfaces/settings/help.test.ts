import { describe, it, expect, afterEach } from 'vitest'
import { render, cleanup, fireEvent } from '@testing-library/svelte'
import Settings from './Settings.svelte'
import { setSettingsStateFeed, resetSettingsStateFeed } from './settings-feed'
import { onSettingsAction } from './settings-actions'
import type { SettingsAction } from './settings-actions'
import type { SettingsState } from './types'
import { onOnboardingRestart } from '../onboarding/restart'
import { DEFAULT_SHORTCUTS } from '../../../../../contracts/settings'

// Contrato T-406 / RF-1001..1004 — aba Ajuda:
//   RF-1001 Sobre com versão do app (lida do feed; o comando core de versão
//           ainda não existe — placeholder '0.0.0');
//   RF-1002 Comunidade (Discord) e Suporte (documentação);
//   RF-1003 Reiniciar Integração → reabre o onboarding via o canal real do
//           T-405 (../onboarding/restart — decisions.md: "T-406 só precisará
//           chamar o dispatch");
//   RF-1004 Logs de depuração: Abrir pasta de logs / Copiar logs — as ações
//           saem pela fronteira declarada (nenhum comando core existe;
//           cobertura real é coverageMap).

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

describe('Ajuda — Sobre (RF-1001)', () => {
  it('exibe a seção Sobre com a versão do feed', async () => {
    const { container } = render(Settings)
    await openTab(container, 'help')

    const panel = container.querySelector('[data-settings-panel="help"]')
    expect(panel?.textContent).toContain('Sobre')
    expect(container.querySelector('[data-about-version]')?.textContent).toContain('0.0.0')
  })

  it('mostra a versão declarada pelo feed quando disponível', async () => {
    setSettingsStateFeed(() => baseState({ appVersion: '2.1.3' }))
    const { container } = render(Settings)
    await openTab(container, 'help')

    expect(container.querySelector('[data-about-version]')?.textContent).toContain('2.1.3')
  })
})

describe('Ajuda — Comunidade e Suporte (RF-1002)', () => {
  it('oferece links para Discord (comunidade) e documentação (suporte)', async () => {
    const { container } = render(Settings)
    await openTab(container, 'help')

    const community = container.querySelector('[data-help-link="community"]')
    expect(community?.textContent).toMatch(/Discord/i)
    expect(community?.getAttribute('href'), 'link externo https').toMatch(/^https:\/\//)

    const support = container.querySelector('[data-help-link="support"]')
    expect(support?.textContent).toMatch(/Documenta/i)
    expect(support?.getAttribute('href'), 'link externo https').toMatch(/^https:\/\//)
  })
})

describe('Ajuda — Reiniciar Integração (RF-1003 / RF-102)', () => {
  it('dispara o canal de reinício do onboarding', async () => {
    let restarts = 0
    const unsubscribe = onOnboardingRestart(() => {
      restarts += 1
    })
    const { container, getByRole } = render(Settings)
    await openTab(container, 'help')

    const button = getByRole('button', { name: 'Reiniciar Integração' })
    await fireEvent.click(button)

    expect(restarts).toBe(1)
    unsubscribe()
  })
})

describe('Ajuda — Logs de depuração (RF-1004)', () => {
  it('Abrir pasta de logs despacha logFolderOpen pela fronteira declarada', async () => {
    const actions: SettingsAction[] = []
    const unsubscribe = onSettingsAction((action: SettingsAction) => actions.push(action))
    const { container, getByRole } = render(Settings)
    await openTab(container, 'help')

    await fireEvent.click(getByRole('button', { name: 'Abrir pasta de logs' }))

    expect(actions).toEqual([{ type: 'logFolderOpen' }])
    unsubscribe()
  })

  it('Copiar logs despacha logCopy pela fronteira declarada', async () => {
    const actions: SettingsAction[] = []
    const unsubscribe = onSettingsAction((action: SettingsAction) => actions.push(action))
    const { container, getByRole } = render(Settings)
    await openTab(container, 'help')

    await fireEvent.click(getByRole('button', { name: 'Copiar logs' }))

    expect(actions).toEqual([{ type: 'logCopy' }])
    unsubscribe()
  })
})
