# Arnold für Garmin – Technischer Bauplan

Stand: 9. November 2026 · Verantwortlich: Claude (Lead Developer)

Was gebaut wird, steht im [PRD](PRD.md). Hier steht, wie: Architektur, Schnittstelle, Datenbank, Uhr-App, Tests, Arbeitspakete, Reihenfolge und Abnahmen. Quellen und Messungen: [recherche/BERICHT.md](recherche/BERICHT.md) und [recherche/](recherche/).

## 0. Leitlinien

1. **Arnolds Regeln gelten unverändert** (CLAUDE.md). Auth und Daten scheitern geschlossen. Die Nutzer-ID kommt nur aus einem geprüften Token. Plan- und Workout-Schreibvorgänge laufen nur über `commitWrite`. Kennzahlen entstehen nur in `src/analytics`. Unbekannte Last ist unbekannt, nicht 0. Kalenderdaten kommen aus `workout_date_local`.
2. **Die Uhr rechnet nichts, was Arnold schon rechnet.** Vorschläge, Gewichtsschritte, Darstellung der Last, Alternativen, Rekorde und Kennzahlen kommen vom Server. Die Uhr zeigt an, erfasst und sendet Rohwerte.
3. **Offline zuerst.** Die Uhr ist während des Trainings die Quelle der Wahrheit. Der Server ist es nach dem Upload.
4. **Ein Upload, wiederholsicher.** Ein Training wird in einem Aufruf gesendet und kann beliebig oft wiederholt werden, ohne doppelt zu landen.
5. **Nur bauen, was auf dem Gerät bestätigt ist.** Alles, was die Recherche nicht belegen konnte, wird in B0 auf der FR255 gemessen, bevor es eingeplant wird.

## 1. Architektur

```
ChatGPT ── /mcp (WorkOS-JWT) ──────────────┐
  Tools: pair_garmin_watch, …             │
  Karten: Verlauf, Training, Konto        ▼
                                    Arnold-Server (Cloud Run, Express)
Garmin-Uhr                          ├─ /mcp            bestehend
  Connect-IQ-App „Arnold“           ├─ /api/watch/v1   NEU  (Uhr-Token)
   ├─ Plan-Cache                    │    ├─ pair/*     Kopplung (ohne Login, ratenbegrenzt)
   ├─ Trainingsplayer               │    ├─ plan       Vorschläge aller Trainingstage
   ├─ Satz-Journal                  │    ├─ workouts   Upload → log_workout (commitWrite)
   ├─ Outbox                        │    └─ health     Messwerte (nur mit Einwilligung)
   ├─ Aufzeichnung (FIT)            └─ Dienste: workout/, plan/, analytics/, auth/
   └─ Hintergrund-Sync                       │
        │                                    ▼
        └─ Bluetooth → Garmin-Connect-App → HTTPS
                                    Postgres (Supabase), Rolle arnold_app, RLS
```

- **Transport:** `Communications.makeWebRequest` über das gekoppelte Handy. HTTPS ist Pflicht, die Antworten sind JSON und klein (Ziel unter 8 KB).
- **Garmin Connect:** bekommt die FIT-Aktivität mit Puls und Kalorien direkt von der Uhr. Arnold hat damit nichts zu tun.
- **Keine Garmin-Server-API.** Developer Program und Connect IQ sind laut Garmin getrennte Programme.

## 2. Repository-Struktur

```
Arnold/
├── apps/garmin/                      NEU – Connect-IQ-App (Monkey C)
│   ├── manifest.xml                  App-ID, Geräteliste, Berechtigungen
│   ├── monkey.jungle                 Ressourcen je Gerät/Displaygröße
│   ├── resources/                    Texte (deu, eng), Icons, Layoutwerte
│   ├── source/
│   │   ├── ArnoldApp.mc              Lebenszyklus, Hintergrund-Einstieg
│   │   ├── core/                     Uhrzeit, IDs, Logging, Gerätefähigkeiten
│   │   ├── net/                      ApiClient (eine Warteschlange), Endpunkte
│   │   ├── store/                    Speicher-Schema, PlanCache, Journal, Outbox
│   │   ├── auth/                     Kopplung, Token
│   │   ├── player/                   Zustandsautomat, Pausentimer, Recorder, HealthCapture
│   │   ├── ui/                       Ansichten + Delegates, Theme, Layout, Format
│   │   └── bg/                       Hintergrunddienst (Outbox, Plan-Vorabruf)
│   ├── tests/                        Monkey-C-Tests (Test-Modul)
│   └── scripts/                      build.sh, test.sh, sideload.sh
├── src/server/watch/                 NEU – Router, Handler, Abbildung auf Dienste
├── src/server/auth/watch-token.ts    NEU – Prüfer für Uhr-Token
├── src/server/mcp-watch.ts           NEU – Tools für Kopplung, Uhren, Einwilligung
├── src/shared/watch-contract.ts      NEU – Zod-Verträge der Uhr-Schnittstelle
├── src/analytics/recording.ts        NEU – Kennzahlen aus Aufzeichnungen
├── src/analytics/alternatives.ts     NEU – ähnliche Übungen (heute in der UI)
├── db/migrations/003_garmin.sql      NEU
└── docs/garmin/                      PRD, Bauplan, Gerätematrix, Geräteprotokoll
```

`npm run check` bleibt der Merge-Maßstab für den Server. Die Uhr-App bekommt `npm run garmin:check` (Build für alle Geräte, Typprüfung, Tests). Das läuft lokal, solange es kein SDK auf dem CI-Server gibt (Lizenzfrage, siehe Abschnitt 13). `.prettierignore` schließt `apps/garmin` aus, falls Prettier dort Dateien findet.

## 3. Uhr-Schnittstelle `/api/watch/v1`

Alle Verträge als Zod-Schemas in `src/shared/watch-contract.ts`. Antworten tragen `api_version` und `min_app_version`.

| Methode | Pfad                              | Auth                     | Zweck                                                                                       |
| ------- | --------------------------------- | ------------------------ | ------------------------------------------------------------------------------------------- |
| POST    | `/pair/start`                     | keine, ratenbegrenzt     | Kopplung beginnen: `device_code` (geheim), `user_code` (Anzeige), `expires_in`, `interval`  |
| POST    | `/pair/token`                     | `device_code`            | Abfragen: `pending`, `slow_down`, `expired` oder `{access_token, device_id, account_label}` |
| GET     | `/device`                         | Uhr-Token                | Status: gekoppelt, Einwilligung Messwerte, Serverzeit, `min_app_version`                    |
| DELETE  | `/device`                         | Uhr-Token                | Uhr meldet sich selbst ab                                                                   |
| GET     | `/plan`                           | Uhr-Token                | Aktiver Plan: alle Trainingstage mit Vorschlag, nächster Tag, ETag                          |
| POST    | `/workouts`                       | Uhr-Token                | Training speichern (wiederholsicher) und Zusammenfassung zurück                             |
| PUT     | `/workouts/{session_uuid}/health` | Uhr-Token + Einwilligung | Messwerte zum Training (Upsert)                                                             |

