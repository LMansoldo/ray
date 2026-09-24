# surfaces/overlay — modal de sessão em tempo real (T-403 / RF-012)

Três componentes: `OverlayWindow.svelte` (root da janela flutuante dedicada),
`Overlay.svelte` (container do conteúdo) e `InsightCard.svelte` (card canônico
de insight, reutilizável pelo Notch).

## OverlayWindow.svelte — a janela flutuante

O texto do assistente vive numa **janela Tauri própria** (label `overlay`,
configurada em `core/tauri.conf.json`: transparente, sem decorações,
always-on-top, fora da janela main) — mesmo modelo do Notch e da AppBar. Este
componente é o root dessa janela e cuida SÓ da gestão de janela:

- Visibilidade: `show_overlay` (reunião iniciada, hint, insight em streaming,
  **erro no stream**, stealth-unsupported) e `hide_window` (reunião
  encerrada). Fora de reunião, conteúdo transitório recolhe após 15s de
  leitura. Falha nunca é silenciosa: o core emite start+error em falhas
  pré-stream (vault/HTTP) e a janela abre também no error puro.
- Movimento (RF-507): atalhos `moveModal*` movem a **janela** via
  `move_window` — não existe mais transform in-page. Por mouse: alça no topo
  do conteúdo (`[data-overlay-drag-handle]`) — duplo caminho, nativo
  (`-webkit-app-region: drag` + `enable_movable_by_background` no setup do
  core, que funciona com `focus: false` porque não depende de mousedown no
  webview) e `startDragging()` da Window API como fallback multiplataforma.
- Atalhos de conteúdo (todos via `ray:shortcut`): `previousResponse`/
  `nextResponse` E `notchPreviousInsight`/`notchNextInsight` navegam o
  histórico do overlay (evento DOM `ray:insight-nav`, consumido pelo
  `<Overlay>`); `overlayScrollUp`/`overlayScrollDown` rolam o corpo do DIGA
  ISSO (evento DOM `ray:overlay-scroll`, consumido pelo `InsightCard` —
  reavalia `followEnd` da rolagem automática); `increaseOpacity`/
  `decreaseOpacity` aplicam `set_window_opacity` ao PRÓPRIO label `overlay`
  (a main aplica ao dela em App.svelte — alvos distintos, sem duplicação).
- Redimensionamento: o tamanho é TODO do container Tauri — bordas nativas
  (`resizable: true` no conf) e grip no canto inferior direito
  (`[data-overlay-resize-handle]`, `startResizeDragging('SouthEast')`).
  NÃO existe auto-fit (`resize_window` nunca é invocado daqui): o componente
  sempre ocupa a largura/altura máximas da janela (`100vw/100vh`), o card
  preenche em cascata e o DIGA ISSO rola dentro do corpo (o body da
  superfície `overlay` é transparente via `body[data-surface='overlay']` em
  app.css). O texto (inclusive blocos de código) quebra na largura
  disponível (`MarkdownView` aplica `pre-wrap`/`overflow-wrap: anywhere`).
- O conteúdo continua sendo `<Overlay>` (abaixo) — nada de stream aqui além
  do rastreio de status para visibilidade.

**Regra de paridade com o Notch:** este componente escuta eventos globais mas
NUNCA invoca comandos que a janela main também trata (`toggle_mic_capture`,
`toggle_window`…) — a duplicação executaria a ação duas vezes.

## Overlay.svelte

- Posição controlada por prop `{ x, y }` — aplicada como `transform: translate`
- Escuta o evento Tauri `'suggest-stream'` e alimenta o redutor `reduceStreamEvent`
- Monta `InsightCard` apenas quando `streamState.status !== 'idle'`
- Uma assinatura por montagem; cancelamento no unmount

## InsightCard.svelte

Card com três seções: contexto (ícone + label), "ELES DISSERAM" (fala do outro
falante) e "DIGA ISSO" (sugestão em Markdown streaming via `MarkdownView`).

### Props

| Prop | Tipo | Descrição |
|---|---|---|
| `state` | `InsightCardState` | Estado corrente do stream |

### Armadilha `$state` com prop chamada `state`

Variáveis reativas dentro de `InsightCard` devem usar `let` simples, **não** a
rune `$state`. Se `$state` for usado enquanto existe uma prop `state` no escopo,
o compilador Svelte 5 resolve como acesso ao store legado e gera `store_invalid_shape`
em runtime. `followEnd` e `sayThisBody` são `let` por esse motivo.

### Rolagem automática (RF-701)

`followEnd` acompanha o fim do conteúdo enquanto o usuário não rolar para cima.
O `$effect` lê `state.text` para registrar a dependência e executa após cada
atualização de DOM.

## Arquivos auxiliares

| Arquivo | O que faz |
|---|---|
| `stream.ts` | `reduceStreamEvent`, `INITIAL_SUGGESTION_STREAM` |
| `overlay-actions.ts` | `dispatchOverlayAction` — ex. `viewUseCase` |
| `types.ts` | `InsightCardState`, `OverlayProps` |

## Narrowing de tipo (general.md)

O payload de `listen<unknown>` é estreitado por `isSuggestStreamEvent` antes de
entrar no redutor. Nunca remover o type guard ou usar `as SuggestStreamEvent`
diretamente.
