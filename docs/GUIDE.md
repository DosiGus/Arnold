# Arnold – Aufbau und Betrieb

Teil 1 erklärt, wie Arnold gebaut ist und welche Regeln gelten. Teil 2 beschreibt Profile, Datenbank, ChatGPT-Test und Hosting. Tests: `npm run check` (Vitest gegen eine echte, lokal gestartete Postgres-Datenbank; Playwright auf den Ports 8790–8802).

# Teil 1 – Aufbau

Arnold ist ein MCP-Server mit einer MCP-App-Oberfläche. Der Server kennt keine Sitzungen (stateless Streamable HTTP): pro Anfrage entstehen ein `McpServer` und ein Transport; der gemeinsame Zustand liegt in der Datenbank.

## Code-Karte

```text
src/
  shared/       Verträge, die Server und UI teilen (Zod-Schemas, Typen, reine Funktionen)
    arnold-schema-v1.ts     Datenmodell: Übungen, Planversionen, Planpositionen, Trainings, Sätze
    workout-contract.ts     Workout-/Satz-Eingaben und -Ausgaben
    plan-contract.ts        Planmodell, Operationen, Validierung
    onboarding-contract.ts  Einrichtungsprofil, Zustandsautomat, Abschluss
    account-contract.ts     Gespeicherte Daten anzeigen, Konto löschen
  analytics/    Reine Kennzahlen-Engine (keine I/O): Aktivität, Volumen, Rekorde, Fortschritt, Planerfüllung
  server/
    main.ts, bootstrap.ts, http.ts   Start, Profilwahl, Express-App, Host-/Origin-Schutz
    mcp-arnold.ts, mcp-workout.ts, mcp-plan.ts, mcp-onboarding.ts   Tool-Registrierung je Bereich
    arnold-presenter.ts   Engine-Ergebnisse → Dashboard-Modell
    arnold-source.ts      Lesepfad des Dashboards
    workout/ plan/ onboarding/   Fachdienste (service.ts) mit Fixture-Varianten für synthetische Daten
    workout/infrastructure.ts    Speicher-Schnittstelle (ArnoldStore), Schreibfehler, Audit
    plan/commit.ts        Der eine Schreibablauf für Workouts und Pläne
    db/           Postgres: Verbindung, Speicher, Konten, Einrichtung, Laufzeit pro Nutzer, Migrationen
    account/      Konto-Tools, Löschbestätigung, Startkatalog, Aufbewahrung
    auth/         Bearer-Prüfung (JWKS), Scopes, Zugriffsklassen pro Tool, Discovery-Dokumente
    identity/     Schnittstelle Login → Arnold-Nutzer (In-Memory-Variante für Tests)
  ui/           React-App (ein Bundle, ein HTML-Dokument ohne externe Assets)
  host/         Lokaler Test-Host mit offiziellem `AppBridge`
db/migrations/  SQL-Migrationen (Tabellen, Zeilenrechte, Funktionen)
tests/          Vitest (Unit/Integration, tests/db-* gegen echtes Postgres), tests/e2e = Playwright
```

Vite bündelt `dashboard.html` (App) und `host.html` (Test-Host) zu je einer Datei mit eingebettetem JS/CSS. Der Server (`dist/server`, `dist/shared`, `dist/analytics`) läuft ohne TypeScript-Loader.

## MCP-Apps-Lebenszyklus

1. Der Host verbindet sich mit `/mcp` und entdeckt die Tools.
2. Ein Tool wie `show_arnold_dashboard` verweist über `_meta.ui.resourceUri` auf die UI-Ressource (MIME `text/html;profile=mcp-app`).
3. Der Host liest die Ressource und startet sie in einem isolierten iframe (CSP `connect-src 'none'`: die UI hat keinen eigenen Netzwerkzugriff).
4. Die UI registriert ihre Handler (`ontoolresult`, Theme, Teardown) **vor** `App.connect()` und lädt aktuelle Daten per `callServerTool`. ChatGPT kann beim Wiederöffnen einen alten Snapshot liefern; deshalb liest die UI vor dem ersten Anzeigen neu nach.
5. Schreibende UI-Aktionen laufen über `callServerTool`; das Ergebnis ersetzt den angezeigten Stand.

## Karten im Chat

