# Core Rules (core/ — Rust, Tauri 2)

> Before writing any code, read `.claude/rules/general.md` and `.claude/rules/infra.md`
> first.

## Tech Stack

- **Rust**, edition 2021, `crate-type = ["staticlib", "cdylib", "rlib"]`
- **Tauri 2** — desktop shell, windows, commands
- **tokio** (`features = ["full"]`) — async runtime
- **reqwest** (`features = ["json", "stream"]`) — HTTP client to the sidecar
- **serde** / **serde_json** — (de)serialization
- **ts-rs** — generates `contracts/ipc.ts` from `#[derive(TS)]` structs (ADR-010)
- **keyring** — native OS credential vault (ADR-003)
- **thiserror** — error types

## Directory Structure

```
core/
├── Cargo.toml
└── src/
    ├── lib.rs        # run() entry point + #[tauri::command] handlers (the UI boundary)
    ├── ipc.rs         # IPC boundary structs, #[derive(TS)] source of contracts/ipc.ts
    ├── sidecar.rs      # spawns/supervises the sidecar (externalBin), health, restart
    ├── vault.rs        # native keychain: store/get/delete a secret
    ├── windows.rs       # per-platform stealth (capture exclusion), opacity, toggle
    └── audio.rs         # device enumeration + capture (VOCÊ/OUTROS channels)
```

## The command boundary is the contract

`#[tauri::command]` functions in `lib.rs` are the **only** thing the Svelte UI calls
(via `invoke()`). Their signatures are the contract — don't rename a command or change
its params/return type without checking every UI call site first. The scaffold already
declares the initial set (`set_stealth`, `toggle_window`, `suggest`) with correct
signatures and `todo!()`/placeholder bodies — fill them in, don't redeclare them.

## Error handling

- Propagate with `?` into `Result<T, E>`; define error enums with `thiserror`.
- No `.unwrap()`/`.expect()` on anything reachable from I/O, external input, or another
  process (sidecar HTTP calls, audio devices, the vault) — those all fail in the real
  world. Tests and genuinely-infallible invariants are the only exception.
- A `#[tauri::command]` that can fail returns `Result<T, String>` (or a typed error that
  serializes) — never panics across the IPC boundary into the UI.

## Module responsibilities (ADR references)

- **`sidecar.rs`** (ADR-001) — spawn via `externalBin`, read `RAY_SIDECAR_PORT=` from
  stdout, healthcheck, **restart on failure without dropping the UI windows** (RNF-302).
  This module is the only thing that knows the sidecar's process lifecycle.
- **`vault.rs`** (ADR-003) — the **only** code path in the whole app allowed to touch a
  real secret. `store`/`get`/`delete` against the native keychain. The database layer
  (owned by the sidecar) only ever sees a `secretRef` pointer — never call into the
  vault from anywhere in `sidecar/`.
- **`ipc.rs`** — structs annotated `#[derive(TS)]` that generate `contracts/ipc.ts`.
  Once T-000 lands, **never hand-edit `contracts/ipc.ts`** — edit the Rust struct and
  regenerate.
- **`windows.rs`** (ADR-008) — stealth is native per platform: Windows
  `SetWindowDisplayAffinity(WDA_EXCLUDEFROMCAPTURE)`, macOS `NSWindowSharingNone`,
  Linux degrades gracefully and must signal the limitation to the user rather than
  silently no-op.
- **`audio.rs`** (ADR-004) — VOCÊ (mic) and OUTROS (system/received) channels. On
  macOS, OUTROS depends on the separate Ray Audio Driver (T-500); on Windows prefer
  WASAPI loopback; on Linux, the Pulse/PipeWire monitor.

## Credential injection flow (ADR-003) — do not shortcut this

When core calls the sidecar on behalf of a feature that needs a provider credential:
1. Resolve the secret via `vault::get_secret` (never read it from anywhere else).
2. Inject it into that one request's `InjectedCredential.secret`.
3. Never persist it, never log it, never reuse it across requests without re-resolving.

## Tests

- `cargo test` for unit/integration tests colocated with each module.
- A vault test must run against the real native keychain of the dev platform — no mock
  substitute that would let a real keychain-integration bug pass silently.

## Commands

```bash
cd core && cargo check
cd core && cargo build
cd core && cargo test
```
