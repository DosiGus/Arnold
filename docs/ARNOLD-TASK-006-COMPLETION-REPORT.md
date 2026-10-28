# ARNOLD TASK 006 – COMPLETION REPORT

Conversational Onboarding, State Machine & Interactive Setup Experience

Branch: `feat/arnold-onboarding`
Datum: 2026-10-28

---

## 1. Status

**Completed.**

Alle Punkte der Definition of Done sind umgesetzt und durch automatisierte Tests
belegt. Die fünf Abschlussprüfungen laufen vollständig durch:

| Prüfung                | Ergebnis                               |
| ---------------------- | -------------------------------------- |
| `npm run typecheck`    | fehlerfrei                             |
| `npm test`             | **881 Tests in 42 Dateien, alle grün** |
| `npm run build`        | erfolgreich                            |
| `npm run test:e2e`     | **52 Browsertests, alle grün**         |
| `npm run format:check` | sauber                                 |

Vor Beginn wurde der Stand der Tasks 001–005 geprüft: 647 Unit-Tests und 35
Browsertests liefen grün, `typecheck` war fehlerfrei. Task 006 fügt **234
Unit-Tests und 17 Browsertests** hinzu, ohne einen einzigen bestehenden Test zu
ändern.

Außerhalb des Auftragsumfangs behoben: `src/server/onboarding/access.ts` enthielt
ein NUL-Byte im Trennzeichen der OAuth-Bindung, wodurch Git die Datei als binär
behandelte und keine Diffs mehr anzeigte. Ersetzt durch `"|"`.

---

## 2. Implementierte Onboarding-Komponenten

| Komponente                 | Datei                                    | Aufgabe                                                          |
| -------------------------- | ---------------------------------------- | ---------------------------------------------------------------- |
| Domain-Vertrag             | `src/shared/onboarding-contract.ts`      | Alle Domain-Objekte, Zod-Schemas, Tool-Verträge, Label-Maps.     |
| Zustandsmaschine           | `src/server/onboarding/state-machine.ts` | `transitionOnboarding`, `allowedEvents`. Rein, ohne Clock.       |
| Profil & Brief             | `src/server/onboarding/profile.ts`       | Vollständigkeit, Validierung, Fortschritt, Zeitbudget, Brief.    |
| Repository                 | `src/server/onboarding/repository.ts`    | Storage-Interface, In-Memory + Dateijournal, Aufbewahrung.       |
| Access Control             | `src/server/onboarding/access.ts`        | Sitzungsnachweis, Fixture-Guard, Deny-Guard, OAuth-Bindung.      |
| Application Service        | `src/server/onboarding/service.ts`       | `OnboardingService` — die einzige Stelle, die Zustand ändert.    |
| Fixture-Runtime            | `src/server/onboarding/fixture.ts`       | Synthetische Tracker für Tests, Read-Only- und Produktionsmodus. |
| MCP-Tools                  | `src/server/mcp-onboarding.ts`           | 12 Werkzeuge + App-Resource.                                     |
| UI-Hook                    | `src/ui/hooks/useOnboarding.ts`          | Schrittführung, Schreib-Warteschlange, Fehlerzustände.           |
| UI-Komponenten             | `src/ui/components/onboarding.tsx`       | 15 wiederverwendbare Schritt- und Zustandskomponenten.           |
| Wizard                     | `src/ui/views/OnboardingView.tsx`        | Der Ablauf; bettet den Task-005-Planeditor ein.                  |
| Sitzungsnachweis im Client | `src/ui/client/onboarding-claim.ts`      | Eine Stelle, die den Nachweis im Browser hält.                   |

---

## 3. Onboarding State Machine

Deterministisch, rein und zentral: `transitionOnboarding(state, event)` nimmt
einen Zustand und ein Ereignis und liefert entweder einen neuen Zustand mit
Effekten oder eine begründete Ablehnung. Kein Clock, kein Storage, kein React.

`OnboardingService` ist der einzige Aufrufer und besitzt **keinen** zweiten
Pfad, der einen Status verschiebt. Eine React-Komponente oder ein MCP-Handler
kann einen Status gar nicht setzen.

**Zustände:** `NOT_STARTED`, `COLLECTING_PROFILE`, `PROFILE_READY`,
`WAITING_FOR_PLAN_PROPOSAL`, `REVIEWING_PLAN`, `PLAN_CONFIRMED`,
`AWAITING_GOOGLE_CONNECTION`, `COMPLETED`, `CANCELLED`, `EXPIRED`.

Lade- und Fehlerzustände sind absichtlich **nicht** Teil dieser Liste: ein
fehlgeschlagener Request lässt die Sitzung im bisherigen Zustand und meldet
`last_error`, sodass ein Netzwerkfehler niemanden in einem toten Zustand
zurücklässt.

**Ereignisse:** `START`, `SAVE_PROFILE`, `GO_BACK`, `REQUEST_PLAN`,
`PLAN_PROPOSED`, `REVISE_PLAN`, `CONFIRM_PLAN`, `PREPARE_HANDOFF`,
`GOOGLE_CONNECTED`, `CANCEL`, `EXPIRE`, `RESUME`.

**Effekte** statt Seiteneffekten: Die Maschine gibt `clear_confirmation`,
`clear_plan_draft`, `handoff_ready`, `handoff_not_ready` und
`handoff_superseded` zurück. Damit ist „eine Änderung macht die Bestätigung
ungültig" eine Maschinenregel und keine Konvention, an die sich der Service
erinnern muss.

**Rückwärtsbewegungen:** Während der Erfassung frei (`GO_BACK` ändert den
Schritt, nicht den Status — die Angaben bleiben vollständig). Nach einer
Bestätigung ist stilles Zurückgehen ausgeschlossen; eine Änderungsanfrage nimmt
den Plan nach `REVIEWING_PLAN` zurück und macht die Bestätigung ungültig.

**Abgelaufene Sitzungen** sind inert: die Ablaufprüfung liegt im Guard, nicht im
Aufrufer, sodass kein künftiges Ereignis sie vergessen kann. Akzeptiert wird nur
noch `CANCEL`.

`allowedEvents(state)` liefert genau die Ereignisse, die aktuell akzeptiert
würden, und treibt die Steuerelemente der UI. Ein Test prüft für **jeden**
Status und beide Vollständigkeitsvarianten, dass kein angebotenes Ereignis
anschließend abgelehnt wird — die beiden können nicht auseinanderlaufen.

---

## 4. Domain-Modelle und Persistenz

Implementiert: `OnboardingSession`, `OnboardingProfile`, `TrainingPreferences`,
`OnboardingProgress`, `OnboardingPlanProposal`, `OnboardingPlanConfirmation`,
`OnboardingState`, `OnboardingEvent`, `OnboardingValidationResult`,
`OnboardingHandoff`, `OnboardingBrief`, `OnboardingClaim`. Alles Zod-validiert.

Zwei Entscheidungen prägen das Modell:

**Die Sitzung ist kein Nutzerkonto.** `onboarding_session_id` identifiziert eine
Einrichtung, nicht eine Person. Sie ist anonym, läuft ab, und kein Feld darf zu
einer `user_id` werden — ein Test prüft, dass die Session kein `user_id`-Feld
besitzt.