### 3.1 Gemeinsame Regeln

- **Header:** `Authorization: Bearer arn_w_…`, `Accept-Language: de|en`, `X-Arnold-Watch: <app-version>/<device-part-number>`. Body nur `application/json`, sonst 415. Body-Grenze 64 KB pro Route.
- **Fehlerform:** `{ "error": { "code": "…", "retryable": bool, "message": "<übersetzt>" } }`. Codes: `AUTH_REQUIRED` (401, Uhr zeigt „Neu verbinden“), `UPGRADE_REQUIRED` (426), `RATE_LIMITED` (429 mit `Retry-After`), `SETUP_REQUIRED`, `NO_ACTIVE_PLAN`, `DUPLICATE_WORKOUT`, `DUPLICATE_OPERATION`, `VALIDATION_ERROR`, `CONSENT_REQUIRED`, `WORKOUT_PENDING` (409), `CONFIRMATION_REQUIRED`, `SCHEMA_MISMATCH`, `STORAGE_UNAVAILABLE` (503, wiederholbar). Fehlertexte verraten nie, ob ein Token existiert.
- **Wie die Uhr reagiert:**
  - `CONFIRMATION_REQUIRED` (ungewöhnlicher Wert, z. B. über 500 kg oder 100 Wiederholungen): Die Uhr fragt „Stimmt das?“. Ein Ja sendet eine **neue** `request_id` mit `confirm_unusual_values: true`; ein Nein führt zurück zur Zusammenfassung.
  - `SCHEMA_MISMATCH` beim erneuten Senden heißt: Das Training ist angekommen und wurde inzwischen in ChatGPT geändert. Die Uhr behandelt es als gesendet.
  - `DUPLICATE_OPERATION` darf bei eingefrorenen Anfragen nicht vorkommen. Kommt er doch, ist das ein Fehler, der mit dem Fehlercode gemeldet wird, und der Outbox-Eintrag bleibt zur Klärung liegen.
- **Größen:** Gewichte reisen als ganze **Gramm** (`load_g`), damit keine Kommazahl auf der Uhr anders serialisiert wird. Der Server rechnet in kg um.
- **Texte:** Alles, was die Uhr wörtlich anzeigt, also Hinweise, Lastdarstellung und Zusammenfassung, liefert der Server in der angefragten Sprache. Die Darstellung der Last kommt aus `src/shared/arnold-format.ts`, wie es die Regel dort verlangt.

### 3.2 `GET /plan` – Antwort (gekürzt)

```json
{
  "api_version": 1,
  "plan_version_id": "plv_…",
  "generated_at_utc": "2026-11-09T06:00:00Z",
  "next_session_id": "s2",
  "sessions": [
    {
      "session_id": "s2",
      "name": "Push A",
      "est_minutes": 55,
      "exercises": [
        {
          "plan_item_id": "pli_…",
          "exercise_id": "exc_…",
          "name": "Bankdrücken",
          "rest_s": 120,
          "step_g": 2500,
          "load": { "basis": "total", "prefix": "", "suffix": "" },
          "reps_basis": "total",
          "sets": [[8, 60000, "both"], [8, 60000, "both"], [8, 60000, "both"]],
          "rep_range": [6, 10],
          "missing": [],
          "hint": "Heute +2,5 kg",
          "last": "Letztes Mal 8 · 8 · 7 mit 57,5 kg",
          "note": "Schulterblätter zusammen",
          "alternatives": [
            { "exercise_id": "exc_…", "name": "Kurzhantel-Bankdrücken", "step_g": 2000,
              "load": { "basis": "per_implement", "prefix": "2 × ", "suffix": "" },
              "sets": [[10, 22000, "both"]] }
          ]
        }
      ]
    }
  ],
  "recent_exercises": [ { "exercise_id": "exc_…", "name": "Face Pulls", "step_g": 2500, "load": {…}, "sets": [[15, 20000, "both"]] } ]
}
```

- **Quelle:** `proposeActivePlan` aus `src/server/workout/proposal.ts` (Progression, sonst letztes Mal, sonst Planziel). `rest_s` kommt aus `plan_items.rest_seconds` (fehlt er: 120 s, wie im Editor). `step_g` kommt aus `weightStep` in `src/analytics/progression.ts`. Den nächsten Tag bestimmt `nextSession` aus `src/analytics/home.ts`, das dafür exportiert wird. Die Alternativen liefert das neue `src/analytics/alternatives.ts`; die Logik wandert dazu aus `src/ui/components/plan-day.tsx` dorthin, und UI und Uhr nutzen danach dieselbe Funktion.
- **ETag:** ein Hash über die Antwort. Bei `If-None-Match` antwortet der Server mit 304 und schickt keinen Inhalt.
- **Größenbudget:** ein Trainingstag mit 6 × 4 unter 1,5 KB, der ganze Plan mit 5 Tagen und Alternativen unter 8 KB. Ein Test erzwingt das.

### 3.3 `POST /workouts` – Anfrage

```json
{
  "request_id": "gw_6f1c…",
  "session_uuid": "6f1c…",
  "plan_version_id": "plv_…",
  "session_id": "s2",
  "workout_date_local": "2026-11-09",
  "utc_offset_min": 60,
  "started_at_utc": "2026-11-09T17:02:11Z",
  "ended_at_utc": "2026-11-09T17:58:40Z",
  "confirm_duplicate": false,
  "exercises": [
    { "plan_item_id": "pli_…", "exercise_id": "exc_…",
      "sets": [ { "reps": 8, "load_g": 62500, "side": "both", "t0": 1731171731, "t1": 1731171771 } ] },
    { "plan_item_id": "pli_…", "skip": true },
    { "exercise_id": "exc_…", "sets": [ … ] }
  ]
}
```

**Ablauf im Handler:**