Arnold zeigt im Chat Karten, keine App: kein Logo, kein Menü, kein Hell-Dunkel-Schalter (das liefert der Host). Das Modell wählt die Karte über das Argument `card` von `show_arnold_dashboard` (`today`, `week`, `progress`, `history`, `plan`; Liste in `src/shared/dashboard-cards.ts`), die UI liest es über `ontoolinput`. Gestaltungsregeln: `docs/DESIGN.md`.

**Chat-Brücke** (`src/ui/model-context.ts`): Jede Karte meldet dem Modell still über `ui/update-model-context`, was sie zeigt, bei laufendem Training mit allen gespeicherten Sätzen samt `set_id`. So kann der Nutzer im Chat nachfragen oder korrigieren. Nur „Training beenden“ schickt eine sichtbare Nachricht, einmal und nur nach einem Tipp in der Karte.

Es gibt keine Abhängigkeit von `window.openai`. `/preview` nutzt denselben Server über einen normalen MCP-Client ohne iframe, `/host` über `AppBridge`. Beides sind Entwicklungswerkzeuge, kein Ersatz für einen echten Host.

## Datenmodell

Die Trainingsdaten folgen dem Schema `arnold.training_raw` 1.0.0 (`src/shared/arnold-schema-v1.ts`) und liegen in Postgres im Schema `arnold` (`db/migrations/001_arnold.sql`):

| Tabelle                | Inhalt                                                        |
| ---------------------- | ------------------------------------------------------------- |
| `users`                | Arnold-Konto: interne Kennung, Status, Tracker-ID             |
| `identity_connections` | Login (Issuer + Subject) → Konto; nie die E-Mail-Adresse      |
| `exercises`            | Übungskatalog des Nutzers (Startkatalog plus eigene Übungen)  |
| `plan_versions`        | Planversionen (`draft` / `active` / `archived`)               |
| `plan_items`           | Einheiten und Positionen einer Planversion                    |
| `workouts`             | Durchgeführte Einheiten (lokales Datum, Status)               |
| `sets`                 | Einzelne Sätze mit Last, Wiederholungen, Ausführungsart       |
| `operations`           | Quittung je Schreibvorgang (`request_id`), für Wiederholungen |
| `audit_events`         | Änderungsprotokoll                                            |
| `onboarding_sessions`  | Einrichtungsstand als JSON-Dokument mit Revision              |

Spaltennamen entsprechen exakt den Feldern des Zod-Schemas. Zeitstempel und Kalenderdaten werden als die geschriebenen Zeichenketten gespeichert, damit ein Kalendertag nie aus UTC umgerechnet wird und ein Datensatz unverändert zurückkommt. Werteregeln (Enums, Bereiche, Querbezüge) prüft das Zod-Schema bei jedem Schreiben; die Datenbank sichert Schlüssel, Bezüge innerhalb eines Nutzers und „höchstens ein aktiver Plan“.

### Nutzertrennung

Zwei Schlösser hintereinander:

1. **Server:** Die Nutzerkennung kommt ausschließlich aus dem geprüften Token, nie aus Tool-Argumenten. Jeder Datenbankzugriff läuft in `Database.asUser`: eine Transaktion, in der `arnold.user_id` gesetzt ist.
2. **Datenbank:** Jede Nutzertabelle hat Row Level Security; die Richtlinie lässt nur Zeilen mit `user_id = arnold.current_user_id()` durch. Der Server verbindet sich als `arnold_app` (kein Superuser, kein `BYPASSRLS`, kein Tabelleneigentümer, kein `DELETE`/`TRUNCATE`/DDL). Ohne gesetzten Nutzer sieht er nichts. Alle Bezüge zwischen Tabellen enthalten `user_id`, ein Satz kann also nie auf das Training eines anderen zeigen. Der Start bricht ab, wenn die Rolle die Richtlinien umgehen könnte (`Database.assertReady`).

Das Schema `arnold` ist nicht über die Supabase-Data-API erreichbar, und die API-Rollen `anon`/`authenticated` haben keine Rechte darauf. Die Konto-Suche per Login läuft über die Funktion `arnold.resolve_identity` (legt beim ersten Kontakt genau ein Konto an, schreibt `last_seen_at` höchstens stündlich). Belegt durch `tests/db-security.test.ts` und `tests/db-journey.test.ts`.

