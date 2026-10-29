# Arnold: verbundener End-to-End-Ablauf

Stand: **29. Oktober 2026**. Der vollständige Ablauf ist lokal über echten HTTP-/MCP-Transport und Chromium geprüft. Google-Endpunkte, OIDC-Anbieter und sämtliche Konten/Trainingsdaten in diesen Tests sind simuliert. **Eine Abnahme mit echten Google-Zugangsdaten oder im ChatGPT-Host ist damit nicht erfolgt.**

## Ergebnis der Projektprüfung

Der bisherige Server verband Workout-, Plan- und Onboarding-Dienste nur im synthetischen Fixture-Profil. Der Google-Verbindungsdienst hatte keine HTTP-Routen, und der normale Startpfad konnte keine OIDC-Metadaten laden. Eine persönliche Dateierstellung fehlte.

Die Analytics-Integration war dagegen bereits vorhanden: `arnold-presenter.ts` verwendet `buildArnoldDashboardAnalytics`, und `mcp-arnold.ts` liefert diese Werte an die v2-Oberfläche. Die gegenteilige Aussage im alten README war veraltet.

## Implementierter Ablauf

1. Der MCP-Host meldet den Nutzer beim konfigurierten OIDC-Anbieter an. Arnold prüft Signatur, Issuer, Audience, Ablaufzeit und Berechtigungen und ordnet die Identität einem dauerhaften internen Nutzer zu.
2. Das Onboarding sammelt das Profil und hält Planentwürfe lokal pro Nutzer. Es verwendet weiterhin den vorhandenen Planeditor. Zusätzlich zum Konto bleibt der Sitzungsnachweis erforderlich. Synthetische, anonyme Demo-Sitzungen werden nicht automatisch in persönliche Konten übernommen.
3. Der Nutzer bestätigt genau eine Planversion und Revision. Google kann erst danach verbunden werden.
4. `connect_google_account` liefert einen einmaligen Browserlink. Beim Öffnen setzt Arnold einen kurzlebigen HttpOnly-/SameSite-Cookie und leitet zu Google weiter. Der Rücksprung benötigt Cookie, `state`, PKCE, Nonce, gültiges Google-ID-Token und den unveränderten bestätigten Plan. Das Arnold-Bearer-Token steht niemals im Browserlink.
5. Nach der Google-Freigabe erstellt Arnold eine leere persönliche Google-Tabelle mit eigener Tracker-ID. Die Masterdatei wird weder gelesen, kopiert noch beschrieben. Ein kleiner Übungskatalog enthält keine erfundenen Workouts oder Startgewichte.
6. Die sechs Tabellen CONFIG, EXERCISES, PLANS, PLAN_ITEMS, WORKOUTS und SETS werden als atomarer Sheets-Batch angelegt. Genau der bestätigte Entwurf wird als aktive erste Planversion übernommen. Freitext wird als `stringValue` geschrieben, auch wenn er mit `=` beginnt.
7. Erst nach vollständigem Schema-/Identitäts-/Inhalts-Readback werden der Tracker als bereit und das Onboarding als `COMPLETED` gespeichert. Danach laufen Planänderungen und Workout-Writes über die eigene Google-Datei, den bestehenden Revisionsschutz, das Operationsjournal und den Auditpfad.
8. Nach einem Serverneustart bleiben Kontozuordnung, verschlüsseltes Refresh-Token, Tracker-Zuordnung, Einrichtung und Idempotenzjournal erhalten. Der nächste Google-Zugriff erneuert das Access-Token. Ein Satz-Retry verwendet dieselbe Operations-ID und erzeugt keine zweite Zeile.

Ein globaler Nutzerkontext wurde durch `AsyncLocalStorage` ersetzt. Ein Regressionstest verschachtelt zwei asynchrone Tool-Aufrufe und prüft die Identität vor und nach dem Warten. Im verbundenen HTTP-Profil werden POST-Anfragen und OAuth-Abschlüsse außerdem pro Nutzer serialisiert; offene GET-/SSE-Verbindungen halten diese Sperre nicht.

## Startprofil

Das neue Profil ist ausdrücklich **Einzelserver-Entwicklung**, kein Produktionsprofil. Es lässt sich nicht als `staging` oder `production` starten. OIDC und ein dauerhafter Datei-Identitätsspeicher sind Pflicht. Die bisherigen Demo-, Fixture- und lesenden Sheets-Profile bleiben separat.

Die Platzhalter in eine ignorierte `.env.connected` übertragen und durch eigene Konfiguration ersetzen:

