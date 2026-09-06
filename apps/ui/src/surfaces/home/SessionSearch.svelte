<script lang="ts">
  // Busca de sessões (RF-802). O termo digitado sobe por binding para a Home,
  // que deriva a lista filtrada; este componente não conhece as sessões.
  import { glassTokens } from '../../lib/glass/tokens'

  let { query = $bindable('') }: { query?: string } = $props()
</script>

<div
  class="session-search"
  data-home-search
  style:--surface-content={glassTokens.color.content}
>
  <svg
    width="13"
    height="13"
    viewBox="0 0 16 16"
    fill="none"
    aria-hidden="true"
    class="session-search__icon"
  >
    <circle cx="7" cy="7" r="5" stroke="currentColor" stroke-width="1.5" />
    <path d="M11 11l3 3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
  </svg>
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
    align-items: center;
    gap: 0.8rem;
    padding: 0.8rem 1.2rem;
    background: rgba(255, 255, 255, 0.04);
    border: 0.1rem solid var(--rim);
    border-radius: 0.8rem;
  }

  .session-search__icon {
    color: var(--text-t);
    flex-shrink: 0;
  }

  .session-search__input {
    font: inherit;
    font-size: 1.3rem;
    flex: 1;
    background: transparent;
    border: none;
    color: var(--text-p);
  }

  .session-search__input:focus {
    border-color: transparent;
    outline: none;
  }

  .session-search__input::placeholder {
    color: var(--text-t);
  }

  .session-search__input::-webkit-search-cancel-button {
    -webkit-appearance: none;
  }
</style>
