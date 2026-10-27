# ARNOLD TASK 005 – COMPLETION REPORT

**Trainingsplanverwaltung, Versionierungsengine und interaktiver MCP-Planeditor**

Branch: `feat/arnold-plan-management`
Datum: 2026-10-27
Vertrag: `arnold.plan/1` über Datenschema `arnold.training_raw` 1.0.0

---

## 1. Status

**Completed** – mit einer bewusst dokumentierten Einschränkung: schreibende
Planoperationen sind ausschließlich im Fixture-Modus freigeschaltet. Für
`PLANS` und `PLAN_ITEMS` existiert absichtlich **kein** Google-Schreibpfad,
solange die produktive Nutzerauthentifizierung nicht abgeschlossen ist
(Auftragsvorgaben §15, §23).

Vor Entwicklungsbeginn geprüft: Tasks 001–004 waren integriert
(`npm run typecheck` fehlerfrei, 459 Tests grün). Es wurde kein konkurrierendes
Domain-Modell eingeführt – die Planobjekte sind eine Projektion der bestehenden
sechs Tabellen.

---

## 2. Implementierte Domain Services

| Service               | Datei                           | Aufgabe                                                                                                               |
| --------------------- | ------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `TrainingPlanService` | `src/server/plan/service.ts`    | Die einzige Stelle, die einen Trainingsplan ändert. Lesen, Validieren, Vergleichen, Bearbeiten, Aktivieren, Verwerfen |
| Planversionierung     | `src/server/plan/versioning.ts` | Entwurfsmodell, alle typisierten Bearbeitungsoperationen, Ableitung neuer Versionen                                   |
| Planvalidierung       | `src/server/plan/validation.ts` | Prüfung in drei Registern (Fehler / Hinweise / Empfehlungen)                                                          |
| Domain-Projektion     | `src/server/plan/domain.ts`     | Abbildung der Tabellen auf das Domain-Modell, State Machine                                                           |
| Versionsvergleich     | `src/server/plan/comparison.ts` | Unterschied zweier Versionen, maschinen- und anzeigefertig                                                            |
| Commit-Protokoll      | `src/server/plan/commit.ts`     | Parametrisierte Schreibsequenz auf Basis der Task-004-Infrastruktur                                                   |
| Fehlervokabular       | `src/server/plan/errors.ts`     | Plan-Fehlercodes, Übersetzung an der Infrastrukturgrenze                                                              |
| Fixture-Runtime       | `src/server/plan/fixture.ts`    | Synthetischer Tracker, der Plan- und Workout-Service gemeinsam bedient                                                |

Architekturtreue: fachliche Planregeln liegen vollständig im Backend, die
MCP-Tools sind schlanke Schnittstellen, die React-App enthält keine
Planversionierungslogik und keine eigene Planberechnung. Der Planservice ist
unabhängig von Google Sheets und greift ausschließlich über die bestehende
Repository-Schnittstelle zu.

---

## 3. Trainingsplan-State-Machine

```text
draft ──activate_training_plan──▶ active ──(Nachfolger aktiviert)──▶ archived
  │                                                                     ▲
  └──────────────── archive_plan_draft ────────────────────────────────┘
```

Genau drei Übergänge, kein Weg zurück nach `draft`. Implementiert als
`PLAN_TRANSITIONS` / `canTransition` in `domain.ts`; ein Test prüft die Tabelle
und dass kein Status nach `draft` führt.

Maximal eine aktive Version je Tracker, gehalten an drei Stellen: Datenvertrag
(`ArnoldDatasetSchema`), atomarer Aktivierungs-Batch (Archivierung des
Vorgängers im selben Batch), Validierung (eine nicht-Draft-Version ist nicht
aktivierbar).

Unveränderlichkeit aktiver Versionen ist dreifach abgesichert – Service,
Änderungsvalidator für `planItems`, Änderungsvalidator für Inhaltsspalten von
`PLANS`. Zwei Tests umgehen den Service und rufen `repository.apply(...)`
direkt auf; beide Schreibversuche werden abgewiesen.

---

## 4. Planversionierungsstrategie

| Gegenstand        | Regel                                                                                                       |
| ----------------- | ----------------------------------------------------------------------------------------------------------- |
| `plan_version_id` | immer neu                                                                                                   |
| `plan_family_id`  | bleibt bei Änderung derselben Routine; neu bei eigenständigem Plan                                          |
| `version_no`      | höchste Nummer der Familie + 1; eindeutig je Familie                                                        |
| `plan_item_id`    | **jede** Position einer neuen Version erhält eine neue ID                                                   |
| `session_id`      | stabil für fortgeführte Einheiten innerhalb der Familie; neu bei neuer Einheit, Duplikat oder neuer Familie |
| `exercise_id`     | unverändert referenziert, nie neu erzeugt                                                                   |
| Löschen           | existiert nicht – Entfernen ist `status = removed` (Tombstone)                                              |

