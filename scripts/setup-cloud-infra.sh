#!/usr/bin/env bash
# One-time Google Cloud setup for the connected (real Google Sheets) profile.
#
#   npm run setup:cloud-infra
#
# Creates, if missing, and grants only what Arnold needs at runtime:
#   - service account arnold-runtime (no project-wide roles),
#   - bucket gs://<project>-state in europe-west1: private, uniform access,
#     hierarchical namespace (atomic renames for Arnold's temp-file writes),
#   - arnold-runtime may read/write objects in that bucket only,
#   - arnold-runtime may read the three Arnold secrets only.
# Safe to run again; existing resources are kept as they are.
set -euo pipefail

PROJECT="${ARNOLD_PROJECT:-arnold-513219}"
REGION="${ARNOLD_REGION:-europe-west1}"
SA_NAME=arnold-runtime
SA="$SA_NAME@$PROJECT.iam.gserviceaccount.com"
BUCKET="gs://$PROJECT-state"
SECRETS=(arnold-google-client-id arnold-google-client-secret arnold-token-encryption-key)

echo "› Dienstkonto $SA"
if gcloud iam service-accounts describe "$SA" --project "$PROJECT" >/dev/null 2>&1; then
  echo "  ✓ vorhanden"
else
  gcloud iam service-accounts create "$SA_NAME" --project "$PROJECT" \
    --display-name="Arnold Cloud Run runtime" >/dev/null
  echo "  ✓ angelegt"
fi

echo "› Speicher $BUCKET"
if gcloud storage buckets describe "$BUCKET" >/dev/null 2>&1; then
  echo "  ✓ vorhanden"
else
  gcloud storage buckets create "$BUCKET" --project "$PROJECT" \
    --location "$REGION" --uniform-bucket-level-access \
    --public-access-prevention --enable-hierarchical-namespace >/dev/null
  echo "  ✓ angelegt"
fi

echo "› Rechte"
# A brand-new service account can take a few seconds to become visible to IAM.
for attempt in 1 2 3 4 5 6; do
  if gcloud storage buckets add-iam-policy-binding "$BUCKET" \
    --member="serviceAccount:$SA" --role=roles/storage.objectUser >/dev/null 2>&1; then
    break
  fi
  [[ $attempt == 6 ]] && {
    echo "Speicherrecht konnte nicht gesetzt werden." >&2
    exit 1
  }
  sleep 5
done
echo "  ✓ Speicher lesen und schreiben"
for secret in "${SECRETS[@]}"; do
  gcloud secrets add-iam-policy-binding "$secret" --project "$PROJECT" \
    --member="serviceAccount:$SA" --role=roles/secretmanager.secretAccessor >/dev/null
  echo "  ✓ $secret lesen"
done

echo "› Build-Konto (Cloud Build baut die Container-Images)"
NUMBER="$(gcloud projects describe "$PROJECT" --format='value(projectNumber)')"
gcloud projects add-iam-policy-binding "$PROJECT" \
  --member="serviceAccount:${NUMBER}-compute@developer.gserviceaccount.com" \
  --role=roles/run.builder --condition=None --quiet >/dev/null
echo "  ✓ darf Images bauen"

echo
echo "Fertig. Sag Claude Bescheid."