1. Die Anfrage wird geprüft und auf `log_workout` abgebildet. Jede Übung schickt immer ausdrücklich ihre Sätze mit, damit nichts vom Vorschlag zum Zeitpunkt des Uploads abhängt. Ein Tausch ist `plan_item_id` plus andere `exercise_id`. Eine Zusatzübung kommt ohne `plan_item_id`.
2. `source` setzt der Server auf `sync`; den Wert gibt es im Schema schon. Die Uhr kann ihn nicht beeinflussen.
3. `log_workout` läuft über `WorkoutLoggingService.execute` und damit über `commitWrite` mit `request_id`. Kommt dieselbe Anfrage noch einmal, liefert der Server das gespeicherte Ergebnis mit `replayed: true`.
4. Im selben Schreibvorgang landen die Satzzeiten und die Uhr-Herkunft (Abschnitt 4.2).
5. Die Antwort enthält `workout_id`, `replayed` und eine Zusammenfassung aus `src/analytics`: neue Rekorde und den Vorschlag fürs nächste Mal je Übung. Die Texte sind übersetzt.

**Nötige Änderungen an `log_workout`:**

- optionale Felder `started_at_utc` und `ended_at_utc`, geprüft wie in `complete_workout`;
- `source` ist für Aufrufe aus `/mcp` weiter nur `chat|ui`; die Uhr-Route setzt `sync` intern;
- ein internes Feld `client_session_id`, siehe 4.2.

**Doppelte Trainings:** Liegt dasselbe Training am selben Tag schon vor, zum Beispiel aus dem Chat, antwortet der Server mit `DUPLICATE_WORKOUT`. Die Uhr fragt dann „Trotzdem speichern“ oder „Verwerfen“. „Trotzdem“ sendet eine **neue** `request_id` mit `confirm_duplicate: true`. Die alte Anfrage bleibt unverändert, so gibt es keinen `DUPLICATE_OPERATION`-Konflikt.

**Zeitzone:** `log_workout` braucht eine IANA-Zeitzone wie „Europe/Berlin“. Connect IQ liefert vermutlich nur den Versatz zur UTC-Zeit; das wird in B0 geprüft. Die Lösung:

1. Bei der Kopplung speichert Arnold die Zeitzone des Kontos am Gerät. ChatGPT übergibt sie beim Tool-Aufruf, genau wie heute bei `log_workout`.
2. Beim Upload prüft der Server, ob der Versatz der Uhr zu dieser Zeitzone am Trainingstag passt. Wenn ja, nimmt er sie.
3. Wenn nicht, zum Beispiel auf Reisen, nimmt er bei ganzen Stunden `Etc/GMT±H`. In allen anderen Fällen lehnt er mit `VALIDATION_ERROR` ab, und die Uhr bittet, die Zeitzone in ChatGPT zu aktualisieren.

Das Kalenderdatum kommt immer wörtlich von der Uhr.

### 3.4 `PUT /workouts/{session_uuid}/health`

```json
{
  "hr": { "interval_s": 5, "start_utc": "2026-11-09T17:02:11Z", "values": [92, 95, 0, 118, …] },
  "calories_kcal": 312,
  "before": { "at_utc": "…", "body_battery": 64, "stress": 31, "resting_hr": 52, "…": "…" },
  "after":  { "at_utc": "…", "body_battery": 48, "stress": 45 },
  "extras": { "training_effect_aerobic": 2.1, "recovery_time_h": 18 }
}
```

- **Fail closed:** Ohne aktive Einwilligung kommt 403 `CONSENT_REQUIRED`, und nichts wird gespeichert. Die Uhr fragt den Status über `GET /device` ab und sendet dann gar nicht erst.
- **Fehlende Werte:** Ein fehlender Wert fehlt im Objekt oder ist `null`. Im Pulsverlauf steht `0` für „keine Messung“; Arnold speichert ihn als Lücke, nie als Wert.
- **Upsert:** über `(user_id, client_session_id)`. Ein erneutes Senden ersetzt die Messwerte vollständig. Wirkt die Anfrage vor dem Training, weil das Training noch nicht angekommen ist, antwortet der Server mit 409 `WORKOUT_PENDING`, und die Uhr versucht es später.
- **Größe:** Zwei Stunden Puls in 5-Sekunden-Schritten sind 1.440 ganze Zahlen, also etwa 6 KB. Wird das Budget in B0 knapp, sendet die Uhr in Teilen (`part`, `parts`).
- **Kennzahlen:** Ø/Max-Puls, Zeit in Zonen und Pausentreue berechnet `src/analytics/recording.ts` beim Lesen. Gespeichert werden nur Rohwerte.

## 4. Datenbank – Migration `003_garmin.sql`

Nach dem Muster von `001` und `002`. `EXPECTED_SCHEMA_VERSION` wird 3. Die Migration kommt vor dem Deploy, wie in `docs/BETRIEB.md` beschrieben.

### 4.1 Neue Tabellen

| Tabelle                     | Inhalt                                                                                                                                                                                                              | Zugriff                                                                                                          |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `arnold.watch_devices`      | `user_id`, `device_id` (`wdv_<uuid>`), `token_hash bytea unique`, `label` (z. B. „Forerunner 255“), `part_number`, `app_version`, `timezone`, `status` (active/revoked), `created_at`, `last_used_at`, `revoked_at` | RLS `own_rows`; `select, insert, update` für `arnold_app`; ein Widerruf ist ein Update, keine Löschung           |
| `arnold.watch_pairings`     | `pairing_id`, `device_code_hash`, `user_code_hash`, `status` (pending/approved/consumed/expired), `user_id null` bis zur Bestätigung, `device_label`, `expires_at`, `attempts`                                      | **keine** direkten Rechte für `arnold_app`; nur über SECURITY-DEFINER-Funktionen (siehe unten)                   |
| `arnold.health_consents`    | `user_id`, `scope` (`garmin_health`), `text_version`, `granted_at`, `revoked_at`                                                                                                                                    | RLS `own_rows`; `select, insert, update`                                                                         |
| `arnold.workout_recordings` | `user_id`, `client_session_id`, `device_id`, `started_at_utc`, `ended_at_utc`, `set_timings jsonb` (je Satz: Übungs- und Satzindex, Start, Ende, Pause davor), `app_version`                                        | RLS `own_rows`; Bezug `(user_id, device_id)`                                                                     |
| `arnold.workout_health`     | `user_id`, `client_session_id`, `hr jsonb`, `calories_kcal`, `before jsonb`, `after jsonb`, `extras jsonb`, `received_at`                                                                                           | RLS `own_rows`; nur mit Einwilligung beschreibbar (vom Server erzwungen); bei Widerruf der Einwilligung gelöscht |

