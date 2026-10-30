# Arnold – Aufbau und Betrieb

Teil 1 erklärt, wie Arnold gebaut ist und welche Regeln gelten. Teil 2 beschreibt Konfiguration, ChatGPT-Test und das Connected-Profil. Tests: `npm run check` (Stand 30.10.2026: 1.199 Unit- und 50 Browser-Tests grün, alles gegen simulierte Anbieter; Browser-Tests brauchen lokale TCP-Listener und laufen auf den Ports 8790–8804).

# Teil 1 – Aufbau

Arnold ist ein MCP-Server mit einer MCP-App-Oberfläche. Der Server kennt keine Sitzungen (stateless Streamable HTTP): pro Anfrage entstehen ein `McpServer` und ein Transport, der gemeinsame Zustand lebt in Diensten und Repositories außerhalb des Transports.

## Code-Karte

```text
src/
  shared/       Verträge, die Server und UI teilen (Zod-Schemas, Typen, reine Funktionen)
    arnold-schema-v1.ts   Sechs Tabellen des Trainingsformats, Zeilen- und Referenzvalidierung
    workout-contract.ts   Workout-/Satz-Eingaben und -Ausgaben
    plan-contract.ts      Planmodell, Operationen, Validierung
    onboarding-contract.ts  Einrichtungsprofil, Zustandsautomat, Handoff
    schemas.ts, calculations.ts, arnold-view.ts, arnold-format.ts
  analytics/    Reine Kennzahlen-Engine (keine I/O): Aktivität, Volumen, Rekorde, Fortschritt, Planerfüllung
  server/
    main.ts, bootstrap.ts, http.ts   Start, Profilwahl, Express-App, Host-/Origin-Schutz
    mcp-arnold.ts, mcp-workout.ts, mcp-plan.ts, mcp-onboarding.ts   Tool-Registrierung je Bereich
    arnold-presenter.ts   Engine-Ergebnisse → Dashboard-Modell
    arnold-sheets-read-adapter.ts, arnold-sheets-write-adapter.ts, arnold-grid-parser.ts, arnold-sheet-parser.ts
    workout/ plan/ onboarding/   Fachdienste (service.ts) mit Fixture-Varianten für synthetische Daten
    auth/       Bearer-Prüfung (JWKS), Scopes, Zugriffsklassen pro Tool, Discovery-Dokumente
    google/     OAuth-Ablauf, verschlüsselter Refresh-Token-Speicher, Verbindungsdienst
    identity/   Dauerhafte Nutzerzuordnung (Google-Subject → interne Nutzer-ID)
    connected/  Profil `arnold_connected`: Laufzeit pro Nutzer, Dateianlage, Browser-Rücksprung
    storage-config.ts   Profilwahl für `arnold_sheets`, Prüfung öffentlicher Bindungen
  ui/           React-App (ein Bundle, ein HTML-Dokument ohne externe Assets)
    views/ components/ hooks/ client/   Ansichten, Bausteine, Zustandslogik, MCP-Client-Anbindung
  host/         Lokaler Test-Host mit offiziellem `AppBridge`
tests/          Vitest (Unit/Integration), tests/e2e = Playwright, tests/fixtures = synthetische Daten
```

Vite bündelt `dashboard.html` (App) und `host.html` (Test-Host) zu je einer Datei mit eingebettetem JS/CSS. Der Server (`dist/server`, `dist/shared`, `dist/analytics`) läuft ohne TypeScript-Loader.

## MCP-Apps-Lebenszyklus

1. Der Host verbindet sich mit `/mcp` und entdeckt die Tools.
2. Ein Tool wie `show_arnold_dashboard` verweist über `_meta.ui.resourceUri` auf die UI-Ressource (MIME `text/html;profile=mcp-app`).
3. Der Host liest die Ressource und startet sie in einem isolierten iframe (CSP `connect-src 'none'`: die UI hat keinen eigenen Netzwerkzugriff).
4. Die UI registriert ihre Handler (`ontoolresult`, Theme, Teardown) **vor** `App.connect()` und lädt aktuelle Daten per `callServerTool`. ChatGPT kann beim Wiederöffnen einen alten Snapshot liefern; deshalb liest die UI vor dem ersten Anzeigen neu nach.
5. Schreibende UI-Aktionen laufen über `callServerTool`; das Ergebnis ersetzt den angezeigten Stand.

