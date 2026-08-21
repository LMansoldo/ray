<script lang="ts">
  // Lista de sessões recentes (RF-011 / RF-802). Recebe a lista já filtrada
  // pela busca; quando vazia, mostra o estado próprio de busca sem resultado.
  import GlassPanel from '../../lib/glass/GlassPanel.svelte'
  import type { SessionSummary } from './types'

  let { sessions }: { sessions: SessionSummary[] } = $props()
</script>

<section class="recent-sessions" data-recent-sessions>
  <GlassPanel>
    <h2 class="recent-sessions__title">Sessões recentes</h2>
    {#if sessions.length === 0}
      <p class="recent-sessions__empty">Nenhuma sessão encontrada</p>
    {:else}
      <ul class="recent-sessions__list">
        {#each sessions as session (session.id)}
          <li>{session.title}</li>
        {/each}
      </ul>
    {/if}
  </GlassPanel>
</section>

<style>
  .recent-sessions__title {
    margin: 0 0 0.8rem;
    font-size: 1.6rem;
  }

  .recent-sessions__list {
    margin: 0;
    padding: 0;
    list-style: none;
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
  }

  .recent-sessions__empty {
    margin: 0;
    opacity: 0.72;
  }
</style>
