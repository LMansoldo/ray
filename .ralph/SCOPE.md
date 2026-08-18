# Scope for this ralph-loop run

This run covers **only FASE 3 — Núcleo Rust** from `docs/TASKS.md`:
T-300, T-301, T-302, T-303, T-304, T-305, T-306, T-307.

- **FASE 0 (T-000..T-003) is already implemented and merged into `dev`.** Treat its
  outputs (Tauri scaffold, `core/src/lib.rs` stubs, `contracts/ipc.ts`,
  `contracts/settings.ts`) as an existing foundation. T-001 and T-003 in particular
  are done — do not generate work items for them; treat them as available deps.
- **FASE 1 (T-100..T-103) is already implemented and merged into `dev`.** T-102
  (agent graph + sidecar streaming) is available; treat it as an existing dep for T-303.
- **FASE 2 (T-200..T-207) is already implemented and merged into `dev`.** Provider
  adapters and handlers are available; no need to recreate them.
- **FASE 4 onward (T-4xx, T-5xx) is out of scope for this run.** Do not generate
  work items for them.

## Item guidance

All items in this run are in `core/` (Rust, Tauri 2). Read `.claude/rules/core.md`
and `.claude/rules/general.md` before generating any item's contract.

**Dependency graph within this run:**
- T-300, T-301, T-304, T-306 have no intra-run dependencies (T-001 is already done).
- T-302 depends on T-300 and T-301.
- T-303 depends on T-302 (T-102 is already done — treat as available).
- T-305 depends on T-304 (T-001 and T-003 are already done).
- T-307 depends on T-306.

Do not add `dependsOn` edges pointing at Fase 0/1/2 task ids — those items do not
exist in this run's graph; reference their outputs as already-present code.

**Critical rules for all items:**
- No `.unwrap()`/`.expect()` on any path reachable from I/O, external input, or
  another process. Propagate with `?` into `Result<T, E>` using `thiserror`.
- `#[tauri::command]` functions that can fail return `Result<T, String>` — never panic
  across the IPC boundary.
- Secrets (T-301/T-302): `vault.rs` is the ONLY code path allowed to read/write a
  real secret. Tests for T-301 must run against the real native keychain, not a mock.
- Linux stealth (T-304): must degrade gracefully and signal the limitation to the user
  rather than silently no-op — per ADR-008.

**Test strategy:**
- `cargo test` colocated with each module.
- T-301 vault tests: real native keychain on the dev platform — no mock substitute.
- T-300 sidecar supervision: can stub the child process binary.
- T-306/T-307 audio/STT: mock the platform audio APIs at the FFI boundary.

Produce exactly 8 items (one per T-300..T-307), or a justified split per the sizing
rule in the Contract-phase instructions.