Es gibt keine Abhängigkeit von `window.openai`. `/preview` nutzt denselben Server über einen normalen MCP-Client ohne iframe, `/host` über `AppBridge`. Beides sind Entwicklungswerkzeuge, kein Ersatz für einen echten Host.

## Datenmodell

Trainingsdaten liegen in einer Google-Tabelle mit `schema_id = arnold.training_raw`, Version `1.0.0` und sechs Tabs:

| Tab          | Inhalt                                                  |
| ------------ | ------------------------------------------------------- |
| `CONFIG`     | Tracker-ID, Dateirolle, Einstellungen                   |
| `EXERCISES`  | Übungskatalog                                           |
| `PLANS`      | Planversionen (`draft` / `active` / `archived`)         |
| `PLAN_ITEMS` | Sessions und Positionen einer Planversion               |
| `WORKOUTS`   | Durchgeführte Einheiten (lokales Datum, Status)         |
| `SETS`       | Einzelne Sätze mit Last, Wiederholungen, Ausführungsart |

Spaltennamen sind `snake_case` und exakt festgelegt (`src/shared/arnold-schema-v1.ts`). Der Lese-Adapter prüft vor jeder Abfrage Datei-, Tab- und Tracker-Identität und stoppt bei Abweichung, statt zu raten. Formeln und Literale werden unterschieden; Freitext, der mit `=` beginnt, wird immer als Text geschrieben.

## Fachregeln

### Lasten und Volumen (`src/analytics`)

Jeder Satz trägt `load_basis`; die Engine mischt Bedeutungen nie unbeschriftet.

| `load_basis`      | Bedeutung                   | Volumenkanal      | In 1RM-Schätzung     |
| ----------------- | --------------------------- | ----------------- | -------------------- |
| `total`           | Gesamte externe Last        | `free_weight`     | ja                   |
| `per_implement`   | Last pro Hantel/Gerät       | `free_weight`     | ja, pro Gerät        |
| `machine_display` | Angezeigte Maschinenlast    | `machine_display` | ja, gerätespezifisch |
| `added`           | Zusatzlast bei Eigengewicht | `added_external`  | nein                 |
| `assistance`      | Unterstützung               | keiner            | nein                 |
| `bodyweight_only` | Körpergewicht               | keiner            | nein                 |

- Kanäle sind physikalisch nicht vergleichbar und werden getrennt ausgewiesen. `comparable_free_weight_volume` enthält nur `free_weight`.
- Eine unbekannte Last ist **unbekannt, nicht null**: Eigengewicht ohne Körpergewichtsmessung und Unterstützungssätze erzeugen weder Volumen noch Rekorde.
- Wochen beginnen **montags**; Kalendertage kommen wörtlich aus `workout_date_local`, UTC-Zeitstempel werden nie in Tage umgerechnet. Zwei Workouts am selben Tag sind zwei Einheiten, aber ein Trainingstag. Leere Wochen bleiben als Nullbucket erhalten.
- Wochenstreaks gibt es nur mit ausdrücklich übergebenem Wochenziel; die laufende Woche beendet einen Streak nie.
- Rekorde werden nur innerhalb desselben Vergleichbarkeitsschlüssels `JSON([exercise_id, load_basis, execution_mode, implement_count, side])` verglichen. Rekordtypen: `max_load`, `max_reps_at_load`, `estimated_1rm`, `exercise_workout_volume`.
- Geschätztes 1RM: Epley, nur im Wiederholungsbereich der Engine, immer als Schätzung bezeichnet.
- Nicht berechenbare Werte tragen einen maschinenlesbaren Grund (`status`/`reason`), statt zu fehlen oder 0 zu sein.

Die Engine ist rein und deterministisch; Ergebnisse tragen die Version der Konventionen (`src/analytics/types.ts`). Der Presenter übernimmt Kennzahlen unverändert; die UI rechnet nichts nach.

### Trainingspläne (`src/server/plan`, `src/shared/plan-contract.ts`)