**Ausnahme Kopplung:** `watch_pairings` existiert, bevor ein Nutzer bekannt ist. Deshalb gilt dort dasselbe Muster wie bei `arnold.resolve_identity`: keine Tabellenrechte, nur diese Funktionen mit `search_path = ''`, EXECUTE nur für `arnold_app`:

- `arnold.start_watch_pairing(p_device_code_hash, p_user_code_hash, p_label, p_ttl)`
- `arnold.approve_watch_pairing(p_user_code_hash)`: läuft unter `asUser` und nimmt den Nutzer aus `arnold.current_user_id()`, nie aus einem Argument;
- `arnold.redeem_watch_pairing(p_device_code_hash, p_token_hash, p_device_id)`: legt das Gerät an und verbraucht die Kopplung genau einmal;
- `arnold.resolve_watch_token(p_token_hash)`: liefert `user_id, device_id, scopes` nur für aktive Geräte aktiver Konten und setzt `last_used_at` höchstens stündlich.

Abgelaufene Kopplungen räumt `arnold.prune` auf.

### 4.2 Änderung an `workouts`

Neue, optionale Spalte `client_session_id text`. Sie kommt in das Schema `ArnoldWorkoutSchema` (`src/shared/arnold-schema-v1.ts`) und einen partiellen Unique-Index `(user_id, client_session_id) where status = 'completed'`.

**Warum:** `workout_recordings` und `workout_health` hängen an `client_session_id`, nicht an `workout_id`. Ersetzt der Nutzer das Training in ChatGPT (`replaces_workout_id`), übernimmt der Ersatz die `client_session_id` im selben `commitWrite`. Die Messwerte wandern so automatisch mit, ohne zweiten Schreibvorgang.

`workout_recordings` wird im selben `commitWrite` wie das Training geschrieben. Dazu bekommt der Commit des Stores einen kleinen, typisierten Zusatz für Uhr-Aufzeichnungen. Das ist eine Transaktion mit Audit und Quittung, wie CLAUDE.md es verlangt.

### 4.3 Konto-Oberfläche

- `DatabaseArnoldRuntime.storedData` bekommt die Punkte „Gekoppelte Uhren“, „Uhr-Aufzeichnungen“ und „Messwerte von der Uhr“.
- Die Zusammenfassung vor der Kontolöschung nennt die neuen Daten. Die Kaskade über `arnold.users` erfasst alle neuen Tabellen.
- `tests/db-security.test.ts` erweitert die Liste der Nutzertabellen.

## 5. Authentifizierung und Kopplung

**Uhr-Token:** `arn_w_` plus 32 zufällige Bytes in base64url. Gespeichert wird nur `sha256(token)`. Rechte sind die neuen Scopes `arnold.watch.read` und `arnold.watch.write`. Kein Scope schließt einen anderen ein.

**Prüfer** `src/server/auth/watch-token.ts`:

1. Den Header prüfen, dann `resolve_watch_token`.
2. Daraus einen `AuthenticatedArnoldContext` bauen: `issuer = "arnold.watch/1"`, `subject = device_id`, `clientId = "arnold-garmin"`, Scopes wie oben.
3. Danach `DatabaseArnoldRuntime.forUser`. Das ruft `assertActive` bei jedem Aufruf auf.

Fehlende, falsche oder widerrufene Token ergeben 401 mit allgemeiner Antwort. Ein Datenbankfehler beim Nachschlagen ergibt 503, nie einen Durchlass.

**Strikte Trennung:**

- `/mcp` nimmt weiter nur WorkOS-JWTs; ein Uhr-Token wird dort abgewiesen.
- `/api/watch/v1` nimmt nur Uhr-Token; ein WorkOS-JWT wird dort abgewiesen.
- Der Router wird nur eingehängt, wenn eine Datenbank konfiguriert ist und `AUTH_MODE=oidc` gilt.

**Zugriffsklassen:** Eine neue Tabelle `WATCH_ROUTE_ACCESS` neben `TOOL_ACCESS` ordnet jeder Route ihre Klasse zu. Eine Route ohne Eintrag wirft beim Start.

**Kopplung:**

1. `pair/start`: Die Uhr erhält `device_code` (32 Byte, bleibt auf der Uhr) und `user_code`. Der `user_code` hat 8 Zeichen aus `23456789ABCDEFGHJKMNPQRSTUVWXYZ` und wird als `XXXX-XXXX` angezeigt. Er gilt 10 Minuten.
2. In ChatGPT: `pair_garmin_watch({ user_code, timezone })`. Das Tool zeigt eine Bestätigungskarte mit Uhrenmodell und Zeitpunkt. Erst der Klick bestätigt, nach dem zweistufigen Muster von `delete_arnold_account`.
3. `pair/token`: Die Uhr fragt alle 5 Sekunden ab und erhält einmalig das Token sowie `account_label`, einen gekürzten Kontonamen. So sieht der Nutzer auf der Uhr, mit welchem Konto sie verbunden ist.

**Schutz:**

| Gegen                       | Maßnahme                                                                 |
| --------------------------- | ------------------------------------------------------------------------ |
| Durchprobieren von Codes    | höchstens 5 Fehlversuche je Konto und Stunde in `approve`; danach Sperre |
| Missbrauch von `pair/start` | höchstens 10 Kopplungsstarts je IP und Stunde                            |
| zu schnelles Abfragen       | `pair/token` antwortet mit `slow_down`                                   |
| Token-Missbrauch            | 120 Anfragen je Token und Minute                                         |

Die Ratenbegrenzung liegt vorerst im Speicher. Das reicht bei `--max-instances 1`; für mehrere Instanzen muss sie in die Datenbank (B7).

**Leitfaden:** In `docs/GUIDE.md` steht heute: „Arnold ist Resource Server … stellt keine aus.“ Das wird ergänzt: Arnold gibt zusätzlich eigene, eng begrenzte Gerätetoken für die Uhr aus. Die Entscheidung wird dort mit Begründung festgehalten.

## 6. Server-Module

