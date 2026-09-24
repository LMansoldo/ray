#!/bin/sh
# Build local do DMG do Ray (macOS) — o par de release do dev-app.sh.
#
# Uso:   core/scripts/build-dmg.sh [--no-sidecar]
#
# - Rebuilda o sidecar empacotavel (launcher + resources em
#   core/resources/sidecar) — pule com --no-sidecar se sidecar/src nao mudou;
# - `cargo tauri build --bundles dmg` com createUpdaterArtifacts DESLIGADO via
#   override de config: artefatos de updater exigem a chave de assinatura do
#   CI (TAURI_SIGNING_PRIVATE_KEY) — para release assinado use release.sh;
# - Assinatura ad-hoc (identidade "-"): o dmg roda na SUA maquina; para
#   distribuir a outros Macs e preciso notarizacao (CI/release.sh).
#
# Saida: core/target/release/bundle/dmg/ray_<versao>_aarch64.dmg (+ ray.app)
# Primeira execucao compila o perfil release inteiro — pode demorar minutos.
set -euo pipefail
cd "$(dirname "$0")/.."

NO_SIDECAR=0
for arg in "$@"; do
  case "$arg" in
    --no-sidecar) NO_SIDECAR=1 ;;
    *) printf 'uso: %s [--no-sidecar]\n' "$0" >&2; exit 1 ;;
  esac
done

VERSION=$(python3 -c "import json;print(json.load(open('tauri.conf.json'))['version'])")

if [ "$NO_SIDECAR" -eq 0 ]; then
  printf '[build-dmg] rebuild do sidecar (launcher + resources)\n'
  ./scripts/build-sidecar.sh
fi

printf '[build-dmg] cargo tauri build --bundles dmg (v%s) — release inteiro, aguarde\n' "$VERSION"
cargo tauri build --bundles dmg \
  --config '{"bundle":{"createUpdaterArtifacts":false}}'

printf '[build-dmg] pronto (v%s):\n' "$VERSION"
for artifact in \
  "target/release/bundle/dmg/ray_${VERSION}_aarch64.dmg" \
  "target/release/bundle/macos/ray.app"; do
  [ -e "$artifact" ] && printf '  %s\n' "$PWD/$artifact"
done
open -R target/release/bundle/dmg 2>/dev/null || true
