# lib/markdown — renderizador read-only de streaming (T-408 / ADR-011)

`MarkdownView.svelte` é o componente leve para EXIBIR Markdown (incluindo tokens
em streaming). Não usa Milkdown — re-renderiza o HTML a cada mudança de prop sem
remontar nada pesado.

## Props

| Prop | Tipo | Descrição |
|---|---|---|
| `markdown` | `string` | Markdown a renderizar; pode ser parcial (streaming) |

## Quando usar vs. MarkdownEditor

| Caso | Componente |
|---|---|
| Exibir tokens chegando do copiloto (Overlay, Notch, cards) | `MarkdownView` |
| Editar um prompt / resposta finalizada | `MarkdownEditor` |

## Invariante ADR-011

`renderMarkdown` (markdown.ts) serializa de Markdown → HTML sanitizado. O
resultado entra via `{@html rendered}` — nenhuma lib externa de highlight é
adicionada sem aprovação; conferir o que já existe em `markdown.ts` antes de
importar algo novo.
