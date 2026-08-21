import { describe, it, expect } from 'vitest'
import { formatCombo, validateShortcutChange } from './shortcut-validation'
import {
  DEFAULT_SHORTCUTS,
  ALLOWED_MODIFIERLESS_KEYS,
} from '../../../../../contracts/settings'
import type { ShortcutBinding, ShortcutMap } from '../../../../../contracts/settings'

// Contrato T-406 / RF-602: o espelho UI das regras de validação do núcleo
// (core/src/shortcuts.rs validate_binding, T-305). A UI ESPELHA as regras
// para dar feedback antes de despachar — não re-dona a enforcement, que é do
// núcleo. Cada regra aqui pina o comportamento exato dos testes Rust:
// - modificador válido = Cmd | Ctrl | Alt (Shift sozinho NÃO basta);
// - sem modificador só se key ∈ ALLOWED_MODIFIERLESS_KEYS (CapsLock);
// - duplicata = mesmo combo em OUTRO comando com binding enabled
//   (bindings disabled ou null não contam; rebindar o MESMO comando para o
//   MESMO combo não é duplicata).
// O erro espelha os variants de core::ShortcutError.

function binding(modifiers: ShortcutBinding['modifiers'], key: string, enabled = true): ShortcutBinding {
  return { enabled, modifiers, key }
}

describe('formatCombo — ordem canônica dos modificadores (core combo_string)', () => {
  it('ordena Cmd, Ctrl, Alt, Shift independente da ordem recebida', () => {
    expect(formatCombo(binding(['Shift', 'Cmd'], 'A'))).toBe('Cmd+Shift+A')
    expect(formatCombo(binding(['Alt', 'Ctrl'], 'E'))).toBe('Ctrl+Alt+E')
  })

  it('formata modificador único e tecla sem modificador', () => {
    expect(formatCombo(binding(['Cmd'], 'Enter'))).toBe('Cmd+Enter')
    expect(formatCombo(binding([], 'CapsLock'))).toBe('CapsLock')
  })
})

describe('validateShortcutChange — regra do modificador (core: MissingModifier)', () => {
  const emptyMap: ShortcutMap = DEFAULT_SHORTCUTS
  const mapWithoutAskOrSend = Object.fromEntries(
    Object.entries(DEFAULT_SHORTCUTS).filter(([command]) => command !== 'askOrSend'),
  ) as unknown as ShortcutMap

  it('rejeita binding sem modificador (core: binding_without_modifier_is_rejected)', () => {
    expect(validateShortcutChange('askOrSend', binding([], 'A'), mapWithoutAskOrSend)).toEqual({
      kind: 'missingModifier',
    })
  })

  it('rejeita Shift sozinho — RF-602 exige Cmd/Ctrl ou Alt (core: shift_only)', () => {
    expect(validateShortcutChange('askOrSend', binding(['Shift'], 'A'), mapWithoutAskOrSend)).toEqual({
      kind: 'missingModifier',
    })
  })

  it('aceita Cmd, Ctrl e Alt como modificadores válidos (core: cmd/ctrl/alt accepted)', () => {
    expect(validateShortcutChange('captureScreen', binding(['Cmd'], 'Enter'), mapWithoutAskOrSend)).toBeNull()
    expect(validateShortcutChange('captureScreen', binding(['Ctrl'], 'Enter'), mapWithoutAskOrSend)).toBeNull()
    expect(validateShortcutChange('captureScreen', binding(['Alt'], 'Enter'), mapWithoutAskOrSend)).toBeNull()
  })

  it('aceita CapsLock sem modificador — ALLOWED_MODIFIERLESS_KEYS (core: capslock)', () => {
    expect(ALLOWED_MODIFIERLESS_KEYS).toEqual(['CapsLock'])
    expect(
      validateShortcutChange('toggleVoiceRecording', binding([], 'CapsLock'), emptyMap),
    ).toBeNull()
  })
})

describe('validateShortcutChange — regra de duplicatas (core: DuplicateCombo)', () => {
  it('rejeita combo já vinculado a outro comando enabled (core: duplicate_combo)', () => {
    // askOrSend = Cmd+Enter no DEFAULT_SHORTCUTS; tentar o mesmo combo em outro comando
    expect(
      validateShortcutChange('captureScreen', binding(['Cmd'], 'Enter'), DEFAULT_SHORTCUTS),
    ).toEqual({ kind: 'duplicateCombo' })
  })

  it('rebindar o MESMO comando para o MESMO combo não é duplicata (core: same_command)', () => {
    expect(
      validateShortcutChange('askOrSend', binding(['Cmd'], 'Enter'), DEFAULT_SHORTCUTS),
    ).toBeNull()
  })

  it('binding disabled em outro comando não bloqueia o combo (core: disabled_not_checked)', () => {
    const map: ShortcutMap = {
      ...DEFAULT_SHORTCUTS,
      askOrSend: binding(['Cmd'], 'Enter', false),
    }
    expect(validateShortcutChange('captureScreen', binding(['Cmd'], 'Enter'), map)).toBeNull()
  })

  it('comando não atribuído (null) não bloqueia o combo', () => {
    // moveModalLeft é null no DEFAULT_SHORTCUTS; Cmd+Enter segue sendo do askOrSend
    expect(
      validateShortcutChange('moveModalLeft', binding(['Cmd'], 'Enter'), DEFAULT_SHORTCUTS),
    ).toEqual({ kind: 'duplicateCombo' })
    // e um combo livre em um comando null é aceito
    expect(
      validateShortcutChange('moveModalLeft', binding(['Cmd'], 'N'), DEFAULT_SHORTCUTS),
    ).toBeNull()
  })
})
