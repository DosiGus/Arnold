# Arnold für Garmin – Produktanforderungen (PRD)

Stand: 9. November 2026 · Verantwortlich: Claude (Lead Developer), Produkt: Kevin · Status: freigegeben zur Umsetzung

Technischer Bauplan: [UMSETZUNG.md](UMSETZUNG.md). Recherche mit Quellen: [recherche/BERICHT.md](recherche/BERICHT.md).

## 1. Worum es geht

Arnold plant das Training im Chat. Im Studio liegt das Handy aber in der Tasche, und ChatGPT lädt nach dem Entsperren neu. Deshalb bekommt Arnold eine eigene App auf der Garmin-Uhr. Sie führt Übung für Übung durch das geplante Training, mit Pausen, Hinweisen und Anpassungen per Taste. Am Ende speichert sie alles in Arnold. In ChatGPT sieht man das Training danach wie jedes andere, ergänzt um die Messwerte der Uhr.

**Der Kreislauf:** Plan im Chat → Training am Handgelenk → Ergebnisse und Messwerte zurück → Arnold schlägt das nächste Training vor.

Die App ist kein Ersatz für Arnold in ChatGPT. Sie ist das Werkzeug für die Ausführung. Planen, Auswerten und Beraten bleiben im Chat.

## 2. Getroffene Entscheidungen

| Thema              | Entscheidung                                                                                                                                                                                               | Wer / wann                                   |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| Umfang             | Fertiges Produkt v1.0, kein MVP. Intern trotzdem in Bauabschnitten mit Abnahme.                                                                                                                            | Kevin, 09.11.                                |
| Uhren              | Forerunner 255/255s/255 Music/255s Music, 265/265s, 955, 965, Fenix 7/7S/7X. Alles mit fünf Tasten; Touch wird nicht gebraucht.                                                                            | Kevin, 09.11.                                |
| Messwerte          | Alles erfassen, was die Uhr hergibt, vor, während und nach dem Training. Speicherung nur mit eingeschalteter Einwilligung; bei Kevin an. Der Datenschutztext ist Pflicht vor dem öffentlichen Store-Start. | Kevin, 09.11.; Einwilligungsschalter: Claude |
| Sprachen           | Deutsch und Englisch, die Uhr folgt der Systemsprache.                                                                                                                                                     | Kevin, 09.11.                                |
| Veröffentlichung   | Connect IQ Store, kostenlos, nur mit Arnold-Konto nutzbar. Bezahlung später über Arnold selbst.                                                                                                            | Kevin, 09.11.                                |
| Garmin-Server-APIs | Werden nicht gebraucht (keine Health, Training oder Personal API). Die App spricht direkt mit Arnold.                                                                                                      | Recherche, 08.11.                            |
| Kopplung           | Code auf der Uhr, bestätigt in ChatGPT. Arnold gibt ein eigenes, widerrufbares Uhr-Token aus.                                                                                                              | Claude, 09.11.                               |
| Einheit            | Kilogramm. Pfund ist nicht Teil von v1.0.                                                                                                                                                                  | Claude, 09.11.                               |

## 3. Nutzer und Situation

- **Hauptnutzer:** trainiert zwei- bis fünfmal pro Woche Kraft im Studio, plant mit Arnold in ChatGPT und trägt eine Garmin-Uhr.
- **Situation:** Studio, oft ohne Netz im Keller. Das Handy liegt im Spind oder in der Tasche, die Hände sind verschwitzt, man hat zwischen den Sätzen 60 bis 180 Sekunden Zeit.
- **Erwartung:** Ein Blick auf die Uhr zeigt, was jetzt dran ist. Ein Tastendruck reicht, wenn es wie geplant lief. Nichts geht verloren.

## 4. Nutzerwege

### 4.1 Uhr koppeln (einmalig)

1. Die App wird aus dem Connect IQ Store installiert und gestartet.
2. Die Uhr zeigt „Mit Arnold verbinden“ und einen Code, z. B. `K7Q4-M2XP`, 10 Minuten gültig.
3. Der Nutzer sagt in ChatGPT: „Verbinde meine Uhr, Code K7Q4-M2XP.“ Arnold zeigt eine Karte mit Uhrenmodell und Bestätigen-Knopf.
4. Nach der Bestätigung zeigt die Uhr „Verbunden“ und lädt den Plan.
5. In ChatGPT kann der Nutzer jederzeit seine Uhren sehen und trennen. Eine getrennte Uhr verliert den Zugriff sofort.

### 4.2 Training starten

