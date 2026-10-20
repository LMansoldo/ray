import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, cleanup, fireEvent, waitFor } from '@testing-library/svelte'
import Settings from './Settings.svelte'
import { setSettingsStateFeed, resetSettingsStateFeed } from './settings-feed'
import { onSettingsAction } from './settings-actions'
import type { SettingsAction } from './settings-actions'
import type { SettingsState } from './types'
import { DEFAULT_OVERLAY_TEMPLATE } from '../../lib/overlay-template'
import { OVERLAY_TEMPLATE_MAX_LENGTH } from '../../../../../contracts/settings'
import {
  DEFAULT_FEATURE_TOGGLES,
  DEFAULT_SHORTCUTS,
  DEFAULT_STT_LANGUAGE,
} from '../../../../../contracts/settings'

// Contrato — aba Overlay (template HTML+CSS customizado): toggle que liga/
// desliga o template, textarea monoespaçada com os placeholders, botões
// Salvar (invoke save_overlay_template com toggle+textarea — o comando emite
// ray:overlay-template-changed e o overlay troca ao vivo) e Restaurar padrão
// (preenche a textarea com DEFAULT_OVERLAY_TEMPLATE, sem persistir), com
// preview ao vivo pelo mesmo caminho de render do overlay real e validação
// de tamanho NO CLIENTE (estouro mostra erro e NÃO chama a ação).

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

function textarea(container: HTMLElement): HTMLTextAreaElement {
  const el = container.querySelector('[data-overlay-template-textarea]')
  expect(el, 'textarea do template deve existir').not.toBeNull()
  return el as HTMLTextAreaElement
}

async function typeTemplate(container: HTMLElement, value: string): Promise<void> {
  await fireEvent.input(textarea(container), { target: { value } })
}

afterEach(() => {
  cleanup()
  resetSettingsStateFeed()
  invokeMock.mockReset().mockResolvedValue(undefined)
  emitMock.mockClear()
  window.localStorage.removeItem?.('ray_models')
  window.localStorage.removeItem?.('ray_audio_meters')
})

describe('Overlay — toggle e textarea (template customizado)', () => {
  it('a aba existe, renderiza o toggle, a textarea e o preview', async () => {
    const { container } = render(Settings)
    await openTab(container, 'overlay')

    expect(container.querySelector('[data-settings-panel="overlay"]')).not.toBeNull()
    const toggle = container.querySelector(
      '[data-overlay-template-toggle]',
    ) as HTMLInputElement | null
    expect(toggle, 'toggle do overlay customizado').not.toBeNull()
    expect(toggle?.checked, 'desligado por padrão (built-in)').toBe(false)
    expect(textarea(container)).not.toBeNull()
    expect(container.querySelector('[data-overlay-template-preview]')).not.toBeNull()
  })

  it('o estado hidratado do feed semeia toggle e textarea', async () => {
    setSettingsStateFeed(() =>
      baseState({ overlayTemplateEnabled: true, overlayTemplate: '<p>meu card</p>' }),
    )
    const { container } = render(Settings)
    await openTab(container, 'overlay')

    await waitFor(() => {
      const toggle = container.querySelector(
        '[data-overlay-template-toggle]',
      ) as HTMLInputElement
      expect(toggle.checked).toBe(true)
      expect(textarea(container).value).toBe('<p>meu card</p>')
    })
  })

  it('a dica cita os placeholders e data-ray-body', async () => {
    const { container } = render(Settings)
    await openTab(container, 'overlay')

    const hint = container.querySelector('[data-overlay-template-hint]')
    expect(hint?.textContent).toContain('{{contextLabel}}')
    expect(hint?.textContent).toContain('{{theySaid}}')
    expect(hint?.textContent).toContain('{{bodyHtml}}')
    expect(hint?.textContent).toContain('{{status}}')
    expect(hint?.textContent).toContain('{{error}}')
    expect(hint?.textContent).toContain('data-ray-body')
  })
})

describe('Overlay — Salvar (save_overlay_template com toggle+textarea)', () => {
  it('salvar chama invoke(save_overlay_template) com o toggle e o rascunho', async () => {
    const actions: SettingsAction[] = []
    const unsubscribe = onSettingsAction((action: SettingsAction) => actions.push(action))
    const { container } = render(Settings)
    await openTab(container, 'overlay')

    const toggle = container.querySelector('[data-overlay-template-toggle]') as HTMLInputElement
    await fireEvent.click(toggle)
    await typeTemplate(container, '<div data-ray-body>{{bodyHtml}}</div>')
    await fireEvent.click(container.querySelector('[data-overlay-template-save]') as HTMLButtonElement)

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith('save_overlay_template', {
        enabled: true,
        template: '<div data-ray-body>{{bodyHtml}}</div>',
      })
    })
    expect(actions).toContainEqual({
      type: 'overlayTemplateChange',
      enabled: true,
      template: '<div data-ray-body>{{bodyHtml}}</div>',
    })
    unsubscribe()
  })

  it('sucesso exibe feedback inline com data-attr de sucesso', async () => {
    const { container } = render(Settings)
    await openTab(container, 'overlay')

    await fireEvent.click(container.querySelector('[data-overlay-template-save]') as HTMLButtonElement)

    await waitFor(() => {
      expect(container.querySelector('[data-overlay-template-feedback="ok"]')).not.toBeNull()
    })
  })

  it('falha do núcleo exibe feedback inline com data-attr de erro', async () => {
    invokeMock.mockImplementation(async (command: string) => {
      if (command === 'save_overlay_template') throw new Error('sidecar not started')
      return undefined
    })
    const { container } = render(Settings)
    await openTab(container, 'overlay')

    await fireEvent.click(container.querySelector('[data-overlay-template-save]') as HTMLButtonElement)

    await waitFor(() => {
      expect(container.querySelector('[data-overlay-template-feedback="error"]')).not.toBeNull()
    })
  })
})

