#!/usr/bin/env bash
# core/scripts/validate-packaging.sh
# Gate for T-501: validates Tauri 2 bundle config, sidecar binaries per target triple,
# Whisper embedding (Windows/Linux), release scripts, and packaging documentation.
#
# Usage: ./validate-packaging.sh
# Exit 0 = all checks pass. Exit 1 = one or more failed.
# Requires: jq, bash >= 3.2.

set -uo pipefail

PASS=0
FAIL=0
SKIP=0

pass() { printf "PASS %s: %s\n" "$1" "$2"; PASS=$((PASS + 1)); }
fail() { printf "FAIL %s: %s\n" "$1" "$2"; FAIL=$((FAIL + 1)); }
skip() { printf "SKIP %s: %s\n" "$1" "$2"; SKIP=$((SKIP + 1)); }

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
CONF="$REPO_ROOT/core/tauri.conf.json"
BINS="$REPO_ROOT/core/binaries"
CORE_DIR="$REPO_ROOT/core"
DOCS_PKG="$REPO_ROOT/docs/packaging.md"
RELEASE="$REPO_ROOT/core/scripts/release.sh"

if ! command -v jq >/dev/null 2>&1; then
  echo "FATAL: jq is required — install it and retry."
  exit 1
fi

# Returns 0 if the named Tauri bundle target is present in bundle.targets.
# Handles both "all" (string) and array forms.
_has_target() {
  local target raw
  target="$1"
  raw=$(jq -r '.bundle.targets // empty' "$CONF" 2>/dev/null) || return 1
  [ -z "$raw" ] && return 1
  [ "$raw" = "all" ] && return 0
  jq -e --arg t "$target" \
    '.bundle.targets | if type == "array" then (index($t) != null) else . == $t end' \
    "$CONF" >/dev/null 2>&1
}

# Runs release.sh --dry-run [--channel <ch>] safely; returns empty if not executable.
_dry_run() {
  local channel="${1:-}"
  if [ ! -x "$RELEASE" ]; then
    return 0
  fi
  if [ -n "$channel" ]; then
    "$RELEASE" --dry-run --channel "$channel" 2>/dev/null || true
  else
    "$RELEASE" --dry-run 2>/dev/null || true
  fi
}

echo ""
echo "=== T-501 validate-packaging ==="
echo ""

# ── C01–C11: tauri.conf.json shape ───────────────────────────────────────────

(set -e; jq . "$CONF" >/dev/null 2>&1) \
  && pass "C01" "tauri.conf.json is valid JSON" \
  || fail "C01" "tauri.conf.json missing or not valid JSON"

(set -e; jq -e '.bundle.active == true' "$CONF" >/dev/null 2>&1) \
  && pass "C02" "bundle.active == true" \
  || fail "C02" "bundle.active missing or not true"

(set -e; val=$(jq -r '.bundle.targets // empty' "$CONF"); [ -n "$val" ]) \
  && pass "C03" "bundle.targets declared in tauri.conf.json" \
  || fail "C03" "bundle.targets missing — RNF-401 requires AppImage/deb/dmg/msi targets"

_has_target "appimage" \
  && pass "C04" 'bundle.targets includes "appimage" (RNF-401 Linux AppImage)' \
  || fail "C04" 'bundle.targets missing "appimage" — Linux AppImage not declared (RNF-401/ADR-009)'

_has_target "deb" \
  && pass "C05" 'bundle.targets includes "deb" (RNF-401 Linux .deb)' \
  || fail "C05" 'bundle.targets missing "deb" — Linux .deb not declared (RNF-401/ADR-009)'

_has_target "dmg" \
  && pass "C06" 'bundle.targets includes "dmg" (RNF-401 macOS .dmg)' \
  || fail "C06" 'bundle.targets missing "dmg" — macOS .dmg not declared (RNF-401/ADR-009)'

_has_target "msi" \
  && pass "C07" 'bundle.targets includes "msi" (RNF-401 Windows .msi)' \
  || fail "C07" 'bundle.targets missing "msi" — Windows .msi not declared (RNF-401/ADR-009)'

# Tauri 2 externalBin entry is the BASE name (no triple suffix); Tauri appends the triple.
(set -e; jq -e '.bundle.externalBin | index("binaries/ray-sidecar") != null' "$CONF" >/dev/null 2>&1) \
  && pass "C08" 'bundle.externalBin keeps base name "binaries/ray-sidecar" (Tauri resolves per triple)' \
  || fail "C08" 'bundle.externalBin missing "binaries/ray-sidecar" — sidecar not wired for bundling (ADR-009)'

# bundle.resources must be present and non-empty (carries the Whisper engine + default model).
(set -e; jq -e '.bundle.resources and (.bundle.resources | length > 0)' "$CONF" >/dev/null 2>&1) \
  && pass "C09" "bundle.resources declared and non-empty (required for Whisper embedding, RNF-404)" \
  || fail "C09" "bundle.resources missing or empty — Whisper engine/model not declared (RNF-404/ADR-009/RID-6)"

