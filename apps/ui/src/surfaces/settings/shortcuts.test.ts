import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, cleanup, fireEvent, waitFor } from '@testing-library/svelte'
import Settings from './Settings.svelte'
import { setSettingsStateFeed, resetSettingsStateFeed } from './settings-feed'
import { onSettingsAction } from './settings-actions'
import type { SettingsAction } from './settings-actions'
import type { SettingsState } from './types'
import {
  SHORTCUT_COMMANDS,
  DEFAULT_SHORTCUTS,
  DEFAULT_FEATURE_TOGGLES,
  DEFAULT_STT_LANGUAGE,
} from '../../../../../contracts/settings'
import type { ShortcutBinding, ShortcutMap } from '../../../../../contracts/settings'
import { formatCombo } from './shortcut-validation'

// Contrato T-406 / RF-601, RF-602, RF-604 — aba Atalhos: o conjunto padrão
// de DEFAULT_SHORTCUTS (contrato T-003), cada atalho com toggle de ativação
// e regravável via "Change" (RF-601), com as regras de validação do núcleo
// (core/src/shortcuts.rs, T-305) ESPELHADAS para feedback:
//   - modificador obrigatório (Cmd/Ctrl/Alt), exceto ALLOWED_MODIFIERLESS_KEYS;
//   - sem duplicatas (combo já usado por outro comando enabled);
//   - ESC cancela a gravação (binding anterior preservado, sem erro);
//   - efeito imediato (o combo exibido muda no commit válido);
//   - "Redefinir Todos para Padrões" volta ao DEFAULT_SHORTCUTS.
// A UI espelha para feedback — NÃO re-dona a enforcement (o registro real no
// SO é do núcleo). As mudanças saem pela fronteira declarada
// (settings-actions) E, desde o comando core apply_shortcuts (core/src/
// lib.rs), o mapa corrente é aplicado no SO com efeito imediato: commit
// válido, toggle de ativação e redefinição chamam invoke('apply_shortcuts')
// e os erros individuais do núcleo voltam como feedback na linha alterada.

const { invokeMock } = vi.hoisted(() => ({
  invokeMock: vi.fn<(command: string, args?: unknown) => Promise<unknown>>().mockResolvedValue(undefined),
}))

vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }))
vi.mock('@tauri-apps/api/event', () => ({
  emit: vi.fn().mockResolvedValue(undefined),
  listen: vi.fn().mockResolvedValue(() => {}),
}))
vi.mock('@tauri-apps/api/app', () => ({ getVersion: vi.fn().mockResolvedValue('1.2.3') }))

const SHORTCUT_LABELS: Record<string, string> = {
  askOrSend: 'Perguntar/Enviar',
  captureScreen: 'Capturar Tela',
  toggleVoiceRecording: 'Gravação de Voz',
  toggleMicCapture: 'Alternar Captura do Microfone',
  pushToListen: 'Ouvir Segurando (solte para analisar)',
  scrollUp: 'Rolar Cima',
  scrollDown: 'Rolar Baixo',
  notchPreviousInsight: 'Insight Anterior do Notch',
  notchNextInsight: 'Insight Próximo do Notch',
  previousResponse: 'Resposta Anterior',
  nextResponse: 'Resposta Próxima',
  overlayScrollUp: 'Rolar Cima do Overlay',
  overlayScrollDown: 'Rolar Baixo do Overlay',
  toggleActionBar: 'Alternar Barra de Ações',
  toggleAlwaysOnTop: 'Sempre no Topo',
  increaseOpacity: 'Aumentar Opacidade',
  decreaseOpacity: 'Reduzir Opacidade',
  moveModalUp: 'Deslizar Modal Cima',
  moveModalDown: 'Deslizar Modal Baixo',
  moveModalLeft: 'Deslizar Modal Esquerda',
  moveModalRight: 'Deslizar Modal Direita',
  toggleWindowVisibility: 'Alternar Visibilidade da Janela',
}

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

function comboText(container: HTMLElement, command: string): string | undefined {
  return container.querySelector(`[data-shortcut-combo="${command}"]`)?.textContent?.trim()
}

