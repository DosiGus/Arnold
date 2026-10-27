# Lokaler Testbericht

Die Umbenennung zu **Arnold 0.4.0** wurde am **25.10.2026** mit Build, Typecheck, allen **30 Unit-/MCP-Tests**, allen **9 Browser-Tests** und Formatprüfung bestätigt. Browser-Titel, Arnold-Navigation sowie die aktualisierten Desktop-/Mobil-Screenshots wurden zusätzlich geprüft.

Geprüft am **24.10.2026**, macOS/ARM, Node **26.7.0**, npm **11.19.0**, Chromium **156.0.8078.4** über Playwright **1.64.1**.

## Ergebnisse

| Prüfung                                         | Ergebnis                                                                             |
| ----------------------------------------------- | ------------------------------------------------------------------------------------ |
| `npm install` und reproduzierbares `npm ci`     | Erfolgreich; npm-Audit meldete 0 bekannte Schwachstellen zum Prüfzeitpunkt           |
| `npm run build` einschließlich Typecheck        | Erfolgreich; selbstständige HTML-Bundles und kompilierter Node-Server                |
| `npm test`                                      | **30/30** bestanden, vier Testdateien                                                |
| `npm run test:e2e`                              | **9/9** bestanden in Chromium                                                        |
| `npm run format:check`                          | Erfolgreich                                                                          |
| Laufender Server / Browser-Vorschau             | Start und Darstellung auf Port 8787 geprüft                                          |
| Direkte Verbindung mit ChatGPT                  | **Erfolgreich; siehe [ChatGPT-Abnahme](CHATGPT-ABNAHME.md)**                         |
| Offizieller externer Basic Host / Inspector-GUI | Anleitung vorhanden; hier nicht zusätzlich ausgeführt                                |
| Docker / Cloud-Deployment / Tunnel              | Cloudflare-Testtunnel ausgeführt; Docker und dauerhaftes Deployment nicht ausgeführt |

Die Testausgaben enthalten eine harmlose Playwright-Meldung über gleichzeitige `NO_COLOR`-/`FORCE_COLOR`-Umgebungsvariablen. Der Build benötigt keine extern geladenen UI-Assets. Das Dashboard-Bundle hat unkomprimiert ca. **980 kB**, gzip ca. **279 kB**; der Entwicklerhost ca. 340 kB unkomprimiert.

## Was die 30 Unit-/MCP-Tests beweisen

**Berechnungen (9):** bekannte Gewichts-/Wiederholungswerte, leere Mengen, Epley-Schätzung und Single, ursprüngliche Fixture einschließlich 40.021 kg Gesamtvolumen, Wochenwechsel über Jahresgrenzen, leere Zwischenwochen, inklusive Datumsgrenzen, Splitfilter, persönliche Bestleistungen, Übungsverläufe und leere Ergebnisse ohne NaN/Infinity.

**Speicher (7):** persistenter Satz und neue Einheit, Wiederöffnung der JSON-Datei, persistente Idempotenz, zehn konkurrierende identische Requests ohne Duplikate, Konflikte bei Schlüsselwiederverwendung, bewusst gleiche Sätze mit unterschiedlichen Schlüsseln, fortlaufende Satznummern, ungültige Eingaben, vollständiger Reset und Erhalt beschädigter Dateien zur Fehlerdiagnose.

**MCP über echten HTTP-Transport (8):** Initialisierung über den offiziellen Client, Tool-Discovery aller sechs Tools, Input-/Output-Schemas und Annotationen, UI-Metadaten, `resources/list`/`resources/read`, MIME-Typ und eingebettetes Bundle, Tool-Ergebnisse mit validem `structuredContent`, Filter, Fehlerfälle, Speichern/Deduplizieren/Reset über getrennte stateless Requests, Health-/Preview-/Host-Routen und Ablehnung fremder Origins/Hosts.

Zusätzlich: Sheets-Server bietet nur vier Lesetools, frische Werte nach Änderung der Testquelle und korrektes `synthetic: false` für Dashboard, Historie und Fortschritt.

**Sheets (6):** Spaltenstruktur, Datumsserien, Dezimalkomma, effektive Last bei Eigengewicht, stabile IDs, ungültige/unvollständige Zeilen und Duplikate; feste Bereiche A:G/O:S, gebündelte gleichzeitige Reads, neue Reads nach Abschluss, Schreibsperren, Datei-/Tab-Abweichungen, Grid-Grenzen sowie Ablehnung öffentlicher Konfigurationen.

## Was die 9 Browser-Tests beweisen

