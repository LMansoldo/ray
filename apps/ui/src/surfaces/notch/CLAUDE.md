# surfaces/notch — faixa compacta de insights (T-404 / RF-013)

`Notch.svelte` é a **segunda janela Tauri** do Ray. A janela em si (transparente,
always-on-top, excluída de captura) é configurada no core — este componente apenas
renderiza o conteúdo dentro dela.

## O que faz

- Consome o mesmo stream `'suggest-stream'` do Overlay (ponte T-303)
- Exibe o insight ativo via `MarkdownView` (sem Milkdown — streaming live)
- Mantém histórico navegável de insights concluídos (`history.ts`)
- Rola automaticamente para o fim de cada token (RF-701); pausa ao rolar para cima

## Estado interno

| Variável | Descrição |
|---|---|
| `streamState` | Insight em streaming agora (reduzido por `reduceStreamEvent`) |
| `history` | Lista imutável de insights concluídos |
| `viewOffset` | 0 = ao vivo; N = N passos atrás no histórico |

## Navegação do histórico (RF-334)

- `goPrevious()` — incrementa `viewOffset`, clampado em `history.length`
- `goNext()` — decrementa `viewOffset`, mínimo 0 (ao vivo)
- Um evento `start` zera `viewOffset` e volta ao vivo automaticamente (RF-704)

## Material por plataforma (RF-013)

`resolveGlassMode(detectGlassSupport())` — detectado uma vez por montagem.
O `GlassPanel` recebe `mode={material}` e `surface="notch"`.

## Armadilha `$state` + prop `state`

Neste arquivo, `$state<HTMLElement | null>(null)` funciona corretamente porque
não há prop chamada `state` no escopo. Em `InsightCard.svelte` isso seria
ambíguo — ver `overlay/CLAUDE.md`.

## Arquivos auxiliares

| Arquivo | O que faz |
|---|---|
| `history.ts` | `reduceInsightHistory` — acumula insights finalizados |