```dotenv
PORT=8787
HOST=127.0.0.1
ALLOWED_HOSTS=localhost,127.0.0.1,[::1]
STORAGE_MODE=arnold_connected
ARNOLD_ENV=development
ARNOLD_WRITE_MODE=disabled
AUTH_MODE=oidc
ARNOLD_PUBLIC_BASE_URL=http://127.0.0.1:8787
AUTH_ISSUER=https://DEIN-OIDC-ANBIETER/
AUTH_JWKS_URI=https://DEIN-OIDC-ANBIETER/DEIN-JWKS-PFAD
IDENTITY_STORE=file
IDENTITY_STORE_FILE=data/connected/identities.json
ARNOLD_STATE_DIRECTORY=data/connected
GOOGLE_CLIENT_ID=DEINE-CLIENT-ID.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=DEIN-GOOGLE-CLIENT-SECRET
GOOGLE_REDIRECT_URI=http://127.0.0.1:8787/auth/google/callback
TOKEN_ENCRYPTION_KEY=k1:DEIN-BASE64-SCHLUESSEL-MIT-32-BYTES
```

```bash
npm run build
node --env-file=.env.connected dist/server/main.js
```

Für einen entfernten MCP-Host ist eine erreichbare HTTPS-Adresse mit passenden `HOST`-/`ALLOWED_HOSTS`-Werten nötig; öffentliche Basisadresse, MCP-Resource/Audience und bei Google registrierte Rücksprungadresse müssen zusammenpassen. Der OIDC-Anbieter muss die Arnold-Scopes vergeben können: Lesen (`arnold.read`), Workout-Schreiben (zusätzlich `arnold.write`), Pläne/verbundenes Onboarding (zusätzlich `arnold.plan`), Google-Kontoverwaltung (`arnold.account`). Eine reale Clientregistrierung beim Anmeldeanbieter ist noch separat zu konfigurieren und im Zielhost zu prüfen.

`/preview` und `/host` besitzen keinen eigenen interaktiven OIDC-Login. Für dieses Profil ist ein authentifizierter MCP-Host erforderlich. Der Browser-Test fügt ausschließlich synthetische Test-Bearer hinzu; er ist kein Login-Feature.

In Google Cloud sind OAuth-Client, Consent-Screen, Testnutzer, Drive API, Sheets API und die exakte Redirect-URI erforderlich. Arnold verlangt nur `openid`, optionales `email` und `drive.file`, keinen allgemeinen Drive-/Sheets-Zugriff. Geheimnisse nicht ins Repository oder in Chatnachrichten einfügen.

## Schnittstellen

| Schnittstelle                  | Verhalten                                                                                      |
| ------------------------------ | ---------------------------------------------------------------------------------------------- |
| `connect_google_account`       | Mit Einrichtungsclaim: Browserfreigabe beginnen oder dasselbe Google-Konto erneut verbinden    |
| `finish_arnold_setup`          | Nach Freigabe: unterbrochene Dateieinrichtung prüfen und abschließen                           |
| `get_google_connection`        | Eigener Verbindungsstatus, E-Mail und Refresh-Verfügbarkeit; keine Tokens                      |
| `disconnect_google_account`    | Mit `confirm: true`: Google widerrufen und lokale Credentials entfernen; Datei bleibt erhalten |
| `POST /auth/google/start`      | Dasselbe Startverhalten mit geprüftem Bearer und JSON-Einrichtungsclaim                        |
| `GET /auth/google/launch`      | Einmaligen Startlink konsumieren und Browser an den Callback binden                            |
| `GET /auth/google/callback`    | Cookie-/State-/Planprüfung, Google-Codeaustausch, Dateieinrichtung                             |
| `GET /auth/google/status`      | Eigener Verbindungsstatus mit Bearer und `arnold.account`                                      |
| `POST /auth/google/disconnect` | Mit Bearer, `arnold.account` und `confirm: true` trennen                                       |

Die neuen Tools werden ausschließlich im verbundenen Profil registriert. Schreiboperationen benötigen ihre jeweilige Zugriffsklasse. Datei-IDs und interne Nutzer-IDs können nicht als Tool-Argument zum Auswählen fremder Daten eingesetzt werden.

## Wiederaufnahme und unklare Ergebnisse

Der lokale Trackerstatus folgt `draft → allocating → initializing → ready`. Eine unklare Dateierstellung wird anhand einer von Arnold gesetzten Drive-`appProperties`-Tracker-ID im Google-Konto des Nutzers gesucht. Findet sich genau eine Datei, wird sie weiterverwendet. Eine nicht gefundene oder mehrdeutige Datei führt zu einer sichtbaren Sperre und niemals zu einer blinden zweiten Erstellung. Ein definitiver HTTP-4xx-Fehler bei der Erstellung kann erneut versucht werden.

