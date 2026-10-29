# Architektur

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
    storage*.ts, google-sheets-storage.ts, fixture.ts, mcp.ts, sheet-parser.ts   Ursprüngliches Demo-Modell (Push/Pull/Legs)
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

Das ältere Demo-Modell (`demo`, `google_sheets`) hat ein eigenes, einfacheres Format und eigene Tools; es ist unabhängig vom Arnold-Schema.

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
| `SYNTHETIC_SANDBOX`   | keines, nur im offenen Modus      | `log_demo_set`, `reset_demo_data`                                    |
| `ONBOARDING_PREVIEW`  | Sitzungsgeheimnis der Einrichtung | `start_arnold_onboarding`, `confirm_onboarding_plan`                 |
| `AUTHENTICATED_READ`  | `arnold.read`                     | `show_arnold_dashboard`, `get_workouts`, `get_training_plan`         |
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
| Dashboard     | `show_arnold_dashboard`, `get_dashboard_data`, `get_workouts`, `get_exercise_progress`                                                                                                                                                                                                 |
| Workout       | `get_workout`, `start_workout`, `log_workout_sets`, `update_set`, `void_set`, `complete_workout`, `cancel_workout`, `create_exercise`                                                                                                                                                  |
| Trainingsplan | `get_training_plan`, `list_training_plans`, `get_plan_history`, `validate_training_plan`, `compare_plan_versions`, `get_plan_editor_context`, `create_training_plan`, `create_plan_version`, `clone_plan_version`, `update_plan_draft`, `activate_training_plan`, `archive_plan_draft` |
| Einrichtung   | `show_arnold_onboarding`, `start_arnold_onboarding`, `update_onboarding_profile`, `request_onboarding_plan`, `submit_onboarding_plan_proposal`, `confirm_onboarding_plan`, `get_onboarding_handoff`, …                                                                                 |
| Konto         | `connect_google_account`, `finish_arnold_setup`, `get_google_connection`, `disconnect_google_account`                                                                                                                                                                                  |

Schreibtools sind nur registriert, wenn das Profil Schreiben erlaubt (`arnold_fixture` oder `arnold_connected`); `arnold_sheets` bleibt rein lesend.

## Grenzen

- Das Connected-Profil ist ein **Einzelserver-Entwicklungsprofil** (ein Prozess pro Zustandsordner, Dateispeicher). Mehrinstanzbetrieb, Postgres-Speicher (`IDENTITY_STORE=postgres` ist nicht implementiert) und verteilte Sperren fehlen.
- Google-Zugriff gilt pro Datei, nicht pro Tab. Zugriffsrechte der ChatGPT-Drive-Verbindung werden nicht an Arnold weitergereicht.
- Mit `drive.file` kann Arnold keine bestehende Tabelle suchen oder öffnen, nur selbst angelegte; ein Import bräuchte einen eigenen Picker-Ablauf.