# bundle.resources must include a path referencing the Whisper engine binary.
WHISPER_ENGINE_PATH=$(jq -r '.bundle.resources[]? | select(test("whisper"; "i"))' "$CONF" 2>/dev/null | head -1)
[ -n "$WHISPER_ENGINE_PATH" ] \
  && pass "C10" "bundle.resources includes Whisper engine path: $WHISPER_ENGINE_PATH" \
  || fail "C10" "bundle.resources has no Whisper engine path — whisper.cpp not declared for embedding (RNF-404)"

# bundle.resources must include a model file (.bin or .gguf).
WHISPER_MODEL_PATH=$(jq -r '.bundle.resources[]? | select(test("\\.(bin|gguf)$"; "i"))' "$CONF" 2>/dev/null | head -1)
[ -n "$WHISPER_MODEL_PATH" ] \
  && pass "C11" "bundle.resources includes model file path: $WHISPER_MODEL_PATH" \
  || fail "C11" "bundle.resources has no model file (.bin/.gguf) — default Whisper model not declared (RNF-404/RID-6)"

# ── C12–C18: binary stubs in core/binaries/ ──────────────────────────────────

# Every supported target triple needs a binary stub so CI can package it.
# aarch64-apple-darwin already ships (existing host binary); the rest are stubs for CI.
[ -e "$BINS/ray-sidecar-aarch64-apple-darwin" ] \
  && pass "C12" "ray-sidecar-aarch64-apple-darwin exists in core/binaries/ (macOS ARM64)" \
  || fail "C12" "ray-sidecar-aarch64-apple-darwin missing from core/binaries/ (ADR-009)"

[ -e "$BINS/ray-sidecar-x86_64-apple-darwin" ] \
  && pass "C13" "ray-sidecar-x86_64-apple-darwin exists in core/binaries/ (macOS x86_64)" \
  || fail "C13" "ray-sidecar-x86_64-apple-darwin missing — stub needed for macOS x86_64 CI (ADR-009)"

[ -e "$BINS/ray-sidecar-x86_64-unknown-linux-gnu" ] \
  && pass "C14" "ray-sidecar-x86_64-unknown-linux-gnu exists in core/binaries/ (Linux x86_64)" \
  || fail "C14" "ray-sidecar-x86_64-unknown-linux-gnu missing — stub needed for Linux x86_64 CI (ADR-009)"

[ -e "$BINS/ray-sidecar-aarch64-unknown-linux-gnu" ] \
  && pass "C15" "ray-sidecar-aarch64-unknown-linux-gnu exists in core/binaries/ (Linux ARM64)" \
  || fail "C15" "ray-sidecar-aarch64-unknown-linux-gnu missing — stub needed for Linux ARM64 CI (ADR-009/RNF-401)"

[ -e "$BINS/ray-sidecar-x86_64-pc-windows-msvc.exe" ] \
  && pass "C16" "ray-sidecar-x86_64-pc-windows-msvc.exe exists in core/binaries/ (Windows x86_64)" \
  || fail "C16" "ray-sidecar-x86_64-pc-windows-msvc.exe missing — stub needed for Windows CI (ADR-009)"

# Whisper engine resource file must exist at the path declared in bundle.resources.
if [ -n "$WHISPER_ENGINE_PATH" ]; then
  [ -e "$CORE_DIR/$WHISPER_ENGINE_PATH" ] \
    && pass "C17" "Whisper engine resource file exists at core/$WHISPER_ENGINE_PATH" \
    || fail "C17" "Whisper engine declared in bundle.resources but not found at core/$WHISPER_ENGINE_PATH"
else
  fail "C17" "Cannot verify Whisper engine file — no engine path in bundle.resources (depends on C10)"
fi

# Whisper model resource file must exist at the path declared in bundle.resources.
if [ -n "$WHISPER_MODEL_PATH" ]; then
  [ -e "$CORE_DIR/$WHISPER_MODEL_PATH" ] \
    && pass "C18" "Whisper model resource file exists at core/$WHISPER_MODEL_PATH" \
    || fail "C18" "Whisper model declared in bundle.resources but not found at core/$WHISPER_MODEL_PATH"
else
  fail "C18" "Cannot verify Whisper model file — no model path in bundle.resources (depends on C11)"
fi

# ── C19–C24: docs/packaging.md content ───────────────────────────────────────

[ -f "$DOCS_PKG" ] \
  && pass "C19" "docs/packaging.md exists" \
  || fail "C19" "docs/packaging.md missing — installer sizes not documented (RID-6/T-501 acceptance)"

# Size figures (e.g. "120 MB", "1.2 GB") must appear so readers can assess installer impact.
grep -qiE '[0-9]+[.,]?[0-9]*\s*(MB|MiB|GB|GiB)' "$DOCS_PKG" 2>/dev/null \
  && pass "C20" "docs/packaging.md contains installer size figures" \
  || fail "C20" "docs/packaging.md lacks installer size data (RID-6: size impact must be documented)"

