# Arnold – Hinweise für die Entwicklung

MCP-App (Node/Express + React) für Training; Login über WorkOS, Daten in Postgres (Supabase). Überblick: `README.md`. Aufbau, Nutzertrennung, Fachregeln, Auth, Datenbank und offene Punkte: `docs/GUIDE.md`. Betrieb: `docs/BETRIEB.md`.

## Befehle

```bash
npm run check        # vor jedem Merge: Build, Typecheck, Vitest, Playwright
npm test             # nur Vitest (startet selbst eine lokale Postgres für tests/db-*)
npm run build:ui     # nach UI-Änderungen, bevor /preview oder /host neu geladen wird
npm run format       # Prettier
npm run db:migrate   # Migrationen anwenden (DATABASE_ADMIN_URL)
npm run deploy:cloud-run -- <projekt-id> <authkit-domain>   # Arnold mit Login auf Cloud Run (docs/GUIDE.md)
```

## Wo wird was geändert

- **Neues Tool:** Registrierung in `src/server/mcp-*.ts`, Ein-/Ausgabe als Zod-Schema in `src/shared/*-contract.ts`, **Zugriffsklasse in `src/server/auth/tool-access.ts`** (sonst wirft die Registrierung). Test in `tests/*-mcp.test.ts`.
- **Kennzahl:** nur in `src/analytics`, rein und ohne I/O. Presenter und UI rechnen nicht nach.
- **Plan/Workout-Schreiben:** immer über die Dienste in `src/server/plan` bzw. `workout` und `commitWrite` (Revisionen, `request_id`, eine Transaktion mit Audit und Quittung). Nie direkt in die Tabelle.
- **Datenbank:** Schemaänderung nur als neue Datei in `db/migrations` plus `EXPECTED_SCHEMA_VERSION` in `src/server/db/database.ts`. Jede Nutzertabelle braucht `user_id`, Row Level Security und die Richtlinie `own_rows`; Bezüge enthalten immer `user_id`. Zugriff nur über `Database.asUser`. Test in `tests/db-*.test.ts`.
- **Skills (ChatGPT-Plugin):** `plugins/arnold/skills/<name>/SKILL.md` plus `references/`. Nur veröffentlichte Tools nennen; `trainingswissenschaft.md` in beiden Skills gleich halten. Test: `tests/plugin-skills.test.ts`.
- **Garmin-Uhr-App (in Arbeit):** Anforderungen `docs/garmin/PRD.md`, Bauplan und Arbeitspakete `docs/garmin/UMSETZUNG.md`. Uhr-App unter `apps/garmin/`, Uhr-Schnittstelle unter `src/server/watch/`.
- **UI:** Ansichten in `src/ui/views`, Zustand in `src/ui/hooks`, Bausteine in `src/ui/components`. Die UI hat keinen Netzwerkzugriff außer `callServerTool`.

## Regeln, die man leicht verletzt

- Auth und Daten **scheitern geschlossen**: Konfigurations- oder Identitätsfehler stoppen den Start oder den Aufruf, sie degradieren nie still.
- Nutzer- und Tracker-IDs kommen aus dem geprüften Token, **nie** aus Tool-Argumenten. Der Server verbindet sich nur als `arnold_app`, nie mit der Owner-Verbindung.
- Nutzerkontext nur über `AsyncLocalStorage`, keine Modul-Globals.
- Unbekannte Last ist unbekannt, nicht 0. Kalenderdaten kommen aus `workout_date_local`, nie aus UTC-Umrechnung.
- Keine echten Trainingsdaten, Schlüssel oder `.env`-Inhalte in Repository, Tests, Logs oder Tool-Ergebnisse.
- Keine externen Schriftarten oder Assets in der UI (ein Bundle, ein HTML-Dokument).

## Stolperfallen

- Tests brauchen lokale TCP-Listener und starten eine eingebettete Postgres; in der Sandbox mit freigegebener lokaler Ausführung laufen lassen.
- Andere Sessions arbeiten parallel in Git-Worktrees. Vor Branch-Arbeit `git worktree list` und den Stand prüfen.
- Ältere Verträge und Berichte (auch zur früheren Google-Sheets-Speicherung): Git-Historie bzw. `git show archive/docs-before-cleanup:docs/<datei>`.
