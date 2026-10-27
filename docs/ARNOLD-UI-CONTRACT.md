# Arnold UI-Vertrag

Technischer Vertrag zwischen Arnold-Datenbasis, Analytics Engine, MCP-Server und
React-Oberfläche. Stand: S001 (Tasks 001–005), Vertrag `arnold.dashboard/2`.

Zugehörige Dokumente: [ARNOLD-DATA-CONTRACT.md](ARNOLD-DATA-CONTRACT.md) (Rohdatenschema v1),
[ARNOLD-METRICS-SPEC.md](ARNOLD-METRICS-SPEC.md) (Berechnungskonventionen),
[ARCHITECTURE.md](ARCHITECTURE.md) (Gesamtarchitektur).

---

## 1. Datenfluss vom Storage bis zur UI

```text
Arnold Google Sheets  (sechs Tabellen, Rohdaten, keine Formelspalten)
        |  nur lesend, nur serverseitig, OAuth-frei (Service-Account)
        v
ArnoldSheetsReadAdapter            src/server/arnold-sheets-read-adapter.ts
        |  validiert gegen ArnoldDatasetSchema; bricht bei Strukturfehlern ab
        v
ArnoldDataset                      src/shared/arnold-schema-v1.ts
        |
        v
ArnoldSheetsDataSource             src/server/arnold-source.ts
        |  Cache mit TTL, geteilter In-flight-Read, invalidate()
        v
Arnold Analytics Engine            src/analytics/
        |  buildArnoldDashboardAnalytics(dataset, options)
        v
ArnoldDashboardAnalytics           src/analytics/types.ts
        |
        v
Presenter                          src/server/arnold-presenter.ts
        |  übersetzt und selektiert; rechnet nichts
        v
ArnoldDashboardView / …HistoryView / …ProgressView   src/shared/arnold-view.ts
        |  Zod-validiert
        v
MCP-Tools                          src/server/mcp-arnold.ts
        |  MCP Streamable HTTP / MCP Apps Bridge
        v
ArnoldClient -> ArnoldMcpClient    src/ui/client.ts, src/ui/client/
        |
        v
Hooks -> Views -> Komponenten      src/ui/hooks/, src/ui/views/, src/ui/components/
```

Verbindliche Eigenschaften:

1. Google Sheets wird **ausschließlich serverseitig** gelesen.
2. Die UI erhält **keine** Google-Zugangsdaten und ruft **keine** Google-API auf.
   Die MCP-App-Ressource deklariert `csp.connectDomains: []`.
3. **Alle** Trainingskennzahlen stammen aus der Analytics Engine. Der Presenter
   kopiert Werte, er berechnet keine Metrik. Das Frontend berechnet keine
   konkurrierende Kennzahl.
4. Jedes API-Ergebnis wird mit Zod validiert — serverseitig beim Erzeugen
   (`ArnoldDashboardViewSchema.parse`) und clientseitig beim Empfangen
   (`ArnoldMcpClient`).
5. Fehlende echte Daten werden **nie** durch Demo-Daten ersetzt.

---

## 2. Verwendete MCP-Tools

### Demo-Modus (`STORAGE_MODE=demo`) — unverändert, Vertrag v1

| Tool                    | Zweck                                            |
| ----------------------- | ------------------------------------------------ |
| `show_arnold_dashboard` | Öffnet die App, liefert `DashboardSchema`        |
| `get_dashboard_data`    | Kennzahlen, `DashboardSchema`                    |
| `get_workouts`          | Historie, Filter Push/Pull/Legs                  |
| `get_exercise_progress` | Übungsverlauf                                    |
| `log_demo_set`          | Schreibt einen synthetischen Demo-Satz           |
| `reset_demo_data`       | Stellt die synthetische Ausgangsdatei wieder her |

### Arnold-Modus (`STORAGE_MODE=arnold_sheets`) — Vertrag v2

