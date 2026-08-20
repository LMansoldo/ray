<script lang="ts">
  import { onDestroy, onMount } from 'svelte'
  import { glassTokens } from '../glass/tokens'
  import { createMarkdownEditor, type MarkdownEditorHandle } from './editor'

  // Contrato T-408 / ADR-011: invólucro Svelte 5 do editor Milkdown.
  // `markdown` é $bindable — entrada E saída são Markdown, sem round-trip
  // para HTML. A reatribuição de um $bindable propaga para um bind: do
  // consumidor (descriptor do pai); o callback prop onmarkdownchange é o
  // canal de notificação explícito e precisa ser chamado à mão (o runtime
  // do Svelte não despacha o callback em props simples).
  // Headless: a estilização da raiz usa os tokens Liquid Glass (T-400)
  // como estilos inline; nenhum bloco de estilo embutido.
  let {
    markdown = $bindable(''),
    onready,
    onmarkdownchange,
  }: {
    markdown?: string
    onready?: (handle: MarkdownEditorHandle) => void
    onmarkdownchange?: (markdown: string) => void
  } = $props()

  let editorRoot: HTMLElement
  let handle: MarkdownEditorHandle | null = null

  onMount(async () => {
    const editorHandle = await createMarkdownEditor(editorRoot, {
      initialMarkdown: markdown,
      onMarkdownChange: (updated) => {
        markdown = updated
        onmarkdownchange?.(updated)
      },
    })
    handle = editorHandle
    onready?.(editorHandle)
  })

  onDestroy(() => {
    handle?.destroy()
  })
</script>

<div
  data-markdown-editor
  bind:this={editorRoot}
  style:background-color={glassTokens.color.surface}
  style:border="{glassTokens.border.width} solid {glassTokens.color.border}"
  style:border-radius={glassTokens.radius.surface}
  style:color={glassTokens.color.content}
  style:padding={glassTokens.padding.surface}
></div>
