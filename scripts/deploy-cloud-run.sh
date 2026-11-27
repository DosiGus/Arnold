#!/usr/bin/env bash
# Deploys Arnold to Google Cloud Run behind a WorkOS login.
#
#   npm run deploy:cloud-run -- <project-id> <authkit-domain>
#   e.g. npm run deploy:cloud-run -- arnold-513219 example-123.authkit.app
#
# Profiles (ARNOLD_PROFILE):
#   database (default)  signed-in users, data in Postgres (Supabase). The
#                       connection comes from Secret Manager
#                       (arnold-database-url). Needs `npm run db:setup` once.
#   fixture             invented data, one in-memory sandbox per user.
#
# What it does, in order:
#   1. refuses a checkout with uncommitted changes, a commit that is not on
#      GitHub, or a commit whose CI run is not green,
#   2. reads the login provider's OAuth metadata (issuer, JWKS) and checks it,
#   3. turns on the APIs it needs,
#   4. builds exactly that commit (a clean `git archive`, not the working
#      folder) in Cloud Build and deploys it (no local Docker); the revision
#      gets ARNOLD_RELEASE=<commit> and the label commit=<commit>,
#   5. pins ALLOWED_HOSTS to the service's own run.app hostnames,
#   6. sends all traffic to the new revision (also after a rollback),
#   7. checks /health (including the release), the protected-resource
#      document and that /mcp refuses a request without a token.
#
# Rollback: docs/BETRIEB.md.
#
# Arnold's scopes come from the provider's JWT template in the claim
# urn:arnold:scopes. There is deliberately no way to deploy without a login.
set -euo pipefail

PROJECT="${1:-}"
AUTHKIT="${2:-${ARNOLD_AUTH_DOMAIN:-}}"
PROFILE="${ARNOLD_PROFILE:-database}"
REGION="${ARNOLD_REGION:-europe-west1}"
SERVICE="${ARNOLD_SERVICE:-arnold}"
# 0 = sleeps when idle (nearly free), 1 = always awake.
MIN_INSTANCES="${ARNOLD_MIN_INSTANCES:-0}"
SCOPE_CLAIM="urn:arnold:scopes"

if [[ -z "$PROJECT" || -z "$AUTHKIT" ]]; then
  echo "Aufruf: npm run deploy:cloud-run -- <projekt-id> <authkit-domain>" >&2
  exit 1
fi
if [[ "$PROFILE" != database && "$PROFILE" != fixture ]]; then
  echo "ARNOLD_PROFILE muss database oder fixture sein." >&2
  exit 1
