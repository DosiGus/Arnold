# Live-Nutzungstest nach Google-Freigabe

Stand: 2. November 2026, Ergebnisse der Fortsetzung des [ersten Berichts](BERICHT.md). Server weiter `arnold-00013-7wj` / `689c21b`. Ausschließlich synthetische Trainingsdaten.

## Google und Testdaten

Nach der ausdrücklichen Freigabe wurde genau ein OAuth-Testnutzer hinzugefügt. Der reguläre Google-Dialog forderte E-Mail/Anmeldung und ausschließlich `drive.file` an. Beide wurden wie bestätigt freigegeben. Die persönliche Datei „Arnold – Mein Training“ wurde angelegt; das Onboarding erreichte COMPLETED. Der bestätigte Ganzkörperplan ist im echten Dashboard verfügbar. Die Master-Vorlage wurde nicht bearbeitet.

Sechs verschiedene Trainingstage und **26 eindeutige Satz-IDs** sind im bestätigten Journal vorhanden. Das Journal ist ein zusätzlicher Nachweis; es ersetzt den nachfolgend genannten Live-Readback nicht.

| Datum      | Sätze | Tatsächlich beobachteter Zustand                                                |
| ---------- | ----: | ------------------------------------------------------------------------------- |
| 26.10.2026 |     4 | Abgeschlossen; nachträgliche Korrektur durch anderen offenen Auftrag blockiert. |
| 28.10.2026 |     4 | Abgeschlossen.                                                                  |
| 30.10.2026 |     4 | Abgeschlossen.                                                                  |
| 31.10.2026 |     4 | Abgeschlossen.                                                                  |
| 01.11.2026 |     4 | Noch laufend; Abschluss dauerhaft unklar.                                       |
| 02.11.2026 |     6 | Im Dashboard erfasst und abgeschlossen; zwei Übungen.                           |

Das heutige Training enthält Kniebeugen 60 × 8, **60 × 8 nach Korrektur von 62,5**, 65 × 6 und Bankdrücken 40 × 10, 42,5 × 8, 42,5 × 7. Die Karte zeigt korrekt sechs Arbeitssätze, zwei Übungen und gerundet 2.388 kg Volumen (rechnerisch 2.387,5 kg). Die fünf historischen freien Einheiten enthalten je zwei Bankdrück- und zwei Latzugsätze mit RIR 2. Nicht bekannte Trainingsuhrzeiten wurden nicht angegeben.

Der historische Chat-Import benötigte nach Fortsetzung laut Host **10 Minuten 17 Sekunden**. Vier der fünf historischen Einheiten wurden abgeschlossen; die letzte bleibt blockiert. Im Chat wurden die Ergebnisse anschließend aus Arnold gelesen, keine bloße Erfolgsaussage ohne Readback. Die anfängliche Unterbrechung durch ein Nutzungslimit der Browser-Freigabe wird getrennt von Arnold-Fehlern behandelt.

## P1 – Jeder Satz blockiert die Oberfläche ungefähr 13–14 Sekunden

Gemessen von der Speicheraktion bis sichtbarer nächster Satzeingabe beziehungsweise sichtbarer Korrektur: 13.220 ms, 13.193 ms, 13.520 ms und 14.071 ms. Ein weiterer Satz zeigte nach 13.758 ms zwar die Folgeüberschrift, blieb jedoch wegen unklarer Bestätigung gesperrt; dieser Wert zählt ausdrücklich nicht als erfolgreiche Eingabebereitschaft. Eine erwartete automatische Übungsnavigation trat nicht ein; deren 30-Sekunden-Warteprüfung ist ebenfalls keine Satzspeicher-Latenz.

Die Gewichtseingabe mit deutschem Dezimalkomma funktioniert. Der lokale manuelle Übungswechsel benötigt nur 44 ms. Die langsame Strecke ist damit erneut von der lokalen Darstellung zu unterscheiden.

**Nachweis im Server:** Die normalen `log_workout_sets`-Aufrufe liegen bei etwa 4,3–5,2 Sekunden; danach folgt `get_workout` mit etwa 0,8–1,3 Sekunden, jeweils zusätzlich zum Host-/MCP-Weg. Weitere Dashboard-Abfragen folgen. Die Zeiten sind über Zeitstempel zugeordnet, nicht über eine gemeinsame Client-/Server-Trace-ID.

