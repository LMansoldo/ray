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

# desinstalacao real: escalada com senha de administrador (dialogo nativo).
# Aspas simples nos caminhos: aspas duplas internas quebrariam a string
# AppleScript (syntax error -2740) — mesmo bug corrigido no install.sh.
sh_quote() {
  printf "'%s'" "$(printf '%s' "$1" | sed "s/'/'\\\\''/g")"
}

privileged_command() {
  printf 'rm -rf %s/%s && killall coreaudiod' \
    "$(sh_quote "$HAL_DIR")" "$BUNDLE_NAME"
}

osa_error="$(osascript -e "do shell script \"$(privileged_command)\" with administrator privileges" 2>&1 >/dev/null)"
if [ $? -ne 0 ]; then
  case "$osa_error" in
    *"User canceled"*|*-128*)
      echo "Desinstalacao falhou: operacao cancelada pelo usuario" >&2
      ;;
    *)
      echo "Desinstalacao falhou: $osa_error" >&2
      ;;
  esac
  exit 1
fi
echo "Desinstalacao concluida: o Ray Audio Driver foi removido do sistema"
