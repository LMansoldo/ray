#!/usr/bin/env bash
# =============================================================================
# verify-driver.sh — gate de CI do T-500 (Ray Audio Driver, macOS).
#
# Especificacao executavel do item T-500: cada criterio de aceitacao do item e
# uma checagem deste script. Uso:
#
#   driver/scripts/verify-driver.sh [--e2e]
#
#   sem --e2e : checagens estruturais + build + instalacao em modo de teste
#               (nao exige privilegio de administrador)
#   --e2e     : roda tambem as checagens privilegiadas (senha de administrador,
#               reinicio do coreaudiod, enumeracao real via system_profiler)
#   host nao-macOS : apenas checagens estruturais (degradacao prevista na
#                    estrategia de teste do item)
#
# Saida: exit 0 = todas as checagens passaram; exit 1 = ao menos uma falhou.
#
# Contratos pinados por este gate (o GREEN deve implementa-los, nao contorna-los):
#   - Dispositivo: nome "Ray Audio Driver" (mesmo nome fixado em core/src/audio.rs
#     pela T-306); bundle CFBundleIdentifier = dev.ray.audio-driver.
#   - Fontes: driver/ray-audio-driver/, plugin em Sources/RayAudioDriver/ e probe
#     em Sources/RayAudioProbe/; Info.plist fonte em driver/ray-audio-driver/Info.plist.
#   - Chaves do Info.plist: RayAudioDriverCaptureOnly (bool, true),
#     RayAudioDriverDeviceName ("Ray Audio Driver"),
#     RayAudioDriverVersion (= conteudo de driver/VERSION).
#   - Build: xcodebuild (RayAudioDriver.xcodeproj, scheme RayAudioDriver) quando
#     houver Xcode completo; caso contrario swift build (Package.swift).
#     Produtos em driver/ray-audio-driver/build ou driver/ray-audio-driver/.build.
#   - Instalador: install.sh [--test-mode <dir>] [--payload <bundle>] e
#     uninstall.sh [--test-mode <dir>]; payload real em
#     driver/installer/RayAudioDriver.driver; privilegio via osascript
#     "with administrator privileges" (RF-203: senha de administrador).
#   - Manifesto: installer/SHA256SUMS, uma linha "<sha256>  <caminho relativo ao
#     bundle>" por arquivo; verificado pelo install.sh ANTES do passo privilegiado.
#   - Embalagem: installer/package.sh <bundle> <dir-saida> regenera o SHA256SUMS.
#   - Modo de teste: instala o bundle em <dir>/RayAudioDriver.driver e escreve o
#     receipt <dir>/ray-audio-driver-receipt.json; sem privilegio.
#   - Probe: RayAudioProbe imprime em stdout uma linha JSON
#     {"deviceName":"Ray Audio Driver","inputStreams":N,"outputStreams":0};
#     --enumerate imprime {"devices":[{"name":...,"inputStreams":N,"outputStreams":M}]};
#     --capture <ms> imprime {"peak":P,"rms":R} do audio capturado no dispositivo.
# =============================================================================

set -u

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DRIVER_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
PLUGIN_DIR="$DRIVER_DIR/ray-audio-driver"
INSTALLER_DIR="$DRIVER_DIR/installer"
TAURI_CONF="$REPO_ROOT/core/tauri.conf.json"
DEVICE_NAME="Ray Audio Driver"
BUNDLE_ID="dev.ray.audio-driver"

IS_MACOS=0
[ "$(uname -s)" = "Darwin" ] && IS_MACOS=1

E2E=0
case "${1:-}" in
  "") ;;
  "--e2e") E2E=1 ;;
  *) echo "Uso: $0 [--e2e]" >&2; exit 2 ;;
esac

PASS_COUNT=0
FAIL_COUNT=0
SKIP_COUNT=0
FAILED_NAMES=""

STAGING="$(mktemp -d "${TMPDIR:-/tmp}/ray-driver-verify.XXXXXX")"
trap 'rm -rf "$STAGING"' EXIT

# -----------------------------------------------------------------------------
# Infra do gate
# -----------------------------------------------------------------------------

