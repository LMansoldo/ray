import { describe, it, expect } from 'vitest'
import { renderMarkdown } from './markdown'

// Contrato T-408 / ADR-011: renderizador Markdown read-only e leve para
// exibir respostas do agente em streaming (card "DIGA ISSO", Notch, resumos).
// Entrada: string Markdown (possivelmente parcial, no meio de um token).
// Saída: HTML com syntax highlight. O texto cru de um bloco de código
// sobrevive byte a byte (SCOPE.md: "a code block survives a render cycle
// unchanged").

// Fixture compartilhada: multiplas linhas, unicode, caracteres HTML-especiais
// e um token destacável (keyword + string). A cerca de fechamento deixa uma
// quebra de linha no conteudo (CommonMark), por isso o esperado e CODE + '\n'.
const CODE = `const x = "olá"; // <&>\nfunction f(): void {\n  return x\n}`
const FENCED = '```ts\n' + CODE + '\n```'

function parseMarkdown(source: string): HTMLElement {
  const container = document.createElement('div')
  container.innerHTML = renderMarkdown(source)
  return container
}

function codeBlockOf(source: string): { pre: HTMLElement; code: HTMLElement } {
  const container = parseMarkdown(source)
  const pre = container.querySelector<HTMLElement>('pre')
  const code = container.querySelector<HTMLElement>('pre > code')
  expect(pre, 'o bloco de código deve renderizar dentro de <pre>').not.toBeNull()
  expect(code, 'o bloco de código deve renderizar dentro de <pre><code>').not.toBeNull()
  return { pre: pre!, code: code! }
}

describe('renderMarkdown — entrada vazia', () => {
  it('retorna string vazia para entrada vazia', () => {
    expect(renderMarkdown('')).toBe('')
  })
})

describe('renderMarkdown — CommonMark básico', () => {
  it('renderiza títulos', () => {
    const container = parseMarkdown('# Título\n\n## Subtítulo')
    expect(container.querySelector('h1')?.textContent).toBe('Título')
    expect(container.querySelector('h2')?.textContent).toBe('Subtítulo')
  })

  it('renderiza ênfase', () => {
    const container = parseMarkdown('**forte** e *itálico*')
    expect(container.querySelector('strong')?.textContent).toBe('forte')
    expect(container.querySelector('em')?.textContent).toBe('itálico')
  })

  it('renderiza links', () => {
    const container = parseMarkdown('[Rótulo](https://exemplo.com)')
    const link = container.querySelector('a')
    expect(link?.getAttribute('href')).toBe('https://exemplo.com')
    expect(link?.textContent).toBe('Rótulo')
  })

  it('renderiza listas ordenadas e não ordenadas', () => {
    const container = parseMarkdown('- um\n- dois\n\n1. primeiro\n2. segundo')
    expect(container.querySelectorAll('ul li').length).toBe(2)
    expect(container.querySelectorAll('ol li').length).toBe(2)
  })

  it('renderiza código inline sem envolver em <pre>', () => {
    const container = parseMarkdown('use `x` aqui')
    expect(container.querySelector('pre')).toBeNull()
    expect(container.querySelector('code')?.textContent).toBe('x')
  })

  it('renderiza citações', () => {
    const container = parseMarkdown('> citação importante')
    expect(container.querySelector('blockquote')?.textContent).toContain('citação importante')
  })

  it('renderiza texto riscado (GFM)', () => {
    const container = parseMarkdown('~~riscado~~')
    expect(container.querySelector('del')?.textContent).toBe('riscado')
  })
})

describe('renderMarkdown — blocos de código com highlight (contrato T-408)', () => {
  it('preserva o texto cru byte a byte (SCOPE.md: render cycle unchanged)', () => {
    const { code } = codeBlockOf(FENCED)
    expect(code.textContent).toBe(CODE + '\n')
  })

  it('preserva a linguagem da cerca', () => {
    const { code } = codeBlockOf(FENCED)
    expect(code.className).toContain('language-ts')
  })

  it('destaca tokens com spans (keyword e string)', () => {
    const { code } = codeBlockOf('```js\nconst greeting = "olá";\n```')
    const tokenTexts = Array.from(code.querySelectorAll('span[class]')).map(
      (span) => span.textContent,
    )
    expect(tokenTexts.length).toBeGreaterThan(0)
    expect(tokenTexts).toContain('const')
    expect(tokenTexts).toContain('"olá"')
  })
})

describe('renderMarkdown — streaming (tokens parciais, ADR-011)', () => {
  it('não quebra com marcações incompletas no meio de um token', () => {
    const partials = [
      '```',
      '```js',
      '```js\nconst x =',
      '```js\n```',
      '### título **incompleto',
      '> citação',
      '- item',
      '1. item',
      '~~corte',
      '[link](',
      '`código',
    ]
    for (const partial of partials) {
      expect(() => renderMarkdown(partial), `parcial quebrou: ${partial}`).not.toThrow()
      expect(renderMarkdown(partial)).toBeTypeOf('string')
    }
  })

  it('acumula tokens incrementais e fecha o bloco com highlight', () => {
    const tokens = ['```js', '\nconst', ' x =', ' "olá";', '\n```']
    let buffer = ''
    for (const token of tokens) {
      buffer += token
      expect(() => renderMarkdown(buffer), `acúmulo quebrou em: ${buffer}`).not.toThrow()
    }
    const { code } = codeBlockOf(buffer)
    expect(code.textContent).toBe('const x = "olá";\n')
    const tokenTexts = Array.from(code.querySelectorAll('span[class]')).map(
      (span) => span.textContent,
    )
    expect(tokenTexts).toContain('"olá"')
  })
})
