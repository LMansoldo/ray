<script lang="ts">
  // Card de memória do assistente (RF-339). Itens chegam por props e o card
  // os acompanha em tempo real; sem itens, mostra um estado próprio.
  import GlassPanel from '../../lib/glass/GlassPanel.svelte'
  import type { MemoryItem } from './types'

  let { memoryItems }: { memoryItems: MemoryItem[] } = $props()
</script>

<div class="memory-card" data-memory-card>
  <GlassPanel>
    <h3 class="memory-card__title">Memória</h3>
    {#if memoryItems.length === 0}
      <p class="memory-card__empty">Nenhuma memória recente</p>
    {:else}
      <ul class="memory-card__list">
        {#each memoryItems as item (item.id)}
          <li>{item.text}</li>
        {/each}
      </ul>
    {/if}
  </GlassPanel>
</div>

<style>
  .memory-card__title {
    margin: 0 0 0.8rem;
    font-size: 1.6rem;
  }

  .memory-card__list {
    margin: 0;
    padding: 0;
    list-style: none;
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
  }

  .memory-card__empty {
    margin: 0;
    opacity: 0.72;
  }
</style>
