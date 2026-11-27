# Design: Arnold

Neutraler Trainingsbegleiter im ChatGPT-Chat: klare Aktionen, echter Fortschritt. Das Gespräch ist das Zentrum: Wünsche und Änderungen laufen über Chat und Sprache, Karten zeigen etwas oder bestätigen etwas. Look: OpenAIs **Apps SDK UI** (`@openai/apps-sdk-ui`) mit Tailwind 4. Dies ist die einzige Designquelle; kein zweites Design-Dokument anlegen. Maßgeblich sind die Ansichten selbst (`src/views`): Farben, Schrift, Radien und Abstände kommen aus den Tokens der Bibliothek (`src/views/index.css`) und werden nicht hier wiederholt. Das abgenommene Bild wird nicht nebenbei verändert.

## Grundsätze

- **Bibliothek zuerst.** Knopf, Badge, Alert, Eingabe, Auswahl, Segmente, Popover, Icons und Übergänge kommen aus Apps SDK UI. Eigene Bausteine nur, wo die Bibliothek keinen hat (Karte, Fortschrittsbalken, Diagramm, Einrichtungs-Stepper).
- **Nur Tokens.** Tailwind-Klassen mit semantischen Farben (`bg-surface`, `border-subtle`, `text-secondary`, `bg-primary-solid`, `bg-secondary-soft`); keine eigenen Farbwerte.
- **Farbe mit Bedeutung.** Schwarz/Weiß ist die Hauptaktion. Grün (`success`) steht für Erfolg, Rekord und Erledigtes, `warning` für „nicht ganz aktuell“, `danger` für Fehler und Unwiderrufliches, `info` für Hinweise wie die Anpassung auf Zeit. Farbe trägt nie allein die Bedeutung.
- **Hell/Dunkel vom Host** (`use-host-theme.ts` setzt `data-theme`). Kein Schalter, keine externen Schriften oder Bilder: je Ansicht ein HTML-Dokument, leere CSP. Die KaTeX-Schriften der Bibliothek bleiben draußen.
- **Ehrliche Daten.** Einheiten und Lastdefinition stehen bei der Zahl. Unbekannt ist „–“, nie 0 (auch das Wochenziel ohne Plan). Dezimalkomma, deutsche Datumsformate, tabellarische Ziffern (`tabular-nums`). Die Ansichten rechnen nichts nach; im echten Betrieb gibt es keine Beispielzahlen.

## Aufbau einer Karte

- Spalte `max-w-xl`, 1rem Rand, Abstände `gap-4`, kein seitliches Scrollen bei 375 px.
- Inhalt in Kästen: `rounded-2xl border border-subtle bg-surface p-4`, Titel `heading-xs`. Flach, kein Schatten.
- Seiten hinter dem Überblick und Chat-Karten: Zurück-Knopf „Dashboard“ (ghost, klein), darunter `heading-lg` (`ScreenHeader`, `card-kit.tsx`).
- Knöpfe: `block` und volle Breite; höchstens eine Hauptaktion (`color="primary"`), weitere `secondary` als `soft` oder `ghost`. Unwiderrufliches braucht einen zweiten Tipp („Wirklich verwerfen?“) oder, wo die Bestätigungsregel es verlangt, den Klick in der Karte.
- Zustände: „Wird geladen …“, Fehler als `Alert` mit „Erneut versuchen“. „Gespeichert“ und „Bestätigt“ erst nach der Antwort des Servers.

## Überblick

Von oben nach unten: „Dein Überblick“; einmalig der **Rückblick** auf ein neues Training (Badge, „Geschafft: …“, Rekorde und Wochenziel, höchstens ein „Nächstes Mal: …“, „Nächstes Training ansehen“ und „Verstanden“); während einer Anpassung auf Zeit der Hinweis mit „Anpassung ansehen“; die drei Scores (Ring, Popover mit den Bestandteilen) neben „Diese Woche“ (sieben Punkte, Popover je Trainingstag); „Health Data“ (nur wenn es Werte geben kann) und „Trainingsplan“; „Heute“ als Zeitleiste je Art mit „Starten“; „Ziele“ und „Rekorde“ mit angeschnittener Liste, Aufklapp-Pfeil und festem Knopf; „Trainingsentwicklung ansehen“ und „Einstellungen“.

## Weitere Ansichten

- **Training:** Arnolds Vorschlag je Satz (Gewicht, Wiederholungen, Haken), Fortschrittsbalken, „Training beenden“. Fehlendes Gewicht steht als „offen“. Ein offenes Training lässt sich fortsetzen.
- **Einheiten:** je Training ein Kasten zum Aufklappen; „Satz korrigieren“ öffnet die Sätze mit Feldern, „Speichern“ (nur bei Änderung) und „Verwerfen“.
- **Ziele:** Liste mit Balken, Formular für Arnolds Zielarten, Körpergewicht eintragen und den letzten Eintrag verwerfen.
- **Chat-Karten** (Lauf, Mobility, Planänderung, Anpassung, Verlauf, Uhr, Konto): eine Aufgabe je Karte; bei Änderungen nur alt → neu.
- **Einrichtung:** Begrüßung mit zwei Wegen, Fragen, Plan prüfen, Uhr; Stepper mit vier Schritten (Texte sind abgenommen).

## Rückmeldung und Datenschutz

- Bleibt eine Antwort aus, behält der erneute Versuch dieselbe `request_id` (`model/writes.ts`) und die Eingaben.
- Ungewöhnliche Werte speichert erst die ausdrückliche Bestätigung („Ja, so speichern“).
- Bestätigungstoken (Konto löschen, Uhr koppeln) kommen nur aus `_meta` und gelangen nie in den Modellkontext.
- Jede Karte sagt dem Modell kurz, was sie zeigt (`DataLLM`). Sichtbare Chat-Nachrichten nur nach einem Tipp.

## Barrierefreiheit und Sprache

Native oder beschriftete Bedienelemente, sichtbarer Fokus, benannte Balken und Diagramme, der Name eines Knopfs beginnt mit seinem sichtbaren Text. Du-Form, kurze Sätze, keine technischen Details. `tests/e2e/layout.spec.ts` prüft jede Ansicht bei 375 px in Hell und Dunkel mit Axe. Bekannt und dort ausgenommen: drei Farbpaare der Bibliothek unter 4,5 : 1 (grünes Soft-Badge und Platzhalter in Hell, rote Ghost-Schrift in Dunkel).

Browser- und AppBridge-Prüfungen ersetzen keine Abnahme auf einem iPhone in der ChatGPT-App.
