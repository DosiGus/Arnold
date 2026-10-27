# ARNOLD STABILIZATION S001 – COMPLETION REPORT

Stand: 27.10.2026, Europe/Berlin. Repository: `DosiGus/Arnold`.

## 1. Status

**Completed – Umsetzung und Entwicklerprüfung im vereinbarten synthetischen Betriebsumfang. Die unabhängige erneute QA ist offen.** Dieser Bericht vergibt weder ein unabhängiges PASS noch eine Produktionsfreigabe. Task 006/007, Google-Plan-Writes, Deployment, Tunneländerungen und Merge nach `main` wurden nicht begonnen.

Der gemeinsame Stand enthält Datenbasis, korrigierte Analytics, Dashboard, Trainingslogger und Planverwaltung. Der dokumentierte Fixture-Start verbindet jetzt beide Services mit demselben Repository, Journal, Audit und Coordinator.

- Integrationsbranch: `codex/arnold-stabilization-s001`.
- Sicherungs-/Übernahmecommit für Task 005: `57b541617ceb5bee9e9824f1f1727a403d309553`.
- Task-003-QA-Übernahme: `83cdc88f00f014d40ed5617cd67be18dba77ef8b`, mit Herkunft `f85fb54134f4e52c5775da527f85ad23501dfa27`.
- S001-Implementierungscommit: `a03b85ed5654b7ddcd08541a26d4b7c738a1f254`.
- **QA-Ziel ist der abschließende Commit dieses Berichts auf dem Integrationsbranch.** Seine exakte SHA, Archiv-Prüfsumme und Prüfprotokolle stehen im externen `S001-HANDOVER.json` des lokalen Belegpakets. Dadurch muss der Bericht keinen unmöglichen selbstreferenziellen Commit-Hash enthalten. Nach Erzeugung dieses Belegs darf nicht still auf einen späteren Branch-HEAD geprüft werden.

Worktree: `/Users/kevingusmao/.codex/worktrees/arnold-stabilization-s001/Arnold`.
Belegpaket: `/Users/kevingusmao/.codex/visualizations/2026/10/27/01a17f23-f745-7470-8015-aa5f6f92144c/arnold-stabilization-s001`.

## 2. Tatsächlicher Ausgang und Herkunft

| Bestandteil                  | Erfasster Stand                                                                                             | Behandlung                                                                                                                                                     |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Gemeinsamer Originalcheckout | `feat/arnold-onboarding`, HEAD `8723df4157c4572a65c95624054b2f9c061990eb`, vermischte uncommittete Arbeiten | Vollständiger Nonignored-Snapshot; keine Dateien zurückgesetzt oder verschoben. Spätere Paralleländerungen verbleiben im Originalcheckout.                     |
| Task 001                     | `344d722`, QA-Übernahme `a6bd7ef` auf `fbbc1c0`; separater QA-Branch `8037cb2`                              | `src`, `tests` und Lockfile zwischen `8037cb2` und `a6bd7ef` inhaltsgleich. Kein zusätzlicher Blind-Merge; Unterschiede nur im damaligen QA-Dokument.          |
| Task 002                     | `7077ffd`, `8723df4`                                                                                        | Bereits Vorfahren von Task 004; erhalten. Metrics-Reason-Texte und numerische Regressionen bleiben bestehen.                                                   |
| Task 003                     | `d613b4e`, QA-Branch `f85fb54`                                                                              | QA-Commit gezielt mit `-x` übernommen und vier Konflikte aufgelöst.                                                                                            |
| Task 004                     | veröffentlichter Referenzstand `815c91db0c55dcfeb978166b2693f61bdb57c7fe`                                   | Ausgangspunkt des neuen Worktrees. Assets, historischer Plan-Zuordnungs-Guard, Testdateien und aktueller damaliger Report erhalten.                            |
| Task 005                     | uncommittet auf Basis `8723df4`                                                                             | Quell-/Testdateien aus gesichertem Snapshot gezielt übernommen, neuere Task-004-Fixes nicht zurückgenommen.                                                    |
| Task 006                     | im Originalcheckout bereits in Arbeit                                                                       | Nicht in S001 integriert. Aus dem gesicherten Infrastrukturstand wurden nur dessen Onboarding-Audit-Erweiterungen entfernt; Originaldateien blieben unberührt. |