**Code:** `src/ui/hooks/useWorkoutLogger.ts` wartet in `dispatch` erst auf `client.write`, danach auf `load(id)`, bevor `busy` endet. `src/ui/views/TrainingCard.tsx` sperrt in dieser Zeit die gesamte Eingabe. Der bestätigte Schreibresponse wird nicht unmittelbar zum Fortschreiben des lokalen Workout-Zustands genutzt.

**Lösung:** Einen bestätigten Schreibresponse mit den nötigen aktuellen Zeilen/Revisionen liefern und die sichtbare Folgeeingabe daraus ableiten; den zusätzlichen Vollabruf aus dem blockierenden Weg nehmen und kontrolliert im Hintergrund abgleichen. Globale Refresh-Aufrufe bündeln. Falls lokale Folgeeingaben schon vor der Bestätigung zugelassen werden, brauchen sie einen separaten dauerhaften Auftragspuffer mit unveränderlichen IDs und ehrlichem Speicherstatus; die UI darf Erfolg nicht vorwegnehmen.

**Dateien:** `src/ui/hooks/useWorkoutLogger.ts`, `src/ui/client/ArnoldMcpClient.ts`, `src/ui/views/TrainingCard.tsx`, `src/server/mcp-workout.ts`, `src/shared/workout-contract.ts`. **Aufwand:** ca. 1–2 Tage einschließlich Wiederaufnahme-, Konflikt- und verlorener-ACK-Prüfungen. **Produktrelevanz:** sehr hoch; der Kernablauf bleibt trotz schneller Onboarding-Fragen zu langsam.

## P1 – Unklarer Auftrag sperrt andere Trainings dauerhaft

Zwei unklare UI-Satzaufträge ließen sich mit der angebotenen Aktion „Erneut prüfen“ klären (12.251 ms bzw. 14.858 ms). Die Karte zeigte danach jeweils genau einen betreffenden Satz; das Journal enthält 26 eindeutige bestätigte Satz-IDs.

Der Abschlussauftrag `synthetic-free-2026-11-01-complete` bleibt dagegen im Journal **dispatching**, während die live gelesene Einheit weiterhin `in_progress`, Revision 1, ist. Wiederholtes Prüfen mit derselben ID bringt erneut COMMIT_STATUS_UNKNOWN. Ein anschließend ausdrücklich angeforderter `update_set` auf das abgeschlossene Training vom 26.10. wird wegen dieses fremden offenen Auftrags ebenfalls abgelehnt. Die beabsichtigte Korrektur 40 → 42,5 kg wurde nicht gespeichert; beide Sätze bleiben bei 40 kg × 10, Revision 1.

**Codeursache:** `src/server/workout/service.ts` speichert `dispatching` vor `repository.apply`. Beim Retry führt `entry.state === "dispatching" && observed === "absent"` immer wieder zu COMMIT_STATUS_UNKNOWN. Andere Aufträge werden bereits in der Schleife über `ledger.pending` blockiert. Dieser Schutz vermeidet blindes erneutes Anhängen, besitzt aber für den beobachteten Zustand keinen nutzbaren Abschlussweg.

**Wichtige Grenze:** Die Logs beweisen noch nicht, an welcher Transportphase der erste Fehler auftrat. Eine Leselimit-/Preflight-Störung ist plausibel; eine eindeutige Bestätigung „nicht gesendet“ fehlt. Deshalb wurde der Live-Journaleintrag nicht manuell zurückgesetzt und der Auftrag nicht unter neuer ID wiederholt.

**Lösung:** Fehler nach Phase und Gewissheit klassifizieren: vor dem Google-Schreibversand sicher gescheitert → denselben Auftrag wieder auf prepared setzen; eindeutig von Google abgelehnt → ebenfalls sicher erneut ausführbar; Versand/Commit tatsächlich unklar → anhand stabiler IDs abgleichen und einen expliziten Reparaturweg anbieten. Einen wirklich unklaren Schreibvorgang niemals allein wegen einer leeren Momentaufnahme erneut senden. Transportstatus und Phase ohne Nutzdaten protokollieren. Fault-Injection-Tests für Preflight-429, verlorene Antwort, partielle Sichtbarkeit und gescheitertes Journal/Audit ergänzen.

