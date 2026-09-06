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
          <li class="memory-card__item">{item.text}</li>
        {/each}
      </ul>
    {/if}
  </GlassPanel>
</div>

<style>
  .memory-card__title {
    margin: 0 0 0.8rem;
    font-size: 1.1rem;
    font-weight: 600;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--text-t);
  }

  .memory-card__list {
    margin: 0;
    padding: 0;
    list-style: none;
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
  }

  .memory-card__item {
    display: flex;
    gap: 0.6rem;
    align-items: flex-start;
    font-size: 1.1rem;
    color: var(--text-s);
    line-height: 1.45;
  }

  .memory-card__item::before {
    content: '';
    width: 4px;
    height: 4px;
    border-radius: 50%;
    background: var(--iris);
    flex-shrink: 0;
    margin-top: 5px;
  }

  .memory-card__empty {
    margin: 0;
    font-size: 1.1rem;
    color: var(--text-s);
  }
</style>