1. Beim Öffnen zeigt die App das nächste Training aus dem aktiven Plan, z. B. „Push A · 6 Übungen · ca. 55 min“.
2. START beginnt dieses Training. Mit HOCH und RUNTER lässt sich ein anderer Trainingstag aus dem Plan wählen.
3. Der Plan liegt auf der Uhr. Das Training startet auch ohne Handy und ohne Netz.
4. Beim Start zeichnet die Uhr eine Krafttraining-Aktivität für Garmin Connect auf und hält die Werte „vor dem Training“ fest (Kapitel 6).

### 4.3 Durch das Training geführt werden

- **Übungsvorschau:** Name, Sätze × Wiederholungen, Gewicht, Pause, Hinweis (Planhinweis oder „Heute +2,5 kg“ aus der Progression).
- **Satzansicht:** „Satz 2 von 4“, groß „8 × 60 kg“, dazu Puls live und ein Hinweis wie „Letztes Mal 8, 8, 7“.
- **Satz wie geplant:** START. Der Satz ist gespeichert und die Pause beginnt.
- **Satz anders gelaufen:** RUNTER öffnet „Anpassen“: Gewicht und Wiederholungen mit HOCH und RUNTER, START bestätigt. Danach fragt die Uhr einmal: „Für die restlichen Sätze übernehmen?“
- **Pause:** großer Countdown, darunter der nächste Satz. HOCH und RUNTER ändern die Pause um 15 Sekunden, START beendet sie vorzeitig. Zehn Sekunden vor Schluss kommt ein kurzer Hinweis, am Ende Vibration und Ton.
- **Übung fertig:** automatisch weiter zur nächsten Übungsvorschau.
- **Menü (HOCH halten):** Übung überspringen · Übung tauschen · Satz hinzufügen · Satz entfernen · Hinweise · Training beenden.
- **Korrektur:** HOCH in der Satzansicht zeigt alle Sätze der Übung. Ein erledigter Satz lässt sich auswählen und korrigieren.
- **Versehentliches Verlassen:** ZURÜCK fragt „Training pausieren?“. Wird die App beendet oder stürzt ab, bietet sie beim nächsten Start „Training fortsetzen“ an, an genau derselben Stelle.

### 4.4 Training abschließen

1. Nach der letzten Übung, oder über „Training beenden“, kommt die Zusammenfassung:
   - Dauer, Sätze erledigt / geplant, Übungen, Ø- und Max-Puls, Kalorien.
   - Änderungen gegenüber dem Plan („2 Sätze angepasst, 1 Übung getauscht“).
2. START speichert. Die Aktivität landet in Garmin Connect, das Training geht an Arnold.
3. Sobald Arnold geantwortet hat, ergänzt die Uhr eine zweite Seite: neue Rekorde und der Vorschlag fürs nächste Mal („Bankdrücken nächstes Mal 62,5 kg“).
4. Ist kein Handy erreichbar, zeigt die Uhr „Auf der Uhr gespeichert · wird gesendet, sobald das Handy da ist“. Das ist kein Fehler.

### 4.5 In ChatGPT ansehen

- Das Training erscheint im Verlauf und auf der Startansicht wie jedes andere, markiert mit „Von der Uhr“.
- Die Detailansicht zeigt zusätzlich:
  - Dauer und tatsächliche Pausen gegenüber den geplanten.
  - Pulsverlauf mit Ø und Max.
  - Body Battery und Stress vor und nach dem Training, sofern die Uhr sie liefert.
- Der Coach kann diese Werte nutzen: „Deine Body Battery war vor dem Training bei 28, deshalb waren die letzten Sätze schwer.“
- Ändern und Rückgängig machen funktioniert wie bei jedem Training; die Messwerte bleiben beim Training.

## 5. Funktionale Anforderungen

Priorität: **M** = Muss für v1.0, **S** = Soll für v1.0, darf bei Zeitnot in v1.1.

### Kopplung und Konto

| ID   | Anforderung                                                                                                                                     | Prio |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------------- | ---- |
| G-01 | Die Uhr fordert einen Kopplungscode an und zeigt ihn mit Ablaufzeit.                                                                            | M    |
| G-02 | Die Kopplung wird in ChatGPT mit dem angemeldeten Arnold-Konto bestätigt. Die Nutzer-ID kommt nur aus dem geprüften Login.                      | M    |
| G-03 | Die Uhr erhält ein eigenes Token, das nur die Uhr-Schnittstelle öffnet: Plan lesen, Training und Messwerte speichern. Es öffnet niemals `/mcp`. | M    |
| G-04 | Uhren auflisten und trennen in ChatGPT; die Trennung wirkt beim nächsten Aufruf. Die Uhr kann sich auch selbst abmelden.                        | M    |
| G-05 | Codes sind gegen Durchprobieren geschützt: Ablaufzeit, Versuchsgrenze, Ratenbegrenzung.                                                         | M    |
| G-06 | Kontolöschung und „Gespeicherte Daten anzeigen“ umfassen Uhren, Aufzeichnungen und Messwerte.                                                   | M    |

