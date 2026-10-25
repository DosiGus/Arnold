# Architektur

## Ausgangslage und Modernisierung

Der ursprüngliche Starter besaß ein Tool, flüchtige Arrays, keine Output-Schemas oder Tests und ein HTML-Dashboard mit separater Fixture. Ein unvalidierter `message`-Listener ersetzte dort den MCP-Apps-Lifecycle. Die neue UI enthält keine eigene Fixture und keinen selbst implementierten JSON-RPC-/postMessage-Listener.

Am 24.10.2026 wurden die npm-Versionen und Peer Dependencies geprüft: `@modelcontextprotocol/ext-apps` **2.0.3** benötigt die modularen MCP-Pakete 2.x und Zod 4. Eingesetzt sind Client/Server/Core **2.4.0**, Node-Transport **2.1.2**, Express-Adapter **2.0.2**, React **19.3.1**, Vite **8.3.5**, TypeScript **6.0.3**, Recharts **3.10.1**, Zod **4.6.7**. Exakte Auflösungen stehen im Lockfile. Das bisherige monolithische `@modelcontextprotocol/sdk` 1.x wurde entfernt.

## Verantwortlichkeiten

```text
src/
  shared/
    schemas.ts        Eingaben, Ausgaben und Domänentypen (Zod)
    calculations.ts   Reine Berechnungen, unabhängig von I/O
  server/
    fixture.ts        Ursprünglicher synthetischer Datensatz
    storage.ts        StorageAdapter + JsonStorageAdapter
    mcp.ts            Tool-/Ressourcenregistrierung, verbindet Adapter und Berechnungen
    http.ts           HTTP-Routen, Origin-/Host-Prüfung, Transport je Anfrage
    main.ts           Prozessstart und Shutdown
  ui/
    client.ts         Offizielle App-Bridge; MCP-Client für Browser-Vorschau
    main.tsx          Bootstrap, Host-Theme, Loading-/Fehlerzustand
    App.tsx           Vier Ansichten und Interaktionen
    style.css         Theme-Tokens und responsive Layouts
  host/
    main.ts           Lokaler Host mit offiziellem AppBridge
```

Vite bündelt jeweils ein vollständiges HTML-Dokument mit eingebettetem JavaScript und CSS. Die Ressource braucht keine externen Assets. Der serverseitige TypeScript-Code wird nach `dist/server` und `dist/shared` kompiliert; `npm start` benötigt keinen TypeScript-Loader.

## MCP-Apps-Lifecycle

1. Host initialisiert einen MCP-Client gegen `/mcp` und entdeckt Tools.
2. `show_fitness_dashboard` verweist über `_meta.ui.resourceUri` auf die registrierte UI.
3. Host liest das HTML mit `resources/read`; MIME-Typ: `text/html;profile=mcp-app`.
4. Die UI registriert `ontoolresult`, Theme- und Teardown-Handler **vor** `App.connect()`.
5. Das SDK führt `ui/initialize` und die Initialized-Notification durch.
6. Host liefert Tool-Argumente und Tool-Ergebnis über die offizielle Bridge. Da ChatGPT beim Wiederöffnen einen historischen Snapshot wiedergeben kann, liest die UI vor dem ersten Anzeigen den aktuellen Stand über `get_dashboard_data` nach. Bei einem Ladefehler kann der historische Stand mit einem sichtbaren Fehlerhinweis angezeigt werden.
7. UI-Aktionen verwenden `App.callServerTool()`. Schreibtools liefern den neuen Dashboard-Snapshot zurück.

`/host` verwendet `AppBridge`, `PostMessageTransport` und einen tatsächlichen MCP-Client. Das iframe hat `allow-scripts allow-forms`, eine opake Origin und CSP `connect-src 'none'`. Die App erhält somit keine direkten Netzwerkrechte. Der Host gibt keine eigene protokollfremde Nachrichtensimulation vor. Er ist ein **lokaler Entwicklerhost**, keine vollständige Host-Plattform mit Freigabe- oder Multi-App-Verwaltung.

`/preview` läuft ohne iframe und verwendet den offiziellen `StreamableHTTPClientTransport` gegen denselben Server. Das ist ein anderer Transportweg, keine Ersatzdatenhaltung. Das Backend ist in beiden Fällen identisch.

Die Registrierung nutzt die gemeinsamen MCP-Apps-Felder. Es gibt keine Abhängigkeit von `window.openai` oder produktspezifischen Browser-Globals. Host-Themes werden initial und bei Kontextänderungen übernommen. Der Theme-Button kann sie lokal wechseln; spätere Host-Änderungen werden wieder angewendet.

## Transport und lokale Speicherung

Streamable HTTP ist stateless: Pro Request werden ein MCP-Server und Transport erstellt und anschließend geschlossen. Ein gemeinsamer StorageAdapter lebt für die gesamte HTTP-Prozesslaufzeit. Sein Inhalt liegt dauerhaft in der JSON-Datei, nicht im MCP-Transport.

Der Adapter stellt `getSnapshot`, `getWorkouts`, `getSets`, `getExercises`, `saveSet` und `resetDemoData` bereit. Berechnungen lesen einen konsistenten Snapshot. Schreiboperationen laufen über eine Promise-Warteschlange und schreiben erst eine temporäre Datei, dann ein atomares Rename. Fehlerhafte vorhandene Dateien werden nicht still durch eine Fixture ersetzt.