**Dateien:** `src/server/workout/service.ts`, `src/server/plan/commit.ts`, `src/server/workout/infrastructure.ts`, `src/server/arnold-sheets-write-adapter.ts`, `src/server/tool-log.ts`, entsprechende Workout-/Connected-Tests. **Aufwand:** ca. 1–2 Tage für saubere Klassifikation und Wiederaufnahme; Reparatur bestehender Fälle gesondert validieren. **Produktrelevanz:** sehr hoch, weil ein einzelner Fehler weitere Workout- und Planänderungen des Nutzers blockiert.

## P1 – Sehr viele Google-Leseanfragen pro Speicherung

`ArnoldSheetsReadAdapter.read` lädt erst Metadaten und danach sechs Tabellen: **sieben Sheets-Leseanfragen pro vollständigem Datensatz**. Ein normaler Schreibpfad liest den vollständigen Datensatz beim Service-Einstieg, beim Prüfen vorhandener Änderungen, im Adapter vor dem Batch, im Adapter nach dem Batch und beim abschließenden Service-Readback. Ohne überlappende Wiederverwendung sind das bereits ungefähr **35 Sheets-GETs für einen logischen Schreibauftrag**, zuzüglich UI-Nachladen, Dashboard und Drive-Dateiprüfungen. Der Adapter teilt nur zeitgleich laufende Reads, hat keinen Snapshot-Cache; die Connected-Invalidierung ist leer.

