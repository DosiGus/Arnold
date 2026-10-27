# ARNOLD – STABILIZATION & INTEGRATION TASK S001
## Gemeinsamen Stand aus Tasks 001–005 herstellen, QA-Fehler beheben und belastbar abnehmen

**Adressat:** Lead Developer / verantwortlicher Integrationsentwickler  
**Stand:** 27.10.2026, Europe/Berlin  
**Repository:** [DosiGus/Arnold](https://github.com/DosiGus/Arnold)  
**Einordnung:** Konsolidierung und Fehlerbehebung vor weiteren Funktionspaketen. Kein Ersatz für Task 006 oder Task 007.

---

## 1. Deine Rolle und dein Auftrag

Du übernimmst die technische Verantwortung für einen gemeinsamen, nachvollziehbaren Arnold-Stand aus den bisherigen Tasks 001–005.

Dein Auftrag ist:

1. Alle vorhandenen Arbeiten erhalten und ihre Herkunft klären.
2. Die getrennten Entwicklungs- und QA-Korrekturstände kontrolliert zusammenführen.
3. Die bestätigten Fehler aus der unabhängigen QA beheben.
4. Task 005 am tatsächlich integrierten Stand fachlich und technisch prüfen.
5. Gemeinsame Schreibgarantien für Trainingslogger und Planverwaltung sicherstellen.
6. Die Abdeckungslücken durch konkrete Regressionstests schließen.
7. Einen reproduzierbaren Commitstand mit ehrlicher Dokumentation zur unabhängigen Abnahme übergeben.

**„Completed“ im Entwicklerbericht bedeutet nicht automatisch „unabhängig geprüft und freigegeben“.** Belege jeden geschlossenen Befund durch Verhalten und Tests am abschließenden Stand.

Dieses Briefing beruht auf der unabhängigen Task-003-/004-QA und einer ergänzenden Sichtung des aktuellen Arbeitsordners. Es ist **keine bereits durchgeführte vollständige QA von Task 005** und keine Behauptung, dass alle denkbaren Fehler des gesamten Repositories bekannt sind.

---

## 2. Verbindlich zu lesende Unterlagen

Lies vor Änderungen:

- Originalaufträge der Tasks 001–005 aus der Projektablage.
- `docs/ARNOLD-DATA-CONTRACT.md`.
- `docs/ARNOLD-METRICS-SPEC.md`.
- `docs/ARNOLD-UI-CONTRACT.md`.
- `docs/ARNOLD-WRITE-CONTRACT.md`.
- `docs/ARNOLD-PLAN-CONTRACT.md`.
- Task-004- und Task-005-Completion-Reports, jeweils mit Herkunft und Commitstand.
- [Unabhängiger Task-003-QA-Bericht](/Users/kevingusmao/.codex/visualizations/2026/10/25/01a1744f-9d58-75f1-854d-61b15b7dc7bb/arnold-task-003-qa/ARNOLD-INDEPENDENT-QA-REPORT-TASK-003.md).
- [Unabhängiger Task-004-QA-Bericht](/Users/kevingusmao/.codex/visualizations/2026/10/25/01a1744f-9d58-75f1-854d-61b15b7dc7bb/arnold-task-004-qa/ARNOLD-INDEPENDENT-QA-REPORT-TASK-004.md).

Der Task-005-Originalauftrag liegt diesem Briefing nicht bei. Sein Completion Report ersetzt ihn nicht. Ziehe den Originalauftrag für die endgültige Scope- und Abnahmeprüfung heran.

**Belegpaket:** Im begleitenden ZIP liegen die QA-Berichte, ursprünglichen Gegenproben und wesentlichen Ergebnisdateien unter `evidence/task003/` und `evidence/task004/`. Die eingebetteten absoluten Links stammen vom Prüfcomputer; die Dateien selbst werden für die Übergabe mitgeliefert.

---

## 3. Tatsächlich vorgefundener Ausgangsstand

| Bestandteil | Vorgefundener Stand | Konsequenz |
| --- | --- | --- |
| Gemeinsamer Arbeitsordner | `/Users/kevingusmao/Desktop/Arnold` | Enthält vermischte, uncommittete Arbeiten. Nicht zurücksetzen. |
| Aktiver lokaler Branch | `feat/arnold-plan-management`, HEAD `8723df4157c4572a65c95624054b2f9c061990eb` | Branch-HEAD enthält Task 005 noch nicht als Commit. |
| Task 004 veröffentlicht | `feat/arnold-workout-logging`, `815c91db0c55dcfeb978166b2693f61bdb57c7fe` | Verifizierter Referenzstand; unabhängige QA ergab FAIL. |
| Task-003-Korrekturbranch | `fix/task-003-qa`, `f85fb54` | Nicht vollständig im veröffentlichten Task-004-Stand integriert. |
| Task-002-Korrekturen | `7077ffd` und `8723df4` | Bereits in der aktuellen Basis; bei Integration erhalten. |
| Task-001-Korrekturen | Änderungen in der Basis-Historie sowie separater QA-Branch vorhanden | Inhaltlich abgleichen; nicht blind jeden Fix-Branch zusätzlich übernehmen. |
| Task 005 | Completion Report meldet Completed, Code liegt lokal uncommittet | Keine unabhängige Abnahme und kein eindeutig reproduzierbarer Task-005-Commit. |
| Task-004-Bericht im Arbeitsordner | Älterer Status „Blocked“ | Weicht vom neueren veröffentlichten Bericht ab. Dokumentherkunft bereinigen. |
| Task-004-Testübernahme nach Task 005 | `tests/http-assets.test.ts` und `tests/workout-restart.test.ts` fehlen im aktuellen Task-005-Arbeitsordner | Beide existieren am veröffentlichten Task-004-Commit. Wieder integrieren und ausführen. |
| Commit-Protokoll | Inline im Workout-Service sowie separat in `plan/commit.ts` | Sicherheitskorrekturen müssen beide Pfade erfassen. |

Die ergänzende Bestandsaufnahme ist in [REPOSITORY-STATE-2026-10-27.json](/Users/kevingusmao/.codex/visualizations/2026/10/25/01a1744f-9d58-75f1-854d-61b15b7dc7bb/arnold-stabilization-s001/REPOSITORY-STATE-2026-10-27.json) dokumentiert. Es handelt sich um eine Momentaufnahme, nicht um einen atomaren Snapshot des gesamten Arbeitsbaums. Andere Entwickler können zwischenzeitlich weiterarbeiten. Vor Umsetzung erneut erfassen.

---

## 4. Zielzustand und Umfang

Nach diesem Paket gibt es **einen eindeutig benannten Integrationsbranch und Zielcommit**, auf dem Datenbasis, Analytics, Dashboard, Workout-Logging und Planverwaltung gemeinsam funktionieren.

Zum Umfang gehören:

- Integration vorhandener Arbeiten und notwendige Konfliktauflösung.
- Korrektur bestätigter P1-/P2-Befunde.
- Wiederherstellung fehlender Tests.
- Prüfung kritischer Task-005-Übergänge und gemeinsamer Infrastruktur.
- Aktualisierung betroffener Verträge und Abschlussberichte.
- Vorbereitung der unabhängigen erneuten QA.

Nicht zum Umfang gehören:

- Onboarding aus Task 006.
- Google OAuth, Nutzerverwaltung oder Produktionsfreigabe aus Task 007.
- Neuer externer Datenbankdienst.
- Ausbau von Google-Schreibrechten für Plantabellen.
- Neue Sheets-Tabellen oder ungeplante Schema-Migration.
- Deployment, Tunneländerungen oder Merge nach `main`.
- Vollständiger UI-Neuentwurf oder allgemeines großflächiges Refactoring.

---

## 5. Arbeitsauftrag A – Arbeitsstände sichern und gemeinsame Basis bilden

**Priorität: zuerst, vor funktionalen Änderungen.**

### A1. Bestand und Eigentümerschaft sichern

- Git-Status, Branches, Worktrees und Ziel-SHAs erneut erfassen.
- Lokale uncommittete Task-005-Arbeit einschließlich ungetrackter Quell- und Testdateien gesichert erfassen.
- Bei laufender Parallelbearbeitung einen abgestimmten Übergabepunkt festlegen. Keine konkurrierenden Änderungen an gemeinsamen Dateien.
- Keine fremde Arbeit durch Reset, Clean, unkoordiniertes Stash oder pauschales Dateikopieren verschieben oder löschen.
- Keine Secrets, echten Nutzerdaten, privaten Env-Dateien, `node_modules` oder Build-Ausgaben in Sicherungscommits aufnehmen.

### A2. Integrationsbranch erstellen

Empfohlener Name: `codex/arnold-stabilization-s001`.

Bestimme die Basis durch den tatsächlichen Commitgraphen und Inhaltsvergleich. **Nicht pauschal auf `f85fb54` zurücksetzen:** Dieser Korrekturstand enthält nicht automatisch die späteren Analytics-Korrekturen und Workout-Funktionen.

Übernimm gezielt:

1. Task-001-/002-Korrekturen, soweit inhaltlich erforderlich.
2. Task-003-QA-Korrekturen, angepasst an die neuere Analytics-/Presenter-Version.
3. Veröffentlichten Task-004-Stand einschließlich Tests und Dokumentation.
4. Gesicherte Task-005-Erweiterungen.
5. Notwendige Integrationskorrekturen.

Wähle Merge, Cherry-pick oder inhaltliche Übernahme passend zum Graphen. Entscheidend ist der geprüfte Inhalt, nicht die Zahl der zusammengeführten Branches.

### A3. Besonders konfliktträchtige Dateien

Prüfe Änderungen beider Seiten insbesondere in:

- `src/server/workout/infrastructure.ts`, `workout/service.ts`, `plan/commit.ts`.
- `src/server/arnold-source.ts`, `arnold-presenter.ts`, `http.ts`, `mcp-arnold.ts`.
- `src/server/arnold-sheets-write-adapter.ts`.
- `src/ui/client.ts`, `client/ArnoldMcpClient.ts`, `ArnoldDashboardApp.tsx`.
- UI-Verträgen, Styles, Playwright-Konfiguration und Fixture-Servern.

**Erhalten:** Generation-Guard im Source-Cache, korrigierte Source-Options, Schutz vor Dashboard-Refresh-Schleifen, aktuelle Metrics-Version und alle neuen Analytics-Reason-Texte.

### A4. Fehlende Tests wieder übernehmen

Die im Task-005-Arbeitsordner fehlenden Dateien

- `tests/http-assets.test.ts`
- `tests/workout-restart.test.ts`

aus Task 004 wieder in den gemeinsamen Stand aufnehmen und bei geänderten Schnittstellen sachgerecht anpassen. Nicht lediglich die erwartete Testanzahl reduzieren.

**Abnahme A:** Reproduzierbarer Integrationscommit; Task 005 als Code gesichert; nachvollziehbare Herkunftsmatrix; alle vorgesehenen Testdateien vorhanden; keine fremde Arbeit verloren.

---

## 6. Arbeitsauftrag B – Korrekturen fest an das ausgewählte Workout binden

**Priorität P1 · QA Task 004 F01.**

**Bestätigtes Verhalten am Commit 815c91d:** Eine in Workout A geöffnete Satzkorrektur bleibt nach Wechsel zu Workout B aktiv. Beim Speichern wird weiterhin A verändert.

Betroffene Stellen:

- `src/ui/views/WorkoutLoggerView.tsx`: Workout-Auswahl und `save()`.
- `src/ui/hooks/useWorkoutLogger.ts`: Auswahl- und Request-Lebenszyklus.

### Umsetzung

1. Korrekturzustand an die ausgewählte Workout-ID binden.
2. Beim Wechsel Edit-Ziel und dazugehörige Formularzustände kontrolliert zurücksetzen.
3. Vor Submit sicherstellen, dass `edit.workout_id === selectedWorkout.workout_id`.
4. Veraltete Auswahlantworten dürfen keinen neueren Auswahlzustand zurücksetzen.
5. Während eines laufenden Writes keinen unkontrollierten Zielwechsel zulassen.
6. Erfolgsanzeigen müssen die tatsächlich betroffene Einheit abbilden.

### Verbindliche Regression

- Offene Workouts A und B mit je einem unterschiedlichen Satz anlegen.
- A zur Korrektur öffnen.
- Zu B wechseln.
- Speichern versuchen beziehungsweise in B neu zur Korrektur öffnen.
- A bleibt einschließlich Revision unverändert.
- Eine zulässige Korrektur an B ändert ausschließlich B.
- Bei verspäteten Reads und schnellem Auswahlwechsel bleibt dieselbe Garantie erhalten.

Vorhandener unabhängiger Gegenbeweis: `Q4-05` im Belegpaket.

---

## 7. Arbeitsauftrag C – Fehler, Journal und UI-Retry gemeinsam korrigieren

**Priorität P1 · QA Task 004 F02.**

**Bestätigtes Verhalten:** Ein eindeutig abgelehnter Write hinterlässt einen `prepared`-Intent. Die UI löscht bei u.a. `PERMISSION_DENIED` den Originalrequest. Neue IDs werden danach durch die globale Pending-Prüfung blockiert.

Die lokale Planimplementierung enthält dasselbe vorbereitete Commit-Muster und eine vergleichbare Fehlerklassifikation. Das ist ein **zusätzlicher Prüfauftrag für Task 005**, noch kein vollständig ausgeführter End-to-End-Fehlernachweis dort.

### C1. Zustände und Antworten eindeutig definieren

Unterscheide mindestens:

| Situation | Erforderliches Verhalten |
| --- | --- |
| Fachlicher Fehler vor Intent/Dispatch | Keine Mutation; klare Fehlermeldung; keine unbegründete globale Sperre. |
| Definitiv abgelehnter Dispatch | Sicherer, dokumentierter Retry-/Abbruchweg; kein verlorener Originalrequest. |
| Unklarer Dispatch/Timeout | IDs und Payload behalten; erst verifizieren; keine neue Mutation als Ersatz. |
| Storage bestätigt, Audit/Ledger offen | Kein verfrühter Erfolg; ursprünglichen Vorgang fertigstellen. |
| Vollständig bestätigt | Idempotenter Replay ohne erneute Mutation. |

Entscheide dich für ein konsistentes Modell: expliziter terminaler Ablehnungszustand oder serverseitig belegtes Fortsetzen desselben Intents. Ein konkreter Write-Fehlercode allein sagt nicht zuverlässig, ob ein Journal bereits vorbereitet wurde.

### C2. Gemeinsam umzusetzen

- Workout-Service, Plan-Commit und beide UI-Hooks angleichen.
- Original-Payload und Request-ID erhalten, solange sie für Recovery benötigt werden.
- Explizit signalisieren, ob derselbe Auftrag wiederzuverwenden ist.
- Wiederholungen nach erneut erteilter Berechtigung ermöglichen.
- Ein neuer unabhängiger Auftrag darf nach sicher abgeschlossenem Ablehnungsfall nicht dauerhaft blockiert bleiben.
- Keine automatische Ausführung eines anderen Pending-Requests unter einem anderen Akteur.
- Keine Wiederholung unbekannter Append-Commits mit neuer ID.

### C3. Task-005-Schaltfläche „Verwerfen“ prüfen

`usePlanEditor.dismissPending()` löscht aktuell den Request ausschließlich lokal; der Planeditor bietet dies bei Pending-Vorgängen als „Verwerfen“ an.

Prüfe und korrigiere den Vertrag:

- Ein lokales Verwerfen ist keine serverseitige Stornierung.
- Bei unbekanntem Dispatch darf die einzige verfügbare Recovery-Information nicht ersatzlos verschwinden.
- UI und Journal müssen nach Verwerfen, Reload und Ansichtswechsel konsistent bleiben.
- Ein sicherer Verwerfungsweg benötigt einen eindeutig bekannten Zustand oder einen ausdrücklich vorgesehenen Recovery-Prozess.

Dieser Punkt ist durch Code-Sichtung begründet; das konkrete Laufzeitverhalten ist im Rahmen dieses Pakets nachzuweisen.

### Verbindliche Tests

- Definitiver 401-/403-/Validierungs-Reject an den jeweils richtigen Phasen.
- Behebung der Ursache und Wiederaufnahme über die UI.
- Gleiche ID, geänderter Payload, anderer Akteur.
- Ablehnung vor Intent versus nach Intent.
- Timeout vor sichtbarem Commit, Commit mit verlorener Antwort.
- Audit-/Ledger-Bestätigung fehlt.
- Pending über Reload, View-Wechsel und lokalem „Verwerfen“.
- Ausstehender Plan-Write blockiert Workout-Write korrekt und umgekehrt.
- Wiederhergestellter Zustand lässt sichere Folgevorgänge wieder zu.

Unabhängige Ausgangsgegenproben: `Q4-01` und Kontrollfall `Q4-03`.

---

## 8. Arbeitsauftrag D – Sheets-Größenlimit vor dem Write absichern

**Priorität P2 · QA Task 004 F03.**

Der Reader unterstützt standardmäßig höchstens 10.000 Grid-Zeilen. Der Writer kann durch Append weitere Zeilen erzeugen und damit den eigenen anschließenden Read unmöglich machen.

### Umsetzung

- Lese- und Schreibgrenzen zentral und konsistent definieren.
- Vor Dispatch die resultierende physische Tabellengröße ermitteln.
- Header, Leerzeilen, vorhandene Grid-Größe und alle Appends des Batches berücksichtigen.
- WORKOUTS, SETS und EXERCISES prüfen.
- Überschreitung vor Mutation strukturiert ablehnen oder eine ausdrücklich abgestimmte Kapazität verwenden.
- Keine stillen abgeschnittenen Reads und kein Löschen alter Historie als Ausweg.
- Keine pauschale Erhöhung sämtlicher Limits ohne begründete Ressourcenprüfung.

Der synthetische Sheets-Transport muss die mögliche Grid-Erweiterung beim Append nachbilden. Andernfalls bleibt der Fehler trotz grüner Tests verborgen. [API-Verhalten: AppendCellsRequest](https://developers.google.com/workspace/sheets/api/reference/rest/v4/spreadsheets/request#AppendCellsRequest).

### Verbindliche Tests

Genau innerhalb der Grenze; exakt auf der Grenze; eine Zeile darüber; Mehrsatz-Batch mit Grenzübertritt; interne Leerzeilen; keine teilweise Mutation. Bei Vorab-Ablehnung: **null Write-Batches** und anschließend weiterhin lesbares Dataset.

Ausgangsgegenprobe: `Q4-04`.

---

## 9. Arbeitsauftrag E – Abschlusszeiten plausibilisieren

**Priorität P2 · QA Task 004 F04.**

Ein Workout für den 20.10.2026 ohne bekannte Startzeit lässt sich aktuell erfolgreich mit Endzeit 01.01.2000 abschließen.

### Umsetzung

- Bekannte Endzeit gegen den lokalen Trainingstag und die gespeicherte Zeitzone prüfen.
- Vorhandene Start-/Endzeitprüfung erhalten.
- Unbekannte Zeitpunkte weiterhin als `null` erlauben.
- Historische Trainings nicht pauschal verbieten.
- Legitime Einheiten über Mitternacht erlauben.
- Keine erfundenen Uhrzeiten oder automatische Korrektur der Nutzereingabe speichern.

### Tests

Ende vor lokalem Trainingstag; Ende vor bekanntem Start; zulässiges Ende am Folgetag; unterschiedliche UTC-Offsets; Sommerzeitgrenzen; historisches Workout; fehlende Start-/Endzeit. Ungültige Eingaben müssen vor Mutation scheitern.

Ausgangsgegenprobe: `Q4-02`.

---

## 10. Arbeitsauftrag F – Task-003-QA vollständig integrieren

**Priorität P1/P2 · QA Task 004 F05 und Task 003 T3-01 bis T3-09.**

| Befund | Verbindliches Ziel | Einordnung |
| --- | --- | --- |
| T3-01 Source-Factory | Dokumentierte Source-Konfiguration startet; Cache-/UI-Options gelangen nicht in striktes Adapter-Schema. | Am Task-004-Commit behoben; bei Integration erhalten. |
| T3-02 Refresh-Schleife | Eine Aktion führt zu begrenzten Reads und anschließend ruhendem Zustand. | Im Task-004-Code adressiert; Schutz erhalten und Browsertest übernehmen. |
| T3-03 Arbeitssatzanzahl | Körpergewichts-/sonstige gültige Arbeitssätze bleiben gezählt, auch ohne berechenbares Volumen. | Am Task-004-Commit erneut fehlgeschlagen. |
| T3-04 Lastbezug | „pro Hantel“, Maschinenbezug und relevante Variante an Werten/Kurven erkennbar. | Am Task-004-Commit erneut fehlgeschlagen. |
| T3-05 Detailauswahl | Exakt die angeklickte Workout-ID anzeigen, auch bei abgebrochenen Einheiten; kein stiller Fallback auf andere Einheit. | Früher bestätigt; im gemeinsamen Endstand erneut prüfen. |
| T3-06 Zeitraum | Nutzbare Zeitraumwahl in Übersicht; Kennzahlen und zugehörige Listen konsistent filtern. | Am Task-004-Commit erneut fehlgeschlagen. |
| T3-07 Cache-Race | Read von vor Invalidierung darf keinen alten Cache als frisch wiederherstellen. | Am Task-004-Commit behoben; erhalten. |
| T3-08 Host-Race | Verspätete Erst-Revalidierung oder deren Fehlerfallback darf neuere Host-Daten nicht überschreiben. | Am Task-004-Commit erneut fehlgeschlagen. |
| T3-09 Mobile Tabelle | Fortschritts-/Variantentabelle verursacht keine horizontale Seitenausdehnung. | Früher bestätigt; im gemeinsamen Endstand erneut prüfen. |

### Fachliche Vorgaben

- Satzanzahl und Volumen-Coverage sind unterschiedliche Kennzahlen. Verwende eine zentrale korrekte Engine-Kennzahl; keine neue Zählformel im Frontend.
- Wesentliche fachliche Hinweise auch bei `status=valid` anzeigen.
- Vergleichbare Lasten dürfen nicht nachträglich als Gesamtgewicht umgedeutet werden.
- Filter semantisch bis zu Listen, Trends und leeren Ergebnissen durchreichen.
- Neuere Host-Payloads durch Generation/Sequenz absichern; nicht allein auf eine formatierte Uhrzeit verlassen.
- Bei ausdrücklich angeforderter, fehlender Workout-ID klaren Fehler/Leerzustand zeigen.
- Breite Tabellen intern zugänglich scrollbar machen, ohne die ganze Seite zu verbreitern.

### Tests

Die früheren QA-Unit-/Render-/Bridge-/Browsertests vollständig ausführen und in die dauerhafte Suite übernehmen. Dazu 390 × 844 px mit echten Varianten, erneutes Öffnen historischer Host-Ergebnisse sowie langsame Antwort-/Fehlerfallback-Reihenfolgen testen.

---

## 11. Arbeitsauftrag G – Gemeinsame Schreibinfrastruktur konsistent halten

**Priorität: Bestandteil der Integrationsabnahme.**

Der Workout-Service besitzt einen Inline-Commitablauf; `src/server/plan/commit.ts` eine zweite Implementierung desselben Protokolls. Der Task-005-Bericht dokumentiert dies.

### Anforderungen

- Beide Domänen müssen pro Tracker dasselbe Repository, Ledger, Audit und denselben Coordinator verwenden.
- Gemeinsamer Request-ID-Namensraum; andere Operation oder anderer Akteur unter derselben ID muss konfliktieren.
- Fehlerkorrekturen aus Auftrag C in beiden Pfaden wirksam machen.
- Plan- und Workout-Ergebnisse bei Replay passend validieren; unsichere Type Assertions nicht als Garantie behandeln.
- Datei-Journal muss neue Plan-Einträge und vorhandene Workout-Einträge kontrolliert lesen können.
- Schema-/Formatänderungen am Journal dokumentieren; bestehende Journale nicht kommentarlos verwerfen.

Bevorzugt wird ein kleiner gemeinsamer getesteter Commit-Runner mit domänenspezifischen Build-/Result-Verträgen. Falls eine sofortige Umstellung unnötig hohes Risiko schafft, beide Implementierungen zunächst nachweislich angleichen und die begründete Restschuld dokumentieren. Eine nur in einer Domäne wirksame Sicherheitskorrektur ist nicht akzeptabel.

### Verbindliche Tests

1. Parallele Planaktivierung und Workout-Anlage auf demselben Tracker.
2. Parallele Planänderung und Satzkorrektur.
3. Gleiche Request-ID über Domänengrenzen.
4. Unklarer Plan-Commit vor Workout-Write und umgekehrt.
5. Prozessneustart nach gespeichertem Plan-/Workout-Batch vor Ledger-Bestätigung.
6. Audit-Replay erzeugt keine doppelten Events.
7. Berechtigungstrennung einschließlich Korrektur abgeschlossener Workouts bleibt erhalten.

Kein verteiltes Exactly-once-System im Rahmen dieses Pakets vortäuschen. Der zulässige Betriebsumfang bleibt synthetisch beziehungsweise bereits eng begrenzte bestehende Test-Schnittstelle.

---

## 12. Arbeitsauftrag H – Task 005 unabhängig abnahmefähig machen

**Einordnung: verpflichtender Prüfauftrag; keine pauschale Behauptung, dass diese Funktionen aktuell fehlerhaft sind.**

Der Entwickler meldet 647 Unit-/Integrationstests und 35 Browsertests. Diese Zahlen stammen aus dem Task-005-Completion-Report und wurden für dieses Briefing **nicht erneut unabhängig verifiziert**. Prüfe den endgültigen integrierten Commit.

### H1. Domain und Historie

- Aktive und archivierte Planinhalte sind gegen direkte Änderung geschützt.
- Bearbeiten erzeugt einen neuen Entwurf mit korrekten Version-/Item-IDs.
- Historische und laufende Workouts behalten ursprüngliche Plan-/Session-/Item-Referenzen.
- Aktivierung archiviert den Vorgänger im selben logischen Batch.
- Höchstens eine aktive Version je Tracker.
- Parallele Erstellung/Aktivierung verursacht weder doppelte Versionsnummern noch verlorene Updates.
- Vorhandene Übungs-IDs werden nicht neu zugewiesen; Übungsaustausch verändert keine alten Trainings.
- Zielwerte und Ausführungsarten behalten ihre fachliche Bedeutung; unbekannte Werte werden nicht still erfunden.

### H2. Explizite Bestätigung

Die Planaktivierung braucht eine ausdrückliche Bestätigung der **konkreten Version und Revision**. Eine zwischenzeitlich bearbeitete Version darf nicht mit einer älteren Bestätigung aktiviert werden. UI, MCP und direkter Service müssen dieselbe Regel erzwingen.

### H3. Editor

- Aktiver Plan, Entwurf, lokale ungespeicherte Einheit und bestätigte Speicherung unterscheidbar.
- Wechsel zwischen Plänen/Entwürfen darf kein altes Edit-Ziel übernehmen.
- Konflikte und Fehler erhalten Eingaben, ohne alte Daten als gespeichert auszugeben.
- Unklare Vorgänge behalten ihren sicheren Recovery-Weg; siehe Auftrag C.
- Doppelklick, Reload, opake MCP-App ohne Session Storage und Ansichtswechsel testen.
- Tastatur, Fokus, mobile Darstellung und Hell-/Dunkelmodus prüfen.
- Demo-Reset, Dashboard, Historie, Fortschritt und Workout-Logger bleiben funktionsfähig.

### H4. Integration

Pflichtablauf: Planentwurf erstellen → validieren → konkrete Revision bestätigen → aktivieren → Workout mit passender Session starten → Sätze loggen → abschließen → Plan als neue Version ändern → alte Trainings unverändert anzeigen.

Auch freie Einheiten, spontane Übungen, einseitige Ausführung, zwei Kurzhanteln, Körpergewicht, Unterstützung und alternierende Wiederholungen abdecken.

### H5. Bestehende Modusgrenzen

Plan-Writes bleiben Fixture-only, soweit dies dem Originalauftrag entspricht. Fehlender produktiver Plan-Sheets-Write ist hier kein Auftrag zur vorgezogenen Freischaltung.

**Abnahme H:** Vollständige Anforderungsmatrix Task 005 mit PASS/FAIL/PARTIAL/NOT VERIFIED und konkreten Nachweisen am gemeinsamen Zielcommit. Anschließend unabhängige QA ermöglichen; keine Selbstfreigabe durch bloßen Completion Report.

---

## 13. Arbeitsauftrag I – Schema-Einschränkungen ohne irreführende Historie behandeln

**Einordnung: bekannte Designgrenzen prüfen und absichern; keine automatische neue Migration.**

Der Task-005-Bericht nennt:

- Keine eigene SESSIONS-Tabelle; leere Einheiten nur lokal darstellbar.
- Session-Name/-Reihenfolge redundant auf PLAN_ITEMS.
- Keine eigenen Zeitstempel an PLAN_ITEMS.
- Nur ein aktiver Plan in v1.
- Verworfene Entwürfe werden als `archived` mit identischer Aktivierungs-/Archivierungszeit gespeichert.

### Anforderungen

1. Lokale leere Einheiten klar als ungespeichert kennzeichnen; keine Aktivierung mit unvollständigem Plan.
2. Eine Session-Umbenennung bleibt ein vollständig validierter logischer Vorgang.
3. Parent-/Item-Revisionen und Audit müssen Änderungen nachvollziehbar machen.
4. Ein verworfener Entwurf darf niemals als tatsächlich früher aktiver Plan in Analytics, Planerfüllung, Historie oder automatischer Workout-Zuordnung auftauchen.
5. Den Sentinel-Fall auch an Tages-, Wochen- und Zeitzonengrenzen testen, nicht nur in einer isolierten Hilfsfunktion.
6. Wiederherstellung erzeugt einen neuen Entwurf; verworfene/archivierte Inhalte werden nicht direkt reaktiviert oder überschrieben.
7. Wenn die verlangte Semantik mit Schema 1.0.0 nicht verlässlich erreichbar ist: Lücke ausdrücklich als PARTIAL/BLOCKED ausweisen und einen konkreten Migrationsvorschlag erstellen.

**Keine siebte Tabelle und keine neue Statussemantik stillschweigend in Produktion einführen.** Eine erforderliche Migration bleibt ein gesondert zu entscheidender Projektpunkt.

---

## 14. Arbeitsauftrag J – Bereits korrigierte Datenbasis und Analytics schützen

Die älteren QA-Berichte enthalten Fehler, die durch spätere Korrekturen adressiert wurden. Diese nicht ohne neuen Nachweis erneut als offen führen. Beim Zusammenführen aber ihre Regressionstests erhalten.

Pflichtschutz:

- Task 001: konsistente Plan-Lifecycle-Daten; Literaltext mit führendem `=`; reproduzierbares Lockfile/frische Installation.
- Task 002: echte Abschlusssemantik; vergleichbare PR-Varianten; keine Planerfüllung durch ungeplante Zusatzübungen.
- Historische Planwechsel innerhalb einer Woche korrekt behandeln.
- Monatsvergleiche aus dem tatsächlichen Filterzeitraum ableiten.
- Unvollständige Volumenbeiträge in Serien sichtbar lassen.
- Endliche Summen und sichere Ganzzahlen; keine DTO-Gesamtabstürze durch Extremwerte.
- Satznummern numerisch sortieren; zusammengesetzte IDs kollisionsfrei bilden.
- Korrigierte Engine-Reason-Texte und Metrics-Version im Presenter erhalten.

Zusätzlich mindestens: leere Historie, nur Körpergewicht, Warmups, stornierte Sätze, abgebrochene Workouts, unbekannte Referenzen und historische Versionen.

---

## 15. Verbindliche Teststrategie

### A. Reproduzierbarer Ausgangspunkt

- Frische Installation aus dem Lockfile in isoliertem Checkout des Integrationscommits.
- Keine Abhängigkeit von zufällig vorhandenen Build-Dateien.
- Keine echten Zugangsdaten oder Trainingsdaten.
- Bestands- und neu ergänzte Tests getrennt ausweisen.

### B. Standardprüfungen

```bash
npm ci
npm run typecheck
npm run build
npm test
npm run test:e2e
npm run format:check
git diff --check
```

Installationsskripte nach Projektvorgaben behandeln; abweichende sichere Installationsflags ausdrücklich dokumentieren. Lokale Ports für synthetische MCP-/Browsertests ermöglichen. Ein Sandbox-`EPERM` ist als Umgebungsfehler zu dokumentieren, nicht als bestandener oder fachlich gescheiterter Test.

### C. Gegenproben

Alle relevanten Gegenproben aus Task 003 und Task 004 ausführen. Sie sind Verhaltensnachweise, keine unveränderlichen Implementierungsvorschriften. Nach API-Anpassungen Importpfade/Verträge sachgerecht anpassen; die fachliche Assertion nicht abschwächen.

Die gelieferten Testdateien erwarten Positionen unter `tests/` beziehungsweise `tests/e2e/` im isolierten Projekt. Ihre relativen Imports beachten.

### D. Mindest-Testmatrix

| Bereich | Verbindlicher Nachweis |
| --- | --- |
| Auswahlkontext | Workout A/B und Plan A/B; keine Mutation am alten Ziel |
| Revisionen | Veraltete Satz-/Planrevision und veraltete Aktivierungsbestätigung |
| Retry | Gleiches Payload, anderes Payload, anderer Akteur, Reload |
| Fehlerzustand | Vor Intent, nach Intent, definitive Ablehnung, unklarer Dispatch |
| Persistenz | Tatsächliche zwei Prozesse; Write gespeichert, Bestätigung verloren |
| Domänenkopplung | Gemeinsame Queue/Ledger; Plan- und Workout-Operationen |
| Sheets-Grenze | Null Writes bei geplanter Grenzüberschreitung |
| Zeit | Ende vor Datum/Start; Zeitzone; Mitternacht |
| Darstellung | Arbeitssätze unabhängig von Volumen; Lastbezug an KPI und Kurve |
| Aktualität | Alte Read-/Host-Antwort überschreibt keinen neueren Zustand |
| Historie | Ursprüngliche Planreferenzen und alte Rohwerte bleiben erhalten |
| Sicherheit | Master/Tracker/Auth/Production-Sperre; Freitext bleibt Literal |
| Browser | Preview und MCP-Testhost; mobile Breite; Tastatur; Farbschemata |
| Bestandsfunktionen | Demo samt Reset, Read-only-Betrieb und feste HTML-Assets |

Testzahlen sind ein Ergebnis, keine Sollvorgabe. **490 am geprüften Task-004-Commit bestandene Tests und 647/35 aus dem Task-005-Entwicklerbericht beziehen sich auf unterschiedliche Stände.** Keine frei gemischte Gesamtzahl als Abnahmenachweis verwenden.

---

## 16. Arbeitsauftrag K – Dokumentation und Herkunft bereinigen

- Pro Task klar trennen: implementiert, getestet, unabhängig geprüft, integriert, veröffentlicht.
- Den alten lokalen Task-004-Blocked-Bericht nicht als aktuellen Stand weiterreichen. Historischen Status mit Datum/Bezugscommit archivieren oder eindeutig kennzeichnen.
- Task-005-Bericht auf tatsächliche gemeinsame Basis und finale Commit-SHA aktualisieren.
- Aussagen wie „Task 004 ist noch nicht committet“ anhand des separaten veröffentlichten Worktrees korrigieren.
- Write-/Plan-/UI-/Metrics-Contract an das implementierte Verhalten anpassen.
- Fehler- und Retry-Vertrag einschließlich „Verwerfen“ dokumentieren.
- Tabellenlimits und verbleibende Schema-Einschränkungen dokumentieren.
- Keine pauschalen Aussagen „alle bisherigen Tasks freigegeben“, solange die unabhängige Abnahme fehlt.
- Keine Drive-Agent-Anleitung, Google-Datei oder ChatGPT-Verbindung automatisch ändern.

Lege `docs/ARNOLD-STABILIZATION-S001-COMPLETION-REPORT.md` an und ergänze eine Befundmatrix: ID, Ursprung, betroffener Stand, Maßnahme, Testnachweis, Status, Restgrenze.

---

## 17. Sicherheits- und Änderungsgrenzen

Verbindlich:

- Master-Datei und alte Fitness-Datei nicht beschreiben.
- Keine echten Trainingslogs bearbeiten, löschen oder umwidmen.
- Produktiven Schreibmodus deaktiviert lassen.
- Keine booleschen Flags als Ersatz für echte Nutzeridentität ausgeben.
- Keine zusätzlichen Google-Schreibrechte für PLANS/PLAN_ITEMS im Rahmen dieses Pakets.
- Keine OAuth-, Deployment-, Tunnel- oder produktiven Verbindungsänderungen.
- Keine neuen externen Dienste/Konten/Kosten.
- Keine Secrets in Commits, Berichten oder Sicherungspaketen.
- Kein Merge nach `main` und keine Produktionseinführung.
- Kein Umgehen von Revisionen, Authentifizierung oder Quarantäne, um Tests grün zu bekommen.
- Alle Writes in Tests ausschließlich gegen synthetische Adapter beziehungsweise ausdrücklich bestehende autorisierte Testgrenzen.

Ein echter Google-Schreibtest ist **kein notwendiger Abnahmeschritt dieses Fixpakets** und durch dieses Briefing nicht freigegeben.

---

## 18. Definition of Done und Abschlussbericht

### Definition of Done

- [ ] Uncommittete Arbeiten gesichert und ihre Herkunft dokumentiert.
- [ ] Ein gemeinsamer Integrationsbranch mit nachvollziehbaren Commits.
- [ ] Task-001-/002-Korrekturen erhalten.
- [ ] Task-003-Befunde vollständig geschlossen oder transparent begründet, ohne offene Abnahmehindernisse.
- [ ] Task-004-F01 bis F04 durch fachliche Regressionen geschlossen.
- [ ] Task-004-F05 durch tatsächliche Task-003-Integration erledigt.
- [ ] Fehlende Asset-/Neustarttests wieder integriert und ausgeführt.
- [ ] Plan-/Workout-Recovery verwendet denselben korrekten Zustandsvertrag.
- [ ] Planeditor-„Verwerfen“ erzeugt keinen verlorenen Recovery-Auftrag.
- [ ] Gemeinsames Ledger, Queue und Audit über Domänengrenzen getestet.
- [ ] Task-005-Originalanforderungen am gemeinsamen Stand geprüft.
- [ ] Historische Referenzen unverändert; verworfene Entwürfe fachlich eindeutig.
- [ ] Vorhandene Suiten und unabhängige Gegenproben erfolgreich.
- [ ] Dokumentation widerspruchsfrei und auf konkrete SHAs bezogen.
- [ ] Produktionsschreibschutz und Master-Schutz erhalten.
- [ ] Reproduzierbarer Zielcommit an unabhängige QA übergeben.

### Abschlussbericht

Titel: **ARNOLD STABILIZATION S001 – COMPLETION REPORT**

1. Status: Completed / Partial / Blocked.
2. Tatsächliche Ausgangsbranches und SHAs.
3. Sicherung und Übernahme uncommitteter Task-005-Arbeit.
4. Endgültiger Integrationsbranch und Commit-SHA.
5. Befundmatrix für Task 003 und Task 004.
6. Durchgeführte Task-005-Anforderungsprüfung.
7. Änderungen an Commit-, Recovery- und UI-Verträgen.
8. Ergebnisse aller Tests mit exakten Zahlen und Protokollen.
9. Belegter Schutz historischer Daten.
10. Sicherheitsmodi und verbleibende Produktionsgrenzen.
11. Dokumentationsänderungen.
12. Offene Punkte, Risiken und gegebenenfalls Migrationsvorschläge.
13. Liste neuer/geänderter Dateien.
14. Konkrete Anweisung zur unabhängigen erneuten QA.

**Stoppe nach diesem Paket.** Keine nächste Entwicklungsphase automatisch beginnen.

Der Lead Developer darf die Umsetzung als abgeschlossen melden. Das abschließende unabhängige QA-Gate – PASS, PASS WITH CONDITIONS, FAIL oder BLOCKED – wird danach separat auf dem benannten Commit vergeben.

---

## 19. Empfohlene Reihenfolge

1. Arbeitsstände sichern, parallele Bearbeitung abstimmen.
2. Integrationsbasis und Dokumentherkunft klären.
3. Task-003-Korrekturen mit Task-002-/004-/005-Änderungen verbinden.
4. P1-Auswahl- und Recoveryfehler beheben, beide Domänen absichern.
5. Tabellenlimit und Endzeitvalidierung korrigieren.
6. Task-005-Kernabläufe, Schema-Grenzen und Historie prüfen.
7. Gesamte Testsuite und unabhängige Gegenproben ausführen.
8. Dokumentation, Befundmatrix und Zielcommit fertigstellen.
9. Unabhängige QA anfordern; erst anschließend über Task 006 entscheiden.

**Erfolg dieses Pakets ist ein belastbarer gemeinsamer Stand der bereits gebauten Funktionen.** Neue Features ersetzen die fehlende Integration und Abnahme nicht.

