# Design: Arnold

Neutraler Trainingsbegleiter im ChatGPT-Chat: klare Aktionen, echter Fortschritt. Einsteiger werden geführt, Erfahrene erfassen schnell. Das Gespräch ist das Zentrum: Wünsche und Änderungen laufen über Chat und Sprache, Karten erscheinen nur, wenn sie etwas zeigen oder bestätigen. Dies ist die einzige Designquelle; kein zweites Design-Dokument anlegen. Die Werte (Farben, Schrift, Radien, Abstände) stehen als CSS-Variablen in `src/ui/styles/base.css`, `cards.css` und `dashboard.css` (gebündelt in `src/ui/style.css`) und werden nicht hier wiederholt.

## Grundsätze

- **Gespräch zuerst.** Eine Karte hat immer eine Aufgabe: etwas zeigen oder etwas bestätigen. Was sich im Chat sagen lässt, braucht keine Karte.
- **Graustufen plus eine Akzentfarbe.** Grün (`--ac-ok-*`) steht ausschließlich für Erfolg, einen neuen Rekord und positiven Status. Ein Warnton (`--ac-warn-*`) steht nur für „fehlt noch“ und „noch nicht auf deiner Uhr“. Alles andere bleibt grau. Keine weiteren Buntfarben, keine Flammen, keine Trophäen. Farbe trägt nie allein die Bedeutung: Text oder Symbol stehen immer dabei.
- **Flach.** Deckende Karten mit feiner Kontur, kein Schatten, kein Blur, keine Glasflächen. Hierarchie durch Raster, Abstand und Typografie. Einzige Ausnahme: der modale Plan-Dialog.
- **Eine Frage pro Karte.** Detailkarten behandeln eine Aufgabe mit sichtbarem Rückweg („Zur Übersicht“). Keine App-Shell, keine globalen Tabs, keine inneren Scrollflächen.
- **Hell/Dunkel vom Host.** Kein Theme-Schalter, keine externen Schriften oder Bilder: ein Bundle, ein HTML-Dokument. Systemschrift, mittleres Gewicht für Titel und Kontrollen, große Zahlen leichter.
- **Ehrliche Daten.** Einheiten und Lastdefinition stehen bei der Zahl („20 kg pro Hantel“). Unbekannt ist nicht 0. Dezimalkomma, deutsche Datumsformate („7. Apr.“, „7. April 2026“), tabellarische Ziffern. Die UI rechnet nichts nach.

## Vier Kartenarten

Jede Karte trägt oben ein kleines Etikett (`CardTag`), das sagt, was sie ist: „Verstanden“, „Vorschlag“, „Änderung“, „Anpassung auf Zeit“ oder „Status“. Bausteine liegen in `src/ui/components/conversation-cards.tsx`; eine Beispielseite mit allen Zuständen öffnet sich lokal unter `/preview?kit=1` und dient Tests und Abnahme, nicht den Nutzern.

- **Verstanden** (`UnderstoodRows`): Arnold gibt wieder, was er verstanden hat, als Zeilen Label und Wert. Fehlt etwas, zeigt die Zeile sichtbar „fehlt noch“ (Warnton); Screenreader hören es genauso. Lücken werden nie geraten oder aufgefüllt.
- **Vorschlag und Änderung** (`ChangeRow`): Bei Änderungen steht nur der Unterschied: alter Wert durchgestrichen, Pfeil, neuer Wert („vorher …“, „jetzt …“ für Screenreader), darunter „Alles andere bleibt gleich.“ Ein neuer Vorschlag zeigt seine Zeilen ohne Gegenüberstellung.
- **Bestätigen** (`ConfirmAction`): höchstens ein Hauptknopf, optional ein ruhiger zweiter. Erst der Klick löst aus; vorher ist nichts gespeichert. Zustände: bereit, läuft, „Bestätigt“, „Nicht übernommen“, Fehler. „Bestätigt“ erscheint erst, wenn der Aufrufer Erfolg meldet, also nach der Antwort des Servers.
- **Status** (`StatusLines`): zwei getrennte Zeilen. „Gespeichert“ steht nur, wenn das Schreiben bestätigt ist. Die Uhrzeile steht nur, wenn sie wahr ist: „Auf deiner Uhr angekommen“ (Grün) oder „Noch nicht auf deiner Uhr“ (Warnton). Ist keine Uhr verbunden oder der Stand unbekannt, gibt es keine Uhrzeile; „angekommen“ erscheint nie ohne Beleg.
- **Sag-Hinweis** (`SayHint`): eine ruhige Zeile „Sag zum Beispiel: „…““ unter einer Karte, die zeigt, wie man im Gespräch weitermacht.

## Layout

Chat-Karte höchstens 44rem breit, Vollbildeditoren 64rem. Die Übersicht ist eine einzige Karte: oben die schmale Kopfzeile „Als Nächstes“, darunter vier gleich große Kacheln (Woche, Scores, Ziele, Rekorde), darunter bei geöffneter Kachel ihr Detail, am Ende die vier Aktionsknöpfe unter der Karte. Die Kacheln stehen ab 36rem in einer Reihe, darunter zu zwei Spalten, bei 375 px ohne horizontales Scrollen. Keine Liste „Letzte Trainings“ auf der Übersicht; „Trainingsentwicklung ansehen“ bleibt eine ruhige Aktion unter den Kacheln.

## Bausteine

