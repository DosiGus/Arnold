# Betrieb

Konfiguration, Verbindung mit ChatGPT, Connected-Profil, Hosting und Backup. Alle Variablen mit Kommentar stehen in `.env.example`; `.env*`-Dateien sind ignoriert und enthalten nie etwas im Repository.

## Betriebsarten

| `STORAGE_MODE`     | Start                          | Port (Konvention) | Werkzeuge                      |
| ------------------ | ------------------------------ | ----------------- | ------------------------------ |
| `demo` (Standard)  | `npm start`                    | 8787              | Demo-Dashboard, `log_demo_set` |
| `arnold_fixture`   | `ARNOLD_WRITE_MODE=fixture`    | 8787              | Alle, auf synthetischen Daten  |
| `arnold_sheets`    | `MCP_ACCESS=private`, Datei-ID | 8789              | Nur lesend, eigene Datei       |
| `google_sheets`    | `MCP_ACCESS=private`           | 8788              | Nur lesend, älteres Format     |
| `arnold_connected` | OIDC + Google OAuth            | 8787              | Alle, pro Nutzer eine Datei    |

Ohne `ARNOLD_WRITE_MODE=fixture` registriert `arnold_fixture` nur die 12 lesenden Werkzeuge. `ARNOLD_WRITE_MODE=production` wird immer abgelehnt.

**Schutzregeln beim Start** (der Server weigert sich, nicht nur zu warnen):

- Eine echte Datei (`arnold_sheets`, `google_sheets`) erfordert `MCP_ACCESS=private`, Loopback-Bindung und nur lokale `ALLOWED_HOSTS`/`ALLOWED_ORIGINS`. Sie wird nie über einen öffentlichen Tunnel ohne Anmeldung bedient.
- `HOST`/`ALLOWED_HOSTS`/`ALLOWED_ORIGINS` werden bei jeder Anfrage geprüft (DNS-Rebinding-Schutz). Eine Tunnel-Domain muss ausdrücklich in `ALLOWED_HOSTS` stehen, Origins ohne `*`.
- `AUTH_MODE=open` nur mit `ARNOLD_ENV=development` und synthetischen Daten; in `staging`/`production` ist `oidc` Pflicht.

## Arnold in ChatGPT testen (synthetisch, ohne Konto)

Daten sind erfunden und liegen im Arbeitsspeicher, ein Neustart verwirft alles. Es gibt keine Anmeldung: Die Tunnel-Adresse nicht weitergeben.

```bash
npm run build
cloudflared tunnel --url http://localhost:8787      # gibt https://<zufall>.trycloudflare.com aus
```

In einem zweiten Terminal, Hostnamen **ohne** `https://` einsetzen:

```bash
STORAGE_MODE=arnold_fixture ARNOLD_WRITE_MODE=fixture PORT=8787 \
  ALLOWED_HOSTS=<zufall>.trycloudflare.com,127.0.0.1,localhost npm start
curl https://<zufall>.trycloudflare.com/health      # erwartet "synthetic":true
```

In ChatGPT einen eigenen MCP-Connector mit `https://<zufall>.trycloudflare.com/mcp` anlegen, Authentifizierung „keine“. Danach in einem neuen Chat testen:

| Sagen                                         | Erwartung               |
| --------------------------------------------- | ----------------------- |
| „Öffne Arnold“                                | Dashboard               |
| „Richte Arnold für mich ein“                  | Geführte Einrichtung    |
| „Erstelle mir jetzt den Trainingsplan“        | Planvorschlag im Editor |
| „Tausche Kniebeugen gegen Beinpresse“         | Änderung im Entwurf     |
| „Ich habe heute Bankdrücken gemacht, 3 Sätze“ | Satz-Logging            |

Nach der Planbestätigung sagt Arnold, die Google-Verbindung sei in diesem Modus nicht verfügbar. Das ist korrekt.

