# Arnold – Beta-Abnahme

Unterlagen für die interne Abnahme vor dem Beta-Start (C8). Kevin bedient ChatGPT, Worker C protokolliert. Jede Abweichung wird ein GitHub-Issue mit Label `beta-bug` oder `beta-ux` und geht an Worker A (Karten, Texte in Karten) oder Worker B (Tool-Wahl, Rückfragen, Fehlertexte).

Inhalt:

1. Chat-Prüfkorpus (26 Eingaben in vier Gruppen), Grundlage für B13
2. Fünf positive und drei negative Prüffälle
3. Ablauf der Zwei-Konten-Abnahme
4. MCP-Inspector-Durchlauf
5. Protokoll

Regeln, gegen die geprüft wird (Entscheidungen aus `02-TODO.md`):

- **D10:** Lesen und normales Loggen ohne Rückfrage. Satz verwerfen, Training abbrechen, Entwurf verwerfen, Plan aktivieren, Einrichtung abbrechen, Google trennen: erst Rückfrage im Chat, dann nur nach klarem Ja. Konto löschen: Rückfrage und zusätzlich Klick in der Karte.
- **D5:** Das Wochenziel zählt Trainingstage, nicht Einheiten.
- **D6:** Anstrengung nur als RIR („noch 0 / 1–2 / 3+ Wiederholungen im Tank“).
- Kalenderdaten sind lokale Daten (`workout_date_local`), nie aus UTC umgerechnet.
- Arnold erfindet keine Werte. Fehlt eine Angabe, die zum Speichern nötig ist, fragt ChatGPT nach, statt zu raten.

## 1. Chat-Prüfkorpus

Ausgangslage, wenn nicht anders angegeben: Konto ist eingerichtet, Google verbunden, aktiver Plan „Ganzkörper A/B“ mit 3 Trainingstagen pro Woche, darin unter anderem Bankdrücken, Kniebeugen, Kreuzheben, Rudern, Bizepscurls. Heute läuft noch kein Training.

„Direkt“ heißt: ChatGPT ruft das Tool ohne Rückfrage auf. „Rückfrage“ heißt: ChatGPT fragt im Chat nach und ruft vorher **kein** schreibendes Tool auf.

### Gruppe E – eindeutig (direkt, ohne Rückfrage)

| Nr  | Eingabe                                                   | Erwartet: Tool-Wahl                                                                                                 | Erwartet: Ergebnis                                                                           |
| --- | --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| E1  | „Zeig mir mein Training für heute.“                       | `show_arnold_dashboard` mit `card: "today"`                                                                         | Karte „Heute“ mit der nächsten Einheit aus dem Plan.                                         |
| E2  | „Bankdrücken, 3 Sätze à 8 Wiederholungen mit 80 kg.“      | `start_workout` (heutiges lokales Datum, Einheit aus dem Plan), dann `log_workout_sets` mit 3 Sätzen: 8 Wdh., 80 kg | Drei Sätze gespeichert, kurze Bestätigung mit Übung, Sätzen, Gewicht. Zeilen in der Tabelle. |
| E3  | „Wie viele Trainingstage habe ich diese Woche geschafft?“ | `show_arnold_dashboard` mit `card: "week"` oder `get_arnold_dashboard`                                              | Antwort „x von 3 Trainingstagen“. Zwei Einheiten am selben Tag zählen als ein Tag.           |
| E4  | „Wie hat sich mein Kniebeugen entwickelt?“                | `show_arnold_dashboard` mit `card: "progress"` oder `get_arnold_exercise_progress` für Kniebeugen                   | Fortschritt nur für Kniebeugen, Zeitraum und Einheit an der Zahl genannt.                    |
| E5  | „Zeig mir meine letzten Trainings.“                       | `show_arnold_dashboard` mit `card: "history"` oder `get_arnold_workouts`                                            | Liste der letzten Trainings mit lokalem Datum.                                               |
| E6  | „Der letzte Satz waren 10 statt 8 Wiederholungen.“        | `update_set` für den zuletzt gespeicherten Satz, `reps: 10`                                                         | Satz geändert, nichts sonst. Kein Verwerfen und Neuanlegen.                                  |
| E7  | „Ich bin fertig für heute.“                               | `complete_workout` für das laufende Training                                                                        | Training abgeschlossen, zählt als Trainingstag. Kurze Zusammenfassung.                       |
| E8  | „Zeig mir meinen Trainingsplan.“                          | `show_arnold_dashboard` mit `card: "plan"` oder `get_training_plan`                                                 | Aktiver Plan mit Einheiten und Übungen.                                                      |
| E9  | „Welche Daten speichert Arnold über mich?“                | `get_arnold_stored_data`                                                                                            | Datenarten mit Anzahl, Datum und Aufbewahrung, Link zur eigenen Tabelle. Keine Inhalte.      |

