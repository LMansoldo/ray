import { describe, it, expect, vi, afterEach, type Mock } from 'vitest'
import { render, cleanup, waitFor } from '@testing-library/svelte'
import MarkdownEditor from './MarkdownEditor.svelte'
import type { MarkdownEditorHandle } from './editor'

// Contrato T-408 / ADR-011: invólucro Svelte 5 do editor Milkdown. Props:
// `markdown` ($bindable — entrada E saída são Markdown, sem round-trip para
// HTML) e `onready` (entrega o handle do editor). Headless: raiz marcada com
// data-markdown-editor, sem bloco de estilo embutido — a estilização vem dos
// tokens Liquid Glass (T-400).

const CODE = `const x = "olá"; // <&>\nfunction f(): void {\n  return x\n}`
const FENCED = '```ts\n' + CODE + '\n```'
const INITIAL = 'Intro\n\n' + FENCED

type MarkdownChangeMock = Mock<(markdown: string) => void>

function extractCodeBlock(markdown: string): string {
  const match = markdown.match(/```ts\n([\s\S]*?)```/)
  expect(match, 'o markdown deve conter um bloco de código ```ts').not.toBeNull()
  return match![1]
}

function lastChange(mock: MarkdownChangeMock): string {
  const last = mock.mock.lastCall
  expect(last, 'o editor deve propagar o markdown atualizado').toBeDefined()
  return last![0]
}

async function mountEditor(
  markdown: string,
  onmarkdownchange: MarkdownChangeMock = vi.fn<(markdown: string) => void>(),
) {
  let readyHandle: MarkdownEditorHandle | null = null
  const result = render(MarkdownEditor, {
    props: {
      markdown,
      onready: (handle: MarkdownEditorHandle) => {
        readyHandle = handle
      },
      onmarkdownchange,
    },
  })
  await waitFor(
    () => {
      expect(readyHandle, 'o componente deve entregar o handle via onready').not.toBeNull()
    },
    { timeout: 5000 },
  )
  await waitFor(
    () => {
      expect(result.container.querySelector('.ProseMirror')).not.toBeNull()
    },
    { timeout: 5000 },
  )
  return { ...result, handle: readyHandle!, onmarkdownchange }
}

afterEach(() => {
  cleanup()
})

describe('MarkdownEditor — contrato do componente', () => {
  it('monta o editor Milkdown na raiz marcada com o markdown inicial', async () => {
    const { container, handle } = await mountEditor(INITIAL)
    const root = container.querySelector<HTMLElement>('[data-markdown-editor]')
    expect(root, 'o editor deve marcar a raiz com data-markdown-editor').not.toBeNull()
    expect(root!.querySelector('.ProseMirror')).not.toBeNull()
    await waitFor(
      () => {
        expect(extractCodeBlock(handle.getMarkdown())).toBe(CODE + '\n')
      },
      { timeout: 5000 },
    )
  })

  it('é headless: a raiz não embute CSS próprio', async () => {
    const { container } = await mountEditor(INITIAL)
    expect(container.querySelector('[data-markdown-editor] style')).toBeNull()
  })

  it('edição no editor propaga Markdown fiel pelo bindable (bloco intacto)', async () => {
    const { handle, onmarkdownchange } = await mountEditor(INITIAL)
    handle.view.dispatch(handle.view.state.tr.insertText('Editado: ', 1))
    await waitFor(
      () => {
        expect(onmarkdownchange).toHaveBeenCalled()
      },
      { timeout: 5000 },
    )
    const markdown = lastChange(onmarkdownchange)
    expect(markdown).toContain('Editado: Intro')
    expect(extractCodeBlock(markdown)).toBe(CODE + '\n')
  })

  it('desmontar o componente destrói o editor', async () => {
    const { handle, unmount } = await mountEditor(INITIAL)
    unmount()
    expect(handle.view.isDestroyed).toBe(true)
  })
})
