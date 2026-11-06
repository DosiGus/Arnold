# Arnold als ChatGPT-Plugin

Dieses Paket verbindet den Arnold-MCP-Server mit zwei Skills. Der Server bleibt unverändert und ist weiterhin allein zuständig für Login, Daten, Prüfungen, Gewichte und Schreibvorgänge. Die Skills geben ChatGPT feste Abläufe und Regeln.

| Datei                          | Inhalt                                                  |
| ------------------------------ | ------------------------------------------------------- |
| `plugin.json`                  | Name, Version, Texte und Rechtslinks für das Plugin     |
| `mcp.json`                     | Live-Adresse des Servers, OAuth mit Selbstregistrierung |
| `skills/arnold-trainingsplan/` | Plan erstellen, übernehmen und ändern                   |
| `skills/arnold-coach/`         | Fragen, Fortschritt, Stillstand, Motivation, Schmerzen  |
| `skills/*/references/`         | Planungsregeln, Trainingswissenschaft, Daten lesen      |
| `skills/*/agents/openai.yaml`  | MCP-Abhängigkeit des Skills                             |

Das Onboarding braucht keinen Skill: Es wird vom Server und den Einrichtungs-Werkzeugen geführt. Die Server-Anweisungen gelten weiter auch für Nutzer, die Arnold ohne Plugin verbinden.

## Lokal testen

1. ChatGPT-Desktop-App mit dem Repository als Projekt öffnen; sie liest `.agents/plugins/marketplace.json`. Alternativ den Ordner nach `~/.codex/plugins/arnold` kopieren und in `~/.agents/plugins/marketplace.json` eintragen.
2. App neu starten, in den Plugins die Quelle „Arnold (Repository)“ wählen, Arnold installieren und anmelden.
3. Neuen Chat starten und die Testfälle unten durchgehen.

Nach Änderungen an den Skills den Plugin-Ordner aktualisieren und die App neu starten. Nach Änderungen an Server-Werkzeugen zusätzlich in ChatGPT „Tools aktualisieren“.

Für die Veröffentlichung braucht es noch die registrierte MCP-Verbindung aus ChatGPT (ID `plugin_asdk_app…`, über „Add custom MCP server“ → „Create as a plugin“) und Logo-Dateien. Beides ist bewusst nicht erfunden.

## Testfälle

Sollen einen Skill auslösen:

1. „Erstelle mir einen Trainingsplan, 3 Tage, 45 Minuten, Studio, Anfänger.“ → arnold-trainingsplan. Namen ohne A/B/C, höchstens zwei Stoßzeit-Geräte pro Tag, kein Gewicht erfunden, nichts aktiviert ohne Ja.
2. „Tausch die Beinpresse gegen etwas ohne Gerät.“ → arnold-trainingsplan, Entwurf, Vergleich, Rückfrage vor Aktivierung.
3. „Warum stagniert mein Bankdrücken?“ → arnold-coach, lädt Daten, Prüfliste, höchstens zwei Rückfragen.
4. „Warum soll ich nächstes Mal 62,5 kg nehmen?“ → arnold-coach, erklärt `progression`, ändert die Rechnung nicht.
5. „Mir tut beim Schulterdrücken die Schulter weh.“ → arnold-coach, keine Steigerung, keine Diagnose, Abklärung bei anhaltenden Beschwerden.

Sollen keinen Skill auslösen:

1. „Push gemacht, alles wie letztes Mal.“ → sofort speichern, kein Coaching.
2. „@Arnold“ → Startansicht, höchstens zwei Sätze.
3. „Zeig mir meine Rekorde.“ → Rekord-Karte, keine Analyse.

## Pflege

- `tests/plugin-skills.test.ts` prüft, dass Skills nur veröffentlichte Werkzeuge nennen, die Adresse zu `docs/BETRIEB.md` passt und beide Skills dieselbe `trainingswissenschaft.md` haben. Diese Datei in beiden Skills gleich ändern.
- Bei inhaltlichen Änderungen `version` in `plugin.json` erhöhen.
