<script lang="ts">
  // Superfície Assistentes (T-407): biblioteca (RF-336/337) + criador de
  // novo assistente (RF-338). A lista e o ativo entram pelo feed local
  // (assistants-feed.ts), lido UMA vez na montagem — nenhum comando core de
  // listagem existe. A seleção despacha assistantSelect, flippa o ativo
  // otimisticamente (derived override, precedente AppBar T-401) e emite o
  // evento Tauri ray:assistant-changed (barramento cross-surface, mesmo
  // padrão do ray:navigate T-402) para o Home/copiloto escutar; a criação
  // despacha assistantCreate com o prompt lido do MODELO Milkdown
  // (handle.getMarkdown() — parse -> serialize, ADR-011: Markdown entra e
  // Markdown sai, sem round-trip para HTML). O prompt importado é lido da
  // UI (input de arquivo escondido, .md/.txt -> file.text()) e entregue
  // pelo canal onPromptImport, aterrando no editor via handle.setMarkdown.
  // A UI NUNCA inventa um comando invoke() (frontend.md).
  import { onMount } from 'svelte'
  import { invoke } from '@tauri-apps/api/core'
  import { emit } from '@tauri-apps/api/event'
  import { glassTokens } from '../../lib/glass/tokens'
  import MarkdownEditor from '../../lib/editor/MarkdownEditor.svelte'
  import type { MarkdownEditorHandle } from '../../lib/editor/editor'
  import GlassPanel from '../../lib/glass/GlassPanel.svelte'
  import type { AssistantCategory } from '../../../../../contracts/ipc'
  import {
    dispatchAssistantAction,
    dispatchPromptImport,
    onPromptImport,
  } from './assistant-actions'
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

  /** Chave da seleção persistida de assistente ativo (RF-337). */
  const ACTIVE_ASSISTANT_KEY = 'ray_active_assistant'
  /** Evento Tauri que leva o assistente ativo às demais surfaces (App.svelte escuta). */
  const ASSISTANT_CHANGED_EVENT = 'ray:assistant-changed'
  let creatingAssistant = $state(false)

  // localStorage pode não existir/funcionar em todo ambiente (testes jsdom,
  // modo restrito) — a UI não pode falhar por causa da preferência de ativo.
  function safeGet(key: string): string | null {
    try {
      return typeof localStorage?.getItem === 'function' ? localStorage.getItem(key) : null
    } catch {
      return null
    }
  }

  function safeSet(key: string, value: string): void {
    try {
      localStorage?.setItem(key, value)
    } catch {
      // sem storage — segue sem persistir a preferência
    }
  }

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
  let importInput: HTMLInputElement | null = null

  onMount(() => {
    const state = readAssistantsState()
    assistants = state.assistants
    seededActiveId = state.activeAssistantId

    // Biblioteca real: BUILTIN seeded + USER criados, via core (persistidos
    // no banco do sidecar). O ativo volta do localStorage se existir.
    void invoke<{ assistants: Array<{ id: string; name: string; category: string; source: string }> }>(
      'list_assistants',
    )
      .then((res) => {
        const active = safeGet(ACTIVE_ASSISTANT_KEY)
        assistants = res.assistants.map((a) => ({
          id: a.id,
          name: a.name,
          category: a.category as AssistantCategory,
          prompt: '',
          source: a.source === 'BUILTIN' ? 'BUILTIN' : 'USER',
        }))
        if (active && res.assistants.some((a) => a.id === active)) {
          seededActiveId = active
        }
      })
      .catch((err) => console.error('[list_assistants]', err))

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
    safeSet(ACTIVE_ASSISTANT_KEY, id)
    dispatchAssistantAction({ type: 'assistantSelect', assistantId: id })

    // A seleção precisa ATRAVESSAR a fronteira da surface (o canal local de
    // assistant-actions não sai daqui): o barramento Tauri entrega o ativo
    // ao Home/copiloto (precedente ray:navigate T-402). Fire-and-forget —
    // falha de IPC nunca derruba a UI.
    const selected = assistants.find((assistant) => assistant.id === id)
    if (selected) {
      void emit(ASSISTANT_CHANGED_EVENT, {
        id: selected.id,
        name: selected.name,
        category: selected.category,
      }).catch(console.error)
    }
  }

  function requestPromptImport(): void {
    dispatchAssistantAction({ type: 'promptImportRequest' })
    // Leitor REAL: o input de arquivo escondido abre o seletor nativo —
    // o conteúdo escolhido aterra no criador via onImportFileChange.
    importInput?.click()
  }

  /** Remove a extensão final do nome do arquivo ("prompt.md" -> "prompt"). */
  function stripFileExtension(fileName: string): string {
    return fileName.replace(/\.[^./\\]*$/, '')
  }

  async function onImportFileChange(event: Event): Promise<void> {
    const input = event.currentTarget as HTMLInputElement
    const file = input.files?.[0]
    // Limpa a seleção para que reimportar o MESMO arquivo re-dispare change.
    input.value = ''
    if (!file) return

    let prompt = ''
    try {
      prompt = await file.text()
    } catch (err) {
      console.error('[importar prompt]', err)
      return
    }

    // A importação leva ao criador: abre se ainda estivermos na biblioteca
    // (openCreator limpa o formulário antes do prefill abaixo).
    if (view !== 'creator') openCreator()
    if (creatorName === '') {
      creatorName = stripFileExtension(file.name)
    }
    // Mesmo aterramento do leitor externo (canal onPromptImport): editor
    // montado recebe direto; senão fica pendente até o onready do criador.
    dispatchPromptImport(prompt)
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

  /**
   * Exclui um assistente USER (RF-336). Otimista: remove da lista quando o
   * core confirma. Se o excluído era o ativo, o seed BUILTIN assume
   * (primeiro da lista — createdAt asc) e o ativo atravessa o barramento
   * para o Home/copiloto não ficar preso num id inexistente.
   */
  async function deleteAssistant(id: string): Promise<void> {
    dispatchAssistantAction({ type: 'assistantDelete', assistantId: id })
    try {
      await invoke('delete_assistant', { id })
    } catch (err) {
      console.error('[delete_assistant]', err)
      return
    }
    assistants = assistants.filter((assistant) => assistant.id !== id)
    if (activeAssistantId === id) {
      const fallback = assistants[0] ?? null
      activeOverride = fallback?.id ?? null
      if (fallback) {
        safeSet(ACTIVE_ASSISTANT_KEY, fallback.id)
        void emit(ASSISTANT_CHANGED_EVENT, {
          id: fallback.id,
          name: fallback.name,
          category: fallback.category,
        }).catch(console.error)
      }
    }
    // A página corrente pode ter ficado vazia após a exclusão.
    const totalPagesAfter = Math.max(1, Math.ceil(filtered.length / ASSISTANTS_PAGE_SIZE))
    if (page > totalPagesAfter) page = totalPagesAfter
  }

  async function createAssistant(): Promise<void> {
    if (creatorName === '') return
    const prompt = editorHandle?.getMarkdown() ?? ''
    // RF-338: sem prompt não há assistente para criar — nada é despachado.
    if (prompt.trim() === '') return
    const category = narrowCreatorCategory(creatorCategory)
    const name = creatorName
    dispatchAssistantAction({ type: 'assistantCreate', name, category, prompt })

    // Persistência REAL: cria no banco via core e insere o registro com o
    // id oficial (não mais `local-<timestamp>` efêmero).
    creatingAssistant = true
    let newAssistant: AssistantView
    try {
      const res = await invoke<{ assistantId: string }>('create_assistant', {
        name,
        category,
        prompt,
      })
      newAssistant = { id: res.assistantId, name, category, prompt, source: 'USER' }
    } catch (err) {
      console.error('[create_assistant]', err)
      // Fallback otimista local (sem persistência) — mesmo comportamento antigo.
      newAssistant = { id: `local-${Date.now()}`, name, category, prompt, source: 'USER' }
    } finally {
      creatingAssistant = false
    }
    assistants = [newAssistant, ...assistants]
    activeOverride = newAssistant.id
    safeSet(ACTIVE_ASSISTANT_KEY, newAssistant.id)

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
  <!-- Seletor nativo da importação de prompts (RF-336/338): fora do bloco
       condicional para sobreviver à troca de view biblioteca -> criador. -->
  <input
    class="assistants__import-input"
    data-assistant-import-input
    type="file"
    accept=".md,.txt,.markdown,text/markdown,text/plain"
    hidden
    bind:this={importInput}
    onchange={onImportFileChange}
  />
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
              <div class="aentry">
                <button
                  class="arow"
                  type="button"
                  data-assistant-row={assistant.id}
                  data-assistant-active={activeAssistantId === assistant.id ? 'true' : undefined}
                  onclick={() => selectAssistant(assistant.id)}
                >
                  <span class="avatar" aria-hidden="true">{assistant.name.charAt(0).toUpperCase()}</span>
                  <span class="ainfo">
                    <strong class="aname" data-assistant-name>{assistant.name}</strong>
                    <span class="acat" data-assistant-category>
                      {ASSISTANT_CATEGORY_LABELS[assistant.category]}
                    </span>
                  </span>
                  <span class="aprompt" data-assistant-prompt>
                    {assistant.prompt}
                  </span>
                  {#if activeAssistantId === assistant.id}
                    <span class="acheck" aria-hidden="true">
                      <svg width="10" height="10" viewBox="0 0 12 12" fill="none">
                        <path
                          d="M2 6l3 3 5-5"
                          stroke="white"
                          stroke-width="1.8"
                          stroke-linecap="round"
                          stroke-linejoin="round"
                        />
                      </svg>
                    </span>
                  {/if}
                </button>
                {#if assistant.source === 'USER'}
                  <button
                    class="adelete"
                    type="button"
                    data-assistant-delete={assistant.id}
                    aria-label={`Excluir assistente ${assistant.name}`}
                    title={`Excluir "${assistant.name}"`}
                    onclick={() => void deleteAssistant(assistant.id)}
                  >
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                      <path
                        d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"
                        stroke="currentColor"
                        stroke-width="1.8"
                        stroke-linecap="round"
                        stroke-linejoin="round"
                      />
                    </svg>
                  </button>
                {/if}
              </div>
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
          onclick={() => void createAssistant()}
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
    gap: 1rem;
    align-items: center;
    flex-wrap: wrap;
    margin-bottom: 1.2rem;
    padding-bottom: 1.4rem;
    border-bottom: 0.1rem solid var(--rim);
  }

  .assistants__search {
    flex: 1;
    min-width: 16rem;
    padding: 0.7rem 1.2rem;
    font: inherit;
    font-size: 1.2rem;
    color: var(--text-p);
    background: rgba(255, 255, 255, 0.04);
    border: 0.1rem solid var(--rim);
    border-radius: 0.8rem;
  }

  .assistants__category-filter {
    padding: 0.7rem 1rem;
    font: inherit;
    font-size: 1.2rem;
    color: var(--text-s);
    background: rgba(255, 255, 255, 0.05);
    border: 0.1rem solid var(--rim);
    border-radius: 2rem;
  }

  .assistants__tool,
  .assistants__page-button,
  .assistants__back {
    padding: 5px 1.2rem;
    font: inherit;
    font-size: 1.1rem;
    font-weight: 500;
    color: var(--text-s);
    background: rgba(255, 255, 255, 0.06);
    border: 0.1rem solid var(--rim);
    border-radius: 6px;
    cursor: pointer;
    transition:
      background 0.12s,
      color 0.12s;
  }

  .assistants__tool:hover,
  .assistants__page-button:hover:not(:disabled),
  .assistants__back:hover {
    background: rgba(255, 255, 255, 0.1);
    color: var(--text-p);
  }

  .assistants__tool--primary,
  .assistants__create {
    color: #fff;
    background: var(--iris);
    border-color: rgba(255, 255, 255, 0.1);
  }

  .assistants__tool--primary:hover,
  .assistants__create:hover {
    opacity: 0.88;
    background: var(--iris);
    color: #fff;
  }

  .assistants__tool:disabled,
  .assistants__page-button:disabled {
    opacity: 0.35;
    cursor: not-allowed;
  }

  .assistants__list {
    display: flex;
    flex-direction: column;
    gap: 1px;
  }

  /* ── Entrada da lista: linha selecionável + trash (assistentes USER) ── */
  .aentry {
    display: flex;
    align-items: stretch;
  }

  .aentry .arow {
    flex: 1;
    min-width: 0;
  }

  .adelete {
    display: flex;
    align-items: center;
    justify-content: center;
    align-self: center;
    width: 2.2rem;
    height: 2.2rem;
    margin-left: 0.4rem;
    flex-shrink: 0;
    color: var(--text-t);
    background: transparent;
    border: 0.1rem solid transparent;
    border-radius: 0.7rem;
    cursor: pointer;
    opacity: 0;
    transition:
      background 0.12s,
      color 0.12s,
      opacity 0.12s;
  }

  .aentry:hover .adelete,
  .adelete:focus-visible {
    opacity: 1;
  }

  .adelete:hover {
    color: #ff6b6b;
    background: rgba(255, 107, 107, 0.08);
    border-color: rgba(255, 107, 107, 0.2);
  }

  .adelete:focus-visible {
    outline: 2px solid var(--iris);
  }

  /* ── Linha de assistente (mock: .arow) ── */
  .arow {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto;
    gap: 0.2rem 1.2rem;
    align-items: center;
    width: 100%;
    padding: 1rem 1.2rem;
    font: inherit;
    text-align: left;
    color: var(--text-p);
    background: transparent;
    border: 0.1rem solid transparent;
    border-radius: 0.9rem;
    cursor: pointer;
    transition: background 0.1s;
  }

  .arow:hover {
    background: rgba(255, 255, 255, 0.04);
  }

  .arow:focus-visible {
    outline: 2px solid var(--iris);
  }

  .arow[data-assistant-active='true'] {
    background: var(--iris-dim);
    border-color: rgba(90, 87, 232, 0.25);
  }

  .avatar {
    grid-row: 1 / span 2;
    width: 3.6rem;
    height: 3.6rem;
    border-radius: 1rem;
    background: rgba(255, 255, 255, 0.07);
    border: 0.1rem solid var(--rim);
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 1.4rem;
    font-weight: 700;
    color: var(--text-s);
    flex-shrink: 0;
  }

  .arow[data-assistant-active='true'] .avatar {
    background: rgba(90, 87, 232, 0.2);
    color: var(--iris);
    border-color: rgba(90, 87, 232, 0.3);
  }

  .ainfo {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }

  .aname {
    font-size: 1.3rem;
    font-weight: 600;
  }

  .acat {
    font-size: 1.1rem;
    color: var(--text-t);
  }

  .aprompt {
    grid-column: 2;
    font-size: 1.1rem;
    color: var(--text-t);
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    display: -webkit-box;
    -webkit-line-clamp: 1;
    line-clamp: 1;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }

  .acheck {
    grid-row: 1 / span 2;
    width: 1.8rem;
    height: 1.8rem;
    border-radius: 50%;
    background: var(--iris);
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }

  .assistants__empty {
    margin: 0;
    padding: 2rem 0;
    text-align: center;
    color: var(--text-s);
  }

  .assistants__pagination {
    display: flex;
    gap: 1rem;
    align-items: center;
    justify-content: center;
    margin-top: 1.2rem;
  }

  .assistants__page-indicator {
    font-size: 1.1rem;
    color: var(--text-t);
    font-variant-numeric: tabular-nums;
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
    color: var(--text-p);
  }

  .assistants__field {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
    font-size: 1.2rem;
    color: var(--text-s);
  }

  .assistants__name-input,
  .assistants__category-select {
    padding: 0.6rem 1rem;
    font: inherit;
    color: var(--text-p);
    background: rgba(255, 255, 255, 0.04);
    border: 0.1rem solid var(--rim);
    border-radius: 0.8rem;
  }

  .assistants__prompt-field {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
  }

  .assistants__field-label {
    font-size: 1.2rem;
    color: var(--text-s);
  }

  .assistants__create {
    align-self: flex-start;
    padding: 0.6rem 1.4rem;
    font-size: 1.2rem;
    border-radius: 0.7rem;
  }
</style>