| Datei                            | Aufgabe                                                                                                        | Nutzt                                                                                            |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `src/server/watch/router.ts`     | Router, JSON-Grenze, 415, Ratenbegrenzung, Logging (Route, Ergebnis, Dauer, Nutzer, Code; nie Token oder Body) | `http.ts` hängt ihn vor dem 404 ein                                                              |
| `src/server/watch/pairing.ts`    | Kopplung start/token                                                                                           | SQL-Funktionen aus 003                                                                           |
| `src/server/watch/plan.ts`       | `GET /plan` → schlankes DTO, ETag                                                                              | `source.load`, `proposeActivePlan`, `nextSession`, `weightStep`, `alternatives`, `arnold-format` |
| `src/server/watch/workouts.ts`   | Upload → `log_workout`, Antwort-Zusammenfassung                                                                | `WorkoutLoggingService`, `exclusive`, `analytics/records`                                        |
| `src/server/watch/health.ts`     | Messwerte mit Einwilligungsprüfung                                                                             | `health_consents`, `workout_health`                                                              |
| `src/server/watch/i18n.ts`       | Texte der Uhr-Antworten de/en                                                                                  | –                                                                                                |
| `src/server/auth/watch-token.ts` | Prüfer, Kontextaufbau                                                                                          | `identity.ts`, `runtime.ts`                                                                      |
| `src/server/mcp-watch.ts`        | Tools `pair_garmin_watch`, `list_garmin_watches`, `unpair_garmin_watch`, `set_garmin_health_consent`           | `ACCOUNT_MANAGEMENT` in `tool-access.ts`                                                         |
| `src/analytics/recording.ts`     | Ø/Max-Puls, Zonen, Pausentreue, vor/nach-Vergleich                                                             | rein, ohne I/O                                                                                   |
| `src/analytics/alternatives.ts`  | ähnliche Übungen (aus der UI hierher verschoben)                                                               | rein, ohne I/O                                                                                   |

Schreibende Uhr-Routen laufen in `database.exclusive(context, …)`, lesende in `withArnoldContext`. Das ist dasselbe Muster wie bei `/mcp`.

## 7. Die Uhr-App

### 7.1 Geräte und Berechtigungen

- **Typ:** `watch-app`, Mindest-API 5.0.
- **Geräte:** `fr255`, `fr255s`, `fr255m`, `fr255sm`, `fr265`, `fr265s`, `fr955`, `fr965`, `fenix7`, `fenix7s`, `fenix7x`. Die genauen Produktkennungen werden in B0 aus dem SDK übernommen.
- **Berechtigungen:** `Communications`, `Background`, `Sensor`, `SensorHistory`, `FitContributor`, `UserProfile`. `Positioning` wird nicht gebraucht.
- **Displays:** 218, 240, 260 und 280 px (MIP) sowie 416 und 454 px (AMOLED). Alle Maße werden relativ zur Displaygröße berechnet, mit festen Stufen für die Schrift. AMOLED-Geräte bekommen ein dunkles Theme und keine dauerhaft hellen Flächen, um Einbrennen zu vermeiden.

### 7.2 Zustandsautomat des Players

```
UNPAIRED → PAIRING → READY
READY → SESSION_PICK → PREVIEW(ex) → SET(ex,s) ─START→ REST(ex,s+1) ─Ende/START→ SET(ex,s+1)
                                   └─ letzte Übung fertig / „beenden“ → SUMMARY → SAVED → (Upload) → DONE
jeder Zustand ─Absturz/Beenden→ beim Start: RESUME? → zurück in den gespeicherten Zustand
```

Der Zustand liegt als kleiner Eintrag `sess:<uuid>:head` im Speicher. Er wird bei jedem Übergang geschrieben, bevor die Anzeige wechselt.

### 7.3 Speicher-Schema (`Application.Storage`)

| Schlüssel          | Inhalt                                                                                             | Größe           |
| ------------------ | -------------------------------------------------------------------------------------------------- | --------------- |
| `schema`           | Versionsnummer des Speicher-Schemas, mit Migrationen                                               | 1 Zahl          |
| `auth`             | Token, `device_id`, `account_label`                                                                | < 200 B         |
| `plan`             | letzte `/plan`-Antwort plus ETag und Zeitpunkt                                                     | < 8 KB          |
| `sess:<uuid>:head` | Zustand, Plan-Kopie des Trainings, Start, Offset                                                   | < 4 KB          |
| `sess:<uuid>:<n>`  | ein Eintrag je Satzereignis: bestätigt, korrigiert, entfernt (Übung, Satz, Wdh., g, Seite, t0, t1) | < 100 B         |
| `out:<id>`         | fertige Upload-Anfrage, **eingefroren**, plus Art, Versuche, letzter Fehler                        | < 8 KB          |
| `hr:<uuid>:<k>`    | Pulswerte in Blöcken                                                                               | < 4 KB je Block |
| `settings`         | Vibration, Ton, Vorwarnung                                                                         | klein           |

- Jeder Wert bleibt unter 32 KB. Das Journal hängt nur an und schreibt große Blöcke nie neu.
- Nach dem bestätigten Upload werden Journal, Pulsblöcke und Outbox-Eintrag gelöscht. Bleibt ein Eintrag 14 Tage liegen, fragt die Uhr nach.
- „Eingefroren“ heißt: Die Anfrage wird beim Speichern einmal gebaut und danach nie verändert. So landen Wiederholungen beim Server als dieselbe Anfrage.

### 7.4 Tastenbelegung (Forerunner 255; in B0 auf dem Gerät bestätigen)

| Ansicht         | START                     | ZURÜCK              | HOCH                        | RUNTER      | HOCH halten                      |
| --------------- | ------------------------- | ------------------- | --------------------------- | ----------- | -------------------------------- |
| Start           | Training beginnen         | App beenden         | anderer Tag                 | anderer Tag | Einstellungen, Sync, Uhr trennen |
| Übungsvorschau  | los                       | Training pausieren? | –                           | –           | Menü                             |
| Satz            | Satz fertig wie angezeigt | Training pausieren? | Sätze der Übung (Korrektur) | Anpassen    | Menü                             |
| Anpassen        | nächstes Feld / speichern | abbrechen           | Wert +                      | Wert −      | –                                |
| Pause           | Pause beenden             | Training pausieren? | +15 s                       | −15 s       | Menü                             |
| Zusammenfassung | speichern                 | zurück ins Training | Seite                       | Seite       | Verwerfen (zweimal bestätigen)   |

- Die LICHT-Taste bleibt beim System.
- Das „Menü“ enthält: Übung überspringen, Übung tauschen, Satz hinzufügen, Satz entfernen, Hinweise, Training beenden.
- Gewichtsänderungen springen um `step_g` vom Server. Wiederholungen springen um 1.
- Bei einseitigen Übungen zeigt die Satzansicht „Links“ oder „Rechts“ und führt beide Seiten als eigene Sätze, wie der Vorschlag sie liefert.

### 7.5 Aufzeichnung (`player/Recorder.mc`)

