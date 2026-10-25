# Google-Sheets-Lesezugriff

Stand: Adapter und private lokale Konfiguration vorbereitet. Das Google-Dienstkonto ist erstellt und die ausgewählte Datei wurde dafür als Betrachter freigegeben. Der erstellte Schlüssel konnte nicht als nutzbare lokale Datei abgelegt werden; die Schlüsseldatei und die Bestätigung der aktivierten Sheets API stehen noch aus. Ein erfolgreicher Live-Test mit dem Backend ist deshalb noch offen. Auf Nutzerwunsch wird vorerst nur lokal getestet; ein privater OpenAI-Tunnel und ein OpenAI-Schlüssel wurden nicht angelegt.

## Datenweg

Bestehendes GPT → schreibt Trainingslog in Google Sheets → privater MCP-Server liest Trainingslog → MCP-Tool-Ergebnis → Dashboard im ChatGPT-Chat.

Die Drive-Verbindung von ChatGPT ist kein automatisch nutzbarer OAuth-Zugang für einen fremden MCP-Server. Der Server braucht separat autorisierten Google-Zugriff. Für diesen einzelnen lokalen Prototyp ist ein Dienstkonto ohne Cloud-Projektrollen vorgesehen, mit Betrachterfreigabe ausschließlich für die ausgewählte Datei. Google gewährt Zugriff auf Dateiebene; technisch kann das Dienstkonto alle Tabs der freigegebenen Datei lesen. Unser Adapter fragt ausschließlich den vereinbarten Tab und A:G/O:S ab. Einen eigenen Trainingslog-Export zu verwenden wäre nötig, um die Tab-Grenze auch über Google-Berechtigungen zu erzwingen.

## Private Konfiguration

Vorlage in `.env.example`. Lokales `.env.sheets` enthält die explizite Datei-/Tab-Zuordnung. Schlüssel ausschließlich als `data/google-sheets-reader.json`, außerhalb von Git und mit Dateimodus 600. Keine Schlüssel in Chatnachrichten, Screenshots oder Tool-Ergebnissen.

Nach freigegebener Einrichtung und aktivierter Sheets API:

```bash
node --env-file=.env.sheets --import tsx scripts/check-sheets.ts
node --env-file=.env.sheets dist/server/main.js
```

Der Check gibt nur Herkunft, aggregierte Kennzahlen, Ladezeit und Anzahl übersprungener Zeilen aus. Vorschau: `http://localhost:8788/host`. Der Server bindet nur Loopback. Die bisherigen Demo-Prozesse auf Port 8787 bleiben unabhängig.

Echte Daten **nicht** über den öffentlichen Cloudflare-Demo-Tunnel leiten. Für ChatGPT einen privaten Secure MCP Tunnel verwenden. Eine private Verbindung muss separat eingerichtet und durch einen tatsächlichen Tool-Aufruf in ChatGPT verifiziert werden; implementierter Adapter allein ist noch kein erfolgreicher Live-Test.

## Spalten und Verhalten

- Kopfzeile 4: A:G = Datum, Einheit, Übung, Satz, Wdh., Gewicht / Zusatz (kg), RPE.
- O:S = Typ, Effektive Last (kg), Satz-ID, Duplikat, Zeile ok.
- Unterstützte Typen: Gewicht, Eigengewicht. Split: Push/Pull/Legs, zusätzlich Beine → Legs.
- Eigengewicht benötigt eine gültige effektive Last; ein fehlender Wert wird nicht als Null geraten.
- Andere Tabs sowie H:N und T:Z werden nicht gelesen.
- Obergrenze konfigurierbar, derzeit 20.004 Grid-Zeilen. Wächst das Grid darüber, wird mit einer gezielten Fehlermeldung gestoppt statt still abzuschneiden.
- Datei-/Tab- oder Spaltenänderungen stoppen den Import. Keine automatische Suche nach Ersatzdateien.
- Lesen bei jedem Tool-Aufruf; Aktualisieren lädt die Datei erneut. Kein Daten- oder Tokenzugriff vom iframe.
- Keine Schreib-, Reset- oder Append-Funktion für die echte Datei. Training weiterhin über das vorhandene GPT erfassen.

## Validierung

Synthetische Master-ähnliche Testzeilen prüfen Datumsserien, Dezimalkomma, Eigengewicht, effektive Last, stabile IDs, Duplikate, unvollständige Zeilen, Metadaten-Abweichungen und Bereichsgrenzen. MCP-Integration prüft vier reine Lesetools, aktuelle Werte nach Quellenänderung und öffentliche Origin-Sperren. Der Browser-Test prüft den vollständigen AppBridge-Lifecycle mit dieser Testquelle, Quellenhinweis, Rekorde, Fortschritt, Aktualisieren und ausgeblendete Demo-Schreibaktionen. Die Tests verwenden keine privaten Trainingszeilen.