run_check() {
  # run_check <nome> <descricao> <funcao>
  # A funcao roda numa subshell com set -e: qualquer `|| fail "..."` encerra a
  # checagem com status 1 (sem set -e, o status do ultimo comando sobrescreveria
  # o da falha e a checagem passaria em falso).
  local name="$1" desc="$2" fn="$3" out rc
  out="$((set -e; $fn) 2>&1)"
  rc=$?
  if [ $rc -eq 0 ]; then
    PASS_COUNT=$((PASS_COUNT + 1))
    printf 'PASS %s — %s\n' "$name" "$desc"
  else
    FAIL_COUNT=$((FAIL_COUNT + 1))
    FAILED_NAMES="$FAILED_NAMES $name"
    printf 'FAIL %s — %s\n' "$name" "$desc"
    if [ -n "$out" ]; then
      printf '%s\n' "$out" | sed 's/^/       | /' | head -8
    fi
  fi
}

skip_check() {
  local name="$1" desc="$2" why="$3"
  SKIP_COUNT=$((SKIP_COUNT + 1))
  printf 'SKIP %s — %s (%s)\n' "$name" "$desc" "$why"
}

fail() {
  echo "$1" >&2
  return 1
}

# plist_get <arquivo> <chave> — valor bruto da chave; falha se a chave nao existir.
plist_get() {
  local file="$1" key="$2"
  if [ $IS_MACOS -eq 1 ] && command -v plutil >/dev/null 2>&1; then
    plutil -extract "$key" raw "$file" 2>/dev/null || return 1
  else
    # host nao-macOS: plist e XML; parse grosseiro o suficiente para o gate.
    awk -v k="$key" '
      $0 ~ "<key>" k "</key>" { want = 1; next }
      want == 1 && $0 ~ /<(true|false)\/>/ { print ($0 ~ /true/) ? "true" : "false"; exit }
      want == 1 && $0 ~ /<string>/ {
        s = $0
        sub(/^.*<string>/, "", s)
        sub(/<\/string>.*$/, "", s)
        print s
        exit
      }
    ' "$file" | grep -v '^$' || return 1
  fi
}

# arquivos de codigo sob driver/ (fora de artefatos de build)
code_files() {
  find "$DRIVER_DIR" -type f \
    \( -name '*.swift' -o -name '*.c' -o -name '*.h' -o -name '*.m' -o -name '*.sh' -o -name '*.plist' \) \
    -not -path '*/build/*' -not -path '*/.build/*' 2>/dev/null
}

# -----------------------------------------------------------------------------
# S01..S19 — checagens estruturais (rodam em qualquer plataforma)
# -----------------------------------------------------------------------------

s01_readme_existe() {
  [ -f "$DRIVER_DIR/README.md" ] || fail "driver/README.md nao existe"
}

s02_readme_documenta() {
  local f="$DRIVER_DIR/README.md"
  [ -f "$f" ] || fail "driver/README.md nao existe"
  grep -q 'Áudio Recebido' "$f" \
    || fail "README nao menciona 'Áudio Recebido' (fonte OUTROS, RF-203)"
  grep -q 'verify-driver.sh' "$f" \
    || fail "README nao documenta o passo de validacao (RF-204 pede validacao documentada)"
  grep -qE 'nunca|não deve' "$f" \
    || fail "README nao documenta a configuracao correta: captura, nunca saida (RF-204)"
}

s03_version_existe() {
  [ -f "$DRIVER_DIR/VERSION" ] || fail "driver/VERSION nao existe (versionamento proprio, ADR-009)"
}

s04_version_semver() {
  local v
  [ -f "$DRIVER_DIR/VERSION" ] || fail "driver/VERSION nao existe"
  v="$(tr -d '[:space:]' < "$DRIVER_DIR/VERSION")"
  printf '%s' "$v" | grep -qE '^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.+-]+)?$' \
    || fail "driver/VERSION nao parseia como semver: '$v'"
}

s05_infoplist_existe() {
  [ -f "$PLUGIN_DIR/Info.plist" ] \
    || fail "driver/ray-audio-driver/Info.plist nao existe (layout do bundle)"
}

s06_capture_only() {
  local v
  v="$(plist_get "$PLUGIN_DIR/Info.plist" RayAudioDriverCaptureOnly)" \
    || fail "Info.plist nao contem a chave RayAudioDriverCaptureOnly"
  [ "$v" = "true" ] \
    || fail "Info.plist nao declara RayAudioDriverCaptureOnly=true (RF-204: nenhuma stream de saida)"
}

