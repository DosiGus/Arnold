# Arnold: Live-Abnahme und Nutzungstest

Datum: 2. November 2026. Ausschließlich erfundene Trainingsdaten. Dieser Teil dokumentiert zunächst die Abnahme vor der Google-Freigabe. **Aktueller Gesamtstand:** Google ist verbunden; sechs Trainingstage mit 26 eindeutigen Satz-IDs wurden erfasst. Fünf Einheiten sind abgeschlossen, ein dauerhaft offener Abschluss sperrt weitere Workout- und Planänderungen. Der Logger benötigt etwa 13–14 Sekunden pro Satz. Vollständige Ergebnisse, Ursachen und Prioritäten stehen in der [Fortsetzung des Live-Tests](FORTSETZUNG.md).

## Veröffentlichung

- GitHub-Commit: `1890d5ee2b092fe0660d177f3b9b02ba4ed1527c`.
- Ergänzende Planreferenz-Korrektur: `689c21b2bcaf93f22a93b84655dff31f0f94f699`; auch deren komplette GitHub-CI ist erfolgreich: https://github.com/DosiGus/Arnold/actions/runs/41467624633.
- Abschließend live: `arnold-00013-7wj`, 100 % Traffic, Health bestätigt `689c21b…`, geschütztes MCP weiterhin 401 ohne Token. Dieselbe bestehende Sitzung zeigt nach Neuladen jetzt korrekt den Ganzkörperplan mit A/B/C und jeweils sechs Übungen.
- GitHub-CI: https://github.com/DosiGus/Arnold/actions/runs/41462766240 — erfolgreich, einschließlich Browsertests.
- Erste Veröffentlichung: `arnold-00012-xn4` mit 100 % Traffic; anschließend durch `arnold-00013-7wj` abgelöst. Beide Health-/Auth-Prüfungen waren erfolgreich. Vorherige Revision und Traffic sind in `before-release.json` gesichert.
- Ausgangszustand: leere Willkommenssitzung, keine Antworten, Pläne, Workouts oder Sätze; keine persönliche Google-Tabelle. Daher kein zusätzlicher Reset vor dem Test.

## Methode

Reale Chrome-/ChatGPT-Oberfläche; Benutzeraktionen über Browsersteuerung. Server-Logs und Code dienen der Diagnose, ersetzen keine erfolgreichen UI-Schritte. Klickmessungen beginnen unmittelbar vor der Aktion und enden bei sichtbarer Folgeüberschrift. Sie enthalten Automationsaufwand und sind keine instrumentierten Paint-Zeitstempel.

## Geplanter Umfang

1. Erster App-Aufruf, Willkommenswahl, fünf Fragenwechsel, Speicherung, Reload, Planvorschlag und Bestätigung.
2. Persönliche Trackerdatei und Dashboard.
3. Sechs synthetische Trainingstage: 26., 28., 30. und 31. Oktober sowie 1. und 2. November 2026.
4. Training im Dashboard und im Chat; Gewichte ändern; abgeschlossene Einträge korrigieren; Historie und Fortschritt abgleichen.
5. Übung austauschen; Plan auf Ganzkörper umstellen; unveränderte historische Planreferenzen prüfen.

Jeder Teil wird als bestanden, fehlerhaft oder konkret blockiert ausgewiesen. Noch nicht durchgeführte Schritte gelten nicht als bestanden.

## Bisher tatsächlich geprüft