### Schreibvorgänge

Jeder Workout- und Planschreibvorgang läuft durch `commitWrite` (`src/server/plan/commit.ts`) als **eine** Datenbanktransaktion, pro Nutzer serialisiert (Advisory Lock, auch über mehrere Server-Instanzen): lesen und prüfen, `request_id` nachschlagen (gleiche ID mit gleichem Inhalt → gespeichertes Ergebnis, mit anderem Inhalt → `DUPLICATE_OPERATION`), Änderung bauen, Datenvertrag prüfen, Änderung + Audit + Quittung speichern. Entweder ist alles gespeichert oder nichts. Bricht die Verbindung im falschen Moment ab, sendet der Aufrufer dieselbe `request_id` erneut; es gibt keinen Zustand, der von Hand geklärt werden muss. Belegt durch `tests/db-store.test.ts`.

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
- Wochen beginnen **montags**; Kalendertage kommen wörtlich aus `workout_date_local`. Zwei Workouts am selben Tag sind zwei Einheiten, aber ein Trainingstag. Leere Wochen bleiben als Nullbucket erhalten.
- Wochenstreaks gibt es nur mit ausdrücklich übergebenem Wochenziel; die laufende Woche beendet einen Streak nie.
- Rekorde werden nur innerhalb desselben Vergleichbarkeitsschlüssels `JSON([exercise_id, load_basis, execution_mode, implement_count, side])` verglichen. Rekordtypen: `max_load`, `max_reps_at_load`, `estimated_1rm`, `exercise_workout_volume`.
- Geschätztes 1RM: Epley, nur im Wiederholungsbereich der Engine, immer als Schätzung bezeichnet.
- Nicht berechenbare Werte tragen einen maschinenlesbaren Grund (`status`/`reason`), statt zu fehlen oder 0 zu sein.

Die Engine ist rein und deterministisch; Ergebnisse tragen die Version der Konventionen (`src/analytics/types.ts`). Der Presenter übernimmt Kennzahlen unverändert; die UI rechnet nichts nach.

### Trainingspläne (`src/server/plan`, `src/shared/plan-contract.ts`)

- Eine Planfamilie hat mehrere **Versionen**. Lebenszyklus: `draft → active → archived` oder `draft → archived`; nie zurück. „Alten Plan wieder nutzen“ heißt: neue Draft-Version auf Basis der alten.
- Höchstens eine aktive Version. Aktive und archivierte Versionen sind unveränderlich.
- Änderungen sind **typisierte Operationen** (`add_session`, `replace_plan_exercise`, `reorder_plan_exercises`, `update_plan_exercise_targets`, …) auf einem Entwurf mit Revisionsschutz; veraltete Revisionen werden abgelehnt.
- Die Aktivierung erfordert Validierung und eine Bestätigung der exakten Version und Revision und archiviert die bisher aktive Version im selben Schreibvorgang.
- Session- und Positions-IDs sind stabil und überleben Umbenennungen, damit Workout-Referenzen historisch gültig bleiben.

### Workout-Logging (`src/server/workout`)

Ablauf: `start_workout` → `log_workout_sets` / `update_set` / `void_set` → `complete_workout` oder `cancel_workout`. Jeder Schreibaufruf trägt eine `request_id`; Wiederholungen mit derselben ID erzeugen nie eine zweite Zeile. Gelöscht wird nichts: ein verworfener Satz bleibt als Tombstone (`status = voided`) erhalten.

### Einrichtung (`src/server/onboarding`)

Der Ablauf aus Nutzersicht:

1. **Begrüßung** mit zwei Buttons: „Plan mit Arnold erstellen“ oder „Eigenen Plan übernehmen“ (`profile.path`).
2. **Plan mit Arnold:** Person (freiwillig) und Training (Ziel, Erfahrung, Tage, Minuten, Ort; Split, Schwerpunkt, Geräte und Lieblingsübungen optional). „Plan erstellen“ schickt eine Nachricht in den Chat, damit ChatGPT den Plan aus dem Briefing baut.
3. **Eigener Plan:** keine Fragen. Der Nutzer schickt seinen Plan als Text oder Foto; ChatGPT überträgt ihn mit `origin: existing_routine`.
4. Prüfen, im Editor oder per Chat ändern, **ausdrücklich genau eine Planrevision bestätigen**. Die Bestätigung schließt die Einrichtung direkt ab: `finishSetup` aktiviert genau diese Revision und setzt den Status `COMPLETED`. Scheitert nur der Abschluss, bleibt die Bestätigung gespeichert (`READY_TO_FINISH`) und `finish_arnold_setup` holt ihn nach; wiederholbar ohne doppelte Aktivierung.

