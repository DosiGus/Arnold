# Arnold – Betrieb

Kurze Schrittfolgen für Deploy, Rollback, Wiederherstellung und Alarme. Hintergrund zu Profilen und Einrichtung: `docs/GUIDE.md`, Teil 2.

| Was         | Wert                                                                  |
| ----------- | --------------------------------------------------------------------- |
| Projekt     | `arnold-513219`                                                       |
| Region      | `europe-west1`                                                        |
| Dienst      | `arnold` (Cloud Run, Profil `arnold_database`, höchstens 1 Instanz)   |
| Adresse     | `https://arnold-789221393068.europe-west1.run.app/mcp`                |
| Daten       | Supabase Postgres (Frankfurt), Schema `arnold`                        |
| Geheimnisse | Secret Manager: `arnold-database-url` (optional `arnold-database-ca`) |
| Login       | WorkOS AuthKit                                                        |
| CI          | GitHub Actions, `.github/workflows/check.yml`                         |

Alle Befehle setzen `gcloud config set project arnold-513219` voraus.

## Deploy

Während der Beta: nur in ruhigen Zeiten und vorher ankündigen. Ein Deploy setzt keine Nutzerdaten zurück; sie liegen in der Datenbank. Braucht ein Stand eine neue Migration, zuerst `npm run db:migrate` (mit `DATABASE_ADMIN_URL`), dann deployen: Der Server startet nur auf genau dem erwarteten Schemastand.

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

- Ein Rollback tauscht nur den Code. Die Datenbank bleibt, wie der neue Stand sie geschrieben hat. Hat der neue Stand eine Migration gebracht, startet ein alter Stand nicht mehr (falsche Schemaversion); dann vorwärts reparieren statt zurückrollen.
- Solange der Traffic festgehalten ist, bekommt eine neue Revision keinen Traffic. Darum stellt das Deploy-Skript ihn immer auf `--to-latest`.

Geübt am 31.10.2026.

## Sicherung und Wiederherstellung

Die Daten liegen in Supabase. Supabase sichert die Datenbank täglich (Umfang und Aufbewahrung je nach Tarif; Point-in-Time-Recovery ist ein Zusatz). Wiederherstellen: Supabase-Dashboard → Database → Backups. Eine Wiederherstellung setzt die **ganze** Datenbank auf den gewählten Zeitpunkt zurück, also für alle Nutzer.

Einzelne Fehler lassen sich meist ohne Wiederherstellung beheben: Arnold löscht keine Trainingszeilen (verworfene Sätze bleiben als Tombstone), und `arnold.audit_events` zeigt, welche Änderung wann geschrieben wurde. Abfragen dafür nur mit der Owner-Verbindung im SQL-Editor von Supabase, nie mit `arnold_app`.

Das Passwort von `arnold_app` lässt sich jederzeit erneuern: `npm run db:setup -- arnold-513219` erneut ausführen, danach deployen.

## Alarme

Eingerichtet mit `bash scripts/setup-monitoring.sh` (wiederholbar). Die E-Mails gehen an das angemeldete `gcloud`-Konto oder an `ARNOLD_ALERT_EMAIL`.

| Alarm                              | Bedeutung                                                        | Erste Schritte                                                                                   |
| ---------------------------------- | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Arnold: /health nicht erreichbar   | `/health` antwortet aus mindestens zwei Regionen nicht mit `ok`. | `curl /health`. Logs ansehen (unten). Kam es direkt nach einem Deploy: Rollback.                 |
| Arnold: Serverfehler (5xx) gehäuft | Mehr als 4 Antworten 5xx in 5 Minuten.                           | Logs nach `severity>=ERROR` filtern. Nach Deploy: Rollback. Sonst Supabase-Status prüfen.        |
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

| Was                                        | Wo                        | Wie lange                                                                 |
| ------------------------------------------ | ------------------------- | ------------------------------------------------------------------------- |
| Server- und Anfrage-Logs                   | Cloud Logging `_Default`  | 30 Tage                                                                   |
| Verwaltungsprotokoll von Google            | Cloud Logging `_Required` | 400 Tage (fest, enthält keine Nutzdaten)                                  |
| Trainingsdaten, abgeschlossene Einrichtung | Supabase                  | bis der Nutzer sein Konto löscht                                          |
| Quittungen, Änderungsprotokoll             | Supabase                  | 30 Tage (`arnold.prune`, täglich)                                         |
| Nicht abgeschlossene Einrichtungen         | Supabase                  | bis Ablauf plus 30 Tage                                                   |
| Datenbank-Sicherungen                      | Supabase                  | je nach Tarif; gelöschte Konten bleiben dort bis zum Ablauf der Sicherung |

## Kosten

Kein Budgetalarm durch Claude möglich (keine Rechte am Abrechnungskonto). Kevin legt ihn an: Abrechnung → Budgets und Benachrichtigungen → Budget erstellen, Projekt `arnold-513219`, 25 € pro Monat, Warnungen bei 50, 90 und 100 Prozent. Supabase rechnet getrennt ab.
