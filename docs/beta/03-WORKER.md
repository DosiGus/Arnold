# Arnold – Worker-Aufteilung für den Beta-Durchgang

Grundlage für die Skills der drei parallelen Worker. Aufgaben-IDs verweisen auf `02-TODO.md`, die Begründung steht in `01-AUDIT-BEWERTUNG.md`, der vollständige Audit in `docs/audit-2026-10-31/`.

## Überblick

| Worker | Rolle                                 | Besitzt (darf ändern)                                                                                                                                                                                                               | Aufgaben |
| ------ | ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| **A**  | Design, Dashboard, Onboarding         | `src/ui/**`, `src/host/**`, `dashboard.html`, `host.html`, `vite*.config.ts`, `tests/e2e/**`, `tests/*-ui-render*.test.tsx`, `tests/arnold-qa-regressions.test.tsx`, `docs/DESIGN.md`, `docs/beta/screens/`, `playwright.config.ts` | A1–A10   |
| **B**  | Backend, Datenintegrität, Datenschutz | `src/server/**`, `src/shared/**`, `src/analytics/**`, alle `tests/*.test.ts` außer UI-Tests, `.env.example`                                                                                                                         | B0–B13   |
| **C**  | Release, Betrieb, Beta-Abnahme        | `.github/**`, `scripts/**`, `Dockerfile`, `.gcloudignore`, `.dockerignore`, `public/**`, `docs/**` (außer `DESIGN.md` und Handoff-Dateien anderer), `README.md`, `CLAUDE.md`                                                        | C1–C11   |

Warum so: Die drei Bereiche berühren kaum gemeinsame Dateien. Die einzige echte Abhängigkeit ist der Vertrag zwischen Server und Oberfläche; den legt B am ersten Tag fest (B0), danach arbeiten alle unabhängig.

## Regeln für alle drei

Diese Regeln stehen in `CLAUDE.md` und gelten ohne Ausnahme:

- Auth und Daten scheitern geschlossen. Nutzer-, Tracker- und Datei-IDs kommen aus dem Token, nie aus Tool-Argumenten. Nutzerkontext nur über `AsyncLocalStorage`.
- Kennzahlen nur in `src/analytics`. Presenter und UI rechnen nichts nach.
- Plan- und Workout-Schreiben nur über die Dienste in `src/server/plan` und `src/server/workout`.
- Die UI hat keinen Netzwerkzugriff außer `callServerTool`. Keine externen Schriftarten oder Assets.
- Keine echten Trainingsdaten, Schlüssel oder `.env`-Inhalte in Repository, Tests, Logs oder Tool-Ergebnissen.
- Neues Tool: Registrierung in `src/server/mcp-*.ts`, Zod-Schema in `src/shared/*-contract.ts`, Zugriffsklasse in `src/server/auth/tool-access.ts`, Test in `tests/*-mcp.test.ts`.

Arbeitsweise:

1. Eigener Git-Worktree und eigener Branch von aktuellem `main`: `feat/beta-design` (A), `feat/beta-backend` (B), `feat/beta-ops` (C). Vor dem Start `git worktree list` prüfen.
2. Nur Dateien im eigenen Besitzbereich ändern. Braucht ein Worker eine Änderung außerhalb, schreibt er sie als Wunsch in seine Handoff-Datei und informiert den Besitzer, statt sie selbst zu machen.
3. Kleine Commits pro Aufgabe, Nachricht mit Aufgaben-ID (`B4: map invalid_grant to GOOGLE_REAUTH_REQUIRED`). Täglich `main` in den eigenen Branch holen.
4. Vor jedem Push: `npm run check` grün und `npm run format`. Tests brauchen lokale TCP-Listener; Playwright nutzt die Ports 8790–8804. **Zwei Worker dürfen Playwright nicht gleichzeitig laufen lassen**; bei Portkonflikt warten und erneut starten, nicht Ports umbiegen.
5. Kein Deploy durch A oder B. Deploy macht nur C nach der Integration.
6. Ergebnis in `docs/beta/handoff-<A|B|C>.md`: was erledigt ist (mit Commit), was offen ist, was geprüft wurde, was nicht. `docs/GUIDE.md` aktualisiert nur C am Ende.
7. Unklare Produktfragen nicht raten: als offene Frage in die Handoff-Datei und an den Lead melden.

