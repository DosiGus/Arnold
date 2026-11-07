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

## Stand der Tests (7. November 2026)

Getestet auf chatgpt.com mit dem bestehenden Arnold-Plugin und den beiden Skills als einzeln hochgeladene Skills (Skills → Hinzufügen → „Von deinem Computer hochladen“, je Skill-Ordner ein ZIP):

- **Skills greifen nur im Modus „Work“.** Im Modus „Chat“ lädt ChatGPT selbst hochgeladene Skills nicht; der Plan sah dann aus wie ohne Skill („Tag A/B/C“, drei Stoßzeit-Geräte an einem Tag). Ob Skills im Chat-Modus greifen, wenn sie im Arnold-Plugin selbst stecken, ist noch offen.
- **Plan-Skill (Work):** Ablauf wie im Skill (aktiver Plan, Katalog, Entwurf, Prüfung), Namen „Beinfokus“/„Rückenfokus“, höchstens zwei Stoßzeit-Geräte pro Tag, engere Wiederholungsbereiche, kurze Erklärung. Offen: Ein Ganzkörpertag hieß „Brust & Schultern“.
- **Coach-Skill (Work):** kurze Einordnung mit Datengrundlage, Verweis auf Arnolds Progression, eine Rückfrage. Die erste Fassung hat die Sicherheitsprüfung von ChatGPT nicht bestanden (sie erlaubte Speichern ohne Rückfrage); seitdem liest der Coach nur.
- **Loggen (Work):** „Ganzkörper B heute gemacht, alles wie letztes Mal“ wird sofort gespeichert, ohne Coaching.
- Arnold-Karten werden auch im Work-Modus angezeigt.

Die registrierte MCP-Verbindung in ChatGPT hat die ID `plugin_asdk_app_6ae4ff061f588191a0ecf58dd697efd8`.

## Lokal testen

1. ChatGPT-Desktop-App mit dem Repository als Projekt öffnen; sie liest `.agents/plugins/marketplace.json`. Alternativ den Ordner nach `~/.codex/plugins/arnold` kopieren und in `~/.agents/plugins/marketplace.json` eintragen.
2. App neu starten, in den Plugins die Quelle „Arnold (Repository)“ wählen, Arnold installieren und anmelden.
3. Neuen Chat starten und die Testfälle unten durchgehen.

Nach Änderungen an den Skills den Plugin-Ordner aktualisieren und die App neu starten. Nach Änderungen an Server-Werkzeugen zusätzlich in ChatGPT „Tools aktualisieren“.

Für die Veröffentlichung fehlen noch Logo-Dateien und die Verknüpfung der Skills mit der registrierten MCP-Verbindung (ID oben).

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
