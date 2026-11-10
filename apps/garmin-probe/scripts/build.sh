#!/usr/bin/env bash
set -euo pipefail
probe_dir="$(cd "$(dirname "$0")/.." && pwd)"
source "$probe_dir/../garmin/scripts/env.sh"
mkdir -p "$probe_dir/bin"
if [[ ! -f "$probe_dir/source/ProbeConfig.mc" ]]; then
  printf 'import Toybox.Lang;\n(:background) module ProbeConfig { var URL as String = ""; }\n' > "$probe_dir/source/ProbeConfig.mc"
fi
build_log="$probe_dir/bin/build.log"
"$MONKEYC" -f "${PROBE_JUNGLE:-$probe_dir/monkey.jungle}" -d fr255 -o "${PROBE_OUTPUT:-$probe_dir/bin/ArnoldProbe.prg}" \
  -y "$GARMIN_DEVELOPER_KEY" -l 3 -w "$@" 2>&1 | tee "$build_log"
if rg -q 'WARNING' "$build_log"; then exit 1; fi
echo 'ok fr255 probe, strict typecheck, no warnings'