## Gemeinsame Verträge (von B in B0 umzusetzen, von A zu nutzen)

A kann sofort gegen diese Form bauen und sie bis zur Lieferung von B in Tests simulieren.

**1. Recovery-Feld an jedem Fehler eines Schreib- oder Google-Tools**

```ts
// src/shared/write-recovery.ts
export const RecoverySchema = z.enum([
  "none", // nichts zu tun, nur informieren
  "retry_same_request", // dieselbe request_id sicher wiederholen
  "reload_then_retry", // Stand neu laden (Revision veraltet), dann neu versuchen
  "start_over", // Vorgang neu beginnen
  "reconnect_google", // Google-Freigabe erneuern
  "finish_setup", // Einrichtung zuerst abschließen (SETUP_REQUIRED)
  "contact_support", // nicht selbst lösbar
]);
// Fehlerobjekt: { code, message, retryable, details, recovery }
```

**2. Abgelaufene Google-Freigabe**

Fehlercode `GOOGLE_REAUTH_REQUIRED`, immer mit `recovery: "reconnect_google"`. Gilt für Dashboard-, Workout-, Plan- und Konto-Tools, sobald sie Google brauchen. Der Text für ChatGPT sagt: „Die Google-Freigabe ist abgelaufen. Bitte über die Karte neu verbinden.“ A zeigt dafür die Karte aus A5 und nutzt den vorhandenen Ablauf über `connect_google_account`.

**3. Wochendaten**

```ts
// src/shared/arnold-view.ts, ViewWeekSchema
trained_dates: z.array(isoDate), // alle Kalendertage der Woche mit abgeschlossenem Training, aus workout_date_local
// vorhanden und weiter gültig: workouts (Einheiten), training_days (Tage)
// Ziel bleibt active_plan.days_per_week und wird mit training_days verglichen.
```

**4. Konto löschen**

`delete_arnold_account`, Eingabe `{ confirmation_token?: string }`.
Ohne Token: `{ stage: "confirm", summary: { stored_items: string[], keeps: string[] }, confirmation_token, expires_at }`.
Mit gültigem Token: `{ stage: "deleted", google_sheet_kept: true, sheet_url }`.
Das Token wird nur über die Karte (Klick) gesendet; die Tool-Beschreibung sagt ChatGPT, das Token nie selbst zu senden.

---

## Worker A – Design, Dashboard, Onboarding

**Rolle und Expertise:** Produktdesigner und Frontend-Entwickler für MCP-Apps in ChatGPT. React 19, CSS ohne Framework, Barrierefreiheit, Playwright. Kennt die OpenAI-Richtlinien für Inline-Karten (keine Reiter, kein inneres Scrollen, kein App-Rahmen).

**Ziel:** Arnold sieht von der ersten Frage im Onboarding bis zur Wochenübersicht aus wie ein Produkt aus einem Guss. Jede Karte funktioniert auf Smartphone und Desktop, hell und dunkel, und sagt dem Nutzer bei jedem Fehler, was er tun kann.

**Ausgangslage:**

- Freigegebene Richtung „Karten statt App“ (30.10.): Schwarz-Weiß, Glas, Systemschrift; kein Logo, Menü oder Hell-Dunkel-Schalter; pro Karte höchstens 2 Buttons und 4 Zahlen; Chips und Plus/Minus statt Formularen; Sprache geht in den Chat.
- Schritte 1–3 sind in `main` (Fundament, Satz-Karte, Chat-Brücke). Offen: Schritt 4 (Fortschritt, Verlauf, Plan als Karten, ein Stylesheet) und Schritt 5 (Onboarding als Frage-Karten, Vollbild nur für Plan bearbeiten und Verlauf).
- Bausteine: `src/ui/components/cards.tsx`. Kartenwahl über das Argument `card` von `show_arnold_dashboard` (`src/shared/dashboard-cards.ts` gehört B; neue Kartennamen dort als Wunsch an B).
- Heute drei Stylesheets: `style.css` (3.640 Zeilen), `glass.css` (1.962), `cards.css` (487).

