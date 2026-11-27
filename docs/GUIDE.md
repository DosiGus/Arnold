# Arnold – Aufbau und Betrieb

Teil 1 erklärt, wie Arnold gebaut ist und welche Regeln gelten. Teil 2 beschreibt Profile, Datenbank, ChatGPT-Test und Hosting. Tests: `npm run check` (Vitest gegen eine echte, lokal gestartete Postgres-Datenbank; Playwright auf lokalen Ports ab 8790).

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
  views/        Kartenoberfläche (Skybridge als Web-Framework), je Ansicht eine HTML-Datei
    onboarding/   Einrichtung, Überblick und seine Seiten
    dashboard/    Einstieg aller anderen Karten (wählt die Karte aus der ersten Antwort)
    live/         Laden und Schreiben je Ansicht über Tool-Aufrufe
    model/        Antwort → Anzeige, rein und getestet (tests/views-*)
    host/         Lokaler Test-Host mit offiziellem `AppBridge` (Entwicklung und Browser-Tests)
db/migrations/  SQL-Migrationen (Tabellen, Zeilenrechte, Funktionen)
tests/          Vitest (Unit/Integration, tests/db-* gegen echtes Postgres), tests/e2e = Playwright
```

Vite baut je Seite (`onboarding`, `dashboard`, `host`, `vite.views.config.ts`) eine Datei mit eingebettetem JS/CSS nach `dist/views`. Skybridge dient nur als Web-Framework; MCP-Host bleibt Arnolds eigener Server. Der Server (`dist/server`, `dist/shared`, `dist/analytics`) läuft ohne TypeScript-Loader.

## MCP-Apps-Lebenszyklus

1. Der Host verbindet sich mit `/mcp` und entdeckt die Tools.
2. Ein Tool wie `show_arnold_dashboard` verweist über `_meta.ui.resourceUri` auf die UI-Ressource (MIME `text/html;profile=mcp-app`).
3. Der Host liest die Ressource und startet sie in einem isolierten iframe (CSP `connect-src 'none'`: die UI hat keinen eigenen Netzwerkzugriff).
4. Die Ansicht zeigt das Ergebnis, mit dem sie geöffnet wurde, und der Überblick liest danach mit `callServerTool` neu nach: ChatGPT kann beim Wiederöffnen einen alten Stand liefern.
5. Schreibende Aktionen laufen über `callServerTool` (`src/views/arnold-client.ts`, einziger Weg zum Server); danach wird neu gelesen.

## Karten im Chat

Arnold zeigt im Chat Karten, keine App: kein Logo, kein Menü, kein Hell-Dunkel-Schalter (das liefert der Host). Es gibt zwei Bundles: `show_arnold_onboarding` öffnet die Einrichtung, alle anderen Karten-Werkzeuge das Dashboard-Bundle. Dieses liest aus der Form der ersten Antwort, welche Karte gemeint ist (`src/views/model/opening.ts`: Lauf, Mobility, Uhr koppeln, Uhrenliste, Konto löschen, sonst Überblick). Bei `show_arnold_dashboard` wählt das Modell mit `card` (`src/shared/dashboard-cards.ts`) eine Seite (`home`/`week`, `today`, `plan`, `stats`, `goals`, `records`) oder eine Karte (`progress`, `history`, `plan_change`, `plan_adjustment`).

- **Überblick:** Woche, Scores, Heute, Ziele, Rekorde; der Rückblick nach einem neuen Training (`mark_recap_seen`) und der Hinweis auf eine Anpassung auf Zeit.
- **Korrigieren:** In `history` ändert die Karte einzelne Sätze (`update_set`) oder verwirft sie (`void_set`), unter „Ziele“ verwirft sie den letzten Gewichtseintrag (`void_body_weight`); Verwerfen braucht den zweiten Tipp.
- **Modellkontext:** Jede Karte beschreibt dem Modell kurz, was sie zeigt (`DataLLM`). Sichtbare Chat-Nachrichten entstehen nur durch einen Tipp.

Es gibt keine Abhängigkeit von `window.openai`. `/host` (auch unter `/` und `/preview`) öffnet die Karten lokal in einem isolierten iframe über `AppBridge` (`?onboarding=1`, `?card=…`, `?tool=…`, `?theme=dark`). Das ist ein Entwicklungswerkzeug, kein Ersatz für einen echten Host. Gestaltungsregeln: `docs/DESIGN.md`.

Nur im früheren Frontend (Git-Tag `archive/old-frontend`), in den Karten heute über den Chat: ganzes Training bearbeiten oder zurücknehmen, offenes Training verwerfen, im Training tauschen, hinzufügen oder „wie letztes Mal“ wählen, Plan in der Karte bearbeiten, ungewöhnliche Werte oder ein doppeltes Training in der Karte trotzdem speichern, Uhr-Stand und die Angebote „Laufen“ und „Mobility“ auf dem Überblick.

## Datenmodell

Die Trainingsdaten folgen dem Schema `arnold.training_raw` 1.0.0 (`src/shared/arnold-schema-v1.ts`) und liegen in Postgres im Schema `arnold` (`db/migrations/001_arnold.sql`, Ziele und Körpergewicht in `002_goals_body_weight.sql`):

| Tabelle                | Inhalt                                                         |
| ---------------------- | -------------------------------------------------------------- |
| `users`                | Arnold-Konto: interne Kennung, Status, Tracker-ID              |
| `identity_connections` | Login (Issuer + Subject) → Konto; nie die E-Mail-Adresse       |
| `exercises`            | Übungskatalog des Nutzers (Startkatalog plus eigene Übungen)   |
| `plan_versions`        | Planversionen (`draft` / `active` / `archived` / `temporary`)  |
| `plan_adjustments`     | Anpassungen auf Zeit (UX-008, Migration 007)                   |
| `plan_items`           | Einheiten und Positionen einer Planversion                     |
| `workouts`             | Durchgeführte Einheiten (lokales Datum, Status)                |
| `sets`                 | Einzelne Sätze mit Last, Wiederholungen, Ausführungsart        |
| `operations`           | Quittung je Schreibvorgang (`request_id`), für Wiederholungen  |
| `audit_events`         | Änderungsprotokoll                                             |
| `onboarding_sessions`  | Einrichtungsstand als JSON-Dokument mit Revision               |
| `goals`                | Ziele: Körpergewicht, Gewicht oder Wiederholungen einer Übung  |
| `body_weights`         | Körpergewicht pro Kalendertag (höchstens ein gültiger Eintrag) |

Spaltennamen entsprechen exakt den Feldern des Zod-Schemas. Zeitstempel und Kalenderdaten werden als die geschriebenen Zeichenketten gespeichert, damit ein Kalendertag nie aus UTC umgerechnet wird und ein Datensatz unverändert zurückkommt. Werteregeln (Enums, Bereiche, Querbezüge) prüft das Zod-Schema bei jedem Schreiben; die Datenbank sichert Schlüssel, Bezüge innerhalb eines Nutzers und „höchstens ein aktiver Plan“.

### Nutzertrennung

Zwei Schlösser hintereinander:

1. **Server:** Die Nutzerkennung kommt ausschließlich aus dem geprüften Token, nie aus Tool-Argumenten. Jeder Datenbankzugriff läuft in `Database.asUser`: eine Transaktion, in der `arnold.user_id` gesetzt ist.
2. **Datenbank:** Jede Nutzertabelle hat Row Level Security; die Richtlinie lässt nur Zeilen mit `user_id = arnold.current_user_id()` durch. Der Server verbindet sich als `arnold_app` (kein Superuser, kein `BYPASSRLS`, kein Tabelleneigentümer, kein `DELETE`/`TRUNCATE`/DDL; einzige Ausnahme: `DELETE` auf Messwerte der Uhr und Garmin-Tageswerte, weil ein Widerruf der Einwilligung sie löscht). Ohne gesetzten Nutzer sieht er nichts. Alle Bezüge zwischen Tabellen enthalten `user_id`, ein Satz kann also nie auf das Training eines anderen zeigen. Der Start bricht ab, wenn die Rolle die Richtlinien umgehen könnte (`Database.assertReady`).

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

### Startansicht, Ziele und Körpergewicht (`src/analytics/home.ts`, `goals.ts`)

- Trainings-, Wochen-, Ziel- und Rekorddaten der Startansicht kommen aus der Engine (`buildHomeAnalytics`), ohne Filter über die ganze Historie; der Presenter ergänzt Namen (`home` im Dashboard-Vertrag). Die Übungsvorschau nutzt dieselben `proposals` aus `get_workout` wie die Trainingskarte. Die drei Scores Konstanz, Fortschritt und Erholung (UX-009) berechnet `src/analytics/scores.ts` (`buildScores`); der Vertrag trägt sie im Feld `scores`, der Presenter reicht sie nur durch. Die Erholung nutzt Uhrwerte (`arnold.health_daily`, ersatzweise die Vorher-Werte aus `workout_health`) nur mit aktiver Einwilligung `garmin_health`; Einwilligung und Werte liest `readScoreHealth` in einer Transaktion. Scheitert das Lesen, zählt nur der Trainingsteil. Zu wenig Daten heißt `insufficient_data` mit Grund, nie 0.
- **Serie:** Wochen am Stück mit erreichtem Wochenziel (Trainingstage aus `days_per_week` des aktiven Plans, egal an welchen Tagen). Die laufende Woche bricht eine Serie nie. Ohne Plan keine Serie.
- **Rekorde:** mehr Gewicht oder mehr Wiederholungen bei gleichem Gewicht (Engine-Rekorde `max_load`/`max_reps_at_load`, nur Verbesserungen), bei Eigengewicht mehr Wiederholungen. Eine Übung in einem Training ist höchstens ein Rekord (auch bei links und rechts). Nur abgeschlossene Trainings zählen.
- **Stärker seit:** mittlere Veränderung des geschätzten 1RM je Übung (erste gegen letzte Messung, häufigste Vergleichsklasse). Muskelgruppen nutzen dasselbe für die letzten 8 Wochen, Arbeitssätze pro Woche für die letzten 4 Wochen; die Gruppe ist `primary_muscle` der Übung.
- **Ziele** speichern nur Art, Übung, Lastdefinition, Ziel- und Startwert. Der Stand wird berechnet: Körpergewicht = letzte Messung, Übungsziel = bester Arbeitssatz eines abgeschlossenen Trainings in der Lastdefinition des Ziels. Prognose aus der Veränderung der letzten 8 Wochen. Pro Art und Übung ein aktives Ziel (Schema und Datenbank).
- Schreiben über `create_training_goal`, `update_training_goal`, `archive_training_goal`, `log_body_weight`, `void_body_weight` im Workout-Dienst, also über `commitWrite` wie jeder Satz. Ein zweiter Gewichtseintrag am selben Tag verwirft den ersten.

### Fortschritt: Gewicht fürs nächste Training (`src/analytics/progression.ts`)

Arnold rechnet die Werte fürs nächste Training selbst, ChatGPT erklärt sie nur. Methode: **doppelte Progression** im Wiederholungsbereich der Planposition (`rep_min`–`rep_max`; eine feste Zahl ist ein Bereich von eins). Grundlage sind die Arbeitssätze der letzten abgeschlossenen Trainings mit der Übung (höchstens sechs), nur solange sie gleich gemessen sind (Lastdefinition, Ausführung, Gerätezahl, Wiederholungsbasis).

| Lage (letztes Training)                                                   | Empfehlung (`decision`)                                                      |
| ------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Alle Sätze an oder über der Obergrenze                                    | `increase`: jeder Satz eine Gewichtsstufe mehr, Wdh. = Untergrenze           |
| Sonst                                                                     | `more_reps`: gleiches Gewicht, je Satz eine Wdh. mehr (höchstens Obergrenze) |
| Zweimal in Folge die meisten Sätze unter der Untergrenze (`missed_range`) | `reduce`: etwa 10 % leichter auf Gerätestufen, Wdh. = Untergrenze            |
| Dreimal in Folge kein Fortschritt beim selben Gewicht (`stalled`)         | `reduce` wie oben                                                            |
| Körpergewicht oder Unterstützung an der Obergrenze                        | `top_reached`: Wdh. bleiben, Arnold ändert kein Gewicht                      |

- Gewichtsstufen (`weightStep`): Langhantel und Kabelzug 2,5 kg, Kurzhantel 2 kg je Hantel, Kettlebell 4 kg, Maschine 5 kg; sonst nach Lastdefinition.
- Ein leichteres Training beendet die Zählung „ohne Fortschritt“; nach einem Deload folgt also nie sofort der nächste. Kann ein Gewicht nicht weiter sinken, baut Arnold Wiederholungen auf.
- Keine Empfehlung (`source: last_time`, Werte wie beim letzten Mal) ohne Wiederholungsbereich, mit unbekanntem Gewicht, für getauschte oder zusätzliche Übungen. Ohne Verlauf gilt das Planziel bzw. das Startgewicht.
- Der Vorschlag (`proposals` aus `get_workout`) trägt die Begründung als `progression`; die Trainingsansicht belegt jeden Satz mit diesen Werten vor und speichert, was abgehakt ist. `log_workout` ohne Änderungen speichert genau diesen Vorschlag; die Sätze vom letzten Mal speichert im Chat `same_as_last_time: true`.
- Bewusst nicht berücksichtigt: Pausen zwischen Trainings (die Karte und das Speichern hätten sonst je nach Uhrzeit verschiedene Werte), Wiederholungen in Reserve (die Karte fragt sie nicht ab). Regelversion: `PROGRESSION_VERSION`.

### Trainingspläne (`src/server/plan`, `src/shared/plan-contract.ts`)

- Eine Planfamilie hat mehrere **Versionen**. Lebenszyklus: `draft → active → archived` oder `draft → archived`; nie zurück. „Alten Plan wieder nutzen“ heißt: neue Draft-Version auf Basis der alten.
- Höchstens eine aktive Version. Aktive und archivierte Versionen sind unveränderlich.
- Änderungen sind **typisierte Operationen** (`add_session`, `replace_plan_exercise`, `reorder_plan_exercises`, `update_plan_exercise_targets`, …) auf einem Entwurf mit Revisionsschutz; veraltete Revisionen werden abgelehnt.
- Die Aktivierung erfordert Validierung und eine Bestätigung der exakten Version und Revision und archiviert die bisher aktive Version im selben Schreibvorgang.
- Session- und Positions-IDs sind stabil und überleben Umbenennungen, damit Workout-Referenzen historisch gültig bleiben.

### Workout-Logging (`src/server/workout`)

Standard nach dem Training: `log_workout` speichert einen Trainingstag in einem Schritt (ohne Änderungen Arnolds Empfehlung aus dem letzten Training, mit `same_as_last_time` die Sätze vom letzten Mal, ohne Verlauf das Planziel; Abweichungen als Tausch, Weglassen, andere Werte oder Zusatzübung). `replaces_workout_id` ersetzt ein gespeichertes Training, `void_workout` nimmt es zurück (Status `voided`, Sätze storniert). Satz für Satz während des Trainings: `start_workout` → `log_workout_sets` / `update_set` / `void_set` → `complete_workout` oder `cancel_workout`. Jeder Schreibaufruf trägt eine `request_id`; Wiederholungen mit derselben ID erzeugen nie eine zweite Zeile. Gelöscht wird nichts: ein verworfener Satz bleibt als Tombstone (`status = voided`) erhalten.

### Einrichtung (`src/server/onboarding`)

Der Ablauf aus Nutzersicht:

1. **Begrüßung** mit zwei Buttons: „Plan mit Arnold erstellen“ oder „Eigenen Plan übernehmen“ (`profile.path`).
2. **Plan mit Arnold:** Person (freiwillig, eine Karte) und vier Fragen (Ziele, Erfahrung, Tage und Minuten, Ort), danach freiwillige Wünsche (feste Tage, Aufteilung, Schwerpunkt, Geräte, Lieblings- und gemiedene Übungen, Freitext `notes`). Mehrere Ziele: das erste ist `primary_goal`, die übrigen `secondary_goals`; das Briefing ordnet sie dem Hauptziel unter. „Plan erstellen“ schickt eine Nachricht in den Chat, damit ChatGPT den Plan aus dem Briefing baut.
3. **Eigener Plan:** keine Fragen. Der Nutzer schickt seinen Plan als Text oder Foto; ChatGPT überträgt ihn mit `origin: existing_routine`.
4. Prüfen, per Chat ändern, **ausdrücklich genau eine Planrevision bestätigen**. Wurde ein Körpergewicht angegeben, schreibt der Abschluss es als ersten Körpergewicht-Eintrag (`log_body_weight` mit fester `request_id`, also höchstens einmal); scheitert nur das, bleibt die Einrichtung trotzdem abgeschlossen. Die Bestätigung schließt die Einrichtung direkt ab: `finishSetup` aktiviert genau diese Revision und setzt den Status `COMPLETED`. Scheitert nur der Abschluss, bleibt die Bestätigung gespeichert (`READY_TO_FINISH`) und `finish_arnold_setup` holt ihn nach; wiederholbar ohne doppelte Aktivierung.

Weitere Regeln:

- Chat-Turns und Oberfläche arbeiten auf demselben Serverzustand. Der Text jedes Einrichtungs-Tools sagt ChatGPT, was als Nächstes zu tun ist.
- Ein neues Konto bekommt den Startkatalog (`src/shared/exercise-starter-catalog.ts`) und sonst nichts: keine erfundenen Trainings oder Pläne.
- **Startgewichte:** ChatGPT schätzt nie Gewichte. Fehlende `target_load_kg` von Katalogübungen setzt der Server beim Speichern des Vorschlags (`onboarding/start-loads.ts`) aus `src/analytics/start-load.ts`: feste Tabelle pro Übung (Anteil vom Körpergewicht für 10 Wdh.), skaliert nach Gewicht, Geschlecht, Erfahrung, Alter und Wiederholungen, bewusst vorsichtig und auf Gerätestufen gerundet. Fortgeschrittene im Studio werden nach bekannten Gewichten gefragt (`training.known_loads`: Bankdrücken, Kniebeuge, Latzug für 8–10 Wdh.); daraus rechnet Arnold die Übungen derselben Gruppe hoch. Der Planvorschlag zeigt Schätzungen mit „≈“ (`load_estimates` im Einrichtungszustand). Körpergewichtsübungen und eigene Übungen bekommen keine Schätzung. Nach dem ersten Training gelten ohnehin die echten Werte vom letzten Mal.
- **Hinter einem Login gehört die Einrichtung dem Konto** (`OnboardingAccessControl.perOwner`): höchstens eine offene Einrichtung pro Nutzer, sie wird in jedem neuen Chat fortgesetzt (jede geöffnete Karte bekommt ein eigenes Sitzungsgeheimnis, früher geöffnete Karten bleiben nutzbar, höchstens neun pro Einrichtung), und nach dem Abschluss startet sie nie wieder (`ONBOARDING_ALREADY_COMPLETED`). Solange ein Konto nicht eingerichtet ist, antworten Dashboard- und Workout-Tools mit `SETUP_REQUIRED` (`onboarding/setup-gate.ts`); Plan- und Einrichtungs-Tools bleiben offen.
- **Unterbrochene Einrichtungsschritte lassen sich wiederholen:** Eine bekannte `request_id` wird vor der Revisionsprüfung erkannt und liefert den gespeicherten Stand. Sitzung und Audit werden in Postgres in einer Transaktion geschrieben. Bricht ein mehrstufiger Schritt (Plan übernehmen, Plan bestätigen) zwischen seinen Teilen ab, führt derselbe Aufruf mit derselben `request_id` und der ursprünglichen Revision ihn zu Ende.
- Ohne Login (Fixture) bleibt die Einrichtung anonym und wird nur durch das 256-Bit-Sitzungsgeheimnis geschützt.
- Bereiche schonen ist eine Trainingsvorliebe, keine Diagnose; Gesundheitsdaten werden nicht erfragt.

## Authentifizierung und Zugriff

Arnold ist **Resource Server**, kein Authorization Server: Es prüft Tokens von WorkOS AuthKit. Einzige Ausnahme sind eigene, eng begrenzte **Gerätetoken für die Garmin-Uhr** (`arn_w_…`, nur als SHA-256 gespeichert, nur die Scopes `arnold.watch.read`/`arnold.watch.write`, sofort widerrufbar). Grund: Eine Uhr kann keinen Browser-Login durchlaufen, und stündlich zu erneuernde WorkOS-Token über das Handy wären unzuverlässig; die Kopplung bestätigt deshalb der angemeldete Nutzer in ChatGPT.

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

Rund 50 Tools in sechs Bereichen; die vollständige, verbindliche Liste ist die Zugriffsklassentabelle in `src/server/auth/tool-access.ts`.

| Bereich       | Tools (Auswahl)                                                                                                                                                                                                                                                                                                                                                                               |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Dashboard     | `show_arnold_dashboard`, `get_arnold_dashboard`, `get_arnold_workouts`, `get_arnold_exercise_progress`                                                                                                                                                                                                                                                                                        |
| Workout       | `get_workout`, `log_workout`, `void_workout`, `start_workout`, `log_workout_sets`, `update_set`, `void_set`, `complete_workout`, `cancel_workout`, `create_exercise`                                                                                                                                                                                                                          |
| Ziele         | `create_training_goal`, `update_training_goal`, `archive_training_goal`, `log_body_weight`, `void_body_weight`                                                                                                                                                                                                                                                                                |
| Trainingsplan | `get_training_plan`, `list_training_plans`, `get_plan_history`, `validate_training_plan`, `compare_plan_versions`, `get_plan_editor_context`, `create_training_plan`, `create_plan_version`, `clone_plan_version`, `update_plan_draft`, `activate_training_plan`, `archive_plan_draft`, `get_plan_adjustments`, `create_plan_adjustment`, `confirm_plan_adjustment`, `cancel_plan_adjustment` |
| Einrichtung   | `show_arnold_onboarding`, `start_arnold_onboarding`, `update_onboarding_profile`, `request_onboarding_plan`, `submit_onboarding_plan_proposal`, `confirm_onboarding_plan`, `finish_arnold_setup`, …                                                                                                                                                                                           |
| Konto         | `get_arnold_stored_data`, `delete_arnold_account`                                                                                                                                                                                                                                                                                                                                             |
| Garmin-Uhr    | `pair_garmin_watch`, `list_garmin_watches`, `unpair_garmin_watch`, `set_garmin_health_consent`                                                                                                                                                                                                                                                                                                |

## Uhr-Schnittstelle (`src/server/watch`, `/api/watch/v1`)

Die Garmin-Uhr spricht über das Handy direkt mit Arnold, ohne Garmin-Server. Vertrag: `src/shared/watch-contract.ts`; Tabellen und Kopplungsfunktionen: `db/migrations/003_garmin.sql`.

- Der Router hängt nur mit Datenbank und `AUTH_MODE=oidc`. Jede Route hat eine Klasse in `WATCH_ROUTE_ACCESS` (`tool-access.ts`), sonst bricht der Start ab. Uhr-Token gelten nie auf `/mcp`, WorkOS-Token nie hier.
- **Kopplung:** `POST /pair/start` liefert den Code für die Uhr, `pair_garmin_watch` bestätigt ihn in ChatGPT erst nach dem Klick in der Karte, `POST /pair/token` gibt das Token genau einmal aus.
- **Plan:** `GET /plan` ist nur ein Verzeichnis, jeder Tag kommt einzeln über `/plan/sessions/:id` (kompakt, mit ETag), dazu `/plan/recent`. Vorschläge, Gewichtsstufen und Dauer rechnet der Server.
- **Anpassung auf Zeit** (UX-008, `src/server/plan/adjustment-rules.ts` und `adjustments.ts`, Tabelle `arnold.plan_adjustments` aus `007_plan_adjustments.sql`): Für lokale Kalendertage (Anfang und Ende inklusive, in der gespeicherten Zone, höchstens 56) ersetzt eine bestätigte Anpassung den aktiven Plan beim Trainieren. Ihre Einheiten liegen in einer eigenen Planversion mit Status `temporary`, die der Plan-Dienst nie sieht (`hideTemporary`): nicht in Liste, Entwürfen, Vergleich, Aktivierung. Die eine Stelle, an der sie über den aktiven Plan gelegt wird, ist `trainingView` (Dashboard, Trainingskarte, Uhr, Plan-Marke); nach dem letzten Tag gilt ohne Schreibvorgang wieder der normale Plan. Anlegen (Entwurf), Bestätigen und Absagen sind getrennte Tools; überschneidende bestätigte Anpassungen werden abgelehnt. Läufe bleiben unverändert.
- **Ehrlicher Uhr-Status** (UX-007, `src/server/watch/delivery.ts`, Tabelle `arnold.watch_plan_receipts` aus `006_watch_plan_receipts.sql`): `GET /plan` trägt die Standmarke `v` (16 Hex, Hash über das Verzeichnis, immer auf Deutsch berechnet, deckt über die Tages-ETags den ganzen Inhalt ab). Die Uhr ruft nach einem vollständigen Abgleich `POST /plan/ack {v}`; der Server speichert je Gerät Marke und Zeit. `watch_delivery` (`delivered | pending | no_watch | unknown`) steht im Dashboard-Vertrag und im Ergebnis von `activate_training_plan`: delivered nur, wenn eine aktive Uhr die aktuelle Marke bestätigt hat; pending, wenn eine Uhr ab App-Version 0.2.0 (oder mit früherer Quittung) sie noch nicht hat; ohne aktive Uhr no_watch; sonst unknown (alte Uhr-App, kein Plan, Lesefehler). Die Karten zeigen eine Uhr-Zeile nur bei delivered und pending.
- **Training:** `POST /workouts` läuft über `log_workout` und `commitWrite` (`source = sync` und `client_session_id` nur intern); die Aufzeichnung wird im selben Schreibvorgang gespeichert.
- **Messwerte:** `PUT /workouts/:session_uuid/health` nur mit Einwilligung (`set_garmin_health_consent`), sonst 403 und nichts gespeichert; Puls 0 wird als Lücke gespeichert. Ein Widerruf löscht alle Messwerte. Der Einwilligungstext und seine Version stehen in `src/shared/health-consent.ts` (beide zusammen ändern). Die neue Oberfläche bietet Health Data nur an, wenn für das Konto Tageswerte abgerufen werden (`GARMIN_DAILY_USER_ID`); sonst antwortet `get_health_data` mit `not_connected`.
- **Tageswerte aus Garmin Connect** (UX-015, `src/server/health`, Tabelle `arnold.health_daily` aus `005_health_daily.sql`): ein Wert je lokalem Kalendertag, unbekannt bleibt `NULL`. Zulieferer hinter `DailyHealthPullSource`; gebaut ist der persönliche Schlüssel für genau ein konfiguriertes Konto (Abruf im Hintergrund beim Öffnen der Übersicht), Business Starter (Push) ist nur als Schnittstelle vorbereitet. Schreiben nur mit Einwilligung (Trigger), Widerruf löscht. Garmins Ruhepuls ist ersatzweise das Tagesminimum, wenn die Uhr keinen Ruhewert hat; Arnold übernimmt ihn unverändert. **Erweiterte Tageswerte** (Migration `008_health_daily_extended.sql`, nur speichern und lesen, die Scores bleiben unverändert): zusätzlich Schlafphasen und -zeiten (lokale Uhrzeit als Text, nie aus UTC), Atmung, Blutsauerstoff, Aktivität (Schritte, Intensitätsminuten, Etagen, Kilokalorien, Distanz), Hauttemperatur-Abweichung, VO2max, Fitnessalter, Trainingsbereitschaft, Trainingszustand und Trainingslast, alle `NULL` wenn unbekannt; die Spaltenliste steht einmal in `DAILY_HEALTH_COLUMNS` (`src/server/health/source.ts`). Garmin dokumentiert die Personal-API nur teilweise: Pflichtpfade (Tageszusammenfassung, Schlafzusammenfassung, HRV) scheitern wie bisher mit benanntem Code, alle weiteren Pfade sind **optional** (Fehler, 403/404/204 oder unerwartetes Format scheitern nie den Abruf und überschreiben keinen Wert; je Pfad `ok`/`empty`/`unavailable`/`error` in `health_daily_sync.endpoint_outcomes`). Die bereinigte Rohantwort jedes erfolgreichen Pfads liegt in `arnold.health_daily_raw` (Nutzer, Tag, Pfadname; höchstens 256 KB, ohne Schlüssel, Token und Garmins IDs; ein leerer Einzeltag-Pfad als Leer-Vermerk `EMPTY_ANSWER`). Nach jedem erfolgreichen Abruf liest der Server die Rohdaten der letzten 35 Tage mit derselben Lesart neu ein (`readStored` des Zulieferers), sodass eine Korrektur der Feldnamen ohne SQL von Hand ankommt; der Backfill zählt nur Antworten der Einzeltag-Pfade (`detailEndpoints`); alle Feldnamen und die Pfade für Trainingsbereitschaft und -zustand gelten als „ungeprüft bis zum ersten echten Abruf“ (`src/server/health/garmin-extended.ts`). Lesen für die Analysen: `readDailyHealthRange` bzw. `selectDailyHealth` in `src/server/health/sync.ts`. Auswertung für die Erholung: `dailyHealthRecovery` in `src/analytics/health-daily.ts`. Betrieb: `docs/BETRIEB.md`.
- **Grenzen** im Speicher (eine Instanz): 10 Kopplungsstarts je Adresse und Stunde, 5 falsche Codes je Konto und Stunde, 120 Aufrufe je Uhr und Minute, 60 fehlgeschlagene Token-Prüfungen je Adresse und Minute. Logs enthalten nie Token, Codes oder Inhalte.

## ChatGPT-Plugin und Skills (`plugins/arnold`)

Das Plugin bündelt den MCP-Server (`mcp.json`, Live-Adresse, OAuth mit Selbstregistrierung) mit zwei Skills: `arnold-trainingsplan` (Plan erstellen, übernehmen, ändern; Planungsregeln, Namen, Stoßzeit-Geräte) und `arnold-coach` (Fragen, Fortschritt, Stillstand, Schmerzen). Skills sind Abläufe und Regeln für ChatGPT; sie ersetzen keine Server-Prüfung, und die Server-Anweisungen gelten weiter für Nutzer ohne Plugin. Wer ein Tool umbenennt, passt die Skills an; `tests/plugin-skills.test.ts` meldet es sonst. Testen und Testfälle: `plugins/arnold/README.md`.

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

## Live-Vorschau in ChatGPT

Für gemeinsame Entwicklungsrunden gibt es das persönliche Custom-MCP-Plugin
**Arnold Vorschau**. Dieselben ChatGPT-Werkzeuge und Karten speichern
Einrichtung, Pläne und Training im freigegebenen Arnold-Testkonto.
Änderungen sind damit auch im regulären Arnold sichtbar. Die Vorschau
verlangt WorkOS-OAuth mit eigener Audience und akzeptiert nur den
vorhandenen Login des konfigurierten Kontos. Die Garmin-Uhr und der Abruf
neuer Garmin-Tageswerte bleiben am regulären Server. Die Vorschau kann
die bereits gespeicherten Garmin-Daten anzeigen.

1. Einen Arbeitsbranch verwenden. Die feste Adresse stellt Tailscale Funnel
   (kostenlos nur für nicht-kommerzielle Nutzung). Einmalig: `brew install
