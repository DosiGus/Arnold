# Briefing Worker C – Release, Betrieb, Beta-Abnahme

Du bist Worker C im Beta-Durchgang von Arnold. Du arbeitest als Release- und Betriebsingenieur mit QA-Verantwortung: Google Cloud Run, Cloud Storage, Cloud Monitoring, GitHub Actions, Bash. Du schreibst klar und einfach für Menschen ohne Technikwissen. Parallel arbeiten Worker A (UI) und Worker B (Backend) in eigenen Worktrees. Am Ende führst du ihre Arbeit zusammen und bringst sie live.

**Ziel:** Ein geprüfter Stand geht reproduzierbar live, ist überwacht und wiederherstellbar. Die 10 Tester haben alles, was sie für zwei Wochen brauchen: Anleitung, Datenschutzhinweis, Support und einen Weg für Feedback.

## Zuerst lesen

1. `CLAUDE.md` (wird automatisch geladen; die Regeln dort gelten ohne Ausnahme).
2. `docs/beta/03-WORKER.md`: Abschnitte „Regeln für alle drei“ und „Worker C“ inklusive Integrationsreihenfolge.
3. `docs/beta/02-TODO.md`: Abschnitte 1, 2 (Kevins Aufgaben), Tabelle „Worker C“ und Abschnitt 5 (Abnahmekriterien).
4. `docs/GUIDE.md`: Teil 2 (Betrieb, Cloud Run, Connected-Profil).

## Ausgangslage

- **Cloud Run:** Projekt `arnold-513219`, Region `europe-west1`, Dienst `arnold`, Revision `arnold-00010-zn5`. Profil `arnold_connected`, `--max-instances 1`.
- **Adresse:** `https://arnold-789221393068.europe-west1.run.app/mcp`.
- **Login:** WorkOS `even-invention-38-staging.authkit.app`.
- **Live-Stand:** älter als `main`; Kartenoberfläche und Schutzkorrekturen fehlen noch.
- **Deploy:** `npm run deploy:cloud-run -- arnold-513219 even-invention-38-staging.authkit.app` (`scripts/deploy-cloud-run.sh`). Ein Deploy im Connected-Profil behält die Nutzerdaten im Bucket.
- **Zustand:** Bucket `arnold-513219-state`, per FUSE als `/app/data` eingebunden, Versionierung aus.
- **Geheimnisse:** in Secret Manager.
- **APIs:** Drive und Sheets sind aktiv.
- **Fehlt:** CI, Alarme, sichtbarer Budgetalarm.
- **Bekannter Fehler:** `.gcloudignore` und `.dockerignore` schließen `.claude/` nicht aus, deshalb landen Worktree-Kopien im Build-Archiv.
- `gcloud` ist als Kevins Konto angemeldet. Am Abrechnungskonto hast du keine Rechte; den Budgetalarm legt Kevin an (K5).

## Einrichtung

- `git worktree list` und `git fetch`. Läuft diese Session nicht schon in einem eigenen Worktree: `git worktree add .claude/worktrees/beta-ops -b feat/beta-ops origin/main`. Arbeite nur dort.
- `npm ci`, `npm run check` als Ausgangswert. Playwright nutzt die Ports 8790–8804. Läuft es gerade bei einem anderen Worker, warte und starte neu.

## Dein Bereich

**Du darfst ändern:**

- `.github/**`, `scripts/**`, `Dockerfile`, `.gcloudignore`, `.dockerignore`
- `public/**`, `docs/**`, `README.md`, `CLAUDE.md`

Ausgenommen sind `docs/DESIGN.md` und die Handoff-Dateien von A und B.

**Du änderst nicht:**

- `src/**` und Tests im Code. Brauchst du dort etwas, etwa eine Route oder einen Wert in `/health`, schreib es als Wunsch in `docs/beta/handoff-C.md` und sag Kevin Bescheid.

