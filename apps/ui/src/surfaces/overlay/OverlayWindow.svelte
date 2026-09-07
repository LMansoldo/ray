<script lang="ts">
  // Janela flutuante do Overlay (RF-012 / RF-331): o texto do assistente mora
  // numa janela Tauri PRÓPRIA — transparente, sem decorações, sempre-no-topo,
  // externa à janela main — no mesmo modelo do Notch e da AppBar. Este
  // componente é o ROOT dessa janela: gerencia a própria visibilidade
  // (show_overlay/hide_window), a movimentação por atalho (move_window,
  // RF-507) e o redimensionamento ao conteúdo (resize_window). O conteúdo em
  // si continua sendo o <Overlay> do T-403 (contrato testado em
  // Overlay.test.ts) — aqui NADA de lógica de stream além do rastreio de
  // status para decidir visibilidade.
  //
  // Regra de ouro (paridade com o Notch): este componente escuta eventos
  // globais mas SÓ invoca comandos que são exclusivamente seus
  // (show_overlay/move_window/resize_window/hide_window do label 'overlay').
  // Atalhos que o core executa (toggleMicCapture, toggleActionBar…) são
  // ignorados aqui — a janela main também recebe ray:shortcut e os trata;
  // duplicar a invocação executaria a ação duas vezes.
  import { listen } from '@tauri-apps/api/event'
  import { invoke } from '@tauri-apps/api/core'
  import type { SuggestStreamEvent } from '../../../../../contracts/ipc'
  import Overlay from './Overlay.svelte'

  const OVERLAY_LABEL = 'overlay'
  /** Passo discreto do RF-507 (mesmo valor do antigo overlay in-page). */
  const MOVE_STEP = 28
  /** Tempo de leitura antes de recolher um aviso/última resposta fora de reunião. */
  const IDLE_HIDE_MS = 15_000

  let meetingActive = $state(false)
  let hint = $state('')
  let autoScroll = $state(true)

  let hideTimer: ReturnType<typeof setTimeout> | null = null

  function cancelHideTimer(): void {
    if (hideTimer !== null) {
      clearTimeout(hideTimer)
      hideTimer = null
    }
  }

  /// Fora de reunião, conteúdo transitório (aviso, última resposta) recolhe a
  /// janela depois de um tempo de leitura; em reunião ela permanece (botão de
  /// encerrar sempre disponível) até ray:meeting-stopped.
  function armIdleHide(): void {
    cancelHideTimer()
    if (meetingActive) return
    hideTimer = setTimeout(() => {
      hideTimer = null
      void invoke('hide_window', { windowLabel: OVERLAY_LABEL }).catch(console.error)
    }, IDLE_HIDE_MS)
  }

  function showWindow(sticky: boolean): void {
    void invoke('show_overlay').catch(console.error)
    if (sticky) {
      cancelHideTimer()
    } else {
      armIdleHide()
    }
  }

  function hideWindow(): void {
    cancelHideTimer()
    void invoke('hide_window', { windowLabel: OVERLAY_LABEL }).catch(console.error)
  }

  // Type Safety (general.md): payload chega como unknown e é estreitado em
  // runtime antes de qualquer uso (mesma guarda de Overlay.svelte/Notch.svelte).
  function isSuggestStreamEvent(payload: unknown): payload is SuggestStreamEvent {
    if (typeof payload !== 'object' || payload === null) return false
    const event = payload as Record<string, unknown>
    switch (event.type) {
      case 'start':
        return typeof event.suggestionId === 'string'
      case 'token':
        return typeof event.text === 'string'
      case 'done':
        return typeof event.providerKind === 'string'
      case 'error': {
        const error = event.error
        if (typeof error !== 'object' || error === null) return false
        const detail = error as Record<string, unknown>
        return typeof detail.code === 'string' && typeof detail.message === 'string'
      }
      default:
        return false
    }
  }

  // A janela acompanha o status do stream apenas para visibilidade; a redução
  // do conteúdo acontece dentro de <Overlay>. Erro também ABRE a janela —
  // falha invisível é bug (o usuário precisa do motivo).
  function handleStreamEventForVisibility(payload: SuggestStreamEvent): void {
    if (payload.type === 'start') {
      showWindow(true)
    } else if (payload.type === 'error') {
      showWindow(true)
    } else if (payload.type === 'done') {
      armIdleHide()
    }
  }

  $effect(() => {
    let cancelled = false
    const unlisteners: Array<() => void> = []
    const track = (promise: Promise<() => void>): void => {
      void promise.then((fn) => {
        if (cancelled) {
          fn()
          return
        }
        unlisteners.push(fn)
      })
    }

    track(
      listen('ray:meeting-started', () => {
        meetingActive = true
        showWindow(true)
      }),
    )
    track(
      listen('ray:meeting-stopped', () => {
        meetingActive = false
        hint = ''
        hideWindow()
      }),
    )
    track(
      listen<{ text: string }>('ray:analysis-hint', (event) => {
        hint = event.payload.text
        showWindow(meetingActive)
      }),
    )
    track(
      listen<unknown>('suggest-stream', (event) => {
        const payload: unknown = event.payload
        if (isSuggestStreamEvent(payload)) handleStreamEventForVisibility(payload)
      }),
    )
    track(
      listen('stealth-unsupported', () => {
        hint = 'Stealth não suportado neste sistema — as janelas podem aparecer na captura.'
        showWindow(meetingActive)
      }),
    )
    track(
      listen<{ autoScroll?: boolean }>('ray:features-changed', (event) => {
        autoScroll = event.payload?.autoScroll !== false
      }),
    )

    // RF-507: mover a JANELA (não mais um transform in-page). RF-334:
    // previousResponse/nextResponse viram evento DOM consumido pelo <Overlay>.
    track(
      listen<{ action: string }>('ray:shortcut', (event) => {
        const action = event.payload.action
        const moves: Record<string, [number, number]> = {
          moveModalLeft: [-MOVE_STEP, 0],
          moveModalRight: [MOVE_STEP, 0],
          moveModalUp: [0, -MOVE_STEP],
          moveModalDown: [0, MOVE_STEP],
        }
        const move = moves[action]
        if (move) {
          void invoke('move_window', {
            windowLabel: OVERLAY_LABEL,
            dx: move[0],
            dy: move[1],
          }).catch(console.error)
          return
        }
        if (action === 'previousResponse' || action === 'nextResponse') {
          window.dispatchEvent(
            new CustomEvent('ray:insight-nav', {
              detail: { dir: action === 'previousResponse' ? 'prev' : 'next' },
            }),
          )
        }
      }),
    )

    return () => {
      cancelled = true
      cancelHideTimer()
      unlisteners.forEach((fn) => fn())
    }
  })

  // A janela cresce com o conteúdo (o card tem teto próprio de 18rem no
  // DIGA ISSO; a folga cobre a sombra projetada pelo vidro).
  let resizeRoot: HTMLElement | null = null

  $effect(() => {
    const root = resizeRoot
    if (root === null) return
    const observer = new ResizeObserver(() => {
      const height = Math.ceil(root.getBoundingClientRect().height) + 24
      void invoke('resize_window', {
        windowLabel: OVERLAY_LABEL,
        width: 460,
        height: Math.max(120, height),
      }).catch(console.error)
    })
    observer.observe(root)
    return () => {
      observer.disconnect()
    }
  })
</script>

<div class="overlay-window" data-overlay-window bind:this={resizeRoot}>
  <Overlay {meetingActive} {hint} {autoScroll} />
</div>

<style>
  /* O fundo da janela é transparente (app.css pinta body de transparente para
     a superfície 'overlay') — o vidro do card flutua direto sobre o desktop.
     O padding dá respiro às sombras; sem cor própria. */
  .overlay-window {
    min-height: 100vh;
    padding: 12px 16px;
    display: flex;
    flex-direction: column;
    align-items: center;
  }

  /* Dentro da janela dedicada o root do Overlay volta ao fluxo (o fixed era
     para flutuar SOBRE a main) — o wrapper passa a medir o conteúdo real
     para o resize_window. */
  .overlay-window :global([data-overlay]) {
    position: relative;
    top: auto;
    left: auto;
  }
</style>
