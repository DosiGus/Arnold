# Lokaler Testbericht

Stand: **29. Oktober 2026**, macOS/ARM, Node **26.7.0**. Dieser Bericht trennt lokale technische Abnahme und reale Anbieter-/Host-Abnahme.

## Aktueller Prüfstand

Die vollständige Unit-/Integrationssuite besteht mit **1.173 Tests in 53 Dateien**. Sie umfasst den bisherigen Demo-/Fixture-Stand sowie den neuen verbundenen Ablauf. Die gemeinsame Abnahme mit `npm run check` bestätigt außerdem den Build einschließlich Typecheck und **53/53 Chromium-Browser-Tests**. `npm run format:check` und `git diff --check` sind erfolgreich. Einzelheiten und Grenzen: [Connected-Bericht](ARNOLD-CONNECTED-E2E.md).

| Bereich                       | Nachweis                                                                                                                                                                                   |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Datenmodell und Sheets-Parser | Sechs Rohdatentabellen, stabile IDs, Schema-/Dateiidentität, Lastdefinitionen, Formelprovenienz, Grenzen und beschädigte Daten                                                             |
| Analytics und v2-Dashboard    | Deterministische Berechnungen; Presenter übernimmt Kennzahlen aus der Engine; MCP liefert sie an die echte Oberfläche                                                                      |
| Workout-/Plan-Schreiben       | Validierung, Revisionen, vollständige atomare Batches, Readback, Audit, persistente Operations-IDs, keine Duplikate bei Retries                                                            |
| Onboarding                    | Profil, Planvorschlag, gemeinsamer Planeditor, ausdrückliche Bestätigung genau einer Revision, ungültige/stale Bestätigungen                                                               |
| Authentifizierung             | JWT-/JWKS-Prüfung, Issuer/Audience, Scopes pro Tool, fremde Nutzer-/Tracker-Zuordnungen, Kontosperren und AsyncLocalStorage bei interleavten Nutzern                                       |
| Connected-Ablauf              | 22 HTTP-/MCP-Integrationstests: Google-Freigabe, eigene Datei, Planaktivierung, erster Satz, Serverneustart, zwei parallele Nutzer, Reconnect, widerrufene Tokens und verlorene Antworten  |
| Speicherfehler                | Fehlgeschlagene Dateiumbenennung verändert keine bestätigte Cache-Identität/-Verbindung; beschädigte oder verschwundene Zustandsdateien führen nicht zu einem stillen leeren Kontospeicher |
| Browser                       | Bestehende Dashboard-/Logger-/Plan-/Onboarding-Tests plus neuer Durchlauf bis zur Google-Datei und Satz-Wiederaufnahme; Chromium                                                           |

## Was der neue End-to-End-Test beweist

`tests/connected-journey.test.ts` startet den normalen HTTP-Server, den offiziellen MCP-Client und einen lokalen Issuer mit echten signierten Test-JWTs und JWKS-HTTP-Abruf. Alle Produktdienste werden gemeinsam verwendet. Nur die externen OIDC-/Google-Anbieter und die Trainingsdaten sind synthetisch.

Der Test verbindet ein geprüftes Konto mit einer eigenen Google-Datei der Simulation, übernimmt den ausdrücklich bestätigten Plan, speichert Sätze, liest sie über das Dashboard und öffnet nach einem vollständigen Server-/Runtime-Neustart dieselben Daten wieder. Derselbe Satz wird mit derselben Operations-ID erneut angefragt und bleibt einmal gespeichert. Ein bekannter Beispielsatz mit 60 kg × 10 Wiederholungen liefert nach Workout-Abschluss 600 kg nominales Volumen im Dashboard.

Zusätzlich werden verweigerte Scopes, fremde Claims einschließlich bekanntem Session-Secret, fremde Workout-IDs, parallele Nutzer, Callback ohne Cookie, Callback-Replay, geändertes Profil während der Google-Freigabe, Kontosperre, verlorene Create-/Init-/Write-Antworten, Wiederverbinden und Google-Widerruf geprüft. Eine weiterhin unklare Initialisierung bleibt gesperrt, statt Daten zu überschreiben.