s07_versao_do_bundle() {
  local v
  v="$(plist_get "$PLUGIN_DIR/Info.plist" RayAudioDriverVersion)" \
    || fail "Info.plist nao contem a chave RayAudioDriverVersion"
  [ "$v" = "$(tr -d '[:space:]' < "$DRIVER_DIR/VERSION")" ] \
    || fail "RayAudioDriverVersion do Info.plist ('$v') difere de driver/VERSION"
}

s08_nome_do_dispositivo() {
  local v
  v="$(plist_get "$PLUGIN_DIR/Info.plist" RayAudioDriverDeviceName)" \
    || fail "Info.plist nao contem a chave RayAudioDriverDeviceName"
  [ "$v" = "$DEVICE_NAME" ] \
    || fail "nome do dispositivo ('$v') difere de '$DEVICE_NAME' (contrato da T-306 em core/src/audio.rs)"
}

s09_bundle_identifier() {
  local v
  v="$(plist_get "$PLUGIN_DIR/Info.plist" CFBundleIdentifier)" \
    || fail "Info.plist nao contem a chave CFBundleIdentifier"
  [ "$v" = "$BUNDLE_ID" ] \
    || fail "CFBundleIdentifier ('$v') difere de '$BUNDLE_ID'"
}

s10_layout_de_fontes() {
  [ -d "$PLUGIN_DIR/Sources/RayAudioDriver" ] \
    || fail "fontes do plugin ausentes: $PLUGIN_DIR/Sources/RayAudioDriver/"
  [ -d "$PLUGIN_DIR/Sources/RayAudioProbe" ] \
    || fail "fontes do probe ausentes: $PLUGIN_DIR/Sources/RayAudioProbe/"
}

s11_instalador_existe() {
  [ -f "$INSTALLER_DIR/install.sh" ] || fail "installer/install.sh nao existe"
  [ -f "$INSTALLER_DIR/uninstall.sh" ] || fail "installer/uninstall.sh nao existe"
  [ -f "$INSTALLER_DIR/SHA256SUMS" ] || fail "installer/SHA256SUMS nao existe"
}

s12_manifesto_valido() {
  local m="$INSTALLER_DIR/SHA256SUMS"
  [ -f "$m" ] || fail "installer/SHA256SUMS nao existe"
  awk 'NF >= 2 && $1 ~ /^[0-9a-f]{64}$/ { ok++ } END { exit (ok == NR) ? 0 : 1 }' "$m" \
    || fail "SHA256SUMS tem linhas malformadas (esperado: '<sha256>  <caminho>')"
  grep -qE '^[0-9a-f]{64}  Contents/MacOS/RayAudioDriver$' "$m" \
    || fail "SHA256SUMS nao cobre o executavel do plugin (Contents/MacOS/RayAudioDriver)"
  grep -qE '^[0-9a-f]{64}  Contents/Info.plist$' "$m" \
    || fail "SHA256SUMS nao cobre Contents/Info.plist"
}

s13_checksum_antes_de_privilegio() {
  local f="$INSTALLER_DIR/install.sh" cs priv
  [ -f "$f" ] || fail "installer/install.sh nao existe"
  cs="$(grep -nE 'shasum|openssl dgst|SHA256SUMS|verific' "$f" | head -1 | cut -d: -f1)"
  priv="$(grep -nE 'with administrator privileges' "$f" | head -1 | cut -d: -f1)"
  [ -n "$cs" ] || fail "install.sh nao contem logica de verificacao de checksum"
  [ -n "$priv" ] || fail "install.sh nao contem escalada privilegiada (osascript)"
  [ "$cs" -lt "$priv" ] \
    || fail "install.sh escalona privilegio (linha $priv) antes de verificar o checksum (linha $cs) — superficie de ataque (SCOPE.md)"
}

s14_privilegio_de_administrador() {
  grep -q 'with administrator privileges' "$INSTALLER_DIR/install.sh" \
    || fail "install.sh nao usa fluxo de senha de administrador (RF-203/RID-5)"
  grep -q 'with administrator privileges' "$INSTALLER_DIR/uninstall.sh" \
    || fail "uninstall.sh nao usa fluxo de senha de administrador (RF-203/RID-5)"
}

