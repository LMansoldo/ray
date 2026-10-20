<script lang="ts">
  import { renderMarkdown } from './markdown'
  import { renderMermaid } from './mermaid'
  import { transformVerdictBlocks } from './verdict'

  // Contrato T-408 / ADR-011: view read-only para streaming. O conteúdo é
  // rederivado a cada token; a raiz nunca é remontada (o peso que o ADR
  // manda evitar é remontar o editor completo, não o HTML do bloco).
  //
  // Diagramas Mermaid: blocos ```mermaid nascem como código highlightado
  // (path síncrono do marked) e o efeito abaixo os troca por SVG — SOMENTE
  // quando `settled` (o caller de streaming passa status done; conteúdo
  // estático usa o default true) e com debounce de 250ms (o HTML re-renderiza
  // a cada token; renderizar diagrama por token é o peso proibitivo). DSL
  // inválido mantém o código (fallback), nunca quebra o stream.
  let {
    markdown,
    settled = true,
  }: { markdown: string; settled?: boolean } = $props()

  // Verificação de fatos (T-602): o pré-processador troca blocos completos da
  // convenção de veredito por HTML cru estilizável ANTES do parse — pureza e
  // custo por token equivalentes ao renderMarkdown. Bloco parcial (streaming
  // cortado antes da linha de veredito fechar) não casa e passa como markdown
  // normal: degradação graciosa, sem crash e sem card incompleto capenga.
  const rendered = $derived(renderMarkdown(transformVerdictBlocks(markdown)))

  // DOM ref em `let` simples — mesma razão do InsightCard (trap da rune
  // $state sob prop em escopo; ver decisions.md).
  let viewRoot: HTMLElement | null = null

  async function renderDiagrams(): Promise<void> {
    const root = viewRoot
    if (root === null) return
    const blocks = root.querySelectorAll<HTMLElement>(
      'pre > code.language-mermaid',
    )
    for (const codeEl of blocks) {
      const pre = codeEl.closest('pre')
      if (pre === null || pre.getAttribute('data-mermaid') !== null) continue
      pre.setAttribute('data-mermaid', 'pending')
      const svg = await renderMermaid(codeEl.textContent ?? '')
      // O HTML pode ter trocado durante o await (novo token/cleanup): o pre
      // detachado é garbage-collected, replaceWith num nó fora da árvore é
      // no-op seguro — sem guard extra.
      if (svg === null) {
        pre.setAttribute('data-mermaid', 'failed')
        continue
      }
      const diagram = document.createElement('div')
      diagram.className = 'mermaid-diagram'
      diagram.innerHTML = svg
      pre.replaceWith(diagram)
    }
  }

  $effect(() => {
    rendered
    if (!settled) return
    // Debounce: cada mudança de conteúdo reinicia o timer; o diagrama só
    // renderiza quando o texto estabiliza.
    const timer = setTimeout(() => void renderDiagrams(), 250)
    return () => clearTimeout(timer)
  })
</script>

<div data-markdown-view bind:this={viewRoot}>
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

  /* Diagrama Mermaid renderizado: o SVG tem viewBox próprio, então width
     100% mantém a proporção dentro do card. A fonte INTERNA do diagrama é
     do próprio SVG — não segue os degraus do auto-ajuste do DIGA ISSO;
     diagramas mais largos que o card rolam no eixo X. */
  [data-markdown-view] :global(.mermaid-diagram) {
    max-width: 100%;
    overflow-x: auto;
  }

  [data-markdown-view] :global(.mermaid-diagram svg) {
    max-width: 100%;
    height: auto;
  }

  /* Card de verificação de fatos (T-602): HTML cru emitido por verdict.ts e
     repassado verbatim pelo marked — por isso :global. Cores semânticas dos
     tokens do tema (app.css :root) com fallback local: TRUE verde, FALSE
     vermelho, UNCERTAIN âmbar. Tamanhos em em acompanham o auto-ajuste de
     fonte do corpo (InsightCard RF-701/T-403). */
  [data-markdown-view] :global(.ray-verdict) {
    display: flex;
    flex-direction: column;
    gap: 0.5em;
    margin: 0.6em 0;
    padding: 0.9em 1em;
    max-width: 100%;
    min-width: 0;
    overflow-wrap: anywhere;
    border: 0.1rem solid var(--rim, rgba(255, 255, 255, 0.09));
    border-radius: var(--radius-m, 0.9rem);
    background: rgba(255, 255, 255, 0.04);
  }

  [data-markdown-view] :global(.ray-verdict__top) {
    display: flex;
    align-items: center;
    gap: 0.7em;
    flex-wrap: wrap;
    min-width: 0;
  }

  [data-markdown-view] :global(.ray-verdict__chip) {
    display: inline-flex;
    align-items: center;
    padding: 0.15em 0.7em;
    border-radius: 999px;
    font-size: 0.82em;
    font-weight: 700;
    letter-spacing: 0.07em;
    white-space: nowrap;
  }

  [data-markdown-view] :global(.ray-verdict__chip--true) {
    color: var(--green, #30d158);
    background: rgba(48, 209, 88, 0.14);
    border: 0.1rem solid rgba(48, 209, 88, 0.35);
  }

  [data-markdown-view] :global(.ray-verdict__chip--false) {
    color: var(--error, #ff453a);
    background: rgba(255, 69, 58, 0.14);
    border: 0.1rem solid rgba(255, 69, 58, 0.35);
  }

  [data-markdown-view] :global(.ray-verdict__chip--uncertain) {
    color: var(--orange, #ff9f0a);
    background: rgba(255, 159, 10, 0.14);
    border: 0.1rem solid rgba(255, 159, 10, 0.35);
  }

  /* Confiança: 3 pontos (1 a 3 acesos conforme alta/média/baixa). */
  [data-markdown-view] :global(.ray-verdict__confidence) {
    display: inline-flex;
    align-items: center;
    gap: 0.3em;
  }

  [data-markdown-view] :global(.ray-verdict__dot) {
    width: 0.55em;
    height: 0.55em;
    border-radius: 50%;
    background: rgba(255, 255, 255, 0.16);
  }

  [data-markdown-view] :global(.ray-verdict__dot--on) {
    background: var(--text-s, rgba(240, 240, 248, 0.52));
  }

  [data-markdown-view] :global(.ray-verdict__claim) {
    margin: 0;
    font-weight: 700;
    color: var(--text-p, #f0f0f8);
    line-height: 1.4;
  }

  [data-markdown-view] :global(.ray-verdict__why) {
    margin: 0;
    color: var(--text-s, rgba(240, 240, 248, 0.52));
    line-height: 1.5;
  }

  /* Fontes: chips de link (mesma linguagem do ícone de contexto do card). */
  [data-markdown-view] :global(.ray-verdict__sources) {
    display: flex;
    flex-wrap: wrap;
    gap: 0.4em;
    margin: 0;
    padding: 0;
    list-style: none;
    min-width: 0;
  }

  [data-markdown-view] :global(.ray-verdict__source) {
    display: inline-flex;
    align-items: center;
    padding: 0.2em 0.7em;
    max-width: 100%;
    overflow-wrap: anywhere;
    border-radius: 999px;
    font-size: 0.88em;
    color: var(--iris, #5a57e8);
    background: rgba(90, 87, 232, 0.15);
    border: 0.1rem solid rgba(90, 87, 232, 0.32);
    text-decoration: none;
  }
</style>