- **Knöpfe:** pro Karte höchstens eine Hauptaktion (Ink auf On-Ink, Pille) und eine zweite (Soft); weitere Wege als Textlinks. Mindestens 2,75rem hoch, Icon-Knöpfe ebenso breit. Sofortige Druckrückmeldung. „Gespeichert“ und „Bestätigt“ erscheinen erst nach bestätigtem Schreiben.
- **Chips:** Kontur im Normalzustand, ausgewählt Ink; `aria-pressed` oder beschriftetes natives Feld; dürfen umbrechen.
- **Karten:** `ArnoldCard`, `CardActions`, `ChipGroup`, `Stepper`, `Rows`, `CardNote`, `CardSkeleton` sind die gemeinsamen Grundbausteine, die vier Kartenarten bauen darauf auf.
- **Felder:** beschriftete native Inputs. Zahlen direkt eintippbar (Plus/Minus ergänzt nur). Fehlertexte in Alltagssprache, Eingaben bleiben erhalten.
- **Navigation:** Widget-Titel, Zeilen und Aktionen öffnen die Detailkarte. Ein Rekord öffnet exakt sein Training (`workout_id`), ein Ziel exakt sein Detail (`goal_id`); Anfrage und angezeigte Einheit dürfen nie auseinanderfallen.
- **Bewegung:** nur als Bestätigung einer Aktion; `prefers-reduced-motion` gilt. Keine Eintrittsanimation beim Wiederöffnen, keine künstlichen Wartezeiten.

## Übersicht

Die Übersicht öffnet sich immer zuerst, wenn der Nutzer nur „@Arnold“ sagt. Das nächste Training steht als schmale Kopfzeile, darunter die vier Kacheln. Tippen auf eine Kachel klappt ihr Detail in derselben Karte auf (immer nur eine offen, erneutes Tippen schließt; `aria-expanded`, per Tastatur bedienbar). Das Detail zeigt nur, was der View liefert, dazu einen Sag-Hinweis und einen ruhigen Textlink in die tiefe Ansicht. Unter der Karte stehen vier Aktionsknöpfe (einer als Hauptknopf): „Nächstes Training“, „Plan ändern“, „Urlaub oder Ausnahme“, „Ziel anpassen“. Jeder schickt wörtlich einen festen Satz in den Chat; nimmt der Chat ihn nicht an, öffnet der Knopf die passende Karte, bei „Urlaub oder Ausnahme“ erscheint ein Hinweis. Wer kein Laufprofil hat, sieht zusätzlich die ruhige Zeile „Ich will auch laufen“.

- **Kopfzeile:** nächstes Training (Name, Übungszahl, „Arnolds Vorschlag“) und nächster Lauf, sonst ehrlicher Leerzustand; nach Abschluss die gespeicherte Einheit. Kein Uhr-Status, solange es keinen belegten gibt. „Noch ein Training“ startet bewusst frisch.
- **Woche:** Kachel mit Ring; Detail mit den Wochentagen. Echte Trainingstage und Wochenziel; zwei Einheiten an einem Tag zählen als ein Trainingstag.
- **Scores:** feste, illustrative Werte (Konstanz 92, Recovery 72, Progress 77). Titel, jedes Label und die Beschreibung nennen „Demo“; nie als berechnet darstellen.
- **Ziele:** Kachel mit Anzahl; Detail mit den ersten vier mit Fortschritt, Ist- und Zielwert, jedes öffnet exakt sein Ziel. Null-Fortschritt und unbekannter Fortschritt sind verschieden.
- **Rekorde:** Kachel mit dem neuesten; Detail mit den drei neuesten samt Lastdefinition und Datum, jede Zeile öffnet exakt ihr Training; ohne Rekorde „Noch keine Rekorde“. Ein neuer Rekord darf grün markiert sein.

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

Native Beschriftungen, sichtbarer Fokus (2px Kontur, 3px Abstand), `role="switch"` mit `aria-checked`, angekündigte Fehler und Statuswechsel, Diagramme für Screenreader zugänglich, Dialoge halten den Fokus und schließen mit Escape. Grün und Warnton erreichen in Hell und Dunkel ausreichend Kontrast und stehen nie ohne Text. Du-Form, kurze Sätze, konkrete Aktionen. Begriffe: Training (eine Einheit), Trainingstag (ein Kalendertag), Satz, Arbeitssatz, Aufwärmsatz, Übung, Plan, Entwurf. Keine technischen Details im normalen Bedienfluss.

## Do und Don't

- Do: vorhandene Tokens und flache Karten verwenden; Etikett an jede Karte; Lücken als „fehlt noch“ zeigen; bei Änderungen nur den Unterschied; Einheiten, Lastdefinition und unbekannte Werte ehrlich zeigen; Trainings-, Ziel- und Rekordidentität bei jeder Navigation erhalten; Hell/Dunkel, schmale Ansicht, 720px, Tastatur und reduzierte Bewegung am gerenderten Ergebnis prüfen.
- Don't: Farbe außer der einen Akzentfarbe für Erfolg/Rekord/Status und dem Warnton für Lücken und fehlende Uhr; Glasflächen, Flammen oder Trophäen; „Gespeichert“, „Bestätigt“ oder „Auf deiner Uhr angekommen“ ohne Beleg; Demo-Scores als echte Werte; Backend-Vergleiche, Vorschläge oder Schreibsemantik für eine optische Vereinfachung ändern; technische IDs oder Tokens zeigen.

Browser- und AppBridge-Prüfungen ersetzen keine Abnahme auf einem iPhone in der ChatGPT-App.
