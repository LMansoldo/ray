<script lang="ts">
  // As três ações de conversa da Home (RF-333). Cada uma monta um
  // SuggestRequest espelho do contrato (contracts/ipc.ts) e o despacha como
  // invoke('suggest', { req }) — nome do parâmetro do comando Rust em
  // core/src/lib.rs. A UI só conhece o secretRef da credencial (ADR-003):
  // o núcleo resolve o segredo no cofre nativo, e o ponteiro segue como veio.
  import { invoke } from '@tauri-apps/api/core'
  import type { SuggestRequest, SuggestionTrigger } from '../../../../../contracts/ipc'
  import type { ConversationActionsProps } from './types'

  let {
    sessionId,
    assistantId,
    context,
    credential,
  }: ConversationActionsProps = $props()

  let askOpen = $state(false)
  let question = $state('')

  async function analyzeConversation(): Promise<void> {
    await dispatchSuggest('ANALYZE_CONVERSATION', {})
  }

  async function captureScreen(): Promise<void> {
    // Captura REAL do display principal no clique (RF-332): o core devolve
    // o data URL para uso IMEDIATO no request (o arquivo já persistiu em
    // app_data/captures). Se a captura ao vivo falhar, cai para a última
    // captura em disco, lida sob demanda via latest_capture — a UI nunca
    // retém base64 fora do corpo do request.
    let shots: string[] | undefined
    try {
      const image = await invoke<unknown>('capture_screen')
      if (typeof image === 'string' && image.startsWith('data:image/')) {
        shots = [image]
      }
    } catch (err) {
      console.error('[capture_screen]', err)
    }
    if (!shots) {
      try {
        shots = [await invoke<string>('latest_capture')]
      } catch (err) {
        console.error('[latest_capture]', err)
      }
    }
    await dispatchSuggest('SCREEN_CAPTURE', { screenshots: shots })
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

<div class="conversation-actions">
  <div class="conversation-actions__item">
    <button type="button" class="ca" aria-label="Analisar Conversa" onclick={analyzeConversation}>
      <span class="ca__icon" aria-hidden="true">
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
          <path d="M2 4h12M2 8h8M2 12h10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
        </svg>
      </span>
      <span class="ca__label">Analisar Conversa</span>
      <span class="ca__desc">Resume a transcrição com insights</span>
    </button>
    <kbd>⌘↩</kbd>
  </div>
  <div class="conversation-actions__item">
    <button type="button" class="ca" aria-label="Capturar Tela" onclick={captureScreen}>
      <span class="ca__icon" aria-hidden="true">
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
          <rect x="1" y="3" width="14" height="10" rx="2" stroke="currentColor" stroke-width="1.5" />
          <circle cx="8" cy="8" r="2" fill="currentColor" />
        </svg>
      </span>
      <span class="ca__label">Capturar Tela</span>
      <span class="ca__desc">Adiciona contexto visual</span>
    </button>
    <kbd>⌘E</kbd>
  </div>
  <div class="conversation-actions__item">
    <button type="button" class="ca" aria-label="Perguntar Algo" onclick={toggleAsk}>
      <span class="ca__icon" aria-hidden="true">
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
          <circle cx="8" cy="8" r="6" stroke="currentColor" stroke-width="1.5" />
          <path d="M8 5v3.5M8 11v.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
        </svg>
      </span>
      <span class="ca__label">Perguntar Algo</span>
      <span class="ca__desc">Consulta direta ao assistente</span>
    </button>
  </div>
  {#if askOpen}
    <div class="conversation-actions__ask">
      <input
        type="text"
        placeholder="Digite sua pergunta"
        aria-label="Digite sua pergunta"
        bind:value={question}
        onkeydown={(event) => {
          if (event.key === 'Enter') void askAnything()
        }}
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
    align-items: stretch;
    gap: 0.8rem;
  }

  .conversation-actions__item {
    display: flex;
    flex: 1;
    align-items: center;
    gap: 0.6rem;
  }

  .ca {
    font: inherit;
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 0.6rem;
    padding: 1.2rem 1.4rem;
    cursor: pointer;
    text-align: left;
    color: var(--text-p);
    background: rgba(255, 255, 255, 0.03);
    border: 0.1rem solid var(--rim);
    border-radius: 1rem;
    transition:
      background 0.12s,
      border-color 0.12s;
  }

  .ca:hover {
    background: rgba(255, 255, 255, 0.06);
    border-color: rgba(255, 255, 255, 0.15);
  }

  .ca:focus-visible {
    outline: 2px solid var(--iris);
  }

  .ca__icon {
    width: 2.8rem;
    height: 2.8rem;
    border-radius: 0.7rem;
    background: rgba(255, 255, 255, 0.06);
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--text-s);
  }

  .ca__label {
    font-size: 1.2rem;
    font-weight: 600;
    color: var(--text-p);
  }

  .ca__desc {
    font-size: 1.1rem;
    color: var(--text-t);
    line-height: 1.4;
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
    color: var(--text-p);
    background: rgba(255, 255, 255, 0.04);
    border: 0.1rem solid var(--rim);
    border-radius: 0.8rem;
  }

  .conversation-actions__button {
    font: inherit;
    font-size: 1.2rem;
    font-weight: 500;
    padding: 0.6rem 1.4rem;
    color: #fff;
    background: var(--iris);
    border: 0.1rem solid rgba(255, 255, 255, 0.1);
    border-radius: 0.7rem;
    cursor: pointer;
  }

  .conversation-actions__button:hover {
    opacity: 0.88;
  }

  kbd {
    font-family: ui-monospace, monospace;
    font-size: 1rem;
    padding: 0.2rem 0.6rem;
    color: var(--text-t);
    background: rgba(255, 255, 255, 0.04);
    border: 0.1rem solid var(--rim);
    border-radius: 0.6rem;
    flex-shrink: 0;
  }
</style>
