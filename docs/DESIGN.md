---
name: Arnold
description: "Neutraler Trainingsbegleiter im Chat mit klaren Aktionen und echtem Fortschritt."
colors:
  bg: "#fff"
  text: "#171717"
  muted: "#666"
  card: "#fff"
  soft: "#f5f5f5"
  hover: "#ededed"
  border: "#e5e5e5"
  ink: "#171717"
  on-ink: "#fff"
  bar-muted: "#777"
  dark-bg: "#171717"
  dark-text: "#f5f5f5"
  dark-muted: "#b4b4b4"
  dark-card: "#242424"
  dark-soft: "#303030"
  dark-hover: "#383838"
  dark-border: "#424242"
  dark-ink: "#f5f5f5"
  dark-on-ink: "#171717"
  dark-bar-muted: "#aaa"
typography:
  display:
    fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    fontSize: "3.5rem"
    fontWeight: 400
    lineHeight: 1
    letterSpacing: "-0.04em"
  headline:
    fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    fontSize: "1.75rem"
    fontWeight: 400
    lineHeight: 1.1
    letterSpacing: "-0.035em"
  title:
    fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    fontSize: "1.75rem"
    fontWeight: 500
    lineHeight: 1.15
    letterSpacing: "-0.025em"
  body:
    fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    fontSize: "0.9375rem"
    lineHeight: 1.45
  label:
    fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    fontSize: "0.75rem"
    fontWeight: 500
  caption:
    fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    fontSize: "0.8125rem"
    lineHeight: 1.5
rounded:
  ac-radius: "1rem"
  ac-radius-inner: "0.5rem"
  field: "0.75rem"
  pill: "62.4375rem"
spacing:
  ac-pad: "1.25rem"
  widget-gap: "0.75rem"
  card-gap: "0.875rem"
  action-gap: "0.5rem"
components:
  button-primary:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.on-ink}"
    rounded: "{rounded.pill}"
    padding: "0.75rem 1.125rem"
    height: "2.75rem"
  button-secondary:
    backgroundColor: "{colors.soft}"
    textColor: "{colors.text}"
    rounded: "{rounded.pill}"
    padding: "0.75rem 1.125rem"
    height: "2.75rem"
  button-secondary-hover:
    backgroundColor: "{colors.hover}"
  card:
    backgroundColor: "{colors.card}"
    textColor: "{colors.text}"
    rounded: "{rounded.ac-radius}"
    padding: "{spacing.ac-pad}"
  input:
    backgroundColor: "{colors.card}"
    textColor: "{colors.text}"
    rounded: "{rounded.field}"
    padding: "0.6rem 0.75rem"
    height: "2.75rem"
  chip-selected:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.on-ink}"
    rounded: "{rounded.pill}"
    padding: "0 0.9375rem"
    height: "2.75rem"
---

# Design System: Arnold

## Overview

**Creative North Star: "Arnolds neutraler Trainingsüberblick"**

Arnold begleitet Training im ChatGPT-Chat. Einsteiger erhalten Unterstützung, erfahrene Trainierende erfassen schnell. Chat und Sprache tragen Wünsche und Änderungen; Karten machen die nächste Aktion, Ziele und Trainingsgeschichte greifbar. Training und Protokollierung bilden den aktuellen Umfang; Ernährung und Geräteanbindung sind Zukunftsthemen.

Die freigegebene Gestaltung ist neutral und monochrom: ruhige Systemschrift, klare Flächen, dünne Konturen und deutliche Zahlen. Die Übersicht führt in eine einzelne fokussierte Aufgabenkarte und von dort zurück. Die dokumentierte Umsetzung ist die verbindliche Grundlage für weitere Ansichten.

**Key Characteristics:**

- Ausschließlich Graustufen in beiden Host-Themes.
- Deckende, flache Karten mit feiner Kontur.
- Klarer Weg von der Übersicht zur Aufgabe und zurück.
- Echte Trainingsdaten mit sichtbaren Einheiten; illustrative Scores ausdrücklich als Demo.

Diese Datei ersetzt die früheren Apple-, Grün-/Rot- und Vier-Kachel-Regeln. Sie ist die maßgebliche Designquelle unter `docs/DESIGN.md`; kein zweites Design-Dokument anlegen. Die tatsächlichen Werte stammen aus `src/ui/styles/base.css`, `cards.css` und `dashboard.css`. `src/ui/style.css` bündelt alle Bereiche. Die Ergänzungen in `.impeccable/design.json` enthalten Zustände, Breakpoints und renderbare Komponenten; Primitive gehören ins Frontmatter. Die spezifische Dashboard-Komposition ist zusätzlich in `.impeccable/surfaces/src-ui-arnolddashboardapp-tsx.md` festgehalten.

