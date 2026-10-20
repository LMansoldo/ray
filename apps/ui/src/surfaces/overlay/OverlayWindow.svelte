<script lang="ts">
  // Janela flutuante do Overlay (RF-012 / RF-331): o texto do assistente mora
  // numa janela Tauri PRÓPRIA — transparente, sem decorações, sempre-no-topo,
  // externa à janela main — no mesmo modelo do Notch e da AppBar. Este
  // componente é o ROOT dessa janela: gerencia a própria visibilidade
  // (show_overlay/hide_window), a movimentação por atalho (move_window,
  // RF-507) e a manipulação por mouse — alça de arraste e grip de canto
  // (startDragging/startResizeDragging). O redimensionamento pertence ao
  // container Tauri (bordas nativas + grip); o conteúdo SEMPRE ocupa a
  // largura/altura máximas da janela. O conteúdo em si continua sendo o
  // <Overlay> do T-403 (contrato testado em Overlay.test.ts) — aqui NADA de
  // lógica de stream além do rastreio de status para decidir visibilidade.
  //
  // Regra de ouro (paridade com o Notch): este componente escuta eventos
  // globais mas SÓ invoca comandos que são exclusivamente seus
  // (show_overlay/move_window/set_window_opacity/hide_window do label
  // 'overlay'). Atalhos que o core executa (toggleMicCapture,
  // toggleActionBar…) são ignorados aqui — a janela main também recebe
  // ray:shortcut e os trata; duplicar a invocação executaria a ação duas
  // vezes. Exceção consciente: increaseOpacity/decreaseOpacity são tratados
  // pela main (label 'main') E aqui (label 'overlay') — alvos distintos.
  import { listen } from '@tauri-apps/api/event'
  import { invoke } from '@tauri-apps/api/core'
  import { getCurrentWindow } from '@tauri-apps/api/window'
  import type { SuggestStreamEvent } from '../../../../../contracts/ipc'
  import Overlay from './Overlay.svelte'

  const OVERLAY_LABEL = 'overlay'
  /** Passo discreto do RF-507 (mesmo valor do antigo overlay in-page). */
  const MOVE_STEP = 28
  /** Tempo de leitura antes de recolher um aviso/última resposta fora de reunião. */
  const IDLE_HIDE_MS = 15_000

  const overlayWindow = getCurrentWindow()

  let meetingActive = $state(false)
  let hint = $state('')
  let autoScroll = $state(true)
  // Template customizado do overlay (HTML+CSS do usuário). null = built-in
  // (InsightCard): hidratado de get_app_settings no arranque (com tolerância —
  // comando falhou = built-in) e mantido ao vivo via ray:overlay-template-changed.
  let customTemplate = $state<string | null>(null)

  // Type Safety (general.md): o blob de settings chega como unknown e é
  // estreitado antes de virar template — campo ausente/inválido = built-in.
  function resolveCustomTemplate(settings: unknown): string | null {
    if (!settings || typeof settings !== 'object') return null
    const blob = settings as Record<string, unknown>
    if (blob.overlayTemplateEnabled !== true) return null
    return typeof blob.overlayTemplate === 'string' && blob.overlayTemplate !== ''
      ? blob.overlayTemplate
      : null
  }

  function isOverlayTemplatePayload(
    payload: unknown,
  ): payload is { enabled: boolean; template: string } {
    if (typeof payload !== 'object' || payload === null) return false
    const record = payload as Record<string, unknown>
    return typeof record.enabled === 'boolean' && typeof record.template === 'string'
  }

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

  // ── Opacidade própria (RF-505/506): os atalhos de opacidade da janela main
  // também afetam o overlay — cada janela aplica o comando ao PRÓPRIO label
  // (a main em App.svelte aplica ao 'main'), então não há invocação
  // duplicada. Mesmos limites da main: 0.35..1.0, passo de 0.1.
  let overlayOpacity = 1

  function handleOpacityShortcut(delta: number): void {
    overlayOpacity = Math.min(1, Math.max(0.35, Math.round((overlayOpacity + delta) * 10) / 10))
    void invoke('set_window_opacity', {
      windowLabel: OVERLAY_LABEL,
      opacity: overlayOpacity,
    }).catch(console.error)
  }

  // ── Drag/resize por mouse (a janela é sem decorações) ────────────────────
  //
  // O par nativo vive no core: setup chama enable_movable_by_background e a
  // alça usa -webkit-app-region: drag — o WKWebView inicia o drag pelo AppKit
  // MESMO sem a janela ter foco (com focus:false o primeiro clique só ativa a
  // janela e o mousedown não chega ao JS; o caminho nativo não depende dele).
  // O startDragging abaixo cobre as demais plataformas e chega como no-op
  // quando o AppKit já assumiu o arraste.

  function startWindowDrag(event: PointerEvent): void {
    if (event.button !== 0) return
    void overlayWindow.startDragging().catch(console.error)
  }

  // Depois o resize é todo do container Tauri: bordas nativas (resizable:
  // true no conf) e o grip de canto abaixo via startResizeDragging. O
  // conteúdo SEMPRE preenche a janela (largura/altura máximas) — o texto
  // responde à largura, o DIGA ISSO rola dentro do corpo.
  function startWindowResize(event: PointerEvent): void {
    if (event.button !== 0) return
    void overlayWindow.startResizeDragging('SouthEast').catch(console.error)
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

    // Template customizado: hidrata do banco (tolerância: comando falhou =
    // built-in) e acompanha o evento global — salvar nas Configurações
    // atualiza o overlay AO VIVO, sem reinício (save_overlay_template emite).
    void invoke<unknown>('get_app_settings')
      .then((settings) => {
        customTemplate = resolveCustomTemplate(settings)
      })
      .catch(() => {
        customTemplate = null
      })
    track(
      listen<unknown>('ray:overlay-template-changed', (event) => {
        const payload: unknown = event.payload
        if (isOverlayTemplatePayload(payload) && payload.enabled && payload.template !== '') {
          customTemplate = payload.template
        } else {
          customTemplate = null
        }
      }),
    )

    // RF-507: mover a JANELA (não mais um transform in-page). RF-334:
    // previousResponse/nextResponse viram evento DOM consumido pelo <Overlay>
    // — e os atalhos de insight do NOTCH também navegam o overlay (o evento
    // é broadcast: o Notch consome o dele, o overlay o seu). overlayScroll*
    // rola o corpo do DIGA ISSO (evento DOM consumido pelo InsightCard).
    // Opacidade: ver handleOpacityShortcut acima.
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
        const navInsight: Record<string, 'prev' | 'next'> = {
          previousResponse: 'prev',
          nextResponse: 'next',
          notchPreviousInsight: 'prev',
          notchNextInsight: 'next',
        }
        const nav = navInsight[action]
        if (nav) {
          window.dispatchEvent(new CustomEvent('ray:insight-nav', { detail: { dir: nav } }))
          return
        }
        if (action === 'overlayScrollUp' || action === 'overlayScrollDown') {
          window.dispatchEvent(
            new CustomEvent('ray:overlay-scroll', {
              detail: { dir: action === 'overlayScrollUp' ? 'up' : 'down' },
            }),
          )
          return
        }
        if (action === 'increaseOpacity') handleOpacityShortcut(0.1)
        else if (action === 'decreaseOpacity') handleOpacityShortcut(-0.1)
      }),
    )

    return () => {
      cancelled = true
      cancelHideTimer()
      unlisteners.forEach((fn) => fn())
    }
  })
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="overlay-window" data-overlay-window>
  <div class="overlay-window__drag" data-overlay-drag-handle onpointerdown={startWindowDrag}>
    <span class="overlay-window__grip" aria-hidden="true"></span>
  </div>
  <Overlay {meetingActive} {hint} {autoScroll} {customTemplate} />
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="overlay-window__resize"
    data-overlay-resize-handle
    aria-hidden="true"
    onpointerdown={startWindowResize}
  ></div>
