# Arnolds Daten lesen

Stand 1.0 (November 2026). Alle Zahlen kommen aus der Arnold-Auswertung auf dem Server. Du rechnest nichts nach und ergänzt nichts.

## Grundregeln

- `null`, `status: "not_available"` oder ein leeres Feld heißt **unbekannt**, nie 0. Begründungen stehen in `note`, `reasons` oder `data_quality.notes`.
- `data_quality.analyzable: false`: Es gibt noch zu wenig auswertbare Daten. Dann keine Aussage zum Fortschritt, sondern sagen, was fehlt (meist einfach weitere Trainings).
- Lasten sind nur innerhalb derselben Ausführungsart und Lastangabe vergleichbar. Bei Kurzhanteln ist das Gewicht meist pro Hantel angegeben (`load_basis: "per_implement"`).
- Kalenderdaten sind lokale Daten des Nutzers.

## `get_arnold_dashboard`

| Feld                      | Bedeutung                                                                                                                                                               |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `home.next_session`       | Die nächste Einheit laut Plan                                                                                                                                           |
| `home.streak`             | Wochenziel (`weekly_goal` = Trainingstage des Plans), aktuelle und längste Serie in Wochen, Trainingstage der letzten Wochen                                            |
| `home.strength_change`    | Durchschnittliche Kraftveränderung in Prozent seit `since`, über `exercises` Übungen                                                                                    |
| `home.muscle_groups`      | Je Muskelgruppe: `sets_per_week` (direkte Arbeitssätze pro Woche, Mittel der letzten 28 Tage, nach der groben Muskelgruppe der Übung), `strength_change_pct`, `records` |
| `home.records`, `records` | Bestleistungen mit Datum                                                                                                                                                |
| `home.goals`              | Ziele mit Fortschritt und, wenn berechenbar, `eta_weeks`                                                                                                                |
| `home.latest_body_weight` | Letztes eingetragenes Körpergewicht                                                                                                                                     |
| `kpis`                    | Kennzahlen des Zeitraums mit `value`, `status`, `note`                                                                                                                  |
| `exercises`               | Übungen mit `exercise_id`, `logged_sets`, `last_trained_on`                                                                                                             |
| `data_quality`            | Ob und wie gut die Daten auswertbar sind                                                                                                                                |

`sets_per_week` zählt nur direkte Sätze nach der Katalog-Muskelgruppe. Mittrainierte Muskeln (Trizeps beim Bankdrücken) fehlen darin. Vergleiche mit dem Volumenrahmen aus `trainingswissenschaft.md` deshalb nur grob.

## `get_arnold_exercise_progress`

- Kennzahlen: `max_load` (größte vergleichbare Last), `estimated_1rm` (geschätztes Maximum nach Epley, eine Schätzung, kein Test), `nominal_volume`, `total_reps`, `mean_reps_per_working_set`.
- `comparisons`: erster gegen letzten Messpunkt je Kennzahl, nur innerhalb derselben Vergleichsklasse.
- `variants`: verschiedene Ausführungen werden getrennt geführt; nicht miteinander vergleichen.
- `empty: true`: im Zeitraum kein auswertbarer Satz.

## `get_arnold_workouts` → Trainings von der Garmin-Uhr

- `from_watch: true`: das Training wurde auf der Garmin-Uhr aufgezeichnet. Es ist ein normales Training; Ändern und Korrigieren funktioniert wie immer.
- `watch` gibt es nur, wenn eine Aufzeichnung vorliegt: `duration_s` (Dauer), `rest` (tatsächliche Pausen `actual_s` gegen geplante `planned_s`, nur vollständig gemessene Pausen).
- `watch.health` nur mit Einwilligung des Nutzers, sonst `null`: `heart_rate` (`average_bpm`, `max_bpm`), `calories_kcal`, `before` und `after` (`body_battery`, `stress`, `resting_hr`), `differences` (nachher minus vorher).
- Body Battery und Stress sind Schätzungen der Uhr, keine Messung von Gesundheit. Für Krafttraining gibt es keine Pulszonen. Für Läufe gelten die Zonen aus `get_run_profile` (Abschnitt „Läufe“).

## `get_workout` → `progression`

| `decision`    | Bedeutung                                                           | typischer `reason`            |
| ------------- | ------------------------------------------------------------------- | ----------------------------- |
| `increase`    | Eine Gewichtsstufe mehr, zurück an die Untergrenze                  | `all_sets_at_top`             |
| `more_reps`   | Gleiches Gewicht, eine Wiederholung mehr pro Satz                   | `building_reps`               |
| `top_reached` | Obergrenze erreicht, aber kein Gewicht zum Steigern (Körpergewicht) | `all_sets_at_top`             |
| `reduce`      | Etwa 10 % leichter, an der Untergrenze neu aufbauen                 | `missed_range` oder `stalled` |

