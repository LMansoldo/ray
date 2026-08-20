import { describe, it, expect, afterEach } from 'vitest'
import { render, cleanup } from '@testing-library/svelte'
import MarkdownView from './MarkdownView.svelte'

// Contrato T-408 / ADR-011: view read-only para streaming. Deve atualizar o
// conteúdo a cada token SEM remontar a raiz (remontar a cada token seria o
// peso que o ADR manda evitar — "NÃO usar o editor completo para exibir
// tokens ao vivo") e NUNCA montar o editor Milkdown: as duas peças são
// separadas.

const CODE = `const x = "olá"; // <&>\nfunction f(): void {\n  return x\n}`
const FENCED = '```ts\n' + CODE + '\n```'

function rootOf(container: HTMLElement): HTMLElement {
  const root = container.querySelector<HTMLElement>('[data-markdown-view]')
  expect(root, 'a view deve marcar a raiz com data-markdown-view').not.toBeNull()
  return root!
}

afterEach(() => {
  cleanup()
})

describe('MarkdownView — renderização', () => {
  it('renderiza markdown simples', () => {
    const { container, getByText } = render(MarkdownView, { props: { markdown: 'Olá' } })
    expect(rootOf(container)).toBeInstanceOf(HTMLElement)
    expect(getByText('Olá')).toBeDefined()
  })

  it('renderiza bloco de código com highlight (read-only)', () => {
    const { container } = render(MarkdownView, { props: { markdown: FENCED } })
    const code = container.querySelector('pre > code')
    expect(code, 'o bloco de código deve renderizar com highlight').not.toBeNull()
    expect(code!.textContent).toBe(CODE + '\n')
    const tokenSpans = code!.querySelectorAll('span[class]')
    expect(tokenSpans.length).toBeGreaterThan(0)
  })

  it('nunca monta o editor Milkdown (ADR-011: peças separadas)', () => {
    const { container } = render(MarkdownView, { props: { markdown: FENCED } })
    expect(container.querySelector('.ProseMirror')).toBeNull()
    expect(container.querySelector('[data-markdown-editor]')).toBeNull()
  })
})

describe('MarkdownView — streaming sem remontagem', () => {
  it('atualiza o conteúdo mantendo a mesma raiz (sem remount)', async () => {
    const { container, rerender } = render(MarkdownView, { props: { markdown: 'Olá' } })
    const before = rootOf(container)

    await rerender({ markdown: 'Olá, **mundo**' })

    expect(rootOf(container)).toBe(before)
    expect(container.querySelector('strong')?.textContent).toBe('mundo')
  })

  it('recebe um fluxo de tokens parciais sem remontar e com highlight ao final', async () => {
    const { container, rerender } = render(MarkdownView, { props: { markdown: '' } })
    const before = rootOf(container)
    const tokens = ['```js', '\nconst', ' x =', ' "olá";', '\n```']

    let buffer = ''
    for (const token of tokens) {
      buffer += token
      await rerender({ markdown: buffer })
      expect(rootOf(container)).toBe(before)
    }

    const code = container.querySelector('pre > code')
    expect(code, 'o bloco deve fechar com highlight ao fim do fluxo').not.toBeNull()
    expect(code!.textContent).toBe('const x = "olá";\n')
    expect(code!.querySelectorAll('span[class]').length).toBeGreaterThan(0)
  })
})