Die Quellversion wird bei einer Ableitung ausschließlich gelesen. Mehrere Tests
vergleichen den kanonischen Hash der Quellzeilen vor und nach der Operation und
belegen Byte-Identität.

Beim Austausch gegen eine andere Bewegungsvariante werden Sätze, Wiederholungen
und Pause übernommen, **Zielgewicht und Gewichtsdefinition jedoch nicht**:
„70 kg gesamt" ist nicht „70 kg pro Hantel".

Reihenfolgewerte werden beim Speichern aus der Anzeigereihenfolge neu
durchnummeriert; doppelte oder lückenhafte Werte sind über die Operationen nicht
erreichbar.

---

## 5. Neue MCP-Tools

### Lesend

| Tool                      | Funktion                                                         |
| ------------------------- | ---------------------------------------------------------------- |
| `get_training_plan`       | Planversion laden; ohne ID die aktive, sonst der neueste Entwurf |
| `list_training_plans`     | Planfamilien mit allen Versionen und Lebenszyklusdaten           |
| `get_plan_history`        | Historie, neueste zuerst, mit Abstand zur aktiven Version        |
| `validate_training_plan`  | Planentwurf prüfen                                               |
| `compare_plan_versions`   | Planänderungen vergleichen                                       |
| `get_plan_editor_context` | Alles für eine Editoransicht in einem Aufruf                     |

### Schreibend

| Tool                     | Funktion                                              |
| ------------------------ | ----------------------------------------------------- |
| `create_training_plan`   | neuen Planentwurf anlegen                             |
| `create_plan_version`    | neue Draft-Version eines bestehenden Plans            |
| `clone_plan_version`     | Alias für den Wiederherstellungspfad                  |
| `update_plan_draft`      | typisierte Änderungen am Entwurf (13 Operationstypen) |
| `activate_training_plan` | bestätigten Entwurf aktivieren                        |
| `archive_plan_draft`     | Entwurf verwerfen                                     |

Alle Tools mit Zod-Input- **und** -Output-Schema, `structuredContent`, präzisen
deutschen Beschreibungen und MCP-Annotationen. `destructiveHint: true` nur für
Aktivierung und Verwerfen. Ohne eingebundene Planverwaltung wird **kein**
Plan-Tool registriert – ein Test belegt das.

Statt eines Tools je Kleinänderung bündelt `update_plan_draft` alle
Änderungsarten: `update_plan_metadata`, `add_session`, `rename_session`,
`reorder_sessions`, `duplicate_session`, `remove_session`,
`add_plan_exercise`, `replace_plan_exercise`, `remove_plan_exercise`,
`reorder_plan_exercises`, `update_plan_exercise_targets`,
`update_plan_exercise_execution`, `replace_draft_sessions`.

---

## 6. Neue und veränderte Dateien

### Neu (7 702 Zeilen Produktionscode)

```text
src/shared/plan-contract.ts                 663   Domain-Modell, Operationen, Tool-Schemas
src/server/plan/service.ts                 1015   TrainingPlanService
src/server/plan/versioning.ts               829   Entwurfsmodell und Bearbeitungen
src/server/plan/fixture.ts                  766   synthetischer Plan-Runtime
src/server/plan/validation.ts               493   Planvalidierung
src/server/plan/comparison.ts               426   Versionsvergleich
src/server/plan/domain.ts                   323   Projektion und State Machine
src/server/plan/commit.ts                   246   Commit-Protokoll
src/server/plan/errors.ts                    62   Fehlervokabular
src/server/mcp-plan.ts                      314   MCP-Tools
src/ui/components/plan.tsx                 1354   Editorkomponenten
src/ui/views/TrainingPlanEditorView.tsx     652   Der Editor
src/ui/hooks/usePlanEditor.ts               559   UI-State-Machine
docs/ARNOLD-PLAN-CONTRACT.md                  –   Vertragsdokumentation (25 Abschnitte)
tests/fixtures/arnold-plan.ts                 –   deterministischer Testharness
tests/plan-{creation,versioning,sessions,exercises,activation,history,security,mcp}.test.ts
tests/plan-ui-render.test.tsx
tests/e2e/plan-editor.spec.ts
```

### Geändert (minimal und additiv)

