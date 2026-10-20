<script lang="ts">
  // Card do Overlay com template HTML+CSS do usuário (sem JavaScript): o
  // template com placeholders {{var}} é renderizado num <iframe
  // sandbox="allow-same-origin"> — SEM allow-scripts (o template não executa
  // JS e o sandbox o isola do IPC do Tauri); allow-same-origin mantém a
  // origem do pai para este componente ler contentDocument e fazer o
  // auto-scroll. O bodyHtml vem do MESMO pipeline do InsightCard
  // (renderOverlayBodyHtml → MarkdownView), então a confiança do conteúdo é
  // idêntica à do card embutido.
  //
  // Reconstrução do srcdoc com debounce: mudança de suggestionId/status é
  // evento DISCRETO (resposta nova ou transição de estado) → imediato; token
  // em streaming é contínuo → trailing debounce (200ms) para não reconstruir
  // o documento a cada token. Auto-scroll (RF-701) e o atalho overlayScroll*
  // espelham o followEnd do InsightCard sobre o [data-ray-body] do template.
  import { renderOverlayBodyHtml, renderOverlayTemplate } from '../../lib/overlay-template'
  import type { CustomOverlayCardProps } from './types'

  let { state, autoScroll = true, template }: CustomOverlayCardProps = $props()

  // DOM refs e flags em `let` simples, NUNCA a rune $state: com a prop
  // `state` no escopo o compilador resolve `$state` como a assinatura legada
  // de store e gera store_invalid_shape em runtime (mesmo trap do
  // InsightCard — ver decisions.md).
  let frame: HTMLIFrameElement | null = null

  // RF-701: segue o fim do conteúdo enquanto o usuário não rolou para cima.
  let followEnd = true

  // Debounce do streaming: cada token reinicia o timer; o doc só é
  // reconstruído quando o texto estabiliza por 200ms.
  const STREAM_DEBOUNCE_MS = 200
  let renderTimer: ReturnType<typeof setTimeout> | null = null

  let prevSuggestionId: string | null | undefined
  let prevStatus: string | null | undefined

  function currentHtml(): string {
    return renderOverlayTemplate(template, {
      contextLabel: state.contextLabel ?? '',
      theySaid: state.theySaid ?? '',
      bodyHtml: renderOverlayBodyHtml(state.text),
      status: state.status,
      error: state.error?.message ?? '',
    })
  }

  // Acesso a contentDocument é OPCIONAL e protegido: sandbox sem
  // allow-scripts mantém same-origin no WKWebView/Chromium, mas ambientes de
  // teste (jsdom) podem não carregar srcdoc — sem crash, sem auto-scroll.
  function bodyOfFrame(): HTMLElement | null | undefined {
    try {
      return frame?.contentDocument?.querySelector<HTMLElement>('[data-ray-body]')
    } catch {
      return null
    }
  }

  // O srcdoc novo substitui o document inteiro: o listener de scroll
  // (followEnd) precisa ser reanexado ao corpo da nova árvore.
  function attachScrollTracking(): void {
    try {
      const body = bodyOfFrame()
      if (!body) return
      body.addEventListener('scroll', () => {
        const reachedEnd = body.scrollTop + body.clientHeight >= body.scrollHeight
        followEnd = reachedEnd
      })
    } catch {
      // same-origin indisponível — rolagem manual do usuário dentro do iframe
      // não reavalia followEnd; o auto-scroll segue do último valor conhecido.
    }
  }

  function applyScrollToEnd(): void {
    if (!followEnd || !autoScroll) return
    try {
      const body = bodyOfFrame()
      if (body) body.scrollTop = body.scrollHeight - body.clientHeight
    } catch {
      // same-origin indisponível — sem auto-scroll (degradação graciosa)
    }
  }

  function renderNow(): void {
    const target = frame
    if (target === null) return
    target.setAttribute('srcdoc', currentHtml())
    // No webview o novo documento carrega async (o onload reanexa o tracking
    // e aplica o scroll); a chamada direta cobre ambientes síncronos.
    attachScrollTracking()
    applyScrollToEnd()
  }

  // Dependências registradas por leitura: suggestionId/status → render
  // imediato; texto/erro/contexto em streaming → trailing debounce.
  $effect(() => {
    const suggestionId = state.suggestionId
    const status = state.status
    state.text
    state.contextLabel
    state.theySaid
    state.error?.message

    const discrete = suggestionId !== prevSuggestionId || status !== prevStatus
    prevSuggestionId = suggestionId
    prevStatus = status

    if (discrete) {
      if (renderTimer !== null) {
        clearTimeout(renderTimer)
        renderTimer = null
      }
      renderNow()
      return
    }
    if (renderTimer !== null) clearTimeout(renderTimer)
    renderTimer = setTimeout(() => {
      renderTimer = null
      renderNow()
    }, STREAM_DEBOUNCE_MS)
  })

  // Unmount: não deixar timer órfão disparando após a remoção.
  $effect(() => {
    return () => {
      if (renderTimer !== null) {
        clearTimeout(renderTimer)
        renderTimer = null
      }
    }
  })

  // Documento novo carregado: reanexa o tracking de followEnd e leva a
  // rolagem ao fim (o corpo recém-criado começa no topo).
  function handleFrameLoad(): void {
    attachScrollTracking()
    applyScrollToEnd()
  }

  // Atalhos overlayScroll* (OverlayWindow → evento DOM ray:overlay-scroll):
  // rolam o [data-ray-body] do template no mesmo passo do InsightCard
  // (80px mínimo / 60% da altura); parar no fim retoma o auto-scroll,
  // subir o pausa (RF-701).
  const OVERLAY_SCROLL_MIN_STEP_PX = 80

  function handleOverlayScrollShortcut(event: Event): void {
    const dir = (event as CustomEvent<{ dir?: string }>).detail?.dir
    if (dir !== 'up' && dir !== 'down') return
    try {
      const body = bodyOfFrame()
      if (!body) return
      const step = Math.max(
        OVERLAY_SCROLL_MIN_STEP_PX,
        Math.floor(body.clientHeight * 0.6),
      )
      body.scrollTop += dir === 'up' ? -step : step
      followEnd = body.scrollTop + body.clientHeight >= body.scrollHeight
    } catch {
      // same-origin indisponível — sem rolagem via atalho
    }
  }

  $effect(() => {
    window.addEventListener('ray:overlay-scroll', handleOverlayScrollShortcut)
    return () => {
      window.removeEventListener('ray:overlay-scroll', handleOverlayScrollShortcut)
    }
  })
</script>

<iframe
  class="custom-overlay-card"
  data-custom-overlay-card
  title="Insight do overlay (template customizado)"
  sandbox="allow-same-origin"
  bind:this={frame}
  onload={handleFrameLoad}
></iframe>

<style>
  /* O iframe ocupa 100% do container (no overlay, a janela inteira): a borda
     do card é desenhada DENTRO do template — o frame em si é invisível. */
  .custom-overlay-card {
    display: block;
    width: 100%;
    height: 100%;
    border: none;
    background: transparent;
    color-scheme: dark;
  }
</style>