| Tool                              | Zweck                        | Output                       |
| --------------------------------- | ---------------------------- | ---------------------------- |
| `show_arnold_dashboard`           | Öffnet die App               | `ArnoldDashboardView`        |
| `get_arnold_dashboard_v2`         | Standardisierte Kennzahlen   | `ArnoldDashboardView`        |
| `get_arnold_workouts_v2`          | Trainingshistorie, paginiert | `ArnoldWorkoutHistoryView`   |
| `get_arnold_exercise_progress_v2` | Fortschritt einer Übung      | `ArnoldExerciseProgressView` |

Alle vier sind `readOnlyHint: true`. Im Arnold-Modus existiert **kein**
schreibendes Tool.

### Warum versioniert

Das v1-`DashboardSchema` modelliert ein Workout als Push/Pull/Legs-Einheit mit
nackten `kg`-Zahlen. Das Arnold-Schema hat beides nicht: eine Einheit trägt einen
freien Namen, und jede Last trägt eine Definition (`per_implement`,
`machine_display`, …). Eine Antwort in v1-Form müsste einen Split erfinden und
die Lastdefinition verschweigen. Deshalb:

- Die v1-Tools bleiben **unverändert** und sind nur im Demo-Modus registriert.
- Der Arnold-Modus publiziert eigene `*_v2`-Tools.
- `show_arnold_dashboard` behält in beiden Modi seinen Namen, weil es das Tool
  ist, das die App öffnet. Sein Payload ist selbstbeschreibend: das Feld
  `ui_contract` (`"arnold.dashboard/2"`) sagt jedem Client, welchen Vertrag er
  vor sich hat. Ein Deployment läuft immer in genau einem Modus; die Änderung ist
  damit ausdrücklich und nicht stillschweigend.
- `GET /health` nennt den aktiven Vertrag im Feld `ui_contract`.

---

## 3. Input- und Output-Schemas

### `get_arnold_dashboard_v2`

Input (alle Felder optional):

| Feld                        | Typ          | Bedeutung                                      |
| --------------------------- | ------------ | ---------------------------------------------- |
| `from`, `to`                | `YYYY-MM-DD` | Zeitraum, Grenzen inklusive                    |
| `plan_version_ids`          | `string[]`   | Nur diese Planversionen                        |
| `session_ids`               | `string[]`   | Nur diese Sessions                             |
| `exercise_ids`              | `string[]`   | Nur diese Übungen                              |
| `weekly_goal_training_days` | `1–7`        | Wochenziel; ohne Angabe wird keines angenommen |

Output `ArnoldDashboardView`: `ui_contract`, `state`, `source`, `period`,
`notices`, `kpis`, `weeks`, `recent_workouts`, `records`, `active_plan`,
`plan_history`, `exercises`, `session_names`, `data_quality`, `totals`.

### `get_arnold_workouts_v2`

Input: `from`, `to`, `plan_version_ids`, `session_ids`, `session_name`,
`exercise_ids`, `workout_statuses`, `limit` (1–200, Standard 20), `offset`.

Output `ArnoldWorkoutHistoryView`: `total`, `offset`, `limit`, `has_more`,
`workouts` (je mit `exercises[].sets[]`), `notices`.

### `get_arnold_exercise_progress_v2`

Input: `exercise_id` (erforderlich), `from`, `to`, `metric`.

Output `ArnoldExerciseProgressView`: `exercise_name`, `empty`, `status`,
`reasons`, `variants`, `kpis`, `selected_metric`, `selected_series`,
`available_metrics`, `notices`.

---

## 4. Dashboard-Datenformat

### `ViewMetric` — die zentrale Regel

```ts
{ key, label, value: number | null, unit, status, note: string | null, detail }
```

- `value: null` heißt **unbekannt** und wird als neutraler Platzhalter („–“)
  plus `note` dargestellt — **niemals** als `0`.
- `status`: `valid` | `partial` | `not_available` | `invalid`.
- `note` ist die deutsche Übersetzung der Engine-Begründungen
  (`REASON_TEXT` in `arnold-presenter.ts`, exhaustiv über
  `Record<AnalyticsReason, string>` erzwungen).

