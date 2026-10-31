# Bewertung des Audits vom 31.10.2026

Stand: `main` = `2c5ad57`. Geprüft von Claude (Produkt- und Entwicklungsleitung).
Der vollständige Audit liegt unter `docs/audit-2026-10-31/` (`BERICHT.md`, `audit.json`, Originalcheckliste, PDF-Übersicht).

## Kurzfazit

Der Audit ist sorgfältig und ehrlich. Seine Befunde stimmen mit dem Code überein, die Prozentwerte sind nachvollziehbar.
Er misst Arnold aber am **ganzen ursprünglichen Fahrplan** bis zur öffentlichen Veröffentlichung mit Bezahlung.
Für unser nächstes Ziel, **zwei Wochen Beta mit 10 Testnutzern**, sind rund 30 der 112 Punkte nicht relevant.
Dafür fehlen im Audit drei Punkte, die für genau diese Beta entscheidend sind.

## Zum PDF

Das PDF enthält nur die eingeklappte Übersicht, also Titel und Prozentwert pro Punkt.
Die Detailtexte fehlen. Der vollständige Bericht kam vom lokalen Audit-Server und liegt jetzt im Repository.
Inhaltlich fehlt damit nichts: Alle 112 Punkte sind mit Befund, Lücke und nächstem Schritt vorhanden.

## Im Code bestätigt

| Audit-Punkt | Befund                                                                                                                                                              | Bestätigt                               |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------- |
| 09.05       | Bei ungültigem JSON landet die Parser-Meldung mit Bruchstücken der Anfrage im Server-Log (`src/server/http.ts`, Fehler-Middleware, `console.error(error.message)`). | ja                                      |
| 07.07       | `.gcloudignore` und `.dockerignore` schließen `.claude/` nicht aus. Die Worktree-Kopien unter `.claude/worktrees/` landen im Cloud-Build-Archiv.                    | ja                                      |
| 05.03       | Die Wochenkarte zählt Einheiten gegen `days_per_week` (Tage) und markiert Tage nur aus `recent_workouts` (die letzten fünf).                                        | ja (`src/ui/views/WeekCard.tsx`)        |
| 05.06       | Die Satzkarte bietet nur vereinfachtes RIR, kein RPE.                                                                                                               | ja (`src/ui/views/TrainingCard.tsx`)    |
| 09.07       | Es gibt kein Tool für Export oder Kontolöschung. „Google trennen“ löscht nur die Zugangsdaten, nicht Journale, Audit und Einrichtungsentwürfe.                      | ja (`src/server/auth/tool-access.ts`)   |
| 06.11       | Die Kapazitätsprüfung vor dem Schreiben (`sheets-limits.ts`) und der Recovery-Vertrag (`write-recovery.ts`) existieren nur auf dem S001-Branch.                     | ja (`codex/arnold-stabilization-s001`)  |
| 07.08       | Kein CI, keine Commit-Kennung an der laufenden Revision.                                                                                                            | ja (kein `.github/`)                    |
| 07.09       | Keine Alarme, keine Versionierung im Zustands-Bucket, kein Budgetalarm sichtbar.                                                                                    | ja (`gcloud`: Bucket-Versionierung aus) |
| 06.02       | Drive API und Sheets API sind aktiv.                                                                                                                                | ja (`gcloud services list`)             |
| —           | Live läuft Revision `arnold-00010-zn5` mit dem Connected-Profil. Kartenoberfläche, Chat-Brücke und die drei Schutzkorrekturen sind noch nicht live.                 | ja                                      |

## Was am Audit gut ist

- Er arbeitet mit Code und Tests als Beleg, nicht mit Vermutungen. Externe Punkte ohne Nachweis bekommen keinen erfundenen Prozentwert.
- Er hat eine echte Sicherheitslücke gefunden und mit erfundenen Daten nachgewiesen (Log-Leck 09.05).
- Er trennt sauber zwischen „gebaut“, „getestet“ und „abgenommen“.
- Die Berechnungs-Engine (Bereich 04) ist zu Recht als stärkster Teil bewertet.

## Wo ich dem Audit widerspreche oder ihn ergänze

