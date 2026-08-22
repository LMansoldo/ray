# App.svelte — roteador raiz (duas janelas Tauri)

`App.svelte` e o unico ponto de entrada do Vite — servido por AMBAS as janelas
Tauri (`appbar` e `main`). Detecta em qual janela esta rodando via
`getCurrentWindow().label` e renderiza de acordo.

## Rendering por janela

| `getCurrentWindow().label` | O que renderiza |
|---|---|
| `'appbar'` | Apenas `<AppBar />` |
| `'main'` | Surface ativa (onboarding / home / settings / assistants) |

## Surfaces da janela `main`

| `surface` | Componente |
|---|---|
| `onboarding` | `Onboarding.svelte` |
| `home` | `Home.svelte` |
| `settings` | `Settings.svelte` |
| `assistants` | `Assistants.svelte` |

## Canais inscritos no `onMount` (janela `main` apenas)

- `listen<{ surface: Surface }>('ray:navigate', ...)` — evento Tauri cross-window emitido pelo AppBar
- `onHomeNavigate` — acoes internas da Home que abrem Settings ou Assistants
- `onOnboardingRestart` — reinicio via Ajuda → Reiniciar Integracao

A janela `appbar` retorna cedo do `onMount` — sem listeners.

## Invariantes

- `ray_onboarding_done` no `localStorage` decide o surface inicial.
- A janela `main` inicia oculta (`visible: false` no tauri.conf.json); na primeira
  execucao (sem `ray_onboarding_done`), `App.svelte` chama `currentWindow.show()`.
- `overlayVisible` controla o `Overlay`; ele esta desmontado por padrao.
- Nao inventar surfaces novas sem: (1) adicionar ao tipo `Surface`, (2) tratar
  no listener de `ray:navigate`, (3) adicionar botao no AppBar com `navigateTo()`.