s15_sem_rede() {
  local files
  files="$(find "$INSTALLER_DIR" "$PLUGIN_DIR" -type f \
    \( -name '*.swift' -o -name '*.c' -o -name '*.h' -o -name '*.m' -o -name '*.sh' -o -name '*.plist' \) \
    -not -path '*/build/*' -not -path '*/.build/*' 2>/dev/null)"
  [ -n "$files" ] || fail "nenhum arquivo de codigo para auditar em driver/"
  if printf '%s\n' "$files" | xargs grep -nE 'URLSession|NSURLConnection|CFNetwork|NWConnection|NWEndpoint|getaddrinfo|socket\(|sendto\(|recvfrom\(|curl|wget' 2>/dev/null | grep -q .; then
    fail "processo privilegiado com acesso de rede — proibido (SCOPE.md: minimizar superficie de ataque)"
  fi
}

s16_parsing_minimo() {
  local dir="$PLUGIN_DIR/Sources/RayAudioDriver"
  [ -d "$dir" ] || fail "fontes do plugin ausentes: $dir"
  if grep -rnE 'CommandLine\.arguments|ProcessInfo\.processInfo\.environment|getenv|argv|argc' "$dir" 2>/dev/null | grep -q .; then
    fail "plugin faz parsing de argumentos/ambiente — proibido (SCOPE.md: parsing minimo no processo privilegiado)"
  fi
}

# Marcadores positivos (PT-BR) e negativos (ingles de UI) para a checagem de i18n.
PT_RE='privil|senha|administrador|instala|desinstala|remov|audio|udio|verifica|corromp|invalido|invalida|sucesso|conclui|falha|falhou|teste|modo|requer|necess|reinici|pasta|diretorio|arquivo|local|destino|nao\b|cancelad|executad|digit|incorret|insira|digite|sera|foi|ja\b'
EN_RE='install|uninstall|error|failed|failure|success|password|abort|warning|usage|done|starting|finished|removing|removed|cancel|denied|not found|missing|wrong|incorrect|retry'

string_ok_pt() {
  # string_ok_pt <texto> — 0 se o texto for PT-BR (ou token tecnico), 1 caso contrario.
  local s="$1" lowered
  lowered="$(printf '%s' "$s" | tr '[:upper:]' '[:lower:]')"
  printf '%s' "$lowered" | grep -qE "$PT_RE" && return 0
  printf '%s' "$lowered" | grep -q '[a-zA-Z]' || return 0
  printf '%s' "$lowered" | grep -qE "$EN_RE" && return 1
  return 0
}

s17_strings_pt_br() {
  local f str bad=0
  for f in "$INSTALLER_DIR/install.sh" "$INSTALLER_DIR/uninstall.sh"; do
    [ -f "$f" ] || fail "script de instalador ausente: $f"
    # strings de mensagens via echo/printf e prompts de osascript
    {
      grep -hoE '(echo|printf) "[^"]+"' "$f" 2>/dev/null | sed -E 's/^(echo|printf) "//; s/"$//'
      grep -h 'osascript' "$f" 2>/dev/null | grep -oE "'[^']*'" | tr -d "'"
    } | while IFS= read -r str; do
      if [ -n "$str" ] && ! string_ok_pt "$str"; then
        echo "string de UI nao e PT-BR: '$str'" >&2
        exit 1
      fi
    done || return 1
  done
  return 0
}

s18_sem_emojis() {
  local files
  files="$(find "$DRIVER_DIR" -type f \
    \( -name '*.swift' -o -name '*.c' -o -name '*.h' -o -name '*.m' -o -name '*.sh' -o -name '*.md' -o -name '*.plist' -o -name 'VERSION' -o -name 'SHA256SUMS' \) \
    -not -path '*/build/*' -not -path '*/.build/*' 2>/dev/null)"
  [ -n "$files" ] || fail "nenhum arquivo para varrer em busca de emojis"
  if printf '%s\n' "$files" | while IFS= read -r f; do
      perl -CSD -ne 'print "$ARGV:$.:$_" if /[\x{1F000}-\x{1FAFF}\x{FE0F}]/' "$f"
    done | grep -q .; then
    fail "emoji encontrado em codigo/comentario (proibido por .claude/rules/general.md)"
  fi
}