- Die Aktivität startet mit „Training beginnen“: `ActivityRecording.createSession` mit Sport Training und Unterart Krafttraining. Garmin markiert die alten Konstanten als veraltet; verwendet werden die Konstanten aus `Activity`.
- Je bestätigtem Satz kommt eine Runde. Wiederholungen und Gewicht gehen als FitContributor-Felder in die Runde (H-07).
- Pausieren pausiert die Aufzeichnung. Speichern beendet sie mit `save`, Verwerfen mit `discard`.
- Ob eine Aufzeichnung einen Absturz übersteht, wird in B0 geprüft. Falls nicht, startet die Uhr nach „Fortsetzen“ eine zweite Aufzeichnung. Arnold bleibt davon unberührt, weil das Journal die Wahrheit ist.

### 7.6 Messwerte (`player/HealthCapture.mc`)

- **Vor dem Training:** Beim Start liest die Uhr einmal die letzten Werte, für jeden Wert, den die Gerätematrix freigibt. Gefragt wird zur Laufzeit (`has :getBodyBatteryHistory` usw.); fehlt etwas, bleibt der Wert leer.
- **Während des Trainings:** Puls alle 5 Sekunden in Blöcke.
- **Nach dem Training:** dieselben Werte noch einmal beim Speichern, und, wenn die App bis dahin offen ist, nach 10 Minuten ein dritter Messpunkt (S-Priorität).
- Ist die Einwilligung aus, liest die Uhr nur den Live-Puls für die Anzeige und speichert nichts davon.

### 7.7 Netz (`net/ApiClient.mc`)

- Es gibt genau **eine** Warteschlange; eine Anfrage nach der anderen, weil parallele Anfragen auf Garmin-Geräten scheitern.
- Zeitlimit und Wiederholung mit Pause dazwischen: 5 s, 30 s, 2 min, danach beim nächsten Anlass. Fehler `-104` (kein Handy) zählt nicht als Versuch.
- Reihenfolge der Outbox: zuerst Trainings, dann Messwerte. Messwerte warten, bis ihr Training bestätigt ist.
- Unter iOS muss Garmin Connect laufen. Die Uhr zeigt dann „Handy: Garmin Connect öffnen“ statt eines allgemeinen Fehlers.

### 7.8 Hintergrund (`bg/`)

- Solange die Outbox nicht leer ist, wacht der Hintergrunddienst alle 15 Minuten auf und sendet **einen** Eintrag (Laufzeitgrenze etwa 30 s).
- Einmal am Tag ruft er den Plan per ETag ab.
- Ist die Outbox leer, ist kein Weckruf registriert. Das schont den Akku.

### 7.9 Texte und Sprache

- `resources-deu/strings.xml` und `resources-eng/strings.xml`. Die Uhr wählt nach Systemsprache, Englisch ist der Rückfall.
- Serverseitige Texte kommen in der Sprache aus `Accept-Language`.

## 8. ChatGPT-Seite

| Teil               | Änderung                                                                                                                                                                                                                                                                          |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tools              | `pair_garmin_watch` (zweistufig mit Karte), `list_garmin_watches`, `unpair_garmin_watch`, `set_garmin_health_consent`; alle `ACCOUNT_MANAGEMENT`; Tests in `auth-tool-access` und `tool-annotations`                                                                              |
| Karten             | Konto-Karte: Bereich „Garmin-Uhr“ mit Status, letzter Kontakt, Trennen. Verlauf und Trainingsdetail: Abzeichen „Von der Uhr“, Dauer, Pausen Ist gegen Plan, Pulskurve (kleines SVG), Body Battery und Stress vor/nach. Alles aus Presenter-Daten, die UI rechnet nicht.           |
| Presenter          | `get_arnold_workouts` und das Trainingsdetail liefern die Aufzeichnungs-Kennzahlen aus `src/analytics/recording.ts` mit.                                                                                                                                                          |
| Skills             | `arnold-coach`: wann Messwerte erwähnt werden (nur vorhandene, nie medizinisch deuten). `arnold-trainingsplan`: Pausenzeiten je Übung setzen, denn die Uhr nutzt sie. `trainingswissenschaft.md` bleibt in beiden Skills gleich. `tests/plugin-skills.test.ts` muss grün bleiben. |
| Server-Anweisungen | Kurzer Absatz: Uhr koppeln über `pair_garmin_watch`; Uhr-Trainings sind normale Trainings.                                                                                                                                                                                        |

## 9. Tests

### 9.1 Server (Vitest, läuft in `npm run check`)