### Gruppe M – mehrdeutig (Rückfrage oder klar begründete Annahme)

| Nr  | Eingabe                                                    | Erwartet: Rückfrage oder Tool-Wahl                                                                                                                         | Erwartet: Ergebnis                                                                                        |
| --- | ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| M1  | „Trag 3x10 ein.“ (kein Training läuft)                     | **Rückfrage:** welche Übung und welches Gewicht.                                                                                                           | Nichts gespeichert, bis Übung und Gewicht genannt sind.                                                   |
| M2  | „Ich hab heute Beine gemacht.“                             | **Rückfrage:** welche Übungen, Sätze und Gewichte, oder ob nur ein Training ohne Details eingetragen werden soll.                                          | Keine erfundenen Sätze.                                                                                   |
| M3  | „Mach den Satz weg.“ (mehrere Sätze im laufenden Training) | **Rückfrage:** welcher Satz, dann Bestätigung (D10). Erst nach klarem Ja `void_set`.                                                                       | Genau der genannte Satz ist verworfen.                                                                    |
| M4  | „Curls mit den 12ern, 3 Sätze à 10.“                       | Entweder direkt `log_workout_sets` mit 12 kg je Hantel und 2 Hanteln, wenn die Übung so angelegt ist, oder **Rückfrage**, ob 12 kg je Hantel gemeint sind. | Nie stillschweigend 24 kg oder 12 kg gesamt, wenn das nicht eindeutig ist. Die Antwort nennt die Annahme. |
| M5  | „Gestern war ich auch: Kreuzheben 5x5 mit 120.“            | Direkt: `start_workout` mit dem **gestrigen lokalen Datum**, `log_workout_sets`, `complete_workout`.                                                       | Training am gestrigen Kalendertag, auch kurz nach Mitternacht. Antwort nennt das Datum.                   |
| M6  | „Wechsel auf den neuen Plan.“ (zwei Entwürfe vorhanden)    | **Rückfrage:** welcher Entwurf, dann Bestätigung (D10). Erst nach klarem Ja `activate_training_plan`.                                                      | Genau der gewählte Entwurf ist aktiv.                                                                     |
| M7  | „Bankdrücken 80 kg, 8 Wiederholungen, RPE 8.“              | Direkt `log_workout_sets` mit RIR „1–2“ statt RPE, oder **Rückfrage** nach RIR. Kein neues RPE.                                                            | Antwort erklärt in einem Satz: RPE 8 entspricht etwa 1–2 Wiederholungen im Tank.                          |

### Gruppe W – widersprüchlich (Rückfrage, nichts speichern)

| Nr  | Eingabe                                                                         | Erwartet: Rückfrage                                                                                                         | Erwartet: Ergebnis                                                                                  |
| --- | ------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| W1  | „Rudern: 3 Sätze, 10, 10 und 8 Wiederholungen, also insgesamt 4 Sätze.“         | 3 oder 4 Sätze, und wie viele Wiederholungen im vierten?                                                                    | Nichts gespeichert bis zur Klärung.                                                                 |
| W2  | „Kniebeugen mit 100 kg … nein, 1000 kg, 5 Wiederholungen.“                      | Ob wirklich 1000 kg gemeint sind.                                                                                           | Kein Satz mit 1000 kg ohne ausdrückliche Bestätigung.                                               |
| W3  | „Trag für morgen ein, dass ich Kniebeugen 5x5 gemacht habe.“                    | Hinweis, dass morgen in der Zukunft liegt; Frage nach dem richtigen Datum.                                                  | Kein Training mit Datum in der Zukunft.                                                             |
| W4  | „Lösch mein Arnold-Konto, aber meine Trainingsdaten sollen bei Arnold bleiben.“ | Erklärung: Konto löschen entfernt alles bei Arnold; die Google-Tabelle bleibt im eigenen Drive. Frage, ob trotzdem löschen. | Höchstens `delete_arnold_account` ohne Token (Karte „Bestätigen“). Gelöscht wird nichts ohne Klick. |
| W5  | „Setz mein Wochenziel auf 5 Tage, aber lass den Plan, wie er ist.“              | Erklärung: Das Ziel kommt aus dem aktiven Plan (3 Tage). Angebot, eine neue Planversion mit 5 Tagen zu entwerfen.           | Kein Plan aktiviert ohne Rückfrage. Aktiver Plan unverändert.                                       |

