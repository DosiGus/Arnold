# Arnold als ChatGPT-Plugin

Dieses Paket verbindet den Arnold-MCP-Server mit zwei Skills. Der Server bleibt unverändert und ist weiterhin allein zuständig für Login, Daten, Prüfungen, Gewichte und Schreibvorgänge. Die Skills geben ChatGPT feste Abläufe und Regeln.

| Datei                          | Inhalt                                                          |
| ------------------------------ | --------------------------------------------------------------- |
| `plugin.json`                  | Name, Version, Texte und Rechtslinks für das Plugin             |
| `mcp.json`                     | Live-Adresse des Servers, OAuth mit Selbstregistrierung         |
| `skills/arnold-trainingsplan/` | Plan erstellen, übernehmen und ändern                           |
| `skills/arnold-coach/`         | Fragen, Fortschritt, Stillstand, Motivation, Schmerzen          |
| `skills/*/references/`         | Planungsregeln, Trainingswissenschaft (mit Laufen), Daten lesen |
| `skills/*/agents/openai.yaml`  | MCP-Abhängigkeit des Skills                                     |

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

Für ein hochgeladenes Paket (Plugins → Hinzufügen → „Plugin-Archiv hochladen“) übernimmt ChatGPT die Server-Adresse nicht aus `mcp.json`, sondern nur über `.app.json`: Sie verweist mit `asdk_app_…` auf die registrierte MCP-Verbindung (ID oben ohne `plugin_`), `plugin.json` nennt sie unter `extensions.com.openai.apps`. ZIP aus dem Ordner `plugins/arnold` ohne README, `version` vorher erhöhen. Seit 17.11.2026 läuft Arnold so mit beiden Skills (Version 0.3.3). Für die öffentliche Einreichung (Portal, „With MCP“) darf `.app.json` nicht im ZIP sein; dort fehlen außerdem noch Logo-Dateien.

## Testfälle

Sollen einen Skill auslösen:

1. „Erstelle mir einen Trainingsplan, 3 Tage, 45 Minuten, Studio, Anfänger.“ → arnold-trainingsplan. Namen ohne A/B/C, höchstens zwei Stoßzeit-Geräte pro Tag, kein Gewicht erfunden, nichts aktiviert ohne Ja.
2. „Tausch die Beinpresse gegen etwas ohne Gerät.“ → arnold-trainingsplan, Entwurf, Vergleich, Rückfrage vor Aktivierung.
3. „Warum stagniert mein Bankdrücken?“ → arnold-coach, lädt Daten, Prüfliste, höchstens zwei Rückfragen.
4. „Warum soll ich nächstes Mal 62,5 kg nehmen?“ → arnold-coach, erklärt `progression`, ändert die Rechnung nicht.
5. „Mir tut beim Schulterdrücken die Schulter weh.“ → arnold-coach, keine Steigerung, keine Diagnose, Abklärung bei anhaltenden Beschwerden.
6. „Heute 45 Minuten Zone 2.“ → arnold-trainingsplan, `plan_run` (`base`, 45 Minuten), keine Tempi oder Pulswerte von ChatGPT.
7. „Morgen Intervalle.“ → `plan_run` (`intervals`, morgiges Datum), keine selbst gewählte Dauer.
8. „Schieb den langen Lauf auf Sonntag.“ → `get_run_week`, dann `update_planned_run`.
9. „Mach heute nur 30 Minuten.“ → `update_planned_run` (gleiche Laufart, 30 Minuten).
10. „Plane meine Laufwoche.“ → `schedule_run_week` als Vorschau mit Rückfrage; erst nach Ja derselbe Aufruf mit `confirm`, `request_id` und `preview_hash`.
11. „Wie lief meine Woche?“ → arnold-coach, `get_run_week` und/oder `get_run_analysis`, kurze Einordnung.
12. „Warum soll ich so langsam laufen?“ → arnold-coach, erklärt Zone 2, nennt kein eigenes Tempo.
13. „Beim Laufen ist mir schwindelig, die Brust drückt.“ → arnold-coach, Lauf beenden, ärztlich abklären (bei Brustschmerz 112), keine Diagnose.

Sollen keinen Skill auslösen:

1. „Push gemacht, alles wie letztes Mal.“ → sofort speichern, kein Coaching.
   „Ich bin 8 km in 44 Minuten gelaufen.“ → sofort `log_run` (Datum, Zeit und Distanz), kein Coaching.
2. „@Arnold“ → Startansicht, höchstens zwei Sätze.
3. „Zeig mir meine Rekorde.“ → Rekord-Karte, keine Analyse.

## Pflege

- `tests/plugin-skills.test.ts` prüft, dass Skills nur veröffentlichte Werkzeuge nennen, die Adresse zu `docs/BETRIEB.md` passt und beide Skills dieselbe `trainingswissenschaft.md` haben. Diese Datei in beiden Skills gleich ändern.
- Bei inhaltlichen Änderungen `version` in `plugin.json` erhöhen.
