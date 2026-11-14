#!/usr/bin/env bash
# End-to-end check of the run upload (RUN-018): the simulator builds the requests of three runs (base, intervals,
# treadmill) in a unit test and prints them; the mock server takes them with the schema of the real server.
# Usage: run-e2e.sh [device]   (default fr255)
set -euo pipefail
source "$(dirname "$0")/env.sh"
device="${1:-fr255}"
repo="$(cd "$APP_DIR/../.." && pwd)"
log="$BIN_DIR/e2e-$device.log"

simulator_running() { pgrep -f 'ConnectIQ.app/Contents/MacOS/simulator' >/dev/null; }
if ! simulator_running; then
  open -g -a "$CIQ_SDK_HOME/bin/ConnectIQ.app"
  for _ in $(seq 1 30); do simulator_running && break; sleep 1; done
  sleep 3
fi
prg="$BIN_DIR/test-$device.prg"
compile "$device" "$prg" -t
for attempt in 1 2 3; do
  "$MONKEYDO" "$prg" "$device" -t >"$log" 2>&1 || true
  grep -q 'RUNPAYLOAD laufband-ohne-hr' "$log" && break
  sleep 3
done
cd "$repo"
MOCK_PORT="${MOCK_PORT:-8835}" npx tsx apps/garmin/scripts/mock-server.ts --run-e2e "$log"
