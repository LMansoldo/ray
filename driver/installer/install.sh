#!/usr/bin/env bash
# install.sh — instala o Ray Audio Driver (dispositivo de audio virtual).
#
#   install.sh [--test-mode <diretorio>] [--payload <bundle>]
#
# Sem argumentos, instala o payload em /Library/Audio/Plug-Ins/HAL/ com
# escalada privilegiada via osascript (RF-203: senha de administrador) e
# reinicia o coreaudiod. Com --test-mode, estagia o bundle num diretorio
# local e escreve um receipt, sem privilegio algum.
#
# O payload e verificado contra SHA256SUMS ANTES de qualquer operacao
# privilegiada (SCOPE.md: superficie de ataque minima).
set -u

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DRIVER_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
MANIFEST="$SCRIPT_DIR/SHA256SUMS"
HAL_DIR="/Library/Audio/Plug-Ins/HAL"
BUNDLE_NAME="RayAudioDriver.driver"
TEST_MODE=""
PAYLOAD="$SCRIPT_DIR/$BUNDLE_NAME"

usage() {
  echo "Uso: install.sh [--test-mode <diretorio>] [--payload <bundle>]" >&2
}

while [ $# -gt 0 ]; do
  case "$1" in
    --test-mode)
      [ $# -ge 2 ] || { usage; exit 2; }
      TEST_MODE="$2"
      shift 2
      ;;
    --payload)
      [ $# -ge 2 ] || { usage; exit 2; }
      PAYLOAD="$2"
      shift 2
      ;;
    *)
      usage
      exit 2
      ;;
  esac
done

# verify_payload <bundle> — confere cada arquivo do manifesto contra o
# payload. Roda sempre, antes do modo de teste E antes da escalada.
verify_payload() {
  local bundle="$1" line hash path actual
  while IFS= read -r line; do
    hash="${line%%  *}"
    path="${line#*  }"
    if [ ! -f "$bundle/$path" ]; then
      echo "Falha na verificacao de checksum: arquivo ausente no payload: $path" >&2
      return 1
    fi
    actual="$(shasum -a 256 "$bundle/$path" | awk '{print $1}')"
    if [ "$actual" != "$hash" ]; then
      echo "Falha na verificacao de checksum: $path esta corrompido ou foi adulterado" >&2
      return 1
    fi
  done < "$MANIFEST"
}

write_receipt() {
  # write_receipt <bundle-estagiado> — receipt da instalacao em modo de teste.
  local staged="$1" dir timestamp version
  dir="$(dirname "$staged")"
  timestamp="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  version="$(tr -d '[:space:]' < "$DRIVER_DIR/VERSION")"
  printf '{"deviceName":"Ray Audio Driver","bundleId":"dev.ray.audio-driver","version":"%s","payload":"%s","installedAt":"%s"}\n' \
    "$version" "$staged" "$timestamp" > "$dir/ray-audio-driver-receipt.json"
}

# verificacao de checksum ANTES de qualquer outra etapa (SCOPE.md)
if [ ! -f "$MANIFEST" ]; then
  echo "Falha: manifesto SHA256SUMS ausente no instalador" >&2
  exit 1
fi
verify_payload "$PAYLOAD" || exit 1

if [ -n "$TEST_MODE" ]; then
  mkdir -p "$TEST_MODE"
  rm -rf "$TEST_MODE/$BUNDLE_NAME"
  if ! cp -R "$PAYLOAD" "$TEST_MODE/$BUNDLE_NAME"; then
    echo "Falha ao copiar o bundle para o diretorio de teste: $TEST_MODE" >&2
    exit 1
  fi
  write_receipt "$TEST_MODE/$BUNDLE_NAME"
  echo "Instalacao concluida em modo de teste: $TEST_MODE/$BUNDLE_NAME"
  exit 0
fi

# instalacao real: escalada com senha de administrador (dialogo nativo).
# Os caminhos usam aspas SIMPLES no shell: aspas duplas internas
# terminariam a string AppleScript antes da hora (syntax error -2740) e
# fariam o osascript falhar sem nem pedir a senha.
sh_quote() {
  printf "'%s'" "$(printf '%s' "$1" | sed "s/'/'\\\\''/g")"
}

privileged_command() {
  printf 'mkdir -p %s && rm -rf %s/%s && cp -R %s %s/%s && killall coreaudiod' \
    "$(sh_quote "$HAL_DIR")" "$(sh_quote "$HAL_DIR")" "$BUNDLE_NAME" \
    "$(sh_quote "$PAYLOAD")" "$(sh_quote "$HAL_DIR")" "$BUNDLE_NAME"
}

osa_error="$(osascript -e "do shell script \"$(privileged_command)\" with administrator privileges" 2>&1 >/dev/null)"
if [ $? -ne 0 ]; then
  case "$osa_error" in
    *"User canceled"*|*-128*)
      echo "Instalacao falhou: operacao cancelada pelo usuario" >&2
      ;;
    *)
      # Nunca descartar o erro real: senha invalida, usuario sem admin,
      # disco cheio etc. chegam aqui com a causa explicita.
      echo "Instalacao falhou: $osa_error" >&2
      ;;
  esac
  exit 1
fi
echo "Instalacao concluida: o Ray Audio Driver esta em $HAL_DIR/$BUNDLE_NAME"
