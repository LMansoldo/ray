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

<style>
  /* Responsividade à largura do container (Overlay/Notch): sem regras de
     wrap, blocos de código (<pre> tem white-space: pre) e palavras longas
     (URLs) empurram o layout além da janela e o texto vaza do overlay.
     pre-wrap + anywhere fazem cada linha quebrar na largura disponível. */
  [data-markdown-view] {
    min-width: 0;
    max-width: 100%;
    overflow-wrap: anywhere;
  }

  [data-markdown-view] :global(pre) {
    max-width: 100%;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    margin: 0;
    font-family: ui-monospace, 'SF Mono', monospace;
  }

  [data-markdown-view] :global(code) {
    overflow-wrap: anywhere;
  }
</style>
