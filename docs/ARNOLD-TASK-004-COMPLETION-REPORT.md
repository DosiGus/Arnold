# ARNOLD TASK 004 – COMPLETION REPORT

Prüfdatum: 26. Oktober 2026, Europe/Berlin.

## 1. Status: Completed

Task 004 ist für den definierten synthetischen Betrieb implementiert.
Produktive Schreibzugriffe bleiben ausnahmslos deaktiviert. Eine echte
Google-Testdatei wurde nicht beschrieben.

Die zuvor blockierende Task-002-QA ist in `7077ffd` und `8723df4` integriert.
Auf dieser Basis bestanden vor Beginn der Implementierung Typecheck, Build,
387 Unit-/MCP-Tests und 19 Browser-Tests. Tasks 001–003 sind in der Basis-Historie
enthalten; der ursprüngliche Blocked-Bericht aus dem ersten Versuch wird durch
diesen Bericht im Task-004-Worktree ersetzt.

Während der Arbeit wechselte eine parallele Task-005-Bearbeitung den gemeinsamen
Checkout und erweiterte gemeinsame Dateien. Task 004 wurde deshalb in einen
eigenen verwalteten Worktree übernommen und dort auf seinen vereinbarten Umfang
begrenzt. Die parallel bearbeiteten Originaldateien wurden dabei nicht
zurückgesetzt. Der abgenommene Stand enthält keine Task-005-Planverwaltung.

## 2. Implementierte Schreiboperationen

`WorkoutLoggingService` implementiert:

- `startWorkout`: freie oder referenzierte Einheit, historische Daten,
  eindeutige Plan-/Session-Zuordnung, Snapshot und Revision 1.
- `logWorkoutSets`: ein oder bis zu 100 Sätze als logische Einheit, stabile IDs,
  explizite Last-/Ausführungssemantik, Nummerierung und Referenzprüfung.
- `updateSet`: Korrektur per Satz-ID und erwarteter Revision, unveränderte
  Identität/Erstellungszeit, neue Revision und Audit-Vorher-/Nachher-Werte.
- `voidSet`: Tombstone ohne Zeilenlöschung.
- `completeWorkout`: Abschluss nur aus zulässigem Zustand und mit mindestens
  einem aktiven Satz mit Wiederholungen.
- `cancelWorkout`: Abbruch unter Erhaltung aller Rohdaten.
- `createExercise`: neue genaue Übungsvariante mit Dublettenprüfung; keine
  Änderung eines Trainingsplans.

Tatsächliche Rohwerte werden gespeichert, keine berechneten Volumen-/1RM-Felder.
Es wird nichts ungeprüft verdoppelt. Körpergewichts-, Maschinen-, Zusatz- und
Unterstützungsdefinitionen folgen dem bestehenden Schema und der Analytics Engine.

## 3. Neue MCP-Tools

`start_workout`, `log_workout_sets`, `update_set`, `void_set`,
`complete_workout`, `cancel_workout`, `create_exercise`; zusätzlich lesend
`get_workout` mit aktuellen IDs, Revisionen, Katalog, Planvorschlägen und
Schreibfähigkeiten.

Alle Verträge sind mit Zod definiert. Fachliche Antworten enthalten
`structuredContent`, tatsächliche Datensätze/IDs/Revisionen und einen expliziten
`replayed`-Hinweis. Fehler haben verständliche Meldungen und definierte Codes.
Es gibt kein öffentliches Tool für beliebige Zellbereiche oder Datei-IDs.

Die sieben Schreibtools werden nur bei ausdrücklich eingebundener Schreib-Runtime
registriert. Die normale Arnold-Verbindung bleibt lesend; `get_workout` kommt
als fünftes lesendes Tool hinzu. Der alte Demo-Vertrag bleibt erhalten.

## 4. Neue und veränderte Dateien

Neue Implementierungsdateien:

- `src/shared/workout-contract.ts`
- `src/server/workout/infrastructure.ts`
- `src/server/workout/service.ts`
- `src/server/workout/fixture.ts`
- `src/server/arnold-sheets-write-adapter.ts`
- `src/server/mcp-workout.ts`
- `src/ui/hooks/useWorkoutLogger.ts`
- `src/ui/views/WorkoutLoggerView.tsx`