**1. Falscher Maßstab für die Beta.** Bereich 08 (Bezahlung, 10 Punkte) und fast alles aus Bereich 11 (öffentliche OpenAI-Veröffentlichung, 13 Punkte) brauchen wir für 10 eingeladene Testnutzer nicht. Die Tester binden Arnold als eigenen Connector im Entwicklermodus ein. Eine Einreichung bei OpenAI ist dafür nicht nötig. Diese Punkte sind keine Beta-Blocker.

**2. Fehlt im Audit: Google-Testmodus und zwei Wochen Testdauer.** Solange die Google-App im Status „Testen“ ist, laufen die Google-Freigaben nach **sieben Tagen** ab. Der Server erkennt das (`REAUTH_REQUIRED`), aber **die Oberfläche hat keinen Weg zurück**: Keine Karte sagt dem Nutzer, dass er Google neu verbinden muss. Bei zwei Wochen Testdauer trifft das jeden Tester mindestens einmal. Der Audit führt das unter 06.04 nur mit normaler Priorität. Für uns ist es Blocker Nummer eins.

**3. Fehlt im Audit: Wer sich anmelden darf.** Das WorkOS-Template gibt jedem angemeldeten Konto alle Rechte. Wer den Link kennt, kann sich registrieren und die Einrichtung durchlaufen. Erst bei der Google-Verbindung stoppt die Google-Testnutzerliste. Für die Beta sollte die Anmeldung auf eingeladene Tester begrenzt sein.

**4. Fehlt im Audit: ChatGPT-Tarif der Tester.** Eigene MCP-Connectors mit Schreib-Tools brauchen in ChatGPT den Entwicklermodus. Welche Tarife das aktuell können, ist in öffentlichen Quellen widersprüchlich. Bevor wir Tester einladen, muss ein Testkonto mit genau dem Tarif der Tester den ganzen Ablauf einmal durchlaufen.

**5. Überbewertet für die Beta: verteilte Sperren und Datenbank (03.10, 10.03, 07.04).** Mit genau einer Instanz und 10 Nutzern reicht der Dateispeicher. Wir halten die Grenze (`--max-instances 1`) und deployen nur in ruhigen Momenten. Postgres kommt erst vor einem größeren Rollout.

**6. Datenschutz (09.01, 09.02, 09.08) ist auch für die Beta Pflicht, aber in kleinerer Form.** Wir speichern Alter, Geschlecht, Größe, Gewicht, „Bereiche schonen“ und Trainingsänderungen auf unserer Seite. Dafür brauchen wir vor dem Start: einen kurzen Datenschutzhinweis, eine Einwilligung der Tester, eine feste Aufbewahrungsfrist für Journale und einen Löschweg. Eine anwaltlich geprüfte Datenschutzerklärung für den öffentlichen Start ist ein späterer Schritt.

**7. S001-Branch.** Der Audit empfiehlt den Abgleich. Ich bleibe bei der Entscheidung vom 28.10.: nicht mergen (34 Konfliktdateien). Wir übernehmen gezielt nur Kapazitätsgrenzen, Recovery-Vertrag, die Layout-Gegenproben und deren Tests. Danach wird der Branch archiviert.

## Einordnung nach Beta-Relevanz

| Gruppe                          | Punkte                                                                                                    | Umgang                        |
| ------------------------------- | --------------------------------------------------------------------------------------------------------- | ----------------------------- |
| Beta-Blocker                    | 09.05, 07.07, 05.03, 06.04 (Reconnect), 06.11, 03.09, 05.10, 09.07, 09.01/09.02 (Beta-Form), 05.12, 10.06 | vor dem Start erledigen       |
| Beta-wichtig                    | 01.04, 01.06, 05.02, 05.05, 05.06, 05.07, 05.09, 07.08, 07.09, 02.09, 10.07, 10.08, 10.10, 06.03, 06.12   | in diesem Durchgang erledigen |
| Produktentscheidung, nicht Code | 01.01, 01.03, 02.02, 03.07, 04.07, 05.08 (Körpergewicht/Kardio), 08.01, 08.02                             | entscheiden und festhalten    |
| Nach der Beta                   | 08.03–08.10, 11.01–11.13, 07.05, 06.13, 10.03 (Mehrinstanz), 10.09 (Schema-Migration)                     | bewusst verschoben            |
