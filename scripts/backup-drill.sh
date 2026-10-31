#!/usr/bin/env bash
# Restore drill for Arnold's state bucket, with a synthetic file only.
#
#   bash scripts/backup-drill.sh
#
# Plays the emergency once: a state file is overwritten with broken content,
# then deleted, and the last good version is brought back from soft delete.
# Works only under drill/ in the bucket, outside connected/ (Arnold's state),
# so no user data is read or touched. The drill file is deleted at the end
# and stays soft-deleted for the retention period.
#
# The real procedure for a user's file is in docs/BETRIEB.md (Wiederherstellen).
set -euo pipefail

PROJECT="${ARNOLD_PROJECT:-arnold-513219}"
BUCKET="gs://$PROJECT-state"
OBJECT="$BUCKET/drill/state-drill-$(date -u +%Y%m%dT%H%M%SZ).json"
GOOD='{"drill":true,"content":"good version"}'
BROKEN='{"drill":true,"content":"BROKEN'

echo "› Schutz am Bucket"
gcloud storage buckets describe "$BUCKET" \
  --format='value(soft_delete_policy.retentionDurationSeconds)' |
  awk '{ d = $1 / 86400; print "  Soft Delete: " d " Tage"; if (d < 7) exit 1 }' || {
  echo "Soft Delete ist aus oder kürzer als 7 Tage. Abbruch." >&2
  exit 1
}

echo "› 1. Gute Version anlegen: $OBJECT"
printf '%s' "$GOOD" | gcloud storage cp - "$OBJECT" --quiet
GOOD_GEN="$(gcloud storage objects describe "$OBJECT" --format='value(generation)')"
echo "  Generation $GOOD_GEN"

echo "› 2. Mit kaputtem Inhalt überschreiben"
printf '%s' "$BROKEN" | gcloud storage cp - "$OBJECT" --quiet

echo "› 3. Datei löschen"
gcloud storage rm "$OBJECT" --quiet

echo "› 4. Gelöschte Versionen anzeigen"
gcloud storage ls --soft-deleted --long "$OBJECT"

echo "› 5. Gute Version $GOOD_GEN zurückholen"
gcloud storage restore "$OBJECT#$GOOD_GEN" --quiet

echo "› 6. Inhalt prüfen"
RESTORED="$(gcloud storage cat "$OBJECT")"
if [[ "$RESTORED" == "$GOOD" ]]; then
  echo "  ✓ wiederhergestellt: $RESTORED"
else
  echo "  ✗ Inhalt passt nicht: $RESTORED" >&2
  exit 1
fi

echo "› 7. Übungsdatei wieder löschen"
gcloud storage rm "$OBJECT" --quiet

echo
echo "Übung bestanden: überschrieben, gelöscht, gute Version zurückgeholt."
