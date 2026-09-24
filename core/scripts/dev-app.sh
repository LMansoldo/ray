#!/bin/sh
# Dev bundle do Ray (macOS): monta um .app mínimo em volta do binário debug
# e o lança via `open`. Necessário por dois motivos:
#
# 1. TCC: SFSpeechRecognizer.requestAuthorization lê a usage description do
#    BUNDLE principal — binário desempacotado (o que `cargo tauri dev` roda)
#    leva ABORT do TCC, e nem a seção __TEXT,__info_plist embutida pelo
#    build.rs basta no macOS 26. E o lançamento PRECISA ser via `open`
#    (launchd): com zsh/exec como pai, o TCC atribui a permissão ao terminal
#    (cujo Info.plist não tem as chaves) e aborta do mesmo jeito.
# 2. Sidecar: o resolution procura ray-sidecar[-<triple>] ao lado do
#    executável; o bundle recebe symlinks para o build e para os resources.
#
# Uso: core/scripts/dev-app.sh   (substitui `cargo tauri dev` no macOS)
# O vite (devUrl :1420) sobe sozinho se a porta estiver livre. Logs do app:
# /tmp/ray-core-dev.log. Reconstruir o Rust: rode o script de novo.
set -euo pipefail
cd "$(dirname "$0")/.."

cargo build

APP="target/debug/ray-dev.app"
PLIST="$APP/Contents/Info.plist"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
cp Info.plist "$PLIST"

# Chaves de bundle que o tauri bundler injetaria no app empacotado.
# Assinatura pb <chave> <tipo> <valor> — $3 é o valor real (tipo é opcional
# para o PlistBuddy: sem ele, "string" viraria o PRÓPRIO valor gravado).
pb() {
  /usr/libexec/PlistBuddy -c "Add :$1 $2 $3" "$PLIST" 2>/dev/null ||
    /usr/libexec/PlistBuddy -c "Set :$1 $3" "$PLIST"
}
# ID distinto do app instalado: com o MESMO id (com.ray.app), o `open`
# apenas ATIVA o /Applications/ray.app já registrado/rodando em vez de
# lançar o dev bundle. O app_data_dir não muda — vem do identifier do
# tauri.conf compilado no binário, não deste plist.
pb CFBundleIdentifier string com.ray.dev
pb CFBundleName string Ray
pb CFBundleDisplayName string Ray
pb CFBundleExecutable string ray-core
pb CFBundleShortVersionString string 0.0.0
pb CFBundleVersion string 0.0.0

# Executável: CÓPIA (não symlink — o TCC/bundle resolve o caminho real).
cp target/debug/ray-core "$APP/Contents/MacOS/ray-core"

# Sidecar + resources por symlink: rebuilds são pegos sem remontar o bundle.
# O launcher procura os resources em ../Resources/sidecar (ver launcher).
ln -sfn "$PWD/target/debug/ray-sidecar-aarch64-apple-darwin" \
  "$APP/Contents/MacOS/ray-sidecar-aarch64-apple-darwin"
[ -f target/debug/ray-sidecar ] &&
  ln -sfn "$PWD/target/debug/ray-sidecar" "$APP/Contents/MacOS/ray-sidecar"
ln -sfn "$PWD/resources/sidecar" "$APP/Contents/Resources/sidecar"

# Assinatura com identidade ESTÁVEL: com ad-hoc (`-`) o cdhash muda a cada
# build e o TCC passa a tratar o app como outro — as permissões concedidas
# (mic/fala/tela) se perdem silenciosamente e a captura passa a devolver
# zeros sem erro. "Ray Local Dev" é um certificado autoassinado de Code
# Signing criado para dar identidade fixa ao TCC em dev (criação: ver
# docs ou recrie com openssl+security import). Sem o certificado, cai
# para ad-hoc como antes.
SIGN_ID=$(security find-identity -v -p codesigning 2>/dev/null |
  awk -F'"' '/Ray Local Dev/{print $2; exit}')
SIGN_ID=${SIGN_ID:--}
codesign --force --sign "$SIGN_ID" "$APP/Contents/MacOS/ray-core" >/dev/null 2>&1 || true
codesign --force --sign "$SIGN_ID" "$APP" >/dev/null 2>&1 || true

# Instância anterior do dev bundle disputaria o SQLite (mesmo app_data_dir).
pkill -f "ray-dev.app/Contents/MacOS/ray-core" 2>/dev/null || true

# O app instalado compartilha o mesmo banco — dois sidecars no mesmo SQLite
# é receita de comportamento estranho. Avisar (não matar o app do usuário).
if pgrep -f "/Applications/ray.app/Contents/MacOS/ray-core" >/dev/null 2>&1; then
  echo "[dev-app] AVISO: /Applications/ray.app está rodando — encerre-o para"
  echo "[dev-app] evitar dois sidecars no mesmo banco (compartilhado)."
fi

if ! lsof -iTCP:1420 -sTCP:LISTEN >/dev/null 2>&1; then
  echo "[dev-app] iniciando vite (log: /tmp/ray-vite-dev.log)"
  (cd ../apps/ui && nohup npm run dev > /tmp/ray-vite-dev.log 2>&1 &)
  n=0
  until lsof -iTCP:1420 -sTCP:LISTEN >/dev/null 2>&1; do
    n=$((n + 1))
    if [ "$n" -gt 40 ]; then
      echo "[dev-app] vite não subiu em 20s — seguindo assim mesmo"
      break
    fi
    sleep 0.5
  done
fi

# `open -n` = nova instância GARANTIDA do caminho especificado (sem ativar
# outro app registrado) e pelo launchd: o app é o próprio responsible
# process do TCC e o dialog de permissão funciona. Logs pipados para /tmp.
open -n --stdout /tmp/ray-core-dev.log --stderr /tmp/ray-core-dev.log "$PWD/$APP"
echo "[dev-app] app lançado — logs: tail -f /tmp/ray-core-dev.log"
