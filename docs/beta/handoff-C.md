# Handoff Worker C – Release, Betrieb, Beta-Abnahme

Stand 31.10.2026, Branch `feat/beta-ops`.

## Überblick

| Aufgabe | Commit    | Stand                                                                                                                       |
| ------- | --------- | --------------------------------------------------------------------------------------------------------------------------- |
| C1      | `9580ba7` | Fertig. Archiv 1.314 → 124 Dateien (unten).                                                                                 |
| C2      | `aa5c7d7` | Workflow geschrieben. **Push blockiert**: GitHub-Zugang ohne `workflow`-Berechtigung (Kevin). Kein Lauf, keine Schutzregel. |
| C3      | `1eb0b24` | Deploy-Skript fertig und Sperren lokal geprüft. Rollback-Übung **offen** (Freigabe Kevin).                                  |
| C4      | `6ab766f` | Übungsskript fertig. Ausführung **offen** (Freigabe Kevin).                                                                 |
| C5      | `5c98300` | Monitoring-Skript fertig. Einrichtung und Alarm-Übungen **offen** (Freigabe Kevin).                                         |
| C6      | `294489a` | Entwürfe fertig, über B12-Routen getestet (200, CSP ohne Skripte). Freigabe K8 offen.                                       |
| C7      | `3a876e1` | Fertig, Platzhalter für Tarif (K4) und Feedback-Kanal (K9).                                                                 |
| C8      | `bf57c05` | Fertig, an B gemeldet; B hat B13 darauf aufgebaut.                                                                          |
| C9      | `ea44d38` | Fertig. Labels `beta-bug`, `beta-ux`, `beta-wunsch` angelegt. Kanal: Entscheidung K9.                                       |
| C10     | –         | Wartet auf `handoff-A.md` und grüne CI.                                                                                     |
| C11     | –         | Nach C10.                                                                                                                   |

## Befunde

- **Zwei Revisionen pro Deploy (behoben in C3).** Das alte Skript legte erst eine Revision mit nur einer Adresse in `ALLOWED_HOSTS` an, dann eine zweite mit beiden (`arnold-00009-f7t` → `arnold-00010-zn5`). Ein Rollback auf „die vorherige Revision“ hätte auf eine halbe Revision gezeigt. Jetzt kennt der Deploy alle Adressen vorher und legt genau eine Revision an.
- **Rollback hält den Traffic fest.** Nach `update-traffic --to-revisions` bekommt ein späterer Deploy keinen Traffic. Das Skript stellt nach jedem Deploy `--to-latest`.
- **Keine Objektversionierung möglich.** Der Bucket hat einen hierarchischen Namensraum; Google erlaubt dort keine Objektversionierung. Soft Delete (7 Tage) ist an und deckt Löschen und Überschreiben ab. Folge für den Datenschutz: Gelöschtes bleibt bis zu 7 Tage wiederherstellbar; steht im Entwurf.
- **ChatGPT-Weg hat sich geändert** (OpenAI-Hilfe, vor 4 Tagen aktualisiert): Eigene MCP-Server kommen jetzt über `chatgpt.com/plugins` → „Add custom MCP server“, offiziell für Business und Enterprise/Edu, Einrichtung nur im Web. Plus/Pro unklar → K4 dringend. Schreibende Tools bestätigt ChatGPT standardmäßig selbst; der Nutzer kann das pro Gespräch merken. Das steht in der Tester-Anleitung.
- **WorkOS** bietet `offline_access` und Refresh-Tokens an; ChatGPT muss sich damit nicht ständig neu anmelden.
- **Log-Aufbewahrung** `_Default` 30 Tage, passt zu D4.

## C1 Build-Archiv

Geprüft mit `gcloud meta list-files-for-upload .` (die Liste, die `gcloud run deploy --source .` hochlädt).

**Vorher** (aus dem Haupt-Checkout, `main` = `78924d0`): **1.314 Dateien**.

- 1.093 davon aus `.claude/worktrees/` (fünf Worktrees anderer Sessions: `beta-backend` 239, `beta-design` 226, `beta-ops` 221, `card-design` 207, `onboarding-flow` 200).
- Dazu Dateien, die zum Bauen nicht gebraucht werden: `docs/` (11, darunter der Audit), `tests/` (76), `scripts/` (3), `README.md`, `CLAUDE.md`, `.gitignore`, `.prettierignore`, `playwright.config.ts`, `vitest.config.ts`.
- Laufzeitcode und Build-Eingaben: `src/` (114), `package*.json`, `Dockerfile`, `.dockerignore`, `tsconfig*.json`, `vite*.config.ts`, `dashboard.html`, `host.html`.

**Nachher:** **124 Dateien**, nur noch Laufzeitcode und Build-Eingaben:
`.dockerignore`, `Dockerfile`, `package.json`, `package-lock.json`, `tsconfig.json`, `tsconfig.server.json`, `vite.config.ts`, `vite.host.config.ts`, `dashboard.html`, `host.html`, `src/**` (114). Mit C6 kommen die drei Seiten unter `public/legal/` dazu (127 Dateien); das Dockerfile kopiert `public/` ins Image.

Umsetzung: `.gcloudignore` und `.dockerignore` sind jetzt Freigabelisten. Alles auf oberster Ebene ist ausgeschlossen, nur die genannten Dateien und Ordner kommen wieder hinein. Ein neuer Worktree, Audit oder Testordner landet damit nie mehr im Archiv. Geheimnis-Muster (`.env*`, `*.pem`, `*.key`, Dienstkonto-Dateien) bleiben auch innerhalb von `src/` und `public/` ausgeschlossen (geprüft mit einer angelegten `src/.env.local` und `test-results/`).

Gegenprobe: Die 124 Dateien in einen leeren Ordner kopiert, `npm ci` und `npm run build` laufen durch. Der Typecheck im Image prüft `src/`; Tests prüft die CI (C2).
