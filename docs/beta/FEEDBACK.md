# Arnold-Beta – Feedback, Fehler und Abschlussbefragung

C9. Entscheidung über den Kanal trifft Kevin (K9).

## 1. Feedback-Kanal während der zwei Wochen

**Empfehlung: ein kurzes Google-Formular plus eine E-Mail-Adresse.**

- **Formular „Arnold: Fehler oder Idee“** mit fünf Feldern: Art (Fehler / Idee / Frage), Was hast du gemacht?, Was ist passiert?, Wann ungefähr?, Bildschirmfoto (optional). Link in der Tester-Anleitung und auf `/support`.
- **E-Mail-Adresse** für alles, was nicht ins Formular passt, und für Löschanfragen. Antwort werktags innerhalb von 24 Stunden.
- Kevin (oder Worker C) schaut einmal am Tag ins Formular und legt pro Fehler ein GitHub-Issue an (Abschnitt 3). Tester brauchen kein GitHub-Konto.

Warum so: Zehn Tester, zwei Wochen. Ein Formular sammelt Fehler vollständig und an einer Stelle, ohne dass jemand Gruppenchats mitlesen muss. Die E-Mail fängt den Rest auf.

Alternativen:

| Kanal                        | Vorteil                                 | Nachteil                                                               |
| ---------------------------- | --------------------------------------- | ---------------------------------------------------------------------- |
| Nur E-Mail                   | Kein neues Werkzeug                     | Unvollständige Berichte, mehr Nachfragen                               |
| WhatsApp- oder Signal-Gruppe | Schnell, Tester helfen sich gegenseitig | Fehler gehen im Verlauf unter; Tester sehen Telefonnummern der anderen |
| GitHub-Issues direkt         | Kein Abtippen                           | Tester brauchen ein Konto; das Repository ist privat                   |

Datenschutz: Das Formular liegt in Kevins Google-Konto. Im Datenschutzhinweis unter „Beta-Befragung“ nennen, sobald entschieden.

## 2. Abschlussbefragung

Nach 14 Tagen, etwa 10 Minuten, freiwillig. Gleiches Werkzeug wie der Feedback-Kanal (Google-Formular). Skala 1–5: 1 = stimme gar nicht zu, 5 = stimme voll zu.

| Nr  | Frage                                                                                                                        | Art                                                                     |
| --- | ---------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| 1   | An wie vielen Tagen hast du in den zwei Wochen mit Arnold trainiert?                                                         | Zahl                                                                    |
| 2   | Hat Arnold das Loggen deines Trainings leichter gemacht als vorher?                                                          | 1–5, dazu: Wie hast du vorher geloggt? (Papier, App, gar nicht, …)      |
| 3   | Wie bist du mit der Einrichtung (Anmelden, Fragen, Plan, Google verbinden) zurechtgekommen?                                  | 1–5, dazu: Wo bist du hängen geblieben?                                 |
| 4   | Hast du Sätze lieber im Chat geschrieben oder in der Karte eingetragen?                                                      | Chat / Karte / beides gleich                                            |
| 5   | Welche Karte war unklar oder hat dich gestört? (Heute, Woche, Fortschritt, Verlauf, Plan, Einrichtung, Google neu verbinden) | Mehrfachauswahl + Freitext: Was genau?                                  |
| 6   | Hat ChatGPT dich verstanden, wenn du ein Training beschrieben hast?                                                          | 1–5, dazu: Ein Beispiel, wo nicht?                                      |
| 7   | Hat Arnold dich zu oft oder zu selten nachgefragt, bevor etwas gespeichert wurde?                                            | zu oft / passt / zu selten                                              |
| 8   | War die Frage nach „Wiederholungen im Tank“ verständlich?                                                                    | 1–5                                                                     |
| 9   | Hat dir der vorgeschlagene Trainingsplan gepasst?                                                                            | 1–5, dazu: Was hast du geändert?                                        |
| 10  | Hat das Neu-Verbinden mit Google nach etwa 7 Tagen geklappt?                                                                 | ja, ohne Probleme / ja, mit Problemen / nein / kam nicht vor            |
| 11  | Vermisst du Körpergewicht in Arnold?                                                                                         | ja, sehr / ein bisschen / nein                                          |
| 12  | Vermisst du Kardio (Laufen, Rad, Rudern) in Arnold?                                                                          | ja, sehr / ein bisschen / nein                                          |
| 13  | Hast du Arnold auch am Handy genutzt? Wie gut ging das?                                                                      | nicht genutzt / 1–5                                                     |
| 14  | Würdest du Arnold nach der Beta weiter nutzen? Was wäre es dir im Monat wert?                                                | ja / vielleicht / nein + Betrag (0 €, bis 3 €, bis 5 €, bis 10 €, mehr) |
| 15  | Was ist das Eine, das wir als Nächstes verbessern sollten?                                                                   | Freitext                                                                |

Fragen 11 und 12 beantworten Entscheidung D1. Frage 14 ist eine erste Orientierung für D2 nach der Beta, keine Zusage.

## 3. Fehlerablauf über GitHub-Issues

Labels im Repository `DosiGus/Arnold`:

| Label         | Bedeutung                                       | Geht an                                                  |
| ------------- | ----------------------------------------------- | -------------------------------------------------------- |
| `beta-bug`    | Etwas funktioniert nicht oder speichert falsch. | A (Karte, Darstellung) oder B (Speichern, Tools, Google) |
| `beta-ux`     | Funktioniert, ist aber unklar oder umständlich. | A, bei Chat-Formulierungen B                             |
| `beta-wunsch` | Neue Funktion oder Erweiterung.                 | Sammeln, nach der Beta bewerten                          |

Ablauf:

1. Bericht kommt über Formular oder E-Mail.
2. Issue anlegen: Titel in einem Satz, dann „Was gemacht“, „Was passiert“, „Was erwartet“, Zeitpunkt, Gerät. **Keine Namen, E-Mail-Adressen oder Trainingswerte der Tester** ins Issue; Bildschirmfotos vorher schwärzen. Statt des Namens: Tester-Nummer (T01–T10).
3. Label setzen und dem Worker zuweisen. Ein `beta-bug`, der Speichern verhindert oder Daten falsch schreibt, ist dringend: am selben Tag ansehen.
4. Behoben: Commit nennt das Issue, Deploy nach `docs/BETRIEB.md` (ruhige Zeit, angekündigt), Tester kurz informieren.
