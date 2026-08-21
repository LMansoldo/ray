<script lang="ts">
  // As três ações de conversa da Home (RF-333). Cada uma monta um
  // SuggestRequest espelho do contrato (contracts/ipc.ts) e o despacha como
  // invoke('suggest', { req }) — nome do parâmetro do comando Rust em
  // core/src/lib.rs. A UI só conhece o secretRef da credencial (ADR-003):
  // o núcleo resolve o segredo no cofre nativo, e o ponteiro segue como veio.
  import { invoke } from '@tauri-apps/api/core'
  import type { SuggestRequest, SuggestionTrigger } from '../../../../../contracts/ipc'
  import { glassTokens } from '../../lib/glass/tokens'
  import type { ConversationActionsProps } from './types'

  let {
    sessionId,
    assistantId,
    context,
    credential,
    screenshots,
  }: ConversationActionsProps = $props()

  let askOpen = $state(false)
  let question = $state('')

  async function analyzeConversation(): Promise<void> {
    await dispatchSuggest('ANALYZE_CONVERSATION', {})
  }

  async function captureScreen(): Promise<void> {
    await dispatchSuggest('SCREEN_CAPTURE', { screenshots })
  }

  function toggleAsk(): void {
    askOpen = !askOpen
  }

  async function askAnything(): Promise<void> {
    const prompt = question.trim()
    if (prompt === '') return
    await dispatchSuggest('ASK_ANYTHING', { userPrompt: prompt })
    askOpen = false
    question = ''
  }

  async function dispatchSuggest(
    trigger: SuggestionTrigger,
    extras: { userPrompt?: string; screenshots?: string[] },
  ): Promise<void> {
    const request: SuggestRequest = {
      sessionId,
      assistantId,
      trigger,
      context,
      credential,
    }
    if (extras.userPrompt !== undefined) {
      request.userPrompt = extras.userPrompt
    }
    if (extras.screenshots !== undefined && extras.screenshots.length > 0) {
      request.screenshots = extras.screenshots
    }
    await invoke('suggest', { req: request })
  }
</script>

<div
  class="conversation-actions"
  style:--surface-fill={glassTokens.color.surface}
  style:--surface-border={glassTokens.color.border}
  style:--surface-content={glassTokens.color.content}
>
  <div class="conversation-actions__item">
    <button
      type="button"
      class="conversation-actions__button"
      onclick={analyzeConversation}
    >
      Analisar Conversa
    </button>
    <kbd>Cmd+Shift+A</kbd>
  </div>
  <div class="conversation-actions__item">
    <button
      type="button"
      class="conversation-actions__button"
      onclick={captureScreen}
    >
      Capturar Tela
    </button>
    <kbd>Cmd+Shift+S</kbd>
  </div>
  <div class="conversation-actions__item">
    <button
      type="button"
      class="conversation-actions__button"
      onclick={toggleAsk}
    >
      Perguntar Algo
    </button>
    <kbd>Cmd+Shift+P</kbd>
  </div>
  {#if askOpen}
    <div class="conversation-actions__ask">
      <input
        type="text"
        placeholder="Digite sua pergunta"
        aria-label="Digite sua pergunta"
        bind:value={question}
      />
      <button
        type="button"
        class="conversation-actions__button"
        onclick={askAnything}
      >
        Perguntar
      </button>
    </div>
  {/if}
</div>

<style>
  .conversation-actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.8rem;
  }

  .conversation-actions__item {
    display: flex;
    align-items: center;
    gap: 0.6rem;
  }

  .conversation-actions__button {
    font: inherit;
    padding: 0.8rem 1.4rem;
    color: var(--surface-content);
    background: var(--surface-fill);
    border: 0.1rem solid var(--surface-border);
    border-radius: 1.2rem;
    cursor: pointer;
  }

  .conversation-actions__ask {
    display: flex;
    flex-basis: 100%;
    align-items: center;
    gap: 0.8rem;
    margin-top: 0.8rem;
  }

  .conversation-actions__ask input {
    font: inherit;
    flex: 1;
    padding: 0.8rem 1.4rem;
    color: var(--surface-content);
    background: var(--surface-fill);
    border: 0.1rem solid var(--surface-border);
    border-radius: 1.2rem;
  }

  kbd {
    font-family: ui-monospace, monospace;
    font-size: 1.1rem;
    padding: 0.2rem 0.6rem;
    color: var(--surface-content);
    background: var(--surface-fill);
    border: 0.1rem solid var(--surface-border);
    border-radius: 0.6rem;
  }
</style>
