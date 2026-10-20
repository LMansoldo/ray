<script lang="ts">
  // Superfície Overlay (T-403 / RF-012 + RF-331/332): o modal de sessão em
  // tempo real. Consome os eventos Tauri de streaming (ponte T-303 — o core
  // reemite cada SuggestStreamEvent com o nome 'suggest-stream') na ordem
  // start → token* → done/error e exibe o card de insight com os tokens ao
  // vivo. A posição (RF-507) entra por prop controlada pelo hub do App
  // (atalhos moveModal*) e é aplicada como deslocamento via transform.
  // RF-334: o histórico de respostas concluídas é navegável (botões e atalhos
  // previousResponse/nextResponse via evento DOM ray:insight-nav).
  import { listen } from '@tauri-apps/api/event'
  import { invoke } from '@tauri-apps/api/core'
  import type { SuggestStreamEvent } from '../../../../../contracts/ipc'
  import InsightCard from './InsightCard.svelte'
  import CustomOverlayCard from './CustomOverlayCard.svelte'
  import { INITIAL_SUGGESTION_STREAM, reduceStreamEvent } from './stream'
  import { reduceInsightHistory, type InsightHistoryEntry } from '../notch/history'
  import type { OverlayProps } from './types'

  let {
    position = { x: 0, y: 0 },
    meetingActive = false,
    hint = '',
    autoScroll = true,
    customTemplate = null,
  }: OverlayProps = $props()

  let stopping = $state(false)

  async function stopMeeting(): Promise<void> {
    stopping = true
    try {
      await invoke('stop_meeting')
    } catch (err) {
      console.error('[stop_meeting]', err)
    } finally {
      stopping = false
    }
  }

  let streamState = $state(INITIAL_SUGGESTION_STREAM)
  let history = $state<readonly InsightHistoryEntry[]>([])
  // viewOffset 0 = resposta ao vivo; N = N respostas atrás no histórico.
  let viewOffset = $state(0)
  const viewIndex = $derived(history.length - viewOffset)

  const displayState = $derived.by(() => {
    if (viewOffset === 0) return streamState
    const entry = history[history.length - viewOffset]
    if (!entry) return streamState
    return { ...streamState, status: 'done' as const, text: entry.text, suggestionId: entry.suggestionId }
  })

  function goPreviousResponse(): void {
    viewOffset = Math.min(viewOffset + 1, history.length)
  }

  function goNextResponse(): void {
    if (viewOffset === 0) return
    viewOffset -= 1
  }

  // Type Safety (general.md): o payload chega do core como unknown e precisa
  // ser estreitado em runtime antes de alimentar o redutor.
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

  function handleStreamEvent(payload: SuggestStreamEvent): void {
    const previous = streamState
    history = reduceInsightHistory(history, previous, payload)
    if (payload.type === 'start') {
      viewOffset = 0 // novo insight devolve a exibição ao ao vivo (RF-704)
    }
    streamState = reduceStreamEvent(previous, payload)
  }

  $effect(() => {
    let cancelled = false
    const unlisteners: Array<() => void> = []

    // Uma assinatura por montagem, nunca por evento; cada evento entra no
    // redutor na ordem de chegada e o cancelamento acontece no unmount.
    void listen<unknown>('suggest-stream', (event) => {
      const payload: unknown = event.payload
      if (!isSuggestStreamEvent(payload)) return
      handleStreamEvent(payload)
    }).then((stopListening) => {
      if (cancelled) {
        stopListening()
        return
      }
      unlisteners.push(stopListening)
    })

    // Atalhos previousResponse/nextResponse (hub do App → evento DOM).
    const onNav = (event: Event): void => {
      const dir = (event as CustomEvent<{ dir?: string }>).detail?.dir
      if (dir === 'prev') goPreviousResponse()
      else if (dir === 'next') goNextResponse()
    }
    window.addEventListener('ray:insight-nav', onNav)
    unlisteners.push(() => window.removeEventListener('ray:insight-nav', onNav))

    return () => {
      cancelled = true
      unlisteners.forEach((fn) => fn())
    }
  })
</script>

<div
  class="overlay"
  data-overlay
  style="transform: translate({position.x}px, {position.y}px)"
