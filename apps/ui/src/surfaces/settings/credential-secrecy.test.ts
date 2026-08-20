import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, cleanup, fireEvent } from '@testing-library/svelte'
import Settings from './Settings.svelte'
import { onSettingsAction } from './settings-actions'
import type { SettingsAction } from './settings-actions'

// Contrato T-406 / ADR-003 / general.md (Secrets): o segredo digitado num
// campo BYOK aparece APENAS dentro do próprio campo de entrada e cruza a
// fronteira declarada (canal settings-actions) exatamente uma vez. A UI
// nunca loga, persiste ou renderiza o valor em outro lugar — o núcleo Rust é
// o único dono de segredos reais (vault). Este teste pina esse invariante
// com espiões em console e Storage: se o GREEN logar ou persistir o segredo,
// falha aqui.

const SECRET = 'sk-test-secret-123'

function typeKey(container: HTMLElement): void {
  const input = container.querySelector('[data-provider-key-input="deepseek"]')
  if (!input) {
    throw new Error('campo de chave do DeepSeek não encontrado')
  }
  fireEvent.input(input, { target: { value: SECRET } })
}

function clickSave(container: HTMLElement): void {
  const save = container.querySelector('[data-provider-save="deepseek"]')
  if (!save) {
    throw new Error('botão Salvar do DeepSeek não encontrado')
  }
  fireEvent.click(save)
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('segredo BYOK — invariante ADR-003 na UI', () => {
  it('o segredo digitado nunca é registrado em log (console.log/warn/error)', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})

    const actions: SettingsAction[] = []
    const unsubscribe = onSettingsAction((action: SettingsAction) => actions.push(action))
    const { container } = render(Settings)

    typeKey(container)
    clickSave(container)

    for (const spy of [log, warn, error]) {
      const serialized = spy.mock.calls.map((args) => args.map(String).join(' ')).join(' ')
      expect(serialized, 'nenhum log pode conter o segredo').not.toContain(SECRET)
    }
    expect(actions).toHaveLength(1)
    unsubscribe()
  })

  it('o segredo digitado nunca é persistido (localStorage/sessionStorage)', () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem')

    const actions: SettingsAction[] = []
    const unsubscribe = onSettingsAction((action: SettingsAction) => actions.push(action))
    const { container } = render(Settings)

    typeKey(container)
    clickSave(container)

    expect(setItem, 'a UI nunca persiste nada em Storage').not.toHaveBeenCalled()
    expect(document.cookie, 'a UI nunca escreve cookies').toBe('')
    expect(actions).toHaveLength(1)
    unsubscribe()
  })

  it('o segredo digitado aparece apenas dentro do próprio campo de entrada', () => {
    const { container } = render(Settings)

    typeKey(container)
    clickSave(container)

    expect(
      container.textContent,
      'nenhum texto fora do input pode conter o segredo',
    ).not.toContain(SECRET)

    const own = container.querySelector('[data-provider-key-input="deepseek"]') as HTMLInputElement
    expect(own.value, 'o campo de origem mantém o valor digitado').toBe(SECRET)

    for (const input of Array.from(container.querySelectorAll('input'))) {
      if (input !== own) {
        expect(
          (input as HTMLInputElement).value,
          `input ${input.getAttribute('data-provider-key-input') ?? ''} não pode conter o segredo`,
        ).not.toBe(SECRET)
      }
    }

    for (const element of Array.from(container.querySelectorAll('*'))) {
      for (const attr of Array.from(element.attributes)) {
        expect(
          attr.value,
          `atributo ${attr.name} de ${element.tagName} não pode conter o segredo`,
        ).not.toContain(SECRET)
      }
    }
  })
})
