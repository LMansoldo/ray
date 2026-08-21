#!/usr/bin/env bash
# package.sh — embala o payload: gera o manifesto SHA256SUMS do bundle.
#
#   package.sh <bundle> <diretorio-de-saida>
#
# Escreve <diretorio-de-saida>/SHA256SUMS com uma linha "<sha256>  <caminho
# relativo ao bundle>" por arquivo (sha256 padrão do macOS shasum -a 256).
# Arquivos ocultos do Finder (.DS_Store) ficam fora do manifesto.
set -eu

usage() {
  echo "Uso: package.sh <bundle> <diretorio-de-saida>" >&2
}

[ $# -eq 2 ] || { usage; exit 2; }
BUNDLE="$1"
OUTDIR="$2"

if [ ! -d "$BUNDLE" ]; then
  echo "Falha: bundle nao encontrado: $BUNDLE" >&2
  exit 1
fi
mkdir -p "$OUTDIR"
tmp="$OUTDIR/SHA256SUMS.tmp"
rm -f "$tmp"

(
  cd "$BUNDLE"
  find . -type f -not -name '.DS_Store' | sort | while IFS= read -r file; do
    shasum -a 256 "${file#./}"
  done
) > "$tmp"

mv "$tmp" "$OUTDIR/SHA256SUMS"