Echte Null gegen unbekannt: Die Engine liefert `0`, wenn **nichts** zählbar war
(kein Training heißt kein Volumen), und `null`, wenn zählbare Sätze existieren,
aber nicht berechenbar sind. Der Leerzustand wird über `state` kommuniziert, nicht
über eine 0 in einer Kennzahl.

### KPI-Bereich

`workouts`, `training_days`, `training_days_per_week`, `workouts_per_week`,
`working_sets`, `nominal_volume`, `comparable_volume`.

`working_sets` ist eine **Anzahl von Sätzen**, keine Volumensumme. Der Wert kommt
aus `volume.by_bucket.working.coverage.eligible_sets`, nicht aus
`included_sets`: `included_sets` zählt die Sätze, die in die Volumensumme
eingegangen sind, und schließt damit einen völlig gültigen Körpergewichtssatz
aus, dessen Last unbekannt ist. Lässt sich für einen Teil der Sätze kein Volumen
berechnen, nennt die Kennzahl das als Hinweis — sie zählt die Sätze trotzdem.

Das Trainingsvolumen trägt immer einen eindeutigen Kennzahlentyp:
`nominal_volume` (Summe Last × Wiederholungen je Lastdefinition) ist von
`comparable_volume` (nur freie Gewichte) getrennt.

---

## 5. Verantwortlichkeiten

| Schicht                      | Zuständig für                                             | Ausdrücklich **nicht** zuständig |
| ---------------------------- | --------------------------------------------------------- | -------------------------------- |
| `arnold-sheets-read-adapter` | Google-Lesezugriff, Strukturprüfung, Validierung          | Berechnungen, Schreiben          |
| `arnold-source`              | Caching, Fehlerklassifikation                             | Berechnungen                     |
| `src/analytics`              | **jede** Trainingskennzahl, Eligibility, Vergleichbarkeit | I/O, Sprache, Darstellung        |
| `arnold-presenter`           | Auswahl, Projektion, deutsche Texte                       | Rechnen                          |
| `mcp-arnold`                 | Tool-Verträge, Serveruhr, Fehlerabbildung                 | Rechnen, Formatieren             |
| `ui/client`                  | MCP-Bridge, Staleness, Vertragserkennung                  | Darstellung                      |
| `ui/hooks`                   | Ladezustände, Abbruch, Reihenfolge                        | MCP-Namen, Rechnen               |
| `ui/components`, `ui/views`  | Darstellung                                               | MCP, Rechnen, Lastinterpretation |
| `shared/arnold-format`       | **jede** Gewichts- und Ausführungsformulierung            | —                                |

React-Komponenten entscheiden nie, wie eine Google-Sheets-Zeile gelesen oder eine
Kennzahl berechnet wird.

---

## 6. Datenquellen und Betriebsmodi

| `STORAGE_MODE`    | Quelle                           | Tools                         | UI                   |
| ----------------- | -------------------------------- | ----------------------------- | -------------------- |
| `demo` (Standard) | `data/demo.json`, synthetisch    | v1 inkl. Schreib-/Reset-Tools | `ArnoldApp`          |
| `google_sheets`   | Altes Trainingslog-Blatt         | v1, lesend                    | `ArnoldApp`          |
| `arnold_sheets`   | Arnold-Schema v1, sechs Tabellen | v2, lesend                    | `ArnoldDashboardApp` |

Umgebungsvariablen für `arnold_sheets`:

| Variable                         | Pflicht         | Bedeutung                                                                        |
| -------------------------------- | --------------- | -------------------------------------------------------------------------------- |
| `ARNOLD_SPREADSHEET_ID`          | ja              | Datei-ID der Arbeitsmappe                                                        |
| `MCP_ACCESS=private`             | ja              | Echte Daten nur über private MCP-Verbindung                                      |
| `GOOGLE_APPLICATION_CREDENTIALS` | ja (Produktion) | Service-Account mit Leserecht                                                    |
| `ARNOLD_EXPECTED_FILE_ROLE`      | nein            | `MASTER_TEMPLATE` oder `USER_TRACKER`; Fehlkonfiguration schlägt beim Lesen fehl |
| `ARNOLD_EXPECTED_TRACKER_ID`     | nein            | Erwartete Tracker-Identität                                                      |
| `ARNOLD_CACHE_TTL_MS`            | nein            | Standard 15000                                                                   |