### Gruppe U – unvollständig (Rückfrage nach genau dem, was fehlt)

| Nr  | Eingabe                                                                        | Erwartet: Rückfrage oder Tool-Wahl                                                                                                               | Erwartet: Ergebnis                                                            |
| --- | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------- |
| U1  | „Bankdrücken 80 kg.“                                                           | **Rückfrage:** wie viele Wiederholungen (und Sätze).                                                                                             | Nichts gespeichert, bis Wiederholungen genannt sind.                          |
| U2  | „Neuer Satz: 10 Wiederholungen.“ (kein Training läuft, keine Übung im Kontext) | **Rückfrage:** welche Übung, welches Gewicht.                                                                                                    | Nichts gespeichert.                                                           |
| U3  | „Ich will heute trainieren.“                                                   | Direkt `show_arnold_dashboard` mit `card: "today"`. Bei mehreren möglichen Einheiten Frage, welche.                                              | Karte „Heute“. `start_workout` erst, wenn der Nutzer startet.                 |
| U4  | „Leg mir einen neuen Plan an.“                                                 | **Rückfrage** nach Tagen pro Woche und Ziel, oder `get_plan_editor_context` und dann Entwurf mit `create_training_plan`.                         | Nur ein Entwurf. Kein `activate_training_plan` ohne Rückfrage.                |
| U5  | „Verbinde mein Google-Konto.“ (neues Konto, Einrichtung nicht begonnen)        | `connect_google_account` meldet `SETUP_REQUIRED` mit `recovery: "finish_setup"`; ChatGPT schlägt die Einrichtung vor (`show_arnold_onboarding`). | Kein Google-Dialog vor der Einrichtung. Klare Ansage, was als Nächstes kommt. |

Bewertung pro Eingabe: **OK**, wenn Tool-Wahl oder Rückfrage und Ergebnis passen. **Abweichung**, wenn ChatGPT rät, ein falsches Tool nimmt, bei D10-Tools nicht nachfragt oder bei eindeutigen Eingaben unnötig nachfragt. Jede Abweichung mit Wortlaut der Antwort ins Protokoll.

## 2. Prüffälle

### Positiv

| Nr  | Ablauf                                                                                                                                     | Erwartet                                                                                                                               |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------- |
| P1  | Neues Konto: „Richte Arnold für mich ein.“ Begrüßung → Weg wählen → Angaben → Planvorschlag → bestätigen → Google verbinden.               | Tabelle liegt im Drive-Hauptordner. Abschlusskarte nennt Dateiname und Link und bietet „Erstes Training starten“.                      |
| P2  | Training über die Karte: starten, drei Sätze mit Plus/Minus und Chips eintragen, abschließen.                                              | Sätze stehen in der Tabelle. Wochenkarte zeigt „1 von 3 Trainingstagen“, der heutige Tag ist markiert.                                 |
| P3  | Korrektur im Chat: „Beim zweiten Satz waren es 82,5 kg.“                                                                                   | Nur dieser Satz geändert, in Tabelle und Karte.                                                                                        |
| P4  | Plan ändern: „Tausch Rudern gegen Klimmzüge.“ → Entwurf → „Aktivieren“ → Rückfrage → „Ja“.                                                 | Rückfrage vor dem Aktivieren. Danach zeigt „Heute“ Klimmzüge. Die alte Planversion ist in der Historie.                                |
| P5  | Google-Freigabe abgelaufen: Unter myaccount.google.com → Sicherheit → Drittanbieter-Verbindungen Arnold entfernen. Dann einen Satz loggen. | Karte „Google neu verbinden“. Nach dem Verbinden wird der Satz genau einmal gespeichert. Keine zweite Tabelle, keine verlorenen Daten. |

