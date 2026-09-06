<script lang="ts">
  // Card do assistente ativo da sessão (RF-011): nome e categoria.
  import GlassPanel from '../../lib/glass/GlassPanel.svelte'
  import type { AssistantSummary } from './types'

  let { assistant }: { assistant: AssistantSummary } = $props()
</script>

<div class="assistant-card" data-assistant-card>
  <GlassPanel>
    <h3 class="assistant-card__title">Assistente ativo</h3>
    <p class="assistant-card__name">{assistant.name}</p>
    <span class="assistant-card__category">{assistant.category}</span>
  </GlassPanel>
</div>

<style>
  .assistant-card__title {
    margin: 0 0 0.8rem;
    font-size: 1.1rem;
    font-weight: 600;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--text-t);
  }

  .assistant-card__name {
    margin: 0 0 0.2rem;
    font-size: 1.4rem;
    font-weight: 600;
    letter-spacing: -0.01em;
  }

  .assistant-card__category {
    font-size: 1.1rem;
    color: var(--text-s);
  }
</style>