Der Arnold-Modus ist wie der alte Sheets-Modus an Loopback gebunden
(`requireLoopbackOnly`). Öffentliche Hosts oder Origins werden abgelehnt.

### Datenquellenhinweis in der UI

`source.label` / `source.description` / `source.file_role` ergeben den Hinweis:
„Demo-Daten“, „Arnold · Google Sheets“ oder „Master-Vorlage · Noch keine
Workouts“. Bei `file_role: MASTER_TEMPLATE` setzt der Presenter
`state: "master_template"` und einen Hinweis; die Anwendung stellt diesen Zustand
**nie** als vollständig eingerichtetes persönliches Nutzerkonto dar.

---

## 7. Filterlogik

- Filter arbeiten über **IDs**, nicht über Namen. Das Umbenennen einer Session
  oder Übung kann eine gespeicherte Ansicht nicht brechen.
- Zeitgrenzen sind **inklusive** und werden serverseitig angewendet.
- Keine Beschränkung auf Push/Pull/Legs. Die Einheitenfilter speisen sich aus
  `session_names`, also aus den tatsächlich erfassten Namen.
- `plan_version_ids` akzeptiert auch **archivierte** Versionen, damit alte
  Einheiten auswertbar bleiben.
- Ein Filter ohne Treffer ist kein Fehler: `notices` enthält `filter_empty`.
- Die Übersicht hat ihren eigenen Zeitraumfilter, und `recent_workouts` sowie
  `session_names` werden mit derselben Auswahl gebildet. Eine Auswahl ohne
  Treffer wird ausdrücklich als solche gemeldet und **nicht** mit dem
  Willkommensbildschirm eines leeren Trackers verwechselt.
- Eine ausdrücklich angeforderte Trainingseinheit wird entweder geöffnet oder als
  „nicht in der Auswahl" gemeldet. Es wird nie stillschweigend eine andere
  Einheit angezeigt.
- Statusfilter und Kennzahlen sind getrennt: `get_arnold_workouts_v2` kann
  abgebrochene Einheiten **anzeigen**, die Analytics-Auswertung läuft aber immer
  auf der Standard-Eligibility (`completed`). Jede Zeile trägt
  `counts_towards_metrics`.

---

## 8. Darstellung von Gewichten und Ausführungsarten

Eine zentrale Stelle: `src/shared/arnold-format.ts`. Keine Komponente
interpretiert `load_basis`, `reps_basis`, `execution_mode` oder `side` selbst.

| Technischer Wert         | UI-Anzeige       |
| ------------------------ | ---------------- |
| `per_implement`          | kg pro Hantel    |
| `total`                  | Gesamtgewicht    |
| `machine_display`        | Maschinenanzeige |
| `added`                  | Zusatzgewicht    |
| `assistance`             | Unterstützung    |
| `bodyweight_only`        | Körpergewicht    |
| `bilateral_simultaneous` | Beidseitig       |
| `unilateral`             | Einseitig        |
| `alternating`            | Abwechselnd      |
| `left` / `right`         | Links / Rechts   |
| `reps_basis: per_side`   | „10 pro Seite“   |

Funktionen: `formatLoad`, `formatReps`, `formatSetLine`, `formatExecution`,
`describeSet` (Screenreader-Satz), `LOAD_BASIS_LABEL`, `SIDE_LABEL`.

Lastbezug an Kennzahlen: `ViewMetric.load_basis` trägt die Lastdefinition einer
Lastkennzahl mit, und die Fortschrittsansicht liefert zusätzlich
`max_comparable_load_comparability` und `best_estimated_1rm_comparability`. Die
Kennzahlenkarte und die Verlaufskurve benennen die Definition direkt am Wert;
die Variantentabelle weiter unten ist eine Ergänzung, kein Ersatz dafür.