| Prüfschritt                                   | Ergebnis                                                                                                                                                                                                                |
| --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Neuer Chat, erster App-Aufruf                 | Fehler: Host zeigt nach leerem Frame „Arnold konnte nicht angezeigt werden“.                                                                                                                                            |
| Erneut versuchen                              | Willkommen nach 453 ms sichtbar.                                                                                                                                                                                        |
| Willkommen → optionale Angaben                | 304 ms.                                                                                                                                                                                                                 |
| Optionale persönliche Angaben überspringen    | 305 ms.                                                                                                                                                                                                                 |
| Ziel → Erfahrung                              | 296 ms.                                                                                                                                                                                                                 |
| Erfahrung → Trainingstage                     | 297 ms.                                                                                                                                                                                                                 |
| Trainingstage → Dauer                         | 303 ms.                                                                                                                                                                                                                 |
| Dauer → Ort                                   | 293 ms.                                                                                                                                                                                                                 |
| Ort → Zusammenfassung                         | Zuerst 2.213 ms; gezielte Wiederholung 322 ms. Ausreißer bleibt erhalten.                                                                                                                                               |
| Freiwillige Wünsche                           | Push/Pull/Beine gewählt; andere freiwillige Angaben übersprungen.                                                                                                                                                       |
| Reload                                        | Zunächst alter Willkommensstand aus Chat-Payload sichtbar, danach korrekte Zusammenfassung durch Serverabgleich. Antworten erhalten.                                                                                    |
| Plan erzeugen                                 | Nach zusätzlicher Chat-Bestätigung erfolgreich.                                                                                                                                                                         |
| Automatische Plananzeige                      | Bereits geöffnete Karte wechselt ohne manuelle Suche zum Vorschlag.                                                                                                                                                     |
| Vollständiger Planeditor                      | Drei Einheiten, 16 Übungen, Satz-/Wiederholungsziele und Pausen vorhanden; keine erfundenen Zielgewichte.                                                                                                               |
| Plan bestätigen                               | Erfolgreich bis Google-Schritt; noch keine Aktivierung/Datei.                                                                                                                                                           |
| Google-Anmeldung                              | 403 access_denied: Konto ist kein freigeschalteter Testnutzer. Console bestätigt 0 Testnutzer.                                                                                                                          |
| Abschluss ohne Google                         | Kein falscher Erfolg; jedoch unzutreffend „Freigabe ist abgelaufen“.                                                                                                                                                    |
| Übung per Chat austauschen                    | Schrägbankdrücken → Brustpresse, 3 × 8–12, 90 s. Erfolgreich; alte Planbestätigung zurückgenommen, Entwurf bleibt inaktiv. Host meldet 1 Min. 8 Sek.                                                                    |
| Neuer Ganzkörperentwurf per Chat              | Erzeugt und strukturell geprüft, 57 Sekunden laut Host. Zunächst alter PPL-Plan in Einrichtung; nach Korrektur richtige Vorschau, vollständiger Editor und erfolgreiche Bestätigung genau des neuen Plans live geprüft. |
| Dashboard / sechs Trainingstage / Korrekturen | Noch blockiert durch fehlende Google-Testfreigabe.                                                                                                                                                                      |

Testchat: https://chatgpt.com/c/6ae8a142-c470-83ed-a0ae-f617aac2c657. Chrome, vorhandene Anmeldung, ChatGPT Work; Modellanzeige GPT-6.1 Sol / Gering. Kein kontrollierter Modellvergleich.

Die fünf erstmaligen Pflichtfragenwechsel haben einen Median von 297 ms, einen Maximalwert von 2.213 ms und einen Mittelwert von 680 ms. Vier davon liegen bei 293–303 ms; der wiederholte letzte Wechsel bei 322 ms. Gegenüber den vorher wiederholt beobachteten 4,2–5,4 Sekunden ist die normale Navigation deutlich verbessert. Der einzelne Ausreißer beweist weder eine verbliebene Netzwerksperre noch deren Abwesenheit. Der Codepfad `saveProfile` stellt lokal in den Puffer; die vier schnellen Wechsel zeigen bereits, dass die Cloud-Bestätigung keine generelle Voraussetzung mehr ist.

## Befunde, Ursachen und Vorschläge

