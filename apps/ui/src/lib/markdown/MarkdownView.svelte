<script lang="ts">
  import { renderMarkdown } from './markdown'

  // Contrato T-408 / ADR-011: view read-only para streaming. O conteúdo é
  // rederivado a cada token; a raiz nunca é remontada (o peso que o ADR
  // manda evitar é remontar o editor completo, não o HTML do bloco).
  let { markdown }: { markdown: string } = $props()

  const rendered = $derived(renderMarkdown(markdown))
</script>

<div data-markdown-view>
  {@html rendered}
</div>