- Eine Planfamilie hat mehrere **Versionen**. Lebenszyklus: `draft → active → archived` oder `draft → archived`; nie zurück. „Alten Plan wieder nutzen“ heißt: neue Draft-Version auf Basis der alten.
- Je Tracker höchstens eine aktive Version. Aktive und archivierte Versionen sind unveränderlich.
- Änderungen sind **typisierte Operationen** (`add_session`, `replace_plan_exercise`, `reorder_plan_exercises`, `update_plan_exercise_targets`, …) auf einem Entwurf mit Revisionsschutz; veraltete Revisionen werden abgelehnt.
- Die Aktivierung erfordert Validierung und eine Bestätigung der exakten Version und Revision, und läuft als ein atomarer Batch (neue Version aktiv, alte archiviert).
- Session- und Positions-IDs sind stabil und überleben Umbenennungen, damit Workout-Referenzen historisch gültig bleiben.

### Workout-Logging (`src/server/workout`)

Ablauf: `start_workout` → `log_workout_sets` / `update_set` / `void_set` → `complete_workout` oder `cancel_workout`. Jeder Schreibaufruf trägt eine `request_id`; Wiederholungen mit derselben ID erzeugen nie eine zweite Zeile, auch nicht nach Serverneustart. Schreibvorgänge sind Batches mit Readback und Auditeintrag. Bei unklarem Ergebnis (Antwort verloren) wird gelesen und verglichen, nicht blind wiederholt.

### Einrichtung (`src/server/onboarding`)

Ein Zustandsautomat führt von Profil über Planvorschlag zur **ausdrücklichen Bestätigung genau einer Planrevision**; erst danach darf Google verbunden werden. Chat-Turns und die Wizard-Oberfläche arbeiten auf demselben Serverzustand (kein zweiter Profilspeicher im Chat). Vor der Anmeldung schützt ein eigenes 256-Bit-Sitzungsgeheimnis den Entwurf.

## Authentifizierung und Zugriff

Arnold ist **Resource Server**, kein Authorization Server: Es prüft Tokens, stellt keine aus.

- Bearer-JWT: Signatur über JWKS, Issuer, Audience (= MCP-Resource-URL, RFC 8707), Ablauf. Algorithmen sind fest; Fehlerantworten verraten keine Details.
- Identität ist ein dauerhafter interner Nutzer, gekoppelt an das stabile Subject des Anmeldeanbieters, nie an eine E-Mail. Nutzer-IDs und Datei-IDs sind nie Tool-Argumente.
- Jedes Tool hat genau eine **Zugriffsklasse** (Tabelle in `src/server/auth/tool-access.ts`, erzwungen von `guardToolRegistrations`). Ein nicht klassifiziertes Tool kann nicht registriert werden.

| Klasse                | Credential                        | Beispiele                                                            |
| --------------------- | --------------------------------- | -------------------------------------------------------------------- |
| `SYNTHETIC_SANDBOX`   | keines, nur im offenen Modus      | Schreib-Tools des Fixture-Profils (zur Laufzeit umklassifiziert)     |
| `ONBOARDING_PREVIEW`  | Sitzungsgeheimnis der Einrichtung | `start_arnold_onboarding`, `confirm_onboarding_plan`                 |
| `AUTHENTICATED_READ`  | `arnold.read`                     | `show_arnold_dashboard`, `get_arnold_workouts`, `get_training_plan`  |
| `AUTHENTICATED_WRITE` | `arnold.read` + `arnold.write`    | `start_workout`, `log_workout_sets`, `create_exercise`               |
| `PLAN_WRITE`          | `arnold.read` + `arnold.plan`     | `create_plan_version`, `update_plan_draft`, `activate_training_plan` |
| `ACCOUNT_MANAGEMENT`  | `arnold.account`                  | `connect_google_account`, `disconnect_google_account`                |

Scopes gelten exakt: kein Scope impliziert einen anderen. Die Prüfung läuft **bei jedem Aufruf**, nicht einmal pro Verbindung, damit ein gesperrter Nutzer mitten in einer Sitzung sofort draußen ist.

