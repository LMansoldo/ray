#!/usr/bin/env bash
# core/scripts/release.sh
# Per-platform release pipeline for Ray (T-501 / RID-3 / ADR-009).
#
# Usage:
#   ./release.sh [--dry-run] [--channel <stable|unstable>] [--platform <linux|macos|windows>]
#
# --dry-run   Print artifact names without actually building or signing.
# --channel   stable (default) | unstable
# --platform  linux | macos | windows — defaults to current host platform
#
# Environment:
#   TAURI_SIGNING_PRIVATE_KEY / TAURI_SIGNING_PRIVATE_KEY_PASSWORD
#     Required when not in dry-run mode.  Injected by CI; never committed.

set -euo pipefail

DRY_RUN=0
CHANNEL="stable"
PLATFORM=""
PLATFORM_EXPLICIT=0

while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run)   DRY_RUN=1 ;;
    --channel)   CHANNEL="${2:?--channel requires an argument}"; shift ;;
    --platform)  PLATFORM="${2:?--platform requires an argument}"; PLATFORM_EXPLICIT=1; shift ;;
    *) printf "Unknown option: %s\n" "$1" >&2; exit 1 ;;
  esac
  shift
done

if [ -z "$PLATFORM" ]; then
  case "$(uname -s)" in
    Linux*)   PLATFORM="linux" ;;
    Darwin*)  PLATFORM="macos" ;;
    MINGW*|MSYS*|CYGWIN*|Windows*) PLATFORM="windows" ;;
    *) printf "Unsupported platform: %s\n" "$(uname -s)" >&2; exit 1 ;;
  esac
fi

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
VERSION="$(jq -r '.version' "$REPO_ROOT/core/tauri.conf.json")"
PRODUCT="ray"

_artifact_name() {
  local format="$1"
  local arch="${2:-x86_64}"
  local plat="${3:-$PLATFORM}"
  case "$CHANNEL" in
    stable)   printf '%s_%s_%s_%s.%s\n' "$PRODUCT" "$VERSION" "$arch" "$plat" "$format" ;;
    unstable) printf '%s_%s-unstable_%s_%s.%s\n' "$PRODUCT" "$VERSION" "$arch" "$plat" "$format" ;;
    *)        printf "Unknown channel: %s\n" "$CHANNEL" >&2; exit 1 ;;
  esac
}

_print_dry_run_linux() {
  printf "Artifact (AppImage x86_64): %s\n" "$(_artifact_name AppImage x86_64 linux)"
  printf "Artifact (AppImage aarch64): %s\n" "$(_artifact_name AppImage aarch64 linux)"
  printf "Artifact (.deb x86_64):     %s\n" "$(_artifact_name deb x86_64 linux)"
  printf "Artifact (.deb aarch64):    %s\n" "$(_artifact_name deb aarch64 linux)"
}

_print_dry_run_macos() {
  printf "Artifact (.dmg universal): %s\n" "$(_artifact_name dmg universal macos)"
}

_print_dry_run_windows() {
  printf "Artifact (.msi x86_64): %s\n" "$(_artifact_name msi x86_64 windows)"
}

if [ "$DRY_RUN" -eq 1 ]; then
  if [ "$PLATFORM_EXPLICIT" -eq 1 ]; then
    printf "=== DRY RUN | channel=%s | platform=%s ===\n" "$CHANNEL" "$PLATFORM"
    case "$PLATFORM" in
      linux)   _print_dry_run_linux ;;
      macos)   _print_dry_run_macos ;;
      windows) _print_dry_run_windows ;;
    esac
  else
    printf "=== DRY RUN | channel=%s | all platforms ===\n" "$CHANNEL"
    _print_dry_run_linux
    _print_dry_run_macos
    _print_dry_run_windows
  fi
  exit 0
fi

# ── Real build (runs on CI with signing credentials) ─────────────────────────

if [ -z "${TAURI_SIGNING_PRIVATE_KEY:-}" ]; then
  printf "ERROR: TAURI_SIGNING_PRIVATE_KEY not set — required for signed builds.\n" >&2
  exit 1
fi

cd "$REPO_ROOT"

printf "Building Ray %s (%s channel, %s)...\n" "$VERSION" "$CHANNEL" "$PLATFORM"

case "$PLATFORM" in
  linux)
    cargo tauri build --target x86_64-unknown-linux-gnu --bundles appimage,deb
    cargo tauri build --target aarch64-unknown-linux-gnu --bundles appimage,deb
    ;;
  macos)
    cargo tauri build --target universal-apple-darwin --bundles dmg
    ;;
  windows)
    cargo tauri build --target x86_64-pc-windows-msvc --bundles msi
    ;;
  *)
    printf "Unsupported platform: %s\n" "$PLATFORM" >&2
    exit 1
    ;;
esac

printf "Build complete. Artifacts in src-tauri/target/release/bundle/\n"
