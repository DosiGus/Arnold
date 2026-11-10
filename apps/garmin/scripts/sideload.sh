#!/usr/bin/env bash
# Builds a test version for one device and copies it to the watch over USB (MTP)
# into GARMIN/APPS. Uses the MTP library that ships with OpenMTP.
# Usage: sideload.sh [--debug] [--build-only] [device]
# --debug uses the ignored DebugConfig.mc; ARNOLD_DEBUG_URL sets its temporary HTTPS URL.
# Default device: ARNOLD_WATCH_DEVICE, else fr255.
set -euo pipefail
source "$(dirname "$0")/env.sh"

debug_build=0
build_only=0
if [[ "${1:-}" == --debug ]]; then debug_build=1; shift; fi
if [[ "${1:-}" == --build-only ]]; then build_only=1; shift; fi
device="${1:-${ARNOLD_WATCH_DEVICE:-fr255}}"
out="$BIN_DIR/sideload/Arnold.prg"
if [[ "$debug_build" == 1 ]]; then
  if [[ -n "${ARNOLD_DEBUG_URL:-}" ]]; then
    python3 - "$APP_DIR/source/ui/DebugConfig.mc" "$ARNOLD_DEBUG_URL" <<'PYCFG'
import json, sys
from pathlib import Path
from urllib.parse import urlsplit
url = sys.argv[2].rstrip('/')
u = urlsplit(url)
if u.scheme != 'https' or not u.hostname or not u.hostname.endswith('.trycloudflare.com') or u.path or u.query or u.fragment or u.username or u.password:
    raise SystemExit('Debug requires a temporary HTTPS trycloudflare.com base URL')
Path(sys.argv[1]).write_text('import Toybox.Lang;\n(:garminGate) module DebugConfig { var URL as String = ' + json.dumps(url) + '; }\n')
PYCFG
  fi
  [[ -f "$APP_DIR/source/ui/DebugConfig.mc" ]] || { echo 'DebugConfig.mc fehlt: ARNOLD_DEBUG_URL setzen' >&2; exit 1; }
  mkdir -p "$(dirname "$out")"
  log="$BIN_DIR/debug-build-$device.log"
  "$MONKEYC" -f "$APP_DIR/debug.jungle" -d "$device" -o "$out" -y "$GARMIN_DEVELOPER_KEY" -l 3 -w 2>&1 | tee "$log"
  if rg -q WARNING "$log"; then exit 1; fi
else
  compile "$device" "$out"
fi
echo "ok  Build $device (debug=$debug_build)"
if [[ "$build_only" == 0 ]]; then
  python3 -I "$APP_DIR/scripts/mtp.py" push "$out" /GARMIN/APPS
  echo "Auf die Uhr kopiert. Uhr vom Kabel trennen; die App erscheint unter Aktivitäten und Apps."
fi
