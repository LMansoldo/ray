# Two-Window AppBar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Separate the Ray UI into two independent Tauri windows — `appbar` (always-visible floating bar, no OS decorations, transparent) and `main` (content surfaces, starts hidden, shown on demand from AppBar).

**Architecture:** The `appbar` window renders only `<AppBar />` — always-on-top, transparent, no titlebar. The `main` window renders Home/Settings/Assistants/Onboarding, starts hidden (`visible: false`), and is shown via `invoke('show_window', { windowLabel: 'main' })` from AppBar. Cross-window navigation uses Tauri broadcast events (`emit`/`listen` from `@tauri-apps/api/event`).

**Tech Stack:** Tauri 2, Rust, Svelte 5, `@tauri-apps/api` v2 (`@tauri-apps/api/window`, `@tauri-apps/api/event`, `@tauri-apps/api/core`)

**Spec:** Designed in session — brainstorming output above.

## Global Constraints

- `@tauri-apps/api` version: `^2.11.1` — do not upgrade
- Svelte 5 runes only — no `export let`, no `$: reactive`
- No `any` in TypeScript — `listen<T>` must use typed generic
- No emojis in UI or comments
- Semantic commits: `feat(scope): description` — one commit per task
- `cargo check` must pass after every Rust change
- `npm run check` (in `apps/ui/`) must pass after every Svelte/TS change
- `npm test` (in `apps/ui/`) must pass with no skipped tests

---

### Task 1: Add `show_window` and `hide_window` Tauri commands

**Files:**
- Modify: `core/src/lib.rs`

**Interfaces:**
- Produces:
  - `show_window` registered as `"show_window"` — UI calls `invoke('show_window', { windowLabel: 'main' })`
  - `hide_window` registered as `"hide_window"` — UI calls `invoke('hide_window', { windowLabel: 'main' })`
  - Both return `Result<(), String>` — error if the label is not found

- [ ] **Step 1: Add the two commands to `core/src/lib.rs` after `fn toggle_window`**

Insert after the `toggle_window` function (around line 47):

```rust
/// Mostra uma janela pelo label (multi-janela: AppBar abre a janela main).
/// Usa o AppHandle diretamente — sem passar pelo registry de toggle — para
/// evitar dessincronização com o estado inicial `visible: false` do tauri.conf.json.
#[tauri::command]
fn show_window(app: tauri::AppHandle, window_label: String) -> Result<(), String> {
    app.get_webview_window(&window_label)
        .ok_or_else(|| format!("janela '{}' nao encontrada", window_label))?
        .show()
        .map_err(|e| e.to_string())
}

/// Oculta uma janela pelo label (multi-janela: botao Ocultar do AppBar).
/// Usa o AppHandle diretamente pelo mesmo motivo que show_window.
#[tauri::command]
fn hide_window(app: tauri::AppHandle, window_label: String) -> Result<(), String> {
    app.get_webview_window(&window_label)
        .ok_or_else(|| format!("janela '{}' nao encontrada", window_label))?
        .hide()
        .map_err(|e| e.to_string())
}
```

- [ ] **Step 2: Register both commands in `generate_handler!` inside `pub fn run()`**

Find the `generate_handler!` block and add the two new commands:

```rust
.invoke_handler(tauri::generate_handler![
    set_stealth,
    toggle_window,
    show_window,
    hide_window,
    suggest,
    transcribe_pending_pcm,
    open_logs_folder,
    copy_logs_to_clipboard,
])
```

- [ ] **Step 3: Verify compilation**

```bash
cd core && cargo check 2>&1 | tail -10
```

Expected: no errors.

- [ ] **Step 4: Run existing tests to confirm nothing broke**

```bash
cd core && cargo test 2>&1 | tail -20
```

Expected: all pre-existing tests pass. The two new commands have no unit tests because `tauri::AppHandle` cannot be constructed outside the Tauri runtime — correctness is validated by E2E in Task 6.

- [ ] **Step 5: Commit**

```bash
git add core/src/lib.rs
git commit -m "feat(core): add show_window and hide_window Tauri commands"
```

---

### Task 2: Configure two Tauri windows

**Files:**
- Modify: `core/tauri.conf.json`