Die aktuellen Remote-SHAs von Task 004, Task-003-/002-QA und `main` wurden während S001 lesend bestätigt; sie stimmen mit den obigen Referenzen überein. Siehe [REMOTE-REFS.txt](qa/s001/REMOTE-REFS.txt). Es gab keinen Push oder PR.

Die Sicherung umfasst 164 nicht ignorierte Dateien, einschließlich ungetrackter Task-005- und begonnener Task-006-Dateien, plus Git-Status, Branch-/Worktree-/Ref-Inventar und binärem Arbeitsbaum-Diff. Archiv-SHA256: `8c25c495b2274948876ab3510b1f3c275e6d891728699a3f753adfa2cbae948a`. Private Env-Dateien, Secrets, `node_modules`, Build-Ausgaben und echte Daten sind nicht Bestandteil dieser Sicherung. Ein gezielter Credential-Musterscan der nicht ignorierten Integrationsdateien lieferte keine Treffer; dies ist kein Audit der gesamten alten Git-Historie.

Der vollständige S001-Auftrag wurde im lokalen Übergabepaket gefunden; der eingefügte Text endete bereits bei Abschnitt A. Der Task-005-Originalauftrag wurde aus der ursprünglichen **Nutzernachricht** `3dc89391-bff2-42bf-9bc6-bb575962fcef` vom `2026-10-26T21:09:02.557Z` im lokalen Entwicklungsprotokoll gesichert. Herkunft und unveränderte Prüfsummen sämtlicher Originalaufträge und QA-Berichte: [INPUT-PROVENANCE.json](qa/s001/INPUT-PROVENANCE.json).

## 3. Integration und Konflikte

`arnold-source.ts` behält den stärkeren Task-004-Generation-Guard: Ein vor Invalidierung gestarteter Read darf weder den alten Cache wiederherstellen noch seinen alten Snapshot als frisch an den ursprünglichen Caller zurückgeben. Er wartet auf einen neuen Read. Source-/Adapter-Optionen bleiben getrennt.

`client.ts` verbindet die Task-003-Trennung zwischen Host-Publikation und expliziter View-Abfrage mit strukturierten Plan-/Workout-/Recovery-Fehlern. Überholte Erst-Revalidierungen und Fehlerfallbacks publizieren nichts. Dashboard-Refresh bleibt begrenzt. Navigation und Styles enthalten sowohl Task-003-Korrekturen als auch Logger und Planeditor.

Die älteren Task-005-Dateien hätten `dotfiles: allow` bei festen HTML-Assets und den Guard gegen automatische Zuordnung zu einem später aktivierten Plan verloren. Beides bleibt erhalten. `tests/http-assets.test.ts` und `tests/workout-restart.test.ts` stammen aus der veröffentlichten Task-004-Basis und laufen wieder mit.

## 4. Befundmatrix

Alle folgenden Statusangaben sind **Entwickler-Verifikationen am gemeinsamen Stand**, keine unabhängige Wiederabnahme.

