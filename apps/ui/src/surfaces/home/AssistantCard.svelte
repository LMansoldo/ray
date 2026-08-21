<script lang="ts">
  // Card do assistente ativo da sessão (RF-011): nome e categoria.
  import GlassPanel from '../../lib/glass/GlassPanel.svelte'
  import type { AssistantSummary } from './types'

  let { assistant }: { assistant: AssistantSummary } = $props()
</script>

<div class="assistant-card" data-assistant-card>
  <GlassPanel>
    <h3 class="assistant-card__name">{assistant.name}</h3>
    <span class="assistant-card__category">{assistant.category}</span>
  </GlassPanel>
</div>

<style>
  .assistant-card__name {
    margin: 0 0 0.4rem;
    font-size: 1.6rem;
  }

  .assistant-card__category {
    font-size: 1.2rem;
    opacity: 0.72;
  }
</style>
