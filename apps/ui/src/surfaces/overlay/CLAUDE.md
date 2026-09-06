# surfaces/overlay — modal de sessão em tempo real (T-403 / RF-012)

Dois componentes: `Overlay.svelte` (container posicionável) e `InsightCard.svelte`
(card canônico de insight, reutilizável pelo Notch).

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