| Priorität | Problem                                                          | Aufwand / nächster Schritt                                                    |
| --------- | ---------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| P1        | Neuer Plan wird durch alte Bestätigung verdeckt                  | Korrigiert, vollständig in CI geprüft und richtige Vorschau live verifiziert. |
| P1        | Google-OAuth-Testkonto fehlt                                     | 10–20 Minuten nach gezielter Freigabe.                                        |
| P1        | Erste App-Karte scheitert                                        | 0,5–2 Tage Eingrenzung; Hostabhängigkeit offen.                               |
| P1        | 38 GCS-Drosselungsereignisse im Identitätspfad                   | 0,5–1 Tag für gedrosselte Metadaten-Schreibvorgänge.                          |
| P2        | Erstverbindung fälschlich als abgelaufen dargestellt             | 0,5–1 Tag, Fehlerzustände und Wiederaufnahme trennen.                         |
| P2        | Zusätzliche Rückfrage nach Planerstellungsbutton                 | 0,5–1 Tag für Übergabe und kontrollierte Host-Abnahme.                        |
| P2        | Planfreigabe vor sichtbarer Übungsliste                          | Etwa 0,5 Tag für lesbare Prüfung mit klarer finaler Aktion.                   |
| P2        | „Fehlt noch“ trotz lokaler Auswahl                               | Etwa 0,25 Tag für eingabebezogene Validierung.                                |
| P2        | Editor spricht vor Google-Schritt bereits von Aktivierung        | Unter 0,25 Tag für korrekte, kontextabhängige Texte.                          |
| P2        | Beim Reload kurz alter Willkommensstand als gespeichert sichtbar | Etwa 0,5 Tag für klaren Revalidierungszustand und Wiederaufnahmeprüfung.      |

Aufwände sind Implementierungsschätzungen einschließlich gezielter Tests, keine verbindlichen Zusagen. P1 bedeutet in diesem Bericht: blockiert oder gefährdet einen wesentlichen Produktablauf vor einer breiteren Freigabe; P2: funktionaler Umweg oder deutliches Verständlichkeitsproblem.

### P1 – Neuer Plan wird von alter Bestätigungsreferenz verdeckt

**Nachweis:** Chat und `get_training_plan` liefern einen neuen Ganzkörperentwurf. `get_onboarding_plan` und Einrichtungskarte liefern weiterhin PPL. Gespeichert sind Profil `full_body`, neuer `plan_draft_reference` auf Ganzkörper (Revision 1), daneben eine historische `confirmed_plan_reference` auf PPL (früher bestätigt auf Revision 1, inzwischen Revision 3). Beide Pläne sind Entwürfe; kein Workout/kein Satz vorhanden. Die Tool-Logs bestätigen, dass das Modell den richtigen Weg `update_onboarding_profile` → `get_onboarding_brief` → `submit_onboarding_plan_proposal` gewählt hat.

**Ursache:** `OnboardingService.referencedPlan` bevorzugt `confirmed_plan_reference` vor `plan_draft_reference`. `REVISE_PLAN` behält die frühere Bestätigung bewusst für die Historie. Ein späterer neuer Vorschlag aktualisiert die Draft-Referenz, wird durch die alte Referenz bei Anzeige und Prüfung aber verdeckt. Der gleiche Code ist bereits im Commit vor dem Latenz-Patch vorhanden. Das ist daher keine durch den Profilpuffer eingeführte Regression.

**Korrektur:** Während der Einrichtung die aktuelle Draft-Referenz verwenden; bei abgeschlossener Einrichtung weiterhin den freigegebenen Plan. Zusätzlich beim Google-Handoff Plan-ID und Revision vergleichen. Historische Bestätigung erhalten, aber niemals als aktuelle Freigabe einer anderen Planversion behandeln.

**Dateien:** `src/server/onboarding/service.ts`, `tests/onboarding-service.test.ts`. **Aufwand:** Kleine gezielte Korrektur plus vollständige Releaseprüfungen; umgesetzt und live. Der neue Regressionstest schlägt auf dem vorherigen Code mit falscher Plan-ID fehl und besteht nach der Korrektur, einschließlich zweier verschiedener Pläne mit identischer Zeilenrevision 1, Ablehnung der alten Bestätigung und erfolgreicher Freigabe genau des neuen Plans. Build und alle 1.433 Unit-/Integrationstests bestanden; komplette Browser-CI ebenfalls grün. Live zeigt dieselbe Sitzung den neuen Ganzkörperplan und bestätigt ihn erfolgreich. Readback um 15:19 UTC: aktuelle Draft-ID und bestätigte Plan-ID sind identisch, Status AWAITING_GOOGLE_CONNECTION und Handoff ready_for_google_connection. **Relevanz:** hoch; falscher Plan in der Freigabeansicht blockiert oder verwirrt die Einrichtung. Eine tatsächliche falsche Google-Aktivierung wurde nicht beobachtet.