Weitere Regeln:

- Chat-Turns und Oberfläche arbeiten auf demselben Serverzustand. Der Text jedes Einrichtungs-Tools sagt ChatGPT, was als Nächstes zu tun ist.
- Ein neues Konto bekommt den Startkatalog (`src/shared/exercise-starter-catalog.ts`) und sonst nichts: keine erfundenen Trainings, Pläne oder Startgewichte.
- **Hinter einem Login gehört die Einrichtung dem Konto** (`OnboardingAccessControl.perOwner`): höchstens eine offene Einrichtung pro Nutzer, sie wird in jedem neuen Chat fortgesetzt (mit neu ausgestelltem Sitzungsgeheimnis), und nach dem Abschluss startet sie nie wieder (`ONBOARDING_ALREADY_COMPLETED`). Solange ein Konto nicht eingerichtet ist, antworten Dashboard- und Workout-Tools mit `SETUP_REQUIRED` (`onboarding/setup-gate.ts`); Plan- und Einrichtungs-Tools bleiben offen.
- Ohne Login (Fixture) bleibt die Einrichtung anonym und wird nur durch das 256-Bit-Sitzungsgeheimnis geschützt.
- Bereiche schonen ist eine Trainingsvorliebe, keine Diagnose; Gesundheitsdaten werden nicht erfragt.

## Authentifizierung und Zugriff

Arnold ist **Resource Server**, kein Authorization Server: Es prüft Tokens, stellt keine aus. Login-Anbieter ist WorkOS AuthKit.

- Bearer-JWT: Signatur über JWKS, Issuer, Audience (= MCP-Resource-URL, RFC 8707), Ablauf. Algorithmen sind fest; Fehlerantworten verraten keine Details.
- Identität ist ein dauerhafter interner Nutzer, gekoppelt an das stabile Subject des Anmeldeanbieters, nie an eine E-Mail. Nutzer-IDs sind nie Tool-Argumente.
- Jedes Tool hat genau eine **Zugriffsklasse** (Tabelle in `src/server/auth/tool-access.ts`, erzwungen von `guardToolRegistrations`). Ein nicht klassifiziertes Tool kann nicht registriert werden.

| Klasse                | Credential                        | Beispiele                                                                  |
| --------------------- | --------------------------------- | -------------------------------------------------------------------------- |
| `SYNTHETIC_SANDBOX`   | keines, nur im offenen Modus      | Schreib-Tools des Fixture-Profils (zur Laufzeit umklassifiziert)           |
| `ONBOARDING_PREVIEW`  | Sitzungsgeheimnis der Einrichtung | `show_arnold_onboarding`, `confirm_onboarding_plan`, `finish_arnold_setup` |
| `AUTHENTICATED_READ`  | `arnold.read`                     | `show_arnold_dashboard`, `get_arnold_workouts`, `get_training_plan`        |
| `AUTHENTICATED_WRITE` | `arnold.read` + `arnold.write`    | `start_workout`, `log_workout_sets`, `create_exercise`                     |
| `PLAN_WRITE`          | `arnold.read` + `arnold.plan`     | `create_plan_version`, `update_plan_draft`, `activate_training_plan`       |
| `ACCOUNT_MANAGEMENT`  | `arnold.account`                  | `get_arnold_stored_data`, `delete_arnold_account`                          |

Hinter einem Login verlangen die Einrichtungs-Tools zusätzlich `arnold.plan`. Scopes gelten exakt: kein Scope impliziert einen anderen. Die Prüfung läuft **bei jedem Aufruf**, damit ein gesperrter Nutzer mitten in einer Sitzung sofort draußen ist.

