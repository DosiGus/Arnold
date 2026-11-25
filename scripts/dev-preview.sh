#!/usr/bin/env bash
# Lokale Vorschau zum Testen der Karten ohne ChatGPT, ohne Konto, ohne Deploy.
#
#   npm run dev:preview
#
# - Der Server läuft mit erfundenen Daten im Arbeitsspeicher (Profil
#   arnold_fixture, keine Datenbank, keine Anmeldung, nur localhost).
# - Die Oberfläche wird bei jeder Änderung in src/ui neu gebaut.
# - Jede Änderung am Server und jedes Drücken von Enter startet den Server neu:
#   alle Daten sind dann wieder frisch, die Einrichtung beginnt von vorn.
#   Danach die Browser-Seite neu laden.
set -euo pipefail
cd "$(dirname "$0")/.."

PORT="${PORT:-8787}"
export PORT HOST=127.0.0.1
export ARNOLD_ENV=development
export STORAGE_MODE=arnold_fixture
export ARNOLD_WRITE_MODE=fixture
export AUTH_MODE=open
export ALLOWED_HOSTS="127.0.0.1,localhost"
# Skybridge-DevTools o. ä. dürfen sich lokal verbinden.
export ALLOWED_ORIGINS="${ALLOWED_ORIGINS:-http://127.0.0.1:3100,http://localhost:3100}"

pids=()
cleanup() { kill "${pids[@]}" 2>/dev/null || true; }
trap cleanup EXIT INT TERM

# Erst einmal vollständig bauen, damit der Server sofort eine Oberfläche hat.
npm run build:ui --silent
npx vite build --watch --logLevel warn &
pids+=($!)
npx vite build --watch --config vite.host.config.ts --logLevel warn &
pids+=($!)

echo
echo "Arnold-Vorschau (erfundene Daten):"
echo "  Einrichtung:  http://localhost:${PORT}/preview?onboarding=1"
echo "  Übersicht:    http://localhost:${PORT}/preview"
echo "  Kartenkit:    http://localhost:${PORT}/preview?kit=1"
echo "  Enter drücken = Daten zurücksetzen, dann Seite neu laden."
echo

npx tsx watch --clear-screen=false src/server/main.ts