### P1 – Google-Testkonto nicht freigeschaltet

**Nachweis:** Google verweigert den Zugriff mit 403 und dem Hinweis auf nicht vom Entwickler freigegebene Tester. Google Auth Platform → Audience im richtigen Projekt zeigt Status Testing, External und 0 Testnutzer. Eine persönliche Trainingsdatei existiert zu diesem Zeitpunkt weiterhin nicht.

**Ursache:** OAuth-Konfiguration, keine ChatGPT-Modelllatenz und kein Fehler im Profilpuffer. Die offizielle Anleitung verlangt bei External/Testing das Eintragen der Testnutzer: https://developers.google.com/workspace/guides/configure-oauth-consent.

**Lösung:** Genau das vorgesehene Testkonto in Audience freigeben, danach den regulären Google-Consent und die Dateiprovisionierung vollständig abnehmen. Kein Wechsel in öffentliche Produktion nötig. Die neue Zugriffsfreigabe ist zur Entscheidung vorbereitet, aber noch nicht gespeichert.

**Dateien:** Keine Laufzeitdatei für die unmittelbare Entsperrung. Release-Checkliste in `docs/BETRIEB.md` um Testnutzer-/Consent-Abnahme ergänzen. **Aufwand:** ca. 10–20 Minuten einschließlich erneuter Anmeldung, sofern die Freigabe erteilt wird. **Relevanz:** blockiert alle neuen Tester und damit die komplette nachfolgende Produktabnahme.

### P1 – Erster App-Aufruf weiterhin unzuverlässig

**Nachweis:** Frischer Aufruf schlägt fehl; nach Retry ist dieselbe Karte in 453 ms bereit. Auch die später vom Chat neu geöffnete zweite Einrichtungskarte scheitert. Die bereits laufende erste Karte kann währenddessen den fertigen Plan anzeigen. Das Servertool `show_arnold_onboarding` ist beim ersten Aufruf erfolgreich (493 ms).

**Ursache:** Noch nicht isoliert. Die neue Ressourcenadresse v2 behebt den Fehler nicht. Erfolgreiches Servertool plus erfolgreicher Retry grenzen auf Ressourcen-/Host-/Bridge-Initialisierung ein; sie beweisen keinen bestimmten CSP- oder OpenAI-Fehler. Die auslesbare Konsole liefert nur allgemeine Statsig-Warnungen, keinen passenden Stacktrace.

**Lösung:** Releasekennung sowie Zeitpunkte für HTML-Start, Bundle-Start, Bridge-Verbindung, erstes Toolresult und ersten sichtbaren Render erfassen; mit Ressourcenanfrage und Hostfehler korrelieren. Frischen Inline-Aufruf und App-Bereich getrennt reproduzieren. Eine sichere, sichtbare Rückfallebene und Wiederholung anbieten. Nicht pauschal CSP lockern.

**Dateien:** `src/server/mcp-onboarding.ts` (Ressource/Metadaten), `src/ui/client.ts` (Bridge-Verbindung), `src/ui/main.tsx` (Boot/Fehleransicht), ggf. Dashboard-Ressource in `src/server/mcp-arnold.ts`. **Aufwand:** 0,5–2 Tage zur Eingrenzung; eine Hostursache kann länger dauern. **Relevanz:** zentraler Erstnutzer-Abbruch, vor öffentlicher Freigabe lösen.

### P1 – Nachgewiesenes GCS-Schreiblimit im Identitätspfad

**Nachweis:** Im bisherigen Durchlauf sind **38 GCSFuse-Drosselungsereignisse mit 429 rateLimitExceeded** belegt, alle auf `connected/identities.json` (14:41:23–14:56:48 UTC). Sie treten sowohl bei der Tool-Aktualisierung als auch im Onboarding-/Planablauf auf. Kein Nachweis eines verlorenen Schreibvorgangs; die Retries selbst sind belegt. Die Anzahl bezeichnet Logereignisse, nicht 38 endgültig fehlgeschlagene Nutzeraktionen.

