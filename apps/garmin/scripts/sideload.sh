#!/usr/bin/env bash
# Builds a test version for one device and copies it to the watch over USB (MTP)
# into GARMIN/APPS. Uses the MTP library that ships with OpenMTP.
# Usage: sideload.sh [device]   (default: ARNOLD_WATCH_DEVICE, else fr255)
set -euo pipefail
source "$(dirname "$0")/env.sh"

device="${1:-${ARNOLD_WATCH_DEVICE:-fr255}}"
out="$BIN_DIR/sideload/Arnold.prg"
compile "$device" "$out"
echo "ok  Build $device"
python3 -I "$APP_DIR/scripts/mtp.py" push "$out" /GARMIN/APPS
echo "Auf die Uhr kopiert. Uhr vom Kabel trennen; die App erscheint unter Aktivitäten und Apps."
