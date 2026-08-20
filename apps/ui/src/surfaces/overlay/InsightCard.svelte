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
  import { dispatchOverlayAction } from './overlay-actions'
  import type { InsightCardProps } from './types'

  let { state }: InsightCardProps = $props()

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

  function openUseCase(): void {
    if (state.suggestionId === null) return
    dispatchOverlayAction({ type: 'viewUseCase', suggestionId: state.suggestionId })
  }

  $effect(() => {
    // A leitura de state.text registra a dependência: o efeito reexecuta a
    // cada token (com o DOM já atualizado) e leva a rolagem até o fim.
    state.text
    const body = sayThisBody
    if (body !== null && followEnd) {
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
      <MarkdownView markdown={state.text} />
    </div>
  </section>

  {#if state.status === 'error'}
    <p class="insight-card__error" data-insight-error role="alert">
      {state.error?.message ?? ''}
    </p>
  {/if}

  <button type="button" class="insight-card__action" onclick={openUseCase}>
    Ver caso de uso
  </button>
</article>

<style>
  .insight-card {
    display: flex;
    flex-direction: column;
    gap: 1.2rem;
    max-width: 44rem;
    padding: 1.6rem;
    color: var(--surface-content);
    background: var(--surface-fill);
    border: 0.1rem solid var(--surface-border);
    border-radius: 1.2rem;
    box-shadow: var(--surface-shadow);
    backdrop-filter: blur(var(--surface-blur));
  }

  .insight-card__context {
    display: flex;
    align-items: center;
    gap: 0.8rem;
  }

  .insight-card__context-icon {
    display: inline-flex;
    color: var(--surface-content);
    opacity: 0.6;
  }

  .insight-card__context-label {
    font-size: 1.3rem;
  }

  .insight-card__block {
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
  }

  .insight-card__heading {
    margin: 0;
    font-size: 1.1rem;
    font-weight: 600;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    opacity: 0.75;
  }

  .insight-card__quote {
    margin: 0;
    font-size: 1.3rem;
    font-style: italic;
    opacity: 0.9;
  }

  .insight-card__body {
    max-height: 24rem;
    overflow-y: auto;
    padding-right: 0.4rem;
    font-size: 1.4rem;
  }

  .insight-card__error {
    margin: 0;
    padding: 0.8rem 1rem;
    font-size: 1.2rem;
    border: 0.1rem solid var(--surface-border);
    border-radius: 0.8rem;
  }

  .insight-card__action {
    align-self: flex-start;
    font: inherit;
    font-size: 1.2rem;
    padding: 0.5rem 1rem;
    color: var(--surface-content);
    background: transparent;
    border: 0.1rem solid var(--surface-border);
    border-radius: 1.2rem;
    cursor: pointer;
  }
</style>