describe('Overlay — Restaurar padrão (só preenche a textarea)', () => {
  it('carrega o DEFAULT_OVERLAY_TEMPLATE na textarea sem invocar o comando', async () => {
    const { container } = render(Settings)
    await openTab(container, 'overlay')

    await typeTemplate(container, '<p>rascunho descartável</p>')
    await fireEvent.click(
      container.querySelector('[data-overlay-template-reset]') as HTMLButtonElement,
    )

    expect(textarea(container).value).toBe(DEFAULT_OVERLAY_TEMPLATE)
    expect(
      invokeMock.mock.calls.filter(([cmd]) => cmd === 'save_overlay_template'),
      'restaurar NÃO persiste — só o Salvar persiste',
    ).toHaveLength(0)
  })
})

describe('Overlay — validação de tamanho no cliente (teto do contrato)', () => {
  /** Semeia um template marcador ANTES do render (o feed é capturado na
   *  inicialização do componente) e espera a hidratação resolver — digitar
   *  antes disso corre o risco de ser sobrescrito pelo load assíncrono. */
  async function openHydratedTab(seedTemplate = '<p>seed</p>'): Promise<{ container: HTMLElement }> {
    setSettingsStateFeed(() => baseState({ overlayTemplate: seedTemplate }))
    const { container } = render(Settings)
    await openTab(container, 'overlay')
    await waitFor(() => expect(textarea(container).value).toBe(seedTemplate))
    return { container }
  }

  it('template acima do teto mostra erro e NÃO chama a ação', async () => {
    const { container } = await openHydratedTab()

    const overflow = 'x'.repeat(OVERLAY_TEMPLATE_MAX_LENGTH + 1)
    await typeTemplate(container, overflow)
    await fireEvent.click(container.querySelector('[data-overlay-template-save]') as HTMLButtonElement)
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(container.querySelector('[data-overlay-template-error]')).not.toBeNull()
    expect(
      invokeMock.mock.calls.filter(([cmd]) => cmd === 'save_overlay_template'),
      'estouro NÃO invoca o comando',
    ).toHaveLength(0)
  })

  it('template exatamente no teto é aceito', async () => {
    const { container } = await openHydratedTab()

    await typeTemplate(container, 'y'.repeat(OVERLAY_TEMPLATE_MAX_LENGTH))
    await fireEvent.click(container.querySelector('[data-overlay-template-save]') as HTMLButtonElement)

    await waitFor(() => {
      expect(
        invokeMock.mock.calls.filter(([cmd]) => cmd === 'save_overlay_template'),
      ).toHaveLength(1)
    })
    expect(container.querySelector('[data-overlay-template-error]')).toBeNull()
  })
})

describe('Overlay — preview ao vivo (mesmo caminho de render do overlay)', () => {
  it('o preview é um iframe sandbox e recebe o template renderizado com dados de exemplo', async () => {
    const { container } = render(Settings)
    await openTab(container, 'overlay')

    const preview = container.querySelector(
      '[data-overlay-template-preview]',
    ) as HTMLIFrameElement | null
    expect(preview).not.toBeNull()
    expect(preview?.getAttribute('sandbox')).toBe('allow-same-origin')

    // Debounce leve do preview (~250ms): o srcdoc chega com o default + amostra.
    await waitFor(
      () => {
        const srcdoc = preview?.getAttribute('srcdoc') ?? ''
        expect(srcdoc).toContain('data-ray-body')
        expect(srcdoc).toContain('data-ray-overlay-status="done"')
        expect(srcdoc).not.toContain('{{bodyHtml}}')
      },
      { timeout: 2_000 },
    )
  })

  it('textarea vazia: o preview cai no template default (mesma regra do overlay real)', async () => {
    setSettingsStateFeed(() => baseState({ overlayTemplate: '<p>custom</p>' }))
    const { container } = render(Settings)
    await openTab(container, 'overlay')

    await waitFor(() => expect(textarea(container).value).toBe('<p>custom</p>'))
    await typeTemplate(container, '')

    await waitFor(
      () => {
        const srcdoc = container
          .querySelector('[data-overlay-template-preview]')
          ?.getAttribute('srcdoc') ?? ''
        expect(srcdoc).toContain('data-ray-overlay-status="done"')
      },
      { timeout: 2_000 },
    )
  })
})
