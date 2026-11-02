# Arnold: Browsertest in ChatGPT und Testdaten-Reset

Datum: 1. November 2026, Beginn ca. 22:14 Uhr Europe/Berlin. Server: Revision `arnold-00011-h6s`, Commit `46a964ad0eb6972133cf80d07454ffb0f01d3de7`.

## Ergebnis

Der direkte Browsertest ist für dieses Problem sehr aufschlussreich. Die langsamen Fragenwechsel sind reproduziert und mit den Cloud-Logs abgeglichen. Vier fortlaufend gemessene Speicherklicks brauchten etwa **4,2–5,4 Sekunden**. Davon lagen rund **3,2–3,4 Sekunden zwischen Beginn der Klickaktion und Eingang der Anfrage bei Cloud Run**. Nach Ende der Serveranfrage erschien die nächste Frage nach weiteren ca. **56–175 ms**.

Der wichtigste Hebel ist daher, die normale Navigation von einzelnen MCP-Rundreisen zu lösen. Backend-Optimierung bleibt sinnvoll, verkürzt aber allein nicht die gesamte beobachtete Wartezeit. Die Verzögerung vor Cloud Run umfasst Browser, Automationsaktion, ChatGPT-Bridge und Weiterleitung; diese Messung beweist keinen generellen OpenAI-Ausfall und zerlegt diesen Weg noch nicht intern.

Zusätzlich wurden ein Fehler beim ersten Anzeigen der App und ein fehlender automatischer Übergang zum fertigen Plan beobachtet.

## Testumgebung und Umfang