Das Dateiformat enthält schema-versionierte Übungen, Einheiten, Sätze und Idempotenzschlüssel. Persistenz und Schlüsselregistrierung erfolgen gemeinsam. Netzwerk-Retries erzeugen dadurch auch nach einem Prozessneustart keine Duplikate. Ein Reset beginnt eine neue Demo und löscht die Schlüssel.

Diese Garantien gelten innerhalb **eines Prozesses**. Mehrere Instanzen auf derselben Datei, verteilte Transaktionen und gleichzeitige unabhängige Adapter-Schreiber sind nicht unterstützt. Keine fsync-/Power-Loss-Garantie; atomares Rename verhindert teilweise sichtbare JSON-Inhalte.

## Berechnungsregeln

- Volumen: Summe aus Gewicht × Wiederholungen; Rundung auf zwei Nachkommastellen.
- Wochen beginnen montags; Kalenderdaten werden in UTC verarbeitet.
- Trainingstage/Woche: unterschiedliche Trainingsdaten geteilt durch Kalenderwochen zwischen erster und letzter gefilterter Einheit, einschließlich leerer Zwischenwochen. Mehrere Splits an einem Tag zählen als ein Trainingstag.
- Persönlicher Bestwert: höchstes Gewicht; bei Gleichstand mehr Wiederholungen, dann das neueste Datum. Die Demo zeigt die drei Hauptübungen; der Sheets-Modus die ersten drei vorhandenen Übungsbestwerte. Die API liefert alle.
- Epley: `kg × (1 + reps / 30)`, bei einer Wiederholung `kg`. Immer als **Schätzung** bezeichnet.
- Übungsverlauf: pro Datum maximales Gewicht, mittlere Wiederholungen über Sätze, Gesamtvolumen, höchste geschätzte 1RM und Satzanzahl.
- Datumsfilter inklusive; vertauschte Grenzen ergeben einen Toolfehler, leere gültige Bereiche ergeben leere Ergebnisse.

## Lesender GoogleSheetsStorageAdapter

`storage-config.ts` wählt `demo` oder `google_sheets`. Der Sheets-Modus erfordert `MCP_ACCESS=private`, Loopback-Bindung, ausschließlich lokale erlaubte Hosts und lokale bzw. keine Origins. Eine öffentliche Demo-Konfiguration lässt den Server nicht mit echten Daten starten. Diese Prüfungen ersetzen keine Authentifizierung eines externen Transports; für ChatGPT muss eine private Verbindung eingerichtet werden.

`google-sheets-storage.ts` verwendet die offizielle `google-auth-library` mit `spreadsheets.readonly`. Keine Connector-Cookies oder GPT-OAuth-Tokens werden übernommen. Ein Dienstkonto erhält nur Betrachterrechte an der ausgewählten Datei. Google-Rechte gelten dennoch für die ganze Datei, nicht für einen Tab; diese Grenze muss vor der Freigabe klar sein. Der Code fragt nur den fest konfigurierten Tab ab.

Vor jeder Datenabfrage werden Datei-ID, Tab-ID, Tab-Name und Grid-Grenzen verifiziert. Werte werden als unformatierte Zahlen mit Datumsserien gelesen. Der Parser prüft die exakten Überschriften, interpretiert Google-Datumszahlen/German-Datumswerte und Dezimalzahlen, verwendet die effektive Last, validiert Sätze über Zod und verwirft Duplikate oder nicht als `ok` markierte Zeilen. IDs werden stabil aus Datei, Tab und Satz-ID bzw. Übungsnamen abgeleitet. Warnungen enthalten Zeilennummern und Gründe, keine kopierten Zellinhalte.

Gleichzeitige Abfragen teilen denselben laufenden Read. Nach Abschluss gibt es keinen Snapshot-Cache; der nächste Abruf liest Google erneut. Eingaben und berechnete Spalten werden in getrennten, begrenzten Reads gelesen; gleichzeitiges GPT-Schreiben ist keine transaktionale Snapshot-Garantie. Nach abgeschlossenem Logging erneut aktualisieren.

`saveSet` und `resetDemoData` lehnt der Adapter ab. Die entsprechenden MCP-Tools werden in diesem Modus nicht registriert. Das bestehende GPT bleibt der Schreiber. Die UI erhält Herkunft, Ladezeit und übersprungene Zeilen und zeigt drei lesende Ansichten mit Aktualisieren an. Das iframe selbst erhält weder Google-Schlüssel noch Netzwerkrechte.

Das ist eine einzelne, explizit konfigurierte private Datei für diesen Nutzer. Ein Produkt für mehrere Nutzer benötigt Nutzeranmeldung, je Nutzer autorisierte Dateien und getrennte Credentials. Es wird keine Mehrnutzerfähigkeit behauptet.

## Offizielle Grundlagen

- [MCP Apps Quickstart](https://github.com/modelcontextprotocol/ext-apps/blob/main/docs/quickstart.md)
- [MCP Apps Basic Host](https://github.com/modelcontextprotocol/ext-apps/tree/main/examples/basic-host)
- [OpenAI: Add UI to your MCP server](https://developers.openai.com/plugins/build/chatgpt-ui)
