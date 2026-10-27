# S001 reproduzierbar prüfen

Der aktuelle Prüfstand verbindet Tasks 001–005. Frühere Testzahlen und externe Abnahmen gelten ausschließlich für ihre damaligen Commits. Der historische Demo-Testbericht liegt unter [history/PUBLISHED-815c91d-TESTING.md](history/PUBLISHED-815c91d-TESTING.md).

## Frischer Checkout

Den im S001-Übergabebeleg genannten Commit in ein leeres Verzeichnis auschecken oder dessen `git archive` entpacken. Keine `.env`, Zugangsdaten, echten Trainingsdaten, Build-Dateien oder vorhandenen Dependencies übernehmen.

```bash
npm ci --ignore-scripts --audit=false --fund=false
npm run typecheck
npm run build
npm test
npm run test:e2e
npm run format:check
git diff --check
```

`--ignore-scripts` deaktiviert Installationsskripte. Die Dependencies werden unverändert aus dem Lockfile installiert; Build und Prüfungen werden anschließend ausdrücklich gestartet. Der unveränderte Lockfile-Hash steht im S001-Prüfbeleg. Eine frische Abfrage von Sicherheitsdatenbanken wird damit nicht behauptet. Die Prüfumgebung hatte bereits den zu Playwright passenden Chromium-Browser installiert. Fehlt er, ist `npx playwright install chromium` ein gesonderter Umgebungsschritt.

Lokale TCP-Listener, Browser- und Node-Kindprozesse müssen erlaubt sein. Ein Sandbox-`EPERM` ist ein Umgebungsfehler und kein bestandener Test. Für S001 wurden die Tests mit erlaubten lokalen Listenern ausgeführt.

## Testumgebung

Playwright startet eigene synthetische Server auf **8890–8900**, getrennt von parallel laufenden Entwicklungsprüfungen auf 8790–8800. Die Ports sind Bestandteil der Testkonfiguration, keine Deployment-/Tunneländerung. Wiederverwendung bereits laufender Server ist abgeschaltet.

- 8890: alte Demo, einschließlich Reset und Persistenz.
- 8891: altes Sheets-Modell mit synthetischem Transport.
- 8892–8894: Arnold-Dashboard mit Historie, leerem Tracker und Lesefehler.
- 8895: Workout-Logger.
- 8896–8899: Planeditor, Ersteinrichtung und isolierte Aktivierungs-/Konfliktfälle.
- 8900: ausschließlich synthetische S001-Fehlerinjektion. Die `/__qa/*`-Steuerung existiert nur im Testserver unter `tests/fixtures/s001-server.ts`, nicht in der Produkt-App.

`test-results/e2e-demo.json` und alle anderen erzeugten Daten sind Testartefakte. Die App-Ressourcen müssen vorher aus diesem Checkout gebaut werden. Die Assettests prüfen auch feste HTML-Dateien in einem versteckten Worktree-Pfad. Neustarttests starten tatsächlich zwei getrennte Node-Prozesse und persistieren ausschließlich synthetische Rohdaten, Journal und Audit.

## Prüfgruppen

| Gruppe                              | Nachweis                                                                                                                                                |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Bereits integrierter Bestand        | Tasks 001/002, Task-003-QA-Fixes, veröffentlichte Task-004-Tests, gesicherte Task-005-Tests; einschließlich wiederhergestellter Asset-/Neustarttests    |
| Übernommene unabhängige Gegenproben | `qa-task003*.test.*`, `qa-task004.test.ts`, `e2e/qa-task003*.spec.ts`                                                                                   |
| Neue S001-Regressionen              | `s001-write-recovery`, `s001-boundaries`, `s001-plan-lifecycle`, `s001-restart`, `s001-runtime`, zusätzliche Host-Race-Fälle und `e2e/s001-integration` |

Die Originalbelege und ihre Prüfsummen liegen unter [qa/s001](qa/s001/INPUT-PROVENANCE.json). API-/Portanpassungen und fachlich strengere Assertions sind im [Abschlussbericht](ARNOLD-STABILIZATION-S001-COMPLETION-REPORT.md) dokumentiert. Die Standardsuite führt die übernommenen Gegenproben mit aus; ihre Ergebnisse dürfen nicht ein zweites Mal zur Gesamtzahl addiert werden.

## Grenzen

Die Suite prüft synthetische Daten, den echten lokalen MCP-HTTP-Transport, Chromium und den offiziellen MCP-App-Testhost. Sie beweist keine produktive Nutzeridentität, kein verteiltes Exactly-once-System und keinen tatsächlichen Google-Write. Safari, Firefox, echte Mobilgeräte und eine neue reale ChatGPT-Verbindung wurden in S001 nicht geprüft. Produktive Writes und Google-Writes auf PLANS/PLAN_ITEMS bleiben gesperrt.

Der separate unabhängige QA-Gate steht aus. Test- und Build-Ergebnisse des benannten Übergabecommits stehen im S001-Abschlussbericht und im lokalen Belegpaket.