**Aufgaben in Reihenfolge:** A4 und A5 zuerst (Blocker, klein, gegen die Verträge), dann A3 (Onboarding), A2 (Karten), A6, A7, A8, A1 (Stylesheet zum Schluss, wenn alle Karten stehen), A9, A10.

**Nicht tun:** keine Kennzahl in der UI berechnen; keine neuen Tools; keine Änderung an `src/shared/**` (Wunsch an B); keine externen Fonts, Bilder oder CDNs; kein Deploy.

**Fertig, wenn:**

- Alle Karten (`today`, `week`, `progress`, `history`, `plan`, Onboarding-Schritte, Reconnect, Konto löschen) nutzen nur Bausteine aus `cards.tsx` und ein Stylesheet.
- Playwright läuft in Chromium und WebKit, Desktop und Mobil-Viewport, ohne horizontalen Überlauf; axe meldet keine schweren Verstöße.
- Bildschirmfotos jeder Karte liegen in `docs/beta/screens/`.
- Jeder `recovery`-Wert hat eine sichtbare, verständliche Darstellung mit Test.
- `npm run check` grün; `docs/DESIGN.md` und `docs/beta/handoff-A.md` geschrieben.

---

## Worker B – Backend, Datenintegrität, Datenschutz

**Rolle und Expertise:** Backend-Entwickler für Node/TypeScript-MCP-Server mit Schwerpunkt Sicherheit und Datenschutz. Zod, Express, Google Sheets/Drive API, OAuth, Idempotenz, Tests mit Vitest.

**Ziel:** Kein Schreibvorgang kann eine Tabelle beschädigen, jeder Fehler sagt klar, wie es weitergeht, keine Nutzdaten landen im Log, und ein Nutzer kann sein Arnold-Konto vollständig löschen. Abgelaufene Google-Freigaben führen sauber zum Neu-Verbinden.

**Ausgangslage:**

- Log-Leck bestätigt: Fehler-Middleware in `src/server/http.ts` schreibt `error.message` ins Log; bei kaputtem JSON enthält das Teile der Anfrage.
- `src/shared/sheets-limits.ts`, `src/shared/write-recovery.ts`, `src/server/workout/commit.ts` und `tests/s001-write-recovery.test.ts` gibt es nur auf `codex/arnold-stabilization-s001`. **Nicht mergen** (34 Konfliktdateien). Inhalte lesen mit `git show codex/arnold-stabilization-s001:<pfad>` und gezielt in die Architektur von `main` übertragen.
- `REAUTH_REQUIRED` existiert in `src/server/google/credential-repository.ts`, wird aber nicht als klarer Tool-Fehler an UI und ChatGPT weitergegeben.
- Kein Export- oder Löschtool. „Google trennen“ löscht nur Zugangsdaten.
- Zustand im Connected-Profil: `data/connected` (auf Cloud Run ein Bucket per FUSE), genau ein Prozess.

**Aufgaben in Reihenfolge:** B0 (Verträge, sofort pushen und A Bescheid geben), B1, B4, B5, B2, B3, B6, B8, B7, B12, B10, B9, B11, B13 (sobald C8 den Prüfkorpus liefert).

**Nicht tun:** keine UI-Dateien; keine Verteilung auf mehrere Instanzen oder Datenbank (nach der Beta); keine Änderung an Deploy-Skripten (Wunsch an C); keine Tool-Argumente für Nutzer- oder Datei-IDs.

**Fertig, wenn:**