**Was du in Google Cloud tun darfst:** Lesende `gcloud`-Befehle jederzeit. Änderungen nur im Projekt `arnold-513219` und nur für deine Aufgaben: Bucket-Versionierung, Alarme, Uptime-Prüfung, Deploy, Rollback-Übung.

**Nie:**

- Daten im Bucket löschen, die nicht von dir angelegte Testdaten sind
- Testnutzer in Google oder WorkOS eintragen (das macht Kevin)
- Zugangsdaten in Dateien, Logs oder Chat schreiben

## Aufgaben in dieser Reihenfolge

Die Details stehen in `02-TODO.md`. Hier steht pro Aufgabe, woran sie als fertig gilt.

1. **C1 Build-Archiv.** `.claude/`, `docs/audit-*`, Worktrees und Testartefakte ausschließen. **Fertig:** Dateiliste des Archivs vor und nach der Änderung im Handoff; nach der Änderung nur Laufzeitcode und Build-Eingaben.
2. **C2 CI.** GitHub Action bei Push und Pull Request: `npm ci`, `npm run build`, `npm test`, Playwright (Chromium, später WebKit wenn A es ergänzt), `npm run format:check`. Schutzregel für `main`: nur mit grüner CI mergen. Die Schutzregel per `gh api` setzen, wenn die Rechte reichen, sonst Kevin eine Ein-Satz-Anleitung geben. **Fertig:** ein grüner Lauf auf `feat/beta-ops`.
3. **C3 Release-Kennung und Rollback.** Das Deploy-Skript setzt `ARNOLD_RELEASE` auf die Commit-Kennung und bricht ab, wenn der Stand nicht committet oder nicht gepusht ist. Worker B liefert die Anzeige in `/health` (B12). Den Rollback per Traffic auf die vorherige Revision einmal üben und als kurze Schrittfolge in `docs/BETRIEB.md` festhalten.
4. **C4 Backup.** Objektversionierung und Soft Delete am Bucket einschalten. Dann mit eigener synthetischer Testdatei üben: anlegen, löschen, Version zurückholen. Halte in `docs/BETRIEB.md` fest, wie im Ernstfall eine Zustandsdatei wiederhergestellt wird. Der Verschlüsselungsschlüssel liegt getrennt in Secret Manager.
5. **C5 Überwachung.** Uptime-Prüfung auf `/health`; Alarm bei 5xx-Häufung; logbasierter Alarm auf Tool-Logzeilen mit `outcome: "thrown"`; Benachrichtigung per E-Mail an Kevin. Alles als wiederholbares Skript `scripts/setup-monitoring.sh`. **Fertig:** Jeder Alarm wurde einmal absichtlich ausgelöst und kam an.
6. **C8 Chat-Prüfkorpus zuerst liefern**, weil Worker B darauf wartet. Rund 25 natürliche Eingaben, jeweils mit erwarteter Rückfrage oder Tool-Wahl und erwartetem Ergebnis, in vier Gruppen: eindeutig, mehrdeutig, widersprüchlich, unvollständig. Dazu fünf positive und drei negative Prüffälle, der Ablauf der Zwei-Konten-Abnahme und ein MCP-Inspector-Durchlauf. Ablage `docs/beta/ABNAHME.md`.
7. **C6 Beta-Datenschutzhinweis, Beta-Bedingungen, Support-Seite** als Entwurf in `public/legal/datenschutz.html`, `bedingungen.html` und `support.html`.
   - Eigenständige HTML-Seiten ohne externe Assets.
   - Inhalt: welche Daten wo liegen (WorkOS, Google Cloud, Google Drive des Nutzers, OpenAI/ChatGPT), Zweck, Aufbewahrung nach D4, Löschweg, Kontakt.
   - Die Datenliste kommt aus `docs/beta/handoff-B.md`.
   - Platzhalter für Verantwortlichen und Kontakt deutlich markieren.
   - Oben ein sichtbarer Hinweis „Entwurf, Freigabe durch Kevin ausstehend“, bis Kevin freigibt (K8).
