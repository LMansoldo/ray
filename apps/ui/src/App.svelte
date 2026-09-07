<script lang="ts">
  import { onMount } from 'svelte'
  import { getCurrentWindow } from '@tauri-apps/api/window'
  import { listen, emit as emitTauri } from '@tauri-apps/api/event'
  import AppBar from './surfaces/appbar/AppBar.svelte'
  import Home from './surfaces/home/Home.svelte'
  import Onboarding from './surfaces/onboarding/Onboarding.svelte'
  import Settings from './surfaces/settings/Settings.svelte'
  import Assistants from './surfaces/assistants/Assistants.svelte'
  import OverlayWindow from './surfaces/overlay/OverlayWindow.svelte'
  import Notch from './surfaces/notch/Notch.svelte'
  import { onHomeNavigate } from './surfaces/home/navigation'
  import { onOnboardingRestart } from './surfaces/onboarding/restart'
  import { onSettingsAction } from './surfaces/settings/settings-actions'
  import { invoke } from '@tauri-apps/api/core'
  import { DEFAULT_FEATURE_TOGGLES } from '../../../contracts/settings'
  import type { FeatureToggles } from '../../../contracts/settings'
  import type {
    CredentialSummary,
    InjectedCredential,
    TranscriptContextSegment,
  } from '../../../contracts/ipc'
  import type { HomeProps, SessionSummary } from './surfaces/home/types'

  type Surface = 'onboarding' | 'home' | 'settings' | 'assistants'

  const ONBOARDING_DONE_KEY = 'ray_onboarding_done'
  const SELECTED_ASSISTANT_KEY = 'ray_selected_assistant'
  const MODELS_KEY = 'ray_models'
  const METERS_KEY = 'ray_audio_meters'

  const currentWindow = getCurrentWindow()
  const windowLabel = currentWindow.label
  const isAppBarWindow = windowLabel === 'appbar'
  const isNotchWindow = windowLabel === 'notch'
  const isOverlayWindow = windowLabel === 'overlay'

  // Superfícies flutuantes de conteúdo (overlay) não pintam fundo: o vidro do
  // card flutua direto sobre o desktop (ver app.css). As demais mantêm o body
  // escuro padrão.
  document.body.dataset.surface = windowLabel

  const initialSurface: Surface = localStorage.getItem(ONBOARDING_DONE_KEY)
    ? 'home'
    : 'onboarding'

  let surface = $state<Surface>(initialSurface)
  let meetingActive = $state(false)
  let transcript = $state<TranscriptContextSegment[]>([])
  let sessions = $state<SessionSummary[]>([])

  // ── Assistente selecionado (RF-337): a escolha da biblioteca troca a
  // capacidade ativa do copiloto — persiste entre sessões do app.
  let selectedAssistant = $state<{
    id: string
    name: string
    category: string
  } | null>(readStoredAssistant())

  function readStoredAssistant(): { id: string; name: string; category: string } | null {
    try {
      const raw = localStorage.getItem(SELECTED_ASSISTANT_KEY)
      if (!raw) return null
      const parsed = JSON.parse(raw)
      if (typeof parsed?.id === 'string' && typeof parsed?.name === 'string') {
        return { id: parsed.id, name: parsed.name, category: String(parsed.category ?? 'GENERAL') }
      }
    } catch {
      /* entrada corrompida — ignora */
    }
    return null
  }

  // ── Credencial real (RF-333): a UI passa o secretRef da primeira credencial
  // persistida — o núcleo resolve o segredo no cofre (ADR-003). Sem segredo
  // em claro na UI; sem credencial, os fluxos avisam via hint.
  let credential = $state<InjectedCredential>({
    kind: 'OPENAI',
    connectionMode: 'API_KEY',
    secret: '',
  })

  async function refreshCredential(): Promise<void> {
    try {
      const res = await invoke<{ credentials: CredentialSummary[] }>('get_provider_statuses')
      const cred = res.credentials[0]
      if (cred) {
        credential = {
          kind: cred.kind,
          connectionMode: cred.connectionMode,
          secret: cred.secretRef,
          baseUrl: cred.baseUrl,
        }
      }
    } catch {
      /* sidecar fora — mantém o estado */
    }
  }

  // ── Config de modelos por função (aba Modelos, localStorage) ───────────
  type ModelConfig = { kind?: string; model?: string }
  let modelsConfig = $state<Record<string, ModelConfig>>(readModels())

  function readModels(): Record<string, ModelConfig> {
    try {
      const raw = localStorage.getItem(MODELS_KEY)
      if (raw) return JSON.parse(raw)
    } catch {
      /* ignora */
    }
    return {}
  }

  // ── Features (RF-700) + medidores (RF-206) ─────────────────────────────
  let features = $state<FeatureToggles>({ ...DEFAULT_FEATURE_TOGGLES })
  let metersVisible = $state(localStorage.getItem(METERS_KEY) !== '0')

  async function loadFeatures(): Promise<void> {
    try {
      const settings = await invoke<{ features?: FeatureToggles }>('get_app_settings')
      if (settings?.features) features = { ...DEFAULT_FEATURE_TOGGLES, ...settings.features }
    } catch {
      /* defaults */
    }
  }

  // ── Janela: opacidade e sempre-no-topo (RF-505/506). A posição do overlay
  // flutuante agora é a posição da janela própria (move_window no núcleo).
  let alwaysOnTop = $state(false)
  let windowOpacity = $state(1)

  // ── Memória em tempo real (RF-339): deriva da transcrição ao vivo ──────
  const memoryItems = $derived(
    transcript
      .slice(-6)
      .reverse()
      .map((segment, index) => ({
        id: `mem-${index}-${segment.startMs}`,
        text: segment.text,
      })),
  )

  const homeProps: HomeProps = {
    get sessions() {
      return sessions
    },
    get assistant() {
      return {
        name: selectedAssistant?.name ?? 'Assistente Padrão',
        category: (selectedAssistant?.category ?? 'GENERAL') as HomeProps['assistant']['category'],
      }
    },
    get memoryItems() {
      return memoryItems
    },
    sessionId: '',
    get assistantId() {
      return selectedAssistant?.id ?? ''
    },
    get context() {
      return transcript
    },
    get credential() {
      return { ...credential, model: modelsConfig.ANALYSIS?.model || undefined }
    },
    get metersVisible() {
      return metersVisible
    },
    get sessionTimerEnabled() {
      return features.sessionTimer
    },
  }

  function goTo(next: Surface): void {
    surface = next
  }

  // ── Atalhos globais repassados pelo core via ray:shortcut (RF-600) ─────
  // Os comandos de núcleo (captura, reunião, pergunta) já agiram no core;
  // aqui ficam as ações de janela/UI da janela main.
  function handleShortcutAction(action: string): void {
    switch (action) {
      case 'toggleActionBar': {
        void invoke('toggle_window', { windowLabel: 'appbar' }).catch(console.error)
        break
      }
      case 'toggleWindowVisibility': {
        void invoke('toggle_window', { windowLabel: 'main' }).catch(console.error)
        break
      }
      case 'toggleAlwaysOnTop': {
        alwaysOnTop = !alwaysOnTop
        void invoke('set_always_on_top', { windowLabel: 'main', enabled: alwaysOnTop }).catch(
          console.error,
        )
        break
      }
      case 'increaseOpacity':
      case 'decreaseOpacity': {
        const delta = action === 'increaseOpacity' ? 0.1 : -0.1
        windowOpacity = Math.min(1, Math.max(0.35, Math.round((windowOpacity + delta) * 10) / 10))
        void invoke('set_window_opacity', { windowLabel: 'main', opacity: windowOpacity }).catch(
          console.error,
        )
        break
      }
      case 'scrollUp':
      case 'scrollDown': {
        window.scrollBy({ top: action === 'scrollUp' ? -360 : 360, behavior: 'smooth' })
        break
      }
      case 'toggleMicCapture': {
        // O núcleo emite o aviso (pausado/retomado) via ray:analysis-hint —
        // quem o exibe é a janela flutuante do Overlay.
        void invoke<boolean>('toggle_mic_capture').catch(console.error)
        break
      }
      default:
        break
    }
  }

  async function refreshSessions(): Promise<void> {
    try {
      const res = await invoke<{ sessions: Array<SessionSummary & { startedAt: string }> }>(
        'list_sessions',
      )
      if (Array.isArray(res?.sessions)) {
        sessions = res.sessions.map((session) => ({
          id: session.id,
          title: session.title,
          startedAt: session.startedAt,
          segmentCount: session.segmentCount,
        }))
      }
    } catch {
      /* sidecar fora — mantém a lista */
    }
  }

  function syncNotchVisibility(): void {
    if (isNotchWindow) return
    const command = meetingActive && features.notchExperience ? 'show_notch' : 'hide_window'
    const args =
      command === 'show_notch' ? {} : { windowLabel: 'notch' }
    void invoke(command, args).catch(() => {
      /* janela inexistente em dev — silencioso */
    })
  }

  onMount(() => {
    // A janela flutuante do overlay gere a própria visibilidade/movimento em
    // OverlayWindow.svelte — nada da lógica da main roda aqui.
    if (isOverlayWindow) return

    if (isAppBarWindow || isNotchWindow) {
      // O Notch navega o próprio histórico ouvindo ray:shortcut direto.
      if (isNotchWindow) {
        let unlistenNotchShortcut: (() => void) | undefined
        void listen<{ action: string }>('ray:shortcut', (event) => {
          if (event.payload.action === 'notchPreviousInsight') {
            window.dispatchEvent(new CustomEvent('ray:notch-nav', { detail: { dir: 'prev' } }))
          } else if (event.payload.action === 'notchNextInsight') {
            window.dispatchEvent(new CustomEvent('ray:notch-nav', { detail: { dir: 'next' } }))
          }
        }).then((fn) => {
          unlistenNotchShortcut = fn
        })
        return () => {
          unlistenNotchShortcut?.()
        }
      }
      return
    }

    // Primeira execucao: exibir automaticamente para o onboarding.
    if (!localStorage.getItem(ONBOARDING_DONE_KEY)) {
      void currentWindow.show()
    }

    // Assistente default (BUILTIN) quando não há seleção persistida.
    if (!selectedAssistant) {
      void invoke<{ id: string; name: string; category: string } | null>('get_default_assistant')
        .then((a) => {
          if (a?.id) {
            selectedAssistant = { id: a.id, name: a.name, category: a.category }
          }
        })
        .catch((err) => console.error('[get_default_assistant]', err))
    }

    void refreshCredential()
    void loadFeatures()
    void refreshSessions()

    const unlisteners: Array<() => void> = []
    const track = (promise: Promise<() => void>): void => {
      void promise.then((fn) => unlisteners.push(fn))
    }

    // ── Eventos do núcleo ────────────────────────────────────────────────
    track(
      listen('ray:meeting-started', () => {
        meetingActive = true
        syncNotchVisibility()
      }),
    )
    track(
      listen('ray:meeting-stopped', () => {
        meetingActive = false
        void refreshSessions()
        syncNotchVisibility()
      }),
    )
    track(
      listen<{ action: string }>('ray:shortcut', (event) => {
        handleShortcutAction(event.payload.action)
      }),
    )
    track(
      listen('ray:screen-captured', () => {
        // O payload é só o caminho em disco (app_data/captures) — a imagem
        // em base64 nunca reside na UI; quem precisa dela lê via
        // latest_capture no ato do request. Aqui: apenas navegar para a Home.
        goTo('home')
      }),
    )
    track(
      listen<{ speaker: string; text: string }>('ray:transcript', (event) => {
        const speaker: TranscriptContextSegment['speaker'] =
          event.payload.speaker === 'self' ? 'SELF' : 'OTHERS'
        transcript = [
          ...transcript,
          {
            speaker,
            text: event.payload.text,
            startMs: Date.now(),
          },
        ].slice(-40)
      }),
    )
    track(
      listen<{ surface: Surface }>('ray:navigate', (event) => {
        goTo(event.payload.surface)
      }),
    )
    track(
      listen('ray:credentials-changed', () => {
        void refreshCredential()
      }),
    )

    // ── Eventos das superfícies (outras janelas/abas) ────────────────────
    track(
      listen<{ id: string; name: string; category: string }>('ray:assistant-changed', (event) => {
        selectedAssistant = event.payload
        localStorage.setItem(SELECTED_ASSISTANT_KEY, JSON.stringify(event.payload))
      }),
    )
    track(
      listen<FeatureToggles>('ray:features-changed', (event) => {
        if (event.payload) {
          features = { ...DEFAULT_FEATURE_TOGGLES, ...event.payload }
          syncNotchVisibility()
        }
      }),
    )
    track(
      listen<Record<string, ModelConfig>>('ray:models-changed', (event) => {
        modelsConfig = event.payload ?? {}
      }),
    )
    track(
      listen<{ visible: boolean }>('ray:meters-changed', (event) => {
        metersVisible = event.payload?.visible !== false
      }),
    )

    const unsubHome = onHomeNavigate((dest) => goTo(dest))

    const unsubRestart = onOnboardingRestart(() => {
      localStorage.removeItem(ONBOARDING_DONE_KEY)
      goTo('onboarding')
    })

    const unsubSettings = onSettingsAction(async (action) => {
      if (action.type === 'credentialSave') {
        try {
          await invoke('save_credential', {
            slot: action.slot,
            kind: action.kind,
            connectionMode: action.connectionMode,
            secret: action.secret,
            baseUrl: action.baseUrl,
          })
          let valid: boolean | undefined
          let reason: string | undefined
          try {
            const result = await invoke<{ valid: boolean; reason?: string }>(
              'validate_credential',
              { slot: action.slot },
            )
            valid = result.valid
            reason = result.reason
          } catch (err) {
            console.error('[validate_credential]', err)
            reason = String(err)
          }
          await emitTauri('ray:credentials-changed', {
            slot: action.slot,
            valid,
            reason,
          })
        } catch (err) {
          console.error('[save_credential]', err)
        }
      }

      if (action.type === 'logFolderOpen') {
        await invoke('open_logs_folder')
      }

      if (action.type === 'logCopy') {
        await invoke('copy_logs_to_clipboard')
      }
    })

    return () => {
      unlisteners.forEach((fn) => fn())
      unsubHome()
      unsubRestart()
      unsubSettings()
    }
  })

  function handleOnboardingComplete(): void {
    localStorage.setItem(ONBOARDING_DONE_KEY, '1')
    goTo('home')
  }
</script>

{#if isAppBarWindow}
  <AppBar />
{:else if isNotchWindow}
  <Notch />
{:else if isOverlayWindow}
  <OverlayWindow />
{:else}
  <div class="app">
    {#if surface === 'onboarding'}
      <Onboarding oncomplete={handleOnboardingComplete} />
    {:else if surface === 'home'}
      <Home {...homeProps} />
    {:else if surface === 'settings'}
      <Settings />
    {:else if surface === 'assistants'}
      <Assistants />
    {/if}
  </div>
{/if}

<style>
  .app {
    min-height: 100vh;
    display: flex;
    flex-direction: column;
    background: var(--void);
  }
</style>