| Datei                                                     | Änderung                                                                                                                                                                |
| --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/server/workout/infrastructure.ts`                    | `EntityChange` um `plans`/`planItems`; `entityId`; `createdAt`-Helfer; Plan-Audit-Ereignistypen; Journal-Ergebnis als Union; Unveränderlichkeitsregeln für Plantabellen |
| `src/server/workout/service.ts`                           | eine Zeile: `createdAt(...)` statt direktem Feldzugriff (PLAN_ITEMS führt keine Zeitstempel)                                                                            |
| `src/server/arnold-sheets-write-adapter.ts`               | Tabellenliste typisiert; Plantabellen bleiben ausgeschlossen                                                                                                            |
| `src/server/mcp-arnold.ts`                                | Plan-Tools registrieren                                                                                                                                                 |
| `src/server/http.ts`                                      | Planservice in die Runtime einbinden                                                                                                                                    |
| `src/ui/ArnoldDashboardApp.tsx`                           | Navigationspunkt „Trainingsplan" mit Fähigkeitsprüfung                                                                                                                  |
| `src/ui/client.ts`                                        | strukturierte Plan-Schreibfehler durchreichen statt als Transportfehler werfen                                                                                          |
| `src/ui/client/ArnoldMcpClient.ts`                        | Plan-Methoden und getrenntes Pending-Bookkeeping                                                                                                                        |
| `src/ui/style.css`                                        | Editor-Styles ausschließlich auf bestehenden Tokens                                                                                                                     |
| `playwright.config.ts`, `tests/fixtures/arnold-server.ts` | Fixture-Server 8796–8799                                                                                                                                                |

Nicht committete Nutzeränderungen an Task-004-Dateien wurden nicht
überschrieben. Der Nutzer hat während der Umsetzung parallel an
`workout/infrastructure.ts`, `workout/service.ts`, `arnold-sheets-write-adapter.ts`,
`ui/client.ts` und weiteren Dateien gearbeitet; alle Eingriffe dort waren
chirurgisch und additiv.

---

## 7. Funktionen des visuellen Planeditors

Erreichbar über den Navigationspunkt „Trainingsplan" in der bestehenden
React-MCP-App. Eine Ansicht für den gesamten Lebenszyklus, kein Seitenwechsel.

Der Nutzer kann: Trainingseinheiten auswählen, hinzufügen, umbenennen,
umsortieren, duplizieren und aus dem Entwurf entfernen; Übungen hinzufügen,
entfernen, austauschen und umsortieren; Zielsätze, Wiederholungsbereiche,
Zielgewichte und Ausführungen bearbeiten; den Entwurf speichern, Änderungen
überprüfen, einen gültigen Plan bestätigen und aktivieren, einen Entwurf
verwerfen, frühere Versionen anzeigen und wiederverwenden, einen weiteren
Trainingsplan anlegen.

Komponenten: `TrainingPlanEditorView`, `TrainingSessionCard`,
`PlannedExerciseRow`, `ExercisePicker`, `ExerciseSettingsPanel`,
`PlanOverview`, `PlanVersionHistory`, `PlanChangeSummary`,
`PlanValidationPanel`, `PlanActivationDialog`, `PlanDialog`.

Umgesetzte UX-Regeln:

- Häufige Änderungen (Sätze, Wiederholungen, Zielgewicht) direkt in der
  Übungskarte; seltenere Einstellungen im Detaildialog.
- Technische IDs nie als primäre Beschriftung.
- Standardwerte für Ausführung und Gewichtsdefinition aus dem Übungskatalog.
- Ein geplantes Gewicht ist immer als Ziel benannt und trägt immer seine
  Gewichtsdefinition („Ziel 20 kg pro Hantel"); die Formulierung kommt
  ausschließlich aus `formatLoad`.
- Navigation allein aktiviert nie einen Plan.
- Eingaben bleiben bei einem Netzwerkfehler erhalten; der Vorgang wird mit
  derselben Operations-ID geprüft, nicht wiederholt.
- Tastaturbedienbar, mobil nutzbar, Screenreader-Beschriftung an jeder Aktion,
  Hell- und Dunkel-Theme, Fokusfang in Dialogen.
- **Automatisierte WCAG-A/AA-Prüfung ohne Verstöße** in sechs Zuständen:
  aktiver Plan, Entwurf, Prüfergebnis, Übungsauswahl, Aktivierungsdialog,
  Planhistorie.

Zwei UI-Fehler wurden dabei gefunden und behoben: ein verdoppeltes „kg kg" in
der Zielwertzeile (eine Lastkonvention wurde zweimal interpretiert) und
Hinweistexte, die als Teil des Feldnamens vorgelesen wurden (jetzt
`aria-describedby`). Dialoge fokussierten anfangs ihren Schließen-Button; sie
fokussieren nun das erste inhaltliche Feld.

---

## 8. Historische Daten und Referenzintegrität

| Zusage                                               | Belegt durch                                                            |
| ---------------------------------------------------- | ----------------------------------------------------------------------- |
| Abgeschlossene Workouts bleiben an ihrer Planversion | Hash-Vergleich von `WORKOUTS` und `SETS` vor/nach Planwechsel           |
| Laufende Workouts behalten ihre Planreferenz         | Test startet ein Workout, wechselt den Plan, prüft `plan_version_id`    |
| Geloggte Gewichte werden nie überschrieben           | Test ändert `target_load_kg` auf 200 und vergleicht alle `SETS.load_kg` |
| Historische Session-Namen bleiben nachvollziehbar    | `session_name_snapshot` unverändert nach Umbenennung                    |
| Alte Planversionen bleiben inhaltlich unverändert    | Byte-Vergleich der archivierten Version                                 |
| Entfernte Übungen bleiben historisch auswertbar      | Tombstone statt Löschung; Katalogeintrag unberührt                      |
| Archivierte Versionen bleiben lesbar                 | `get_training_plan` liefert sie vollständig                             |

Der Planservice schreibt **nie** nach `WORKOUTS` oder `SETS` – es gibt keinen
Codepfad dafür.

---

## 9. Integration mit Workout Logging

Plan- und Workout-Service teilen Repository, Operationsjournal,
Schreibkoordinator, Audit-Log, Autorisierungs-Guard und Änderungsvalidator.
Es wurde **keine** zweite Authentifizierungs- oder Idempotenzschicht gebaut.

Belegt: `start_workout` nutzt die aktuell aktivierte Planversion; nach einer
Aktivierung verwendet ein neues Workout die neue Version; Satz-Logging
funktioniert nach einem Planwechsel unverändert; ein gleichzeitiger
Planschreibvorgang und ein Workout-Start auf demselben Tracker werden
serialisiert und hinterlassen einen schemakonformen Datensatz.

Die drei e2e-Tests des Workout-Loggers aus Task 004 laufen unverändert grün.

---

## 10. Integration mit Analytics Engine

Keine Änderung an der Analytics Engine war nötig. Belegt:

- `planVersionAt()` löst nach einer Aktivierung korrekt auf: für ein Datum vor
  dem ersten Wechsel Version 1, danach Version 2, nach der neuen Aktivierung
  Version 3.
- `buildArnoldDashboardAnalytics` zählt nach einem Planwechsel weiterhin beide
  historischen Workouts.
- Das Dashboard (`buildDashboardView`) zeigt die neue aktive Version und listet
  in `plan_history` alle Versionen, die es je gab.
- Ein verworfener Entwurf wird von `planVersionAt()` zu **keinem** Datum
  ausgewählt – ein Test prüft mehrere Daten.

---

## 11. Idempotenz und Nebenläufigkeit

Jede Schreiboperation trägt eine `request_id` und läuft durch das
Operationsjournal aus Task 004.

Belegt:

- Wiederholte identische Anfrage → `replayed: true`, genau eine Änderung.
- Wiederholte Aktivierung mit derselben `request_id` → idempotent, identischer
  Aktivierungszeitpunkt, genau ein aktiver Plan.
- Gleiche `request_id` mit anderem Payload → `DUPLICATE_OPERATION`.
- Veraltete Revision → `REVISION_CONFLICT`, die fremde Änderung bleibt erhalten.
- Zwei gleichzeitige `create_plan_version` → Versionsnummern 3 und 4, keine
  Dublette.
- Zwei gleichzeitige Aktivierungen → höchstens eine aktive Version.
- Sechs aufeinanderfolgende Mehrfachänderungen → Datensatz nach jeder Runde
  schemakonform, Revision exakt +1 je Runde.
- Ein Browsertest lässt zwei Tabs auf demselben Entwurf konkurrieren und
  belegt, dass die fremde Änderung nicht überschrieben wird.

Erfolg wird erst nach Datenvertrag, Readback, Audit und Journal-Commit
gemeldet. Ein unklarer Ausgang ergibt `COMMIT_STATUS_UNKNOWN` mit
`retryable: true` und **keiner** Erfolgsmeldung.

---

## 12. Sicherheitsmechanismen

| Mechanismus                                                                  | Status                                  |
| ---------------------------------------------------------------------------- | --------------------------------------- |
| Master-Vorlage verweigert jede Schreiboperation                              | belegt (`TEMPLATE_WRITE_FORBIDDEN`)     |
| Arnold-Masterdatei-ID lässt den Schreibadapter nicht konstruieren            | belegt                                  |
| Fremder Tracker wird abgewiesen                                              | belegt                                  |
| Unverifizierte Identität wird abgewiesen                                     | belegt (`AUTH_REQUIRED`)                |
| Akteur ohne Schreibrecht wird abgewiesen                                     | belegt (`PERMISSION_DENIED`)            |
| `mode: "production"` lässt den Planservice nicht konstruieren                | belegt                                  |
| `mode: "test_sheet"` lässt den Planservice nicht konstruieren                | belegt                                  |
| Kein Google-Schreibpfad für `PLANS`/`PLAN_ITEMS`                             | belegt                                  |
| Keine Teilschreibung bei Ablehnung                                           | belegt (Hash-Vergleich des Datensatzes) |
| Aktive und archivierte Versionen inhaltlich unveränderlich                   | belegt, auch bei Umgehung des Service   |
| Deaktivierte Verbindung meldet `can_write: false`, Lesen funktioniert weiter | belegt                                  |
| Keine zweite Authentifizierungsschicht                                       | Guard aus Task 004 unverändert          |
| Keine echten Nutzerdaten in Tests                                            | ausschließlich synthetische Fixtures    |

Die Arnold-Masterdatei wurde nicht verändert. Es wurden keine Zugangsdaten
committet, kein OAuth implementiert, keine Tunnel- oder Plugin-Konfiguration
angefasst, kein Deployment ausgeführt und kein externer Datenbankdienst
eingerichtet.

---

## 13. Testresultate

Alle fünf Abschlussprüfungen wurden ausgeführt. Tatsächliche Ergebnisse:

| Befehl                 | Ergebnis                                                  |
| ---------------------- | --------------------------------------------------------- |
| `npm run typecheck`    | **fehlerfrei**                                            |
| `npm test`             | **647 Tests / 36 Dateien grün**, 0 Fehler                 |
| `npm run build`        | **erfolgreich** (UI 1 130 kB, Host 340 kB)                |
| `npm run test:e2e`     | **35 Tests grün**, 0 Fehler                               |
| `npm run format:check` | **sauber** – „All matched files use Prettier code style!" |

### Neue Tests in Task 005: 182 Unit-/Integrationstests + 13 Browsertests

| Datei                     | Tests | Schwerpunkt                                                              |
| ------------------------- | ----- | ------------------------------------------------------------------------ |
| `plan-creation.test.ts`   | 21    | Planerstellung, beliebige Splits (1 bis 5 Einheiten), State Machine      |
| `plan-versioning.test.ts` | 13    | Versionierung, ID-Strategien, Unveränderlichkeit, Nebenläufigkeit        |
| `plan-sessions.test.ts`   | 16    | Einheiten hinzufügen, umbenennen, sortieren, duplizieren, entfernen      |
| `plan-exercises.test.ts`  | 23    | Übungen hinzufügen, austauschen, entfernen, sortieren, Ziele, Ausführung |
| `plan-activation.test.ts` | 22    | Aktivierung, Bestätigung, Idempotenz, Verwerfen                          |
| `plan-history.test.ts`    | 19    | Historie, Vergleich, historische Integrität, Analytics                   |
| `plan-security.test.ts`   | 25    | Schreibschutz, Autorisierung, Konflikte, Audit, Validierungsregister     |
| `plan-mcp.test.ts`        | 17    | MCP-Tools über echten HTTP-Transport                                     |
| `plan-ui-render.test.tsx` | 26    | Editorkomponenten gegen echte Service-Payloads                           |
| `e2e/plan-editor.spec.ts` | 13    | Browserfluss, Konflikt, Tastatur, mobil, Dunkel-Theme, WCAG              |

Die Baseline vor Beginn lag bei 459 Tests; parallele Nutzerarbeit an Task 004
brachte sie auf 465. Die 182 neuen Tests ergeben 647.

Abgedeckt sind alle in §21 des Auftrags genannten Fälle, einschließlich: Plan
ohne Übungen als Draft behandeln, parallele Erstellung derselben Versionsnummer
kontrollieren, veraltete Bestätigung ablehnen, unklaren Commit-Status korrekt
behandeln, Master-Template verweigert Schreiboperation.

---

## 14. Einschränkungen des Google-Sheets-Schemas

Vollständig dokumentiert in `docs/ARNOLD-PLAN-CONTRACT.md` §24, jeweils mit
konkretem Migrationsvorschlag. Zusammengefasst:

1. **Leere Trainingseinheit nicht speicherbar** (`EMPTY_SESSION_NOT_PERSISTABLE`).
   Eine Einheit existiert nur über ihre Planpositionen. Umgang: Der Editor hält
   eine neue leere Einheit lokal, kennzeichnet sie ausdrücklich als „Noch nicht
   gespeichert", gibt sie als `persisted: false` aus und blockiert die
   Aktivierung. Mit der ersten Übung wird sie über `add_session` echt.
   Migration: eigene `SESSIONS`-Tabelle.

2. **Keine `SESSIONS`-Tabelle** (`NO_SESSION_TABLE`). Name und Reihenfolge
   liegen redundant auf jeder Position; eine Umbenennung ist ein Massenupdate.
   Gleiche Migration.

3. **Keine Zeitstempel in `PLAN_ITEMS`** (`NO_PLAN_ITEM_TIMESTAMPS`). Der
   Änderungszeitpunkt wird über `PLANS.updated_at_utc` abgebildet.
   Migration: `created_at_utc`/`updated_at_utc` ergänzen.

4. **Nur ein aktiver Plan** (`SINGLE_ACTIVE_PLAN_ONLY`). Mehrere parallele
   aktive Pläne sind in V1 ausgeschlossen. Migration: `plan_track_key`.

5. **Entwurf verwerfen ohne Aktivierung.** `ArnoldPlanVersionSchema` verlangt
   für `status = archived` ein gesetztes `activated_at_utc`. `archive_plan_draft`
   setzt daher `activated_at_utc` und `retired_at_utc` auf **denselben**
   Zeitpunkt – ein Fenster der Länge null, das `planVersionAt()` zu keinem Datum
   auswählen kann (durch Test belegt). Dieses Paar ist das dokumentierte
   Kennzeichen für „verworfener Entwurf, nie aktiv gewesen"; die Schreibantwort
   weist ausdrücklich darauf hin. Migration: Statuswert `discarded` **oder**
   `activated_at_utc` für `archived` nullable.

Keine ungeprüfte zusätzliche Tabelle wurde angelegt. Die Master-Datei wurde
nicht verändert.

---

## 15. Offene technische Risiken

| Risiko                               | Auswirkung                                                      | Minderung / Status                                                   |
| ------------------------------------ | --------------------------------------------------------------- | -------------------------------------------------------------------- |
| Prozesslokale Schreibkoordination    | Zwei Serverinstanzen auf demselben Tracker könnten verschränken | Nur eine Instanz je Tracker; verteilte Sperre offen                  |
| Journal `memory`/`local`             | Idempotenz übersteht keinen Instanzwechsel                      | `FileOperationLedger` übersteht Neustart; verteiltes Journal offen   |
| Externe manuelle Tabellenänderung    | Nicht durch Constraints abgedeckt                               | Fingerprint-Erkennung sperrt den Tracker bis zur Klärung             |
| Verworfener Entwurf als „archiviert" | Rohdatenleser könnte `activated == retired` fehldeuten          | Dokumentiertes Kennzeichen, Analytics-Test, Migrationsvorschlag      |
| Doppeltes Commit-Protokoll           | Zwei Implementierungen könnten auseinanderlaufen                | Gleiche Reihenfolge und Garantien; Zusammenführung als Folgeaufgabe  |
| Entwürfe sammeln sich an             | Viele verworfene Versionen in der Historie                      | Historie filtert nach Status; Aufräumen offen                        |
| Massenupdate bei Umbenennung         | Eine Umbenennung schreibt alle Positionen der Einheit           | Durch Modell-Diff minimiert; echte Lösung ist die `SESSIONS`-Tabelle |
| Keine produktive Autorisierung       | Planänderungen nur im Fixture-Modus                             | Beabsichtigt; Freigabe erst mit abgeschlossener Authentifizierung    |

---

## 16. Abweichungen vom ursprünglichen Auftrag

1. **Kein Google-Schreibpfad für Plantabellen.** Der Auftrag erlaubte in §23
   Fixture-Modus „beziehungsweise" einen aus Task 004 autorisierten Testmodus.
   Umgesetzt wurde ausschließlich der Fixture-Modus. Begründung: Der
   Google-Schreibadapter ist Teil der noch nicht committeten Task-004-Arbeit;
   seine Schreibfläche auf zwei weitere Tabellen auszuweiten wäre eine
   sicherheitsrelevante Änderung an laufender Fremdarbeit. §15 verlangt
   ausdrücklich, keine produktiven Google-Schreibzugriffe zu ermöglichen. Der
   nötige Schritt ist dokumentiert.

2. **Commit-Protokoll liegt zweimal vor.** Es wurde als parametrisierter
   `commitWrite` neu geschrieben und für die Plandomäne verwendet; der
   Workout-Service behält seine Inline-Variante. Grund: `workout/service.ts`
   wurde während der Umsetzung aktiv vom Nutzer bearbeitet; ein Umbau hätte
   diese Arbeit überschrieben. Beide Implementierungen halten dieselbe
   Reihenfolge und dieselben Garantien; die Zusammenführung ist als
   Folgeaufgabe dokumentiert.

3. **`archive_plan_draft` nutzt ein Sentinel.** Siehe §14 Punkt 5 – der vom
   Auftrag geforderte Übergang `draft → archived` ist im bestehenden Schema
   nicht verlustfrei darstellbar.

4. **Keine serverseitig erfundenen Trainingsvorgaben.** Sätze, Wiederholungen,
   Zielgewicht und Pause bleiben `null`, wenn sie nicht angegeben werden. Die
   vom Auftrag gewünschten „sinnvollen Standardwerte" werden als sichtbare,
   änderbare Formularvorschläge im Editor umgesetzt (3 Sätze, 8–12
   Wiederholungen, 120 s). Begründung: Der Übungskatalog enthält keine
   Satz-/Wiederholungsvorgaben; sie im Backend zu erfinden widerspräche dem
   Projektprinzip, nichts zu raten. Ausführung und Gewichtsdefinition stammen
   dagegen tatsächlich aus dem Katalog.

5. **Einheitennamen innerhalb eines Plans eindeutig.** Vom Auftrag nicht
   verlangt, aber nötig, damit die namensbasierte Session-Erkennung in
   `start_workout` (Task 004) eindeutig bleibt. Verglichen wird normalisiert.

6. **Der Editor öffnet auf dem aktiven Plan, nicht auf dem neuesten Entwurf.**
   Offene Entwürfe werden gesondert angeboten. Das entspricht §17
   („VIEWING_ACTIVE", „Der Bearbeiten-Button erstellt beziehungsweise öffnet
   einen Draft") und war eine Korrektur während der Browsertests.

7. **`DRAFT_SAVED` erscheint nicht als eigener Dauerzustand.** Nach einem
   erfolgreichen Speichern geht die UI direkt in `EDITING_DRAFT`,
   `READY_FOR_CONFIRMATION` oder `DRAFT_INVALID` über und zeigt die Bestätigung
   als Meldung. Der Zustand ist definiert und beschriftet, wird aber nicht
   künstlich gehalten.

---

## 17. Git-Branch und Commit-SHA

**Branch:** `feat/arnold-plan-management` (erstellt aus
`feat/arnold-workout-logging`, damit auf dem integrierten Stand gearbeitet wird)

**Commit-SHA:** keiner. Es wurde **nicht committet**.

Begründung: Die Task-004-Arbeit des Nutzers ist weiterhin nicht committet und
liegt in denselben Dateien wie Teile dieser Umsetzung
(`workout/infrastructure.ts`, `workout/service.ts`, `ui/client.ts`,
`arnold-sheets-write-adapter.ts`, `mcp-arnold.ts`, `http.ts`,
`ArnoldDashboardApp.tsx`, `style.css`). Ein Commit würde fremde, unfertige
Arbeit in einen Task-005-Commit bündeln. Die Aufteilung ist eine Entscheidung
des Nutzers; die Arbeit liegt vollständig im Arbeitsbaum des Branches.

Letzter Commit auf dem Branch: `8723df4` („Carry the corrected engine results
through the dashboard presenter").

---

## 18. Empfehlung für Task 006

1. **Onboarding auf dem vorhandenen Editor aufbauen.**
   `TrainingPlanEditorView` nimmt `embedded` an und funktioniert auf einem
   leeren Tracker. Der Ablauf „KI-Vorschlag → Editor → Bestätigen → Aktivieren"
   lässt sich ohne Änderung an der Plandomäne verdrahten.
2. **`create_training_plan` mit `origin: "ai_proposal"` nutzen.** Der Service
   nimmt einen vollständigen strukturierten Vorschlag entgegen und speichert
   ihn als Entwurf; es gibt keinen Pfad, der ihn ohne Bestätigung aktiviert.
3. **Reihenfolge beachten:** Tracker anlegen und autorisieren, **dann**
   aktivieren. Aktivierung braucht einen schreibfähigen Tracker.
4. **Vor der produktiven Freigabe zuerst Task 007 (Authentifizierung)
   abschließen.** Danach sind genau drei Schritte nötig: `PLANS`/`PLAN_ITEMS`
   in den Google-Schreibadapter aufnehmen, `test_sheet` im Planservice
   zulassen, verteilte Sperre und verteiltes Journal bereitstellen.
5. **Die beiden Folgeaufgaben aus diesem Bericht einplanen:**
   Zusammenführung des Commit-Protokolls und die Schema-Migration für
   `SESSIONS` (löst drei der fünf dokumentierten Schemagrenzen auf einmal).

---

## Verbindliche Abnahmefragen

**Können beliebige Trainingspläne erstellt werden?**
Ja. `split_key` und `session_name` sind freier Text, kein Codepfad verzweigt
darauf, die Anzahl der Einheiten ist nicht begrenzt. Belegt für Ganzkörper,
Push/Pull/Legs, Oberkörper/Unterkörper, einen individuellen Vier-Tage-Split,
einen Plan mit nur einer wiederkehrenden Einheit und einen mit fünf Einheiten.

**Können vorhandene Pläne geändert werden, ohne die historische Version zu
verändern?**
Ja. Eine Änderung läuft immer über eine neue Draft-Version; die Quellversion
wird nur gelesen. Belegt durch Byte-Vergleich der Quellzeilen vor und nach der
Operation.

**Bleiben alte Workout-Referenzen gültig?**
Ja. `plan_version_id`, `session_id` und `plan_item_id` bleiben auflösbar, weil
Entfernen ein Tombstone ist und der Planservice nie nach `WORKOUTS` oder `SETS`
schreibt.

**Können Übungen und Trainingseinheiten hinzugefügt, entfernt und ersetzt
werden?**
Ja, über `update_plan_draft` mit 13 typisierten Operationen – sowohl aus
ChatGPT als auch aus dem Editor, über denselben Codepfad.

**Werden Planänderungen versioniert?**
Ja. Neue `plan_version_id`, eindeutige `version_no` je Planfamilie, neue
`plan_item_id` für jede Position, stabile `session_id` für fortgeführte
Einheiten.

**Wird ein neuer Plan erst nach ausdrücklicher Bestätigung aktiviert?**
Ja. `activate_training_plan` verlangt eine `confirmation`, die dieselbe
Planversion **und** dieselbe Revision nennt. Eine erfolgreiche Validierung ist
keine Bestätigung; eine veraltete Bestätigung wird mit `STALE_CONFIRMATION`
abgewiesen. Navigation allein aktiviert nichts – ein Browsertest belegt das.

**Kann niemals versehentlich eine aktive Version direkt verändert werden?**
Nein, das ist dreifach ausgeschlossen: der Service lehnt es ab, der
Änderungsvalidator lehnt Positionsänderungen an nicht-Draft-Versionen ab, und
er lehnt Inhaltsänderungen an nicht-Draft-`PLANS`-Zeilen ab. Zwei Tests umgehen
den Service und werden auf Speicherebene abgewiesen. Der Editor bietet an einem
aktiven Plan keine Bearbeitungssteuerelemente an.

**Ist das Aktivieren mehrerer Pläne gleichzeitig ausgeschlossen?**
Ja. Die Archivierung des Vorgängers liegt im selben atomaren Batch wie die
Aktivierung, und der Datenvertrag lehnt einen Datensatz mit zwei aktiven Plänen
ab. Belegt auch für zwei gleichzeitige Aktivierungsversuche.

**Funktioniert die bestehende Arnold-UI weiterhin?**
Ja. Alle Tests der Tasks 001–004 laufen unverändert grün: 647 Unit-Tests und
35 Browsertests, darunter die Dashboard-, Historie-, Fortschritts- und
Workout-Logger-Flüsse.

**Funktioniert der neue Trainingsplan-Editor innerhalb des MCP-App-Hosts?**
Ja. Der Editor ist Teil derselben React-MCP-App, nutzt denselben
`ArnoldClient` und dieselbe MCP-Bridge. Alle Planoperationen laufen über
MCP-Tools; 13 Browsertests treiben den Editor über die reale Oberfläche.

**Sind die Funktionen für das zukünftige Onboarding wiederverwendbar?**
Ja. Der Editor nimmt `embedded` an, setzt keinen vorhandenen Plan voraus, und
`create_training_plan` akzeptiert vollständige strukturierte Vorschläge aus
manueller Erstellung, bestehendem Plan, KI-Vorschlag oder Kopie.

**Wurden sämtliche Tests erfolgreich ausgeführt?**
Ja. `npm run typecheck` fehlerfrei, `npm test` 647/647, `npm run build`
erfolgreich, `npm run test:e2e` 35/35, `npm run format:check` sauber.

**Welche Funktionen sind bereits implementiert und welche benötigen noch
produktive Authentifizierung?**
Vollständig implementiert und getestet: das gesamte Domain-Modell, die
Versionierungsengine, alle Bearbeitungsoperationen, Validierung, Aktivierung,
Historie, Vergleich, Wiederherstellung, alle MCP-Tools, der visuelle Editor,
Idempotenz, Nebenläufigkeit, Auditierung und die Schutzmechanismen – lauffähig
im Fixture-Modus.

Produktive Authentifizierung benötigen: schreibende Planoperationen gegen eine
echte Google-Datei (`PLANS`/`PLAN_ITEMS` sind im Google-Adapter bewusst
ausgeschlossen, `test_sheet` und `production` lassen den Planservice nicht
konstruieren), die benutzerbezogene Autorisierung je Tracker und eine verteilte
Sperre samt verteiltem Journal für mehrere Serverinstanzen.

**Wurde die Arnold-Masterdatei unverändert gelassen?**
Ja. Es gab keinen Zugriff auf die Masterdatei. Ihre Spreadsheet-ID lässt den
Schreibadapter nicht konstruieren, jeder Datensatz mit
`file_role = MASTER_TEMPLATE` wird vor jedem Schreibvorgang mit
`TEMPLATE_WRITE_FORBIDDEN` abgewiesen, und alle Tests arbeiten ausschließlich
auf synthetischen In-Memory-Fixtures.