s19_versao_independente() {
  # ADR-009: o driver nao e empacotado nem atualizado pelo app.
  [ -f "$TAURI_CONF" ] || fail "core/tauri.conf.json nao encontrado"
  if grep -qE 'driver/|RayAudioDriver|driver/VERSION' "$TAURI_CONF"; then
    fail "tauri.conf.json referencia o driver (externalBin/updater) — viola ADR-009"
  fi
  if grep -rn 'driver/VERSION' "$REPO_ROOT/core/src" "$REPO_ROOT/apps" "$REPO_ROOT/sidecar/src" "$REPO_ROOT/contracts" \
      --include='*.rs' --include='*.ts' --include='*.svelte' --include='*.json' \
      --exclude-dir=target --exclude-dir=node_modules 2>/dev/null | grep -q .; then
    fail "codigo fora de driver/ le driver/VERSION — a versao do driver nao pode ser consumida pelo auto-update do app (ADR-009)"
  fi
}

# -----------------------------------------------------------------------------
# R01..R08 — checagens de runtime no macOS (sem privilegio)
# -----------------------------------------------------------------------------

r01_build() {
  if [ -d "$PLUGIN_DIR/RayAudioDriver.xcodeproj" ] && xcodebuild -version >/dev/null 2>&1; then
    xcodebuild -project "$PLUGIN_DIR/RayAudioDriver.xcodeproj" -scheme RayAudioDriver \
      -configuration Release -derivedDataPath "$PLUGIN_DIR/build" build >/dev/null \
      || fail "xcodebuild falhou (veja o log do xcodebuild)"
  elif [ -f "$PLUGIN_DIR/Package.swift" ]; then
    swift build --package-path "$PLUGIN_DIR" -c release >/dev/null \
      || fail "swift build falhou (veja o log do swift)"
  else
    fail "nenhum projeto compilavel em driver/ray-audio-driver/ (RayAudioDriver.xcodeproj com Xcode completo, ou Package.swift)"
  fi
}

BUNDLE=""
PROBE=""

# resolve_products — roda no shell pai (nao via run_check), porque BUNDLE e PROBE
# precisam sobreviver para as checagens seguintes (subshells herdam, mas nao
# propagam, atribuicoes).
resolve_products() {
  BUNDLE="$(find "$PLUGIN_DIR/build" "$PLUGIN_DIR/.build" -type d -name 'RayAudioDriver.driver' 2>/dev/null | head -1)"
  PROBE="$(find "$PLUGIN_DIR/build" "$PLUGIN_DIR/.build" -type f -name 'RayAudioProbe' -perm -111 2>/dev/null | head -1)"
}

r02_produtos_do_build() {
  [ -n "$BUNDLE" ] || fail "bundle RayAudioDriver.driver nao encontrado em driver/ray-audio-driver/build (ou .build)"
  [ -n "$PROBE" ] || fail "executavel RayAudioProbe nao encontrado em driver/ray-audio-driver/build (ou .build)"
}

r03_probe_capture_only() {
  local out inputs outputs
  [ -n "$PROBE" ] || fail "RayAudioProbe nao construido (r02)"
  out="$("$PROBE" 2>/dev/null)"
  printf '%s' "$out" | grep -q "\"deviceName\":\"$DEVICE_NAME\"" \
    || fail "probe nao reporta deviceName '$DEVICE_NAME': $out"
  inputs="$(printf '%s' "$out" | grep -oE '"inputStreams":[0-9]+' | head -1 | cut -d: -f2)"
  [ -n "$inputs" ] || fail "probe nao reporta inputStreams: $out"
  [ "$inputs" -ge 1 ] || fail "dispositivo sem stream de captura (inputStreams=$inputs)"
  outputs="$(printf '%s' "$out" | grep -oE '"outputStreams":[0-9]+' | head -1 | cut -d: -f2)"
  [ "$outputs" = "0" ] \
    || fail "dispositivo registra stream de saida (outputStreams=$outputs) — viola RF-204"
}

r04_manifesto_sincronizado() {
  local m="$INSTALLER_DIR/SHA256SUMS" outdir
  [ -n "$BUNDLE" ] || fail "bundle nao construido (r02)"
  [ -x "$INSTALLER_DIR/package.sh" ] || fail "installer/package.sh ausente ou nao executavel"
  outdir="$STAGING/manifest"
  mkdir -p "$outdir"
  "$INSTALLER_DIR/package.sh" "$BUNDLE" "$outdir" >/dev/null \
    || fail "package.sh falhou ao gerar o manifesto"
  [ -f "$outdir/SHA256SUMS" ] || fail "package.sh nao gerou SHA256SUMS"
  cmp -s "$outdir/SHA256SUMS" "$m" \
    || fail "installer/SHA256SUMS esta fora de sincronia com o payload construido — regenere via package.sh e commite"
}

