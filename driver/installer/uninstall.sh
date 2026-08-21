#!/usr/bin/env bash
# uninstall.sh — remove o Ray Audio Driver (dispositivo de audio virtual).
#
#   uninstall.sh [--test-mode <diretorio>]
#
# Sem argumentos, remove /Library/Audio/Plug-Ins/HAL/RayAudioDriver.driver
# com escalada privilegiada via osascript (RF-203: senha de administrador) e
# reinicia o coreaudiod. Com --test-mode, remove o bundle estagiado e o
# receipt do diretorio indicado, sem privilegio.
set -u

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HAL_DIR="/Library/Audio/Plug-Ins/HAL"
BUNDLE_NAME="RayAudioDriver.driver"
TEST_MODE=""

usage() {
  echo "Uso: uninstall.sh [--test-mode <diretorio>]" >&2
}

while [ $# -gt 0 ]; do
  case "$1" in
    --test-mode)
      [ $# -ge 2 ] || { usage; exit 2; }
      TEST_MODE="$2"
      shift 2
      ;;
    *)
      usage
      exit 2
      ;;
  esac
done

if [ -n "$TEST_MODE" ]; then
  rm -rf "$TEST_MODE/$BUNDLE_NAME" "$TEST_MODE/ray-audio-driver-receipt.json"
  echo "Desinstalacao concluida em modo de teste: $TEST_MODE"
  exit 0
fi

# desinstalacao real: escalada com senha de administrador (dialogo nativo)
privileged_command() {
  printf 'rm -rf "%s/%s" && killall coreaudiod' "$HAL_DIR" "$BUNDLE_NAME"
}

if ! osascript -e "do shell script \"$(privileged_command)\" with administrator privileges" >/dev/null 2>&1; then
  echo "Desinstalacao falhou: senha de administrador negada ou operacao cancelada" >&2
  exit 1
fi
echo "Desinstalacao concluida: o Ray Audio Driver foi removido do sistema"