| Datei                                   | Prüft                                                                                                                                                                                                                                                                |
| --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tests/db-garmin.test.ts`               | RLS auf allen neuen Tabellen; `arnold_app` kann `watch_pairings` nicht direkt lesen; `resolve_watch_token` liefert nichts für widerrufene Geräte und gesperrte Konten; Kaskade bei Kontolöschung                                                                     |
| `tests/watch-http.test.ts`              | 401 ohne, mit falschem oder mit widerrufenem Token; Uhr-Token auf `/mcp` abgewiesen und JWT auf `/api/watch/v1` abgewiesen; zwei Nutzer sehen nie den Tag des anderen; 415 und 413; 429 mit `Retry-After`                                                            |
| `tests/watch-pairing.test.ts`           | ganzer Ablauf; Ablauf nach 10 min; Code nur einmal einlösbar; Versuchsgrenze; Bestätigung nur mit Login                                                                                                                                                              |
| `tests/watch-plan.test.ts`              | DTO entspricht `proposeActivePlan`; `rest_s`- und `step_g`-Regeln; fehlende Last bleibt `missing`; ETag und 304; Größenbudget                                                                                                                                        |
| `tests/watch-workouts.test.ts`          | Upload landet einmal; Wiederholung liefert `replayed`; geänderter Body mit gleicher ID ergibt `DUPLICATE_OPERATION`; `DUPLICATE_WORKOUT` und „trotzdem“; Zeitzonenregel; `DATE_IN_FUTURE`; Einrichtung fehlt; Tausch, Auslassen, Zusatzübung; Gramm-zu-kg-Umrechnung |
| `tests/watch-health.test.ts`            | ohne Einwilligung 403 und nichts gespeichert; Upsert; Lücken bleiben Lücken; Widerruf löscht; Ersatz in ChatGPT nimmt die Messwerte mit                                                                                                                              |
| `tests/analytics-recording.test.ts`     | Kennzahlen aus Rohwerten, inklusive Lücken                                                                                                                                                                                                                           |
| `tests/log-privacy.test.ts` (erweitert) | Token, Codes und Bodies erscheinen nie in Logs                                                                                                                                                                                                                       |
| `tests/db-journey.test.ts` (erweitert)  | Uhr koppeln über `/mcp`, Plan holen, Training senden, in `get_arnold_workouts` sehen                                                                                                                                                                                 |

### 9.2 Uhr-App (`npm run garmin:check`)

- **Build** für alle Zielgeräte mit strenger Typprüfung, ohne Warnungen.
- **Unit-Tests** mit dem Test-Modul: Zustandsautomat einschließlich Fortsetzen, Journal zu Anfrage, Einfrieren und erneutes Senden, Outbox-Reihenfolge, Pausentimer nach Zeitstempeln, Formatierung, Zeitzonen-Felder.
- **Simulator-Durchlauf** je Displaygröße: koppeln (gegen eine Test-Revision auf HTTPS), Training durchspielen, Flugmodus simulieren, Speicherspitze ablesen. Die Screenshots kommen in den PR.

### 9.3 Geräteprotokoll FR255 (`docs/garmin/GERAETEPROTOKOLL.md`)

Jede Uhr-Version durchläuft vor der Freigabe dieses Protokoll im Studio:

1. Koppeln.
2. Training nach Plan mit 6 Übungen.
3. Zwei Anpassungen, ein Tausch, eine ausgelassene Übung.
4. Training ganz im Flugmodus.
5. App mitten im Satz beenden und fortsetzen.
6. Akku vorher und nachher.
7. Upload nach Rückkehr des Handys.
8. Kontrolle in ChatGPT und Garmin Connect.

## 10. Team und Arbeitspakete

Ich führe das Projekt und arbeite mit parallelen Sessions in eigenen Git-Worktrees. Jede Spur hat eigene Dateien, damit sich niemand in die Quere kommt. Ich prüfe, merge und deploye. Vor jedem Start prüfe ich `git worktree list`, wie CLAUDE.md es verlangt.

| Spur                        | Inhalt                                                                                                         | Dateien                                                                                                         | Hängt ab von                                                                                           |
| --------------------------- | -------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| **A – Server**              | Migration 003, Uhr-Token, Kopplung, `/api/watch/v1`, `log_workout`-Erweiterungen, Analytics, Tests             | `db/`, `src/server/watch/`, `src/server/auth/watch-token.ts`, `src/server/workout/`, `src/analytics/`, `tests/` | Vertrag (B1)                                                                                           |
| **B – Uhr-App**             | alles unter `apps/garmin/`                                                                                     | nur `apps/garmin/`                                                                                              | Vertrag (B1); arbeitet bis A fertig ist gegen einen Mock-Server (`apps/garmin/scripts/mock-server.ts`) |
| **C – ChatGPT**             | Tools, Karten, Presenter, Skills, Server-Anweisungen                                                           | `src/server/mcp-watch.ts`, `src/ui/`, `plugins/arnold/`, Presenter                                              | A (Tabellen und Dienste)                                                                               |
| **D – Betrieb und Release** | Alarme, Ratenbegrenzung im Betrieb, Monitoring der Uhr-Routen, Store-Eintrag, Datenschutztext, Geräteprotokoll | `scripts/`, `docs/`, Store-Material                                                                             | A für die Alarme                                                                                       |

Die Reihenfolge der Merges: Vertrag → A → C → B. B wird erst gemergt, wenn A live ist, denn erst dann funktioniert die Uhr gegen den echten Server.

## 11. Bauabschnitte

Die Aufwände sind meine Schätzung in Arbeitstagen mit Claude Code. Belastbare Vergleichswerte gibt es für Monkey C nicht.

|        | Abschnitt                           | Inhalt                                                                                                                                                                                                                                                                                                                                                                                                                      | Abnahme                                                                                                                    | Aufwand                                     |
| ------ | ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| **B0** | Gerät und Grundlagen                | Java und Connect IQ SDK installieren, Entwicklerschlüssel, Hallo-Welt auf der FR255 per USB. Eine Mess-App misst: App-Speicher, Grenze für `-402`, Länge der Verläufe, Ruhepuls, Zeitzone (IANA oder nur Versatz), Tasten während der Aufzeichnung, Vibration und Ton, Hintergrund-Laufzeit, Verhalten nach Absturz, iOS oder Android. Außerdem: offene P1-Punkte aus dem Audit vom 6.11. prüfen (Alarme, Ratenbegrenzung). | `docs/garmin/GERAETE-MATRIX.md` mit Messwerten; jede „prüfen“-Zeile im PRD entschieden                                     | 2–3                                         |
| **B1** | Vertrag und Datenmodell             | `watch-contract.ts`, Migration 003, GUIDE-Abschnitt „Uhr“, Entscheidungen festgehalten                                                                                                                                                                                                                                                                                                                                      | Verträge mit Tests auf Rundlauf und Größe; Migration läuft lokal; `npm run check` grün                                     | 2                                           |
| **B2** | Server (Spur A)                     | Abschnitte 3–6, Tests 9.1                                                                                                                                                                                                                                                                                                                                                                                                   | alle Tests 9.1 grün; Test-Revision auf Cloud Run ohne Verkehrsumleitung                                                    | 5–6                                         |
| **B3** | Uhr-App Kern (Spur B)               | Kopplung, Plan-Cache, Player, Anpassen, Pause, Journal, Fortsetzen, Zusammenfassung, Outbox, Upload, Texte de/en, Layouts                                                                                                                                                                                                                                                                                                   | Tests 9.2 grün; im Simulator ein ganzes Training gegen den Mock-Server; auf der FR255 ein Training gegen die Test-Revision | 8–10                                        |
| **B4** | Aufzeichnung und Messwerte (Spur B) | Recorder, FIT-Felder, HealthCapture, Hintergrund-Sync                                                                                                                                                                                                                                                                                                                                                                       | Aktivität in Garmin Connect sichtbar; Messwerte in Arnold mit Einwilligung, ohne Einwilligung nicht                        | 4–5                                         |
| **B5** | ChatGPT-Seite (Spur C)              | Abschnitt 8                                                                                                                                                                                                                                                                                                                                                                                                                 | Koppeln, Anzeigen, Trennen und Einwilligung in ChatGPT; Karten zeigen Uhr-Trainings; Skill-Tests grün                      | 4–5 (parallel zu B3/B4)                     |
| **B6** | Live und Dogfooding                 | Migration und Deploy, Alarme; Kevin trainiert nur mit der Uhr; Fehler werden laufend behoben                                                                                                                                                                                                                                                                                                                                | 12 Trainings ohne Datenverlust und ohne Doppel; Geräteprotokoll bei jeder Version                                          | 2–3 Wochen Kalender                         |
| **B7** | Store-Release                       | Datenschutztext und Einwilligungskarte; Store-Eintrag de/en mit Icon und Screenshots; Simulator-Abnahme aller Geräte; mindestens ein Tester mit einer AMOLED-Uhr; Ratenbegrenzung mehrinstanzfähig, falls nötig; Einreichung                                                                                                                                                                                                | PRD Abschnitt 10 vollständig erfüllt; Kevin gibt frei                                                                      | 3–4 plus bis zu 2 Wochen Prüfung bei Garmin |

**Gesamtdauer:** etwa 6 bis 8 Wochen bis zum Store. B2, B3 und B5 laufen parallel. Der kritische Pfad ist B0 → B1 → B3/B4 → B6 → B7.

## 12. Release und Betrieb

1. **Reihenfolge beim Deploy:** zuerst die Migration 003 über `npm run db:migrate` oder den Supabase-Connector inklusive `schema_migrations`, dann der Server-Deploy (`npm run deploy:cloud-run`), dann die Uhr-App.
2. **Versionen:** Die Uhr-App folgt SemVer. Der Server meldet `min_app_version`. Eine inkompatible Server-Änderung kommt nur als `/api/watch/v2` neben v1.
3. **Monitoring:** Alarme auf 5xx-Rate und Latenz der Uhr-Routen, auf ungewöhnlich viele 401 und auf Kopplungs-Spitzen. Garmin-Absturzberichte aus dem Developer-Dashboard prüfe ich wöchentlich.
4. **Rücknahme:** Der Server lässt sich per Cloud-Run-Revision zurückdrehen. Die Uhr-App lässt sich im Store auf die vorige Version zurücksetzen. Die Migration 003 ist rein additiv, ein Rückdrehen des Servers bricht also nichts.
5. **Kevins Hinweis aus dem Betrieb gilt weiter:** Nach Tool-Änderungen in ChatGPT „Tools aktualisieren“ und einen neuen Chat starten.

## 13. Risiken

| Risiko                                                                    | Wirkung                                | Gegenmaßnahme                                                                         |
| ------------------------------------------------------------------------- | -------------------------------------- | ------------------------------------------------------------------------------------- |
| Handy-Verbindung (iOS: Garmin Connect muss laufen; zeitweise `-2`/`-104`) | Upload verzögert                       | Offline zuerst, Outbox, Hintergrund, klare Statusanzeige; Training nie davon abhängig |
| Simulator weicht vom Gerät ab                                             | Fehler erst im Studio                  | Gerät ab B0; Geräteprotokoll bei jeder Version                                        |
| Messwerte auf FR255 dünner als erhofft                                    | weniger „vor/nach“-Daten               | Gerätematrix entscheidet; fehlende Werte sind leer, nicht 0                           |
| Aufzeichnung übersteht keinen Absturz                                     | Garmin-Aktivität in zwei Teilen        | Journal ist die Wahrheit für Arnold; Verhalten in B0 klären                           |
| Garmin-Store-Prüfung bis 2 Wochen                                         | später Start                           | früh einreichen (B7 beginnt parallel zu B6)                                           |
| Geräte außer der FR255 nicht in der Hand                                  | Layoutfehler auf AMOLED                | relative Layouts, Simulator-Abnahme, Tester mit 265/965 vor der Freigabe              |
| SDK-Lizenz verbietet SDK im CI                                            | kein automatischer Uhr-Build in GitHub | `garmin:check` lokal vor jedem Merge von Spur B; Klärung in B0                        |
| Monkey C ist für Sprachmodelle dünn belegt                                | mehr Compiler-Runden                   | strenge Typprüfung, kleine Module, Vorlagen (RepFlow, TrainAsONE, ChronoGym)          |
| Gesundheitsdaten ohne Datenschutztext                                     | rechtliches Risiko bei Store-Start     | Einwilligungsschalter von Anfang an; Text ist Bedingung für B7                        |
| Eine Instanz auf Cloud Run                                                | Ratenbegrenzung im Speicher            | reicht bis B7; danach in die Datenbank                                                |

## 14. Was ich von dir brauche

1. **Freigabe**, Java (Temurin) und den Connect IQ SDK Manager auf deinem Mac zu installieren.
2. **Anmeldung im SDK Manager** mit deinem Garmin-Konto. Das musst du selbst machen, ich gebe keine Passwörter ein.
3. **Deine FR255 per USB**: einmal anschließen und das Kopieren erlauben. Auf dem Mac geht das mit OpenMTP; das installiere ich nach deinem OK.
4. **iPhone oder Android?** Das entscheidet, wie wir die Verbindung testen.
5. **Training im Studio** mit jeder Testversion nach dem Geräteprotokoll, ab B3.
6. **Connect-IQ-Entwicklerkonto** für den Store-Eintrag und die Freigabe der Store-Texte (B7).
7. **Datenschutztext** für die Messwerte freigeben, vor dem öffentlichen Start. Ich schreibe den Entwurf.
8. **Ein bis zwei Tester** mit Forerunner 265/965 oder Fenix 7 für B7.

## 15. Offene Punkte, die B0 entscheidet

| Frage                                                                 | Folge im Plan                                   |
| --------------------------------------------------------------------- | ----------------------------------------------- |
| Liefert Connect IQ eine IANA-Zeitzone oder nur den Versatz?           | Bei IANA entfällt die Zeitzone bei der Kopplung |
| Wie viel App-Speicher und ab welcher Antwortgröße kommt `-402`?       | Größenbudgets in 3.2 und 3.4                    |
| Wie lang sind die Verläufe für Body Battery und Stress?               | „vor dem Training“-Fenster                      |
| Welche Werte aus Abschnitt 6 im PRD liefert die FR255 wirklich?       | Felder in `before`/`after`/`extras`             |
| Wie verhalten sich ZURÜCK und HOCH halten während einer Aufzeichnung? | Tastenbelegung 7.4                              |
| Ist die Vibration im Studio deutlich genug?                           | Ton als Standard an oder aus                    |
| Übersteht eine Aufzeichnung einen Absturz?                            | 7.5                                             |
| Schafft der Hintergrunddienst einen Upload in seiner Laufzeit?        | 7.8                                             |
| Darf das SDK im CI laufen?                                            | Spalte „Merge-Maßstab“ für Spur B               |