function rowOf(container: HTMLElement, command: string): Element | null {
  return container.querySelector(`[data-shortcut-row="${command}"]`)
}

async function startRecording(container: HTMLElement, command: string): Promise<void> {
  const change = container.querySelector(`[data-shortcut-change="${command}"]`)
  if (!change) {
    throw new Error(`botão Change de ${command} não encontrado`)
  }
  await fireEvent.click(change)
}

async function pressKey(container: HTMLElement, command: string, options: KeyboardEventInit): Promise<void> {
  const row = rowOf(container, command)
  if (!row) {
    throw new Error(`linha de ${command} não encontrada`)
  }
  await fireEvent.keyDown(row, options)
}

function recordingAttr(container: HTMLElement, command: string): string | null {
  const row = rowOf(container, command)
  if (!row) {
    throw new Error(`linha de ${command} não encontrada`)
  }
  return row.getAttribute('data-shortcut-recording')
}

function shortcutChanges(actions: SettingsAction[]): Array<{ type: string; command?: unknown; binding?: unknown }> {
  return actions.filter((action) => action.type === 'shortcutChange')
}

afterEach(() => {
  cleanup()
  resetSettingsStateFeed()
  // mockReset limpa a implementação baseline — reestabelecemos o resolved
  // undefined (invoke real SEMPRE devolve Promise).
  invokeMock.mockReset().mockResolvedValue(undefined)
})

describe('Atalhos — conjunto padrão (RF-604)', () => {
  it('renderiza as 22 linhas de SHORTCUT_COMMANDS com os títulos do contrato', async () => {
    const { container } = render(Settings)
    await openTab(container, 'shortcuts')

    const rows = Array.from(container.querySelectorAll('[data-shortcut-row]'))
    expect(rows.map((row) => row.getAttribute('data-shortcut-row'))).toEqual([...SHORTCUT_COMMANDS])
    for (const command of SHORTCUT_COMMANDS) {
      expect(rowOf(container, command)?.textContent, `título de ${command}`).toContain(
        SHORTCUT_LABELS[command],
      )
    }
  })

  it('exibe os combos de DEFAULT_SHORTCUTS e "Não atribuído" para os nulos', async () => {
    const { container } = render(Settings)
    await openTab(container, 'shortcuts')

    for (const command of SHORTCUT_COMMANDS) {
      const binding = DEFAULT_SHORTCUTS[command]
      if (binding) {
        expect(comboText(container, command), `combo de ${command}`).toBe(formatCombo(binding))
      } else {
        expect(comboText(container, command), `combo de ${command}`).toBe('Não atribuído')
        expect(
          container.querySelector(`[data-shortcut-toggle="${command}"]`),
          `${command} sem binding não tem toggle`,
        ).toBeNull()
      }
    }

    // Pinos literais de combos-chave do conjunto padrão (RF-604)
    expect(comboText(container, 'askOrSend')).toBe('Cmd+Enter')
    expect(comboText(container, 'captureScreen')).toBe('Cmd+E')
    expect(comboText(container, 'toggleMicCapture')).toBe('Cmd+Shift+D')
    expect(comboText(container, 'increaseOpacity')).toBe('Cmd+Shift+=')
    expect(comboText(container, 'overlayScrollUp')).toBe('Cmd+Alt+Shift+ArrowUp')
    expect(comboText(container, 'overlayScrollDown')).toBe('Cmd+Alt+Shift+ArrowDown')
  })

  it('o estado real de atalhos entra pelo feed (combos customizados exibidos)', async () => {
    setSettingsStateFeed(() =>
      baseState({
        shortcuts: {
          ...DEFAULT_SHORTCUTS,
          askOrSend: { enabled: true, modifiers: ['Ctrl'], key: 'Q' },
        },
      }),
    )
    const { container } = render(Settings)
    await openTab(container, 'shortcuts')

    expect(comboText(container, 'askOrSend')).toBe('Ctrl+Q')
    expect(comboText(container, 'captureScreen')).toBe('Cmd+E')
  })
})