- **Konfiguration scheitert geschlossen** (`src/server/auth/config.ts`): widersprüchliche Einstellungen stoppen den Start. `AUTH_MODE=open` ist nur in `ARNOLD_ENV=development` erlaubt und nur mit synthetischen Daten.
- **Google-Zugriff:** Scope nur `drive.file` (plus `openid`, `email`); ein breiterer Grant wird abgelehnt. Refresh-Tokens liegen AES-256-GCM-verschlüsselt (`TOKEN_ENCRYPTION_KEY`, rotierbar). Der OAuth-Rücksprung braucht Cookie, `state`, PKCE, Nonce, gültiges ID-Token und den unveränderten bestätigten Plan. Das Arnold-Bearer-Token steht nie in einem Browserlink.
- **Nutzertrennung:** Der Nutzerkontext reist über `AsyncLocalStorage`, nie global. Im Connected-Profil werden POSTs pro Nutzer serialisiert.

Details zu jeder Regel stehen als Kommentar am zuständigen Modul (`src/server/auth/*`, `src/server/google/*`).

## Tools

Rund 40 Tools in fünf Bereichen; die vollständige, verbindliche Liste ist die Zugriffsklassentabelle in `src/server/auth/tool-access.ts`.

| Bereich       | Tools (Auswahl)                                                                                                                                                                                                                                                                        |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Dashboard     | `show_arnold_dashboard`, `get_arnold_dashboard`, `get_arnold_workouts`, `get_arnold_exercise_progress`                                                                                                                                                                                 |
| Workout       | `get_workout`, `start_workout`, `log_workout_sets`, `update_set`, `void_set`, `complete_workout`, `cancel_workout`, `create_exercise`                                                                                                                                                  |
| Trainingsplan | `get_training_plan`, `list_training_plans`, `get_plan_history`, `validate_training_plan`, `compare_plan_versions`, `get_plan_editor_context`, `create_training_plan`, `create_plan_version`, `clone_plan_version`, `update_plan_draft`, `activate_training_plan`, `archive_plan_draft` |
| Einrichtung   | `show_arnold_onboarding`, `start_arnold_onboarding`, `update_onboarding_profile`, `request_onboarding_plan`, `submit_onboarding_plan_proposal`, `confirm_onboarding_plan`, `get_onboarding_handoff`, …                                                                                 |
| Konto         | `connect_google_account`, `finish_arnold_setup`, `get_google_connection`, `disconnect_google_account`                                                                                                                                                                                  |

Schreibtools sind nur registriert, wenn das Profil Schreiben erlaubt (`arnold_fixture` oder `arnold_connected`); `arnold_sheets` bleibt rein lesend.

## Grenzen

- Das Connected-Profil ist ein **Einzelserver-Entwicklungsprofil** (ein Prozess pro Zustandsordner, Dateispeicher). Mehrinstanzbetrieb, Postgres-Speicher (`IDENTITY_STORE=postgres` ist nicht implementiert) und verteilte Sperren fehlen.
- Google-Zugriff gilt pro Datei, nicht pro Tab. Zugriffsrechte der ChatGPT-Drive-Verbindung werden nicht an Arnold weitergereicht.
- Mit `drive.file` kann Arnold keine bestehende Tabelle suchen oder öffnen, nur selbst angelegte; ein Import bräuchte einen eigenen Picker-Ablauf.

# Teil 2 – Betrieb

Konfiguration, Verbindung mit ChatGPT, Connected-Profil, Hosting und Backup. Alle Variablen mit Kommentar stehen in `.env.example`; `.env*`-Dateien sind ignoriert und enthalten nie etwas im Repository.

## Betriebsarten

| `STORAGE_MODE`              | Start                          | Port (Konvention) | Werkzeuge                     |
| --------------------------- | ------------------------------ | ----------------- | ----------------------------- |
| `arnold_fixture` (Standard) | `npm start`                    | 8787              | Alle, auf synthetischen Daten |
| `arnold_sheets`             | `MCP_ACCESS=private`, Datei-ID | 8789              | Nur lesend, eigene Datei      |
| `arnold_connected`          | OIDC + Google OAuth            | 8787              | Alle, pro Nutzer eine Datei   |

Ohne jede Einstellung läuft `arnold_fixture` mit `ARNOLD_WRITE_MODE=fixture`. Wer `STORAGE_MODE=arnold_fixture` ausdrücklich setzt, muss auch `ARNOLD_WRITE_MODE=fixture` setzen. `ARNOLD_WRITE_MODE=production` wird immer abgelehnt. Die früheren Modi `demo` und `google_sheets` gibt es nicht mehr.

