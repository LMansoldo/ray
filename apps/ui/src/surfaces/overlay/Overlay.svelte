<script lang="ts">
  // Superfície Overlay (T-403 / RF-012 + RF-331/332): o modal de sessão em
  // tempo real. Consome os eventos Tauri de streaming (ponte T-303 — o core
  // reemite cada SuggestStreamEvent com o nome 'suggest-stream') na ordem
  // start → token* → done/error e exibe o card de insight com os tokens ao
  // vivo, sem bufferizar e achatar (frontend.md). A posição da superfície
  // entra por prop (controlada pelo core, RF-012/RF-507) e é aplicada como
  // deslocamento via transform — o comando core de reposicionar ainda não
  // existe (coverageMap).
  import { listen } from '@tauri-apps/api/event'
  import type { SuggestStreamEvent } from '../../../../../contracts/ipc'
  import InsightCard from './InsightCard.svelte'
  import { INITIAL_SUGGESTION_STREAM, reduceStreamEvent } from './stream'
  import type { OverlayProps } from './types'

  let { position = { x: 0, y: 0 } }: OverlayProps = $props()

  let streamState = $state(INITIAL_SUGGESTION_STREAM)

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

  $effect(() => {
    let cancelled = false
    let unlisten: (() => void) | undefined

    // Uma assinatura por montagem, nunca por evento; cada evento entra no
    // redutor na ordem de chegada e o cancelamento acontece no unmount.
    void listen<unknown>('suggest-stream', (event) => {
      const payload: unknown = event.payload
      if (!isSuggestStreamEvent(payload)) return
      streamState = reduceStreamEvent(streamState, payload)
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
</script>

<div
  class="overlay"
  data-overlay
  style="transform: translate({position.x}px, {position.y}px)"
>
  {#if streamState.status !== 'idle'}
    <InsightCard state={streamState} />
  {/if}
</div>

<style>
  .overlay {
    position: fixed;
    top: 0;
    left: 0;
    max-width: 46rem;
  }
</style>