- **Konfiguration scheitert geschlossen** (`src/server/auth/config.ts`): widersprüchliche Einstellungen stoppen den Start. `AUTH_MODE=open` ist nur in `ARNOLD_ENV=development` erlaubt und nur mit synthetischen Daten.
- **Nutzerkontext** reist über `AsyncLocalStorage`, nie global. POSTs eines Nutzers werden pro Instanz serialisiert.
- **Konto löschen** läuft zweistufig: der erste Aufruf liefert eine Zusammenfassung und ein kurzlebiges Token nur an die Karte (`_meta`), erst der Klick löscht. Das Konto und alle Zeilen des Nutzers verschwinden in einer Anweisung (Kaskade).

## Tools

Rund 40 Tools in fünf Bereichen; die vollständige, verbindliche Liste ist die Zugriffsklassentabelle in `src/server/auth/tool-access.ts`.

| Bereich       | Tools (Auswahl)                                                                                                                                                                                                                                                                        |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Dashboard     | `show_arnold_dashboard`, `get_arnold_dashboard`, `get_arnold_workouts`, `get_arnold_exercise_progress`                                                                                                                                                                                 |
| Workout       | `get_workout`, `start_workout`, `log_workout_sets`, `update_set`, `void_set`, `complete_workout`, `cancel_workout`, `create_exercise`                                                                                                                                                  |
| Trainingsplan | `get_training_plan`, `list_training_plans`, `get_plan_history`, `validate_training_plan`, `compare_plan_versions`, `get_plan_editor_context`, `create_training_plan`, `create_plan_version`, `clone_plan_version`, `update_plan_draft`, `activate_training_plan`, `archive_plan_draft` |
| Einrichtung   | `show_arnold_onboarding`, `start_arnold_onboarding`, `update_onboarding_profile`, `request_onboarding_plan`, `submit_onboarding_plan_proposal`, `confirm_onboarding_plan`, `finish_arnold_setup`, …                                                                                    |
| Konto         | `get_arnold_stored_data`, `delete_arnold_account`                                                                                                                                                                                                                                      |

# Teil 2 – Betrieb

Alle Variablen mit Kommentar stehen in `.env.example`; `.env*`-Dateien sind ignoriert und enthalten nie etwas im Repository.

## Profile

| `STORAGE_MODE`              | Daten                                      | Anmeldung | Zweck                                      |
| --------------------------- | ------------------------------------------ | --------- | ------------------------------------------ |
| `arnold_fixture` (Standard) | Synthetisch im Arbeitsspeicher, alle Tools | optional  | Entwicklung, Vorschau, Tests, ChatGPT-Test |
| `arnold_database`           | Pro Nutzer in Postgres (Supabase)          | OIDC      | Echte Nutzer                               |

Ohne jede Einstellung läuft `arnold_fixture` mit `ARNOLD_WRITE_MODE=fixture`. Hinter einem Login (`AUTH_MODE=oidc`) bekommt im Fixture-Profil jeder Nutzer einen eigenen erfundenen Datenstand im Arbeitsspeicher (`src/server/fixture-sandboxes.ts`).

**Schutzregeln beim Start** (der Server weigert sich, nicht nur zu warnen):

- `arnold_database` verlangt `AUTH_MODE=oidc`, `IDENTITY_STORE=postgres`, eine erreichbare Datenbank auf dem erwarteten Schemastand und eine Rolle ohne Umgehungsrechte.
- Eine entfernte Datenbank wird nur über TLS mit geprüftem Zertifikat erreicht; `sslmode` in der URL wird ignoriert. Das CA-Zertifikat kommt bei Bedarf aus `DATABASE_CA_CERT`.
- `HOST`/`ALLOWED_HOSTS`/`ALLOWED_ORIGINS` werden bei jeder Anfrage geprüft (DNS-Rebinding-Schutz). Echte Daten sind ohne Anmeldung nie öffentlich erreichbar.
- `AUTH_MODE=open` nur mit `ARNOLD_ENV=development` und synthetischen Daten.

## Arnold in ChatGPT testen (synthetisch, ohne Konto)

Daten sind erfunden und liegen im Arbeitsspeicher, ein Neustart verwirft alles. Es gibt keine Anmeldung: Die Tunnel-Adresse nicht weitergeben.

```bash
npm run build
cloudflared tunnel --url http://localhost:8787      # gibt https://<zufall>.trycloudflare.com aus
```

In einem zweiten Terminal, Hostnamen **ohne** `https://` einsetzen:

