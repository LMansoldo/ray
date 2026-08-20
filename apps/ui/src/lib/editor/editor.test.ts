import { describe, it, expect, vi, afterEach } from 'vitest'
import { createMarkdownEditor, type MarkdownEditorHandle } from './editor'

// Contrato T-408 / ADR-011: o editor Milkdown (ProseMirror + remark) recebe
// Markdown e devolve Markdown — SEM round-trip para HTML (o modelo interno do
// Milkdown já é Markdown). Um bloco de código deve sobreviver ao round-trip de
// edição e leitura byte a byte (SCOPE.md: "a code block survives a render
// cycle unchanged"). A fiação é a API core do Milkdown (Editor.make()
// apontado a um nó do DOM) — headless, sem framework (frontend.md).

// Fixture compartilhada: multiplas linhas, unicode e caracteres
// HTML-especiais. A cerca de fechamento deixa uma quebra de linha no conteudo
// (CommonMark), por isso o esperado e CODE + '\n'.
const CODE = `const x = "olá"; // <&>\nfunction f(): void {\n  return x\n}`
const FENCED = '```ts\n' + CODE + '\n```'

function extractCodeBlock(markdown: string): string {
  const match = markdown.match(/```ts\n([\s\S]*?)```/)
  expect(match, 'o markdown deve conter um bloco de código ```ts').not.toBeNull()
  return match![1]
}

const createdRoots: HTMLElement[] = []
const createdHandles: MarkdownEditorHandle[] = []

async function mountEditor(): Promise<{ root: HTMLElement; handle: MarkdownEditorHandle }> {
  const root = document.createElement('div')
  document.body.appendChild(root)
  createdRoots.push(root)
  const handle = await createMarkdownEditor(root)
  createdHandles.push(handle)
  return { root, handle }
}

afterEach(() => {
  for (const handle of createdHandles) {
    if (!handle.view.isDestroyed) {
      handle.destroy()
    }
  }
  createdHandles.length = 0
  for (const root of createdRoots) {
    root.remove()
  }
  createdRoots.length = 0
})

describe('createMarkdownEditor — montagem headless', () => {
  it('monta o editor ProseMirror dentro do nó fornecido (Editor.make -> DOM node)', async () => {
    const { root } = await mountEditor()
    await vi.waitFor(
      () => {
        expect(
          root.querySelector('.ProseMirror'),
          'o editor deve montar .ProseMirror dentro do nó',
        ).not.toBeNull()
      },
      { timeout: 5000 },
    )
  })
})

describe('createMarkdownEditor — round-trip Markdown fiel (sem HTML)', () => {
  it('setMarkdown + getMarkdown preserva o bloco de código byte a byte', async () => {
    const { handle } = await mountEditor()
    handle.setMarkdown(FENCED)
    const markdown = handle.getMarkdown()
    expect(markdown).toContain('```ts')
    expect(extractCodeBlock(markdown)).toBe(CODE + '\n')
  })

  it('uma edição no modelo ProseMirror não corrompe o bloco de código', async () => {
    const { handle } = await mountEditor()
    handle.setMarkdown('Intro\n\n' + FENCED)
    const view = handle.view
    view.dispatch(view.state.tr.insertText('Editado: ', 1))
    const markdown = handle.getMarkdown()
    expect(markdown).toContain('Editado: Intro')
    expect(extractCodeBlock(markdown)).toBe(CODE + '\n')
  })

  it('setMarkdown substitui o documento inteiro', async () => {
    const { handle } = await mountEditor()
    handle.setMarkdown(FENCED)
    handle.setMarkdown('Novo conteúdo\n')
    const markdown = handle.getMarkdown()
    expect(markdown).toContain('Novo conteúdo')
    expect(markdown).not.toContain('olá')
  })
})

describe('createMarkdownEditor — ciclo de vida', () => {
  it('destroy encerra o editor ProseMirror', async () => {
    const { handle } = await mountEditor()
    handle.destroy()
    expect(handle.view.isDestroyed).toBe(true)
  })
})