</div>

<style>
  /* O fundo da janela é transparente (app.css pinta body de transparente para
     a superfície 'overlay') — o vidro do card flutua direto sobre o desktop.
     O componente SEMPRE ocupa a largura e altura máximas da janela Tauri: o
     resize pertence ao container (bordas nativas + grip de canto) e o
     conteúdo responde a ele — o card estica para preencher e o DIGA ISSO
     rola dentro do corpo. Sem padding: a borda do card termina EXATAMENTE na
     extremidade da janela (sem sombra, não há vão para preencher). A alça de
     arraste e a navegação de histórico ficam sobrepostas ao card. */
  .overlay-window {
    position: relative;
    width: 100vw;
    height: 100vh;
    padding: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    overflow: hidden;
  }

  /* ── Alça de arraste (sobre o card, no topo) ── */
  .overlay-window__drag {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    z-index: 3;
    width: 100%;
    height: 1.6rem;
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 0.8rem;
    cursor: grab;
    user-select: none;
    -webkit-user-select: none;
    /* Drag NATIVO no macOS: o WKWebView reporta mouseDownCanMoveWindow para
       elementos com app-region: drag e o AppKit arrasta a janela sem JS —
       funciona mesmo com focus:false, onde o primeiro clique não chega ao
       webview. O par disto é enable_movable_by_background no setup do core. */
    -webkit-app-region: drag;
  }

  .overlay-window__drag:active {
    cursor: grabbing;
  }

  .overlay-window__grip {
    /* pointer-events none: o hit-test precisa cair no próprio handle — filhos
       clicáveis quebram app-region: drag (e data-tauri-drag-region). */
    pointer-events: none;
    width: 3.2rem;
    height: 0.3rem;
    border-radius: 999px;
    background: rgba(255, 255, 255, 0.22);
    transition: background 0.12s;
  }

  .overlay-window__drag:hover .overlay-window__grip {
    background: rgba(255, 255, 255, 0.42);
  }

  /* ── Grip de resize (canto inferior direito) ── */
  .overlay-window__resize {
    position: absolute;
    right: 2px;
    bottom: 2px;
    width: 1.6rem;
    height: 1.6rem;
    cursor: nwse-resize;
    user-select: none;
    -webkit-user-select: none;
    opacity: 0.4;
    background: repeating-linear-gradient(
      135deg,
      transparent 0 3px,
      rgba(255, 255, 255, 0.55) 3px 4.5px,
      transparent 4.5px 7px
    );
    -webkit-mask-image: linear-gradient(135deg, transparent 52%, #000 52%);
    mask-image: linear-gradient(135deg, transparent 52%, #000 52%);
    transition: opacity 0.12s;
  }

  .overlay-window:hover .overlay-window__resize {
    opacity: 0.85;
  }

  /* Dentro da janela dedicada o root do Overlay volta ao fluxo (o fixed era
     para flutuar SOBRE a main) e preenche o viewport em cascata: overlay →
     card-wrap → card → bloco DIGA ISSO → corpo rolável. O teto de 46rem do
     Overlay.svelte cai aqui: a largura máxima é a da janela. */
  .overlay-window :global([data-overlay]) {
    position: relative;
    top: auto;
    left: auto;
    width: 100%;
    max-width: none;
    align-items: stretch;
    flex: 1;
    min-height: 0;
  }

  .overlay-window :global(.overlay__card-wrap) {
    position: relative;
    flex: 1;
    min-height: 0;
  }

  /* Navegação de histórico sobreposta ao canto inferior do card (fora do
     fluxo) — o card precisa ocupar a janela INTEIRA para a borda terminar na
     extremidade do container. O offset à direita desvia do grip de resize. */
  .overlay-window :global(.overlay__history) {
    position: absolute;
    right: 2.4rem;
    bottom: 0.4rem;
    z-index: 2;
  }

  .overlay-window :global(.insight-card) {
    width: 100%;
    max-width: 100%;
    flex: 1;
    min-height: 0;
  }

  /* O iframe do template customizado preenche como o InsightCard: a borda do
     card vive DENTRO do template — o frame ocupa a janela inteira. */
  .overlay-window :global([data-custom-overlay-card]) {
    flex: 1;
    min-height: 0;
  }

  .overlay-window :global([data-insight-say-this]) {
    flex: 1;
    min-height: 0;
  }

  .overlay-window :global(.insight-card__body) {
    max-height: none;
    flex: 1;
    min-height: 3rem;
  }
</style>
