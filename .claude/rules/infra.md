# Infra Rules

> Before writing any code, read `.claude/rules/general.md` first.

## Process boundary

Ray is two processes plus a UI shell (ADR-001):

| Process | Runtime | Role |
|---|---|---|
| **core** | Rust (Tauri 2) | Supervisor. Windows, audio capture, global shortcuts, credential vault, spawns and supervises the sidecar, IPC with the UI. |
| **sidecar** | Node/TypeScript | Child process, packaged as an `externalBin`. Hosts the LangGraph.js agent and the Prisma Client — the only code that talks to Postgres. |
| **apps/ui** | Svelte 5 + Vite | Talks only to the Rust core via Tauri `invoke()`/events. **Never talks to the sidecar directly.** |

Communication core ↔ sidecar is **HTTP over loopback with streaming** (ADR-005):
sidecar binds `127.0.0.1` on an ephemeral port, prints `RAY_SIDECAR_PORT=<port>` to
stdout at boot, core reads it and becomes the sole client. Never bind beyond loopback;
never put a secret in a query string.

## Running things locally

Tauri needs a native window and the Rust toolchain, so **core and the UI run on the
host, not in a container** — there is no way to `docker run` a desktop app's window.
The sidecar and Postgres are the pieces that container well.

```bash
# Rust core (Tauri) — host, requires the Rust toolchain + Tauri system deps
cd core && cargo check
cd core && cargo build
cd core && cargo test
# cargo tauri dev  — once T-001 wires the Tauri CLI

# Sidecar (Node/TS) — host, requires Node
cd sidecar && npm install
cd sidecar && npm run build       # tsc
cd sidecar && npm run typecheck   # tsc --noEmit
cd sidecar && npm test            # vitest run

# Prisma — repo root (prisma/schema.prisma lives at the repo root, not under sidecar/)
npx prisma generate
npx prisma validate
npx prisma migrate dev
```

**Postgres**: RID-1 (`docs/docs/SRS-Ray.md`) calls for a `docker-compose.yml` with a
Postgres service (persistent volume) — **it does not exist yet** in this repo. Until
it's added, point `DATABASE_URL` at whatever local/dockerized Postgres you have
running; don't assume a compose file is already wired.

## Contract generation pipeline (ADR-010)

Two independent generators feed the type system — run before compiling consumers:

1. `npx prisma generate` — `prisma/schema.prisma` → TS domain types, consumed only by
   the sidecar.
2. `ts-rs` derive on `core/src/ipc.rs` structs → `contracts/ipc.ts` (once T-000 lands).
   Until then, `contracts/ipc.ts` is hand-maintained and must mirror the Rust structs
   exactly — a divergence is a contract bug, not a style choice.

## Environment Variables

- `DATABASE_URL` — PostgreSQL connection, read by the sidecar's Prisma Client only.
- `RAY_SIDECAR_PORT` — printed by the sidecar at boot; read by the core supervisor
  (`core/src/sidecar.rs`), not user-set.

No `.env.example` exists yet in this repo — don't assume env vars beyond the ones
above without checking `docs/docs/ADR-Ray.md` / `SRS-Ray.md` first.