## Colors

Die Palette besteht vollständig aus neutralen Graustufen. Das Frontmatter dokumentiert die hellen Standardwerte und ihre `dark-`-Entsprechungen; im Code bleiben dieselben CSS-Variablen aktiv, während der Host das Theme wechselt.

### Primary

**Ink / On Ink** bilden die kontrastreiche Hauptaktion, ausgewählte Chips und Fortschrittsfüllungen. „Primary“ bezeichnet die Aktionshierarchie, keinen Buntton.

### Neutral

- **Background / Card:** Host-Hintergrund beziehungsweise deckende Kartenfläche. Die eingebettete Dokumentfläche bleibt transparent, damit der Chat seine Umgebung zeichnet.
- **Text / Muted:** Hauptinhalt beziehungsweise ergänzende Informationen, Labels und Einheiten.
- **Soft / Hover:** zurückhaltende Kontrollflächen und ihre Reaktion auf Zeigerkontakt.
- **Border / Bar Muted:** Konturen, Trennlinien und ergänzende Diagrammmarken.
- `--surface-strong` entspricht der Kartenfläche; `--focus` und `--chart` folgen Ink. `--ac-good` und `--ac-bad` folgen Text. Die vorhandenen Accent-Aliasse bleiben neutral: Soft für Abzeichen, Ink für Füllungen.

**The Monochrome Rule.** Erfolg, Warnung, Auswahl und Fortschritt bleiben achromatisch. Text, Symbol, Kontur und Füllung vermitteln den Zustand gemeinsam.

Hell/Dunkel kommen aus dem Host; die eigenständige Vorschau beginnt mit dem System-Theme. Kein Theme-Schalter in der Karte, keine externen Schriften oder Bildassets.

## Typography

**Display Font / Body Font:** dieselbe native Systemschrift mit den Fallbacks aus dem Frontmatter.

**Character:** zurückhaltend und gut lesbar. Titel und Kontrollen verwenden überwiegend mittleres Gewicht; große Trainings- und Rekordzahlen bleiben leichter. Kein durchgehend fettes Dashboard.

### Hierarchy

- **Display:** große Rekordzahl, mobil auf (2.75rem) reduziert.
- **Headline:** Name des nächsten oder gespeicherten Trainings im breiten Widget.
- **Title:** fokussierte Aufgabenkarte; der Übersichtstitel verwendet (1.6875rem), Gewicht (500), Zeilenhöhe (1.15) und Laufweite (-0.035em).
- **Body:** Grundtext innerhalb der Karten. Erläuterungen verwenden häufig (0.875rem), Widget-Zeilen (0.8125rem).
- **Label / Caption:** kleine Orientierung und Nebeninformationen. Widget-Metadaten dürfen (0.6875rem) verwenden; entscheidende Eingaben bleiben größer.

Zahlen verwenden tabellarische Ziffern. Lange Übungsnamen, Einheiten und Fehlermeldungen brechen um. Unbekannte Werte werden nicht als Null dargestellt. Dezimalkomma und deutsche Datumsformate bleiben erhalten: kompakt „7. Apr.“, vollständig „7. April 2026“. Lastdefinition steht unmittelbar bei der Zahl, etwa „20 kg pro Hantel“.

## Layout

Die Chat-Karte hat eine maximale Breite von (44rem); die vorhandenen Vollbildeditoren (64rem). Eine Aufgabenkarte beantwortet eine Frage. Die Übersicht gibt der nächsten Handlung den meisten Raum; Detailkarten konzentrieren sich auf eine Aufgabe mit erkennbarem Rückweg. Lange Inhalte laufen im Dokumentfluss; keine neuen inneren Scrollflächen oder App-Shell-Navigation einführen.

Die implementierte Übersicht nutzt sechs gleiche Rasterspalten mit dem im Frontmatter dokumentierten Widget-Abstand. Training belegt vier Spalten und zwei Zeilen, rechts stehen Woche und Demo-Scores mit je zwei Spalten. Darunter belegen Ziele vier und Rekorde zwei Spalten. Die normalen Widget-Innenabstände sind vertikal (1.1875rem) und horizontal (1.25rem), die Score-Karte (1.0625rem 1rem).