**Ursache im Code:** `src/server/auth/identity.ts:102` verwendet beim Auflösen `register`. `src/server/identity/repository.ts:133` aktualisiert bei vorhandenen Nutzern jedes Mal `last_seen_at_utc`; `FileIdentityRepository.mutate/persist` schreibt die gesamte Datei über temporäre Datei und Rename. Dadurch wird ein gemeinsames GCS-Objekt bei häufigen Anfragen immer wieder mutiert. Die globale Warteschlange kann weitere Nutzer mitbremsen.

**Lösung:** Vorhandene Identität ohne Schreibvorgang auflösen; nur unbekannte Identitäten atomar registrieren. Last-seen-Aktualisierung gesondert und gedrosselt bündeln. Kontostatus und Autorisierung weiterhin bei jedem Aufruf korrekt prüfen; kein langlebiger Berechtigungs-Cache als Abkürzung. Für mehrere Instanzen ist anschließend ein geeigneter transaktionaler Identitätsspeicher nötig; die aktuelle Datei bleibt bewusst Einzelserver-Entwicklung.

**Dateien:** `src/server/auth/identity.ts`, `src/server/identity/repository.ts`, aufrufender Pfad in `src/server/http.ts` / `src/server/auth/tool-guard.ts`, zugehörige Identitäts-/Parallelitätstests. **Aufwand:** 0,5–1 Tag für weniger unnötige Schreibvorgänge; Speichermigration gesondert. **Relevanz:** reale Drosselung schon bei einem Testnutzer; sinnvoll vor größerem Stresstest.

### P2 – Fehlende Erstverbindung wird als abgelaufene Freigabe dargestellt

**Nachweis:** Nach dem externen 403 führt „Einrichtung prüfen und abschließen“ zu „Google neu verbinden – Deine Google-Freigabe ist abgelaufen“. Dieses Konto war nie verbunden. Der angebotene Wiederverbindungsweg führt anschließend erst zur Meldung „Deine Einrichtung ist noch offen“.

**Ursache:** `src/server/google/reauth.ts:19` fasst GOOGLE_NOT_CONNECTED und GOOGLE_REAUTH_REQUIRED zusammen. `src/shared/write-recovery.ts:66` ordnet beiden dieselbe Wiederverbindung zu; `src/ui/components/recovery.tsx:94` zeigt stets die Ablaufmeldung. Der Wiederverbindungsbutton nutzt `connectGoogle(true)` ohne Einrichtungssitzung, obwohl beim Erstnutzer die bestätigte Einrichtung erforderlich ist.

**Lösung:** Erstverbindung, verweigerte/abgebrochene Anmeldung und widerrufene/abgelaufene bestehende Verbindung unterscheiden. Beim Erstnutzer in der passenden Einrichtung mit Claim bleiben; erneute Planprüfung nach Planänderungen respektieren. Erst nach bestätigter Google-Verbindung „Einrichtung abschließen“ anbieten. Ladezustand und Doppelklickschutz auch für connectGoogle/finishSetup ergänzen.

**Dateien:** `src/server/google/reauth.ts`, `src/shared/write-recovery.ts`, `src/server/connected/mcp-google.ts`, `src/ui/components/recovery.tsx`, `src/ui/hooks/useOnboarding.ts:501`, `src/ui/views/OnboardingView.tsx`. **Aufwand:** 0,5–1 Tag mit Browserprüfung für Ablehnung, Abbruch und echte Reautorisierung. **Relevanz:** verwirrt neue Nutzer und verlängert die Wiederaufnahme.

### P2 – Plananforderung verlangt eine zusätzliche Chat-Bestätigung

**Nachweis:** Nach Klick auf „Plan erstellen“ wird die richtige Nachricht im Chat sichtbar. Das Modell fragt trotzdem noch einmal nach und begründet es mit der Herkunft aus dem Widget. Erst nach einer direkt getippten Bestätigung erzeugt es den Entwurf. Der spätere Übungsaustausch benötigt laut Host 68 Sekunden bei drei bis dahin sichtbaren Servertools von 251, 896 und 1.422 ms. Kein kontrollierter Modellvergleich; die gesamte Differenz darf nicht nur dem Modell zugeschrieben werden.

