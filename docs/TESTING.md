# Tests

Stand 29.10.2026: **1.173 Unit-/Integrationstests in 53 Dateien** und **53 Chromium-Browsertests**, alle grün. Alle externen Anbieter (OIDC, Google) und alle Trainingsdaten sind in den Tests synthetisch.

```bash
npm ci
npx playwright install chromium
npm run check          # Build + Typecheck + Vitest + Playwright
npm run format:check
```

Gezielt:

```bash
npm test -- tests/connected-journey.test.ts      # einzelne Datei
npm run test:auth                                # Auth-Teilmengen: test:security, test:integration
npm run test:e2e -- --grep 'onboarding'          # einzelne Browser-Tests
```

## Aufbau

| Bereich                     | Dateien (`tests/`)                                  | Was sie sichern                                                                                                                                        |
| --------------------------- | --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Datenformat und Parser      | `arnold-grid`, `arnold-adapter`, `arnold-domain`, … | Kopfzeilen, IDs, Lastdefinitionen, Literal vs. Formel, Lesegrenzen, kaputte Daten                                                                      |
| Analytics                   | `analytics-*`                                       | Deterministische Kennzahlen, Wochenlogik, Rekorde, Planerfüllung, Architekturgrenzen                                                                   |
| Workout / Plan / Onboarding | `workout-*`, `plan-*`, `onboarding-*`               | Validierung, Revisionen, Idempotenz, Batches, Zustandsautomat, Sicherheit                                                                              |
| Authentifizierung           | `auth-*`                                            | JWT/JWKS, Scopes pro Tool, Nutzertrennung, Konfiguration scheitert geschlossen                                                                         |
| Google                      | `google-oauth`, `google-credentials`                | OAuth-Ablauf, Verschlüsselung, Kontowechsel                                                                                                            |
| Connected-Ablauf            | `connected-journey`, `connected-storage`            | Echter HTTP/MCP-Pfad mit simuliertem Issuer und Google: Einrichtung, Neustart, Retries, parallele Nutzer, Reconnect, verlorene Antworten               |
| MCP und UI-Rendering        | `mcp`, `*-mcp`, `*-ui-render`                       | Tool-Verträge mit echtem Client, Rendering der React-Ansichten                                                                                         |
| Browser                     | `e2e/*.spec.ts`                                     | Echter `App`/`AppBridge`-Handshake im iframe, Dashboard, Logger, Planeditor, Einrichtung, Connected-Durchlauf, axe-Prüfung, mobile Breiten, Dark Theme |

Die Google-Simulation liegt nur unter `tests/fixtures/` und wird vom normalen Server nie eingebunden. Browser-Tests starten eigene Server auf den Ports **8790–8804** und berühren weder laufende Demos noch persönliche Dateien. Fehlerartefakte (Screenshots, Traces) liegen in `test-results/`.

## Hinweise

- Die Sandbox von Claude Code blockiert lokale TCP-Listener; HTTP- und Browser-Tests brauchen freigegebene lokale Ausführung.
- Playwright-Meldungen zu gleichzeitig gesetztem `NO_COLOR`/`FORCE_COLOR` sind harmlos.
- `/host` beweist den MCP-Apps-Lebenszyklus, ersetzt aber keine Abnahme im echten ChatGPT.

## Nicht nachgewiesen

- Echte Google-/OIDC-/ChatGPT-Abnahme des Connected-Profils.
- Mehrinstanzbetrieb, Postgres-Speicher, verteilte Sperren, echte Google-Quoten, Lasttests, Restore auf neuer Instanz, Monitoring, Aufbewahrung der lokalen Journale.
- Safari, Firefox, echte Mobilgeräte, manuelle Accessibility-Prüfung, Prompt-/Modell-Evaluation.
- Geräteübergreifende Wiederaufnahme der Einrichtung.