Bis (36rem) wird das Raster zweispaltig: Training und Scores über die volle Breite, danach Woche und Rekorde nebeneinander, anschließend Ziele. Karten erhalten (1rem) Innenabstand. Bis (21rem) stehen auch Woche und Rekorde einzeln. Flexible Zeilen und umbrechende Aktionen erhalten die Bedienbarkeit bei längeren Texten und vergrößerter Grundschrift. Die vorhandenen Detailansichten haben zusätzliche lokale Breakpoints; die Sidecar listet diese getrennt auf.

Die Übersicht enthält keinen zusätzlichen Block „Letzte Trainings“. Der Wochen-Link führt zu allen Einheiten. „Trainingsentwicklung ansehen“ bleibt eine ruhige Aktion unter dem Raster. Neue Oberflächen übernehmen die räumliche Hierarchie; die konkrete Fünf-Widget-Komposition gilt für diese Übersicht.

## Elevation & Depth

Karten haben keinen Flächenschatten und keinen Blur. Deckende Flächen, feine Konturen und klare Abstände trennen Inhalte. Der Host darf durch die transparente Umgebung sichtbar bleiben; die Karten selbst bleiben opak.

**The Flat Surface Rule.** Karten bleiben deckend und flach. Hierarchie entsteht durch Raster, Kontur, Abstand und Typografie.

Fokus- und Statuskonturen sind funktionale Markierungen, keine erhöhte Fläche. Die heutige untrainierte Tagesmarke verwendet eine innere Kontur. Der bestehende Plan-Dialog besitzt einen eigenen modalen Schatten (`0 12px 50px rgb(0 0 0 / 0.2)`); diese begrenzte Ausnahme ist kein Kartenstil.

Bewegung bestätigt eine konkrete Aktion: Knöpfe reagieren auf Druck, Balken auf geänderte Werte. Bestehende Übergänge und `prefers-reduced-motion` erhalten. Wiederöffnen spielt keine Eintrittsanimation; keine künstlichen Wartezeiten, wiederholten Erfolgsanimationen oder vorgetäuschten haptischen Effekte.

## Shapes

Karten verwenden den gemeinsamen äußeren Radius, innere Gruppen den kleineren Radius aus dem Frontmatter. Dünne Konturen (1px) rahmen Flächen. Felder haben einen eigenen mittleren Radius; Hauptknöpfe und Chips sind pillenförmig, Icon-Knöpfe kreisförmig. Wochen- und Score-Ringe sind Informationsgrafiken mit einer schmalen Kontur, keine Schmuckelemente.

Interaktive Kontrollen bleiben mindestens (2.75rem) hoch; reine Icon-Knöpfe ebenso breit. Das entspricht bei Standardschrift (44px). Der Fokus ist sichtbar: Kontur (2px), Abstand (3px). Gesonderte Eingabe- und Editorzustände behalten ihre bestehenden Fokusregeln.

## Components

### Buttons

Ruhige, eindeutige Aktionen mit höchstens einer Hauptaktion und einer zweiten Aktion pro fokussierter Karte; weitere Wege bleiben leise Textaktionen.

- **Primary:** Ink auf On Ink, pillenförmig; Maße und Padding im Frontmatter. Destruktive Hauptaktionen nutzen dieselbe neutrale Palette und eine eindeutige Beschriftung.
- **Secondary:** Soft mit Text; Hover wechselt zu Hover.
- **Text / Back:** unterstrichene, gedämpfte Links beziehungsweise ein beschrifteter Zurück-Knopf. Detailkarten zeigen „Zur Übersicht“.
- **States:** unmittelbare Druckrückmeldung; deaktivierte Kontrollen mit reduzierter Deckkraft. „Training gespeichert“ erscheint erst nach bestätigtem Schreiben.

### Chips

Kontur und neutrale Fläche im Normalzustand; ausgewählt Ink / On Ink. `aria-pressed` oder beschriftete native Auswahlfelder transportieren denselben Zustand für assistive Technik. Chips dürfen umbrechen.

### Cards / Containers

`ArnoldCard`, `CardActions`, `ChipGroup`, `Stepper`, `Rows`, `CardNote` und `CardSkeleton` bleiben die gemeinsamen Bausteine. Karten und Vollbildeditoren teilen Tokens und Kontrollmaße. Kopfzeile, Titel, Inhalt und Aktionen bilden eine klare Folge. Bearbeitungsgruppen bleiben aufklappbar; die Übersicht selbst weicht der fokussierten Aufgabenkarte.

### Inputs / Fields

