# ARNOLD – INDEPENDENT QA REPORT

Prüfdatum: 25.10.2026 · Europe/Berlin

**1. Prüfgegenstand**

- **Task:** ARNOLD TASK 003 – Dashboard Integration, Analytics API & MCP UI Modernization.
- **Repository:** [DosiGus/Arnold](https://github.com/DosiGus/Arnold).
- **Geprüfter Branch:** `feat/arnold-dashboard-v2`.
- **Geprüfter Commit:** `d613b4e9589e84cca54f57feff784250e6940cf3`.
- **Unmittelbare Vergleichsbasis:** `a6bd7efd371e2a675f9912578a2582001c9d7d27`, direkter Vorgänger. Der eigentliche Dashboard-Commit umfasst 34 Dateien, +7.496/−38 Zeilen.
- **Erweiterte Vergleichsbasis:** `fbbc1c083cfe8d4c768fd7dbc1f69ba33a262ad5`. Einschließlich des vorausgehenden Carry-over-Commits `a6bd7ef` ergibt sich die im Report genannte Summe von 39 Dateien, +7.837/−50 Zeilen. Dieser Carry-over enthält bereits begonnene Task-001-Korrekturen.
- **Wichtige Git-Abgrenzung:** `8037cb2` auf `fix/task-001-qa` und `a6bd7ef` sind Geschwistercommits auf `fbbc1c0`, keine lineare Commitfolge. Die relevanten Task-001-Korrekturen wurden funktional übernommen; daraus wird kein Merge von `8037cb2` behauptet. Task 002 liegt unverändert unter `ddb0bf3` in der Historie.
- **GitHub und lokaler Status:** Zu Beginn und am Ende überprüft: GitHub-Branch und lokaler Branch entsprechen exakt `d613b4e`; Arbeitsverzeichnis sauber. Der Report ist beim Push-Status überholt: Der Stand ist inzwischen gepusht.
- **Isolation:** Vollständiger Git-Archivexport nach `/private/tmp/arnold-qa-d613b4e`. Eigene frische Dependencies; sämtliche zusätzlichen Tests und Prüfdateien ausschließlich dort und im separaten QA-Berichtsordner. Kein Branchwechsel, Commit, Push oder Produktpatch durch QA.
- **Quellen:** [Originalauftrag](</Users/kevingusmao/.codex/attachments/65388975-f8c3-409d-b840-f161e0b7a557/Eingefügter Text.txt>), [Completion Report](</Users/kevingusmao/.codex/attachments/34f28654-b20f-4446-be18-1c3e6408d4bc/Eingefügter Text.txt>), tatsächlicher Commit, UI-/Metrik-/Datenvertrag und die früheren unabhängigen QA-Nachweise.

**2. Gesamtergebnis**

## FAIL

Die Demo funktioniert weiter, das neue Dashboard lässt sich mit der statischen Testdatenquelle öffnen und alle vorhandenen Standardprüfungen bestehen. Der eigentliche neue Sheets-Betriebsmodus startet jedoch mit seiner dokumentierten Konfiguration nicht. Zusätzlich sind eine sich selbst fortsetzende Aktualisierungsschleife, falsche Arbeitssatzzahlen, unzureichende Lastbeschriftungen und weitere UI-/Cache-/Lifecycle-Fehler bestätigt.

**Neun neue Befunde: vier P1 und fünf P2.** Unabhängig davon bleiben die fachlichen Befunde aus Task 002 in der eingebundenen Engine bestehen: Alle 14 Analytics-Module sind byteidentisch zum zuvor geprüften, durchgefallenen Task-002-Stand; 14 wiederholte Regressionstests scheitern weiterhin. Die bloße Existenz dieser Schicht und eine grüne Standardsuite erfüllen die geforderte Voraussetzung „Task 002 abgeschlossen“ nicht.

**Positiv:** Die drei früheren Task-001-Hauptbefunde sind im hier geprüften Stand gezielt nachgeprüft und behoben: Plan-Lebenszyklusdaten werden abgelehnt, wenn sie widersprüchlich sind; Literaltext mit führendem `=` bleibt erhalten; ein frischer Installationslauf funktioniert. Das ist keine pauschale erneute Vollfreigabe jedes Task-001-Details.

**3. Anforderungsprüfung**

| Originalanforderung | Ergebnis | Nachweis / Abweichung |
| --- | --- | --- |
| Voraussetzungen Task 001 und Task 002 abgeschlossen | PARTIAL / FAIL | Task-001-Hauptkorrekturen nachgeprüft; Task-002-Engine unverändert mit weiterhin reproduzierbaren fachlichen Fehlern. |
| A: Bestehende Architektur respektieren | PASS | Demo-App und alte Berechnungen bleiben bestehen; neue Ansicht über expliziten Vertrag getrennt. |
| B: Tatsächliche Sheets → Adapter → Analytics → MCP → UI-Pipeline | FAIL | Die produktive Source-Factory wirft schon bei Konstruktion `ArnoldDataError`, T3-01. Die statische Testquelle umgeht diesen Pfad. |
| B: Google nur im Backend, keine Credentials im Frontend | PASS im untersuchten Code | Read-only-Adapter, serverseitige Source und CSP; keine Google-Aufrufe aus dem iframe. |
| B: Keine Demo-Fallbacks bei echten Lesefehlern | PASS in ausgeführten Fällen | Fehlende Quelle wird als Fehler angezeigt; keine erfundenen Workouts. |
| B: Kennzahlen aus Analytics und transparent bei fehlenden Werten | PARTIAL | Zentrale Engine wird verwendet; falsche Projektion der Arbeitssatzzahl, T3-03; alte Analytics-Probleme bleiben. |
| B/C: Zod-validierte, explizite API-Verträge | PASS für die Struktur | Server und Client prüfen DTOs; v2-Namen sind nach der Kompatibilitätsregel zulässig. Strukturvalidität beweist keine fachliche Richtigkeit. |
| C: App-Opener und vier lesende Arnold-Tools | PASS mit Einschränkung | Registrierung, App-Ressource und MCP-Testhost funktionieren mit statischer Quelle. Echter Source-Start scheitert. |
| C/F: Beliebige Trainingsnamen, historische Pläne, spontane Workouts | PASS in regulären Fixtures | Keine Pflicht-Push/Pull/Legs-Zuordnung; Snapshots in Historie erhalten. |
| E: KPI-Bereich und Wochenentwicklung | PARTIAL | Vorhanden; Arbeitssätze falsch bei unbekanntem Volumen, Übersicht ohne Zeitraumwahl, T3-03/T3-06. |
| E/F: Klick auf Einheit öffnet deren Details | FAIL | Klick auf eine abgebrochene Einheit öffnet eine andere Einheit, T3-05. |
| F/H: Tatsächliche Satzdaten, Seite und Lastdefinition darstellen | PARTIAL | Satzlisten beschriften Lasten und Seiten überwiegend korrekt; Fortschritts-KPIs und Kurven verlieren wesentliche Lastbezüge, T3-04. |
| G: Übung, Zeitraum, Metrik und vergleichbare Ausführung | PARTIAL | Übung/Zeitraum/Metrik auswählbar. Keine Variante auswählbar; aktive Kurvenvariante und Lastbasis nicht ausreichend erkennbar, T3-04. |
| I: Leerer Tracker und Master getrennt, kein simuliertes Onboarding | PASS in Fixtures | Eigene Zustände, keine Beispieltrainings oder leeren Onboarding-Aktionen. |
| I/J: Fehler, Aktualisierung und Schutz vor alten Snapshots | FAIL / PARTIAL | Normaler Erst-Replay wird geprüft; Refresh-Schleife und nachgewiesene Antwort-Race, T3-02/T3-08. |
| J: Offizielle MCP-App-Bridge, Host-Theme, AutoResize | PASS im Testhost | Bestehende und neue Host-/Bridge-Tests bestanden; keine eigene postMessage-Lösung. |
| K: Gebündelte Reads, TTL und Vorbereitung späterer Writes | PARTIAL | Cache-Schnittstelle vorhanden, aber Aktualisierungsschleife und Invalidation-Race, T3-02/T3-07. |
| L: Mobile Darstellung aller neuen Ansichten | FAIL | Fortschrittsansicht mit Varianten wird auf 390 px Bildschirm 440 px breit, T3-09. |
| L: Tastatur und automatisierte Accessibility | PASS in ausgeführten stabilen Fällen | Standardtests bestanden; zusätzliche Dark-Theme-Prüfung aller drei Ansichten nach Stabilisierung ebenfalls bestanden. Keine vollständige manuelle Accessibility-Zertifizierung. |
| M: Bestehende Demo und Regressionstests erhalten | PASS für bestehende Suite | 366 Unit-/MCP- und 19 Browser-Tests bestehen. Neue Nachweise zeigen wichtige Abdeckungslücken. |
| N: Technische Dokumentation | PARTIAL | Umfangreich vorhanden; Aussagen über echten Source-Start, Lastkennzeichnung, Race-Sicherheit und Invalidation sind durch Befunde nicht gedeckt. |
| Sicherheits-/Änderungsgrenzen | PASS im untersuchten Commit | Keine Google-Writes, OAuth-/Nutzerverwaltungs-/Deployment-/Tunneländerungen oder neuen externen Dienste. |

**4. Code-Review Findings**

### T3-01 · P1 – Der echte Arnold-Sheets-Modus startet nicht

- **Dateien:** [arnold-source.ts:123](/Users/kevingusmao/Desktop/Arnold/src/server/arnold-source.ts:123), [storage-config.ts:122](/Users/kevingusmao/Desktop/Arnold/src/server/storage-config.ts:122), strikte Adapterprüfung in [arnold-sheets-read-adapter.ts:128](/Users/kevingusmao/Desktop/Arnold/src/server/arnold-sheets-read-adapter.ts:128).
- **Beobachtung:** `ArnoldSheetsDataSource` übergibt die vollständigen Source-Optionen an den Adapter. Dessen Zod-Schema akzeptiert ausschließlich Adapter-Optionen. `cacheTtlMs`, `transport`, `label`, `description` und `now` gehören dort nicht hinein. `createArnoldSource` übergibt immer `cacheTtlMs`, auch beim Standardwert.
- **Reproduktion:** `createArnoldSource(root, { STORAGE_MODE:"arnold_sheets", MCP_ACCESS:"private", ARNOLD_SPREADSHEET_ID:"synthetic-arnold-v1-workbook" })` ausführen. Ergebnis: `ArnoldDataError`, Issue-Code `OPTIONS`. Bereits `{spreadsheetId, cacheTtlMs:0}` reicht. Keine Google-Verbindung oder echte Credentials für diesen Nachweis erforderlich.
- **Erwartung:** Die dokumentierte Konfiguration konstruiert die Source; erst ein tatsächlicher Leseversuch kann gegebenenfalls an Credentials oder Berechtigungen scheitern.
- **Korrektur:** Source-/Cache-/Transportoptionen sauber abtrennen und nur zulässige Adapteroptionen weitergeben. Einen Integrationstest der echten Factory und Source mit gemocktem Google-Transport ergänzen. Zwei neue Tests scheitern; die vorhandenen MCP-/Browser-Tests verwenden `StaticArnoldDataSource` und erkennen den Fehler nicht.

### T3-02 · P1 – Ein Aktualisierungsklick erzeugt eine dauernde Request-Schleife

- **Dateien:** [hooks/index.ts:88](/Users/kevingusmao/Desktop/Arnold/src/ui/hooks/index.ts:88), [client.ts:67](/Users/kevingusmao/Desktop/Arnold/src/ui/client.ts:67), [main.tsx:30](/Users/kevingusmao/Desktop/Arnold/src/ui/main.tsx:30).
- **Reproduktion:** Synthetischen v2-Server `/preview` öffnen, einmal „Trainingsdaten aktualisieren“ klicken und MCP-Tool-Aufrufe beobachten.
- **Tatsächliches Ergebnis:** Im unabhängigen Browsertest **109 zusätzliche `get_arnold_dashboard_v2`-Aufrufe innerhalb von 700 ms**.
- **Ursache:** Jede angeforderte Antwort wird zugleich global als neues Payload publiziert. `Boot` ersetzt dadurch `initial`; `useDashboardData` reagiert auf diese Änderung mit einem weiteren Abruf, dessen Antwort wieder `initial` ersetzt. Der Hook-Sequenzzähler unterbindet diesen Rückkopplungspfad nicht.
- **Erwartung:** Eine begrenzte Aktualisierung pro Aktion, danach ein ruhender Zustand.
- **Korrektur:** Start-/Host-Payloads und Antworten expliziter View-Abfragen auseinanderhalten oder neue Host-Daten direkt übernehmen, ohne aus ihrer Publikation wieder einen Request auszulösen. Browser-Regression für die tatsächliche Klickaktion ergänzen. Es wurde keine reale Google-Datei belastet; der Nachweis lief ausschließlich auf lokaler statischer Fixture.

### T3-03 · P1 – Gültige Arbeitssätze verschwinden, wenn ihr Volumen unbekannt ist

- **Datei:** [arnold-presenter.ts:473](/Users/kevingusmao/Desktop/Arnold/src/server/arnold-presenter.ts:473).
- **Beobachtung:** Der KPI „Gültige Arbeitssätze“ verwendet `volume.by_bucket.working.coverage.included_sets`. Dieser Wert zählt die in die Volumensumme eingegangenen Beiträge, nicht alle gültigen Arbeitssätze.
- **Reproduktion:** Eine abgeschlossene Einheit mit einem gültigen Körpergewichtssatz, zehn Wiederholungen, unbekannter Körpermasse. Die Historie meldet korrekt einen Arbeitssatz; der Übersichts-KPI meldet **0**. Bei einem berechenbaren Satz plus einem Körpergewichtssatz meldet er **1 statt 2**.
- **Erwartung:** Die Anzahl der erfassten gültigen Arbeitssätze bleibt bekannt, auch wenn keine Last-/Volumensumme berechnet werden kann. Satzanzahl und Volumen-Coverage sind verschiedene Kennzahlen.
- **Korrektur:** Eine echte Arbeitssatzzahl der Analytics Engine verwenden beziehungsweise dort als zentrale Kennzahl bereitstellen. Nicht aus Volumen-Berechenbarkeit ableiten und keine konkurrierende Zähllogik im Frontend ergänzen. Zwei neue Tests scheitern.

### T3-04 · P1 – Wesentliche Lastbezüge gehen in der Fortschrittsansicht verloren

- **Dateien:** [arnold-presenter.ts:829](/Users/kevingusmao/Desktop/Arnold/src/server/arnold-presenter.ts:829), [components/index.tsx:80](/Users/kevingusmao/Desktop/Arnold/src/ui/components/index.tsx:80), [ExerciseProgressView.tsx:159](/Users/kevingusmao/Desktop/Arnold/src/ui/views/ExerciseProgressView.tsx:159).
- **Reproduktion:** Einen Satz mit 20 kg **pro Hantel**, zwei Hanteln, zehn Wiederholungen anzeigen. Die Karte zeigt nur **„Maximale vergleichbare Last 20 kg“**. Die 1RM-Karte zeigt etwa **26,7 kg**, ohne den vorhandenen Hinweis „pro Hantel“ darzustellen.
- **Ursache:** Beim Maximalwert fehlt die Lastkennzeichnung bereits im kompakten KPI. Beim 1RM ist sie als `note` vorhanden, wird von `MetricCard` jedoch unterdrückt, weil der Wert den Status `valid` hat. Ein fachlicher Vorbehalt kann auch bei einem korrekt berechneten Wert notwendig sein. Die Kurve erhält nur den allgemeinen Text und die Einheit `kg`; die aktive Vergleichsvariante ist nicht auswählbar beziehungsweise ausreichend bezeichnet.
- **Erwartung:** „pro Hantel“, Maschinenbezug und relevante Seite/Ausführung direkt an den betroffenen Werten/Kurven erkennen können; keine Verwechslung mit Gesamtlast. Die Variantentabelle weiter unten ersetzt diese Beschriftung nicht.
- **Korrektur:** Lastbezug und Vergleichbarkeit in KPI-/Serienprojektion erhalten und zentral formatieren; wesentliche Hinweise unabhängig von `status !== valid` anzeigen. Bei mehreren Varianten eine eindeutige Auswahl/Kennzeichnung ermöglichen. Zwei Render-Tests und ein Browser-Test scheitern. [Screenshot](qa-task003-progress.png).

### T3-05 · P2 – Klick auf eine abgebrochene Einheit öffnet eine andere Einheit

- **Dateien:** [WorkoutHistoryView.tsx:52](/Users/kevingusmao/Desktop/Arnold/src/ui/views/WorkoutHistoryView.tsx:52), Fallback ab Zeile 64; auslösende Übersichtsliste in [arnold-presenter.ts:579](/Users/kevingusmao/Desktop/Arnold/src/server/arnold-presenter.ts:579).
- **Reproduktion:** In der Übersicht die vorhandene Fixture-Karte „Abgebrochene Einheit“ vom 20.10.2026 anklicken.
- **Tatsächliches Ergebnis:** Die Detailansicht zeigt **„Freies Training“**, eine andere Einheit vom 19.10.2026. Die angeklickte ID fehlt in der standardmäßig auf abgeschlossene Workouts beschränkten Historienseite; die UI fällt still auf `workouts[0]` zurück.
- **Erwartung:** Genau die angeklickte Einheit öffnen oder deren Nichtverfügbarkeit ausdrücklich melden. Keine fremde Einheit als scheinbare Antwort anzeigen.
- **Korrektur:** Details gezielt anhand der Workout-ID laden beziehungsweise den passenden Status beim Öffnen berücksichtigen. Den stillen Fallback für eine ausdrücklich angeforderte ID entfernen. Ein Browser-Test scheitert.

### T3-06 · P2 – Zeitraumfilter sind in der Übersicht unvollständig umgesetzt

- **Dateien:** [ArnoldDashboardApp.tsx:68](/Users/kevingusmao/Desktop/Arnold/src/ui/ArnoldDashboardApp.tsx:68), [OverviewView.tsx:56](/Users/kevingusmao/Desktop/Arnold/src/ui/views/OverviewView.tsx:56), [arnold-presenter.ts:579](/Users/kevingusmao/Desktop/Arnold/src/server/arnold-presenter.ts:579).
- **Fall A:** Die Übersicht ist absichtlich immer ungefiltert; es gibt dort keinen Zeitraumfilter für die Wochenentwicklung. Im Browser befinden sich in dieser Ansicht null Datumsfelder. Abschnitt 7.2 des Auftrags verlangt eine geeignete Zeitraumwahl.
- **Fall B:** Selbst ein serverseitiger Dashboard-Abruf mit `from=2030-01-01`, `to=2030-01-31` liefert zwar null Einheiten im Zeitraum, aber weiterhin fünf `recent_workouts` aus 2026. Diese Liste entsteht direkt aus dem ungefilterten Dataset; die Abgrenzung zur ausgewählten Ansicht ist nicht kenntlich.
- **Erwartung:** Eine nutzbare Zeitraumwahl und konsistente Anwendung auf die zeitraumbezogenen Inhalte. Globale Zusatzlisten müssten gegebenenfalls ausdrücklich als außerhalb der Auswahl gekennzeichnet sein.
- **Korrektur:** Übersicht an den Dashboard-Filter anbinden, nach Zeitraum/Plan eingeschränkte Listen aus derselben Auswahl bilden und leere Treffer verständlich anzeigen. Zwei Unit-/Render-Tests und ein Browser-Test scheitern.

### T3-07 · P2 – Ein laufender Read kann eine Cache-Invalidierung rückgängig machen

- **Datei:** [arnold-source.ts:145](/Users/kevingusmao/Desktop/Arnold/src/server/arnold-source.ts:145), `invalidate()` ab Zeile 161.
- **Reproduktion:** Einen verzögerten, ausschließlich gemockten Read starten; währenddessen `invalidate()` aufrufen; danach den alten Read abschließen lassen und erneut lesen.
- **Tatsächliches Ergebnis:** Der alte Read füllt den Cache erneut. Der zweite Aufruf liefert diesen alten Bestand; der gemockte Adapter wurde nur einmal statt zweimal aufgerufen.
- **Erwartung:** Ein vor der Invalidierung gestarteter Abruf darf den invalidierten Bestand nicht wieder als aktuellen Cache eintragen. Der dokumentierte Vertrag verspricht nach Invalidierung einen neuen Read.
- **Korrektur:** Cache-Generation/Invalidierungszähler oder gleichwertige Koordination für laufende Reads verwenden. Ein Test scheitert. Das betrifft die ausdrücklich verlangte Vorbereitung späterer Writes; es wurde kein tatsächlicher Schreibvorgang ausgeführt.

### T3-08 · P2 – Eine verspätete Erstaktualisierung überschreibt neuere Host-Daten

- **Datei:** [client.ts:97](/Users/kevingusmao/Desktop/Arnold/src/ui/client.ts:97).
- **Reproduktion:** Historisches Host-Ergebnis empfangen und dessen Erstaktualisierung verzögern. Währenddessen einen neueren Host-Payload mit Stand 10:00 empfangen. Anschließend die ältere, bereits laufende Antwort mit Stand 09:00 auflösen.
- **Tatsächliches Ergebnis:** Die Oberfläche erhält zuletzt wieder den Stand **09:00**, obwohl sie bereits 10:00 erhalten hatte. `onStale` bleibt `false`.
- **Erwartung:** Eine ältere laufende Antwort darf einen neueren bereits publizierten Stand nicht zurücksetzen. Die Sequenzsicherung der View-Hooks schützt den globalen Publish-Pfad nicht.
- **Korrektur:** Die globale Host-/Revalidierungsverarbeitung mit Request-Generation und konsistenter Aktualitätsprüfung absichern; eine überholte Revalidierung oder deren Fallback verwerfen. Ein zusätzlicher Bridge-Test scheitert. Der normale einzelne Replay-Fall ist durch die vorhandenen Tests korrekt abgesichert; die nachgewiesene Race ist ein zusätzlicher Fall.

### T3-09 · P2 – Die mobile Fortschrittsansicht läuft über den Bildschirmrand

- **Dateien:** [style.css:2630](/Users/kevingusmao/Desktop/Arnold/src/ui/style.css:2630), Variantentabelle in [ExerciseProgressView.tsx:200](/Users/kevingusmao/Desktop/Arnold/src/ui/views/ExerciseProgressView.tsx:200).
- **Reproduktion:** 390 × 844 px einstellen, „Fortschritt“ öffnen und eine Übung mit Links-/Rechts-Varianten auswählen.
- **Tatsächliches Ergebnis:** `document.body.scrollWidth=440` bei `innerWidth=390`.
- **Ursache:** `.set-list` erhält mobil mindestens 420 px. Der interne Scrollschutz liegt nur auf `.exercise-details` der Workout-Historie, nicht auf der Variantentabelle der Fortschrittsansicht.
- **Erwartung:** Keine horizontale Seitenausdehnung; breite Tabellen bei Bedarf innerhalb eines zugänglichen Containers scrollen.
- **Korrektur:** Auch diese Tabelle responsiv begrenzen beziehungsweise intern scrollbar machen. Ein Browser-Test scheitert. [Screenshot](qa-task003-mobile.png).

**5. Testergebnisse**

Alle Prüfungen wurden unabhängig selbst ausgeführt. Die vorhandenen Standardprüfungen liefen vor dem Hinzufügen der QA-Dateien auf dem unveränderten Commitexport.

| Prüfung | Ergebnis | Nachweis |
| --- | --- | --- |
| Frische Installation | PASS | `npm ci --ignore-scripts --audit=false --fund=false`; 212 Pakete installiert, alle 212 installierten Versionen stimmen mit dem Lockfile überein. Installationsskripte bewusst deaktiviert; anschließender Build erfolgreich. |
| `npm run typecheck` | PASS | Exit 0. |
| `npm test` | PASS | 366/366 Unit-/MCP-Tests, 22 Dateien. |
| `npm run build` | PASS | Typecheck, Vite-UI/-Host und Server-Kompilierung erfolgreich. |
| `npm run test:e2e` | PASS | 19/19 Browser-Tests: neun bestehende und zehn neue Arnold-Specs. |
| `npm run format:check` | PASS | Alle geprüften Dateien formatiert. |
| Neue QA-Unit-/Render-/Bridge-Tests | FAIL | Zehn Tests, zehn Fehler; T3-01/03/04/06/07/08. |
| Neue QA-Browserfälle, abschließende Bewertung | 5 FAIL / 1 PASS | Refresh-Schleife, falsche Einheit, fehlende Lastbeschriftung, fehlender Übersichtsfilter und mobiler Überlauf scheitern. Stabiler Dark-Theme-Axe-Lauf über alle drei Ansichten besteht. |
| Wiederholung Task-002-Regressionen | FAIL | 14 Tests, 14 Fehler. Der inzwischen von der Domain-Validierung abgefangene Draft-Unterfall wurde ausdrücklich ausgeschlossen. |
| Gezielte Task-001-Nachprüfung | PASS | Aktiver Plan ohne Aktivierung abgelehnt; aktiver Plan mit Retirement abgelehnt; Literaltext `=literal note` unverändert akzeptiert. |
| Echte Source-Factory ohne Google-Aufruf | FAIL | Dokumentierte Optionen verursachen `ArnoldDataError/OPTIONS`, noch vor Netzwerk/Authentifizierung. |

**Accessibility-Messung:** Der erste zusätzliche Dark-Theme-Lauf meldete einen Kontrastverstoß unmittelbar während Theme-/Navigationsübergängen. Zur Abgrenzung einer instabilen Messphase wurde die Prüfung mit reduzierter Bewegung und abgewartetem Rendering wiederholt; alle drei v2-Ansichten bestanden. Es wird daraus kein dauerhafter Dark-Theme-Fehler behauptet. Beide Rohberichte sind erhalten. Der mobile Überlauf ist hiervon unabhängig bestätigt.

**Umgebung:** Node `v26.7.0`, npm `11.19.0`; frischer Dependency-Bestand des geprüften Lockfiles. Die neuen Browsernachweise verwenden ausschließlich lokale synthetische Fixture-Server. Ein externer Google-/ChatGPT-Produktivzugriff wurde nicht verwendet.

**Nachweise:**

- [Zusammenfassung der Prüfungen](qa-summary.json).
- [Neue Unit-/Render-Tests](qa-task003.test.tsx) und [Ergebnisbericht](qa-task003-results.json).
- [Zusätzlicher Bridge-Test](qa-task003-bridge.test.ts) und [Ergebnisbericht](qa-task003-bridge-results.json).
- [Neue Browser-Regressionstests](qa-task003.spec.ts) und [Ergebnisbericht samt Request-Zählung](qa-task003-browser-results.json).
- [Mobile-/Dark-Theme-Tests](qa-task003-accessibility.spec.ts), [erster Lauf](qa-task003-accessibility-first-run.json) und [stabiler Dark-Theme-Lauf](qa-task003-dark-results.json).
- [Wiederholte Analytics-Regressionen](qa-task003-legacy.test.ts) und [Ergebnisbericht](qa-task003-legacy-results.json).
- [SHA-256-Manifest der 39 Dateien des erweiterten Prüfumfangs](source-manifest.json).

Reproduktion in einem isolierten Checkout: die jeweiligen `.test.tsx`/`.test.ts` nach `tests/`, die `.spec.ts` nach `tests/e2e/` kopieren. Mit `vitest run tests/qa-task003.test.tsx tests/qa-task003-bridge.test.ts tests/qa-task003-legacy.test.ts` beziehungsweise `playwright test tests/e2e/qa-task003.spec.ts tests/e2e/qa-task003-accessibility.spec.ts` ausführen. Standardbrowserkonfiguration und Fixtures des Commits werden unverändert verwendet.

**6. Architektur & Integration**

Positiv sind die Trennung zwischen Source, Presenter, MCP-Vertrag, Client, Hooks und Ansichten, die offiziell verwendete App-Bridge, die ausdrücklich versionierten v2-Tools und die erhaltene Demo. Die v2-Namen sind nach dem Originalauftrag zulässig; hieraus entsteht kein Finding.

Die entscheidende Integrationslücke liegt zwischen der Source-Factory und dem strikten Adapter: Die getestete statische Quelle bildet diesen Übergang nicht ab. Damit belegen erfolgreiche UI-/MCP-Tests zwar das Dashboard über Fixtures, aber keine funktionierende tatsächliche Sheets-Pipeline.

Die Presenter-Schicht darf Engine-Ergebnisse projizieren; dabei muss sie jedoch die Bedeutung der gewählten Zahlen erhalten. T3-03 ist gerade kein fehlendes Rechenfeature, sondern die Verwechslung von Satzanzahl und Volumen-Coverage. T3-04 zeigt zusätzlich einen Bedeutungsverlust zwischen Engine, DTO und Oberfläche.

**Fortbestehende Task-002-Befunde:**

| Früherer Befund | Erneuter Nachweis / Einordnung |
| --- | --- |
| T2-F1: Statusfilter machen nicht abgeschlossene Einheiten zu Abschlüssen | Engine weiterhin fehlerhaft. Der neue History-Presenter hält die Listen-Statusauswahl korrekt von seiner Standard-Analytics getrennt; diese konkrete API-Mitigation wird anerkannt. |
| T2-F2: Workout-Volumenrekorde vermischen Varianten | Weiterhin reproduzierbar. Die neue Übersicht projiziert derzeit nur Maximalgewicht und 1RM, nicht diesen Rekordtyp. |
| T2-F3: Ungeplante Übungen erfüllen Planpositionen | Weiterhin reproduzierbar; die Engine ist unverändert. Die aktuelle Planbox zeigt noch keine entsprechende Erfüllungsquote. |
| T2-F4: Planwechsel innerhalb einer Woche | Weiterhin falsches vollständiges Wochenziel. Der Draft-Unterfall wird jetzt bereits durch das korrigierte Domain-Schema abgefangen. |
| T2-F5: Künstlicher Vormonat | Weiterhin reproduzierbar in der Engine. |
| T2-F6: Verlust des Partial-Status in Serien | Weiterhin reproduzierbar und für neue Fortschrittsdaten relevant. |
| T2-F7: Aggregierte Extremwerte | Weiterhin reproduzierbar; die neuen Presenter rufen den vollständigen Dashboard-Analytics-Aufbau auf und erben dessen Abbrüche. |
| T2-F8: Numerische Satzreihenfolge | Engine weiterhin fehlerhaft; die neue rohe Historienansicht sortiert ihre Satznummern hingegen bereits numerisch. |
| T2-F9: Kollision zusammengesetzter IDs | Weiterhin reproduzierbar in der Plananalyse. |

Diese Abgrenzung verhindert, dass ein alter Engine-Fehler ungeprüft als neue UI-Beobachtung ausgegeben wird. Die unerfüllte Task-002-Voraussetzung bleibt dennoch ein Freigabehindernis.

**7. Sicherheit & Datenintegrität**

- **Schreibschutz:** Neue Arnold-Tools sind lesend annotiert; keine Sheets-Schreibmethoden oder Schreibtools im Arnold-Modus. QA hat keine echten Trainingsdaten, Masterdatei oder Google-Konfiguration verändert.
- **Zugriffsgrenzen:** Neuer Modus verlangt `MCP_ACCESS=private` und wird auf Loopback/zulässige lokale Hosts beschränkt. Es wurde kein produktives Multiuser-/OAuth-System ergänzt; das entspricht dem Scope.
- **Frontend:** Keine Credentials oder Google-Datei-Zugriffsmethoden in der Oberfläche; React rendert Namen/Notizen als Text. Keine neue eigene postMessage-Bridge festgestellt.
- **Secrets:** Musterprüfung über alle 39 Dateien des erweiterten Umfangs ohne erkannte Schlüssel-/Tokenmuster. Dies ersetzt kein vollständiges historisches Secret-Audit.
- **Historie:** Satz-/Session-Snapshots und Rohlastfelder bleiben in den Historien-DTOs erhalten. T3-05 führt allerdings zur Anzeige der falschen Einheit; T3-04 verändert die Verständlichkeit der Lastsemantik. Es wurde keine Löschung/Überschreibung echter Daten festgestellt.
- **Idempotenz/Nebenläufigkeit:** Rein lesende Requests erfordern keine Schreibidempotenz. Relevante Lese-/UI-/Cache-Races sind T3-02, T3-07 und T3-08. Vorbereitung auf spätere Writes ist wegen T3-07 noch nicht verlässlich.
- **Sicherheitsbewertung:** Keine bestätigte P0-Sicherheitslücke oder Zugriffsmöglichkeit auf fremde Nutzerdateien. Die Request-Schleife ist ein bestätigtes Ressourcen-/Performanceproblem; aus dem lokalen Fixture-Nachweis wird kein tatsächlich erfolgter Google-Quota-Ausfall behauptet.

**8. Offene Risiken**

Bestätigt sind T3-01 bis T3-09 und die beschriebenen fortbestehenden Analytics-Probleme. Der Completion Report nennt diese nicht als blockierend, obwohl zentrale Funktionen betroffen sind.

Nicht unabhängig live verifiziert wurden der Betrieb der neuen Factory mit tatsächlichen Google-Credentials, echte ChatGPT-Unterhaltungen nach erneutem Öffnen und das Lastverhalten mehrjähriger Tracker. Der erste Punkt ist bereits durch T3-01 logisch blockiert, nicht bloß durch fehlende Credentials. MCP-App-Funktion und Replays wurden mit lokalem Host beziehungsweise gezielten Bridge-Tests geprüft.

Die Aussage, die Masterdatei sei vom Entwickler nur gelesen worden, ist durch den untersuchten Code plausibel; historische externe Aktivitäten lassen sich ohne Auditlogs nicht lückenlos nachweisen. QA selbst führte keinen Google-Schreib- oder Produktivzugriff aus. Der frühere Task-001-Lockfile-Befund ist hier ausdrücklich kein offenes Risiko mehr.

**9. Korrekturauftrag an den Entwickler**

1. **P1 / T3-01:** Source- und Adapteroptionen trennen; Factory → realer Read-Adapter → synthetisch gemockter Google-Transport → Presenter → MCP als vollständigen Integrationstest absichern.
2. **P1 / T3-02:** Rückkopplung zwischen globalem Payload, `initial`-Prop und Dashboard-Hook entfernen. Genau eine Aktualisierungsaktion muss in einen stabilen Zustand zurückkehren.
3. **P1 / T3-03:** Echte Arbeitssatzanzahl aus der Analytics-Schicht verwenden, unabhängig von berechenbarem Volumen.
4. **P1 / T3-04:** Lastdefinition und Vergleichsvariante an KPIs und Kurven erhalten und sichtbar formatieren; auch bei `valid` unverzichtbare Hinweise anzeigen.
5. **P2 / T3-05/06/09:** Angeforderte Workout-ID zuverlässig öffnen, Zeitraumfilter der Übersicht umsetzen und konsequent anwenden, mobile Variantentabelle begrenzen.
6. **P2 / T3-07/08:** Cache-Invalidierung und globale Host-Revalidierung mit Generation/Sequenz absichern; verspätete alte Antworten dürfen weder Cache noch UI zurücksetzen.
7. Die offenen Task-002-Befunde in einer nachvollziehbar integrierten Basis korrigieren und erneut unabhängig prüfen lassen. Die aktuellen v2-Mitigationen nicht mit einer korrigierten Engine gleichsetzen.
8. Regressionstests übernehmen, UI-Vertrag und Completion Report mit dem korrigierten Verhalten abgleichen. Erst danach die Empfehlung für Onboarding und schreibende Tools erneuern.

Durch QA wurden ausschließlich Prüfdateien und Berichtsartefakte erstellt; keine Reparaturen auf dem Entwicklungsbranch.

**10. Finales QA-Gate**

## FAIL – keine fachliche Freigabe für Task 003

Der echte Datenquellenmodus startet nicht, die zentrale Aktualisierungsaktion erzeugt eine Request-Schleife und wichtige Trainingsangaben werden falsch gezählt beziehungsweise unzureichend gekennzeichnet. Damit sind zentrale DoD-Punkte verletzt. Die fortbestehende nicht freigegebene Analytics-Basis ist ein zusätzliches Hindernis.

**Voraussetzungen für eine erneute Prüfung:**

- Konkreter Korrektur-SHA mit nachvollziehbarer Basis, einschließlich geklärter Task-002-Korrekturen.
- T3-01 bis T3-09 korrigiert; die zehn neuen Unit-/Render-/Bridge- und fünf fehlgeschlagenen Browser-Anforderungsfälle bestehen oder sind durch gleichwertige, fachlich begründete Regressionen ersetzt.
- Ein vollständiger Source-Factory-/Adapter-Integrationstest ohne Umgehung durch `StaticArnoldDataSource`.
- Erfolgreicher frischer Installationslauf und alle fünf Standardprüfungen, einschließlich bestehender Demo-/Host-Tests.
- Erneuter Nachweis für Updates, langsame Antworten, Cache-Invalidierung, Filter, Lastbeschriftung und mobile Fortschrittsansicht.

Die externe Projektleitung entscheidet nach dem erneuten QA-Gate über weitere Entwicklungsphasen. Onboarding oder schreibende Tools sind durch diesen Bericht nicht freigegeben.
