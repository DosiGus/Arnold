# Briefing Worker B – Backend, Datenintegrität, Datenschutz

Du bist Worker B im Beta-Durchgang von Arnold. Du arbeitest als erfahrener Backend-Entwickler für Node/TypeScript-MCP-Server mit Schwerpunkt Sicherheit und Datenschutz. Parallel arbeiten Worker A (UI) und Worker C (Betrieb) in eigenen Worktrees.

**Ziel:** Bevor 10 Testnutzer Arnold zwei Wochen lang mit ihrer eigenen Google-Tabelle nutzen, kann kein Schreibvorgang eine Tabelle beschädigen. Jeder Fehler sagt klar, wie es weitergeht. Keine Nutzdaten landen im Log. Abgelaufene Google-Freigaben führen sauber zum Neu-Verbinden. Ein Nutzer kann sein Arnold-Konto vollständig löschen.

## Zuerst lesen

1. `CLAUDE.md` (wird automatisch geladen; die Regeln dort gelten ohne Ausnahme).
2. `docs/beta/03-WORKER.md`: die Abschnitte „Regeln für alle drei“, „Gemeinsame Verträge“ und „Worker B“.
3. `docs/beta/02-TODO.md`: Abschnitt 1 (Entscheidungen) und die Tabelle „Worker B“.
4. Den Audit `docs/audit-2026-10-31/BERICHT.md` nur bei Bedarf, gezielt nach Punktnummer suchen.

## Einrichtung

- Prüfe `git worktree list` und `git fetch`. Läuft diese Session nicht schon in einem eigenen Worktree, lege einen an: `git worktree add .claude/worktrees/beta-backend -b feat/beta-backend origin/main`. Arbeite nur dort.
- `npm ci`, dann `npm run check` einmal als Ausgangswert. Tests brauchen lokale TCP-Listener. Playwright nutzt die Ports 8790–8804. Laufen sie gerade bei einem anderen Worker, warte und starte neu; ändere keine Ports.

## Geltende Entscheidungen

Arbeite mit diesen Entscheidungen, solange Kevin nichts anderes sagt:

- **D3:** Google bleibt im Testmodus, Freigaben laufen nach 7 Tagen ab.
- **D4:** Journale, Operations-Snapshots und Audit werden 30 Tage aufbewahrt. „Konto löschen“ entfernt sofort alles bei uns, die Google-Tabelle bleibt beim Nutzer.
- **D5:** Das Wochenziel zählt Trainingstage.
- **D8:** Der S001-Branch wird nicht gemergt, nur gezielt übernommen.
- **D10:**
  - Lesen und normales Loggen laufen direkt.
  - Verwerfen, Abbrechen, Aktivieren und Trennen brauchen eine Rückfrage im Chat.
  - Konto löschen braucht zusätzlich einen Klick in der Karte.

Körpergewicht, Kardio, Bezahlung, Datenbank und Mehrinstanzbetrieb sind **nicht** dein Auftrag.

## Dein Bereich

**Du darfst ändern:**

- `src/server/**`, `src/shared/**`, `src/analytics/**`
- alle `tests/*.test.ts` außer den UI-Tests (`*-ui-render*`, `arnold-qa-regressions.test.tsx`, `tests/e2e/**`)
- `.env.example`
- `docs/beta/handoff-B.md`

**Du änderst nicht:**

- UI, Deploy-Skripte, `Dockerfile`, CI
- `docs/GUIDE.md` und `README.md`; die aktualisiert Worker C am Ende aus deiner Handoff-Datei

Brauchst du dort etwas, schreib es als Wunsch in `docs/beta/handoff-B.md` und sag Kevin Bescheid. Kein Deploy.

## Aufgaben in dieser Reihenfolge

Die Details und Audit-Bezüge stehen in `02-TODO.md`. Hier steht pro Aufgabe, woran sie als fertig gilt.

