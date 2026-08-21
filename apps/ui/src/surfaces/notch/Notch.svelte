<script lang="ts">
  // Superfície Notch (T-404 / RF-013 + RF-334 + RF-704 + RF-701): a faixa
  // COMPACTA de insights em tempo real durante sessões ativas. É a SEGUNDA
  // janela Tauri — a janela em si (transparente, sempre-no-topo, excluída de
  // captura) é config do CORE, e tauri.conf.json só define 'main'; o mesmo
  // para os atalhos globais de navegação (RF-334 "via atalhos"):
  // coverageMap com coveredBy vazio.
  //
  // Consome o MESMO stream do T-403 ('suggest-stream', ponte T-303 — o core
  // reemite cada SuggestStreamEvent) na ordem start → token* → done/error e
  // exibe o insight ao vivo com o renderizador read-only do T-408 (ADR-011:
  // nunca o editor Milkdown para tokens em streaming). O histórico navegável
  // (RF-334) é a lista de insights concluídos: Anterior/Próximo com clamp nas
  // duas pontas; um novo start devolve a exibição ao ao vivo (RF-704). O
  // material por plataforma (RF-013) vem da camada T-400: vibrancy nativa no
  // macOS, vidro equivalente a Mica/Acrylic via backdrop-filter no Windows,
  // translúcido com compositor no Linux e semi-opaco sem ele (SRS 8.3).
  import { listen } from '@tauri-apps/api/event'
  import type { SuggestStreamEvent } from '../../../../../contracts/ipc'
  import GlassPanel from '../../lib/glass/GlassPanel.svelte'
  import { detectGlassSupport, resolveGlassMode } from '../../lib/glass/platform'
  import MarkdownView from '../../lib/markdown/MarkdownView.svelte'
  import { INITIAL_SUGGESTION_STREAM, reduceStreamEvent } from '../overlay/stream'
  import { reduceInsightHistory, type InsightHistoryEntry } from './history'

  // Material por plataforma (RF-013): a capacidade do sistema é estática —
  // detectada UMA vez por montagem pela camada T-400; o modo real é decidido
  // pelo resolveGlassMode (native > backdrop > solid).
  const material = resolveGlassMode(detectGlassSupport())

  let streamState = $state(INITIAL_SUGGESTION_STREAM)
  let history = $state<readonly InsightHistoryEntry[]>([])

  // Navegação (RF-334): viewOffset 0 = ao vivo; N = N passos atrás no
  // histórico. O índice absoluto deriva da lista, então um `done` que anexa
  // desloca o ao vivo junto e a navegação não precisa ser reposicionada.
  let viewOffset = $state(0)
  const viewIndex = $derived(history.length - viewOffset)

  const displayStatus = $derived(viewOffset === 0 ? streamState.status : 'done')
  const displayText = $derived(
    viewOffset === 0 ? streamState.text : (history[history.length - viewOffset]?.text ?? ''),
  )
  const displayError = $derived(viewOffset === 0 ? streamState.error : undefined)

  // O flag da rolagem é `let` simples (padrão do MarkdownEditor T-408): lido
  // pelo efeito na reexecução por mudança de texto; não precisa de
  // reatividade própria. A ref do DOM usa $state — aqui não há prop/variável
  // `state` no escopo (o trap do InsightCard não se aplica).
  let scrollBody = $state<HTMLElement | null>(null)
  let followEnd = true

  // Type Safety (general.md): o payload chega do core como unknown e precisa
  // ser estreitado em runtime antes de alimentar os redutores.
  function isSuggestStreamEvent(payload: unknown): payload is SuggestStreamEvent {
    if (typeof payload !== 'object' || payload === null) return false
    const event = payload as Record<string, unknown>
    switch (event.type) {
      case 'start':
        return typeof event.suggestionId === 'string'
      case 'token':
        return typeof event.text === 'string'
      case 'done':
        return typeof event.providerKind === 'string'
      case 'error': {
        const error = event.error
        if (typeof error !== 'object' || error === null) return false
        const detail = error as Record<string, unknown>
        return typeof detail.code === 'string' && typeof detail.message === 'string'
      }
      default:
        return false
    }
  }

  // Um evento por chamada, em ordem de chegada: o histórico é reduzido com o
  // estado ANTES do evento (um done anexa o insight que estava em streaming);
  // um novo start devolve a exibição ao ao vivo (RF-704).
  function handleStreamEvent(payload: SuggestStreamEvent): void {
    const previous = streamState
    history = reduceInsightHistory(history, previous, payload)
    if (payload.type === 'start') {
      viewOffset = 0
    }
    streamState = reduceStreamEvent(previous, payload)
  }

  $effect(() => {
    let cancelled = false
    let unlisten: (() => void) | undefined

    // Uma assinatura por montagem, nunca por evento; o cancelamento acontece
    // no unmount (frontend.md).
    void listen<unknown>('suggest-stream', (event) => {
      const payload: unknown = event.payload
      if (!isSuggestStreamEvent(payload)) return
      handleStreamEvent(payload)
    }).then((stopListening) => {
      if (cancelled) {
        stopListening()
        return
      }
      unlisten = stopListening
    })

    return () => {
      cancelled = true
      unlisten?.()
    }
  })

  function goPrevious(): void {
    viewOffset = Math.min(viewOffset + 1, history.length)
  }

  function goNext(): void {
    if (viewOffset === 0) return
    viewOffset -= 1
  }

  // RF-701: segue o fim do conteúdo enquanto o usuário não rolar para cima.
  function handleScroll(event: Event): void {
    const body = event.currentTarget as HTMLElement
    const reachedEnd = body.scrollTop + body.clientHeight >= body.scrollHeight
    followEnd = reachedEnd
  }

  $effect(() => {
    // A leitura de displayText registra a dependência: o efeito reexecuta a
    // cada token (com o DOM já atualizado) e leva a rolagem até o fim, salvo
    // pausa do usuário (RF-701).
    displayText
    const body = scrollBody
    if (body !== null && followEnd) {
      body.scrollTop = body.scrollHeight - body.clientHeight
    }
  })
