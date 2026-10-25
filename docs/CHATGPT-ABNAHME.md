# ChatGPT-Abnahme: Arnold

Seit dem 25.10.2026 heißt das Projekt **Arnold**. Dieser Bericht dokumentiert den früheren Test unter dem damaligen Namen; Plugin-Bezeichnungen, Ressourcen-IDs und Screenshots sind historische Nachweise. Der aktuelle lokale Stand verwendet `show_arnold_dashboard` und `ui://arnold/dashboard-v5.html`.

**Datum:** 24.10.2026 · **Projektversion:** 0.2.1 · **Status:** persönliches ChatGPT-Testplugin verbunden, echte MCP-App angezeigt und Backend-Interaktionen geprüft.

## Historische Testinstallation

- [Testchat in ChatGPT](https://chatgpt.com/c/6adcd1db-0618-83eb-b99e-b7cce502cce2)
- [Persönliches Plugin „Fitness Tracker AI“](https://chatgpt.com/plugins/plugin_asdk_app_6adccf5562508191a75073999b0538cb)
- MCP-Endpunkt: `https://yards-suzuki-wolf-brick.trycloudflare.com/mcp`
- Lokaler Server: `http://127.0.0.1:8787/mcp`
- Tunnel-Client: offizielles `cloudflared` 2026.10.3, über Homebrew installiert.
- Protokoll: stateless Streamable HTTP mit JSON-Antworten; keine SSE-Verbindung erforderlich.
- UI: `ui://fitness/dashboard-v3.html`, MIME `text/html;profile=mcp-app`.

Es wurden weder API-Keys erzeugt noch ein Cloudflare-Konto, ein kostenpflichtiges Deployment oder eine öffentliche Plugin-Veröffentlichung eingerichtet. Der ChatGPT-Eintrag ist persönlich; der temporäre Tunnel-Endpunkt ist öffentlich erreichbar und enthält ausschließlich die lokale synthetische Demo.

## Beobachtete Ergebnisse

| Schritt                         | Nachweis                                                                                                                                                          |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| HTTPS erreichbar                | `/health` liefert `status: ok`, Version 0.2.1                                                                                                                     |
| MCP initialisiert               | Offizieller MCP-Client verbindet sich über die öffentliche HTTPS-Adresse                                                                                          |
| Tool-Erkennung                  | Alle sechs erwarteten Tools im HTTPS-Discovery vorhanden                                                                                                          |
| UI-Ressource                    | HTML-Bundle über `resources/read`, korrekter MCP-Apps-MIME-Typ                                                                                                    |
| ChatGPT-Verbindung              | Persönlicher Eintrag erstellt, nach ausdrücklicher Nutzerbestätigung verbunden und installiert                                                                    |
| Natürlicher Prompt              | `@Fitness Tracker AI Öffne meinen Fitness Tracker.` löst das Tool „Fitness Tracker öffnen“ aus                                                                    |
| Eingebettete UI                 | Dashboard im ChatGPT-iframe sichtbar; zusätzlich im größeren App-Panel geöffnet                                                                                   |
| Historie                        | Filter „Push“ liefert vier Einheiten mit Bankdrücken-Details                                                                                                      |
| Fortschritt                     | Kniebeugen gewählt; maximal 47,5 kg und geschätztes 1RM 64,9 kg sowie vier Verlaufspunkte geladen                                                                 |
| Schreiben aus der UI            | Bankdrücken am 24.10.2026, 60 kg, 10 Wiederholungen, RPE 8 gespeichert                                                                                            |
| Unabhängiger Persistenznachweis | Separater MCP-Client liest danach 13 Workouts, 109 Sätze, 40.621 kg und den gespeicherten Satz aus dem Backend                                                    |
| CSP                             | Vorhandene ChatGPT-Einstellung „CSP für benutzerdefinierte Apps durchsetzen“ von aus auf **ein** gestellt; die App rendert anschließend weiterhin                 |
| Reset mit CSP                   | Demo-Reset aus dem ChatGPT-iframe stellt 12 Workouts, 108 Sätze und 40.021 kg wieder her                                                                          |
| Wiederöffnen des Chats          | Nach Reset und Neuladen zeigt die aktualisierte UI den aktuellen Backendstand 12/108/40.021, obwohl das historische Öffnungs-Ergebnis noch 13/109/40.621 enthielt |

Der erste Speicher-Test erfolgte vor Aktivierung der zuvor deaktivierten ChatGPT-CSP-Einstellung. Rendering, Reset und erneutes Laden wurden danach mit aktivierter Durchsetzung geprüft. Andere Kontosicherheits- und MFA-Einstellungen wurden nicht verändert.

## Im echten Host gefundener Fehler und Korrektur

ChatGPT speichert Tool-Ergebnisse in der Unterhaltung und kann diese beim Wiederöffnen an die UI übergeben. Version 0.2.0 nahm diesen historischen Snapshot unverändert an. Dadurch konnte ein neu geladenes Widget frühere Kennzahlen anzeigen, obwohl neuere Demo-Sätze korrekt im Backend lagen.

Version 0.2.1 liest nach der ersten Host-Ergebnisbenachrichtigung zunächst `get_dashboard_data` über die offizielle App-Bridge nach und zeigt dann den aktuellen Backendstand. Scheitert die Aktualisierung, kann der historische Snapshot mit einem sichtbaren Fehlerhinweis angezeigt werden. Die UI-Ressource wurde versioniert und die Tools in ChatGPT aktualisiert.

Ein gezielter Browser-Regressionstest reproduziert die Wiedergabe eines alten 108-Satz-Snapshots bei inzwischen 109 gespeicherten Sätzen: vor der Korrektur fehlgeschlagen, danach bestanden. Insgesamt bestehen **23 Unit-/MCP-Tests und 8 Browser-Tests**. Siehe [TESTING.md](TESTING.md).

Die früheren Textantworten des Modells bleiben als Gesprächshistorie erhalten. Eine UI-Aktualisierung überschreibt diese historischen Nachrichten nicht.

## Laufzeit und erneuter Start

Server und Tunnel laufen aktuell auf diesem Mac. Der Tunnel ist eine temporäre Entwicklungsverbindung: Er endet beim Stoppen des `cloudflared`-Prozesses, und bei einem neuen Quick Tunnel entsteht eine neue Adresse. Ruhezustand oder eine unterbrochene Internetverbindung können die Erreichbarkeit unterbrechen.

Für den aktuellen Tunnel liegt die lokale, von Git ausgeschlossene `.env.chatgpt` bereit. Solange derselbe Tunnel weiterläuft, kann der Backend-Prozess damit erneut gestartet werden:

```bash
node --env-file=.env.chatgpt dist/server/main.js
```

Ein neuer Tunnel wird über folgenden Befehl erzeugt:

```bash
cloudflared tunnel --no-autoupdate --url http://127.0.0.1:8787
```

Danach muss die **neue** ausgegebene Domain in der lokalen Host-/Origin-Freigabe und in der ChatGPT-Verbindung eingetragen werden. Die alte URL darf nicht als dauerhaft angesehen werden. Für eine dauerhaft nutzbare Adresse später einen benannten Tunnel bzw. ein geeignetes Hosting einrichten.

Quick Tunnels benötigen laut [Cloudflare-Dokumentation](https://developers.cloudflare.com/tunnel/get-started/quick-tunnels/) keinen Account und unterstützen kein SSE. Das getestete JSON-Antwortverfahren funktioniert über diesen Tunnel. Für spätere SSE-/Streaming-Anforderungen die Tunnelvariante erneut prüfen.

## Grenzen

- Ein erfolgreicher Desktop-Web-Test ist keine vollständige Prüfung aller ChatGPT-Clients, Geräte oder Formulierungen.
- Keine echten Trainingsdaten, Google-Sheets-Synchronisierung, Google OAuth, Kundenkonten oder Zahlungen eingebunden.
- Kein Zugriffsschutz am öffentlichen Demo-Endpunkt; die bekannten Demo-Tools können dort synthetische Daten verändern oder zurücksetzen. Kein produktiver Betrieb.
- Die ChatGPT-CSP-Durchsetzung ist nun für alle benutzerdefinierten Apps in diesem ChatGPT-Konto aktiviert. Das wurde zur Prüfung mit restriktiven Host-Vorgaben geändert.

## Screenshots

- [Verbindungsdialog vor der Nutzerfreigabe](screenshots/chatgpt-connect-confirmation.png)
- [Fertiges Dashboard in ChatGPT](screenshots/chatgpt-dashboard.png)
