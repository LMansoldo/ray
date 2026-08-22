<script lang="ts">
  // Superfície Assistentes (T-407): biblioteca (RF-336/337) + criador de
  // novo assistente (RF-338). A lista e o ativo entram pelo feed local
  // (assistants-feed.ts), lido UMA vez na montagem — nenhum comando core de
  // listagem existe. A seleção despacha assistantSelect e flippa o ativo
  // otimisticamente (derived override, precedente AppBar T-401); a criação
  // despacha assistantCreate com o prompt lido do MODELO Milkdown
  // (handle.getMarkdown() — parse -> serialize, ADR-011: Markdown entra e
  // Markdown sai, sem round-trip para HTML). O prompt importado chega pelo
  // canal onPromptImport (o leitor de arquivo nativo é core-side) e aterra
  // no editor via handle.setMarkdown. A UI NUNCA inventa um comando invoke()
  // (frontend.md).
  import { onMount } from 'svelte'
  import { glassTokens } from '../../lib/glass/tokens'
  import MarkdownEditor from '../../lib/editor/MarkdownEditor.svelte'
  import type { MarkdownEditorHandle } from '../../lib/editor/editor'
  import GlassPanel from '../../lib/glass/GlassPanel.svelte'
  import type { AssistantCategory } from '../../../../../contracts/ipc'
  import { dispatchAssistantAction, onPromptImport } from './assistant-actions'
  import { readAssistantsState } from './assistants-feed'
  import {
    ASSISTANT_CATEGORIES,
    ASSISTANT_CATEGORY_LABELS,
    ASSISTANTS_PAGE_SIZE,
    filterAssistantsByCategory,
    paginateAssistants,
    searchAssistants,
  } from './library'
  import type { AssistantCategoryFilter, AssistantView } from './types'

  type AssistantViewKind = 'library' | 'creator'

  let view = $state<AssistantViewKind>('library')

  // ── Biblioteca (RF-336/337) ───────────────────────────────────────────

  let assistants = $state<AssistantView[]>([])
  let seededActiveId = $state<string | null>(null)
  let activeOverride = $state<string | null>(null)
  let query = $state('')
  let categoryFilter = $state('ALL')
  let page = $state(1)

  // Flip otimista da seleção: o override local prevalece sobre o ativo
  // semeado do feed (montar não re-dispara nada — precedente T-401).
  const activeAssistantId = $derived(activeOverride ?? seededActiveId)

  const searched = $derived(searchAssistants(assistants, query))
  const filtered = $derived(
    filterAssistantsByCategory(searched, narrowCategoryFilter(categoryFilter)),
  )
  const pagination = $derived(paginateAssistants(filtered, page, ASSISTANTS_PAGE_SIZE))

  // ── Criador (RF-338) ──────────────────────────────────────────────────

  let creatorName = $state('')
  let creatorCategory = $state('GENERAL')
  let editorHandle: MarkdownEditorHandle | null = null
  let pendingImportedPrompt: string | null = null

  onMount(() => {
    const state = readAssistantsState()
    assistants = state.assistants
    seededActiveId = state.activeAssistantId

    return onPromptImport((prompt) => {
      if (editorHandle) {
        editorHandle.setMarkdown(prompt)
      } else {
        pendingImportedPrompt = prompt
      }
    })
  })

  /** Restringe o valor do filtro (string do select) à união do contrato. */
  function narrowCategoryFilter(value: string): AssistantCategoryFilter {
    if (value === 'ALL') return 'ALL'
    const category = ASSISTANT_CATEGORIES.find((entry) => entry === value)
    return category ?? 'ALL'
  }

  /** Restringe o valor da categoria do criador à união do contrato. */
  function narrowCreatorCategory(value: string): AssistantCategory {
    const category = ASSISTANT_CATEGORIES.find((entry) => entry === value)
    return category ?? 'GENERAL'
  }

  function onSearchInput(event: Event): void {
    query = (event.currentTarget as HTMLInputElement).value
    page = 1
  }

  function onCategoryChange(event: Event): void {
    categoryFilter = (event.currentTarget as HTMLSelectElement).value
    page = 1
  }

  function goToPreviousPage(): void {
    if (page > 1) page -= 1
  }

  function goToNextPage(): void {
    if (page < pagination.totalPages) page += 1
  }

  function selectAssistant(id: string): void {
    activeOverride = id
    dispatchAssistantAction({ type: 'assistantSelect', assistantId: id })
  }

  function requestPromptImport(): void {
    dispatchAssistantAction({ type: 'promptImportRequest' })
  }

  function openCreator(): void {
    creatorName = ''
    creatorCategory = 'GENERAL'
    view = 'creator'
  }

  function closeCreator(): void {
    view = 'library'
    editorHandle = null
  }

  function onEditorReady(handle: MarkdownEditorHandle): void {
    editorHandle = handle
    if (pendingImportedPrompt !== null) {
      handle.setMarkdown(pendingImportedPrompt)
      pendingImportedPrompt = null
    }
  }

  function createAssistant(): void {
    if (creatorName === '') return
    const prompt = editorHandle?.getMarkdown() ?? ''
    const category = narrowCreatorCategory(creatorCategory)
    dispatchAssistantAction({ type: 'assistantCreate', name: creatorName, category, prompt })

    // Adiciona localmente sem esperar o core (não há comando ainda).
    const newAssistant: AssistantView = {
      id: `local-${Date.now()}`,
      name: creatorName,
      category,
      prompt,
    }
    assistants = [newAssistant, ...assistants]
    activeOverride = newAssistant.id

    // Volta para a biblioteca e limpa o formulário.
    view = 'library'
    creatorName = ''
    creatorCategory = 'GENERAL'
    editorHandle?.setMarkdown('')
  }
