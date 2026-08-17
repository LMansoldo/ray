# Ralph Loop run

This `.ralph/` folder was scaffolded by the `ralph-loop` skill for:
`/Users/lucasmansoldo/Projects/ray/docs/TASKS.md /Users/lucasmansoldo/Projects/ray/docs/docs/SRS-Ray.md /Users/lucasmansoldo/Projects/ray/docs/docs/ADR-Ray.md /Users/lucasmansoldo/Projects/ray/docs/README.md /Users/lucasmansoldo/Projects/ray/.ralph/SCOPE.md`.

Scope for this run: **FASE 1 — Sidecar: dados e agente** (T-100 a T-103) do backlog em
TASKS.md. FASE 0 (T-000..T-003) já está implementada e mergeada em `dev` — este run
não a recria. FASE 2 em diante fica para runs seguintes; `.ralph/SCOPE.md` (incluído
nos specs acima) documenta como o item T-102 deve tratar sua dependência declarada em
T-2xx (providers), que fica fora do escopo deste run.

## Run it

```bash
bash .ralph/run.sh
```

This runs **unattended** with `--dangerously-skip-permissions`. It will:
- Refuse to run if the current branch is `main`/`master`, or the working tree is
  dirty.
- Create a dedicated git worktree on branch `ralph/fase-1-sidecar-agente` — all work
  (including every commit) happens there, never in this checkout.
- Spend up to $2 per model call and $20 total before aborting.
- Cap each work item at 5 attempts before marking it `BLOCKED` and moving on to
  independent items.

## Watching it run

`run.sh` itself only prints one line per event (`COMPLETED X`, `BLOCKED Y`, ...). For a
live-updating view, run this in a second terminal while `run.sh` is going:

```bash
node .ralph/scripts/watch-progress.mjs
```

It auto-detects the worktree/state dir from `run.sh`'s `BRANCH_NAME`, then polls
`progress.json`/`cost.json`/`contract.json` every 2s and redraws a table: one row per
item (status, attempts, model tier, title/block reason), plus a summary line with
completed/blocked/skipped counts and spend against `TOTAL_BUDGET_USD`. The item shown
as `RUNNING` is a guess — `progress.json` only records terminal states, so it's
inferred as the first still-`PENDING` item in `order.json` whose dependencies aren't
`BLOCKED`/`SKIPPED`. Flags: `--interval=<seconds>` (default 2), `--state-dir=<path>`
to point at a different run's state dir explicitly.

## Model tiers run on different Claude Code instances

Each `light`/`medium`/`strong` tier is invoked via its own configurable CLI binary
(`CLAUDE_BIN_LIGHT`/`CLAUDE_BIN_MEDIUM`/`CLAUDE_BIN_STRONG` at the top of `run.sh`,
defaulting to the plain `claude` command). Right now `light`/`medium` (the RED/GREEN
worker stages) point at `~/claude-mimo.sh` — a wrapper that exports its own
`ANTHROPIC_BASE_URL`/`ANTHROPIC_AUTH_TOKEN`/`ANTHROPIC_MODEL` to run Claude Code
against a Xiaomi MiMo-compatible endpoint (`mimo-v2.5-pro`) — while `strong` (both
judge passes and the Contract phase) stays on `claude` with real `opus`, so review
quality doesn't depend on the alternate backend.

This works even though `mimo` can't be used inside an interactive Claude Code session
alongside another model: every call in `run.sh` is its own subprocess, so each tier's
env vars are scoped to that one process and never collide with the others.

Caveat: `total_cost_usd` reported by a non-Anthropic-billed backend may not reflect
real spend — `record_cost`/`PER_CALL_BUDGET_USD`/`TOTAL_BUDGET_USD` were written
assuming Anthropic's own cost accounting, so budget enforcement for mimo-routed calls
should be treated as approximate until verified against actual mimo billing.

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
