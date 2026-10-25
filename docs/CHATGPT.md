# Verbindung mit ChatGPT vorbereiten

Stand: 24.10.2026. Der lokale MCP- und iframe-Workflow ist getestet. **Die Verbindung und ein erfolgreicher Aufruf in ChatGPT wurden inzwischen durchgeführt.** Der aktuelle [Abnahmebericht](CHATGPT-ABNAHME.md) dokumentiert die verwendete Testinstallation. Die folgenden Schritte benötigen den Zugriff auf dein ChatGPT-Konto bzw. die Tunnel-Verwaltung.

## Aktueller Sheets-Modus

Version 0.4.0 implementiert einen privaten, lesenden Sheets-Adapter. Die bestehende ChatGPT-Installation ist weiterhin die öffentliche synthetische Demo. Für echte Trainingsdaten eine **separate private Verbindung** auf Port 8788 einrichten; siehe [Google Sheets](GOOGLE-SHEETS.md). Im Sheets-Modus werden vier Lesetools entdeckt. Demo-Logger und Reset existieren dort nicht. Der bisherige ChatGPT-Abnahmebericht bezieht sich auf die Demo.

## Option A: offizieller Secure MCP Tunnel

[Secure MCP Tunnel](https://developers.openai.com/api/docs/guides/secure-mcp-tunnels) verbindet einen privaten Server über eine ausgehende Verbindung. Dafür werden eine Tunnel-ID, ein berechtigter Runtime-Key und die Zuordnung zum gewünschten ChatGPT-Workspace benötigt. Im Projekt werden dafür keine Secrets angelegt.

1. Demo mit `npm start` starten; für die freigegebene echte Datei `node --env-file=.env.sheets dist/server/main.js` (Port 8788).
2. In den [Platform-Tunneleinstellungen](https://platform.openai.com/settings/organization/tunnels) den passenden Tunnel auswählen bzw. einrichten und Organisation/Workspace zuordnen.
3. Den offiziellen [tunnel-client](https://github.com/openai/tunnel-client/releases/latest) installieren. Mit `tunnel-client help quickstart` die aktuelle CLI prüfen.
4. Einen HTTP-Client für `http://127.0.0.1:8787/mcp` konfigurieren; bei `tunnel-client init` die Option `--mcp-server-url` verwenden. Profil und Tunnel-ID explizit angeben. Den erforderlichen Runtime-Key über eine sichere lokale Eingabe/Umgebung bereitstellen, niemals in Chat oder Repository einfügen.
5. `tunnel-client doctor --profile arnold-local --explain`, danach `tunnel-client run --profile arnold-local` ausführen. Lokale Readiness und Polling prüfen.

Tunnel-Erstellung verlangt Tunnels Read + Manage; Nutzung Read + Use. Zusätzlich gelten ChatGPT-Workspace-Rechte. Die konkrete Verfügbarkeit und etwaige Kosten im Konto wurden nicht geprüft.

## Option B: HTTPS-Entwicklungstunnel (ausschließlich synthetische Demo)

Der [OpenAI-Quickstart](https://developers.openai.com/plugins/build/app-quickstart) beschreibt z. B. `ngrok http 8787`. Alternativ kann ein anderer vertrauenswürdiger HTTPS-Forwarder verwendet werden. Anbieterzugang und Tarif vor Nutzung selbst prüfen.

Für eine erhaltene Domain den Server mit expliziten Host-/Origin-Freigaben starten, beispielsweise:

```bash
ALLOWED_HOSTS=localhost,127.0.0.1,deine-demo.ngrok.app \
ALLOWED_ORIGINS=https://deine-demo.ngrok.app \
npm start
```

Den Forwarder auf `http://127.0.0.1:8787` richten. Als MCP-Adresse in ChatGPT **`https://deine-demo.ngrok.app/mcp`** eintragen. Die gezeigte Domain ist ein Platzhalter. Für MCP-Clients, die einen zusätzlichen Origin-Header senden, genau diesen Origin ergänzen. Kein `*` verwenden. Der Server prüft Hostnamen und Origins; die öffentliche Domain muss deshalb ausdrücklich zugelassen sein.

Diese Demo besitzt keine Authentifizierung. Während eines öffentlichen Tests können Personen mit Kenntnis der URL dieselben synthetischen Daten verändern oder zurücksetzen. Für längerfristige Nutzung einen privaten Tunnel bzw. Authentifizierung vorsehen.

## In ChatGPT verbinden und abnehmen

Nach der [offiziellen Testanleitung](https://developers.openai.com/plugins/deploy/connect-chatgpt):

1. [ChatGPT Plugins](https://chatgpt.com/plugins) öffnen, Plus → **Add custom MCP server**.
2. „Arnold“ benennen. Unter **Connection** den Tunnel oder die HTTPS-URL einschließlich `/mcp` wählen.
3. Für diese reine synthetische Demo **No authentication** wählen, falls angeboten. Die Hinweise prüfen und den privaten Testeintrag erstellen. Nichts öffentlich einreichen.
4. Prüfen, ob alle sechs Tools erkannt wurden. Den Eintrag installieren, einen neuen Chat öffnen und ihn über `@` auswählen.
5. „Öffne Arnold.“ schreiben. Erwarteter Aufruf: `show_arnold_dashboard`.
6. Prüfen: iframe sichtbar, 12 Workouts/108 Sätze, vier navigierbare Ansichten, Übungs- und Datumsfilter, Theme, Logger.
7. Einen **synthetischen** 60-kg-/10-Wiederholungs-Satz für Bankdrücken am 24.10.2026 erfassen. Erwartung: 13 Workouts, 109 Sätze und 40.621 kg. UI und späterer Aufruf von `get_dashboard_data` müssen übereinstimmen.
8. Demo zurücksetzen; 12/108/40.021 bestätigen. Auch ein ungültiges Gewicht bzw. unbekannte Übung soll einen brauchbaren Fehler ergeben.

UI-Namen und Funktionen können je nach Konto/Workspace abweichen. Fehlt das Hinzufügen eigener MCP-Server, sind die entsprechenden Workspace-Rechte bzw. Kontofunktionen erforderlich. Nach Tool-/Metadatenänderungen die Verbindung **Refresh** ausführen, nach UI-Änderungen Ressource neu laden und einen neuen Chat testen.

## Prüfliste für eine erneute Abnahme

- Konto-/Workspace-Zugang und benutzbaren Tunnel oder HTTPS-Endpunkt einrichten.
- Initialisierung und Tool-Erkennung **in ChatGPT** beobachten.
- Natürliche Werkzeugauswahl durch das Modell prüfen, einschließlich indirekter Prompts.
- iframe-Rendering, CSP, Theme und Schreibtool-Freigaben unter ChatGPT-Policies prüfen.
- Ergebnis mit Datum, ausgewähltem Tool, Argumenten und sichtbarem UI-Verhalten dokumentieren.

Der eigene `/host` beweist den gemeinsamen MCP-Apps-Lifecycle. Er ersetzt diese produktspezifische Abnahme nicht.
