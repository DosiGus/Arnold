# Schnelle Onboarding-Karten: Umsetzung und Live-Abnahme

Stand 2. November: als `1890d5e` auf GitHub veröffentlicht und auf Cloud Run abgenommen. Live läuft inzwischen `689c21b` mit einer zusätzlich im Browsertest gefundenen und korrigierten Planreferenz. Einzelheiten und verbleibende Fehler stehen im [Live-Testbericht](live-audit-2026-11-02/BERICHT.md).

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

## Live-Abnahme am 2. November

1. Beide Code-Commits wurden gepusht, vollständig in GitHub geprüft und mit dem bestehenden Skript veröffentlicht. Abschließend live: `arnold-00013-7wj`, Commit `689c21b`, 100 % Traffic; Health und Auth-Smoketest erfolgreich.
2. ChatGPT-Tools wurden aktualisiert und ein neuer Chat mit leerem Testkonto geöffnet. Die normalen Fragenwechsel liegen überwiegend bei 293–303 ms. Der letzte Wechsel zeigte zunächst einen Ausreißer von 2.213 ms, bei der Wiederholung 322 ms. Median der fünf ersten Pflichtfragenwechsel: 297 ms. Dies sind Browser-Automationsmessungen, keine instrumentierten Paint-Zeiten.
3. Antworten bleiben nach Reload erhalten; ein im Chat erzeugter Plan erscheint automatisch in der bereits laufenden Karte. Zusätzliche Chat-Rückfragen und die kurz alte Ansicht beim Reload bleiben eigene Ablaufprobleme.
4. Der erste App-Aufruf scheitert weiterhin; Retry öffnet die Karte in 453 ms. Die neue Ressourcenadresse ist keine Lösung dieses separaten Initialisierungsfehlers.
5. Ein Übungsaustausch und ein neuer Ganzkörperentwurf wurden per Chat getestet. Dabei verdeckte eine historische Bestätigungsreferenz den neuen Plan. Der ergänzende Fix wurde zunächst mit einem fehlschlagenden Regressionstest nachgewiesen, danach mit 1.433 Unit-/Integrationstests und vollständiger Browser-CI geprüft. Die korrigierte Vorschau, der Editor und die Bestätigung des richtigen Plans sind live verifiziert.
6. Die anschließende Google-Anmeldung ist mit 403 blockiert: Die OAuth-App hat keine freigeschalteten Testnutzer. Die gezielte Konto-/Dateifreigabe steht zur Entscheidung aus. Daher sind Dashboard, sechs Trainingstage und Gewichtskorrekturen noch nicht live abgenommen. Der synthetische Planstand bleibt zur Fortsetzung erhalten; null Workouts und null Sätze.

Die übrigen möglichen Backend-Optimierungen aus der [ersten Performance-Analyse](performance-2026-11-01.md), etwa weniger Identitätsschreibvorgänge und effizientere Dashboard-Lesewege, gehören zu einem weiteren Schritt. Für diesen Patch ist keine Erhöhung von CPU, Instanzzahl oder Datenbankmigration nötig.
