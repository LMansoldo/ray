#!/usr/bin/env bash
# core/scripts/sign-release.sh
# Signs a Tauri release artifact with minisign for auto-update verification
# (T-502 / RID-4 / ADR-009). The public key counterpart must be set in
# core/tauri.conf.json plugins.updater.pubkey before distribution.
#
# Usage:
#   ./sign-release.sh <artifact-path>
#
# Environment (both required — injected by CI, never committed):
#   TAURI_SIGNING_PRIVATE_KEY          base64-encoded minisign private key
#   TAURI_SIGNING_PRIVATE_KEY_PASSWORD passphrase for the key
#
# Keypair generation (run once, store public key in tauri.conf.json):
#   cargo tauri signer generate -w ~/.tauri/ray.key
#
# Audio driver (T-500) has its own separate update cycle per ADR-009 and is
# NOT signed or distributed through this script.

set -euo pipefail

ARTIFACT="${1:?Usage: $0 <artifact-path>}"

if [ ! -f "$ARTIFACT" ]; then
  printf "ERROR: artifact not found: %s\n" "$ARTIFACT" >&2
  exit 1
fi

if [ -z "${TAURI_SIGNING_PRIVATE_KEY:-}" ]; then
  printf "ERROR: TAURI_SIGNING_PRIVATE_KEY not set.\n" >&2
  exit 1
fi

if [ -z "${TAURI_SIGNING_PRIVATE_KEY_PASSWORD:-}" ]; then
  printf "ERROR: TAURI_SIGNING_PRIVATE_KEY_PASSWORD not set.\n" >&2
  exit 1
fi

printf "Signing: %s\n" "$ARTIFACT"

cargo tauri signer sign \
  --private-key "$TAURI_SIGNING_PRIVATE_KEY" \
  --password "$TAURI_SIGNING_PRIVATE_KEY_PASSWORD" \
  "$ARTIFACT"

printf "Signature written: %s.sig\n" "$ARTIFACT"
