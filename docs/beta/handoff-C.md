# Handoff Worker C – Release, Betrieb, Beta-Abnahme

Stand 31.10.2026, Branch `feat/beta-ops`.

## C1 Build-Archiv

Geprüft mit `gcloud meta list-files-for-upload .` (die Liste, die `gcloud run deploy --source .` hochlädt).

**Vorher** (aus dem Haupt-Checkout, `main` = `78924d0`): **1.314 Dateien**.

- 1.093 davon aus `.claude/worktrees/` (fünf Worktrees anderer Sessions: `beta-backend` 239, `beta-design` 226, `beta-ops` 221, `card-design` 207, `onboarding-flow` 200).
- Dazu Dateien, die zum Bauen nicht gebraucht werden: `docs/` (11, darunter der Audit), `tests/` (76), `scripts/` (3), `README.md`, `CLAUDE.md`, `.gitignore`, `.prettierignore`, `playwright.config.ts`, `vitest.config.ts`.
- Laufzeitcode und Build-Eingaben: `src/` (114), `package*.json`, `Dockerfile`, `.dockerignore`, `tsconfig*.json`, `vite*.config.ts`, `dashboard.html`, `host.html`.

**Nachher:** **124 Dateien**, nur noch Laufzeitcode und Build-Eingaben:
`.dockerignore`, `Dockerfile`, `package.json`, `package-lock.json`, `tsconfig.json`, `tsconfig.server.json`, `vite.config.ts`, `vite.host.config.ts`, `dashboard.html`, `host.html`, `src/**` (114). Ab C6 kommt `public/legal/` dazu (drei Seiten, von B12 ausgeliefert).

Umsetzung: `.gcloudignore` und `.dockerignore` sind jetzt Freigabelisten. Alles auf oberster Ebene ist ausgeschlossen, nur die genannten Dateien und Ordner kommen wieder hinein. Ein neuer Worktree, Audit oder Testordner landet damit nie mehr im Archiv. Geheimnis-Muster (`.env*`, `*.pem`, `*.key`, Dienstkonto-Dateien) bleiben auch innerhalb von `src/` und `public/` ausgeschlossen (geprüft mit einer angelegten `src/.env.local` und `test-results/`).

Gegenprobe: Die 124 Dateien in einen leeren Ordner kopiert, `npm ci` und `npm run build` laufen durch. Der Typecheck im Image prüft `src/`; Tests prüft die CI (C2).