### Plan auf der Uhr

| ID   | Anforderung                                                                                                                                                                                | Prio |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---- |
| P-01 | Die Uhr lädt den aktiven Plan mit allen Trainingstagen und markiert den nächsten Tag (gleiche Regel wie die Startansicht).                                                                 | M    |
| P-02 | Je Übung kommen die Werte von Arnolds Vorschlag (Progression, sonst letztes Mal, sonst Planziel), dazu Pause, Hinweise, Gewichtsschritt und die Darstellung der Last (z. B. „pro Hantel“). | M    |
| P-03 | Fehlt ein Gewicht, zeigt die Uhr „Gewicht wählen“, mit 0 kg vorausgewählt aber nie stillschweigend gespeichert. Unbekannte Last bleibt unbekannt.                                          | M    |
| P-04 | Der Plan wird auf der Uhr gespeichert; Training ist ohne Verbindung möglich. Die Uhr zeigt, wie aktuell der Plan ist.                                                                      | M    |
| P-05 | Ein Plan, der während eines laufenden Trainings in ChatGPT geändert wird, ändert dieses Training nicht.                                                                                    | M    |
| P-06 | Der Plan wird beim Öffnen und im Hintergrund aktualisiert, ohne unnötige Übertragung (nur wenn geändert).                                                                                  | S    |
| P-07 | Für „Übung tauschen“ liefert Arnold je Übung bis zu drei passende Alternativen mit eigenem Vorschlag.                                                                                      | M    |
| P-08 | „Übung hinzufügen“ aus den zuletzt trainierten Übungen.                                                                                                                                    | S    |

### Trainingsplayer

| ID   | Anforderung                                                                                                                                                                     | Prio |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- |
| T-01 | Geführter Ablauf: Übungsvorschau → Satz → Pause → … → Zusammenfassung.                                                                                                          | M    |
| T-02 | Ein Tastendruck bestätigt einen Satz wie angezeigt.                                                                                                                             | M    |
| T-03 | Gewicht und Wiederholungen je Satz anpassen; Übernahme für die restlichen Sätze anbieten.                                                                                       | M    |
| T-04 | Erledigte Sätze nachträglich korrigieren; letzten Satz rückgängig machen.                                                                                                       | M    |
| T-05 | Übung überspringen, tauschen, Satz hinzufügen und entfernen.                                                                                                                    | M    |
| T-06 | Pausentimer nach Plan, anpassbar um ±15 s, vorzeitig beendbar; Vorwarnung und Ende per Vibration und Ton. Der Timer rechnet mit Zeitstempeln und stimmt auch nach einem Hänger. | M    |
| T-07 | Hinweise: Planhinweis, Progressionshinweis, letztes Mal, einseitige Übungen („Links“, „Rechts“, „je Seite“).                                                                    | M    |
| T-08 | Puls live in Satz- und Pausenansicht.                                                                                                                                           | M    |
| T-09 | Pausieren und Fortsetzen; nach Absturz oder Neustart an derselben Stelle fortsetzen.                                                                                            | M    |
| T-10 | Zusammenfassung vor dem Speichern; Verwerfen nur mit doppelter Bestätigung.                                                                                                     | M    |
| T-11 | Zweite Seite der Zusammenfassung mit Arnolds Antwort (Rekorde, nächster Vorschlag).                                                                                             | S    |
| T-12 | Einstellungen: Vibration an/aus, Ton an/aus, Vorwarnung an/aus.                                                                                                                 | S    |

### Aufzeichnung und Messwerte

