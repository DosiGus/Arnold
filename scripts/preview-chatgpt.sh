#!/usr/bin/env bash
# Live-Vorschau in ChatGPT mit fester Adresse (docs/GUIDE.md).
# Startet Tailscale ohne Root, schaltet die feste HTTPS-Adresse ein und
# startet den Vorschau-Server. Einstellungen und Datenbankzugang kommen aus
# dem laufenden Cloud-Run-Dienst bzw. Secret Manager und bleiben nur im
# Prozess: nichts davon wird gespeichert oder ausgegeben.
#
#   bash scripts/preview-chatgpt.sh [projekt-id]
set -euo pipefail
cd "$(dirname "$0")/.."

PROJECT="${1:-$(gcloud config get-value project 2>/dev/null)}"
REGION="${ARNOLD_REGION:-europe-west1}"
PORT=8788
STATE="$HOME/.local/share/arnold-tailscale"
SOCKET="$STATE/tailscaled.sock"
ts() { tailscale --socket="$SOCKET" "$@"; }

mkdir -p "$STATE"
chmod 700 "$STATE"
if ! ts status --json >/dev/null 2>&1; then
  nohup "$(brew --prefix)/opt/tailscale/bin/tailscaled" \
    --tun=userspace-networking --statedir="$STATE" --socket="$SOCKET" \
    >"$STATE/tailscaled.log" 2>&1 &
  disown
fi
state=""
for _ in $(seq 1 40); do
  state="$(ts status --json 2>/dev/null |
    node -pe 'JSON.parse(require("fs").readFileSync(0)).BackendState' 2>/dev/null || true)"
  [[ "$state" == "Running" ]] && break
  sleep 0.5
done
if [[ "$state" != "Running" ]]; then
  echo "Tailscale ist nicht angemeldet: tailscale --socket=$SOCKET up" >&2
  exit 1
fi
HOSTNAME_TS="$(ts status --json |
  node -pe 'JSON.parse(require("fs").readFileSync(0)).Self.DNSName.replace(/\.$/, "")')"
ts funnel --bg "$PORT" >/dev/null

# Anmeldeeinstellungen genau wie beim laufenden Dienst.
SERVICE_JSON="$(gcloud run services describe arnold --project "$PROJECT" --region "$REGION" --format=json)"
live_env() {
  node -e 'const s = JSON.parse(process.argv[1]);
    const e = s.spec.template.spec.containers[0].env.find((v) => v.name === process.argv[2]);
    if (!e?.value) process.exit(1);
    process.stdout.write(e.value);' "$SERVICE_JSON" "$1"
}
secret() { gcloud secrets versions access latest --secret "$1" --project "$PROJECT"; }

AUTH_ISSUER="$(live_env AUTH_ISSUER)"
AUTH_JWKS_URI="$(live_env AUTH_JWKS_URI)"
AUTH_SCOPE_CLAIM="$(live_env AUTH_SCOPE_CLAIM)"
DATABASE_URL="$(secret arnold-database-url)"
DATABASE_CA_CERT="$(secret arnold-database-ca)"
# Das eine freigegebene Konto der Vorschau: seine interne Kennung liegt nur
# lokal, nie im Repository.
ID_FILE="$HOME/.config/arnold/preview-user-id"
ARNOLD_PREVIEW_USER_ID="${ARNOLD_PREVIEW_USER_ID:-$(cat "$ID_FILE" 2>/dev/null || true)}"
if [[ -z "$ARNOLD_PREVIEW_USER_ID" ]]; then
  echo "Die Kontokennung fehlt: usr_… in $ID_FILE eintragen." >&2
  exit 1
fi
export AUTH_ISSUER AUTH_JWKS_URI AUTH_SCOPE_CLAIM DATABASE_URL DATABASE_CA_CERT
export ARNOLD_PREVIEW_USER_ID ARNOLD_PREVIEW_URL="https://$HOSTNAME_TS" PORT

echo "Vorschau-Adresse für ChatGPT: $ARNOLD_PREVIEW_URL/mcp"
# Der Mac schläft nicht ein, solange die Vorschau läuft.
exec caffeinate -i npm run dev:chatgpt
