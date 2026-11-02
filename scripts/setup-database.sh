#!/usr/bin/env bash
# Prepares the Supabase database and Google Cloud for the database profile.
#
#   DATABASE_ADMIN_URL=... npm run db:setup -- <gcp-project-id>
#
# DATABASE_ADMIN_URL is the owner connection (Supabase: user postgres.<ref>,
# session pooler). It is read from the environment only and never printed.
# If Supabase's CA certificate is needed, put it in DATABASE_CA_CERT.
#
# What it does, safe to run again:
#   1. applies the migrations in db/migrations,
#   2. gives the server role arnold_app a new random password,
#   3. stores the server's connection (role arnold_app, same host) in Secret
#      Manager as arnold-database-url — the password never leaves this script
#      and the secret store,
#   4. stores DATABASE_CA_CERT as arnold-database-ca, when given,
#   5. creates the runtime service account arnold-runtime and lets it read
#      exactly these secrets.
#
# Running it again rotates the server password. The next deploy picks up the
# new secret version; until then the running revision keeps its connections.
set -euo pipefail

PROJECT="${1:-}"
if [[ -z "$PROJECT" ]]; then
  echo "Aufruf: DATABASE_ADMIN_URL=... npm run db:setup -- <gcp-projekt-id>" >&2
  exit 1
fi
if [[ -z "${DATABASE_ADMIN_URL:-}" ]]; then
  echo "DATABASE_ADMIN_URL fehlt (Supabase: Connect → Session pooler, Nutzer postgres)." >&2
  exit 1
fi
cd "$(git rev-parse --show-toplevel)"

echo "› Migrationen anwenden"
npx tsx src/server/db/migrate.ts

echo "› Passwort für arnold_app setzen und Verbindung ableiten"
APP_URL="$(npx tsx src/server/db/app-role.ts)"

gcloud config set project "$PROJECT" >/dev/null
gcloud services enable secretmanager.googleapis.com --quiet

store_secret() {
  local name="$1"
  if gcloud secrets describe "$name" --project "$PROJECT" >/dev/null 2>&1; then
    gcloud secrets versions add "$name" --project "$PROJECT" --data-file=- >/dev/null
  else
    gcloud secrets create "$name" --project "$PROJECT" \
      --replication-policy=user-managed --locations=europe-west1 \
      --data-file=- >/dev/null
  fi
  echo "  ✓ $name gespeichert"
}
echo "› Geheimnisse in Secret Manager"
printf '%s' "$APP_URL" | store_secret arnold-database-url
unset APP_URL
SECRETS=(arnold-database-url)
if [[ -n "${DATABASE_CA_CERT:-}" ]]; then
  printf '%s' "$DATABASE_CA_CERT" | store_secret arnold-database-ca
  SECRETS+=(arnold-database-ca)
fi

SA_NAME=arnold-runtime
SA="$SA_NAME@$PROJECT.iam.gserviceaccount.com"
echo "› Dienstkonto $SA"
if ! gcloud iam service-accounts describe "$SA" --project "$PROJECT" >/dev/null 2>&1; then
  gcloud iam service-accounts create "$SA_NAME" --project "$PROJECT" \
    --display-name="Arnold Cloud Run runtime" >/dev/null
fi
for secret in "${SECRETS[@]}"; do
  # A brand-new service account can take a few seconds to become visible.
  for attempt in 1 2 3 4 5 6; do
    if gcloud secrets add-iam-policy-binding "$secret" --project "$PROJECT" \
      --member="serviceAccount:$SA" --role=roles/secretmanager.secretAccessor >/dev/null 2>&1; then
      break
    fi
    [[ $attempt == 6 ]] && {
      echo "Leserecht für $secret konnte nicht gesetzt werden." >&2
      exit 1
    }
    sleep 5
  done
  echo "  ✓ $SA darf $secret lesen"
done

echo
echo "Fertig. Nächster Schritt: npm run deploy:cloud-run -- $PROJECT <authkit-domain>"