| ID / Priorität | Ursprung / betroffener Stand | Maßnahme                                                                             | Verhalten und dauerhafter Testnachweis                                                                                                    | Status / Restgrenze                                |
| -------------- | ---------------------------- | ------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| T3-01 P1       | Task 003 `d613b4e`           | Source-/Adapter-Optionen getrennt, Task-004-Fix erhalten                             | `arnold-pipeline-integration`, `qa-task003*`: dokumentierte Factory und echter synthetischer Transport starten                            | PASS; kein Google-Live-Test                        |
| T3-02 P1       | Task 003                     | Host-Publikation von View-Calls getrennt                                             | `arnold-v2-qa`, `qa-task003.spec`: begrenzte Requests und ruhender Zustand nach Refresh                                                   | PASS                                               |
| T3-03 P1       | Task 003/004                 | Arbeitssatzanzahl aus zentraler Engine-Eligibility, unabhängig von Volumen           | `arnold-qa-regressions`, `qa-task003*`: Körpergewicht 1, gemischte Sätze 2, nachvollziehbarer Hinweis                                     | PASS                                               |
| T3-04 P1       | Task 003/004                 | Lastbasis an KPI/Kurve, Hinweise auch bei `valid`, eindeutige Variantenkennzeichnung | Render-/Browser-Regressionen für pro Hantel, Maschinenbezug und Varianten                                                                 | PASS                                               |
| T3-05 P2       | Task 003                     | Exakte Detail-ID, kein stiller Fallback                                              | `arnold-v2-qa`, `qa-task003.spec`: abgebrochene Einheit wird korrekt geöffnet                                                             | PASS                                               |
| T3-06 P2       | Task 003/004                 | Zeitraumwahl und konsistente Auswahl der Listen                                      | Render-/Browsertests, Zukunftsfilter liefert keine früheren „letzten Workouts“                                                            | PASS                                               |
| T3-07 P2       | Task 003                     | Task-004-Cache-Guard erhalten                                                        | `workout-cache`, `arnold-pipeline-integration`, unabhängige Gegenprobe                                                                    | PASS                                               |
| T3-08 P2       | Task 003/004                 | Generation statt bloßer Zeitstempelprüfung im globalen Host-Pfad                     | `arnold-bridge-staleness`, `qa-task003*bridge`: späte Antwort **und Fehlerfallback** verdrängen neue Daten nicht                          | PASS                                               |
| T3-09 P2       | Task 003                     | Interner Tabellen-Scroll                                                             | `arnold-v2-qa`: 390 × 844 px mit Links-/Rechts-Varianten ohne Seitenausdehnung                                                            | PASS                                               |
| F01 P1         | Task 004 `815c91d`           | Workout-Editziel binden, bei Wechsel zurücksetzen, Submit-/Write-Gates               | `e2e/s001-integration`: A bleibt inklusive Revision unverändert, nur B wird geändert; verspäteter A-Read wird verworfen                   | PASS                                               |
| F02 P1         | Task 004                     | Gemeinsamer Commit-Runner, explizite Recovery, bewiesene Ablehnung, atomarer Abbruch | `s001-write-recovery`, echte UI-Retries für Auth/Permission/Validierung, Reload, View-Wechsel und opaker Host                             | PASS; verteilte Recovery weiterhin außerhalb Scope |
| F03 P2         | Task 004                     | Zentrale Limits und physische Batch-Vorprüfung                                       | `s001-boundaries`, Q4-04: WORKOUTS/SETS/EXERCISES innerhalb, auf und über 10.000 Zeilen, Lücken, Mehrfachbatch, null Writes bei Ablehnung | PASS                                               |
| F04 P2         | Task 004                     | Ende gegen lokalen Tag und bekannten Start prüfen                                    | Q4-02, `s001-boundaries`: UTC-Offsets, Sommerzeit, Mitternacht, Historie, `null`; ungültig vor Mutation                                   | PASS                                               |
| F05 P1         | Task 004                     | Tatsächliche Task-003-QA-Integration                                                 | Übernommene Unit-/Render-/Bridge-/Browsertests laufen gemeinsam mit Tasks 004/005                                                         | PASS                                               |

Zusätzlich bei S001 gefunden und geschlossen:

- `archive_plan_draft` konnte einen aktiven Plan verwerfen; der alte Test akzeptierte sowohl Erfolg als auch Ablehnung. Service und Test verlangen jetzt explizit die Ablehnung.
- Derselbe Serverzeitpunkt für zwei Aktivierungen konnte eine tatsächlich aktive Version als Discard-Sentinel erscheinen lassen. Die zweite Aktivierung wird vor Mutation abgelehnt, bis die Serveruhr fortgeschritten ist. Keine erfundenen Uhrzeiten.
- Plan-Settings wurden bei Ablehnung geschlossen und verloren die sichtbaren Eingaben. Sie bleiben erhalten; Recovery ist im Dialog auch per Tastatur erreichbar.
- Lokale leere Einheiten konnten das Plan-Ziel wechseln. Sie gehören jetzt zur konkreten Version und werden beim Zurückwechseln wieder angezeigt.
- Ein bestätigter Plan-Write mit danach fehlgeschlagenem View-Read wurde als unklar gemeldet. Er bleibt bestätigt; die veraltete Ansicht wird ausdrücklich benannt.
- Ein nur lokaler Abbruch konnte mit paralleler Wiederaufnahme konkurrieren. `abandon_rejected_write` bestätigt den Journalabbruch unter demselben Coordinator; ein inzwischen wieder dispatchter Auftrag kann nicht verworfen werden.
- Der normale Fixture-Start verdrahtete bislang nur den Logger. Er verwendet jetzt die gemeinsame Plan-/Workout-Runtime; `s001-runtime` belegt die Integration über echtes MCP.

