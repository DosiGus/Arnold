# Arnold

Ausführbarer lokaler MCP-Apps-Prototyp mit React, TypeScript, Streamable HTTP, Recharts mit lokaler Demo oder einem lesenden Google-Sheets-Adapter.

**Lokal geprüft:** Build, Typecheck, Unit-Tests, MCP-Integration und Browser-Tests mit echtem `App`/`AppBridge`-Handshake. **Auch in ChatGPT verbunden und mit echtem Tool-Aufruf und eingebetteter UI getestet.** Siehe [Testbericht](docs/TESTING.md).

Das Projekt wird in einem privaten GitHub-Repository versioniert. Hinweise zum Sichern neuer Änderungen und Wiederherstellen stehen unter [GitHub-Backup](docs/BACKUP.md).

## Start in drei Schritten

Node.js **22.12+**, empfohlen Node 24 LTS oder neuer.

```bash
npm ci
npm run build
npm start
```

| Adresse                                                 | Funktion                                           |
| ------------------------------------------------------- | -------------------------------------------------- |
| [localhost:8787/preview](http://localhost:8787/preview) | Browser-Vorschau, Daten über den echten MCP-Client |
| [localhost:8787/host](http://localhost:8787/host)       | Lokaler MCP-Apps-Test-Host mit isoliertem iframe   |
| [localhost:8787/mcp](http://localhost:8787/mcp)         | Streamable-HTTP-Endpunkt für MCP-Clients           |
| [localhost:8787/health](http://localhost:8787/health)   | JSON-Healthcheck                                   |

`/mcp` ist kein normaler Browser-Link: mit einem MCP-Client verbinden. Ein direktes GET ohne MCP-Header kann 405/406 liefern.

Für Serverentwicklung: `npm run dev` baut die UI und startet den TypeScript-Server mit Watch-Modus. Nach UI-Änderungen `npm run build:ui` ausführen und die Vorschau bzw. den Host neu laden. Ein Host muss die UI-Ressource nach Änderungen erneut lesen.

Die lokale App benötigt **keinen OpenAI-API-Key** und führt keine Modell-API-Aufrufe aus. Der optionale Google-Sheets-Modus benötigt eigene Google-Zugangsdaten. Die Google-Drive-Verbindung des GPT wird nicht an unseren Server weitergegeben. Keine externen Schriftarten oder Bild-Assets.

## Was funktioniert?

- **Übersicht:** Workouts, Sätze, Volumen, Trainingstage/Woche, Wochenverlauf, Splitfilter, letzte Einheiten und Bestleistungen.
- **Workouts:** Push/Pull/Legs- und Datumsfilter, auswählbare Einheiten, alle Übungs-/Satzdetails.
- **Fortschritt:** Übungsauswahl, Gewicht, Wiederholungen, Volumen und geschätztes Epley-1RM; eigene Datumsgrenzen oder 14/28 Demo-Tage relativ zum letzten gespeicherten Workout.
- **Logger:** synthetischen Satz mit Gewicht, Wiederholungen und optionalem RPE speichern. Das Backend aktualisiert die Daten; die Oberfläche übernimmt das Tool-Ergebnis direkt.
- Helles/dunkles Theme, Host-Theme, mobile Navigation, Tastaturbedienung, Loading-/Empty-/Error-States und Demo-Reset mit Dialog.

## Arnold Data Foundation (Schema v1)

Die separate Datenzugriffsschicht für `arnold.training_raw` / `1.0.0` unterstützt CONFIG, EXERCISES, PLANS, PLAN_ITEMS, WORKOUTS und SETS. `ArnoldSheetsReadAdapter.getDataset()` liefert validierte Rohdaten mit stabilen IDs und vollständigen Last-/Ausführungsdefinitionen. Sie ist bewusst noch nicht in das bestehende Dashboard eingebunden. Vertrag, Typen, Referenzen, Grenzen und Prüfstand: [ARNOLD-DATA-CONTRACT.md](docs/ARNOLD-DATA-CONTRACT.md).

## Arnold Analytics Engine (Metrics v1)

Die Berechnungsschicht in `src/analytics/` wertet ein validiertes `ArnoldDataset` aus und liefert ein Zod-geprüftes `ArnoldDashboardAnalytics`-Objekt mit Trainingsaktivität, Volumen, Bestleistungen, Übungsfortschritt, Wochen-/Monatsvergleichen, Planerfüllung und Datenqualität.

```ts
import { buildArnoldDashboardAnalytics } from "./src/analytics/index.js";

const analytics = buildArnoldDashboardAnalytics(dataset, {
  filter: { from: "2026-01-01", to: "2026-01-31" },
  reference_date: "2026-01-31",
  weekly_goal_training_days: 3,
});
```

Die Engine kennt kein Google, kein HTTP, kein MCP, kein React, kein Dateisystem und keine Systemuhr; sie verändert ihre Eingabe nicht und ist deterministisch. `Volumen = Gewicht × Wiederholungen` gilt dort **nicht** allgemein: Lastdefinition, Gerätezahl, Ausführungsart und Wiederholungsbasis gehen in jede Satzrechnung ein, und nicht berechenbare Beiträge werden als `not_available` mit maschinenlesbarem Grund ausgewiesen statt als Nullwert. Wie Task 001 ist diese Schicht bewusst noch nicht an Dashboard oder MCP-Tools angeschlossen.

Verbindliche Konventionen, Formeln, Grenzen und Beispielergebnisse: [ARNOLD-METRICS-SPEC.md](docs/ARNOLD-METRICS-SPEC.md).

## Google Sheets lesen

Der Adapter für das bestehende `Trainingslog` ist implementiert. Er liest ausschließlich die konfigurierten Bereiche **A:G** (Eingaben) und **O:S** (Typ, effektive Last, Satz-ID, Duplikat, Zeilenstatus) ab Kopfzeile 4. Notizspalten und andere Tabs werden nicht abgefragt. Datei-ID, Tab-ID, Name und Spaltenüberschriften werden vor der Auswertung geprüft.

Das bestehende GPT schreibt weiterhin in die Originaldatei. Das Dashboard liest beim Öffnen, beim erneuten Tool-Aufruf und über **Aktualisieren** neu. Es speichert keine Kopie der Trainingsdaten auf der Festplatte. „Gewicht“ und Volumen verwenden die effektive Last aus Spalte P, auch bei Eigengewichtsübungen. Ungültige, unvollständige oder doppelte Sätze werden mit sichtbarer Zeilenwarnung ausgeschlossen.

Im Sheets-Modus gibt es nur vier lesende MCP-Tools und drei Ansichten. Demo-Logger und Reset sind weder registriert noch sichtbar. Herkunft und Ladezeit werden angezeigt. Es gibt keinen automatischen Rückfall auf Demo-Daten bei Google-Fehlern.

Konfiguration: siehe [.env.example](.env.example) und [Sheets-Einrichtung](docs/GOOGLE-SHEETS.md). Die lokale Datei `.env.sheets` ist ignoriert. **Das Google-Dienstkonto und die Betrachterfreigabe sind eingerichtet; für den echten Backend-Lesetest fehlen noch die lokal abgelegte Google-Schlüsseldatei und die Bestätigung der Sheets-API-Aktivierung. Vorerst wird nur lokal getestet. Ein privater OpenAI-Tunnel und ein OpenAI-Schlüssel wurden nicht angelegt. Die bisher in ChatGPT getestete Verbindung verwendet synthetische Demo-Daten.**

## Demo-Daten und Speicherung

`src/server/fixture.ts` reproduziert den ursprünglichen Starter: **12 Workouts, 108 Sätze, 9 Übungen, vier Wochen vom 28.09. bis 23.10.2026, exakt 40.021 kg Volumen**. Diese Fixture bleibt unabhängig vom optionalen Google-Sheets-Modus.

Beim ersten Zugriff entsteht `data/demo.json`. Zusätzliche Demo-Sätze bleiben nach einem Serverneustart erhalten. Zurücksetzen geht über den UI-Button oder `reset_demo_data` mit `confirmDemoReset: true`.

Eine Einheit ist durch Datum + Split bestimmt. Satznummern laufen pro Übung innerhalb einer Einheit. Der Split wird aus der Übung abgeleitet. `requestId` identifiziert **einen Speicherversuch**, nicht den Satzinhalt: denselben Schlüssel bei Retries verwenden; für einen weiteren identischen Satz einen neuen Schlüssel erzeugen. Gleicher Schlüssel mit anderem Inhalt wird abgelehnt. Die UI behält ihn bei einem fehlgeschlagenen Versuch, solange die Eingaben gleich bleiben. Nach Reset werden auch die Demo-Idempotenzschlüssel gelöscht.

Der JSON-Adapter unterstützt **einen laufenden Serverprozess pro Datendatei**. Er serialisiert Schreibvorgänge und ersetzt die Datei atomar. Er ist keine Benutzerverwaltung oder produktive Datenbank.

## MCP-Tools

Alle Tools besitzen Input- und Output-Schemas, lesbare Textantworten und `structuredContent`. Sie können ohne UI aufgerufen werden.

| Tool                    | Eingaben                                                        | Ergebnis / Verhalten                                            |
| ----------------------- | --------------------------------------------------------------- | --------------------------------------------------------------- |
| `show_arnold_dashboard` | `{}`                                                            | Kennzahlen und UI-Ressource `ui://arnold/dashboard-v5.html`     |
| `get_dashboard_data`    | optional `startDate`, `endDate`, `split`                        | Kennzahlen, Einheiten, Wochen, Rekorde, Übungen                 |
| `get_workouts`          | optional `startDate`, `endDate`, `split`                        | Einheiten einschließlich aller Sätze                            |
| `get_exercise_progress` | `exerciseId`, optional Datumsgrenzen                            | Kennzahlen pro Trainingstag                                     |
| `log_demo_set`          | `requestId`, `date`, `exerciseId`, `kg`, `reps`, optional `rpe` | Gespeicherter Satz, Duplikatstatus und aktualisiertes Dashboard |
| `reset_demo_data`       | `confirmDemoReset: true`                                        | Ursprüngliches synthetisches Dashboard                          |

Datum: `YYYY-MM-DD`, Grenzen inklusive. Split: `Push`, `Pull`, `Legs`. Gewicht: 0–1000 kg, Wiederholungen: ganze Zahlen 1–100, RPE: 1–10. Übungs-IDs kommen aus `get_dashboard_data`, z. B. `bench-press`, `lat-pulldown`, `squat`. Ungültige Argumente oder unbekannte IDs erzeugen MCP-Toolfehler und ändern den Speicher nicht.

## MCP Inspector und eingebettete UI testen

```bash
npm run inspector
```

Im Inspector **Streamable HTTP** wählen, `http://localhost:8787/mcp` verbinden und **List Tools** ausführen. Alle sechs Tools einzeln testen. In **Resources** die UI-Ressource lesen; MIME-Typ ist `text/html;profile=mcp-app`. Der Inspector dient zunächst der Protokollinspektion. Für einen nachweisbaren iframe-/UI-Test den mitgelieferten Host unter `/host` verwenden.

Beispiel für `log_demo_set`:

```json
{
  "requestId": "inspector-demo-0001",
  "date": "2026-10-24",
  "exerciseId": "bench-press",
  "kg": 60,
  "reps": 10,
  "rpe": 8
}
```

Erwartung nach einmaligem Aufruf: 13 Workouts, 109 Sätze, 40.621 kg. Derselbe Aufruf liefert `duplicate: true`; es bleibt bei 109 Sätzen. Anschließend `reset_demo_data` mit `{"confirmDemoReset":true}` ausführen.

Im [lokalen Host](http://localhost:8787/host) erscheint nach der Initialisierung eine Statuszeile. Historie und Fortschritt öffnen, dann einen Satz speichern und die Demo zurücksetzen. Die UI besitzt dort keinen Netzwerkzugriff: Alle Backend-Tools laufen durch die offizielle Host-Bridge. `?theme=dark` prüft den initialen dunklen Host-Kontext.

Optional kann auch der offizielle [MCP Apps Basic Host](https://github.com/modelcontextprotocol/ext-apps/tree/main/examples/basic-host) eingesetzt werden. Dessen aktuelle Installationsanleitung beachten. Für einen Host auf Port 8080 den Server mit `ALLOWED_ORIGINS=http://localhost:8080 npm start` starten und den Host auf den MCP-Endpunkt konfigurieren. Der unabhängige Basic Host wurde hier nicht zusätzlich ausgeführt.

## Tests

```bash
npx playwright install chromium
npm run check
```

Einzeln: `npm run typecheck`, `npm run build`, `npm test`, `npm run test:e2e`. Browser-Tests starten selbst einen separaten Server auf **8790**, verwenden `test-results/e2e-demo.json` und setzen nur diese Testdatei zurück. Ein bereits belegter Testport muss zuerst freigegeben werden.

Details zu Prüfungen, Ergebnissen und Grenzen: [docs/TESTING.md](docs/TESTING.md).

## Konfiguration

| Variable          | Standard                    | Zweck                                                          |
| ----------------- | --------------------------- | -------------------------------------------------------------- |
| `PORT`            | `8787`                      | HTTP-Port                                                      |
| `HOST`            | `127.0.0.1`                 | Bind-Adresse; loopback für lokale Entwicklung                  |
| `DEMO_DATA_FILE`  | `data/demo.json`            | Absoluter oder projektbezogener Dateipfad                      |
| `ALLOWED_HOSTS`   | `localhost,127.0.0.1,[::1]` | Erlaubte Hostnamen ohne Schema und Port                        |
| `ALLOWED_ORIGINS` | leer; Same-Origin möglich   | Zusätzliche vollständige Browser-Origins, durch Komma getrennt |

Variablen werden aus der Prozessumgebung gelesen. Eine `.env` wird nicht automatisch geladen; bei Bedarf `node --env-file=.env dist/server/main.js` verwenden. Beispiel: [.env.example](.env.example).

## In ChatGPT verwenden

Die konkrete Anleitung einschließlich Secure MCP Tunnel und HTTPS-Alternative steht in [docs/CHATGPT.md](docs/CHATGPT.md). Eine persönliche ChatGPT-Demo-Verbindung wurde bereits geprüft. Nach der Umbenennung müssen bestehende ChatGPT-Verbindungen ihre Tool-Liste aktualisieren oder neu verbunden werden, damit `show_arnold_dashboard` und die neue UI-Ressource erkannt werden. Für den früheren Test wurde ein temporärer Cloudflare-HTTPS-Tunnel verwendet. Details und beobachtete Ergebnisse stehen in [docs/CHATGPT-ABNAHME.md](docs/CHATGPT-ABNAHME.md). Es wurden keine API-Keys oder kostenpflichtigen Dienste eingerichtet.

## Architektur und Grenzen

[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) beschreibt Adapter, Berechnungen, MCP-Lifecycle und die spätere Google-Sheets-Anbindung. [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) vergleicht Hosting-Wege.

Dieser Prototyp verwendet einen gemeinsamen synthetischen Demo-Datensatz ohne Authentifizierung. Er bietet keine Konten, Google OAuth, Sheets-Synchronisierung, Zahlungen oder Verarbeitung echter Gesundheitsdaten. Andere bereits offene Browserfenster aktualisieren sich erst nach Neuladen; es gibt keinen Hintergrund-Sync. Der Öffnungs-Prompt und die beschriebenen UI-Flows sind in ChatGPT geprüft; eine umfassende Prompt-Evaluation und weitere Geräte stehen aus.
