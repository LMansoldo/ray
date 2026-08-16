# Frontend Rules (apps/ui)

> Before writing any code, read `.claude/rules/general.md` first.

## Tech Stack

- **Svelte 5** with runes (`$props()`, `$state()`, `$derived()`, `$effect()`,
  `$bindable()`, `Snippet`)
- **Vite** — **plain Vite, not SvelteKit** (`docs/TASKS.md` T-001: "inicializar
  apps/ui como projeto Svelte 5 + Vite + TypeScript"). There is no file-based routing —
  no `+page.svelte`, no `+layout`, no `+page.server.ts`. Don't reach for SvelteKit
  conventions here.
- **TypeScript**
- **Tauri `invoke()`** — the only way this app talks to the rest of Ray. It never
  calls the sidecar directly (see `infra.md`); it calls `#[tauri::command]`s exposed
  by `core/src/lib.rs`, whose signatures are the contract (`core.md`).

## Directory Structure (per `docs/TASKS.md` Fase 4)

```
apps/ui/src/
├── lib/
│   ├── glass/            # Liquid Glass design system: tokens + base components (T-400)
│   ├── markdown/          # read-only streaming Markdown renderer (T-408)
│   └── editor/             # Milkdown WYSIWYG editor (T-408, ADR-011)
└── surfaces/
    ├── appbar/              # T-401 — floating action bar
    ├── home/                 # T-402 — sessions, assistant card, conversation actions
    ├── overlay/               # T-403 — real-time insight card, streaming
    ├── notch/                  # T-404 — compact insight surface, secondary Tauri window
    ├── onboarding/              # T-405 — 6-step flow
    ├── settings/                 # T-406 — AI sources, models, audio, shortcuts, help
    └── assistants/                 # T-407 — library + creator
```

Each "surface" maps to one of the four window surfaces in SRS §3
(`docs/docs/SRS-Ray.md`): app bar, home, overlay/modal, Notch — plus the onboarding,
settings, and assistants screens reachable from them. Notch is a **second Tauri
window**, not a route.

## Svelte 5 Conventions

- Use `$props()` for component props with TypeScript types inline; never `export let`.
- Use `$derived()` / `$derived.by()` for computed values, `$effect()` only for real
  side effects (not derived state).
- Use `$bindable()` for two-way binding props.
- Use `Snippet` / `{#snippet}` / `{@render}` for render props.

```svelte
<script lang="ts">
  let {
    label,
    variant = 'default',
    onclick,
  }: {
    label: string
    variant?: 'default' | 'primary'
    onclick?: () => void
  } = $props()
</script>
```

## Design System — Liquid Glass (SRS §8, T-400)

`apps/ui/src/lib/glass/` holds the shared tokens and base components. Rules:

- **macOS**: use the window's native material/vibrancy when available (SRS 8.2) —
  don't fake it with CSS if the native API is reachable.
- **Everywhere else**: `backdrop-filter` + a token layer for cross-platform
  consistency (SRS 8.3).
- **Opacity is runtime-adjustable per surface** (RF-506) — a glass component's opacity
  must stay controllable by the opacity command exposed from `core/src/windows.rs`,
  never a value hardcoded past what the user can change.
- There is no separate `packages/design-system` in this repo — all shared UI lives
  inside `apps/ui/src/lib/glass/`. Before building a new glass primitive, check what's
  already there; don't duplicate a translucent panel/card that already exists.

## Markdown — two distinct pieces (ADR-011, T-408)

- **Read-only streaming renderer** (`lib/markdown/`) — lightweight, syntax-highlighted,
  used for the "DIGA ISSO" card, Notch, and summaries while tokens are streaming in.
  Never use the full editor here — re-rendering the whole editor per token is wasted
  weight.
- **Milkdown WYSIWYG editor** (`lib/editor/`) — for editing a finished response (and
  future Markdown input fields). Its internal model is already Markdown — no
  Markdown↔HTML round-trip; a code block must survive edit+save unchanged. Milkdown is
  framework-agnostic — expect to wire it via its core `Editor.make()` API pointed at a
  DOM node, not a ready-made Svelte 5 wrapper.

## IPC / streaming

- Every action calls a `core` Tauri command (`invoke('command_name', …)`); the set of
  valid command names lives in `core/src/lib.rs` — don't invent a new one from the UI
  side without adding it to core first.
- Streaming suggestions arrive as Tauri events in order `start` → `token`* →
  `done`/`error` (once T-303 wires it) — consume them in that order, don't assume
  `done` can arrive without a preceding `start`.

## CSS Conventions

- Prefer `rem` over `px` (see `general.md`) — not yet tooling-enforced here.
- Component-scoped `<style>` blocks.

## i18n

RNF-502 requires PT and EN at launch. No translation mechanism is decided yet in this
repo — don't import a convention from another project (e.g. a specific `en.json`/
`pt.json` + `$t()` helper) without confirming it's the chosen approach first.

## Icons

No emojis in the UI (see `general.md`). No icon library has been chosen yet for this
app — check what's already imported before adding one.

## Testing

- **Vitest** + `@testing-library/svelte` for components, once the test setup exists
  (not yet scaffolded as of T-001).
