# Ray — UI (apps/ui)

Svelte 5 + Vite + TypeScript (plain Vite, not SvelteKit) — see `docs/TASKS.md`
T-001 and `.claude/rules/frontend.md`.

This app talks only to the Rust core (`core/`) via Tauri's `invoke()`; it never
calls the sidecar directly. Run it through the core crate:

```sh
cd core && cargo tauri dev
```

Running `npm run dev`/`npm run build` here directly only exercises the Vite
dev server / static build — it does not open the native Tauri window.