## 5. Task-005-Anforderungsprüfung gegen den Originalauftrag

| Originalumfang                                                                 | Ergebnis                                 | Nachweis / Grenze                                                                                                                                                                                                           |
| ------------------------------------------------------------------------------ | ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Domain-Projektion, beliebige Splits, ein/fünf Einheiten                        | PASS                                     | `plan-creation`, `plan-ui-render`; freie Namen/IDs, dokumentierte Ressourcenlimits                                                                                                                                          |
| Planfamilien, neue Versions-/Item-IDs, Session-Strategie                       | PASS                                     | `plan-versioning`, `plan-sessions`, Quellzeilen bleiben unverändert                                                                                                                                                         |
| Aktive/archivierte Inhalte schützen                                            | PASS                                     | Service- und Repository-Gegenproben; archivierte Versionen können auch nicht in den Draft-Lebenszyklus zurückgesetzt werden                                                                                                 |
| Sessions hinzufügen, umbenennen, ordnen, duplizieren, entfernen                | PASS                                     | `plan-sessions`; Umbenennung als ein validierter Batch einschließlich Tombstones                                                                                                                                            |
| Übungen hinzufügen, ersetzen, entfernen, ordnen, Ziele/Ausführung ändern       | PASS                                     | `plan-exercises`; neue Positions-ID bei anderer Bewegung, keine Umdeutung alter Lasten                                                                                                                                      |
| Draft-Revisionen und parallele Erstellung                                      | PASS                                     | `plan-versioning`, `plan-security`, `s001-write-recovery`; gemeinsame Queue verhindert Nummerndubletten und verlorene Updates                                                                                               |
| Strukturierte Validierung vor Aktivierung                                      | PASS                                     | `plan-activation`, `plan-security`; Fehler/Warnungen/Empfehlungen getrennt                                                                                                                                                  |
| Konkrete Version **und Revision** ausdrücklich bestätigen                      | PASS                                     | Service, echtes MCP und Browser; veraltete Bestätigung aktiviert nichts                                                                                                                                                     |
| Maximal eine aktive Version, Archivierung im selben Batch                      | PASS                                     | parallele Aktivierungen und Planaktivierung gleichzeitig mit Workout-Start                                                                                                                                                  |
| Historie, Vergleich, Wiederherstellung als neuer Draft                         | PASS                                     | `plan-history`, `s001-boundaries`; ursprüngliche Version bleibt erhalten                                                                                                                                                    |
| Workout-Integration und Lastvarianten                                          | PASS                                     | `s001-plan-lifecycle`: erstellen → validieren → bestätigen → aktivieren → starten → loggen → abschließen → neue Version; freie Einheit, pro Hantel, beide Seiten, Körpergewicht, Unterstützung, alternierend                |
| Historische und laufende Trainings unverändert                                 | PASS                                     | Kanonische Byte-/Wertvergleiche der WORKOUTS-/SETS-Zeilen und stabile Referenzen                                                                                                                                            |
| MCP-Schemas, Annotationen, Fehler, Idempotenz                                  | PASS                                     | `plan-mcp`, `workout-mcp`, `s001-runtime`; Result-Schema beim Journal-Replay geprüft                                                                                                                                        |
| Wiederverwendung von Auth/Journal/Audit/Coordinator                            | PASS                                     | Ein gemeinsamer Commit-Runner und gemeinsame Instanzen; Request-ID-Konflikte auch domänenübergreifend                                                                                                                       |
| Editor, Eingaben, Konflikte, Doppelklick, Reload                               | PASS                                     | bestehende Plan-/Logger-Browserflows und 14 S001-Browserregressionen                                                                                                                                                        |
| Tastatur, Fokus, mobil, Hell/Dunkel, Accessibility                             | PASS im getesteten Umfang                | Chromium, automatisierte WCAG-A/AA-Prüfungen und Tastatur-Recovery; keine vollständige manuelle Zertifizierung                                                                                                              |
| Für späteres Onboarding wiederverwendbarer Editor und strukturierte Vorschläge | PASS für Schnittstellen                  | `embedded`, `origin`, vollständige Vorschläge; keine automatische Aktivierung. Tatsächliches Task-006-Onboarding nicht geprüft/in Scope.                                                                                    |
| Leere Einheit dauerhaft speichern                                              | PARTIAL, ausdrücklich erlaubte v1-Grenze | Nur lokal, als ungespeichert gekennzeichnet; Aktivierung blockiert. Separate SESSIONS-Migration vorgeschlagen.                                                                                                              |
| PLAN_ITEMS-Zeitstempel                                                         | PARTIAL, Schema-Grenze                   | Parent-Revision/-Zeit und Audit vorhanden; eigene Item-Zeitstempel benötigen Migration.                                                                                                                                     |
| Verworfener Draft                                                              | PASS für neue S001-Writes                | Keine Aktivierungsfenster/Planerfüllung/automatische oder explizite Workout-Zuordnung; Anzeige „Nie aktiviert“, Wiederherstellung nur als neuer Draft.                                                                      |
| Verlustfreie Interpretation beliebiger alter Null-Zeitfenster ohne Audit       | PARTIAL                                  | Schema v1 kann den Sentinel nicht von einem tatsächlich null Millisekunden aktiven importierten Altplan unterscheiden. Neue Writes verhindern den Fall. Expliziter Discard-Status/Lifecycle-Metadaten separat erforderlich. |
| Sicherheit, Master-/Tracker-/Mode-Grenzen                                      | PASS                                     | bestehende Security-Suiten; Produktion und Google-Plan-Writes gesperrt                                                                                                                                                      |
| Echte Google-Datei / produktive Nutzer / verteilte Instanzen                   | NOT VERIFIED, außerhalb S001             | Kein solcher Write oder Freigabeversuch; keine Produktionsgarantie                                                                                                                                                          |

