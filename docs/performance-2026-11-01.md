# Arnold: Analyse der Wartezeiten in ChatGPT

Stand: 1. November 2026. Untersucht wurden der lokale Quellcode, die laufende Cloud-Run-Konfiguration, die letzten 24 Stunden Cloud Logging und ein lokaler MCP-Messlauf mit synthetischen Daten. Keine Produktivdaten wurden verändert und es wurde nichts veröffentlicht.

Ergänzung aus dem anschließenden, vom Nutzer beauftragten Browsertest: [Browsertest und Testdaten-Reset](browser-test-2026-11-01/BERICHT.md). Dort sind Fragenwechsel von 4,2–5,4 Sekunden mit den Cloud-Zeiten abgeglichen; rund 3,2–3,4 Sekunden lagen vor Eingang bei Cloud Run. Außerdem wurden das Hängenbleiben der ersten App-Ansicht und der fehlende automatische Übergang zum fertigen Plan beobachtet. Die folgenden Aussagen zur noch fehlenden Klickmessung beschreiben den Stand **vor** diesem ergänzenden Test.

## Ergebnis

Die bisherige Umsetzung koppelt jeden beantworteten Onboarding-Schritt an eine vollständige MCP-Rundreise durch den ChatGPT-Host und eine bestätigte Speicherung. Das erklärt, weshalb auch eine einfache Fragenkarte warten muss. Zusätzlich sind beim Öffnen Kaltstarts, wiederholte große UI-Antworten und erneute Zustandsabfragen sichtbar.

Die eigentliche Speicherung dauerte in den fünf aktuellen Live-Aufrufen 531–689 ms; die zugehörigen vollständigen HTTP-Anfragen an Cloud Run 861–1.068 ms. Damit sind zehn Sekunden pro Klick durch den gemessenen Arnold-Speichervorgang allein **nicht** erklärt. Die Zeit vom Browser-Klick bis zum nächsten sichtbaren Bild wurde bisher nicht aufgezeichnet. Welchen Anteil ChatGPT-Host, Weiterleitung, Browser und gegebenenfalls Freigaben haben, bleibt deshalb offen.

Ein großes ChatGPT-Modell ist anhand des Codes keine notwendige Erklärung für normale Fragenwechsel: Die Karte ruft direkt `App.callServerTool` auf. Einen neuen Chat-Turn fordert sie erst bei „Plan erstellen“ oder der Übernahme eines eigenen Plans an. Das sagt noch nichts über zusätzliche Verarbeitung im Host aus.

## Live-Nachweise

- Projekt `arnold-513219`, Region `europe-west1`, Revision `arnold-00011-h6s`, 100 % Traffic.
- Live-Commit: `46a964ad0eb6972133cf80d07454ffb0f01d3de7`. Der lokale HEAD enthält zusätzlich den Dokumentationscommit `e6d1e2b`.
- 1 vCPU, 512 MiB, Parallelität 80, maximal eine Instanz je Revision. Keine Mindestinstanz konfiguriert; das Deploy-Skript verwendet standardmäßig 0.
- Zustand unter `/app/data` liegt in `arnold-513219-state`, eingebunden über Cloud Storage FUSE.
- Im betrachteten Testfenster: 12 Tool-Logs und 24 MCP-HTTP-Anfragen, sämtliche HTTP-Antworten mit Status 200. Zwei Zustandsabfragen lieferten fachliche Fehler; davor wurde ein abgelaufener Einrichtungsstand gelesen. HTTP 200 bedeutet bei MCP nicht automatisch fachlichen Erfolg.

Die Nutzerinteraktionen liegen am 1.11. gegen **19:46–19:48 Uhr Europe/Berlin**; die folgenden Rohzeitstempel sind UTC.

| Ende des Tool-Aufrufs (UTC) | Tool-Zeit | Ganze HTTP-Anfrage | Differenz außerhalb des gemessenen Tool-Wrappers |
| --------------------------- | --------: | -----------------: | -----------------------------------------------: |
| 18:46:30.934                |    531 ms |             861 ms |                                           330 ms |
| 18:46:34.145                |    560 ms |             887 ms |                                           327 ms |
| 18:46:37.950                |    566 ms |             876 ms |                                           310 ms |
| 18:47:14.042                |    630 ms |             999 ms |                                           369 ms |
| 18:47:17.658                |    689 ms |           1.068 ms |                                           379 ms |