1. **B0 Verträge.** Setze die vier Verträge aus `03-WORKER.md` um: `recovery`-Feld, `GOOGLE_REAUTH_REQUIRED`, `trained_dates`, Ein- und Ausgabeform von `delete_arnold_account`. Zunächst nur Schemas und Typen, mit Tests für die Schemas. Ist `npm run check` grün, merge diesen einen Commit direkt in `main` und pushe. Das ist die einzige Ausnahme von „nur C integriert“, damit Worker A sofort darauf bauen kann.
2. **B1 Log-Leck.** Die Fehler-Middleware in `src/server/http.ts` protokolliert nur Fehlertyp und Status, nie `error.message`. Prüfe jeden `console.*`-Aufruf im Server, auch Google-API-Fehlertexte. **Fertig:** Ein Test schickt kaputtes JSON mit erfundenem Marker-Text, und der Marker taucht in keiner Logausgabe auf.
3. **B4 Google-Reauth.** `invalid_grant` ergibt in jedem Tool, das Google braucht, `GOOGLE_REAUTH_REQUIRED` mit `recovery: "reconnect_google"` und einem klaren Text für ChatGPT. **Fertig:** Test mit simuliertem abgelaufenem Grant; nach erneutem Verbinden laufen Lesen und Schreiben ohne Datenverlust weiter.
4. **B5 Wochendaten.** Die Engine liefert `trained_dates` pro Woche aus allen Workouts, nicht nur aus `recent_workouts`. Der Presenter übernimmt sie unverändert. **Fertig:** unabhängige Kontrollrechnung als Test, inklusive zwei Einheiten am selben Tag.
5. **B2 Kapazitätsgrenzen.** Hol dir `src/shared/sheets-limits.ts` per `git show codex/arnold-stabilization-s001:<pfad>`, passe es an `main` an und prüfe vor jedem Schreib-Batch. **Fertig:** Ein Batch, der die Tabelle über die Grenze des eigenen Readers bringen würde, wird vorher mit verständlichem Fehler abgelehnt.
6. **B3 Recovery-Vertrag.** Übertrage `write-recovery.ts` und `tests/s001-write-recovery.test.ts` aus S001. Jeder Fehler in Workout-, Plan-, Einrichtungs- und Google-Tools trägt `recovery`. **Fertig:** ein Test pro Dienst.
7. **B6 Konto löschen.** Implementiere `delete_arnold_account` zweistufig mit kurzlebigem Token. Es löscht:
   - Identität
   - Zugangsdaten, mit Widerruf bei Google
   - Einrichtung
   - Journale und Audit
   - Tracker-Zuordnung

   Die Zugriffsklasse ist `ACCOUNT_MANAGEMENT`, mit `destructiveHint: true`. **Fertig:** Tests für „ohne Token passiert nichts“, „falsches oder abgelaufenes Token“ und „anderer Nutzer bleibt unberührt“.

8. **B8 Aufbewahrung.** `ARNOLD_JOURNAL_RETENTION_DAYS`, Standard 30. Aufräumen beim Start und einmal täglich. Einträge, die eine laufende Wiederholung braucht, bleiben. **Fertig:** Test mit gesteuerter Zeit.
9. **B7** `get_arnold_stored_data`.
10. **B12** Statische Seiten `/datenschutz`, `/bedingungen`, `/support` aus `public/legal/*.html`, Inhalt von C. Fehlt eine Datei, antwortet die Route mit 404. Dazu `release` aus `ARNOLD_RELEASE` in `/health`.
11. **B10 Tool-Metadaten.** Ein Test schlägt fehl, wenn einem Tool `readOnlyHint`, `destructiveHint` oder `openWorldHint` fehlt.
12. **B9 Bestätigungsregeln** nach D10 in den Tool-Beschreibungen umsetzen und als Matrix in der Handoff-Datei festhalten.
13. **B11 Eigene Übungen.** Übungen außerhalb des Grundkatalogs werden beim Anlegen der Tabelle als eigene Übungen angelegt, statt nur in `open_questions` zu landen. **Fertig:** Test für „Eigenen Plan übernehmen“ mit drei unbekannten Übungen.
14. **B13 Chat-Prüfkorpus.** Sobald Worker C ihn liefert (`docs/beta/`), Tool-Beschreibungen und Fehlermeldungen nachschärfen.

## Arbeitsweise

- Ein Commit pro Aufgabe, die Nachricht beginnt mit der ID: `B1: keep request fragments out of server logs`. Mit der Co-Authored-By-Zeile aus dem System.
- Vor jedem Push `npm run format` und `npm run check`. Pushe `feat/beta-backend` regelmäßig. Hol dir täglich `origin/main` in deinen Branch.
- Für neue Tools gilt die Reihenfolge aus `CLAUDE.md`: Registrierung, Zod-Vertrag, Zugriffsklasse in `tool-access.ts`, Test in `tests/*-mcp.test.ts`.
- Nur synthetische Testdaten. Kein echter Schlüssel, keine `.env`-Inhalte, keine echten Trainingsdaten, auch nicht in Logs.
- Ist eine Produktfrage offen, rate nicht. Frag Kevin kurz in einfachen Sätzen, ohne Tabellen oder Dateipfade; er hört Antworten per Sprachausgabe. Arbeite bis zur Antwort an der nächsten Aufgabe weiter.

## Abschluss

Schreibe `docs/beta/handoff-B.md` mit:

- erledigten Aufgaben samt Commit
- offenen Punkten
- dem, was geprüft wurde und was nicht
- der Bestätigungsmatrix (B9)
- einer Datenliste: was Arnold bei uns speichert, wo, wie lange, wie es gelöscht wird (Grundlage für den Datenschutzhinweis von C)
- Wünschen an A und C

Zum Schluss Branch pushen und Kevin in zwei, drei Sätzen sagen, dass B fertig ist. Mergen in `main` macht Worker C.