**Schutzregeln beim Start** (der Server weigert sich, nicht nur zu warnen):

- Eine echte Datei (`arnold_sheets`) erfordert `MCP_ACCESS=private`, Loopback-Bindung und nur lokale `ALLOWED_HOSTS`/`ALLOWED_ORIGINS`. Sie wird nie über einen öffentlichen Tunnel ohne Anmeldung bedient.
- `HOST`/`ALLOWED_HOSTS`/`ALLOWED_ORIGINS` werden bei jeder Anfrage geprüft (DNS-Rebinding-Schutz). Eine Tunnel-Domain muss ausdrücklich in `ALLOWED_HOSTS` stehen, Origins ohne `*`.
- `AUTH_MODE=open` nur mit `ARNOLD_ENV=development` und synthetischen Daten; in `staging`/`production` ist `oidc` Pflicht.

## Arnold in ChatGPT testen (synthetisch, ohne Konto)

Daten sind erfunden und liegen im Arbeitsspeicher, ein Neustart verwirft alles. Es gibt keine Anmeldung: Die Tunnel-Adresse nicht weitergeben.

```bash
npm run build
cloudflared tunnel --url http://localhost:8787      # gibt https://<zufall>.trycloudflare.com aus
```

In einem zweiten Terminal, Hostnamen **ohne** `https://` einsetzen:

```bash
PORT=8787 ALLOWED_HOSTS=<zufall>.trycloudflare.com,127.0.0.1,localhost npm start
curl https://<zufall>.trycloudflare.com/health      # erwartet "synthetic":true
```

In ChatGPT einen eigenen MCP-Connector mit `https://<zufall>.trycloudflare.com/mcp` anlegen, Authentifizierung „keine“. Danach in einem neuen Chat testen:

| Sagen                                         | Erwartung               |
| --------------------------------------------- | ----------------------- |
| „Öffne Arnold“                                | Dashboard               |
| „Richte Arnold für mich ein“                  | Geführte Einrichtung    |
| „Erstelle mir jetzt den Trainingsplan“        | Planvorschlag im Editor |
| „Tausche Kniebeugen gegen Beinpresse“         | Änderung im Entwurf     |
| „Ich habe heute Bankdrücken gemacht, 3 Sätze“ | Satz-Logging            |

Nach der Planbestätigung sagt Arnold, die Google-Verbindung sei in diesem Modus nicht verfügbar. Das ist korrekt.

| Symptom                            | Ursache                                                       |
| ---------------------------------- | ------------------------------------------------------------- |
| Server antwortet nicht über Tunnel | Tunnel-Hostname fehlt in `ALLOWED_HOSTS`                      |
| Server startet nicht               | Echte Datenquelle konfiguriert; `STORAGE_MODE=arnold_fixture` |
| ChatGPT findet keine Werkzeuge     | Adresse endet nicht auf `/mcp`                                |
| Alte Tools/UI nach Änderung        | Connector „Refresh“, neuen Chat öffnen                        |