Beschriftete native Inputs, Selects und Textareas mit deckender Kartenfläche, Kontur und sichtbarem Fokus. Direkte Eingabe bleibt für Gewicht, Wiederholungen und andere Zahlen möglich; bestehende Plus/Minus-Regler ergänzen sie. Dezimalkomma, freiwillige leere Profilfelder und unbekannte Gewichte bleiben unterstützt. Fehlertexte nennen das Problem in Alltagssprache und erhalten die Eingaben.

### Navigation

Widget-Titel, Zeilen und Aktionen öffnen die jeweilige Detailkarte. Der Rückweg zur Übersicht bleibt sichtbar; keine zusätzlichen globalen Tabs. Woche öffnet den Verlauf aller Einheiten. Ein Rekord öffnet exakt das zugeordnete Training über seine `workout_id`; ein Ziel öffnet sein konkretes Detail über `goal_id`. Anfrage und angezeigte Einheit dürfen niemals auseinanderfallen.

### Dashboard-Widgets

- **Training:** nächstes Training mit vorhandenen Vorschlägen und bis zu vier Übungszeilen, sonst ehrlicher Leerzustand. Nach einem heutigen Abschluss zeigt es die gespeicherte Einheit. Aktionen öffnen Training oder Plan; „Noch ein Training“ startet bewusst frisch. Schreibrechte bestimmen Beschriftung und angebotene Aktionen.
- **Woche:** echte Trainingsdaten, Tagesmarken und Wochenziel. Zwei Einheiten an einem Tag zählen als ein Trainingstag. Aufklappen erklärt den Stand, „Alle Einheiten“ öffnet den Verlauf.
- **Demo-Scores:** feste illustrative Werte Konstanz (92), Recovery (72), Progress (77). Titel, jedes einzelne Label und zugängliche Beschreibung nennen Demo. Der Info-Text erklärt die freie Wahl, die spätere Berechnung und die fehlende Health-Geräteanbindung. Keine Berechnung oder Geräteintegration im Backend behaupten oder ergänzen.
- **Ziele:** erste vier Ziele mit geliefertem Fortschritt, aktuellem Wert und Zielwert; danach „Ziel hinzufügen“ bei Schreibrechten und gegebenenfalls Link zu allen Zielen. Null-Fortschritt und unbekannter Fortschritt bleiben verschieden.
- **Rekorde:** Karussell der drei neuesten Rekorde, eine Hauptzahl, Lastdefinition, Datum und Position. Vor/Zurück ist beschriftet; Wechsel wird angekündigt. Wert, Metrik, Wiederholungen und zugehörige Trainingsidentität stammen aus den vorhandenen Backend-Daten.

### Training, Ziele, Fortschritt und Plan

Die visuelle Vereinheitlichung ändert keine Daten- oder Schreibsemantik:

- **Training:** `proposals` aus `get_workout` liefern Empfehlung beziehungsweise letzten Stand und Planwerte. „Arnolds Vorschlag · Wie letztes Mal“ stellt die angezeigten Werte um; „So gemacht“ speichert genau diese Werte über `log_workout`. Fehlendes Gewicht wird nicht geraten. Bestehende Anpassungen, Übungstausch nur für heute, Weglassen mit Zurückholen und Hinzufügen bleiben erhalten. Der gesamte Entwurf wird gemeinsam gespeichert. Laufende Satz-für-Satz-Trainings behalten Abschluss und Verwerfen; Timer und RIR-Abfrage werden nicht ergänzt.
- **Gespeichert:** dieselbe Karte zeigt den bestätigten Stand; Bearbeiten ersetzt in einem Schritt. Rückgängig erfordert den zweiten ausdrücklichen Klick. Ein weiteres Training ist ein eigener Vorgang.
- **Ziele:** gelieferter Fortschritt, Kurve und Prognose bleiben maßgeblich. Ziel ändern, Messwert eintragen und die vorhandene Erstellung bleiben zugänglich; Ziel beenden braucht den zweiten Tipp.
- **Fortschritt:** eine Übung, eine Hauptzahl und `selected_comparison`. Lastdefinition, Ausführung und Seite bleiben sichtbar. Kurven enthalten nur gelieferte Messpunkte in echten Zeitabständen. Die UI berechnet keine Vergleichsdifferenz.
- **Verlauf / Rekorde:** vorhandene Filter, Detailaufklappung und „mehr laden“ bleiben erhalten. Sätze zeigen Lastdefinition, Seite und Satztyp. Zeitraum, Plan und Status werden serverseitig gefiltert; Vollbild hat den vorhandenen Fallback im Dokumentfluss.
- **Plan:** Überblick und aufklappbarer Editor bleiben erhalten. Änderungen am aktiven Plan gehen über einen neuen Entwurf. Aktivierung bestätigt ausdrücklich die gezeigte Version und Revision.
- **Einrichtung:** die bestehenden Phasen Angaben, Wünsche, Prüfen und Plan mit Zurück, Neuladen und Abbrechen erhalten. Persönliche Angaben bleiben freiwillig; Erfahrung, Häufigkeit, Dauer, Ort und Wünsche behalten ihre vorhandenen Eingaben. Feste Wochentage nur in gewählter Anzahl. Nach Bestätigung führen nächste Einheit und Startgewicht zu den passenden Aktionen.