| Symptom                            | Ursache                                                       |
| ---------------------------------- | ------------------------------------------------------------- |
| Server antwortet nicht über Tunnel | Tunnel-Hostname fehlt in `ALLOWED_HOSTS`                      |
| Server startet nicht               | Echte Datenquelle konfiguriert; `STORAGE_MODE=arnold_fixture` |
| ChatGPT findet keine Werkzeuge     | Adresse endet nicht auf `/mcp`                                |
| 12 statt 36 Werkzeuge              | `ARNOLD_WRITE_MODE=fixture` fehlt                             |
| Alte Tools/UI nach Änderung        | Connector „Refresh“, neuen Chat öffnen                        |

Alternativ zum Quick-Tunnel: [OpenAI Secure MCP Tunnel](https://developers.openai.com/api/docs/guides/secure-mcp-tunnels) mit dem offiziellen `tunnel-client` (`tunnel-client doctor`, dann `run`). Das ist der Weg für private Daten; Runtime-Key nie in Repository oder Chat.

## Eigene Tabelle nur lesen (`arnold_sheets`)

Für lokale Auswertung einer bestehenden Arnold-Tabelle mit einem Google-Dienstkonto:

1. Dienstkonto ohne Cloud-Rollen anlegen, Sheets API aktivieren, Tabelle für das Konto als Betrachter freigeben (Google gewährt pro Datei, nicht pro Tab).
2. Schlüssel nur als `data/google-sheets-reader.json` (Modus 600, ignoriert) ablegen.
3. `.env.sheets` aus der Vorlage in `.env.example` füllen (`ARNOLD_SPREADSHEET_ID`, optional `ARNOLD_EXPECTED_TRACKER_ID`, `ARNOLD_CACHE_TTL_MS`).
4. `node --env-file=.env.sheets dist/server/main.js` und `/host` auf dem konfigurierten Port öffnen. `scripts/check-sheets.ts` gibt nur Herkunft, Kennzahlen und Ladezeit aus.

Der Adapter liest nur den konfigurierten Tracker, stoppt bei geänderter Datei-, Tab- oder Spaltenidentität und schreibt nie.

## Connected-Profil (`arnold_connected`)

Ende-zu-Ende-Ablauf pro Nutzer: OIDC-Anmeldung → Einrichtung und Planbestätigung → Google-Freigabe → Arnold legt eine **eigene leere Tabelle** an und übernimmt genau den bestätigten Plan → Workouts schreiben in diese Tabelle. Die Masterdatei wird weder gelesen noch kopiert.

**Status:** Der Ablauf ist lokal über echten HTTP/MCP-Transport und Chromium getestet, aber mit **simulierten** OIDC- und Google-Endpunkten. Eine Abnahme mit echten Konten oder im ChatGPT-Host steht aus. Das Profil ist Einzelserver-Entwicklung (nicht `staging`/`production`).

Konfiguration in `.env.connected` (ignoriert):

```dotenv
STORAGE_MODE=arnold_connected
ARNOLD_ENV=development
AUTH_MODE=oidc
ARNOLD_WRITE_MODE=disabled          # die Nutzer-Laufzeit schaltet geprüftes Schreiben selbst frei
ARNOLD_PUBLIC_BASE_URL=http://127.0.0.1:8787
AUTH_ISSUER=https://<oidc-anbieter>/
AUTH_JWKS_URI=https://<oidc-anbieter>/<jwks-pfad>
IDENTITY_STORE=file
IDENTITY_STORE_FILE=data/connected/identities.json
ARNOLD_STATE_DIRECTORY=data/connected
GOOGLE_CLIENT_ID=<id>.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=<secret>
GOOGLE_REDIRECT_URI=http://127.0.0.1:8787/auth/google/callback   # exakt <BASE_URL>/auth/google/callback
TOKEN_ENCRYPTION_KEY=k1:<base64, 32 Byte>
```

Schlüssel erzeugen: `node -e "console.log('k1:' + require('crypto').randomBytes(32).toString('base64'))"`. Rotation: neuen Schlüssel als `TOKEN_ENCRYPTION_KEY`, alten nach `TOKEN_ENCRYPTION_KEYS_OLD`, Zeilen neu verpacken, dann alten entfernen.

```bash
npm run build
node --env-file=.env.connected dist/server/main.js
```

Voraussetzungen außerhalb des Codes:

- **OIDC-Anbieter**, der Tokens mit Audience = `<BASE_URL>/mcp` und den Scopes `arnold.read`, `arnold.write`, `arnold.plan`, `arnold.account` ausstellt. Ein Anbieter ist noch nicht gewählt.
- **Google Cloud:** OAuth-Client, Consent-Screen, Testnutzer, Drive API und Sheets API, exakte Redirect-URI. Arnold fordert nur `openid`, `email`, `drive.file`.
- **MCP-Host mit Anmeldung.** `/preview` und `/host` haben keinen OIDC-Login; die Browser-Tests setzen synthetische Test-Bearer.
- Für einen entfernten Host: HTTPS-Adresse, passende `HOST`/`ALLOWED_HOSTS`; Basisadresse, Audience und Redirect-URI müssen übereinstimmen.

Schnittstellen: Tools `connect_google_account`, `finish_arnold_setup`, `get_google_connection`, `disconnect_google_account`; HTTP `POST /auth/google/start`, `GET /auth/google/launch`, `GET /auth/google/callback`, `GET /auth/google/status`, `POST /auth/google/disconnect`.

**Wiederaufnahme und Fehlerfälle:**

- Tracker-Zustand: `draft → allocating → initializing → ready`. Unklare Dateierstellung wird über eine von Arnold gesetzte Drive-`appProperties`-Tracker-ID gesucht; genau ein Treffer wird weiterverwendet, kein oder mehrdeutiger Treffer sperrt sichtbar. Es gibt keine blinde zweite Erstellung, keinen Auto-Reset, kein Überschreiben.
- Ein fertiger Tracker bleibt an das ursprüngliche Google-Subject gebunden; Reconnect mit demselben Konto geht, ein anderes Konto wird vor Speicherung abgelehnt.
- Google-401 → ein Refresh-Versuch; `invalid_grant` → `REAUTH_REQUIRED`. Trennen widerruft bei Google und löscht lokale Credentials, die Tabelle bleibt erhalten.

**Daten und Backup:** `data/connected` enthält Konto- und Tracker-Zuordnung, verschlüsselte Refresh-Tokens, Einrichtungsentwürfe, Audit und Operations-Snapshots (können Trainingsinhalte enthalten). Zustandsordner und `TOKEN_ENCRYPTION_KEY` gehören zusammen in ein verschlüsseltes Backup, der Schlüssel getrennt gelagert. Genau ein Prozess pro Zustandsordner. Aufbewahrung und Löschung der Journale sind offen.

## Hosting

Es gibt kein Deployment. Ein `Dockerfile` (Node 24, Port 8787, `HOST=0.0.0.0`) liegt bereit und wurde noch nicht gebaut oder veröffentlicht. Für `HOST=0.0.0.0` muss der Servicehostname in `ALLOWED_HOSTS` stehen.

| Weg                       | Eignung                                                                                                                              |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Lokal + Secure MCP Tunnel | Aktueller Testweg; Rechner und Tunnel-Client müssen laufen                                                                           |
| Cloud Run (Container)     | Nächster Schritt für Tests: passt zu Express und stateless MCP. Lokale Dateien sind flüchtig, ein Volume oder anderer Speicher nötig |
| Kleine VM mit Volume      | Geringste Änderung; TLS, Backup und Prozessüberwachung selbst betreiben                                                              |
| Cloudflare Workers        | Erfordert anderen Transport und Speicher; nicht ohne Umbau                                                                           |

Echte Nutzerdaten erst mit produktiver Anmeldung (`AUTH_MODE=oidc`, Postgres-Speicher statt Datei) und einem für mehrere Instanzen geeigneten Zustandsspeicher. Der Datei-Speicher darf nicht von mehreren Instanzen geteilt werden. Vor jeder Veröffentlichung Tarife, Streaming-Unterstützung und Requestlimits des Anbieters neu prüfen.

## Git-Backup

```bash
git status && git add <dateien> && git commit -m "…" && git push
```

Nur Commit und Push sichern Änderungen; das Repository spiegelt den Ordner nicht automatisch. Nicht versioniert: `.env*` (außer `.env.example`), `data/`, `secrets/`, `credentials/`, Schlüssel, `node_modules/`, `dist/`, `test-results/`. Wiederherstellen: `git clone … && npm ci && npm run build && npm start`.
