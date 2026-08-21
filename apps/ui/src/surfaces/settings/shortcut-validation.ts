// Espelho UI das regras de validação de atalhos do núcleo (core/src/shortcuts.rs
// validate_binding + combo_string, T-305). A UI ESPELHA as regras para dar
// feedback antes de despachar — não re-dona a enforcement, que é do núcleo
// (RF-602 / CA-8):
//   - modificador válido = Cmd | Ctrl | Alt (Shift sozinho NÃO basta);
//   - sem modificador só se key ∈ ALLOWED_MODIFIERLESS_KEYS (CapsLock);
//   - duplicata = mesmo combo em OUTRO comando com binding enabled
//     (bindings disabled ou null não contam; rebindar o MESMO comando para o
//     MESMO combo não é duplicata).
// Os erros espelham os variants de core::ShortcutError.
import { ALLOWED_MODIFIERLESS_KEYS } from '../../../../../contracts/settings'
import type {
  ShortcutBinding,
  ShortcutCommand,
  ShortcutMap,
  ShortcutModifier,
} from '../../../../../contracts/settings'

/** Ordem canônica dos modificadores — igual ao core combo_string. */
const MODIFIER_ORDER: readonly ShortcutModifier[] = ['Cmd', 'Ctrl', 'Alt', 'Shift']

/**
 * Monta a string de combo na ordem canônica (ex.: "Cmd+Shift+A",
 * "Cmd+Enter", "CapsLock") — espelho do core combo_string.
 */
export function formatCombo(binding: ShortcutBinding): string {
  const parts: string[] = []
  for (const modifier of MODIFIER_ORDER) {
    if (binding.modifiers.includes(modifier)) {
      parts.push(modifier)
    }
  }
  parts.push(binding.key)
  return parts.join('+')
}

/** Erros de validação — espelham os variants de core::ShortcutError. */
export type ShortcutValidationError =
  | { kind: 'missingModifier' }
  | { kind: 'duplicateCombo' }

/**
 * Valida uma tentativa de mudança de atalho contra o mapa corrente — espelho
 * do core validate_binding. Retorna null quando o binding é aceito.
 */
export function validateShortcutChange(
  command: ShortcutCommand,
  binding: ShortcutBinding,
  map: ShortcutMap,
): ShortcutValidationError | null {
  const hasValidModifier = binding.modifiers.some(
    (modifier) => modifier === 'Cmd' || modifier === 'Ctrl' || modifier === 'Alt',
  )
  const isModifierlessAllowed = (ALLOWED_MODIFIERLESS_KEYS as readonly string[]).includes(
    binding.key,
  )

  if (!hasValidModifier && !isModifierlessAllowed) {
    return { kind: 'missingModifier' }
  }

  const newCombo = formatCombo(binding)
  for (const [otherCommand, otherBinding] of Object.entries(map)) {
    if (otherCommand === command) {
      continue
    }
    if (!otherBinding || !otherBinding.enabled) {
      continue
    }
    if (formatCombo(otherBinding) === newCombo) {
      return { kind: 'duplicateCombo' }
    }
  }

  return null
}