**Interfaces:**
- Produces:
  - Window `"appbar"`: 700×72, `decorations: false, transparent: true, alwaysOnTop: true, resizable: false, visible: true`
  - Window `"main"`: 900×640, `decorations: true, transparent: false, visible: false, resizable: true`
  - Both serve `/` (same Vite entry; `App.svelte` dispatches by `getCurrentWindow().label`)

- [ ] **Step 1: Replace the `windows` array in `core/tauri.conf.json`**

Find the current `"windows"` array (single `main` entry) and replace it with:

```json
"windows": [
  {
    "label": "appbar",
    "title": "Ray",
    "url": "/",
    "width": 700,
    "height": 72,
    "decorations": false,
    "transparent": true,
    "alwaysOnTop": true,
    "resizable": false,
    "visible": true,
    "center": true
  },
  {
    "label": "main",
    "title": "Ray",
    "url": "/",
    "width": 900,
    "height": 640,
    "decorations": true,
    "transparent": false,
    "visible": false,
    "resizable": true,
    "center": true
  }
]
```

- [ ] **Step 2: Validate JSON**

```bash
cd core && python3 -m json.tool tauri.conf.json > /dev/null && echo "JSON valido"
```

Expected: `JSON valido`

- [ ] **Step 3: Cargo check (Tauri reads the config at build time)**

```bash
cd core && cargo check 2>&1 | tail -10
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add core/tauri.conf.json
git commit -m "feat(core): configure appbar and main as separate Tauri windows"
```

---

### Task 3: Simplify `navigation.ts` and update its tests

The pub/sub functions (`dispatchAppBarNavigation`, `onAppBarNavigate`) were designed for in-process single-window use. With `AppBar` in its own window, cross-window navigation goes through Tauri events. The pub/sub is no longer called — remove it and keep only the type.

**Files:**
- Modify: `apps/ui/src/surfaces/appbar/navigation.ts`
- Modify: `apps/ui/src/surfaces/appbar/navigation.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces: `AppBarDestination` type exported — consumed by `AppBar.svelte` and `App.svelte`

- [ ] **Step 1: Write the updated test first (TDD — red)**

Replace the full content of `apps/ui/src/surfaces/appbar/navigation.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import type { AppBarDestination } from './navigation'

// Contrato T-401 / RF-010: AppBarDestination declara os destinos validos.
// O canal pub/sub foi removido — a navegacao cross-window agora usa eventos
// Tauri (emit/listen). O tipo permanece como fonte unica para AppBar.svelte
// e App.svelte.

