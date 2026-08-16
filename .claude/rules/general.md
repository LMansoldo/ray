# General Rules

> Mandatory rules for all code in this repo (Ray — copiloto de IA para reuniões em
> tempo real). Read this file before writing any code. These are the same baseline
> rules `docs/TASKS.md` states for every task in the backlog.

## The contract is the boundary — never improvise a new shape

Three artifacts are the sources of truth for cross-boundary types. Do not change the
signatures they dictate without stopping and flagging it first — never invent a new
shape at the boundary because the declared one looks wrong or inconvenient:

- **`contracts/ipc.ts`** — the Rust core ↔ sidecar IPC boundary (ADR-005). Once T-000
  lands, this file is *generated* from `core/src/ipc.rs` via `ts-rs` (ADR-010); until
  then it is the hand-maintained mirror and must match the Rust structs 1:1.
- **`prisma/schema.prisma`** — the domain type source of truth (ADR-002). The Prisma
  Client (sidecar-only) generates TypeScript types from it.
- **The `AiProvider` interface** (`sidecar/src/providers/provider.ts`, ADR-006) — every
  concrete provider adapter implements this unchanged; capabilities are declared, not
  assumed.

A task is only "done" when it compiles against these contracts (`tsc --noEmit` in
`sidecar/`, `cargo check` in `core/`) and passes the tests the task calls for.

## Fill stubs in place — don't recreate

The scaffold's stubs already satisfy their contracts (correct signature, placeholder
body: `todo!()` / `INTERNAL` / typed placeholder). Replace a stub's body with the real
implementation; don't delete and rewrite the file from scratch, and don't change the
signature the contract dictates.

## Secrets — never logged, never persisted outside the native vault (ADR-003)

This is the single most important invariant in the codebase:

- The **Rust core** is the only code path allowed to read/write a real secret, and only
  via `core/src/vault.rs` (native OS keychain — Keychain/Credential Manager/Secret
  Service).
- The database only ever stores an `ApiKeyRef` — provider kind, label, connection mode,
  a `secretRef` pointer. **Never the secret itself.**
- A secret reaches the sidecar only as `InjectedCredential.secret`, injected **per
  request**, used in memory for that one call, and never written to disk, the
  database, or a log line. Never in a query string.
- Before closing any task that touches credentials, grep your diff for the secret
  field name to confirm it isn't logged.

## Type Safety

- **TypeScript (`sidecar/`, `apps/ui/`): never use `any`.** Use `unknown` with runtime
  type validation (type guards, Zod, `typeof` checks) and narrow before accessing
  properties.
- **Rust (`core/`): no `.unwrap()`/`.expect()` on a path that can be reached from
  external input or I/O.** Propagate with `?` into a `Result`, using `thiserror` for
  error types. `.unwrap()` is acceptable only in tests or on a genuinely-infallible
  invariant — comment why if you reach for it anywhere else.

```ts
// Bad
function parse(data: any) { return data.name }

// Good
function parse(data: unknown) {
  if (typeof data === 'object' && data !== null && 'name' in data) {
    return (data as { name: string }).name
  }
  throw new Error('Invalid data')
}
```

## Single Responsibility

- Every function, component, and module must have **one reason to change**.
- If a function does two things, split it into two functions.

## DRY (Don't Repeat Yourself)

- If logic is duplicated in 2+ places, abstract it into a shared function/module.
- Before abstracting, ask the user which pattern to follow when it's not obvious.

## SOLID Principles

| Principle | Rule |
|-----------|------|
| **S** — Single Responsibility | One module/function = one job |
| **O** — Open/Closed | New provider/adapter = new file, not a conditional in shared code |
| **L** — Liskov Substitution | Every `AiProvider` adapter must be substitutable for another |
| **I** — Interface Segregation | Small, focused interfaces over fat ones |
| **D** — Dependency Inversion | The agent graph and core depend on `AiProvider`/contracts, never a concrete provider |

## Object Calisthenics

1. **One level of indentation** per function — extract inner blocks into named functions.
2. **Don't use `else`** where an early return works.
3. **Wrap primitives** where a bare `string`/`number` would let two unrelated concepts
   collide (e.g. a provider kind vs. a free-form string).
4. **One dot per line** — avoid deep chaining, break into named variables.
5. **Don't abbreviate** — full names.
6. **Keep entities small** — files and functions stay easy to hold in one head.

> Apply judgment — don't create artificial splits that hurt readability.

## CSS Units (`apps/ui`)

Prefer `rem` over `px` for new styles (`10px = 1rem`). Not yet enforced by tooling in
this repo, but keep it consistent going forward.

## i18n

**RNF-502** requires PT and EN at launch. The concrete mechanism (translation file
format, key convention) is **not yet decided** in the docs — don't assume a specific
library or file layout; if you're about to add the first user-facing string, flag the
i18n approach for a decision rather than picking one silently.

## Conventions

- **No emojis** in UI or in code/comments.
- **Semantic commits**: `feat(scope):`, `fix(scope):`, `docs(scope):`, etc. — one item
  from `docs/TASKS.md` per commit.
- Every ADR (`docs/docs/ADR-Ray.md`) and every requirement ID (`RF-*`, `RNF-*`, `RID-*`
  in `docs/docs/SRS-Ray.md`) referenced in a task is binding context — read it before
  implementing, don't guess at intent.