r05_payload_corrompido_rejeitado() {
  local m="$INSTALLER_DIR/SHA256SUMS" tampered entry staging_dir rc
  [ -n "$BUNDLE" ] || fail "bundle nao construido (r02)"
  [ -f "$m" ] || fail "installer/SHA256SUMS nao existe"
  entry="$(grep -E '^[0-9a-f]{64}  ' "$m" | head -1 | cut -d' ' -f3-)"
  [ -n "$entry" ] || fail "SHA256SUMS vazio"
  tampered="$STAGING/tampered.driver"
  cp -R "$BUNDLE" "$tampered"
  printf 'X' >> "$tampered/$entry"
  staging_dir="$STAGING/install-tampered"
  mkdir -p "$staging_dir"
  rc=0
  "$INSTALLER_DIR/install.sh" --test-mode "$staging_dir" --payload "$tampered" \
    >"$STAGING/tampered.out" 2>&1 || rc=$?
  [ $rc -ne 0 ] \
    || fail "install.sh aceitou payload corrompido (exit 0) — checksum nao aplicado"
  grep -qiE 'checksum|verifica|soma|integridade|corromp' "$STAGING/tampered.out" \
    || fail "install.sh rejeitou o payload, mas sem mensagem de checksum: $(head -1 "$STAGING/tampered.out")"
  [ ! -e "$staging_dir/ray-audio-driver-receipt.json" ] \
    || fail "install.sh escreveu receipt para payload corrompido"
}

r06_instala_modo_teste() {
  local staging_dir="$STAGING/install-clean" staged
  [ -n "$BUNDLE" ] || fail "bundle nao construido (r02)"
  mkdir -p "$staging_dir"
  "$INSTALLER_DIR/install.sh" --test-mode "$staging_dir" --payload "$BUNDLE" >/dev/null \
    || fail "install.sh --test-mode falhou"
  [ -f "$staging_dir/ray-audio-driver-receipt.json" ] \
    || fail "install.sh --test-mode nao escreveu ray-audio-driver-receipt.json"
  staged="$staging_dir/RayAudioDriver.driver"
  [ -d "$staged" ] || fail "bundle nao foi estagiado em $staged"
  [ "$(plist_get "$staged/Contents/Info.plist" RayAudioDriverCaptureOnly)" = "true" ] \
    || fail "bundle estagiado perdeu a declaracao RayAudioDriverCaptureOnly (RF-204)"
}

r07_desinstala_modo_teste() {
  local staging_dir="$STAGING/install-clean"
  [ -f "$staging_dir/ray-audio-driver-receipt.json" ] \
    || fail "sem receipt previo (r06 nao concluiu)"
  "$INSTALLER_DIR/uninstall.sh" --test-mode "$staging_dir" >/dev/null \
    || fail "uninstall.sh --test-mode falhou"
  [ ! -e "$staging_dir/ray-audio-driver-receipt.json" ] \
    || fail "uninstall.sh --test-mode nao removeu o receipt"
  [ ! -e "$staging_dir/RayAudioDriver.driver" ] \
    || fail "uninstall.sh --test-mode nao removeu o bundle estagiado"
}

r08_reinstala_modo_teste() {
  local staging_dir="$STAGING/install-clean"
  [ -n "$BUNDLE" ] || fail "bundle nao construido (r02)"
  mkdir -p "$staging_dir"
  "$INSTALLER_DIR/install.sh" --test-mode "$staging_dir" --payload "$BUNDLE" >/dev/null \
    || fail "reinstalacao apos desinstalacao falhou (RID-5: round-trip)"
  [ -f "$staging_dir/ray-audio-driver-receipt.json" ] \
    || fail "reinstalacao nao escreveu receipt (RID-5)"
}

# -----------------------------------------------------------------------------
# E01..E07 — checagens privilegiadas (somente --e2e no macOS)
# -----------------------------------------------------------------------------

e01_payload_real() {
  [ -d "$INSTALLER_DIR/RayAudioDriver.driver" ] \
    || fail "payload real ausente: installer/RayAudioDriver.driver (embale o build antes do e2e)"
}

e02_instala_real() {
  "$INSTALLER_DIR/install.sh" >/dev/null \
    || fail "instalacao privilegiada falhou (senha de administrador negada ou erro de instalacao)"
}