describe('AppBarDestination', () => {
  it('inclui todos os destinos esperados', () => {
    const all: AppBarDestination[] = ['home', 'settings', 'assistants', 'onboarding']
    expect(all).toHaveLength(4)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails (the module still exports pub/sub)**

```bash
cd apps/ui && npm test -- navigation.test 2>&1 | tail -20
```

Expected: test passes already (the type is already exported). The step that will fail is the TypeScript check after removing the pub/sub — which the next task will catch. Proceed.

- [ ] **Step 3: Replace the content of `apps/ui/src/surfaces/appbar/navigation.ts`**

```ts
// Destinos que a app bar pode abrir (T-401 / RF-010).
// Navegacao cross-window via eventos Tauri (emit/listen) — sem pub/sub in-process.
export type AppBarDestination = 'home' | 'settings' | 'assistants' | 'onboarding'
```

- [ ] **Step 4: Run TypeScript check**

```bash
cd apps/ui && npm run check 2>&1 | tail -30
```

Expected: errors about `dispatchAppBarNavigation` and `onAppBarNavigate` — they are still imported in `AppBar.svelte` and `AppBar.test.ts`. These will be fixed in Task 4.

- [ ] **Step 5: Run the navigation test only**

```bash
cd apps/ui && npm test -- navigation.test 2>&1 | tail -10
```

Expected: 1 test passes.

- [ ] **Step 6: Commit**

```bash
git add apps/ui/src/surfaces/appbar/navigation.ts \
        apps/ui/src/surfaces/appbar/navigation.test.ts
git commit -m "feat(ui): simplify navigation.ts to type-only (cross-window nav via Tauri events)"
```

---

### Task 4: Update `AppBar.svelte` and `AppBar.test.ts` for cross-window navigation

Navigation buttons now call `invoke('show_window', { windowLabel: 'main' })` + `emit('ray:navigate', { surface: dest })`. The "Ocultar" button calls `invoke('hide_window', { windowLabel: 'main' })` directly (no registry desync).

**Files:**
- Modify: `apps/ui/src/surfaces/appbar/AppBar.svelte`
- Modify: `apps/ui/src/surfaces/appbar/AppBar.test.ts`

**Interfaces:**
- Consumes:
  - `invoke` from `@tauri-apps/api/core` (already imported)
  - `emit` from `@tauri-apps/api/event` (new)
  - `AppBarDestination` type from `./navigation` (keep — type-only import)
  - Commands: `show_window`, `hide_window` (Task 1); `set_stealth` (unchanged)
- Produces: AppBar dispatches cross-window navigation via Tauri events

- [ ] **Step 1: Write the updated `AppBar.test.ts` (TDD — red)**

Replace the full content of `apps/ui/src/surfaces/appbar/AppBar.test.ts`:

```ts
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, cleanup, fireEvent } from '@testing-library/svelte'
import AppBar from './AppBar.svelte'
import type { AppBarProps } from './types'

// Contrato T-401 / RF-010: barra flutuante compacta com grip para arrastar,
// botao Home, indicador de status, botao stealth e botoes de navegacao.
// RF-502: ativacao rapida do stealth com sinalizacao clara do estado.
// RF-504: ocultar a janela main ("panic hide") via hide_window.
// RF-508: aviso de uso responsavel e conformidade legal ao ativar o stealth.
//
// Navegacao cross-window: invoke('show_window', { windowLabel: 'main' }) +
// emit('ray:navigate', { surface: dest }). Nao ha mais pub/sub in-process.
// O seam e mockado via vi.hoisted + vi.mock para garantir a interceptacao
// antes da resolucao de modulo (padrao T-402/T-406).

const { invokeMock } = vi.hoisted(() => ({
  invokeMock: vi
    .fn<(command: string, args?: unknown) => Promise<unknown>>()
    .mockResolvedValue(undefined),
}))
vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }))

const { emitMock } = vi.hoisted(() => ({
  emitMock: vi
    .fn<(event: string, payload?: unknown) => Promise<void>>()
    .mockResolvedValue(undefined),
}))
vi.mock('@tauri-apps/api/event', () => ({ emit: emitMock }))

type Props = AppBarProps

const baseProps: Props = {}

const NOTICE_FRAGMENTS: RegExp[] = [
  /conformidade/i,
  /consentimento/i,
  /responsável/i,
  /responsabilidade do usuário/i,
]

const EMOJI_PATTERN = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/u

afterEach(() => {
  invokeMock.mockClear()
  emitMock.mockClear()
  cleanup()
})

function statusIndicator(container: HTMLElement): Element {
  const el = container.querySelector('[data-appbar-status]')
  expect(el, 'o indicador de status deve existir').not.toBeNull()
  return el as Element
}

function stealthNotice(container: HTMLElement): Element | null {
  return container.querySelector('[data-stealth-notice]')
}

describe('AppBar — elementos da barra flutuante (RF-010)', () => {
  it('renderiza grip, Home, indicador de status, stealth, Iniciar Configuracao e Ocultar', () => {
    const { container, getByRole } = render(AppBar, { props: baseProps })

    expect(container.querySelector('[data-appbar]'), 'raiz da barra').not.toBeNull()
    expect(container.querySelector('[data-appbar-grip]'), 'grip de arrastar').not.toBeNull()
    expect(getByRole('button', { name: 'Home' }), 'botao Home').toBeDefined()
    expect(container.querySelector('[data-appbar-status]'), 'indicador de status').not.toBeNull()
    expect(getByRole('button', { name: /stealth/i }), 'botao stealth').toBeDefined()
    expect(getByRole('button', { name: 'Iniciar Configuracao' })).toBeDefined()
    expect(getByRole('button', { name: 'Ocultar' }), 'botao de ocultar').toBeDefined()
  })

  it('o grip e regiao de arraste nativa (data-tauri-drag-region)', () => {
    const { container } = render(AppBar, { props: baseProps })
    const grip = container.querySelector('[data-appbar-grip]')
    expect(grip).not.toBeNull()
    expect(grip?.hasAttribute('data-tauri-drag-region')).toBe(true)
  })

  it('comeca com stealth inativo e sem aviso', () => {
    const { container } = render(AppBar, { props: baseProps })
    expect(statusIndicator(container).textContent).toContain('Stealth inativo')
    expect(stealthNotice(container)).toBeNull()
  })
})

describe('AppBar — stealth alterna visivelmente (RF-502)', () => {
  it('clique ativa: set_stealth com excluded=true e indicador muda', async () => {
    const { container, getByRole } = render(AppBar, { props: baseProps })
    await fireEvent.click(getByRole('button', { name: /stealth/i }))

    expect(invokeMock).toHaveBeenCalledTimes(1)
    expect(invokeMock.mock.calls[0]).toEqual(['set_stealth', { windowLabel: 'main', excluded: true }])
    expect(statusIndicator(container).textContent).toContain('Stealth ativo')
  })

  it('ativar exibe aviso RF-508 (SRS §7)', async () => {
    const { container, getByRole } = render(AppBar, { props: baseProps })
    await fireEvent.click(getByRole('button', { name: /stealth/i }))

    const aviso = stealthNotice(container)
    expect(aviso).not.toBeNull()
    for (const fragment of NOTICE_FRAGMENTS) {
      expect(aviso?.textContent).toMatch(fragment)
    }
  })

  it('segundo clique desativa: set_stealth com excluded=false e aviso some', async () => {
    const { container, getByRole } = render(AppBar, { props: baseProps })
    const botao = getByRole('button', { name: /stealth/i })
    await fireEvent.click(botao)
    await fireEvent.click(botao)

    expect(invokeMock).toHaveBeenCalledTimes(2)
    expect(invokeMock.mock.calls[0]).toEqual(['set_stealth', { windowLabel: 'main', excluded: true }])
    expect(invokeMock.mock.calls[1]).toEqual(['set_stealth', { windowLabel: 'main', excluded: false }])
    expect(statusIndicator(container).textContent).toContain('Stealth inativo')
    expect(stealthNotice(container)).toBeNull()
  })

  it('monta ja ativo quando stealthExcluded=true, sem re-disparar o comando', async () => {
    const { container, getByRole } = render(AppBar, {
      props: { ...baseProps, stealthExcluded: true },
    })

    expect(statusIndicator(container).textContent).toContain('Stealth ativo')
    expect(stealthNotice(container)).not.toBeNull()
    expect(invokeMock).not.toHaveBeenCalled()

    await fireEvent.click(getByRole('button', { name: /stealth/i }))
    expect(invokeMock.mock.calls[0]).toEqual(['set_stealth', { windowLabel: 'main', excluded: false }])
  })
})

describe('AppBar — navegacao cross-window (RF-010)', () => {
  it('botao Home mostra a janela main e emite ray:navigate com surface=home', async () => {
    const { getByRole } = render(AppBar, { props: baseProps })
    await fireEvent.click(getByRole('button', { name: 'Home' }))

    expect(invokeMock).toHaveBeenCalledWith('show_window', { windowLabel: 'main' })
    expect(emitMock).toHaveBeenCalledWith('ray:navigate', { surface: 'home' })
  })

  it('botao Assistentes mostra a janela main e emite ray:navigate com surface=assistants', async () => {
    const { getByRole } = render(AppBar, { props: baseProps })
    await fireEvent.click(getByRole('button', { name: 'Assistentes' }))

    expect(invokeMock).toHaveBeenCalledWith('show_window', { windowLabel: 'main' })
    expect(emitMock).toHaveBeenCalledWith('ray:navigate', { surface: 'assistants' })
  })

  it('botao Configuracoes mostra a janela main e emite ray:navigate com surface=settings', async () => {
    const { getByRole } = render(AppBar, { props: baseProps })
    await fireEvent.click(getByRole('button', { name: 'Configuracoes' }))

    expect(invokeMock).toHaveBeenCalledWith('show_window', { windowLabel: 'main' })
    expect(emitMock).toHaveBeenCalledWith('ray:navigate', { surface: 'settings' })
  })

  it('botao Onboarding mostra a janela main e emite ray:navigate com surface=onboarding', async () => {
    const { getByRole } = render(AppBar, { props: baseProps })
    await fireEvent.click(getByRole('button', { name: 'Iniciar Configuracao' }))

    expect(invokeMock).toHaveBeenCalledWith('show_window', { windowLabel: 'main' })
    expect(emitMock).toHaveBeenCalledWith('ray:navigate', { surface: 'onboarding' })
  })

  it('Ocultar chama hide_window na janela main sem emitir eventos (RF-504)', async () => {
    const { getByRole } = render(AppBar, { props: baseProps })
    await fireEvent.click(getByRole('button', { name: 'Ocultar' }))

    expect(invokeMock).toHaveBeenCalledTimes(1)
    expect(invokeMock.mock.calls[0]).toEqual(['hide_window', { windowLabel: 'main' }])
    expect(emitMock).not.toHaveBeenCalled()
  })

  it('windowLabel prop controla apenas o stealth, nao a navegacao', async () => {
    const { getByRole } = render(AppBar, { props: { windowLabel: 'outra-janela' } })
    await fireEvent.click(getByRole('button', { name: /stealth/i }))

    expect(invokeMock.mock.calls[0]).toEqual([
      'set_stealth',
      { windowLabel: 'outra-janela', excluded: true },
    ])
    invokeMock.mockClear()

    await fireEvent.click(getByRole('button', { name: 'Home' }))
    expect(invokeMock).toHaveBeenCalledWith('show_window', { windowLabel: 'main' })
    expect(emitMock).toHaveBeenCalledWith('ray:navigate', { surface: 'home' })
  })
})

describe('AppBar — regras gerais do repo', () => {
  it('a saida renderizada nao contem emojis, nem com aviso visivel', async () => {
    const { container, getByRole } = render(AppBar, { props: baseProps })
    expect(EMOJI_PATTERN.test(container.textContent ?? '')).toBe(false)

    await fireEvent.click(getByRole('button', { name: /stealth/i }))
    expect(EMOJI_PATTERN.test(container.textContent ?? '')).toBe(false)
  })
})
```

- [ ] **Step 2: Run the tests to confirm they fail (implementation not updated yet)**

```bash
cd apps/ui && npm test -- AppBar.test 2>&1 | tail -30
```

Expected: failures on navigation tests (still dispatching pub/sub, not `emit`).

- [ ] **Step 3: Update the `<script>` block in `AppBar.svelte`**

Replace the full `<script lang="ts">` block:

```svelte
<script lang="ts">
  import { invoke } from '@tauri-apps/api/core'
  import { emit } from '@tauri-apps/api/event'
  import { glassTokens } from '../../lib/glass/tokens'
  import type { AppBarDestination } from './navigation'
  import type { AppBarProps } from './types'

  let {
    windowLabel = 'main',
    stealthExcluded = false,
  }: AppBarProps = $props()

  let stealthOverride = $state<boolean | null>(null)
  const stealthActive = $derived(stealthOverride ?? stealthExcluded)

  const STEALTH_NOTICE =
    'Stealth ativo: garanta o consentimento das pessoas capturadas. ' +
    'O uso e de inteira responsabilidade do usuario, inclusive a ' +
    'conformidade legal da gravacao. Use de forma responsavel.'

  function toggleStealth(): void {
    const nextExcluded = !stealthActive
    stealthOverride = nextExcluded
    void invoke('set_stealth', { windowLabel, excluded: nextExcluded })
  }

  async function navigateTo(dest: AppBarDestination): Promise<void> {
    await invoke('show_window', { windowLabel: 'main' })
    await emit('ray:navigate', { surface: dest })
  }

  async function hideMainWindow(): Promise<void> {
    await invoke('hide_window', { windowLabel: 'main' })
  }
</script>
```

- [ ] **Step 4: Update all navigation button `onclick` handlers in the template**

Replace every `onclick={() => dispatchAppBarNavigation('...')}` and `onclick={hideWindow}`:

```svelte
<!-- Home -->
<button
  type="button"
  class="appbar__home"
  onclick={() => void navigateTo('home')}
>
  Home
</button>

<!-- Botao stealth (bola laranja) — sem alteracao -->

<!-- Assistentes -->
<button
  type="button"
  class="appbar__nav"
  onclick={() => void navigateTo('assistants')}
>
  Assistentes
</button>

<!-- Configuracoes -->
<button
  type="button"
  class="appbar__nav"
  onclick={() => void navigateTo('settings')}
>
  Configuracoes
</button>

<!-- Iniciar Configuracao (onboarding) -->
<button
  type="button"
  class="appbar__setup"
  onclick={() => void navigateTo('onboarding')}
>
  Iniciar Configuracao
</button>

<!-- Ocultar -->
<button type="button" class="appbar__hide" onclick={() => void hideMainWindow()}>
  Ocultar
</button>
```

- [ ] **Step 5: Run the tests — should pass now**

```bash
cd apps/ui && npm test -- AppBar.test 2>&1 | tail -20
```

Expected: all tests pass.

- [ ] **Step 6: Run TypeScript check**

```bash
cd apps/ui && npm run check 2>&1 | tail -20
```

Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add apps/ui/src/surfaces/appbar/AppBar.svelte \
        apps/ui/src/surfaces/appbar/AppBar.test.ts
git commit -m "feat(ui): AppBar uses Tauri events for cross-window navigation"
```

---

### Task 5: Update `App.svelte` for window-aware rendering

`App.svelte` is served by both windows. It checks `getCurrentWindow().label` at runtime to decide what to render. The `appbar` window gets only `<AppBar />`. The `main` window gets the content surfaces and listens for `ray:navigate` Tauri events.

**Files:**
- Modify: `apps/ui/src/App.svelte`

**Interfaces:**
- Consumes:
  - `getCurrentWindow()` from `@tauri-apps/api/window` — synchronous; `.label` is `'appbar'` or `'main'`
  - `listen<{ surface: Surface }>('ray:navigate', handler)` from `@tauri-apps/api/event` — returns `Promise<() => void>`; call returned fn to unsubscribe
  - `currentWindow.show()` — called in `onMount` on first run (no onboarding done yet)
  - `onHomeNavigate` from `./surfaces/home/navigation` — in-process, stays (Home → Settings/Assistants within main window)
  - `onOnboardingRestart` from `./surfaces/onboarding/restart` — in-process, stays
- Produces: correct surface per window; auto-shows `main` on first run

- [ ] **Step 1: Replace the full content of `apps/ui/src/App.svelte`**

```svelte
<script lang="ts">
  import { onMount } from 'svelte'
  import { getCurrentWindow } from '@tauri-apps/api/window'
  import { listen } from '@tauri-apps/api/event'
  import AppBar from './surfaces/appbar/AppBar.svelte'
  import Home from './surfaces/home/Home.svelte'
  import Onboarding from './surfaces/onboarding/Onboarding.svelte'
  import Settings from './surfaces/settings/Settings.svelte'
  import Assistants from './surfaces/assistants/Assistants.svelte'
  import Overlay from './surfaces/overlay/Overlay.svelte'
  import { onHomeNavigate } from './surfaces/home/navigation'
  import { onOnboardingRestart } from './surfaces/onboarding/restart'
  import type { HomeProps } from './surfaces/home/types'

  type Surface = 'onboarding' | 'home' | 'settings' | 'assistants'

  const ONBOARDING_DONE_KEY = 'ray_onboarding_done'

  const currentWindow = getCurrentWindow()
  const isAppBarWindow = currentWindow.label === 'appbar'

  const initialSurface: Surface = localStorage.getItem(ONBOARDING_DONE_KEY)
    ? 'home'
    : 'onboarding'

  let surface = $state<Surface>(initialSurface)
  let overlayVisible = $state(false)

  const homeProps: HomeProps = {
    sessions: [],
    planName: 'Free',
    freeSessionsUsed: 0,
    freeSessionsTotal: 7,
    assistant: { name: 'Assistente Padrao', category: 'GENERAL' },
    memoryItems: [],
    sessionId: '',
    assistantId: '',
    context: [],
    credential: { kind: 'OPENAI', connectionMode: 'API_KEY', secret: '' },
  }

  function goTo(next: Surface): void {
    surface = next
  }

  onMount(() => {
    if (isAppBarWindow) return

    // Primeira execucao: exibir automaticamente para o onboarding.
    if (!localStorage.getItem(ONBOARDING_DONE_KEY)) {
      void currentWindow.show()
    }

    let unlistenNavigate: (() => void) | undefined

    void listen<{ surface: Surface }>('ray:navigate', (event) => {
      goTo(event.payload.surface)
    }).then((fn) => {
      unlistenNavigate = fn
    })

    const unsubHome = onHomeNavigate((dest) => goTo(dest))

    const unsubRestart = onOnboardingRestart(() => {
      localStorage.removeItem(ONBOARDING_DONE_KEY)
      goTo('onboarding')
    })

    return () => {
      unlistenNavigate?.()
      unsubHome()
      unsubRestart()
    }
  })

  function handleOnboardingComplete(): void {
    localStorage.setItem(ONBOARDING_DONE_KEY, '1')
    goTo('home')
  }
</script>

{#if isAppBarWindow}
  <AppBar />
{:else}
  <div class="app">
    {#if surface === 'onboarding'}
      <Onboarding oncomplete={handleOnboardingComplete} />
    {:else if surface === 'home'}
      <Home {...homeProps} />
    {:else if surface === 'settings'}
      <Settings />
    {:else if surface === 'assistants'}
      <Assistants />
    {/if}

    {#if overlayVisible}
      <Overlay />
    {/if}
  </div>
{/if}

<style>
  .app {
    min-height: 100vh;
    display: flex;
    flex-direction: column;
  }
</style>
```

- [ ] **Step 2: Run TypeScript check**

```bash
cd apps/ui && npm run check 2>&1 | tail -20
```

Expected: no errors. If `listen` typing causes issues (`event.payload` type inference), add an explicit type annotation: `listen<{ surface: Surface }>('ray:navigate', ...)`.

- [ ] **Step 3: Run all tests**

```bash
cd apps/ui && npm test 2>&1 | tail -20
```

Expected: all tests pass. `App.svelte` has no dedicated unit tests yet — TypeScript check + E2E covers it.

- [ ] **Step 4: Commit**

```bash
git add apps/ui/src/App.svelte
git commit -m "feat(ui): App.svelte renders by Tauri window label; main auto-shows on first run"
```

---

### Task 6: E2E verification

No code changes — manual checkpoint to confirm all four behaviors work in the real app.

- [ ] **Step 1: Start the app**

```bash
cargo tauri dev
```

Wait for both Vite and Tauri to finish compiling. Two windows should open.

- [ ] **Step 2: Verify `appbar` window has no OS decorations**

On macOS: no traffic-light buttons visible. On Windows: no minimize/maximize/close buttons. The AppBar component renders floating with transparent background (desktop visible through/around it).

If the background is still white: verify `"transparent": true` is in the `appbar` window config AND `body { background: transparent }` is in `apps/ui/src/app.css`.

- [ ] **Step 3: Verify `main` window is hidden on startup (after first run)**

Clear localStorage first:
- Open browser devtools in the `appbar` window (in dev mode, right-click → Inspect or use Tauri's WebviewWindow inspector)
- Run `localStorage.removeItem('ray_onboarding_done')` in the console
- Restart `cargo tauri dev`

Expected: `main` window opens automatically (first run → onboarding).

After completing onboarding and restarting: `main` window stays hidden. Only `appbar` window visible.

- [ ] **Step 4: Verify AppBar navigation opens `main`**

Click "Home" in the AppBar. Expected: `main` window appears showing the Home surface.

Click "Configuracoes". Expected: `main` shows Settings.

Click "Assistentes". Expected: `main` shows Assistants.

- [ ] **Step 5: Verify "Ocultar" hides `main`**

With `main` visible, click "Ocultar". Expected: `main` disappears; AppBar remains visible.

- [ ] **Step 6: Verify stealth still works**

Click the orange circle (stealth toggle). Expected: stealth indicator changes text; RF-508 notice appears. The `appbar` window stealth state changes (not `main`).

- [ ] **Step 7: Done — no commit needed**

All behaviors verified. The implementation is complete.
