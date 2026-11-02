# Schnelle Onboarding-Karten: vorbereitete Umsetzung

Stand: lokal umgesetzt, noch nicht auf GitHub veröffentlicht oder auf Cloud Run bereitgestellt.

## Was sich ändert

Bisher: Klick → MCP-Rundreise und bestätigte Speicherung → nächste Karte.

Jetzt: Klick → nächste Karte. Die noch unbestätigten Antworten werden getrennt gesammelt und im Hintergrund gespeichert. Vor einer Plananforderung oder einer anderen Kontrollaktion wird die Speicherung vollständig abgeschlossen. Der Server bleibt die Quelle für bestätigte Daten, Revisionen, Planfreigaben und Berechtigungen.

Die Wartezeit des MCP-Wegs wird damit aus den normalen Fragenwechseln und der ersten Wahl „Plan mit Arnold erstellen“ genommen. Die Netzwerkanfragen selbst werden dadurch nicht auf Millisekunden beschleunigt. Planerzeugung durch das Modell bleibt eine eigene, länger laufende Aktion.

## Umgesetzt

- `OnboardingProfileBuffer` hält lokale Eingaben getrennt vom bestätigten Serverstand. Nach einer kurzen Eingabepause werden Antworten zu einem minimalen Patch zusammengefasst. Bereits laufende Aufträge bleiben unveränderlich; spätere Antworten warten in einem getrennten Puffer.
- Die Fragenkarte kann sofort fortsetzen. Auch der Einstieg vom Willkommensbildschirm ist lokal. Vor der Übergabe eines eigenen Plans an den Chat wird der gewählte Pfad gespeichert.
- Die Plananforderung wartet auf sämtliche ausstehenden Antworten und verwendet erst danach die aktuelle bestätigte Revision. Ein zweiter Klick startet keinen zweiten Kontrollauftrag.
- Der Speicherstatus unterscheidet ausdrücklich zwischen lokalen Antworten und bestätigtem Stand. Ein fehlgeschlagener Auftrag wird nicht als gespeichert angezeigt.
- Lokale Eingaben und der ursprüngliche Auftrag werden in derselben Browsersitzung nach einem Reload wieder aufgenommen. Wo Browser-Speicher nicht verfügbar ist, gibt es einen Speicherhinweis und einen Speicher im laufenden Client; eine Wiederherstellung nach Schließen kann dort nicht garantiert werden.
- Änderungen aus dem Chat werden nicht still überschrieben. Bei einem Revisionskonflikt bleiben die lokalen Antworten erhalten; erneutes Speichern verlangt eine ausdrückliche Aktion.
- Ein Profilauftrag mit verlorener Bestätigung lässt sich mit derselben Auftrags-ID und ursprünglichen Revision erneut prüfen. Der Server erkennt die Wiederholung vor der Prüfung der inzwischen erhöhten Revision.
- Während der regulären Planerstellung gleicht die Karte den Stand begrenzt und ohne überlappende Abfragen ab. Der im Chat erzeugte Vorschlag erscheint automatisch. Es gibt weiterhin die manuelle Rückfallebene. Dies betrifft den Zustand `WAITING_FOR_PLAN_PROPOSAL`; die separate Suche beim eigenen Plan bleibt bestehen.
- Die neue Oberfläche hat die Ressourcenadresse `ui://arnold/onboarding-v2.html`. Die bisherige Adresse bleibt für gespeicherte Karten lesbar. Neue Aufrufe können damit nicht allein wegen derselben Ressourcenadresse den vorherigen Bundle-Stand übernehmen.
- Die Aktivierung eines Buttons blendet dessen Deckkraft nicht mehr langsam ein. Das vermeidet kurzzeitig zu schwachen Kontrast bei einer gerade freigegebenen Schaltfläche.

Die reinen Profilregeln wurden in ein gemeinsames Modul verschoben, damit lokale Vorschau und Server dieselben Regeln für Wochentage, Übungsvorlieben, Validierung und Fortschritt verwenden. Der bisherige Serverimport bleibt über einen Reexport kompatibel.

## Abnahme

Die lokalen Browserprüfungen testen unter anderem:

- Willkommensauswahl und jede weitere Frage innerhalb eines 500-ms-Prüfbudgets, während eine echte MCP-Anfrage mindestens drei Sekunden angehalten bleibt;
- weitere Antworten während eines laufenden Auftrags, mit zwei gebündelten Speicheraufträgen im kontrollierten Test;
- keine Plananforderung vor Bestätigung der letzten Antwort;
- Wiederaufnahme nach Reload sowohl vor dem ersten Hintergrundauftrag als auch nach verlorener Serverantwort;
- automatische Anzeige eines über den Chatpfad erzeugten Vorschlags;
- Revisionskonflikte einschließlich einer neueren Chatänderung während einer verspäteten Bestätigung.

Das 500-ms-Limit ist ein lokales Testbudget in Chromium und WebKit, keine bereits gemessene neue Ende-zu-Ende-Latenz in ChatGPT. Die bisherigen Live-Messungen stehen im [Browsertest-Bericht](browser-test-2026-11-01/BERICHT.md).

Abgeschlossen: `npm run check` erfolgreich. Build und Typecheck sind grün; 76 Vitest-Dateien mit **1.432 bestandenen Prüfungen** sowie **91 bestandene Browserprüfungen**. Die neuen Latenz- und Wiederaufnahmeprüfungen laufen in Chromium und WebKit. Der vollständige finale Lauf enthält auch die vorhandene Connected-Strecke mit synthetischer Google-Freigabe, Trackerdatei und erster Satzeingabe.

Die automatisch neu geschriebenen bestehenden Beta-Screenshots wurden nach dem Test auf ihren vorherigen Stand zurückgesetzt; sie gehören nicht zur Änderung.

## Noch vor einer Live-Abnahme

1. Diesen Stand committen und pushen; die CI des konkreten Commits muss grün sein.
2. Mit dem bestehenden Deploy-Skript veröffentlichen. Datenformat, Cloud-Ressourcen, Berechtigungen und Zielgruppe werden dafür nicht geändert.
3. In ChatGPT die Tools aktualisieren und einen neuen Chat öffnen, damit die neue UI-Ressourcenadresse verwendet wird.
4. Die Fragenwechsel erneut im echten Host messen, anschließend den Teststand wieder leeren.
5. Den separaten Fehler beim allerersten Anzeigen in Inline-Ansicht und App-Bereich erneut untersuchen. Die neue Ressourcenadresse allein ist kein Nachweis, dass dieser Fehler behoben ist.

Die übrigen möglichen Backend-Optimierungen aus der [ersten Performance-Analyse](performance-2026-11-01.md), etwa weniger Identitätsschreibvorgänge und effizientere Dashboard-Lesewege, gehören zu einem weiteren Schritt. Für diesen Patch ist keine Erhöhung von CPU, Instanzzahl oder Datenbankmigration nötig.
