<script lang="ts">
  // Lista de sessões recentes (RF-011 / RF-802). Recebe a lista já filtrada
  // pela busca; quando vazia, mostra o estado próprio de busca sem resultado.
  // Cada linha abre o detalhe da sessão (transcrição persistida).
  import GlassPanel from '../../lib/glass/GlassPanel.svelte'
  import type { SessionSummary } from './types'

  let {
    sessions,
    onselect,
  }: { sessions: SessionSummary[]; onselect?: (id: string) => void } = $props()

  function sessionMeta(session: SessionSummary): string {
    const parts: string[] = []
    if (session.startedAt) {
      parts.push(new Date(session.startedAt).toLocaleDateString('pt-BR'))
    }
    if (typeof session.segmentCount === 'number') {
      parts.push(`${session.segmentCount} falas`)
    }
    return parts.join(' · ')
  }
</script>

<section class="recent-sessions" data-recent-sessions>
  <h2 class="recent-sessions__title">Sessões recentes</h2>
  {#if sessions.length === 0}
    <GlassPanel>
      <p class="recent-sessions__empty">Nenhuma sessão encontrada</p>
    </GlassPanel>
  {:else}
    <ul class="recent-sessions__list">
      {#each sessions as session (session.id)}
        <li class="recent-sessions__row">
          <button
            type="button"
            class="recent-sessions__button"
            data-recent-session={session.id}
            onclick={() => onselect?.(session.id)}
          >
            <span class="recent-sessions__dot" aria-hidden="true"></span>
            <span class="recent-sessions__meta">
              <span class="recent-sessions__name">{session.title}</span>
              {#if sessionMeta(session) !== ''}
                <span class="recent-sessions__info">{sessionMeta(session)}</span>
              {/if}
            </span>
          </button>
        </li>
      {/each}
    </ul>
  {/if}
</section>

<style>
  .recent-sessions {
    display: flex;
    flex-direction: column;
    gap: 0.8rem;
  }

  .recent-sessions__title {
    margin: 0;
    font-size: 1.1rem;
    font-weight: 600;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--text-t);
  }

  .recent-sessions__list {
    margin: 0;
    padding: 0;
    list-style: none;
    display: flex;
    flex-direction: column;
    gap: 1px;
  }

  .recent-sessions__row {
    border-radius: 0.8rem;
  }

  .recent-sessions__button {
    display: flex;
    align-items: center;
    gap: 1.2rem;
    width: 100%;
    padding: 0.9rem 1.2rem;
    font: inherit;
    text-align: left;
    background: transparent;
    border: none;
    border-radius: 0.8rem;
    cursor: pointer;
    transition: background 0.1s;
  }

  .recent-sessions__button:hover,
  .recent-sessions__button:focus-visible {
    background: rgba(255, 255, 255, 0.04);
    outline-color: var(--iris);
  }

  .recent-sessions__dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--text-t);
    flex-shrink: 0;
  }

  .recent-sessions__meta {
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
    min-width: 0;
    flex: 1;
  }

  .recent-sessions__name {
    font-size: 1.3rem;
    color: var(--text-s);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .recent-sessions__button:hover .recent-sessions__name {
    color: var(--text-p);
  }

  .recent-sessions__info {
    font-size: 1.05rem;
    color: var(--text-t);
  }

  .recent-sessions__empty {
    margin: 0;
    font-size: 1.2rem;
    color: var(--text-s);
  }
</style>
