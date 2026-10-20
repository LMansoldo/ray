<script lang="ts">
  // Superfície Home (T-402): busca de sessões, card do assistente atual,
  // card de memória, as três ações de conversa e sessões recentes
  // (RF-011 / RF-333 / RF-339 / RF-802). O uso completo é o default — não
  // existe conceito de plano/free tier/trial na superfície.
  import AssistantCard from './AssistantCard.svelte'
  import ConversationActions from './ConversationActions.svelte'
  import MemoryCard from './MemoryCard.svelte'
  import RecentSessions from './RecentSessions.svelte'
  import SessionSearch from './SessionSearch.svelte'
  import { onMount } from 'svelte'
  import { invoke } from '@tauri-apps/api/core'
  import { listen } from '@tauri-apps/api/event'
  import { dispatchHomeNavigation } from './navigation'
  import type { HomeProps, SessionDetailData } from './types'

  let {
    sessions,
    assistant,
    memoryItems,
    sessionId: propSessionId,
    assistantId,
    context,
    credential,
    metersVisible = true,
    sessionTimerEnabled = true,
  }: HomeProps = $props()

  let searchQuery = $state('')

  // ── Ouvir Reunião (T-306/307): toggle de sessão + transcript ao vivo ──
  let listening = $state(false)
  let meetingSessionId = $state('')
  let listeningError = $state('')
  let lastTranscript = $state('')

  // ── Medidores de áudio (RF-206): níveis VOCÊ/OUTROS durante a reunião ──
  let meterSelf = $state(0)
  let meterOthers = $state(0)
  let metersTimer: ReturnType<typeof setInterval> | undefined

  // ── Temporizador de sessão (RF-703): aviso a cada 30 min ──
  const SESSION_TIMER_MS = 30 * 60 * 1000
  let meetingStartedAt = $state(0)
  let timerPromptVisible = $state(false)
  let timerTimer: ReturnType<typeof setInterval> | undefined
  let timerDismissed = $state(false)

  // ── Detalhe de sessão (RF-802): transcrição persistida ──
  let sessionDetail = $state<SessionDetailData | null>(null)
  let sessionDetailError = $state('')

  // ── Export de relatório da sessão (T-604): md ou html via comando core ──
  type SessionReportData = { sessionId: string; format: string; filename: string; content: string }
  let exporting = $state(false)
  let exportFeedback = $state('')
  let exportError = $state('')

  let unlistenTranscript: (() => void) | undefined
  let unlistenMeetingStart: (() => void) | undefined
  let unlistenMeetingStop: (() => void) | undefined

  onMount(() => {
    // Transcript em tempo real emitido pelo loop de STT do core.
    void listen<{ speaker: string; text: string }>('ray:transcript', (event) => {
      lastTranscript = event.payload.text
    }).then((fn) => {
      unlistenTranscript = fn
    })
    // O estado da reunião também chega por evento (atalho global ⌘D).
    void listen('ray:meeting-started', () => {
      listening = true
      startMeetingTelemetry()
    }).then((fn) => {
      unlistenMeetingStart = fn
    })
    void listen('ray:meeting-stopped', () => {
      listening = false
      stopMeetingTelemetry()
    }).then((fn) => {
      unlistenMeetingStop = fn
    })
    return () => {
      unlistenTranscript?.()
      unlistenMeetingStart?.()
      unlistenMeetingStop?.()
      stopMeetingTelemetry()
    }
  })

  function startMeetingTelemetry(): void {
    stopMeetingTelemetry()
    meetingStartedAt = Date.now()
    timerDismissed = false
    timerPromptVisible = false
    if (metersVisible) {
      metersTimer = setInterval(() => {
        void invoke<Array<{ channelId: string; rms: number }>>('get_meter_levels')
          .then((levels) => {
            meterSelf = levelOf(levels, 'self')
            meterOthers = levelOf(levels, 'others')
          })
          .catch(() => {
            /* core sem níveis — barras em zero */
          })
      }, 600)
    }
    if (sessionTimerEnabled) {
      timerTimer = setInterval(() => {
        if (!timerDismissed && Date.now() - meetingStartedAt >= SESSION_TIMER_MS) {
          timerPromptVisible = true
          // RF-703: sem resposta em 60s, pausa a gravação.
          setTimeout(() => {
            if (timerPromptVisible) {
              timerPromptVisible = false
              void invoke('stop_meeting').catch(console.error)
            }
          }, 60_000)
          meetingStartedAt = Date.now() // reinicia o ciclo do aviso
        }
      }, 5_000)
    }
  }

  function stopMeetingTelemetry(): void {
    if (metersTimer) clearInterval(metersTimer)
    if (timerTimer) clearInterval(timerTimer)
    metersTimer = undefined
    timerTimer = undefined
    timerPromptVisible = false
    meterSelf = 0
    meterOthers = 0
  }

  function levelOf(levels: Array<{ channelId: string; rms: number }>, id: string): number {
    const found = levels.find((l) => l.channelId === id)
    if (!found) return 0
    // RMS ~0..0.3 na fala — escala para 0..1 com clamp.
    return Math.min(1, found.rms * 4)
  }

  function continueRecording(): void {
    timerPromptVisible = false
    timerDismissed = false
    meetingStartedAt = Date.now()
  }

  async function toggleMeeting(): Promise<void> {
    listeningError = ''
    if (listening) {
      try {
        await invoke('stop_meeting')
      } catch (err) {
        console.error('[stop_meeting]', err)
      }
      listening = false
      stopMeetingTelemetry()
      return
    }
    try {
      meetingSessionId = await invoke<string>('start_meeting', {
        assistantId: assistantId || propSessionId || '',
      })
      listening = true
      lastTranscript = ''
      startMeetingTelemetry()
    } catch (err) {
      listeningError = String(err)
      console.error('[start_meeting]', err)
    }
  }

  const activeSessionId = $derived(meetingSessionId || propSessionId)

  const filteredSessions = $derived.by(() => {
    const query = searchQuery.trim().toLowerCase()
    if (query === '') {
      return sessions
    }
    return sessions.filter((session) => session.title.toLowerCase().includes(query))
  })

  async function openSession(id: string): Promise<void> {
    sessionDetailError = ''
    try {
      sessionDetail = await invoke<SessionDetailData>('get_session', { sessionId: id })
    } catch (err) {
      sessionDetailError = String(err)
    }
  }

  function closeSession(): void {
    sessionDetail = null
    exportFeedback = ''
    exportError = ''
  }

  // Entrega do arquivo (T-604): sem plugin de dialog/fs configurado no Tauri,
  // o caminho é o fallback de download via blob URL no webview. Se a criação
  // do blob falhar (webview sem suporte a download), copia para a área de
  // transferência como último recurso.
  function deliverReport(report: SessionReportData): string {
    try {
      const mime =
        report.format === 'html' ? 'text/html;charset=utf-8' : 'text/markdown;charset=utf-8'
      const url = URL.createObjectURL(new Blob([report.content], { type: mime }))
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = report.filename
      document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()
      window.setTimeout(() => URL.revokeObjectURL(url), 1_000)
      return `Relatório exportado: ${report.filename}`
    } catch {
      void navigator.clipboard.writeText(report.content)
      return 'Download indisponível — relatório copiado para a área de transferência'
    }
  }

  async function exportSession(format: 'md' | 'html'): Promise<void> {
    if (!sessionDetail || exporting) return
    exporting = true
    exportFeedback = ''
    exportError = ''
    try {
      const report = await invoke<SessionReportData>('export_session_report', {
        sessionId: sessionDetail.id,
        format,
      })
      exportFeedback = deliverReport(report)
    } catch (err) {
      exportError = `Falha ao exportar: ${String(err)}`
    } finally {
      exporting = false
    }
  }

  function openSettings(): void {
    dispatchHomeNavigation('settings')
  }

  function openAssistants(): void {
    dispatchHomeNavigation('assistants')
  }
