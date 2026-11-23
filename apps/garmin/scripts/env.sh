# Shared setup for the Garmin scripts. Source it, do not run it.
# Needs: GARMIN_DEVELOPER_KEY (path to the PKCS8 DER key, kept outside the repo).
# Optional: CIQ_SDK_HOME (defaults to the SDK chosen in the Connect IQ SDK Manager).

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BIN_DIR="$APP_DIR/bin"

if [[ -z "${CIQ_SDK_HOME:-}" ]]; then
  cfg="$HOME/Library/Application Support/Garmin/ConnectIQ/current-sdk.cfg"
  if [[ ! -f "$cfg" ]]; then
    echo "Kein Connect IQ SDK gefunden. SDK Manager öffnen oder CIQ_SDK_HOME setzen." >&2
    exit 1
  fi
  CIQ_SDK_HOME="$(tr -d '\n' < "$cfg")"
fi
CIQ_SDK_HOME="${CIQ_SDK_HOME%/}"
MONKEYC="$CIQ_SDK_HOME/bin/monkeyc"
MONKEYDO="$CIQ_SDK_HOME/bin/monkeydo"
if [[ ! -x "$MONKEYC" ]]; then
  echo "monkeyc fehlt unter $CIQ_SDK_HOME/bin." >&2
  exit 1
fi

if [[ -z "${GARMIN_DEVELOPER_KEY:-}" ]]; then
  echo "GARMIN_DEVELOPER_KEY ist nicht gesetzt (Pfad zum Entwicklerschlüssel, z. B. ~/.garmin/developer_key.der)." >&2
  exit 1
fi
if [[ ! -r "$GARMIN_DEVELOPER_KEY" ]]; then
  echo "Entwicklerschlüssel nicht lesbar: GARMIN_DEVELOPER_KEY zeigt auf keine lesbare Datei." >&2
  exit 1
fi

# Target devices come from the manifest, so there is one list only.
mapfile_devices() {
  sed -n 's/.*<iq:product id="\([^"]*\)".*/\1/p' "$APP_DIR/manifest.xml"
}
DEVICES=()
while IFS= read -r d; do DEVICES+=("$d"); done < <(mapfile_devices)
if [[ ${#DEVICES[@]} -eq 0 ]]; then
  echo "Keine Zielgeräte im Manifest." >&2
  exit 1
fi

# Compile one target. Fails on any compiler warning, so the build stays clean.
# Usage: compile <device> <output.prg> [extra monkeyc flags...]
compile() {
  local device="$1" out="$2"
  shift 2
  local log
  mkdir -p "$(dirname "$out")"
  if ! log="$("$MONKEYC" -f "$APP_DIR/${JUNGLE:-monkey.jungle}" -d "$device" -o "$out" \
    -y "$GARMIN_DEVELOPER_KEY" -l 3 -w "$@" 2>&1)"; then
    echo "$log" >&2
    echo "Build fehlgeschlagen: $device" >&2
    return 1
  fi
  if grep -q 'WARNING' <<<"$log"; then
    echo "$log" >&2
    echo "Build mit Warnungen: $device" >&2
    return 1
  fi
}
