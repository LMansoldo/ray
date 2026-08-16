# Ralph Loop run

This `.ralph/` folder was scaffolded by the `ralph-loop` skill for:
`/Users/lucasmansoldo/Projects/ray/docs/TASKS.md /Users/lucasmansoldo/Projects/ray/docs/docs/SRS-Ray.md /Users/lucasmansoldo/Projects/ray/docs/docs/ADR-Ray.md /Users/lucasmansoldo/Projects/ray/docs/README.md`.

Scope for this run: **FASE 0 — Fundação** (T-000 a T-003) do backlog em TASKS.md. As
demais fases (1–6) ficam para runs seguintes.

## Run it

```bash
bash .ralph/run.sh
```

This runs **unattended** with `--dangerously-skip-permissions`. It will:
- Refuse to run if the current branch is `main`/`master`, or the working tree is
  dirty.
- Create a dedicated git worktree on branch `ralph/fase-0-fundacao` — all work
  (including every commit) happens there, never in this checkout.
- Spend up to $2 per model call and $20 total before aborting.
- Cap each work item at 5 attempts before marking it `BLOCKED` and moving on to
  independent items.

## After it finishes

- Read `<worktree>/.ralph-run/REPORT.md` — Mermaid graph of the item dependency graph
  colored by outcome, a task table, the coverage map, and the frozen contracts.
- Review every commit in the worktree before merging — this workflow never pushes and
  never merges on its own.
- If any item is `BLOCKED`, its `blockReason` in `.ralph-run/progress.json` and the
  judge findings under `.ralph-run/out-*-judge*.json` explain why.

## Known limitation

A defect in an already-committed item that no later item's tests ever exercise is not
caught by this workflow — TDD-based verification is bounded by what each item's
`testStrategy` actually exercises.