Geänderte Integration:

- `src/server/http.ts`, `src/server/mcp-arnold.ts`, `src/server/arnold-source.ts`
- `src/ui/ArnoldDashboardApp.tsx`, `src/ui/client.ts`,
  `src/ui/client/ArnoldMcpClient.ts`, `src/ui/style.css`
- `.env.example`, `.gitignore`, `README.md`
- `tests/arnold-mcp-v2.test.ts`, `tests/fixtures/arnold-server.ts`

Neue Tests/Fixtures:

- `tests/workout-logging.test.ts`
- `tests/arnold-write-adapter.test.ts`
- `tests/workout-mcp.test.ts`
- `tests/workout-cache.test.ts`
- `tests/workout-restart.test.ts`
- `tests/http-assets.test.ts`
- `tests/fixtures/arnold-write-sheets.ts`
- `tests/e2e/workout-logger.spec.ts`

Dokumentation:

- `docs/ARNOLD-WRITE-CONTRACT.md`: vollständige Architektur, Verträge,
  Fehler-/Recovery-Protokoll, Sicherheitsgrenzen und Beispiele.
- `docs/ARNOLD-UI-CONTRACT.md`: Task-004-Erweiterung.
- Dieser Abschlussbericht.

Der verbundene Datenvertrag v1.0.0 und die Analytics-Berechnungsdateien bleiben
unverändert. `.gitignore` schließt auch einen lokalen `node_modules`-Symlink aus.

## 5. Workout- und Satzstatusmodell

| Zustand               | Zulässige Operationen                                                               |
| --------------------- | ----------------------------------------------------------------------------------- |
| Noch kein Workout     | Start → `in_progress`                                                               |
| `planned`             | Abbruch → `cancelled`                                                               |
| `in_progress`         | Sätze loggen/korrigieren/stornieren; Abschluss → `completed`; Abbruch → `cancelled` |
| `completed`           | Ausschließlich explizit autorisierte Satzkorrektur/-stornierung                     |
| `cancelled`, `voided` | Keine weitere Mutation durch Task-004-Tools                                         |

Sätze: `active -> active` bei Korrektur, `active -> voided` bei Stornierung.
Keine physische Löschung oder stille Wiederöffnung. Abgeschlossene Workouts
verlangen `correct_completed=true`, eine Korrekturbegründung und das gesonderte
Recht `correct_completed`. `planned -> in_progress` und Wiederaufnahme sind
spätere Erweiterungen, kein versteckter Nebenweg.

Historische Plan-/Workout-Referenzen, Namen-Snapshots, IDs und Erstellungsdaten
bleiben geschützt. Ein später aktivierter Plan wird einem früheren Workout
nicht automatisch zugeordnet.

## 6. Idempotenz- und Nebenläufigkeitsstrategie

SHA-256-Fingerprint aus kanonischem fachlichem Payload und Operationsname.
Ledger-Schlüssel aus Tracker-ID und Request-ID; geprüfter Akteur wird zusätzlich
gebunden. Gleiches Request/Payload → ursprüngliches Ergebnis, keine zweite
Änderung. Abweichender Payload/Akteur → `DUPLICATE_OPERATION`.

Vor dem Storage-Aufruf speichert das Journal die vollständigen Änderungen und
stabilen IDs: `prepared -> dispatching -> committed`. Erfolg erfolgt erst nach
Readback, Audit und abschließender Journalbestätigung. Der lokale Datei-Adapter
verwendet Dateirechte 0600, Flush und atomaren Rename.

Der per-Tracker-Koordinator serialisiert parallele Writes innerhalb eines
Prozesses. Unterschiedliche Anfragen erhalten konsistente Satznummern; bei
parallelen Korrekturen derselben Revision kann nur eine gewinnen. Alle Services
für denselben Tracker müssen dasselbe Ledger und denselben Koordinator verwenden.

