# ARNOLD – INDEPENDENT QA REPORT

**1. Prüfgegenstand**

- **Task:** ARNOLD TASK 004 – Secure Workout Logging Engine & Google Sheets Write Infrastructure.
- **Repository:** [DosiGus/Arnold](https://github.com/DosiGus/Arnold).
- **Branch:** `feat/arnold-workout-logging`.
- **Zielcommit:** [815c91db0c55dcfeb978166b2693f61bdb57c7fe](https://github.com/DosiGus/Arnold/commit/815c91db0c55dcfeb978166b2693f61bdb57c7fe).
- **Vergleichsbasis:** `8723df4157c4572a65c95624054b2f9c061990eb`.
- **Prüfdatum:** 26.10.2026, Europe/Berlin.
- **Originalauftrag:** [unveränderte Kopie](/Users/kevingusmao/.codex/visualizations/2026/10/25/01a1744f-9d58-75f1-854d-61b15b7dc7bb/arnold-task-004-qa/ARNOLD-TASK-004-ORIGINAL.txt).
- **Gelesene Entwicklerdokumente:** [Write Contract](/Users/kevingusmao/.codex/visualizations/2026/10/25/01a1744f-9d58-75f1-854d-61b15b7dc7bb/arnold-task-004-qa/reviewed-source/docs/ARNOLD-WRITE-CONTRACT.md), [Completion Report](/Users/kevingusmao/.codex/visualizations/2026/10/25/01a1744f-9d58-75f1-854d-61b15b7dc7bb/arnold-task-004-qa/reviewed-source/docs/ARNOLD-TASK-004-COMPLETION-REPORT.md).

Die GitHub-Verbindung bestätigt: Der Remote-Branch entspricht exakt dem Zielcommit, `ahead_by=0`, `behind_by=0`. Die Basis ist der gemeinsame Vorfahr; zwischen Basis und Ziel liegen drei Commits und 31 geänderte Dateien mit 5.775 hinzugefügten und 34 entfernten Zeilen. Der Implementierungscommit ist `32d9d8e`, die beiden weiteren Commits ändern die Dokumentation. Nachweise: [GitHub-Abgleich](/Users/kevingusmao/.codex/visualizations/2026/10/25/01a1744f-9d58-75f1-854d-61b15b7dc7bb/arnold-task-004-qa/github-verification.json), [Git-Protokoll](/Users/kevingusmao/.codex/visualizations/2026/10/25/01a1744f-9d58-75f1-854d-61b15b7dc7bb/arnold-task-004-qa/git-verification.txt).

Der ursprüngliche Arbeitsordner stand auf `feat/arnold-plan-management` bei `8723df4` und enthielt bereits umfangreiche uncommittete/parallele Arbeiten. Geprüft wurde deshalb ein Export ausschließlich des Zielcommits unter `/private/tmp/arnold-qa-815c91d`. Kein Checkout-Wechsel, Reset, Commit, Push oder Merge durch diese Prüfung. Keine Änderungen am Entwicklungsbranch, keine Zugriffe auf echte Google-Sheets-Daten oder Änderungen echter Trainingslogs. Alle 31 geänderten Dateien wurden bytegleich gegen `git show <Zielcommit>:<Datei>` geprüft. Die folgenden lokalen Code-Links führen auf gesicherte Kopien dieses Commits, unabhängig von späteren Änderungen im Arbeitsordner. [Dateiprüfsummen](/Users/kevingusmao/.codex/visualizations/2026/10/25/01a1744f-9d58-75f1-854d-61b15b7dc7bb/arnold-task-004-qa/source-manifest.json).

**2. Gesamtergebnis**

**FAIL – Nacharbeit vor Abnahme erforderlich.**

Die wesentlichen Schreiboperationen, der gesperrte Produktionsmodus, Master-Schutz, Revisionen, Journal, Audit-Schnittstelle und synthetische Tests sind vorhanden. Die gemeldeten **468 Unit-/MCP-Tests und 22 Browsertests bestehen auch bei unabhängiger Ausführung**.

Die Gegenproben zeigen dennoch vier neue Fehler und eine weiterhin offene Integrationsanforderung:

| Finding | Priorität | Auswirkung |
| --- | --- | --- |
| F01 | P1 | Nach Workout-Wechsel kann die Korrektur das zuvor ausgewählte Workout verändern. |
| F02 | P1 | Nach eindeutig abgelehntem Write verliert die UI den notwendigen Wiederholungsauftrag; neue Writes werden durch das Journal blockiert. |
| F03 | P2 | Append kann die eigene Lesegrenze überschreiten und den Tracker anschließend unlesbar machen. |
| F04 | P2 | Ein Workout vom Oktober 2026 lässt sich mit Endzeit im Jahr 2000 erfolgreich abschließen. |
| F05 | P1 | Task-003-Korrekturen sind nicht vollständig integriert; falsche Dashboard-Werte und die Host-Antwort-Race bestehen weiter. |

**Kein P0-Befund und kein nachgewiesener Zugriff auf fremde echte Nutzerdaten.** Der aktuelle Produktionsschutz funktioniert in den geprüften Konfigurationen. Fehlende spätere Produktionsbausteine sind im Auftrag ausdrücklich erlaubt und allein kein Grund für dieses FAIL. Entscheidend sind die reproduzierten Fehler im vereinbarten Funktionsumfang.

**3. Anforderungsprüfung**

PASS bedeutet durch Code und/oder ausgeführte Tests belegt. PARTIAL bezeichnet eine vorhandene Funktion mit Einschränkung; NOT VERIFIED bezeichnet einen nicht durchgeführten externen Nachweis.

| Anforderung aus Originalauftrag | Bewertung | Nachweis / Einschränkung |
| --- | --- | --- |
| Abgeschlossene, integrierte Tasks 001–003 als Grundlage | **FAIL** | Task-002-Korrekturen vorhanden; Task-003-QA-Branch `f85fb54` kein Vorfahr. Sieben unabhängige Integrationsprüfungen schlagen weiterhin fehl, F05. |
| Neues Feature-Branch und begrenzter Task-004-Umfang | PASS | Angegebener Branch/Commit verifiziert; keine Task-005-Planverwaltung im geprüften Commit. |
| Eigenständiger Application Service; austauschbare Repositories | PASS | `WorkoutLoggingService`, Repository-, Guard-, Ledger-, Audit- und Coordinator-Schnittstellen. |
| Bestehendes Schema 1.0.0 mit sechs Tabellen erhalten | PASS | Schema und Analytics-Rechenmodule gegenüber Basis unverändert; keine Audit-Tabelle angelegt. |
| Freie und planbezogene Workouts starten | PASS | Historische Daten, gültige/ungültige Referenzen, eindeutige und mehrdeutige Session-Zuordnung getestet. |
| Datum, Zeitzone, Snapshot, stabile ID, Revision 1 | PASS | UTC-/Datum-/Zeitzonenvalidierung; UUIDv7; bekannte Startzeit muss zum lokalen Tag passen. |
| Einzelne und mehrere Sätze als logische Einheit | PASS | Ein und drei Sätze, bis 100 pro Request; Validierung vor Mutation; zusammengehörige Sheets-Änderungen in einem Batch. |
| Bekannte aktive Übungen, Planposition/Workout/Session prüfen | PASS | Unbekannte/inaktive Übungen und falsche Referenzen werden abgelehnt. |
| Lastbasis, Gerätezahl, Seite, Wiederholungsbasis explizit | PASS | Keine automatische Gewichtsverdopplung; mehrdeutige Kombinationen werden abgewiesen. |
| Rohgewichte, Lastarten, Warmup/Working und spontane Übungen erhalten | PASS | Service-/Adaptertests, Körpergewicht, unilateral, bilateral und alternierend. |
| Ungewöhnliche gültige Messwerte nicht pauschal verbieten | PASS | Service liefert Warnungen für hohe Lasten/Wiederholungen. Keine Behauptung, dass jede UI diese Warnungen vollständig darstellt. |
| Satznummern, Übungsreihenfolge, stabile Namen-Snapshots | PASS | Konkurrierende Vergabe serialisiert; aktive Duplikate durch Domain-Schema abgewiesen. |
| Satzkorrektur per ID mit erwarteter Revision | **PARTIAL** | Service schützt ID/Referenzen und weist alte Revisionen ab. Die UI kann nach Auswahlwechsel die falsche, alte Satz-ID senden, F01. |
| Satzstornierung als Tombstone, keine physische Löschung | PASS | Status `voided`, Revision erhöht, Wiederholung derselben Operation dedupliziert. |
| Workout abschließen; mindestens ein aktiver Satz | **PARTIAL** | Lifecycle/Revision/Idempotenz bestehen; Plausibilität der bekannten Endzeit bei unbekannter Startzeit fehlt, F04. |
| Kontrollierte Korrektur abgeschlossener Workouts | PASS | `correct_completed=true`, Begründung und gesondertes Recht; keine stille Wiederöffnung. |
| Abbruch erhält Sätze und historische Daten | PASS | `cancelled`; abgeschlossene Kennzahlen schließen abgebrochene Einheiten aus. |
| Neue Übung mit stabiler ID und Dublettenprüfung | PASS | Normalisierte Namen bzw. Family-/Variant-Treffer verhindern automatische Dublette; kein Plan-Edit. |
| Request-ID plus kanonischer Payload-Fingerprint | PASS | Gleiche Operation dedupliziert; andere Operation/Payload/Akteur unter derselben ID abgelehnt. |
| Neustart und „Storage gespeichert, Ledger-Bestätigung verloren“ | PASS im lokalen Modell | Datei-Journal und tatsächlicher Zwei-Prozess-Test bestehen. Kein verteilter Nachweis behauptet. |
| Timeout/Teilcommit: erst prüfen, keine blinde Append-Wiederholung | PASS | Unsichere/teilweise Ergebnisse sperren weitere Mutationen; gleiche IDs werden zur Prüfung benutzt. |
| Wiederaufnahme nach eindeutig abgelehntem Write | **FAIL** | Service hält `prepared`; UI verwirft Request bei u.a. `AUTH_REQUIRED`/`PERMISSION_DENIED`; neue IDs bleiben blockiert, F02. |
| Pro-Tracker-Koordination und Revisionskonflikte | PASS für einen Prozess | Parallele gleiche/unterschiedliche Requests und konkurrierende Korrekturen getestet; verteilte Umsetzung ausdrücklich offen. |
| Unsichere Vorgänge blockieren Folgeschreibvorgänge | PASS | Journal-Pending-Prüfung vorhanden; F02 betrifft die fehlende Abgrenzung eindeutig abgelehnter Vorgänge. |
| Getrennter Sheets-Writer; nur freigegebene Tabellen/Spalten | PASS | Nur WORKOUTS/SETS/EXERCISES; kein öffentliches Range-Write-Tool. |
| Datei, Rolle, Tracker, sechs Header, Struktur vor Write prüfen | PASS | Master/fremde Tracker/Schema/Header/Merges und feste Master-ID getestet. |
| Begrenzte Batches und unterstützte Tabellengröße erhalten | **PARTIAL** | Request auf 100 Sätze begrenzt; die prognostizierte Tabellengröße nach Append wird nicht geprüft, F03. |
| Zielzeile jedes Mal anhand stabiler ID bestimmen | PASS | Blank-Row-/Revisions-/historische Referenztests. |
| Verifizierter Readback vor Erfolg | PASS | Vollständiges Dataset plus erwartete Datensätze; Audit-/Ledgerfehler verhindern Erfolg. F03 verhindert jedoch den Readback nach eigener Grenzüberschreitung. |
| 429 begrenzt mit Backoff/Jitter; 401/403/404 klassifiziert | **PARTIAL** | Adaptertests bestehen; durchgehende UI-/Ledger-Recovery für definitive Ablehnungen fehlerhaft, F02. |
| Freitext als Literal, keine Formelausführung | PASS | `stringValue`; Formelähnliche Namen/Notizen und Readback getestet. |
| disabled standardmäßig; fixture nur ausdrücklich | PASS | Env-Resolver, Service und Tool-Registrierung schließen standardmäßig. |
| test_sheet nur dedizierte Datei und vertrauenswürdige Autorisierung | PASS als vorbereitete Schnittstelle | Nicht allein per Env einschaltbar; Request-Authenticator, Service-Guard und Adapter-Akteur erforderlich. |
| production bis Task 007 gesperrt | PASS | Env-Resolver und Service-Konstruktor lehnen Produktion ab. |
| Sieben MCP-Writes mit Zod und strukturierten Ergebnissen | PASS | Tool-Liste, IDs, Revisionen, Fehlercodes, Replay-Anzeige und Annotations über echtes lokales Streamable HTTP getestet. |
| UI Start/Auswahl/Speichern/Korrektur/Abschluss | **PARTIAL** | Grundworkflow besteht; Zielbindung einer Korrektur nach Workout-Wechsel fehlt, F01. |
| Bestätigte Anzeige, Fehler erhalten Formwerte, Doppelklickschutz | PASS für geprüfte Grundfälle | Browsertests inkl. Doppelklick und ungültiger Eingabe. |
| Unklare Requests behalten ID auch nach Reload/Ansichtswechsel | **PARTIAL** | Verlorene Erfolgsantwort/Reload und opake AppBridge bestehen; definitive Fehler erzeugen abweichenden defekten Lebenszyklus, F02. |
| Gezielter Read und Analytics-Cache-Invalidierung | PASS | Generation-Guard und Source-Konfigurationskorrektur unabhängig bestätigt; kein vollständiges Dashboard im Write-Ergebnis. |
| Korrektur/Stornierung aktualisiert PRs/Volumen; richtige Anzeige | **PARTIAL** | Engine-/Service-Integration und Invalidierung bestehen; Arbeitssatz-KPI und Lastbeschriftungen weiterhin falsch, F05. |
| Historische Tool-Ergebnisse überschreiben keine neueren Daten | **FAIL** | Langsame erste Host-Revalidierung publiziert anschließend ältere Daten als frisch, F05. |
| Audit-Schnittstelle mit sieben Ereignissen, Akteur und Revisionen | PASS | Deduplizierte lokale Audit-Events; relevante Vorher-/Nachher-Werte; freie Notizen nicht unnötig dupliziert. |
| Bestehender Demo-Modus, Reset und Lesefunktionen | PASS für vorhandene Suite | Alle bisherigen Browser-/MCP-Tests bestehen. Nicht jede frühere Task-003-QA-Randbedingung damit behoben. |
| Write Contract und Abschlussbericht vorhanden | **PARTIAL** | Beide gelesen und überwiegend konsistent; „Completed“ trotz dokumentierter Integrationslücke und neuer Fehler nicht abnahmefähig. |
| Optionaler echter Google-Schreibtest | NOT VERIFIED | Kein Live-Write; keine dafür ausdrücklich freigegebene dedizierte Datei/echte Authentifizierung verwendet. Im Auftrag optional. |
| Kompatibilität mit externer Drive-Agent-Anleitung | NOT VERIFIED | Entwickler dokumentiert Lesen und Änderungsvorschläge; die externe Drive-Datei wurde in dieser Prüfung nicht erneut abgerufen. Lokale Datenverträge geprüft. |
| Keine Produktions-, OAuth-, Tunnel-, Deployment- oder Schema-Ausweitung | PASS im Commit-Diff | Kein solcher Änderungspfad im geprüften Delta; keine Behauptung über außerhalb von Git vorgenommene Handlungen anderer Agenten. |

**4. Code-Review Findings**

**F01 – P1: Workout-Wechsel lässt die Korrektur auf dem alten Satz stehen**

**Code:** [WorkoutLoggerView.tsx:189](/Users/kevingusmao/.codex/visualizations/2026/10/25/01a1744f-9d58-75f1-854d-61b15b7dc7bb/arnold-task-004-qa/reviewed-source/src/ui/views/WorkoutLoggerView.tsx:189), [dieselbe Datei:121](/Users/kevingusmao/.codex/visualizations/2026/10/25/01a1744f-9d58-75f1-854d-61b15b7dc7bb/arnold-task-004-qa/reviewed-source/src/ui/views/WorkoutLoggerView.tsx:121).

**Beobachtung:** Die Workout-Auswahl ruft nur `logger.select(id)` auf. Der lokale `edit`-Zustand wird nicht gelöscht oder an das ausgewählte Workout gebunden. Das Formular sendet danach `update_set` mit `edit.set_id` aus Workout A, obwohl Überschrift und bestätigte Sätze Workout B zeigen.

**Reproduktion:** Zwei offene Workouts A und B mit je einem Satz anlegen; A auswählen und „Satz 1 korrigieren“ öffnen; zu B wechseln; Gewicht auf 99 ändern und „Korrektur speichern“ ausführen. **Tatsächlich wird der Satz in A auf 99 kg, Revision 2 geändert.** Die UI springt anschließend durch den Erfolgs-Read auf A zurück. Im Screenshot ist vor dem Speichern B mit bestätigten 40 kg ausgewählt, während das Korrekturformular noch A mit 30 kg enthält.

**Erwartet:** Eine Mutation betrifft ausschließlich die ausdrücklich ausgewählte Einheit und den dort zur Korrektur gewählten Satz.

**Korrektur:** Edit-Zustand beim Workout-Wechsel zurücksetzen; bei Submit zusätzlich `edit.workout_id === workout.workout_id` prüfen. Den Formularzustand auf Workout-ID beziehen und während eines laufenden Requests Wechsel kontrollieren.

**Nachweis:** Gegenprobe `Q4-05` schlägt am tatsächlichen falschen Workout nach Speicherung fehl, nicht an Netzwerk/Startproblemen. [Browserergebnis](/Users/kevingusmao/.codex/visualizations/2026/10/25/01a1744f-9d58-75f1-854d-61b15b7dc7bb/arnold-task-004-qa/arnold004-qa-browser.json), [gesendete MCP-Aufrufe](/Users/kevingusmao/.codex/visualizations/2026/10/25/01a1744f-9d58-75f1-854d-61b15b7dc7bb/arnold-task-004-qa/workout-switch-evidence.json), [Screenshot vor falscher Speicherung](/Users/kevingusmao/.codex/visualizations/2026/10/25/01a1744f-9d58-75f1-854d-61b15b7dc7bb/arnold-task-004-qa/selected-b-editing-a.png), [Trace](/Users/kevingusmao/.codex/visualizations/2026/10/25/01a1744f-9d58-75f1-854d-61b15b7dc7bb/arnold-task-004-qa/trace.zip).

**F02 – P1: Definitive Ablehnung hinterlässt einen offenen Journaleintrag, dessen Request die UI verwirft**

**Code:** [Service:347](/Users/kevingusmao/.codex/visualizations/2026/10/25/01a1744f-9d58-75f1-854d-61b15b7dc7bb/arnold-task-004-qa/reviewed-source/src/server/workout/service.ts:347), [Pending-Sperre:195](/Users/kevingusmao/.codex/visualizations/2026/10/25/01a1744f-9d58-75f1-854d-61b15b7dc7bb/arnold-task-004-qa/reviewed-source/src/server/workout/service.ts:195), [Logger-Hook:73](/Users/kevingusmao/.codex/visualizations/2026/10/25/01a1744f-9d58-75f1-854d-61b15b7dc7bb/arnold-task-004-qa/reviewed-source/src/ui/hooks/useWorkoutLogger.ts:73).

**Beobachtung:** Nach eindeutigem `PERMISSION_DENIED` und unverändertem Storage setzt der Service den Intent zurück auf `prepared`. Bei einer neuen Request-ID behandelt die globale Pending-Prüfung diesen Intent als ungeklärten Commit. Gleichzeitig löscht die UI bei diesem Fehler den vollständigen Pending-Request aus Zustand und Session Storage; erhalten werden dort nur `COMMIT_STATUS_UNKNOWN` und `STORAGE_UNAVAILABLE`.

**Reproduktion:** Synthetisches Repository lehnt den ersten Start eindeutig mit `PERMISSION_DENIED` ab und würde danach Writes wieder erlauben. Der erste Aufruf schreibt keine Zeile. Ein zweiter Start mit neuer ID erhält trotzdem `COMMIT_STATUS_UNKNOWN: Ein früherer Schreibvorgang muss zuerst geklärt werden`. Derselbe ursprüngliche Request funktioniert dagegen nach Behebung – das bestätigt die Kontrollgegenprobe `Q4-03`. Den ursprünglichen Request hat die normale UI aber bereits verworfen. Wiederholung des neuen Requests löst den alten Eintrag nicht auf.

**Erwartet:** Eine eindeutige Ablehnung darf nach Behebung der Ursache nicht zu einem über die UI nicht auflösbaren Schreibstopp führen. Die Trennung zwischen „definitiv nicht geschrieben“ und „Commit unklar“ muss Ende zu Ende erhalten bleiben.

**Korrektur:** Einen expliziten terminalen Ablehnungs-/Abbruchzustand mit sicheren Wiederholungsregeln oder ein serverseitig eindeutig signalisiertes „Originalrequest weiterverwenden“ einführen. Solange ein Intent weiterhin vorliegt, muss der Client Payload und ID behalten und die passende Wiederaufnahme anbieten. Unklare Dispatches weiterhin strikt sperren; keine automatische Ausführung fremder Pending-Requests unter einem anderen Akteur.

**Nachweis:** `Q4-01` scheitert; `Q4-03` besteht. [Ergebnisse](/Users/kevingusmao/.codex/visualizations/2026/10/25/01a1744f-9d58-75f1-854d-61b15b7dc7bb/arnold-task-004-qa/arnold004-qa-additional.json), [Testcode](/Users/kevingusmao/.codex/visualizations/2026/10/25/01a1744f-9d58-75f1-854d-61b15b7dc7bb/arnold-task-004-qa/repros/tests/qa-task004.test.ts:11). Der Service-Fehler wurde ausgeführt; das Verwerfen des Requests ist zusätzlich direkt im Hook belegt. Kein echter Google-403 wurde ausgelöst.

**F03 – P2: Append überschreitet die eigene unterstützte Tabellengröße**

**Code:** [Writer:377](/Users/kevingusmao/.codex/visualizations/2026/10/25/01a1744f-9d58-75f1-854d-61b15b7dc7bb/arnold-task-004-qa/reviewed-source/src/server/arnold-sheets-write-adapter.ts:377), [Readback:404](/Users/kevingusmao/.codex/visualizations/2026/10/25/01a1744f-9d58-75f1-854d-61b15b7dc7bb/arnold-task-004-qa/reviewed-source/src/server/arnold-sheets-write-adapter.ts:404), [Reader-Grenze:128](/Users/kevingusmao/.codex/visualizations/2026/10/25/01a1744f-9d58-75f1-854d-61b15b7dc7bb/arnold-task-004-qa/reviewed-source/src/server/arnold-sheets-read-adapter.ts:128), [Bounds-Prüfung:205](/Users/kevingusmao/.codex/visualizations/2026/10/25/01a1744f-9d58-75f1-854d-61b15b7dc7bb/arnold-task-004-qa/reviewed-source/src/server/arnold-sheets-read-adapter.ts:205).

**Beobachtung:** Der Writer prüft den aktuellen Zustand, aber nicht die Größe nach seinen geplanten Appends. Sein Reader verwendet unverändert die Standardgrenze von 10.000 Grid-Zeilen. Bei voller Tabelle kann der Writer Zeile 10.001 erzeugen. Danach lehnt derselbe Reader das gesamte Dataset als außerhalb der Grenzen ab.

**Reproduktion:** Synthetische EXERCISES-Tabelle mit Header und 9.999 gültigen Übungen, `rowCount=10000`. Eine weitere gültige Übung anhängen. Der Batch wird tatsächlich aufgerufen und die Zeile ergänzt; der Readback scheitert anschließend an `SCHEMA_MISMATCH`. Erwartete Vorab-Abweisung mit null Write-Batches bleibt aus. Derselbe Mechanismus betrifft SETS/WORKOUTS beim Erreichen der Grenze.

Der Boundary-Mock wurde für diesen Fall so ergänzt, dass ein Append die Grid-Größe erhöht. Das bildet dokumentiertes API-Verhalten ab: Google kann beim Append nötige neue Zeilen einfügen. [Google: AppendCellsRequest](https://developers.google.com/workspace/sheets/api/reference/rest/v4/spreadsheets/request#AppendCellsRequest). Kein Live-Write durchgeführt.

**Erwartet:** Ein unterstützter Ausgangszustand darf durch einen eigenen Write nicht außerhalb des anschließend lesbaren Zustands geraten.

**Korrektur:** Gemeinsame explizite Größenlimits für Reader und Writer; vor Dispatch pro Tabelle die physische nächste Append-Zeile inklusive Leerzeilen und Batchumfang prüfen. Überschreitung vor Mutation strukturiert ablehnen oder eine abgestimmte Erweiterung von Lese-/Schreibkapazität vorsehen.

**Nachweis:** `Q4-04`: ein Batch statt null; [Testergebnis](/Users/kevingusmao/.codex/visualizations/2026/10/25/01a1744f-9d58-75f1-854d-61b15b7dc7bb/arnold-task-004-qa/arnold004-qa-additional.json), [Testcode](/Users/kevingusmao/.codex/visualizations/2026/10/25/01a1744f-9d58-75f1-854d-61b15b7dc7bb/arnold-task-004-qa/repros/tests/qa-task004.test.ts:38). Dieser Fehler betrifft den vorbereiteten Test-Sheet-Adapter; der standardmäßig gesperrte Produktionsmodus wird dadurch nicht umgangen.

**F04 – P2: Unplausible Endzeit wird bei unbekannter Startzeit erfolgreich gespeichert**

**Code:** [Service:733](/Users/kevingusmao/.codex/visualizations/2026/10/25/01a1744f-9d58-75f1-854d-61b15b7dc7bb/arnold-task-004-qa/reviewed-source/src/server/workout/service.ts:733), [Workout-Schema:350](/Users/kevingusmao/.codex/visualizations/2026/10/25/01a1744f-9d58-75f1-854d-61b15b7dc7bb/arnold-task-004-qa/reviewed-source/src/shared/arnold-schema-v1.ts:350).

**Beobachtung:** Ein bekannter Endzeitpunkt wird nur gegen einen ebenfalls bekannten Startzeitpunkt geprüft. Bei `started_at_utc=null` fehlt der Vergleich mit dem lokalen Trainingstag.

**Reproduktion:** Workout für `2026-10-20`, Zeitzone Europe/Berlin, ohne Startzeit anlegen; einen gültigen Satz speichern; mit `ended_at_utc=2000-01-01T12:00:00Z` abschließen. Der Service meldet **`ok=true`**, speichert `completed` und erhöht die Revision auf 2.

**Erwartet:** Ein bekannter Abschluss kann nicht vor Beginn des angegebenen lokalen Trainingstags liegen. Unbekannte Zeitpunkte dürfen null bleiben. Legitime Einheiten über Mitternacht dürfen weiterhin möglich sein.

**Korrektur:** Im Service Endzeit mit Trainingstag und Zeitzone plausibilisieren, zusätzlich zum vorhandenen Start-/Endzeitvergleich. Grenztests für Zeitzonen und Abschluss am Folgetag ergänzen.

**Nachweis:** `Q4-02` schlägt mit dem gespeicherten widersprüchlichen Datensatz fehl. [Ergebnis](/Users/kevingusmao/.codex/visualizations/2026/10/25/01a1744f-9d58-75f1-854d-61b15b7dc7bb/arnold-task-004-qa/arnold004-qa-additional.json), [Testcode](/Users/kevingusmao/.codex/visualizations/2026/10/25/01a1744f-9d58-75f1-854d-61b15b7dc7bb/arnold-task-004-qa/repros/tests/qa-task004.test.ts:25).

**F05 – P1: Nicht vollständig integrierte Task-003-QA verletzt Voraussetzung und Anzeigeintegrität**

**Code:** [Completion Report:315](/Users/kevingusmao/.codex/visualizations/2026/10/25/01a1744f-9d58-75f1-854d-61b15b7dc7bb/arnold-task-004-qa/reviewed-source/docs/ARNOLD-TASK-004-COMPLETION-REPORT.md:315), [Arbeitssatz-KPI:479](/Users/kevingusmao/.codex/visualizations/2026/10/25/01a1744f-9d58-75f1-854d-61b15b7dc7bb/arnold-task-004-qa/reviewed-source/src/server/arnold-presenter.ts:479), [Host-Revalidierung:101](/Users/kevingusmao/.codex/visualizations/2026/10/25/01a1744f-9d58-75f1-854d-61b15b7dc7bb/arnold-task-004-qa/reviewed-source/src/ui/client.ts:101), [MetricCard:78](/Users/kevingusmao/.codex/visualizations/2026/10/25/01a1744f-9d58-75f1-854d-61b15b7dc7bb/arnold-task-004-qa/reviewed-source/src/ui/components/index.tsx:78), [ungefilterte letzte Workouts:585](/Users/kevingusmao/.codex/visualizations/2026/10/25/01a1744f-9d58-75f1-854d-61b15b7dc7bb/arnold-task-004-qa/reviewed-source/src/server/arnold-presenter.ts:585).

Der Originalauftrag verlangt ausdrücklich den erfolgreichen integrierten Stand von Tasks 001–003 vor Task 004. Der Bericht dokumentiert selbst den fehlenden QA-Branch. Der Git-Verlauf bestätigt dies. Entscheidend sind die **am Zielcommit erneut ausgeführten** Gegenproben:

- Ein gültiger Körpergewichts-Arbeitssatz erscheint im KPI als **0 statt 1**; bei einem berechenbaren und einem Körpergewichtssatz **1 statt 2**. Die Zählung benutzt Volumen-Coverage statt der Anzahl gültiger Arbeitssätze.
- Maximalgewicht und gültiges 1RM bei Kurzhanteln zeigen weiterhin keinen sichtbaren Hinweis **„pro Hantel“**.
- Ein Dashboard-Filter auf Januar 2030 ergibt null Einheiten im Zeitraum, liefert aber weiterhin fünf frühere „letzte Workouts“; die Übersicht bietet weiterhin keine Zeitraumselektion.
- Eine langsame erste Host-Revalidierung überschreibt ein neueres Ergebnis von **10:00** durch das ältere von **09:00**, während es als frisch markiert bleibt.

**Erwartet:** Die neue Schreibschicht muss auf korrekt integrierten Read-/Dashboard-Pfaden aufbauen. Gespeicherte Daten dürfen weder falsch gezählt noch durch eine spätere alte Antwort als aktuell ersetzt werden.

**Korrektur:** Task-003-QA-Korrekturen in die gemeinsame Basis integrieren beziehungsweise gleichwertig umsetzen, Konflikte mit den Task-004-Änderungen auflösen und die früheren QA-Gegenproben erneut ausführen. Dabei die bereits behobenen Source-Factory-/Cache-/Refresh-Fixes von Task 004 erhalten. Nicht nur den Branch-Namen oder die Dokumentation anpassen.

**Nachweis:** Zehn erneut ausgeführte unabhängige Task-003-Prüfungen: **3 PASS, 7 FAIL**. [Integrationsergebnis](/Users/kevingusmao/.codex/visualizations/2026/10/25/01a1744f-9d58-75f1-854d-61b15b7dc7bb/arnold-task-004-qa/arnold004-qa-inherited.json), [Integrationsgegenproben](/Users/kevingusmao/.codex/visualizations/2026/10/25/01a1744f-9d58-75f1-854d-61b15b7dc7bb/arnold-task-004-qa/repros/tests/qa-task003-inherited.test.tsx), [Host-Race-Gegenprobe](/Users/kevingusmao/.codex/visualizations/2026/10/25/01a1744f-9d58-75f1-854d-61b15b7dc7bb/arnold-task-004-qa/repros/tests/qa-task003-inherited-bridge.test.ts). Dies sind überwiegend **geerbte Fehler**, keine Behauptung von sieben neuen Task-004-Regressionen. Frühere zusätzliche Mobile-/Detailauswahl-Befunde wurden hier nicht erneut geprüft.

**5. Testergebnisse**

Umgebung: macOS, Node `v26.7.0`, npm `11.19.0`; frische Installation mit `npm ci --ignore-scripts --audit=false --fund=false` im isolierten Export. Alle Daten synthetisch.

| Prüfung | Unabhängig ausgeführt | Tatsächliches Ergebnis |
| --- | --- | --- |
| `npm run typecheck` | Ja | **PASS**, Exit 0; zusätzlich Bestandteil des erfolgreichen Builds. |
| `npm test` | Ja | **PASS – 468/468 Tests, 29/29 Dateien, keine übersprungenen Tests** im erfolgreichen vollständigen Lauf. |
| `npm run build` | Ja | **PASS**, Exit 0; UI, Host, TypeScript-Server. |
| `npm run test:e2e` | Ja | **PASS – 22/22 Tests**; Demo, Lesemodus und drei neue Logger-Browsertests. |
| `npm run format:check` | Ja | **PASS**, Exit 0, vor Hinzufügen der temporären QA-Tests. |
| `git diff --check 8723df4 815c91d` | Ja | **PASS**, Exit 0. |
| Neue Task-004-Service-/Adapter-Gegenproben | Ja | **1 PASS, 3 FAIL** aus vier Tests; F02/F03/F04 reproduziert. |
| Neuer Task-004-Browser-Gegentest | Ja | **0 PASS, 1 FAIL**; F01 mit wirklicher falscher Mutation reproduziert. |
| Erneute unabhängige Task-003-Gegenproben | Ja | **3 PASS, 7 FAIL** aus zehn Tests; F05. |
| Echter Google-Write mit realem Nutzer | Nein | **NOT VERIFIED**, optionaler externer Nachweis fehlt. |
| Produktions-/Mehrinstanzen-Exactly-once | Nein | Keine implementierte Garantie; Produktion bleibt ausdrücklich gesperrt. |

Somit bestehen **490 vorhandene Tests**. Die **15 zusätzlichen unabhängigen Prüfungen** ergeben **4 PASS und 11 FAIL**. Mehrere Fehltests belegen dieselbe zugrunde liegende Integrationslücke; es sind fünf Findings, nicht elf unterschiedliche Fehler.

Der erste Unit-/Browserlauf innerhalb der Sandbox scheiterte an `listen EPERM 127.0.0.1`. Nach erlaubter Ausführung lokaler Testserver liefen beide vollständigen Suiten erfolgreich. Das ist ein Umgebungsproblem, kein Produktfehler. Der erste neue Browser-Gegentest hatte einen zu strengen `getByLabel`-Selektor; nach Korrektur auf die tatsächliche Combobox-Rolle erreichte er die falsche Mutation und scheiterte an der fachlichen Assertion. Nur dieser abschließende Gegenbeweis wird als Finding gewertet.

Gesicherte Protokolle: [Typecheck](/Users/kevingusmao/.codex/visualizations/2026/10/25/01a1744f-9d58-75f1-854d-61b15b7dc7bb/arnold-task-004-qa/arnold004-qa-typecheck.log), [Unit/MCP](/Users/kevingusmao/.codex/visualizations/2026/10/25/01a1744f-9d58-75f1-854d-61b15b7dc7bb/arnold-task-004-qa/arnold004-qa-tests.log), [Build](/Users/kevingusmao/.codex/visualizations/2026/10/25/01a1744f-9d58-75f1-854d-61b15b7dc7bb/arnold-task-004-qa/arnold004-qa-build.log), [Browser-Suite](/Users/kevingusmao/.codex/visualizations/2026/10/25/01a1744f-9d58-75f1-854d-61b15b7dc7bb/arnold-task-004-qa/arnold004-qa-e2e.log), [Format](/Users/kevingusmao/.codex/visualizations/2026/10/25/01a1744f-9d58-75f1-854d-61b15b7dc7bb/arnold-task-004-qa/arnold004-qa-format.log). Die QA-Tests liegen separat unter [repros](/Users/kevingusmao/.codex/visualizations/2026/10/25/01a1744f-9d58-75f1-854d-61b15b7dc7bb/arnold-task-004-qa/repros/tests/qa-task004.test.ts); sie wurden ausschließlich im isolierten Export ergänzt und nicht in den Entwicklungsbranch übernommen.

**6. Architektur & Integration**

Die Trennung ist im Grundsatz sinnvoll: MCP validiert Verträge und delegiert; der Service besitzt Fachregeln, Autorisierung, Status und Journal; der Writer kapselt die Google-Anfragen; UI-Komponenten besitzen keine Google-Zugriffe. Die sieben Domain-Operationen geben eng begrenzte Rohdatensätze zurück. `get_workout` lädt gezielt die für den Logger erforderlichen IDs und Revisionen.

Die bestehende Engine und das Rohdatenschema wurden im Delta nicht verändert. Stabile Referenzen, Snapshot-Namen und Erstellungsdaten sind gegen Umwidmung geschützt. Task-004-Korrekturen an Source-Options, Cache-Generationen und unterdrückter erneuter Dashboard-Publikation beheben wichtige frühere Integrationsprobleme. Die beiden Source-Factory-Prüfungen und die Cache-Gegenprobe bestehen jetzt.

Die Schnittstellen sind auf einen späteren dauerhaften Backend-Speicher vorbereitet. Der lokale Koordinator und das Datei-Journal sind jedoch ausdrücklich kein verteiltes Transaktionssystem. Diese Abgrenzung ist korrekt dokumentiert und für den vereinbarten synthetischen Betrieb zulässig.

Die verbleibenden Probleme liegen insbesondere an Übergängen: Auswahlkontext → Korrektur-ID (F01), Fehlerklasse → Journalzustand → UI-Retry (F02), vorhandene → zukünftige Grid-Größe (F03), lokale Datumsangabe → UTC-Endzeit (F04) sowie Schreibbestätigung → korrekte Dashboard-Anzeige (F05).

**7. Sicherheit & Datenintegrität**

- **Schreibschutz:** Feste Master-Datei-ID bereits im Writer-Konstruktor blockiert; zusätzlich `MASTER_TEMPLATE` aus CONFIG unabhängig von ID gesperrt. Fremde/unzugewiesene Tracker, fehlerhafte Header und Merges werden abgelehnt. Keine generischen Range-/Datei-ID-MCP-Parameter.
- **Zugriffsrechte:** `disabled` ist Standard. Produktionsmodus wird doppelt blockiert. Ein Test-Sheet benötigt programmatische Einbindung und geprüften Akteur; private Netzwerkbindung allein gilt nicht als Identität. Authentifizierung wird nicht aus Tool-Argumenten übernommen. Kein erfolgreicher Schutzumgehungsfall in den ausgeführten Tests.
- **Idempotenz:** Request/Payload/Akteur gebunden; Wiederholungen mit erhaltenem Journal und IDs sicher im geprüften Ein-Prozess-Modell. Antwortverlust, gespeicherter Write mit fehlender Ledger-Bestätigung sowie Auditfehler getestet. F02 betrifft die Wiederaufnahme eindeutiger Ablehnungen, nicht ein nachgewiesenes Doppel-Append nach Timeout.
- **Nebenläufigkeit:** Queue je Tracker, aktuelle Revision vor Änderung und gemeinsame Batch-Anwendung. Für mehrere Services müssen Coordinator und Ledger gemeinsam sein. Kein atomarer CAS gegen manuelle Google-Änderungen; dokumentierter offener Produktionspunkt.
- **Historische Daten:** Korrekturen behalten IDs und Referenzen; Stornierungen löschen keine Zeile. Abgeschlossene Workouts benötigen Sonderberechtigung und Begründung. F01 kann innerhalb desselben Trackers dennoch einen fachlich ungewollten anderen Datensatz verändern.
- **Formelinjektion:** Literaltext über `stringValue`; vorhandene Transporttests bestätigen dies. Keine Verwendung von `formulaValue` für Nutzereingaben im Writer.
- **Geheimnisse:** Kein Zugangsdaten- oder Tokenmaterial im überprüften Änderungssatz identifiziert. Keine Env-/Schlüsseldateien aus dem Nutzerrechner ausgelesen oder ausgegeben. Dies ersetzt keinen separaten Scan der vollständigen Git-Historie.
- **Audit:** Austauschbare Schnittstelle und deduplizierte lokale Events mit Revisionen und relevanten Änderungen. Dauerhafter produktiver Audit-Speicher fehlt wie vorgesehen. Das Intent-Journal enthält für Recovery vollständige Vorher-/Nachher-Datensätze und muss auch künftig geschützt gespeichert werden.

**8. Offene Risiken**

**Bestätigte Abnahmehindernisse:** F01–F05. Die UI kann eine andere Einheit als ausgewählt korrigieren; Fehler-Recovery und Größen-/Zeitvalidierung sind lückenhaft; die vorausgesetzte Task-003-Integration ist nicht vollständig.

**Dokumentierte, für Task 004 akzeptable Grenzen:** Keine produktiven Schreibzugriffe, echte Nutzerverwaltung/OAuth erst später; keine verteilte Koordination/Transaktion; Fixture-Daten/Audit flüchtig; manuelle Änderungen zwischen Read und Write nicht atomar ausgeschlossen; keine Recovery bei totalem Journalverlust ohne Backup. Diese Grenzen sollen sichtbar bleiben, nicht durch eine Freigabe umgedeutet werden.

**Nicht verifiziert:** Tatsächliches Google-Verhalten mit freigegebener Testdatei und realem Nutzer; reale ChatGPT-Verbindung außerhalb des lokalen AppBridge-Testhosts; mehrere Serverinstanzen; externer Drift über Prozessneustarts; Stromausfall-/Dateisystem-Durabilität über den getesteten normalen Prozessabbruch hinaus; externe Drive-Agent-Anleitung im aktuellen Stand. Der ursprüngliche Auftrag erlaubt das Ausbleiben des echten optionalen Schreibtests.

**Testlücken:** Die vorhandenen 490 Tests decken die neuen Gegenfälle nicht ab. Der Writer-Fake erhöht die Grid-Größe ursprünglich nicht bei Append, sodass F03 in der vorhandenen Suite verborgen bleibt. Der Browser-Grundworkflow wechselt nicht während einer offenen Satzkorrektur zwischen zwei Workouts.

**9. Korrekturauftrag an den Entwickler**

1. **P1 / F01:** Korrekturzustand an Workout-ID binden und bei Auswahlwechsel bereinigen. Vor Submit falsche Zielbindung verhindern. Browserregression mit zwei offenen Workouts und nachgewiesener unveränderter alter Einheit ergänzen.
2. **P1 / F02:** End-to-End-Vertrag für definitive Ablehnung, Pending-Intent und UI-Retry korrigieren. Auth-/Permission-Recovery mit derselben ID sowie neuen unabhängigen Vorgängen testen. Echte Unsicherheit weiterhin quarantänisieren; keine blinden Write-Retries einführen.
3. **P1 / F05:** Task-003-QA-Korrekturen integrieren; Arbeitssätze korrekt zählen, Lastbezug sichtbar machen, Zeitraum konsistent anwenden und alte Host-Antworten verwerfen. Erhaltene Source-/Cache-/Refresh-Fixes aus Task 004 nicht zurücknehmen.
4. **P2 / F03:** Zukünftige Tabellengröße vor Dispatch gegen gemeinsame Limits prüfen; Grenze und exakt einen überschreitenden Datensatz testen. Mock muss Googles Grid-Erweiterung beim Append abbilden.
5. **P2 / F04:** Endzeit gegen lokalen Trainingstag plausibilisieren, auch ohne Startzeit. Nullwerte und legitime Mitternachtswechsel erhalten.
6. Completion Report und Write Contract anschließend an das tatsächliche Endverhalten anpassen. Korrekturcommit und eindeutige gemeinsame Basis nennen. Vorhandene Tests und die hier belegten Gegenproben erneut ausführen.

Diese Prüfung enthält **keine eigenmächtige Reparatur**. Neue QA-Tests sind Belege und ein Korrekturauftrag, kein freigegebener Patch.

**10. Finales QA-Gate**

**FAIL**

Keine Abnahme des Zielcommits als vollständig erledigte Task 004. Die Datenzugriffssicherheit ist in wichtigen Bereichen bereits umgesetzt und der produktive Schreibmodus ist wirksam gesperrt; die falsche Zielbindung im Logger, defekte Fehler-Recovery und nicht integrierte Vorgänger-QA verletzen jedoch zentrale Anforderungen.

Erneute Prüfung nach Integration und Korrektur von F01–F05, mit benanntem neuem Zielcommit. Erforderlich sind weiterhin grüne vorhandene Suiten **und** erfolgreiche fachliche Gegenproben einschließlich Workout-Wechsel, Ablehnungs-Recovery, Grid-Grenze, Endzeit und Task-003-Anzeigeintegrität. Eine spätere positive Task-004-QA wäre keine Produktionsfreigabe; die externe Projektleitung entscheidet über den nächsten Entwicklungsschritt.