>
  {#if meetingActive}
    <button
      type="button"
      class="overlay__stop"
      data-overlay-stop-meeting
      disabled={stopping}
      onclick={() => void stopMeeting()}
    >
      {stopping ? 'Encerrando…' : '⏹ Encerrar reunião'}
    </button>
  {/if}
  {#if hint}
    <div class="overlay__hint" data-overlay-hint>{hint}</div>
  {/if}
  {#if streamState.status !== 'idle' || history.length > 0}
    {@const cardState = viewOffset === 0 ? streamState : displayState}
    {#if cardState.status !== 'idle'}
      <div class="overlay__card-wrap">
        <!-- Template customizado do usuário (HTML+CSS em iframe sandbox)
             quando ativo; o InsightCard embutido é o default intocado. -->
        {#if customTemplate}
          <CustomOverlayCard state={cardState} {autoScroll} template={customTemplate} />
        {:else}
          <InsightCard state={cardState} {autoScroll} />
        {/if}
        {#if history.length > 0}
          <nav class="overlay__history" aria-label="Histórico de respostas" data-overlay-history>
            <button
              type="button"
              class="overlay__history-btn"
              data-overlay-history-prev
              aria-label="Resposta anterior"
              disabled={viewIndex === 0}
              onclick={goPreviousResponse}
            >
              <svg width="7" height="7" viewBox="0 0 8 8" fill="none" aria-hidden="true">
                <path d="M5 1L2 4l3 3" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" />
              </svg>
            </button>
            <span class="overlay__history-count">
              {Math.min(viewIndex + 1, history.length + 1)} / {history.length + 1}
            </span>
            <button
              type="button"
              class="overlay__history-btn"
              data-overlay-history-next
              aria-label="Próxima resposta"
              disabled={viewIndex === history.length}
              onclick={goNextResponse}
            >
              <svg width="7" height="7" viewBox="0 0 8 8" fill="none" aria-hidden="true">
                <path d="M3 1l3 3-3 3" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" />
              </svg>
            </button>
          </nav>
        {/if}
      </div>
    {/if}
  {/if}
</div>

<style>
  .overlay {
    position: fixed;
    top: 0;
    left: 0;
    max-width: 46rem;
    /* O container não engole cliques do que está por baixo — só os filhos
       (card/botão) são interativos. Evita bloquear a Home durante reuniões. */
    pointer-events: none;
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 0.6rem;
  }

  .overlay > :global(*) {
    pointer-events: auto;
  }

  .overlay__card-wrap {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    pointer-events: none;
  }

  .overlay__card-wrap > :global(*) {
    pointer-events: auto;
  }

  .overlay__history {
    display: flex;
    align-items: center;
    gap: 2px;
    align-self: flex-end;
  }

  .overlay__history-btn {
    width: 2.4rem;
    height: 2.4rem;
    border-radius: 6px;
    background: rgba(255, 255, 255, 0.05);
    border: 0.1rem solid var(--rim);
    color: var(--text-t);
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    transition: background 0.1s;
    padding: 0;
  }

  .overlay__history-btn:hover:not(:disabled) {
    background: rgba(255, 255, 255, 0.1);
    color: var(--text-p);
  }

  .overlay__history-btn:disabled {
    opacity: 0.35;
    cursor: default;
  }

  .overlay__history-count {
    font-size: 1.14rem;
    color: var(--text-t);
    font-variant-numeric: tabular-nums;
    padding: 0 4px;
  }

  .overlay__stop {
    font: inherit;
    font-size: 1.33rem;
    font-weight: 600;
    padding: 0.7rem 1.4rem;
    color: #fff;
    background: rgba(255, 69, 58, 0.85);
    border: none;
    border-radius: 0.9rem;
    cursor: pointer;
  }

  .overlay__stop:hover {
    background: rgba(255, 69, 58, 1);
  }

  .overlay__hint {
    max-width: 40rem;
    padding: 0.7rem 1.2rem;
    font-size: 1.33rem;
    color: #f5e9c8;
    background: rgba(60, 50, 20, 0.85);
    border-radius: 0.9rem;
  }
</style>
