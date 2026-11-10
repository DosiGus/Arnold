#!/usr/bin/env bash
# Builds the app for every target device with strict type checking. Any warning fails.
# Usage: build.sh [device ...]   (default: all devices from manifest.xml)
set -euo pipefail
source "$(dirname "$0")/env.sh"

targets=("$@")
[[ ${#targets[@]} -eq 0 ]] && targets=("${DEVICES[@]}")

bash "$(dirname "$0")/check-texts.sh"

for device in "${targets[@]}"; do
  compile "$device" "$BIN_DIR/$device.prg"
  echo "ok  $device"
done
echo "Build erfolgreich: ${#targets[@]} Geräte"