**Kein zweiter Trainingsplan.** Die Sitzung speichert eine _Referenz_
(`plan_version_id`, `row_revision`), nie eine Kopie der Planstruktur. Eine
zweite Kopie wäre eine zweite Wahrheit und könnte dem Editor widersprechen.

### Repository

`OnboardingStateRepository` mit `createSession`, `getSession`, `updateSession`,
`expireSession`, `purge` und einem `durability`-Feld. Zwei Implementierungen:

- `InMemoryOnboardingRepository` — ein Prozess, für Unit-Tests.
- `FileOnboardingRepository` — lokales Journal, atomar über Temp-Datei und
  `rename` mit Modus `0600`, nach dem Muster des Operationsjournals aus Task 004. Überlebt einen Serverneustart und macht die Wiederaufnahmetests
  aussagekräftig. Ausdrücklich kein verteilter Speicher.

Onboarding-Daten liegen **nie** in den sechs Arnold-Tabellen
(`CONFIG.onboarding_storage = BACKEND_ONLY`); ein Test serialisiert den
Datensatz und prüft, dass weder Sitzungs-ID noch Status noch Profilfelder darin
vorkommen.

Der gespeicherte Datensatz trennt Öffentliches von Geheimem: neben der Session
stehen `token_fingerprint` (SHA-256, nie der Nachweis), `owner_subject` und
`applied` (angewendete `request_id`s, auf 64 Einträge begrenzt).

`updateSession` lehnt jeden Versuch ab, Nachweis, Eigentümer oder
Erstellungszeit einer bestehenden Sitzung zu ändern — Session-Fixation ist damit
auf Speicherebene ausgeschlossen, nicht nur per Konvention.

**Aufbewahrung:** 24 Stunden Gültigkeit, 7 Tage Nachlauf, dann einsammelbar.
`purge` läuft beim Start jeder neuen Einrichtung. Verwaiste Entwürfe werden nicht
unbegrenzt gespeichert.

---

## 5. Neue MCP-Tools

Zwölf Werkzeuge, alle mit Zod-Input- und Output-Schema, `structuredContent`,
MCP-Annotationen, Authentifizierungs- und Zustandsprüfung, Idempotenz und
Fehlercodes.

| Tool                              | Schreibend | Besonderheit                                       |
| --------------------------------- | ---------- | -------------------------------------------------- |
| `show_arnold_onboarding`          | ja         | App-Resource `ui://arnold/onboarding-v1.html`.     |
| `start_arnold_onboarding`         | ja         | `resume_session` setzt fort statt neu zu beginnen. |
| `get_onboarding_state`            | nein       | Vollständiger Stand inkl. Plan und Handoff.        |
| `update_onboarding_profile`       | ja         | Patch mischt; `step` allein navigiert zurück.      |
| `get_onboarding_brief`            | nein       | Katalog, Randbedingungen, `must_not_invent`.       |
| `request_onboarding_plan`         | ja         | Öffnet die Vorschlagsphase.                        |
| `submit_onboarding_plan_proposal` | ja         | Validiert und speichert als **Draft**.             |
| `get_onboarding_plan`             | nein       | Draft + Prüfergebnis + Handoff.                    |
| `confirm_onboarding_plan`         | ja         | Bindet Planversion **und** Revision.               |
| `revise_onboarding_plan`          | ja         | Nimmt einen bestätigten Plan zurück.               |
| `get_onboarding_handoff`          | ja         | Prüft **und repariert** einen veralteten Handoff.  |
| `cancel_onboarding`               | ja         | `destructiveHint: true`.                           |

Schreibende Tools geben den **tatsächlich gespeicherten** Zustand zurück. Erfolg
wird erst gemeldet, wenn das Repository den Schreibvorgang bestätigt hat. Eine
Ablehnung liefert `ok: false`, den unveränderten Zustand und den Grund — sie ist
informativ, nicht destruktiv.

Der `session_token` erscheint ausschließlich im `structuredContent` des Aufrufs,
der die Sitzung erzeugt, und **nie** in einem Text-Block — dieser Text wandert in
den Chatverlauf. Ein Test prüft das. Auch die Zusammenfassungszeile nennt weder
Sitzungs-ID noch Nachweis.

Die Beschreibungen sind Produktbestandteil, nicht Dokumentation: ein Modell liest
daraus, _wann_ es eine Einrichtung startet, fortsetzt, Angaben aktualisiert, einen
Vorschlag anfordert, bestätigen darf und wann auf Google gewartet wird. Sechs
Tests prüfen die entscheidenden Formulierungen.

Bestandstools unverändert: `show_arnold_dashboard`, die v2-Dashboard-Tools und
alle Task-004/005-Werkzeuge. Ein Deployment ohne `OnboardingService`
veröffentlicht kein einziges Onboarding-Tool.

---

## 6. Interaktive UI-Komponenten

Fünfzehn Komponenten in `src/ui/components/onboarding.tsx`, zusammengesetzt in
`OnboardingView.tsx`: `OnboardingLayout`, `OnboardingProgressBar`,
`WelcomeStep`, `GoalStep`, `AvailabilityStep`, `PreferencesStep`,
`ProfileSummaryStep`, `PlanGenerationStep`, `PlanConfirmationDialog`,
`GoogleConnectionHandoffStep`, `OnboardingErrorState`, `OnboardingResumeState`,
`OnboardingIssues`, `ChoiceGroup`, `TagInput`, `CancelOnboardingButton`.

Fünf Schritte statt sechs Formulare: Willkommen → Ziel + Erfahrung → Tage +
Dauer + Umgebung → Vorlieben → Zusammenfassung. Jede Pflichtangabe ist eine
Auswahlkarte, kein Textfeld; „Wie oft möchtest du trainieren?" sind sieben Taps,
keine Formularseite.

