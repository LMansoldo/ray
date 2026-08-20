# Scope for this ralph-loop run

This run covers **only FASE 4 — UI (apps/ui)** from `docs/TASKS.md`:
T-400, T-401, T-402, T-403, T-404, T-405, T-406, T-407, T-408.

- **FASE 0 (T-000..T-003) is already implemented and merged into `dev`.** Tauri scaffold,
  `core/src/lib.rs` commands, `contracts/ipc.ts`, `contracts/settings.ts` are all available.
- **FASE 1 (T-100..T-103) is already implemented and merged into `dev`.** LangGraph.js agent
  graph, session/assistant handlers, and streaming are available.
- **FASE 2 (T-200..T-207) is already implemented and merged into `dev`.** All provider adapters
  and credential validation handlers are available.
- **FASE 3 (T-300..T-307) is already implemented and merged into `dev`.** Sidecar supervision,
  vault, credential injection, SSE→Tauri streaming bridge, window controls/stealth, global
  shortcuts, audio capture, and STT are all available as Tauri commands.
- **FASE 5 onward (T-5xx) is out of scope for this run.**

## Item guidance

All items in this run are in `apps/ui/` (Svelte 5 + Vite, NOT SvelteKit).
Read `.claude/rules/frontend.md` and `.claude/rules/general.md` before generating any item's contract.

**Dependency graph within this run:**
- T-400 (design system tokens + base glass components) has no intra-run dependencies — it is the foundation.
- T-401 (app bar), T-402 (home), T-403 (overlay), T-404 (notch), T-405 (onboarding),
  T-406 (settings), T-407 (assistants), T-408 (markdown/editor) all depend on T-400.
- T-408 (markdown renderer + Milkdown editor) is consumed by T-403, T-404, T-407 — sequence T-408 before those three.
- T-404 (Notch) and T-403 (overlay) depend on T-303's streaming bridge — treat it as available.

**Critical rules for all items:**
- **Svelte 5 runes only** — `$props()`, `$state()`, `$derived()`, `$effect()`, `$bindable()`, `Snippet`.
  Never `export let`; never SvelteKit conventions (`+page.svelte`, `+layout`, routing).
- **Plain Vite, not SvelteKit** — there is no file-based router.
- **No `any`** in TypeScript — use `unknown` + type guards / Zod.
- **Tauri `invoke()` only** for IPC — never call the sidecar directly.
- **No emojis** in UI or code/comments.
- **`rem` over `px`** for new styles (10px = 1rem).
- **Liquid Glass design system** lives in `apps/ui/src/lib/glass/` — reuse before creating new primitives.
- **i18n**: RNF-502 requires PT and EN — do not pick a translation library silently; flag if adding the first user-facing string.
- **No icon library chosen yet** — check existing imports before adding one.

**Test strategy:**
- `npm run check` (svelte-check + tsc) gates every item — must pass clean.
- Vitest + @testing-library/svelte is not yet scaffolded in apps/ui; items that add test infrastructure should do so as part of T-400 or the first item that needs it.
- Glass components: test token application and slot rendering.
- Streaming surfaces (T-403, T-404): test event consumption order (start → token* → done/error).
- Markdown renderer (T-408): test that a code block survives a render cycle unchanged.

Produce exactly 9 items (one per T-400..T-408), or a justified split per the sizing
rule in the Contract-phase instructions.