Bei Antwortverlust oder fehlender letzter Ledger-Bestätigung wird anhand der
bereits journalisierten IDs reconciliiert. Teilweise/unbekannte Änderungen
sperren weitere Writes. Auch eine zunächst leere Antwort nach Timeout führt zu
keinem blinden Append-Retry. Ein Test mit zwei echten Node-Prozessen belegt den
Wiederanlauf nach gespeichertem Rohdatensatz und Prozessende vor der Ledger-
Bestätigung. Die dazu verwendete Storage-Datei enthält ausschließlich Fixtures.

Keine Exactly-once-Garantie für mehrere Instanzen oder vollständigen Journalverlust.

## 7. Google-Sheets-Write-Adapter

Der getrennte `ArnoldSheetsWriteAdapter` prüft Datei-ID, Rolle, Tracker,
Schema-Version, alle sechs Header/Tabellen, Grenzen, Referenzen und Revisionen.
Nur WORKOUTS, SETS und EXERCISES sind beschreibbar.

Zusammengehörige Änderungen werden in einem `spreadsheets.batchUpdate` gebündelt.
Updates lösen die physische Zeile jedes Mal über die stabile ID auf. Neue Zeilen
werden je Tabelle gebündelt. Texte verwenden `stringValue`, Zahlen `numberValue`;
Notizen mit führendem `=` bleiben Literaltext. Der vollständige Batch wird
anschließend durch Readback geprüft.

Die feste Arnold-Master-ID ist bereits im Konstruktor gesperrt. Zusätzlich wird
`CONFIG.file_role=MASTER_TEMPLATE` unabhängig von der Datei-ID abgewiesen.
Fremde/unzugewiesene Tracker und beschädigte Tabellen verhindern Writes.

HTTP 429: begrenzter exponentieller Backoff mit Jitter, höchstens drei Versuche
bei eindeutigem Reject. 401/403/404 werden gezielt klassifiziert. Netzwerkfehler,
Timeout oder unsichere 5xx-Antworten werden vor einer Wiederholung reconciliiert.
Unerwartete externe Dataset-Änderungen während der Adapter-Laufzeit führen zur
Quarantäne. Dies ist kein atomarer Compare-and-Swap gegen manuelle Bearbeiter.

## 8. Testmodus und Sicherheitsgrenzen

`disabled` ist Standard. `fixture` erfordert zusätzlich
`STORAGE_MODE=arnold_fixture` und verwendet ausschließlich synthetische Daten im
Arbeitsspeicher. Ein Serverneustart setzt diesen Tracker zurück.

`test_sheet` ist nicht per Environment freischaltbar. Eine vertrauenswürdige
Integration muss dedizierte Datei, Freigabe, Tracker-Zuordnung, privaten lokalen
Server, Request-Authentifizierer, Service-Guard sowie den je Dispatch geprüften
Adapter-Akteur bereitstellen. Ein Boolean oder `MCP_ACCESS=private` reicht nicht.

`production` wird ausnahmslos abgelehnt. Keine Nutzerkonten wurden simuliert, um
reale Berechtigungen zu umgehen. Die Test-Akteure existieren nur an synthetischen
Testgrenzen. Keine OAuth-, Tunnel-, Deployment-, Datenbank- oder produktive
ChatGPT-Verbindungsänderung. Keine echten Trainingsdaten oder Masterdateien
wurden beschrieben und keine Zugangsdaten committet.

## 9. UI-Logger-Integration

Die bestehende v2-App erhält bei vorhandener Schreibberechtigung „Training
eintragen“. Workout starten/auswählen, Übung und sichtbare Ausführungsdefaults,
Last und Wiederholungen, optionale RPE/RIR, Speichern, Korrektur, Stornierung
laufender Sätze, Abschluss und Abbruch sind integriert.

Die App zeigt ausschließlich bestätigte Datensätze. Formularwerte bleiben bei
Fehlern erhalten. Ein synchrones Submit-Gate verhindert doppelte Klicks.
Unklare Vorgänge behalten denselben Payload und dieselbe ID und bieten eine
gezielte Statusprüfung per idempotentem Retry. Browser-Reload wird bei
verfügbarem Session Storage unterstützt. Im opaken MCP-App-Sandbox bleibt ein
Request im gemeinsamen Client über Ansichtswechsel erhalten.

