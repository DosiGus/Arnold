# Arnold – Hinweise für die Entwicklung

MCP-App (Node/Express + React) für Training mit Google-Sheets-Speicher. Überblick: `README.md`. Aufbau, Fachregeln, Auth, Konfiguration, ChatGPT-Test und offene Punkte: `docs/GUIDE.md`.

## Befehle

```bash
npm run check        # vor jedem Merge: Build, Typecheck, Vitest, Playwright
npm test             # nur Vitest
npm run build:ui     # nach UI-Änderungen, bevor /preview oder /host neu geladen wird
npm run format       # Prettier
npm run deploy:cloud-run -- <projekt-id>   # synthetisches Arnold auf Cloud Run (docs/GUIDE.md)
```

## Wo wird was geändert

- **Neues Tool:** Registrierung in `src/server/mcp-*.ts`, Ein-/Ausgabe als Zod-Schema in `src/shared/*-contract.ts`, **Zugriffsklasse in `src/server/auth/tool-access.ts`** (sonst wirft die Registrierung). Test in `tests/*-mcp.test.ts`.
- **Kennzahl:** nur in `src/analytics`, rein und ohne I/O. Presenter und UI rechnen nicht nach.
- **Plan/Workout-Schreiben:** immer über die Dienste in `src/server/plan` bzw. `workout` (Revisionen, `request_id`, Batch mit Readback, Audit). Nie direkt in die Tabelle.
- **UI:** Ansichten in `src/ui/views`, Zustand in `src/ui/hooks`, Bausteine in `src/ui/components`. Die UI hat keinen Netzwerkzugriff außer `callServerTool`.

## Regeln, die man leicht verletzt

- Auth und Daten **scheitern geschlossen**: Konfigurations- oder Identitätsfehler stoppen den Start oder den Aufruf, sie degradieren nie still.
- Nutzer-, Tracker- und Datei-IDs kommen aus dem geprüften Token, **nie** aus Tool-Argumenten.
- Nutzerkontext nur über `AsyncLocalStorage`, keine Modul-Globals.
- Unbekannte Last ist unbekannt, nicht 0. Kalenderdaten kommen aus `workout_date_local`, nie aus UTC-Umrechnung.
- Freitext in Sheets immer als `stringValue` schreiben (führendes `=` ist sonst eine Formel).
- Keine echten Trainingsdaten, Schlüssel oder `.env`-Inhalte in Repository, Tests, Logs oder Tool-Ergebnisse.
- Keine externen Schriftarten oder Assets in der UI (ein Bundle, ein HTML-Dokument).

## Stolperfallen

- Tests brauchen lokale TCP-Listener; in der Sandbox mit freigegebener lokaler Ausführung laufen lassen.
- Andere Sessions arbeiten parallel in Git-Worktrees. Vor Branch-Arbeit `git worktree list` und den Stand prüfen.
- Ältere Verträge und Task-Berichte: `git show archive/docs-before-cleanup:docs/<datei>`.