- `change_kg`: Gewichtsänderung pro Satz gegenüber dem letzten Mal.
- `last_sets`, `last_date`: worauf die Empfehlung beruht.
- `stalled_sessions`: Einheiten in Folge ohne Fortschritt beim gleichen Gewicht. Ab 3 senkt Arnold das Gewicht.
- Ohne Wiederholungsbereich, ohne Verlauf oder bei unbekanntem Gewicht gibt es keine Empfehlung; dann gelten die Werte vom letzten Mal.

So erklären: „Letztes Mal hast du alle Sätze mit 10 Wiederholungen geschafft, also oben im Bereich. Deshalb geht Arnold 2,5 kg hoch und startet wieder bei 8.“

## Prüfliste bei Stillstand

1. **Ist es Stillstand?** Mindestens drei Einheiten der Übung ohne mehr Gewicht oder Wiederholungen, oder drei bis vier Wochen ohne Anstieg bei `max_load` oder `estimated_1rm`. Steigen die Wiederholungen beim gleichen Gewicht, ist das Fortschritt.
2. **Regelmäßigkeit:** Erreicht der Nutzer sein Wochenziel (`home.streak.weeks`)? Lücken sind die häufigste Ursache.
3. **Volumen:** Liegt `sets_per_week` der Muskelgruppe deutlich unter dem Rahmen für seine Erfahrung?
4. **Progression:** Steht schon `reduce` an? Dann ist der Ausweg geplant: leichter, sauber, neu aufbauen.
5. **Gewichtssprünge:** Bei Kurzhanteln oder Maschinen ist die nächste Stufe oft ein großer Sprung. Mehr Wiederholungen vor dem nächsten Sprung sind dann normal.
6. **Erst danach fragen** (höchstens zwei Fragen): Schlaf, Stress, genug essen, Beschwerden.

Mögliche Vorschläge, höchstens zwei:

- Dranbleiben und Arnolds Empfehlung folgen, auch wenn sie leichter ist.
- Regelmäßiger trainieren, bevor etwas am Plan geändert wird.
- Ein, zwei Sätze mehr für die Muskelgruppe (Planänderung mit Entwurf und Ja).
- Nach langem Stillstand eine Variante tauschen (z. B. Bankdrücken gegen Kurzhantel-Bankdrücken für einige Wochen).

## Läufe

Läufe haben eigene Werkzeuge. Alle Kennzahlen kommen fertig von Arnold; Krafttraining steht in denselben Antworten daneben. `value: null` mit `reason` ist unbekannt, nie 0. Alle Aufrufe mit `timezone`.

- **`get_run_profile`**: Revision, Ziel, Wettkampfdatum, Referenzleistung (gültig oder nicht), Erfahrung, daraus abgeleitet VDOT (Leistungszahl) und Tempozonen, dazu, was noch fehlt. Fehlt etwas, sag das und verweise auf arnold-trainingsplan (dort wird das Profil ergänzt). Nichts davon nachrechnen.
- **`get_run_analysis`** mit `view`: `run` (ein Lauf, `workout_id`), `week` (Woche um `date`, sonst heute) oder `four_weeks`. Liefert Tempo, Kilometerzeiten, Bestzeiten, Zeit in Zonen, Belastung, Wochenumfang, Erfüllung des Plans, Trend und das 7:28-Verhältnis (Belastung der letzten 7 Tage im Verhältnis zu den letzten 28 Tagen; ein Hinweis auf den Verlauf, keine Aussage über Gesundheit).
- **`get_run_week`**: Woche Montag bis Sonntag mit Laufen und Kraft: geplant, erledigt, verpasst, die Laufeinheiten des aktiven Plans mit Stufe und Arnolds nächste Vorschläge (nur Vorschau, nichts gespeichert) und Hinweise (`notes`), etwa harter Lauf am Beintag oder gekürzte Einheit.
- Pulswerte und Zonenzeiten: nur vorhanden, wenn der Nutzer in die Gesundheitsdaten eingewilligt hat und ein Pulsgurt oder die Uhr sie geliefert hat. Sonst `null` mit Grund; dann gibt es sie nicht, und du sprichst nicht von Puls. Nie medizinisch deuten.
- Ein Lauf ist erst ab etwa drei Läufen oder drei Wochen ein Trend. Vorher sagen, dass es noch zu früh ist.
- Nur Gleiches vergleichen: lockere mit lockeren Läufen, gleiche Umgebung (Strecke, Laufband, Bahn).

So erklären: „Diese Woche hast du drei von vier geplanten Läufen gemacht. Der lange Lauf fehlt noch; Arnold hat ihn auf Sonntag gelegt.“
