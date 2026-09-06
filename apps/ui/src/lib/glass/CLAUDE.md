# lib/glass — design system Liquid Glass (T-400 / SRS §8)

Todo painel translúcido do Ray nasce aqui. Não duplicar o material em outro lugar.

## GlassPanel.svelte

Componente base. Aplica o material (vibrancy macOS / backdrop-filter / sólido) e
expõe um slot `children`.

### Props

| Prop | Tipo | Padrão | Descrição |
|---|---|---|---|
| `surface` | `GlassSurfaceId` | — | Superfície cuya opacidade em tempo real o painel segue (RF-506) |
| `opacity` | `number` | — | Override explícito; prevalece sobre o global |
| `mode` | `GlassMode` | auto | `'native'` / `'backdrop'` / `'solid'` |

### Modos (`GlassMode`)

- `native` — vibrancy macOS via `NSWindowSharingNone` (SRS 8.2)
- `backdrop` — `backdrop-filter: blur(...)` (Windows / Linux com compositor)
- `solid` — sem transparência (Linux sem compositor, SRS 8.3)

`resolveGlassMode(detectGlassSupport())` escolhe o modo correto por plataforma;
não passe `mode` manualmente a não ser em testes.

## Outros arquivos

| Arquivo | O que faz |
|---|---|
| `tokens.ts` | Constantes de cor, borda, sombra, blur e padding |
| `opacity.ts` | Canal pub/sub de opacidade por superfície (RF-506) |
| `platform.ts` | Detecção de suporte a vibrancy e modo de vidro |
| `color.ts` | `scaleAlpha` — escala o canal alpha de uma cor CSS |

## Invariante RF-506

A opacidade do painel é ajustável em tempo de execução via o comando
`core/src/windows.rs` — nunca fixar um valor que o usuário não possa mudar.