Alle fünf Aufrufe waren `update_onboarding_profile` und erfolgreich. Die Zuordnung erfolgt über das Ende der HTTP-Anfrage und den unmittelbar davor geschriebenen Tool-Logeintrag; die Logs enthalten noch keine gemeinsame Aufruf-ID. Die Differenz umfasst HTTP-Vorbereitung, Identitätsauflösung, gegebenenfalls Warten und Antwortverarbeitung, **nicht** die Zeit im ChatGPT-Browser.

Weitere Messungen:

- `show_arnold_onboarding`: 1.562 ms beim ersten Aufruf, später 214 ms im Tool-Wrapper; vollständige HTTP-Zeiten 1.903 bzw. 556 ms.
- `get_onboarding_state`: 160–196 ms im Tool-Wrapper.
- Die initialen MCP-Anfragen brauchten 1,06–5,79 Sekunden. Fünf große Antworten hatten jeweils 1.112.599 Byte. Größe und lokaler Ressourcen-Messlauf sprechen stark für wiederholtes Ausliefern des UI-Bundles; die vorhandenen HTTP-Logs protokollieren die JSON-RPC-Methode nicht.
- System-Logs zeigen Instanzstarts um 18:45:59.789 und 18:46:14.967 UTC. Die Startup-Probe war nach rund 3,97 bzw. 1,75 Sekunden erfolgreich. Warum in diesem Fenster zwei Instanzen derselben Revision starteten, ist aus diesen Einträgen nicht bestimmt.
- Eigener erster `/health`-Abruf: 2,67 Sekunden, zeitgleich mit einem weiteren protokollierten Instanzstart. Spätere warme Abrufe: 54–59 ms. Das misst die Erreichbarkeit, keine authentifizierte Speicheroperation.

## Konkrete Ursachen im Code

### 1. Jede Frage wartet auf die komplette Rundreise

`src/ui/components/onboarding.tsx:291–329`: `next()` wartet in Zeile 325 auf `onSave(patch)`, erst danach setzt es die nächste Frage. Währenddessen verhindern der Guard und der globale Busy-Zustand weitere Interaktionen.

`src/ui/views/OnboardingView.tsx:388` verbindet diesen Aufruf mit `useOnboarding.saveProfile`. `src/ui/hooks/useOnboarding.ts:174–243` serialisiert die Speicherung und wartet auf die Serverantwort. `src/ui/client.ts:249–261` leitet den Aufruf über die MCP-App-Bridge weiter.

Die Serialisierung schützt Revisionen und unbekannte Schreibausgänge, blockiert aber in ihrer jetzigen Form auch die lokale Fragen-Navigation. Die zentrale UX-Verbesserung liegt darin, noch nicht gespeicherte Antworten als lokalen Entwurf zu behandeln und den Fragenwechsel von der Bestätigung zu lösen. „Gespeichert“ darf erst nach Serverbestätigung erscheinen.

### 2. Zusätzliche Zustandsabfragen beim Öffnen

`src/ui/client.ts:150–191` revalidiert das erste Dashboard-Ergebnis vor der Veröffentlichung. Das Onboarding zeigt zunächst den übergebenen Stand und lädt über `src/ui/hooks/useOnboarding.ts:150–166` erneut. Diese Logik schützt vor alten Ergebnissen aus wieder geöffneten Chats und darf nicht ersatzlos entfernt werden.

Verbesserung: Bei einem frischen, vertrauenswürdig als frisch erkennbaren Ergebnis vorhandene Daten sofort nutzen; bei Replays weiterhin abgleichen. Andernfalls explizit einen vorläufigen Stand anzeigen und einen einmaligen Abgleich durchführen, der neuere lokale Eingaben nicht überschreibt. Unnötige Remounts und parallele Leseaufrufe vermeiden.

### 3. Dateien im Bucket werden wie eine interaktive Datenbank verwendet

`src/server/onboarding/repository.ts:280–310` liest die Sitzungsdatei und ersetzt sie über temporäre Datei, `flush` und `rename`. `src/server/onboarding/service.ts:431–446` schreibt danach zusätzlich den Audit-Eintrag. `src/server/connected/state.ts` liest und schreibt dafür wiederum eine JSON-Datei. Diese Operationen betreffen in der Cloud den Bucket, keine lokale SSD.

