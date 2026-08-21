<script lang="ts">
  // Superfície Home (T-402): busca de sessões, badge de plano, card do
  // assistente atual, card de memória, free tier, as três ações de conversa
  // e sessões recentes (RF-011 / RF-333 / RF-339 / RF-802 / RF-901..903).
  // A superfície compõe um componente por card e por grupo de ação; as
  // sessões chegam por props no seam do invoke() — nenhum comando novo é
  // inventado aqui (frontend.md).
  import { glassTokens } from '../../lib/glass/tokens'
  import AssistantCard from './AssistantCard.svelte'
  import ConversationActions from './ConversationActions.svelte'
  import MemoryCard from './MemoryCard.svelte'
  import PlanBadge from './PlanBadge.svelte'
  import RecentSessions from './RecentSessions.svelte'
  import SessionSearch from './SessionSearch.svelte'
  import TierCard from './TierCard.svelte'
  import { dispatchHomeNavigation } from './navigation'
  import type { HomeProps } from './types'

  let {
    sessions,
    planName,
    freeSessionsUsed,
    freeSessionsTotal,
    assistant,
    memoryItems,
    sessionId,
    assistantId,
    context,
    credential,
    screenshots,
  }: HomeProps = $props()

  let searchQuery = $state('')

  const filteredSessions = $derived.by(() => {
    const query = searchQuery.trim().toLowerCase()
    if (query === '') {
      return sessions
    }
    return sessions.filter((session) => session.title.toLowerCase().includes(query))
  })

  function openSettings(): void {
    dispatchHomeNavigation('settings')
  }

  function openAssistants(): void {
    dispatchHomeNavigation('assistants')
  }
</script>

<main
  class="home"
  style:--surface-fill={glassTokens.color.surface}
  style:--surface-border={glassTokens.color.border}
  style:--surface-content={glassTokens.color.content}
>
  <header class="home__header">
    <PlanBadge {planName} />
    <nav class="home__nav">
      <button type="button" class="home__nav-button" onclick={openSettings}>
        Configurações
      </button>
      <button type="button" class="home__nav-button" onclick={openAssistants}>
        Assistentes
      </button>
    </nav>
  </header>

  <SessionSearch bind:query={searchQuery} />

  <ConversationActions
    {sessionId}
    {assistantId}
    {context}
    {credential}
    {screenshots}
  />

  <section class="home__grid">
    <AssistantCard {assistant} />
    <MemoryCard {memoryItems} />
    <TierCard {freeSessionsUsed} {freeSessionsTotal} />
  </section>

  <RecentSessions sessions={filteredSessions} />
</main>

<style>
  .home {
    display: flex;
    flex-direction: column;
    gap: 1.6rem;
    max-width: 88rem;
    margin: 0 auto;
    padding: 1.6rem;
  }

  .home__header {
    display: flex;
    flex-wrap: wrap;
    justify-content: space-between;
    align-items: center;
    gap: 1.6rem;
  }

  .home__nav {
    display: flex;
    gap: 0.8rem;
  }

  .home__nav-button {
    font: inherit;
    padding: 0.8rem 1.4rem;
    color: var(--surface-content);
    background: var(--surface-fill);
    border: 0.1rem solid var(--surface-border);
    border-radius: 1.2rem;
    cursor: pointer;
  }

  .home__grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(24rem, 1fr));
    gap: 1.6rem;
  }
</style>