</script>

<div class="notch" data-notch data-notch-material={material}>
  <GlassPanel mode={material} surface="notch">
    <nav class="notch__nav" aria-label="Histórico de insights">
      <button
        type="button"
        class="notch__nav-button"
        data-notch-prev
        disabled={viewIndex === 0}
        onclick={goPrevious}
      >
        Anterior
      </button>
      <button
        type="button"
        class="notch__nav-button"
        data-notch-next
        disabled={viewIndex === history.length}
        onclick={goNext}
      >
        Próximo
      </button>
    </nav>

    {#if displayStatus !== 'idle'}
      <section class="notch__insight" data-notch-insight data-notch-status={displayStatus}>
        <div
          class="notch__body"
          data-notch-body
          bind:this={scrollBody}
          onscroll={handleScroll}
        >
          <MarkdownView markdown={displayText} />
        </div>
        {#if displayStatus === 'error'}
          <p class="notch__error" data-notch-error role="alert">
            {displayError?.message ?? ''}
          </p>
        {/if}
      </section>
    {/if}
  </GlassPanel>
</div>

<style>
  .notch {
    max-width: 34rem;
  }

  .notch__nav {
    display: flex;
    gap: 0.8rem;
    margin-bottom: 0.8rem;
  }

  .notch__nav-button {
    font: inherit;
    font-size: 1.2rem;
    padding: 0.4rem 0.9rem;
    border-radius: 0.8rem;
    cursor: pointer;
  }

  .notch__insight {
    display: flex;
    flex-direction: column;
    gap: 0.8rem;
  }

  .notch__body {
    max-height: 18rem;
    overflow-y: auto;
    padding-right: 0.4rem;
    font-size: 1.4rem;
  }

  .notch__error {
    margin: 0;
    padding: 0.6rem 0.8rem;
    font-size: 1.2rem;
  }
</style>
