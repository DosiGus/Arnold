# Arnold – vollständiger Checklisten-Audit

Stand: 31. Oktober 2026 · 112 von 112 Originalpunkten geprüft · Bericht für Produktentscheidung und Entwicklung.

Geprüfte Codebasis: main auf Commit [2c5ad57](https://github.com/DosiGus/Arnold/commit/2c5ad5716cc47eefddd1859e2fb8221e90cea900).

## Das Ergebnis für dich

Arnold besitzt einen gut ausgebauten Krafttrainingskern: Training und Sätze, versionierte Pläne, Kennzahlen, Onboarding, Google-Verbindung und persönliche Tabellen sind technisch vorhanden. Die Berechnungsschicht ist einer der stärksten Bereiche. Das Gesamtprodukt erfüllt die ursprüngliche Mission aber noch nicht vollständig: Körpergewicht und Kardio fehlen als eigene Produktbereiche, Bezahlung/Lizenzen sind nicht gebaut und öffentliche Veröffentlichung, Datenschutzunterlagen sowie Betriebssicherung haben erhebliche offene Teile.

Die Prozentwerte unten sind begründete Reifegrade je Anforderung. Sie sind keine Messung verbrauchter Entwicklungszeit und kein pauschaler Fertigstellungsgrad des Produkts. Ein fertiger Wochenzähler und ein fehlender Löschprozess wiegen für eine Kundenfreigabe nicht gleich viel.

## Was jetzt zuerst entschieden oder behoben werden sollte

1. **Datenschutzversprechen präzisieren – 09.01, 09.02, 09.07 und 09.08.** Die Haupttabelle gehört dem Nutzer. Trotzdem speichert der Betreiber in Operationsjournal und Audit Kopien von Trainingsänderungen. Google trennen entfernt diese Dateien nicht. Die strenge ursprüngliche Vorgabe wird damit nicht erfüllt. Das ist eine Architekturentscheidung mit Aufbewahrungs- und Löschbedarf, kein bloßer Formulierungsfehler.
2. **Neu nachgewiesene Loglücke schließen – 09.05.** Ein lokaler, vollständig synthetischer Test zeigt, dass die allgemeine JSON-Fehlerausgabe Fragmente der Anfrage ins Server-Log übernimmt. Die Antwort an den Client bleibt korrekt allgemein; der Betreiberlogpfad ist das Problem. Es wurde kein Vorfall mit echten Daten nachgewiesen.
3. **V1-Umfang verbindlich festlegen – 01.03, 02.02, 03.07, 04.07 und 05.08.** Körpergewichtsübungen sind unterstützt, fortlaufende Körpergewichtsmessungen und Kardio dagegen nicht. Diese ursprünglichen Anforderungen dürfen nur durch eine ausdrückliche Produktentscheidung verschoben werden.
4. **Geschäftsmodell vor Payment-Implementierung konkretisieren – 08.01 bis 08.09.** Anmeldung und technische Rechte sind keine bezahlte Lizenz. Der geplante externe Personal-Training-Dienst muss so beschrieben sein, dass seine Plattformzulässigkeit und der konkrete Freischaltablauf geprüft werden können. [Aktuelle OpenAI-Richtlinie](https://developers.openai.com/plugins/plugin-guidelines).
5. **Weitere Stabilisierung gezielt abgleichen – 03.08 bis 03.10, 05.05, 05.07 und 06.11.** Die drei zuvor reproduzierten Fehler sind auf main geschlossen. Der übrige S001-Branch ist damit nicht vollständig übernommen: gemeinsame Recovery-Regeln, Tabellenkapazität und einige Darstellungs-/Lebenszyklusdetails bleiben offen.
6. **Wochenziel verständlich und einheitlich machen – 05.03.** Trainingstage und Einheiten sind in der Engine getrennt. Die Wochenkarte setzt Einheiten mit einem Planfeld für Tage ins Verhältnis und markiert Wochentage anhand einer begrenzten Liste letzter Trainings. Das kann eine missverständliche Übersicht ergeben.
7. **Vor öffentlichem Kundenzugang Release-Gates abarbeiten – 07.04 bis 07.09, 09 und 11.** Dazu gehören Betrieb/Restore, Löschung, belastbare Veröffentlichungsunterlagen und eine echte Abnahme des vorgesehenen Releases.

## Welche Version dieser Bericht bewertet

- **Lokal und GitHub:** main = 2c5ad5716cc47eefddd1859e2fb8221e90cea900. Die drei kleinen Schutzkorrekturen sind enthalten.
- **Live auf Cloud Run:** arnold-00010-zn5, 100 % Traffic, Connected-Profil mit Google und dauerhaftem Zustand. Sein Quellarchiv entsprach bei der vorherigen Prüfung bytegenau dem Laufzeit-/Build-Code von 5eecc19 beziehungsweise b931d79.
- **Bewusst noch nicht live:** die jüngere Kartenoberfläche, Chat-Brücke und die drei Schutzkorrekturen. Der Auftrag enthielt ausdrücklich kein Deployment.
- **Privates Plugin:** Ein privates Arnold-Testpaket wurde unabhängig gelesen. Es ist ein zusätzlicher Entwicklungsnachweis. Seine App-Referenz wurde nicht mit der konkreten Custom-MCP-Konfiguration in deinem ChatGPT-Konto gleichgesetzt.
- **Echte Nutzung:** Du berichtest von bereits erfolgreich getesteter Google-/ChatGPT-Verbindung. Dieser Audit hat keine neue persönliche Google-Freigabe ausgeführt und keine echten Trainingsdateien gelesen.

## Wie die Bewertung funktioniert

| Fortschritt | Bedeutung |
| --- | --- |
| 100 % | Das konkret benannte Kriterium ist im vorhandenen Funktionsumfang implementiert beziehungsweise nachgewiesen. Relevante vorhandene Tests bestehen. Das ist keine Garantie, dass es nie weitere Fehler gibt, und keine automatische Produktionsfreigabe. |
| 75 % | Wesentliche Umsetzung vorhanden; ein ausdrücklich benannter Bestandteil, Grenzfall oder Abnahmenachweis fehlt. |
| 50 % | Ein erheblicher Teil ist gebaut, aber ein weiterer wesentlicher Teil der Anforderung fehlt. |
| 25 % | Grundlage, Teilmechanismus oder Planung vorhanden; die Anforderung ist überwiegend offen. |
| 0 % | Keine Umsetzung oder kein erforderliches lieferbares Ergebnis in den geprüften Projekt-/Paketunterlagen gefunden. Bei externen Unterlagen bedeutet das nicht automatisch, dass du außerhalb des Projekts nie daran gearbeitet hast. |
| Extern offen | Ohne Zugang zum konkreten Nachweis ist keine seriöse Prozentzahl möglich. Diese Fälle sind ausdrücklich benannt. |

Bei zusammengesetzten Anforderungen wird der vollständige Originalpunkt bewertet. Bei 02.08 genügt beispielsweise die tatsächlich eingeführte Schemaversion; ein universeller Migrationsdienst gehört zur separaten Aufgabe 10.09. Bei 06.09 wird die funktionale persönliche Dateierstellung anerkannt und die bewusste Alternative zur Masterkopie erklärt.

## Welche Nachweise verwendet wurden

- Quellcode, Datenverträge, UI-Pfade und Tests des genannten Commits.
- Vorheriger GitHub-/Worktree-/Cloud-Abgleich einschließlich bytegenauem Vergleich des aktiven Build-Quellarchivs.
- Der vollständige erfolgreiche Check nach den drei Fixes: **1.261 Unit-/Integrationstests in 59 Dateien und 52 Chromium-Browser-Tests**, Build, Typecheck und Formatprüfung. Diese unveränderte Codebasis wurde für den Audit nicht nochmals grundlos komplett getestet.
- Neue reine Audit-Gegenprobe zur Loglücke, ausschließlich lokal mit erfundenem Text; Beleg log-probe.json.
- Lesender Nachweis der aktivierten Google-APIs und Dateien des privaten Arnold-Plugins.
- Tatsächlich geöffnete aktuelle Primärquellen zu OpenAI-Plugins, Google-OAuth und Datenschutzgrundsätzen.

Eine Testsuite prüft vorgegebene Fälle. Dieser Bericht ist eine anforderungsbezogene Code- und Evidenzprüfung; er behauptet weder eine formale Vollständigkeitsgarantie noch einen durchgeführten Penetrationstest.

## So hängen die Bausteine zusammen

ChatGPT nimmt eine Frage oder Eingabe entgegen und ruft ein eng beschriebenes MCP-Werkzeug auf. Arnold prüft Konto und Rechte, lässt einen Fachdienst arbeiten und liest oder schreibt die persönliche Google-Tabelle. Die Analytics-Schicht berechnet daraus Kennzahlen; React zeigt sie als Karte. WorkOS prüft die Anmeldung bei Arnold, Google erteilt zusätzlich die Dateifreigabe. Ein separater Betreiberzustand speichert Identitätszuordnung, Profile, Tokens, Journale und Audit – diese letzte Ebene ist für die Datenschutzentscheidung besonders wichtig.

## Kurzes Wörterbuch

- **MCP-Werkzeug:** eine genau definierte Aktion, die ChatGPT am Server auslösen darf, zum Beispiel einen Satz speichern.
- **Schema:** verbindliche Struktur und Regeln einer Datei oder Eingabe, etwa erlaubte Spalten und Werte.
- **Revision:** Änderungsnummer. Eine veraltete Nummer verhindert, dass eine neue Änderung übersehen und überschrieben wird.
- **Idempotenz:** derselbe Auftrag mit derselben ID wird nicht zweimal als neue Änderung ausgeführt.
- **Readback:** der Server liest nach dem Schreiben erneut, um das Ergebnis zu bestätigen.
- **Journal / Ledger:** technische Erinnerung an Schreibaufträge. Hier enthält sie auch Trainingsinhalte und ist deshalb nicht datenschutzneutral.
- **Audit:** fachliches Änderungsprotokoll. Das ist etwas anderes als der allgemeine Serverlog mit Fehlermeldungen.
- **Token / Scope:** Zugangsnachweis und darin erlaubte Aktionsarten. Beides beweist keine bezahlte Lizenz.
- **Fixture:** vollständig erfundener Testdatenstand.
- **RIR:** verbleibende Wiederholungen im Tank. **RPE:** eine andere Skala der empfundenen Anstrengung. Die aktuelle Karte bietet vereinfachtes RIR an.
- **Persistenz versus Backup:** Daten überstehen einen Neustart; ein Backup muss auch nach Verlust oder Beschädigung des ursprünglichen Speichers helfen.


## Übersicht der 112 Einzelbewertungen

41 erfüllt, 54 teilweise, 12 ohne Umsetzung/Liefernachweis, 5 extern nicht bewertbar.

| Bereich | Punkte | 100 % | Teilweise | 0 % / kein Liefernachweis | Extern offen |
| --- | ---: | ---: | ---: | ---: | ---: |
| [01 · Produktdefinition](#bereich-01) | 6 | 1 | 5 | 0 | 0 |
| [02 · Google-Sheets-Datenbank](#bereich-02) | 9 | 6 | 3 | 0 | 0 |
| [03 · MCP-Server – Grundfunktionen](#bereich-03) | 11 | 7 | 3 | 1 | 0 |
| [04 · Berechnungs-Engine](#bereich-04) | 9 | 8 | 0 | 1 | 0 |
| [05 · MCP Apps UI – Frontend](#bereich-05) | 12 | 3 | 8 | 1 | 0 |
| [06 · Google OAuth und Integration](#bereich-06) | 13 | 7 | 6 | 0 | 0 |
| [07 · Hosting und Infrastruktur](#bereich-07) | 10 | 2 | 7 | 0 | 1 |
| [08 · Kundenkonten und Bezahlung](#bereich-08) | 10 | 1 | 4 | 4 | 1 |
| [09 · Sicherheit und Datenschutz](#bereich-09) | 9 | 3 | 5 | 1 | 0 |
| [10 · Qualitätssicherung](#bereich-10) | 10 | 3 | 7 | 0 | 0 |
| [11 · OpenAI-Veröffentlichung](#bereich-11) | 13 | 0 | 6 | 4 | 3 |

Die Originalformulierungen stehen vollständig und unverändert als Überschriften. Die IDs 01.01 bis 11.13 wurden für eindeutige Verweise ergänzt.


<a id="bereich-01"></a>

## 01 · Produktdefinition


### 01.01 · Zielgruppe festlegen: zunächst trainierende Einzelpersonen und Personal-Training-Kunden

**Fortschritt: 50 % · Teilweise umgesetzt.**

**Einordnung:** Der einzelne Trainierende ist klar erkennbar; Personal-Training-Kunden sind noch keine eigene Produktgruppe.

**So ist es heute umgesetzt:** Arnold ist als persönlicher Trainingsbegleiter beschrieben. Die Einrichtung fragt Ziele, Erfahrung und Trainingsmöglichkeiten ab und legt je Konto eine eigene Datei an. Ein Trainerkonto, die Beziehung Trainer–Kunde und ein abgegrenztes Personal-Training-Angebot sind dagegen nicht modelliert.

**Maßgebliche Dateien und ihre Aufgabe:**

- [README.md](/Users/kevingusmao/Desktop/Arnold/README.md:1): Erklärt Produktzweck, Start und Betriebsarten.
- [src/server/onboarding/profile.ts](/Users/kevingusmao/Desktop/Arnold/src/server/onboarding/profile.ts:1): Bereitet Trainingsangaben und offene Fragen für Planvorschläge auf.
- [src/server/identity/repository.ts](/Users/kevingusmao/Desktop/Arnold/src/server/identity/repository.ts:1): Speichert Kontozuordnung und Status ACTIVE/DISABLED; keine Lizenzverwaltung.

**Tests und Nachweis:** Produktbeschreibung, Profilvertrag und Nutzerzuordnung passen zur selbstständigen Nutzung durch Einzelpersonen.

Relevante Tests: [tests/onboarding-profile.test.ts](/Users/kevingusmao/Desktop/Arnold/tests/onboarding-profile.test.ts:1).

**Offen, problematisch oder verbesserbar:** Es fehlt eine verbindliche Zielgruppenbeschreibung mit Nutzungssituation, Kundennutzen und klarer Abgrenzung zur späteren Trainerfunktion.

**Nächster sinnvoller Schritt:** Eine kurze Produktentscheidung festhalten: Wer ist V1-Kunde, welches Problem lösen wir zuerst und welche Trainerfunktionen bleiben später?


### 01.02 · Die wichtigsten Nutzeraktionen beschreiben: Training erfassen, Plan ansehen, Fortschritt verfolgen

**Fortschritt: 100 % · Erfüllt im geprüften Umfang.**

**Einordnung:** Die drei zentralen Nutzeraktionen sind beschrieben und technisch vorhanden.

**So ist es heute umgesetzt:** Die Oberfläche und die Werkzeuge unterstützen Training erfassen, Trainingsplan lesen und bearbeiten sowie Fortschritt ansehen. ChatGPT kann dieselben Dienste auch ohne Oberfläche ansprechen. Die Dateiaufteilung trennt dabei Trainingsspeicherung, Planverwaltung und Auswertung.

**Maßgebliche Dateien und ihre Aufgabe:**

- [README.md](/Users/kevingusmao/Desktop/Arnold/README.md:1): Erklärt Produktzweck, Start und Betriebsarten.
- [src/server/mcp-arnold.ts](/Users/kevingusmao/Desktop/Arnold/src/server/mcp-arnold.ts:1): Registriert Dashboard-, Historien- und Fortschrittswerkzeuge.
- [src/server/mcp-workout.ts](/Users/kevingusmao/Desktop/Arnold/src/server/mcp-workout.ts:1): Registriert Werkzeuge zum Starten, Speichern und Korrigieren von Trainings.
- [src/server/mcp-plan.ts](/Users/kevingusmao/Desktop/Arnold/src/server/mcp-plan.ts:1): Registriert lesende und schreibende Planwerkzeuge.
- [src/ui/ArnoldDashboardApp.tsx](/Users/kevingusmao/Desktop/Arnold/src/ui/ArnoldDashboardApp.tsx:1): Steuert die Kartenansichten und Navigation.

**Tests und Nachweis:** MCP- und Browserprüfungen decken Trainingsstart, Satzspeicherung, Plananzeige und Übungsverlauf ab.

Relevante Tests: [tests/arnold-mcp.test.ts](/Users/kevingusmao/Desktop/Arnold/tests/arnold-mcp.test.ts:1), [tests/workout-mcp.test.ts](/Users/kevingusmao/Desktop/Arnold/tests/workout-mcp.test.ts:1), [tests/plan-mcp.test.ts](/Users/kevingusmao/Desktop/Arnold/tests/plan-mcp.test.ts:1), [tests/e2e/arnold-dashboard.spec.ts](/Users/kevingusmao/Desktop/Arnold/tests/e2e/arnold-dashboard.spec.ts:1), [tests/e2e/workout-logger.spec.ts](/Users/kevingusmao/Desktop/Arnold/tests/e2e/workout-logger.spec.ts:1).

**Offen, problematisch oder verbesserbar:** Im Umfang dieser drei Aktionen ist keine fehlende Grundfunktion nachgewiesen. Körpergewicht und Kardio sind zusätzliche, separat bewertete Anforderungen.

**Nächster sinnvoller Schritt:** Diese drei Aktionen als Kernversprechen der ersten Version beibehalten und für die spätere Beta als Erfolgskriterien verwenden.


### 01.03 · Die Funktionen für Version 1 von späteren Erweiterungen trennen

**Fortschritt: 25 % · Grundlage vorhanden.**

**Einordnung:** Der Code hat einen erkennbaren Schwerpunkt; ein verbindlicher V1-Zuschnitt fehlt.

**So ist es heute umgesetzt:** README und Guide beschreiben den gebauten Krafttrainingskern und einige Grenzen. Sie sind aber keine priorisierte Produkt-Roadmap. Dass Körpergewicht, Kardio, Bezahlung und Trainerzugriff fehlen, ist dadurch weder ausdrücklich als Verschiebung beschlossen noch als offene V1-Arbeit sauber gekennzeichnet.

**Maßgebliche Dateien und ihre Aufgabe:**

- [README.md](/Users/kevingusmao/Desktop/Arnold/README.md:1): Erklärt Produktzweck, Start und Betriebsarten.
- [docs/GUIDE.md](/Users/kevingusmao/Desktop/Arnold/docs/GUIDE.md:1): Dokumentiert Architektur, Datenregeln und bekannte Grenzen.

**Tests und Nachweis:** Aktuelle Dokumentation und tatsächliche Tabellen-/Werkzeugliste wurden mit allen ursprünglichen Checklistenpunkten verglichen.

**Offen, problematisch oder verbesserbar:** Ohne Versionsentscheidung besteht das Risiko, fehlende ursprüngliche Anforderungen nachträglich still als nicht mehr notwendig zu behandeln.

**Nächster sinnvoller Schritt:** V1, spätere Version und bewusst gestrichene Anforderungen schriftlich unterscheiden; Änderungen an der Mission ausdrücklich bestätigen.


### 01.04 · Die vollständige Nutzerreise vom ersten Login bis zum ersten Workout festlegen

**Fortschritt: 75 % · Weitgehend umgesetzt.**

**Einordnung:** Die Nutzerreise funktioniert technisch; die endgültige Produktabnahme ist noch offen.

**So ist es heute umgesetzt:** Der gebaute Weg lautet: WorkOS-Anmeldung, Einrichtung, Arnold-Plan oder eigener Plan, Entwurf prüfen, genaue Revision bestätigen, Google freigeben, persönliche Tabelle anlegen und erstes Training speichern. Einrichtungszustand und Konto sind verbunden, damit ein neuer Chat den Nutzer nicht wieder von vorne fragt.

**Maßgebliche Dateien und ihre Aufgabe:**

- [src/server/onboarding/service.ts](/Users/kevingusmao/Desktop/Arnold/src/server/onboarding/service.ts:1): Gemeinsamer Einrichtungszustand für Chat und Oberfläche.
- [src/ui/views/OnboardingView.tsx](/Users/kevingusmao/Desktop/Arnold/src/ui/views/OnboardingView.tsx:1): Steuert Begrüßung, Profil, Planprüfung und Google-Schritt.
- [src/server/connected/runtime.ts](/Users/kevingusmao/Desktop/Arnold/src/server/connected/runtime.ts:1): Erzeugt und bindet die eigene Trainingsdatei je angemeldetem Nutzer.
- [src/server/onboarding/setup-gate.ts](/Users/kevingusmao/Desktop/Arnold/src/server/onboarding/setup-gate.ts:1): Hält Trainingstools bis zur fertigen Einrichtung geschlossen.

**Tests und Nachweis:** Der vollständige Ablauf wird mit simulierten Anbietern über HTTP/MCP und Chromium geprüft. Du berichtest zusätzlich von echten Google-/ChatGPT-Tests.

Relevante Tests: [tests/onboarding-service.test.ts](/Users/kevingusmao/Desktop/Arnold/tests/onboarding-service.test.ts:1), [tests/onboarding-setup-gate.test.ts](/Users/kevingusmao/Desktop/Arnold/tests/onboarding-setup-gate.test.ts:1), [tests/connected-journey.test.ts](/Users/kevingusmao/Desktop/Arnold/tests/connected-journey.test.ts:1), [tests/e2e/connected.spec.ts](/Users/kevingusmao/Desktop/Arnold/tests/e2e/connected.spec.ts:1), [tests/e2e/onboarding.spec.ts](/Users/kevingusmao/Desktop/Arnold/tests/e2e/onboarding.spec.ts:1).

**Offen, problematisch oder verbesserbar:** Die Fragenreihenfolge wird in der lokalen Onboarding-Bestandsaufnahme noch als offen bezeichnet. Eigene Übungen außerhalb des Grundkatalogs können vor der Google-Einrichtung nicht vollständig übernommen werden.

**Nächster sinnvoller Schritt:** Die endgültige Reise einschließlich Abbruch, unbekannter Übung und Wiederaufnahme als verständlichen Abnahmeablauf festhalten.


### 01.05 · Festlegen, welche Daten ChatGPT lesen, bearbeiten und löschen können soll

**Fortschritt: 75 % · Weitgehend umgesetzt.**

**Einordnung:** Lesen und Bearbeiten sind gut abgegrenzt; echtes Löschen ist noch nicht als Produktfunktion umgesetzt.

**So ist es heute umgesetzt:** Die Zugriffstabelle unterscheidet Lesen, Trainingsänderung, Planänderung und Kontoverwaltung. Identität und Datei kommen vom geprüften Konto. Sätze werden beim Entfernen als ungültig markiert und bleiben historisch erhalten; Pläne werden versioniert. Das ist bewusst etwas anderes als eine vollständige Datenlöschung.

**Maßgebliche Dateien und ihre Aufgabe:**

- [src/server/auth/tool-access.ts](/Users/kevingusmao/Desktop/Arnold/src/server/auth/tool-access.ts:1): Vollständige Zuordnung aller Werkzeuge zu Zugriffsklassen.
- [src/server/auth/scopes.ts](/Users/kevingusmao/Desktop/Arnold/src/server/auth/scopes.ts:1): Definiert getrennte Lese-, Schreib-, Plan- und Kontorechte.
- [src/server/mcp-workout.ts](/Users/kevingusmao/Desktop/Arnold/src/server/mcp-workout.ts:1): Registriert Werkzeuge zum Starten, Speichern und Korrigieren von Trainings.
- [src/server/mcp-plan.ts](/Users/kevingusmao/Desktop/Arnold/src/server/mcp-plan.ts:1): Registriert lesende und schreibende Planwerkzeuge.
- [src/server/connected/mcp-google.ts](/Users/kevingusmao/Desktop/Arnold/src/server/connected/mcp-google.ts:1): Verbindung, Fertigstellung, Verbindungsstatus und Trennen von Google.

**Tests und Nachweis:** Rechteprüfungen und Werkzeugverträge zeigen, welche Operationen zulässig sind und wann alte Revisionen abgelehnt werden.

Relevante Tests: [tests/auth-tool-access.test.ts](/Users/kevingusmao/Desktop/Arnold/tests/auth-tool-access.test.ts:1), [tests/workout-mcp.test.ts](/Users/kevingusmao/Desktop/Arnold/tests/workout-mcp.test.ts:1), [tests/plan-security.test.ts](/Users/kevingusmao/Desktop/Arnold/tests/plan-security.test.ts:1).

**Offen, problematisch oder verbesserbar:** Eine vollständige Berechtigungsmatrix für Export, endgültige Löschung, Körpergewicht und Kardio fehlt. Google trennen entfernt auch nicht alle Betreiberdateien.

**Nächster sinnvoller Schritt:** Lesen, Ändern, historisches Stornieren, Export und endgültiges Löschen in einer einzigen Produktmatrix unterscheiden.


### 01.06 · Festlegen, wann ChatGPT vor Änderungen nachfragen muss

**Fortschritt: 75 % · Weitgehend umgesetzt.**

**Einordnung:** Für wichtige Änderungen gibt es Bestätigungen; eine vollständige Bestätigungsregel fehlt.

**So ist es heute umgesetzt:** Planaktivierung und Onboarding-Freigabe verlangen die genaue Planversion und Revision. Bei Google-Trennung ist confirm=true erforderlich. Werkzeugtexte sagen ChatGPT, dass es den Plan nicht selbst bestätigen darf. Weitere Änderungen sind teilweise über Sicherheits-Hinweise als verändernd markiert.

**Maßgebliche Dateien und ihre Aufgabe:**

- [src/server/plan/service.ts](/Users/kevingusmao/Desktop/Arnold/src/server/plan/service.ts:1): Verwaltet Entwürfe, Freigabe, Aktivierung und historische Pläne.
- [src/server/mcp-onboarding.ts](/Users/kevingusmao/Desktop/Arnold/src/server/mcp-onboarding.ts:1): Führt ChatGPT durch die Einrichtung und Planbestätigung.
- [src/server/connected/mcp-google.ts](/Users/kevingusmao/Desktop/Arnold/src/server/connected/mcp-google.ts:1): Verbindung, Fertigstellung, Verbindungsstatus und Trennen von Google.
- [src/server/mcp-plan.ts](/Users/kevingusmao/Desktop/Arnold/src/server/mcp-plan.ts:1): Registriert lesende und schreibende Planwerkzeuge.

**Tests und Nachweis:** Tests lehnen veraltete oder fehlende Planbestätigungen ab und prüfen den Übergang zur Google-Verbindung.

Relevante Tests: [tests/plan-activation.test.ts](/Users/kevingusmao/Desktop/Arnold/tests/plan-activation.test.ts:1), [tests/onboarding-mcp.test.ts](/Users/kevingusmao/Desktop/Arnold/tests/onboarding-mcp.test.ts:1).

**Offen, problematisch oder verbesserbar:** Ein vom Modell gesetztes Bestätigungsfeld beweist allein keinen menschlichen Willen. Für Satzlöschung, Entwurfsverwerfen und spätere Kontolöschung fehlt eine durchgehende verständliche Produktregel mit Chat-Prüffällen.

**Nächster sinnvoller Schritt:** Für jede Änderung festlegen: direkter Nutzerauftrag genügt, zusätzliche Rückfrage nötig oder expliziter Klick erforderlich.


<a id="bereich-02"></a>

## 02 · Google-Sheets-Datenbank


### 02.01 · Neue Mastervorlage ohne persönliche Trainingsdaten erstellen

**Fortschritt: 75 % · Weitgehend umgesetzt.**

**Einordnung:** Eine saubere Vorlage existiert als Code; eine separate Google-Masterdatei wurde hier nicht abgenommen.

**So ist es heute umgesetzt:** Der Connected-Pfad kopiert keine möglicherweise persönliche Masterdatei. Er baut eine neue leere Nutzertabelle aus dem festgelegten Schema und dem Grundübungskatalog auf und übernimmt nur den bestätigten Trainingsplan. Die sechs Tabs und ihre Header kommen aus versioniertem Code.

**Maßgebliche Dateien und ihre Aufgabe:**

- [src/shared/arnold-schema-v1.ts](/Users/kevingusmao/Desktop/Arnold/src/shared/arnold-schema-v1.ts:5): Legt die sechs Tabellen, Spalten, IDs und Datenregeln fest.
- [src/shared/exercise-starter-catalog.ts](/Users/kevingusmao/Desktop/Arnold/src/shared/exercise-starter-catalog.ts:1): Gemeinsamer Grundkatalog für Einrichtung und persönliche Datei.
- [src/server/connected/google-api.ts](/Users/kevingusmao/Desktop/Arnold/src/server/connected/google-api.ts:1): Erstellt und prüft Drive-Dateien und initialisiert die sechs Tabs.
- [src/server/connected/runtime.ts](/Users/kevingusmao/Desktop/Arnold/src/server/connected/runtime.ts:1): Erzeugt und bindet die eigene Trainingsdatei je angemeldetem Nutzer.

**Tests und Nachweis:** Tests prüfen, dass eine neue persönliche Datei entsteht und der bestätigte Plan erhalten bleibt.

Relevante Tests: [tests/connected-journey.test.ts](/Users/kevingusmao/Desktop/Arnold/tests/connected-journey.test.ts:1).

**Offen, problematisch oder verbesserbar:** Das ist eine funktionale Weiterentwicklung der ursprünglichen Kopieridee. Die Existenz und Sauberkeit einer zusätzlichen manuell gepflegten Google-Mastervorlage wurden nicht geprüft.

**Nächster sinnvoller Schritt:** Die Architekturentscheidung dokumentieren: Code ist die verbindliche Vorlage; eine physische Masterdatei ist optional und darf nicht zur zweiten widersprüchlichen Quelle werden.


### 02.02 · Tabellen für Übungen, Trainingspläne, Workouts, Sätze, Körpergewicht, Kardio und Einstellungen festlegen

**Fortschritt: 75 % · Weitgehend umgesetzt.**

**Einordnung:** Die Krafttrainings-Tabellen sind vorhanden; Körpergewicht und Kardio fehlen.

**So ist es heute umgesetzt:** Es gibt CONFIG für Einstellungen, EXERCISES für Übungen, PLANS für Planversionen, PLAN_ITEMS für Planpositionen, WORKOUTS für Trainingseinheiten und SETS für einzelne Sätze. Körpergewicht im Onboarding ist lediglich eine Profilangabe, keine Messreihe. Ein Ausdauertraining mit Dauer, Strecke oder Intensität ist nicht als eigener Datensatz vorgesehen.

**Maßgebliche Dateien und ihre Aufgabe:**

- [src/shared/arnold-schema-v1.ts](/Users/kevingusmao/Desktop/Arnold/src/shared/arnold-schema-v1.ts:5): Legt die sechs Tabellen, Spalten, IDs und Datenregeln fest.
- [src/shared/onboarding-contract.ts](/Users/kevingusmao/Desktop/Arnold/src/shared/onboarding-contract.ts:1): Fragen, Profilfelder und Zustände der Einrichtung.

**Tests und Nachweis:** Der Tabellenvertrag enthält exakt sechs Tabs. Entsprechende Bodyweight-/Cardio-Tabellen und Rohdatentypen wurden im aktuellen Quellstand nicht gefunden.

Relevante Tests: [tests/arnold-domain.test.ts](/Users/kevingusmao/Desktop/Arnold/tests/arnold-domain.test.ts:1), [tests/arnold-grid.test.ts](/Users/kevingusmao/Desktop/Arnold/tests/arnold-grid.test.ts:1).

**Offen, problematisch oder verbesserbar:** Zwei ausdrücklich genannte Datenbereiche der ursprünglichen Mission sind nicht umgesetzt. Spätere Ergänzung benötigt eine geplante Schemaänderung.

**Nächster sinnvoller Schritt:** Entscheiden, ob beide Bereiche zu V1 gehören; falls ja, Messreihen und Kardio-Einheiten vor UI und Kennzahlen fachlich definieren.


### 02.03 · Jeder Übung, jedem Workout und jedem Satz eine eindeutige ID geben

**Fortschritt: 100 % · Erfüllt im geprüften Umfang.**

**Einordnung:** Übungen, Trainingseinheiten und Sätze besitzen stabile eindeutige IDs.

**So ist es heute umgesetzt:** Trainingsänderungen erzeugen IDs auf Serverseite. WORKOUTS und SETS verweisen über diese IDs aufeinander; eine Umbenennung der Übung verändert ihre Identität nicht. Auch Planfamilien, Planversionen und Planpositionen besitzen eigene Schlüssel. Neue Schreibvorgänge werden zusätzlich über eine Auftrags-ID wiedererkannt.

**Maßgebliche Dateien und ihre Aufgabe:**

- [src/shared/arnold-schema-v1.ts](/Users/kevingusmao/Desktop/Arnold/src/shared/arnold-schema-v1.ts:5): Legt die sechs Tabellen, Spalten, IDs und Datenregeln fest.
- [src/server/workout/infrastructure.ts](/Users/kevingusmao/Desktop/Arnold/src/server/workout/infrastructure.ts:1): Gemeinsame IDs, Sperren, Revisionsregeln, Audit und Operationsjournal.
- [src/server/workout/service.ts](/Users/kevingusmao/Desktop/Arnold/src/server/workout/service.ts:1): Prüft und verarbeitet Training, Satzkorrekturen und Abschluss.

**Tests und Nachweis:** Die Trainingsprüfungen kontrollieren erzeugte IDs, eindeutige Satzzeilen und Wiederholungen ohne zweite Entität.

Relevante Tests: [tests/workout-logging.test.ts](/Users/kevingusmao/Desktop/Arnold/tests/workout-logging.test.ts:1), [tests/arnold-domain.test.ts](/Users/kevingusmao/Desktop/Arnold/tests/arnold-domain.test.ts:1).

**Offen, problematisch oder verbesserbar:** Für die vorhandenen Entitäten ist keine offene ID-Lücke nachgewiesen. Neue Datentypen wie Körpergewichtsmessungen müssen dieselbe Regel übernehmen.

**Nächster sinnvoller Schritt:** Die bestehende ID-Strategie bei jeder Schemaerweiterung konsequent fortführen.


### 02.04 · Kilogramm, Wiederholungen, Kurzhanteln pro Seite und Körpergewichtsübungen eindeutig definieren

**Fortschritt: 100 % · Erfüllt im geprüften Umfang.**

**Einordnung:** Gewicht und Wiederholungen sind wesentlich genauer definiert als in einer einfachen Trainingstabelle.

**So ist es heute umgesetzt:** Ein Satz speichert, ob das Gewicht insgesamt, je Hantel, als Maschinenanzeige, Zusatzlast oder Unterstützung gemeint ist. Anzahl der Geräte, Ausführung und Seite stehen getrennt daneben. Die Engine verdoppelt Kurzhanteln nur dann, wenn die dokumentierte Ausführung das rechtfertigt. Unbekannte Eigengewichtslast bleibt unbekannt.

**Maßgebliche Dateien und ihre Aufgabe:**

- [src/shared/arnold-schema-v1.ts](/Users/kevingusmao/Desktop/Arnold/src/shared/arnold-schema-v1.ts:130): Definiert die verschiedenen Bedeutungen von Gewicht und Ausführung.
- [src/analytics/load.ts](/Users/kevingusmao/Desktop/Arnold/src/analytics/load.ts:96): Berechnet Satzlast, Volumen und e1RM nach Ausführungsregeln.
- [src/shared/arnold-format.ts](/Users/kevingusmao/Desktop/Arnold/src/shared/arnold-format.ts:1): Beschriftet Gewichte und Ausführungen ohne Umdeutung.

**Tests und Nachweis:** Numerische Beispiele prüfen Langhantel, zwei Kurzhanteln, einseitiges und alternierendes Training sowie Körpergewicht und Unterstützung.

Relevante Tests: [tests/analytics-load.test.ts](/Users/kevingusmao/Desktop/Arnold/tests/analytics-load.test.ts:1), [tests/workout-logging.test.ts](/Users/kevingusmao/Desktop/Arnold/tests/workout-logging.test.ts:1).

**Offen, problematisch oder verbesserbar:** Keine offene Bedeutungsfrage innerhalb der unterstützten Lastkonventionen nachgewiesen. Eine spätere Körpergewichtskurve ist dadurch noch nicht implementiert.

**Nächster sinnvoller Schritt:** Die Bedeutungen in der Oberfläche und in Chat-Eingaben weiterhin sichtbar machen; keine pauschale Multiplikation einführen.


### 02.05 · Verknüpfung zwischen Workouts, Übungen und Sätzen herstellen

**Fortschritt: 100 % · Erfüllt im geprüften Umfang.**

**Einordnung:** Die Verbindungen zwischen Training, Übung und Satz werden serverseitig geprüft.

**So ist es heute umgesetzt:** Jeder Satz gehört zu genau einer Trainingseinheit und einer Übung. Planreferenzen werden zusätzlich gegen Planversion, Session und Position geprüft. Historische Namen können als Momentaufnahme erhalten bleiben, während stabile IDs die Beziehungen absichern. Unbekannte oder widersprüchliche Referenzen werden abgelehnt.

**Maßgebliche Dateien und ihre Aufgabe:**

- [src/shared/arnold-schema-v1.ts](/Users/kevingusmao/Desktop/Arnold/src/shared/arnold-schema-v1.ts:5): Legt die sechs Tabellen, Spalten, IDs und Datenregeln fest.
- [src/server/workout/service.ts](/Users/kevingusmao/Desktop/Arnold/src/server/workout/service.ts:1): Prüft und verarbeitet Training, Satzkorrekturen und Abschluss.
- [src/server/workout/infrastructure.ts](/Users/kevingusmao/Desktop/Arnold/src/server/workout/infrastructure.ts:1): Gemeinsame IDs, Sperren, Revisionsregeln, Audit und Operationsjournal.

**Tests und Nachweis:** Domain- und Trainingsprüfungen decken fremde oder unbekannte IDs, Sessions in falschen Plänen und historische Referenzen ab.

Relevante Tests: [tests/arnold-domain.test.ts](/Users/kevingusmao/Desktop/Arnold/tests/arnold-domain.test.ts:1), [tests/workout-logging.test.ts](/Users/kevingusmao/Desktop/Arnold/tests/workout-logging.test.ts:1).

**Offen, problematisch oder verbesserbar:** Für den vorhandenen Krafttrainingsumfang ist kein fehlender Grundbezug nachgewiesen. Die heute behobene automatische historische Planzuordnung ist berücksichtigt.

**Nächster sinnvoller Schritt:** Bei Importen und künftigen Migrationen dieselben Referenzprüfungen vor jeder Übernahme ausführen.


### 02.06 · Datums- und Zeitformate vereinheitlichen

**Fortschritt: 100 % · Erfüllt im geprüften Umfang.**

**Einordnung:** Datums- und Zeitformate sind festgelegt und die drei jüngsten Schutzkorrekturen sind enthalten.

**So ist es heute umgesetzt:** Der Trainingstag wird als lokales Kalenderdatum gespeichert; die Zeitzone steht ausdrücklich daneben. Technische Zeitpunkte sind UTC-Zeitstempel mit Z. Wochenberechnungen verwenden den lokalen Trainingstag. Ein Abschluss vor diesem Tag wird nun auch ohne bekannte Startuhrzeit zurückgewiesen.

**Maßgebliche Dateien und ihre Aufgabe:**

- [src/shared/arnold-schema-v1.ts](/Users/kevingusmao/Desktop/Arnold/src/shared/arnold-schema-v1.ts:318): Prüft lokale Trainingstage, Zeitzonen und UTC-Zeitstempel.
- [src/analytics/period.ts](/Users/kevingusmao/Desktop/Arnold/src/analytics/period.ts:1): Behandelt Kalenderdaten und Wochenanfänge.
- [src/server/workout/service.ts](/Users/kevingusmao/Desktop/Arnold/src/server/workout/service.ts:1): Prüft und verarbeitet Training, Satzkorrekturen und Abschluss.

**Tests und Nachweis:** Formatprüfungen sowie neue Grenzfälle für lokale Mitternacht, mehrere Zeitzonen und Sommerzeitwechsel bestehen.

Relevante Tests: [tests/arnold-domain.test.ts](/Users/kevingusmao/Desktop/Arnold/tests/arnold-domain.test.ts:1), [tests/analytics-activity.test.ts](/Users/kevingusmao/Desktop/Arnold/tests/analytics-activity.test.ts:1), [tests/workout-logging.test.ts](/Users/kevingusmao/Desktop/Arnold/tests/workout-logging.test.ts:1).

**Offen, problematisch oder verbesserbar:** Im geprüften Datumsvertrag ist keine weitere konkrete Formatlücke nachgewiesen. Eine Nutzerzeitzone für die gesamte Dashboard-Gegenwartsanzeige ist eine davon getrennte Produktverbesserung.

**Nächster sinnvoller Schritt:** Den gemeinsamen Datumsvertrag bei neuen Körpergewichts- und Kardiodaten wiederverwenden.


### 02.07 · Prüfen, wie mehrere Workouts am gleichen Tag gespeichert werden

**Fortschritt: 100 % · Erfüllt im geprüften Umfang.**

**Einordnung:** Mehrere Trainingseinheiten an einem Tag sind ausdrücklich erlaubt und werden getrennt gezählt.

**So ist es heute umgesetzt:** Eine Trainingseinheit wird über ihre ID und nicht über das Datum identifiziert. Zwei Einheiten am selben Datum ergeben zwei Workouts, aber nur einen Trainingstag. Sätze bleiben ihren jeweiligen Einheiten zugeordnet; Übungsdiagramme können Werte desselben Tages zusammenfassen, ohne Rohdaten zu überschreiben.

**Maßgebliche Dateien und ihre Aufgabe:**

- [src/shared/arnold-schema-v1.ts](/Users/kevingusmao/Desktop/Arnold/src/shared/arnold-schema-v1.ts:5): Legt die sechs Tabellen, Spalten, IDs und Datenregeln fest.
- [src/analytics/activity.ts](/Users/kevingusmao/Desktop/Arnold/src/analytics/activity.ts:128): Zählt Trainingstage und Einheiten und berechnet Wochenserien.
- [src/analytics/progress.ts](/Users/kevingusmao/Desktop/Arnold/src/analytics/progress.ts:1): Berechnet Übungsverläufe mit getrennten Ausführungsvarianten.

**Tests und Nachweis:** Tests benennen genau den Fall zwei Workouts an einem Tag und prüfen Tagesaggregation ohne Überschreiben.

Relevante Tests: [tests/analytics-activity.test.ts](/Users/kevingusmao/Desktop/Arnold/tests/analytics-activity.test.ts:1), [tests/analytics-progress.test.ts](/Users/kevingusmao/Desktop/Arnold/tests/analytics-progress.test.ts:1).

**Offen, problematisch oder verbesserbar:** Die Datenbasis erfüllt den Punkt. Die Wochenkarte vermischt teilweise Einheiten und ein aus Trainingstagen abgeleitetes Ziel; das wird separat unter 05.03 bewertet.

**Nächster sinnvoller Schritt:** Die Trennung zwischen Trainingstag und Einheit bei allen sichtbaren Zielen und Beschriftungen beibehalten.


### 02.08 · Eine interne Schemaversion für spätere Updates einführen

**Fortschritt: 100 % · Erfüllt im geprüften Umfang.**

**Einordnung:** Eine interne Schemaversion ist vorhanden und wird beim Lesen validiert.

**So ist es heute umgesetzt:** Die Rohdaten tragen schema_id=arnold.training_raw und schema_version=1.0.0. Zusätzlich sind Tabellenstruktur und erwartete Header festgelegt. Ein inkompatibler Tracker wird dadurch nicht still wie eine passende Datei behandelt. Kennzahlen besitzen außerdem eine eigene Konventionsversion.

**Maßgebliche Dateien und ihre Aufgabe:**

- [src/shared/arnold-schema-v1.ts](/Users/kevingusmao/Desktop/Arnold/src/shared/arnold-schema-v1.ts:5): Legt die sechs Tabellen, Spalten, IDs und Datenregeln fest.
- [src/server/arnold-sheets-read-adapter.ts](/Users/kevingusmao/Desktop/Arnold/src/server/arnold-sheets-read-adapter.ts:1): Liest und validiert die sechs Google-Tabellen.
- [src/analytics/index.ts](/Users/kevingusmao/Desktop/Arnold/src/analytics/index.ts:1): Öffentlicher Einstieg in die reine Berechnungsschicht.

**Tests und Nachweis:** Domain-, Tabellen- und Adapterprüfungen kontrollieren das erwartete Format und Fehler bei Abweichungen.

Relevante Tests: [tests/arnold-domain.test.ts](/Users/kevingusmao/Desktop/Arnold/tests/arnold-domain.test.ts:1), [tests/arnold-grid.test.ts](/Users/kevingusmao/Desktop/Arnold/tests/arnold-grid.test.ts:1).

**Offen, problematisch oder verbesserbar:** Dieser Punkt verlangt das Einführen der Version, nicht bereits einen universellen Migrationsdienst. Ein solcher Dienst fehlt weiterhin und ist unter 10.09 bewertet.

**Nächster sinnvoller Schritt:** Bei der nächsten echten Datenmodelländerung eine explizite Migration und Versionsanhebung planen.


### 02.09 · Eine sichere Sicherungs- und Wiederherstellungsfunktion vorsehen

**Fortschritt: 25 % · Grundlage vorhanden.**

**Einordnung:** Persistenz und Wiederaufnahme sind vorhanden; eine vollständige Sicherung mit geprüfter Wiederherstellung fehlt.

**So ist es heute umgesetzt:** Der Guide erklärt, dass Code-Commits keine Tokens, Zustandsdateien oder Nutzertabellen sichern. Das Connected-Profil erhält Betreiberzustand über einen privaten Cloud-Bucket. Journale helfen nach unterbrochenen Schreibvorgängen. Keine dieser Maßnahmen ist allein ein versioniertes, getrenntes Backup.

**Maßgebliche Dateien und ihre Aufgabe:**

- [docs/GUIDE.md](/Users/kevingusmao/Desktop/Arnold/docs/GUIDE.md:341): Beschreibt, welche Daten zusätzlich zum Code gesichert werden müssen.
- [src/server/connected/state.ts](/Users/kevingusmao/Desktop/Arnold/src/server/connected/state.ts:1): Speichert Entwürfe und Auditdaten atomar als Betreiberdateien.
- [src/server/workout/infrastructure.ts](/Users/kevingusmao/Desktop/Arnold/src/server/workout/infrastructure.ts:276): Speichert vollständige Änderungsdatensätze im Operationsjournal.
- [scripts/setup-cloud-infra.sh](/Users/kevingusmao/Desktop/Arnold/scripts/setup-cloud-infra.sh:1): Richtet Dienstkonto, privaten Zustands-Bucket und begrenzte Secret-Rechte ein.

**Tests und Nachweis:** Neustarttests belegen die Wiederaufnahme einzelner Abläufe. Eine Wiederherstellung nach Verlust von Bucket, Zuordnung oder Schlüssel wurde nicht nachgewiesen.

Relevante Tests: [tests/workout-restart.test.ts](/Users/kevingusmao/Desktop/Arnold/tests/workout-restart.test.ts:1), [tests/connected-storage.test.ts](/Users/kevingusmao/Desktop/Arnold/tests/connected-storage.test.ts:1).

**Offen, problematisch oder verbesserbar:** Es fehlen Backup-Plan, Aufbewahrung, automatischer Lauf, getrennte Schlüsselstrategie und Restore-Test für Betreiberzustand plus persönliche Tabellen.

**Nächster sinnvoller Schritt:** Ein Wiederherstellungsziel festlegen und den Verlust einer Instanz samt lokalem Zustand mit synthetischen Daten wirklich durchspielen.


<a id="bereich-03"></a>

## 03 · MCP-Server – Grundfunktionen


### 03.01 · Node.js-/TypeScript-Projektstruktur und MCP-SDK einrichten

**Fortschritt: 100 % · Erfüllt im geprüften Umfang.**

**Einordnung:** Node.js, TypeScript und das MCP-SDK sind eingerichtet und werden erfolgreich gebaut.

**So ist es heute umgesetzt:** Das Projekt trennt gemeinsame Datenverträge, Serverdienste, Berechnungsschicht und React-Oberfläche. Paketdatei und Lockfile legen Werkzeuge und Bibliotheken fest. Der Build prüft TypeScript und erzeugt UI sowie ausführbaren Servercode.

**Maßgebliche Dateien und ihre Aufgabe:**

- [package.json](/Users/kevingusmao/Desktop/Arnold/package.json:1): Abhängigkeiten, Node-Version und ausführbare Projektbefehle.
- [src/server/main.ts](/Users/kevingusmao/Desktop/Arnold/src/server/main.ts:1): Startet den Server und beendet ihn kontrolliert.
- [src/server/bootstrap.ts](/Users/kevingusmao/Desktop/Arnold/src/server/bootstrap.ts:1): Prüft Konfiguration und verbindet Authentifizierung mit Google-Laufzeit.

**Tests und Nachweis:** Der zuletzt vollständig geprüfte Hauptcommit baut erfolgreich; die direkten installierten Abhängigkeiten waren konsistent.

Relevante Tests: [tests/analytics-architecture.test.ts](/Users/kevingusmao/Desktop/Arnold/tests/analytics-architecture.test.ts:1).

**Offen, problematisch oder verbesserbar:** Die lokale Prüfung lief mit Node 26, das Container-Build mit Node 24. Eine zusätzliche Testmatrix für alle offiziell unterstützten Node-Versionen ist noch keine automatisierte CI-Regel.

**Nächster sinnvoller Schritt:** Die bestehende Struktur beibehalten und die Laufzeitversion später in der CI ausdrücklich mitprüfen.


### 03.02 · Streamable-HTTP-Endpunkt /mcp implementieren

**Fortschritt: 100 % · Erfüllt im geprüften Umfang.**

**Einordnung:** Der Streamable-HTTP-Endpunkt /mcp ist implementiert und tatsächlich erreichbar.

**So ist es heute umgesetzt:** Express verbindet jede Anfrage mit einem MCP-Server und dem offiziellen HTTP-Transport. Der Transport ist zustandslos; Trainingszustand liegt in Diensten und Repositories. Authentifizierung und Host-/Origin-Schutz laufen vor dem Zugriff auf persönliche Daten.

**Maßgebliche Dateien und ihre Aufgabe:**

- [src/server/http.ts](/Users/kevingusmao/Desktop/Arnold/src/server/http.ts:1): Stellt MCP, Vorschau, Testhost und Healthcheck bereit.
- [src/server/auth/router.ts](/Users/kevingusmao/Desktop/Arnold/src/server/auth/router.ts:1): Verbindet OAuth-Metadaten und geschützte HTTP-Aufrufe.

**Tests und Nachweis:** Lokale MCP-/HTTP-Tests bestehen. Der Live-Endpunkt weist einen Aufruf ohne Token mit HTTP 401 ab.

Relevante Tests: [tests/arnold-mcp.test.ts](/Users/kevingusmao/Desktop/Arnold/tests/arnold-mcp.test.ts:1), [tests/auth-http.test.ts](/Users/kevingusmao/Desktop/Arnold/tests/auth-http.test.ts:1).

**Offen, problematisch oder verbesserbar:** Keine fehlende Grundfunktion am Endpunkt nachgewiesen. Lastverhalten und verteilter Betrieb sind eigenständige offene Betriebsaufgaben.

**Nächster sinnvoller Schritt:** Den Endpunkt als stabile Schnittstelle erhalten und Änderungen über Protokolltests absichern.


### 03.03 · MCP-Tools mit klaren Namen und Eingabe-/Ausgabeformaten registrieren

**Fortschritt: 100 % · Erfüllt im geprüften Umfang.**

**Einordnung:** Die vorhandenen Werkzeuge sind einzeln benannt und haben klare Verträge.

**So ist es heute umgesetzt:** Dashboard, Training, Plan, Einrichtung und Google-Verbindung besitzen getrennte Werkzeugmodule. Zod-Schemas beschreiben zulässige Eingaben und strukturierte Ergebnisse. Die zentrale Zugriffstabelle verhindert, dass ein neues unklassifiziertes Werkzeug versehentlich ungeschützt registriert wird.

**Maßgebliche Dateien und ihre Aufgabe:**

- [src/server/mcp-arnold.ts](/Users/kevingusmao/Desktop/Arnold/src/server/mcp-arnold.ts:1): Registriert Dashboard-, Historien- und Fortschrittswerkzeuge.
- [src/server/mcp-workout.ts](/Users/kevingusmao/Desktop/Arnold/src/server/mcp-workout.ts:1): Registriert Werkzeuge zum Starten, Speichern und Korrigieren von Trainings.
- [src/server/mcp-plan.ts](/Users/kevingusmao/Desktop/Arnold/src/server/mcp-plan.ts:1): Registriert lesende und schreibende Planwerkzeuge.
- [src/server/mcp-onboarding.ts](/Users/kevingusmao/Desktop/Arnold/src/server/mcp-onboarding.ts:1): Führt ChatGPT durch die Einrichtung und Planbestätigung.
- [src/server/connected/mcp-google.ts](/Users/kevingusmao/Desktop/Arnold/src/server/connected/mcp-google.ts:1): Verbindung, Fertigstellung, Verbindungsstatus und Trennen von Google.
- [src/server/auth/tool-access.ts](/Users/kevingusmao/Desktop/Arnold/src/server/auth/tool-access.ts:1): Vollständige Zuordnung aller Werkzeuge zu Zugriffsklassen.

**Tests und Nachweis:** MCP-Tests kontrollieren Registrierung, Schemas und relevante Rückgaben. Die Vollständigkeit öffentlicher Sicherheits-Annotationen ist separat unter 11.06 eingeschränkt.

Relevante Tests: [tests/arnold-mcp.test.ts](/Users/kevingusmao/Desktop/Arnold/tests/arnold-mcp.test.ts:1), [tests/workout-mcp.test.ts](/Users/kevingusmao/Desktop/Arnold/tests/workout-mcp.test.ts:1), [tests/plan-mcp.test.ts](/Users/kevingusmao/Desktop/Arnold/tests/plan-mcp.test.ts:1), [tests/onboarding-mcp.test.ts](/Users/kevingusmao/Desktop/Arnold/tests/onboarding-mcp.test.ts:1), [tests/auth-tool-access.test.ts](/Users/kevingusmao/Desktop/Arnold/tests/auth-tool-access.test.ts:1).

**Offen, problematisch oder verbesserbar:** Für die vorhandenen Funktionsbereiche ist die Grundanforderung erfüllt. Körpergewicht und Kardio erscheinen folgerichtig auch noch nicht in der Werkzeugliste.

**Nächster sinnvoller Schritt:** Neue Werkzeuge nur mit Vertrag, Zugriffsklasse und passendem Transporttest ergänzen.


### 03.04 · Tool zum Öffnen des Dashboards erstellen

**Fortschritt: 100 % · Erfüllt im geprüften Umfang.**

**Einordnung:** Ein Werkzeug öffnet das Dashboard beziehungsweise die passende Karte im Chat.

**So ist es heute umgesetzt:** show_arnold_dashboard liefert Dashboard-Daten und verweist auf die eingebettete MCP-Apps-Oberfläche. Das card-Argument wählt Training, Woche, Fortschritt, Historie oder Plan. Der Host lädt die UI als Ressource und stellt ihre Darstellung im Chat bereit.

**Maßgebliche Dateien und ihre Aufgabe:**

- [src/server/mcp-arnold.ts](/Users/kevingusmao/Desktop/Arnold/src/server/mcp-arnold.ts:1): Registriert Dashboard-, Historien- und Fortschrittswerkzeuge.
- [src/ui/ArnoldDashboardApp.tsx](/Users/kevingusmao/Desktop/Arnold/src/ui/ArnoldDashboardApp.tsx:1): Steuert die Kartenansichten und Navigation.
- [src/ui/main.tsx](/Users/kevingusmao/Desktop/Arnold/src/ui/main.tsx:1): Startet die UI und empfängt Werkzeugdaten des Hosts.

**Tests und Nachweis:** Tests prüfen Werkzeugvertrag, UI-Ressource und Darstellung im lokalen AppBridge-Host.

Relevante Tests: [tests/arnold-mcp.test.ts](/Users/kevingusmao/Desktop/Arnold/tests/arnold-mcp.test.ts:1), [tests/e2e/arnold-dashboard.spec.ts](/Users/kevingusmao/Desktop/Arnold/tests/e2e/arnold-dashboard.spec.ts:1).

**Offen, problematisch oder verbesserbar:** Im Hauptstand ist die Funktion erfüllt. Die aktuelle Live-Revision enthält noch die frühere Oberfläche; das ist der ausdrücklich zurückgestellte Deployment-Schritt.

**Nächster sinnvoller Schritt:** Beim späteren Deployment die Kartenwahl einmal im echten ChatGPT-Connector abnehmen.


### 03.05 · Tools zum Abrufen von Trainingsplan, Workouts und Übungsverlauf erstellen

**Fortschritt: 100 % · Erfüllt im geprüften Umfang.**

**Einordnung:** Trainingsplan, Trainingseinheiten und Übungsverlauf können über Werkzeuge abgerufen werden.

**So ist es heute umgesetzt:** get_training_plan und verwandte Planwerkzeuge liefern stabile Versionen. get_arnold_workouts unterstützt Filter und Blätterung. get_arnold_exercise_progress liefert zeitliche Messpunkte einer Übung. Die Berechnungen kommen aus der gemeinsamen Engine, nicht aus ChatGPT-Schätzungen.

**Maßgebliche Dateien und ihre Aufgabe:**

- [src/server/mcp-arnold.ts](/Users/kevingusmao/Desktop/Arnold/src/server/mcp-arnold.ts:1): Registriert Dashboard-, Historien- und Fortschrittswerkzeuge.
- [src/server/mcp-plan.ts](/Users/kevingusmao/Desktop/Arnold/src/server/mcp-plan.ts:1): Registriert lesende und schreibende Planwerkzeuge.
- [src/server/arnold-presenter.ts](/Users/kevingusmao/Desktop/Arnold/src/server/arnold-presenter.ts:1): Übersetzt Berechnungen in verständliche Dashboard-Daten.

**Tests und Nachweis:** MCP-Tests und numerische Fortschrittstests decken die Abrufe und Filter ab.

Relevante Tests: [tests/arnold-mcp.test.ts](/Users/kevingusmao/Desktop/Arnold/tests/arnold-mcp.test.ts:1), [tests/plan-mcp.test.ts](/Users/kevingusmao/Desktop/Arnold/tests/plan-mcp.test.ts:1), [tests/analytics-progress.test.ts](/Users/kevingusmao/Desktop/Arnold/tests/analytics-progress.test.ts:1).

**Offen, problematisch oder verbesserbar:** Keine fehlende Grundfunktion für die vorhandenen Krafttrainingsdaten nachgewiesen. Die Benutzeroberfläche zeigt nicht jede technisch verfügbare Vergleichsinformation gleich ausführlich.

**Nächster sinnvoller Schritt:** Beim weiteren Ausbau dieselben Datenabrufe für Sprache und UI verwenden.


### 03.06 · Tools zum Erfassen und Korrigieren von Workout-Sätzen erstellen

**Fortschritt: 100 % · Erfüllt im geprüften Umfang.**

**Einordnung:** Sätze können angelegt, korrigiert und historisch storniert werden.

**So ist es heute umgesetzt:** start_workout und log_workout_sets erfassen Training und Sätze. update_set verwendet eine stabile Satz-ID und die erwartete Revision. void_set markiert einen Satz als ungültig. Abgeschlossene Trainings erfordern für Korrekturen zusätzliche Angaben und eine entsprechende Berechtigung.

**Maßgebliche Dateien und ihre Aufgabe:**

- [src/server/mcp-workout.ts](/Users/kevingusmao/Desktop/Arnold/src/server/mcp-workout.ts:1): Registriert Werkzeuge zum Starten, Speichern und Korrigieren von Trainings.
- [src/server/workout/service.ts](/Users/kevingusmao/Desktop/Arnold/src/server/workout/service.ts:1): Prüft und verarbeitet Training, Satzkorrekturen und Abschluss.
- [src/shared/workout-contract.ts](/Users/kevingusmao/Desktop/Arnold/src/shared/workout-contract.ts:39): Verbindlicher Ein-/Ausgabevertrag für Trainingsänderungen.

**Tests und Nachweis:** Service-, MCP- und Browser-Tests prüfen Speicherung, Korrektur, Stornierung, Revisionen und Wiederholungen.

Relevante Tests: [tests/workout-logging.test.ts](/Users/kevingusmao/Desktop/Arnold/tests/workout-logging.test.ts:1), [tests/workout-mcp.test.ts](/Users/kevingusmao/Desktop/Arnold/tests/workout-mcp.test.ts:1), [tests/e2e/workout-logger.spec.ts](/Users/kevingusmao/Desktop/Arnold/tests/e2e/workout-logger.spec.ts:1).

**Offen, problematisch oder verbesserbar:** Die Funktionen sind vorhanden. Stornieren ist kein endgültiges datenschutzrechtliches Löschen; die Wiederherstellungsgrenzen werden unter 03.10 und 10.09 erläutert.

**Nächster sinnvoller Schritt:** Diese Unterschiede in der späteren Nutzerhilfe klar beschreiben.


### 03.07 · Tools für Körpergewicht und Kardio ergänzen

**Fortschritt: 0 % · Nicht umgesetzt / kein Liefernachweis.**

**Einordnung:** Werkzeuge für Körpergewichtsmessungen und Kardio existieren noch nicht.

**So ist es heute umgesetzt:** Die registrierten Werkzeuge bedienen Krafttraining, Pläne, Einrichtung und Google-Konto. Das einmalige Körpergewicht im Einrichtungsprofil ist kein Werkzeug zum fortlaufenden Gewicht-Tracking. Für Laufen, Radfahren, Dauer oder Strecke gibt es keinen eigenen Eingabe-/Ausgabevertrag.

**Maßgebliche Dateien und ihre Aufgabe:**

- [src/server/auth/tool-access.ts](/Users/kevingusmao/Desktop/Arnold/src/server/auth/tool-access.ts:1): Vollständige Zuordnung aller Werkzeuge zu Zugriffsklassen.
- [src/shared/arnold-schema-v1.ts](/Users/kevingusmao/Desktop/Arnold/src/shared/arnold-schema-v1.ts:5): Legt die sechs Tabellen, Spalten, IDs und Datenregeln fest.
- [src/shared/onboarding-contract.ts](/Users/kevingusmao/Desktop/Arnold/src/shared/onboarding-contract.ts:1): Fragen, Profilfelder und Zustände der Einrichtung.

**Tests und Nachweis:** Suche in Werkzeugregistrierungen und Datenverträgen ergab keine entsprechenden Operationen.

**Offen, problematisch oder verbesserbar:** Es fehlen Rohdatenmodell, Schreib- und Lesedienste, Validierung, Berechnungen und Tests für beide Bereiche.

**Nächster sinnvoller Schritt:** Nach der V1-Entscheidung zuerst die Datenmodelle definieren und darauf aufbauend wenige klare Werkzeuge ergänzen.


### 03.08 · Alle Eingaben auf Gültigkeit prüfen

**Fortschritt: 75 % · Weitgehend umgesetzt.**

**Einordnung:** Eingaben werden intensiv geprüft; die Aussage alle Eingaben sicher behandeln ist noch zu weitgehend.

**So ist es heute umgesetzt:** Zod prüft Datentypen, Wertebereiche und unbekannte Felder. Die Dienste prüfen zusätzlich Planstatus, Revision, Berechtigungen, Referenzen und Ausführungslogik. Die drei zuletzt gefundenen fachlichen Lücken wurden geschlossen. Der Sheets-Writer hat jedoch noch nicht die zusätzliche Kapazitätsvorprüfung aus S001.

**Maßgebliche Dateien und ihre Aufgabe:**

- [src/shared/workout-contract.ts](/Users/kevingusmao/Desktop/Arnold/src/shared/workout-contract.ts:39): Verbindlicher Ein-/Ausgabevertrag für Trainingsänderungen.
- [src/shared/plan-contract.ts](/Users/kevingusmao/Desktop/Arnold/src/shared/plan-contract.ts:446): Verbindlicher Vertrag für Planversionen und Bearbeitungen.
- [src/shared/arnold-schema-v1.ts](/Users/kevingusmao/Desktop/Arnold/src/shared/arnold-schema-v1.ts:5): Legt die sechs Tabellen, Spalten, IDs und Datenregeln fest.
- [src/server/workout/service.ts](/Users/kevingusmao/Desktop/Arnold/src/server/workout/service.ts:1): Prüft und verarbeitet Training, Satzkorrekturen und Abschluss.
- [src/server/arnold-sheets-write-adapter.ts](/Users/kevingusmao/Desktop/Arnold/src/server/arnold-sheets-write-adapter.ts:1): Schreibt geprüfte Batches als echte Text-/Zahlenzellen nach Google.

**Tests und Nachweis:** Viele negative Service- und MCP-Fälle bestehen. Der Audit hat zusätzlich einen Protokollierungsfehler bei ungültigem JSON reproduziert.

Relevante Tests: [tests/workout-logging.test.ts](/Users/kevingusmao/Desktop/Arnold/tests/workout-logging.test.ts:1), [tests/arnold-domain.test.ts](/Users/kevingusmao/Desktop/Arnold/tests/arnold-domain.test.ts:1), [tests/arnold-write-adapter.test.ts](/Users/kevingusmao/Desktop/Arnold/tests/arnold-write-adapter.test.ts:1), [tests/http-surface.test.ts](/Users/kevingusmao/Desktop/Arnold/tests/http-surface.test.ts:1).

**Offen, problematisch oder verbesserbar:** Tabellenwachstum wird vor dem Schreiben nicht vollständig gegen die Leselimits abgesichert. Bei ungültigem JSON können Anfragefragmente in allgemeine Fehlerlogs gelangen.

**Nächster sinnvoller Schritt:** Kapazitätsgrenzen vor dem Batch validieren und Parserfehler ohne Originalnachricht protokollieren.


### 03.09 · Fehler und Bestätigungen eindeutig an ChatGPT zurückgeben

**Fortschritt: 75 % · Weitgehend umgesetzt.**

**Einordnung:** Erfolg, Fehler und unklare Speicherung sind unterscheidbar; die Wiederherstellung ist noch nicht überall einheitlich.

**So ist es heute umgesetzt:** Schreibantworten enthalten Erfolg, Wiederholung, Ergebnis oder Fehlercode. Erfolg wird erst nach erneutem Lesen, Audit und Journalbestätigung gemeldet. Manche Lese-/HTTP-Fehler kommen jedoch nur als Text oder allgemeine Fehlermeldung zurück. Oberfläche und Dienste leiten Wiederholbarkeit teilweise aus Fehlercodes ab.

**Maßgebliche Dateien und ihre Aufgabe:**

- [src/server/mcp-workout.ts](/Users/kevingusmao/Desktop/Arnold/src/server/mcp-workout.ts:1): Registriert Werkzeuge zum Starten, Speichern und Korrigieren von Trainings.
- [src/server/mcp-plan.ts](/Users/kevingusmao/Desktop/Arnold/src/server/mcp-plan.ts:1): Registriert lesende und schreibende Planwerkzeuge.
- [src/server/plan/commit.ts](/Users/kevingusmao/Desktop/Arnold/src/server/plan/commit.ts:1): Sichert Planänderungen mit Journal, Readback und Audit ab.
- [src/ui/hooks/useWorkoutLogger.ts](/Users/kevingusmao/Desktop/Arnold/src/ui/hooks/useWorkoutLogger.ts:1): Verhindert Doppelklicks und behält unbestätigte Schreibaufträge.

**Tests und Nachweis:** MCP- und Recovery-Tests unterscheiden bestätigte Speicherung von verlorener oder unklarer Antwort.

Relevante Tests: [tests/workout-mcp.test.ts](/Users/kevingusmao/Desktop/Arnold/tests/workout-mcp.test.ts:1), [tests/plan-mcp.test.ts](/Users/kevingusmao/Desktop/Arnold/tests/plan-mcp.test.ts:1), [tests/workout-restart.test.ts](/Users/kevingusmao/Desktop/Arnold/tests/workout-restart.test.ts:1).

**Offen, problematisch oder verbesserbar:** Der gemeinsame explizite Recovery-Vertrag aus S001 ist nicht integriert. Unterschiedliche Fehlerpfade können Nutzer unnötig blockieren oder die erforderliche nächste Aktion uneindeutig machen.

**Nächster sinnvoller Schritt:** Ein einheitliches Antwortfeld für erneut prüfen, sicher wiederholen oder neu beginnen festlegen und in beiden Schreibdiensten verwenden.


### 03.10 · Mehrfach ausgeführte Schreibaufträge gegen Duplikate absichern

**Fortschritt: 75 % · Weitgehend umgesetzt.**

**Einordnung:** Doppelte Schreibaufträge werden im unterstützten Einzelprozessbetrieb wirksam abgefangen.

**So ist es heute umgesetzt:** Jeder Schreibauftrag trägt request_id. Das Journal merkt sich Inhalt, Akteur, Änderungen und Ergebnis. Derselbe Auftrag wird wiedererkannt; ein anderer Inhalt unter derselben ID wird abgelehnt. Die UI behält einen unklaren Auftrag bei Reload und prüft ihn mit derselben ID weiter.

**Maßgebliche Dateien und ihre Aufgabe:**

- [src/server/workout/infrastructure.ts](/Users/kevingusmao/Desktop/Arnold/src/server/workout/infrastructure.ts:276): Speichert vollständige Änderungsdatensätze im Operationsjournal.
- [src/server/workout/service.ts](/Users/kevingusmao/Desktop/Arnold/src/server/workout/service.ts:1): Prüft und verarbeitet Training, Satzkorrekturen und Abschluss.
- [src/server/plan/commit.ts](/Users/kevingusmao/Desktop/Arnold/src/server/plan/commit.ts:1): Sichert Planänderungen mit Journal, Readback und Audit ab.
- [src/ui/hooks/useWorkoutLogger.ts](/Users/kevingusmao/Desktop/Arnold/src/ui/hooks/useWorkoutLogger.ts:1): Verhindert Doppelklicks und behält unbestätigte Schreibaufträge.
- [src/server/connected/runtime.ts](/Users/kevingusmao/Desktop/Arnold/src/server/connected/runtime.ts:1): Erzeugt und bindet die eigene Trainingsdatei je angemeldetem Nutzer.

**Tests und Nachweis:** Tests decken Wiederholung, Parallelität, verlorene Antwort und Prozessneustart ab.

Relevante Tests: [tests/workout-logging.test.ts](/Users/kevingusmao/Desktop/Arnold/tests/workout-logging.test.ts:1), [tests/workout-mcp.test.ts](/Users/kevingusmao/Desktop/Arnold/tests/workout-mcp.test.ts:1), [tests/workout-restart.test.ts](/Users/kevingusmao/Desktop/Arnold/tests/workout-restart.test.ts:1), [tests/connected-journey.test.ts](/Users/kevingusmao/Desktop/Arnold/tests/connected-journey.test.ts:1).

**Offen, problematisch oder verbesserbar:** Die Sperren sind pro Prozess. Während zweier gleichzeitig laufender Revisionen besteht keine verteilte Genau-einmal-Garantie. S001 behandelt außerdem endgültige Ablehnung und erneuten Versuch differenzierter.

**Nächster sinnvoller Schritt:** Den Einzelprozessumfang ausdrücklich halten und vor Mehrinstanzbetrieb ein gemeinsam transaktionales Journal mit verteiltem Schutz einführen.


### 03.11 · Alle Tools auch ohne grafische Benutzeroberfläche testen

**Fortschritt: 100 % · Erfüllt im geprüften Umfang.**

**Einordnung:** Für die vorhandenen Werkzeuggruppen existieren Tests ohne grafische Oberfläche.

**So ist es heute umgesetzt:** Vitest verbindet echte lokale HTTP-/MCP-Clients mit den registrierten Werkzeugen. Plan, Training, Dashboard, Einrichtung und Google-Abläufe lassen sich dadurch unabhängig von React überprüfen. Google und OIDC werden dabei kontrolliert simuliert.

**Maßgebliche Dateien und ihre Aufgabe:**

- [package.json](/Users/kevingusmao/Desktop/Arnold/package.json:1): Abhängigkeiten, Node-Version und ausführbare Projektbefehle.
- [src/server/mcp-arnold.ts](/Users/kevingusmao/Desktop/Arnold/src/server/mcp-arnold.ts:1): Registriert Dashboard-, Historien- und Fortschrittswerkzeuge.
- [src/server/mcp-workout.ts](/Users/kevingusmao/Desktop/Arnold/src/server/mcp-workout.ts:1): Registriert Werkzeuge zum Starten, Speichern und Korrigieren von Trainings.
- [src/server/mcp-plan.ts](/Users/kevingusmao/Desktop/Arnold/src/server/mcp-plan.ts:1): Registriert lesende und schreibende Planwerkzeuge.
- [src/server/mcp-onboarding.ts](/Users/kevingusmao/Desktop/Arnold/src/server/mcp-onboarding.ts:1): Führt ChatGPT durch die Einrichtung und Planbestätigung.
- [src/server/connected/mcp-google.ts](/Users/kevingusmao/Desktop/Arnold/src/server/connected/mcp-google.ts:1): Verbindung, Fertigstellung, Verbindungsstatus und Trennen von Google.

**Tests und Nachweis:** Die Werkzeugtests sind Teil der 1.261 bestandenen Unit-/Integrationstests des geprüften Hauptstands.

Relevante Tests: [tests/arnold-mcp.test.ts](/Users/kevingusmao/Desktop/Arnold/tests/arnold-mcp.test.ts:1), [tests/workout-mcp.test.ts](/Users/kevingusmao/Desktop/Arnold/tests/workout-mcp.test.ts:1), [tests/plan-mcp.test.ts](/Users/kevingusmao/Desktop/Arnold/tests/plan-mcp.test.ts:1), [tests/onboarding-mcp.test.ts](/Users/kevingusmao/Desktop/Arnold/tests/onboarding-mcp.test.ts:1), [tests/connected-journey.test.ts](/Users/kevingusmao/Desktop/Arnold/tests/connected-journey.test.ts:1).

**Offen, problematisch oder verbesserbar:** Damit ist die Grundprüfung ohne UI erfüllt. Sie ersetzt keine Modell-Evaluation natürlicher Sprache und keine erneute echte Google-Abnahme.

**Nächster sinnvoller Schritt:** Neue Werkzeuge zuerst über denselben Transport prüfen und erst danach eine Oberfläche daraufsetzen.


<a id="bereich-04"></a>

## 04 · Berechnungs-Engine


### 04.01 · Trainingsvolumen berechnen

**Fortschritt: 100 % · Erfüllt im geprüften Umfang.**

**Einordnung:** Trainingsvolumen wird mit dokumentierten Lastkonventionen berechnet.

**So ist es heute umgesetzt:** Die Engine berechnet je Satz die tatsächlich dokumentierte externe Last mal passende Wiederholungszahl. Freie Gewichte, Maschinenanzeigen und Zusatzlast werden getrennt geführt. Aufwärmen und ergänzende Sätze sind unterscheidbar. Unbekannte Körpergewichtslast wird nicht als null Kilogramm ausgegeben.

**Maßgebliche Dateien und ihre Aufgabe:**

- [src/analytics/load.ts](/Users/kevingusmao/Desktop/Arnold/src/analytics/load.ts:96): Berechnet Satzlast, Volumen und e1RM nach Ausführungsregeln.
- [src/analytics/volume.ts](/Users/kevingusmao/Desktop/Arnold/src/analytics/volume.ts:1): Trennt Arbeitssätze, Aufwärmen und nicht vergleichbare Volumenarten.

**Tests und Nachweis:** Kontrollfälle prüfen unter anderem zwei gleichzeitig bewegte Hanteln und alternierende Wiederholungen.

Relevante Tests: [tests/analytics-load.test.ts](/Users/kevingusmao/Desktop/Arnold/tests/analytics-load.test.ts:1), [tests/analytics-volume.test.ts](/Users/kevingusmao/Desktop/Arnold/tests/analytics-volume.test.ts:1), [tests/analytics-qa-regressions.test.ts](/Users/kevingusmao/Desktop/Arnold/tests/analytics-qa-regressions.test.ts:1).

**Offen, problematisch oder verbesserbar:** Im unterstützten Krafttrainingsumfang ist die Berechnung umgesetzt. Ein physiologisch vollständiges Körpergewichtsvolumen wird ausdrücklich nicht behauptet.

**Nächster sinnvoller Schritt:** Die getrennten Volumenarten in jeder neuen Anzeige weiter kenntlich machen.


### 04.02 · Trainingstage, Einheiten und Sätze pro Woche berechnen

**Fortschritt: 100 % · Erfüllt im geprüften Umfang.**

**Einordnung:** Wochenzahlen für Einheiten, Trainingstage und Sätze sind vorhanden.

**So ist es heute umgesetzt:** Wochen beginnen montags. Die Engine zählt unterschiedliche Workout-IDs als Einheiten und unterschiedliche lokale Daten als Trainingstage. Arbeitssätze, Aufwärmsätze und andere Satzarten bleiben unterscheidbar. Ein absichtlich leerer Wochenabschnitt bleibt in Zeitreihen sichtbar.

**Maßgebliche Dateien und ihre Aufgabe:**

- [src/analytics/activity.ts](/Users/kevingusmao/Desktop/Arnold/src/analytics/activity.ts:128): Zählt Trainingstage und Einheiten und berechnet Wochenserien.
- [src/analytics/volume.ts](/Users/kevingusmao/Desktop/Arnold/src/analytics/volume.ts:1): Trennt Arbeitssätze, Aufwärmen und nicht vergleichbare Volumenarten.
- [src/analytics/trends.ts](/Users/kevingusmao/Desktop/Arnold/src/analytics/trends.ts:1): Vergleicht Wochen und Monate.
- [src/analytics/period.ts](/Users/kevingusmao/Desktop/Arnold/src/analytics/period.ts:1): Behandelt Kalenderdaten und Wochenanfänge.

**Tests und Nachweis:** Tests decken Wochen- und Jahresgrenzen, mehrere Trainings pro Tag und leere Zeiträume ab.

Relevante Tests: [tests/analytics-activity.test.ts](/Users/kevingusmao/Desktop/Arnold/tests/analytics-activity.test.ts:1), [tests/analytics-volume.test.ts](/Users/kevingusmao/Desktop/Arnold/tests/analytics-volume.test.ts:1), [tests/analytics-dashboard.test.ts](/Users/kevingusmao/Desktop/Arnold/tests/analytics-dashboard.test.ts:1).

**Offen, problematisch oder verbesserbar:** Die Berechnungsschicht erfüllt den Punkt. Eine andere sichtbare Zielbeschriftung in der Wochenkarte ist ein UI-Thema unter 05.03.

**Nächster sinnvoller Schritt:** Zähler in Produkttexten immer mit ihrer tatsächlichen Einheit beschriften.


### 04.03 · Geschätzte Maximalkraft (e1RM) berechnen

**Fortschritt: 100 % · Erfüllt im geprüften Umfang.**

**Einordnung:** Die geschätzte Maximalkraft wird als Schätzung mit klar begrenztem Anwendungsbereich berechnet.

**So ist es heute umgesetzt:** Die Lastanalyse verwendet Epley für geeignete Arbeitssätze mit ein bis zehn Wiederholungen; bei genau einer Wiederholung bleibt der Wert die dokumentierte Last. Kurzhantelwerte bleiben je Gerät, Maschinenwerte gerätespezifisch. Eigengewicht, Unterstützung und unklare alternierende Wiederholungen liefern keine erfundene Schätzung.

**Maßgebliche Dateien und ihre Aufgabe:**

- [src/analytics/load.ts](/Users/kevingusmao/Desktop/Arnold/src/analytics/load.ts:96): Berechnet Satzlast, Volumen und e1RM nach Ausführungsregeln.
- [src/server/arnold-presenter.ts](/Users/kevingusmao/Desktop/Arnold/src/server/arnold-presenter.ts:1): Übersetzt Berechnungen in verständliche Dashboard-Daten.

**Tests und Nachweis:** Numerische Tests prüfen acht Wiederholungen, Einzelwiederholung, Bereichsgrenzen und nicht vergleichbare Lastarten.

Relevante Tests: [tests/analytics-load.test.ts](/Users/kevingusmao/Desktop/Arnold/tests/analytics-load.test.ts:1), [tests/analytics-records.test.ts](/Users/kevingusmao/Desktop/Arnold/tests/analytics-records.test.ts:1).

**Offen, problematisch oder verbesserbar:** Die Formel ist im unterstützten Bereich umgesetzt. Das ist keine gemessene tatsächliche Maximalkraft und keine medizinische Aussage.

**Nächster sinnvoller Schritt:** Die Bezeichnung geschätzt und die Lastbasis in UI und Chat konsequent beibehalten.


### 04.04 · Persönliche Rekorde erkennen und erste Baselines korrekt behandeln

**Fortschritt: 100 % · Erfüllt im geprüften Umfang.**

**Einordnung:** Erste Ausgangswerte und spätere Bestleistungen werden getrennt behandelt.

**So ist es heute umgesetzt:** Die Engine läuft zeitlich durch vergleichbare Leistungen. Der erste gültige Wert erhält die Art initial. Nur ein größerer späterer Wert wird zur improvement. Gleichstände sind kein neuer Rekord. Ausführung, Seite und Lastdefinition bilden getrennte Vergleichsklassen.

**Maßgebliche Dateien und ihre Aufgabe:**

- [src/analytics/records.ts](/Users/kevingusmao/Desktop/Arnold/src/analytics/records.ts:112): Unterscheidet erste Ausgangswerte von echten Verbesserungen.
- [src/analytics/load.ts](/Users/kevingusmao/Desktop/Arnold/src/analytics/load.ts:96): Berechnet Satzlast, Volumen und e1RM nach Ausführungsregeln.

**Tests und Nachweis:** Tests prüfen Baseline, Verbesserung, Gleichstand, geringeren Folgewert und unvergleichbare Ausführungsarten.

Relevante Tests: [tests/analytics-records.test.ts](/Users/kevingusmao/Desktop/Arnold/tests/analytics-records.test.ts:1), [tests/analytics-qa-regressions.test.ts](/Users/kevingusmao/Desktop/Arnold/tests/analytics-qa-regressions.test.ts:1).

**Offen, problematisch oder verbesserbar:** Im vorhandenen Kennzahlenumfang ist die Rekorderkennung umgesetzt. Eine gefilterte Auswertung findet Rekorde im gewählten Fenster, nicht automatisch Allzeitrekorde.

**Nächster sinnvoller Schritt:** Bei jeder Anzeige klar sagen, ob sich die Bestleistung auf einen Zeitraum oder die gesamte Historie bezieht.


### 04.05 · Trainingshäufigkeit und Streaks berechnen

**Fortschritt: 100 % · Erfüllt im geprüften Umfang.**

**Einordnung:** Trainingshäufigkeit und Wochenserien werden berechnet, ohne ein Ziel zu erfinden.

**So ist es heute umgesetzt:** Die Engine ermittelt Einheiten beziehungsweise Trainingstage pro Woche. Eine Serie wird nur berechnet, wenn ein Wochenziel in Trainingstagen ausdrücklich vorliegt. Eine noch laufende Woche zerstört eine bereits erreichte Serie nicht; sie verlängert sie erst nach Erreichen ihres Ziels.

**Maßgebliche Dateien und ihre Aufgabe:**

- [src/analytics/activity.ts](/Users/kevingusmao/Desktop/Arnold/src/analytics/activity.ts:128): Zählt Trainingstage und Einheiten und berechnet Wochenserien.
- [src/analytics/activity.ts](/Users/kevingusmao/Desktop/Arnold/src/analytics/activity.ts:63): Berechnet eine Wochenserie nur mit ausdrücklich gesetztem Ziel.

**Tests und Nachweis:** Tests kontrollieren fehlendes Ziel, erreichte laufende Woche, leere laufende Woche und eine verpasste abgeschlossene Woche.

Relevante Tests: [tests/analytics-activity.test.ts](/Users/kevingusmao/Desktop/Arnold/tests/analytics-activity.test.ts:1).

**Offen, problematisch oder verbesserbar:** Der Berechnungspunkt ist erfüllt. Dauerhaftes Einstellen und konsistentes Anzeigen des Wochenziels sind separate UI-/Produktaufgaben.

**Nächster sinnvoller Schritt:** Die Zielverwaltung mit dem Onboarding-Plan und der Wochenkarte fachlich vereinheitlichen.


### 04.06 · Übungsverläufe nach Datum und Zeitraum auswerten

**Fortschritt: 100 % · Erfüllt im geprüften Umfang.**

**Einordnung:** Übungsverläufe sind nach Datum und Zeitraum auswertbar.

**So ist es heute umgesetzt:** Die Engine sammelt echte Sätze einer Übung, gruppiert Messpunkte und liefert Last, Wiederholungen, Volumen oder e1RM. Unterschiedliche Ausführungen bleiben beschrieben; bei Lastkurven führt eine bestimmte Vergleichsklasse die Hauptserie an. Fehlende Zeitpunkte werden nicht durch erfundene Messungen aufgefüllt.

**Maßgebliche Dateien und ihre Aufgabe:**

- [src/analytics/progress.ts](/Users/kevingusmao/Desktop/Arnold/src/analytics/progress.ts:1): Berechnet Übungsverläufe mit getrennten Ausführungsvarianten.
- [src/analytics/validation.ts](/Users/kevingusmao/Desktop/Arnold/src/analytics/validation.ts:1): Validiert Filter und kennzeichnet nicht berechenbare Werte.
- [src/server/mcp-arnold.ts](/Users/kevingusmao/Desktop/Arnold/src/server/mcp-arnold.ts:1): Registriert Dashboard-, Historien- und Fortschrittswerkzeuge.

**Tests und Nachweis:** Tests prüfen Zeitfilter, zwei Einheiten an einem Tag, historische Übungsreferenzen und leere Verläufe.

Relevante Tests: [tests/analytics-progress.test.ts](/Users/kevingusmao/Desktop/Arnold/tests/analytics-progress.test.ts:1), [tests/arnold-mcp.test.ts](/Users/kevingusmao/Desktop/Arnold/tests/arnold-mcp.test.ts:1).

**Offen, problematisch oder verbesserbar:** Die Berechnung ist vorhanden. Die Hauptkurve benennt ihre genaue Ausführung/Seite noch nicht so klar wie die spätere S001-Korrektur.

**Nächster sinnvoller Schritt:** Den mathematischen Vertrag erhalten und die Vergleichsklasse an der Kurve verständlich ergänzen.


### 04.07 · Körpergewichtstrends und Kardio-Statistiken berechnen

**Fortschritt: 0 % · Nicht umgesetzt / kein Liefernachweis.**

**Einordnung:** Es gibt noch keine Körpergewichtstrends oder Kardio-Statistiken.

**So ist es heute umgesetzt:** Die aktuelle Engine verarbeitet Krafttrainingssätze. Sie kennt den Lasttyp Körpergewichtsübung und eine optionale Gewichtsangabe im Onboarding, aber keine datierte Folge persönlicher Körpergewichtsmessungen. Für Ausdauer fehlen Datentypen und Berechnungsmodule vollständig.

**Maßgebliche Dateien und ihre Aufgabe:**

- [src/analytics/index.ts](/Users/kevingusmao/Desktop/Arnold/src/analytics/index.ts:1): Öffentlicher Einstieg in die reine Berechnungsschicht.
- [src/shared/arnold-schema-v1.ts](/Users/kevingusmao/Desktop/Arnold/src/shared/arnold-schema-v1.ts:5): Legt die sechs Tabellen, Spalten, IDs und Datenregeln fest.
- [src/shared/onboarding-contract.ts](/Users/kevingusmao/Desktop/Arnold/src/shared/onboarding-contract.ts:1): Fragen, Profilfelder und Zustände der Einrichtung.

**Tests und Nachweis:** Die Modul- und Datensuche zeigt keine entsprechende Messreihe oder Kardio-Auswertung.

**Offen, problematisch oder verbesserbar:** Fehlend sind beispielsweise Gewichtsmittelwerte und -veränderungen sowie Kardiodauer, Strecke und daraus fachlich definierte Kennzahlen.

**Nächster sinnvoller Schritt:** Die benötigten Messdaten und aussagekräftigen Kennzahlen gemeinsam mit der V1-Abgrenzung festlegen.


### 04.08 · Fehlende und ungültige Daten sinnvoll behandeln

**Fortschritt: 100 % · Erfüllt im geprüften Umfang.**

**Einordnung:** Fehlende oder nicht sinnvoll berechenbare Daten erhalten ausdrückliche Zustände und Gründe.

**So ist es heute umgesetzt:** Werte können gültig, teilweise, nicht verfügbar oder ungültig sein. Eine unbekannte Last wird nicht still null. Abgebrochene Trainings erzeugen keine abgeschlossenen Leistungen oder Rekorde. Strukturell falsche Tabellen werden zurückgewiesen, statt automatisch auf Demo-Daten umzuschalten.

**Maßgebliche Dateien und ihre Aufgabe:**

- [src/analytics/quality.ts](/Users/kevingusmao/Desktop/Arnold/src/analytics/quality.ts:1): Macht eingeschränkte Datenqualität sichtbar.
- [src/analytics/eligibility.ts](/Users/kevingusmao/Desktop/Arnold/src/analytics/eligibility.ts:1): Bestimmt, welche Daten für welche Kennzahl zählen.
- [src/analytics/validation.ts](/Users/kevingusmao/Desktop/Arnold/src/analytics/validation.ts:1): Validiert Filter und kennzeichnet nicht berechenbare Werte.
- [src/server/arnold-sheets-read-adapter.ts](/Users/kevingusmao/Desktop/Arnold/src/server/arnold-sheets-read-adapter.ts:1): Liest und validiert die sechs Google-Tabellen.
- [src/server/arnold-presenter.ts](/Users/kevingusmao/Desktop/Arnold/src/server/arnold-presenter.ts:1): Übersetzt Berechnungen in verständliche Dashboard-Daten.

**Tests und Nachweis:** Tests prüfen fehlende Last, unzulässige Kombinationen, leere Auswahl, ungültige Quellen und Statusfilter.

Relevante Tests: [tests/analytics-load.test.ts](/Users/kevingusmao/Desktop/Arnold/tests/analytics-load.test.ts:1), [tests/analytics-activity.test.ts](/Users/kevingusmao/Desktop/Arnold/tests/analytics-activity.test.ts:1), [tests/analytics-qa-regressions.test.ts](/Users/kevingusmao/Desktop/Arnold/tests/analytics-qa-regressions.test.ts:1), [tests/arnold-google-transport.test.ts](/Users/kevingusmao/Desktop/Arnold/tests/arnold-google-transport.test.ts:1).

**Offen, problematisch oder verbesserbar:** Im geprüften Engine-Vertrag ist der Punkt erfüllt. Die verständliche Erklärung jedes Sonderfalls in allen UI-Zuständen kann weiter verbessert werden.

**Nächster sinnvoller Schritt:** Die maschinenlesbaren Gründe für neue Kennzahlen beibehalten und bei Nutzerfragen verständlich übersetzen.


### 04.09 · Alle Formeln mit automatisierten Tests überprüfen

**Fortschritt: 100 % · Erfüllt im geprüften Umfang.**

**Einordnung:** Für die vorhandenen Formeln liegen automatisierte numerische Prüfungen vor.

**So ist es heute umgesetzt:** Die Tests vergleichen Ergebnisse mit festgelegten Erwartungswerten für Volumen, Epley, Rekorde, Wochen und Planerfüllung. Architekturtests verhindern zudem, dass die reine Rechenschicht unbemerkt auf Server- oder UI-Zustand zugreift. Frühere unabhängige QA-Befunde sind als Gegenproben erhalten.

**Maßgebliche Dateien und ihre Aufgabe:**

- [src/analytics/index.ts](/Users/kevingusmao/Desktop/Arnold/src/analytics/index.ts:1): Öffentlicher Einstieg in die reine Berechnungsschicht.
- [src/analytics/load.ts](/Users/kevingusmao/Desktop/Arnold/src/analytics/load.ts:96): Berechnet Satzlast, Volumen und e1RM nach Ausführungsregeln.
- [src/analytics/activity.ts](/Users/kevingusmao/Desktop/Arnold/src/analytics/activity.ts:128): Zählt Trainingstage und Einheiten und berechnet Wochenserien.
- [src/analytics/records.ts](/Users/kevingusmao/Desktop/Arnold/src/analytics/records.ts:112): Unterscheidet erste Ausgangswerte von echten Verbesserungen.

**Tests und Nachweis:** Die Analytics-Suiten bestehen im letzten vollständigen Lauf des aktuellen Hauptcommits.

Relevante Tests: [tests/analytics-load.test.ts](/Users/kevingusmao/Desktop/Arnold/tests/analytics-load.test.ts:1), [tests/analytics-activity.test.ts](/Users/kevingusmao/Desktop/Arnold/tests/analytics-activity.test.ts:1), [tests/analytics-volume.test.ts](/Users/kevingusmao/Desktop/Arnold/tests/analytics-volume.test.ts:1), [tests/analytics-records.test.ts](/Users/kevingusmao/Desktop/Arnold/tests/analytics-records.test.ts:1), [tests/analytics-progress.test.ts](/Users/kevingusmao/Desktop/Arnold/tests/analytics-progress.test.ts:1), [tests/analytics-qa-regressions.test.ts](/Users/kevingusmao/Desktop/Arnold/tests/analytics-qa-regressions.test.ts:1), [tests/analytics-architecture.test.ts](/Users/kevingusmao/Desktop/Arnold/tests/analytics-architecture.test.ts:1).

**Offen, problematisch oder verbesserbar:** Das belegt die vorhandenen Formeln und getesteten Fälle, keine mathematische Vollständigkeit aller denkbaren Trainingssituationen. Noch nicht gebaute Gewichts-/Kardioformeln sind nicht mitgemeint.

**Nächster sinnvoller Schritt:** Bei jeder neuen Fachformel zuerst unabhängig ausgerechnete Beispiele und Grenzfälle aufnehmen.


<a id="bereich-05"></a>

## 05 · MCP Apps UI – Frontend


### 05.01 · UI-Technologie und Designsystem festlegen

**Fortschritt: 100 % · Erfüllt im geprüften Umfang.**

**Einordnung:** Technologie und eine gemeinsame Gestaltung sind festgelegt.

**So ist es heute umgesetzt:** Die Oberfläche verwendet React, TypeScript, Recharts und gemeinsame CSS-Regeln. Sie wird als eigenständiges HTML-Bundle in den Chat eingebettet. Der jüngste Produktansatz zeigt einzelne Karten für Training, Woche, Verlauf, Fortschritt und Plan statt einer großen App mit eigenem Rahmen.

**Maßgebliche Dateien und ihre Aufgabe:**

- [package.json](/Users/kevingusmao/Desktop/Arnold/package.json:1): Abhängigkeiten, Node-Version und ausführbare Projektbefehle.
- [src/ui/ArnoldDashboardApp.tsx](/Users/kevingusmao/Desktop/Arnold/src/ui/ArnoldDashboardApp.tsx:1): Steuert die Kartenansichten und Navigation.
- [src/ui/glass.css](/Users/kevingusmao/Desktop/Arnold/src/ui/glass.css:1): Gemeinsame Designbasis und responsive Gestaltungsregeln.
- [src/ui/cards.css](/Users/kevingusmao/Desktop/Arnold/src/ui/cards.css:1): Layout und Bedienung der Chat-Karten.
- [docs/GUIDE.md](/Users/kevingusmao/Desktop/Arnold/docs/GUIDE.md:1): Dokumentiert Architektur, Datenregeln und bekannte Grenzen.

**Tests und Nachweis:** Build und Browser-Tests prüfen die gebaute Oberfläche; der Guide beschreibt die Kartenregeln.

Relevante Tests: [tests/e2e/arnold-dashboard.spec.ts](/Users/kevingusmao/Desktop/Arnold/tests/e2e/arnold-dashboard.spec.ts:1), [tests/e2e/onboarding.spec.ts](/Users/kevingusmao/Desktop/Arnold/tests/e2e/onboarding.spec.ts:1).

**Offen, problematisch oder verbesserbar:** Die technische Designbasis ist vorhanden. Die endgültigen Onboarding-Fragen sind eine offene Produktentscheidung und keine fehlende UI-Technologie.

**Nächster sinnvoller Schritt:** Künftige Ansichten an dieselben Karten- und Bedienregeln anschließen.


### 05.02 · Responsive Dashboard für Desktop und Smartphone gestalten

**Fortschritt: 75 % · Weitgehend umgesetzt.**

**Einordnung:** Desktop und schmale Smartphone-Größen sind umgesetzt und automatisiert geprüft.

**So ist es heute umgesetzt:** Responsive CSS, flexible Karten und angepasste Bedienfelder erlauben die Nutzung in einem schmalen Chatbereich. Die Browser-Tests prüfen unter anderem 390-Pixel-Ansichten, horizontales Überlaufen, Tastatur und Theme. Die Oberfläche lädt keine externen Schriften oder Bilddateien nach.

**Maßgebliche Dateien und ihre Aufgabe:**

- [src/ui/cards.css](/Users/kevingusmao/Desktop/Arnold/src/ui/cards.css:1): Layout und Bedienung der Chat-Karten.
- [src/ui/glass.css](/Users/kevingusmao/Desktop/Arnold/src/ui/glass.css:1): Gemeinsame Designbasis und responsive Gestaltungsregeln.
- [src/ui/ArnoldDashboardApp.tsx](/Users/kevingusmao/Desktop/Arnold/src/ui/ArnoldDashboardApp.tsx:1): Steuert die Kartenansichten und Navigation.
- [src/ui/components/TrendChart.tsx](/Users/kevingusmao/Desktop/Arnold/src/ui/components/TrendChart.tsx:1): Diagramme mit zugänglichen Text-/Tabellenalternativen.

**Tests und Nachweis:** Die aktuelle Chromium-Suite enthält Desktop-, mobile Größen- und Accessibility-Fälle.

Relevante Tests: [tests/e2e/arnold-dashboard.spec.ts](/Users/kevingusmao/Desktop/Arnold/tests/e2e/arnold-dashboard.spec.ts:1), [tests/e2e/arnold-v2-qa.spec.ts](/Users/kevingusmao/Desktop/Arnold/tests/e2e/arnold-v2-qa.spec.ts:1), [tests/e2e/onboarding.spec.ts](/Users/kevingusmao/Desktop/Arnold/tests/e2e/onboarding.spec.ts:1).

**Offen, problematisch oder verbesserbar:** Echte Smartphones, Safari und Firefox sind nicht nachgewiesen. Die stärkere S001-Prüfung der Dokumentwurzelbreite und der versteckte Tabellencontainer sind noch nicht übernommen.

**Nächster sinnvoller Schritt:** Die dokumentweiten Layout-Gegenproben übernehmen und vor Beta mindestens ein echtes Smartphone sowie Safari prüfen.


### 05.03 · Startübersicht mit Kennzahlen und Wochenziel bauen

**Fortschritt: 75 % · Weitgehend umgesetzt.**

**Einordnung:** Kennzahlen und Wochenübersicht sind vorhanden; die Zieldefinition ist noch nicht überall konsistent.

**So ist es heute umgesetzt:** WeekCard zeigt Wochenzahlen und ein Ziel aus days_per_week des aktiven Plans. Die Überschrift verwendet dabei die Zahl der Workouts. Die Engine kennt daneben ein separates Ziel in Trainingstagen und liefert bei fehlender ausdrücklicher Angabe keinen Streak. Das sind zwei unterschiedliche Zielbegriffe.

**Maßgebliche Dateien und ihre Aufgabe:**

- [src/ui/views/WeekCard.tsx](/Users/kevingusmao/Desktop/Arnold/src/ui/views/WeekCard.tsx:1): Zeigt Wochenzahlen und ein aus dem Plan abgeleitetes Ziel.
- [src/analytics/activity.ts](/Users/kevingusmao/Desktop/Arnold/src/analytics/activity.ts:128): Zählt Trainingstage und Einheiten und berechnet Wochenserien.
- [src/analytics/activity.ts](/Users/kevingusmao/Desktop/Arnold/src/analytics/activity.ts:63): Berechnet eine Wochenserie nur mit ausdrücklich gesetztem Ziel.
- [src/server/arnold-presenter.ts](/Users/kevingusmao/Desktop/Arnold/src/server/arnold-presenter.ts:1): Übersetzt Berechnungen in verständliche Dashboard-Daten.

**Tests und Nachweis:** Die Wochenkarte ist im Browser geprüft; die Engine testet ausdrücklich zwei Workouts, aber nur einen Trainingstag am selben Datum.

Relevante Tests: [tests/analytics-activity.test.ts](/Users/kevingusmao/Desktop/Arnold/tests/analytics-activity.test.ts:1), [tests/e2e/arnold-dashboard.spec.ts](/Users/kevingusmao/Desktop/Arnold/tests/e2e/arnold-dashboard.spec.ts:1).

**Offen, problematisch oder verbesserbar:** Ein Tag mit zwei Einheiten kann in der Karte zwei Fortschrittsschritte ergeben, obwohl das Planfeld Trainingstage meint. Die Tagesmarkierungen nutzen außerdem nur recent_workouts, standardmäßig fünf Einheiten, statt einer vollständigen Wochenliste.

**Nächster sinnvoller Schritt:** Einheitenziel und Trainingstageziel fachlich trennen oder vereinheitlichen; Tagesmarkierungen aus vollständigen Wochenaktivitäten erzeugen.


### 05.04 · Interaktive Trainingshistorie mit Filtern entwickeln

**Fortschritt: 100 % · Erfüllt im geprüften Umfang.**

**Einordnung:** Eine filterbare Trainingshistorie mit einzelnen Trainingsdetails ist vorhanden.

**So ist es heute umgesetzt:** WorkoutHistoryView fragt die Historie über den gemeinsamen MCP-Client ab. Nutzer können Zeitraum und weitere Auswahlkriterien einschränken und eine einzelne Einheit mit ihren Übungen und Sätzen ansehen. Historische Rohwerte und Status werden angezeigt, statt aus dem aktuellen Plan neu berechnet zu werden.

**Maßgebliche Dateien und ihre Aufgabe:**

- [src/ui/views/WorkoutHistoryView.tsx](/Users/kevingusmao/Desktop/Arnold/src/ui/views/WorkoutHistoryView.tsx:1): Filterbare Trainingshistorie und Details einzelner Einheiten.
- [src/server/mcp-arnold.ts](/Users/kevingusmao/Desktop/Arnold/src/server/mcp-arnold.ts:1): Registriert Dashboard-, Historien- und Fortschrittswerkzeuge.
- [src/server/arnold-presenter.ts](/Users/kevingusmao/Desktop/Arnold/src/server/arnold-presenter.ts:1): Übersetzt Berechnungen in verständliche Dashboard-Daten.
- [src/ui/client/ArnoldMcpClient.ts](/Users/kevingusmao/Desktop/Arnold/src/ui/client/ArnoldMcpClient.ts:1): Gemeinsamer UI-Zugriff auf MCP-Werkzeuge und Aktualitäts-/Cachelogik.

**Tests und Nachweis:** Browser-Tests filtern die Historie und öffnen eine Einheit; MCP-Tests prüfen die Datenlieferung.

Relevante Tests: [tests/e2e/arnold-dashboard.spec.ts](/Users/kevingusmao/Desktop/Arnold/tests/e2e/arnold-dashboard.spec.ts:1), [tests/arnold-mcp.test.ts](/Users/kevingusmao/Desktop/Arnold/tests/arnold-mcp.test.ts:1).

**Offen, problematisch oder verbesserbar:** Die Kernanforderung ist umgesetzt. Bei sehr langen Historien sind zusätzliche Bedien- und Leistungstests sinnvoll, aber kein fehlender Grundbaustein.

**Nächster sinnvoller Schritt:** Historische Details und aktive Filter bei zukünftigen UI-Änderungen erhalten.


### 05.05 · Übungsdetails und Fortschrittsdiagramme entwickeln

**Fortschritt: 75 % · Weitgehend umgesetzt.**

**Einordnung:** Übungsdetails und Kurven sind gebaut; die hervorgehobene Ausführungsvariante ist nicht klar genug beschriftet.

**So ist es heute umgesetzt:** ExerciseProgressView zeigt Kennzahlen, Messpunkte und Ausführungsdetails. Recharts zeichnet die von der Engine gelieferten Serien. Lastdefinitionen werden teilweise ergänzt. Bei Last und e1RM kann die Engine eine bestimmte Vergleichsklasse auswählen, deren konkrete Seite/Ausführung nicht unmittelbar an Kurve und Hauptzahl erscheint.

**Maßgebliche Dateien und ihre Aufgabe:**

- [src/ui/views/ExerciseProgressView.tsx](/Users/kevingusmao/Desktop/Arnold/src/ui/views/ExerciseProgressView.tsx:1): Fortschrittsansicht mit Kennzahlen, Kurven und Ausführungsdetails.
- [src/ui/components/TrendChart.tsx](/Users/kevingusmao/Desktop/Arnold/src/ui/components/TrendChart.tsx:1): Diagramme mit zugänglichen Text-/Tabellenalternativen.
- [src/analytics/progress.ts](/Users/kevingusmao/Desktop/Arnold/src/analytics/progress.ts:1): Berechnet Übungsverläufe mit getrennten Ausführungsvarianten.
- [src/server/arnold-presenter.ts](/Users/kevingusmao/Desktop/Arnold/src/server/arnold-presenter.ts:1): Übersetzt Berechnungen in verständliche Dashboard-Daten.

**Tests und Nachweis:** Tests prüfen Kurven, leere Übungen, Lastkonvention und schmale Darstellung.

Relevante Tests: [tests/analytics-progress.test.ts](/Users/kevingusmao/Desktop/Arnold/tests/analytics-progress.test.ts:1), [tests/e2e/arnold-dashboard.spec.ts](/Users/kevingusmao/Desktop/Arnold/tests/e2e/arnold-dashboard.spec.ts:1), [tests/e2e/arnold-v2-qa.spec.ts](/Users/kevingusmao/Desktop/Arnold/tests/e2e/arnold-v2-qa.spec.ts:1).

**Offen, problematisch oder verbesserbar:** Die spätere S001-Beschriftung für dominante Variante und Seite fehlt. Ein Nutzer kann sonst zwei unterschiedlich ausgeführte Leistungen zu leicht als dieselbe Kurve verstehen.

**Nächster sinnvoller Schritt:** Die Vergleichsklasse direkt an Hauptkennzahl und Kurve benennen; eine bewusst auswählbare Variante wäre eine spätere Erweiterung.


### 05.06 · Workout-Logger mit Gewicht, Wiederholungen, Sätzen und RPE bauen

**Fortschritt: 75 % · Weitgehend umgesetzt.**

**Einordnung:** Der Logger unterstützt Gewicht, Wiederholungen, Sätze und vereinfachte Anstrengung; eine echte RPE-Eingabe fehlt.

**So ist es heute umgesetzt:** TrainingCard führt Satz für Satz durch das Training. Gewicht und Wiederholungen sind veränderbar, gespeicherte Sätze korrigierbar. Leicht, Passt und Am Limit werden als RIR 4, 2 und 0 gespeichert. RIR bedeutet verbleibende Wiederholungen; RPE wäre eine andere Anstrengungsskala. Das Backend kann RPE bereits speichern.

**Maßgebliche Dateien und ihre Aufgabe:**

- [src/ui/views/TrainingCard.tsx](/Users/kevingusmao/Desktop/Arnold/src/ui/views/TrainingCard.tsx:1): Training, Satzspeicherung, Korrekturen und Zusammenfassung als Karte.
- [src/ui/hooks/useWorkoutLogger.ts](/Users/kevingusmao/Desktop/Arnold/src/ui/hooks/useWorkoutLogger.ts:1): Verhindert Doppelklicks und behält unbestätigte Schreibaufträge.
- [src/shared/workout-contract.ts](/Users/kevingusmao/Desktop/Arnold/src/shared/workout-contract.ts:39): Verbindlicher Ein-/Ausgabevertrag für Trainingsänderungen.
- [src/server/workout/service.ts](/Users/kevingusmao/Desktop/Arnold/src/server/workout/service.ts:1): Prüft und verarbeitet Training, Satzkorrekturen und Abschluss.

**Tests und Nachweis:** Service- und Browser-Tests prüfen Speichern, Korrigieren, Abschluss und Wiederaufnahme.

Relevante Tests: [tests/workout-logging.test.ts](/Users/kevingusmao/Desktop/Arnold/tests/workout-logging.test.ts:1), [tests/e2e/workout-logger.spec.ts](/Users/kevingusmao/Desktop/Arnold/tests/e2e/workout-logger.spec.ts:1).

**Offen, problematisch oder verbesserbar:** Die ausdrücklich verlangte RPE-Bedienung ist nicht vorhanden. Vorhandenes RPE wird beim Bearbeiten erhalten, aber in der Karte nicht frei erfasst.

**Nächster sinnvoller Schritt:** Entscheiden, ob V1 RIR, RPE oder beides anbietet; die gewählte Skala im Produkt verständlich erklären.


### 05.07 · Trainingsplan-Ansicht und Bearbeitung ergänzen

**Fortschritt: 75 % · Weitgehend umgesetzt.**

**Einordnung:** Plananzeige und ein umfangreicher Editor existieren; einzelne Schema- und Wiederherstellungsgrenzen bleiben.

**So ist es heute umgesetzt:** Aktive Pläne werden unveränderlich angezeigt. Änderungen erzeugen einen Entwurf, in dem Einheiten und Übungen hinzugefügt, ersetzt, umsortiert und mit Zielen versehen werden. Die Aktivierung verlangt eine konkrete Freigabe. Der heutige Fix verhindert das Verwerfen eines aktiven Plans.

**Maßgebliche Dateien und ihre Aufgabe:**

- [src/ui/views/TrainingPlanEditorView.tsx](/Users/kevingusmao/Desktop/Arnold/src/ui/views/TrainingPlanEditorView.tsx:1): Zeigt und bearbeitet Trainingsplanentwürfe.
- [src/ui/components/plan.tsx](/Users/kevingusmao/Desktop/Arnold/src/ui/components/plan.tsx:1): Eingaben und Darstellung einzelner Planbestandteile.
- [src/ui/hooks/usePlanEditor.ts](/Users/kevingusmao/Desktop/Arnold/src/ui/hooks/usePlanEditor.ts:1): Verarbeitet Planbearbeitung, Konflikte und Wiederholungen.
- [src/server/plan/service.ts](/Users/kevingusmao/Desktop/Arnold/src/server/plan/service.ts:1): Verwaltet Entwürfe, Freigabe, Aktivierung und historische Pläne.
- [src/shared/plan-contract.ts](/Users/kevingusmao/Desktop/Arnold/src/shared/plan-contract.ts:446): Verbindlicher Vertrag für Planversionen und Bearbeitungen.

**Tests und Nachweis:** Browser-Tests bearbeiten und aktivieren Pläne. Service-Tests sichern Revisionen, Bestätigung und den Schutz aktiver Versionen ab.

Relevante Tests: [tests/plan-activation.test.ts](/Users/kevingusmao/Desktop/Arnold/tests/plan-activation.test.ts:1), [tests/plan-security.test.ts](/Users/kevingusmao/Desktop/Arnold/tests/plan-security.test.ts:1), [tests/e2e/plan-editor.spec.ts](/Users/kevingusmao/Desktop/Arnold/tests/e2e/plan-editor.spec.ts:1).

**Offen, problematisch oder verbesserbar:** Leere Trainingseinheiten können im heutigen Rohschema nicht als eigenständige dauerhafte Entität gespeichert werden. Verworfene Entwürfe werden über gleiche Aktivierungs-/Archivierungszeitpunkte dargestellt; S001 verbessert deren Kennzeichnung und Recovery.

**Nächster sinnvoller Schritt:** Schema-Grenzen sichtbar halten und die verbleibenden S001-Plan-/Recovery-Korrekturen gezielt abgleichen.


### 05.08 · Ansichten für Körpergewicht und Kardio entwickeln

**Fortschritt: 0 % · Nicht umgesetzt / kein Liefernachweis.**

**Einordnung:** Es gibt noch keine eigenständigen Ansichten für Körpergewicht und Kardio.

**So ist es heute umgesetzt:** Die vorhandenen Karten sind Training, Woche, Fortschritt, Historie und Plan. Eine Körpergewichtsangabe im Onboarding und Körpergewichtsübungen im Katalog sind keine Gewichtsstatistik. Eine Ansicht für Ausdauer-Einheiten oder deren Kennzahlen wurde nicht gefunden.

**Maßgebliche Dateien und ihre Aufgabe:**

- [src/ui/ArnoldDashboardApp.tsx](/Users/kevingusmao/Desktop/Arnold/src/ui/ArnoldDashboardApp.tsx:1): Steuert die Kartenansichten und Navigation.
- [src/ui/components/onboarding.tsx](/Users/kevingusmao/Desktop/Arnold/src/ui/components/onboarding.tsx:1): Person-/Trainingsfragen und Auswahlfelder.
- [src/ui/views/TrainingCard.tsx](/Users/kevingusmao/Desktop/Arnold/src/ui/views/TrainingCard.tsx:1): Training, Satzspeicherung, Korrekturen und Zusammenfassung als Karte.
- [src/shared/arnold-schema-v1.ts](/Users/kevingusmao/Desktop/Arnold/src/shared/arnold-schema-v1.ts:5): Legt die sechs Tabellen, Spalten, IDs und Datenregeln fest.

**Tests und Nachweis:** Die Ansichts-, Werkzeug- und Schemaübersicht enthält die beiden Bereiche nicht.

**Offen, problematisch oder verbesserbar:** Es fehlen Erfassung, Historie, Diagramme, sinnvolle Leerzustände und die zugrunde liegenden Daten-/Berechnungsfunktionen.

**Nächster sinnvoller Schritt:** Die Ansichten erst nach der Entscheidung über Datenmodell und V1-Umfang gestalten.


### 05.09 · Darstellung von Rekorden und Trendvergleichen ergänzen

**Fortschritt: 75 % · Weitgehend umgesetzt.**

**Einordnung:** Rekorde und Zeitentwicklungen werden dargestellt, aber noch nicht als vollständig erklärtes Vergleichssystem.

**So ist es heute umgesetzt:** Die Wochenkarte hebt eine Verbesserung hervor; die Fortschrittsansicht zeigt Rekorde und Zeitreihen. Die Engine unterscheidet Baselines und echte Verbesserungen sowie verschiedene Lastarten. Ein Teil der ausführlicheren Wochen-/Monatsvergleiche ist vor allem im Datenmodell vorhanden.

**Maßgebliche Dateien und ihre Aufgabe:**

- [src/ui/views/WeekCard.tsx](/Users/kevingusmao/Desktop/Arnold/src/ui/views/WeekCard.tsx:1): Zeigt Wochenzahlen und ein aus dem Plan abgeleitetes Ziel.
- [src/ui/views/ExerciseProgressView.tsx](/Users/kevingusmao/Desktop/Arnold/src/ui/views/ExerciseProgressView.tsx:1): Fortschrittsansicht mit Kennzahlen, Kurven und Ausführungsdetails.
- [src/analytics/records.ts](/Users/kevingusmao/Desktop/Arnold/src/analytics/records.ts:112): Unterscheidet erste Ausgangswerte von echten Verbesserungen.
- [src/analytics/trends.ts](/Users/kevingusmao/Desktop/Arnold/src/analytics/trends.ts:1): Vergleicht Wochen und Monate.

**Tests und Nachweis:** Numerische Rekordtests und Browserdarstellung sind vorhanden.

Relevante Tests: [tests/analytics-records.test.ts](/Users/kevingusmao/Desktop/Arnold/tests/analytics-records.test.ts:1), [tests/e2e/arnold-dashboard.spec.ts](/Users/kevingusmao/Desktop/Arnold/tests/e2e/arnold-dashboard.spec.ts:1), [tests/e2e/arnold-v2-qa.spec.ts](/Users/kevingusmao/Desktop/Arnold/tests/e2e/arnold-v2-qa.spec.ts:1).

**Offen, problematisch oder verbesserbar:** Vergleichszeitraum, Baseline und dominante Ausführung müssen direkt an der jeweiligen Zahl eindeutig bleiben. Ein vollständiger sichtbarer Vergleichsfluss ist noch nicht für alle Engine-Kennzahlen umgesetzt.

**Nächster sinnvoller Schritt:** Die wichtigsten Vergleiche auswählen und jeweils Zeitraum, Einheit und Vergleichbarkeit unmittelbar erklären.


### 05.10 · Loading-, Leer-, Fehler- und Erfolgszustände entwickeln

**Fortschritt: 75 % · Weitgehend umgesetzt.**

**Einordnung:** Laden, leere Daten, Fehler und bestätigte Speicherung werden angezeigt.

**So ist es heute umgesetzt:** Die UI zeigt echte Leerzustände statt erfundener Trainingsdaten. Schreibvorgänge werden nicht vorschnell als Erfolg dargestellt. Bei verlorenem Ergebnis bleibt der Originalauftrag erhalten; die Karte bietet eine erneute Prüfung an. Planeditor und Logger besitzen dafür eigene Zustandslogik.

**Maßgebliche Dateien und ihre Aufgabe:**

- [src/ui/hooks/useWorkoutLogger.ts](/Users/kevingusmao/Desktop/Arnold/src/ui/hooks/useWorkoutLogger.ts:1): Verhindert Doppelklicks und behält unbestätigte Schreibaufträge.
- [src/ui/hooks/usePlanEditor.ts](/Users/kevingusmao/Desktop/Arnold/src/ui/hooks/usePlanEditor.ts:1): Verarbeitet Planbearbeitung, Konflikte und Wiederholungen.
- [src/ui/ArnoldDashboardApp.tsx](/Users/kevingusmao/Desktop/Arnold/src/ui/ArnoldDashboardApp.tsx:1): Steuert die Kartenansichten und Navigation.
- [src/ui/views/TrainingCard.tsx](/Users/kevingusmao/Desktop/Arnold/src/ui/views/TrainingCard.tsx:1): Training, Satzspeicherung, Korrekturen und Zusammenfassung als Karte.

**Tests und Nachweis:** Browser-Tests prüfen leere Quellen, nicht erreichbare Daten, Fehler und verlorene Antworten über Reload.

Relevante Tests: [tests/e2e/arnold-dashboard.spec.ts](/Users/kevingusmao/Desktop/Arnold/tests/e2e/arnold-dashboard.spec.ts:1), [tests/e2e/workout-logger.spec.ts](/Users/kevingusmao/Desktop/Arnold/tests/e2e/workout-logger.spec.ts:1), [tests/e2e/plan-editor.spec.ts](/Users/kevingusmao/Desktop/Arnold/tests/e2e/plan-editor.spec.ts:1).

**Offen, problematisch oder verbesserbar:** Recovery ist noch nicht über einen gemeinsamen expliziten Vertrag vereinheitlicht. Ein technischer Fehlercode allein beschreibt nicht immer eindeutig, ob ein Auftrag aufgegeben oder erneut geprüft werden darf.

**Nächster sinnvoller Schritt:** Die S001-Wiederherstellungsregeln in die aktuelle Architektur übertragen und verständliche, handlungsorientierte Fehlertexte vereinheitlichen.


### 05.11 · MCP Apps UI mit den Backend-Tools verbinden

**Fortschritt: 100 % · Erfüllt im geprüften Umfang.**

**Einordnung:** Die Oberfläche arbeitet über dieselben MCP-Werkzeuge wie der Chat.

**So ist es heute umgesetzt:** Der Client ruft die Serverwerkzeuge über das offizielle MCP-Apps-Protokoll auf. Der lokale Testhost verwendet AppBridge und ein isoliertes iframe. Die UI hat keinen eigenen beliebigen Netzwerkzugriff. Die neue Chat-Brücke meldet sichtbare Sätze mit stabilen IDs an das Modell und sendet beim Abschluss eine Nachricht.

**Maßgebliche Dateien und ihre Aufgabe:**

- [src/ui/client.ts](/Users/kevingusmao/Desktop/Arnold/src/ui/client.ts:1): Offizielle MCP-Apps-Anbindung und Host-Kommunikation.
- [src/ui/client/ArnoldMcpClient.ts](/Users/kevingusmao/Desktop/Arnold/src/ui/client/ArnoldMcpClient.ts:1): Gemeinsamer UI-Zugriff auf MCP-Werkzeuge und Aktualitäts-/Cachelogik.
- [src/host/main.ts](/Users/kevingusmao/Desktop/Arnold/src/host/main.ts:1): Lokaler isolierter MCP-Apps-Testhost mit AppBridge.
- [src/ui/model-context.ts](/Users/kevingusmao/Desktop/Arnold/src/ui/model-context.ts:1): Meldet sichtbare Trainingsdaten und stabile Satz-IDs an das Modell.
- [src/ui/main.tsx](/Users/kevingusmao/Desktop/Arnold/src/ui/main.tsx:1): Startet die UI und empfängt Werkzeugdaten des Hosts.

**Tests und Nachweis:** MCP-Apps-Hosttests und Modellkontexttests prüfen Datenfluss, Satzspeicherung und Abschlussmeldung.

Relevante Tests: [tests/e2e/arnold-dashboard.spec.ts](/Users/kevingusmao/Desktop/Arnold/tests/e2e/arnold-dashboard.spec.ts:1), [tests/e2e/workout-logger.spec.ts](/Users/kevingusmao/Desktop/Arnold/tests/e2e/workout-logger.spec.ts:1), [tests/model-context.test.ts](/Users/kevingusmao/Desktop/Arnold/tests/model-context.test.ts:1).

**Offen, problematisch oder verbesserbar:** Die Implementierung im Hauptstand ist vorhanden. Ihre erneute Abnahme im echten ChatGPT-Host steht für die noch nicht deployte Kartenfassung aus.

**Nächster sinnvoller Schritt:** Den späteren Release kurz im echten Host testen, ohne eine zweite Datenlogik für die Oberfläche einzuführen.


### 05.12 · Bedienbarkeit in ChatGPT tatsächlich testen

**Fortschritt: 75 % · Weitgehend umgesetzt.**

**Einordnung:** Echte ChatGPT-Nutzung wurde von dir bestätigt; die neueste Fassung ist dort noch nicht abgenommen.

**So ist es heute umgesetzt:** Der Server ist als Custom-MCP-Dienst eingebunden, und es existiert ein privates Arnold-Plugin. Du hast reale Einrichtung und Google-Freigabe getestet. Automatisierte Browserprüfungen arbeiten zusätzlich mit einem protokollgetreuen lokalen Host.

**Maßgebliche Dateien und ihre Aufgabe:**

- [src/host/main.ts](/Users/kevingusmao/Desktop/Arnold/src/host/main.ts:1): Lokaler isolierter MCP-Apps-Testhost mit AppBridge.
- [src/ui/client.ts](/Users/kevingusmao/Desktop/Arnold/src/ui/client.ts:1): Offizielle MCP-Apps-Anbindung und Host-Kommunikation.
- [scripts/deploy-cloud-run.sh](/Users/kevingusmao/Desktop/Arnold/scripts/deploy-cloud-run.sh:1): Manuelles Cloud-Run-Deployment mit Login, Speicher und Healthchecks.
- [docs/GUIDE.md](/Users/kevingusmao/Desktop/Arnold/docs/GUIDE.md:1): Dokumentiert Architektur, Datenregeln und bekannte Grenzen.

**Tests und Nachweis:** Nutzerbestätigung, private Plugin-Metadaten und bestehende Hosttests sind vorhanden. Der aktive Cloud-Code ist älter als Karten, Chat-Brücke und die drei Fixes.

Relevante Tests: [tests/e2e/arnold-dashboard.spec.ts](/Users/kevingusmao/Desktop/Arnold/tests/e2e/arnold-dashboard.spec.ts:1), [tests/e2e/connected.spec.ts](/Users/kevingusmao/Desktop/Arnold/tests/e2e/connected.spec.ts:1).

**Offen, problematisch oder verbesserbar:** Eine funktionierende Vorschau beweist nicht jede Besonderheit des echten ChatGPT-Hosts. Die neueste Oberfläche wurde bewusst noch nicht deployt.

**Nächster sinnvoller Schritt:** Nach dem später freigegebenen Deployment den gesamten Hauptweg samt Kartenkontext, Korrektur und Wiederöffnung einmal nachvollziehbar abnehmen.


<a id="bereich-06"></a>

## 06 · Google OAuth und Integration


### 06.01 · Google-Cloud-Projekt für Entwicklung anlegen

**Fortschritt: 100 % · Erfüllt im geprüften Umfang.**

**Einordnung:** Ein reales Entwicklungsprojekt bei Google Cloud existiert.

**So ist es heute umgesetzt:** Arnold läuft im Projekt arnold-513219 in europe-west1. Die Skripte verwenden dieses Projekt für Cloud Run, Build, Secret Manager und Zustands-Bucket. Der aktive Dienst konnte über Google Cloud lesend geprüft werden.

**Maßgebliche Dateien und ihre Aufgabe:**

- [scripts/deploy-cloud-run.sh](/Users/kevingusmao/Desktop/Arnold/scripts/deploy-cloud-run.sh:1): Manuelles Cloud-Run-Deployment mit Login, Speicher und Healthchecks.
- [scripts/setup-cloud-infra.sh](/Users/kevingusmao/Desktop/Arnold/scripts/setup-cloud-infra.sh:1): Richtet Dienstkonto, privaten Zustands-Bucket und begrenzte Secret-Rechte ein.
- [scripts/setup-google-secrets.sh](/Users/kevingusmao/Desktop/Arnold/scripts/setup-google-secrets.sh:1): Überträgt Google-Zugangsdaten sicher in Secret Manager.

**Tests und Nachweis:** Cloud-Run-Revision, Build-Metadaten und aktivierte Dienste sind unabhängig nachgewiesen.

**Offen, problematisch oder verbesserbar:** Die Einrichtung als Entwicklungsprojekt ist erfüllt. Ein getrenntes Produktionsprojekt ist daraus noch nicht abgeleitet.

**Nächster sinnvoller Schritt:** Vor öffentlichen Kundendaten Entwicklung und Produktion mit getrennten Konfigurationen und Zugriffsrechten planen.


### 06.02 · Google Drive API und Google Sheets API aktivieren

**Fortschritt: 100 % · Erfüllt im geprüften Umfang.**

**Einordnung:** Drive API und Sheets API sind im tatsächlichen Projekt aktiviert.

**So ist es heute umgesetzt:** Das Deployment-Skript schaltet beide APIs für das Connected-Profil frei. GoogleTrackerApi erstellt die Datei über Drive und initialisiert beziehungsweise liest und schreibt ihre Tabellen über die Sheets API.

**Maßgebliche Dateien und ihre Aufgabe:**

- [scripts/deploy-cloud-run.sh](/Users/kevingusmao/Desktop/Arnold/scripts/deploy-cloud-run.sh:1): Manuelles Cloud-Run-Deployment mit Login, Speicher und Healthchecks.
- [src/server/connected/google-api.ts](/Users/kevingusmao/Desktop/Arnold/src/server/connected/google-api.ts:1): Erstellt und prüft Drive-Dateien und initialisiert die sechs Tabs.

**Tests und Nachweis:** Ein lesender gcloud-Aufruf listete drive.googleapis.com und sheets.googleapis.com als aktiviert.

Auditbelege: [infrastructure-evidence.json](/Users/kevingusmao/.codex/visualizations/2026/10/31/01a191e8-3845-7550-9bc3-670d3c146ee3/arnold-checklist-audit-2026-10-31/infrastructure-evidence.json).

**Offen, problematisch oder verbesserbar:** Für diesen Infrastrukturpunkt ist kein offener Schritt nachgewiesen. Zugriff auf eine konkrete Nutzerdatei verlangt zusätzlich den individuellen Grant.

**Nächster sinnvoller Schritt:** API-Aktivierung und individuelle Nutzerfreigabe weiterhin getrennt behandeln.


### 06.03 · OAuth-Zustimmungsbildschirm und App-Branding konfigurieren

**Fortschritt: 75 % · Weitgehend umgesetzt.**

**Einordnung:** Zustimmungsbildschirm und Branding sind offenbar eingerichtet, aber nicht als vollständig geprüfte Veröffentlichungskonfiguration belegt.

**So ist es heute umgesetzt:** Die Betriebsanleitung beschreibt Branding Arnold, externe Zielgruppe und OAuth-Einrichtung. Der echte Connected-Dienst startet mit einem Google-Client, und du berichtest von erfolgreicher Freigabe als Testnutzer. Der Code erzeugt den Consent-Screen selbst nicht.

**Maßgebliche Dateien und ihre Aufgabe:**

- [docs/GUIDE.md](/Users/kevingusmao/Desktop/Arnold/docs/GUIDE.md:1): Dokumentiert Architektur, Datenregeln und bekannte Grenzen.
- [scripts/setup-google-secrets.sh](/Users/kevingusmao/Desktop/Arnold/scripts/setup-google-secrets.sh:1): Überträgt Google-Zugangsdaten sicher in Secret Manager.
- [src/server/bootstrap.ts](/Users/kevingusmao/Desktop/Arnold/src/server/bootstrap.ts:1): Prüft Konfiguration und verbindet Authentifizierung mit Google-Laufzeit.

**Tests und Nachweis:** Nutzerbestätigung und laufende Google-Konfiguration stützen die Entwicklungs-Einrichtung; die Google-Console wurde nicht visuell geprüft.

**Offen, problematisch oder verbesserbar:** Branding-Details, verknüpfte rechtliche URLs und eine Produktionsabnahme sind nicht als Artefakt dokumentiert.

**Nächster sinnvoller Schritt:** Die sichtbaren Consent-Angaben mit Produktname, Support und Datenschutzhinweisen abgleichen und als Konfiguration festhalten.


### 06.04 · Externe Testnutzer und OAuth-Testmodus einrichten

**Fortschritt: 75 % · Weitgehend umgesetzt.**

**Einordnung:** Testmodus und dein Testnutzer sind durch deine Angaben und die Betriebsdokumentation belegt.

**So ist es heute umgesetzt:** Der Guide beschreibt eine externe Google-App im Testmodus und die Eintragung zugelassener Nutzer. Diese Freigabeliste wird in Google verwaltet, nicht im Arnold-Quellcode. Der heutige Code kann einen fehlenden oder widerrufenen Grant verständlich zurückweisen.

**Maßgebliche Dateien und ihre Aufgabe:**

- [docs/GUIDE.md](/Users/kevingusmao/Desktop/Arnold/docs/GUIDE.md:1): Dokumentiert Architektur, Datenregeln und bekannte Grenzen.
- [src/server/google/connection-service.ts](/Users/kevingusmao/Desktop/Arnold/src/server/google/connection-service.ts:1): Verwaltet Google-Verbindungen und erneuert Zugangstokens.
- [src/server/google/oauth-flow.ts](/Users/kevingusmao/Desktop/Arnold/src/server/google/oauth-flow.ts:1): Google-OAuth mit state, PKCE, Nonce, Refresh und Widerruf.

**Tests und Nachweis:** Du bestätigst reale Tests als eingetragener Nutzer. Die Testnutzerliste selbst wurde nicht über eine Console-Sitzung kontrolliert.

Relevante Tests: [tests/google-oauth.test.ts](/Users/kevingusmao/Desktop/Arnold/tests/google-oauth.test.ts:1).

**Offen, problematisch oder verbesserbar:** Der begrenzte Testbetrieb ist keine allgemeine Kundenfreigabe. Mit drive.file im Testmodus sind zeitlich begrenzte Refresh-Tokens zu berücksichtigen.

**Nächster sinnvoller Schritt:** Eine kleine dokumentierte Testnutzerliste und einen Wiederverbindungs-Test nach abgelaufenem Grant führen.

**Aktuelle externe Grundlage:** [Offizielle Dokumentation](https://developers.google.com/identity/protocols/oauth2).


### 06.05 · Benötigte Berechtigungen festlegen, bevorzugt drive.file

**Fortschritt: 100 % · Erfüllt im geprüften Umfang.**

**Einordnung:** Der gewünschte enge Drive-Dateizugriff ist umgesetzt und wird erzwungen.

**So ist es heute umgesetzt:** Arnold fordert drive.file zusammen mit openid und email an. Der Code prüft die tatsächlich erteilten Scopes und lehnt breitere Drive-/Sheets-Rechte ab. Dadurch wird nicht der gesamte Drive des Nutzers allgemein durchsuchbar; der persönliche Tracker wird gezielt von Arnold erstellt und gebunden.

**Maßgebliche Dateien und ihre Aufgabe:**

- [src/server/google/scopes.ts](/Users/kevingusmao/Desktop/Arnold/src/server/google/scopes.ts:1): Erlaubt drive.file und lehnt überbreite Freigaben ab.
- [src/server/google/oauth-flow.ts](/Users/kevingusmao/Desktop/Arnold/src/server/google/oauth-flow.ts:1): Google-OAuth mit state, PKCE, Nonce, Refresh und Widerruf.
- [src/server/connected/google-api.ts](/Users/kevingusmao/Desktop/Arnold/src/server/connected/google-api.ts:1): Erstellt und prüft Drive-Dateien und initialisiert die sechs Tabs.

**Tests und Nachweis:** Scope-Tests prüfen exakt erlaubte Rechte, fehlendes drive.file sowie unzulässig breite Grants.

Relevante Tests: [tests/google-credentials.test.ts](/Users/kevingusmao/Desktop/Arnold/tests/google-credentials.test.ts:1).

**Offen, problematisch oder verbesserbar:** Der Berechtigungsumfang erfüllt den Punkt. Ein enger Scope ersetzt weder Dateibesitzprüfung noch Datenschutzerklärung; beides wird separat bewertet.

**Nächster sinnvoller Schritt:** Bei neuen Google-Funktionen zuerst prüfen, ob sie mit dem bestehenden dateibezogenen Zugriff auskommen.

**Aktuelle externe Grundlage:** [Offizielle Dokumentation](https://developers.google.com/workspace/drive/api/guides/api-specific-auth).


### 06.06 · OAuth-Client und Redirect-URLs konfigurieren

**Fortschritt: 100 % · Erfüllt im geprüften Umfang.**

**Einordnung:** OAuth-Client und Rücksprungadresse sind technisch konfiguriert und streng abgeglichen.

**So ist es heute umgesetzt:** GOOGLE_CLIENT_ID und GOOGLE_CLIENT_SECRET werden aus geschützter Konfiguration geladen. Der Start verweigert eine Rücksprungadresse, die nicht exakt auf /auth/google/callback der öffentlichen Arnold-Adresse zeigt. Für entfernte Adressen wird HTTPS verlangt.

**Maßgebliche Dateien und ihre Aufgabe:**

- [src/server/bootstrap.ts](/Users/kevingusmao/Desktop/Arnold/src/server/bootstrap.ts:1): Prüft Konfiguration und verbindet Authentifizierung mit Google-Laufzeit.
- [scripts/setup-google-secrets.sh](/Users/kevingusmao/Desktop/Arnold/scripts/setup-google-secrets.sh:1): Überträgt Google-Zugangsdaten sicher in Secret Manager.
- [scripts/deploy-cloud-run.sh](/Users/kevingusmao/Desktop/Arnold/scripts/deploy-cloud-run.sh:1): Manuelles Cloud-Run-Deployment mit Login, Speicher und Healthchecks.
- [src/server/connected/google-browser.ts](/Users/kevingusmao/Desktop/Arnold/src/server/connected/google-browser.ts:1): Sicherer Browser-Rücksprung nach der Google-Freigabe.

**Tests und Nachweis:** Der reale Connected-Server läuft; lokale OAuth-/HTTP-Tests prüfen Bindung, Callback und Fehlerfälle.

Relevante Tests: [tests/google-oauth.test.ts](/Users/kevingusmao/Desktop/Arnold/tests/google-oauth.test.ts:1), [tests/connected-journey.test.ts](/Users/kevingusmao/Desktop/Arnold/tests/connected-journey.test.ts:1).

**Offen, problematisch oder verbesserbar:** Die Entwicklungs-Konfiguration erfüllt den Punkt. Bei einer eigenen Produktionsdomain müssen Client und Rücksprungadresse gemeinsam angepasst und erneut geprüft werden.

**Nächster sinnvoller Schritt:** Die exakten öffentlichen URLs als Release-Konfiguration dokumentieren und keine Geheimnisse in die Dokumentation aufnehmen.


### 06.07 · Google-Anmeldung und Token-Verwaltung im Backend implementieren

**Fortschritt: 100 % · Erfüllt im geprüften Umfang.**

**Einordnung:** Google-Anmeldung, Refresh und geschützte Token-Verwaltung sind implementiert.

**So ist es heute umgesetzt:** Der OAuth-Ablauf verwendet state, PKCE und Nonce. Google-ID-Tokens werden geprüft. Refresh-Tokens werden nutzergebunden verschlüsselt persistiert; kurzlebige Access-Tokens werden im Speicher gehalten und bei Bedarf erneuert. Ein widerrufener Grant führt zu REAUTH_REQUIRED.

**Maßgebliche Dateien und ihre Aufgabe:**

- [src/server/google/oauth-flow.ts](/Users/kevingusmao/Desktop/Arnold/src/server/google/oauth-flow.ts:1): Google-OAuth mit state, PKCE, Nonce, Refresh und Widerruf.
- [src/server/google/connection-service.ts](/Users/kevingusmao/Desktop/Arnold/src/server/google/connection-service.ts:1): Verwaltet Google-Verbindungen und erneuert Zugangstokens.
- [src/server/google/crypto.ts](/Users/kevingusmao/Desktop/Arnold/src/server/google/crypto.ts:1): Verschlüsselt Refresh-Tokens und bindet sie an Nutzer und Konto.
- [src/server/google/credential-repository.ts](/Users/kevingusmao/Desktop/Arnold/src/server/google/credential-repository.ts:1): Speichert verschlüsselte Google-Zugangsdaten getrennt pro Nutzer.
- [src/server/connected/google-browser.ts](/Users/kevingusmao/Desktop/Arnold/src/server/connected/google-browser.ts:1): Sicherer Browser-Rücksprung nach der Google-Freigabe.

**Tests und Nachweis:** Tests prüfen falsche Callbacks, Replay, Token-Erneuerung, parallele Refreshes und Widerruf.

Relevante Tests: [tests/google-oauth.test.ts](/Users/kevingusmao/Desktop/Arnold/tests/google-oauth.test.ts:1), [tests/google-credentials.test.ts](/Users/kevingusmao/Desktop/Arnold/tests/google-credentials.test.ts:1), [tests/connected-journey.test.ts](/Users/kevingusmao/Desktop/Arnold/tests/connected-journey.test.ts:1).

**Offen, problematisch oder verbesserbar:** Im unterstützten Einzelserverbetrieb ist die Funktion vorhanden. Ein während OAuth neu gestarteter Prozess kann einen erneuten Consent-Anlauf erfordern; das ist keine verlorene Trainingsdatei.

**Nächster sinnvoller Schritt:** Die dokumentierten Reconnect-Wege erhalten und Schlüsselrotation samt Notfallwiederherstellung operativ testen.


### 06.08 · Persönlichen Fitness-Tracker-Ordner beziehungsweise Speicherort festlegen

**Fortschritt: 75 % · Weitgehend umgesetzt.**

**Einordnung:** Der aktuelle Speicherort ist das persönliche Google Drive; ein eigener Arnold-Ordner wird nicht angelegt.

**So ist es heute umgesetzt:** Die Dateierstellung setzt keinen parents-Ordner. Google legt den Tracker deshalb im standardmäßigen persönlichen Drive-Bereich an. Name und App-Metadaten identifizieren die Datei. Die Einrichtung liefert eine direkte Tabellen-URL zurück.

**Maßgebliche Dateien und ihre Aufgabe:**

- [src/server/connected/google-api.ts](/Users/kevingusmao/Desktop/Arnold/src/server/connected/google-api.ts:1): Erstellt und prüft Drive-Dateien und initialisiert die sechs Tabs.
- [src/server/connected/runtime.ts](/Users/kevingusmao/Desktop/Arnold/src/server/connected/runtime.ts:1): Erzeugt und bindet die eigene Trainingsdatei je angemeldetem Nutzer.

**Tests und Nachweis:** Der Erstellungsrequest und die Rückgabe der Spreadsheet-URL sind im Code und in simulierten Ablaufprüfungen sichtbar.

Relevante Tests: [tests/connected-journey.test.ts](/Users/kevingusmao/Desktop/Arnold/tests/connected-journey.test.ts:1).

**Offen, problematisch oder verbesserbar:** Ein eigener Fitness-Tracker-Ordner oder eine frei wählbare Ablage ist nicht implementiert. Auch die Entscheidung für den Standardort ist noch keine ausgearbeitete Nutzererklärung.

**Nächster sinnvoller Schritt:** Den Standardort bewusst festlegen und im Abschluss nennen; einen eigenen Ordner nur ergänzen, wenn er einen klaren Nutzervorteil hat.


### 06.09 · Automatische Erstellung der nutzereigenen Google-Sheet-Kopie programmieren

**Fortschritt: 100 % · Erfüllt im geprüften Umfang.**

**Einordnung:** Die persönliche Trainingsdatei wird automatisch erstellt; die Umsetzung verwendet eine neue Datei statt einer Masterkopie.

**So ist es heute umgesetzt:** Nach bestätigtem Plan und Google-Freigabe erstellt Arnold eine neue Google-Tabelle, initialisiert die sechs Tabs und übernimmt den exakt freigegebenen Plan. Eine möglicherweise persönliche Masterdatei wird weder gelesen noch blind kopiert. Das erreicht den Nutzerzweck der ursprünglichen Kopieranforderung.

**Maßgebliche Dateien und ihre Aufgabe:**

- [src/server/connected/runtime.ts](/Users/kevingusmao/Desktop/Arnold/src/server/connected/runtime.ts:1): Erzeugt und bindet die eigene Trainingsdatei je angemeldetem Nutzer.
- [src/server/connected/google-api.ts](/Users/kevingusmao/Desktop/Arnold/src/server/connected/google-api.ts:1): Erstellt und prüft Drive-Dateien und initialisiert die sechs Tabs.
- [src/shared/arnold-schema-v1.ts](/Users/kevingusmao/Desktop/Arnold/src/shared/arnold-schema-v1.ts:5): Legt die sechs Tabellen, Spalten, IDs und Datenregeln fest.
- [src/shared/exercise-starter-catalog.ts](/Users/kevingusmao/Desktop/Arnold/src/shared/exercise-starter-catalog.ts:1): Gemeinsamer Grundkatalog für Einrichtung und persönliche Datei.

**Tests und Nachweis:** Ablauftests prüfen Dateierstellung, Planübernahme, Readback und das Verbot einer Erstellung vor Freigabe.

Relevante Tests: [tests/connected-journey.test.ts](/Users/kevingusmao/Desktop/Arnold/tests/connected-journey.test.ts:1), [tests/e2e/connected.spec.ts](/Users/kevingusmao/Desktop/Arnold/tests/e2e/connected.spec.ts:1).

**Offen, problematisch oder verbesserbar:** Der funktionale Zweck ist im geprüften Connected-Ablauf erfüllt. Die alternative Vorlagenarchitektur sollte ausdrücklich als Produktentscheidung dokumentiert bleiben.

**Nächster sinnvoller Schritt:** Code als einzige verbindliche Vorlage nutzen und Änderungen an Headern zusammen mit der Schemaversion kontrollieren.


### 06.10 · Vorhandene Tracker wiedererkennen statt duplizieren

**Fortschritt: 100 % · Erfüllt im geprüften Umfang.**

**Einordnung:** Vorhandene Tracker werden bei Wiederholung erkannt, statt blind neu angelegt zu werden.

**So ist es heute umgesetzt:** Eine serverseitige Tracker-ID wird im Nutzerzustand und in Drive-appProperties gespeichert. Bei verlorener Antwort auf die Erstellung sucht Arnold nach dieser ID. Genau ein passender Treffer wird weiterverwendet; unklare oder mehrdeutige Ergebnisse blockieren sichtbar.

**Maßgebliche Dateien und ihre Aufgabe:**

- [src/server/connected/runtime.ts](/Users/kevingusmao/Desktop/Arnold/src/server/connected/runtime.ts:1): Erzeugt und bindet die eigene Trainingsdatei je angemeldetem Nutzer.
- [src/server/connected/google-api.ts](/Users/kevingusmao/Desktop/Arnold/src/server/connected/google-api.ts:1): Erstellt und prüft Drive-Dateien und initialisiert die sechs Tabs.
- [src/server/connected/state.ts](/Users/kevingusmao/Desktop/Arnold/src/server/connected/state.ts:1): Speichert Entwürfe und Auditdaten atomar als Betreiberdateien.

**Tests und Nachweis:** Tests simulieren verlorene Erstellungs- und Initialisierungsantworten und prüfen, dass keine zweite Datei entsteht.

Relevante Tests: [tests/connected-journey.test.ts](/Users/kevingusmao/Desktop/Arnold/tests/connected-journey.test.ts:1).

**Offen, problematisch oder verbesserbar:** Das gilt bei erhaltener Konto-/Tracker-Zuordnung. Vollständiger Verlust des Betreiberzustands ist ein Backup-/Restore-Szenario und noch nicht gelöst.

**Nächster sinnvoller Schritt:** Die Tracker-Zuordnung gemeinsam mit Schlüssel und Identitätsdaten in das Wiederherstellungskonzept aufnehmen.


### 06.11 · Google-Sheets-Lese- und Schreibfunktionen anbinden

**Fortschritt: 75 % · Weitgehend umgesetzt.**

**Einordnung:** Lesen und Schreiben eigener Sheets sind verbunden; wichtige Grenzfälle bleiben.

**So ist es heute umgesetzt:** Die Adapter prüfen Dateiidentität, Tabellenstruktur und Revisionen. Schreibbatches werden zurückgelesen und auditiert; Freitext wird als Textzelle geschrieben. Das Connected-Profil erlaubt zusätzlich Planänderungen auf der persönlichen Datei.

**Maßgebliche Dateien und ihre Aufgabe:**

- [src/server/arnold-sheets-read-adapter.ts](/Users/kevingusmao/Desktop/Arnold/src/server/arnold-sheets-read-adapter.ts:1): Liest und validiert die sechs Google-Tabellen.
- [src/server/arnold-sheets-write-adapter.ts](/Users/kevingusmao/Desktop/Arnold/src/server/arnold-sheets-write-adapter.ts:1): Schreibt geprüfte Batches als echte Text-/Zahlenzellen nach Google.
- [src/server/connected/runtime.ts](/Users/kevingusmao/Desktop/Arnold/src/server/connected/runtime.ts:1): Erzeugt und bindet die eigene Trainingsdatei je angemeldetem Nutzer.
- [src/server/connected/google-api.ts](/Users/kevingusmao/Desktop/Arnold/src/server/connected/google-api.ts:1): Erstellt und prüft Drive-Dateien und initialisiert die sechs Tabs.

**Tests und Nachweis:** Transport-, Schreibadapter- und Gesamtflussprüfungen mit simuliertem Google bestehen.

Relevante Tests: [tests/arnold-write-adapter.test.ts](/Users/kevingusmao/Desktop/Arnold/tests/arnold-write-adapter.test.ts:1), [tests/arnold-literal-text.test.ts](/Users/kevingusmao/Desktop/Arnold/tests/arnold-literal-text.test.ts:1), [tests/connected-journey.test.ts](/Users/kevingusmao/Desktop/Arnold/tests/connected-journey.test.ts:1).

**Offen, problematisch oder verbesserbar:** Die Kapazitätsvorprüfung aus S001 fehlt: Tabellen dürfen nicht durch einen Schreibbatch über Grenzen wachsen, die der eigene Reader anschließend ablehnt. Reale Quoten-/Lasttests sind nicht nachgewiesen.

**Nächster sinnvoller Schritt:** Die Schreibgrenzen gegen den Reader abgleichen und kleine Quoten-/Fehlerszenarien in einer kontrollierten echten Testdatei abnehmen.


### 06.12 · Entkopplung und Rechtewiderruf testen

**Fortschritt: 75 % · Weitgehend umgesetzt.**

**Einordnung:** Trennung und Widerruf sind automatisiert getestet; ein erneuter realer Nachweis fehlt.

**So ist es heute umgesetzt:** disconnect_google_account verlangt eine ausdrückliche Bestätigung. Der Dienst versucht den Google-Widerruf und entfernt lokale Zugangsdaten auch dann, wenn Google gerade nicht erreichbar ist. Die Antwort unterscheidet lokale Entfernung und erfolgreichen Widerruf bei Google. Die Nutzertabelle bleibt bestehen.

**Maßgebliche Dateien und ihre Aufgabe:**

- [src/server/connected/mcp-google.ts](/Users/kevingusmao/Desktop/Arnold/src/server/connected/mcp-google.ts:1): Verbindung, Fertigstellung, Verbindungsstatus und Trennen von Google.
- [src/server/google/connection-service.ts](/Users/kevingusmao/Desktop/Arnold/src/server/google/connection-service.ts:1): Verwaltet Google-Verbindungen und erneuert Zugangstokens.
- [src/server/google/oauth-flow.ts](/Users/kevingusmao/Desktop/Arnold/src/server/google/oauth-flow.ts:1): Google-OAuth mit state, PKCE, Nonce, Refresh und Widerruf.
- [src/server/google/credential-repository.ts](/Users/kevingusmao/Desktop/Arnold/src/server/google/credential-repository.ts:1): Speichert verschlüsselte Google-Zugangsdaten getrennt pro Nutzer.

**Tests und Nachweis:** Tests prüfen erfolgreichen und fehlgeschlagenen Widerruf, fremde Nutzer und gesperrte Folgezugriffe.

Relevante Tests: [tests/google-oauth.test.ts](/Users/kevingusmao/Desktop/Arnold/tests/google-oauth.test.ts:1), [tests/connected-journey.test.ts](/Users/kevingusmao/Desktop/Arnold/tests/connected-journey.test.ts:1).

**Offen, problematisch oder verbesserbar:** Ein dokumentierter echter Widerrufs-/Reconnect-Test mit Google liegt in dieser Prüfung nicht vor. Backend-Journale und Konto werden durch das Trennen nicht gelöscht.

**Nächster sinnvoller Schritt:** Den realen Widerruf einmal mit einem Testkonto prüfen und in der Oberfläche Trennen klar von Konto-/Datenlöschung unterscheiden.


### 06.13 · Google-Produktions- und Verifizierungsanforderungen abschließen

**Fortschritt: 25 % · Grundlage vorhanden.**

**Einordnung:** Technische Grundlagen sind gelegt; Google-Produktionsanforderungen sind nicht abgeschlossen.

**So ist es heute umgesetzt:** Die App nutzt einen engen Scope und hat einen funktionierenden Entwicklungs-Consent. Der dokumentierte Betrieb bleibt Testmodus beziehungsweise Entwicklungsprofil. Im Repository existiert keine abgeschlossene Produktions-Checkliste mit Branding-, Domain-, Datenschutz- und Freigabenachweisen.

**Maßgebliche Dateien und ihre Aufgabe:**

- [src/server/google/scopes.ts](/Users/kevingusmao/Desktop/Arnold/src/server/google/scopes.ts:1): Erlaubt drive.file und lehnt überbreite Freigaben ab.
- [docs/GUIDE.md](/Users/kevingusmao/Desktop/Arnold/docs/GUIDE.md:1): Dokumentiert Architektur, Datenregeln und bekannte Grenzen.
- [src/server/bootstrap.ts](/Users/kevingusmao/Desktop/Arnold/src/server/bootstrap.ts:1): Prüft Konfiguration und verbindet Authentifizierung mit Google-Laufzeit.

**Tests und Nachweis:** Code und aktuelle Infrastruktur zeigen einen funktionierenden Testbetrieb, keine eigenständige Produktionsabnahme.

**Offen, problematisch oder verbesserbar:** drive.file ist ein nicht-sensitiver Scope; daraus folgt aber keine pauschale Erledigung aller grundlegenden Google-App-/Branding-Anforderungen.

**Nächster sinnvoller Schritt:** Die tatsächliche Google-App-Konfiguration anhand der aktuellen Produktionsanforderungen prüfen und alle manuellen Nachweise ablegen.

**Aktuelle externe Grundlage:** [Offizielle Dokumentation](https://developers.google.com/workspace/drive/api/guides/api-specific-auth).


<a id="bereich-07"></a>

## 07 · Hosting und Infrastruktur


### 07.01 · Lokale Entwicklungsumgebung mit Codex, Node.js und Git einrichten

**Fortschritt: 100 % · Erfüllt im geprüften Umfang.**

**Einordnung:** Die lokale Arbeitsumgebung mit Git, Node und Codex ist eingerichtet.

**So ist es heute umgesetzt:** Das Repository ist lokal verfügbar, besitzt einen Lockfile-basierten Build und kann Vorschau, Testhost sowie Server starten. Main ist auf dem zuletzt geprüften Commit sauber und synchron mit GitHub. Die anderen Worktrees wurden bei der vorherigen Bestandsaufnahme erfasst.

**Maßgebliche Dateien und ihre Aufgabe:**

- [package.json](/Users/kevingusmao/Desktop/Arnold/package.json:1): Abhängigkeiten, Node-Version und ausführbare Projektbefehle.
- [CLAUDE.md](/Users/kevingusmao/Desktop/Arnold/CLAUDE.md:1): Entwicklungsregeln und vollständiger Prüfbefehl.
- [README.md](/Users/kevingusmao/Desktop/Arnold/README.md:1): Erklärt Produktzweck, Start und Betriebsarten.

**Tests und Nachweis:** Build, Typecheck, Tests und Git-Abgleich wurden tatsächlich ausgeführt.

**Offen, problematisch oder verbesserbar:** Die Grundumgebung ist erfüllt. Alte Worktree-Registrierungen und eine nur lokale Onboarding-Notiz sind noch organisatorisch aufzuräumen.

**Nächster sinnvoller Schritt:** Die unversionierte Notiz sichern und unbenutzte Worktrees erst nach Prüfung ihrer enthaltenen Arbeit bereinigen.


### 07.02 · MCP Inspector und lokale MCP-UI-Tests durchführen

**Fortschritt: 75 % · Weitgehend umgesetzt.**

**Einordnung:** Lokale MCP-UI- und Protokolltests sind vorhanden; ein aktueller Inspector-Lauf ist nicht dokumentiert.

**So ist es heute umgesetzt:** /host verwendet den offiziellen AppBridge und /preview einen echten MCP-Client. Das Paket bietet zudem einen Inspector-Befehl an. Die automatisierten Suiten prüfen Transport, Ressourcen und Oberfläche. Ein verfügbarer Befehl allein beweist aber nicht seine tatsächliche Ausführung.

**Maßgebliche Dateien und ihre Aufgabe:**

- [src/host/main.ts](/Users/kevingusmao/Desktop/Arnold/src/host/main.ts:1): Lokaler isolierter MCP-Apps-Testhost mit AppBridge.
- [src/server/http.ts](/Users/kevingusmao/Desktop/Arnold/src/server/http.ts:1): Stellt MCP, Vorschau, Testhost und Healthcheck bereit.
- [package.json](/Users/kevingusmao/Desktop/Arnold/package.json:1): Abhängigkeiten, Node-Version und ausführbare Projektbefehle.
- [playwright.config.ts](/Users/kevingusmao/Desktop/Arnold/playwright.config.ts:1): Chromium-Browserprüfungen mit synthetischen lokalen Testservern.

**Tests und Nachweis:** Lokale Protokoll- und UI-Tests bestehen. Ein eigenständiger Inspector-Prüfbericht für diesen Commit wurde nicht gefunden.

Relevante Tests: [tests/arnold-mcp.test.ts](/Users/kevingusmao/Desktop/Arnold/tests/arnold-mcp.test.ts:1), [tests/e2e/arnold-dashboard.spec.ts](/Users/kevingusmao/Desktop/Arnold/tests/e2e/arnold-dashboard.spec.ts:1).

**Offen, problematisch oder verbesserbar:** Die Inspector-Seite der zusammengesetzten Anforderung bleibt als Nachweis offen.

**Nächster sinnvoller Schritt:** Vor der Einreichung einen kurzen Inspector-Durchlauf auf dem vorgesehenen Server protokollieren.


### 07.03 · Den Testserver über HTTPS-Tunnel mit ChatGPT verbinden

**Fortschritt: 75 % · Weitgehend umgesetzt.**

**Einordnung:** Der entfernte ChatGPT-Testzugang ist vorhanden; ein Tunnel ist heute nicht mehr der aktive Betriebsweg.

**So ist es heute umgesetzt:** Der Guide beschreibt den lokalen Test über HTTPS-Tunnel. Inzwischen ersetzt eine feste Cloud-Run-Adresse den laufenden Mac. Du bestätigst die Verbindung als Custom-MCP-Dienst in ChatGPT. Der heutige Live-Endpunkt ist unabhängig von einem lokalen Tunnel erreichbar.

**Maßgebliche Dateien und ihre Aufgabe:**

- [docs/GUIDE.md](/Users/kevingusmao/Desktop/Arnold/docs/GUIDE.md:1): Dokumentiert Architektur, Datenregeln und bekannte Grenzen.
- [scripts/deploy-cloud-run.sh](/Users/kevingusmao/Desktop/Arnold/scripts/deploy-cloud-run.sh:1): Manuelles Cloud-Run-Deployment mit Login, Speicher und Healthchecks.
- [src/server/storage-config.ts](/Users/kevingusmao/Desktop/Arnold/src/server/storage-config.ts:1): Verhindert unsichere öffentliche Nutzung echter Daten.

**Tests und Nachweis:** Nutzerbestätigung und geprüfter HTTPS-Endpunkt stützen den tatsächlichen Testzugang. Die historische Tunnelabnahme wurde nicht neu durchlaufen.

**Offen, problematisch oder verbesserbar:** Die ursprüngliche Aufgabe ist technisch durch einen stabileren Zugang überholt. Sie sollte nicht irrtümlich als Pflicht für den späteren Produktbetrieb weitergeführt werden.

**Nächster sinnvoller Schritt:** Den Tunnel als optionales Entwicklungswerkzeug kennzeichnen und Cloud Run als aktuellen Testweg dokumentieren.


### 07.04 · Hosting-Variante für Produktion auswählen

**Fortschritt: 75 % · Weitgehend umgesetzt.**

**Einordnung:** Cloud Run ist ausgewählt und eingerichtet; der volle Produktionsbetrieb ist noch nicht vorbereitet.

**So ist es heute umgesetzt:** Dockerfile, Deployment- und Infrastruktur-Skripte bauen den Dienst und veröffentlichen ihn auf Google Cloud Run. Persönlicher Zustand liegt in einem gemounteten Bucket. Das Connected-Profil verlangt derzeit ausdrücklich development und einen einzelnen Prozess.

**Maßgebliche Dateien und ihre Aufgabe:**

- [Dockerfile](/Users/kevingusmao/Desktop/Arnold/Dockerfile:1): Reproduzierbarer Build und Laufzeit als unprivilegierter Nutzer.
- [scripts/deploy-cloud-run.sh](/Users/kevingusmao/Desktop/Arnold/scripts/deploy-cloud-run.sh:1): Manuelles Cloud-Run-Deployment mit Login, Speicher und Healthchecks.
- [scripts/setup-cloud-infra.sh](/Users/kevingusmao/Desktop/Arnold/scripts/setup-cloud-infra.sh:1): Richtet Dienstkonto, privaten Zustands-Bucket und begrenzte Secret-Rechte ein.
- [src/server/bootstrap.ts](/Users/kevingusmao/Desktop/Arnold/src/server/bootstrap.ts:1): Prüft Konfiguration und verbindet Authentifizierung mit Google-Laufzeit.

**Tests und Nachweis:** Aktive Revision, erfolgreicher Cloud Build und dauerhaftes Volume sind nachgewiesen.

**Offen, problematisch oder verbesserbar:** Mehrinstanzbetrieb, Revisionsüberlapp beim Deployment, Wiederherstellung und eine getrennte Produktionskonfiguration sind nicht abgeschlossen.

**Nächster sinnvoller Schritt:** Cloud Run als Hostingentscheidung bestätigen und die verbleibenden Produktionsbedingungen als eigene Release-Gates festhalten.


### 07.05 · Eigene Domain und HTTPS einrichten

**Fortschritt: 50 % · Teilweise umgesetzt.**

**Einordnung:** HTTPS funktioniert über die Google-Dienstadresse; eine eigene Arnold-Domain ist nicht nachgewiesen.

**So ist es heute umgesetzt:** Der Dienst ist über eine feste run.app-Adresse mit gültigem HTTPS erreichbar. OAuth-Resource und Google-Callback zeigen auf diese öffentliche Basisadresse. Eine eigene registrierte Marken-Domain oder deren DNS-/Zertifikatskonfiguration ist im Projekt nicht dokumentiert.

**Maßgebliche Dateien und ihre Aufgabe:**

- [scripts/deploy-cloud-run.sh](/Users/kevingusmao/Desktop/Arnold/scripts/deploy-cloud-run.sh:1): Manuelles Cloud-Run-Deployment mit Login, Speicher und Healthchecks.
- [src/server/bootstrap.ts](/Users/kevingusmao/Desktop/Arnold/src/server/bootstrap.ts:1): Prüft Konfiguration und verbindet Authentifizierung mit Google-Laufzeit.
- [docs/GUIDE.md](/Users/kevingusmao/Desktop/Arnold/docs/GUIDE.md:1): Dokumentiert Architektur, Datenregeln und bekannte Grenzen.

**Tests und Nachweis:** Healthcheck und OAuth-Discovery wurden auf der Google-Dienstadresse erfolgreich aufgerufen.

**Offen, problematisch oder verbesserbar:** Die Hälfte der zusammengesetzten Anforderung ist erfüllt: HTTPS ja, eigene Domain nicht belegt.

**Nächster sinnvoller Schritt:** Für den öffentlichen Release eine eigene kontrollierte Domain wählen und alle OAuth-/Host-Adressen konsistent darauf umstellen.


### 07.06 · Stabile /mcp- und /health-Endpunkte bereitstellen

**Fortschritt: 100 % · Erfüllt im geprüften Umfang.**

**Einordnung:** Stabile MCP- und Health-Endpunkte sind vorhanden und live geprüft.

**So ist es heute umgesetzt:** /mcp ist der geschützte Protokollendpunkt; /health meldet Status, Betriebsart und Vertrag. Das Deployment prüft Health, OAuth-Metadaten und die Ablehnung eines MCP-Aufrufs ohne Token. Die Adresse bleibt über Revisionen stabil.

**Maßgebliche Dateien und ihre Aufgabe:**

- [src/server/http.ts](/Users/kevingusmao/Desktop/Arnold/src/server/http.ts:1): Stellt MCP, Vorschau, Testhost und Healthcheck bereit.
- [scripts/deploy-cloud-run.sh](/Users/kevingusmao/Desktop/Arnold/scripts/deploy-cloud-run.sh:1): Manuelles Cloud-Run-Deployment mit Login, Speicher und Healthchecks.
- [src/server/auth/router.ts](/Users/kevingusmao/Desktop/Arnold/src/server/auth/router.ts:1): Verbindet OAuth-Metadaten und geschützte HTTP-Aufrufe.

**Tests und Nachweis:** Der aktuelle Live-Healthcheck liefert ok; /mcp ohne Token liefert 401.

Relevante Tests: [tests/http-surface.test.ts](/Users/kevingusmao/Desktop/Arnold/tests/http-surface.test.ts:1), [tests/auth-http.test.ts](/Users/kevingusmao/Desktop/Arnold/tests/auth-http.test.ts:1).

**Offen, problematisch oder verbesserbar:** Der Grundpunkt ist erfüllt. Der Healthcheck belegt keine vollständige Funktionsprüfung von Google-Zugriff, Nutzerlizenz oder Backup.

**Nächster sinnvoller Schritt:** Health als Erreichbarkeitssignal verwenden und für echte Betriebsbereitschaft zusätzliche kontrollierte Checks definieren.


### 07.07 · Umgebungsvariablen und Geheimnisse sicher verwalten

**Fortschritt: 75 % · Weitgehend umgesetzt.**

**Einordnung:** Geheimnisse werden geschützt verwaltet; der operative Lebenszyklus ist noch nicht vollständig.

**So ist es heute umgesetzt:** Setup-Skripte übertragen Google-Clientdaten und den Token-Schlüssel in Secret Manager. Ein eigenes Laufzeitkonto erhält begrenzte Rechte. Dateien und Konfiguration sind aus Git und vielen Uploadpfaden ausgeschlossen; Tokens werden zusätzlich anwendungsseitig verschlüsselt.

**Maßgebliche Dateien und ihre Aufgabe:**

- [scripts/setup-google-secrets.sh](/Users/kevingusmao/Desktop/Arnold/scripts/setup-google-secrets.sh:1): Überträgt Google-Zugangsdaten sicher in Secret Manager.
- [scripts/setup-cloud-infra.sh](/Users/kevingusmao/Desktop/Arnold/scripts/setup-cloud-infra.sh:1): Richtet Dienstkonto, privaten Zustands-Bucket und begrenzte Secret-Rechte ein.
- [scripts/deploy-cloud-run.sh](/Users/kevingusmao/Desktop/Arnold/scripts/deploy-cloud-run.sh:1): Manuelles Cloud-Run-Deployment mit Login, Speicher und Healthchecks.
- [src/server/google/crypto.ts](/Users/kevingusmao/Desktop/Arnold/src/server/google/crypto.ts:1): Verschlüsselt Refresh-Tokens und bindet sie an Nutzer und Konto.
- [.gcloudignore](/Users/kevingusmao/Desktop/Arnold/.gcloudignore:1): Schließt viele Geheimnisdateien vom Upload aus; Worktrees fehlen noch.

**Tests und Nachweis:** Laufzeitkonto und Bucket-Mount sind nachgewiesen; Verschlüsselungs- und Konfigurationsprüfungen bestehen.

Relevante Tests: [tests/google-credentials.test.ts](/Users/kevingusmao/Desktop/Arnold/tests/google-credentials.test.ts:1).

**Offen, problematisch oder verbesserbar:** Rotation und Wiederherstellung sind nicht vollständig operativ getestet. Das aktive Build-Quellarchiv enthielt außerdem 397 Dateien aus lokalen Worktrees, weil deren Ausschluss fehlt; ein Geheimnisleck wurde dabei nicht festgestellt.

**Nächster sinnvoller Schritt:** Schlüsselrotation samt Restore testen und Worktrees ausdrücklich aus Cloud-/Docker-Build-Kontext ausschließen.


### 07.08 · Automatisches Deployment und Rollback vorbereiten

**Fortschritt: 25 % · Grundlage vorhanden.**

**Einordnung:** Ein manuelles Deployment ist vorhanden; automatische Auslieferung und geprüfter Rollback fehlen.

**So ist es heute umgesetzt:** Ein Shell-Skript baut aus dem lokalen Quellstand und erstellt eine Cloud-Run-Revision. Es prüft danach grundlegende Endpunkte. GitHub enthält keinen Workflow, der Tests und Deployment als nachvollziehbare Pipeline erzwingt. Ein vorbereiteter Rückweg einschließlich Datenkompatibilität ist nicht beschrieben.

**Maßgebliche Dateien und ihre Aufgabe:**

- [scripts/deploy-cloud-run.sh](/Users/kevingusmao/Desktop/Arnold/scripts/deploy-cloud-run.sh:1): Manuelles Cloud-Run-Deployment mit Login, Speicher und Healthchecks.
- [Dockerfile](/Users/kevingusmao/Desktop/Arnold/Dockerfile:1): Reproduzierbarer Build und Laufzeit als unprivilegierter Nutzer.
- [package.json](/Users/kevingusmao/Desktop/Arnold/package.json:1): Abhängigkeiten, Node-Version und ausführbare Projektbefehle.
- [docs/GUIDE.md](/Users/kevingusmao/Desktop/Arnold/docs/GUIDE.md:1): Dokumentiert Architektur, Datenregeln und bekannte Grenzen.

**Tests und Nachweis:** Cloud Build und mehrere Revisionen sind real vorhanden. Für main wurden keine entsprechenden GitHub-Statuschecks gefunden.

**Offen, problematisch oder verbesserbar:** Manuell eine ältere Revision auswählen ist noch kein getesteter Rollback-Prozess. Eine Codeversion ist zudem nicht automatisch an der laufenden Revision sichtbar.

**Nächster sinnvoller Schritt:** CI für Prüfungen einrichten, Commit-SHA als Release-Metadatum setzen und Rollback samt Zustandskompatibilität einmal üben.


### 07.09 · Monitoring, Fehlermeldungen, Limits und Backups des Dienstes einrichten

**Fortschritt: 25 % · Grundlage vorhanden.**

**Einordnung:** Betriebslogs und einige technische Grenzen existieren; vollständiges Monitoring und Backups fehlen.

**So ist es heute umgesetzt:** Die Anwendung schreibt strukturierte Werkzeugmetadaten mit Erfolg, Fehlercode und Dauer. /health sowie Ressourcen- und Instanzgrenzen sind vorhanden. Das sind brauchbare Grundlagen, aber noch kein benachrichtigender Überwachungs- und Sicherungsbetrieb.

**Maßgebliche Dateien und ihre Aufgabe:**

- [src/server/tool-log.ts](/Users/kevingusmao/Desktop/Arnold/src/server/tool-log.ts:1): Schreibt bewusst reduzierte Betriebsmetadaten statt Trainingsinhalte.
- [src/server/http.ts](/Users/kevingusmao/Desktop/Arnold/src/server/http.ts:1): Stellt MCP, Vorschau, Testhost und Healthcheck bereit.
- [scripts/deploy-cloud-run.sh](/Users/kevingusmao/Desktop/Arnold/scripts/deploy-cloud-run.sh:1): Manuelles Cloud-Run-Deployment mit Login, Speicher und Healthchecks.
- [scripts/setup-cloud-infra.sh](/Users/kevingusmao/Desktop/Arnold/scripts/setup-cloud-infra.sh:1): Richtet Dienstkonto, privaten Zustands-Bucket und begrenzte Secret-Rechte ein.

**Tests und Nachweis:** Tool-Log-Tests und die Cloud-Run-Konfiguration belegen diese Grundlagen.

Relevante Tests: [tests/tool-log.test.ts](/Users/kevingusmao/Desktop/Arnold/tests/tool-log.test.ts:1).

**Offen, problematisch oder verbesserbar:** Keine versionierte Alarmkonfiguration, gesicherte Aufbewahrung, automatische Restore-Probe oder Ende-zu-Ende-Überwachung ist nachgewiesen. Der neu gefundene Parser-Logfehler muss ebenfalls bereinigt werden.

**Nächster sinnvoller Schritt:** Wenige konkrete Alarme für Ausfall, Fehlerrate und unklare Schreibvorgänge einrichten und einen echten Backup-/Restore-Ablauf festlegen.


### 07.10 · Hosting-Kosten und Google-API-Quotas überwachen

**Fortschritt: Nicht seriös bezifferbar · Nicht belegt / extern offen.**

**Einordnung:** Kosten- und Quotaüberwachung lassen sich aus dem geprüften Projektstand nicht bestätigen.

**So ist es heute umgesetzt:** Der Code enthält begrenzte Ressourcen und reagiert auf Google-Fehler beziehungsweise Quotenprobleme. Das ist Fehlerbehandlung, keine Beobachtung von Kosten oder verbrauchter API-Quota. Budgetalarme und Quota-Dashboards würden überwiegend außerhalb des Repositories in Google Cloud liegen.

**Maßgebliche Dateien und ihre Aufgabe:**

- [scripts/deploy-cloud-run.sh](/Users/kevingusmao/Desktop/Arnold/scripts/deploy-cloud-run.sh:1): Manuelles Cloud-Run-Deployment mit Login, Speicher und Healthchecks.
- [src/server/connected/google-api.ts](/Users/kevingusmao/Desktop/Arnold/src/server/connected/google-api.ts:1): Erstellt und prüft Drive-Dateien und initialisiert die sechs Tabs.
- [src/server/arnold-sheets-write-adapter.ts](/Users/kevingusmao/Desktop/Arnold/src/server/arnold-sheets-write-adapter.ts:1): Schreibt geprüfte Batches als echte Text-/Zahlenzellen nach Google.
- [docs/GUIDE.md](/Users/kevingusmao/Desktop/Arnold/docs/GUIDE.md:1): Dokumentiert Architektur, Datenregeln und bekannte Grenzen.

**Tests und Nachweis:** Im Repository wurde keine Budget-/Quota-Monitoring-Konfiguration gefunden; die entsprechende Cloud-Console wurde nicht geprüft.

**Offen, problematisch oder verbesserbar:** Ein Prozentwert würde hier fehlende Information mit fehlender Umsetzung verwechseln.

**Nächster sinnvoller Schritt:** Prüfen, ob Budgetwarnungen und Quotaalarme im Projekt existieren, und deren Empfänger sowie Schwellen dokumentieren.


<a id="bereich-08"></a>

## 08 · Kundenkonten und Bezahlung


### 08.01 · Eigenständigen Personal-Training-Dienst und Angebotsstruktur definieren

**Fortschritt: Nicht seriös bezifferbar · Nicht belegt / extern offen.**

**Einordnung:** Ein eigenständiges Personal-Training-Angebot ist aus den vorhandenen Unterlagen nicht verlässlich bewertbar.

**So ist es heute umgesetzt:** Der Quellcode liefert einen Trainingsbegleiter, aber keinen Angebotskatalog mit Leistungsumfang, Vertragsbeziehung, Preis und Kundenzugang. Solche Geschäftsentscheidungen können außerhalb des Repositories existieren; aus ihrer Abwesenheit im Code folgt nicht, dass du sie nie getroffen hast.

**Maßgebliche Dateien und ihre Aufgabe:**

- [README.md](/Users/kevingusmao/Desktop/Arnold/README.md:1): Erklärt Produktzweck, Start und Betriebsarten.
- [docs/GUIDE.md](/Users/kevingusmao/Desktop/Arnold/docs/GUIDE.md:1): Dokumentiert Architektur, Datenregeln und bekannte Grenzen.
- [src/server/identity/repository.ts](/Users/kevingusmao/Desktop/Arnold/src/server/identity/repository.ts:1): Speichert Kontozuordnung und Status ACTIVE/DISABLED; keine Lizenzverwaltung.

**Tests und Nachweis:** Produkt- und Projektunterlagen enthalten keine abschließende Angebotsstruktur.

**Offen, problematisch oder verbesserbar:** Zielkunde, konkrete Dienstleistung und das Verhältnis zwischen menschlichem Personal Training und Softwarezugang sind für die Monetarisierungsprüfung noch nicht ausreichend dokumentiert.

**Nächster sinnvoller Schritt:** Ein kurzes Angebotsblatt bereitstellen: Was wird bezahlt, wo wird es gekauft, was ist enthalten und wer erbringt die Leistung?


### 08.02 · OpenAI-Zulässigkeit des konkreten Monetarisierungsmodells prüfen

**Fortschritt: 25 % · Grundlage vorhanden.**

**Einordnung:** Die aktuellen Plattformgrenzen sind geprüft; das konkrete Geschäftsmodell ist noch nicht freigegeben.

**So ist es heute umgesetzt:** Die offizielle OpenAI-Richtlinie erlaubt die Anmeldung mit einem bereits bezahlten Konto. Neue digitale Abos, Dienstleistungsverkäufe oder Upgrade-Käufe dürfen nicht über das Plugin angebahnt werden. Daraus lässt sich ein externer bestehender Kundenzugang prüfen; die Zulässigkeit eures noch nicht präzise beschriebenen Angebots folgt daraus nicht automatisch.

**Maßgebliche Dateien und ihre Aufgabe:**

- [README.md](/Users/kevingusmao/Desktop/Arnold/README.md:1): Erklärt Produktzweck, Start und Betriebsarten.
- [src/server/identity/repository.ts](/Users/kevingusmao/Desktop/Arnold/src/server/identity/repository.ts:1): Speichert Kontozuordnung und Status ACTIVE/DISABLED; keine Lizenzverwaltung.
- [docs/GUIDE.md](/Users/kevingusmao/Desktop/Arnold/docs/GUIDE.md:1): Dokumentiert Architektur, Datenregeln und bekannte Grenzen.

**Tests und Nachweis:** Die offizielle Plugin-Richtlinie wurde für diesen Bericht tatsächlich geöffnet und mit dem vorgesehenen Bezahlbereich abgeglichen.

**Offen, problematisch oder verbesserbar:** Es fehlen ein konkretes Angebot, ein vollständiger Kauf-/Freischaltablauf und eine nachvollziehbare Entscheidung, welche kommerziellen Hinweise im Plugin zulässig sind.

**Nächster sinnvoller Schritt:** Zuerst das externe Angebot konkretisieren und den vorgesehenen Ablauf gegen die Richtlinie prüfen; keinen pauschalen Kaufbutton in Arnold planen.

**Aktuelle externe Grundlage:** [Offizielle Dokumentation](https://developers.openai.com/plugins/plugin-guidelines).


### 08.03 · Kundenregistrierung und Anmeldung entwickeln

**Fortschritt: 75 % · Weitgehend umgesetzt.**

**Einordnung:** Registrierung und Anmeldung funktionieren technisch; eine vollständige Kundenverwaltung fehlt.

**So ist es heute umgesetzt:** WorkOS übernimmt die Anmeldung. Aus geprüftem Issuer und Subject erzeugt Arnold eine stabile interne Nutzer-ID. Wiederkehrende Nutzer erhalten dasselbe Konto; ein gesperrtes Konto wird abgewiesen. Die Einrichtung gehört diesem Konto und wird nicht je Chat neu angelegt.

**Maßgebliche Dateien und ihre Aufgabe:**

- [src/server/auth/identity.ts](/Users/kevingusmao/Desktop/Arnold/src/server/auth/identity.ts:1): Ordnet eine geprüfte Anmeldung einem aktiven Arnold-Konto zu.
- [src/server/identity/repository.ts](/Users/kevingusmao/Desktop/Arnold/src/server/identity/repository.ts:1): Speichert Kontozuordnung und Status ACTIVE/DISABLED; keine Lizenzverwaltung.
- [src/server/auth/router.ts](/Users/kevingusmao/Desktop/Arnold/src/server/auth/router.ts:1): Verbindet OAuth-Metadaten und geschützte HTTP-Aufrufe.
- [src/server/onboarding/access.ts](/Users/kevingusmao/Desktop/Arnold/src/server/onboarding/access.ts:1): Bindet die Einrichtung an Konto oder Sitzungsgeheimnis.

**Tests und Nachweis:** Identitäts-, HTTP- und Onboarding-Tests decken Wiederkehr, mehrere Nutzer und Sperrung ab.

Relevante Tests: [tests/auth-isolation.test.ts](/Users/kevingusmao/Desktop/Arnold/tests/auth-isolation.test.ts:1), [tests/auth-http.test.ts](/Users/kevingusmao/Desktop/Arnold/tests/auth-http.test.ts:1), [tests/onboarding-security.test.ts](/Users/kevingusmao/Desktop/Arnold/tests/onboarding-security.test.ts:1).

**Offen, problematisch oder verbesserbar:** Es fehlen eine produktive Kundenselbstverwaltung, abgeschlossene Kontolöschung und die Verknüpfung mit einer bezahlten Leistung.

**Nächster sinnvoller Schritt:** Die Anmeldefunktion als Grundlage nutzen und Konto-, Kunden- sowie Lizenzzustand bewusst als getrennte Dinge modellieren.


### 08.04 · OAuth-Anbindung ChatGPT zu unserem eigenen MCP-Dienst implementieren

**Fortschritt: 100 % · Erfüllt im geprüften Umfang.**

**Einordnung:** Die OAuth-Anbindung von ChatGPT an den eigenen MCP-Dienst ist umgesetzt.

**So ist es heute umgesetzt:** Arnold veröffentlicht Protected-Resource-Metadaten und verweist auf WorkOS als Authorization Server. Es prüft die erhaltenen Bearer-Tokens auf Signatur, Aussteller, Audience und Scopes. Arnold stellt selbst keine Anmeldetokens aus. Die Google-Freigabe ist ein zweiter, davon getrennter Ablauf.

**Maßgebliche Dateien und ihre Aufgabe:**

- [src/server/auth/router.ts](/Users/kevingusmao/Desktop/Arnold/src/server/auth/router.ts:1): Verbindet OAuth-Metadaten und geschützte HTTP-Aufrufe.
- [src/server/auth/token-verifier.ts](/Users/kevingusmao/Desktop/Arnold/src/server/auth/token-verifier.ts:1): Prüft Signatur, Aussteller, Zielgruppe und Gültigkeit eines Tokens.
- [src/server/auth/config.ts](/Users/kevingusmao/Desktop/Arnold/src/server/auth/config.ts:1): Stoppt bei unsicheren oder widersprüchlichen Anmeldeeinstellungen.
- [scripts/deploy-cloud-run.sh](/Users/kevingusmao/Desktop/Arnold/scripts/deploy-cloud-run.sh:1): Manuelles Cloud-Run-Deployment mit Login, Speicher und Healthchecks.

**Tests und Nachweis:** Du nutzt den Dienst bereits als OAuth-Custom-MCP-Connector. Discovery und 401 ohne Token wurden unabhängig geprüft; HTTP-/Token-Tests bestehen.

Relevante Tests: [tests/auth-token-verifier.test.ts](/Users/kevingusmao/Desktop/Arnold/tests/auth-token-verifier.test.ts:1), [tests/auth-http.test.ts](/Users/kevingusmao/Desktop/Arnold/tests/auth-http.test.ts:1).

**Offen, problematisch oder verbesserbar:** Die Authentifizierungsanforderung ist erfüllt. Aus einem gültigen Token folgt aktuell noch kein bezahlter Anspruch.

**Nächster sinnvoller Schritt:** Diese Grenze bei der späteren Lizenzprüfung erhalten: Identität prüfen und anschließend konkrete Berechtigung entscheiden.


### 08.05 · Minimale Account-/Lizenzverwaltung anlegen

**Fortschritt: 50 % · Teilweise umgesetzt.**

**Einordnung:** Eine minimale Kontoverwaltung ist vorhanden; ein Lizenzmodell fehlt.

**So ist es heute umgesetzt:** ArnoldUser und die Zuordnung zu einem Anmeldeanbieter werden dauerhaft gespeichert. ACTIVE und DISABLED erlauben eine Kontosperre. Es gibt aber keine Lizenzentität mit Tarif, Laufzeit, Zahlungsstatus oder freigeschalteten Leistungen. Ein Konto wird standardmäßig beim ersten gültigen Kontakt automatisch angelegt.

**Maßgebliche Dateien und ihre Aufgabe:**

- [src/server/identity/repository.ts](/Users/kevingusmao/Desktop/Arnold/src/server/identity/repository.ts:1): Speichert Kontozuordnung und Status ACTIVE/DISABLED; keine Lizenzverwaltung.
- [src/server/auth/identity.ts](/Users/kevingusmao/Desktop/Arnold/src/server/auth/identity.ts:1): Ordnet eine geprüfte Anmeldung einem aktiven Arnold-Konto zu.
- [src/server/connected/runtime.ts](/Users/kevingusmao/Desktop/Arnold/src/server/connected/runtime.ts:1): Erzeugt und bindet die eigene Trainingsdatei je angemeldetem Nutzer.

**Tests und Nachweis:** Identitätstests prüfen Wiedererkennung, parallele Erstregistrierung und gesperrte Nutzer.

Relevante Tests: [tests/auth-isolation.test.ts](/Users/kevingusmao/Desktop/Arnold/tests/auth-isolation.test.ts:1).

**Offen, problematisch oder verbesserbar:** Konto und Lizenz sind noch nicht verbunden. Ein aktiver angemeldeter Nutzer ist derzeit grundsätzlich zugelassen, sofern die erforderlichen Scopes vorliegen.

**Nächster sinnvoller Schritt:** Ein kleines Anspruchsmodell mit aktiv, abgelaufen und gesperrt definieren, ohne Zahlungsdaten in die Trainingsdatei zu mischen.


### 08.06 · Externen Zahlungsanbieter anbinden

**Fortschritt: 0 % · Nicht umgesetzt / kein Liefernachweis.**

**Einordnung:** Ein externer Zahlungsanbieter ist nicht angebunden.

**So ist es heute umgesetzt:** Im Server gibt es keine Payment-SDKs, Kauf-Endpunkte oder Webhook-Verarbeitung. Die vorhandenen Google- und WorkOS-Verbindungen dienen Anmeldung und Datenzugriff, nicht Bezahlung. Das private Plugin-Paket enthält ebenfalls keinen ausgearbeiteten kommerziellen Ablauf.

**Maßgebliche Dateien und ihre Aufgabe:**

- [package.json](/Users/kevingusmao/Desktop/Arnold/package.json:1): Abhängigkeiten, Node-Version und ausführbare Projektbefehle.
- [src/server/http.ts](/Users/kevingusmao/Desktop/Arnold/src/server/http.ts:1): Stellt MCP, Vorschau, Testhost und Healthcheck bereit.
- [src/server/identity/repository.ts](/Users/kevingusmao/Desktop/Arnold/src/server/identity/repository.ts:1): Speichert Kontozuordnung und Status ACTIVE/DISABLED; keine Lizenzverwaltung.

**Tests und Nachweis:** Abhängigkeiten, Serverrouten und Datenmodelle wurden nach Payment-, Subscription- und Lizenzfunktionen durchsucht.

**Offen, problematisch oder verbesserbar:** Es fehlen Anbieterentscheidung, sicherer externer Kaufablauf, signaturgeprüfte Webhooks sowie Preis-/Steuer-/Erstattungsprozesse.

**Nächster sinnvoller Schritt:** Erst nach der Angebots- und Plattformentscheidung einen externen Zahlungsprozess außerhalb des Plugins planen.


### 08.07 · Nach bestätigter Zahlung eine Berechtigung aktivieren

**Fortschritt: 0 % · Nicht umgesetzt / kein Liefernachweis.**

**Einordnung:** Eine Zahlung aktiviert derzeit keine Berechtigung.

**So ist es heute umgesetzt:** Es existiert kein Verarbeitungspfad von einem bestätigten Zahlungsereignis zu einem Arnold-Anspruch. Kontoregistrierung und Nutzerstatus kommen aus Identität beziehungsweise interner Speicherung. Die Trainingsdienste erhalten keine Zahlungsbestätigung und sollen ihr auch nicht blind vertrauen.

**Maßgebliche Dateien und ihre Aufgabe:**

- [src/server/identity/repository.ts](/Users/kevingusmao/Desktop/Arnold/src/server/identity/repository.ts:1): Speichert Kontozuordnung und Status ACTIVE/DISABLED; keine Lizenzverwaltung.
- [src/server/auth/identity.ts](/Users/kevingusmao/Desktop/Arnold/src/server/auth/identity.ts:1): Ordnet eine geprüfte Anmeldung einem aktiven Arnold-Konto zu.
- [src/server/auth/tool-guard.ts](/Users/kevingusmao/Desktop/Arnold/src/server/auth/tool-guard.ts:1): Prüft Identität und Rechte bei jedem Werkzeugaufruf.

**Tests und Nachweis:** Kein Zahlungs-Webhook, kein Lizenzstatus und kein Freischaltvorgang wurden im aktuellen Code gefunden.

**Offen, problematisch oder verbesserbar:** Es fehlen signaturgeprüfte, wiederholbar sichere Ereignisverarbeitung und eine nachvollziehbare Zuordnung zwischen externem Kunden und Arnold-Konto.

**Nächster sinnvoller Schritt:** Nach Einführung eines Lizenzmodells genau definieren, welches bestätigte Ereignis welchen Anspruch aktiviert oder beendet.


### 08.08 · Bei jedem geschützten MCP-Aufruf Lizenz prüfen

**Fortschritt: 0 % · Nicht umgesetzt / kein Liefernachweis.**

**Einordnung:** Jeder geschützte Aufruf prüft Rechte, aber noch keine bezahlte Lizenz.

**So ist es heute umgesetzt:** Der ToolGuard prüft pro Aufruf Identität, aktives Konto und Scopes. Das ist ein wichtiger Sicherheitsbaustein. Eine zusätzliche Prüfung auf bezahlten, gültigen Kundenanspruch fehlt vollständig. Ein Scope sagt, welche Art von Aktion ein Token erlaubt, nicht ob der Kunde bezahlt hat.

**Maßgebliche Dateien und ihre Aufgabe:**

- [src/server/auth/tool-guard.ts](/Users/kevingusmao/Desktop/Arnold/src/server/auth/tool-guard.ts:1): Prüft Identität und Rechte bei jedem Werkzeugaufruf.
- [src/server/auth/identity.ts](/Users/kevingusmao/Desktop/Arnold/src/server/auth/identity.ts:1): Ordnet eine geprüfte Anmeldung einem aktiven Arnold-Konto zu.
- [src/server/auth/scopes.ts](/Users/kevingusmao/Desktop/Arnold/src/server/auth/scopes.ts:1): Definiert getrennte Lese-, Schreib-, Plan- und Kontorechte.
- [src/server/auth/tool-access.ts](/Users/kevingusmao/Desktop/Arnold/src/server/auth/tool-access.ts:1): Vollständige Zuordnung aller Werkzeuge zu Zugriffsklassen.

**Tests und Nachweis:** Die Berechtigungsprüfungen sind getestet. Im Datenmodell gibt es keinen Lizenzzustand, den der Guard auswerten könnte.

Relevante Tests: [tests/auth-tool-access.test.ts](/Users/kevingusmao/Desktop/Arnold/tests/auth-tool-access.test.ts:1), [tests/auth-isolation.test.ts](/Users/kevingusmao/Desktop/Arnold/tests/auth-isolation.test.ts:1).

**Offen, problematisch oder verbesserbar:** Ohne diese zusätzliche Schranke wäre ein späteres Bezahlmodell technisch nicht zuverlässig durchgesetzt.

**Nächster sinnvoller Schritt:** Die Anspruchsprüfung zentral vor geschützten Aufrufen einbauen, sobald das zulässige Geschäftsmodell feststeht.


### 08.09 · Rückerstattung, Sperrung und Kontolöschung vorsehen

**Fortschritt: 25 % · Grundlage vorhanden.**

**Einordnung:** Kontosperrung ist als technische Grundlage vorhanden; Erstattung und Kontolöschung fehlen.

**So ist es heute umgesetzt:** Das Identitätsrepository kann einen Nutzer deaktivieren, und Folgeaufrufe werden abgewiesen. Google kann getrennt werden. Es gibt aber keinen vollständigen administrativen oder nutzerseitigen Ablauf für Rückerstattung, Kontoentfernung und Bereinigung aller gespeicherten Betreiberdateien.

**Maßgebliche Dateien und ihre Aufgabe:**

- [src/server/identity/repository.ts](/Users/kevingusmao/Desktop/Arnold/src/server/identity/repository.ts:1): Speichert Kontozuordnung und Status ACTIVE/DISABLED; keine Lizenzverwaltung.
- [src/server/auth/identity.ts](/Users/kevingusmao/Desktop/Arnold/src/server/auth/identity.ts:1): Ordnet eine geprüfte Anmeldung einem aktiven Arnold-Konto zu.
- [src/server/google/connection-service.ts](/Users/kevingusmao/Desktop/Arnold/src/server/google/connection-service.ts:1): Verwaltet Google-Verbindungen und erneuert Zugangstokens.
- [src/server/connected/state.ts](/Users/kevingusmao/Desktop/Arnold/src/server/connected/state.ts:1): Speichert Entwürfe und Auditdaten atomar als Betreiberdateien.

**Tests und Nachweis:** Tests belegen, dass deaktivierte Nutzer nicht weiterarbeiten und Google-Zugänge getrennt werden können.

Relevante Tests: [tests/auth-isolation.test.ts](/Users/kevingusmao/Desktop/Arnold/tests/auth-isolation.test.ts:1), [tests/google-oauth.test.ts](/Users/kevingusmao/Desktop/Arnold/tests/google-oauth.test.ts:1).

**Offen, problematisch oder verbesserbar:** Ein interner Statuswechsel ist keine bedienbare Kundenverwaltung. Zahlungsrückerstattung und Datenlöschung sind nicht implementiert.

**Nächster sinnvoller Schritt:** Sperren, Lizenzentzug, Erstatten und endgültiges Löschen als unterschiedliche Vorgänge mit klaren Folgen definieren.


### 08.10 · Trainerzugriff auf Kundendaten nur nach expliziter Freigabe für spätere Version planen

**Fortschritt: 0 % · Nicht umgesetzt / kein Liefernachweis.**

**Einordnung:** Trainerzugriff nach ausdrücklicher Freigabe ist noch nicht als spätere Funktion spezifiziert.

**So ist es heute umgesetzt:** Der vorhandene Datenzugriff ist konsequent auf den jeweiligen Nutzer und dessen eigene Datei beschränkt. Es gibt keine Trainerrolle, keine Kundenbeziehung und kein Freigabeobjekt für einen zweiten berechtigten Menschen. Diese Trennung ist heute ein Schutz, aber noch kein geplanter Delegationsmechanismus.

**Maßgebliche Dateien und ihre Aufgabe:**

- [src/server/identity/repository.ts](/Users/kevingusmao/Desktop/Arnold/src/server/identity/repository.ts:1): Speichert Kontozuordnung und Status ACTIVE/DISABLED; keine Lizenzverwaltung.
- [src/server/auth/tool-access.ts](/Users/kevingusmao/Desktop/Arnold/src/server/auth/tool-access.ts:1): Vollständige Zuordnung aller Werkzeuge zu Zugriffsklassen.
- [src/server/connected/runtime.ts](/Users/kevingusmao/Desktop/Arnold/src/server/connected/runtime.ts:1): Erzeugt und bindet die eigene Trainingsdatei je angemeldetem Nutzer.

**Tests und Nachweis:** Die gegenwärtigen Isolationstests verlangen gerade, dass Nutzer keine fremden Tracker lesen können.

Relevante Tests: [tests/auth-isolation.test.ts](/Users/kevingusmao/Desktop/Arnold/tests/auth-isolation.test.ts:1).

**Offen, problematisch oder verbesserbar:** Eine nachvollziehbare V2-Spezifikation für Einwilligung, Umfang, Widerruf, Audit und Trainer-Kunden-Zuordnung fehlt.

**Nächster sinnvoller Schritt:** Trainerfreigaben als eigenen späteren Vertrag planen und keinesfalls durch allgemeine Drive-Freigaben oder gemeinsame Konten ersetzen.


<a id="bereich-09"></a>

## 09 · Sicherheit und Datenschutz


### 09.01 · Personenbezogene Datenflüsse vollständig dokumentieren

**Fortschritt: 50 % · Teilweise umgesetzt.**

**Einordnung:** Die Architektur ist beschrieben; eine vollständige personenbezogene Datenflussdokumentation fehlt.

**So ist es heute umgesetzt:** Der Guide erläutert Google-Datei, WorkOS-Identität und Backend-Zustand. Im tatsächlichen Ablauf gehen Eingaben aus ChatGPT an Arnold und weiter zu Google; Modellkontext fließt zurück an ChatGPT. Betreiberdateien enthalten zusätzlich Einrichtungsprofile, Trackerzuordnung, Änderungsjournal und Audit. Cloud-Betriebslogs sind ein weiterer Speicherort.

**Maßgebliche Dateien und ihre Aufgabe:**

- [docs/GUIDE.md](/Users/kevingusmao/Desktop/Arnold/docs/GUIDE.md:1): Dokumentiert Architektur, Datenregeln und bekannte Grenzen.
- [src/server/connected/runtime.ts](/Users/kevingusmao/Desktop/Arnold/src/server/connected/runtime.ts:1): Erzeugt und bindet die eigene Trainingsdatei je angemeldetem Nutzer.
- [src/server/connected/state.ts](/Users/kevingusmao/Desktop/Arnold/src/server/connected/state.ts:1): Speichert Entwürfe und Auditdaten atomar als Betreiberdateien.
- [src/server/workout/infrastructure.ts](/Users/kevingusmao/Desktop/Arnold/src/server/workout/infrastructure.ts:276): Speichert vollständige Änderungsdatensätze im Operationsjournal.
- [src/ui/model-context.ts](/Users/kevingusmao/Desktop/Arnold/src/ui/model-context.ts:1): Meldet sichtbare Trainingsdaten und stabile Satz-IDs an das Modell.
- [src/server/tool-log.ts](/Users/kevingusmao/Desktop/Arnold/src/server/tool-log.ts:1): Schreibt bewusst reduzierte Betriebsmetadaten statt Trainingsinhalte.

**Tests und Nachweis:** Die Speicher- und Kommunikationspfade wurden im Code nachverfolgt. Der neue Parser-Logtest zeigt einen zusätzlichen relevanten Fehlerpfad.

**Offen, problematisch oder verbesserbar:** Es fehlt ein vollständiger Überblick über Datenarten, Zwecke, Empfänger, Aufbewahrung, Zugriff und Löschung an jedem dieser Orte.

**Nächster sinnvoller Schritt:** Einen verständlichen Datenfluss mit Speicherfristen und verantwortlichen Dienstleistern dokumentieren; nicht nur die Google-Tabelle betrachten.


### 09.02 · Keine Trainingshistorien in Betreiber-Datenbanken speichern

**Fortschritt: 25 % · Grundlage vorhanden.**

**Einordnung:** Die Hauptdatei liegt beim Nutzer, aber das strenge Ziel keine Trainingshistorien beim Betreiber wird nicht erfüllt.

**So ist es heute umgesetzt:** Nach der Einrichtung liest Arnold die Trainingsdaten aus der persönlichen Google-Tabelle. Das serverseitige Operationsjournal speichert dennoch vollständige Änderungen mit Vorher-/Nachher-Datensätzen und Ergebnissen. Auditdateien enthalten weitere Änderungsinformationen. Diese JSON-Dateien liegen im Betreiberzustand und überleben über den Cloud-Bucket Neustarts.

**Maßgebliche Dateien und ihre Aufgabe:**

- [src/server/connected/runtime.ts](/Users/kevingusmao/Desktop/Arnold/src/server/connected/runtime.ts:1): Erzeugt und bindet die eigene Trainingsdatei je angemeldetem Nutzer.
- [src/server/workout/infrastructure.ts](/Users/kevingusmao/Desktop/Arnold/src/server/workout/infrastructure.ts:276): Speichert vollständige Änderungsdatensätze im Operationsjournal.
- [src/server/workout/infrastructure.ts](/Users/kevingusmao/Desktop/Arnold/src/server/workout/infrastructure.ts:1): Gemeinsame IDs, Sperren, Revisionsregeln, Audit und Operationsjournal.
- [src/server/connected/state.ts](/Users/kevingusmao/Desktop/Arnold/src/server/connected/state.ts:1): Speichert Entwürfe und Auditdaten atomar als Betreiberdateien.
- [scripts/setup-cloud-infra.sh](/Users/kevingusmao/Desktop/Arnold/scripts/setup-cloud-infra.sh:1): Richtet Dienstkonto, privaten Zustands-Bucket und begrenzte Secret-Rechte ein.

**Tests und Nachweis:** FileOperationLedger serialisiert die vollständigen Journal-Einträge; die Connected-Laufzeit legt operations.json und audit.json je Nutzer an.

**Offen, problematisch oder verbesserbar:** Eine Datei statt einer SQL-Datenbank ändert nichts daran, dass der Betreiber Trainingsinhalte speichert. Für Trainingsjournale fehlt eine begründete begrenzte Aufbewahrung; Google trennen entfernt sie nicht.

**Nächster sinnvoller Schritt:** Diese Mission ausdrücklich entscheiden: Journale minimieren und begrenzen oder die begründete Ausnahme transparent dokumentieren und im Löschkonzept berücksichtigen.


### 09.03 · OAuth-Tokens verschlüsseln und Zugriffe begrenzen

**Fortschritt: 100 % · Erfüllt im geprüften Umfang.**

**Einordnung:** Google-Refresh-Tokens werden verschlüsselt und nutzergebunden gespeichert.

**So ist es heute umgesetzt:** AES-256-GCM schützt gespeicherte Tokens. Zusätzliche Bindungsdaten verhindern, dass ein verschlüsselter Datensatz einfach einem anderen Nutzer oder Google-Konto zugeordnet wird. Der aktive Schlüssel kommt aus geschützter Konfiguration, ältere Schlüssel können für Rotation zugelassen werden. Credential-Ansichten geben keine Tokens zurück.

**Maßgebliche Dateien und ihre Aufgabe:**

- [src/server/google/crypto.ts](/Users/kevingusmao/Desktop/Arnold/src/server/google/crypto.ts:1): Verschlüsselt Refresh-Tokens und bindet sie an Nutzer und Konto.
- [src/server/google/credential-repository.ts](/Users/kevingusmao/Desktop/Arnold/src/server/google/credential-repository.ts:1): Speichert verschlüsselte Google-Zugangsdaten getrennt pro Nutzer.
- [src/server/google/connection-service.ts](/Users/kevingusmao/Desktop/Arnold/src/server/google/connection-service.ts:1): Verwaltet Google-Verbindungen und erneuert Zugangstokens.
- [scripts/setup-cloud-infra.sh](/Users/kevingusmao/Desktop/Arnold/scripts/setup-cloud-infra.sh:1): Richtet Dienstkonto, privaten Zustands-Bucket und begrenzte Secret-Rechte ein.

**Tests und Nachweis:** Tests prüfen Manipulation, falsche Bindung, Verschlüsselung auf Datei und getrennte Nutzerverbindungen.

Relevante Tests: [tests/google-credentials.test.ts](/Users/kevingusmao/Desktop/Arnold/tests/google-credentials.test.ts:1), [tests/google-oauth.test.ts](/Users/kevingusmao/Desktop/Arnold/tests/google-oauth.test.ts:1).

**Offen, problematisch oder verbesserbar:** Der konkrete Token-Schutz ist umgesetzt. Ein betrieblicher Schlüsselrotations-/Restore-Lauf ist noch offen; andere personenbezogene JSON-Dateien nutzen nicht automatisch dieselbe Anwendungsverschlüsselung.

**Nächster sinnvoller Schritt:** Den Token-Schutz erhalten und Rotation samt getrennter Wiederherstellung operativ nachweisen.


### 09.04 · Verhindern, dass Kunden fremde Sheets lesen können

**Fortschritt: 100 % · Erfüllt im geprüften Umfang.**

**Einordnung:** Der unterstützte Zugriff ist an Nutzer, Google-Konto und eigene Datei gebunden.

**So ist es heute umgesetzt:** Datei- und Tracker-IDs werden aus dem geprüften Nutzerkontext bestimmt, nicht aus frei eingegebenen Werkzeugargumenten. Google-Dateibesitz und App-Metadaten werden geprüft. Ein bestehender Tracker bleibt an das ursprüngliche Google-Subject gebunden. AsyncLocalStorage verhindert globale Verwechslungen bei parallelen Anfragen.

**Maßgebliche Dateien und ihre Aufgabe:**

- [src/server/auth/guarded-server.ts](/Users/kevingusmao/Desktop/Arnold/src/server/auth/guarded-server.ts:1): Erzwingt Werkzeugklassifizierung und isoliert Nutzerkontext je Anfrage.
- [src/server/auth/identity.ts](/Users/kevingusmao/Desktop/Arnold/src/server/auth/identity.ts:1): Ordnet eine geprüfte Anmeldung einem aktiven Arnold-Konto zu.
- [src/server/connected/runtime.ts](/Users/kevingusmao/Desktop/Arnold/src/server/connected/runtime.ts:1): Erzeugt und bindet die eigene Trainingsdatei je angemeldetem Nutzer.
- [src/server/connected/google-api.ts](/Users/kevingusmao/Desktop/Arnold/src/server/connected/google-api.ts:1): Erstellt und prüft Drive-Dateien und initialisiert die sechs Tabs.

**Tests und Nachweis:** Tests trennen Nutzer, Zugänge und Onboarding-Sitzungen und lehnen fremde Referenzen ab.

Relevante Tests: [tests/auth-isolation.test.ts](/Users/kevingusmao/Desktop/Arnold/tests/auth-isolation.test.ts:1), [tests/connected-journey.test.ts](/Users/kevingusmao/Desktop/Arnold/tests/connected-journey.test.ts:1), [tests/onboarding-security.test.ts](/Users/kevingusmao/Desktop/Arnold/tests/onboarding-security.test.ts:1).

**Offen, problematisch oder verbesserbar:** Im unterstützten Einzelservermodell ist kein fremder Dateizugriff nachgewiesen. Ein späterer Trainerzugriff braucht einen eigenen Freigabevertrag und darf diese Grenze nicht umgehen.

**Nächster sinnvoller Schritt:** Die bestehenden Isolationstests bei jeder Erweiterung um Rollen oder gemeinsame Daten unverändert mitlaufen lassen.


### 09.05 · Persönliche Workout-Daten und Tokens aus Server-Logs fernhalten

**Fortschritt: 50 % · Teilweise umgesetzt.**

**Einordnung:** Die eigentlichen Tool-Logs sind reduziert; ein anderer Fehlerpfad kann Anfrageinhalte protokollieren.

**So ist es heute umgesetzt:** tool-log.ts schreibt Werkzeugname, Ergebnis, Dauer und interne Nutzer-ID, aber keine Trainingsnutzlast. Die allgemeine Express-Fehlerbehandlung schreibt dagegen error.message unverändert. Der JSON-Parser kann darin einen Ausschnitt der fehlerhaften Anfrage unterbringen.

**Maßgebliche Dateien und ihre Aufgabe:**

- [src/server/tool-log.ts](/Users/kevingusmao/Desktop/Arnold/src/server/tool-log.ts:1): Schreibt bewusst reduzierte Betriebsmetadaten statt Trainingsinhalte.
- [src/server/http.ts](/Users/kevingusmao/Desktop/Arnold/src/server/http.ts:324): Allgemeine Fehlerbehandlung schreibt derzeit rohe Fehlermeldungen.
- [src/server/http.ts](/Users/kevingusmao/Desktop/Arnold/src/server/http.ts:1): Stellt MCP, Vorschau, Testhost und Healthcheck bereit.

**Tests und Nachweis:** Ein neuer rein lokaler Test sendete den erfundenen Inhalt WORKOUT_120KG_AUDIT_SYNTHETIC. Die Antwort war korrekt HTTP 400; im abgefangenen Fehlerlog erschien dennoch ein Fragment WORKOUT_12. Ergebnis: log-probe.json.

Relevante Tests: [tests/tool-log.test.ts](/Users/kevingusmao/Desktop/Arnold/tests/tool-log.test.ts:1), [tests/http-surface.test.ts](/Users/kevingusmao/Desktop/Arnold/tests/http-surface.test.ts:1).

Auditbelege: [log-probe.json](/Users/kevingusmao/.codex/visualizations/2026/10/31/01a191e8-3845-7550-9bc3-670d3c146ee3/arnold-checklist-audit-2026-10-31/log-probe.json), [log-probe.mjs](/Users/kevingusmao/.codex/visualizations/2026/10/31/01a191e8-3845-7550-9bc3-670d3c146ee3/arnold-checklist-audit-2026-10-31/log-probe.mjs).

**Offen, problematisch oder verbesserbar:** Damit ist die Aussage keine Trainingsinhalte in Server-Logs derzeit falsch. Es wurde keine historische Preisgabe echter Daten festgestellt; der reproduzierte Fehler zeigt den möglichen Pfad.

**Nächster sinnvoller Schritt:** Parser- und unerwartete Fehler nur als freigegebenen Fehlercode protokollieren und einen dauerhaften Regressionstest gegen Nutzlastfragmente ergänzen.


### 09.06 · Jeden Schreibzugriff serverseitig autorisieren

**Fortschritt: 100 % · Erfüllt im geprüften Umfang.**

**Einordnung:** Schreibzugriffe werden serverseitig autorisiert; die Oberfläche ist nicht die Sicherheitsgrenze.

**So ist es heute umgesetzt:** Der Guard prüft pro Werkzeugaufruf das aktive Konto und benötigte Scopes. Dienste prüfen zusätzlich Tracker, Revision und passende Änderungsrechte. Google-Schreiben läuft nur über die gebundene Nutzerruntime. Im offenen Entwicklungsmodus werden ausschließlich synthetische Sandboxes zugelassen.

**Maßgebliche Dateien und ihre Aufgabe:**

- [src/server/auth/tool-guard.ts](/Users/kevingusmao/Desktop/Arnold/src/server/auth/tool-guard.ts:1): Prüft Identität und Rechte bei jedem Werkzeugaufruf.
- [src/server/auth/guarded-server.ts](/Users/kevingusmao/Desktop/Arnold/src/server/auth/guarded-server.ts:1): Erzwingt Werkzeugklassifizierung und isoliert Nutzerkontext je Anfrage.
- [src/server/auth/tool-access.ts](/Users/kevingusmao/Desktop/Arnold/src/server/auth/tool-access.ts:1): Vollständige Zuordnung aller Werkzeuge zu Zugriffsklassen.
- [src/server/workout/service.ts](/Users/kevingusmao/Desktop/Arnold/src/server/workout/service.ts:1): Prüft und verarbeitet Training, Satzkorrekturen und Abschluss.
- [src/server/plan/service.ts](/Users/kevingusmao/Desktop/Arnold/src/server/plan/service.ts:1): Verwaltet Entwürfe, Freigabe, Aktivierung und historische Pläne.
- [src/server/connected/runtime.ts](/Users/kevingusmao/Desktop/Arnold/src/server/connected/runtime.ts:1): Erzeugt und bindet die eigene Trainingsdatei je angemeldetem Nutzer.
- [src/server/auth/config.ts](/Users/kevingusmao/Desktop/Arnold/src/server/auth/config.ts:1): Stoppt bei unsicheren oder widersprüchlichen Anmeldeeinstellungen.

**Tests und Nachweis:** Tests decken fehlende oder falsche Scopes, deaktivierte Nutzer, fremde Tracker und unklassifizierte Werkzeuge ab.

Relevante Tests: [tests/auth-tool-access.test.ts](/Users/kevingusmao/Desktop/Arnold/tests/auth-tool-access.test.ts:1), [tests/auth-isolation.test.ts](/Users/kevingusmao/Desktop/Arnold/tests/auth-isolation.test.ts:1), [tests/plan-security.test.ts](/Users/kevingusmao/Desktop/Arnold/tests/plan-security.test.ts:1), [tests/workout-logging.test.ts](/Users/kevingusmao/Desktop/Arnold/tests/workout-logging.test.ts:1).

**Offen, problematisch oder verbesserbar:** Die technische Autorisierung ist umgesetzt. Eine Zahlungs-/Lizenzprüfung gehört zusätzlich dazu, sobald bezahlter Zugang eingeführt wird; sie ist aktuell noch nicht vorhanden.

**Nächster sinnvoller Schritt:** Bei neuen Schreibwerkzeugen Zugriffsklasse und Serviceprüfung verbindlich ergänzen.


### 09.07 · Export, Widerruf und Lösch-/Entkopplungsabläufe anbieten

**Fortschritt: 25 % · Grundlage vorhanden.**

**Einordnung:** Widerruf und Entkopplung existieren; vollständiger Export und Datenlöschung fehlen.

**So ist es heute umgesetzt:** Google-Verbindung und lokale Credentials lassen sich trennen. Die persönliche Tabelle bleibt im Google Drive und kann dort durch den Nutzer verwaltet werden. Arnold bietet aber keinen eigenen vollständigen Export und keinen Ablauf zur Entfernung von Profil, Identität, Journal, Audit und verbleibenden Einrichtungsdateien.

**Maßgebliche Dateien und ihre Aufgabe:**

- [src/server/connected/mcp-google.ts](/Users/kevingusmao/Desktop/Arnold/src/server/connected/mcp-google.ts:1): Verbindung, Fertigstellung, Verbindungsstatus und Trennen von Google.
- [src/server/google/connection-service.ts](/Users/kevingusmao/Desktop/Arnold/src/server/google/connection-service.ts:1): Verwaltet Google-Verbindungen und erneuert Zugangstokens.
- [src/server/connected/runtime.ts](/Users/kevingusmao/Desktop/Arnold/src/server/connected/runtime.ts:1): Erzeugt und bindet die eigene Trainingsdatei je angemeldetem Nutzer.
- [src/server/connected/state.ts](/Users/kevingusmao/Desktop/Arnold/src/server/connected/state.ts:1): Speichert Entwürfe und Auditdaten atomar als Betreiberdateien.
- [src/server/identity/repository.ts](/Users/kevingusmao/Desktop/Arnold/src/server/identity/repository.ts:1): Speichert Kontozuordnung und Status ACTIVE/DISABLED; keine Lizenzverwaltung.

**Tests und Nachweis:** Trennung ist getestet. Im Werkzeug- und Routenbestand wurden kein vollständiger Export- und kein Konto-/Betreiberlöschdienst gefunden.

Relevante Tests: [tests/google-oauth.test.ts](/Users/kevingusmao/Desktop/Arnold/tests/google-oauth.test.ts:1), [tests/connected-journey.test.ts](/Users/kevingusmao/Desktop/Arnold/tests/connected-journey.test.ts:1).

**Offen, problematisch oder verbesserbar:** Ein Satz-Tombstone, Google-Widerruf und eine deaktivierte Identität sind jeweils keine endgültige Datenlöschung.

**Nächster sinnvoller Schritt:** Eine klare Export-/Löschmatrix festlegen und einen nutzerverständlichen Ablauf für alle Betreiberkopien umsetzen.


### 09.08 · Datenschutzerklärung, Dienstleister und DSGVO-Rollen prüfen

**Fortschritt: 0 % · Nicht umgesetzt / kein Liefernachweis.**

**Einordnung:** Eine lieferbare Datenschutzerklärung und dokumentierte DSGVO-Rollenprüfung sind nicht nachgewiesen.

**So ist es heute umgesetzt:** Im Repository gibt es technische Sicherheitsregeln, aber keine veröffentlichungsfähige Datenschutzerklärung, Dienstleisterübersicht oder Rollen-/Vertragsdokumentation. Das geprüfte private Plugin enthält auch keine Datenschutz- oder Support-URLs. Personendaten aus dem Onboarding und Betreiberjournale machen diese Aufgabe bereits heute relevant.

**Maßgebliche Dateien und ihre Aufgabe:**

- [docs/GUIDE.md](/Users/kevingusmao/Desktop/Arnold/docs/GUIDE.md:1): Dokumentiert Architektur, Datenregeln und bekannte Grenzen.
- [src/shared/onboarding-contract.ts](/Users/kevingusmao/Desktop/Arnold/src/shared/onboarding-contract.ts:1): Fragen, Profilfelder und Zustände der Einrichtung.
- [src/server/workout/infrastructure.ts](/Users/kevingusmao/Desktop/Arnold/src/server/workout/infrastructure.ts:276): Speichert vollständige Änderungsdatensätze im Operationsjournal.
- [scripts/setup-cloud-infra.sh](/Users/kevingusmao/Desktop/Arnold/scripts/setup-cloud-infra.sh:1): Richtet Dienstkonto, privaten Zustands-Bucket und begrenzte Secret-Rechte ein.

**Tests und Nachweis:** Projektdateien und privates Plugin-Paket wurden geprüft. Eine externe bereits erfolgte rechtliche Prüfung wurde nicht vorgelegt.

**Offen, problematisch oder verbesserbar:** Es fehlen konkrete Zwecke, Speicherfristen, Empfänger, Rollen, Löschwege und belastbare öffentliche Informationen. Aus sicherem Code folgt keine rechtliche Abnahme.

**Nächster sinnvoller Schritt:** Die tatsächlichen Datenflüsse aufarbeiten und darauf basierend Datenschutzhinweise sowie erforderliche Dienstleistervereinbarungen prüfen lassen.

**Aktuelle externe Grundlage:** [Offizielle Dokumentation](https://commission.europa.eu/law/law-topic/data-protection/information-business-and-organisations/principles-gdpr_en).


### 09.09 · Sicherheits- und Berechtigungs-Tests durchführen

**Fortschritt: 75 % · Weitgehend umgesetzt.**

**Einordnung:** Ein breites Sicherheits-Testfundament existiert; eine vollständige aktuelle Sicherheitsabnahme fehlt.

**So ist es heute umgesetzt:** Tokenprüfung, Zugriffsklassen, Nutzertrennung, OAuth-Callbacks, Scope-Begrenzung und verschlüsselte Credentials besitzen eigene Suiten. Sie laufen im normalen Gesamtcheck. Der heutige Audit ergänzt eine gezielte negative HTTP-Gegenprobe, die einen bisher nicht abgesicherten Logpfad findet.

**Maßgebliche Dateien und ihre Aufgabe:**

- [src/server/auth/token-verifier.ts](/Users/kevingusmao/Desktop/Arnold/src/server/auth/token-verifier.ts:1): Prüft Signatur, Aussteller, Zielgruppe und Gültigkeit eines Tokens.
- [src/server/auth/tool-guard.ts](/Users/kevingusmao/Desktop/Arnold/src/server/auth/tool-guard.ts:1): Prüft Identität und Rechte bei jedem Werkzeugaufruf.
- [src/server/auth/guarded-server.ts](/Users/kevingusmao/Desktop/Arnold/src/server/auth/guarded-server.ts:1): Erzwingt Werkzeugklassifizierung und isoliert Nutzerkontext je Anfrage.
- [src/server/google/crypto.ts](/Users/kevingusmao/Desktop/Arnold/src/server/google/crypto.ts:1): Verschlüsselt Refresh-Tokens und bindet sie an Nutzer und Konto.
- [src/server/google/oauth-flow.ts](/Users/kevingusmao/Desktop/Arnold/src/server/google/oauth-flow.ts:1): Google-OAuth mit state, PKCE, Nonce, Refresh und Widerruf.
- [src/server/tool-log.ts](/Users/kevingusmao/Desktop/Arnold/src/server/tool-log.ts:1): Schreibt bewusst reduzierte Betriebsmetadaten statt Trainingsinhalte.

**Tests und Nachweis:** Die relevanten Auth-/Google-/Isolationstests bestehen im geprüften Hauptcommit.

Relevante Tests: [tests/auth-token-verifier.test.ts](/Users/kevingusmao/Desktop/Arnold/tests/auth-token-verifier.test.ts:1), [tests/auth-tool-access.test.ts](/Users/kevingusmao/Desktop/Arnold/tests/auth-tool-access.test.ts:1), [tests/auth-isolation.test.ts](/Users/kevingusmao/Desktop/Arnold/tests/auth-isolation.test.ts:1), [tests/google-oauth.test.ts](/Users/kevingusmao/Desktop/Arnold/tests/google-oauth.test.ts:1), [tests/google-credentials.test.ts](/Users/kevingusmao/Desktop/Arnold/tests/google-credentials.test.ts:1).

**Offen, problematisch oder verbesserbar:** Keine erneute unabhängige Gesamtprüfung, kein dokumentierter Penetrationstest und keine reale Zwei-Konten-Abnahme aller aktuellen Flüsse sind nachgewiesen. Die Loglücke bleibt offen.

**Nächster sinnvoller Schritt:** Nach Schließen der konkreten Befunde eine unabhängige Abnahme mit klaren Angriffsszenarien und geprüftem Release-Commit durchführen.


<a id="bereich-10"></a>

## 10 · Qualitätssicherung


### 10.01 · Mit vollständig synthetischen Testdaten entwickeln

**Fortschritt: 100 % · Erfüllt im geprüften Umfang.**

**Einordnung:** Die automatisierte Entwicklung und Prüfung verwendet synthetische Daten.

**So ist es heute umgesetzt:** Die Fixtures erzeugen erfundene Übungen, Pläne, Nutzer und Google-Antworten. Ein eigener Sandboxmodus erlaubt interaktive Tests ohne persönliche Trainingshistorie. Auch die drei letzten Regressionen und der neue Logtest verwenden nur synthetische Daten.

**Maßgebliche Dateien und ihre Aufgabe:**

- [package.json](/Users/kevingusmao/Desktop/Arnold/package.json:1): Abhängigkeiten, Node-Version und ausführbare Projektbefehle.
- [playwright.config.ts](/Users/kevingusmao/Desktop/Arnold/playwright.config.ts:1): Chromium-Browserprüfungen mit synthetischen lokalen Testservern.
- [src/server/connected/runtime.ts](/Users/kevingusmao/Desktop/Arnold/src/server/connected/runtime.ts:1): Erzeugt und bindet die eigene Trainingsdatei je angemeldetem Nutzer.
- [src/shared/arnold-schema-v1.ts](/Users/kevingusmao/Desktop/Arnold/src/shared/arnold-schema-v1.ts:5): Legt die sechs Tabellen, Spalten, IDs und Datenregeln fest.

**Tests und Nachweis:** Die Testverzeichnisse enthalten getrennte Fixture-Server und simulierte Auth-/Google-Transporte; echte Tracker wurden in diesem Audit nicht geöffnet.

Relevante Tests: [tests/auth-fixture-sandbox.test.ts](/Users/kevingusmao/Desktop/Arnold/tests/auth-fixture-sandbox.test.ts:1), [tests/connected-journey.test.ts](/Users/kevingusmao/Desktop/Arnold/tests/connected-journey.test.ts:1).

**Offen, problematisch oder verbesserbar:** Diese QA-Grundlage ist erfüllt. Sie sagt nicht, dass der bereits mit deinem Einverständnis verbundene Live-Testtracker synthetisch sein muss.

**Nächster sinnvoller Schritt:** Synthetische Beispieldaten als Standard für neue Gegenproben und spätere Reviewer-Demos beibehalten.


### 10.02 · Erstinstallation und wiederholtes Onboarding prüfen

**Fortschritt: 100 % · Erfüllt im geprüften Umfang.**

**Einordnung:** Ersteinrichtung, Fortsetzen und erneutes Öffnen sind automatisiert geprüft.

**So ist es heute umgesetzt:** Die Einrichtung gehört einem Konto. Eine offene Sitzung kann fortgesetzt werden; ein abgeschlossenes Konto soll nicht automatisch neu eingerichtet werden. Die UI erhält neue Sitzungsnachweise und übernimmt den Serverzustand. Ein älteres Profilformat wird beim Lesen begrenzt migriert.

**Maßgebliche Dateien und ihre Aufgabe:**

- [src/server/onboarding/service.ts](/Users/kevingusmao/Desktop/Arnold/src/server/onboarding/service.ts:1): Gemeinsamer Einrichtungszustand für Chat und Oberfläche.
- [src/server/onboarding/access.ts](/Users/kevingusmao/Desktop/Arnold/src/server/onboarding/access.ts:1): Bindet die Einrichtung an Konto oder Sitzungsgeheimnis.
- [src/server/onboarding/repository.ts](/Users/kevingusmao/Desktop/Arnold/src/server/onboarding/repository.ts:1): Persistiert Einrichtungsprofile, Revisionen und begrenzte Altformatmigration.
- [src/server/onboarding/setup-gate.ts](/Users/kevingusmao/Desktop/Arnold/src/server/onboarding/setup-gate.ts:1): Hält Trainingstools bis zur fertigen Einrichtung geschlossen.
- [src/ui/hooks/useOnboarding.ts](/Users/kevingusmao/Desktop/Arnold/src/ui/hooks/useOnboarding.ts:1): Synchronisiert Einrichtung, lokale Eingaben und Serverzustand.

**Tests und Nachweis:** Service-, Sicherheits- und Browserprüfungen decken Erstinstallation, Wiederöffnung, abgelaufene Sitzungen, beide Planwege und Abschluss ab.

Relevante Tests: [tests/onboarding-service.test.ts](/Users/kevingusmao/Desktop/Arnold/tests/onboarding-service.test.ts:1), [tests/onboarding-security.test.ts](/Users/kevingusmao/Desktop/Arnold/tests/onboarding-security.test.ts:1), [tests/onboarding-setup-gate.test.ts](/Users/kevingusmao/Desktop/Arnold/tests/onboarding-setup-gate.test.ts:1), [tests/e2e/onboarding.spec.ts](/Users/kevingusmao/Desktop/Arnold/tests/e2e/onboarding.spec.ts:1).

**Offen, problematisch oder verbesserbar:** Der unterstützte Einprozess-Ablauf ist geprüft. Der vollständige Verlust der Betreiberzuordnung ist ein anderer, noch offener Wiederherstellungsfall.

**Nächster sinnvoller Schritt:** Den kontogebundenen Ablauf bei Änderungen an Fragen und Schritten als feste Regression erhalten.


### 10.03 · Doppelte Logs und parallele Änderungen testen

**Fortschritt: 75 % · Weitgehend umgesetzt.**

**Einordnung:** Doppelte Aufträge und parallele Änderungen sind für einen Prozess getestet.

**So ist es heute umgesetzt:** Auftrags-IDs, erwartete Revisionen und Sperren verhindern viele doppelte Einträge oder überholte Bearbeitungen. Die Connected-Laufzeit serialisiert POST-Anfragen je Nutzer. Tests simulieren parallele Erstregistrierung, gleichzeitige Änderungen und wiederholte Aufträge.

**Maßgebliche Dateien und ihre Aufgabe:**

- [src/server/workout/infrastructure.ts](/Users/kevingusmao/Desktop/Arnold/src/server/workout/infrastructure.ts:1): Gemeinsame IDs, Sperren, Revisionsregeln, Audit und Operationsjournal.
- [src/server/plan/commit.ts](/Users/kevingusmao/Desktop/Arnold/src/server/plan/commit.ts:1): Sichert Planänderungen mit Journal, Readback und Audit ab.
- [src/server/workout/service.ts](/Users/kevingusmao/Desktop/Arnold/src/server/workout/service.ts:1): Prüft und verarbeitet Training, Satzkorrekturen und Abschluss.
- [src/server/connected/runtime.ts](/Users/kevingusmao/Desktop/Arnold/src/server/connected/runtime.ts:1): Erzeugt und bindet die eigene Trainingsdatei je angemeldetem Nutzer.

**Tests und Nachweis:** Unit-/MCP-Tests und Browser-Recoveryfälle bestehen.

Relevante Tests: [tests/workout-logging.test.ts](/Users/kevingusmao/Desktop/Arnold/tests/workout-logging.test.ts:1), [tests/plan-activation.test.ts](/Users/kevingusmao/Desktop/Arnold/tests/plan-activation.test.ts:1), [tests/auth-isolation.test.ts](/Users/kevingusmao/Desktop/Arnold/tests/auth-isolation.test.ts:1), [tests/e2e/workout-logger.spec.ts](/Users/kevingusmao/Desktop/Arnold/tests/e2e/workout-logger.spec.ts:1).

**Offen, problematisch oder verbesserbar:** Der gemeinsam gemountete Bucket liefert keine transaktionale verteilte Sperre. Alte und neue Cloud-Run-Revision können während eines Deployments gleichzeitig leben.

**Nächster sinnvoller Schritt:** Den erlaubten Einzelprozessbetrieb operativ absichern und vor Skalierung echte Mehrprozess-Konfliktprüfungen mit passendem Speicher durchführen.


### 10.04 · Alle Statistiken gegen unabhängige Kontrollrechnungen testen

**Fortschritt: 75 % · Weitgehend umgesetzt.**

**Einordnung:** Es gibt viele feste Kontrollwerte und frühere QA-Gegenproben; keine erneute unabhängige Prüfung aller Kennzahlen.

**So ist es heute umgesetzt:** Last-, Volumen-, Rekord- und Aktivitätstests vergleichen mit vorgegebenen Zahlen. Die QA-Regressionsdatei erhält neun frühere Analytics-Befunde. Dadurch werden nicht nur interne Funktionen gegeneinander verglichen. Eine vollständige aktuelle Kontrollrechnung über alle Kennzahlen, UI-Aggregationen und Originalanforderungen liegt jedoch nicht als separates Abnahmeprotokoll vor.

**Maßgebliche Dateien und ihre Aufgabe:**

- [src/analytics/load.ts](/Users/kevingusmao/Desktop/Arnold/src/analytics/load.ts:96): Berechnet Satzlast, Volumen und e1RM nach Ausführungsregeln.
- [src/analytics/activity.ts](/Users/kevingusmao/Desktop/Arnold/src/analytics/activity.ts:128): Zählt Trainingstage und Einheiten und berechnet Wochenserien.
- [src/analytics/records.ts](/Users/kevingusmao/Desktop/Arnold/src/analytics/records.ts:112): Unterscheidet erste Ausgangswerte von echten Verbesserungen.
- [src/server/arnold-presenter.ts](/Users/kevingusmao/Desktop/Arnold/src/server/arnold-presenter.ts:1): Übersetzt Berechnungen in verständliche Dashboard-Daten.
- [src/ui/views/WeekCard.tsx](/Users/kevingusmao/Desktop/Arnold/src/ui/views/WeekCard.tsx:1): Zeigt Wochenzahlen und ein aus dem Plan abgeleitetes Ziel.

**Tests und Nachweis:** Die numerischen Tests bestehen. Der Audit fand eine noch uneinheitliche Wochenziel-Einheit in der Oberfläche.

Relevante Tests: [tests/analytics-load.test.ts](/Users/kevingusmao/Desktop/Arnold/tests/analytics-load.test.ts:1), [tests/analytics-volume.test.ts](/Users/kevingusmao/Desktop/Arnold/tests/analytics-volume.test.ts:1), [tests/analytics-activity.test.ts](/Users/kevingusmao/Desktop/Arnold/tests/analytics-activity.test.ts:1), [tests/analytics-records.test.ts](/Users/kevingusmao/Desktop/Arnold/tests/analytics-records.test.ts:1), [tests/analytics-qa-regressions.test.ts](/Users/kevingusmao/Desktop/Arnold/tests/analytics-qa-regressions.test.ts:1), [tests/analytics-dashboard.test.ts](/Users/kevingusmao/Desktop/Arnold/tests/analytics-dashboard.test.ts:1).

**Offen, problematisch oder verbesserbar:** Die UI kann rechnerisch korrekte Einzelzahlen trotzdem in einem unklaren Kontext zusammensetzen. Körpergewicht und Kardio sind noch gar nicht prüfbar.

**Nächster sinnvoller Schritt:** Für jede veröffentlichte Kennzahl ein kleines unabhängig berechnetes Abnahmebeispiel samt sichtbarer Beschriftung führen.


### 10.05 · Ausfall von Google APIs und Netzwerkverbindung simulieren

**Fortschritt: 100 % · Erfüllt im geprüften Umfang.**

**Einordnung:** Google- und Netzwerkausfälle werden gezielt simuliert.

**So ist es heute umgesetzt:** Die Testanbieter können fehlende Rechte, abgelaufene Tokens, Quotenprobleme, verlorene Antworten und nicht erreichbare Quellen erzeugen. Besonders Dateierstellung und Satzspeicherung werden nach unklarer Antwort erneut geprüft, statt blind zu wiederholen. Die UI soll dabei keinen erfundenen Erfolg anzeigen.

**Maßgebliche Dateien und ihre Aufgabe:**

- [src/server/connected/google-api.ts](/Users/kevingusmao/Desktop/Arnold/src/server/connected/google-api.ts:1): Erstellt und prüft Drive-Dateien und initialisiert die sechs Tabs.
- [src/server/google/connection-service.ts](/Users/kevingusmao/Desktop/Arnold/src/server/google/connection-service.ts:1): Verwaltet Google-Verbindungen und erneuert Zugangstokens.
- [src/server/arnold-sheets-write-adapter.ts](/Users/kevingusmao/Desktop/Arnold/src/server/arnold-sheets-write-adapter.ts:1): Schreibt geprüfte Batches als echte Text-/Zahlenzellen nach Google.
- [src/server/connected/runtime.ts](/Users/kevingusmao/Desktop/Arnold/src/server/connected/runtime.ts:1): Erzeugt und bindet die eigene Trainingsdatei je angemeldetem Nutzer.
- [src/ui/hooks/useWorkoutLogger.ts](/Users/kevingusmao/Desktop/Arnold/src/ui/hooks/useWorkoutLogger.ts:1): Verhindert Doppelklicks und behält unbestätigte Schreibaufträge.

**Tests und Nachweis:** Tests decken Google-Ausfall, invalid_grant, verlorene Erstellung, verlorene Initialisierung und verlorene Schreibantworten ab.

Relevante Tests: [tests/arnold-google-transport.test.ts](/Users/kevingusmao/Desktop/Arnold/tests/arnold-google-transport.test.ts:1), [tests/arnold-write-adapter.test.ts](/Users/kevingusmao/Desktop/Arnold/tests/arnold-write-adapter.test.ts:1), [tests/google-oauth.test.ts](/Users/kevingusmao/Desktop/Arnold/tests/google-oauth.test.ts:1), [tests/connected-journey.test.ts](/Users/kevingusmao/Desktop/Arnold/tests/connected-journey.test.ts:1), [tests/e2e/workout-logger.spec.ts](/Users/kevingusmao/Desktop/Arnold/tests/e2e/workout-logger.spec.ts:1).

**Offen, problematisch oder verbesserbar:** Die Simulationsanforderung ist erfüllt. Reale Last, Google-Quota-Ausreizung und lang andauernde Providerstörungen wurden nicht zusätzlich im Livebetrieb getestet.

**Nächster sinnvoller Schritt:** Die kontrollierten Fehlertransporte für neue Google-Funktionen weiterverwenden.


### 10.06 · Test mit zwei getrennten Nutzern und Google-Konten durchführen

**Fortschritt: 75 % · Weitgehend umgesetzt.**

**Einordnung:** Zwei getrennte Nutzer und Google-Identitäten sind simuliert geprüft; zwei reale Konten noch nicht nachgewiesen.

**So ist es heute umgesetzt:** Die Tests erzeugen unabhängige Arnold-Konten und Google-Subjects. Sie prüfen getrennte Token-Caches, persönliche Tracker sowie die Ablehnung fremder Sitzungen. Der reale Betrieb wurde laut deiner Beschreibung bisher mit dir als Testnutzer abgenommen.

**Maßgebliche Dateien und ihre Aufgabe:**

- [src/server/auth/identity.ts](/Users/kevingusmao/Desktop/Arnold/src/server/auth/identity.ts:1): Ordnet eine geprüfte Anmeldung einem aktiven Arnold-Konto zu.
- [src/server/connected/runtime.ts](/Users/kevingusmao/Desktop/Arnold/src/server/connected/runtime.ts:1): Erzeugt und bindet die eigene Trainingsdatei je angemeldetem Nutzer.
- [src/server/google/connection-service.ts](/Users/kevingusmao/Desktop/Arnold/src/server/google/connection-service.ts:1): Verwaltet Google-Verbindungen und erneuert Zugangstokens.
- [src/server/auth/guarded-server.ts](/Users/kevingusmao/Desktop/Arnold/src/server/auth/guarded-server.ts:1): Erzwingt Werkzeugklassifizierung und isoliert Nutzerkontext je Anfrage.

**Tests und Nachweis:** Ablauf- und Isolationstests behandeln ausdrücklich zwei Nutzer und getrennte Google-Verbindungen.

Relevante Tests: [tests/auth-isolation.test.ts](/Users/kevingusmao/Desktop/Arnold/tests/auth-isolation.test.ts:1), [tests/google-credentials.test.ts](/Users/kevingusmao/Desktop/Arnold/tests/google-credentials.test.ts:1), [tests/google-oauth.test.ts](/Users/kevingusmao/Desktop/Arnold/tests/google-oauth.test.ts:1), [tests/connected-journey.test.ts](/Users/kevingusmao/Desktop/Arnold/tests/connected-journey.test.ts:1).

**Offen, problematisch oder verbesserbar:** Ein nachvollziehbarer Durchlauf mit zwei echten Google-Konten auf der vorgesehenen Release-Revision fehlt.

**Nächster sinnvoller Schritt:** Zwei Testpersonen oder Testkonten verwenden und Lesen, Schreiben, Trennen sowie verbotene Querverweise getrennt abnehmen.


### 10.07 · UI auf Desktop und Smartphone prüfen

**Fortschritt: 75 % · Weitgehend umgesetzt.**

**Einordnung:** Desktop und emulierte Smartphone-Ansichten werden geprüft; die reale Geräteabnahme steht aus.

**So ist es heute umgesetzt:** Playwright testet Chromium mit verschiedenen Fenstergrößen, hellem/dunklem Theme, Tastatur und automatisierter Accessibility-Prüfung. Onboarding und Dashboard besitzen mobile Prüfungen. Dies deckt viele Layoutfehler ab, aber keine echten Betriebssystem-/Hostunterschiede.

**Maßgebliche Dateien und ihre Aufgabe:**

- [playwright.config.ts](/Users/kevingusmao/Desktop/Arnold/playwright.config.ts:1): Chromium-Browserprüfungen mit synthetischen lokalen Testservern.
- [src/ui/cards.css](/Users/kevingusmao/Desktop/Arnold/src/ui/cards.css:1): Layout und Bedienung der Chat-Karten.
- [src/ui/glass.css](/Users/kevingusmao/Desktop/Arnold/src/ui/glass.css:1): Gemeinsame Designbasis und responsive Gestaltungsregeln.
- [src/ui/components/TrendChart.tsx](/Users/kevingusmao/Desktop/Arnold/src/ui/components/TrendChart.tsx:1): Diagramme mit zugänglichen Text-/Tabellenalternativen.

**Tests und Nachweis:** Alle 52 aktuellen Browserprüfungen bestehen.

Relevante Tests: [tests/e2e/arnold-dashboard.spec.ts](/Users/kevingusmao/Desktop/Arnold/tests/e2e/arnold-dashboard.spec.ts:1), [tests/e2e/arnold-v2-qa.spec.ts](/Users/kevingusmao/Desktop/Arnold/tests/e2e/arnold-v2-qa.spec.ts:1), [tests/e2e/onboarding.spec.ts](/Users/kevingusmao/Desktop/Arnold/tests/e2e/onboarding.spec.ts:1).

**Offen, problematisch oder verbesserbar:** Kein Nachweis für echte iOS-/Android-Geräte, Safari, Firefox und eine vollständige manuelle Bedienbarkeitsprüfung. Stärkere alte S001-Überlauf-Gegenproben fehlen noch.

**Nächster sinnvoller Schritt:** Mindestens echte Smartphone-Nutzung und Safari als spätere Beta-Abnahme ergänzen.


### 10.08 · Tests für fehlerhafte, widersprüchliche und unvollständige Chat-Eingaben erstellen

**Fortschritt: 75 % · Weitgehend umgesetzt.**

**Einordnung:** Fehlerhafte Werkzeugdaten sind stark getestet; natürliche Sprache wird noch nicht systematisch evaluiert.

**So ist es heute umgesetzt:** Schemas und Dienste lehnen unbekannte Felder, ungültige Zahlen, falsche Referenzen, unvollständige Profile und veraltete Bestätigungen ab. Werkzeugtexte führen ChatGPT durch den Ablauf. Ob ein Modell widersprüchliche Sätze wie doch nur zweimal oder eine unklare Satzkorrektur richtig versteht, ist eine zusätzliche Ebene.

**Maßgebliche Dateien und ihre Aufgabe:**

- [src/shared/workout-contract.ts](/Users/kevingusmao/Desktop/Arnold/src/shared/workout-contract.ts:39): Verbindlicher Ein-/Ausgabevertrag für Trainingsänderungen.
- [src/shared/plan-contract.ts](/Users/kevingusmao/Desktop/Arnold/src/shared/plan-contract.ts:446): Verbindlicher Vertrag für Planversionen und Bearbeitungen.
- [src/shared/onboarding-contract.ts](/Users/kevingusmao/Desktop/Arnold/src/shared/onboarding-contract.ts:1): Fragen, Profilfelder und Zustände der Einrichtung.
- [src/server/mcp-onboarding.ts](/Users/kevingusmao/Desktop/Arnold/src/server/mcp-onboarding.ts:1): Führt ChatGPT durch die Einrichtung und Planbestätigung.
- [src/server/workout/service.ts](/Users/kevingusmao/Desktop/Arnold/src/server/workout/service.ts:1): Prüft und verarbeitet Training, Satzkorrekturen und Abschluss.

**Tests und Nachweis:** Viele negative MCP-/Servicefälle bestehen; die jüngsten Datumsfehler haben jetzt dauerhafte Regressionen.

Relevante Tests: [tests/workout-logging.test.ts](/Users/kevingusmao/Desktop/Arnold/tests/workout-logging.test.ts:1), [tests/workout-mcp.test.ts](/Users/kevingusmao/Desktop/Arnold/tests/workout-mcp.test.ts:1), [tests/onboarding-mcp.test.ts](/Users/kevingusmao/Desktop/Arnold/tests/onboarding-mcp.test.ts:1), [tests/onboarding-profile.test.ts](/Users/kevingusmao/Desktop/Arnold/tests/onboarding-profile.test.ts:1).

**Offen, problematisch oder verbesserbar:** Ein dokumentierter Korpus natürlicher Chat-Eingaben mit erwarteter Rückfrage, Werkzeugwahl und Ergebnis fehlt.

**Nächster sinnvoller Schritt:** Typische mehrdeutige, widersprüchliche und fehlende Angaben als echte Chat-Prüffälle sammeln und getrennt von JSON-Validierung bewerten.


### 10.09 · Backup, Recovery und Schema-Migration testen

**Fortschritt: 25 % · Grundlage vorhanden.**

**Einordnung:** Einzelne Recovery- und Altformatfälle sind getestet; Backup und allgemeine Migration bleiben offen.

**So ist es heute umgesetzt:** Dateijournale überleben Neustarts; verlorene Schreibantworten werden geprüft. Die Onboarding-Repository-Schicht kann ein altes Profilformat beim Lesen übernehmen. Ein neuer Rohschema-Stand von Google-Tabellen wird dagegen nicht allgemein migriert, und ein Verlust des gesamten Zustands wurde nicht wiederhergestellt.

**Maßgebliche Dateien und ihre Aufgabe:**

- [src/server/workout/infrastructure.ts](/Users/kevingusmao/Desktop/Arnold/src/server/workout/infrastructure.ts:276): Speichert vollständige Änderungsdatensätze im Operationsjournal.
- [src/server/connected/state.ts](/Users/kevingusmao/Desktop/Arnold/src/server/connected/state.ts:1): Speichert Entwürfe und Auditdaten atomar als Betreiberdateien.
- [src/server/onboarding/repository.ts](/Users/kevingusmao/Desktop/Arnold/src/server/onboarding/repository.ts:1): Persistiert Einrichtungsprofile, Revisionen und begrenzte Altformatmigration.
- [src/shared/arnold-schema-v1.ts](/Users/kevingusmao/Desktop/Arnold/src/shared/arnold-schema-v1.ts:5): Legt die sechs Tabellen, Spalten, IDs und Datenregeln fest.
- [docs/GUIDE.md](/Users/kevingusmao/Desktop/Arnold/docs/GUIDE.md:341): Beschreibt, welche Daten zusätzlich zum Code gesichert werden müssen.

**Tests und Nachweis:** Tests behandeln Prozessneustart, atomare Dateioperationen und ältere Onboarding-Records.

Relevante Tests: [tests/workout-restart.test.ts](/Users/kevingusmao/Desktop/Arnold/tests/workout-restart.test.ts:1), [tests/connected-storage.test.ts](/Users/kevingusmao/Desktop/Arnold/tests/connected-storage.test.ts:1), [tests/onboarding-security.test.ts](/Users/kevingusmao/Desktop/Arnold/tests/onboarding-security.test.ts:1).

**Offen, problematisch oder verbesserbar:** Neustart ist kein Totalausfall-Restore. Es fehlen gesicherte Testbackups, Schlüsselwiederherstellung, Migration der Trainingsdatei und ein nachvollziehbarer Rückweg.

**Nächster sinnvoller Schritt:** Ein synthetisches Wiederherstellungsszenario vom vollständigen Verlust bis zur wieder nutzbaren Tabelle definieren und ausführen.


### 10.10 · Beta-Feedback erfassen und kritische Fehler beheben

**Fortschritt: 50 % · Teilweise umgesetzt.**

**Einordnung:** Feedback fließt in Korrekturen ein; ein durchgehender Beta-Prozess fehlt.

**So ist es heute umgesetzt:** Die gestrigen UI-/Onboarding-Änderungen und die drei jetzt gepushten Schutzkorrekturen zeigen einen aktiven Verbesserungsprozess. Der heutige Bericht macht weitere Lücken sichtbar. Es gibt aber kein gepflegtes Beta-Board mit Priorität, Reproduktion, Verantwortlichem und Abnahmekriterium.

**Maßgebliche Dateien und ihre Aufgabe:**

- [docs/GUIDE.md](/Users/kevingusmao/Desktop/Arnold/docs/GUIDE.md:1): Dokumentiert Architektur, Datenregeln und bekannte Grenzen.
- [src/server/workout/service.ts](/Users/kevingusmao/Desktop/Arnold/src/server/workout/service.ts:1): Prüft und verarbeitet Training, Satzkorrekturen und Abschluss.
- [src/server/plan/service.ts](/Users/kevingusmao/Desktop/Arnold/src/server/plan/service.ts:1): Verwaltet Entwürfe, Freigabe, Aktivierung und historische Pläne.
- [package.json](/Users/kevingusmao/Desktop/Arnold/package.json:1): Abhängigkeiten, Node-Version und ausführbare Projektbefehle.

**Tests und Nachweis:** Die drei vorher reproduzierten Fehler sind in Commit 2c5ad57 behoben; 1.261 Unit-/Integrationstests und 52 Browser-Tests bestehen.

Relevante Tests: [tests/plan-activation.test.ts](/Users/kevingusmao/Desktop/Arnold/tests/plan-activation.test.ts:1), [tests/workout-logging.test.ts](/Users/kevingusmao/Desktop/Arnold/tests/workout-logging.test.ts:1).

**Offen, problematisch oder verbesserbar:** Weitere S001-Integrationspunkte, Parser-Logging, Datenaufbewahrung und Produktlücken sind offen. Die GitHub-Suche fand keine offenen Issues als zentrale Sammlung.

**Nächster sinnvoller Schritt:** Die priorisierten Befunde dieses Berichts in wenige nachvollziehbare Arbeitspakete mit klarer Abnahme überführen.


<a id="bereich-11"></a>

## 11 · OpenAI-Veröffentlichung


### 11.01 · Entwicklerkonto und Identität bei OpenAI verifizieren

**Fortschritt: Nicht seriös bezifferbar · Nicht belegt / extern offen.**

**Einordnung:** Die Entwickler-/Identitätsverifizierung lässt sich mit den verfügbaren Nachweisen nicht bestätigen.

**So ist es heute umgesetzt:** Ein privates Plugin und die Verbindung zum eigenen MCP-Dienst beweisen, dass Entwicklungszugang existiert. Sie zeigen nicht, ob der veröffentlichende Mensch oder die Organisation im OpenAI-Dashboard bereits die erforderliche Verifizierung abgeschlossen hat.

**Maßgebliche Dateien und ihre Aufgabe:**

- [README.md](/Users/kevingusmao/Desktop/Arnold/README.md:1): Erklärt Produktzweck, Start und Betriebsarten.
- [docs/GUIDE.md](/Users/kevingusmao/Desktop/Arnold/docs/GUIDE.md:1): Dokumentiert Architektur, Datenregeln und bekannte Grenzen.

**Tests und Nachweis:** Privates Plugin-Metadatum ist vorhanden; der relevante Account-Verifizierungsstatus ist nicht Teil des Repositories oder der gelesenen Plugin-Dateien.

**Offen, problematisch oder verbesserbar:** Ein Prozentwert oder die Aussage erledigt wäre ohne Dashboard-Nachweis erfunden.

**Nächster sinnvoller Schritt:** Den Verifizierungsstatus des vorgesehenen Herausgebers im Dashboard prüfen und den Abschluss als Release-Nachweis festhalten.

**Aktuelle externe Grundlage:** [Offizielle Dokumentation](https://developers.openai.com/plugins/plugin-guidelines).


### 11.02 · Produktnamen, Marke, Logo und Plugin-Beschreibung vorbereiten

**Fortschritt: 50 % · Teilweise umgesetzt.**

**Einordnung:** Name und visuelle Richtung existieren; veröffentlichungsfähige Marken-/Listingdaten fehlen.

**So ist es heute umgesetzt:** Das Produkt heißt Arnold und hat eine konsistente monochrome Gestaltung sowie ein dokumentiertes Bildmotiv. Das tatsächlich vorhandene private Plugin verwendet jedoch Beschreibung Live, Kategorie Other und Entwicklername App developer. Ein ausgearbeitetes Markenlogo oder eine öffentliche Plugin-Beschreibung sind dort nicht hinterlegt.

**Maßgebliche Dateien und ihre Aufgabe:**

- [README.md](/Users/kevingusmao/Desktop/Arnold/README.md:1): Erklärt Produktzweck, Start und Betriebsarten.
- [src/ui/glass.css](/Users/kevingusmao/Desktop/Arnold/src/ui/glass.css:1): Gemeinsame Designbasis und responsive Gestaltungsregeln.
- [src/ui/assets/README.md](/Users/kevingusmao/Desktop/Arnold/src/ui/assets/README.md:1): Dokumentiert Herkunft des Arnold-Bildmotivs.

**Tests und Nachweis:** Repository und die gelesene .codex-plugin/plugin.json des privaten Plugins belegen den Unterschied.

Auditbelege: [private-plugin-evidence.json](/Users/kevingusmao/.codex/visualizations/2026/10/31/01a191e8-3845-7550-9bc3-670d3c146ee3/arnold-checklist-audit-2026-10-31/private-plugin-evidence.json).

**Offen, problematisch oder verbesserbar:** Ein internes Testlabel ist keine verständliche öffentliche Positionierung. Herkunft, Nutzungsrechte und finale Markenbestandteile müssen für die konkrete Veröffentlichung feststehen.

**Nächster sinnvoller Schritt:** Finalen Herausgeber, Kurz-/Langbeschreibung, Logo und passende Kategorie formulieren und als versionierte Release-Unterlagen speichern.


### 11.03 · Plugin-Paket mit plugin.json und mcp.json zusammenstellen

**Fortschritt: 25 % · Grundlage vorhanden.**

**Einordnung:** Ein privates Testpaket existiert; ein öffentlich einreichbares Paket fehlt.

**So ist es heute umgesetzt:** Das private Arnold-Plugin enthält .codex-plugin/plugin.json und .app.json mit einer registrierten App-Referenz. Im Repository liegen weder ein portables plugin.json noch eine MCP-Konfiguration für eine öffentliche Einreichung. Die aktuelle OpenAI-Dokumentation akzeptiert das private App-Referenzpaket nicht unverändert als öffentliches ZIP.

**Maßgebliche Dateien und ihre Aufgabe:**

- [package.json](/Users/kevingusmao/Desktop/Arnold/package.json:1): Abhängigkeiten, Node-Version und ausführbare Projektbefehle.
- [README.md](/Users/kevingusmao/Desktop/Arnold/README.md:1): Erklärt Produktzweck, Start und Betriebsarten.
- [docs/GUIDE.md](/Users/kevingusmao/Desktop/Arnold/docs/GUIDE.md:1): Dokumentiert Architektur, Datenregeln und bekannte Grenzen.

**Tests und Nachweis:** Die Plugin-Creator-Schnittstelle lieferte die beiden Dateien und den Status PRIVATE. Der lokale Code enthält kein gesondertes Einreichungspaket.

Auditbelege: [private-plugin-evidence.json](/Users/kevingusmao/.codex/visualizations/2026/10/31/01a191e8-3845-7550-9bc3-670d3c146ee3/arnold-checklist-audit-2026-10-31/private-plugin-evidence.json).

**Offen, problematisch oder verbesserbar:** MCP-Endpunktzuordnung, öffentliche Metadaten, Assets und weitere Review-Unterlagen müssen in einer dafür geeigneten Paketform zusammengestellt werden.

**Nächster sinnvoller Schritt:** Ein separates versioniertes Release-Paket nach aktueller Paket-/Submission-Dokumentation vorbereiten; die private Installation dabei erhalten.

**Aktuelle externe Grundlage:** [Offizielle Dokumentation](https://developers.openai.com/plugins/deploy/submission).


### 11.04 · Produktions-MCP-Server auf einer stabilen HTTPS-Domain bereitstellen

**Fortschritt: 50 % · Teilweise umgesetzt.**

**Einordnung:** Ein stabiler HTTPS-Server läuft; die öffentlich produktive Freigabe ist noch nicht erreicht.

**So ist es heute umgesetzt:** Cloud Run stellt eine dauerhafte HTTPS-Adresse bereit und bindet persönlichen Zustand sowie OAuth ein. Der aktive Dienst verwendet aber development und einen Staging-Anmeldeanbieter. Die neueste Codefassung ist außerdem bewusst noch nicht veröffentlicht.

**Maßgebliche Dateien und ihre Aufgabe:**

- [scripts/deploy-cloud-run.sh](/Users/kevingusmao/Desktop/Arnold/scripts/deploy-cloud-run.sh:1): Manuelles Cloud-Run-Deployment mit Login, Speicher und Healthchecks.
- [src/server/bootstrap.ts](/Users/kevingusmao/Desktop/Arnold/src/server/bootstrap.ts:1): Prüft Konfiguration und verbindet Authentifizierung mit Google-Laufzeit.
- [src/server/auth/config.ts](/Users/kevingusmao/Desktop/Arnold/src/server/auth/config.ts:1): Stoppt bei unsicheren oder widersprüchlichen Anmeldeeinstellungen.
- [docs/GUIDE.md](/Users/kevingusmao/Desktop/Arnold/docs/GUIDE.md:1): Dokumentiert Architektur, Datenregeln und bekannte Grenzen.

**Tests und Nachweis:** Live-Health, Authentifizierung, aktive Revision und Zustandsvolume wurden unabhängig geprüft.

**Offen, problematisch oder verbesserbar:** Eigene Domain, Produktionskonfiguration, gelöste Release-Befunde und vollständige Abnahme fehlen beziehungsweise sind nicht nachgewiesen.

**Nächster sinnvoller Schritt:** Vor der öffentlichen Einreichung einen eindeutig benannten Produktionsstand mit abgearbeiteten Datenschutz-, Betriebs- und Produktgates bereitstellen.


### 11.05 · Domain-Challenge erfolgreich abschließen

**Fortschritt: Nicht seriös bezifferbar · Nicht belegt / extern offen.**

**Einordnung:** Eine erfolgreiche OpenAI-Domain-Challenge ist nicht nachgewiesen.

**So ist es heute umgesetzt:** OAuth-Discovery unter .well-known beschreibt den Anmeldeanbieter; das ist keine Domain-Verifizierung für eine Plugin-Veröffentlichung. In den gelesenen Projekt-/Plugin-Unterlagen liegt kein Challenge-Ergebnis. Es wurde kein Verifizierungsstatus im Veröffentlichungsdashboard geöffnet.

**Maßgebliche Dateien und ihre Aufgabe:**

- [src/server/auth/router.ts](/Users/kevingusmao/Desktop/Arnold/src/server/auth/router.ts:1): Verbindet OAuth-Metadaten und geschützte HTTP-Aufrufe.
- [scripts/deploy-cloud-run.sh](/Users/kevingusmao/Desktop/Arnold/scripts/deploy-cloud-run.sh:1): Manuelles Cloud-Run-Deployment mit Login, Speicher und Healthchecks.

**Tests und Nachweis:** Der Audit belegt nur die funktionierenden OAuth-Metadaten und die Google-Dienstadresse.

**Offen, problematisch oder verbesserbar:** Ob bereits außerhalb des Repositories eine Domain erfolgreich verifiziert wurde, bleibt unbekannt.

**Nächster sinnvoller Schritt:** Die für den Release vorgesehene Domain im richtigen Dashboard verifizieren und den erfolgreichen Status dokumentieren.


### 11.06 · Alle Tools mit korrekten Beschreibungen, Schemas und Sicherheits-Annotationen ausstatten

**Fortschritt: 75 % · Weitgehend umgesetzt.**

**Einordnung:** Beschreibungen, Schemas und Sicherheits-Hinweise sind weitgehend vorhanden, aber noch nicht vollständig einreichungsreif.

**So ist es heute umgesetzt:** Alle vorhandenen Bereiche haben beschriebene Werkzeuge und Eingabeverträge. Sicherheits-Annotationen kennzeichnen Lesen, Änderungen und Wiederholbarkeit. Bei get_google_connection fehlt jedoch destructiveHint als ausdrücklicher Boolean. Ein begrenztes privates Konto darf laut aktueller Richtlinie openWorldHint=false verwenden; externe Speicherung allein wäre kein Fehler.

**Maßgebliche Dateien und ihre Aufgabe:**

- [src/server/mcp-arnold.ts](/Users/kevingusmao/Desktop/Arnold/src/server/mcp-arnold.ts:1): Registriert Dashboard-, Historien- und Fortschrittswerkzeuge.
- [src/server/mcp-workout.ts](/Users/kevingusmao/Desktop/Arnold/src/server/mcp-workout.ts:1): Registriert Werkzeuge zum Starten, Speichern und Korrigieren von Trainings.
- [src/server/mcp-plan.ts](/Users/kevingusmao/Desktop/Arnold/src/server/mcp-plan.ts:1): Registriert lesende und schreibende Planwerkzeuge.
- [src/server/mcp-onboarding.ts](/Users/kevingusmao/Desktop/Arnold/src/server/mcp-onboarding.ts:1): Führt ChatGPT durch die Einrichtung und Planbestätigung.
- [src/server/connected/mcp-google.ts](/Users/kevingusmao/Desktop/Arnold/src/server/connected/mcp-google.ts:1): Verbindung, Fertigstellung, Verbindungsstatus und Trennen von Google.
- [src/server/auth/tool-access.ts](/Users/kevingusmao/Desktop/Arnold/src/server/auth/tool-access.ts:1): Vollständige Zuordnung aller Werkzeuge zu Zugriffsklassen.

**Tests und Nachweis:** Registrierungs-/Schematests bestehen. Der manuelle Vergleich der Annotationen mit der aktuellen Richtlinie zeigt die konkrete Lücke.

Relevante Tests: [tests/auth-tool-access.test.ts](/Users/kevingusmao/Desktop/Arnold/tests/auth-tool-access.test.ts:1), [tests/arnold-mcp.test.ts](/Users/kevingusmao/Desktop/Arnold/tests/arnold-mcp.test.ts:1), [tests/plan-mcp.test.ts](/Users/kevingusmao/Desktop/Arnold/tests/plan-mcp.test.ts:1), [tests/workout-mcp.test.ts](/Users/kevingusmao/Desktop/Arnold/tests/workout-mcp.test.ts:1).

**Offen, problematisch oder verbesserbar:** Die öffentlichen Beschreibungen und alle drei verlangten Sicherheits-Booleans müssen für den tatsächlichen Release vollständig geprüft werden. Bestehende interne Tests sind noch kein OpenAI-Scan.

**Nächster sinnvoller Schritt:** Für jedes im Release sichtbare Werkzeug eine kleine Metadatenmatrix prüfen und die fehlenden Angaben mit Regression absichern.

**Aktuelle externe Grundlage:** [Offizielle Dokumentation](https://developers.openai.com/plugins/plugin-guidelines).


### 11.07 · Datenschutz-, Nutzungsbedingungen-, Website- und Support-Links bereitstellen

**Fortschritt: 0 % · Nicht umgesetzt / kein Liefernachweis.**

**Einordnung:** Öffentliche Datenschutz-, Vertrags-, Website- und Support-Links sind nicht als Release-Unterlagen vorhanden.

**So ist es heute umgesetzt:** README und Guide richten sich an Entwickler. Im privaten Plugin-Paket fehlen entsprechende öffentliche URLs. Eine geschützte MCP-Adresse oder eine Google-Tabelle ersetzt keine zugängliche Produkt-/Supportseite mit den für Kunden nötigen Informationen.

**Maßgebliche Dateien und ihre Aufgabe:**

- [README.md](/Users/kevingusmao/Desktop/Arnold/README.md:1): Erklärt Produktzweck, Start und Betriebsarten.
- [docs/GUIDE.md](/Users/kevingusmao/Desktop/Arnold/docs/GUIDE.md:1): Dokumentiert Architektur, Datenregeln und bekannte Grenzen.
- [scripts/deploy-cloud-run.sh](/Users/kevingusmao/Desktop/Arnold/scripts/deploy-cloud-run.sh:1): Manuelles Cloud-Run-Deployment mit Login, Speicher und Healthchecks.

**Tests und Nachweis:** Repository und privates Plugin-Manifest wurden geprüft; keine vollständige Link-Sammlung gefunden.

**Offen, problematisch oder verbesserbar:** Es fehlen öffentliche Texte, erreichbarer Support und die Zuordnung zum tatsächlichen Herausgeber. Eine externe schon bestehende Website wurde nicht benannt.

**Nächster sinnvoller Schritt:** Die rechtlichen und unterstützenden Inhalte auf einer kontrollierten Domain bereitstellen und im Release-Paket verlinken.


### 11.08 · Test-Demokonto mit synthetischen Beispieldaten bereitstellen

**Fortschritt: 50 % · Teilweise umgesetzt.**

**Einordnung:** Synthetischer Demobetrieb ist vorhanden; ein dokumentiertes Reviewer-Konto fehlt.

**So ist es heute umgesetzt:** Das Fixture-Profil liefert erfundene Daten und kann hinter Anmeldung je Nutzer eine eigene Sandbox bereitstellen. Das private Arnold-Plugin ist ein Testartefakt. Der aktive Connected-Dienst legt dagegen persönliche Google-Dateien an und ist kein automatisch geeigneter synthetischer Reviewer-Zugang.

**Maßgebliche Dateien und ihre Aufgabe:**

- [scripts/deploy-cloud-run.sh](/Users/kevingusmao/Desktop/Arnold/scripts/deploy-cloud-run.sh:1): Manuelles Cloud-Run-Deployment mit Login, Speicher und Healthchecks.
- [src/server/connected/runtime.ts](/Users/kevingusmao/Desktop/Arnold/src/server/connected/runtime.ts:1): Erzeugt und bindet die eigene Trainingsdatei je angemeldetem Nutzer.
- [package.json](/Users/kevingusmao/Desktop/Arnold/package.json:1): Abhängigkeiten, Node-Version und ausführbare Projektbefehle.
- [docs/GUIDE.md](/Users/kevingusmao/Desktop/Arnold/docs/GUIDE.md:1): Dokumentiert Architektur, Datenregeln und bekannte Grenzen.

**Tests und Nachweis:** Fixture-/Sandbox-Tests belegen synthetische Trennung. Reviewer-Anmeldedaten, Zugangsanleitung und sicherer Reset wurden nicht als Abnahmepaket gefunden.

Relevante Tests: [tests/auth-fixture-sandbox.test.ts](/Users/kevingusmao/Desktop/Arnold/tests/auth-fixture-sandbox.test.ts:1).

**Offen, problematisch oder verbesserbar:** Ein menschlicher Reviewer muss den vorgesehenen Weg ohne eigene echte Trainingsdaten zuverlässig ausführen können.

**Nächster sinnvoller Schritt:** Einen klar getrennten synthetischen Demo-Zugang mit dokumentiertem Einstieg und Reset für die spätere Einreichung bereitstellen.


### 11.09 · Fünf positive und drei negative Prüffälle dokumentieren

**Fortschritt: 25 % · Grundlage vorhanden.**

**Einordnung:** Viele technische Tests sind vorhanden; die verlangten fünf positiven und drei negativen Reviewfälle fehlen als Dokument.

**So ist es heute umgesetzt:** Die bestehenden Tests liefern gute Bausteine für Einrichtung, Training, Planänderung und Rechtefehler. Sie sind jedoch keine kurze reviewerlesbare Sammlung mit Nutzerprompt, erwarteten Werkzeugen und beobachtbarem Ergebnis. Im privaten Paket gibt es keine entsprechende Review-Metadatenliste.

**Maßgebliche Dateien und ihre Aufgabe:**

- [package.json](/Users/kevingusmao/Desktop/Arnold/package.json:1): Abhängigkeiten, Node-Version und ausführbare Projektbefehle.
- [src/server/mcp-arnold.ts](/Users/kevingusmao/Desktop/Arnold/src/server/mcp-arnold.ts:1): Registriert Dashboard-, Historien- und Fortschrittswerkzeuge.
- [src/server/mcp-workout.ts](/Users/kevingusmao/Desktop/Arnold/src/server/mcp-workout.ts:1): Registriert Werkzeuge zum Starten, Speichern und Korrigieren von Trainings.
- [src/server/mcp-onboarding.ts](/Users/kevingusmao/Desktop/Arnold/src/server/mcp-onboarding.ts:1): Führt ChatGPT durch die Einrichtung und Planbestätigung.

**Tests und Nachweis:** Die offizielle Submission-Dokumentation und vorhandenen Tests wurden abgeglichen; ein genau passendes 5/3-Prüfpaket wurde nicht gefunden.

Relevante Tests: [tests/connected-journey.test.ts](/Users/kevingusmao/Desktop/Arnold/tests/connected-journey.test.ts:1), [tests/workout-mcp.test.ts](/Users/kevingusmao/Desktop/Arnold/tests/workout-mcp.test.ts:1), [tests/onboarding-mcp.test.ts](/Users/kevingusmao/Desktop/Arnold/tests/onboarding-mcp.test.ts:1).

**Offen, problematisch oder verbesserbar:** Automatisierte Testanzahl allein erfüllt diese konkrete Einreichungsanforderung nicht.

**Nächster sinnvoller Schritt:** Aus dem später freigegebenen Produkt exakt fünf positive und drei negative reale Reviewer-Szenarien ableiten und mit dem Demo-Zugang ausführen.

**Aktuelle externe Grundlage:** [Offizielle Dokumentation](https://developers.openai.com/plugins/deploy/submission).


### 11.10 · Demo-Video der Hauptfunktionen erstellen

**Fortschritt: 0 % · Nicht umgesetzt / kein Liefernachweis.**

**Einordnung:** Ein zugängliches Demo-Video der Hauptfunktionen ist nicht nachgewiesen.

**So ist es heute umgesetzt:** Das Repository enthält UI-Code, Tests und ein Bildmotiv, aber keinen dokumentierten Aufnahme-Link. Die gelesenen privaten Plugin-Dateien enthalten ebenfalls keine Demo-Aufzeichnung. Eine laufende lokale Vorschau ist nicht dasselbe wie ein für Reviewer erreichbares Video.

**Maßgebliche Dateien und ihre Aufgabe:**

- [README.md](/Users/kevingusmao/Desktop/Arnold/README.md:1): Erklärt Produktzweck, Start und Betriebsarten.
- [docs/GUIDE.md](/Users/kevingusmao/Desktop/Arnold/docs/GUIDE.md:1): Dokumentiert Architektur, Datenregeln und bekannte Grenzen.
- [src/ui/assets/README.md](/Users/kevingusmao/Desktop/Arnold/src/ui/assets/README.md:1): Dokumentiert Herkunft des Arnold-Bildmotivs.

**Tests und Nachweis:** Keine Video-URL oder entsprechende Review-Datei in den geprüften Lieferunterlagen gefunden.

**Offen, problematisch oder verbesserbar:** Aufnahme, freigegebener Beispieldatenstand und erreichbarer Hosting-Link fehlen als Nachweis.

**Nächster sinnvoller Schritt:** Nach Stabilisierung die Hauptwege und die geforderten Reviewfälle mit synthetischen Daten aufnehmen.

**Aktuelle externe Grundlage:** [Offizielle Dokumentation](https://developers.openai.com/plugins/deploy/submission).


### 11.11 · Automatischen MCP-Tool-Scan durchführen und Befunde beheben

**Fortschritt: 0 % · Nicht umgesetzt / kein Liefernachweis.**

**Einordnung:** Ein OpenAI-MCP-Tool-Scan mit abgearbeiteten Befunden ist nicht nachgewiesen.

**So ist es heute umgesetzt:** Die lokalen Tests prüfen eigenes Verhalten und Vertragsdetails. Es liegt aber kein Ergebnis des automatisierten Veröffentlichungs-Scans mit Versionsbezug vor. Auch die heute gefundene fehlende Annotation zeigt, dass der lokale Gesamtcheck nicht alle externen Reviewregeln erzwingt.

**Maßgebliche Dateien und ihre Aufgabe:**

- [package.json](/Users/kevingusmao/Desktop/Arnold/package.json:1): Abhängigkeiten, Node-Version und ausführbare Projektbefehle.
- [src/server/auth/tool-access.ts](/Users/kevingusmao/Desktop/Arnold/src/server/auth/tool-access.ts:1): Vollständige Zuordnung aller Werkzeuge zu Zugriffsklassen.
- [src/server/connected/mcp-google.ts](/Users/kevingusmao/Desktop/Arnold/src/server/connected/mcp-google.ts:1): Verbindung, Fertigstellung, Verbindungsstatus und Trennen von Google.

**Tests und Nachweis:** Kein Scanprotokoll im Repository oder privaten Paket vorhanden; die öffentlichen Werkzeuge wurden in diesem Auftrag nicht neu eingereicht.

**Offen, problematisch oder verbesserbar:** Ohne Scanbericht kann keine abgeschlossene Scan-/Befundrunde bestätigt werden.

**Nächster sinnvoller Schritt:** Das einreichbare Paket später scannen lassen und jede Meldung gegen die genaue Release-Version prüfen.

**Aktuelle externe Grundlage:** [Offizielle Dokumentation](https://developers.openai.com/plugins/deploy/submission).


### 11.12 · Plugin zur OpenAI-Prüfung einreichen

**Fortschritt: Nicht seriös bezifferbar · Nicht belegt / extern offen.**

**Einordnung:** Eine öffentliche Einreichung zur OpenAI-Prüfung ist nicht bestätigt.

**So ist es heute umgesetzt:** Ein privates Plugin ist installiert und kann getestet werden. PRIVATE bedeutet jedoch nicht automatisch, dass niemals eine gesonderte Einreichung angelegt wurde, und beweist auch keine öffentliche Review-Abnahme. Der genaue Submission-Status war über die gelesenen Dateien nicht zugänglich.

**Maßgebliche Dateien und ihre Aufgabe:**

- [README.md](/Users/kevingusmao/Desktop/Arnold/README.md:1): Erklärt Produktzweck, Start und Betriebsarten.
- [docs/GUIDE.md](/Users/kevingusmao/Desktop/Arnold/docs/GUIDE.md:1): Dokumentiert Architektur, Datenregeln und bekannte Grenzen.

**Tests und Nachweis:** Privater Paketstatus wurde unabhängig gelesen; ein öffentlicher Einreichungsbeleg oder Reviewstatus wurde nicht vorgelegt.

Auditbelege: [private-plugin-evidence.json](/Users/kevingusmao/.codex/visualizations/2026/10/31/01a191e8-3845-7550-9bc3-670d3c146ee3/arnold-checklist-audit-2026-10-31/private-plugin-evidence.json).

**Offen, problematisch oder verbesserbar:** Ein Prozentwert wäre ohne Dashboard-Status unzuverlässig. Mehrere technische und inhaltliche Einreichungsvoraussetzungen sind nach diesem Audit ohnehin offen.

**Nächster sinnvoller Schritt:** Nach Fertigstellung der Unterlagen den tatsächlichen Einreichungsstatus im Dashboard dokumentieren.

**Aktuelle externe Grundlage:** [Offizielle Dokumentation](https://developers.openai.com/plugins/deploy/submission).


### 11.13 · Nach Freigabe Veröffentlichung und Wartungsprozess starten

**Fortschritt: 0 % · Nicht umgesetzt / kein Liefernachweis.**

**Einordnung:** Eine öffentliche Veröffentlichung mit abgestimmtem Wartungsprozess ist nicht nachgewiesen.

**So ist es heute umgesetzt:** Arnold hat einen laufenden Entwicklungsdienst und eine private Testinstallation. Ein öffentlicher Directory-Eintrag, dokumentierte Freigabe sowie ein Release-/Supportprozess mit Verantwortlichkeit und Rückfallweg liegen nicht als Projektunterlagen vor.

**Maßgebliche Dateien und ihre Aufgabe:**

- [scripts/deploy-cloud-run.sh](/Users/kevingusmao/Desktop/Arnold/scripts/deploy-cloud-run.sh:1): Manuelles Cloud-Run-Deployment mit Login, Speicher und Healthchecks.
- [docs/GUIDE.md](/Users/kevingusmao/Desktop/Arnold/docs/GUIDE.md:1): Dokumentiert Architektur, Datenregeln und bekannte Grenzen.
- [package.json](/Users/kevingusmao/Desktop/Arnold/package.json:1): Abhängigkeiten, Node-Version und ausführbare Projektbefehle.

**Tests und Nachweis:** Das geprüfte Plugin ist PRIVATE; automatische CI-/Release-Gates und ein Wartungshandbuch fehlen im Repository.

**Offen, problematisch oder verbesserbar:** Öffentliche Verfügbarkeit, Versionspflege, Störungsreaktion, Support und kontrollierte Metadatenupdates sind noch kein abgeschlossener Prozess.

**Nächster sinnvoller Schritt:** Vor öffentlicher Freigabe Releaseverantwortung, Prüfpflichten, Supportweg und Notfallmaßnahmen festlegen.

**Aktuelle externe Grundlage:** [Offizielle Dokumentation](https://developers.openai.com/plugins/deploy/submission).


## Konkrete Arbeitsreihenfolge nach diesem Audit

1. **Produktentscheidungen:** V1-Grenze für Körpergewicht/Kardio, strenge Datenbesitzregel, Wochenziel-Einheit und das konkrete externe Angebot festhalten. Diese Entscheidungen verändern die Roadmap und brauchen deine Produktentscheidung.
2. **Sicherheits-/Integritätsarbeit:** Parser-Loglücke schließen; Kapazitäts- und Recovery-Korrekturen aus S001 gegen den aktuellen Connected-/Auth-Stand abgleichen. Danach die verbleibenden UI-/Plan-Lebenszyklusdetails prüfen.
3. **Datenlebenszyklus:** vollständigen Export-/Löschweg, begrenzte Journalaufbewahrung und getestete Sicherung/Wiederherstellung umsetzen. Ein bloßes Google-Trennen erfüllt diese Aufgaben nicht.
4. **Kundenzugang:** erst nach dem konkret geprüften Geschäftsmodell Anspruchs-/Lizenzmodell und erforderliche externe Zahlungsintegration bauen.
5. **Releaseabnahme:** stabile Produktionskonfiguration, genaue Commit-/Revisionzuordnung, zwei echte Testkonten, echter ChatGPT-Host und Geräteprüfung. Der derzeitige Auftrag enthält keinen Deployment-Schritt.
6. **Öffentliche Veröffentlichung:** separate einreichbare Paketform, finale Metadaten und URLs, synthetischer Reviewer-Zugang, fünf positive/drei negative Fälle, Video und Scan. Dashboard-Nachweise für Verifizierung, Domain und Einreichungsstatus ergänzen.

Die konkrete Dauer lässt sich aus diesem Audit nicht seriös in Stunden umrechnen. Kleine Fehlerkorrekturen, Architekturentscheidungen und Geschäftsbetrieb sind unterschiedliche Arbeitspakete.

## Welche Dateien dafür angelegt oder geändert wurden

Bei jedem Punkt stehen die heute maßgeblichen Dateien mit ihrer Aufgabe und geprüfter Zeile. Einige Anforderungen wurden in bestehenden Dateien ergänzt, nicht in eigens benannten Feature-Dateien. Die folgende Dateikarte nennt zusätzlich den ersten Anlagecommit des heutigen Pfads in der main-Historie. Das ist ein Git-Nachweis der Dateieinführung, keine Behauptung über die Urheberschaft einzelner späterer Änderungen.


| Datei | Aufgabe | Einführung unter heutigem Pfad |
| --- | --- | --- |
| [.gcloudignore](/Users/kevingusmao/Desktop/Arnold/.gcloudignore:1) | Schließt viele Geheimnisdateien vom Upload aus; Worktrees fehlen noch. | [c9b43e5](https://github.com/DosiGus/Arnold/commit/c9b43e5) · 2026-10-30 |
| [CLAUDE.md](/Users/kevingusmao/Desktop/Arnold/CLAUDE.md:1) | Entwicklungsregeln und vollständiger Prüfbefehl. | [330a2e9](https://github.com/DosiGus/Arnold/commit/330a2e9) · 2026-10-29 |
| [Dockerfile](/Users/kevingusmao/Desktop/Arnold/Dockerfile:1) | Reproduzierbarer Build und Laufzeit als unprivilegierter Nutzer. | [fd95018](https://github.com/DosiGus/Arnold/commit/fd95018) · 2026-10-25 |
| [README.md](/Users/kevingusmao/Desktop/Arnold/README.md:1) | Erklärt Produktzweck, Start und Betriebsarten. | [fd95018](https://github.com/DosiGus/Arnold/commit/fd95018) · 2026-10-25 |
| [docs/GUIDE.md](/Users/kevingusmao/Desktop/Arnold/docs/GUIDE.md:341) | Beschreibt, welche Daten zusätzlich zum Code gesichert werden müssen. | [7f4200b](https://github.com/DosiGus/Arnold/commit/7f4200b) · 2026-10-29 |
| [package.json](/Users/kevingusmao/Desktop/Arnold/package.json:1) | Abhängigkeiten, Node-Version und ausführbare Projektbefehle. | [fd95018](https://github.com/DosiGus/Arnold/commit/fd95018) · 2026-10-25 |
| [playwright.config.ts](/Users/kevingusmao/Desktop/Arnold/playwright.config.ts:1) | Chromium-Browserprüfungen mit synthetischen lokalen Testservern. | [fd95018](https://github.com/DosiGus/Arnold/commit/fd95018) · 2026-10-25 |
| [scripts/deploy-cloud-run.sh](/Users/kevingusmao/Desktop/Arnold/scripts/deploy-cloud-run.sh:1) | Manuelles Cloud-Run-Deployment mit Login, Speicher und Healthchecks. | [c9b43e5](https://github.com/DosiGus/Arnold/commit/c9b43e5) · 2026-10-30 |
| [scripts/setup-cloud-infra.sh](/Users/kevingusmao/Desktop/Arnold/scripts/setup-cloud-infra.sh:1) | Richtet Dienstkonto, privaten Zustands-Bucket und begrenzte Secret-Rechte ein. | [c6d890b](https://github.com/DosiGus/Arnold/commit/c6d890b) · 2026-10-30 |
| [scripts/setup-google-secrets.sh](/Users/kevingusmao/Desktop/Arnold/scripts/setup-google-secrets.sh:1) | Überträgt Google-Zugangsdaten sicher in Secret Manager. | [c6d890b](https://github.com/DosiGus/Arnold/commit/c6d890b) · 2026-10-30 |
| [src/analytics/activity.ts](/Users/kevingusmao/Desktop/Arnold/src/analytics/activity.ts:63) | Berechnet eine Wochenserie nur mit ausdrücklich gesetztem Ziel. | [ddb0bf3](https://github.com/DosiGus/Arnold/commit/ddb0bf3) · 2026-10-25 |
| [src/analytics/eligibility.ts](/Users/kevingusmao/Desktop/Arnold/src/analytics/eligibility.ts:1) | Bestimmt, welche Daten für welche Kennzahl zählen. | [ddb0bf3](https://github.com/DosiGus/Arnold/commit/ddb0bf3) · 2026-10-25 |
| [src/analytics/index.ts](/Users/kevingusmao/Desktop/Arnold/src/analytics/index.ts:1) | Öffentlicher Einstieg in die reine Berechnungsschicht. | [ddb0bf3](https://github.com/DosiGus/Arnold/commit/ddb0bf3) · 2026-10-25 |
| [src/analytics/load.ts](/Users/kevingusmao/Desktop/Arnold/src/analytics/load.ts:96) | Berechnet Satzlast, Volumen und e1RM nach Ausführungsregeln. | [ddb0bf3](https://github.com/DosiGus/Arnold/commit/ddb0bf3) · 2026-10-25 |
| [src/analytics/period.ts](/Users/kevingusmao/Desktop/Arnold/src/analytics/period.ts:1) | Behandelt Kalenderdaten und Wochenanfänge. | [ddb0bf3](https://github.com/DosiGus/Arnold/commit/ddb0bf3) · 2026-10-25 |
| [src/analytics/progress.ts](/Users/kevingusmao/Desktop/Arnold/src/analytics/progress.ts:1) | Berechnet Übungsverläufe mit getrennten Ausführungsvarianten. | [ddb0bf3](https://github.com/DosiGus/Arnold/commit/ddb0bf3) · 2026-10-25 |
| [src/analytics/quality.ts](/Users/kevingusmao/Desktop/Arnold/src/analytics/quality.ts:1) | Macht eingeschränkte Datenqualität sichtbar. | [ddb0bf3](https://github.com/DosiGus/Arnold/commit/ddb0bf3) · 2026-10-25 |
| [src/analytics/records.ts](/Users/kevingusmao/Desktop/Arnold/src/analytics/records.ts:112) | Unterscheidet erste Ausgangswerte von echten Verbesserungen. | [ddb0bf3](https://github.com/DosiGus/Arnold/commit/ddb0bf3) · 2026-10-25 |
| [src/analytics/trends.ts](/Users/kevingusmao/Desktop/Arnold/src/analytics/trends.ts:1) | Vergleicht Wochen und Monate. | [ddb0bf3](https://github.com/DosiGus/Arnold/commit/ddb0bf3) · 2026-10-25 |
| [src/analytics/validation.ts](/Users/kevingusmao/Desktop/Arnold/src/analytics/validation.ts:1) | Validiert Filter und kennzeichnet nicht berechenbare Werte. | [ddb0bf3](https://github.com/DosiGus/Arnold/commit/ddb0bf3) · 2026-10-25 |
| [src/analytics/volume.ts](/Users/kevingusmao/Desktop/Arnold/src/analytics/volume.ts:1) | Trennt Arbeitssätze, Aufwärmen und nicht vergleichbare Volumenarten. | [ddb0bf3](https://github.com/DosiGus/Arnold/commit/ddb0bf3) · 2026-10-25 |
| [src/host/main.ts](/Users/kevingusmao/Desktop/Arnold/src/host/main.ts:1) | Lokaler isolierter MCP-Apps-Testhost mit AppBridge. | [fd95018](https://github.com/DosiGus/Arnold/commit/fd95018) · 2026-10-25 |
| [src/server/arnold-presenter.ts](/Users/kevingusmao/Desktop/Arnold/src/server/arnold-presenter.ts:1) | Übersetzt Berechnungen in verständliche Dashboard-Daten. | [d613b4e](https://github.com/DosiGus/Arnold/commit/d613b4e) · 2026-10-25 |
| [src/server/arnold-sheets-read-adapter.ts](/Users/kevingusmao/Desktop/Arnold/src/server/arnold-sheets-read-adapter.ts:1) | Liest und validiert die sechs Google-Tabellen. | [344d722](https://github.com/DosiGus/Arnold/commit/344d722) · 2026-10-25 |
| [src/server/arnold-sheets-write-adapter.ts](/Users/kevingusmao/Desktop/Arnold/src/server/arnold-sheets-write-adapter.ts:1) | Schreibt geprüfte Batches als echte Text-/Zahlenzellen nach Google. | [cc1fb84](https://github.com/DosiGus/Arnold/commit/cc1fb84) · 2026-10-28 |
| [src/server/auth/config.ts](/Users/kevingusmao/Desktop/Arnold/src/server/auth/config.ts:1) | Stoppt bei unsicheren oder widersprüchlichen Anmeldeeinstellungen. | [5d7c4b4](https://github.com/DosiGus/Arnold/commit/5d7c4b4) · 2026-10-27 |
| [src/server/auth/guarded-server.ts](/Users/kevingusmao/Desktop/Arnold/src/server/auth/guarded-server.ts:1) | Erzwingt Werkzeugklassifizierung und isoliert Nutzerkontext je Anfrage. | [cce7f8a](https://github.com/DosiGus/Arnold/commit/cce7f8a) · 2026-10-28 |
| [src/server/auth/identity.ts](/Users/kevingusmao/Desktop/Arnold/src/server/auth/identity.ts:1) | Ordnet eine geprüfte Anmeldung einem aktiven Arnold-Konto zu. | [5d7c4b4](https://github.com/DosiGus/Arnold/commit/5d7c4b4) · 2026-10-27 |
| [src/server/auth/router.ts](/Users/kevingusmao/Desktop/Arnold/src/server/auth/router.ts:1) | Verbindet OAuth-Metadaten und geschützte HTTP-Aufrufe. | [906a7c1](https://github.com/DosiGus/Arnold/commit/906a7c1) · 2026-10-27 |
| [src/server/auth/scopes.ts](/Users/kevingusmao/Desktop/Arnold/src/server/auth/scopes.ts:1) | Definiert getrennte Lese-, Schreib-, Plan- und Kontorechte. | [5d7c4b4](https://github.com/DosiGus/Arnold/commit/5d7c4b4) · 2026-10-27 |
| [src/server/auth/token-verifier.ts](/Users/kevingusmao/Desktop/Arnold/src/server/auth/token-verifier.ts:1) | Prüft Signatur, Aussteller, Zielgruppe und Gültigkeit eines Tokens. | [5d7c4b4](https://github.com/DosiGus/Arnold/commit/5d7c4b4) · 2026-10-27 |
| [src/server/auth/tool-access.ts](/Users/kevingusmao/Desktop/Arnold/src/server/auth/tool-access.ts:1) | Vollständige Zuordnung aller Werkzeuge zu Zugriffsklassen. | [cce7f8a](https://github.com/DosiGus/Arnold/commit/cce7f8a) · 2026-10-28 |
| [src/server/auth/tool-guard.ts](/Users/kevingusmao/Desktop/Arnold/src/server/auth/tool-guard.ts:1) | Prüft Identität und Rechte bei jedem Werkzeugaufruf. | [5d7c4b4](https://github.com/DosiGus/Arnold/commit/5d7c4b4) · 2026-10-27 |
| [src/server/bootstrap.ts](/Users/kevingusmao/Desktop/Arnold/src/server/bootstrap.ts:1) | Prüft Konfiguration und verbindet Authentifizierung mit Google-Laufzeit. | [d4cb653](https://github.com/DosiGus/Arnold/commit/d4cb653) · 2026-10-29 |
| [src/server/connected/google-api.ts](/Users/kevingusmao/Desktop/Arnold/src/server/connected/google-api.ts:1) | Erstellt und prüft Drive-Dateien und initialisiert die sechs Tabs. | [d4cb653](https://github.com/DosiGus/Arnold/commit/d4cb653) · 2026-10-29 |
| [src/server/connected/google-browser.ts](/Users/kevingusmao/Desktop/Arnold/src/server/connected/google-browser.ts:1) | Sicherer Browser-Rücksprung nach der Google-Freigabe. | [d4cb653](https://github.com/DosiGus/Arnold/commit/d4cb653) · 2026-10-29 |
| [src/server/connected/mcp-google.ts](/Users/kevingusmao/Desktop/Arnold/src/server/connected/mcp-google.ts:1) | Verbindung, Fertigstellung, Verbindungsstatus und Trennen von Google. | [d4cb653](https://github.com/DosiGus/Arnold/commit/d4cb653) · 2026-10-29 |
| [src/server/connected/runtime.ts](/Users/kevingusmao/Desktop/Arnold/src/server/connected/runtime.ts:1) | Erzeugt und bindet die eigene Trainingsdatei je angemeldetem Nutzer. | [d4cb653](https://github.com/DosiGus/Arnold/commit/d4cb653) · 2026-10-29 |
| [src/server/connected/state.ts](/Users/kevingusmao/Desktop/Arnold/src/server/connected/state.ts:1) | Speichert Entwürfe und Auditdaten atomar als Betreiberdateien. | [d4cb653](https://github.com/DosiGus/Arnold/commit/d4cb653) · 2026-10-29 |
| [src/server/google/connection-service.ts](/Users/kevingusmao/Desktop/Arnold/src/server/google/connection-service.ts:1) | Verwaltet Google-Verbindungen und erneuert Zugangstokens. | [5ff17d6](https://github.com/DosiGus/Arnold/commit/5ff17d6) · 2026-10-28 |
| [src/server/google/credential-repository.ts](/Users/kevingusmao/Desktop/Arnold/src/server/google/credential-repository.ts:1) | Speichert verschlüsselte Google-Zugangsdaten getrennt pro Nutzer. | [5ff17d6](https://github.com/DosiGus/Arnold/commit/5ff17d6) · 2026-10-28 |
| [src/server/google/crypto.ts](/Users/kevingusmao/Desktop/Arnold/src/server/google/crypto.ts:1) | Verschlüsselt Refresh-Tokens und bindet sie an Nutzer und Konto. | [5ff17d6](https://github.com/DosiGus/Arnold/commit/5ff17d6) · 2026-10-28 |
| [src/server/google/oauth-flow.ts](/Users/kevingusmao/Desktop/Arnold/src/server/google/oauth-flow.ts:1) | Google-OAuth mit state, PKCE, Nonce, Refresh und Widerruf. | [5ff17d6](https://github.com/DosiGus/Arnold/commit/5ff17d6) · 2026-10-28 |
| [src/server/google/scopes.ts](/Users/kevingusmao/Desktop/Arnold/src/server/google/scopes.ts:1) | Erlaubt drive.file und lehnt überbreite Freigaben ab. | [5ff17d6](https://github.com/DosiGus/Arnold/commit/5ff17d6) · 2026-10-28 |
| [src/server/http.ts](/Users/kevingusmao/Desktop/Arnold/src/server/http.ts:324) | Allgemeine Fehlerbehandlung schreibt derzeit rohe Fehlermeldungen. | [fd95018](https://github.com/DosiGus/Arnold/commit/fd95018) · 2026-10-25 |
| [src/server/identity/repository.ts](/Users/kevingusmao/Desktop/Arnold/src/server/identity/repository.ts:1) | Speichert Kontozuordnung und Status ACTIVE/DISABLED; keine Lizenzverwaltung. | [5d7c4b4](https://github.com/DosiGus/Arnold/commit/5d7c4b4) · 2026-10-27 |
| [src/server/main.ts](/Users/kevingusmao/Desktop/Arnold/src/server/main.ts:1) | Startet den Server und beendet ihn kontrolliert. | [fd95018](https://github.com/DosiGus/Arnold/commit/fd95018) · 2026-10-25 |
| [src/server/mcp-arnold.ts](/Users/kevingusmao/Desktop/Arnold/src/server/mcp-arnold.ts:1) | Registriert Dashboard-, Historien- und Fortschrittswerkzeuge. | [d613b4e](https://github.com/DosiGus/Arnold/commit/d613b4e) · 2026-10-25 |
| [src/server/mcp-onboarding.ts](/Users/kevingusmao/Desktop/Arnold/src/server/mcp-onboarding.ts:1) | Führt ChatGPT durch die Einrichtung und Planbestätigung. | [cc1fb84](https://github.com/DosiGus/Arnold/commit/cc1fb84) · 2026-10-28 |
| [src/server/mcp-plan.ts](/Users/kevingusmao/Desktop/Arnold/src/server/mcp-plan.ts:1) | Registriert lesende und schreibende Planwerkzeuge. | [cc1fb84](https://github.com/DosiGus/Arnold/commit/cc1fb84) · 2026-10-28 |
| [src/server/mcp-workout.ts](/Users/kevingusmao/Desktop/Arnold/src/server/mcp-workout.ts:1) | Registriert Werkzeuge zum Starten, Speichern und Korrigieren von Trainings. | [cc1fb84](https://github.com/DosiGus/Arnold/commit/cc1fb84) · 2026-10-28 |
| [src/server/onboarding/access.ts](/Users/kevingusmao/Desktop/Arnold/src/server/onboarding/access.ts:1) | Bindet die Einrichtung an Konto oder Sitzungsgeheimnis. | [cc1fb84](https://github.com/DosiGus/Arnold/commit/cc1fb84) · 2026-10-28 |
| [src/server/onboarding/profile.ts](/Users/kevingusmao/Desktop/Arnold/src/server/onboarding/profile.ts:1) | Bereitet Trainingsangaben und offene Fragen für Planvorschläge auf. | [cc1fb84](https://github.com/DosiGus/Arnold/commit/cc1fb84) · 2026-10-28 |
| [src/server/onboarding/repository.ts](/Users/kevingusmao/Desktop/Arnold/src/server/onboarding/repository.ts:1) | Persistiert Einrichtungsprofile, Revisionen und begrenzte Altformatmigration. | [cc1fb84](https://github.com/DosiGus/Arnold/commit/cc1fb84) · 2026-10-28 |
| [src/server/onboarding/service.ts](/Users/kevingusmao/Desktop/Arnold/src/server/onboarding/service.ts:1) | Gemeinsamer Einrichtungszustand für Chat und Oberfläche. | [cc1fb84](https://github.com/DosiGus/Arnold/commit/cc1fb84) · 2026-10-28 |
| [src/server/onboarding/setup-gate.ts](/Users/kevingusmao/Desktop/Arnold/src/server/onboarding/setup-gate.ts:1) | Hält Trainingstools bis zur fertigen Einrichtung geschlossen. | [c3198f6](https://github.com/DosiGus/Arnold/commit/c3198f6) · 2026-10-30 |
| [src/server/plan/commit.ts](/Users/kevingusmao/Desktop/Arnold/src/server/plan/commit.ts:1) | Sichert Planänderungen mit Journal, Readback und Audit ab. | [cc1fb84](https://github.com/DosiGus/Arnold/commit/cc1fb84) · 2026-10-28 |
| [src/server/plan/service.ts](/Users/kevingusmao/Desktop/Arnold/src/server/plan/service.ts:1) | Verwaltet Entwürfe, Freigabe, Aktivierung und historische Pläne. | [cc1fb84](https://github.com/DosiGus/Arnold/commit/cc1fb84) · 2026-10-28 |
| [src/server/storage-config.ts](/Users/kevingusmao/Desktop/Arnold/src/server/storage-config.ts:1) | Verhindert unsichere öffentliche Nutzung echter Daten. | [fd95018](https://github.com/DosiGus/Arnold/commit/fd95018) · 2026-10-25 |
| [src/server/tool-log.ts](/Users/kevingusmao/Desktop/Arnold/src/server/tool-log.ts:1) | Schreibt bewusst reduzierte Betriebsmetadaten statt Trainingsinhalte. | [4402737](https://github.com/DosiGus/Arnold/commit/4402737) · 2026-10-30 |
| [src/server/workout/infrastructure.ts](/Users/kevingusmao/Desktop/Arnold/src/server/workout/infrastructure.ts:1) | Gemeinsame IDs, Sperren, Revisionsregeln, Audit und Operationsjournal. | [cc1fb84](https://github.com/DosiGus/Arnold/commit/cc1fb84) · 2026-10-28 |
| [src/server/workout/service.ts](/Users/kevingusmao/Desktop/Arnold/src/server/workout/service.ts:1) | Prüft und verarbeitet Training, Satzkorrekturen und Abschluss. | [cc1fb84](https://github.com/DosiGus/Arnold/commit/cc1fb84) · 2026-10-28 |
| [src/shared/arnold-format.ts](/Users/kevingusmao/Desktop/Arnold/src/shared/arnold-format.ts:1) | Beschriftet Gewichte und Ausführungen ohne Umdeutung. | [d613b4e](https://github.com/DosiGus/Arnold/commit/d613b4e) · 2026-10-25 |
| [src/shared/arnold-schema-v1.ts](/Users/kevingusmao/Desktop/Arnold/src/shared/arnold-schema-v1.ts:318) | Prüft lokale Trainingstage, Zeitzonen und UTC-Zeitstempel. | [344d722](https://github.com/DosiGus/Arnold/commit/344d722) · 2026-10-25 |
| [src/shared/exercise-starter-catalog.ts](/Users/kevingusmao/Desktop/Arnold/src/shared/exercise-starter-catalog.ts:1) | Gemeinsamer Grundkatalog für Einrichtung und persönliche Datei. | [c3198f6](https://github.com/DosiGus/Arnold/commit/c3198f6) · 2026-10-30 |
| [src/shared/onboarding-contract.ts](/Users/kevingusmao/Desktop/Arnold/src/shared/onboarding-contract.ts:1) | Fragen, Profilfelder und Zustände der Einrichtung. | [cc1fb84](https://github.com/DosiGus/Arnold/commit/cc1fb84) · 2026-10-28 |
| [src/shared/plan-contract.ts](/Users/kevingusmao/Desktop/Arnold/src/shared/plan-contract.ts:446) | Verbindlicher Vertrag für Planversionen und Bearbeitungen. | [cc1fb84](https://github.com/DosiGus/Arnold/commit/cc1fb84) · 2026-10-28 |
| [src/shared/workout-contract.ts](/Users/kevingusmao/Desktop/Arnold/src/shared/workout-contract.ts:39) | Verbindlicher Ein-/Ausgabevertrag für Trainingsänderungen. | [cc1fb84](https://github.com/DosiGus/Arnold/commit/cc1fb84) · 2026-10-28 |
| [src/ui/ArnoldDashboardApp.tsx](/Users/kevingusmao/Desktop/Arnold/src/ui/ArnoldDashboardApp.tsx:1) | Steuert die Kartenansichten und Navigation. | [d613b4e](https://github.com/DosiGus/Arnold/commit/d613b4e) · 2026-10-25 |
| [src/ui/assets/README.md](/Users/kevingusmao/Desktop/Arnold/src/ui/assets/README.md:1) | Dokumentiert Herkunft des Arnold-Bildmotivs. | [004a5f3](https://github.com/DosiGus/Arnold/commit/004a5f3) · 2026-10-30 |
| [src/ui/cards.css](/Users/kevingusmao/Desktop/Arnold/src/ui/cards.css:1) | Layout und Bedienung der Chat-Karten. | [9281829](https://github.com/DosiGus/Arnold/commit/9281829) · 2026-10-30 |
| [src/ui/client.ts](/Users/kevingusmao/Desktop/Arnold/src/ui/client.ts:1) | Offizielle MCP-Apps-Anbindung und Host-Kommunikation. | [fd95018](https://github.com/DosiGus/Arnold/commit/fd95018) · 2026-10-25 |
| [src/ui/client/ArnoldMcpClient.ts](/Users/kevingusmao/Desktop/Arnold/src/ui/client/ArnoldMcpClient.ts:1) | Gemeinsamer UI-Zugriff auf MCP-Werkzeuge und Aktualitäts-/Cachelogik. | [d613b4e](https://github.com/DosiGus/Arnold/commit/d613b4e) · 2026-10-25 |
| [src/ui/components/TrendChart.tsx](/Users/kevingusmao/Desktop/Arnold/src/ui/components/TrendChart.tsx:1) | Diagramme mit zugänglichen Text-/Tabellenalternativen. | [d613b4e](https://github.com/DosiGus/Arnold/commit/d613b4e) · 2026-10-25 |
| [src/ui/components/onboarding.tsx](/Users/kevingusmao/Desktop/Arnold/src/ui/components/onboarding.tsx:1) | Person-/Trainingsfragen und Auswahlfelder. | [cc1fb84](https://github.com/DosiGus/Arnold/commit/cc1fb84) · 2026-10-28 |
| [src/ui/components/plan.tsx](/Users/kevingusmao/Desktop/Arnold/src/ui/components/plan.tsx:1) | Eingaben und Darstellung einzelner Planbestandteile. | [cc1fb84](https://github.com/DosiGus/Arnold/commit/cc1fb84) · 2026-10-28 |
| [src/ui/glass.css](/Users/kevingusmao/Desktop/Arnold/src/ui/glass.css:1) | Gemeinsame Designbasis und responsive Gestaltungsregeln. | [004a5f3](https://github.com/DosiGus/Arnold/commit/004a5f3) · 2026-10-30 |
| [src/ui/hooks/useOnboarding.ts](/Users/kevingusmao/Desktop/Arnold/src/ui/hooks/useOnboarding.ts:1) | Synchronisiert Einrichtung, lokale Eingaben und Serverzustand. | [cc1fb84](https://github.com/DosiGus/Arnold/commit/cc1fb84) · 2026-10-28 |
| [src/ui/hooks/usePlanEditor.ts](/Users/kevingusmao/Desktop/Arnold/src/ui/hooks/usePlanEditor.ts:1) | Verarbeitet Planbearbeitung, Konflikte und Wiederholungen. | [cc1fb84](https://github.com/DosiGus/Arnold/commit/cc1fb84) · 2026-10-28 |
| [src/ui/hooks/useWorkoutLogger.ts](/Users/kevingusmao/Desktop/Arnold/src/ui/hooks/useWorkoutLogger.ts:1) | Verhindert Doppelklicks und behält unbestätigte Schreibaufträge. | [cc1fb84](https://github.com/DosiGus/Arnold/commit/cc1fb84) · 2026-10-28 |
| [src/ui/main.tsx](/Users/kevingusmao/Desktop/Arnold/src/ui/main.tsx:1) | Startet die UI und empfängt Werkzeugdaten des Hosts. | [fd95018](https://github.com/DosiGus/Arnold/commit/fd95018) · 2026-10-25 |
| [src/ui/model-context.ts](/Users/kevingusmao/Desktop/Arnold/src/ui/model-context.ts:1) | Meldet sichtbare Trainingsdaten und stabile Satz-IDs an das Modell. | [2c91240](https://github.com/DosiGus/Arnold/commit/2c91240) · 2026-10-30 |
| [src/ui/views/ExerciseProgressView.tsx](/Users/kevingusmao/Desktop/Arnold/src/ui/views/ExerciseProgressView.tsx:1) | Fortschrittsansicht mit Kennzahlen, Kurven und Ausführungsdetails. | [d613b4e](https://github.com/DosiGus/Arnold/commit/d613b4e) · 2026-10-25 |
| [src/ui/views/OnboardingView.tsx](/Users/kevingusmao/Desktop/Arnold/src/ui/views/OnboardingView.tsx:1) | Steuert Begrüßung, Profil, Planprüfung und Google-Schritt. | [cc1fb84](https://github.com/DosiGus/Arnold/commit/cc1fb84) · 2026-10-28 |
| [src/ui/views/TrainingCard.tsx](/Users/kevingusmao/Desktop/Arnold/src/ui/views/TrainingCard.tsx:1) | Training, Satzspeicherung, Korrekturen und Zusammenfassung als Karte. | [9281829](https://github.com/DosiGus/Arnold/commit/9281829) · 2026-10-30 |
| [src/ui/views/TrainingPlanEditorView.tsx](/Users/kevingusmao/Desktop/Arnold/src/ui/views/TrainingPlanEditorView.tsx:1) | Zeigt und bearbeitet Trainingsplanentwürfe. | [cc1fb84](https://github.com/DosiGus/Arnold/commit/cc1fb84) · 2026-10-28 |
| [src/ui/views/WeekCard.tsx](/Users/kevingusmao/Desktop/Arnold/src/ui/views/WeekCard.tsx:1) | Zeigt Wochenzahlen und ein aus dem Plan abgeleitetes Ziel. | [9281829](https://github.com/DosiGus/Arnold/commit/9281829) · 2026-10-30 |
| [src/ui/views/WorkoutHistoryView.tsx](/Users/kevingusmao/Desktop/Arnold/src/ui/views/WorkoutHistoryView.tsx:1) | Filterbare Trainingshistorie und Details einzelner Einheiten. | [d613b4e](https://github.com/DosiGus/Arnold/commit/d613b4e) · 2026-10-25 |
| [tests/analytics-activity.test.ts](/Users/kevingusmao/Desktop/Arnold/tests/analytics-activity.test.ts:1) | Wochen, mehrere Trainings je Tag, Häufigkeit und Streaks. | [ddb0bf3](https://github.com/DosiGus/Arnold/commit/ddb0bf3) · 2026-10-25 |
| [tests/analytics-architecture.test.ts](/Users/kevingusmao/Desktop/Arnold/tests/analytics-architecture.test.ts:1) | Berechnungsschicht bleibt frei von Datenzugriff und UI. | [ddb0bf3](https://github.com/DosiGus/Arnold/commit/ddb0bf3) · 2026-10-25 |
| [tests/analytics-dashboard.test.ts](/Users/kevingusmao/Desktop/Arnold/tests/analytics-dashboard.test.ts:1) | Zusammengesetzte Dashboard-Kennzahlen. | [ddb0bf3](https://github.com/DosiGus/Arnold/commit/ddb0bf3) · 2026-10-25 |
| [tests/analytics-load.test.ts](/Users/kevingusmao/Desktop/Arnold/tests/analytics-load.test.ts:1) | Numerische Kontrollfälle für Last, Kurzhanteln, Seiten und Epley. | [ddb0bf3](https://github.com/DosiGus/Arnold/commit/ddb0bf3) · 2026-10-25 |
| [tests/analytics-progress.test.ts](/Users/kevingusmao/Desktop/Arnold/tests/analytics-progress.test.ts:1) | Übungsverläufe und Tagesaggregation. | [ddb0bf3](https://github.com/DosiGus/Arnold/commit/ddb0bf3) · 2026-10-25 |
| [tests/analytics-qa-regressions.test.ts](/Users/kevingusmao/Desktop/Arnold/tests/analytics-qa-regressions.test.ts:1) | Gegenproben aus unabhängigen früheren Analytics-Befunden. | [7077ffd](https://github.com/DosiGus/Arnold/commit/7077ffd) · 2026-10-26 |
| [tests/analytics-records.test.ts](/Users/kevingusmao/Desktop/Arnold/tests/analytics-records.test.ts:1) | Baselines, Verbesserungen und getrennte Rekordklassen. | [ddb0bf3](https://github.com/DosiGus/Arnold/commit/ddb0bf3) · 2026-10-25 |
| [tests/analytics-volume.test.ts](/Users/kevingusmao/Desktop/Arnold/tests/analytics-volume.test.ts:1) | Volumenkanäle und Satzzählung. | [ddb0bf3](https://github.com/DosiGus/Arnold/commit/ddb0bf3) · 2026-10-25 |
| [tests/arnold-domain.test.ts](/Users/kevingusmao/Desktop/Arnold/tests/arnold-domain.test.ts:1) | Datenformat, Verknüpfungen und widersprüchliche Rohdaten. | [344d722](https://github.com/DosiGus/Arnold/commit/344d722) · 2026-10-25 |
| [tests/arnold-google-transport.test.ts](/Users/kevingusmao/Desktop/Arnold/tests/arnold-google-transport.test.ts:1) | Google-Lesefehler und Antwortbehandlung. | [344d722](https://github.com/DosiGus/Arnold/commit/344d722) · 2026-10-25 |
| [tests/arnold-grid.test.ts](/Users/kevingusmao/Desktop/Arnold/tests/arnold-grid.test.ts:1) | Tabellen- und Zellstruktur. | [a6bd7ef](https://github.com/DosiGus/Arnold/commit/a6bd7ef) · 2026-10-25 |
| [tests/arnold-literal-text.test.ts](/Users/kevingusmao/Desktop/Arnold/tests/arnold-literal-text.test.ts:1) | Formelähnliche Nutzereingaben bleiben Text. | [fbbc1c0](https://github.com/DosiGus/Arnold/commit/fbbc1c0) · 2026-10-25 |
| [tests/arnold-mcp.test.ts](/Users/kevingusmao/Desktop/Arnold/tests/arnold-mcp.test.ts:1) | Dashboard-Werkzeuge und Verträge über MCP. | [c1e169a](https://github.com/DosiGus/Arnold/commit/c1e169a) · 2026-10-29 |
| [tests/arnold-write-adapter.test.ts](/Users/kevingusmao/Desktop/Arnold/tests/arnold-write-adapter.test.ts:1) | Geprüfte Google-Schreibbatches gegen synthetischen Transport. | [cc1fb84](https://github.com/DosiGus/Arnold/commit/cc1fb84) · 2026-10-28 |
| [tests/auth-fixture-sandbox.test.ts](/Users/kevingusmao/Desktop/Arnold/tests/auth-fixture-sandbox.test.ts:1) | Getrennte synthetische Sandboxes hinter Anmeldung. | [e885174](https://github.com/DosiGus/Arnold/commit/e885174) · 2026-10-30 |
| [tests/auth-http.test.ts](/Users/kevingusmao/Desktop/Arnold/tests/auth-http.test.ts:1) | Authentifizierung über tatsächliche lokale HTTP-Anfragen. | [906a7c1](https://github.com/DosiGus/Arnold/commit/906a7c1) · 2026-10-27 |
| [tests/auth-isolation.test.ts](/Users/kevingusmao/Desktop/Arnold/tests/auth-isolation.test.ts:1) | Getrennte Nutzer und Kontosperren. | [5d7c4b4](https://github.com/DosiGus/Arnold/commit/5d7c4b4) · 2026-10-27 |
| [tests/auth-token-verifier.test.ts](/Users/kevingusmao/Desktop/Arnold/tests/auth-token-verifier.test.ts:1) | JWT-Signatur, Zielgruppe, Ablauf und ungültige Tokens. | [5d7c4b4](https://github.com/DosiGus/Arnold/commit/5d7c4b4) · 2026-10-27 |
| [tests/auth-tool-access.test.ts](/Users/kevingusmao/Desktop/Arnold/tests/auth-tool-access.test.ts:1) | Jedes Werkzeug ist einer Zugriffsklasse zugeordnet. | [cce7f8a](https://github.com/DosiGus/Arnold/commit/cce7f8a) · 2026-10-28 |
| [tests/connected-journey.test.ts](/Users/kevingusmao/Desktop/Arnold/tests/connected-journey.test.ts:1) | Kompletter Ablauf mit getrennten Nutzern und simuliertem Google. | [d4cb653](https://github.com/DosiGus/Arnold/commit/d4cb653) · 2026-10-29 |
| [tests/connected-storage.test.ts](/Users/kevingusmao/Desktop/Arnold/tests/connected-storage.test.ts:1) | Atomarer lokaler Speicher und Fehlerverhalten. | [d4cb653](https://github.com/DosiGus/Arnold/commit/d4cb653) · 2026-10-29 |
| [tests/e2e/arnold-dashboard.spec.ts](/Users/kevingusmao/Desktop/Arnold/tests/e2e/arnold-dashboard.spec.ts:1) | Karten, Historie, Charts, Theme, mobile Größe und Tastatur. | [c1e169a](https://github.com/DosiGus/Arnold/commit/c1e169a) · 2026-10-29 |
| [tests/e2e/arnold-v2-qa.spec.ts](/Users/kevingusmao/Desktop/Arnold/tests/e2e/arnold-v2-qa.spec.ts:1) | Gezielte Dashboard-Regressionen. | [f85fb54](https://github.com/DosiGus/Arnold/commit/f85fb54) · 2026-10-26 |
| [tests/e2e/connected.spec.ts](/Users/kevingusmao/Desktop/Arnold/tests/e2e/connected.spec.ts:1) | Einrichtung bis erstem Satz und Browser-Reload mit simulierten Anbietern. | [d4cb653](https://github.com/DosiGus/Arnold/commit/d4cb653) · 2026-10-29 |
| [tests/e2e/onboarding.spec.ts](/Users/kevingusmao/Desktop/Arnold/tests/e2e/onboarding.spec.ts:1) | Neue und fortgesetzte Einrichtung im Browser. | [cc1fb84](https://github.com/DosiGus/Arnold/commit/cc1fb84) · 2026-10-28 |
| [tests/e2e/plan-editor.spec.ts](/Users/kevingusmao/Desktop/Arnold/tests/e2e/plan-editor.spec.ts:1) | Interaktive Planänderung und Bestätigung. | [cc1fb84](https://github.com/DosiGus/Arnold/commit/cc1fb84) · 2026-10-28 |
| [tests/e2e/workout-logger.spec.ts](/Users/kevingusmao/Desktop/Arnold/tests/e2e/workout-logger.spec.ts:1) | Sätze, Reload, verlorene Antwort und Modellkontext. | [cc1fb84](https://github.com/DosiGus/Arnold/commit/cc1fb84) · 2026-10-28 |
| [tests/google-credentials.test.ts](/Users/kevingusmao/Desktop/Arnold/tests/google-credentials.test.ts:1) | Verschlüsselung, Nutzerbindung und enge Scopes. | [5ff17d6](https://github.com/DosiGus/Arnold/commit/5ff17d6) · 2026-10-28 |
| [tests/google-oauth.test.ts](/Users/kevingusmao/Desktop/Arnold/tests/google-oauth.test.ts:1) | Google-Consent, Refresh, Widerruf und Fehlerfälle mit Testanbieter. | [5ff17d6](https://github.com/DosiGus/Arnold/commit/5ff17d6) · 2026-10-28 |
| [tests/http-surface.test.ts](/Users/kevingusmao/Desktop/Arnold/tests/http-surface.test.ts:1) | HTTP-Oberfläche und fehlerhafte Requests. | [3a289ca](https://github.com/DosiGus/Arnold/commit/3a289ca) · 2026-10-29 |
| [tests/model-context.test.ts](/Users/kevingusmao/Desktop/Arnold/tests/model-context.test.ts:1) | Stiller Modellkontext und Abschlussnachricht. | [2c91240](https://github.com/DosiGus/Arnold/commit/2c91240) · 2026-10-30 |
| [tests/onboarding-mcp.test.ts](/Users/kevingusmao/Desktop/Arnold/tests/onboarding-mcp.test.ts:1) | Einrichtungswerkzeuge aus Chat-Aufrufen. | [cc1fb84](https://github.com/DosiGus/Arnold/commit/cc1fb84) · 2026-10-28 |
| [tests/onboarding-profile.test.ts](/Users/kevingusmao/Desktop/Arnold/tests/onboarding-profile.test.ts:1) | Pflichtfragen, freiwillige Angaben und Profiländerungen. | [cc1fb84](https://github.com/DosiGus/Arnold/commit/cc1fb84) · 2026-10-28 |
| [tests/onboarding-security.test.ts](/Users/kevingusmao/Desktop/Arnold/tests/onboarding-security.test.ts:1) | Geheimnisse, Besitzerbindung und persistente Einrichtung. | [cc1fb84](https://github.com/DosiGus/Arnold/commit/cc1fb84) · 2026-10-28 |
| [tests/onboarding-service.test.ts](/Users/kevingusmao/Desktop/Arnold/tests/onboarding-service.test.ts:1) | Einrichtung, Vorschläge, Bestätigung und Wiederaufnahme. | [cc1fb84](https://github.com/DosiGus/Arnold/commit/cc1fb84) · 2026-10-28 |
| [tests/onboarding-setup-gate.test.ts](/Users/kevingusmao/Desktop/Arnold/tests/onboarding-setup-gate.test.ts:1) | Ersteinrichtung als Sperre vor Training. | [c3198f6](https://github.com/DosiGus/Arnold/commit/c3198f6) · 2026-10-30 |
| [tests/plan-activation.test.ts](/Users/kevingusmao/Desktop/Arnold/tests/plan-activation.test.ts:1) | Exakte Planfreigabe und Schutz aktiver Planversionen. | [cc1fb84](https://github.com/DosiGus/Arnold/commit/cc1fb84) · 2026-10-28 |
| [tests/plan-mcp.test.ts](/Users/kevingusmao/Desktop/Arnold/tests/plan-mcp.test.ts:1) | Planwerkzeuge ohne grafische Oberfläche. | [cc1fb84](https://github.com/DosiGus/Arnold/commit/cc1fb84) · 2026-10-28 |
| [tests/plan-security.test.ts](/Users/kevingusmao/Desktop/Arnold/tests/plan-security.test.ts:1) | Rechte- und Dateigrenzen der Planverwaltung. | [cc1fb84](https://github.com/DosiGus/Arnold/commit/cc1fb84) · 2026-10-28 |
| [tests/tool-log.test.ts](/Users/kevingusmao/Desktop/Arnold/tests/tool-log.test.ts:1) | Reduzierte Betriebsprotokolle ohne Nutzlast. | [4402737](https://github.com/DosiGus/Arnold/commit/4402737) · 2026-10-30 |
| [tests/workout-logging.test.ts](/Users/kevingusmao/Desktop/Arnold/tests/workout-logging.test.ts:1) | Training, Sätze, Idempotenz, Revisionen und neue Datumsregressionen. | [cc1fb84](https://github.com/DosiGus/Arnold/commit/cc1fb84) · 2026-10-28 |
| [tests/workout-mcp.test.ts](/Users/kevingusmao/Desktop/Arnold/tests/workout-mcp.test.ts:1) | Trainingswerkzeuge über echten lokalen MCP-Transport. | [cc1fb84](https://github.com/DosiGus/Arnold/commit/cc1fb84) · 2026-10-28 |
| [tests/workout-restart.test.ts](/Users/kevingusmao/Desktop/Arnold/tests/workout-restart.test.ts:1) | Wiederaufnahme eines Schreibauftrags nach Prozessneustart. | [eca985e](https://github.com/DosiGus/Arnold/commit/eca985e) · 2026-10-29 |


## Quellen und Grenzen externer Nachweise

- [OpenAI – Plugin guidelines](https://developers.openai.com/plugins/plugin-guidelines): Grundlage der Hinweise zu kommerziellem Verhalten, Identitätsverifizierung und Sicherheits-Annotationen.
- [OpenAI – Package your plugin](https://developers.openai.com/plugins/build/plugins): Paketformen für persönliche und öffentliche Verteilung.
- [OpenAI – Upload and submit your plugin](https://developers.openai.com/plugins/deploy/submission): Einreichungsunterlagen und technische Paketgrenzen.
- [Google – OAuth 2.0](https://developers.google.com/identity/protocols/oauth2): Token-Lebenszyklus und Testmodus.
- [Google – Drive API scopes](https://developers.google.com/workspace/drive/api/guides/api-specific-auth): Bedeutung und Einstufung von drive.file.
- [Europäische Kommission – Datenschutzgrundsätze](https://commission.europa.eu/law/law-topic/data-protection/information-business-and-organisations/principles-gdpr_en): Datenminimierung, Speicherbegrenzung und transparente Information. Der Bericht ersetzt die ausstehende konkrete rechtliche Rollen-/Vertragsprüfung nicht.

Die Codebewertung und Dateiverweise beziehen sich auf den eingefrorenen Hauptcommit. Links im HTML führen auf denselben Commit auf GitHub; lokale Links im Markdown öffnen die geprüften Projektdateien. Spätere Änderungen können deren lokale Zeilennummern verschieben.

## Prüfabschluss

Alle 112 Originalpunkte erscheinen genau einmal. Jeder Punkt hat Fortschritt oder ausdrücklich begründeten extern offenen Status, eine Umsetzungserklärung, Dateibelege, Prüfbelege, Restarbeit und einen nächsten Schritt. Die zusätzlichen Audit-Artefakte liegen außerhalb des Repositories. Produktcode, Google-Daten und Deployment wurden in diesem Analyseauftrag nicht verändert.

