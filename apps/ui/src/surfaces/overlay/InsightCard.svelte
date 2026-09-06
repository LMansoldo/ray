<script lang="ts">
  // Card de insight canônico (T-403 / RF-331): contexto da situação com
  // ícone no topo, bloco "ELES DISSERAM" com a fala do outro falante, bloco
  // "DIGA ISSO" com a resposta sugerida e ação contextual "Ver caso de uso".
  // Reusável pelo Notch (T-404). O DIGA ISSO renderiza o markdown acumulado
  // via o renderizador read-only de streaming do T-408 (ADR-011: nunca o
  // editor Milkdown para exibir tokens ao vivo). A rolagem automática
  // (RF-701) vive no corpo rolável: acompanha o conteúdo mais novo até o fim,
  // pausa quando o usuário rola para cima e retoma ao voltar ao fim.
  import { glassTokens } from '../../lib/glass/tokens'
  import MarkdownView from '../../lib/markdown/MarkdownView.svelte'
  import type { InsightCardProps } from './types'

  let { state, autoScroll = true }: InsightCardProps = $props()

  // DOM refs e o flag da rolagem são `let` simples (padrão do
  // MarkdownEditor T-408), NUNCA a rune $state: com a prop `state` no escopo
  // o compilador resolve `$state` como a assinatura legada de store e gera
  // store_get($$props.state) — store_invalid_shape em runtime
  // (probe-verificado; ver decisions.md).
  let sayThisBody: HTMLElement | null = null

  // RF-701: segue o fim do conteúdo enquanto o usuário não rolar para cima.
  let followEnd = true

  function handleScroll(event: Event): void {
    const body = event.currentTarget as HTMLElement
    const reachedEnd = body.scrollTop + body.clientHeight >= body.scrollHeight
    followEnd = reachedEnd
  }

  $effect(() => {
    // A leitura de state.text registra a dependência: o efeito reexecuta a
    // cada token (com o DOM já atualizado) e leva a rolagem até o fim.
    state.text
    const body = sayThisBody
    if (body !== null && followEnd && autoScroll) {
      body.scrollTop = body.scrollHeight - body.clientHeight
    }
  })
</script>

<article
  class="insight-card"
  data-insight-card
  data-insight-status={state.status}
  style:--surface-fill={glassTokens.color.surface}
  style:--surface-border={glassTokens.color.border}
  style:--surface-content={glassTokens.color.content}
  style:--surface-shadow={glassTokens.shadow.background}
  style:--surface-blur={glassTokens.blur.surface}
>
  <header class="insight-card__context" data-insight-context>
    <span
      class="insight-card__context-icon"
      data-insight-context-icon
      aria-hidden="true"
    >
      <svg viewBox="0 0 16 16" width="1.4rem" height="1.4rem">
        <circle
          cx="8"
          cy="8"
          r="6"
          fill="none"
          stroke="currentColor"
          stroke-width="1.5"
        ></circle>
        <circle cx="8" cy="8" r="2" fill="currentColor"></circle>
      </svg>
    </span>
    <span class="insight-card__context-label">{state.contextLabel ?? ''}</span>
  </header>

  <section class="insight-card__block" data-insight-they-said>
    <h2 class="insight-card__heading">ELES DISSERAM</h2>
    <p class="insight-card__quote">{state.theySaid ?? ''}</p>
  </section>

  <section class="insight-card__block" data-insight-say-this>
    <h2 class="insight-card__heading">DIGA ISSO</h2>
    <div
      class="insight-card__body"
      data-insight-say-this-body
      bind:this={sayThisBody}
      onscroll={handleScroll}
    >
      <MarkdownView markdown={state.text} />{#if state.status === 'streaming'}<span
          class="cursor"
          aria-hidden="true"
        ></span>{/if}
    </div>
  </section>

  {#if state.status === 'error'}
    <p class="insight-card__error" data-insight-error role="alert">
      {state.error?.message ?? ''}
    </p>
  {/if}
</article>

<style>
  .insight-card {
    display: flex;
    flex-direction: column;
    gap: 1.4rem;
    width: 42rem;
    max-width: 100%;
    padding: 1.8rem;
    color: var(--surface-content, var(--text-p));
    background: var(--surface-fill, rgba(20, 22, 36, 0.93));
    border: 0.1rem solid var(--surface-border, rgba(255, 255, 255, 0.13));
    border-radius: 1.4rem;
    box-shadow:
      var(--surface-shadow, 0 2rem 6rem rgba(0, 0, 0, 0.55)),
      0 0.2rem 0.8rem rgba(0, 0, 0, 0.35),
      inset 0 1px 0 rgba(255, 255, 255, 0.07);
    position: relative;
    overflow: hidden;
    backdrop-filter: blur(var(--surface-blur));
    -webkit-backdrop-filter: blur(var(--surface-blur));
  }

  .insight-card::before {
    content: '';
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    height: 40%;
    background: linear-gradient(180deg, rgba(255, 255, 255, 0.04) 0%, transparent 100%);
    pointer-events: none;
  }

  .insight-card__context {
    display: flex;
    align-items: center;
    gap: 0.8rem;
  }

  .insight-card__context-icon {
    width: 2.4rem;
    height: 2.4rem;
    border-radius: 6px;
    background: rgba(90, 87, 232, 0.15);
    border: 0.1rem solid rgba(90, 87, 232, 0.28);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    color: var(--iris);
    flex-shrink: 0;
  }

  .insight-card__context-label {
    font-size: 1.2rem;
    color: var(--text-s);
    font-weight: 500;
  }

  .insight-card__block {
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
  }

  .insight-card__heading {
    margin: 0;
    font-size: 1rem;
    font-weight: 700;
    letter-spacing: 0.09em;
    text-transform: uppercase;
    color: var(--text-t);
  }

  .insight-card__quote {
    margin: 0;
    font-size: 1.3rem;
    font-style: italic;
    color: var(--text-s);
    line-height: 1.55;
  }

  .insight-card__body {
    max-height: 18rem;
    overflow-y: auto;
    padding-right: 0.4rem;
    font-size: 1.3rem;
    line-height: 1.65;
    color: var(--text-p);
  }

  /* Cursor de streaming (mock: .cursor) */
  .cursor {
    display: inline-block;
    width: 2px;
    height: 1.4rem;
    background: var(--iris);
    vertical-align: text-bottom;
    margin-left: 1px;
    animation: blink 1s step-end infinite;
  }

  @keyframes blink {
    0%,
    100% {
      opacity: 1;
    }
    50% {
      opacity: 0;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .cursor {
      animation: none !important;
    }
  }

  .insight-card__error {
    margin: 0;
    padding: 0.8rem 1rem;
    font-size: 1.2rem;
    color: var(--error);
    border: 0.1rem solid var(--rim);
    border-radius: 0.8rem;
    background: rgba(255, 69, 58, 0.08);
  }


</style>