## 6. Gemeinsamer Commit-, Recovery- und UI-Vertrag

`workout/commit.ts` wird von beiden Services verwendet; `plan/commit.ts` exportiert ihn nur weiter. Resultate werden vor Journalvorbereitung und bei Replay domänenspezifisch geprüft. Request-ID, Operations-/Payload-Fingerprint und Akteur bleiben über beide Domänen gebunden.

Journalfolge: `prepared → dispatching → committed`; bewiesene Ablehnung führt zu `rejected`. Ein anderer Auftrag darf danach weitergehen. Derselbe Auftrag kann nach Behebung der Ursache sicher neu validiert werden. `abandon_rejected_write` setzt ausschließlich eine aktuell bewiesene Ablehnung endgültig auf `abandoned`; die ID wird danach nicht wiederverwendet. Unklare Dispatches bleiben in Quarantäne. Andere Akteure dürfen weder fremde Intents ausführen noch abbrechen.

`error.recovery` entscheidet unabhängig vom Fehlercode über `none`, `retry_same_request` oder `retry_or_new_request`. UI und Journal behalten den Originalrequest, solange Recovery nötig ist. Eine neue Host-Sitzung ohne Browser-Speicher besitzt diese lokalen Requestdaten nicht automatisch; das Serverjournal verhindert trotzdem eine Ersatzmutation. Ein solcher vollständiger Verlust benötigt den dokumentierten manuellen Recovery-Prozess.

Das Datei-Journal behält das JSON-Array-Format. Bestehende Workout-/Plan-Einträge werden kontrolliert gelesen. S001 erweitert die erlaubten Zustände; alte Server dürfen auf neue Journale nicht zurückgerollt werden. Kein Journal wird kommentarlos verworfen. Prozesslokale Sperre und lokales Journal sind keine verteilte Exactly-once-Garantie.

## 7. Testergebnisse und Reproduzierbarkeit

Prüfumgebung: macOS/ARM, Node `v26.7.0`, npm `11.19.0`, Chromium aus dem vorhandenen passenden Playwright-Browsercache. Alle fachlichen Daten sind synthetisch.

