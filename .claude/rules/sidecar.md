# Sidecar Rules (sidecar/ — Node/TypeScript)

> Before writing any code, read `.claude/rules/general.md` and `.claude/rules/infra.md`
> first.

## Tech Stack

- **TypeScript** (strict — see `sidecar/tsconfig.json`)
- **LangGraph.js** (`@langchain/langgraph`) — the copilot agent graph
- **Prisma Client** — the only code in the whole app that talks to Postgres (ADR-002)
- Plain Node HTTP server on loopback (ADR-005) — no framework decided in the docs;
  check `sidecar/src/server.ts` for what's actually there before assuming one
- **Vitest** — testing

## Directory Structure

```
sidecar/
├── package.json         # scripts: build (tsc), typecheck (tsc --noEmit), test (vitest run)
└── src/
    ├── server.ts         # loopback HTTP server, prints RAY_SIDECAR_PORT= at boot
    ├── handlers.ts        # one handler per contracts/ipc.ts endpoint
    ├── contract.ts         # hand-maintained mirror of contracts/ipc.ts (see below)
    ├── db.ts               # Prisma Client singleton (T-002)
    ├── agent/
    │   └── graph.ts         # LangGraph.js graph (T-102) — provider-agnostic
    └── providers/
        ├── provider.ts       # the AiProvider interface (ADR-006) — do not change lightly
        ├── types.ts           # shared provider-facing types
        ├── registry.ts         # maps ProviderKind -> concrete adapter
        └── openai.ts, anthropic.ts, ... # one adapter file per provider
```

## `contract.ts` vs `contracts/ipc.ts` — know which is real

`sidecar/src/contract.ts` is an internal, hand-maintained **mirror** of the real
contract at `contracts/ipc.ts` (itself generated from `core/src/ipc.rs` once T-000
lands, per ADR-010). If the two diverge, that is a contract bug — fix it by making
`contract.ts` match the generated source, never by reshaping the endpoint to whatever
`contract.ts` currently says.

## Handlers — implement against the contract, not around it

Every function in `handlers.ts` implements one `contracts/ipc.ts` endpoint. Request and
response shapes are fixed by the contract — don't add/remove/rename a field to make an
implementation easier. If a contract shape looks wrong for what you're building, stop
and flag it (per `general.md`) instead of improvising.

## Provider adapters (ADR-006) — `AiProvider` interface

Every concrete provider (`openai.ts`, `anthropic.ts`, `gemini.ts`, `deepseek.ts`,
`openrouter.ts`, a generic OpenAI-compatible-endpoint adapter) implements
`sidecar/src/providers/provider.ts`'s `AiProvider` interface unchanged:

- Declare `capabilities` (`analysis`/`transcription`/`translation`) **truthfully** —
  never claim a capability the adapter doesn't actually implement.
- Throw `CapabilityNotSupported` for an unsupported operation rather than silently
  no-op-ing or returning empty data.
- `validate()` must actually call the provider to confirm the credential, not just
  check the shape of the key string.
- A new provider is a **new adapter file + a registry entry** — never a conditional
  branch on `ProviderKind` inside the agent graph or a handler (that's the whole point
  of ADR-006 / RNF-601).

## The agent (T-102, LangGraph.js)

- `agent/graph.ts` receives the active assistant's system prompt + transcript context,
  and must stay **agnostic to the concrete provider** — it depends on `AiProvider`,
  never imports a specific adapter directly.
- Streaming output is a sequence of `SuggestStreamEvent`s: `start` → `token`* →
  `done`/`error`. Order must be preserved; don't buffer and flatten it.
- Swapping the active assistant changes behavior (different system prompt), not the
  graph shape.

## Prisma (ADR-002)

- `prisma/schema.prisma` (repo root) is the domain type source of truth — the Prisma
  Client run here is the **only** database access path in the entire app; the Rust core
  never touches Postgres directly.
- The client is a **singleton** in the sidecar process (`db.ts`) — don't instantiate a
  new `PrismaClient` per request.
- **Migrations are immutable once applied** — add a new migration, never edit one
  that's already landed.
- Changesets/validation happen before persistence; no business logic embedded in a bare
  Prisma call that skips validation.

## Security — credential handling

`InjectedCredential.secret` arrives **per request**, injected by the Rust core (ADR-003).
- Use it in memory for that single call only.
- Never write it to the database, disk, or a log line.
- Never hold it in a module-level variable that outlives the request.

## Tests

- **Vitest**, colocated `*.test.ts`.
- Provider adapters: test against a fake/mocked HTTP layer, not real API calls, but
  assert on the actual request shape sent (auth header, endpoint, streaming parse).
- Agent graph: test with a fake `AiProvider` implementation, asserting event order
  (`start` → `token`* → `done`).

## Commands

```bash
cd sidecar && npm install
cd sidecar && npm run build
cd sidecar && npm run typecheck
cd sidecar && npm test
```