describe('Atalhos — gravação e regras espelhadas do núcleo (RF-602)', () => {
  it('Change entra em gravação; ESC cancela e preserva o binding anterior', async () => {
    const { container } = render(Settings)
    await openTab(container, 'shortcuts')

    await startRecording(container, 'toggleVoiceRecording')
    expect(recordingAttr(container, 'toggleVoiceRecording')).not.toBeNull()

    await pressKey(container, 'toggleVoiceRecording', { key: 'Escape' })

    expect(recordingAttr(container, 'toggleVoiceRecording')).toBeNull()
    expect(comboText(container, 'toggleVoiceRecording')).toBe('Cmd+D')
    expect(
      container.querySelector('[data-shortcut-error="toggleVoiceRecording"]'),
      'ESC não gera erro',
    ).toBeNull()
  })

  it('teclas de modificador sozinhas não encerram a gravação', async () => {
    const { container } = render(Settings)
    await openTab(container, 'shortcuts')

    await startRecording(container, 'toggleVoiceRecording')
    await pressKey(container, 'toggleVoiceRecording', { key: 'Meta', metaKey: true })

    expect(recordingAttr(container, 'toggleVoiceRecording')).not.toBeNull()
  })

  it('rejeita tecla sem modificador: feedback e binding anterior preservado', async () => {
    const actions: SettingsAction[] = []
    const unsubscribe = onSettingsAction((action: SettingsAction) => actions.push(action))
    const { container } = render(Settings)
    await openTab(container, 'shortcuts')

    await startRecording(container, 'toggleVoiceRecording')
    await pressKey(container, 'toggleVoiceRecording', { key: 'X' })

    const error = container.querySelector('[data-shortcut-error="toggleVoiceRecording"]')
    expect(error?.textContent).toMatch(/modificador/i)
    expect(comboText(container, 'toggleVoiceRecording')).toBe('Cmd+D')
    expect(shortcutChanges(actions)).toEqual([])
    unsubscribe()
  })

  it('rejeita Shift sozinho (RF-602 exige Cmd/Ctrl ou Alt — espelho do núcleo)', async () => {
    const { container } = render(Settings)
    await openTab(container, 'shortcuts')

    await startRecording(container, 'toggleVoiceRecording')
    await pressKey(container, 'toggleVoiceRecording', { key: 'A', shiftKey: true })

    const error = container.querySelector('[data-shortcut-error="toggleVoiceRecording"]')
    expect(error?.textContent).toMatch(/modificador/i)
    expect(comboText(container, 'toggleVoiceRecording')).toBe('Cmd+D')
  })

  it('rejeita combo duplicado de outro comando: feedback e sem despacho', async () => {
    const actions: SettingsAction[] = []
    const unsubscribe = onSettingsAction((action: SettingsAction) => actions.push(action))
    const { container } = render(Settings)
    await openTab(container, 'shortcuts')

    await startRecording(container, 'toggleVoiceRecording')
    await pressKey(container, 'toggleVoiceRecording', { key: 'E', metaKey: true })

    const error = container.querySelector('[data-shortcut-error="toggleVoiceRecording"]')
    expect(error?.textContent).toMatch(/duplic/i)
    expect(comboText(container, 'toggleVoiceRecording')).toBe('Cmd+D')
    expect(shortcutChanges(actions)).toEqual([])
    unsubscribe()
  })

  it('aceita CapsLock sem modificador (ALLOWED_MODIFIERLESS_KEYS) com efeito imediato', async () => {
    const actions: SettingsAction[] = []
    const unsubscribe = onSettingsAction((action: SettingsAction) => actions.push(action))
    const { container } = render(Settings)
    await openTab(container, 'shortcuts')

    await startRecording(container, 'askOrSend')
    await pressKey(container, 'askOrSend', { key: 'CapsLock' })

    expect(comboText(container, 'askOrSend')).toBe('CapsLock')
    expect(shortcutChanges(actions)).toEqual([
      {
        type: 'shortcutChange',
        command: 'askOrSend',
        binding: { enabled: true, modifiers: [], key: 'CapsLock' },
      },
    ])
    unsubscribe()
  })

  it('commit válido aplica o combo imediatamente e despacha shortcutChange', async () => {
    const actions: SettingsAction[] = []
    const unsubscribe = onSettingsAction((action: SettingsAction) => actions.push(action))
    const { container } = render(Settings)
    await openTab(container, 'shortcuts')

    await startRecording(container, 'toggleVoiceRecording')
    await pressKey(container, 'toggleVoiceRecording', { key: 'R', metaKey: true })

    expect(comboText(container, 'toggleVoiceRecording')).toBe('Cmd+R')
    expect(
      container.querySelector('[data-shortcut-error="toggleVoiceRecording"]'),
    ).toBeNull()
    expect(shortcutChanges(actions)).toEqual([
      {
        type: 'shortcutChange',
        command: 'toggleVoiceRecording',
        binding: { enabled: true, modifiers: ['Cmd'], key: 'R' },
      },
    ])
    unsubscribe()
  })

  it('binding desativado em outro comando não conta como duplicata (espelho do núcleo)', async () => {
    const actions: SettingsAction[] = []
    const unsubscribe = onSettingsAction((action: SettingsAction) => actions.push(action))
    const { container } = render(Settings)
    await openTab(container, 'shortcuts')

    // Desativa captureScreen (Cmd+E) pelo toggle — RF-601
    const toggle = container.querySelector(
      '[data-shortcut-toggle="captureScreen"]',
    ) as HTMLInputElement
    if (!toggle) {
      throw new Error('toggle de captureScreen não encontrado')
    }
    expect(toggle.checked).toBe(true)
    await fireEvent.click(toggle)
    expect(shortcutChanges(actions)).toEqual([
      {
        type: 'shortcutChange',
        command: 'captureScreen',
        binding: { enabled: false, modifiers: ['Cmd'], key: 'E' },
      },
    ])

    // Cmd+E agora está livre: toggleVoiceRecording pode tomá-lo
    await startRecording(container, 'toggleVoiceRecording')
    await pressKey(container, 'toggleVoiceRecording', { key: 'E', metaKey: true })

    expect(
      container.querySelector('[data-shortcut-error="toggleVoiceRecording"]'),
      'nenhum erro de duplicata com binding desativado',
    ).toBeNull()
    expect(comboText(container, 'toggleVoiceRecording')).toBe('Cmd+E')
    expect(shortcutChanges(actions)).toHaveLength(2)
    unsubscribe()
  })
})

