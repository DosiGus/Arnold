# Worker A – Übergabe

Stand: 31.10.2026. Branch: `feat/beta-design`.
Worktree: `.claude/worktrees/beta-design`.
Lokale Vorschau: `http://127.0.0.1:8787/preview?card=week` (synthetische Daten, nur auf Loopback).

Worker A ist umgesetzt. Die Änderungen sind mit dem Backend-Stand `bfd2916` (B18) integriert. Die Backend-Dateien wurden aus dem von Worker B gelieferten Branch übernommen; A hat sie nicht selbst verändert. Der Merge nach `main` und der Deploy bleiben bei Worker C.

## Erledigte Aufgaben

| Aufgabe | Ergebnis                                                                                                                                                                                    | Commits                           |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------- |
| A1      | Ein tokenbasiertes Stylesheet, alte `cards.css` und `glass.css` entfernt; gemeinsame Regeln in `docs/DESIGN.md`                                                                             | `a7798d1`, Abschlussdokumentation |
| A2      | Kompakte Fortschritts-, Verlaufs- und Plankarten; Verlauf als Satzzeilen; ausführliche Ansichten im Vollbild mit Inline-Fallback                                                            | `754fe87`, `02f494d`              |
| A3      | Frage-Karten, freiwillige Person-Angaben, gezielte Korrektur, optionale Planwünsche, Chat-Übernahme und Wiederaufnahme; echte Abschlusskarte mit Dateiname und Link                         | `0803acd`, `d1013ed`              |
| A4      | Trainingstage statt Einheiten; Tagesmarkierungen ausschließlich aus `trained_dates`                                                                                                         | `34756e0`, `e7a71f2`              |
| A5      | Google-Reconnect ohne alten Einrichtungsnachweis; bestehende Karte und Eingaben bleiben erhalten; offizieller AppBridge-Host prüft Rückkehr und Vollbild                                    | `ff05513`, `cb50e72`, `4359b83`   |
| A6      | Alle sieben Recovery-Wege; fachliche Begründung ohne technische Codes; exakte Wiederholung unbestätigter Vorgänge bei Training, Plan und Einrichtung                                        | `ff05513`                         |
| A7      | Konto-Zusammenfassung, ausdrücklicher Löschklick, Token nur aus `_meta`, Ablauf-/Abbruch-/Erfolgszustände; Token bleibt aus dem Modellkontext                                               | `ff05513`, `3864f97`, `a28eb9d`   |
| A8      | Verständliches, freiwilliges RIR; vollständig sichtbare Übungen; Aufwärmschalter; vergleichbare Vorleistung; flüchtige echte Speicherbestätigung; ungewöhnliche Werte erst nach Bestätigung | `a991586`, `ef5cc20`              |
| A9      | Chromium und WebKit, schmale und große Ansichten, axe, 200-Prozent-Schrift, Regressionen, Bildschirmaufnahmen                                                                               | `a28eb9d`, Abschlussaufnahmen     |
| A10     | Einheitliche Daten, Einheiten, Begriffe und Singular-/Pluralformen; verständliche Validierungsgründe                                                                                        | `e7a71f2`, `ef5cc20`              |

Die zusätzlichen Verbesserungen aus dem freigegebenen Proposal sind enthalten: vorhandene Chat-Antworten überspringen, persönliche Angaben gesammelt auslassen, direkte Zahleneingabe beibehalten, sofortiges Druckfeedback und Erfolg erst nach Serverbestätigung.

## Gemeinsame Verträge – erledigter Abgleich

- B14: `connect_google_account` erhält bei einer Wiederverbindung `{}`. Eine laufende Einrichtung übergibt ihren Claim weiterhin. Die Karte prüft danach `get_google_connection` und aktualisiert die ursprüngliche Ansicht.
- B16: Die Abschlusskarte verwendet den tatsächlich geprüften `spreadsheet_name` und `spreadsheet_url` aus `FinishSetupOutputSchema`. Eine in einem neuen Chat erneut geöffnete abgeschlossene Einrichtung stellt den Link über `get_arnold_stored_data` wieder her, wenn der alte Claim fehlt. Ein nicht gelieferter Dateiname wird nicht erfunden.
- B17: `focus` transportiert Karte, Übung, Kennzahl und Training. Der initiale Leseabgleich des AppBridge-Hosts erhält diese Auswahl. Auch ein angefordertes abgebrochenes Training wird präzise geöffnet; danach bleibt die normale Trainingsliste bedienbar.
- B18: Hauptzahl und Unterschied verwenden `selected_comparison`. Zeitraum und Vergleichsklasse stammen vom Server. Keine Differenzberechnung in der UI.
- Ungewöhnliche Satzwerte werden nach einer eindeutigen Bestätigung mit `confirm_unusual_values: true` und einer neuen Operations-ID erneut gesendet. Unbestätigte Schreibvorgänge behalten dagegen unverändert ihre bestehende ID.
- `DATE_IN_FUTURE` bekommt einen kurzen verständlichen Hinweis. `CONFIRMATION_INVALID` startet die Kontobestätigung neu; `SHEET_CAPACITY_EXCEEDED` verweist auf den Beta-Support.