Die drei neuen Browser-Tests prüfen den vollständigen Workflow, Antwortverlust
mit Reload sowie die offizielle AppBridge ohne Browser-Speicher. Historische
Tool-Ergebnisse und Demo-Reset werden durch die bestehenden Browser-Tests
weiterhin geprüft.

## 10. Analytics-Aktualisierung

Jede bestätigte oder möglicherweise bereits wirksame Mutation invalidiert die
Datenquelle. Ein Generation-Guard verhindert, dass ein alter In-flight-Read
anschließend wieder als frisch gecacht wird. Die Optionsübergabe an den strikten
Read-Adapter wurde dabei korrigiert.

Die UI lädt gezielt den Workout-Zustand und kompakte Dashboard-Kennzahlen nach.
Dashboard-Antworten aus Hooks werden nicht erneut als initiales Host-Ergebnis
publiziert; eine dabei aufgedeckte Refresh-Schleife ist behoben. Korrigierte
Lasten ändern Volumen/PRs, stornierte Sätze fallen aus der Berechnung, abgebrochene
Workouts zählen nicht als abgeschlossen. Die Analytics Engine selbst schreibt
weiterhin nichts.

## 11. Audit-Implementierung

Austauschbares `AuditLogRepository`, deduplizierende In-Memory-Implementierung
und sieben geforderte Eventtypen. Je Event: Operation, Entity, Zeitpunkt,
technischer/geprüfter Akteur, alte/neue Revision, bestätigtes Ergebnis,
geänderte Felder und relevante Mess-/Status-Vorher-/Nachher-Werte. Freie
Notizinhalte werden nicht im Audit dupliziert. Korrekturen abgeschlossener
Workouts enthalten die ausdrückliche Begründung.

Der dauerhafte produktive Audit-Speicher bleibt Aufgabe des späteren Backends.
Es gibt keine zusätzliche Sheet-Tabelle.

## 12. Ergebnisse aller Abschlussprüfungen

Ausgeführt im isolierten Worktree mit Node `v26.7.0`, npm `11.19.0`, ausschließlich
synthetischen Daten und lokalen Testservern:

| Prüfung                | Tatsächliches Endergebnis                                                           |
| ---------------------- | ----------------------------------------------------------------------------------- |
| `npm run typecheck`    | Bestanden, Exit 0                                                                   |
| `npm test`             | Bestanden, Exit 0: **468 Tests in 29 Dateien**, keine übersprungenen Tests          |
| `npm run build`        | Bestanden, Exit 0: UI, Host und TypeScript-Server                                   |
| `npm run test:e2e`     | Bestanden, Exit 0: **22 Browser-Tests**, inklusive Demo, Read-only und neuem Logger |
| `npm run format:check` | Bestanden, Exit 0; Bericht nach Erstellung zusätzlich geprüft                       |
| `git diff --check`     | Bestanden                                                                           |

Gesamt: **490 bestandene automatisierte Tests**; gegenüber der integrierten Basis
81 zusätzliche Unit-/MCP-Testfälle und drei Browser-Tests mit mehreren Schritten.

Die vollständigen lokalen Endprotokolle liegen unter
`/private/tmp/arnold004-final-tests.log`,
`/private/tmp/arnold004-final-build.log` und
`/private/tmp/arnold004-final-e2e-verified.log`.

Vorläufe waren nicht alle grün: Der erste Sandbox-Test konnte keine lokalen Ports
öffnen und wurde mit erlaubten Loopback-Ports erfolgreich wiederholt. Ein
Logger-Browser-Test deckte die behobene Refresh-Schleife auf; anschließend wurde
sein Select-Locator auf die tatsächliche Combobox-Rolle präzisiert. Nach dem
Worktree-Wechsel fehlten zunächst Build-Artefakte; danach verweigerte Express
HTML-Dateien im versteckten `.codex`-Pfad. Der überholte Browserlauf wurde nach
acht Fehlern gezielt abgebrochen, die auf zwei feste öffentliche Assets begrenzte
Auslieferung korrigiert und per Regression gegen beliebige versteckte Dateien
abgesichert. Die vollständige frische Gesamtabnahme danach besteht.