describe('Atalhos — Redefinir Todos para Padrões (RF-601)', () => {
  it('restaura DEFAULT_SHORTCUTS e despacha shortcutReset pela fronteira declarada', async () => {
    setSettingsStateFeed(() =>
      baseState({
        shortcuts: {
          ...DEFAULT_SHORTCUTS,
          askOrSend: { enabled: true, modifiers: ['Ctrl'], key: 'Q' },
          captureScreen: { enabled: false, modifiers: ['Alt'], key: 'X' },
        },
      }),
    )
    const actions: SettingsAction[] = []
    const unsubscribe = onSettingsAction((action: SettingsAction) => actions.push(action))
    const { container } = render(Settings)
    await openTab(container, 'shortcuts')

    expect(comboText(container, 'askOrSend')).toBe('Ctrl+Q')

    const reset = container.querySelector('[data-shortcut-reset]')
    if (!reset) {
      throw new Error('botão Redefinir Todos para Padrões não encontrado')
    }
    expect(reset.textContent?.trim()).toBe('Redefinir Todos para Padrões')
    await fireEvent.click(reset)

    expect(actions).toEqual([{ type: 'shortcutReset' }])
    expect(comboText(container, 'askOrSend')).toBe('Cmd+Enter')
    expect(comboText(container, 'captureScreen')).toBe('Cmd+E')
    // Comandos core registrados (core/src/lib.rs) são permitidos; a regra
    // proíbe inventar nomes fora do contrato (general.md).
    const calledCommands = invokeMock.mock.calls.map((call) => call[0])
    for (const command of calledCommands) {
      expect(
        [
          'get_provider_statuses',
          'get_permission_status',
          'get_shortcuts',
          'get_app_settings',
          'apply_shortcuts',
        ],
        `comando não registrado: ${command}`,
      ).toContain(command)
    }
    unsubscribe()
  })

  it('Redefinir aplica o conjunto PADRÃO no core (apply_shortcuts)', async () => {
    setSettingsStateFeed(() =>
      baseState({
        shortcuts: {
          ...DEFAULT_SHORTCUTS,
          askOrSend: { enabled: true, modifiers: ['Ctrl'], key: 'Q' },
        },
      }),
    )
    const { container } = render(Settings)
    await openTab(container, 'shortcuts')

    const reset = container.querySelector('[data-shortcut-reset]')
    if (!reset) {
      throw new Error('botão Redefinir Todos para Padrões não encontrado')
    }
    await fireEvent.click(reset)

    const applyCall = invokeMock.mock.calls.find((call) => call[0] === 'apply_shortcuts')
    expect(applyCall, 'reset deve aplicar no core').toBeDefined()
    expect((applyCall?.[1] as { bindings: ShortcutMap }).bindings).toEqual(DEFAULT_SHORTCUTS)
  })
})