## Prüfungen

Die vollständige Endprüfung `npm run check` ist grün:

- Build und TypeScript.
- 74 Testdateien, **1.423 Unit- und Integrationstests**.
- **87 Browserprüfungen** in Chromium und WebKit.
- Danach **10 gezielte visuelle und Eingabe-Prüfungen** einschließlich der 44-Pixel-Mindestbreite/-höhe und der vollständigen Trainingsansicht erneut grün. **152 Bildschirmaufnahmen** liegen vor.
- Die Bildschirmmatrix prüft 375 und 1024 Pixel, hell und dunkel; weitere Regressionen prüfen 390 Pixel und 200 Prozent Grundschrift.
- axe ohne schwere/kritische Verstöße in der Karten- und Einrichtungs-Matrix. Weitere Tests verlangen für die Hauptansichten und den Planeditor gar keine WCAG-A/AA-Verstöße.
- Sämtliche sichtbaren Buttons der Bildschirmmatrix sind mindestens 44 CSS-Pixel hoch und breit. Keine horizontalen Überläufe.
- Offizieller AppBridge-Host mit Sandbox und gesperrtem UI-Netzwerk: Schreiben, Modellkontext, einmaliger Trainingsabschluss, direkte Kartenwahl und private Löschbestätigung geprüft.
- Verlorene Antworten: Training und Einrichtung behalten dieselbe Anfrage über einen Browser-Neustart hinweg; keine doppelte Speicherung.
- Plan: alte Revision abgewiesen, aktive Version bleibt unverändert, Entwurf bewusst bestätigt, ungültige Eingaben bleiben im Dialog korrigierbar.
- Gewichtskorrektur als Regression gegen angehängte Ziffern beim Fokuswechsel. Ungültige Zahlen blockieren das Speichern; Dezimalkomma bleibt korrekt.
- Echtes Zusammenspiel von UI, MCP, OIDC-Prüfung und synthetischen Google-Endpunkten bis zur eigenen Tabelle und zum ersten Satz.

Nur synthetische Daten wurden verwendet. Die Simulation der Löschkarte, einzelner Fehlerantworten und visueller Abschlusszustände ist ausdrücklich eine UI-Prüfung; die Backend-Funktionen sind zusätzlich durch B und die Integrationstests abgedeckt.

## Bildschirmaufnahmen

Ablage: `docs/beta/screens/`. Dateinamen nennen Browser, Zustand, Breite und Theme. Die Aufnahmen enthalten ausschließlich synthetische Daten.

Beispiele:

- [Woche, mobil und dunkel](screens/chromium-week-375-dark.png)
- [Satzkarte, mobil und hell](screens/chromium-set-375-light.png)
- [Trainingsabschluss](screens/chromium-training-summary-375-dark.png)
- [Fortschritt mit Serververgleich](screens/chromium-progress-375-dark.png)
- [Verlauf als Satzzeilen](screens/chromium-history-detail-375-light.png)
- [Planeditor](screens/chromium-plan-editor-375-light.png)
- [Einrichtungsfrage](screens/chromium-setup-question-375-light.png)
- [Abschluss mit Google-Dateiname](screens/chromium-setup-done-375-dark.png)
- [Konto löschen](screens/chromium-account-375-light.png)
- [Google neu verbinden](screens/chromium-reconnect-375-dark.png)

## Verbleibende Abnahme durch C

- Auf einem physischen iPhone direkt in der ChatGPT-App prüfen: Tastatur, Safe Areas, Öffnen/Rückkehr aus der Google-Freigabe, Host-Vollbild und Host-Theme. WebKit-Emulation ersetzt diesen Gerätetest nicht.
- Die echte Konto-Löschung und erneute Google-Freigabe mit den vorgesehenen Beta-Testkonten abnehmen. A hat keine realen Konten gelöscht oder Google-Freigaben verändert.
- Die neuen Karten und Vertragsdetails in `docs/GUIDE.md`/Tester-Anleitung übernehmen; diese Dokumente liegen bei C.
- Nur nach Integration und vollständiger Abnahme deployen. A hat keinen Deploy ausgeführt und `main` nicht verändert.

Keine offenen Implementierungswünsche an B. Eine optionale eigenständige Karte für `get_arnold_stored_data` ist zusätzlicher Umfang und gehört nicht zu A1–A10.
