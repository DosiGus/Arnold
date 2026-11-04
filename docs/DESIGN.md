# Arnold – Designregeln

Arnold ist ein Trainingsbegleiter im Chat. Karten helfen beim Entscheiden, Eingeben und Nachsehen. Die Unterhaltung bleibt der Ort für Wünsche, Rückfragen und Änderungen in eigenen Worten.

Die Grundlage ist der [Apple-Design-Skill von Emil Kowalski](https://github.com/emilkowalski/skills/blob/main/skills/apple-design/SKILL.md): direkte Reaktion, vertraute Bedienung, klare Hierarchie, zurückhaltende Materialien und verständliche Rückmeldung. Wir übernehmen passende Prinzipien in die Chat-Karten; Gestenphysik oder weitere Bibliotheken sind für diese Abläufe nicht erforderlich.

## Gemeinsames System

- `src/ui/style.css` ist der einzige Einstieg für Styles; er bindet die Bereiche aus `src/ui/styles/` ein (Basis, Karten, Start, Einrichtung, Plan-Editor, Training), und Vite fügt alles in das eine Bundle ein. Der lokale Test-Host hat ein eigenes, getrenntes Stylesheet.
- `components/cards.tsx` enthält `ArnoldCard`, `CardActions`, `ChipGroup`, `Stepper`, `Rows`, `StatGrid`, `CardNote` und `CardSkeleton`. Die Karten verwenden diese Bausteine. Der Vollbildeditor nutzt dieselben Tokens und Bedienelement-Maße.
- Hell und Dunkel kommen aus dem Host. Die eigenständige Vorschau verwendet beim Öffnen das System-Theme. Kein Theme-Schalter in der Karte, keine externen Schriften oder Assets.
- Flächen und Schrift sind weitgehend achromatisch. Ein helles Grün (`--ac-accent`) kennzeichnet Fortschritt und bestätigten Erfolg; Balken, Punkte und Ringe nutzen `--ac-accent-fill`, das im hellen Modus dunkler ist (mindestens 3:1 zur Kachel), Rot eine Warnung oder destruktive Aktion. Eine Auswahl ist durch Füllung und Semantik erkennbar, auch ohne Farbe.

## Tokens und Maße

Die semantischen Farb-Tokens sind `--bg`, `--text`, `--muted`, `--card`, `--surface-strong`, `--soft`, `--hover`, `--border`, `--ink`, `--on-ink`, `--focus` und `--chart`. Zustandstöne verwenden `--ac-good` und `--ac-bad`.

Das Kartenraster verwendet `--ac-pad: 1rem`, `--ac-radius: 1.25rem`, `--ac-radius-inner: .875rem` und `--ac-tap: 2.75rem`. Das ergibt bei Standardschrift mindestens 44 CSS-Pixel hohe und breite Bedienelemente. Abstände skalieren mit der Schrift. Der Karteninhalt bleibt bis 375 Pixel Breite und bei 200 Prozent Grundschrift ohne horizontalen Überlauf zugänglich.

Die Schrift ist die Systemschrift. Titel, Fließtext und Nebeninformationen unterscheiden sich durch Größe, Gewicht und Zeilenhöhe; große Zahlen haben eine enge Laufweite. Zahlen verwenden tabellarische Ziffern. Lange Übungsnamen brechen um und werden nicht abgeschnitten.

## Kartenregeln

Eine Karte beantwortet eine Frage. Unten stehen höchstens zwei Hauptaktionen; eine leise Textaktion ist möglich. Umfangreiche Trainingsdaten und Planbearbeitung gehören in eine vollständige Ansicht. Inline-Karten enthalten keine Reiter, sichtbaren Tabellen oder eigenen Scrollbereiche. Einzige Navigation: die Kacheln der Startansicht öffnen ihre Ansicht, die oben einen Zurück-Knopf hat.

Fokus-Stil: oben eine kleine Kopfzeile (wo bin ich, ggf. Fortschrittsbalken und Drei-Punkte-Knopf oder Zurück), darunter ein großer Titel, große Zahlen mit enger Laufweite, Knöpfe mit 52 px Höhe. Grün (`--ac-accent`) heißt neu und verdient: Haken, Serie, neuester Rekord, Zielbalken. Höchstens ein grünes Abzeichen pro Karte; weitere Hinweise (Bestwert, Spitzenreiter, ältere Rekorde) bleiben neutral (`ac-pill muted`).

- **Startansicht:** öffnet, wenn Arnold ohne konkrete Frage gestartet wird; `week` ist ein älterer Name dafür. Titel „Heute: <nächste Einheit>“, „Heute geschafft“ oder ohne Plan „Dein Training“, darunter der Wochenstand. Vier Kacheln, jede eine Zusammenfassung und ein Knopf: Training (Wochentage und nächste Einheit, „Training starten“ öffnet `today`, leise Textaktion „Plan bearbeiten“), Fortschritt (Serie und Einheiten im Jahr), Ziele (zwei Balken), Rekorde (die drei neuesten; Name bis zwei Zeilen, Wert darunter in einer Zeile).
- **Fortschritt (Kachel):** Serie wie bei einer Lauf-App: Flamme, Zahl, acht Wochen als Kreise, die laufende Woche als Ring. Darunter Einheiten im Jahr, „stärker seit“ und bester Monat, dann Muskelgruppen umschaltbar nach Fortschritt, Rekorden und Sätzen pro Woche, jeweils mit Erklärung, wie gerechnet wird.
- **Ziele:** Balken von Start- zu Zielwert, Detail mit Kurve, gestrichelter Ziellinie und Prognose. Gewicht eintragen und Ziel ändern direkt in der Karte; Ziel beenden braucht einen zweiten Tipp. Neues Ziel in drei Schritten (Art, Übung, Zielwert).
- **Rekorde:** neueste zuerst nach Monat oder nach Muskelgruppe und Übung; ein Rekord klappt seinen Verlauf auf. Zuerst zwölf, mehr auf Wunsch.
- **Training (Heute):** Arnold ist kein Tracker, durch den man sich klickt. „Training starten“ zeigt den Trainingstag mit einer Zeile je Übung: Sätze × Wiederholungen · Gewicht, vom letzten Mal, sonst aus dem Plan (`proposals` aus `get_workout`). Unten „So gemacht“ (speichert alles mit `log_workout`) und „Anpassen“; darunter der Hinweis, dass Änderungen auch im Chat gehen. Fehlt ein Gewicht, heißt der Hauptknopf „Werte eintragen“; nichts wird geraten. Ein anderer Trainingstag ist eine leise Textaktion.
- **Anpassen:** je Übung Sätze (Plus/Minus), Wiederholungen und Gewicht als getippte Felder, wahlweise Satz für Satz. Tauschen (nur für heute, das Volumen bleibt, das Gewicht ist neu), Weglassen mit Zurückholen, Übung hinzufügen. Gespeichert wird der ganze Entwurf auf einmal.
- **Gespeichert:** dieselbe Karte zeigt, was gespeichert ist, und höchstens einen neuen Rekord. „Zur Übersicht“ und „Bearbeiten“ (ersetzt das Training in einem Schritt), leise „Rückgängig“ (zweiter Tipp) und „Noch ein Training eintragen“. Speichern in der Karte schickt eine kurze Chat-Nachricht. Sagt der Nutzer im Chat, was er gemacht hat, speichert Arnold sofort und zeigt danach diese Karte.
- **Laufend:** ein im Chat Satz für Satz begonnenes Training zeigt die eingetragenen Sätze mit „Training abschließen“ und „Verwerfen“. Es gibt keinen Pausen-Timer und keine Frage nach Wiederholungen in Reserve; das kommt mit einem späteren Anfänger-Modus.
- **Wochenstreifen:** Trainingstage kommen aus `training_days`, Haken aus `trained_dates`. Zwei Trainings am selben Tag ergeben einen Trainingstag. Arbeitssätze und letzter Rekord haben Vorrang vor einer unkommentierten Volumenzahl.
- **Fortschritt:** eine Übung, eine Hauptzahl, ein fertiger Vergleich aus `selected_comparison`, eine kleine Kurve. Lastdefinition, Ausführung und Seite bleiben sichtbar. Die Kurve enthält nur gelieferte Messpunkte mit echten zeitlichen Abständen. Die UI berechnet keine Differenz.
- **Verlauf:** wenige ruhige Zeilen im Chat. Die vollständige Liste und einzelne Trainings öffnen im Vollbild, mit denselben Inhalten als Fallback im Dokumentfluss. Sätze bleiben lesbare Zeilen mit Lastdefinition, Seite und Satztyp. Zeitraum, Plan und Status werden serverseitig gefiltert. Eine angeforderte Einheit wird niemals durch eine andere ersetzt.
- **Plan:** kurzer Überblick über die Trainingstage. Die ausführliche Ansicht und Bearbeitung sind im Vollbild. Ein aktiver Plan wird über einen neuen Entwurf verändert. Aktivierung bleibt eine ausdrückliche Bestätigung der angezeigten Version und Revision.
- **Einrichtung:** oben Phase, Balken in vier Abschnitten (Angaben, Wünsche, Prüfen, Plan), Zurück und drei Punkte (Stand neu laden, Einrichtung abbrechen). Ablauf: Begrüßung mit zwei Wegen, „Über dich“ auf einer Karte (Alter, Größe und Gewicht direkt eintippen, leer erlaubt, Dezimalkomma, Geschlecht und Bereiche aufklappbar, alles freiwillig), vier Fragen (Ziel mit Mehrfachauswahl, Erfahrung, wie oft und wie lange auf einer Karte mit freier Minutenzahl, Ort), dann die Wünsche als eigener, freiwilliger Schritt mit aufklappbaren Bereichen und einem Freitext, dann „So wird dein Plan“ mit einem Satz in Alltagssprache und Stift je Zeile. Feste Wochentage gibt es nur in der gewählten Anzahl. Nach der Bestätigung zeigt die Karte die nächste Einheit und das Startgewicht mit Weg zu den Zielen.
- **Konto löschen:** Aufruf aus dem Chat. Die Karte nennt alles, was gelöscht wird, auch die Trainingsdaten. Das Bestätigungstoken bleibt ausschließlich im App-Zustand, kommt aus `_meta` und verlässt die Karte nur durch den ausdrücklichen Löschklick. Abgelaufene Tokens werden neu angefordert.

## Zustände und Rückmeldung

Alle sechs `recovery`-Werte besitzen gemeinsame, verständliche Texte. Technische Fehlercodes, interne IDs und Revisionen bleiben aus sichtbaren Fehlermeldungen heraus. Ein fachlicher Fehler nennt zusätzlich die verständliche Serverbegründung. Beispielsweise bleibt bei einer ungültigen Wiederholungsspanne der Einstellungsdialog mit beiden Werten geöffnet.

Ein Druck wird direkt sichtbar. „Training gespeichert“ folgt ausschließlich einem bestätigten Schreibvorgang und verschwindet anschließend. Bleibt eine Antwort aus, bleiben dieselbe `request_id` und die ursprünglichen Eingaben erhalten; „Erneut versuchen“ sendet genau diesen Vorgang noch einmal, ohne etwas doppelt zu speichern. Das gilt für Training, Plan und Einrichtung, auch nach einem Neuladen.

Ungewöhnliche Werte (über 500 kg oder 100 Wiederholungen) werden erst nach „Stimmt das?“ mit `confirm_unusual_values: true` gesendet. Ein zukünftiges Datum führt zu einem verständlichen Hinweis. Ein Training wird erst nach einem zweiten ausdrücklichen Klick zurückgenommen.

## Barrierefreiheit und Bewegung

Beschriftete native Inputs, sichtbarer Fokus, `aria-pressed` für Chips und `role="switch"` mit `aria-checked` für Schalter bilden dieselben Zustände visuell und für Screenreader ab. Fehlermeldungen werden angekündigt. Die Diagrammwerte sind zusätzlich für Screenreader erreichbar. Dialoge halten den Tastaturfokus, schließen mit Escape und geben den Fokus zurück.

Bewegung begleitet eine Aktion. Wiederöffnen spielt keine Karten-Eintrittsanimation ab. `prefers-reduced-motion` entfernt Bewegung, erhält Auswahl- und Statusrückmeldungen. Reduzierte Transparenz und höherer Kontrast haben passende Darstellungen. Es gibt keine künstlichen Wartezeiten, wiederholten Erfolgsanimationen oder vorgetäuschten haptischen Effekte.

## Chat-Brücke

Jede Ansicht meldet den relevanten Zustand still über `ui/update-model-context`: Übung und Vergleich, ausgewähltes Training samt Satzreferenzen, Planversion oder Einrichtungsfrage. Eine sichtbare Nachricht entsteht nur bei einem tatsächlichen Übergang wie Planerstellung oder Trainingsabschluss. Keine Chat-Nachricht pro Satz oder Feld. Private Bestätigungstokens gelangen nie in den Modellkontext.

## Sprache

Du-Form, kurze Sätze, konkrete Aktionen. Einheitliche Begriffe: **Training**, **Trainingstag**, **Satz**, **Arbeitssatz**, **Aufwärmsatz**, **Übung**, **Plan**, **Entwurf**. „Trainingstag“ meint einen Kalendertag, „Training“ eine Einheit. Singular und Plural richten sich nach dem gelieferten Wert.

Datumsformat im kompakten Kontext: „7. Apr.“; im vollständigen Kontext „7. April 2026“. Deutsches Dezimalkomma. Gewichte tragen ihre Bedeutung direkt an der Zahl, etwa „20 kg pro Hantel“. Unbekannte Werte bleiben unbekannt und werden nicht als Null dargestellt.

## Abnahme

Playwright prüft Chromium und WebKit mit Mobil- und Desktop-Ansichten. Die Layout-Gegenproben aus S001 wurden auf die Karten übertragen: begrenzte Aufrufzahl, kein Überlauf, präzise Trainingsauswahl, unveränderte Startansicht beim Filtern und sichtbare Vergleichsklasse. axe prüft die Karten und Einrichtung. Bildschirmfotos liegen in `docs/beta/screens/` und verwenden ausschließlich synthetische Daten.

Browseremulation und der lokale AppBridge-Host ersetzen keine Abnahme auf einem physischen iPhone in der ChatGPT-App. Diese letzte Geräte- und Host-Abnahme gehört zur Integration mit Worker C.