## 13. Bekannte Risiken und technische Einschränkungen

- Sheets-Read/Revision plus Batch ist kein atomarer CAS gegen andere Clients.
  Externe Änderungen im letzten Prüf-/Schreibfenster bleiben ein Restrisiko.
- Der Koordinator und Datei-Ledger sind Ein-Prozess-Bausteine. Keine verteilte
  Garantie und kein automatischer Recovery-Dienst.
- Ein vollständig verlorenes Intent-Journal erfordert Backup und manuellen
  Abgleich. Es darf nicht mit leerem Ledger auf einem bestehenden Tracker
  weitergeschrieben werden.
- Fixture-Rohdaten und Fixture-Audit sind flüchtig. Der Datei-Ledger belegt
  separat die Wiederanlauf-Schnittstelle; er macht den Fixture-Modus nicht produktiv.
- Eine vollständig neue opake Host-Sitzung ohne Speicher verliert lokale
  Formular-/Request-Entwürfe. Es entsteht daraus keine automatische neue Mutation.
- Die Verifikation liest derzeit das vollständige begrenzte Domain-Dataset und prüft darin gezielt die betroffenen IDs. Das erhöht Google-Lesezugriffe; eine spätere Optimierung muss die gleichen Integritätsprüfungen erhalten.
- Es gab keinen Live-Write gegen Google. Die API-Grenze ist mit einem
  atomaren synthetischen Transport und injizierten Fehlern getestet.

## 14. Fehlende Voraussetzungen für produktive Writes

Echte Nutzeridentität, Tracker-Eigentum/Autorisierung, OAuth und Token-Speicher,
serverübergreifendes transaktionales Ledger, verteilte Koordination, dauerhafte
Auditierung, Drift-Checkpoints über Neustarts, Backups, getestete Wiederherstellung
und ein operativer Reconciliation-Prozess. Diese Bestandteile sind vorbereitet
beziehungsweise als Schnittstellen definiert, nicht als produktiv vorhanden
behauptet. Produktionsfreigabe bleibt bis Task 007 gesperrt.

## 15. Abweichungen vom Auftrag

Kein optionaler Live-Test mangels dedizierter ausdrücklich autorisierter
Testdatei und real geprüfter Nutzerintegration. Kein externer Dienst eingerichtet.

Schreibtools werden bei `disabled` nicht veröffentlicht; der Service prüft die
Sperre zusätzlich. Scalar-Schemafehler kann die MCP-SDK bereits vor dem Handler
als Protokoll-/Toolfehler ablehnen; fachliche Fehler liefern das einheitliche
strukturierte Ergebnis. Für abgeschlossene Workouts wurde der ausdrücklich
berechtigte Korrekturvorgang statt Wiederöffnung gewählt.

Die bestehende Demo-Oberfläche bleibt erhalten; der Arnold-Schema-v1-Logger
verwendet ihre vorhandene Gestaltung und MCP-Bridge im v2-Dashboard. Kein
Plan-Editor, kein Onboarding, keine Sheet-Schemaänderung. Die Agent-Anleitung
wurde nur gelesen; notwendige Ergänzungen sind im Write Contract vorgeschlagen.

## 16. Git-Branch und Commit-SHA

- Branch: `feat/arnold-workout-logging`.
- Integrierte Basis: `8723df4`.
- Implementierungscommit: `32d9d8e4ec39409066b850b156d32283aeb6a505`.
- Worktree: `/Users/kevingusmao/.codex/worktrees/arnold-workout-logging/Arnold`.
- Veröffentlichung: auf ausdrücklichen Nutzerwunsch am 26.10.2026 nach
  `origin/feat/arnold-workout-logging` gepusht. Kein Merge nach `main`, kein PR,
  kein Deployment. Der parallel bearbeitete ursprüngliche Checkout bleibt separat.