Vorbehalte bei gültigen Werten: Ein korrekt berechneter Wert kann einen
fachlichen Vorbehalt tragen — ein 1RM aus einer Hantellast ist `valid` und darf
trotzdem nicht als Gesamtlast gelesen werden. Die Oberfläche zeigt `note` daher
immer, wenn die Engine eine Begründung angehängt hat, und nicht erst bei
`status !== "valid"`.

Regeln:

- `bodyweight_only` wird benannt, nicht als „0 kg“ gedruckt.
- Ein Satz zeigt die **tatsächlich gespeicherte** Ausführung, auch wenn sie vom
  Standard der Übung abweicht.
- Bestleistungen nennen immer ihre Lastdefinition. Links und Rechts sind
  getrennte Vergleichsklassen; die Engine vergleicht sie nicht gegeneinander.
- Enthält eine Übungskarte mehrere Lastdefinitionen, setzt der Presenter
  `mixed_load_basis` und die UI weist darauf hin, statt zu summieren.

---

## 9. Fehler- und Leerzustände

`state`: `ready` | `empty_history` | `empty_catalog` | `master_template`.

`notices[]`: `partial_data`, `retired_exercises_in_use`,
`removed_plan_items_in_use`, `no_plan_configured`, `weekly_goal_missing`,
`master_template`, `filter_empty`.

Fehlercodes des Datenzugriffs (`ArnoldSourceFailure`), auch in
`_meta.arnold.failure` eines fehlgeschlagenen Tool-Aufrufs:

| Code                  | Ursache                               | Wiederholbar |
| --------------------- | ------------------------------------- | ------------ |
| `auth_missing`        | Google-Anmeldung fehlt/abgelaufen     | nein         |
| `permission_denied`   | Leseberechtigung oder API fehlt       | nein         |
| `not_found`           | Datei oder Tabelle nicht gefunden     | nein         |
| `rate_limited`        | Leselimit erreicht                    | ja           |
| `unavailable`         | Google vorübergehend nicht erreichbar | ja           |
| `schema_incompatible` | Datei passt nicht zu Schema v1        | nein         |
| `unknown`             | sonstiger Fehler                      | ja           |

Verbindlich:

- Bei einem Lesefehler werden **keine** Demo-Daten eingesetzt.
- Ein fehlgeschlagener Read lässt **kein** altes Dataset als frisch erscheinen;
  der Tool-Aufruf schlägt fehl (`isError`), es gibt kein `structuredContent`.
- Werden alte Werte angezeigt, sind sie ausdrücklich als veraltet markiert
  (siehe Abschnitt 10).

### Leerer Tracker

Bei `empty_history` zeigt die Oberfläche:

> **Willkommen bei Arnold**
> Deine Trainingsdatenbasis ist bereit. Sobald du dein erstes Training erfasst,
> siehst du hier deine Fortschritte.

Keine künstlichen Beispiel-Workouts. **Kein** Onboarding-Button, solange der
Onboarding-Prozess nicht existiert — der Leerzustand enthält bewusst gar kein
`<button>` (durch einen Test abgesichert).

---

## 10. Aktualisierung des UI-Zustands

- Die App erhält ihren Startzustand aus dem Ergebnis von
  `show_arnold_dashboard`; der erste Aufbau kostet keine zusätzliche Runde.
- Jede Ansicht lädt ihre eigenen Daten über Hooks nach. Ein Filterwechsel
  initialisiert die App **nicht** neu: das vorige Ergebnis bleibt sichtbar,
  während das neue lädt.
- Antworten auf Abfragen, die die Oberfläche selbst stellt, werden **nicht**
  global publiziert, sondern an ihren Aufrufer zurückgegeben. Nur der Host
  publiziert Anwendungszustand. Diese Trennung ist der Grund, warum ein
  Aktualisierungsklick genau eine Anfrage auslöst: als jede Antwort auch
  publiziert wurde, speiste sie die Abhängigkeiten des Dashboard-Hooks und löste
  die nächste Anfrage aus.
