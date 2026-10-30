#!/usr/bin/env bash
# Puts Arnold's Google secrets into Secret Manager, without printing them.
#
#   npm run setup:google-secrets [-- <client_secret_….json>]
#
# 1. Creates the token encryption key (32 random bytes) once. An existing key
#    is never replaced: that would make every stored Google refresh token
#    unreadable.
# 2. Reads the OAuth client JSON downloaded from the Google Cloud Console
#    (newest ~/Downloads/client_secret_*.json unless a path is given), checks
#    the redirect URI, and stores client id and secret as new secret versions.
#
# Runs as the signed-in gcloud user. Nothing secret reaches the terminal.
set -euo pipefail

PROJECT="${ARNOLD_PROJECT:-arnold-513219}"
SERVICE_URL="${ARNOLD_URL:-https://arnold-789221393068.europe-west1.run.app}"
REDIRECT="$SERVICE_URL/auth/google/callback"
FILE="${1:-$(ls -t "$HOME"/Downloads/client_secret_*.json 2>/dev/null | head -1 || true)}"

put_secret() { # name, value on stdin
  if gcloud secrets describe "$1" --project "$PROJECT" >/dev/null 2>&1; then
    gcloud secrets versions add "$1" --project "$PROJECT" --data-file=- >/dev/null
  else
    gcloud secrets create "$1" --project "$PROJECT" \
      --replication-policy=automatic --labels=app=arnold --data-file=- >/dev/null
  fi
  echo "  ✓ $1"
}

echo "› Verschlüsselungsschlüssel"
if gcloud secrets describe arnold-token-encryption-key --project "$PROJECT" >/dev/null 2>&1; then
  echo "  ✓ arnold-token-encryption-key (bleibt unverändert)"
else
  node -e "process.stdout.write('k1:' + require('crypto').randomBytes(32).toString('base64'))" |
    put_secret arnold-token-encryption-key
fi

if [[ -z "$FILE" || ! -f "$FILE" ]]; then
  echo "Keine Google-Zugangsdatei gefunden (client_secret_….json im Downloads-Ordner)." >&2
  echo "Erst in der Cloud Console den Client anlegen und \"JSON herunterladen\" klicken." >&2
  exit 1
fi
echo "› Google-Zugang aus $(basename "$FILE")"
node -e '
  const c = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")).web;
  if (!c) throw new Error("Kein Webanwendungs-Client. Typ \"Webanwendung\" wählen.");
  if (!(c.redirect_uris || []).includes(process.argv[2]))
    throw new Error("Weiterleitungs-URI fehlt. Erwartet: " + process.argv[2]);
  if (!c.client_id || !c.client_secret) throw new Error("client_id oder client_secret fehlt.");
' "$FILE" "$REDIRECT"
node -e 'process.stdout.write(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).web.client_id)' "$FILE" |
  put_secret arnold-google-client-id
node -e 'process.stdout.write(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).web.client_secret)' "$FILE" |
  put_secret arnold-google-client-secret

echo
read -r -p "Die heruntergeladene Datei enthält das Geheimnis. Jetzt in den Papierkorb legen? (j/n) " ANSWER
if [[ "$ANSWER" == j* || "$ANSWER" == J* ]]; then
  mv "$FILE" "$HOME/.Trash/" && echo "  ✓ in den Papierkorb gelegt"
fi
echo
echo "Fertig. Sag Claude Bescheid."