- Der separat veröffentlichte Task-003-QA-Branch `fix/task-003-qa` (`f85fb54`) ist
  noch nicht in diesen Task-004-Branch integriert. Die Abnahme oben bezieht sich
  auf die angegebene Basis `8723df4` plus Task 004; diese Integrationslücke muss
  der unabhängige Prüfer ausdrücklich berücksichtigen.

## 17. Empfehlung für Task 005

Task 005 sollte diesen geprüften Task-004-Commit als gemeinsame Grundlage
übernehmen und dieselben Ledger-/Audit-/Koordinator-Schnittstellen kontrolliert
um Planoperationen erweitern. Plan- und Workout-Writes müssen je Tracker
zusammen koordiniert werden. Aktive/archivierte Planinhalte bleiben unveränderlich;
neue Inhalte benötigen neue Versions-, Session- und Planpositions-IDs. Keine
Vorziehung der späteren Produktionsfreigabe.

## Ausdrückliche Abnahmeantworten

| Frage                                             | Antwort                                                                                                                                                                                                                                                       |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Mehrere Sätze zuverlässig speichern?              | Ja, als geprüfte logische Einheit; In-Memory atomar, Sheets in einem Batch. Teilzustände werden nie als vollständiger Erfolg gemeldet.                                                                                                                        |
| Doppelte MCP-Aufrufe erkannt?                     | Ja, Request-ID/Fingerprint/Akteur; Replay liefert das ursprüngliche Ergebnis, geänderter Payload einen Konflikt.                                                                                                                                              |
| Parallele Writes?                                 | Ein-Prozess-Serialisierung je Tracker, aktuelle Revisionsprüfung und konsistente Nummern. Mehrinstanzbetrieb bleibt gesperrt.                                                                                                                                 |
| Abgeschlossene Workouts korrigieren?              | Ja, ausschließlich explizit mit gesondertem Recht und Begründung, stabiler Satz-ID, erwarteter Revision und Audit.                                                                                                                                            |
| Alte Planversionen und Referenzen erhalten?       | Ja. Task 004 besitzt keinen Plan-Schreibpfad; historische IDs, Referenzen und Snapshots sind geschützt.                                                                                                                                                       |
| Ein- und beidseitige Übungen korrekt gespeichert? | Ja, inklusive zwei Kurzhanteln, getrennten Links-/Rechts-Sätzen und expliziter alternierender Wiederholungsbasis.                                                                                                                                             |
| Korrekturen/Stornierungen in Analytics?           | Ja, neue Reads berechnen Volumen, PRs und Verläufe aus dem aktualisierten Dataset; voided Sätze werden ausgeschlossen.                                                                                                                                        |
| Masterdatei geschützt?                            | Ja, feste Datei-ID und CONFIG-Rolle werden gesperrt; Tests belegen beide Grenzen. Es gab keinen realen Schreibzugriff.                                                                                                                                        |
| Welche Garantien sind implementiert?              | Lokale Koordination, Revisionsprüfung, vorbereitete IDs/Journal, Readback, idempotentes Fixture-Audit, Mode-/Rollen-/Akteurprüfungen, sichere Fehlerbehandlung und UI-Retry. Verteilte Autorisierung/Persistenz/Recovery sind noch keine Produktionsgarantie. |
| Produktion weiterhin deaktiviert?                 | Ja, ausnahmslos.                                                                                                                                                                                                                                              |
| Bisherige MCP-App funktioniert?                   | Ja, die vorhandenen Demo-/Read-only-/Bridge-/Reset-Browserprüfungen und die neue Logger-Bridge-Prüfung bestehen.                                                                                                                                              |
| Tests tatsächlich erfolgreich ausgeführt?         | Ja: 468 Unit-/MCP-Tests, 22 Browser-Tests sowie Typecheck, Build und Formatprüfung.                                                                                                                                                                           |

Task 004 endet mit diesem Bericht. Es wird keine automatische Fortsetzung oder
Task-005-Ausführung aus diesem Chat eingerichtet.