</script>

<div
  class="assistants"
  data-assistants
  style:--surface-fill={glassTokens.color.surface}
  style:--surface-border={glassTokens.color.border}
  style:--surface-content={glassTokens.color.content}
  style:--surface-solid={glassTokens.color.surfaceSolid}
>
  {#if view === 'library'}
    <GlassPanel surface="home">
      <section class="assistants__library" data-assistant-library>
        <header class="assistants__toolbar">
          <input
            class="assistants__search"
            data-assistant-search
            type="search"
            placeholder="Buscar assistentes"
            value={query}
            oninput={onSearchInput}
          />
          <select
            class="assistants__category-filter"
            data-assistant-category-filter
            value={categoryFilter}
            onchange={onCategoryChange}
          >
            <option value="ALL">Todas</option>
            {#each ASSISTANT_CATEGORIES as category (category)}
              <option value={category}>{ASSISTANT_CATEGORY_LABELS[category]}</option>
            {/each}
          </select>
          <button class="assistants__tool" type="button" onclick={requestPromptImport}>
            Importar prompt
          </button>
          <button class="assistants__tool assistants__tool--primary" type="button" onclick={openCreator}>
            Novo assistente
          </button>
        </header>

        {#if pagination.items.length === 0}
          <p class="assistants__empty" data-assistant-empty>Nenhum assistente encontrado</p>
        {:else}
          <div class="assistants__list">
            {#each pagination.items as assistant (assistant.id)}
              <button
                class="assistants__row"
                type="button"
                data-assistant-row={assistant.id}
                data-assistant-active={activeAssistantId === assistant.id ? 'true' : undefined}
                onclick={() => selectAssistant(assistant.id)}
              >
                <strong class="assistants__row-name" data-assistant-name>{assistant.name}</strong>
                <span class="assistants__row-category" data-assistant-category>
                  {ASSISTANT_CATEGORY_LABELS[assistant.category]}
                </span>
                <span class="assistants__row-prompt" data-assistant-prompt>
                  {assistant.prompt}
                </span>
              </button>
            {/each}
          </div>
        {/if}

        <footer class="assistants__pagination">
          <button
            class="assistants__page-button"
            data-assistant-prev
            type="button"
            disabled={page <= 1}
            onclick={goToPreviousPage}
          >
            Anterior
          </button>
          <span class="assistants__page-indicator" data-assistant-page>
            {page} de {pagination.totalPages}
          </span>
          <button
            class="assistants__page-button"
            data-assistant-next
            type="button"
            disabled={page >= pagination.totalPages}
            onclick={goToNextPage}
          >
            Próximo
          </button>
        </footer>
      </section>
    </GlassPanel>
  {:else}
    <GlassPanel surface="home">
      <section class="assistants__creator" data-assistant-creator>
        <header class="assistants__creator-header">
          <button class="assistants__back" type="button" onclick={closeCreator}>Voltar</button>
          <h2 class="assistants__creator-title">Novo assistente</h2>
        </header>

        <label class="assistants__field">
          Nome
          <input
            class="assistants__name-input"
            data-assistant-name-input
            type="text"
            bind:value={creatorName}
          />
        </label>

        <label class="assistants__field">
          Categoria
          <select
            class="assistants__category-select"
            data-assistant-category-select
            bind:value={creatorCategory}
          >
            {#each ASSISTANT_CATEGORIES as category (category)}
              <option value={category}>{ASSISTANT_CATEGORY_LABELS[category]}</option>
            {/each}
          </select>
        </label>

        <div class="assistants__prompt-field">
          <span class="assistants__field-label">Prompt</span>
          <MarkdownEditor onready={onEditorReady} />
        </div>

        <button
          class="assistants__create"
          data-assistant-create
          type="button"
          onclick={createAssistant}
        >
          Criar assistente
        </button>
      </section>
    </GlassPanel>
  {/if}
</div>

<style>
  .assistants {
    font-size: 1.4rem;
  }

  .assistants__toolbar {
    display: flex;
    gap: 0.8rem;
    align-items: center;
    flex-wrap: wrap;
    margin-bottom: 1.2rem;
  }

  .assistants__search {
    flex: 1;
    min-width: 16rem;
    padding: 0.6rem 1rem;
    font: inherit;
    color: var(--surface-content);
    background: var(--surface-fill);
    border: 0.1rem solid var(--surface-border);
    border-radius: 0.8rem;
  }

  .assistants__category-filter {
    padding: 0.6rem 0.8rem;
    font: inherit;
    color: var(--surface-content);
    background: var(--surface-fill);
    border: 0.1rem solid var(--surface-border);
    border-radius: 0.8rem;
  }

  .assistants__tool,
  .assistants__page-button,
  .assistants__back,
  .assistants__create {
    padding: 0.6rem 1.2rem;
    font: inherit;
    color: var(--surface-content);
    background: var(--surface-fill);
    border: 0.1rem solid var(--surface-border);
    border-radius: 0.8rem;
    cursor: pointer;
  }

  .assistants__tool--primary,
  .assistants__create {
    color: var(--surface-solid);
    background: var(--surface-content);
    border-color: var(--surface-content);
  }

  .assistants__tool:disabled,
  .assistants__page-button:disabled {
    opacity: 0.4;
    cursor: default;
  }

  .assistants__list {
    display: flex;
    flex-direction: column;
    gap: 0.8rem;
  }

  .assistants__row {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: 0.2rem 1.2rem;
    align-items: baseline;
    width: 100%;
    padding: 1rem 1.2rem;
    font: inherit;
    text-align: left;
    color: var(--surface-content);
    background: var(--surface-fill);
    border: 0.1rem solid var(--surface-border);
    border-radius: 0.8rem;
    cursor: pointer;
  }

  .assistants__row[data-assistant-active='true'] {
    outline: 0.2rem solid var(--surface-content);
    outline-offset: -0.2rem;
  }

  .assistants__row-name {
    font-weight: 600;
  }

  .assistants__row-category {
    justify-self: end;
    font-size: 1.2rem;
    opacity: 0.75;
  }

  .assistants__row-prompt {
    grid-column: 1 / -1;
    font-size: 1.2rem;
    opacity: 0.8;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }

  .assistants__empty {
    margin: 0;
    padding: 2rem 0;
    text-align: center;
    opacity: 0.75;
  }

  .assistants__pagination {
    display: flex;
    gap: 1rem;
    align-items: center;
    justify-content: center;
    margin-top: 1.2rem;
  }

  .assistants__creator {
    display: flex;
    flex-direction: column;
    gap: 1.2rem;
  }

  .assistants__creator-header {
    display: flex;
    gap: 1.2rem;
    align-items: center;
  }

  .assistants__creator-title {
    margin: 0;
    font-size: 1.6rem;
  }

  .assistants__field {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
    font-size: 1.2rem;
    opacity: 0.85;
  }

  .assistants__name-input,
  .assistants__category-select {
    padding: 0.6rem 1rem;
    font: inherit;
    color: var(--surface-content);
    background: var(--surface-fill);
    border: 0.1rem solid var(--surface-border);
    border-radius: 0.8rem;
  }

  .assistants__prompt-field {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
  }

  .assistants__field-label {
    font-size: 1.2rem;
    opacity: 0.85;
  }

  .assistants__create {
    align-self: flex-start;
  }
</style>