e03_dispositivo_visivel() {
  local json
  command -v python3 >/dev/null 2>&1 || fail "python3 necessario para o e2e"
  json="$(system_profiler SPAudioDataType -json 2>/dev/null)"
  printf '%s' "$json" | grep -q "\"_name\" : \"$DEVICE_NAME\"\|\"_name\": \"$DEVICE_NAME\"" \
    || fail "dispositivo '$DEVICE_NAME' nao aparece em system_profiler SPAudioDataType"
  printf '%s' "$json" | python3 -c '
import json, sys
name = "Ray Audio Driver"
data = json.load(sys.stdin)
devices = data["SPAudioDataType"]
found = [d for d in devices if d.get("_name") == name]
if len(found) != 1:
    raise SystemExit(f"esperado 1 dispositivo {name}, encontrados {len(found)}")
d = found[0]
if "coreaudio_device_input" not in d:
    raise SystemExit("dispositivo sem stream de captura (coreaudio_device_input)")
if "coreaudio_device_output" in d:
    raise SystemExit("dispositivo com stream de saida (coreaudio_device_output) — viola RF-204")
' || fail "shape do dispositivo em system_profiler viola RF-204 (ver mensagem acima)"
}

e04_enumeracao_capture_only() {
  local out
  [ -n "$PROBE" ] || fail "RayAudioProbe nao construido (r02)"
  command -v python3 >/dev/null 2>&1 || fail "python3 necessario para o e2e"
  out="$("$PROBE" --enumerate 2>/dev/null)"
  printf '%s' "$out" | python3 -c '
import json, sys
data = json.load(sys.stdin)
devs = [d for d in data.get("devices", []) if d.get("name") == "Ray Audio Driver"]
if len(devs) != 1:
    raise SystemExit(f"esperado 1 dispositivo Ray Audio Driver na enumeracao CoreAudio, encontrados {len(devs)}")
d = devs[0]
if d.get("inputStreams", 0) < 1:
    raise SystemExit("dispositivo sem stream de captura na enumeracao CoreAudio")
if d.get("outputStreams", 0) != 0:
    raise SystemExit("dispositivo com stream de saida na enumeracao CoreAudio — viola RF-204")
' || fail "enumeracao CoreAudio viola o contrato capture-only (ver mensagem acima)"
}

e05_audio_flui() {
  local out cap_pid rc
  [ -n "$PROBE" ] || fail "RayAudioProbe nao construido (r02)"
  command -v python3 >/dev/null 2>&1 || fail "python3 necessario para o e2e"
  command -v afplay >/dev/null 2>&1 || fail "afplay necessario para o teste de audio"
  "$PROBE" --capture 4000 > "$STAGING/capture.json" 2>/dev/null &
  cap_pid=$!
  sleep 0.5
  afplay /System/Library/Sounds/Glass.aiff >/dev/null 2>&1 \
    || fail "afplay falhou ao tocar o som de teste"
  rc=0
  wait $cap_pid || rc=$?
  [ $rc -eq 0 ] || fail "probe --capture falhou (exit $rc)"
  python3 -c '
import json
with open(sys.argv[1]) as f:
    data = json.load(f)
peak = float(data.get("peak", 0.0))
if peak <= 0.005:
    raise SystemExit(f"audio da reuniao nao chegou ao dispositivo (peak={peak}) — o driver nao esta capturando a saida do sistema (CA-5)")
print(f"peak={peak:.4f} — audio flui do sistema para o dispositivo")
' "$STAGING/capture.json" || fail "captura do dispositivo nao recebeu audio do sistema (CA-5)"
}

e06_desinstala_real() {
  "$INSTALLER_DIR/uninstall.sh" >/dev/null \
    || fail "desinstalacao privilegiada falhou"
  sleep 2
  if system_profiler SPAudioDataType 2>/dev/null | grep -q "$DEVICE_NAME"; then
    fail "dispositivo ainda visivel apos desinstalacao (RID-5)"
  fi
}

e07_reinstala_real() {
  "$INSTALLER_DIR/install.sh" >/dev/null \
    || fail "reinstalacao privilegiada falhou (RID-5: round-trip)"
  sleep 2
  system_profiler SPAudioDataType 2>/dev/null | grep -q "$DEVICE_NAME" \
    || fail "dispositivo nao voltou apos reinstalacao (RID-5)"
}

# -----------------------------------------------------------------------------
# Execucao
# -----------------------------------------------------------------------------