Google nennt standardmäßig 60 Leseanfragen je Minute/Nutzer/Projekt und 300 je Minute/Projekt. [Offizielle Sheets-Limits](https://developers.google.com/workspace/sheets/api/limits). Die konkrete Kontingentkonfiguration und einzelne Google-HTTP-429-Antworten wurden in diesem Test nicht aus der Console verifiziert. **Die Vervielfachung ist ein belegter Codebefund; sie ist eine starke Hypothese für einen Teil der beobachteten Speicherfehler, aber noch kein vollständiger Ursachennachweis.**

**Lösung:** Die sechs begrenzten Tabellenbereiche nach geprüften Metadaten in einer gemeinsamen Google-Abfrage laden. Innerhalb eines exklusiven Schreibvorgangs einen eindeutig zugeordneten Vorher-Snapshot wiederverwenden und genau einen frischen, vollständigen Nachher-Readback durchführen. Revisionen, Trackerzuordnung, Formel-/Headerprüfungen und die Erkennung fremder Änderungen erhalten. Read-only-Dashboard-Snapshots kurzzeitig teilen und korrekt nach bestätigten Mutationen invalidieren. Keine pauschale Entfernung von Kontrollen und keine Kontingenterhöhung als erster Schritt.

**Dateien:** `src/server/arnold-sheets-read-adapter.ts`, `src/server/arnold-sheets-write-adapter.ts`, `src/server/workout/service.ts`, `src/server/connected/runtime.ts`, Google-Transport und Adaptertests. **Aufwand:** etwa 1–2 Tage, abhängig vom transaktionsbezogenen Snapshot-Vertrag. **Produktrelevanz:** hoch für Latenz, Zuverlässigkeit und mehrere Nutzer.

## Weitere bisherige Beobachtungen

- Neuer Dashboard-Aufruf scheitert wie die Onboarding-Karte zunächst mit „Arnold konnte nicht angezeigt werden“. Nach Retry lädt die Wochenkarte. Chattext behauptet schon vorher, sie sei geöffnet. Der bestehende P1-Erstladefehler ist damit auch außerhalb des Onboardings reproduziert.
- Wochenzahlen im Chat und auf der Wochenkarte stimmen: 26.10.–01.11. vier abgeschlossene Trainings/16 Arbeitssätze; aktuelle Woche ein abgeschlossenes Training/sechs Arbeitssätze. Die vier Sätze der offenen Einheit werden korrekt nicht in die Wochenkennzahlen gezählt.
- In einer Momentaufnahme von 77 Tool-Aufrufen des Testkontos stehen 53 Erfolge und 24 Fehler: zwölf COMMIT_STATUS_UNKNOWN, elf STORAGE_UNAVAILABLE, ein vom Tool-Logger nicht näher klassifizierter Fehler. Das ist eine Momentaufnahme, keine endgültige Fehlerquote für jeden Nutzer.
- Im erfassten Connected-Zeitfenster 16:43–18:37 UTC wurden zusätzlich 67 GCSFuse-Drosselungsereignisse erfasst, sämtlich auf `identities.json`. Auch hier handelt es sich um Retry-Logereignisse, nicht um 67 endgültig verlorene Nutzeraktionen.
- Die Speicheroberfläche verwendet „noch nicht bestätigt“/„erneut prüfen“ bereits während normal laufender Aufträge. Aktives Speichern und tatsächlich unklarer Ausgang sollten getrennt dargestellt werden.

## Historie, Fortschritt und aktiver Plan

Die Historie zeigt standardmäßig fünf abgeschlossene Einheiten. „Offene und abgebrochene Trainings zeigen“ erhöht die Anzeige auf sechs und macht die laufende Einheit vom 01.11. sichtbar. Die Detailansicht vom 26.10. zeigt beide Bankdrücksätze mit 40 kg × 10 und beide Latzugsätze mit 45 kg Maschinenanzeige × 10, jeweils RIR 2. Die abgelehnte nachträgliche Korrektur wird damit auch direkt im Dashboard als unverändert verifiziert.

Der Bankdrück-Fortschritt enthält korrekt nur abgeschlossene Trainings: 40 / 42,5 / 42,5 / 45 / 42,5 kg an den fünf abgeschlossenen Tagen. Der offene 01.11. fehlt in der Auswertung. Das angezeigte Plus von 2,5 kg vergleicht letzten mit erstem Wert. Die alternative Volumenkennzahl stimmt ebenfalls: 800 / 765 / 850 / 720 / 1.037,5 kg.

Der per Chat angeforderte neue Entwurf aus dem aktiven Plan wird ausdrücklich wegen des offenen Abschlussauftrags abgelehnt. Gewünschte Änderung war Bankdrücken → Brustpresse in Ganzkörper A bei unverändert 3 × 6–10. Es wurde kein neuer Entwurf als erfolgreich bestätigt und nichts aktiviert. Auch die Plan-Commitstrecke (`src/server/plan/commit.ts`) prüft dieselben offenen Journaleinträge und blockiert deren ungeklärten Zustand.

Dasselbe ist direkt im Dashboard getestet: aktiven Plan öffnen → Plan bearbeiten → neue bearbeitbare Version anfordern. Der Editor zeigt „Ein früherer Schreibvorgang muss zuerst geklärt werden“ und zwei nebeneinander stehende Hinweise zum unbestätigten Vorgang. Der aktive Plan bleibt mit drei Einheiten und 18 Übungen sichtbar. Der Editor erklärt nicht, welches frühere Training den Planvorgang blockiert; „denselben Vorgang erneut prüfen“ führt den Nutzer daher nicht gezielt zum eigentlichen Hindernis. Die Fehlermeldung sollte den vorherigen Speichervorgang verständlich benennen und bei tatsächlich unklarem Ausgang einen brauchbaren Wiederaufnahme-/Reparaturweg anbieten.

Damit kann die zusätzliche Planaktivierung nach vorhandenen Trainings und die Prüfung historischer Planreferenzen über einen erfolgreichen Versionswechsel hinweg noch nicht live abgenommen werden. Die vor Google getestete Umstellung PPL → Ganzkörper und deren Planreferenz-Korrektur sind weiterhin erfolgreich geprüft. Der bisherige aktive Plan und die historischen Trainings bleiben unverändert.

## Ergebnis und Reihenfolge der Korrekturen

Der Fragenwechsel-Fix ist live und wirksam; **die gesamte Anwendung ist mit dem beobachteten Logger- und Journalverhalten noch nicht abnahmefähig**. Das Testziel war eine echte Nutzung in ChatGPT, keine synthetische Mehrnutzer-Lastprüfung. Die Fehler treten bereits in diesem einzelnen Testkonto auf.

1. **P1: Dauerhaft offenen Schreibauftrag beherrschbar machen.** Gewissheit über Versand/Commit, phasenbezogene Fehler und sichere Wiederaufnahme zuerst korrigieren. Den vorhandenen Testfall anschließend kontrolliert reparieren und genau dieselben UI-/Chataktionen erneut prüfen.
2. **P1: Google-Lesevervielfachung und Identitätsdatei-Schreiblast reduzieren.** Frische Prüfungen bewahren, redundante Vollabrufe und Last-seen-Schreibvorgänge bündeln. Vor-/Nachher-Anzahl der Google-Aufrufe pro Satz messen.
3. **P1: Bestätigten Schreibresponse direkt im Logger verwenden.** Das zweite MCP-Nachladen aus dem blockierenden Pfad entfernen; ehrliche, getrennte Zustände für laufende, bestätigte und unklare Aufträge.
4. **P1: Erstladefehler im tatsächlichen ChatGPT-Host isolieren.** Er ist erneut bei Wochenkarte und Planeditor aufgetreten. Retry funktioniert, die Ursache bleibt offen.
5. **P2: Rückmeldungen und Validierung vereinheitlichen.** Konkreter Wiederaufnahmehinweis, weniger doppelte Warnungen, wahrer Google-Verbindungszustand und lesbare Planfreigabe.

Die Implementierungsaufwände der zusammengehörigen Änderungen überschneiden sich und sollten nicht blind addiert werden. Eine ungeprüfte Journaländerung, ein längerer Timeout oder mehr Server-CPU wären keine ausreichende Lösung.

## Testgrenzen und Nachweise

Erfolgreich live geprüft: Google-Testnutzer/Consent/Dateierstellung, Onboarding-Abschluss, heutiges Training über UI, deutsche Dezimaleingabe, Gewichtsänderung und Korrektur während eines laufenden Trainings, fünf historische Trainings über Chat, zwei erfolgreich reconciliierte Satzaufträge ohne erkennbare Doppelanlage, Abschluss von fünf Einheiten, Historienfilter und Satzdetails, Wochenzahlen, Gewicht- und Volumenfortschritt. Fehlgeschlagen: Abschluss des 01.11., Korrektur eines abgeschlossenen Trainings und Erstellung eines neuen Entwurfs aus dem aktiven Plan in Chat und UI. Der anschließende Versionswechsel und seine historischen Referenzen bleiben wegen dieser Sperre ungetestet. Es wurde weder ein realer Mehrnutzer-Lasttest noch ein kontrollierter Modellvergleich durchgeführt.

Die letzte Log-Momentaufnahme enthält 99 Toolaufrufe: 71 Erfolge und 28 Fehler (16 COMMIT_STATUS_UNKNOWN, elf STORAGE_UNAVAILABLE und ein nicht näher klassifizierter Fehler). Erfolgreiche Satz-Schreibtools: Median 4.413 ms. Diese Serverzeiten enthalten nicht die gesamte Browser-/Host-Laufzeit. Der Fehlerlogger lässt bei einzelnen Read-Fehlern `_meta.arnold.code` und den ursprünglichen Google-HTTP-Status außer Betracht; für die nächste Diagnose phasenbezogene, inhaltsfreie Metadaten ergänzen (`src/server/tool-log.ts` und Adapterfehler).

Der hinterlassene Stand ist beabsichtigt nachvollziehbar: persönliche Testdatei verbunden, sechs Trainingstage/26 eindeutige bestätigte Satz-IDs, fünf abgeschlossene Einheiten, eine offene Einheit und genau ein `dispatching`-Auftrag im Backendjournal. Die synthetischen Daten wurden nicht gelöscht oder durch manuelle Journaleingriffe passend gemacht. Screenshots liegen ausschließlich lokal in `data/live-audit-2026-11-02/`.

### Bereinigte Nachweise

- [Logger-Messungen](workout-ui-timings.json), einschließlich als nicht erfolgreich markierter Versuche.
- [Connected-Toolaufrufe](connected-tools-final.json) und [Zusammenfassung mit Laufzeiten](connected-tools-summary.json).
- [Unklare erste Satzbestätigung](logger-unknown-tools.json), [zweite Satzbestätigung](logger-second-unknown-tools.json), [erster historischer Import](historical-import-first-logs.json) und [Fortsetzung](historical-import-resume-logs.json).
- [GCS-Drosselungen](connected-throttle-summary.json), [abschließender Journal-/Dateistand](connected-final-state.json).

Die direkte Abfrage der Google-Console-Metriken wurde durch die automatische Browser-Freigabe wegen eines Nutzungslimits abgewiesen. Der Testchat konnte nach der Fortsetzungsanweisung regulär weiterverwendet werden. Die Console-Abfrage wurde nicht durch einen anderen Zugriffsweg umgangen. Die Hypothese zu Sheets-Leselimits bleibt deshalb ausdrücklich von den belegten GCS-429-Ereignissen und COMMIT_STATUS_UNKNOWN-Antworten getrennt.