Alternativ zum Quick-Tunnel: [OpenAI Secure MCP Tunnel](https://developers.openai.com/api/docs/guides/secure-mcp-tunnels) mit dem offiziellen `tunnel-client` (`tunnel-client doctor`, dann `run`). Das ist der Weg für private Daten; Runtime-Key nie in Repository oder Chat.

## Eigene Tabelle nur lesen (`arnold_sheets`)

Für lokale Auswertung einer bestehenden Arnold-Tabelle mit einem Google-Dienstkonto:

1. Dienstkonto ohne Cloud-Rollen anlegen, Sheets API aktivieren, Tabelle für das Konto als Betrachter freigeben (Google gewährt pro Datei, nicht pro Tab).
2. Schlüssel nur als `data/google-sheets-reader.json` (Modus 600, ignoriert) ablegen.
3. `.env.sheets` aus der Vorlage in `.env.example` füllen (`ARNOLD_SPREADSHEET_ID`, optional `ARNOLD_EXPECTED_TRACKER_ID`, `ARNOLD_CACHE_TTL_MS`).
4. `node --env-file=.env.sheets dist/server/main.js` und `/host` auf dem konfigurierten Port öffnen.

Der Adapter liest nur den konfigurierten Tracker, stoppt bei geänderter Datei-, Tab- oder Spaltenidentität und schreibt nie.

## Connected-Profil (`arnold_connected`)

Ende-zu-Ende-Ablauf pro Nutzer: OIDC-Anmeldung → Einrichtung und Planbestätigung → Google-Freigabe → Arnold legt eine **eigene leere Tabelle** an und übernimmt genau den bestätigten Plan → Workouts schreiben in diese Tabelle. Die Masterdatei wird weder gelesen noch kopiert.

**Status:** Der Ablauf ist lokal über echten HTTP/MCP-Transport und Chromium getestet, aber mit **simulierten** OIDC- und Google-Endpunkten. Eine Abnahme mit echten Konten oder im ChatGPT-Host steht aus. Das Profil ist Einzelserver-Entwicklung (nicht `staging`/`production`).

Konfiguration in `.env.connected` (ignoriert):

```dotenv
STORAGE_MODE=arnold_connected
ARNOLD_ENV=development
AUTH_MODE=oidc
ARNOLD_WRITE_MODE=disabled          # die Nutzer-Laufzeit schaltet geprüftes Schreiben selbst frei
ARNOLD_PUBLIC_BASE_URL=http://127.0.0.1:8787
AUTH_ISSUER=https://<oidc-anbieter>/
AUTH_JWKS_URI=https://<oidc-anbieter>/<jwks-pfad>
IDENTITY_STORE=file
IDENTITY_STORE_FILE=data/connected/identities.json
ARNOLD_STATE_DIRECTORY=data/connected
GOOGLE_CLIENT_ID=<id>.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=<secret>
GOOGLE_REDIRECT_URI=http://127.0.0.1:8787/auth/google/callback   # exakt <BASE_URL>/auth/google/callback
TOKEN_ENCRYPTION_KEY=k1:<base64, 32 Byte>
```

Schlüssel erzeugen: `node -e "console.log('k1:' + require('crypto').randomBytes(32).toString('base64'))"`. Rotation: neuen Schlüssel als `TOKEN_ENCRYPTION_KEY`, alten nach `TOKEN_ENCRYPTION_KEYS_OLD`, Zeilen neu verpacken, dann alten entfernen.

```bash
npm run build
node --env-file=.env.connected dist/server/main.js
```

Voraussetzungen außerhalb des Codes:

- **OIDC-Anbieter**, der Tokens mit Audience = `<BASE_URL>/mcp` und den Scopes `arnold.read`, `arnold.write`, `arnold.plan`, `arnold.account` ausstellt. Ein Anbieter ist noch nicht gewählt.
- **Google Cloud:** OAuth-Client, Consent-Screen, Testnutzer, Drive API und Sheets API, exakte Redirect-URI. Arnold fordert nur `openid`, `email`, `drive.file`.
- **MCP-Host mit Anmeldung.** `/preview` und `/host` haben keinen OIDC-Login; die Browser-Tests setzen synthetische Test-Bearer.
- Für einen entfernten Host: HTTPS-Adresse, passende `HOST`/`ALLOWED_HOSTS`; Basisadresse, Audience und Redirect-URI müssen übereinstimmen.

Schnittstellen: Tools `connect_google_account`, `finish_arnold_setup`, `get_google_connection`, `disconnect_google_account`; HTTP `POST /auth/google/start`, `GET /auth/google/launch`, `GET /auth/google/callback`, `GET /auth/google/status`, `POST /auth/google/disconnect`.

**Wiederaufnahme und Fehlerfälle:**

- Tracker-Zustand: `draft → allocating → initializing → ready`. Unklare Dateierstellung wird über eine von Arnold gesetzte Drive-`appProperties`-Tracker-ID gesucht; genau ein Treffer wird weiterverwendet, kein oder mehrdeutiger Treffer sperrt sichtbar. Es gibt keine blinde zweite Erstellung, keinen Auto-Reset, kein Überschreiben.
- Ein fertiger Tracker bleibt an das ursprüngliche Google-Subject gebunden; Reconnect mit demselben Konto geht, ein anderes Konto wird vor Speicherung abgelehnt.
- Google-401 → ein Refresh-Versuch; `invalid_grant` → `REAUTH_REQUIRED`. Trennen widerruft bei Google und löscht lokale Credentials, die Tabelle bleibt erhalten.

**Daten und Backup:** `data/connected` enthält Konto- und Tracker-Zuordnung, verschlüsselte Refresh-Tokens, Einrichtungsentwürfe, Audit und Operations-Snapshots (können Trainingsinhalte enthalten). Zustandsordner und `TOKEN_ENCRYPTION_KEY` gehören zusammen in ein verschlüsseltes Backup, der Schlüssel getrennt gelagert. Genau ein Prozess pro Zustandsordner. Aufbewahrung und Löschung der Journale sind offen.

## Hosting auf Google Cloud Run (synthetisch, mit Login)

Feste, öffentliche HTTPS-Adresse für ChatGPT-Tests, ohne laufenden Mac. Profil `arnold_fixture` hinter `AUTH_MODE=oidc`: Wer sich anmeldet, bekommt **einen eigenen erfundenen Datenstand** im Arbeitsspeicher (`src/server/fixture-sandboxes.ts`, höchstens 200, der am längsten unbenutzte fällt zuerst weg). Ohne Token antwortet `/mcp` mit 401. `/preview` und `/host` haben keinen Login und zeigen hier nur die Hülle.

Login-Anbieter ist **WorkOS AuthKit** (Authorization Server, Arnold prüft nur). Einmalig im WorkOS-Dashboard:

- **Connect → Configuration:** „Client ID Metadata Document“ und „Dynamic Client Registration“ einschalten (ChatGPT registriert sich selbst).
- **Resource Indicator:** `https://arnold-<projektnummer>.europe-west1.run.app/mcp` anlegen und als Standard setzen; sonst steht im `aud` die Client-ID der Umgebung.
- **JWT-Template:** `{"urn:arnold:scopes": "arnold.read arnold.write arnold.plan"}`. AuthKit gibt dynamisch registrierten Clients nur `openid profile email offline_access`; Arnolds Scopes kommen deshalb aus diesem Claim (`AUTH_SCOPE_CLAIM`). Ist der Claim gesetzt, zählt **nur** er, der Standard-Claim `scope` wird für Arnold ignoriert. Das Protected-Resource-Dokument bewirbt dann die Scopes des Anbieters, nicht `arnold.*`, weil AuthKit unbekannte Scopes ablehnt.
- Google-Anmeldung aktivieren (in der Staging-Umgebung mit den WorkOS-Testzugangsdaten).

Einmalig bei Google: Projekt mit Abrechnung, `gcloud` installiert (`brew install --cask gcloud-cli`), `gcloud auth login`. Dann:

```bash
npm run deploy:cloud-run -- <projekt-id> <authkit-domain>
```

Das Skript (`scripts/deploy-cloud-run.sh`) liest Issuer und JWKS aus den OAuth-Metadaten des Anbieters, schaltet die APIs ein, baut das `Dockerfile` in Cloud Build (kein lokales Docker nötig), veröffentlicht den Dienst `arnold` in `europe-west1` und prüft `/health`, das Protected-Resource-Dokument und die 401 ohne Token. Ohne Login-Anbieter verweigert es den Start. Connector-Adresse: `https://arnold-<projektnummer>.europe-west1.run.app/mcp`, Authentifizierung OAuth; sie bleibt über alle Deployments gleich.

Gesetzte Variablen: `ARNOLD_ENV=development`, `STORAGE_MODE=arnold_fixture`, `ARNOLD_WRITE_MODE=fixture`, `AUTH_MODE=oidc`, `ARNOLD_PUBLIC_BASE_URL`, `AUTH_ISSUER`, `AUTH_JWKS_URI`, `AUTH_SCOPE_CLAIM=urn:arnold:scopes`, `IDENTITY_STORE=memory`, `TRUST_PROXY=1` (TLS endet bei Google), `ALLOWED_HOSTS` = die `run.app`-Adressen des Dienstes.

- **Genau eine Instanz** (`--max-instances 1`): Sandboxes und Identitäten liegen im Prozess.
- **Schläft bei Ruhe** (`ARNOLD_MIN_INSTANCES=0`, Standard): fast kostenlos, erste Anfrage nach einer Pause einige Sekunden langsamer, Testdaten danach wieder im Anfangszustand. `ARNOLD_MIN_INSTANCES=1` hält die Instanz wach (grob 10 € im Monat).
- Jedes Deployment und jede Variablenänderung startet eine neue Revision und setzt alle Testdaten zurück.
- `.gcloudignore` hält `.env*`, `data/`, Schlüssel und `.git` aus dem hochgeladenen Quellarchiv.

Für echte Nutzerdaten fehlen weiterhin ein mehrinstanztauglicher Zustandsspeicher (statt `data/connected` im Container), ein `staging`-taugliches Connected-Profil mit Google-OAuth-Client und eine Zugangsbeschränkung pro Nutzer statt eines Templates für alle.

## Hosting mit echten Google-Tabellen (Connected-Profil auf Cloud Run)

Standard von `npm run deploy:cloud-run` (`ARNOLD_PROFILE=connected`; `fixture` bleibt wählbar). Ablauf für Nutzer wie im Abschnitt Connected-Profil: WorkOS-Login, Einrichtung, Planbestätigung, Google-Freigabe (`drive.file`), Arnold legt eine eigene Tabelle im Drive des Nutzers an. Die Struktur des „Arnold Master“ (sechs Tabs) steckt im Code; die Masterdatei wird nie gelesen oder kopiert, mit `drive.file` dürfte Arnold das auch nicht.

Einmalig, in dieser Reihenfolge:

1. Google Auth Platform im Projekt: Branding „Arnold“, Zielgruppe „Extern“ im Status **Testen**, Testnutzer eintragen, OAuth-Client „Webanwendung“ mit Weiterleitungs-URI `<BASE_URL>/auth/google/callback`, JSON herunterladen.
2. `npm run setup:google-secrets` legt `arnold-token-encryption-key` (einmalig, nie überschrieben), `arnold-google-client-id` und `arnold-google-client-secret` in Secret Manager ab, ohne sie auszugeben.
3. `npm run setup:cloud-infra` legt das Dienstkonto `arnold-runtime` (keine Projektrollen) und den Bucket `gs://<projekt>-state` an (europe-west1, privat, hierarchischer Namespace für atomare Umbenennungen) und gibt `arnold-runtime` nur Objektzugriff auf den Bucket und Lesezugriff auf die drei Geheimnisse. Außerdem `roles/run.builder` für das Build-Konto.
4. WorkOS-JWT-Template um `arnold.account` ergänzen (`connect_google_account`).

Laufzeit: Der Bucket ist per Cloud Storage FUSE als `/app/data` eingebunden (uid/gid 1000, Dateien 600). Identitäten, verschlüsselte Refresh-Tokens, Einrichtungsentwürfe und Tracker-Zuordnung überleben so Neustarts und das Einschlafen. Geheimnisse kommen als Umgebungsvariablen aus Secret Manager.

Grenzen dieser Stufe:

- **Ein Prozess pro Zustandsordner** gilt weiter. `--max-instances 1` sichert das im Betrieb; während eines Deployments können alte und neue Revision einige Sekunden gleichzeitig laufen. Deployments daher in ruhigen Momenten.
- Im Google-Status **Testen** laufen Refresh-Tokens nach sieben Tagen ab; danach meldet Arnold `REAUTH_REQUIRED` und der Nutzer verbindet Google neu. Abhilfe: App veröffentlichen (`drive.file` ist kein sensibler Scope).
- Höchstens 100 Testnutzer bei Google; WorkOS-Template gibt jedem angemeldeten Nutzer alle Scopes.
- Für Mehrinstanzbetrieb fehlt weiterhin eine Datenbank (Task 007-D).

## Backup

Nur Commit und Push sichern Änderungen. Nicht versioniert: `.env*` (außer `.env.example`), `data/`, `secrets/`, `credentials/`, Schlüssel, `node_modules/`, `dist/`, `test-results/`.

## Nicht nachgewiesen

- Echte Google-/OIDC-/ChatGPT-Abnahme des Connected-Profils.
- Mehrinstanzbetrieb, Postgres-Speicher, verteilte Sperren, echte Google-Quoten, Lasttests, Restore auf neuer Instanz, Monitoring, Aufbewahrung der lokalen Journale.
- Safari, Firefox, echte Mobilgeräte, manuelle Accessibility-Prüfung, Prompt-/Modell-Evaluation.
- Geräteübergreifende Wiederaufnahme der Einrichtung.