Zusätzlich löst `src/server/http.ts:310–364` die Identität zweimal auf, der Tool-Guard nochmals. `ArnoldIdentityResolver.resolve` verwendet `repository.register`; dieses aktualisiert auch bei bekannten Nutzern `last_seen_at_utc` und schreibt die Identitätsdatei erneut (`src/server/identity/repository.ts:133–140,254–273`). So verursachen selbst wiederholte Identitätsprüfungen Dateischreibvorgänge. Die beobachteten 310–379 ms außerhalb des Tool-Wrappers passen zu zusätzlichem Vorbereitungsaufwand; ohne interne Spans ist dessen genaue Aufteilung nicht gemessen.

Kurzfristig: Identitätsauflösung innerhalb einer Anfrage wiederverwenden, Aktivitätszeitpunkte gezielt statt mehrfach pro Anfrage persistieren und doppelte Datei-Lesevorgänge vermeiden. Autorisierung und aktuelle Kontosperren müssen weiterhin geprüft werden. Mittelfristig: Sitzungen und Journale auf einen transaktionalen Zustandsspeicher umstellen; Bucket für Backups oder Exporte verwenden. Einfaches Weglassen von `flush`, Audit oder Bestätigungen ist keine belastbare Lösung.

### 4. Große UI-Ressource und unnötig umfassende Request-Sperre

`vite.config.ts` erzeugt eine einzige HTML-Datei mit allen Ansichten, SDKs und Charts. Beide UI-Ressourcen liefern dieses Bundle (`src/server/mcp-arnold.ts:310–338`, `src/server/mcp-onboarding.ts:209–239`). Der aktuelle Build hat 1.110,33 kB HTML; gzip-Größe laut Build 318,38 kB, ohne Nachweis, dass dieser Transport tatsächlich komprimiert ist.

Jeder authentifizierte POST wird in `src/server/http.ts:359–364` unter dieselbe Nutzersperre gestellt. Das betrifft auch Initialize- und Ressourcenanfragen. Innerhalb der Sperre werden Nutzerruntime und MCP-Server vorbereitet. Damit können statische Ressourcen und echte Nutzerschreibvorgänge unnötig aufeinander warten. Der Server wird pro Anfrage neu registriert; ein lokaler warmer Messlauf brauchte hierfür insgesamt nur wenige Millisekunden bis rund 20 ms und beweist daher für sich keinen großen CPU-Engpass.

Verbesserung: Unveränderliche UI-Ressourcen pro Release vorbereiten/cachen, Onboarding-Bundle verkleinern und statische Protokollanfragen aus unnötiger Nutzer-Schreibserialisierung lösen. Dabei keine nutzergebundenen Handler zwischen Konten teilen. Ressourcen-URIs bei inhaltlichen Änderungen versionieren und das Host-Caching prüfen. Noch zu klären ist, warum der Host hier fünf vergleichbar große Antworten abgerufen hat.

### 5. Dashboard-Lesen hat weitere Google-Rundreisen

Für eine bereits eingerichtete Datei prüft `src/server/connected/runtime.ts:482–487` vor dem Datenlesen die Drive-Datei. Der Sheets-Reader lädt Metadaten und danach die sechs Tabellen parallel (`src/server/arnold-sheets-read-adapter.ts:196–203,256–268`). Es gibt nur eine Bündelung gleichzeitig laufender Leseaufrufe, keinen über aufeinanderfolgende Aufrufe nutzbaren Snapshot-Cache (Zeile 305 ff.). `source.invalidate()` im Connected-Pfad ist leer.

Das ist ein belegter Kostenfaktor im Code, aber **keine gemessene Dashboard-Latenz dieses Testfensters**: Darin wurde noch kein eingerichtetes Dashboard gelesen. Mehrere Tabellen könnten in einer Anfrage gelesen und Ansichten aus einem gemeinsamen Snapshot berechnet werden. Ein kurzer, nutzergebundener Lesecache benötigt klare Invalidierung nach Schreibvorgängen; Revisionen, externe Änderungen und Eigentumsprüfungen dürfen dadurch nicht verdeckt werden.

## Empfohlene Reihenfolge