tailscale`, anmelden, Funnel im Tailnet freigeben, die interne Kennung des
   freigegebenen Kontos nach `~/.config/arnold/preview-user-id` schreiben.
2. Einmalig in WorkOS Connect → Configuration die Vorschau-Adresse inklusive
   `/mcp` als zusätzlichen Resource Indicator anlegen (der Live-Endpunkt
   bleibt der Standard) und in ChatGPT unter Plugins einen separaten
   benutzerdefinierten MCP-Server mit dieser Adresse und OAuth verbinden.
3. Starten mit `bash scripts/preview-chatgpt.sh <projekt-id>` (ohne Angabe das
   aktive gcloud-Projekt). Das Skript startet Tailscale ohne Root, liest die
   Anmeldeeinstellungen vom laufenden Dienst und die Datenbankverbindung aus
   Secret Manager in die Prozessumgebung, zeigt die Adresse an und hält den
   Mac wach, solange es läuft.
4. In einem neuen Chat „Arnold Vorschau“ auswählen und die gewünschte Karte
   öffnen. Änderungen an React-Komponenten und CSS laufen über Vite und den
   WebSocket zum offenen Widget. Serveränderungen starten den lokalen Prozess
   neu. Nach Änderungen an Tool-Namen, Schemas oder Metadaten in ChatGPT
   zusätzlich die Vorschau-Verbindung aktualisieren.
5. Geprüfte Zwischenstände auf dem Arbeitsbranch committen und pushen.
   Zusammengehörige, abgenommene Änderungen bündeln. Erst den grünen Stand
   auf `main` als Produktionsrelease deployen.

Die Adresse bleibt über Neustarts gleich. Die Vorschau braucht den lokalen
Prozess, solange Karten geöffnet sind; ist der Mac aus, ist nur die Vorschau
nicht erreichbar.

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
- Geplant: Erinnerungen und Berichte über die Uhr (Push-Benachrichtigungen fürs Training, die Morgenroutine und den Wochenrückblick direkt auf die Garmin-Uhr). Die drei Schalter in den Einstellungen sind bis dahin als „bald verfügbar“ gekennzeichnet und speichern nichts.
- Nicht nachgewiesen: Abnahme mit echter Supabase-Instanz und echtem ChatGPT-Host nach dem Umbau, Lasttests, Wiederherstellung aus einem Supabase-Backup, Safari/Firefox/Mobilgeräte, manuelle Accessibility-Prüfung.