### Zustände, Rückmeldung und Datenschutz

Alle sechs `recovery`-Werte verwenden gemeinsame verständliche Texte. Technische Fehlercodes, IDs und Revisionen bleiben aus Fehlermeldungen heraus; fachliche Fehler nennen zusätzlich die verständliche Serverbegründung. Ein ungültiger Wertebereich lässt den Dialog mit beiden Eingaben geöffnet.

Bleibt eine Antwort aus, bleiben dieselbe `request_id` und die ursprünglichen Eingaben erhalten. „Erneut versuchen“ sendet genau diesen Vorgang erneut und erzeugt keinen zweiten Schreibvorgang. Das gilt auch nach Neuladen für Training, Plan und Einrichtung. Ungewöhnliche Werte über (500kg) oder (100 Wiederholungen) benötigen „Stimmt das?“ und `confirm_unusual_values: true`; zukünftige Daten erhalten den bestehenden verständlichen Hinweis.

„Konto löschen“ nennt den Umfang einschließlich Trainingsdaten. Das Bestätigungstoken kommt ausschließlich aus `_meta`, bleibt im App-Zustand und verlässt die Karte nur beim ausdrücklichen Löschklick. Abgelaufene Tokens werden neu angefordert. Private Bestätigungstokens gelangen nie in den Modellkontext.

Jede Ansicht meldet den relevanten Zustand still über `ui/update-model-context`: Übung und Vergleich, Training mit Satzreferenzen, Planversion oder Einrichtungsfrage. Sichtbare Chat-Nachrichten entstehen bei echten Übergängen wie Planerstellung und Trainingsabschluss, nicht pro Feld oder Satz.

### Accessibility und Sprache

Native Beschriftungen, sichtbarer Fokus, `aria-pressed` und `role="switch"` mit `aria-checked` bilden Zustände gleichwertig ab. Fehler und relevante Statuswechsel werden angekündigt. Diagrammwerte bleiben für Screenreader zugänglich. Dialoge halten den Fokus, schließen mit Escape und geben ihn zurück. Reduzierte Bewegung, reduzierte Transparenz und höherer Kontrast erhalten ihre bestehenden Anpassungen.

Du-Form, kurze Sätze und konkrete Aktionen. Begriffe: Training, Trainingstag, Satz, Arbeitssatz, Aufwärmsatz, Übung, Plan und Entwurf. Trainingstag meint einen Kalendertag, Training eine Einheit. Singular und Plural folgen dem gelieferten Wert. Keine technischen Implementierungsdetails im normalen Bedienfluss.

Aktuelle visuelle Referenzen liegen in `.impeccable/review/` für Desktop, Mobile, 720px, Hellmodus und die fokussierten Ansichten. Browser- und AppBridge-Prüfungen ersetzen keine Abnahme auf einem physischen iPhone in der ChatGPT-App.

## Do's and Don'ts

### Do:

- Do verwende die bestehenden semantischen Tokens und dieselben flachen Karten in Übersicht, Einrichtung und Editoren.
- Do halte interaktive Ziele mindestens 2.75rem hoch und reine Icon-Knöpfe ebenso breit.
- Do zeige Einheiten, Lastdefinition und unbekannte Werte ehrlich an.
- Do erhalte die genaue Trainings-, Ziel- und Rekordidentität bei jeder Navigation.
- Do prüfe Hell/Dunkel, schmale Ansichten, 720px, Tastatur und reduzierte Bewegung am gerenderten Ergebnis.

### Don't:

- Don't ergänze farbige Akzente, Glasflächen, dekorative Flammen oder Trophäen.
- Don't stelle Demo-Scores als berechnete Trainings- oder Gesundheitswerte dar.
- Don't ändere Backend-Vergleiche, Vorschläge oder Schreibsemantik für eine visuelle Vereinfachung.
- Don't zeige technische IDs, Revisionen oder private Bestätigungstokens als Bedienoberfläche.
- Don't bestätige einen Schreibvorgang vor der Serverantwort oder erzeuge einen neuen Vorgang für einen Retry.
