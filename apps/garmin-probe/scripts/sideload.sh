#!/usr/bin/env bash
set -euo pipefail
probe_dir="$(cd "$(dirname "$0")/.." && pwd)"
bash "$probe_dir/scripts/build.sh"
python3 -I "$probe_dir/../garmin/scripts/mtp.py" push "$probe_dir/bin/ArnoldProbe.prg" /GARMIN/APPS