```bash
PORT=8787 ALLOWED_HOSTS=<zufall>.trycloudflare.com,127.0.0.1,localhost npm start
```

In ChatGPT einen eigenen MCP-Connector mit `https://<zufall>.trycloudflare.com/mcp` anlegen, Authentifizierung „keine“.

| Symptom                            | Ursache                                  |
| ---------------------------------- | ---------------------------------------- |
| Server antwortet nicht über Tunnel | Tunnel-Hostname fehlt in `ALLOWED_HOSTS` |
| ChatGPT findet keine Werkzeuge     | Adresse endet nicht auf `/mcp`           |
| Alte Tools/UI nach Änderung        | Connector „Refresh“, neuen Chat öffnen   |

## Datenbank (Supabase)

Einmalig:

1. Supabase-Projekt in der Region Frankfurt (`eu-central-1`) anlegen.
2. Unter „Connect“ die **Session-Pooler**-Adresse kopieren (Nutzer `postgres.<project-ref>`). Das ist `DATABASE_ADMIN_URL`; sie wird nur für Migrationen und die Einrichtung gebraucht, nie vom Server.
3. Falls Supabase ein eigenes CA-Zertifikat verlangt: unter „Database Settings → SSL Configuration“ herunterladen und als `DATABASE_CA_CERT` bereitstellen.
4. `DATABASE_ADMIN_URL=… npm run db:setup -- <gcp-projekt-id>`: wendet die Migrationen an, gibt `arnold_app` ein neues Zufallspasswort, legt die Server-Verbindung als `arnold-database-url` in Secret Manager ab und erlaubt nur dem Dienstkonto `arnold-runtime`, sie zu lesen. Das Passwort wird nirgends ausgegeben.

Neue Migrationen: Datei `db/migrations/NNN_name.sql`, `EXPECTED_SCHEMA_VERSION` in `src/server/db/database.ts` erhöhen, `npm run db:migrate` (liest `DATABASE_ADMIN_URL`). Der Server startet nur auf genau dem erwarteten Stand.

Lokal ohne Supabase: `npm test` startet für die Tests eine echte Postgres-Instanz aus dem Paket `embedded-postgres` (kein Docker nötig) und wendet dieselben Migrationen an.

## Hosting auf Google Cloud Run

```bash
npm run deploy:cloud-run -- <projekt-id> <authkit-domain>
```

Das Skript (`scripts/deploy-cloud-run.sh`) baut genau den committeten, gepushten und CI-grünen Stand, veröffentlicht den Dienst `arnold` in `europe-west1` mit Profil `arnold_database` (Standard; `ARNOLD_PROFILE=fixture` für synthetische Daten) und prüft `/health`, das Protected-Resource-Dokument und die 401 ohne Token. Ohne Login-Anbieter verweigert es den Start. Connector-Adresse: `https://arnold-<projektnummer>.europe-west1.run.app/mcp`, Authentifizierung OAuth.

Einmalig im WorkOS-Dashboard:

- **Connect → Configuration:** „Client ID Metadata Document“ und „Dynamic Client Registration“ einschalten (ChatGPT registriert sich selbst).
- **Resource Indicator:** `https://arnold-<projektnummer>.europe-west1.run.app/mcp` anlegen und als Standard setzen.
- **JWT-Template:** `{"urn:arnold:scopes": "arnold.read arnold.write arnold.plan arnold.account"}`. AuthKit gibt dynamisch registrierten Clients nur seine eigenen Scopes; Arnolds Scopes kommen deshalb aus diesem Claim (`AUTH_SCOPE_CLAIM`).

Betrieb, Rollback und Alarme: `docs/BETRIEB.md`.

## Grenzen

- Höchstens eine Server-Instanz (`--max-instances 1`): Löschbestätigungen und die Fixture-Sandboxes liegen im Arbeitsspeicher. Die Daten selbst sind mehrinstanzfähig (Transaktionen, Advisory Locks).
- Kein Export der Trainingsdaten für Nutzer (geplant als Export-Knopf).
- Nicht nachgewiesen: Abnahme mit echter Supabase-Instanz und echtem ChatGPT-Host nach dem Umbau, Lasttests, Wiederherstellung aus einem Supabase-Backup, Safari/Firefox/Mobilgeräte, manuelle Accessibility-Prüfung.