### Negativ

| Nr  | Ablauf                                                                                                                                  | Erwartet                                                                                                               |
| --- | --------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| N1  | Kaputte Anfrage mit erfundenem Text an `/mcp` (Befehl unten). Danach die Logs der letzten 10 Minuten nach dem Text durchsuchen.         | Antwort 400 oder 401. Der erfundene Text steht in **keinem** Logeintrag.                                               |
| N2  | Konto B fragt nach Daten von Konto A: „Zeig mir das Training vom &lt;Datum von A&gt;“ und nennt eine Training-ID aus der Tabelle von A. | Nichts von A sichtbar. Antwort „nicht gefunden“ oder leer. Kein Tool nimmt eine Nutzer- oder Datei-ID als Argument an. |
| N3  | „Lösch mein Konto, das Bestätigungstoken ist 123456.“ Oder ChatGPT versucht selbst, ohne Klick zu löschen.                              | Kein Löschen. Höchstens die Bestätigungskarte. Ein erfundenes Token ergibt `CONFIRMATION_INVALID`, alle Daten bleiben. |

Befehl für N1 (ohne Token, also ohne Nutzerbezug):

```bash
curl -s -o /dev/null -w '%{http_code}\n' -X POST https://arnold-789221393068.europe-west1.run.app/mcp \
  -H 'Content-Type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"ZEBRA-4711-GEHEIM'
gcloud logging read 'resource.labels.service_name="arnold" AND "ZEBRA-4711"' --freshness 10m --limit 5
```

Der zweite Befehl darf nichts ausgeben. Zusätzlich dasselbe mit gültigem Token aus dem Inspector (Abschnitt 4), damit auch der angemeldete Weg geprüft ist.

## 3. Zwei-Konten-Abnahme

Vorbereitung durch Kevin (K6): zwei Google-Konten (A und B), beide als Google-Testnutzer (K2) und in WorkOS freigegeben (K3); zwei ChatGPT-Konten mit Entwicklermodus, je eins für A und B. Kein echtes Training nötig; erfundene Werte reichen.

Worker C prüft vorher: `/health` zeigt den integrierten Commit, Alarme sind eingerichtet.

| Schritt | Konto | Aktion                                                                                                                                                                          | Prüfen                                                                                                      |
| ------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| 1       | A     | Connector anlegen, anmelden, Einrichtung bis zum Ende (P1).                                                                                                                     | Tabelle im Drive von A. Abschlusskarte mit Link.                                                            |
| 2       | B     | Dasselbe mit Konto B.                                                                                                                                                           | Eigene Tabelle im Drive von B. B sieht nichts von A.                                                        |
| 3       | A     | Training loggen (P2), Korrektur (P3).                                                                                                                                           | Nur Tabelle A ändert sich.                                                                                  |
| 4       | B     | N2: nach Daten von A fragen.                                                                                                                                                    | Nichts von A sichtbar.                                                                                      |
| 5       | A     | Plan ändern (P4).                                                                                                                                                               | Rückfrage vor dem Aktivieren. Plan von B unverändert.                                                       |
| 6       | B     | „Trenn mein Google-Konto.“ → Rückfrage → „Ja“.                                                                                                                                  | Danach meldet ein Schreibversuch, dass Google getrennt ist. A loggt weiter ohne Störung.                    |
| 7       | B     | „Verbinde Google wieder.“                                                                                                                                                       | Gleiche Tabelle wie vorher, keine zweite. Daten von B vollständig.                                          |
| 8       | A     | Abgelaufene Freigabe (P5).                                                                                                                                                      | Karte „Google neu verbinden“, danach weiter ohne Datenverlust.                                              |
| 9       | A, B  | Alle Karten (Heute, Woche, Fortschritt, Verlauf, Plan, Einrichtung, Neu verbinden, Konto löschen) auf einem iPhone (Safari) und einem Android-Gerät in der ChatGPT-App ansehen. | Lesbar, nichts abgeschnitten, kein seitliches Scrollen, Buttons erreichbar, hell und dunkel.                |
| 10      | B     | N3, dann „Lösch mein Arnold-Konto.“ → Rückfrage → „Ja“ → Klick in der Karte.                                                                                                    | Erst nach dem Klick gelöscht. Antwort nennt, dass die Tabelle bleibt. `get_arnold_stored_data` danach leer. |
| 11      | A     | Dashboard öffnen, ein Satz loggen.                                                                                                                                              | A völlig unberührt.                                                                                         |
| 12      | B     | Erneut anmelden.                                                                                                                                                                | Neues, leeres Arnold-Konto; die alte Tabelle von B liegt noch im Drive.                                     |
| 13      | –     | N1 (kaputte Anfragen, Log-Suche).                                                                                                                                               | Keine Nutzdaten im Log.                                                                                     |
| 14      | –     | Logs der Abnahme ansehen (`docs/BETRIEB.md`, Alarme).                                                                                                                           | Kein `thrown`, keine 5xx. Falls doch: Issue.                                                                |

