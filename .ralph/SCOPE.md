# Scope for this ralph-loop run

This run covers **only FASE 5 — Ship** from `docs/TASKS.md`:
T-500, T-501, T-502, T-503.

- **FASES 0–4 (T-000..T-408) are already implemented and merged into `dev`.** All Rust core
  commands, sidecar, UI surfaces, provider adapters, audio capture, STT, and streaming are
  available as a working foundation.
- There is no Fase 6 — this is the final phase.

## Item guidance

Fase 5 is a mixed-stack phase. Items span:
- **T-500**: macOS Audio Server Plugin (Swift/C, privileged installer) — lives outside the
  main Tauri build, versionned separately per ADR-009.
- **T-501**: Cross-platform packaging (Tauri bundler, AppImage/.deb/dmg/msi), embedded
  Whisper model for Win/Linux per ADR-009/RID-3/6.
- **T-502**: Signed auto-update (Tauri updater plugin) per RID-4.
- **T-503**: Local error-only logging and log export (RF-1004) — never log meeting content.

Read `.claude/rules/core.md`, `.claude/rules/general.md`, and `.claude/rules/infra.md`
before generating any item's contract.

**Dependency graph within this run:**
- T-500 depends on T-306 (already done — treat as available).
- T-501 depends on T-307 (already done — treat as available).
- T-502 depends on T-501.
- T-503 depends on T-001 (already done — treat as available).
- T-500 and T-503 are independent of each other.

**Important — T-501 previous failure:** The worker attempted to `git add docs/packaging.md`
(a file it did not actually create). Do NOT create documentation files or commit files
that do not exist on disk. Every `git add <path>` must be preceded by verifying the file
exists. Only commit files listed in `files` that were actually written.

**Critical rules for all items:**
- No `.unwrap()`/`.expect()` on any I/O path — propagate with `?` into `Result<T, E>`.
- Secrets never logged, never persisted outside `vault.rs` (ADR-003).
- T-503: meeting content (transcripts, suggestions) must NEVER appear in logs — only
  errors and diagnostics.
- T-500: the audio driver runs as a privileged process; minimize its attack surface.
- i18n: all user-facing strings hardcoded in PT-BR (deferred, same decision as Fase 4).

**Test strategy:**
- `cargo check` gates all Rust items.
- T-501/T-502: build scripts and manifest validation are testable; actual installer
  signing requires platform CI — mock the signing step in unit tests.
- T-503: test that log output never contains transcript content.

Produce exactly 4 items (one per T-500..T-503).