1. **Fragen sofort wechseln lassen:** Antworten lokal als ungespeicherten Entwurf halten; Speicherung kontrolliert bündeln oder im Hintergrund serialisieren. Vor Plananforderung und Bestätigung alle offenen Änderungen bestätigen lassen. Ausstehende Speicherung sichtbar machen, Originalaufträge bei unklarem Ergebnis erhalten und verlorene Antworten nach Reload vermeiden. Das nimmt die MCP-Wartezeit aus jedem einzelnen Kartenwechsel.
2. **Messung ergänzen:** Klick → MCP-Aufruf, MCP-Antwort → React-Commit/Frame; serverseitig HTTP-Eingang, Sperrwartezeit, Identität, Sitzung, Audit und Google-APIs. Gemeinsame zufällige Korrelations-ID; keine Antworten, Tokens oder personenbezogenen Inhalte loggen. Erst damit lässt sich die noch fehlende Zeit exakt zuordnen.
3. **Start verkürzen:** Eine Mindestinstanz erwägen (zusätzliche laufende Kosten), UI-Bundle und wiederholte Ressourcenabrufe optimieren, Revalidierung nur einmal pro Öffnung und ohne unnötige Kette. Eine Mindestinstanz reduziert Kaltstartlatenz, löst den einzelnen Fragenwechsel aber nicht allein.
4. **Speicher- und Dashboard-Pfade optimieren:** Wiederholte Identitätsschreibvorgänge entfernen, Leseaufrufe bündeln, anschließend transaktionalen Zustandsspeicher planen.

Mehr Instanzen allein sind mit den heutigen Prozesssperren und Dateispeichern kein geeigneter erster Schritt. Die bestehende Eininstanz-Grenze schützt Annahmen der Implementierung; horizontal skalieren erst nach passender Koordination und Speicherumstellung.

## Abnahme nach einer Umsetzung

- Reale ChatGPT-Sitzung mit warmem und kaltem Server getrennt messen; Modell und Freigabeeinstellungen dokumentieren.
- Mindestens 20 Fragenwechsel messen, Median und p95 ausweisen; Ziel für den sichtbaren lokalen Wechsel: unter 200 ms. Das ist ein Entwicklungsziel, kein bereits nachgewiesener Wert.
- Langsames Netz, schnelle Klicks, Zurücknavigation, verlorene Serverantwort und Reload prüfen. Kein Datenverlust, kein falscher Speichererfolg, keine doppelte Änderung.
- „Plan erstellen“ erst bei bestätigter letzter Profilrevision zulassen.
- Dashboard nach abgeschlossener Einrichtung separat messen; die aktuellen Onboarding-Logs ersetzen diesen Test nicht.

## Durchgeführte lokale Verifikation

- `npm run build:ui`: erfolgreich. Nur ignorierte Build-Dateien aktualisiert, kein Laufzeitcode geändert.
- Temporärer lokaler MCP-HTTP-Messlauf, ausschließlich synthetische Daten: Initialize ca. 23 ms; Tool-Liste 17–21 ms, 579.850 Byte bei 36 Fixture-Tools; Ressourcenliste ca. 2 ms; aktuelle UI-Ressource ca. 6–7 ms, 1.112.417/1.112.418 Byte JSON-Body. Die Fixture-Tool-Liste ist nicht identisch mit der Connected-Liste und wird nicht als Live-Messung verwendet.
- Diese lokalen Werte enthalten weder GCS-FUSE noch WorkOS, die ChatGPT-Bridge oder echte Google-APIs. Sie dienen zum Abgleich der Paketgröße und zeigen keine Ende-zu-Ende-Geschwindigkeit in ChatGPT.

## Quellen

- [OpenAI: Erfahrungen beim Bauen von ChatGPT-Apps](https://developers.openai.com/blog/15-lessons-building-chatgpt-apps), Abschnitt zu Lazy Loading: Tool-Rundreisen können mehrere Sekunden brauchen; vorhandene Daten im Widget direkt nutzen.
- [OpenAI: UI an MCP-Server anbinden](https://developers.openai.com/plugins/build/chatgpt-ui): Bridge-Aufrufe, Widget-Zustand und Tool-Ergebnisse.
- [Google Cloud: Mindestinstanzen](https://docs.cloud.google.com/run/docs/configuring/min-instances): Kaltstartlatenz reduzieren, zusätzliche Kosten, keine Garantie gegen jeden Neustart.
- [Google Cloud: Cloud-Storage-Volumes](https://docs.cloud.google.com/run/docs/configuring/services/cloud-storage-volume-mounts): Dateioperationen über Cloud Storage FUSE, Cacheverhalten und Grenzen der Schreibkoordination.

Die Logauszüge und der temporäre synthetische Messlauf liegen für diese Untersuchung unter `/private/tmp/arnold-performance-*`. Der Bericht enthält keine Trainingsantworten, Zugangsdaten oder Nutzerkennungen.
