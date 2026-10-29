# Arnold

Persönlicher Trainingsbegleiter als **MCP-App** für ChatGPT und andere MCP-Hosts. Ein Node-Server stellt Tools bereit (Dashboard, Workout-Logging, Trainingsplan, Einrichtung); eine React-Oberfläche läuft im Chat als eingebettetes iframe. Trainingsdaten liegen in einer Google-Tabelle des Nutzers.

TypeScript, Express, `@modelcontextprotocol/*` 2.x, React 19, Recharts, Zod 4, Vitest, Playwright. Node **22.12+** (empfohlen 24).

## Schnellstart

```bash
npm ci
npm run build
npm start          # synthetische Daten auf http://localhost:8787
```

| Adresse                  | Zweck                                                  |
| ------------------------ | ------------------------------------------------------ |
| `localhost:8787/preview` | Browser-Vorschau, Daten über einen echten MCP-Client   |
| `localhost:8787/host`    | Lokaler MCP-Apps-Host (isoliertes iframe, `AppBridge`) |
| `localhost:8787/mcp`     | Streamable-HTTP-Endpunkt für MCP-Clients               |
| `localhost:8787/health`  | Healthcheck                                            |

`/mcp` ist kein Browser-Link; ein GET ohne MCP-Header liefert 405/406.

## Befehle

| Befehl              | Wirkung                                            |
| ------------------- | -------------------------------------------------- |
| `npm run dev`       | UI bauen, Server mit Watch starten                 |
| `npm run build:ui`  | Nur die beiden UI-Bundles (App und Host) neu bauen |
| `npm run check`     | Build + Typecheck + Unit-Tests + Browser-Tests     |
| `npm test`          | Vitest (Unit und Integration)                      |
| `npm run test:e2e`  | Playwright (Chromium)                              |
| `npm run inspector` | MCP Inspector                                      |

## Betriebsarten

Der Server wählt über `STORAGE_MODE` (und `AUTH_MODE`) eine Betriebsart. Details und Variablen: [docs/GUIDE.md](docs/GUIDE.md).

| Modus                       | Daten                                       | Anmeldung | Zweck                                                   |
| --------------------------- | ------------------------------------------- | --------- | ------------------------------------------------------- |
| `arnold_fixture` (Standard) | Synthetisch, im Arbeitsspeicher, alle Tools | keine     | Erste Schritte, UI-Entwicklung, ChatGPT-Test per Tunnel |
| `arnold_sheets`             | Eigene Google-Tabelle, nur lesend           | privat    | Lokale Auswertung                                       |
| `arnold_connected`          | Pro Nutzer eine eigene Google-Tabelle       | OIDC      | Ende-zu-Ende-Entwicklung                                |

Echte Daten gehen nie über einen öffentlichen Tunnel ohne Anmeldung; der Server weigert sich zu starten.

## Dokumentation

- [CLAUDE.md](CLAUDE.md) – Orientierung für die Entwicklung: Befehle, Regeln, Stolperfallen.
- [docs/GUIDE.md](docs/GUIDE.md) – Aufbau, Datenmodell, Fachregeln, Authentifizierung, Konfiguration, ChatGPT-Test, Connected-Profil, offene Punkte.

Ältere ausführliche Verträge und Abschlussberichte stehen im Git-Tag `archive/docs-before-cleanup` (`git show archive/docs-before-cleanup:docs/<datei>`).
