# Arnold in ChatGPT testen

Diese Anleitung bringt Arnold in ChatGPT, **ohne** Google-Konto, ohne
Hosting-Konto und ohne Anmeldedienst. Arnold läuft dabei auf deinem Rechner,
ein Tunnel gibt ihm eine öffentliche Adresse, und ChatGPT verbindet sich
dorthin.

## Was dieser Modus ist — und was nicht

|             |                                                                    |
| ----------- | ------------------------------------------------------------------ |
| Daten       | **Ausschließlich synthetisch.** Ein Tracker im Arbeitsspeicher.    |
| Google      | Nicht verbunden. Keine Datei wird gelesen oder angelegt.           |
| Anmeldung   | **Keine.** Wer die Tunnel-Adresse kennt, kann den Server benutzen. |
| Haltbarkeit | Ein Serverneustart verwirft alle Änderungen.                       |

Das ist für einen Funktionstest richtig und bewusst so: es gibt nichts zu
schützen, weil nichts Echtes drinsteckt. **Für echte Trainingsdaten ist dieser
Modus ausgeschlossen** — der Server weigert sich zu starten, wenn eine echte
Google-Datei über eine öffentliche Adresse erreichbar wäre und keine
Authentifizierung aktiv ist.

Die Tunnel-Adresse ist trotzdem nicht öffentlich zu teilen: jeder, der sie hat,
kann den synthetischen Tracker verändern.

## Schritt 1 — Arnold bauen

```bash
npm run build
```

## Schritt 2 — Tunnel starten

Zuerst der Tunnel, denn seine Adresse brauchst du für Schritt 3.

```bash
cloudflared tunnel --url http://localhost:8787
```

Falls `cloudflared` fehlt: `brew install cloudflared`.

Der Befehl gibt eine Adresse der Form `https://zufall-wort.trycloudflare.com`
aus. Diese Adresse kopieren.

## Schritt 3 — Arnold starten

Den Hostnamen aus Schritt 2 **ohne** `https://` einsetzen:

```bash
STORAGE_MODE=arnold_fixture ARNOLD_WRITE_MODE=fixture PORT=8787 ALLOWED_HOSTS=zufall-wort.trycloudflare.com,127.0.0.1,localhost npm start
```

`ALLOWED_HOSTS` ist nicht optional: Arnold prüft den Host-Header jeder Anfrage,
um DNS-Rebinding abzuwehren. Fehlt der Tunnel-Hostname, antwortet der Server
nicht.

Prüfen, ob es läuft:

```bash
curl https://zufall-wort.trycloudflare.com/health
```

Erwartet wird `"status":"ok"` und `"synthetic":true`. Steht dort
`"synthetic":false`, läuft eine andere Datenquelle als gedacht — dann abbrechen
und die Umgebungsvariablen prüfen.

## Schritt 4 — In ChatGPT verbinden

In ChatGPT einen eigenen Connector mit dieser MCP-Adresse anlegen:

```
https://zufall-wort.trycloudflare.com/mcp
```

Authentifizierung: keine.

## Was sich testen lässt

36 Werkzeuge und zwei Oberflächen stehen bereit:

| Sagen                                          | Erwartung                                       |
| ---------------------------------------------- | ----------------------------------------------- |
| „Öffne Arnold"                                 | Dashboard mit Kennzahlen, Historie, Fortschritt |
| „Richte Arnold für mich ein"                   | Geführte Einrichtung, sechs Fragen              |
| „Ich will Muskeln aufbauen, dreimal pro Woche" | Angaben werden übernommen                       |
| „Erstelle mir jetzt den Trainingsplan"         | Planvorschlag, bearbeitbar                      |
| „Tausche Kniebeugen gegen Beinpresse"          | Änderung im Planentwurf                         |
| „Zeig mir meinen Trainingsplan"                | Planeditor                                      |
| „Ich habe heute Bankdrücken gemacht, 3 Sätze"  | Training eintragen                              |

Der Punkt, an dem dieser Modus endet: Nach der Planbestätigung sagt Arnold, dass
die Google-Verbindung noch nicht verfügbar ist. Das ist korrekt und keine
Fehlfunktion — der Schritt existiert noch nicht.

## Wenn etwas nicht geht

| Symptom                                                | Ursache                                                               |
| ------------------------------------------------------ | --------------------------------------------------------------------- |
| Server startet nicht, Meldung über öffentliche Adresse | Echte Datenquelle konfiguriert. `STORAGE_MODE=arnold_fixture` setzen. |
| Tunnel-Adresse antwortet nicht                         | Tunnel-Hostname fehlt in `ALLOWED_HOSTS`.                             |
| ChatGPT findet keine Werkzeuge                         | Adresse endet nicht auf `/mcp`.                                       |
| Nur 12 statt 36 Werkzeuge                              | `ARNOLD_WRITE_MODE=fixture` fehlt.                                    |

Tool-Liste direkt prüfen:

```bash
curl -s -X POST https://zufall-wort.trycloudflare.com/mcp -H "Content-Type: application/json" -H "Accept: application/json, text/event-stream" -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

## Danach: dauerhaftes Hosting

Der Tunnel ist für den Test. Für eine dauerhafte Adresse liegt ein
`Dockerfile` bereit; `docs/DEPLOYMENT.md` vergleicht die Wege. Dabei gilt
dasselbe: synthetisch ohne Anmeldung ist in Ordnung, echte Daten brauchen
`AUTH_MODE=oidc`.
