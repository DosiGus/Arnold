# Arnold – Betrieb

Kurze Schrittfolgen für Deploy, Rollback, Wiederherstellung und Alarme. Hintergrund zu Profilen und Einrichtung: `docs/GUIDE.md`, Teil 2.

| Was         | Wert                                                                          |
| ----------- | ----------------------------------------------------------------------------- |
| Projekt     | `arnold-513219`                                                               |
| Region      | `europe-west1`                                                                |
| Dienst      | `arnold` (Cloud Run, Profil `arnold_connected`, höchstens 1 Instanz)          |
| Adresse     | `https://arnold-789221393068.europe-west1.run.app/mcp`                        |
| Zustand     | Bucket `arnold-513219-state`, im Container als `/app/data`                    |
| Geheimnisse | Secret Manager: Google-Client, Client-Secret, Token-Verschlüsselungsschlüssel |
| Login       | WorkOS AuthKit                                                                |
| CI          | GitHub Actions, `.github/workflows/check.yml`                                 |

Alle Befehle setzen `gcloud config set project arnold-513219` voraus.

## Deploy

Während der Beta: nur in ruhigen Zeiten und vorher ankündigen. Ein Deploy setzt keine Nutzerdaten zurück; sie liegen im Bucket.

1. Stand auf `main` committen und pushen. Warten, bis die CI für diesen Commit grün ist.
2. Im Haupt-Checkout auf `main`:
   ```bash
   npm run deploy:cloud-run -- arnold-513219 even-invention-38-staging.authkit.app
   ```

Das Skript bricht ab, wenn

- nicht committete Änderungen da sind,
- der Commit nicht auf GitHub liegt,
- für den Commit kein grüner CI-Lauf (`check.yml`) existiert,
- `/health` danach nicht genau diesen Commit als `release` meldet,
- `/mcp` ohne Token nicht mit 401 antwortet.

Es baut aus einer sauberen Kopie des Commits (`git archive`), nicht aus dem Arbeitsordner. Die Revision trägt `ARNOLD_RELEASE=<commit>` und das Label `commit=<commit>`. Nach dem Deploy geht der gesamte Traffic auf die neue Revision, auch wenn vorher ein Rollback den Traffic festgehalten hat.

Prüfen, was live ist:

```bash
curl -s https://arnold-789221393068.europe-west1.run.app/health
```

`release` ist der Commit. Fehlt das Feld, läuft ein Stand von vor der Beta-Integration.

## Rollback

Wenn ein neuer Stand Fehler macht: Traffic zurück auf die vorherige Revision. Das dauert Sekunden, es wird nichts neu gebaut.

1. Revisionen mit Commit anzeigen (neueste oben):
   ```bash
   gcloud run revisions list --service arnold --region europe-west1 \
     --format='table(metadata.name,metadata.labels.commit,metadata.creationTimestamp)'
   ```
   Zurück auf die neueste Revision **des vorherigen Commits**. Revisionen ohne Commit-Label stammen von vor der Beta.
2. Traffic umstellen:
   ```bash
   gcloud run services update-traffic arnold --region europe-west1 \
     --to-revisions <REVISION>=100
   ```
3. Prüfen: `/health` zeigt den alten Commit als `release`, `/mcp` ohne Token antwortet 401.
4. Fehler beheben, committen, pushen, CI grün, deployen. Das Deploy-Skript stellt den Traffic selbst wieder auf die neueste Revision. Ohne neuen Deploy zurück:
   ```bash
   gcloud run services update-traffic arnold --region europe-west1 --to-latest
   ```

Wichtig:

- Ein Rollback tauscht nur den Code. Die Daten im Bucket bleiben, wie der neue Stand sie geschrieben hat. Ändert ein Stand das Format der Zustandsdateien, vorher prüfen, ob der alte Stand sie lesen kann.
- Solange der Traffic festgehalten ist, bekommt eine neue Revision keinen Traffic. Darum stellt das Deploy-Skript ihn immer auf `--to-latest`.

Geübt am 31.10.2026, siehe `docs/beta/handoff-C.md`.

## Wiederherstellen einer Zustandsdatei

Der Bucket hat **Soft Delete mit 7 Tagen**: Jede gelöschte oder überschriebene Datei bleibt 7 Tage lang als frühere Generation erhalten und lässt sich zurückholen. Objektversionierung gibt es nicht, weil der Bucket einen hierarchischen Namensraum hat (nötig für sichere Umbenennungen beim Schreiben); Google erlaubt beides nicht zusammen. Soft Delete deckt Löschen und Überschreiben ab.

