# Handoff Worker C – Release, Betrieb, Beta-Abnahme

Stand 31.10.2026. Integriert in `main` (`46a964a`), live als `arnold-00011-h6s`.

## Überblick

| Aufgabe | Commit    | Stand                                                                                                                                                                                                                                                                                                                                  |
| ------- | --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C1      | `9580ba7` | Fertig. Archiv 1.314 → 124 Dateien (unten).                                                                                                                                                                                                                                                                                            |
| C2      | `ef9f9e4` | Fertig. CI läuft bei jedem Push und PR, inklusive WebKit. Erster Lauf auf `main` deckte einen echten UI-Wettlauf auf (B19, PR #1), danach grün (Lauf 41236118563). Schutzregel für `main` nicht möglich: privates Repository im Free-Tarif, GitHub verlangt Pro. Ersatz: Das Deploy-Skript deployt nur Commits mit grünem `check.yml`. |
| C3      | `82c73a0` | Deploy-Skript fertig und Sperren lokal geprüft. Rollback-Übung **offen** (Freigabe Kevin).                                                                                                                                                                                                                                             |
| C4      | `5aa3c19` | Übungsskript fertig. Ausführung **offen** (Freigabe Kevin).                                                                                                                                                                                                                                                                            |
| C5      | `6cc15aa` | Monitoring-Skript fertig. Einrichtung und Alarm-Übungen **offen** (Freigabe Kevin).                                                                                                                                                                                                                                                    |
| C6      | `969f996` | Entwürfe fertig, über B12-Routen getestet (200, CSP ohne Skripte). Freigabe K8 offen.                                                                                                                                                                                                                                                  |
| C7      | `5831cdf` | Fertig, Platzhalter für Tarif (K4) und Feedback-Kanal (K9).                                                                                                                                                                                                                                                                            |
| C8      | `a7e7d94` | Fertig, an B gemeldet; B hat B13 darauf aufgebaut.                                                                                                                                                                                                                                                                                     |
| C9      | `5ae00e6` | Fertig. Labels `beta-bug`, `beta-ux`, `beta-wunsch` angelegt. Kanal: Entscheidung K9.                                                                                                                                                                                                                                                  |
| C10     | `46a964a` | Fertig. Reihenfolge backend → design → ops → C2 → B19 ohne Konflikte; lokal und in der CI grün (1.423 Vitest, 87 Playwright in Chromium und WebKit). Deploy durch den Lead mit dem Skript (Kevins Freigabe in dessen Session). Rauchtest siehe unten.                                                                                  |
| C11     | –         | Nach C10.                                                                                                                                                                                                                                                                                                                              |

## Live-Stand

- Revision `arnold-00011-h6s`, 100 % Traffic, Label `commit=46a964ad0eb6972133cf80d07454ffb0f01d3de7`, Profil connected.
- Rauchtest (Lead, von C lesend nachgeprüft): `/health` meldet `release` = `46a964ad0eb6…`; `/mcp` ohne Token 401; `/datenschutz`, `/bedingungen`, `/support` je 200; beide Adressen antworten; keine Logzeile `severity>=ERROR` oder `outcome: thrown` in den 30 Minuten danach.
- Pro Deploy entsteht jetzt genau eine Revision (vorher zwei).
- Rollback-Ziel bei Problemen: `arnold-00010-zn5` (Stand vor der Beta, ohne Kartenoberfläche; liest dieselben Daten).

## Offen

| Punkt                                             | Wer       | Stand                                                                                                         |
| ------------------------------------------------- | --------- | ------------------------------------------------------------------------------------------------------------- |
| C3 Rollback-Übung                                 | C         | wartet auf Kevins Okay in der Session von C                                                                   |
| C4 Backup-Übung                                   | C         | wartet auf Kevins Okay (`bash scripts/backup-drill.sh`, nur Testdatei)                                        |
| C5 Alarme und Testalarme                          | C         | wartet auf Kevins Okay (`bash scripts/setup-monitoring.sh`, dann `drill thrown`, `drill 5xx`, `drill uptime`) |
| Interne Abnahme                                   | Kevin + C | nach `ABNAHME.md`; Protokoll folgt hier                                                                       |
| C11 GUIDE, README, Aufräumen                      | C         | nach der Abnahme                                                                                              |
| Playwright überschreibt `docs/beta/screens/*.png` | A         | lokale Läufe hinterlassen einen schmutzigen Checkout; nach der Beta hinter einen Schalter legen               |

## K-Liste (Kevin)

| ID  | Aufgabe                               | Stand                                                                                  |
| --- | ------------------------------------- | -------------------------------------------------------------------------------------- |
| K1  | D1–D10 bestätigen                     | offen (Worker arbeiten mit den Empfehlungen)                                           |
| K2  | Google Auth Platform prüfen           | offen                                                                                  |
| K3  | WorkOS nur Eingeladene, JWT-Template  | offen; `offline_access` und Refresh-Tokens bietet WorkOS an                            |
| K4  | ChatGPT-Tarif der Tester              | **dringend**: OpenAI nennt eigene MCP-Server nur noch für Business, Enterprise und Edu |
| K5  | Budgetalarm                           | offen (Schritte in `docs/BETRIEB.md`, Kosten)                                          |
| K6  | Tester und zwei Testkonten            | offen                                                                                  |
| K7  | Tester eintragen                      | nach interner Abnahme                                                                  |
| K8  | Datenschutz und Bedingungen freigeben | offen; Platzhalter gelb markiert                                                       |
| K9  | Support- und Feedback-Weg             | offen; Vorschlag in `docs/beta/FEEDBACK.md`                                            |

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
