#!/usr/bin/env bash
# Builds the unit tests and runs them in the Connect IQ simulator on each target device.
# Starts the simulator if it is not running.
# Usage: test.sh [device ...]   (default: all devices from manifest.xml)
# Languages: ARNOLD_SIM_LANGS="eng deu" (default, both); each device runs once per language.
# The simulator language is set with sim-language.sh and is back on English at the end.
set -euo pipefail
source "$(dirname "$0")/env.sh"

targets=("$@")
[[ ${#targets[@]} -eq 0 ]] && targets=("${DEVICES[@]}")

simulator_running() { pgrep -f 'ConnectIQ.app/Contents/MacOS/simulator' >/dev/null; }
start_simulator() {
  if ! simulator_running; then
    open -g -a "$CIQ_SDK_HOME/bin/ConnectIQ.app"
    for _ in $(seq 1 30); do simulator_running && break; sleep 1; done
    simulator_running || { echo "Simulator startet nicht." >&2; exit 1; }
    sleep 3
  fi
}
start_simulator

langs=(${ARNOLD_SIM_LANGS:-eng deu})
for lang in "${langs[@]}"; do
  [[ "$lang" == eng || "$lang" == deu ]] || { echo "Unbekannte Sprache '$lang' (eng oder deu)." >&2; exit 2; }
done

for device in "${targets[@]}"; do
  compile "$device" "$BIN_DIR/test-$device.prg" -t
done

reset_language() { bash "$(dirname "$0")/sim-language.sh" eng "$BIN_DIR/test-${targets[0]}.prg" "${targets[0]}" >/dev/null 2>&1 || true; }
trap reset_language EXIT

failed=0
runs=0
for lang in "${langs[@]}"; do
  bash "$(dirname "$0")/sim-language.sh" "$lang" "$BIN_DIR/test-${targets[0]}.prg" "${targets[0]}" >/dev/null \
    || { echo "FEHLER  Simulator-Sprache $lang nicht gesetzt" >&2; exit 1; }
  for device in "${targets[@]}"; do
    prg="$BIN_DIR/test-$device.prg"
    out=""
    for attempt in 1 2 3; do
      out="$("$MONKEYDO" "$prg" "$device" -t 2>&1 || true)"
      grep -qE '^(PASSED|FAILED) \(' <<<"$out" && break
      if grep -q 'Unable to connect to simulator' <<<"$out"; then
        # The simulator quit: start it again and set the language once more.
        start_simulator
        bash "$(dirname "$0")/sim-language.sh" "$lang" "$prg" "$device" >/dev/null 2>&1 || true
      fi
      sleep 3
    done
    summary="$(grep -E '^(PASSED|FAILED) \(' <<<"$out" || true)"
    runs=$((runs + 1))
    if [[ "$summary" == PASSED* ]]; then
      echo "ok  $device $lang  $summary"
    else
      echo "$out" >&2
      echo "FEHLER  $device $lang  ${summary:-keine Testergebnisse}" >&2
      failed=1
    fi
  done
done
[[ $failed -eq 0 ]] || exit 1
echo "Tests erfolgreich: ${#targets[@]} Geräte, ${#langs[@]} Sprachen, $runs Läufe"