- Zwei getrennte Absicherungen gegen veraltete Antworten: die View-Hooks
  verwerfen über einen Sequenzzähler eine überholte Antwort, und der globale
  Publish-Pfad verwirft über eine Generation eine Revalidierung, die von einem
  neueren Host-Payload überholt wurde.

### Veraltete Tool-Ergebnisse (historischer Fehler)

Beim Wiederöffnen einer ChatGPT-Unterhaltung spielt der Host das ursprüngliche
Tool-Ergebnis aus dem Chatverlauf erneut ein. Dieses Ergebnis wird **nie**
ungeprüft als aktueller Zustand übernommen:

1. `ArnoldClient.ontoolresult` erkennt das erste Ergebnis.
2. Statt es zu publizieren, fragt der Client den Server erneut — mit dem Tool,
   das zum erkannten Vertrag passt (`get_arnold_dashboard_v2` bzw.
   `get_dashboard_data`).
3. Gelingt das, wird die Serverantwort angezeigt.
4. Scheitert es, wird das wiedergespielte Ergebnis angezeigt **und** als
   möglicherweise veraltet gekennzeichnet (Banner mit Stand und
   „Jetzt aktualisieren“); zusätzlich erscheint die Fehlermeldung.
5. Eine später erfolgreiche Aktualisierung hebt die Markierung wieder auf.

Abgesichert durch `tests/arnold-bridge-staleness.test.ts` und
`tests/e2e/arnold.spec.ts` („replayed host snapshots are reconciled“).

Weitere Bridge-Pflichten: offizielle MCP-Apps-Bridge (`@modelcontextprotocol/ext-apps`),
kein eigenes `postMessage`, `autoResize`, Host-Theme über
`onhostcontextchanged`, Aufräumen in `onteardown`.

---

## 11. Auswirkungen historischer Trainingsplanänderungen

- Planversionen sind unveränderlich (`IMMUTABLE_VERSION_IDS`). `plan_history`
  listet alle Versionen mit ihrer Einheitenzahl.
- Der Name einer Einheit kommt aus `session_name_snapshot` des Workouts, nicht
  aus dem heutigen Plan.
- Der Name einer Übung kommt aus `exercise_name_snapshot` des Satzes. Die UI
  rekonstruiert historische Übungsdaten **nicht** aus dem aktiven Plan.
- Wird eine Übung aus dem Plan entfernt oder im Katalog beendet, bleibt sie in
  alten Workouts sichtbar und behält ihren damaligen Namen. Kennzeichnung über
  `retired` und `in_current_catalog`.
- Übungen, die nur noch in der Historie existieren, bleiben in `exercises`
  auswählbar, damit ihr Fortschritt erreichbar bleibt.
- Spontane Workouts ohne Planreferenz (`plan_version_id: null`) werden
  vollständig unterstützt.

---

## 12. Performance-Überlegungen

- Kennzahlen werden **aggregiert** übertragen; die Übersicht enthält nur
  `recent_workouts` (Standard 5), nicht die ganze Historie.
- Workout-Details werden bei Bedarf geladen, mit `limit`/`offset` (Standard 20,
  max. 200) und echtem `total`.
- Fortschrittsdaten werden nach Übung **und** Zeitraum gefiltert; die Engine wird
  über `progress_exercise_ids` auf genau eine Übung eingeschränkt, damit die
  Kosten nicht mit der Katalogbreite wachsen.
- Datumsfilter wirken serverseitig.
- `ArnoldSheetsDataSource` teilt einen In-flight-Read und hält das Dataset für
  `cacheTtlMs`, sodass das Öffnen des Dashboards Google nicht mehrfach anfragt.
