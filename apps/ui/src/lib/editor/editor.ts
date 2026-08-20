// Editor WYSIWYG Milkdown (ProseMirror + remark) — T-408 / ADR-011.
// Headless: montado pela API core (Editor.make() apontado a um nó do DOM),
// sem bloco de estilo embutido — a aparência vem dos tokens Liquid Glass
// (T-400), aplicados por quem consome o editor. O modelo interno já é
// Markdown: Markdown entra e Markdown sai, sem round-trip para HTML.

import {
  Editor,
  defaultValueCtx,
  editorViewCtx,
  parserCtx,
  rootCtx,
  serializerCtx,
} from '@milkdown/kit/core'
import { commonmark } from '@milkdown/kit/preset/commonmark'
import { gfm } from '@milkdown/kit/preset/gfm'
import { history } from '@milkdown/kit/plugin/history'
import { listener, listenerCtx } from '@milkdown/kit/plugin/listener'
import type { EditorView } from '@milkdown/prose/view'

/** Handle do editor montado: view viva + leitura/escrita em Markdown. */
export interface MarkdownEditorHandle {
  /** A view ProseMirror viva — fonte das transações de edição. */
  readonly view: EditorView
  /** Serializa o documento atual de volta para Markdown fiel. */
  getMarkdown(): string
  /** Substitui o documento inteiro pelo Markdown fornecido. */
  setMarkdown(markdown: string): void
  /** Encerra o editor ProseMirror e libera o nó do DOM. */
  destroy(): void
}

export interface MarkdownEditorOptions {
  /** Markdown inicial carregado na criação do editor. */
  initialMarkdown?: string
  /** Notifica o Markdown serializado a cada mudança no documento. */
  onMarkdownChange?: (markdown: string) => void
}

export async function createMarkdownEditor(
  root: HTMLElement,
  options: MarkdownEditorOptions = {},
): Promise<MarkdownEditorHandle> {
  const editor = await Editor.make()
    .config((ctx) => {
      ctx.set(rootCtx, root)
      ctx.set(defaultValueCtx, options.initialMarkdown ?? '')
      if (options.onMarkdownChange) {
        ctx.get(listenerCtx).markdownUpdated((_ctx, markdown) => {
          options.onMarkdownChange?.(markdown)
        })
      }
    })
    .use(commonmark)
    .use(gfm)
    .use(listener)
    .use(history)
    .create()

  const view = editor.ctx.get(editorViewCtx)

  return {
    view,
    getMarkdown(): string {
      return editor.ctx.get(serializerCtx)(view.state.doc)
    },
    setMarkdown(markdown: string): void {
      editor.action((ctx) => {
        const currentView = ctx.get(editorViewCtx)
        const document = ctx.get(parserCtx)(markdown)
        currentView.dispatch(
          currentView.state.tr.replaceWith(0, currentView.state.doc.content.size, document),
        )
      })
    },
    destroy(): void {
      // A view é encerrada de forma síncrona (e idempotente); o teardown
      // assíncrono dos plugins do Milkdown continua em segundo plano.
      view.destroy()
      void editor.destroy()
    },
  }
}
