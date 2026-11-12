# Design: Arnold

Neutraler Trainingsbegleiter im ChatGPT-Chat: klare Aktionen, echter Fortschritt. Einsteiger werden geführt, Erfahrene erfassen schnell. Chat und Sprache tragen Wünsche und Änderungen; Karten machen nächste Aktion, Ziele und Verlauf greifbar. Dies ist die einzige Designquelle; kein zweites Design-Dokument anlegen. Die Werte (Farben, Schrift, Radien, Abstände) stehen als CSS-Variablen in `src/ui/styles/base.css`, `cards.css` und `dashboard.css` (gebündelt in `src/ui/style.css`) und werden nicht hier wiederholt.

## Grundsätze

- **Monochrom.** Nur Graustufen, in beiden Host-Themes. Erfolg, Warnung, Auswahl und Fortschritt entstehen aus Text, Symbol, Kontur und Füllung, nie aus Buntfarbe.
- **Flach.** Deckende Karten mit feiner Kontur, kein Schatten, kein Blur, keine Glasflächen. Hierarchie durch Raster, Abstand und Typografie. Einzige Ausnahme: der modale Plan-Dialog.
- **Eine Frage pro Karte.** Die Übersicht gibt der nächsten Handlung den meisten Raum; Detailkarten behandeln eine Aufgabe mit sichtbarem Rückweg („Zur Übersicht“). Keine App-Shell, keine globalen Tabs, keine inneren Scrollflächen.
- **Hell/Dunkel vom Host.** Kein Theme-Schalter, keine externen Schriften oder Bilder: ein Bundle, ein HTML-Dokument. Systemschrift, mittleres Gewicht für Titel und Kontrollen, große Zahlen leichter.
- **Ehrliche Daten.** Einheiten und Lastdefinition stehen bei der Zahl („20 kg pro Hantel“). Unbekannt ist nicht 0. Dezimalkomma, deutsche Datumsformate („7. Apr.“, „7. April 2026“), tabellarische Ziffern. Die UI rechnet nichts nach.

## Layout

Chat-Karte höchstens 44rem breit, Vollbildeditoren 64rem. Die Übersicht ist ein Sechs-Spalten-Raster: Training (vier Spalten, zwei Zeilen), Woche und Demo-Scores (je zwei), darunter Ziele (vier) und Rekorde (zwei). Bis 36rem zweispaltig, bis 21rem einspaltig. Keine Liste „Letzte Trainings“ auf der Übersicht; „Trainingsentwicklung ansehen“ bleibt eine ruhige Aktion unter dem Raster.

## Bausteine

- **Knöpfe:** pro Karte höchstens eine Hauptaktion (Ink auf On-Ink, Pille) und eine zweite (Soft); weitere Wege als Textlinks. Mindestens 2,75rem hoch, Icon-Knöpfe ebenso breit. Sofortige Druckrückmeldung. „Gespeichert“ erscheint erst nach bestätigtem Schreiben.
- **Chips:** Kontur im Normalzustand, ausgewählt Ink; `aria-pressed` oder beschriftetes natives Feld; dürfen umbrechen.
- **Karten:** `ArnoldCard`, `CardActions`, `ChipGroup`, `Stepper`, `Rows`, `CardNote`, `CardSkeleton` sind die gemeinsamen Bausteine.
- **Felder:** beschriftete native Inputs. Zahlen direkt eintippbar (Plus/Minus ergänzt nur). Fehlertexte in Alltagssprache, Eingaben bleiben erhalten.
- **Navigation:** Widget-Titel, Zeilen und Aktionen öffnen die Detailkarte. Ein Rekord öffnet exakt sein Training (`workout_id`), ein Ziel exakt sein Detail (`goal_id`); Anfrage und angezeigte Einheit dürfen nie auseinanderfallen.
- **Bewegung:** nur als Bestätigung einer Aktion; `prefers-reduced-motion` gilt. Keine Eintrittsanimation beim Wiederöffnen, keine künstlichen Wartezeiten.

## Übersicht

