#!/usr/bin/env bash
# Builds the unit tests and runs them in the Connect IQ simulator on each target device.
# Starts the simulator if it is not running.
# Usage: test.sh [device ...]   (default: all devices from manifest.xml)
set -euo pipefail
source "$(dirname "$0")/env.sh"

targets=("$@")
[[ ${#targets[@]} -eq 0 ]] && targets=("${DEVICES[@]}")

simulator_running() { pgrep -f 'ConnectIQ.app/Contents/MacOS/simulator' >/dev/null; }
if ! simulator_running; then
  open -g -a "$CIQ_SDK_HOME/bin/ConnectIQ.app"
  for _ in $(seq 1 30); do simulator_running && break; sleep 1; done
  simulator_running || { echo "Simulator startet nicht." >&2; exit 1; }
  sleep 3
fi

failed=0
for device in "${targets[@]}"; do
  prg="$BIN_DIR/test-$device.prg"
  compile "$device" "$prg" -t
  out=""
  for attempt in 1 2 3; do
    out="$("$MONKEYDO" "$prg" "$device" -t 2>&1 || true)"
    grep -qE '^(PASSED|FAILED) \(' <<<"$out" && break
    sleep 3
  done
  summary="$(grep -E '^(PASSED|FAILED) \(' <<<"$out" || true)"
  if [[ "$summary" == PASSED* ]]; then
    echo "ok  $device  $summary"
  else
    echo "$out" >&2
    echo "FEHLER  $device  ${summary:-keine Testergebnisse}" >&2
    failed=1
  fi
done
[[ $failed -eq 0 ]] || exit 1
echo "Tests erfolgreich: ${#targets[@]} Geräte"
