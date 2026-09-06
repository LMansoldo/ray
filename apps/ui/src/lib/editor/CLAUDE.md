# lib/editor — editor WYSIWYG Milkdown (T-408 / ADR-011)

`MarkdownEditor.svelte` é o invólucro Svelte 5 do editor Milkdown. Usado apenas
onde o usuário precisa EDITAR texto (criador de assistentes). **Nunca** usar para
exibir tokens em streaming — use `lib/markdown/MarkdownView.svelte`.

## Props

| Prop | Tipo | Descrição |
|---|---|---|
| `markdown` | `string` (bindable) | Conteúdo inicial; propaga mudanças de volta |
| `onready` | `(handle) => void` | Chamado quando o editor está pronto |
| `onmarkdownchange` | `(md) => void` | Chamado a cada edição |

## `MarkdownEditorHandle` (editor.ts)

- `getMarkdown()` — lê o Markdown atual sem round-trip para HTML
- `setMarkdown(md)` — substitui o conteúdo
- `destroy()` — chamado automaticamente no `onDestroy`

## Invariantes ADR-011

- Entrada e saída são sempre Markdown puro, sem HTML intermediário.
- O editor não é remontado a cada token — use `MarkdownView` para streaming.
- Estilização via tokens Liquid Glass aplicados inline (sem `<style>` embutido).
- `handle` só existe após o `onMount` assíncrono; checar antes de usar.
