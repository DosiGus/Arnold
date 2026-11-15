#!/usr/bin/env bash
# Sets the language of the running Connect IQ simulator (Settings > Language) and checks the result.
# Usage: sim-language.sh eng|deu [<app.prg> <device>]
# The simulator lists its languages only while an app is loaded. Pass a built .prg and its device
# (test.sh does); without them the script loads the newest bin/*.prg for the first manifest device.
# Needs: System Events access for the calling terminal (macOS Privacy > Accessibility).
set -euo pipefail
source "$(dirname "$0")/env.sh"

lang="${1:-}"
case "$lang" in
  eng) label="English (eng)" ;;
  deu) label="German (deu)" ;;
  *) echo "Usage: sim-language.sh eng|deu [<app.prg> <device>]" >&2; exit 2 ;;
esac

prg="${2:-}"
device="${3:-}"
if [[ -z "$prg" ]]; then
  prg="$(ls -t "$BIN_DIR"/*.prg 2>/dev/null | head -1 || true)"
  device="${DEVICES[0]}"
  [[ -n "$prg" ]] || { echo "Kein .prg in $BIN_DIR; zuerst build.sh oder test.sh laufen lassen." >&2; exit 1; }
fi

pgrep -f 'ConnectIQ.app/Contents/MacOS/simulator' >/dev/null || {
  open -g -a "$CIQ_SDK_HOME/bin/ConnectIQ.app"
  sleep 8
}

"$MONKEYDO" "$prg" "$device" >/dev/null 2>&1 &
loader=$!
trap 'kill "$loader" 2>/dev/null || true' EXIT
sleep 6

osascript -e 'tell application "System Events" to set frontmost of process "simulator" to true' >/dev/null
sleep 0.6

# Click the entry, then read back which entry carries the check mark.
set_lang() {
  osascript <<EOF
tell application "System Events" to tell process "simulator"
  click menu item "$label" of menu 1 of menu item "Language" of menu 1 of menu bar item "Settings" of menu bar 1
end tell
EOF
}

checked() {
  osascript <<'EOF'
tell application "System Events" to tell process "simulator"
  set m to menu 1 of menu item "Language" of menu 1 of menu bar item "Settings" of menu bar 1
  repeat with i in (every menu item of m)
    if (value of attribute "AXMenuItemMarkChar" of i) is "✓" then return name of i as text
  end repeat
  return "none"
end tell
EOF
}

if [[ "$(checked)" != "$label" ]]; then
  set_lang
  sleep 1
fi
now="$(checked)"
if [[ "$now" != "$label" ]]; then
  echo "Simulator-Sprache nicht gesetzt: erwartet \"$label\", steht auf \"$now\"." >&2
  exit 1
fi
echo "Simulator-Sprache: $now"
