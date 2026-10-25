# ARNOLD TASK 001 – QA FIX COMPLETION REPORT

## Umfang und Arbeitsstand

Es wurden ausschließlich die drei bestätigten P2-Befunde F1, F2 und F3 korrigiert. Ausgangsbasis war der saubere, bereits vorhandene Analytics-Stand `ddb0bf3` auf `feat/arnold-analytics-engine`. Darauf wurde `fix/task-001-qa` angelegt. Vorhandene Analytics-Quellen und Tests sowie Demo-Funktionen bleiben erhalten. Der während der Arbeit auf demselben QA-Branch hinzugekommene Commit `fbbc1c0` mit den Domain-/Parserkorrekturen wurde beibehalten; die restlichen Korrekturen folgen in einem weiteren Commit.

Keine echten Google-Sheets-Daten oder Master-Dateien wurden gelesen oder verändert. Keine Credentials, Tunnel, Deployments oder produktiven ChatGPT-Verbindungen wurden verändert.

Der Hauptordner wurde während der parallelen Entwicklung später auf `feat/arnold-dashboard-v2` umgeschaltet. Der QA-Abschluss wird deshalb in einer separaten Git-Arbeitskopie auf `fix/task-001-qa` gesichert. Fremder Branch, Index und Entwicklerdateien im Hauptordner werden dabei nicht zurückgesetzt oder überschrieben.

## F1 – Planstatus und Lebenszyklus

Zod erzwingt die gültigen Zustände:

- `draft`: Aktivierung und Archivierungszeitpunkt sind `null`.
- `active`: gültige UTC-Aktivierung erforderlich, Archivierungszeitpunkt ist `null`.
- `archived`: gültige UTC-Aktivierung und gültiger Archivierungszeitpunkt erforderlich; Ende liegt nicht vor Aktivierung. Ein identischer Zeitpunkt ist zulässig.

Die bestehenden Status-, UTC- und Referenzprüfungen bleiben erhalten. Regressionstests prüfen gültige Zustände, fehlende Zeitpunkte, aktive bereits beendete Pläne, widersprüchliche Drafts, unvollständig archivierte Pläne, ungültige Zeitstempel und die physische Fehlerposition im Sheet.

## F2 – Literaltext und echte Formeln

Der Adapter liest statt untypisierter Values die ursprünglichen `userEnteredValue`-Zelltypen über begrenzte, reine `spreadsheets.get`-GET-Abfragen. Die Feldmaske fordert weder berechnete noch formatierte Werte an. Es bleiben insgesamt sieben GETs je vollständigem Read: Metadaten plus sechs Bereiche.

`stringValue` bleibt Literaltext, auch bei führendem `=`. `formulaValue` bleibt eine echte Formel und wird unabhängig von einem scheinbar harmlosen oder leeren Rechenergebnis abgewiesen. Der Grid-Decoder liefert echte Formeln als explizite `{formulaValue: string}`-Markierung an den Parser. Mehrdeutige Zelltypen, unerwartete Antwortidentitäten und Bereichsüberschreitungen werden abgelehnt. Es gibt keine zweite zeitlich versetzte Formelabfrage und keinen untypisierten Fallback.

Positive Tests decken Literaltext in allen sechs Tabellen ab. Negative Tests prüfen echte Formeln in Freitext- und Zahlenfeldern, leere Formelergebnisse, irreführende berechnete Werte, mehrdeutige/ungültige Zelltypen und fehlerhafte Grid-Antworten. Der Standard-Google-Transport bleibt mit `spreadsheets.readonly` und ausschließlich GET geprüft.