- Regressionstest beweist: kaputte Anfragen mit erfundenem Text erzeugen keinen Logeintrag mit diesem Text.
- Jeder Fehler aus Workout-, Plan-, Einrichtungs- und Google-Tools trägt `recovery`; Test pro Dienst.
- Simulierter `invalid_grant` ergibt in allen Google-abhängigen Tools `GOOGLE_REAUTH_REQUIRED`, und nach erneutem Verbinden geht es ohne Datenverlust weiter.
- `delete_arnold_account` löscht alle Betreiberdaten eines Nutzers, lässt andere Nutzer unberührt und kann ohne Karten-Token nicht ausgeführt werden.
- Journale älter als die Frist verschwinden; laufende Wiederholungen bleiben möglich.
- Jedes Tool hat alle drei Sicherheitsangaben (Test).
- `npm run check` grün; `docs/beta/handoff-B.md` mit Bestätigungsmatrix (B9) und Datenliste (was wird wo wie lange gespeichert, Grundlage für C6).

---

## Worker C – Release, Betrieb, Beta-Abnahme

**Rolle und Expertise:** Release- und Betriebsingenieur mit QA-Verantwortung. Google Cloud Run, Cloud Storage, Cloud Monitoring, GitHub Actions, Bash. Schreibt klar und einfach für Nichttechniker. Koordiniert die Integration.

**Ziel:** Ein geprüfter Stand geht reproduzierbar live, ist überwacht und wiederherstellbar, und Tester haben alles, was sie brauchen: Anleitung, Datenschutzhinweis, Support und einen Weg für Feedback.

**Ausgangslage:**

- Cloud Run: Projekt `arnold-513219`, Region `europe-west1`, Dienst `arnold`, Revision `arnold-00010-zn5`, Connected-Profil, `--max-instances 1`. Adresse `https://arnold-789221393068.europe-west1.run.app/mcp`. Login über WorkOS (`even-invention-38-staging.authkit.app`).
- Drive API und Sheets API sind aktiv. Bucket `arnold-513219-state` ohne Versionierung. Kein CI, keine Alarme, kein Budgetalarm sichtbar.
- `.gcloudignore` und `.dockerignore` schließen `.claude/` nicht aus.
- Deploy: `npm run deploy:cloud-run -- arnold-513219 even-invention-38-staging.authkit.app` (`scripts/deploy-cloud-run.sh`).

**Aufgaben in Reihenfolge:** C1, C2 (sofort, damit A und B davon profitieren), C3, C4, C5, C6 (mit Datenliste aus B), C7, C8 (Prüfkorpus früh an B liefern), C9, dann C10 und C11.

**Integration (C10), feste Reihenfolge:**

1. `feat/beta-backend` (B) in `main`, CI grün.
2. `feat/beta-design` (A) auf neuen `main` aktualisieren lassen, mergen, CI grün.
3. `feat/beta-ops` (C) mergen, CI grün.
4. `npm run check` auf `main`, Deploy, Rauchtest (`/health` zeigt den Commit, 401 ohne Token, Anmeldung, Dashboard).
5. Interne Abnahme mit Kevin nach C8 und den Abnahmekriterien in `02-TODO.md`. Fehler gehen als Issue an A oder B zurück.

**Nicht tun:** keine Änderung an `src/**` (Wunsch an A oder B); keine Rechtstexte als endgültig ausgeben (Entwurf, Freigabe durch Kevin); keine Testnutzer in Google oder WorkOS eintragen (Kevin); keinen Deploy während laufender Tests ohne Absprache; keine Zugangsdaten in Skripte oder Dokumente.

**Fertig, wenn:**

- CI läuft und schützt `main`; Deploy setzt die Release-Kennung; Rollback einmal geübt.
- Backup-Wiederherstellung mit synthetischen Daten geübt und dokumentiert.
- Alarme feuern nachweislich (einmal absichtlich ausgelöst).
- Datenschutzhinweis, Bedingungen, Support-Seite, Tester-Anleitung, Prüfkorpus, Fragebogen liegen vor.
- Integrierter Stand ist live und intern abgenommen; `docs/GUIDE.md` und `README.md` beschreiben ihn; `docs/beta/handoff-C.md` mit Abnahmeprotokoll.

---

## Was der Lead (Claude in dieser Session) übernimmt

- Fragen der Worker beantworten und Produktentscheidungen mit Kevin klären.
- Handoff-Dateien prüfen und Ergebnisse gegen die Abnahmekriterien abgleichen, bevor C integriert.
- Den Stand für Kevin kurz zusammenfassen.