`tests/e2e/connected.spec.ts` öffnet die echte React-Oberfläche. Ein simulierter Chat-Turn übermittelt Profil und Vorschlag über MCP. Danach bedient der Browser die Planbestätigung, den Google-Button, den Rücksprung, den Abschluss und den Logger. Ein gespeicherter Satz wird nach Neuladen über die vorhandene offene Workout-Auswahl wieder angezeigt. Die Google-Weiterleitung wird im erfolgreichen Test bereits am lokalen Startlink simuliert. Synthetische Bearer werden ausschließlich vom Test hinzugefügt. Die Browser-Vorschau selbst implementiert keinen OIDC-Login.

## Bestehende Browser-Abdeckung

- Dashboard, Charts, Zeit-/Plan-/Splitfilter, Historie, Fortschritt und Empty-/Error-Zustände.
- Sätze speichern, korrigieren, stornieren, Training abschließen, Wiederholungsversuche bei verlorenem Response.
- Planeditor, Versionen, Aktivierung, Konflikte und erster Plan.
- Geführte Einrichtung, Vorschlag im gemeinsamen Editor, Bestätigungsrevisionen, Wiederaufnahme, Ablauf, Sitzungsschutz und Tastaturbedienung.
- Echter `App`/`AppBridge`-Handshake im isolierten iframe, inklusive Schreibaufrufen bei `connect-src 'none'`.
- Mobile Breiten, dunkles Theme und automatisierte axe-Prüfungen in den vorhandenen geprüften Ansichten. Das ersetzt keine manuelle Accessibility-Zertifizierung.

## Wiederholen

```bash
npm ci
npx playwright install chromium
npm run check
npm run format:check
```

Gezielt:

```bash
npm test -- tests/connected-journey.test.ts tests/connected-storage.test.ts tests/auth-tool-access.test.ts
npm run test:e2e -- --grep 'onboarding, Google consent'
```

Tests schreiben ausschließlich temporäre Verzeichnisse beziehungsweise `test-results/`. Die Browser-Konfiguration startet eigene Server auf **8790–8804**; persönliche Trainingsdateien und die laufende Demo auf 8787 werden nicht zurückgesetzt. Bei Fehlern liegen Screenshots und Traces unter `test-results/`. Der neue erfolgreiche Browser-Durchlauf schreibt `test-results/connected-logger.png` zur visuellen Kontrolle.

Die Sandbox blockiert lokale TCP-Listener; die hier ausgeführten HTTP-/Browser-Tests liefen mit freigegebener lokaler Ausführung. Harmlose Playwright-Meldungen zu gleichzeitig gesetzten `NO_COLOR`-/`FORCE_COLOR`-Variablen sind keine Testfehler.

## Was weiterhin nicht nachgewiesen ist

- **Echte Google-/OIDC-/ChatGPT-Abnahme des Connected-Profils.** Die ältere [ChatGPT-Demo-Abnahme](CHATGPT-ABNAHME.md) gilt für synthetische Daten und ist kein Nachweis des neuen persönlichen Ablaufs.
- Produktiver Mehrinstanzbetrieb, PostgreSQL-Zustandsspeicher, verteilte Sperren, echte Google-Quoten, Lasttests, Wiederherstellung auf einer neuen Instanz, Monitoring sowie Aufbewahrung und Löschung der lokalen Journale.
- Safari, Firefox, echte Mobilgeräte und umfassende Modell-/Prompt-Evaluation.
- Automatische geräteübergreifende Wiederaufnahme und Hintergrund-Synchronisierung anderer offener Ansichten.

Das Connected-Profil bleibt deshalb ausdrücklich auf einen Entwicklungsserver begrenzt. Konfiguration und noch offene reale Abnahme: [ARNOLD-CONNECTED-E2E.md](ARNOLD-CONNECTED-E2E.md).

## Historischer Kontext

Die dokumentierten 30 Unit-/MCP- und neun Browser-Tests vom 24./25. Oktober gehörten zur frühen Demo. Der Ausgangsstand dieser Prüfung hatte bereits **1.146 Tests in 51 Dateien** und 52 Browser-Tests. Diese Zahlen waren im alten Bericht nicht nachgeführt. Auch der Hinweis, Analytics sei noch nicht mit der UI verbunden, war überholt: das v2-Dashboard nutzt die Engine bereits über den Presenter.