| Prüfung                           | Ergebnis                                                                             |
| --------------------------------- | ------------------------------------------------------------------------------------ |
| Frische Installation aus Lockfile | PASS mit `npm ci --ignore-scripts --audit=false --fund=false` im isolierten Checkout |
| `npm run typecheck`               | PASS                                                                                 |
| `npm run build`                   | PASS; UI, Host und Server aus dem geprüften Quellcode                                |
| `npm test`                        | **784/784**, 51 Dateien, keine übersprungenen Tests                                  |
| `npm run test:e2e`                | **61/61** Chromium-Browsertests                                                      |
| `npm run format:check`            | PASS                                                                                 |
| `git diff --check`                | PASS                                                                                 |

Aufteilung der 784 Unit-/MCP-Fälle: **678 integrierter Bestand** einschließlich wiederhergestellter Asset-/Neustarttests und Task-003-QA-Fixes, **38 übernommene unabhängige Gegenproben**, **68 neue S001-Fälle** einschließlich zweier zusätzlicher Host-Reihenfolgen. Browser: **41 integrierter Bestand**, **6 übernommene QA-Tests**, **14 neue S001-Fälle**. Die Gegenproben sind bereits Teil der Gesamtsuite und werden nicht nochmals addiert.

Der frische Abschlusslauf und alle Exitcodes werden unverändert im Belegpaket unter `verification/` gesichert; `S001-HANDOVER.json` bindet sie an die finale Commit-SHA und das Quellarchiv. Die Testanleitung steht in [TESTING.md](TESTING.md). Die Testports 8890–8900 wurden von den parallel belegten Ports des Originalcheckouts getrennt; keine fremden Prozesse wurden beendet.

Zwischenläufe wurden nicht als Abnahme ausgegeben: zunächst fehlten Builds für die Assettests; nach Integration mussten stärkere Cache-/Bridge-Assertions angepasst werden; Browserläufe fanden die Formular-Race. Ein nach späterem Test-Compilefehler versehentlich gegen alte Build-Dateien gestarteter Zwischenlauf wurde verworfen. Erst vollständig gebaute und abschließend frisch installierte Quellen gelten für obige Zahlen. Eine explizite Prettier-Formatierung der `.prettierignore` meldete „kein Parser“; der anschließende reguläre Formatcheck besteht.

Die visuelle Schlussprüfung fand zusätzlich eine durch die bisherigen grünen Tests nicht abgedeckte Restlücke von T3-04: Die Seite der dargestellten dominanten Ausführung fehlte direkt an Kurve und KPI. Beide zeigen jetzt die Vergleichsklasse aus den vorhandenen Engine-Metadaten (Ausführung, Seite, Mehrgerätezahl, Lastbasis). Volumen-/Wiederholungskurven und Gesamtzähler sind ausdrücklich mit „Alle Ausführungsarten“ gekennzeichnet. Es gibt keine manuelle Variantenwahl; die automatische dominante Variante bleibt unverändert. Die bestehende Browser-Gegenprobe prüft zusätzlich Links an Last-/1RM-KPI und Kurve sowie den korrekten Wechsel zur variantenübergreifenden Volumenkurve. Ein erster frischer Browserlauf fand die veränderte zugängliche Diagrammbezeichnung als Regression; der bestehende Name bleibt jetzt erhalten und der Kontext wird separat ergänzt. Danach wurde der gesamte frische Abschlusslauf auf dem neuen finalen Commit wiederholt.

## 8. Übernahme der QA-Gegenproben

- Die Originalquellen sind unter `qa/s001/inputs` beziehungsweise den dokumentierten Herkunftspfaden gesichert. Testimporte und Ports wurden an den gemeinsamen Stand angepasst.
- Alte Task-002-Gegenproben prüfen nun die ausdrücklich korrigierten `completed_workouts`/`completed_training_days`. Der Auswahlzähler `workouts` darf einen angeforderten Statusfilter erweitern; das ist keine Abschlussbehauptung.
- T3-08 erwartet jetzt genau **eine** Publikation: eine überholte Revalidierung wird vollständig verworfen. Die finale Aktualitätsassertion bleibt erhalten und wird durch den Fehlerfallback-Fall ergänzt.
- T3-07 erlaubt, dass bereits der ursprüngliche Caller auf den neuen Read wartet. Zwei vollständige Transport-Reads werden nachgewiesen; der nächste Load darf den bereits frischen Cache verwenden.
- Q4-01/Q4-03 verwenden für ihren ausdrücklich definitiven Reject den neuen Repository-Nachweistyp `RejectedWriteError`. Ein normaler vertrauter Fehlercode wird zusätzlich als **unzureichender** Nachweis getestet.
- Die ursprüngliche Q4-05-Datei führte absichtlich die falsche Mutation aus. Ihre neue dauerhafte Regression verlangt das korrigierte Verhalten: A unverändert, neues Edit nur an B, keine stille Auswahländerung. Die ursprüngliche Gegenprobe bleibt bytegenau erhalten.

