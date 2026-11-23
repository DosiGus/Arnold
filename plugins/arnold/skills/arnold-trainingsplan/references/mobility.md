# Mobility und Morgenroutine: Ablauf

Kurz und zum Nachschlagen. Die Regeln dazu stehen in `SKILL.md` (Abschnitt „Mobility und Morgenroutine“) und in `references/trainingswissenschaft.md`, Abschnitt 8. Der Server prüft und rechnet; du wählst Übungen und Platz.

## Was der Nutzer wollen kann

Gespeichert im Profil (`update_mobility_profile`, `get_mobility_overview` zeigt es):

- Nein: `wants: false`. Das gilt endgültig, nicht noch einmal fragen.
- Ja, mit einer Morgenroutine (Wochentage `mon` … `sun`, 5, 10 oder 15 Minuten) und/oder Mobility-Einheiten (`own_days`, `after_strength` oder `arnold_decides`; 1 bis 3 pro Woche; 15, 20 oder 30 Minuten) und steifen Bereichen.
- Ohne Details und mit Ja gelten die Vorgaben des Werkzeugtexts: Morgenroutine alle sieben Tage, 10 Minuten; zwei Einheiten pro Woche, 20 Minuten; Arnold entscheidet.

## Ablauf nach der Einrichtung („Ich will auch Mobility“)

1. Fehlt der Wunsch im Profil: Karte `show_arnold_mobility` mit `card: "mobility_setup"` oder kurz fragen und `update_mobility_profile` mit der Antwort des Nutzers aufrufen (neue `request_id`).
2. `get_training_plan` und `get_plan_editor_context` (dort steht der Mobility-Katalog), dann `create_plan_version` vom aktiven Plan.
3. `update_plan_draft` mit `add_mobility_session` je Routine.
4. `validate_training_plan` mit `timezone`, dann `compare_plan_versions`, dann die Karte `show_arnold_dashboard` mit `card: plan_change`. Ein Satz dazu. Aktiviert wird nur nach Knopf oder Ja.

## Ablauf in der Einrichtung

Der Brief hat dann `mobility` und `mobility_catalog`. Erst den Kraftvorschlag mit `submit_onboarding_plan_proposal` senden. Danach über `get_onboarding_plan` und `update_plan_draft` mit `add_mobility_session` in denselben Entwurf. Nichts noch einmal abfragen, was im Brief steht.

## Operationen von `update_plan_draft`

| Operation                 | Wofür                                                                                             |
| ------------------------- | ------------------------------------------------------------------------------------------------- |
| `add_mobility_session`    | Neue Routine: `kind` (`morning` oder `session`), `session_name`, `minutes`, `exercise_ids`, Platz |
| `update_mobility_session` | Name, Minuten, Übungen oder Platz einer Routine ändern (`session_id`)                             |
| `remove_mobility_session` | Eine Routine entfernen (`session_id`)                                                             |

Sekunden, Haltezeiten und Wiederholungen schickst du nie mit: Arnold berechnet sie aus den Übungen und den Minuten.

## Platzierung

- Morgenroutine: `kind: "morning"`, an eigenen Tagen (`weekdays`, ISO, 1 = Montag), Minuten 5, 10 oder 15. Nie nach einer Krafteinheit.
- Einheit an einem eigenen Tag: `kind: "session"`, `placement: "own_day"`, genau ein Wochentag, Minuten 15, 20 oder 30.
- Einheit nach dem Kraft�training: `kind: "session"`, `placement: "after_strength"`, `after_session_id` der Krafteinheit, kein Wochentag.
- „Arnold entscheidet“: ein Tag ohne Krafttraining; ist keiner frei, nach dem Krafttraining.
- Bei mehr als einer Einheit pro Woche bekommt jede einen eigenen Tag bzw. eine eigene Krafteinheit und einen eigenen Namen nach dem Inhalt („Hüfte lösen“, „Schultern und Nacken“), ohne Wochentag.

## Übungswahl

- Nur `exercise_id` aus dem Mobility-Katalog (Brief oder `get_plan_editor_context`), nie erfinden.
- Zuerst Übungen für die steifen Bereiche des Nutzers (Nacken, Schultern, oberer Rücken, unterer Rücken, Hüfte, Beinrückseite, Waden und Sprunggelenke, Handgelenke). Ohne Angabe eine ausgewogene Mischung.
- Morgens nur Übungen mit `morning_ok`.
- Eine Übung höchstens einmal pro Routine; so viele, wie in die Minuten passen, nie mehr als 15.
- Steif ist keine Diagnose. Keine medizinischen Aussagen, keine Heilversprechen.

## Erledigt melden

„Morgenroutine gemacht“ ist Loggen und gehört nicht zu diesem Skill: sofort `log_mobility`, ohne Coaching. `minutes` nur, wenn der Nutzer sie nennt. Mobility ist keine Trainingslast und kein Trainingstag.

## Schmerz

Nennt der Nutzer Schmerz, die Routine abbrechen und nichts speichern. Keine Diagnose, keine Behandlung; bei anhaltendem Schmerz zu Ärztin, Arzt oder Physiotherapie raten.
