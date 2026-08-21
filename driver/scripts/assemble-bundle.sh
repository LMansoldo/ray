#!/usr/bin/env bash
# assemble-bundle.sh — compila o plugin e o probe e monta o bundle .driver.
#
# Fluxo de empacotamento do T-500: swift build -> bundle RayAudioDriver.driver
# em driver/ray-audio-driver/build/ -> payload do instalador -> SHA256SUMS
# regerado via package.sh. Rode este script apos qualquer mudanca de codigo do
# driver e commite os artefatos (o gate verify-driver.sh confere a sincronia
# do manifesto com o payload).
set -eu

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DRIVER_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
PLUGIN_DIR="$DRIVER_DIR/ray-audio-driver"
INSTALLER_DIR="$DRIVER_DIR/installer"
BUNDLE="$PLUGIN_DIR/build/RayAudioDriver.driver"

swift build --package-path "$PLUGIN_DIR" -c release

rm -rf "$BUNDLE"
mkdir -p "$BUNDLE/Contents/MacOS"
cp "$PLUGIN_DIR/.build/release/libRayAudioDriver.dylib" "$BUNDLE/Contents/MacOS/RayAudioDriver"
cp "$PLUGIN_DIR/Info.plist" "$BUNDLE/Contents/Info.plist"
cp "$PLUGIN_DIR/.build/release/RayAudioProbe" "$PLUGIN_DIR/build/RayAudioProbe"
chmod 755 "$BUNDLE/Contents/MacOS/RayAudioDriver" "$PLUGIN_DIR/build/RayAudioProbe"

rm -rf "$INSTALLER_DIR/RayAudioDriver.driver"
cp -R "$BUNDLE" "$INSTALLER_DIR/RayAudioDriver.driver"
"$INSTALLER_DIR/package.sh" "$BUNDLE" "$INSTALLER_DIR"

echo "Bundle RayAudioDriver.driver montado e manifesto SHA256SUMS atualizado"
