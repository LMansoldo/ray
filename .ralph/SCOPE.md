# Scope for this ralph-loop run

This run covers **only FASE 2 — Sidecar: adapters de provedor** from `docs/TASKS.md`:
T-200, T-201, T-202, T-203, T-204, T-205, T-206, T-207.

- **FASE 0 (T-000..T-003) is already implemented and merged into `dev`.** Treat its
  outputs (Prisma client, `contracts/settings.ts`, the Tauri/Svelte scaffold,
  `contracts/ipc.ts` generation) as an existing foundation.
- **FASE 1 (T-100..T-103) is already implemented and merged into `dev`.** Treat its
  outputs (`server.ts`, `handlers.ts`, `db.ts`, `agent/graph.ts`, `agent/summary.ts`,
  `prisma/seed.ts`, and the `AiProvider` interface in `providers/provider.ts`) as
  existing code you build on — do not recreate or regenerate any of it.
- **FASE 3 onward (T-3xx, T-4xx, T-5xx) is out of scope for this run.** Do not
  generate work items for them.

## Item guidance

- T-200..T-205 are the six provider adapters. Each implements the `AiProvider`
  interface from `sidecar/src/providers/provider.ts` unchanged and registers itself
  in `sidecar/src/providers/registry.ts`. They are independent of each other —
  `dependsOn` edges among them are not needed unless one genuinely requires another
  to exist first (they don't).
- T-206 (`validateCredential` handler) and T-207 (`translate` handler) both depend
  on at least T-200 being present (so a real adapter exists to delegate to).
- Do not add `dependsOn` edges pointing at Fase 0 or Fase 1 task ids — those items
  do not exist in this run's graph. Reference their outputs as already-present code.
- Produce exactly 8 items (one per T-200..T-207), or a justified split of one of
  them per the sizing rule in the Contract-phase instructions.
- Tests for adapters must mock the HTTP layer (no real API calls) but assert on the
  actual request shape sent (auth header, endpoint, streaming parse) — per
  `.claude/rules/sidecar.md`.