- **Training:** nächstes Training mit Vorschlägen und bis zu vier Übungszeilen, sonst ehrlicher Leerzustand; nach Abschluss die gespeicherte Einheit. „Noch ein Training“ startet bewusst frisch.
- **Woche:** echte Trainingstage und Wochenziel; zwei Einheiten an einem Tag zählen als ein Trainingstag.
- **Demo-Scores:** feste, illustrative Werte (Konstanz 92, Recovery 72, Progress 77). Titel, jedes Label und die Beschreibung nennen „Demo“; nie als berechnet darstellen.
- **Ziele:** die ersten vier mit Fortschritt, Ist- und Zielwert. Null-Fortschritt und unbekannter Fortschritt sind verschieden.
- **Rekorde:** Karussell der drei neuesten, Hauptzahl mit Lastdefinition, Datum und Position.

## Detailkarten (die Semantik der Daten bleibt unverändert)

- **Training:** `proposals` aus `get_workout`. Der Umschalter „Arnolds Vorschlag · Wie letztes Mal“ stellt die Werte um, „So gemacht“ speichert genau diese über `log_workout`. Fehlendes Gewicht wird nicht geraten. Tausch nur für heute, Weglassen mit Zurückholen und Hinzufügen bleiben. Der Entwurf wird gemeinsam gespeichert. Kein Timer, keine RIR-Abfrage.
- **Gespeichert:** dieselbe Karte zeigt den bestätigten Stand; Rückgängig braucht einen zweiten ausdrücklichen Klick.
- **Ziele:** gelieferter Fortschritt, Kurve und Prognose sind maßgeblich; Ziel beenden braucht den zweiten Tipp.
- **Fortschritt:** eine Übung, eine Hauptzahl, `selected_comparison`; Kurven nur aus gelieferten Messpunkten in echten Zeitabständen.
- **Verlauf/Rekorde:** Filter, Aufklappen und „mehr laden“; Zeitraum, Plan und Status filtert der Server.
- **Plan:** Änderungen am aktiven Plan gehen über einen neuen Entwurf; Aktivierung bestätigt die gezeigte Version und Revision.
- **Einrichtung:** Phasen Angaben, Wünsche, Prüfen, Plan mit Zurück, Neuladen und Abbrechen. Persönliche Angaben freiwillig.

## Rückmeldung und Datenschutz

- Die sechs `recovery`-Werte haben gemeinsame verständliche Texte; keine Fehlercodes, IDs oder Revisionen in Fehlermeldungen.
- Bleibt eine Antwort aus, bleiben `request_id` und Eingaben erhalten; „Erneut versuchen“ sendet denselben Vorgang (auch nach Neuladen), nie einen zweiten.
- Werte über 500 kg oder 100 Wiederholungen brauchen „Stimmt das?“ (`confirm_unusual_values: true`).
- „Konto löschen“ nennt den Umfang inklusive Trainingsdaten. Das Bestätigungstoken kommt nur aus `_meta`, bleibt im App-Zustand und gelangt nie in den Modellkontext.
- Jede Ansicht meldet ihren Zustand still über `ui/update-model-context`. Sichtbare Chat-Nachrichten nur bei echten Übergängen (Plan erstellt, Training abgeschlossen).

## Barrierefreiheit und Sprache

Native Beschriftungen, sichtbarer Fokus (2px Kontur, 3px Abstand), `role="switch"` mit `aria-checked`, angekündigte Fehler und Statuswechsel, Diagramme für Screenreader zugänglich, Dialoge halten den Fokus und schließen mit Escape. Du-Form, kurze Sätze, konkrete Aktionen. Begriffe: Training (eine Einheit), Trainingstag (ein Kalendertag), Satz, Arbeitssatz, Aufwärmsatz, Übung, Plan, Entwurf. Keine technischen Details im normalen Bedienfluss.

## Do und Don't

- Do: vorhandene Tokens und flache Karten verwenden; Einheiten, Lastdefinition und unbekannte Werte ehrlich zeigen; Trainings-, Ziel- und Rekordidentität bei jeder Navigation erhalten; Hell/Dunkel, schmale Ansicht, 720px, Tastatur und reduzierte Bewegung am gerenderten Ergebnis prüfen.
- Don't: farbige Akzente, Glasflächen, Flammen oder Trophäen; Demo-Scores als echte Werte; Backend-Vergleiche, Vorschläge oder Schreibsemantik für eine optische Vereinfachung ändern; technische IDs oder Tokens zeigen; einen Schreibvorgang vor der Serverantwort bestätigen.

Browser- und AppBridge-Prüfungen ersetzen keine Abnahme auf einem iPhone in der ChatGPT-App.