- Chrome, vorhandene angemeldete ChatGPT-Sitzung, neuer Chat mit ausgewähltem Arnold-Plugin.
- Das Plugin zeigte die korrekte Cloud-Run-URL und die vorhandene OAuth-Verbindung. Berechtigung war bereits „Alles zulassen“; bei den gemessenen Antwortspeicherungen gab es keine zusätzliche Freigabeabfrage.
- Neuer Chat im Work-Modus, Modellanzeige im DOM: `GPT-6.1 Sol`, `Gering`. Der frühere Nutzerchat zeigte eine höhere Leistungsstufe. Es wurde **kein kontrollierter Modellvergleich** durchgeführt. Dass die Buttons auch in dieser Konfiguration langsam sind, ist jedoch beobachtet.
- Nur synthetische Testauswahl: allgemeine Fitness, Anfänger, drei Tage, 60 Minuten, Fitnessstudio. Freiwillige persönliche Angaben wurden übersprungen.
- Getestet: erster Einstieg, Pfadwahl, fünf Pflichtfragen, Zusammenfassung, Plananforderung, Erzeugung eines Planentwurfs, manuelles Nachladen des Plans, Öffnen des Planeditors.
- Nicht getestet: Planbestätigung, Google-Freigabe, Dateiprovisionierung, fertiges Dashboard und Trainingslogging. Der Plan wurde nicht aktiviert.
- [Testchat](https://chatgpt.com/c/6ae7ac94-be1c-83ed-b388-19ae01d4b62a). Der darin gezeigte Demo-Plan wurde nach dem Test wieder aus Arnold entfernt; alte Chatnachrichten können weiterhin von diesem damaligen Stand sprechen.

## Reset

Vor dem Reset war der eindeutig zu den bisherigen Tests gehörende Serverstand:

- fünf Einrichtungssitzungen;
- kein gespeicherter Plan, keine Planeinträge, keine Workouts oder Sätze;
- keine persönliche Google-Tabelle, keine gespeicherte Google-Verbindung;
- 56 Audit-Ereignisse, kein Operationsjournal mit Einträgen.

Der reine Teststand wurde administrativ zurückgesetzt: `onboarding.json` und `audit.json` geleert, `draft.json` mit dem bestehenden Starterkatalog und ohne persönliche Daten oder Pläne neu erzeugt. Anmeldung und Trackerzuordnung blieben bestehen. Vor dem Schreiben wurden Zielkonto, Phase `draft`, fehlende Google-Anbindung und fehlende ungeklärte Schreibvorgänge geprüft. Die Objektgenerationen schützten die Ersetzung gegen zwischenzeitliche Änderungen; ein Readback bestätigte das Ergebnis. Der Bucket hat sieben Tage Soft Delete. Die bestehende Master-Tabelle wurde nicht angefasst.

Nach dem Browsertest wurden auch die synthetischen Antworten, der erzeugte Demo-Plan und dessen ein abgeschlossener Journaleintrag wieder entfernt. Ein weiterer neuer Einstieg dient anschließend nur der Prüfung des leeren Willkommenszustands. Eine leere aktive Einrichtungssitzung ist dabei normal; sie enthält noch keine Antworten.

Abschluss: [Frischer Chat mit Willkommenskarte](https://chatgpt.com/c/6ae7af07-9880-83eb-8942-56cbeef429f6). Die Karte ist im Browser offen gelassen. [Abschließender Zustandsnachweis](final-state.json).

Der ursprüngliche Versuch über die ChatGPT-Oberfläche zeigte einen Katalogunterschied: ChatGPT erklärte, es gebe keine Kontolöschfunktion, obwohl der aktuelle Servercode `delete_arnold_account` registriert. In den Plugin-Einstellungen wurde „Tools aktualisieren“ ausgeführt. Die anschließende gezielte Verifikation, ob genau die Löschfunktion im Modellkatalog angekommen ist, steht aus. Der Reset war deshalb kein Test des regulären Kontolösch-Workflows.

## Gemessene Zeiten

Die Messung beginnt direkt vor der Browser-Klickaktion und endet beim Auffinden der sichtbaren nächsten Überschrift. Das sind praktische Automationsmessungen mit Warteprüfungen, keine instrumentierten Paint-Zeitstempel. Die Cloud-Zuordnung erfolgt über die Zeitstempel und das Ende der passenden HTTP-Anfrage; gemeinsame Trace-IDs fehlen noch. Für den zeitlichen Abgleich werden hinreichend synchronisierte Client- und Cloud-Uhren angenommen.

| Aktion                  | Klick bis nächste Karte | Gesamte Cloud-HTTP-Anfrage | Darin Tool-Wrapper | Klick bis Cloud-Eingang | Cloud-Ende bis beobachtete Karte |
| ----------------------- | ----------------------: | -------------------------: | -----------------: | ----------------------: | -------------------------------: |
| Erfahrung speichern     |                4.552 ms |                     975 ms |             605 ms |                3.437 ms |                           140 ms |
| Drei Tage speichern     |                4.379 ms |                     924 ms |             577 ms |                3.280 ms |                           175 ms |
| 60 Minuten speichern    |                4.156 ms |                     877 ms |             565 ms |                3.223 ms |                            56 ms |
| Fitnessstudio speichern |                5.368 ms |                   2.010 ms |           1.344 ms |                3.249 ms |                           109 ms |

Der lokale Wechsel „Persönliche Angaben überspringen“ brauchte ca. **305 ms** ohne Server-Speicherung. Das Nachladen des fertigen Planvorschlags brauchte weitere **4.255 ms**.

Für die vorherige Ziel-Frage gibt es nur ein grobes Intervall: Die erste Warteprüfung war nach etwa drei Sekunden noch nicht erfolgreich; bei der nächsten, späteren Beobachtung nach 14,1 Sekunden war die nächste Frage sichtbar. Dieser Wert wird ausdrücklich **nicht** als präzise 14-Sekunden-Latenz gezählt. Auch die erste Pfadwahl wurde nicht ohne Beobachtungslücke gemessen.

Der erste Modellaufruf bis zum Öffnungsversuch dauerte laut ChatGPT ca. **16 Sekunden**. Das eigentliche `show_arnold_onboarding` brauchte serverseitig **702 ms**. Diese Startzeit enthält Modell-/Host-Verarbeitung; die normalen Fragenwechsel benötigen dagegen laut Implementierung keinen neuen Chat-Turn.

Rohdaten: [Klickmessungen](timings.json), [Abgleich mit Serverzeiten](correlated-timings.json), [Tool-Laufzeiten ohne Nutzerinhalte](server-tool-timings.json).

## Befunde und Änderungen

### P1: Jeder Fragenwechsel wartet mehrere Sekunden auf die MCP-Rundreise

**Beobachtung:** Nach „Weiter“ bleiben die aktuelle Frage und gesperrte Buttons stehen, bis die Speicherung bestätigt ist. Vier Messungen zeigen das wiederholt. Die nächste Karte rendert nach der Serverantwort schnell.

**Code:** `src/ui/components/onboarding.tsx:291–329`, insbesondere `await onSave(patch)` vor `setQuestion(...)`; `src/ui/hooks/useOnboarding.ts:174–243`; `src/ui/client.ts:249–261`.

**Änderung:** Lokalen Eingabeentwurf von bestätigtem Serverstand trennen. Fragen sofort weiterschalten; Speicherung bündeln oder kontrolliert im Hintergrund serialisieren. Speicherstatus wahrheitsgemäß anzeigen, unveränderte Originalaufträge bei unklarem Ausgang erhalten und nicht gespeicherte Eingaben gegen Reload absichern. Vor Plananforderung und Freigabe alle offenen Profiländerungen bestätigen lassen. Revisions- und Eigentumsprüfungen bleiben serverseitig bestehen.

**Abnahme:** Nächste lokale Frage auch bei künstlich drei Sekunden verzögerter Bridge innerhalb eines definierten UI-Budgets sichtbar; kein Datenverlust bei schnellem Weiterklicken, Zurücknavigation, Verbindungsabbruch oder Reload. Keine Plananforderung mit unbestätigten Antworten.

### P1: Der erste App-Aufruf kann leer bleiben und dann fehlschlagen

**Beobachtung:** Alte Karten aus dem bisherigen Testchat zeigten „Arnold konnte nicht angezeigt werden“. Auch der neue Einstieg blieb zunächst als leerer Frame stehen und wechselte zum Fehler. Gleichzeitig behauptete die Chatantwort bereits, die Einrichtung sei geöffnet. Nach Versuch im App-Bereich und „Erneut versuchen“ wurde die Willkommenskarte sichtbar.

**Einordnung:** Ein intermittierender Host-/Ressourcen-/Initialisierungsfehler ist belegt, seine genaue Ursache noch nicht. Eine pauschale Zuordnung zu Server, CSP oder OpenAI wäre mit dieser Datenlage zu weitgehend. In der ausgelesenen Konsole gab es keinen brauchbaren zugehörigen Fehler; nur eine allgemeine Statsig-Cache-Warnung.

**Wiederholung beim Abschluss:** Auch der neue leere Willkommensaufruf blieb zunächst leer und zeigte nach einer weiteren 25-Sekunden-Warteprüfung den Fehler. Nach „Erneut versuchen“ war die Willkommensüberschrift nach ca. 429 ms sichtbar. Die eigentliche Ursache ist weiter offen; die Reproduktion ist nun zweimal gelungen.

![Reproduzierter Fehler beim ersten Anzeigen](/Users/kevingusmao/Desktop/Arnold/docs/browser-test-2026-11-01/06-first-load-error.png)

**Änderung:** UI-Ressourcen pro Release versionieren und gecachte Bundle-Stände abgleichen; Bridge-Initialisierung und sichtbaren Bereitschaftszustand separat protokollieren. Frischen Aufruf, Wiederöffnen eines alten Chats, Inline-Ansicht und App-Bereich getrennt testen. Ein erfolgreiches Tool-Ergebnis darf in der Produktkommunikation nicht mit einer nachweislich geladenen Oberfläche gleichgesetzt werden. Optional kurze textliche Rückfallebene anbieten, wenn die App nicht verfügbar ist.

### P1: Chat sagt „Plan bereit“, Karte bleibt auf „Jetzt entsteht dein Plan“

**Beobachtung:** Der Demo-Plan wurde um **22:23:38 Uhr Berlin** erfolgreich gespeichert. Die Karte blieb anschließend in der Warteansicht. Der Chat meldete bereits „Dein Planvorschlag ist bereit“. Erst der manuelle Klick um **22:24:30 Uhr** auf „Nach dem Vorschlag suchen“ brachte die Vorschau nach weiteren 4,3 Sekunden zum Vorschein.

**Code:** `src/ui/views/OnboardingView.tsx:273–301` bietet den manuellen `onb.reload(true)` an. `src/ui/hooks/useOnboarding.ts:303–314` startet nach der Serveranforderung die Chat-Nachricht. Für den anschließend im Modellpfad gespeicherten Entwurf fehlt in diesem UI-Ablauf ein verlässlicher automatischer Abgleich.

**Änderung:** Bei erfolgreichem Plan-Submit eine passende, nutzer- und sitzungsgebundene Aktualisierung an die geöffnete Ansicht liefern. Wo der Host das nicht verlässlich zustellt, begrenzten Abgleich nur während der laufenden Plananforderung verwenden, mit sinnvoller Rücknahme der Abfragefrequenz und definiertem Ende. Ein im Chat gespeicherter Entwurf soll ohne Nutzeraktion in der Karte auftauchen. Den Modellkontext dazu knapp halten.

**Abnahme:** Plan-Submit über den Chatpfad aktualisiert eine bereits geöffnete Karte automatisch; kein Dauerpolling, keine doppelte Planerstellung und kein Überschreiben neuerer Revisionen.

![Chat meldet den fertigen Plan, während die Karte noch wartet](/Users/kevingusmao/Desktop/Arnold/docs/browser-test-2026-11-01/03-chat-ready-card-waiting.png)

### P2: Die erste Planvorschau zeigt nur Einheiten und Übungsanzahlen

**Beobachtung:** Die Karte „Dein Planvorschlag“ zeigt drei Einheiten und deren Übungsanzahl. Primäraktion ist bereits „Plan bestätigen“. Übungen, Sätze und Wiederholungen erscheinen erst über die sekundäre Aktion „Plan ansehen und bearbeiten“ in einem umfangreichen Editor. Der Benutzer muss zum bloßen Prüfen in eine Bearbeitungsoberfläche wechseln.

**Code:** `src/ui/views/OnboardingView.tsx:309–315,334–371`.

**Änderung:** Eine lesbare Planprüfung mit den tatsächlichen Übungen und Zielen zur Hauptansicht machen, Bearbeitung als gesonderte Option. Die Bestätigung anschließend eindeutig auf den gesehenen Plan beziehen. Zwei aufeinanderfolgende Buttons mit nahezu gleichem Bestätigungstext vermeiden.

![Die anfängliche Planübersicht zeigt nur Anzahlen](/Users/kevingusmao/Desktop/Arnold/docs/browser-test-2026-11-01/04-plan-summary.png)

### P2: Vorbelegte Antworten und Fehltexte widersprechen sich

**Beobachtung:** Bei drei ausgewählten Trainingstagen steht gleichzeitig „Trainingstage fehlt noch“. Bei vorbelegten 60 Minuten steht „Zeit pro Training fehlt noch“. Die Anzeige unterscheidet nicht verständlich zwischen vorgeschlagenem Wert und gespeicherter Antwort.

**Änderung:** Entweder keine Auswahl vortäuschen, bis der Nutzer gewählt hat, oder den Vorschlag verständlich kennzeichnen und erst bei fehlgeschlagener Weiteraktion einen Fehler zeigen. Formulierung von Pflichtvalidierung und Speicherstatus trennen.

### P2: Plugin-Katalog und Serverstand müssen beim Release gemeinsam geprüft werden

**Beobachtung:** Die verbundene URL war korrekt, doch ChatGPT bot die im Servercode vorhandene Kontolöschfunktion nicht an. Die in dieser Codex-Sitzung sichtbaren Arnold-Werkzeugbeschreibungen zeigen ebenfalls noch Fixture-Bezüge. Das ist ein Hinweis auf unterschiedliche Katalog-/Release-Stände; noch kein Beweis, dass jeder Aufruf alte Logik verwendet.

**Änderung:** Release-Abnahme um Tool-Aktualisierung, tatsächliche Tool-Liste und versionierte UI-Ressource erweitern. Ein Gesundheitsendpunkt mit aktuellem Commit beweist nur den Serverstand, nicht den Modellkatalog oder den tatsächlich dargestellten UI-Build.

## Sinnvolle weitere Testmethode

Die Kombination aus echtem Browser und Server-Logs sollte Teil der Release-Abnahme werden. Dazu kommen schnelle lokale Browserprüfungen mit gezielt langsamer Bridge, verlorenen Antworten und alten Host-Payloads. Die bestehenden sofort antwortenden Test-Doubles können den realen MCP-Weg nicht zeitlich abbilden.

Die nächsten Arbeiten wären in dieser Reihenfolge:

1. Sofortige Fragen-Navigation mit sauberem Entwurfs- und Speicherstatus.
2. Automatische Anzeige des im Chat erzeugten Plans.
3. Fehler beim ersten Anzeigen isolieren und mit versionsbezogenen Ressourcen testen.
4. Planprüfung und Bestätigung verständlicher gestalten.
5. Backend-Dateizugriffe und Identitätsschreibvorgänge aus dem vorherigen [Performance-Bericht](../performance-2026-11-01.md) reduzieren.

Anschließend einen kontrollierten Modellvergleich mit demselben Testfall ergänzen. Der aktuelle Test reicht bereits aus, um die Speicherung jedes einzelnen Kartenwechsels als Hauptproblem des Interaktionsdesigns zu bestätigen. Er ersetzt keinen Durchlauf bis Google-Verbindung, aktivem Dashboard und Workout.

Es wurden keine Laufzeitcodeänderungen veröffentlicht oder Cloud-Run-Konfigurationen verändert. Die vorgenommenen externen Änderungen waren der beauftragte Testdaten-Reset, die erneute Werkzeugabfrage in den Plugin-Einstellungen und die ausdrücklich getesteten synthetischen Onboarding-Eingaben samt anschließender Bereinigung.