# On-demand download of larger models must be documented (RID-6).
grep -qiE 'download|on.demand|sob.demanda|baixar' "$DOCS_PKG" 2>/dev/null \
  && pass "C21" "docs/packaging.md documents on-demand model download (RID-6)" \
  || fail "C21" "docs/packaging.md missing on-demand download docs (RID-6: larger models downloadable on demand)"

# Hardware-based model selection must be documented (RNF-404).
grep -qiE 'hardware|selec|tiny|base|small|medium|large|RAM|vRAM' "$DOCS_PKG" 2>/dev/null \
  && pass "C22" "docs/packaging.md documents hardware-based model selection (RNF-404)" \
  || fail "C22" "docs/packaging.md missing model-size-by-hardware docs (RNF-404)"

# stable/unstable channels must be documented (RID-3/ADR-009).
(grep -qE 'stable' "$DOCS_PKG" 2>/dev/null && grep -qE 'unstable' "$DOCS_PKG" 2>/dev/null) \
  && pass "C23" "docs/packaging.md mentions both stable and unstable channels (RID-3/ADR-009)" \
  || fail "C23" "docs/packaging.md missing stable/unstable channel docs (RID-3/ADR-009)"

# CPU-only requirement must be stated (RNF-404: no GPU dependency).
grep -qiE '\bCPU\b|sem GPU|without GPU|no GPU|nao.*GPU|sem.*placa' "$DOCS_PKG" 2>/dev/null \
  && pass "C24" "docs/packaging.md states CPU-only Whisper requirement (RNF-404)" \
  || fail "C24" "docs/packaging.md missing CPU-only note (RNF-404: whisper.cpp must run without GPU)"

# ── C25–C31: core/scripts/release.sh ─────────────────────────────────────────

[ -f "$RELEASE" ] \
  && pass "C25" "core/scripts/release.sh exists (RID-3: release pipeline per platform)" \
  || fail "C25" "core/scripts/release.sh missing — no release pipeline (RID-3/ADR-009)"

(set -e; [ -f "$RELEASE" ] && [ -x "$RELEASE" ] && bash -n "$RELEASE" >/dev/null 2>&1) \
  && pass "C26" "release.sh is executable and has valid bash syntax" \
  || fail "C26" "release.sh missing, not executable, or has bash syntax errors"

DRY_OUTPUT=$(_dry_run)

printf '%s' "$DRY_OUTPUT" | grep -qi 'AppImage' \
  && pass "C27" 'release.sh --dry-run outputs AppImage artifact name (Linux x86_64 + ARM64)' \
  || fail "C27" 'release.sh --dry-run missing AppImage output — Linux AppImage not in release pipeline (RNF-401)'

printf '%s' "$DRY_OUTPUT" | grep -qiE '\.deb' \
  && pass "C28" 'release.sh --dry-run outputs .deb artifact name' \
  || fail "C28" 'release.sh --dry-run missing .deb output — Linux .deb not in release pipeline (RNF-401)'

printf '%s' "$DRY_OUTPUT" | grep -qiE '\.dmg' \
  && pass "C29" 'release.sh --dry-run outputs .dmg artifact name' \
  || fail "C29" 'release.sh --dry-run missing .dmg output — macOS .dmg not in release pipeline (RNF-401)'

printf '%s' "$DRY_OUTPUT" | grep -qiE '\.msi' \
  && pass "C30" 'release.sh --dry-run outputs .msi artifact name' \
  || fail "C30" 'release.sh --dry-run missing .msi output — Windows .msi not in release pipeline (RNF-401)'

# stable and unstable channel runs must produce distinct artifact paths (ADR-009/RID-3).
STABLE_OUT=$(_dry_run stable)
UNSTABLE_OUT=$(_dry_run unstable)
([ -n "$STABLE_OUT" ] && [ -n "$UNSTABLE_OUT" ] && [ "$STABLE_OUT" != "$UNSTABLE_OUT" ]) \
  && pass "C31" "release.sh --channel stable and --channel unstable produce distinct artifact names (RID-3)" \
  || fail "C31" "release.sh does not distinguish stable/unstable channels (RID-3/ADR-009)"

# ── C32: cargo check ─────────────────────────────────────────────────────────

if command -v cargo >/dev/null 2>&1; then
  (set -e; cd "$CORE_DIR" && cargo check --quiet 2>/dev/null) \
    && pass "C32" "cargo check passes in core/ (tauri.conf.json changes did not break compilation)" \
    || fail "C32" "cargo check failed in core/ — T-501 changes introduced a compilation error"
else
  skip "C32" "cargo not available on this host — skipping compilation check"
fi

# ── Summary ───────────────────────────────────────────────────────────────────

echo ""
echo "=== Summary ==="
printf "PASS: %d | FAIL: %d | SKIP: %d\n" "$PASS" "$FAIL" "$SKIP"
echo ""

if [ "$FAIL" -gt 0 ]; then
  exit 1
fi
exit 0