| ID   | Anforderung                                                                                                                                                      | Prio |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- |
| H-01 | Die Uhr zeichnet eine Garmin-Aktivität „Krafttraining“ auf (Puls, Kalorien, Dauer), mit einer Runde pro Satz.                                                    | M    |
| H-02 | Während des Trainings: Pulsverlauf, Satzbeginn und -ende, tatsächliche Pausen.                                                                                   | M    |
| H-03 | Vor und nach dem Training: Body Battery, Stress, Ruhepuls und alle weiteren Werte, die das Gerät nachweislich liefert (Liste aus der Gerätematrix, Abschnitt 6). | M    |
| H-04 | Messwerte gehen nur an Arnold, wenn die Einwilligung des Kontos aktiv ist. Ohne Einwilligung lehnt der Server sie ab, und die Uhr sendet nur das Training.       | M    |
| H-05 | Fehlt ein Wert auf einem Gerät, wird er als „nicht verfügbar“ behandelt, nie als 0.                                                                              | M    |
| H-06 | Arnold berechnet Kennzahlen (Ø/Max-Puls, Zeit in Zonen, Pausentreue) selbst aus den Rohwerten. Uhr und Karten rechnen nichts nach.                               | M    |
| H-07 | Satzdaten zusätzlich als Entwicklerfelder in der FIT-Aktivität (Wiederholungen, Gewicht je Runde), soweit Garmin Connect sie anzeigt.                            | S    |

### Synchronisierung

| ID   | Anforderung                                                                                                                     | Prio |
| ---- | ------------------------------------------------------------------------------------------------------------------------------- | ---- |
| S-01 | Jeder bestätigte Satz ist sofort auf der Uhr gespeichert, bevor die Anzeige weiterspringt.                                      | M    |
| S-02 | Nach „Speichern“ sendet die Uhr das Training in einem Aufruf. Wiederholte Sendungen erzeugen nie ein zweites Training.          | M    |
| S-03 | Klappt das Senden nicht, versucht die Uhr es beim nächsten Öffnen, im Hintergrund und über „Jetzt senden“ erneut.               | M    |
| S-04 | Hat der Nutzer dasselbe Training am selben Tag schon im Chat gespeichert, fragt die Uhr: „Trotzdem speichern“ oder „Verwerfen“. | M    |
| S-05 | Status jederzeit sichtbar: „Alles gesendet“ oder „1 Training wartet“.                                                           | M    |
| S-06 | Messwerte werden getrennt vom Training gesendet; ein Fehler dort blockiert nie das Training.                                    | M    |

### ChatGPT-Seite

| ID   | Anforderung                                                                                                                               | Prio |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------- | ---- |
| C-01 | Neue Tools: Uhr koppeln, Uhren anzeigen, Uhr trennen, Messwerte-Einwilligung setzen. Jedes mit Zugriffsklasse.                            | M    |
| C-02 | Verlauf und Startansicht kennzeichnen Uhr-Trainings. Die Trainingsdetails zeigen Dauer, Pausen, Puls und Werte vor und nach dem Training. | M    |
| C-03 | Der Coach-Skill kennt die neuen Werte und nennt nur veröffentlichte Tools.                                                                | M    |
| C-04 | „Gespeicherte Daten anzeigen“ listet Uhren und Messwerte; Kontolöschung entfernt alles.                                                   | M    |

## 6. Messwerte: was die Uhr liefern kann

Die Spalte „Stand“ zeigt, ob Garmins Dokumentation den Wert für die FR255 bestätigt. Alles mit „prüfen“ wird im Bauabschnitt B0 auf deiner Uhr gemessen und in `docs/garmin/GERAETE-MATRIX.md` festgehalten. Nur was dort bestätigt ist, wird gebaut.

| Wert                                      | Zeitpunkt          | Quelle in Connect IQ                  | Stand                              |
| ----------------------------------------- | ------------------ | ------------------------------------- | ---------------------------------- |
| Puls live                                 | während            | `Sensor` / `Activity.Info`            | dokumentiert                       |
| Pulsverlauf                               | vor, während, nach | `SensorHistory.getHeartRateHistory`   | dokumentiert                       |
| Body Battery                              | vor, nach          | `SensorHistory.getBodyBatteryHistory` | dokumentiert; Verlaufslänge prüfen |
| Stress                                    | vor, nach          | `SensorHistory.getStressHistory`      | dokumentiert; Verlaufslänge prüfen |
| Kalorien, Dauer                           | während            | `Activity.Info`                       | dokumentiert                       |
| Schritte, Intensitätsminuten des Tages    | vor                | `ActivityMonitor.Info`                | prüfen                             |
| Ruhepuls                                  | vor                | `UserProfile`                         | prüfen                             |
| Sauerstoffsättigung, Temperatur           | vor, nach          | `SensorHistory`                       | prüfen                             |
| Erholungszeit, VO2max, Trainingseffekt    | nach               | `Complications` / `Activity.Info`     | prüfen                             |
| Schlaf, HRV-Status, Trainingsbereitschaft | –                  | keine Connect-IQ-Schnittstelle        | nicht verfügbar                    |

