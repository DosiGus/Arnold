# Arnold

Persönlicher Trainingsbegleiter als **MCP-App** für ChatGPT und andere MCP-Hosts. Ein Node-Server stellt Tools bereit (Dashboard, Workout-Logging, Trainingsplan, Einrichtung); React-Karten im Look von OpenAIs Apps SDK UI laufen im Chat als eingebettetes iframe. Nutzer melden sich über WorkOS an; ihre Trainingsdaten liegen in Postgres (Supabase), streng getrennt pro Nutzer.

TypeScript, Express, `@modelcontextprotocol/*` 2.x, React 19, Skybridge (nur Web), Apps SDK UI, Tailwind 4, Zod 4, `pg`, Vitest, Playwright. Node **22.12+** (empfohlen 24).

## Schnellstart

```bash
npm ci
npm run build
npm start          # synthetische Daten auf http://localhost:8787
```

| Adresse                 | Zweck                                                  |
| ----------------------- | ------------------------------------------------------ |
| `localhost:8787/host`   | Lokaler MCP-Apps-Host (isoliertes iframe, `AppBridge`) |
| `localhost:8787/mcp`    | Streamable-HTTP-Endpunkt für MCP-Clients               |
| `localhost:8787/health` | Healthcheck                                            |

`/mcp` ist kein Browser-Link; ein GET ohne MCP-Header liefert 405/406.

## Befehle

| Befehl               | Wirkung                                            |
| -------------------- | -------------------------------------------------- |
| `npm run dev`        | UI bauen, Server mit Watch starten                 |
| `npm run build:ui`   | Nur die Ansichten und den Test-Host neu bauen      |
| `npm run check`      | Build + Typecheck + Unit-Tests + Browser-Tests     |
| `npm test`           | Vitest, inklusive Tests gegen eine lokale Postgres |
| `npm run test:e2e`   | Playwright (Chromium, WebKit)                      |
| `npm run db:migrate` | Migrationen anwenden (`DATABASE_ADMIN_URL`)        |
| `npm run db:setup`   | Supabase und Secret Manager einrichten             |
| `npm run inspector`  | MCP Inspector                                      |

## Betriebsarten

Der Server wählt über `STORAGE_MODE` (und `AUTH_MODE`) eine Betriebsart. Details und Variablen: [docs/GUIDE.md](docs/GUIDE.md).

| Modus                       | Daten                                       | Anmeldung | Zweck                                                   |
| --------------------------- | ------------------------------------------- | --------- | ------------------------------------------------------- |
| `arnold_fixture` (Standard) | Synthetisch, im Arbeitsspeicher, alle Tools | optional  | Erste Schritte, UI-Entwicklung, ChatGPT-Test per Tunnel |
| `arnold_database`           | Pro Nutzer in Postgres (Supabase)           | OIDC      | Echte Nutzer                                            |

Echte Daten gehen nie über einen öffentlichen Tunnel ohne Anmeldung; der Server weigert sich zu starten.

## Dokumentation

- [CLAUDE.md](CLAUDE.md) – Orientierung für die Entwicklung: Befehle, Regeln, Stolperfallen.
- [docs/GUIDE.md](docs/GUIDE.md) – Aufbau, Datenmodell, Nutzertrennung, Fachregeln, Authentifizierung, Datenbank, Hosting, offene Punkte.
- [docs/BETRIEB.md](docs/BETRIEB.md) – Deploy, Rollback, Sicherung, Alarme.
- [docs/DESIGN.md](docs/DESIGN.md) – Gestaltungsregeln der Karten.

Ältere Berichte und Verträge stehen in der Git-Historie (`git log -- docs/`) und im Tag `archive/docs-before-cleanup`.