Umgesetzte UX-Vorgaben: keine Standardwerte für Pflichtangaben (nichts ist
vorausgewählt), alle Werte änderbar (auch aus der Zusammenfassung über eine
„Ändern"-Schaltfläche je Zeile), Fortschritt sichtbar („3 von 6 Pflichtangaben
erfasst"), vorheriger Schritt jederzeit, optionale Fragen überspringbar als
echter Button, Validierungsfehler direkt am Feld, kein Datenverlust beim
Navigieren.

Gestaltung auf denselben Design-Tokens wie das Dashboard; einspaltig, maximal
720 px für das ChatGPT-App-Panel; helle und dunkle Host-Themes über `data-theme`
und die geteilten CSS-Variablen; Auswahlkarten mindestens 48 px hoch; keine
technischen IDs in der Oberfläche.

**Zugänglichkeit:** Jede Pflichtangabe ist ein `<fieldset>` mit `<legend>` und
echten Radio-Inputs. Die Inputs sind transparent, aber **vollflächig** — bewusst
nicht der 1-px-Trick: ein Control ohne Fläche ist unzuverlässig aktivierbar, und
in der Praxis reagierte es nicht auf `Space`. Der sichtbare Text ist auch der
Accessible Name (`aria-label`), damit ein Screenreader „Muskelaufbau" liest und
nicht `muscle_gain`. Fehler sind `role="alert"` und über `aria-describedby` mit
ihrer Gruppe verbunden. Der Accessible Name der Zurück-Steuerung enthält ihren
sichtbaren Text (WCAG 2.5.3). Automatisierte WCAG-A/AA-Prüfung ohne ernste
Verstöße.

**Keine Scheininteraktionen.** Jeder Button löst eine funktionierende Aktion
aus. Die noch nicht verfügbare Google-Verbindung ist deaktiviert, mit
`aria-disabled` und als nächster Entwicklungsschritt gekennzeichnet.

**Keine Enum-Werte auf dem Bildschirm.** Alle Beschriftungen kommen aus den
Label-Maps des Vertrags; ein Test rendert vier Schritte und prüft, dass keiner
der dreizehn Speicherschlüssel darin vorkommt. Mehrsprachigkeit bedeutet damit,
diese Maps zu tauschen.

---

## 7. Integration mit ChatGPT

Chat und UI teilen **eine** serverseitige Sitzung und **einen** Satz
Validierungsregeln. Es gibt keine zweite, nur im Chatverlauf gehaltene Kopie des
Profils.

Belegt durch einen MCP-Test, der den Planentwurf einmal über
`get_onboarding_plan` und einmal über `get_plan_editor_context` liest und
dieselbe `plan_version_id` erhält; und durch einen zweiten, der über
`update_plan_draft` eine Einheit umbenennt und die Änderung anschließend in
`get_onboarding_state` wiederfindet.

Ein Patch **mischt**: nicht übergebene Felder bleiben unverändert. Darum genügt
für „eigentlich lieber nur dreimal die Woche" ein einzelnes Feld. Ein Test fährt
genau diesen Gesprächsverlauf über drei Turns.

Die Tool-Beschreibungen decken die sechs geforderten Erkennungssituationen ab:
neues Onboarding starten, bestehendes fortsetzen, Angaben aktualisieren,
Planvorschlag anfordern, Plan bestätigen dürfen, auf Google OAuth warten.

Steht kein sicherer persistenter Sitzungskontext zur Verfügung, wird die
Einschränkung transparent gemeldet: `OnboardingState.resume` nennt `durable`,
`cross_device: false` und einen Hinweistext, der in der UI in der Statuszeile
erscheint.

Die Agent-Anleitung steht in `docs/ARNOLD-ONBOARDING-CONVERSATION.md`.

---

## 8. Planvorschlagsprozess

**ChatGPT ist die Planvorschlags-Engine.** Kein zusätzlicher OpenAI-API-Key, und
der MCP-Server ruft von sich aus kein weiteres Sprachmodell auf.

Ablauf: Profil validieren → `request_onboarding_plan` → `get_onboarding_brief` →
Modell erstellt den Plan → `submit_onboarding_plan_proposal` → serverseitige
Validierung → bearbeitbarer Draft → UI zeigt ihn → Nutzer ändert → ausdrückliche
Bestätigung.

Der Brief enthält Ziel, Erfahrung, Verfügbarkeit, Umgebung, Ausgangssituation,
Vorlieben, den Übungskatalog mit gültigen `exercise_id`-Werten, ein Zeitbudget
in Übungen pro Einheit sowie zwei Listen: `constraints` (genaue Tageszahl,
Übungsbudget, gültige Bereiche, nur Katalog-IDs, Umgebung, ausschließlich
Krafttraining, gemiedene und bevorzugte Übungen) und `must_not_invent` (keine
Gewichte, keine IDs, keine Leistungswerte, keine medizinischen Aussagen, keine
Wirksamkeitsversprechen, kein vorgetäuschter Speicherstatus).

Freitext des Nutzers steht getrennt unter `user_statements`, ausdrücklich als
Nutzerangabe. Ein Test prüft, dass er nicht in die maschinenlesbaren Regeln
durchsickert.

Serverseitig validiert: erfundene `exercise_id` → `PLAN_PROPOSAL_INVALID`;
ungültiger Wiederholungsbereich → abgelehnt; Plan ohne Übungen oder leere
Einheit → abgelehnt; Vorschlag vor `request_onboarding_plan` → abgelehnt. Eine
abweichende Tageszahl ist ein **Hinweis**, kein Fehler — der Nutzer kann sie im
Editor anpassen, und ein harter Abbruch würde einen Plan ablehnen, den er
vielleicht will.

Unbekannte Startgewichte bleiben leer; ein Test prüft, dass jedes
`target_load_kg` eines Vorschlags ohne Gewichtsangabe `null` ist. Die
Oberfläche sagt es ausdrücklich.

**Host-Grenzen:** `@modelcontextprotocol/ext-apps` stellt `callServerTool`
bereit — also Serverwerkzeuge —, aber keine Sampling- oder Prompt-Schnittstelle
zum Host-Modell. Die UI kann eine Modellgenerierung daher nicht anstoßen.
Deshalb implementiert Task 006 einen ehrlichen Übergabezustand: der Schritt
`plan_proposal` erklärt, was im Chat zu sagen ist, und bietet als einzige Aktion
ein echtes „Nach dem Vorschlag suchen". Es gibt **keinen** Button, der eine
nicht vorhandene KI-Generierung vortäuscht, und keine eigene inoffizielle
ChatGPT-Bridge. Zwei Tests prüfen die Abwesenheit eines solchen Steuerelements.

### Bestehenden Plan übernehmen

Gleichwertiger zweiter Weg über `starting_point: "existing_plan"` und
`origin: "existing_routine"`. Der Brief erhält die Randbedingung, die bestehende
Routine zu übernehmen und nur fehlende Angaben zu ergänzen. Unvollständige
Routinen werden als offen gekennzeichnet (`EXISTING_ROUTINE_INCOMPLETE`), nicht
erfunden. Ein Browsertest fährt diesen Weg bis zum identischen Handoff-Zustand.

---

## 9. Integration des Planeditors

`TrainingPlanEditorView` aus Task 005 wird **unverändert** mit `embedded`
gemountet. Es gibt genau einen Planeditor im Produkt; jede Änderung ist ein
typisierter Edit an `update_plan_draft`.

Der Nutzer kann im Onboarding Trainingstage ansehen, hinzufügen, entfernen,
umbenennen, umsortieren und duplizieren; Übungen hinzufügen, austauschen,
entfernen und umsortieren; Sätze, Wiederholungsbereiche, Zielgewichte, Pausen,
Notizen und Ausführungen bearbeiten; den Plan prüfen.

Der Onboarding-Service entwickelt **keine** eigene Planversionierung. Er
speichert eine Referenz und steuert nur, wann der Editor verfügbar ist und wann
ein bestätigter Plan weitergehen darf.

**Eine Änderung an Task 005 war nötig** und ist in §17 als Abweichung
dokumentiert: `embedded` unterdrückt jetzt auch die Lifecycle-Steuerelemente
„Bestätigen und aktivieren" und „Entwurf verwerfen". Der Grund ist fachlich —
eine Aktivierung aus dem Editor würde den Entwurf unveränderbar machen und das
Onboarding in eine Sackgasse führen, ein Verwerfen würde die Version entfernen,
auf die die Einrichtung noch verweist. Das Bearbeiten ist in beiden Modi
identisch; ein Browsertest prüft, dass beide Steuerelemente im Onboarding fehlen
und die Bearbeitung dennoch funktioniert.

---

## 10. Planbestätigung und Versionierung

Die Bestätigung bindet genau eine Planversion **und** genau eine Revision. Drei
Prüfungen stehen zwischen Klick und gespeicherter Freigabe: die Bestätigung muss
den referenzierten Entwurf nennen, sie muss die Revision nennen, die der
Entwurf **jetzt** hat, und der Planservice muss diese Revision als gültig
ansehen.

Eine erfolgreiche Validierung ist keine Bestätigung. Eine veraltete wird mit
`STALE_CONFIRMATION` abgewiesen, inklusive beider Revisionsnummern in den
Details.

Zusätzlich ist die Bestätigung an die **Profilrevision** gebunden: der Plan
wurde für bestimmte Angaben freigegeben. Ändert der Nutzer danach eine Angabe,
ist die Freigabe überholt, auch wenn keine Planzeile bewegt wurde. Diese
zusätzliche Bindung entstand aus einem Testbefund — ohne sie meldete der Handoff
nach einer Profiländerung nur „keine Bestätigung vorhanden" statt des Grundes.

**Ungültigwerden ist doppelt abgesichert:**

- _Proaktiv:_ `REVISE_PLAN` und `SAVE_PROFILE` nehmen den Plan nach
  `REVIEWING_PLAN` zurück und setzen den Handoff auf `superseded`.
- _Defensiv:_ `get_onboarding_handoff` vergleicht bei **jedem** Lesen die
  gespeicherte Bestätigung mit der aktuellen Revision des Entwurfs. Das ist
  entscheidend, weil der Planeditor einen Entwurf über die Plan-Tools ändern
  kann, ohne dass der Onboarding-Service davon erfährt. Ein veralteter Handoff
  ist damit nicht handlungsfähig, egal woher die Änderung kam.

Der Bestätigungs-_Datensatz_ bleibt beim Ungültigwerden absichtlich erhalten.
Ungültig ist nicht dasselbe wie gelöscht: so kann der Handoff sagen „bestätigt
war Revision 1, aktuell ist Revision 2" statt des nutzlosen „keine Bestätigung
vorhanden". Handlungsfähig ist er nie, weil die Revisionen bei jedem Lesen
verglichen werden.

Die Bestätigung wird auditiert (`ONBOARDING_PLAN_CONFIRMED`), ihr Ungültigwerden
ebenfalls (`ONBOARDING_CONFIRMATION_INVALIDATED`) — das ist die Spur, die zeigt,
dass eine freigegebene Revision aufgehört hat, freigegeben zu sein.

**Was die Bestätigung bedeutet:** „Dieser Plan ist vom Nutzer zur Einrichtung
freigegeben." Sie bedeutet **nicht**, dass der Plan in einer persönlichen
Google-Sheets-Datei aktiviert wurde. Dialog und Handoff-Screen sagen das
ausdrücklich.

---

## 11. OAuth-Handoff-Schnittstelle

`OnboardingHandoff` enthält `onboarding_session_id`, `status`,
`confirmed_plan_version_id`, `confirmed_plan_revision`, `profile_revision`,
`confirmation_timestamp`, `current_plan_revision`, `oauth_state_binding`,
`blocked_reason` und `google_connection_pending: true`.

Nur validierte Referenzen: kein Sitzungsnachweis, keine Profilinhalte, keine
personenbezogenen Daten. Ein Test serialisiert das Objekt und prüft, dass weder
der Token noch ein Profilwert darin vorkommt — es ist vollständig
protokollierbar.

`oauth_state_binding` ist ein opaker SHA-256-Wert über Sitzungs-ID, bestätigte
Revision und Token-Fingerprint: stabil für einen bestätigten Plan, verschieden
für eine andere Revision oder Sitzung, nicht in den Nachweis zurückrechenbar.
Eine **Bindung**, kein Berechtigungsnachweis — Task 007 muss die Sitzung
weiterhin selbst autorisieren.

**In Task 006 implementiert:** bestätigtes Handoff-Objekt, Zustand
`AWAITING_GOOGLE_CONNECTION`, saubere Anzeige des nächsten Schritts, technische
Schnittstelle für das spätere Provisioning, erneutes Laden und Validieren des
bestätigten Entwurfs, Fehlerverhalten bei ungültigem oder abgelaufenem Handoff.

**Nicht implementiert:** Consent Screen, Authorization Code Flow,
Token-Austausch, Refresh-Token-Speicherung, Drive-Dateikopien, produktive
Tracker, automatische Aktivierung im Google Sheet.

---

## 12. Sitzungssicherheit und Wiederaufnahme

Eine Einrichtung wird mit einem 256-Bit-Geheimnis erzeugt. Der Client behält es;
der Server speichert nur den SHA-256. Drei Mechanismen schützen die anonyme
Sitzung:

1. **Der Nachweis ist Pflicht.** Eine Sitzungs-ID allein ist keine Berechtigung.
2. **Der Vergleich ist konstant-zeitig** (`timingSafeEqual`).
3. **Produktion schließt dicht.** `DenyOnboardingAccessControl` lehnt jeden
   Aufruf mit `AUTH_REQUIRED` ab, bis Task 007 eine geprüfte Identität liefert.

Eine unbekannte ID und ein falscher Nachweis werden gleich beantwortet: ob eine
ID existiert, ist selbst eine Information, die ein Aufrufer ohne Nachweis nicht
erhalten darf.

Belegt: zwei Sitzungen können einander nicht lesen (ID von A mit Token von B →
`PERMISSION_DENIED`); ihre Angaben und Planentwürfe bleiben getrennt; eine
unbekannte Referenz wird abgewiesen; der Nachweis erscheint in keinem
State-Payload; er wird genau einmal ausgegeben; im Dateijournal steht kein
Klartext-Token.

**Wiederaufnahme** funktioniert innerhalb einer nachweislich zugeordneten
Sitzung: belegt für einen Reload der App (Browsertest) und für einen
Serverneustart mit Dateijournal (Unit-Test mit zwei Runtimes über derselben
Datei). Nach dem Neustart wird ein falscher Token weiterhin abgewiesen.

Eine Wiederzuordnung nach Schließen des Chats oder Gerätewechsel ist eine
**Abhängigkeit von Task 007**. `resume.cross_device` ist ein literal `false` im
Vertrag — die Einschränkung ist nicht nur dokumentiert, sie ist typisiert.

---

## 13. Neue und geänderte Dateien

### Neu

| Datei                                       | Zeilen |
| ------------------------------------------- | -----: |
| `src/shared/onboarding-contract.ts`         |    899 |
| `src/server/onboarding/state-machine.ts`    |    392 |
| `src/server/onboarding/profile.ts`          |    430 |
| `src/server/onboarding/repository.ts`       |    253 |
| `src/server/onboarding/access.ts`           |    178 |
| `src/server/onboarding/service.ts`          |   1277 |
| `src/server/onboarding/fixture.ts`          |    135 |
| `src/server/mcp-onboarding.ts`              |    475 |
| `src/ui/client/onboarding-claim.ts`         |     52 |
| `src/ui/hooks/useOnboarding.ts`             |    385 |
| `src/ui/components/onboarding.tsx`          |   1269 |
| `src/ui/views/OnboardingView.tsx`           |    518 |
| `tests/onboarding-state-machine.test.ts`    |    508 |
| `tests/onboarding-profile.test.ts`          |    543 |
| `tests/onboarding-service.test.ts`          |   1148 |
| `tests/onboarding-security.test.ts`         |    563 |
| `tests/onboarding-mcp.test.ts`              |    727 |
| `tests/onboarding-ui-render.test.tsx`       |    740 |
| `tests/e2e/onboarding.spec.ts`              |    671 |
| `docs/ARNOLD-ONBOARDING-CONTRACT.md`        |   1030 |
| `docs/ARNOLD-ONBOARDING-CONVERSATION.md`    |    371 |
| `docs/ARNOLD-TASK-006-COMPLETION-REPORT.md` | dieses |

### Geändert

| Datei                                     | Änderung                                                                                                |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `src/server/workout/infrastructure.ts`    | Elf `ONBOARDING_*`-Event-Typen im bestehenden Audit-Vokabular.                                          |
| `src/server/mcp-arnold.ts`                | Optionaler `OnboardingService`; registriert die Onboarding-Tools zuletzt.                               |
| `src/server/http.ts`                      | `onboarding` in der Runtime; Query-String überlebt den `/`-Redirect.                                    |
| `src/ui/client.ts`                        | Erkennt den Onboarding-Vertrag; Preview-Einstieg `?onboarding=1`; setzt eine gespeicherte Sitzung fort. |
| `src/ui/client/ArnoldMcpClient.ts`        | Zehn typisierte Onboarding-Methoden; nutzt den geteilten Sitzungsnachweis.                              |
| `src/ui/main.tsx`                         | Dritter Vertrag im Boot; merkt sich den Nachweis einer neuen Sitzung.                                   |
| `src/ui/views/TrainingPlanEditorView.tsx` | `embedded` unterdrückt zusätzlich die Lifecycle-Steuerelemente.                                         |
| `src/ui/style.css`                        | Onboarding-Stile auf den bestehenden Tokens, beide Themes.                                              |
| `tests/fixtures/arnold-server.ts`         | Drei Onboarding-Fixture-Server (8800–8802).                                                             |
| `playwright.config.ts`                    | Kommentar zu den Ports.                                                                                 |
| `README.md`                               | Abschnitt „Task 006: geführte Einrichtung".                                                             |

Außerdem: NUL-Byte in `src/server/onboarding/access.ts` entfernt (siehe §1).

---

## 14. Ergebnisse aller Tests

Tatsächlich ausgeführt, vollständig:

```text
npm run typecheck     fehlerfrei
npm test              881 Tests / 42 Dateien   alle grün
npm run build         erfolgreich
npm run test:e2e      52 Browsertests          alle grün
npm run format:check  sauber
```

### Neue Testdateien

| Datei                                    |   Tests | Umfang                                                                                                                                                                                         |
| ---------------------------------------- | ------: | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tests/onboarding-state-machine.test.ts` |      41 | Jeder Übergang, jede Ablehnung, Rückwärtsbewegung, Ablauf, Abbruch, Idempotenz, Unerreichbarkeit von `COMPLETED`, Konsistenz von `allowedEvents`.                                              |
| `tests/onboarding-profile.test.ts`       |      37 | Vollständigkeit, alle Enum-Werte, Grenzwerte, Startgewichte, bestehende Routine, Fortschritt, Zeitbudget, Brief, Vorschlagsabgleich.                                                           |
| `tests/onboarding-service.test.ts`       |      57 | Start, Patch-Semantik, Revisionskonflikt, Idempotenz, Vorschlag, Bestätigung, Ungültigwerden, Handoff, Abbruch, Ablauf, Wiederaufnahme, Produktionsmodus, keine Google-Schreibzugriffe, Audit. |
| `tests/onboarding-security.test.ts`      |      32 | Token-Erzeugung und -Vergleich, Guards, Isolation, unberechtigte Abfrage, Repository-Regeln, Session-Fixation, Nebenläufigkeit, Aufbewahrung, Dateijournal, Neustart, OAuth-Bindung.           |
| `tests/onboarding-mcp.test.ts`           |      34 | Discovery, Beschreibungen, Annotationen, Resources, Zod-Validierung, strukturierte Fehler, Gesprächsfluss, geteilter Zustand, Bestätigung, Handoff, Idempotenz, unveränderte Bestandstools.    |
| `tests/onboarding-ui-render.test.tsx`    |      33 | Komponenten gegen echte Serverausgaben, keine Enum-Werte, keine IDs, Fortschritt, Zusammenfassung, ehrliche Übergabe, Bestätigungsdialog, Handoff, Fehler- und Wiederaufnahmezustände.         |
| **Summe**                                | **234** |                                                                                                                                                                                                |

Alle Tests arbeiten ausschließlich auf synthetischen Profilen und
Trainingsplänen in isolierten In-Memory-Trackern. Kein Google-Zugriff, kein
Google-Token, keine realen Trainingsdaten.

### Während der Umsetzung gefundene und behobene Fehler

Die Tests und ein Durchlauf im echten Browser haben acht Defekte aufgedeckt, die
sonst im Produkt gelandet wären:

1. **Handoff nach Profiländerung unverständlich.** Meldete „keine Bestätigung
   vorhanden" statt des Grundes. Behoben durch die zusätzliche Bindung an die
   Profilrevision (§10).
2. **Ungültigwerden nicht auditiert.** Das Audit-Event hing am Löschen des
   Datensatzes, nicht am Überholtwerden. Behoben.
3. **Willkommensschritt wurde übersprungen.** Eine neue Sitzung entsteht in
   `COLLECTING_PROFILE`, dessen Schritt `goal` ist — der Wizard öffnete direkt
   die erste Frage. Behoben: der Willkommensschritt ist eine UI-Angelegenheit
   und erscheint, solange keine Angabe existiert.
4. **Screenreader las Speicherschlüssel.** Der Accessible Name der Radios kam
   aus `value`, also `muscle_gain` statt „Muskelaufbau". Behoben durch
   `aria-label` aus dem Label, Hinweis über `aria-describedby`.
5. **Zweites `role="banner"` pro Schritt.** Ein `<header>` in einem `<div>`
   bildet auf `banner` ab. Behoben: die Karte ist ein `<section>`.
6. **WCAG-2.5.3-Verstoß an der Zurück-Steuerung.** Das `aria-label` („Zum
   vorherigen Schritt") enthielt den sichtbaren Text „Zurück" nicht. Behoben.
7. **Zweite Antwort wurde still verworfen.** Zwei schnell aufeinanderfolgende
   Antworten beanspruchten dieselbe Revision; die zweite fiel einem
   `REVISION_CONFLICT` zum Opfer. Behoben durch eine Schreib-Warteschlange, die
   die Revision erst beim Ausführen liest.
8. **Antwort speichern sprang zum falschen Schritt.** Das Übernehmen eines
   Schreibergebnisses folgte dem serverseitig gespeicherten `current_step` und
   warf den Nutzer mitten in der Eingabe zurück. Behoben: `current_step` dient
   der Wiederaufnahme, nicht der Navigation.

Zwei weitere Fehler lagen außerhalb des Onboardings und betrafen die Testbarkeit:
der `/`-Redirect verlor den Query-String (wodurch `?onboarding=1` stillschweigend
das Dashboard öffnete), und der Browser-Preview startete bei jedem Reload eine
neue Sitzung statt die gespeicherte fortzusetzen. Beide behoben.

---

## 15. End-to-End-Testresultate

`tests/e2e/onboarding.spec.ts` — 17 Tests, alle grün. Die drei
Abnahmeszenarien aus §23 des Auftrags sind abgedeckt.

### Szenario 1 – neuer Nutzer

`a new user walks the whole setup up to the Google handoff` und
`editing the proposal rebinds the confirmation to the new revision`.

Ein synthetischer Nutzer gibt Muskelaufbau, Intermediate, 3 Trainingstage, 60
Minuten, Fitnessstudio und „neuer Trainingsplan" an, erhält einen strukturierten
Push/Pull/Legs-Vorschlag (übergeben über die MCP-Tools, wie ChatGPT es täte),
öffnet den Planeditor, ersetzt eine Übung, sieht die erhöhte Revision und
bestätigt die aktuelle Fassung. Der Status wechselt zu
`AWAITING_GOOGLE_CONNECTION`.

Der Test bestätigt:

- Keine echte Google-Datei wurde erstellt (Button deaktiviert, Text
  ausdrücklich: „Es wurde kein Google-Konto verbunden").
- Kein OAuth-Token wurde erzeugt (`google_connection_pending: true`).
- Kein Plan wurde in einer Nutzerdatei aktiviert (ein Unit-Test prüft
  zusätzlich, dass der Tracker keine aktive Planversion enthält und der Entwurf
  `status: "draft"` mit `activated_at_utc: null` behält).
- Der bestätigte Plan ist für Task 007 nachvollziehbar referenziert
  (`confirmed_plan_version_id`, `confirmed_plan_revision`,
  `oauth_state_binding`).
- Die vorherige Planrevision kann nicht mehr unbemerkt bestätigt werden
  (`STALE_CONFIRMATION`).

### Szenario 2 – Nutzer besitzt bereits einen Plan

`an existing routine reaches the same handoff state`. Der Nutzer wählt „Ich habe
schon einen Plan", die Routine wird als Draft strukturiert
(`origin: "existing_routine"`), überprüft, korrigierbar und bestätigt. Derselbe
sichere Handoff-Zustand wird erreicht.

### Szenario 3 – Unterbrechung

`closing and reopening the app resumes the stored setup`,
`a setup without its credential starts fresh instead of leaking one` und
`an expired setup offers a controlled restart`. Nach dem Ausfüllen des Profils
wird die UI neu geladen; die gespeicherten Angaben erscheinen und der Ablauf
geht weiter. Ohne Nachweis beginnt eine neue Einrichtung statt Fremddaten zu
zeigen. Bei abgelaufener Sitzung erscheint ein kontrollierter
Wiederherstellungszustand mit funktionierendem Neustart.

### Weitere Browsertests

Rückwärtsnavigation ohne Datenverlust; Feldfehler am betroffenen Feld;
Zusammenfassungszeilen springen zum zuständigen Schritt; abgelehnter
Schreibvorgang zeigt den Grund und erhält den gespeicherten Stand; keine
Schein-Erfolgsmeldungen; mobile Ansicht ohne horizontalen Überlauf; helles und
dunkles Theme; Tastaturbedienung (Tab in die Gruppe, `Space`, Pfeiltasten);
WCAG A/AA ohne ernste Verstöße; das bestehende Dashboard öffnet unverändert und
zeigt kein Onboarding.

Die 35 Browsertests der Tasks 001–005 laufen unverändert grün.

---

## 16. Bekannte Einschränkungen

1. **Keine Cross-Device-Wiederaufnahme.** Ohne authentifizierte Identität gibt
   es nichts, woran eine Sitzung erneut gebunden werden könnte.
   `resume.cross_device` ist literal `false`. Benötigt Task 007.
2. **Keine Modellinteraktion aus der UI.** Die installierte MCP-Apps-Version
   bietet dafür keine unterstützte Schnittstelle. Der Planvorschlag entsteht im
   Chat; die UI führt ehrlich dorthin.
3. **Kein produktiver Betrieb.** `production` lehnt jeden Aufruf ab. Schreibende
   Planoperationen laufen ausschließlich im Fixture-Modus — eine Grenze, die aus
   Task 005 übernommen wird.
4. **Journal nicht verteilt.** `FileOnboardingRepository` ist ein lokales
   Journal für einen Prozess. Mehrinstanzbetrieb benötigt ein verteiltes
   Backend.
5. **Keine Dokument-Extraktion.** Bestehende Pläne werden aus strukturierten
   Chat-Eingaben übernommen, nicht aus PDFs oder Fotos.
6. **Kein Cardio, keine Ernährung, keine Gesundheitsprofile.** Bewusst außerhalb
   des Umfangs; es existieren keine Felder dafür.
7. **`COMPLETED` ist unerreichbar.** Der Status existiert im Vertrag für Task
   007 und wird in Task 006 nie gemeldet.
8. **Der Sitzungsnachweis lebt in `sessionStorage`.** In einem Kontext ohne
   Browser-Storage (opakes MCP-App-Origin) hält ihn der Client im Speicher; ein
   Reload beginnt dort eine neue Einrichtung.

---

## 17. Abweichungen vom Auftrag

**1. Eine Änderung an einer Task-005-Datei.** `TrainingPlanEditorView` wurde um
eine Zeile Logik erweitert: `embedded` unterdrückt nun auch „Bestätigen und
aktivieren" und „Entwurf verwerfen". Der Auftrag verlangt, den Editor
wiederzuverwenden und keine zweite Implementierung zu schaffen — genau das ist
umgesetzt. Die Anpassung war fachlich notwendig, weil eine Aktivierung aus dem
eingebetteten Editor den Entwurf unveränderbar gemacht und das Onboarding in
eine Sackgasse geführt hätte, und weil §16 eine Aktivierung vor dem
Task-007-Provisioning ausschließt. Das Bearbeiten ist unverändert; alle
13 Planeditor-Browsertests laufen weiter grün.

**2. Bestätigung und Handoff in einem Vorgang.** `confirm_onboarding_plan` führt
`CONFIRM_PLAN` **und** `PREPARE_HANDOFF` aus, sodass der Status nach der
Bestätigung `AWAITING_GOOGLE_CONNECTION` ist — wie das Abnahmeszenario es
verlangt. Beide sind echte Maschinenübergänge in der dokumentierten Reihenfolge;
`PLAN_CONFIRMED` ist damit ein Durchgangszustand. Ein zweiter Button, der die
Freigabe nur wiederholt, wäre eine Scheininteraktion gewesen.

**3. Der Bestätigungsdatensatz bleibt beim Ungültigwerden erhalten.** Der
Auftrag verlangt, dass eine Änderung die Bestätigung ungültig macht. Umgesetzt
über den Status `superseded` plus Revisionsvergleich bei jedem Lesen, statt den
Datensatz zu löschen — so kann dem Nutzer gesagt werden, _welche_ Revision
freigegeben war. Handlungsfähig ist eine überholte Bestätigung nie.

**4. Idempotenz in der Session, nicht im Operations-Ledger.** Der Auftrag
verlangt, das vorhandene Idempotenzsystem wiederzuverwenden. Für
Planschreibvorgänge geschieht das: eine wiederholte Vorschlagsübergabe läuft
über das Ledger aus Task 004 und erzeugt keinen zweiten Entwurf. Die
Onboarding-eigene Idempotenz liegt dagegen in `OnboardingRecord.applied`, weil
das Ledger auf `WriteResult | PlanWriteResult` typisiert ist; die Union um einen
Onboarding-Typ zu erweitern hätte das Onboarding in den Commit-Pfad von Workout
und Plan verdrahtet. Die Session-Variante ist atomar mit dem Session-Write und
auf 64 Einträge begrenzt.

**5. Der Willkommensschritt ist kein Serverzustand.** Eine neue Sitzung entsteht
in `COLLECTING_PROFILE`, damit ein Chat-Turn sofort eine Antwort speichern kann;
`NOT_STARTED` würde das mit `INVALID_STATE_TRANSITION` ablehnen. Der
Willkommensschritt ist daher eine UI-Angelegenheit und erscheint, solange keine
Angabe existiert. Der Zustand `NOT_STARTED` und sein `START`-Übergang bleiben im
Vertrag und sind getestet.

**6. Ein Fix außerhalb des Umfangs.** Das NUL-Byte in `access.ts` (§1) wurde
behoben, weil Git die Datei dadurch als binär behandelte und Diffs für Review
und Task 007 unbrauchbar gewesen wären.

Keine weiteren Abweichungen. Insbesondere eingehalten: keine Änderung an der
Arnold-Masterdatei, kein Google-OAuth, keine Google-Tokens, keine produktiven
Nutzerkonten, keine Google-Dateierstellung, keine zweite
Trainingsplan-Versionierung, keine zweite Analytics Engine, keine Änderung an
der ChatGPT-Verbindung, kein Deployment, keine Tunnel-Änderungen, keine externen
kostenpflichtigen Dienste, keine medizinischen Diagnosefunktionen, keine
Ernährungs- oder Cardio-Module, keine ungeschützten öffentlichen
Schreibzugriffe, keine committeten Secrets.

---

## 18. Branch und Commit-SHA

**Branch:** `feat/arnold-onboarding`, erstellt aus `feat/arnold-plan-management`
unter Erhalt des Arbeitsbaums, damit die unfertige Task-004/005-Arbeit nicht
überschrieben wird.

**Commit:** Während dieser Arbeit hat eine **andere Sitzung** den Arbeitsbaum als
Checkpoint committet: `cc1fb84` („Integrate Tasks 004-006: workout logging, plan
management, onboarding"). Dieser Commit enthält den Code dieser Task, aber
weder die beiden Vertragsdokumente noch diesen Bericht — er benennt diese Lücke
selbst.

Uncommitted verbleiben daher:

- `docs/ARNOLD-ONBOARDING-CONTRACT.md` (neu)
- `docs/ARNOLD-ONBOARDING-CONVERSATION.md` (neu)
- `docs/ARNOLD-TASK-006-COMPLETION-REPORT.md` (neu, dieses Dokument)
- `README.md` (Abschnitt Task 006)
- `src/server/onboarding/access.ts` (NUL-Byte entfernt)

Diese Sitzung hat selbst **nicht** committet. Letzter Commit vor der
Fremdsitzung: `8723df4`.

Alle fünf Prüfungen in §1 wurden nach dem Fremdcommit und nach dem
NUL-Byte-Fix erneut vollständig ausgeführt.

---

## 19. Empfehlung für Task 007

1. **Identitäts-Guard zuerst.** `OnboardingAccessControl` durch eine
   Implementierung ersetzen, die einen verifizierten Google-Subject auflöst
   (`kind: "authenticated"`). `DenyOnboardingAccessControl` ist die absichtlich
   dichte Vorlage; `establish` und `authorize` sind die beiden Methoden, die zu
   füllen sind. Danach darf `mode: "production"` freigeschaltet werden.
2. **`oauth_state_binding` verwenden.** Beim Start des Flows mitführen, im
   Callback gegen die Sitzung prüfen. Der Wert allein ist kein
   Berechtigungsnachweis — die Sitzung ist weiterhin zu autorisieren.
3. **`GOOGLE_CONNECTED` erst nach verifiziertem Provisioning.** Die Maschine
   akzeptiert den Übergang nur mit `provisioning_verified: true`. Erst dann wird
   `COMPLETED` gemeldet — vorher nicht, auch nicht in der UI.
4. **Aktivierung im Provisioning, nicht im Onboarding.** Über
   `TrainingPlanService.activateTrainingPlan` mit einer Bestätigung, die exakt
   `confirmed_plan_version_id` und `confirmed_plan_revision` aus dem Handoff
   nennt. Nur bei `status === "ready_for_google_connection"` handeln; bei
   `superseded` den Nutzer erneut bestätigen lassen.
5. **Reihenfolge beachten.** Tracker anlegen und autorisieren, **dann**
   aktivieren. Die Aktivierung braucht einen schreibfähigen Tracker; dazu
   `PLANS`/`PLAN_ITEMS` in den Google-Schreibadapter aufnehmen und `test_sheet`
   im Planservice zulassen (Details im Task-005-Vertrag).
6. **Persistenz tauschen.** `FileOnboardingRepository` durch ein verteiltes
   Backend ersetzen (`durability: "distributed"`). Erst dann darf
   `resume.cross_device` wahr werden — es ist heute absichtlich ein literal
   `false`, damit niemand die Zusage versehentlich gibt.
7. **Den Google-Button aktivieren.** In `GoogleConnectionHandoffStep` ist er
   deaktiviert und als nächster Entwicklungsschritt gekennzeichnet; dort und im
   `WelcomeStep` stehen die Hinweistexte, die mit der Umsetzung angepasst werden
   müssen. Drei Tests prüfen heute ausdrücklich, dass keine Google-Verbindung
   behauptet wird — sie sind beim Freischalten anzupassen.

---

## Verbindliche Abnahmefragen

**Kann ein neuer Nutzer das Onboarding vollständig starten?**
Ja. `show_arnold_onboarding` öffnet die Oberfläche und legt eine Sitzung an;
`start_arnold_onboarding` tut dasselbe aus dem Chat. Ein Browsertest fährt den
vollständigen Ablauf vom Willkommensschritt bis zum Google-Handoff.

**Kann das Trainingsprofil interaktiv ausgefüllt werden?**
Ja. Fünf Schritte, jede Pflichtangabe als Auswahlkarte, Fortschrittsanzeige,
Rückwärtsnavigation, überspringbare optionale Fragen und Validierungsfehler am
betroffenen Feld. 17 Browsertests und 33 Render-Tests belegen das.

**Können Angaben auch über ChatGPT verändert werden?**
Ja. `update_onboarding_profile` mischt einen Patch, sodass für „eigentlich lieber
nur dreimal die Woche" ein einzelnes Feld genügt. Ein MCP-Test fährt diesen
Gesprächsverlauf über drei Turns.

**Wird derselbe Backend-Zustand von Chat und UI verwendet?**
Ja. Belegt durch einen Test, der denselben Planentwurf über
`get_onboarding_plan` und `get_plan_editor_context` liest und dieselbe
`plan_version_id` erhält, und durch einen zweiten, der eine Änderung über
`update_plan_draft` anschließend in `get_onboarding_state` wiederfindet. Es
existiert keine zweite, nur im Chatverlauf gehaltene Kopie des Profils.

**Kann ChatGPT einen strukturierten Trainingsplanvorschlag übergeben?**
Ja, über `submit_onboarding_plan_proposal` im Domain-Modell aus Task 005. Der
Brief aus `get_onboarding_brief` liefert den gültigen Übungskatalog, das
Zeitbudget, die Randbedingungen und die Liste dessen, was nicht erfunden werden
darf.

**Wird dieser Plan serverseitig validiert?**
Ja, zweifach: fachlich gegen das Profil (Einheiten vorhanden, nicht leer,
Tageszahl) und strukturell durch den `TrainingPlanService` gegen den Arnold-
Datenvertrag. Erfundene Exercise-IDs, ungültige Wiederholungsbereiche, leere
Einheiten und Vorschläge vor der Vorschlagsphase werden abgelehnt.

**Wird der bestehende Planeditor wiederverwendet?**
Ja. `TrainingPlanEditorView` aus Task 005 wird mit `embedded` gemountet. Es gibt
keine zweite Planeditor-Implementierung und keine zweite Planlogik; jede
Änderung ist ein typisierter Edit an `update_plan_draft`.

**Kann der Nutzer den Plan bearbeiten?**
Ja: Trainingstage ansehen, hinzufügen, entfernen, umbenennen, umsortieren,
duplizieren; Übungen hinzufügen, austauschen, entfernen, umsortieren; Sätze,
Wiederholungsbereiche, Zielgewichte, Pausen, Notizen und Ausführungen
bearbeiten; prüfen. Ein Browsertest ersetzt eine Übung im eingebetteten Editor
und sieht die erhöhte Revision.

**Wird eine Planbestätigung an eine eindeutige Revision gebunden?**
Ja. Die `confirmation` nennt `plan_version_id` **und** `row_revision`, geprüft
gegen den Stand _jetzt_. Zusätzlich ist sie an die Profilrevision gebunden.

**Können ältere oder ungültige Planversionen nicht versehentlich bestätigt
werden?**
Nein, das ist dreifach ausgeschlossen: eine Bestätigung mit alter Revision wird
mit `STALE_CONFIRMATION` abgewiesen; eine Änderung am Plan oder am Profil setzt
den Handoff auf `superseded` und nimmt die Einrichtung nach `REVIEWING_PLAN`
zurück; und `get_onboarding_handoff` vergleicht bei jedem Lesen erneut, sodass
auch eine Änderung aus dem Planeditor — von der das Onboarding nichts erfährt —
die Freigabe ungültig macht.

**Funktioniert die Wiederaufnahme einer gültigen Testsession?**
Ja. Belegt für einen Reload der App (Browsertest: Angaben und Schritt erscheinen
wieder) und für einen Serverneustart mit Dateijournal (Unit-Test mit zwei
Runtimes über derselben Datei). Ein falscher Nachweis wird auch nach dem
Neustart abgewiesen.

**Sind Nutzersitzungen gegeneinander isoliert?**
Ja. Die ID von Sitzung A mit dem Token von Sitzung B wird mit
`PERMISSION_DENIED` abgewiesen; Angaben und Planentwürfe zweier Sitzungen
bleiben getrennt. Eine beliebige Session-ID ist kein Berechtigungsnachweis: der
Server speichert nur den SHA-256 des Nachweises und vergleicht konstant-zeitig.

**Ist der spätere Google-OAuth-Handoff eindeutig definiert?**
Ja. `OnboardingHandoff` nennt Sitzung, bestätigte Planversion, bestätigte
Revision, Profilrevision, Bestätigungszeitpunkt, die aktuelle Planrevision und
eine `oauth_state_binding` für die spätere `state`-Prüfung. Vier Status
unterscheiden `not_ready`, `ready_for_google_connection`, `superseded` und
`completed`. Das Objekt enthält keinen Nachweis und keine personenbezogenen
Daten.

**Wird noch keine echte Google-Datei erstellt?**
Nein. Es gibt keinen Codepfad dorthin. `google_connection_pending` ist literal
`true`, der Google-Button ist deaktiviert, und die Oberfläche sagt ausdrücklich:
kein Google-Konto verbunden, keine Datei angelegt, kein Plan in einer
Trainingsdatei aktiviert. Kein Google-Token wird erzeugt oder gespeichert.

**Sind produktive Schreibzugriffe weiterhin deaktiviert?**
Ja. `ARNOLD_WRITE_MODE=production` lehnt der Planservice weiterhin ab,
`test_sheet` ebenfalls (kein Google-Schreibpfad für `PLANS`/`PLAN_ITEMS`), und
das Onboarding im Modus `production` lehnt jeden Aufruf mit `AUTH_REQUIRED` ab.
Alle Schreibvorgänge dieser Task laufen gegen synthetische In-Memory-Tracker.

**Funktioniert das bestehende Arnold-Dashboard weiterhin?**
Ja. `show_arnold_dashboard` ist unverändert, das Onboarding ist eine eigene
App-Resource, und der Leerzustand des Dashboards enthält weiterhin bewusst
keinen Onboarding-Button. Alle Tests der Tasks 001–005 laufen unverändert grün:
647 der 881 Unit-Tests und 35 der 52 Browsertests stammen aus den
Vorgängertasks.

**Wurden alle Tests tatsächlich ausgeführt?**
Ja, alle fünf Prüfungen vollständig und nach dem letzten Eingriff erneut:
`typecheck` fehlerfrei, `npm test` 881/881, `npm run build` erfolgreich,
`npm run test:e2e` 52/52, `npm run format:check` sauber.

**Welche Anforderungen benötigen zwingend Task 007?**
Die verifizierte Nutzeridentität und damit der Modus `production`; die
Wiederaufnahme über Geräte hinweg (`resume.cross_device`); der OAuth-Flow samt
`state`-Prüfung; das Anlegen der persönlichen Google-Datei; die Aktivierung des
bestätigten Plans im Nutzertracker; der Zustand `COMPLETED`; der
Google-Schreibpfad für `PLANS`/`PLAN_ITEMS`; und ein verteiltes Session-Backend
für den Mehrinstanzbetrieb.