1. Vorschau lädt reale MCP-Daten, filtert den Volumenchart, wechselt auf Sätze, öffnet das gewählte letzte Workout und filtert die Historie.
2. Übungsauswahl und Diagrammkennzahlen laden über MCP. Eigene Datumsgrenzen erzeugen korrekt einen Empty-State bzw. einen Fehler bei vertauschten Grenzen.
3. Logger speichert einen Satz im Backend. Nach Browser-Neuladen bleiben 109 Sätze und 40.621 kg sichtbar. Demo-Reset stellt den Ursprung wieder her.
4. **Eingebetteter MCP-Apps-Lifecycle:** der lokale Host entdeckt die UI über MCP, lädt die Ressource, initialisiert `AppBridge` ↔ `App`, liefert das initiale Tool-Ergebnis und leitet Historien-, Fortschritts-, Speicher- und Reset-Aufrufe aus dem iframe zum echten Server weiter. Der Test beobachtet die tatsächlichen `tools/call`-HTTP-Anfragen und prüft fehlende JavaScript-Laufzeitfehler.
5. Mobile Navigation, Logger und Theme-Button bei 390 × 844 px; kein horizontaler Überlauf.
6. Ein Host spielt beim Wiederöffnen absichtlich den alten 108-Satz-Snapshot ab. Die App gleicht ihn mit dem Backend ab und zeigt die inzwischen gespeicherten 109 Sätze und 40.621 kg. Dieser Regressionstest scheiterte vor der Korrektur und besteht seit Version 0.2.1.
7. Initialer dunkler Host-Kontext wird vom iframe übernommen.
8. axe-Prüfung der vier Ansichten im hellen und dunklen Theme gegen WCAG-A-/AA-Regeln; keine gemeldeten Verstöße in den geprüften Zuständen. Für stabile Kontrastmessungen werden Animationen über die unterstützte `prefers-reduced-motion`-Einstellung deaktiviert. Das ist keine vollständige manuelle Accessibility-Zertifizierung.

9. Sheets-Modus mit synthetischer Master-Struktur über den echten AppBridge-Lifecycle: Quelle und effektive Last sichtbar, dynamische Bestleistungen, Historie, Fortschritt, Aktualisieren und mobile Breite; Demo-Logger/Reset fehlen und werden nicht aufgerufen.

Der Testhost setzt eine CSP mit `connect-src 'none'` für die App. Der bestandene Schreibtest belegt damit den Weg über die Host-Bridge und nicht einen direkten Fetch aus dem iframe.

Bei der Implementierung gefundene und korrigierte Probleme: fehlendes `allow-forms` im lokalen iframe, zu geringe Textkontraste, nicht benannte Status-Tabellenspalte, fehlende zugängliche Namen der kompakten Navigation und Auswahl des passenden Workouts beim Klick aus der Übersicht.

## Analytics Engine

Die Berechnungsschicht aus Task 002 ist mit vollständig synthetischen Fixtures geprüft: Gewichtskonventionen und Ausführungsarten einschließlich der sechs Referenzbeispiele, Volumenkanäle und Abdeckung, Trainingstage über Wochen- und Jahresgrenzen, Wochenstreak mit laufender Woche, Bestleistungen und ihre Vergleichbarkeit, Epley-Grenzen, Übungsverlauf mit Serienaggregation, Planhistorie und Planerfüllung, Filterfehler, Datenqualität, Determinismus sowie numerische Extremwerte. Eine Architekturprüfung stellt sicher, dass die Schicht ausschließlich `zod` und das validierte Rohschema importiert und keine Systemuhr liest. Die Engine ist nicht an HTTP, MCP oder die Oberfläche angeschlossen; Browser-Tests decken sie daher nicht ab.

## Visuelle Prüfung

Desktop sowie mobile Light-/Dark-Ansichten wurden im Browser aufgenommen und geprüft:

- [Dashboard Desktop](screenshots/dashboard-desktop.png)
- [Dashboard Mobile](screenshots/dashboard-mobile.png)
- [Dashboard Mobile Dark](screenshots/dashboard-dark-mobile.png)

## Wiederholen

```bash
npm ci
npx playwright install chromium
npm run check
npm run format:check
```

Unit-/MCP-Tests legen temporäre Datenverzeichnisse an. E2E-Tests starten auf Port 8790 und benutzen ausschließlich `test-results/e2e-demo.json`; die laufende Demo-Datei auf Port 8787 bleibt davon unabhängig. Bei Browser-Fehlern entstehen Screenshot und Trace unter `test-results/`.

Eine Umgebung, die lokale TCP-Listener oder Browserprozesse blockiert, benötigt dafür eine entsprechende Freigabe. Die hier zunächst eingeschränkte Sandbox wurde für die lokalen Listener-/Browser-Tests freigegeben.

## Grenzen und offene Abnahme

- Die gemeinsame MCP-Apps-Bridge ist lokal und für die dokumentierten Flows in ChatGPT geprüft. Eine umfassende Modell-/Prompt-Evaluation und weitere ChatGPT-Clients stehen aus. Siehe [CHATGPT-ABNAHME.md](CHATGPT-ABNAHME.md).
- Sheets-Adapter implementiert und mit einer synthetischen Google-Transport-Testquelle geprüft. Metadaten und erlaubte Trainingslog-Bereiche wurden über den verbundenen Drive-Connector verifiziert. Ein tatsächlicher Backend-Zugriff mit eigenem Google-Schlüssel und die private ChatGPT-Verbindung sind noch offen. Keine Kundenkonto- oder Zahlungsabläufe implementiert.
- Getestet wurde Chromium; Safari, Firefox und echte Mobilgeräte stehen aus.
- Der JSON-Speicher unterstützt einen Prozess pro Datei. Verteilte Schreibvorgänge, Stromausfall-Durabilität und Mehrbenutzer-Isolation sind nicht abgedeckt.
- Keine Echtzeit-Synchronisierung zwischen mehreren bereits geöffneten Dashboards; Neuladen holt den aktuellen Backendstand.
- Keine Lasttests, kein produktiver Zugriffsschutz und kein öffentliches Hosting. Nur synthetische Daten verwenden.
