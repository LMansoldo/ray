# Scope for this ralph-loop run

This run covers **only FASE 1 — Sidecar: dados e agente** from `docs/TASKS.md`:
T-100, T-101, T-102, T-103.

- **FASE 0 (T-000..T-003) is already implemented and merged into `dev`.** Do not
  recreate it, do not generate work items for it, and treat its outputs (Prisma
  client, `contracts/settings.ts`, the Tauri/Svelte scaffold, `contracts/ipc.ts`
  generation) as an existing foundation you can build on.
- **FASE 2 onward (T-2xx, T-3xx, T-4xx, T-5xx) is out of scope for this run.** Do not
  generate work items for them.
- T-102's "Dependências" line in TASKS.md lists "T-2xx (providers — pelo menos um
  real)" alongside T-101. That line describes what a *fully working end-to-end*
  suggestion needs, not this item's own acceptance criteria — T-102's own "Pronto
  quando" only requires "teste com um provider fake". Since no T-2xx item exists in
  this run's graph, resolve T-102 using only its `AiProvider`-agnostic contract and a
  fake/mocked provider in tests; do not add a `dependsOn` edge to a nonexistent T-2xx
  item, and do not block T-102 on a real provider adapter existing.
- Produce exactly 4 items (or a justified split of one of them per the sizing rule in
  the Contract-phase instructions), one per T-100/T-101/T-102/T-103, with `dependsOn`
  edges only among items in this run's own graph (T-100..T-103) — never pointing at a
  Fase 0 or Fase 2+ task id that this run does not generate.