## 9. Schutz historischer Daten

Der End-to-End-Lifecycle vergleicht WORKOUTS und SETS nach Planwechsel mit dem vorherigen Bestand. Geloggte Werte `[70, 20, 30, 32, null, 15, 12]` bleiben unverändert; keine Verdoppelung pro Hantel, keine erfundene Körpermasse. Alte Plan-/Session-/Item-IDs bleiben gültig. Planänderungen greifen nicht in tatsächliche Satzwerte ein. Zwei-Prozess-Tests belegen den Neustart nach bereits gespeichertem Plan-/Workout-Batch vor Ledger-Bestätigung mit dauerhaft dedupliziertem synthetischem Audit.

## 10. Dokumentation, Grenzen und Dateien

Write-, Plan-, UI- und Metrics-Vertrag sowie README/Testanleitung beschreiben den aktuellen Stand. Metrics-Version ist **1.2.0** für die korrigierte Planerfüllung bei Entwürfen/Discard-Sentinels; Rohschema bleibt **1.0.0**. Der frühere lokale Task-004-Blocked-Bericht und die veröffentlichten Task-004-/ursprünglichen Task-005-Berichte sind unter `docs/history` historisch erhalten. Aktuelle Task-004-/005-Berichte verweisen ausdrücklich auf diese Integration.

Neue zentrale Dateien: `workout/commit.ts`, `shared/write-recovery.ts`, `shared/sheets-limits.ts`, die S001-Service-/Grenz-/Lifecycle-/Neustart-/Runtime-/Browserregressionen und die dauerhaften QA-Gegenproben. Die vollständige Dateiänderungsliste gegenüber `815c91d` steht in [CHANGED-FILES.txt](qa/s001/CHANGED-FILES.txt).

Offen bleiben: verteiltes Ledger/Lock/Audit, echte Nutzeridentität/OAuth, produktive Tracker-Provisionierung, externer Drift über Neustarts, vollständiger Journalverlust, Browser-/Gerätebreite über Chromium hinaus sowie die ausdrücklich dokumentierten Schema-Migrationen. Master-/Alt-/Nutzerdateien wurden in S001 weder ausgelesen noch beschrieben. Keine Drive-Anleitung, produktive Verbindung, Tunnel- oder Deployment-Konfiguration wurde geändert.

## 11. Anweisung zur unabhängigen erneuten QA

1. Exakte finale SHA aus `S001-HANDOVER.json` auflösen und Quellarchiv-Prüfsumme prüfen; nicht einen beweglichen Branch-HEAD annehmen.
2. Originalaufträge 001–005, vollständiges S001-Briefing, Verträge, Provenienz und beide unabhängigen QA-Berichte lesen.
3. Sauberen Checkout mit eigener frischer Installation erstellen und sämtliche Befehle aus `TESTING.md` ausführen. Erwartet: 784 Unit-/MCP- und 61 Browserfälle ohne Skips.
4. F01–F05/T3-01–09 sowie die zusätzliche Abbruch-/Retry-Race, gleiche Aktivierungszeitpunkte, Plan-A/B-Auswahl, Fehlerfallback und Zwei-Prozess-Recovery eigenständig nachprüfen. Assertions nicht aus der grünen Gesamtzahl ableiten.
5. Das separate Gate **PASS / PASS WITH CONDITIONS / FAIL / BLOCKED** vergeben. Produktive Freigabe und Task 006/007 bleiben separate Entscheidungen.

S001 endet mit dieser Übergabe. Keine Folgephase und keine weitere Automation wurde gestartet.
