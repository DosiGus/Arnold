#!/usr/bin/env bash
set -euo pipefail
probe_dir="$(cd "$(dirname "$0")/.." && pwd)"
source "$probe_dir/../garmin/scripts/env.sh"
PROBE_JUNGLE="$probe_dir/test.jungle" PROBE_OUTPUT="$probe_dir/bin/tests.prg" bash "$probe_dir/scripts/build.sh" -t
test_output="$("$MONKEYDO" "$probe_dir/bin/tests.prg" fr255 -t 2>&1 || true)"
printf '%s\n' "$test_output" | tee "$probe_dir/bin/tests.log"
rg -q '^PASSED \(passed=3, failed=0, errors=0\)' "$probe_dir/bin/tests.log"