</script>

<main class="home">
  <header class="home__header">
    <span class="home__brand">Ray</span>
    <div class="home__spacer"></div>
    <nav class="home__nav">
      <button type="button" class="home__nav-button" onclick={openSettings}>
        Configurações
      </button>
      <button type="button" class="home__nav-button" onclick={openAssistants}>
        Assistentes
      </button>
    </nav>
  </header>

  {#if sessionDetail}
    <!-- Detalhe de sessão passada (RF-802): transcrição persistida -->
    <section class="home__session-detail" data-session-detail>
      <header class="home__session-detail-header">
        <h2 class="home__session-detail-title">
          Sessão de {new Date(sessionDetail.startedAt).toLocaleString('pt-BR')}
        </h2>
        <div class="home__session-export" data-session-export>
          <span class="home__session-export-label">Exportar:</span>
          <button
            type="button"
            class="home__nav-button"
            data-export-report="md"
            disabled={exporting}
            onclick={() => void exportSession('md')}
          >
            Markdown
          </button>
          <button
            type="button"
            class="home__nav-button"
            data-export-report="html"
            disabled={exporting}
            onclick={() => void exportSession('html')}
          >
            HTML
          </button>
        </div>
        <button
          type="button"
          class="home__nav-button"
          data-session-detail-back
          onclick={closeSession}
        >
          Voltar
        </button>
      </header>
      {#if exportFeedback}
        <p class="home__export-feedback" data-export-feedback role="status">
          {exportFeedback}
        </p>
      {/if}
      {#if exportError}
        <p class="home__meeting-error" data-export-error role="alert">{exportError}</p>
      {/if}
      {#if sessionDetail.assistantName}
        <p class="home__session-detail-assistant">Assistente: {sessionDetail.assistantName}</p>
      {/if}
      {#if sessionDetail.transcript.length === 0}
        <p class="home__meeting-transcript">Sem transcrição nesta sessão.</p>
      {:else}
        <ol class="home__session-transcript">
          {#each sessionDetail.transcript as segment, index (index)}
            <li class="home__session-segment" data-session-segment data-speaker={segment.speaker}>
              <span class="home__session-speaker">
                {segment.speaker === 'SELF' ? 'Você' : 'Outros'}
              </span>
              <span class="home__session-text">{segment.text}</span>
            </li>
          {/each}
        </ol>
      {/if}
    </section>
  {:else}
    <SessionSearch bind:query={searchQuery} />

    <!-- Ouvir Reunião: captura o microfone, transcreve on-device e persiste
         a sessão no banco (copiloto usa o contexto acumulado). -->
    <section class="home__meeting" data-meeting-toggle-section>
      <div class="home__meeting-row">
        <button
          type="button"
          class="home__meeting-toggle"
          class:home__meeting-toggle--on={listening}
          data-meeting-toggle
          onclick={() => void toggleMeeting()}
        >
          <span class="home__meeting-dot" aria-hidden="true"></span>
          {listening ? 'Parar de ouvir' : 'Ouvir reunião'}
        </button>
        {#if listening && metersVisible}
          <div class="home__meters" data-audio-meters>
            <span class="home__meter" title="Canal VOCÊ (microfone)">
              <span class="home__meter-label">VOCÊ</span>
              <span class="home__meter-track">
                <span class="home__meter-fill" data-meter-self style="width: {meterSelf * 100}%"></span>
              </span>
            </span>
            <span class="home__meter" title="Canal OUTROS (áudio recebido)">
              <span class="home__meter-label">OUTROS</span>
              <span class="home__meter-track">
                <span class="home__meter-fill" data-meter-others style="width: {meterOthers * 100}%"></span>
              </span>
            </span>
          </div>
        {/if}
      </div>
      {#if listeningError}
        <p class="home__meeting-error" data-meeting-error>{listeningError}</p>
      {/if}
      {#if timerPromptVisible}
        <div class="home__timer-prompt" data-session-timer-prompt role="alert">
          <span>Continuar gravando?</span>
          <button type="button" class="home__timer-continue" onclick={continueRecording}>
            Continuar
          </button>
        </div>
      {/if}
      {#if listening}
        <p class="home__meeting-transcript" data-meeting-transcript>
          {lastTranscript === '' ? 'Ouvindo… fale para transcrever.' : lastTranscript}
        </p>
      {/if}
    </section>

    <ConversationActions
      sessionId={activeSessionId}
      {assistantId}
      {context}
      {credential}
    />

    <section class="home__grid">
      <AssistantCard {assistant} />
      <MemoryCard {memoryItems} />
    </section>

    {#if sessionDetailError}
      <p class="home__meeting-error">{sessionDetailError}</p>
    {/if}

    <RecentSessions sessions={filteredSessions} onselect={(id) => void openSession(id)} />
  {/if}
</main>

<style>
  .home__meeting {
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
    margin-bottom: 1.6rem;
  }

  .home__meeting-row {
    display: flex;
    align-items: center;
    gap: 1.6rem;
    flex-wrap: wrap;
  }

  .home__meeting-toggle {
    display: inline-flex;
    align-items: center;
    gap: 0.8rem;
    align-self: flex-start;
    font: inherit;
    font-size: 1.3rem;
    font-weight: 600;
    padding: 0.7rem 1.4rem;
    color: var(--text-p);
    background: var(--iris-dim);
    border: 0.1rem solid var(--iris-border);
    border-radius: 0.9rem;
    cursor: pointer;
    transition: background 0.12s;
  }

  .home__meeting-toggle:hover {
    background: rgba(90, 87, 232, 0.32);
  }

  .home__meeting-toggle--on {
    background: rgba(255, 69, 58, 0.16);
    border-color: rgba(255, 69, 58, 0.4);
  }

  .home__meeting-dot {
    width: 0.9rem;
    height: 0.9rem;
    border-radius: 50%;
    background: var(--iris);
  }

  .home__meeting-toggle--on .home__meeting-dot {
    background: var(--error);
    animation: home-pulse 1.2s ease-in-out infinite;
  }

  @keyframes home-pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.3; }
  }

  .home__meters {
    display: flex;
    gap: 1.6rem;
    align-items: center;
  }

  .home__meter {
    display: inline-flex;
    align-items: center;
    gap: 0.6rem;
  }

  .home__meter-label {
    font-size: 1rem;
    font-weight: 600;
    letter-spacing: 0.05em;
    color: var(--text-t);
  }

  .home__meter-track {
    width: 9rem;
    height: 0.4rem;
    border-radius: 0.2rem;
    background: rgba(255, 255, 255, 0.08);
    overflow: hidden;
    display: inline-block;
  }

  .home__meter-fill {
    display: block;
    height: 100%;
    border-radius: 0.2rem;
    background: var(--green);
    transition: width 0.15s ease-out;
  }

  .home__timer-prompt {
    display: flex;
    align-items: center;
    gap: 1.2rem;
    padding: 0.8rem 1.2rem;
    font-size: 1.2rem;
    color: var(--yellow);
    background: rgba(255, 214, 10, 0.08);
    border: 0.1rem solid rgba(255, 214, 10, 0.25);
    border-radius: 0.8rem;
  }

  .home__timer-continue {
    font: inherit;
    font-size: 1.15rem;
    font-weight: 600;
    padding: 0.4rem 1.2rem;
    color: var(--text-p);
    background: rgba(255, 255, 255, 0.08);
    border: 0.1rem solid var(--rim-strong);
    border-radius: 0.6rem;
    cursor: pointer;
  }

  .home__meeting-error {
    margin: 0;
    font-size: 1.2rem;
    color: var(--error);
  }

  .home__meeting-transcript {
    margin: 0;
    font-size: 1.3rem;
    color: var(--text-s);
    line-height: 1.5;
  }

  .home__session-detail {
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  .home__session-detail-header {
    display: flex;
    align-items: center;
    gap: 1.2rem;
  }

  .home__session-export {
    display: flex;
    align-items: center;
    gap: 0.6rem;
  }

  .home__session-export-label {
    font-size: 1.1rem;
    color: var(--text-t);
  }

  .home__export-feedback {
    margin: 0;
    font-size: 1.2rem;
    color: var(--green);
  }

  .home__session-detail-title {
    margin: 0;
    flex: 1;
    font-size: 1.5rem;
    font-weight: 700;
    color: var(--text-p);
  }

  .home__session-detail-assistant {
    margin: 0;
    font-size: 1.2rem;
    color: var(--text-s);
  }

  .home__session-transcript {
    margin: 0;
    padding: 0;
    list-style: none;
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
    max-height: 40rem;
    overflow-y: auto;
  }

  .home__session-segment {
    display: flex;
    gap: 1rem;
    padding: 0.7rem 1rem;
    background: rgba(255, 255, 255, 0.03);
    border-radius: 0.8rem;
  }

  .home__session-speaker {
    flex-shrink: 0;
    width: 5.5rem;
    font-size: 1rem;
    font-weight: 600;
    letter-spacing: 0.04em;
    color: var(--iris);
    text-transform: uppercase;
  }

  .home__session-segment[data-speaker='OTHERS'] .home__session-speaker {
    color: var(--orange);
  }

  .home__session-text {
    font-size: 1.25rem;
    color: var(--text-s);
    line-height: 1.5;
  }

  .home {
    display: flex;
    flex-direction: column;
    gap: 1.4rem;
    max-width: 88rem;
    margin: 0 auto;
    padding: 1.6rem 2rem;
  }

  .home__header {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 1.2rem;
    padding-bottom: 1.4rem;
    border-bottom: 0.1rem solid var(--rim);
  }

  .home__brand {
    font-size: 1.6rem;
    font-weight: 800;
    letter-spacing: -0.03em;
    color: var(--text-p);
  }

  .home__spacer {
    flex: 1;
  }

  .home__nav {
    display: flex;
    gap: 0.8rem;
  }

  .home__nav-button {
    font: inherit;
    font-size: 1.2rem;
    font-weight: 500;
    padding: 0.6rem 1.4rem;
    color: var(--text-s);
    background: rgba(255, 255, 255, 0.06);
    border: 0.1rem solid var(--rim);
    border-radius: 0.7rem;
    cursor: pointer;
    transition:
      background 0.12s,
      color 0.12s;
  }

  .home__nav-button:hover {
    background: rgba(255, 255, 255, 0.1);
    color: var(--text-p);
  }

  .home__grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(24rem, 1fr));
    gap: 1rem;
  }
</style>