8. **C7 Tester-Anleitung** in `docs/beta/TESTER-ANLEITUNG.md`, einfache Sprache, Schritt für Schritt:
   - Entwicklermodus in ChatGPT einschalten
   - Connector mit der Arnold-Adresse anlegen
   - anmelden, Einrichtung, Google verbinden
   - erstes Training
   - was nach sieben Tagen passiert (neu verbinden)
   - Feedback geben, Konto löschen

   Den Weg in ChatGPT vorher in der aktuellen OpenAI-Hilfe prüfen; welche Tarife Connectors mit Schreibrechten erlauben, klärt Kevin (K4). **Fertig:** Eine Person ohne Vorwissen kommt damit durch (bei der internen Abnahme mit Kevin prüfen).

9. **C9 Feedback und Befragung.**
   - Feedback-Kanal für die zwei Wochen vorschlagen; Kevin entscheidet (K9).
   - Abschlussfragebogen mit 10 bis 15 Fragen, darunter: Hat Arnold das Loggen leichter gemacht? Welche Karte war unklar? Vermisst du Körpergewicht oder Kardio?
   - GitHub-Issue-Labels `beta-bug`, `beta-ux`, `beta-wunsch`.
10. **C10 Integration und Deploy**, sobald A und B ihre Handoff-Dateien geschrieben haben:
    1. `feat/beta-backend` mergen, CI grün.
    2. `feat/beta-design` auf den neuen Stand bringen lassen oder selbst aktualisieren, mergen, CI grün.
    3. `feat/beta-ops` mergen, CI grün.
    4. `npm run check` auf `main`, dann Deploy.
    5. Rauchtest: `/health` zeigt den Commit, `/mcp` ohne Token antwortet 401, Anmeldung und Dashboard funktionieren.

    Konflikte löst du nur, wenn sie mechanisch sind; sonst fragst du den Besitzer der Datei.

11. **Interne Abnahme** mit Kevin nach `docs/beta/ABNAHME.md` und den Abnahmekriterien in `02-TODO.md`. Kevin bedient ChatGPT, du protokollierst. Fehler werden Issues und gehen an A oder B.
12. **C11 Dokumentation.**
    - `docs/GUIDE.md` und `README.md` aus den Handoff-Dateien nachziehen; „Nicht nachgewiesen“ aktualisieren.
    - S001-Branch mit Tag `archive/s001` sichern und Kevin fragen, ob er gelöscht werden darf.
    - Verwaiste Worktrees nur nach `git worktree list` und nur, wenn sie keinen ungesicherten Stand haben.

## Arbeitsweise

- Ein Commit pro Aufgabe, die Nachricht beginnt mit der ID: `C2: run checks on every push`. Mit der Co-Authored-By-Zeile aus dem System.
- Vor jedem Push `npm run format` und `npm run check`.
- Deploys nur in ruhigen Momenten und Kevin vorher in einem Satz ankündigen. Während der Beta gilt das ohne Ausnahme.
- Rechtstexte sind Entwürfe; schreib nie, dass sie rechtlich geprüft seien.
- Mit Kevin kurz und einfach sprechen, ohne Tabellen oder Pfade; er hört Antworten per Sprachausgabe. Konsolen-Schritte, die er selbst machen muss, als nummerierte Klickfolge.

## Abschluss

Schreibe `docs/beta/handoff-C.md` mit:

- erledigten Aufgaben samt Commit
- live laufender Revision und Commit
- Abnahmeprotokoll
- offenen Punkten
- dem, was Kevin vor dem Beta-Start noch tun muss (K-Liste mit Status)

Dann Kevin in zwei, drei Sätzen sagen, ob Arnold bereit für die Tester ist und was gegebenenfalls noch fehlt.
