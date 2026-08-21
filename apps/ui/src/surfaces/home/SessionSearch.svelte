<script lang="ts">
  // Busca de sessões (RF-802). O termo digitado sobe por binding para a Home,
  // que deriva a lista filtrada; este componente não conhece as sessões.
  import { glassTokens } from '../../lib/glass/tokens'

  let { query = $bindable('') }: { query?: string } = $props()
</script>

<div
  class="session-search"
  data-home-search
  style:--surface-fill={glassTokens.color.surface}
  style:--surface-border={glassTokens.color.border}
  style:--surface-content={glassTokens.color.content}
>
  <input
    type="search"
    class="session-search__input"
    placeholder="Buscar sessões"
    aria-label="Buscar sessões"
    bind:value={query}
  />
</div>

<style>
  .session-search {
    display: flex;
  }

  .session-search__input {
    font: inherit;
    flex: 1;
    padding: 1rem 1.4rem;
    color: var(--surface-content);
    background: var(--surface-fill);
    border: 0.1rem solid var(--surface-border);
    border-radius: 1.2rem;
  }
</style>