Aufbau im Bucket: `connected/identities.json`, `connected/google-connections.json` und je Nutzer `connected/users/<hash>/` mit `tracker.json`, `onboarding.json`, `draft.json`, `provisioning.json`, `operations.json`, `audit.json`. `<hash>` ist der SHA-256 der internen Nutzerkennung.

Die Google-Freigaben in `google-connections.json` sind mit dem Schlüssel `arnold-token-encryption-key` aus Secret Manager verschlüsselt. Eine wiederhergestellte Datei ist nur mit demselben Schlüssel lesbar: **Schlüsselversionen nie löschen oder zerstören.**

1. Frühere Generationen anzeigen:
   ```bash
   gcloud storage ls --soft-deleted --long gs://arnold-513219-state/connected/<pfad>
   ```
   Spalten: Größe, Zeit, `<pfad>#<generation>`. Die richtige Generation ist die letzte vor dem Schaden.
2. Zurückholen:
   ```bash
   gcloud storage restore gs://arnold-513219-state/connected/<pfad>#<generation>
   ```
   Gibt es die Datei noch in kaputtem Zustand, zusätzlich `--allow-overwrite` setzen. Die kaputte Fassung wird dabei selbst zu einer gelöschten Generation und ist nicht verloren.
3. Prüfen: `gcloud storage cat gs://arnold-513219-state/connected/<pfad>` zeigt gültiges JSON. Der Dienst liest die Datei beim nächsten Zugriff (Dateisystem-Cache bis etwa 1 Minute). Bei Zweifel eine neue Revision starten: `gcloud run services update arnold --region europe-west1 --update-labels restart=<datum>`.

Geübt mit `bash scripts/backup-drill.sh`: nur eine synthetische Datei unter `drill/`, nie Nutzerdaten.

Beachten für den Datenschutz: Was „Konto löschen“ entfernt, bleibt noch bis zu 7 Tage als gelöschte Generation im Bucket und verschwindet dann endgültig. Das steht im Datenschutzhinweis.

## Alarme

Eingerichtet mit `bash scripts/setup-monitoring.sh` (wiederholbar). Die E-Mails gehen an das angemeldete `gcloud`-Konto oder an `ARNOLD_ALERT_EMAIL`.

| Alarm                              | Bedeutung                                                        | Erste Schritte                                                                                   |
| ---------------------------------- | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Arnold: /health nicht erreichbar   | `/health` antwortet aus mindestens zwei Regionen nicht mit `ok`. | `curl /health`. Logs ansehen (unten). Kam es direkt nach einem Deploy: Rollback.                 |
| Arnold: Serverfehler (5xx) gehäuft | Mehr als 4 Antworten 5xx in 5 Minuten.                           | Logs nach `severity>=ERROR` filtern. Nach Deploy: Rollback. Sonst Google-Status prüfen.          |
| Arnold: Tool-Aufruf abgestürzt     | Ein Tool ist mit einer unerwarteten Ausnahme abgebrochen.        | Logzeile ansehen: Tool, Zeit, interne Nutzerkennung. Als Issue mit Label `beta-bug` an Worker B. |

Logs ansehen:

```bash
gcloud logging read 'resource.type="cloud_run_revision" AND resource.labels.service_name="arnold" AND severity>=WARNING' \
  --limit 50 --freshness 1h --format='table(timestamp,severity,jsonPayload.tool,jsonPayload.outcome,jsonPayload.code)'
```

Übungen (lösen den Alarm absichtlich aus, ändern nie die echten Regeln):

```bash
bash scripts/setup-monitoring.sh drill thrown   # synthetische Logzeile, echte Regel
bash scripts/setup-monitoring.sh drill 5xx      # gleiche Regel für 4xx, 8 Anfragen ohne Token
bash scripts/setup-monitoring.sh drill uptime   # Prüfung, die nie passt
bash scripts/setup-monitoring.sh drill-cleanup  # Übungsregeln entfernen
```

## Aufbewahrung

| Was                             | Wo                        | Wie lange                                |
| ------------------------------- | ------------------------- | ---------------------------------------- |
| Server- und Anfrage-Logs        | Cloud Logging `_Default`  | 30 Tage                                  |
| Verwaltungsprotokoll von Google | Cloud Logging `_Required` | 400 Tage (fest, enthält keine Nutzdaten) |
| Gelöschte Zustandsdateien       | Bucket, Soft Delete       | 7 Tage                                   |
| Journale, Einrichtung, Audit    | Bucket                    | 30 Tage (Arnold löscht selbst, B8/B15)   |

## Kosten

Kein Budgetalarm durch Claude möglich (keine Rechte am Abrechnungskonto). Kevin legt ihn an (K5): Abrechnung → Budgets und Benachrichtigungen → Budget erstellen, Projekt `arnold-513219`, 25 € pro Monat, Warnungen bei 50, 90 und 100 Prozent.