describe('Atalhos — aplicação no SO via core (apply_shortcuts)', () => {
  it('commit válido despacha shortcutChange E aplica o mapa corrente no core', async () => {
    const { container } = render(Settings)
    await openTab(container, 'shortcuts')

    await startRecording(container, 'toggleVoiceRecording')
    await pressKey(container, 'toggleVoiceRecording', { key: 'R', metaKey: true })

    const applyCall = invokeMock.mock.calls.find((call) => call[0] === 'apply_shortcuts')
    expect(applyCall, 'commit válido deve chamar apply_shortcuts').toBeDefined()
    const bindings = (applyCall?.[1] as { bindings: ShortcutMap }).bindings
    expect(bindings.toggleVoiceRecording).toEqual({
      enabled: true,
      modifiers: ['Cmd'],
      key: 'R',
    })
    // O mapa completo vai junto (o core registra tudo de uma vez)
    expect(Object.keys(bindings)).toEqual([...SHORTCUT_COMMANDS])
  })

  it('toggle de ativação também aplica o mapa no core (RF-601)', async () => {
    const { container } = render(Settings)
    await openTab(container, 'shortcuts')

    const toggle = container.querySelector(
      '[data-shortcut-toggle="captureScreen"]',
    ) as HTMLInputElement
    if (!toggle) {
      throw new Error('toggle de captureScreen não encontrado')
    }
    await fireEvent.click(toggle)

    const applyCall = invokeMock.mock.calls.find((call) => call[0] === 'apply_shortcuts')
    expect(applyCall, 'toggle deve chamar apply_shortcuts').toBeDefined()
    expect((applyCall?.[1] as { bindings: ShortcutMap }).bindings.captureScreen).toEqual({
      enabled: false,
      modifiers: ['Cmd'],
      key: 'E',
    })
  })

  it('erros do núcleo em apply_shortcuts viram feedback na linha alterada', async () => {
    invokeMock.mockImplementation(async (command: string) =>
      command === 'apply_shortcuts'
        ? { errors: ['combo já registrado pelo sistema: Cmd+R'] }
        : undefined,
    )
    const { container } = render(Settings)
    await openTab(container, 'shortcuts')

    await startRecording(container, 'toggleVoiceRecording')
    await pressKey(container, 'toggleVoiceRecording', { key: 'R', metaKey: true })

    await waitFor(() => {
      expect(
        container.querySelector('[data-shortcut-error="toggleVoiceRecording"]')?.textContent,
      ).toContain('combo já registrado')
    })
  })

  it('combo inválido (espelho local) não chega a chamar apply_shortcuts', async () => {
    const { container } = render(Settings)
    await openTab(container, 'shortcuts')

    await startRecording(container, 'toggleVoiceRecording')
    await pressKey(container, 'toggleVoiceRecording', { key: 'X' })

    expect(
      invokeMock.mock.calls.some((call) => call[0] === 'apply_shortcuts'),
      'validação local falhou — nada a aplicar',
    ).toBe(false)
  })
})
