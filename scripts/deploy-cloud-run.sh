#!/usr/bin/env bash
# Deploys Arnold to Google Cloud Run in the synthetic fixture profile.
#
#   npm run deploy:cloud-run -- <project-id>
#
# What it does, in order:
#   1. turns on the Cloud Run, Cloud Build and Artifact Registry APIs,
#   2. lets the default build account build Cloud Run images,
#   3. builds the Dockerfile in Cloud Build and deploys it (no local Docker),
#   4. pins ALLOWED_HOSTS to the service's own run.app hostnames,
#   5. checks /health and the tool list over the public address.
#
# Synthetic data only, no login: the instance is public and holds invented
# data in memory. Real data needs AUTH_MODE=oidc and is not done here.
set -euo pipefail

PROJECT="${1:-$(gcloud config get-value project 2>/dev/null || true)}"
REGION="${ARNOLD_REGION:-europe-west1}"
SERVICE="${ARNOLD_SERVICE:-arnold}"
# 0 = sleeps when idle (nearly free, test data resets), 1 = always awake.
MIN_INSTANCES="${ARNOLD_MIN_INSTANCES:-0}"

if [[ -z "$PROJECT" ]]; then
  echo "Projekt-ID fehlt: npm run deploy:cloud-run -- <project-id>" >&2
  exit 1
fi
if ! gcloud auth list --filter=status:ACTIVE --format='value(account)' | grep -q .; then
  echo "Nicht bei Google angemeldet. Zuerst: gcloud auth login" >&2
  exit 1
fi

echo "› Projekt $PROJECT, Region $REGION, Dienst $SERVICE"
gcloud config set project "$PROJECT" >/dev/null
NUMBER="$(gcloud projects describe "$PROJECT" --format='value(projectNumber)')"

echo "› APIs einschalten"
gcloud services enable run.googleapis.com cloudbuild.googleapis.com \
  artifactregistry.googleapis.com --quiet

echo "› Build-Konto berechtigen"
gcloud projects add-iam-policy-binding "$PROJECT" \
  --member="serviceAccount:${NUMBER}-compute@developer.gserviceaccount.com" \
  --role=roles/run.builder --condition=None --quiet >/dev/null

# The deterministic run.app hostname is known before the first deploy, so the
# very first revision already accepts its own address. Others are added below.
PRIMARY_HOST="${SERVICE}-${NUMBER}.${REGION}.run.app"
env_vars() {
  # '^@^' switches gcloud's list separator to '@' so ALLOWED_HOSTS keeps commas.
  echo "^@^ARNOLD_ENV=development@STORAGE_MODE=arnold_fixture@ARNOLD_WRITE_MODE=fixture@TRUST_PROXY=1@ALLOWED_HOSTS=$1"
}

echo "› Bauen und veröffentlichen (dauert einige Minuten)"
gcloud run deploy "$SERVICE" \
  --source . \
  --region "$REGION" \
  --allow-unauthenticated \
  --min-instances "$MIN_INSTANCES" \
  --max-instances 1 \
  --cpu 1 --memory 512Mi --cpu-boost \
  --concurrency 80 --timeout 300 \
  --set-env-vars "$(env_vars "$PRIMARY_HOST")" \
  --labels app=arnold,profile=fixture \
  --quiet

HOSTS="$(gcloud run services describe "$SERVICE" --region "$REGION" \
  --format='value(metadata.annotations."run.googleapis.com/urls")' |
  tr -d '[]" ' | tr ',' '\n' | sed -E 's#^https://##' | grep . | sort -u |
  paste -sd, -)"
HOSTS="$(printf '%s\n%s\n' "$PRIMARY_HOST" "${HOSTS//,/$'\n'}" | grep . | sort -u | paste -sd, -)"
if [[ "$HOSTS" != "$PRIMARY_HOST" ]]; then
  echo "› ALLOWED_HOSTS auf alle Dienstadressen setzen: $HOSTS"
  gcloud run services update "$SERVICE" --region "$REGION" \
    --update-env-vars "$(env_vars "$HOSTS")" --quiet >/dev/null
fi

URL="https://${PRIMARY_HOST}"
echo "› Prüfen: $URL"
HEALTH="$(curl -fsS "$URL/health")"
echo "  health: $HEALTH"
grep -q '"synthetic":true' <<<"$HEALTH" || {
  echo "Health meldet keine synthetischen Daten. Abbruch." >&2
  exit 1
}
TOOLS="$(curl -fsS -X POST "$URL/mcp" \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' |
  node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).result.tools.length))')"
echo "  tools: $TOOLS"

echo
echo "Fertig. ChatGPT-Connector-Adresse: $URL/mcp"
