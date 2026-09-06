# surfaces/onboarding — fluxo de 5 passos (T-405 / RF-101)

`Onboarding.svelte` guia o usuário por: permissões → áudio → transcrição →
análise → comunidade/ajuda (opcional, terminal). O uso completo é o default —
não existe passo de trial.

## Props

| Prop | Tipo | Descrição |
|---|---|---|
| `oncomplete` | `() => void` | Chamado quando o usuário clica "Concluir configuracao" no passo 5 |

`App.svelte` recebe o callback e grava `ray_onboarding_done` no `localStorage`.

## Travamento de avanço (`canAdvanceFrom`)

| Passo | Condição para avançar |
|---|---|
| 1 | Todas as permissões exigidas na plataforma `!== 'notGranted'` |
| 2 | `audioDevicesConfigured` |
| 3 | `transcriptionConfigured` |
| 4 | `analysisConfigured` |
| 5 | Terminal — botão "Concluir configuracao" chama `oncomplete` |

## `state-feed.ts`

Fonte de estado do onboarding. Por padrão retorna um placeholder **permissivo**
(todas as permissões `'granted'`, configurações `true`) para não bloquear o fluxo
durante o desenvolvimento sem core real. Quando o comando core existir, injetar
via `setOnboardingStateFeed()`.

## Canais

- `onOnboardingRestart` (restart.ts) — reinicia do passo 1 e relê o estado.
  Inscrito também em `$effect` dentro do componente (além do `App.svelte`).

## Permissões por plataforma (RF-103)

`speechRecognition` é exigida apenas no macOS (STT on-device). Windows/Linux
usam Whisper embutido e não precisam da permissão.