echo "== verify-driver.sh — gate T-500 (Ray Audio Driver) =="
echo "== driver: $DRIVER_DIR"
echo "== host: $(uname -s) | macOS=$IS_MACOS | e2e=$E2E"

run_check S01 "driver/README.md existe" s01_readme_existe
run_check S02 "README documenta configuracao correta e passo de validacao (RF-204)" s02_readme_documenta
run_check S03 "driver/VERSION existe (versionamento proprio, ADR-009)" s03_version_existe
run_check S04 "driver/VERSION parseia como semver" s04_version_semver
run_check S05 "Info.plist do plugin existe" s05_infoplist_existe
run_check S06 "plugin declara captura-only (RF-204: nenhuma stream de saida)" s06_capture_only
run_check S07 "versao do bundle bate com driver/VERSION" s07_versao_do_bundle
run_check S08 "nome do dispositivo 'Ray Audio Driver' (contrato T-306)" s08_nome_do_dispositivo
run_check S09 "CFBundleIdentifier = dev.ray.audio-driver" s09_bundle_identifier
run_check S10 "layout de fontes do plugin e do probe" s10_layout_de_fontes
run_check S11 "install.sh, uninstall.sh e SHA256SUMS existem" s11_instalador_existe
run_check S12 "SHA256SUMS bem formado e cobre o payload" s12_manifesto_valido
run_check S13 "checksum verificado antes do passo privilegiado (SCOPE.md)" s13_checksum_antes_de_privilegio
run_check S14 "fluxo privilegiado via senha de administrador (RF-203/RID-5)" s14_privilegio_de_administrador
run_check S15 "nenhum acesso de rede no driver (SCOPE.md)" s15_sem_rede
run_check S16 "plugin sem parsing de argv/ambiente (SCOPE.md)" s16_parsing_minimo
run_check S17 "strings do instalador em PT-BR (SCOPE.md i18n)" s17_strings_pt_br
run_check S18 "sem emojis em codigo/comentarios (general.md)" s18_sem_emojis
run_check S19 "versao do driver independente do app (ADR-009)" s19_versao_independente

if [ $IS_MACOS -eq 1 ]; then
  resolve_products
  run_check R01 "build do plugin compila (xcodebuild ou swift build)" r01_build
  run_check R02 "produtos do build existem (.driver + probe)" r02_produtos_do_build
  run_check R03 "probe reporta device capture-only (RF-204)" r03_probe_capture_only
  run_check R04 "SHA256SUMS sincronizado com o payload construido" r04_manifesto_sincronizado
  run_check R05 "payload corrompido e rejeitado antes de qualquer instalacao" r05_payload_corrompido_rejeitado
  run_check R06 "instalacao em modo de teste funciona" r06_instala_modo_teste
  run_check R07 "desinstalacao em modo de teste funciona" r07_desinstala_modo_teste
  run_check R08 "reinstalacao apos desinstalacao funciona (RID-5)" r08_reinstala_modo_teste

  if [ $E2E -eq 1 ]; then
    run_check E01 "payload real presente em installer/" e01_payload_real
    run_check E02 "instalacao privilegiada (senha de administrador)" e02_instala_real
    run_check E03 "dispositivo visivel em system_profiler, so captura (RF-204)" e03_dispositivo_visivel
    run_check E04 "enumeracao CoreAudio: so stream de captura (RF-204)" e04_enumeracao_capture_only
    run_check E05 "audio do sistema flui para o dispositivo (CA-5)" e05_audio_flui
    run_check E06 "desinstalacao privilegiada remove o dispositivo" e06_desinstala_real
    run_check E07 "reinstalacao privilegiada devolve o dispositivo (RID-5)" e07_reinstala_real
  else
    skip_check E01..E07 "checagens privilegiadas (system_profiler, coreaudiod, senha de admin)" "rode com --e2e"
  fi
else
  skip_check R01..R08 "build e modo de teste do instalador" "host nao-macOS: degradacao para checagens estruturais"
  skip_check E01..E07 "checagens privilegiadas" "host nao-macOS"
fi

echo ""
echo "== Resumo: $PASS_COUNT passaram, $FAIL_COUNT falharam, $SKIP_COUNT ignoradas"
if [ $FAIL_COUNT -gt 0 ]; then
  echo "== Falharam:$FAILED_NAMES"
  exit 1
fi
exit 0