Nach verlorener Initialisierungsantwort wird ausschließlich der Inhalt gelesen und mit dem gespeicherten Einrichtungssnapshot verglichen. Stimmt er vollständig, geht der Ablauf weiter. Ist der Ausgang weiterhin unklar, bleibt er für eine manuelle Betreiberprüfung gesperrt. Es gibt keinen automatischen Reset oder ein Überschreiben eventuell vorhandener Trainingsdaten. Ist der Tracker bereits bereit und nur die abschließende Onboarding-Speicherung unterbrochen worden, beendet `finish_arnold_setup` den Vorgang.

Ein fertiger Tracker bleibt an sein ursprüngliches Google-Subject gebunden. Reconnect mit demselben Konto funktioniert auch nach Disconnect; ein anderes Google-Konto wird vor Speicherung seiner Tokens abgelehnt. Eine direkte Änderung der Datei oder eine falsche Tracker-ID wird nicht als erfolgreicher Write bestätigt. Ein Google-401 verwirft das nutzereigene Access-Token und versucht einmal einen Refresh; `invalid_grant` setzt `REAUTH_REQUIRED`.

## Persistenz und verbleibende Grenzen

- Genau **ein Serverprozess** darf einen Zustandsordner verwenden. Keine mehreren Worker, Replikate oder geteilten Dateisysteminstanzen. Eine verteilte Datenbank und verteilte Schreibkoordination fehlen weiterhin.
- `data/connected` enthält technische Kontodaten, verschlüsselte Refresh-Tokens, Einrichtungsprofile/-entwürfe, Auditinformationen und zur Wiederholbarkeit notwendige Operations-Snapshots. Nach Einrichtung ist Google die Quelle der Trainingsdaten; das Backend liest diese bei Zugriff. Die lokalen Journale können Trainingsinhalte enthalten und brauchen ein verschlüsseltes Backup einschließlich getrennt gesichertem Token-Schlüssel. Eine produktive Aufbewahrungs-/Löschstrategie ist noch offen.
- Laufende Browser-/OAuth-Versuche sind kurzlebig im Arbeitsspeicher. Ein Neustart vor Speicherung der Google-Freigabe erfordert einen neuen Verbindungsversuch; eine bereits gespeicherte Verbindung und Dateieinrichtung lassen sich fortsetzen.
- Geräteübergreifende automatische Wiederaufnahme ist nicht implementiert. Die Oberfläche hält den vorhandenen Einrichtungsclaim in der Sitzung.
- Kein Monitoring-/Rate-Limit-/Lasttest gegen echte Google-Quoten, kein produktiver Restore-Test, keine abschließende Sicherheitsprüfung und keine geschlossene Beta-Freigabe.

## Reproduzierbare Abnahme

Lokales Gesamtergebnis: Build/Typecheck erfolgreich, **1.173 Unit-/Integrationstests in 53 Dateien**, **53 Browser-Tests**, Formatprüfung und `git diff --check` erfolgreich. Die externen Anbieter bleiben in diesen Tests simuliert.

```bash
npm run check
npm run format:check
```

`tests/connected-journey.test.ts` startet echte HTTP-/MCP- und JWKS-Endpunkte. Es prüft den Gesamtfluss, verschlüsselte Credentials, wiederholte Writes, Serverneustart, parallele Nutzer, fremde Claims/Workout-IDs, fehlende Scopes, veraltete Bestätigungen, Callback-Cookie/Replay, deaktivierte Nutzer, verlorene Antworten, Reconnect und widerrufene Google-Freigaben. `tests/e2e/connected.spec.ts` öffnet die echte Oberfläche, bestätigt den Plan, durchläuft den simulierten Browserrücksprung, speichert einen Satz und lädt ihn nach Wiederöffnen. Die Google-Simulation liegt ausschließlich unter `tests/`; Teststeuerungsrouten werden vom normalen Server niemals eingebunden.

Für eine echte Abnahme verbleiben: Anmeldeanbieter/Google-Cloud-Projekt konfigurieren, Arnold im Zielhost verbinden, mit einem dafür vorgesehenen echten Konto den ganzen Ablauf ausführen und nach Serverneustart dieselbe Datei und denselben Satz nachweisen. Erst danach ist dieser Ablauf gegen Google/ChatGPT nachgewiesen. Vor mehreren Beta-Nutzern außerdem Datenbank, Betrieb, Wiederherstellung und Aufbewahrung/Löschung abschließen.

API-Grundlagen: [Drive-Dateierstellung](https://developers.google.com/workspace/drive/api/reference/rest/v3/files/create), [appProperties und Suche](https://developers.google.com/workspace/drive/api/guides/properties), [atomare Sheets-Batches](https://developers.google.com/workspace/sheets/api/guides/batch). Google-Workspace-Dateien unterstützen [keine vorab generierten Drive-IDs](https://developers.google.com/workspace/drive/api/guides/create-file); deshalb verwendet die Wiederaufnahme eine gespeicherte Tracker-Zuordnung und sucht unklare Erstellungen, statt sie blind zu wiederholen.