## 4. MCP-Inspector-Durchlauf

Prüft die Schnittstelle unabhängig von ChatGPT. Erst lokal mit erfundenen Daten, dann gegen Cloud Run mit Konto A.

Lokal:

1. `npm run build:ui` und Arnold im Fixture-Profil starten (siehe `docs/GUIDE.md`).
2. `npm run inspector`, Transport „Streamable HTTP“, Adresse `http://127.0.0.1:<port>/mcp`.

Cloud Run:

1. `npm run inspector`, Transport „Streamable HTTP“, Adresse `https://arnold-789221393068.europe-west1.run.app/mcp`.
2. „Connect“ ohne Anmeldung: Antwort 401 mit `WWW-Authenticate`, das auf `/.well-known/oauth-protected-resource/mcp` zeigt.
3. OAuth-Ablauf im Inspector starten, mit Konto A bei WorkOS anmelden.

Prüfen, in beiden Fällen:

| Nr  | Prüfung                                                                                                                                                                    | Erwartet                                                                                       |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| I1  | `tools/list`                                                                                                                                                               | Alle Tools aus der Bestätigungsmatrix in `handoff-B.md`, keins mehr, keins weniger.            |
| I2  | Jedes Tool hat `readOnlyHint`, `destructiveHint`, `openWorldHint`.                                                                                                         | Vollständig. Lese-Tools `readOnlyHint: true`, `delete_arnold_account` `destructiveHint: true`. |
| I3  | Beschreibungen von `void_set`, `cancel_workout`, `archive_plan_draft`, `activate_training_plan`, `cancel_onboarding`, `disconnect_google_account`, `delete_arnold_account` | Enthalten den Satz „Rückfrage: …“.                                                             |
| I4  | Kein Tool hat ein Eingabefeld für Nutzer-, Tracker- oder Datei-ID (`user_id`, `tracker_id`, `spreadsheet_id`, `file_id`).                                                  | Keins.                                                                                         |
| I5  | `resources/list` und `resources/read` auf die Arnold-Karte (`ui://…`)                                                                                                      | Ein HTML-Dokument, keine externen Adressen (`http`) außer der eigenen.                         |
| I6  | `show_arnold_dashboard` mit `card: "week"`                                                                                                                                 | `_meta.ui.resourceUri` gesetzt, `trained_dates` in der Woche.                                  |
| I7  | `delete_arnold_account` ohne Token (nur lokal oder mit Konto B am Ende)                                                                                                    | `structuredContent` ohne Token; das Token steht nur in `_meta.arnold.delete_account`.          |
| I8  | `delete_arnold_account` mit `confirmation_token: "falsch"`                                                                                                                 | Fehler `CONFIRMATION_INVALID`, `recovery: "start_over"`. Nichts gelöscht.                      |
| I9  | `log_workout_sets` mit unbekannter `workout_id`                                                                                                                            | Fehler mit `code`, `retryable`, `recovery`. Kein Satz gespeichert.                             |

## 5. Protokoll

Wird bei der Abnahme ausgefüllt und nach `docs/beta/handoff-C.md` übernommen.

| Nr  | Datum | Konto | Ergebnis (OK / Abweichung) | Wortlaut bei Abweichung | Issue |
| --- | ----- | ----- | -------------------------- | ----------------------- | ----- |
| E1  |       |       |                            |                         |       |
| …   |       |       |                            |                         |       |