Quellen: [CellData](https://developers.google.com/workspace/sheets/api/reference/rest/v4/spreadsheets/cells#CellData), [ExtendedValue](https://developers.google.com/workspace/sheets/api/reference/rest/v4/spreadsheets/other#ExtendedValue), [spreadsheets.get](https://developers.google.com/workspace/sheets/api/reference/rest/v4/spreadsheets/get).

## F3 – Konsistente Dependency-Auflösung

Die npm-Metadaten für die bereits deklarierten Versionen `vite@8.3.5` und `vitest@5.0.5` verlangen `tinyglobby ^0.2.17`. Das bisherige Lockfile enthielt die nicht gültige Version/Referenz `0.3.07` bzw. `^0.3.07`.

Das vollständige Lockfile wurde von npm aus der **unveränderten package.json** in einem leeren temporären Arbeitsverzeichnis neu erzeugt. Keine Version, URL, Integrität oder Dependency-Referenz wurde einzeln von Hand geändert. Die neue Datei wurde anschließend unverändert übernommen; ihre SHA-256 stimmt mit dem Resolver-Artefakt überein. Der erste verworfene Versuch mit `--prefix` enthielt unportable temporäre Paketpfade. Der übernommene zweite Versuch lief direkt im kanonischen temporären Arbeitsverzeichnis und enthält ausschließlich reguläre `node_modules/`-Pfade.

Reproduktionsverfahren:

```bash
ARNOLD_QA_RESOLVE_DIR=$(mktemp -d)
cp package.json "$ARNOLD_QA_RESOLVE_DIR/package.json"
(
  cd "$ARNOLD_QA_RESOLVE_DIR"
  npm install --package-lock-only --ignore-scripts --registry=https://registry.npmjs.org
)
cp "$ARNOLD_QA_RESOLVE_DIR/package-lock.json" package-lock.json
npm ci --registry=https://registry.npmjs.org
npm ls --all
```

Ergebnis: `tinyglobby@0.2.17` mit passenden Vite-/Vitest-Dependency-Referenzen, frisches `npm ci` erfolgreich und `npm ls --all` ohne Dependency-Probleme. Bei der regulären Neuauflösung wurde zusätzlich die bereits transitive Abhängigkeit `hono` innerhalb ihres bestehenden Bereichs von `4.13.13` auf `4.13.14` aufgelöst. Direkte Dependencies und `package.json` sind unverändert.

## Geänderte Dateien

- `src/shared/arnold-schema-v1.ts`: Lebenszyklusprüfung.
- `src/server/arnold-sheet-parser.ts`: explizite Formelmarkierung statt String-Heuristik.
- `src/server/arnold-grid-parser.ts`: neuer typisierter Grid-Decoder für F2.
- `src/server/arnold-sheets-read-adapter.ts`: begrenzte Zelltyp-Abfragen.
- `package-lock.json`: vollständig von npm neu erzeugte Auflösung.
- `tests/arnold-plan-lifecycle.test.ts`, `tests/arnold-literal-text.test.ts`, `tests/arnold-grid.test.ts`: neue QA-Regressionen.
- `tests/arnold-domain.test.ts`, `tests/arnold-adapter.test.ts`, `tests/arnold-google-transport.test.ts`, `tests/fixtures/arnold-v1.ts`: an Zelltyp-Provenienz angepasste Fixtures/Tests; ursprüngliche Prüfziele erhalten.
- `docs/ARNOLD-DATA-CONTRACT.md`, diese Datei: korrigierter Vertrag und prüfbare Nachweise.

## Prüfungen

Ausgangsbasis erneut geprüft: Typecheck, Build, **236 Unit-/MCP-/Analytics-Tests**, **9 Playwright-Tests** und Formatprüfung bestanden. Die gezielten F1/F2-Regressionen reproduzierten vor der Korrektur **17 Fehler bei 24 Fällen**; die übrigen sieben Fälle bestanden bereits.

Nach frischem `npm ci`: Typecheck und **290 Unit-/MCP-/Analytics-Tests** bestanden. Die 54 zusätzlichen QA-Testfälle behandeln F1/F2 und die zugehörigen typisierten Antwortgrenzen. Auch Build, alle **9 Playwright-Tests** und Formatprüfung bestanden anschließend. Damit sind **299 automatisierte Tests** erfolgreich. `npm ls --all` meldet keine Dependency-Probleme. Prüfwerkzeuge: Node 26.7.0, npm 11.19.0. Ein Backend-Live-Test mit Google-Zugangsdaten war für diese rein lokalen Korrekturen nicht erforderlich und wurde nicht durchgeführt.