- Die UI wird bei einem Filterwechsel nicht neu initialisiert.
- `invalidate()` erhöht eine Cache-Generation. Ein Read, der vor der
  Invalidierung gestartet wurde, darf den Bestand nicht neu befüllen — sonst
  würde ein späteres Schreib-Tool veraltete Daten zeigen.

Bekannte Grenzen: Der Presenter läuft bei jedem Aufruf über das gesamte Dataset.
Für mehrjährige Historien ist der nächste Schritt ein serverseitiger Cache der
**Analytics-Ergebnisse** je Filter — die Architektur ist darauf vorbereitet
(ein Einstiegspunkt, deterministische Ergebnisse, `metrics_version` als
Cache-Schlüsselbestandteil).

---

## 13. Vorbereitung für spätere schreibende Tools

- `ArnoldDataSource.invalidate()` existiert bereits. Ein schreibendes Tool muss
  nach erfolgreichem Schreiben `invalidate()` aufrufen; der nächste Read geht
  dann wieder an Google. Kein Cache darf nach einem Schreibvorgang veraltete
  Daten zeigen.
- Der Lese-Adapter hat bewusst **keine** `append`/`update`/`delete`-Methode.
  Schreiben gehört in einen getrennten Adapter mit eigener Validierung.
- `source.generated_at` und die Staleness-Markierung sind vorhanden, sodass ein
  Schreibvorgang die Oberfläche gezielt invalidieren kann.
- `deleted_record_policy: TOMBSTONE`: Sätze werden auf `voided` gesetzt, nicht
  entfernt. Die UI stellt verworfene Sätze bereits durchgestrichen dar und die
  Engine zählt sie nicht.
- `row_revision` ist im Schema vorhanden und kann für optimistisches Locking
  verwendet werden.

---

## 14. Vorbereitung für das Onboarding

- `file_role` und `tracker_id` unterscheiden Master-Vorlage und Nutzer-Tracker
  bereits. `ARNOLD_EXPECTED_FILE_ROLE` erzwingt die Erwartung beim Lesen.
- `state: "master_template"` und `"empty_history"` sind getrennte Zustände; das
  Onboarding kann an genau diesen Zuständen ansetzen.
- Der Leerzustand enthält bewusst keinen Button. Sobald ein Onboarding-Flow
  existiert, ist das die eine Stelle, an der er eingehängt wird.
- `onboarding_storage: BACKEND_ONLY`: Onboarding-Zustand und OAuth gehören nicht
  in Google Sheets.
- Nicht Bestandteil von Task 003: Onboarding-Flow, Google OAuth, automatische
  Tracker-Erstellung, Multiuser-Betrieb.

---

## 15. Tests

| Datei                                                  | Umfang                                                                                        |
| ------------------------------------------------------ | --------------------------------------------------------------------------------------------- |
| `tests/arnold-presenter.test.ts`                       | Dataset → Analytics → Dashboard-DTO, Leer-/Template-Zustände, Pläne, Historie                 |
| `tests/arnold-mcp-v2.test.ts`                          | Echte Streamable-HTTP-Integration der v2-Tools, Filter, Pagination, Fehlercodes               |
| `tests/arnold-ui-render.test.tsx`                      | Tool-Ergebnis → React-UI, Gewichtsdarstellung, unbekannte Kennzahlen, Diagramm-Zugänglichkeit |
| `tests/arnold-bridge-staleness.test.ts`                | Regression: wiedergespielte Tool-Ergebnisse, Staleness, Host-Lifecycle                        |
| `tests/e2e/arnold-v2.spec.ts`                          | Browser: Ansichten, Filter, Diagramme, Leerzustand, Fehler, Mobile, Themes, Bridge, WCAG A/AA |
| `tests/e2e/arnold.spec.ts`, `tests/e2e/sheets.spec.ts` | Unveränderte Demo- und Sheets-Modus-Tests                                                     |

Tests verwenden ausschließlich synthetische lokale Fixtures
(`tests/fixtures/arnold-dashboard.ts`) und verändern keine echten Trainingsdaten.

## 16. Task 004: kontrollierter Workout-Logger

