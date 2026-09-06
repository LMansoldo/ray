# surfaces/appbar — barra flutuante (T-401 / RF-010)

`AppBar.svelte` e a barra compacta que fica sempre visivel acima dos demais
surfaces. Fornece navegacao global e controle de stealth/ocultacao.

## Props

| Prop | Tipo | Padrao | Descricao |
|---|---|---|---|
| `windowLabel` | `string` | `'main'` | Label da janela alvo do `set_stealth` apenas |
| `stealthExcluded` | `boolean` | `true` | Estado inicial do stealth — ativo por padrao (uso completo e o default) |

Nota: `windowLabel` controla APENAS o stealth. A navegacao sempre aponta
para a janela `'main'`, independentemente do valor desta prop.

## Navegacao cross-window

Nao ha mais pub/sub in-process (`dispatchAppBarNavigation` / `onAppBarNavigate`
foram removidos em Task 3/4). A navegacao e feita em dois passos:

1. `invoke('show_window', { windowLabel: 'main' })` — traz a janela main para frente.
2. `emit('ray:navigate', { surface: dest })` — evento Tauri consumido pela janela main.

`App.svelte` escuta `'ray:navigate'` via `listen()` do `@tauri-apps/api/event`
e faz o roteamento interno.

### Destinos disponíveis (`AppBarDestination`)

`'home'` | `'settings'` | `'assistants'` | `'onboarding'`

Para adicionar um novo destino: (1) adicione a uniao em `navigation.ts`,
(2) adicione o botao no template com `onclick={() => void navigateTo('novo')}`,
(3) trate o caso em `App.svelte` no listener de `'ray:navigate'`.

## Comandos Tauri invocados

| Botao | Comando | Janela alvo | Arquivo core |
|---|---|---|---|
| Bola laranja (stealth) | `set_stealth` | `windowLabel` prop | `core/src/lib.rs` |
| Home / Assistentes / Configuracoes / Iniciar Configuracao | `show_window` + emit `ray:navigate` | sempre `'main'` | `core/src/lib.rs` |
| Ocultar | `hide_window` | sempre `'main'` | `core/src/lib.rs` |

## Invariante RF-508

Ao ativar o stealth, o aviso de consentimento e responsabilidade legal (SRS §7)
e exibido inline. Nao remover nem encurtar esse texto sem revisao de compliance.