**Ursache:** Der Button setzt serverseitig WAITING_FOR_PLAN_PROPOSAL und sendet über `App.sendMessage` eine User-Nachricht. Dass dieser Host/Modellpfad sie nochmals bestätigen lässt, ist beobachtet; eine allgemeingültige Prompt- oder Plattformursache ist damit nicht bewiesen. Zusätzliche sequentielle Modell-/Toolrunden verstärken die wahrgenommene Dauer.

**Lösung:** Übergabe als geprüften serverseitigen Auftrag mit bereits vorhandener expliziter Buttonentscheidung beschreiben und im Host abnehmen; Freigabe des fertigen Plans weiterhin separat. Falls der Host den Widget-Auftrag grundsätzlich nicht als Nutzerauftrag akzeptiert, klare direkte Chat-Aktion statt widersprüchlicher Wartekarte anbieten. Vor Modellwahl- oder Infrastrukturänderung denselben Ablauf kontrolliert messen. Kleine Planänderungen nach frischem Kontext möglichst in einer atomaren Änderung abarbeiten.

**Dateien:** `src/ui/hooks/useOnboarding.ts:345`, `src/ui/client.ts:311`, `src/server/mcp-onboarding.ts` (Brief/Beschreibungen/Zustandszusammenfassung), `src/server/auth/confirmation-rules.ts`. **Aufwand:** ca. 0,5–1 Tag für Ablaufverbesserung und Hostabnahme; Plattformgrenzen gesondert klären. **Relevanz:** vermeidbare Rückfragen und lange gefühlte Ladephasen.

### P2 – Planprüfung und Validierungstexte bleiben widersprüchlich

Die Vorschau zeigt Einheiten und Übungsanzahlen; die tatsächlichen Übungen und Ziele stehen erst im Editor. „Plan bestätigen“ erscheint zweimal hintereinander. Bei gewähltem Ziel/Erfahrung erscheint vor „Weiter“ noch „fehlt noch“. Dies ist im neuen Live-Durchlauf wieder beobachtet, unabhängig vom schnellen Hintergrundpuffer.

**Ursache/Lösung:** `src/ui/components/onboarding.tsx:657` zeigt bestätigte Servervalidierung neben einer noch nicht abgeschickten lokalen Auswahl. Auswahl anhand des aktuellen Eingabefelds prüfen bzw. Fehler erst nach fehlgeschlagenem Weiterklick zeigen. Planvorschau in `src/ui/views/OnboardingView.tsx` um sichtbare Übungen/Ziele ergänzen und finale Freigabe klar benennen. Der Editortext „Wird erst mit deiner Bestätigung aktiv“ ist beim Onboarding zu früh: Aktivierung folgt erst mit Google-Dateiprovisionierung.

**Dateien:** `src/ui/components/onboarding.tsx`, `src/ui/views/OnboardingView.tsx`, `src/ui/views/TrainingPlanEditorView.tsx`. **Aufwand:** 0,5–1 Tag. **Relevanz:** mittlere technische, hohe Verständlichkeitsrelevanz im ersten Produktkontakt.

### P2 – Reload zeigt zunächst einen alten Stand als bereit

**Nachweis:** Nach Reload erscheint zuerst die ursprüngliche Willkommenskarte mit „Einrichtungsstand … gespeichert“, erst nach dem Serverabgleich die bereits vollständig ausgefüllte Zusammenfassung. Die Antworten gehen nicht verloren; die Zwischenanzeige ist irreführend.

**Ursache:** `src/ui/client.ts` veröffentlicht den wiedergegebenen Onboarding-Payload zunächst mit stale=true. `src/ui/main.tsx` übergibt diesen Zustand an das Dashboard, aber nicht an die Onboarding-Ansicht. `useOnboarding` prüft nach dem Mount im Hintergrund erneut. Die Zwischenansicht ist schon als READY bedienbar; ein dadurch ausgelöster Revisionskonflikt wurde in diesem Durchlauf nicht provoziert und ist daher nur ein zusätzlich zu prüfender Fall.

