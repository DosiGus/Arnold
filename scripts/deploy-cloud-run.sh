#!/usr/bin/env bash
# Deploys Arnold to Google Cloud Run: synthetic data, behind a login.
#
#   npm run deploy:cloud-run -- <project-id> <authkit-domain>
#   e.g. npm run deploy:cloud-run -- arnold-513219 https://example-123.authkit.app
#
# What it does, in order:
#   1. reads the login provider's OAuth metadata (issuer, JWKS) and checks it,
#   2. turns on the Cloud Run, Cloud Build and Artifact Registry APIs,
#   3. lets the default build account build Cloud Run images,
#   4. builds the Dockerfile in Cloud Build and deploys it (no local Docker),
#   5. pins ALLOWED_HOSTS to the service's own run.app hostnames,
#   6. checks /health, the protected-resource document and that /mcp refuses
#      a request without a token.
#
# Every signed-in user gets their own invented dataset in memory. Arnold's
# scopes come from the provider's JWT template in the claim urn:arnold:scopes.
# There is deliberately no way to deploy without a login from this script.
set -euo pipefail

PROJECT="${1:-}"
AUTHKIT="${2:-${ARNOLD_AUTH_DOMAIN:-}}"
REGION="${ARNOLD_REGION:-europe-west1}"
SERVICE="${ARNOLD_SERVICE:-arnold}"
# 0 = sleeps when idle (nearly free, test data resets), 1 = always awake.
MIN_INSTANCES="${ARNOLD_MIN_INSTANCES:-0}"
SCOPE_CLAIM="urn:arnold:scopes"

if [[ -z "$PROJECT" || -z "$AUTHKIT" ]]; then
  echo "Aufruf: npm run deploy:cloud-run -- <projekt-id> <authkit-domain>" >&2
  exit 1
fi
AUTHKIT="${AUTHKIT%/}"
[[ "$AUTHKIT" == https://* ]] || AUTHKIT="https://$AUTHKIT"
if ! gcloud auth list --filter=status:ACTIVE --format='value(account)' | grep -q .; then
  echo "Nicht bei Google angemeldet. Zuerst: gcloud auth login" >&2
  exit 1
fi

echo "› Login-Anbieter prüfen: $AUTHKIT"
METADATA="$(curl -fsS "$AUTHKIT/.well-known/oauth-authorization-server")"
read -r ISSUER JWKS < <(node -e '
  const m = JSON.parse(process.argv[1]);
  const base = new URL(process.argv[2]).origin;
  if (!m.issuer || new URL(m.issuer).origin !== base) throw new Error("issuer passt nicht zur Domain: " + m.issuer);
  if (!m.jwks_uri || !m.jwks_uri.startsWith("https://")) throw new Error("jwks_uri fehlt oder ist nicht https");
  if (!(m.code_challenge_methods_supported || []).includes("S256")) throw new Error("PKCE S256 fehlt");
  console.log(m.issuer, m.jwks_uri);
' "$METADATA" "$AUTHKIT")
echo "  issuer: $ISSUER"

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
# first revision already accepts its own address and names it as the MCP
# resource. Other hostnames of the service are added to ALLOWED_HOSTS below.
PRIMARY_HOST="${SERVICE}-${NUMBER}.${REGION}.run.app"
URL="https://${PRIMARY_HOST}"
env_vars() {
  # '^@^' switches gcloud's list separator to '@' so ALLOWED_HOSTS keeps commas.
  local vars=(
    ARNOLD_ENV=development
    STORAGE_MODE=arnold_fixture
    ARNOLD_WRITE_MODE=fixture
    AUTH_MODE=oidc
    "ARNOLD_PUBLIC_BASE_URL=$URL"
    "AUTH_ISSUER=$ISSUER"
    "AUTH_JWKS_URI=$JWKS"
    "AUTH_SCOPE_CLAIM=$SCOPE_CLAIM"
    IDENTITY_STORE=memory
    TRUST_PROXY=1
    "ALLOWED_HOSTS=$1"
  )
  local IFS=@
  echo "^@^${vars[*]}"
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
  --labels app=arnold,profile=fixture-oidc \
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

echo "› Prüfen: $URL"
HEALTH="$(curl -fsS "$URL/health")"
echo "  health: $HEALTH"
grep -q '"synthetic":true' <<<"$HEALTH" && grep -q '"auth":"oidc"' <<<"$HEALTH" || {
  echo "Health meldet nicht synthetisch + oidc. Abbruch." >&2
  exit 1
}
PRM="$(curl -fsS "$URL/.well-known/oauth-protected-resource/mcp")"
grep -q "\"resource\":\"$URL/mcp\"" <<<"$PRM" || {
  echo "Protected-Resource-Dokument nennt nicht $URL/mcp: $PRM" >&2
  exit 1
}
STATUS="$(curl -s -o /dev/null -w '%{http_code}' -X POST "$URL/mcp" \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}')"
echo "  /mcp ohne Token: $STATUS"
[[ "$STATUS" == 401 ]] || {
  echo "/mcp antwortet ohne Token nicht mit 401. Abbruch." >&2
  exit 1
}

echo
echo "Fertig. ChatGPT-Connector-Adresse: $URL/mcp (Anmeldung: OAuth)"
