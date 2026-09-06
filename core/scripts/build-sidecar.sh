#!/bin/sh
# Monta o sidecar empacotável em core/resources/sidecar/:
#   dist/        (tsc build de sidecar/src)
#   prisma/      (sqlite_init.sql — DDL de primeira execução)
#   node_modules/ (runtime: @prisma/client + engine + langgraph)
#
# Também gera o launcher core/binaries/ray-sidecar-<triple> com o caminho
# do Node resolvido na máquina de build (fallbacks no próprio launcher).
# Reexecutar sempre que sidecar/src mudar.
set -e
REPO=$(cd "$(dirname "$0")/../.." && pwd)
SIDECAR="$REPO/sidecar"
DEST="$REPO/core/resources/sidecar"

echo "[build-sidecar] tsc build"
(cd "$SIDECAR" && ./node_modules/.bin/tsc)

echo "[build-sidecar] limpando $DEST"
rm -rf "$DEST"
mkdir -p "$DEST/prisma"

echo "[build-sidecar] copiando dist/prisma/node_modules"
cp -R "$SIDECAR/dist" "$DEST/dist"
cp "$SIDECAR/prisma/sqlite_init.sql" "$DEST/prisma/sqlite_init.sql"
# NAO copiar package.json: o tauri-cli o detectaria como frontend root e
# rodaria o beforeBuildCommand do lugar errado. O launcher importa o ESM
# diretamente (shim dinamico), sem depender de "type": "module".
cp -R "$SIDECAR/node_modules" "$DEST/node_modules"

echo "[build-sidecar] gerando launcher com node=$(command -v node)"
LAUNCHER="$REPO/core/binaries/ray-sidecar-aarch64-apple-darwin"
sed "s|@NODE_PATH@|$(command -v node)|" "$REPO/core/binaries/ray-sidecar-launcher.template" > "$LAUNCHER"
chmod +x "$LAUNCHER"

# Dev: copia o launcher para junto dos binarios de debug/release para que
# `cargo run` encontre o sidecar sem configurar RAY_SIDECAR_BIN.
for t in debug release; do
  TDIR="$REPO/core/target/$t"
  [ -d "$TDIR" ] && cp "$LAUNCHER" "$TDIR/ray-sidecar-aarch64-apple-darwin" && chmod +x "$TDIR/ray-sidecar-aarch64-apple-darwin"
done

echo "[build-sidecar] ok ($(du -sh "$DEST" | cut -f1))"