fi
AUTHKIT="${AUTHKIT%/}"
[[ "$AUTHKIT" == https://* ]] || AUTHKIT="https://$AUTHKIT"
if ! gcloud auth list --filter=status:ACTIVE --format='value(account)' | grep -q .; then
  echo "Nicht bei Google angemeldet. Zuerst: gcloud auth login" >&2
  exit 1
fi

# Only a committed, pushed and CI-checked state goes live, so /health always
# names a commit that anyone can look up and that passed `npm run check`.
cd "$(git rev-parse --show-toplevel)"
if [[ -n "$(git status --porcelain)" ]]; then
  echo "Nicht committete Änderungen. Erst committen und pushen, dann deployen:" >&2
  git status --short >&2
  exit 1
fi
RELEASE="$(git rev-parse HEAD)"
git fetch --quiet origin
if [[ -z "$(git branch -r --contains "$RELEASE")" ]]; then
  echo "Commit $RELEASE ist nicht auf GitHub. Erst pushen, dann deployen." >&2
  exit 1
fi
command -v gh >/dev/null || {
  echo "GitHub CLI (gh) fehlt; ohne sie lässt sich die CI nicht prüfen." >&2
  exit 1
}
CI="$(gh run list --commit "$RELEASE" --workflow check.yml \
  --json status,conclusion --jq '[.[] | select(.conclusion == "success")] | length' 2>/dev/null || true)"
if [[ "${CI:-0}" == 0 ]]; then
  echo "Für $RELEASE gibt es keinen grünen CI-Lauf (check.yml). Erst grün, dann deployen." >&2
  gh run list --commit "$RELEASE" --workflow check.yml >&2 || true
  exit 1
fi
echo "› Release $RELEASE (committet, gepusht, CI grün)"

# Build from a clean copy of the commit, never from the working folder.
SOURCE="$(mktemp -d)"
trap 'rm -rf "$SOURCE"' EXIT
git archive --format=tar "$RELEASE" | tar -x -C "$SOURCE"

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

echo "› Projekt $PROJECT, Region $REGION, Dienst $SERVICE, Profil $PROFILE"
gcloud config set project "$PROJECT" >/dev/null
NUMBER="$(gcloud projects describe "$PROJECT" --format='value(projectNumber)')"

echo "› APIs einschalten"
gcloud services enable run.googleapis.com cloudbuild.googleapis.com \
  artifactregistry.googleapis.com --quiet

RUNTIME_SA="arnold-runtime@$PROJECT.iam.gserviceaccount.com"
EXTRA=()
GARMIN_DAILY_SOURCE=off
if [[ "$PROFILE" == database ]]; then
  gcloud services enable secretmanager.googleapis.com --quiet
  gcloud iam service-accounts describe "$RUNTIME_SA" --project "$PROJECT" >/dev/null 2>&1 &&
    gcloud secrets describe arnold-database-url --project "$PROJECT" >/dev/null 2>&1 || {
    echo "Dienstkonto oder Datenbankzugang fehlt. Zuerst: npm run db:setup -- $PROJECT" >&2
    exit 1
  }
  SECRETS="DATABASE_URL=arnold-database-url:latest"
  if gcloud secrets describe arnold-database-ca --project "$PROJECT" >/dev/null 2>&1; then
    SECRETS+=",DATABASE_CA_CERT=arnold-database-ca:latest"
  fi
  # Garmin daily values (UX-015): on only when both secrets exist and
  # GARMIN_DAILY_DISABLE is not 1. The values are never read here.
  if [[ "${GARMIN_DAILY_DISABLE:-}" != 1 ]] &&
    gcloud secrets describe arnold-garmin-personal-key --project "$PROJECT" >/dev/null 2>&1 &&
    gcloud secrets describe arnold-garmin-daily-user --project "$PROJECT" >/dev/null 2>&1; then
    for secret in arnold-garmin-personal-key arnold-garmin-daily-user; do
      gcloud secrets add-iam-policy-binding "$secret" --project "$PROJECT" \
        --member="serviceAccount:$RUNTIME_SA" \
        --role=roles/secretmanager.secretAccessor >/dev/null
    done
    SECRETS+=",GARMIN_PERSONAL_API_KEY=arnold-garmin-personal-key:latest"
    SECRETS+=",GARMIN_DAILY_USER_ID=arnold-garmin-daily-user:latest"
    GARMIN_DAILY_SOURCE=personal
    echo "  Garmin-Tageswerte: an (persönlicher Schlüssel)"
  else
    echo "  Garmin-Tageswerte: aus"
  fi
  # --set-secrets replaces every secret of the service, so secrets of
  # earlier profiles disappear with this deploy.
  EXTRA+=(--service-account "$RUNTIME_SA" --set-secrets "$SECRETS")
fi
# The storage bucket of the former Google profile is no longer mounted.
VOLUMES="$(gcloud run services describe "$SERVICE" --region "$REGION" \
  --format='value(spec.template.spec.volumes[].name)' 2>/dev/null || true)"
if [[ "$VOLUMES" == *state* ]]; then
  EXTRA+=(--remove-volume-mount /app/data --remove-volume state)
fi

# The deterministic run.app hostname is known before the first deploy, so the
# first revision already accepts its own address and names it as the MCP
# resource. Other hostnames of the service are added to ALLOWED_HOSTS below.
PRIMARY_HOST="${SERVICE}-${NUMBER}.${REGION}.run.app"
URL="https://${PRIMARY_HOST}"
# Every hostname the service already answers on, so a redeploy creates exactly
# one revision with the full list. Only the very first deploy needs a second
# revision (below), because the other hostname exists only afterwards.
service_hosts() {
  { gcloud run services describe "$SERVICE" --region "$REGION" \
    --format='value(metadata.annotations."run.googleapis.com/urls")' 2>/dev/null || true; } |
    tr -d '[]" ' | tr ',' '\n' | sed -E 's#^https://##' |
    { cat; echo "$PRIMARY_HOST"; } | grep . | sort -u | paste -sd, -
}
HOSTS="$(service_hosts)"
env_vars() {
  local vars=(
    AUTH_MODE=oidc
    "ARNOLD_PUBLIC_BASE_URL=$URL"
    "AUTH_ISSUER=$ISSUER"
    "AUTH_JWKS_URI=$JWKS"
    "AUTH_SCOPE_CLAIM=$SCOPE_CLAIM"
    TRUST_PROXY=1
    ARNOLD_TOOL_LOG=json
    "ARNOLD_RELEASE=$RELEASE"
    "ALLOWED_HOSTS=$1"
  )
  if [[ "$PROFILE" == database ]]; then
    # production switches on the strict start checks in src/server/auth/config.ts
    # (https everywhere, identities only in Postgres, no open mode).
    vars+=(
      ARNOLD_ENV=production
      STORAGE_MODE=arnold_database
      ARNOLD_WRITE_MODE=disabled
      IDENTITY_STORE=postgres
      "GARMIN_DAILY_SOURCE=$GARMIN_DAILY_SOURCE"
    )
  else
    # The synthetic profile keeps identities in memory, which production
    # refuses; staging still forbids an open endpoint.
    vars+=(ARNOLD_ENV=staging STORAGE_MODE=arnold_fixture ARNOLD_WRITE_MODE=fixture IDENTITY_STORE=memory)
  fi
  # '^@^' switches gcloud's list separator to '@' so ALLOWED_HOSTS keeps commas.
  local IFS=@
  echo "^@^${vars[*]}"
}

echo "› Bauen und veröffentlichen (dauert einige Minuten)"
gcloud run deploy "$SERVICE" \
  --source "$SOURCE" \
  --region "$REGION" \
  --allow-unauthenticated \
  --min-instances "$MIN_INSTANCES" \
  --max-instances 1 \
  --cpu 1 --memory 512Mi --cpu-boost \
  --concurrency 80 --timeout 300 \
  --set-env-vars "$(env_vars "$HOSTS")" \
  --labels "app=arnold,profile=$PROFILE,commit=$RELEASE" \
  ${EXTRA[@]+"${EXTRA[@]}"} \
  --quiet

NEW_HOSTS="$(service_hosts)"
if [[ "$NEW_HOSTS" != "$HOSTS" ]]; then
  echo "› ALLOWED_HOSTS auf alle Dienstadressen setzen: $NEW_HOSTS"
  gcloud run services update "$SERVICE" --region "$REGION" \
    --update-env-vars "$(env_vars "$NEW_HOSTS")" --quiet >/dev/null
fi

# After a rollback the traffic is pinned to an older revision, and a new
# deploy would then get none. Deploying means: this commit is live.
echo "› Gesamten Traffic auf die neue Revision"
gcloud run services update-traffic "$SERVICE" --region "$REGION" --to-latest --quiet >/dev/null
LIVE="$(gcloud run services describe "$SERVICE" --region "$REGION" \
  --format='value(status.traffic[0].revisionName)')"
echo "  live: $LIVE"

echo "› Prüfen: $URL"
HEALTH="$(curl -fsS "$URL/health")"
echo "  health: $HEALTH"
EXPECT_SYNTHETIC=$([[ "$PROFILE" == fixture ]] && echo true || echo false)
grep -q "\"synthetic\":$EXPECT_SYNTHETIC" <<<"$HEALTH" && grep -q '"auth":"oidc"' <<<"$HEALTH" || {
  echo "Health passt nicht zum Profil $PROFILE (synthetic=$EXPECT_SYNTHETIC, auth=oidc). Abbruch." >&2
  exit 1
}
grep -q "\"release\":\"$RELEASE\"" <<<"$HEALTH" || {
  echo "/health meldet nicht release $RELEASE. Abbruch; Rollback siehe docs/BETRIEB.md." >&2
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
echo "Fertig. Live: $LIVE, Commit $RELEASE"
echo "ChatGPT-Connector-Adresse: $URL/mcp (Anmeldung: OAuth, Profil $PROFILE)"
