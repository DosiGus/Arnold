# Arnold – Designregeln

Arnold ist ein Trainingsbegleiter im Chat. Karten helfen beim Entscheiden, Eingeben und Nachsehen. Die Unterhaltung bleibt der Ort für Wünsche, Rückfragen und Änderungen in eigenen Worten.

Die Grundlage ist der [Apple-Design-Skill von Emil Kowalski](https://github.com/emilkowalski/skills/blob/main/skills/apple-design/SKILL.md): direkte Reaktion, vertraute Bedienung, klare Hierarchie, zurückhaltende Materialien und verständliche Rückmeldung. Wir übernehmen passende Prinzipien in die Chat-Karten; Gestenphysik oder weitere Bibliotheken sind für diese Abläufe nicht erforderlich.

## Gemeinsames System

- `src/ui/style.css` ist das einzige Stylesheet der App. Der lokale Test-Host hat ein eigenes, getrenntes Stylesheet.
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
- **Heute und Satz:** ein beständiges Objekt für Start, laufendes Training und Abschluss. Oben stehen Übung x von y und ein Balken je Übung, darunter Satz-Felder: gespeicherte grün und zur Korrektur antippbar, der aktuelle umrandet, offene gestrichelt. Gewicht und Wiederholungen stehen nebeneinander, lassen sich antippen und direkt eingeben oder mit Plus/Minus ändern; darunter der Vergleich zum letzten Mal. Ohne bekanntes Gewicht muss der Nutzer zuerst eines angeben. Nach einem Arbeitssatz läuft die Pause aus `rest_seconds` (sonst 90 s); dort wird freiwillig gefragt, wie viele Wiederholungen noch gegangen wären. Nach dem letzten geplanten Satz zeigt die Karte „Übung geschafft“ und die nächste Übung. Seltene Aktionen (Aufwärmsatz, Übung wechseln, tauschen, überspringen, Training beenden oder abbrechen) liegen hinter dem Drei-Punkte-Knopf. Eine getauschte Übung übernimmt den Planplatz nur für dieses Training und nur bis zum Neuladen.
- **RIR:** freiwillig und erklärt als noch mögliche Wiederholungen. 0, 1 und 2 sind genau wählbar; 3+ öffnet eine sichtbare genaue Zahl. Die UI erfindet keine Genauigkeit aus einem Bereich. Vorhandenes RPE bleibt bei einer Korrektur erhalten.
- **Wochenstreifen:** Trainingstage kommen aus `training_days`, Haken aus `trained_dates`. Zwei Trainings am selben Tag ergeben einen Trainingstag. Arbeitssätze und letzter Rekord haben Vorrang vor einer unkommentierten Volumenzahl.
- **Fortschritt:** eine Übung, eine Hauptzahl, ein fertiger Vergleich aus `selected_comparison`, eine kleine Kurve. Lastdefinition, Ausführung und Seite bleiben sichtbar. Die Kurve enthält nur gelieferte Messpunkte mit echten zeitlichen Abständen. Die UI berechnet keine Differenz.
- **Verlauf:** wenige ruhige Zeilen im Chat. Die vollständige Liste und einzelne Trainings öffnen im Vollbild, mit denselben Inhalten als Fallback im Dokumentfluss. Sätze bleiben lesbare Zeilen mit Lastdefinition, Seite und Satztyp. Zeitraum, Plan und Status werden serverseitig gefiltert. Eine angeforderte Einheit wird niemals durch eine andere ersetzt.
- **Plan:** kurzer Überblick über die Trainingstage. Die ausführliche Ansicht und Bearbeitung sind im Vollbild. Ein aktiver Plan wird über einen neuen Entwurf verändert. Aktivierung bleibt eine ausdrückliche Bestätigung der angezeigten Version und Revision.
- **Einrichtung:** oben Phase, Balken in vier Abschnitten (Angaben, Wünsche, Prüfen, Plan), Zurück und drei Punkte (Stand neu laden, Einrichtung abbrechen). Ablauf: Begrüßung mit zwei Wegen, „Über dich“ auf einer Karte (Alter, Größe und Gewicht direkt eintippen, leer erlaubt, Dezimalkomma, Geschlecht und Bereiche aufklappbar, alles freiwillig), vier Fragen (Ziel mit Mehrfachauswahl, Erfahrung, wie oft und wie lange auf einer Karte mit freier Minutenzahl, Ort), dann die Wünsche als eigener, freiwilliger Schritt mit aufklappbaren Bereichen und einem Freitext, dann „So wird dein Plan“ mit einem Satz in Alltagssprache und Stift je Zeile. Feste Wochentage gibt es nur in der gewählten Anzahl. Nach der Bestätigung zeigt die Karte die nächste Einheit und das Startgewicht mit Weg zu den Zielen.
- **Konto löschen:** Aufruf aus dem Chat. Die Karte nennt alles, was gelöscht wird, auch die Trainingsdaten. Das Bestätigungstoken bleibt ausschließlich im App-Zustand, kommt aus `_meta` und verlässt die Karte nur durch den ausdrücklichen Löschklick. Abgelaufene Tokens werden neu angefordert.

## Zustände und Rückmeldung

Alle sechs `recovery`-Werte besitzen gemeinsame, verständliche Texte. Technische Fehlercodes, interne IDs und Revisionen bleiben aus sichtbaren Fehlermeldungen heraus. Ein fachlicher Fehler nennt zusätzlich die verständliche Serverbegründung. Beispielsweise bleibt bei einer ungültigen Wiederholungsspanne der Einstellungsdialog mit beiden Werten geöffnet.

Ein Druck wird direkt sichtbar. „Satz gespeichert“ folgt ausschließlich einem bestätigten Schreibvorgang und verschwindet anschließend. Bleibt eine Antwort aus, bleiben dieselbe `request_id` und die ursprünglichen Eingaben erhalten; „Erneut versuchen“ sendet genau diesen Vorgang noch einmal, ohne etwas doppelt zu speichern. Das gilt für Training, Plan und Einrichtung, auch nach einem Neuladen.

Ungewöhnliche Satzwerte werden erst nach „Stimmt das?“ mit `confirm_unusual_values: true` gesendet. Ein zukünftiges Datum führt zu einem verständlichen Hinweis. Ein Satz wird erst nach einem zweiten ausdrücklichen Klick verworfen.

## Barrierefreiheit und Bewegung

Beschriftete native Inputs, sichtbarer Fokus, `aria-pressed` für Chips und `role="switch"` mit `aria-checked` für Schalter bilden dieselben Zustände visuell und für Screenreader ab. Fehlermeldungen werden angekündigt. Die Diagrammwerte sind zusätzlich für Screenreader erreichbar. Dialoge halten den Tastaturfokus, schließen mit Escape und geben den Fokus zurück.

Bewegung begleitet eine Aktion. Wiederöffnen spielt keine Karten-Eintrittsanimation ab. `prefers-reduced-motion` entfernt Bewegung, erhält Auswahl- und Statusrückmeldungen. Reduzierte Transparenz und höherer Kontrast haben passende Darstellungen. Es gibt keine künstlichen Wartezeiten, wiederholten Erfolgsanimationen oder vorgetäuschten haptischen Effekte.

## Chat-Brücke

Jede Ansicht meldet den relevanten Zustand still über `ui/update-model-context`: Übung und Vergleich, ausgewähltes Training samt Satzreferenzen, Planversion oder Einrichtungsfrage. Eine sichtbare Nachricht entsteht nur bei einem tatsächlichen Übergang wie Planerstellung oder Trainingsabschluss. Keine Chat-Nachricht pro Satz. Private Bestätigungstokens gelangen nie in den Modellkontext.

## Sprache

Du-Form, kurze Sätze, konkrete Aktionen. Einheitliche Begriffe: **Training**, **Trainingstag**, **Satz**, **Arbeitssatz**, **Aufwärmsatz**, **Übung**, **Plan**, **Entwurf**. „Trainingstag“ meint einen Kalendertag, „Training“ eine Einheit. Singular und Plural richten sich nach dem gelieferten Wert.

Datumsformat im kompakten Kontext: „7. Apr.“; im vollständigen Kontext „7. April 2026“. Deutsches Dezimalkomma. Gewichte tragen ihre Bedeutung direkt an der Zahl, etwa „20 kg pro Hantel“. Unbekannte Werte bleiben unbekannt und werden nicht als Null dargestellt.

## Abnahme

Playwright prüft Chromium und WebKit mit Mobil- und Desktop-Ansichten. Die Layout-Gegenproben aus S001 wurden auf die Karten übertragen: begrenzte Aufrufzahl, kein Überlauf, präzise Trainingsauswahl, unveränderte Startansicht beim Filtern und sichtbare Vergleichsklasse. axe prüft die Karten und Einrichtung. Bildschirmfotos liegen in `docs/beta/screens/` und verwenden ausschließlich synthetische Daten.

Browseremulation und der lokale AppBridge-Host ersetzen keine Abnahme auf einem physischen iPhone in der ChatGPT-App. Diese letzte Geräte- und Host-Abnahme gehört zur Integration mit Worker C.