`get_workout` ergänzt die lesende Oberfläche in jedem Arnold-v2-Modus um aktuelle
Rohdatensätze mit IDs/Revisionen, offene Workouts und Logger-Fähigkeiten.
Standardmäßig bleibt `can_write=false`; die sieben Schreibtools werden nur bei
explizit eingebundener Schreib-Runtime registriert. In `disabled` bleiben sie
unveröffentlicht. Der frühere Demo-Vertrag inklusive `log_demo_set` und Reset ist
unverändert.

`STORAGE_MODE=arnold_fixture` zusammen mit `ARNOLD_WRITE_MODE=fixture` startet den
v2-Logger mit synthetischem Katalog und Trainingsplan. Die UI übernimmt sichtbare
Vorschläge, zeigt unbestätigte Writes niemals als Erfolg und wiederholt unklare
Vorgänge mit derselben Operations-ID. Die MCP-App benötigt keinen direkten
Google-Zugriff. `ArnoldMcpClient` hält ausstehende Requests über Ansichtswechsel;
Browser-Previews sichern sie zusätzlich in Session Storage, soweit verfügbar.
Eine vollständige neue Host-Sitzung ohne Browser-Speicher besitzt diese lokale
Wiederherstellungsinformation nicht; der Server bleibt die Quelle des Zustands.

Dashboard-Abrufe aus Hooks werden nicht erneut als initiales Host-Ergebnis
publiziert. So führt eine bestätigte Mutation zu einem gezielten Workout-Read
und einer kompakten Dashboard-Aktualisierung, ohne eine Refresh-Schleife.

Details: [ARNOLD-WRITE-CONTRACT](ARNOLD-WRITE-CONTRACT.md).

## S001: verbindliche Recovery- und Integrationsregeln

Planverwaltung und Workout-Logger laufen im dokumentierten Fixture-Start gemeinsam. Die Read-only-Modi und die alte Demo bleiben erhalten. Produktive Writes und Google-Plan-Writes bleiben gesperrt.

`error.recovery` wird unabhängig vom Fehlercode beachtet; siehe [Write Contract](ARNOLD-WRITE-CONTRACT.md). Der Originalrequest bleibt bei einer Unklarheit erhalten. „Abgelehnten Vorgang schließen“ ist nur nach einer belegten Ablehnung sichtbar und ruft `abandon_rejected_write` auf. Erst nach dessen atomarer Journalbestätigung wird lokal gelöscht. Unklare Requests bieten keinen Verwerfungsweg. Serverfehler und Revisionskonflikte erhalten Formwerte; UI-Erfolg setzt die vollständige Commit-Bestätigung voraus.

Workout-Edits sind an die ausgewählte Workout-ID gebunden und werden beim Wechsel zurückgesetzt. Ein Submit prüft die Bindung erneut. Während eines Writes kann das Ziel nicht gewechselt werden. Lokale leere Planeinheiten gehören zur jeweiligen Planversion. Bestätigt wird exakt die Revision, die beim Öffnen des Aktivierungsdialogs angezeigt wurde.

Wesentliche Lastbezüge werden auch bei gültigen Kennzahlen angezeigt. Die Übersicht filtert Zeitraum und zugehörige Listen konsistent; Workout-Details fallen bei ausdrücklich angeforderter fehlender ID nicht auf eine fremde Einheit zurück. Host-Revalidierung und ihr Fehlerfallback dürfen bei überholter Generation nichts publizieren. Die Variantenansicht bleibt bei 390 × 844 px innerhalb der Seitenbreite.

Die Fortschrittsansicht kennzeichnet die automatisch dominante Vergleichsklasse direkt an Last-/1RM-KPI und Kurve: Ausführung, relevante Seite, mehrere Geräte und Lastdefinition. Die Engine-Metadaten sind die Quelle; es wird keine Variante aus Lastwerten geraten. Volumen und Wiederholungen umfassen alle Ausführungsarten und werden entsprechend beschriftet. Eine manuelle Variantenwahl ist nicht Bestandteil dieser Ansicht.