## 7. Nicht-funktionale Anforderungen

| Bereich         | Anforderung                                                                                                                                                             |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Zuverlässigkeit | Kein bestätigter Satz geht verloren, auch nicht bei Absturz, leerem Akku oder Flugmodus. Kein Training wird doppelt gespeichert.                                        |
| Offline         | Nach dem Laden des Plans läuft das ganze Training ohne Handy.                                                                                                           |
| Geschwindigkeit | App-Start bis Trainingsvorschau aus dem Speicher unter 3 Sekunden; Tastendruck bis Anzeige unter 300 ms.                                                                |
| Akku            | Ziel: höchstens 8 % pro Trainingsstunde mit Puls und Aufzeichnung auf der FR255; wird in B0 gemessen und dann als Grenze festgelegt.                                    |
| Speicher        | Höchstens 70 % des App-Speichers des jeweiligen Geräts in der Spitze.                                                                                                   |
| Lesbarkeit      | Hauptzahl in der Satzansicht mindestens ein Drittel der Displayhöhe; hoher Kontrast, im Sonnenlicht auf MIP lesbar.                                                     |
| Sicherheit      | Uhr-Token zufällig (256 Bit), nur als Hash gespeichert, nie geloggt, sofort widerrufbar, nur Uhr-Rechte. Schreibrechte der Uhr nur für Training und Messwerte.          |
| Datenschutz     | Messwerte nur mit Einwilligung; löschbar; in „Gespeicherte Daten“ sichtbar. Vor dem öffentlichen Start: Datenschutztext, Einwilligungskarte, Prüfung nach DSGVO Art. 9. |
| Sprache         | Deutsch und Englisch, auch für Texte, die Arnolds Server an die Uhr schickt.                                                                                            |
| Wartbarkeit     | Layouts relativ zur Displaygröße; ein Code für alle Geräte; Gerätefunktionen werden zur Laufzeit geprüft.                                                               |

## 8. Bewusst nicht in v1.0

- Touch-Bedienung, Zifferblatt, Datenfelder für andere Aktivitäten.
- Pläne auf der Uhr erstellen oder dauerhaft ändern; das bleibt in ChatGPT.
- Aufwärmsätze, RIR/RPE, Supersätze und Zirkel als eigene Abläufe.
- Pfund als Einheit.
- Schlaf, HRV und Trainingsbereitschaft (nur über Garmins Health API möglich, eigener Antrag).
- Andere Hersteller (Apple Watch, Wear OS).
- Bezahlung über Garmin.

## 9. Erfolg messen

- **Dogfooding (Kevin):** 12 Trainings in Folge mit der Uhr, kein verlorener Satz, kein Doppel. Bei Trainings nach Plan höchstens ein Tastendruck pro Satz. Das Handy wird im Training nicht gebraucht.
- **Nach Store-Start:** Anteil gekoppelter Nutzer, die in den ersten zwei Wochen mindestens drei Trainings mit der Uhr machen. Anteil der Uploads, die im ersten Versuch ankommen (Ziel über 90 %) und innerhalb von 24 Stunden (Ziel 100 %).
- **Fehlerbudget:** keine Datenverlust-Meldung; Absturzrate unter 1 % der Trainings (Garmin-Absturzberichte im Developer-Dashboard).

## 10. Abnahme v1.0 (Definition of Done)

1. Alle **M**-Anforderungen erfüllt und durch Tests oder das Geräteprotokoll belegt.
2. `npm run check` grün; Uhr-App baut für alle Zielgeräte ohne Warnungen des Typprüfers; Uhr-Tests grün.
3. Geräteprotokoll auf der FR255 vollständig (UMSETZUNG.md, Abschnitt 9). Die übrigen Geräte sind im Simulator geprüft, und mindestens ein Tester mit einer AMOLED-Uhr (265/965) hat ein echtes Training gemacht.
4. Sicherheitsprüfung: fremde Daten nie sichtbar, Uhr-Token auf `/mcp` abgewiesen, getrennte Uhr sofort ausgesperrt, keine Tokens in Logs.
5. Datenschutztext, Einwilligungskarte und Store-Eintrag (de/en) fertig; Kevin hat den Store-Eintrag freigegeben.
6. Betrieb: Alarme für die Uhr-Routen aktiv; Ratenbegrenzung aktiv; Deploy und Migration nach `docs/BETRIEB.md` durchgeführt.