**Lösung:** Beim Wiederöffnen den Revalidierungszustand sichtbar und eindeutig machen; lokale Wiederaufnahme und ausstehende Originalaufträge erhalten. Keine alte Willkommensansicht als bestätigten aktuellen Stand anbieten. **Dateien:** `src/ui/client.ts`, `src/ui/main.tsx`, `src/ui/hooks/useOnboarding.ts`, `src/ui/views/OnboardingView.tsx`. **Aufwand:** ca. 0,5 Tag. **Relevanz:** besonders bei erneut geöffneten Chats und fortgesetzter Einrichtung.

## Noch keine Aussage möglich

Die sechs Trainingstage, Gewichtskorrekturen, rückdatierte Workouts, Wochenzahlen, Fortschritt und historische Planreferenzen sind bisher **nicht live abgenommen**. Die 1.433 Vitest- und 91 Browserprüfungen ersetzen diese fehlende reale Google-/ChatGPT-Strecke nicht. src/server/connected/runtime.ts verweigert Workout-Schreibvorgänge vor der persönlichen Dateieinrichtung ausdrücklich. Mögliche Optimierungen der Google-Sheets-Lesewege aus dem früheren Performancebericht bleiben zunächst Codebefunde, keine neu gemessene Dashboard-Diagnose.

## Ergänzende Laufzeiten

Im Zeitfenster 14:42–14:58 UTC wurden 81 erfolgreiche HTTP-POST-Anfragen dieser Service-Revision erfasst: Median 516 ms, p95 (unterer Stichprobenrang) 2.364 ms, Maximum 2.928 ms. Das umfasst auch Protokoll-/Host-Anfragen und lässt sich nicht eins zu eins mit einzelnen Toolaufrufen gleichsetzen. Browser, Bridge-Weiterleitung und Modelllaufzeit sind in diesen Cloud-HTTP-Werten nicht enthalten. Der Befund spricht gegen die Annahme, sämtliche beobachtete Wartezeit sei reine Server-Rechenzeit; er entlastet die nachgewiesenen Identitätsschreibvorgänge nicht.

Das zweite Deployment wurde zunächst durch 429 auf einem Leseaufruf der Cloud Resource Manager-Verwaltungs-API gestoppt. Nach dem Kontingentfenster war derselbe unveränderte Aufruf wieder erfolgreich; das bestehende Deployment-Skript wurde erneut gestartet. Keine Kontingente wurden erhöht, keine weiteren APIs dafür aktiviert. Dieser Verwaltungsfehler ist vom GCS-Laufzeitbefund getrennt.

## Teststand vor der Fortsetzung (15:19 UTC)

Am Ende bestehen zwei synthetische Planentwürfe (alter PPL-Plan, neuer bestätigter Ganzkörperplan), keine persönliche Google-Datei, kein verbundenes Google-Konto, null Workouts und null Sätze. Der Anfangsreset wurde nicht wiederholt, damit dieser konkret geprüfte Stand fortgesetzt werden kann. Es wurden keine zusätzlichen OAuth-Testnutzer gespeichert und keine Google-Dateirechte erteilt. Die Freigabeentscheidung des Nutzers ist ausstehend. Screenshots mit der persönlichen Browserumgebung bleiben ausschließlich lokal unter `data/live-audit-2026-11-02/`; die versionierten Nachweise enthalten keine Tokens oder persönlichen Trainingsdaten.

## Nachweise

- [Klickmessungen](timings.json) und [Zusammenfassung](latency-summary.json).
- [Toolzeiten während des Onboardings](onboarding-tools.json), [Übungsaustausch](plan-edit-logs.json), [Ganzkörperwechsel](fullbody-tools.json), [Live-Prüfung nach der Korrektur](final-release-tools.json).
- [Planreferenzen beim Fehler](plan-reference-check.json) und [abschließender Testzustand](final-state.json).
- [HTTP-Zusammenfassung](http-summary.json), [GCS-Drosselungen](storage-throttles-summary.json), [finaler Trafficnachweis](final-release.json).
