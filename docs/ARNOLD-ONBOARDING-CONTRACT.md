# Arnold Onboarding Contract

Vertrag: `arnold.onboarding/1`
Schema-Version: `1.0.0`
Stand: Task 006

Dieses Dokument beschreibt den Einrichtungsprozess von Arnold: das
Domain-Modell, die Zustandsmaschine, die Profilregeln, die MCP-Werkzeuge, den
Planvorschlagsprozess, die Planbestätigung und den vorbereiteten
Google-OAuth-Handoff.

Es ist konsistent zu `ARNOLD-DATA-CONTRACT.md` (Task 001),
`ARNOLD-METRICS-SPEC.md` (Task 002), `ARNOLD-UI-CONTRACT.md` (Task 003),
`ARNOLD-WRITE-CONTRACT.md` (Task 004) und `ARNOLD-PLAN-CONTRACT.md` (Task 005).

---

## 1. Produktziel

Ein neuer Nutzer soll innerhalb von ChatGPT in wenigen Minuten einen konkreten,
nützlichen Trainingsplan erhalten — ohne ein langes technisches Formular.

Zwei Oberflächen teilen sich dieselbe Aufgabe:

- **ChatGPT** nimmt natürliche Sprache auf („Ich will Muskeln aufbauen",
  „Eigentlich lieber nur dreimal die Woche").
- **Die Arnold MCP-App** übernimmt die strukturierten Teile: Ziele auswählen,
  Häufigkeit einstellen, Plan ansehen, Übungen bearbeiten, Plan bestätigen,
  Fortschritt anzeigen.

Beide arbeiten auf **einer** serverseitigen Einrichtungssitzung mit **einem**
Satz Validierungsregeln. Es gibt bewusst keine zweite, nur im Chatverlauf
gehaltene Kopie des Profils: ein Chatverlauf ist keine Datenbank.

Es werden nur die Angaben erfragt, die für den **ersten** Plan nötig sind.
Alles Weitere lässt sich später ergänzen.

---

## 2. Gesamter Nutzerfluss

```text
ChatGPT-Unterhaltung
         |
         v
Arnold MCP-Tools  (12 Werkzeuge, §9)
         |
         v
OnboardingService  (die einzige Stelle, die Einrichtungszustand ändert)
         |
         +--> Onboarding State Machine   (transitionOnboarding)
         |
         +--> Profilvalidierung          (validateProfile / buildBrief)
         |
         +--> Planvorschlags-Orchestrierung
         |
         +--> TrainingPlanService (Task 005)   <-- die einzige Planlogik
         |
         +--> Revisions- und Idempotenz-Guard
         |
         +--> Access Control             (fail-closed)
         |
         v
OnboardingStateRepository
         |
         +--> InMemory  (Tests, ein Prozess)
         |
         +--> File      (lokales Journal, überlebt Serverneustart)
         |
         +--> später: persistentes Backend
         |
         v
Arnold MCP UI
         |
         +--> Setup-Wizard
         |
         +--> Trainingsplan-Editor (Task 005, unverändert eingebettet)
         |
         +--> Bestätigungsdialog
         |
         v
OAuth-Handoff-Grenze  (OnboardingHandoff)
         |
         v
Task 007: Google OAuth + Provisioning
```

### Verbindliche Grundsätze

1. Der Server ist die einzige Autorität für den Einrichtungszustand.
2. Die UI ist eine Darstellung dieses Zustands.
3. ChatGPT darf Vorschläge machen, aber keine Zustandsregel umgehen.
4. Fachliche Entscheidungen werden im Backend validiert.
5. **Keine** Onboarding-Daten in den sechs Google-Sheets-Tabellen
   (`CONFIG.onboarding_storage = BACKEND_ONLY`).
6. Keine zweite Trainingsplanlogik.
7. Der Planeditor aus Task 005 wird wiederverwendet.
8. Audit und Idempotenz stammen aus dem bestehenden System (Task 004).
9. Keine realen Google-Tokens.
10. Das Onboarding funktioniert unabhängig vom Demo-Dashboard.

---

## 3. Domain-Modell

Datei: `src/shared/onboarding-contract.ts`. Alles Zod-validiert.

| Objekt                       | Bedeutung                                                                 |
| ---------------------------- | ------------------------------------------------------------------------- |
| `OnboardingSession`          | Der serverseitige Einrichtungszustand. Einzige Autorität.                 |
| `OnboardingProfile`          | Das Trainingsprofil. Pflichtfelder nullable, Vollständigkeit berechnet.   |
| `TrainingPreferences`        | Optionale Angaben: Splits, Übungen, Geräte, bestehende Routine, Freitext. |
| `OnboardingProgress`         | Abgeleiteter Fortschritt. Nie gespeichert.                                |
| `OnboardingPlanProposal`     | **Referenz** auf den Draft des Planservice, nie eine Kopie des Plans.     |
| `OnboardingPlanConfirmation` | Die Freigabe genau einer Planversion und genau einer Revision.            |
| `OnboardingState`            | Was jeder Aufrufer sieht: Session, Fortschritt, Prüfung, Plan, Handoff.   |
| `OnboardingEvent`            | Die Ereignisse der Zustandsmaschine.                                      |
| `OnboardingValidationResult` | Fehler, Hinweise, Empfehlungen — getrennt nach Schweregrad.               |
| `OnboardingHandoff`          | Das Übergabeobjekt für Task 007. Nur validierte Referenzen.               |
| `OnboardingBrief`            | Strukturierte Grundlage, aus der ChatGPT einen Plan erstellt.             |
| `OnboardingClaim`            | Sitzungs-ID **und** Sitzungsnachweis. Die Adressierung jeder Operation.   |

### `OnboardingSession`

```typescript
{
  onboarding_session_id: string;      // "onb-<uuid7>"
  status: OnboardingStatus;
  current_step: OnboardingStep;
  schema_version: "1.0.0";
  created_at_utc: string;
  updated_at_utc: string;
  expires_at_utc: string;
  revision: number;                   // +1 pro akzeptierten Schreibvorgang
  profile: OnboardingProfile;
  plan_draft_reference: OnboardingPlanProposal | null;
  confirmed_plan_reference: OnboardingPlanConfirmation | null;
  handoff_status: HandoffStatus;
  last_error: { code; message; at } | null;
  tracker_id: string;                 // Fixture-Tracker vor Task 007
}
```

### Wichtige Regel: Sitzung ist kein Nutzerkonto

`onboarding_session_id` identifiziert eine **Einrichtung**, nicht eine Person.
Vor Task 007 existiert keine belastbare Google-Nutzeridentität. Die Sitzung ist
anonym und läuft ab. Kein Feld dieses Vertrags darf zu einer `user_id` werden;
ein Test prüft ausdrücklich, dass die Session kein `user_id`-Feld besitzt.

Nicht im Server abgelegt: Token-Klartext, Gesundheitsdaten, personenbezogene
Kennungen.

---

## 4. State Machine

Datei: `src/server/onboarding/state-machine.ts`. Rein: Zustand + Ereignis →
neuer Zustand oder begründete Ablehnung. Kein Clock, kein Storage, kein React.

`OnboardingService` ist der einzige Aufrufer und hat **keinen** zweiten Pfad,
der einen Status verschiebt. Eine React-Komponente oder ein MCP-Handler kann
einen Status gar nicht setzen.

### Zustände

```typescript
type OnboardingStatus =
  | "NOT_STARTED"
  | "COLLECTING_PROFILE"
  | "PROFILE_READY"
  | "WAITING_FOR_PLAN_PROPOSAL"
  | "REVIEWING_PLAN"
  | "PLAN_CONFIRMED"
  | "AWAITING_GOOGLE_CONNECTION"
  | "COMPLETED" // nur über Task 007 erreichbar
  | "CANCELLED"
  | "EXPIRED";
```

Lade- und Fehlerzustände sind **nicht** Teil dieser Liste. Ein fehlgeschlagener
Request lässt die Sitzung im bisherigen Zustand und meldet `last_error`, sodass
ein Netzwerkfehler niemanden in einem toten Zustand zurücklässt.

### Erlaubter Prozess

```text
NOT_STARTED
      | START
      v
COLLECTING_PROFILE  <--+ SAVE_PROFILE (unvollständig)
      | SAVE_PROFILE   | GO_BACK (Schritt, nicht Status)
      v (vollständig)  |
PROFILE_READY ---------+
      | REQUEST_PLAN
      v
WAITING_FOR_PLAN_PROPOSAL
      | PLAN_PROPOSED
      v
REVIEWING_PLAN  <--+ REVISE_PLAN / SAVE_PROFILE
      | CONFIRM_PLAN
      v            |
PLAN_CONFIRMED ----+
      | PREPARE_HANDOFF
      v
AWAITING_GOOGLE_CONNECTION
      | GOOGLE_CONNECTED (nur mit verifiziertem Provisioning)
      v
[ TASK 007 ] --> COMPLETED
```

Jederzeit möglich: `CANCEL` → `CANCELLED`, `EXPIRE` → `EXPIRED`, `RESUME`
(verändert den fachlichen Zustand nicht).

### Anforderungen an jeden Übergang

1. Gültiger aktueller Zustand.
2. Erlaubtes Ereignis.
3. Validierte Eingaben (Zod).
4. Passende Revision (`expected_revision`).
5. Autorisierte Sitzung im jeweiligen Betriebsmodus.

### Effekte

Die Maschine gibt neben dem Zustand _Effekte_ zurück, damit „eine Änderung macht
die Bestätigung ungültig" eine Maschinenregel ist und keine Konvention:

| Effekt               | Wirkung                                 |
| -------------------- | --------------------------------------- |
| `clear_confirmation` | Bestätigungsdatensatz entfernen.        |
| `clear_plan_draft`   | Planreferenz entfernen.                 |
| `handoff_ready`      | Übergabe bereit.                        |
| `handoff_not_ready`  | Keine Übergabe möglich.                 |
| `handoff_superseded` | Bestätigung besteht, ist aber überholt. |

### Rückwärtsbewegungen

Während der Erfassung darf der Nutzer frei zu früheren Schritten zurück
(`GO_BACK` ändert den **Schritt**, nicht den Status — die Angaben bleiben
vollständig). Nach einer Planbestätigung ist stilles Zurückgehen ausgeschlossen:
`REVISE_PLAN` oder eine Profiländerung nimmt den Plan zurück in `REVIEWING_PLAN`
und macht die Bestätigung ungültig.

Der Bestätigungs-_Datensatz_ bleibt dabei absichtlich erhalten. Ungültig ist
nicht dasselbe wie gelöscht: so kann der Handoff sagen „bestätigt war Revision
3, aktuell ist Revision 4" statt des nutzlosen „keine Bestätigung vorhanden".
Handlungsfähig ist er nie, weil `handoffFor` bei jedem Lesen die Revisionen
vergleicht.

### Kontrolliert abgelehnte Vorgänge

| Vorgang                                     | Code                       |
| ------------------------------------------- | -------------------------- |
| Plan bestätigen ohne Planentwurf            | `PLAN_PROPOSAL_REQUIRED`   |
| Bestätigung mit falscher/alter Revision     | `STALE_CONFIRMATION`       |
| OAuth-Handoff ohne bestätigten Plan         | `HANDOFF_NOT_READY`        |
| Handoff ohne gültigen Bestätigungsdatensatz | `CONFIRMATION_REQUIRED`    |
| `COMPLETED` ohne erfolgreiches Provisioning | `OAUTH_NOT_IMPLEMENTED`    |
| Planvorschlag vor `request_onboarding_plan` | `INVALID_STATE_TRANSITION` |
| Planvorschlag bei unvollständigem Profil    | `PROFILE_INCOMPLETE`       |
| Nutzung einer abgelaufenen Sitzung          | `SESSION_EXPIRED`          |
| Nutzung einer abgebrochenen Sitzung         | `SESSION_CANCELLED`        |
| Schreibvorgang auf veralteter Revision      | `REVISION_CONFLICT`        |

`allowedEvents(state)` liefert genau die Ereignisse, die die Maschine aktuell
akzeptieren würde, und treibt damit die Steuerelemente der UI. Ein Test prüft
für **jeden** Status, dass kein angebotenes Ereignis anschließend abgelehnt
wird.

---

## 5. Profilfelder und Validierungsregeln

Der erste Produktumfang betrachtet ausschließlich **Krafttraining**.

### Pflichtangaben (6)

| Feld              | Werte                                                         | Schritt        |
| ----------------- | ------------------------------------------------------------- | -------------- |
| `primary_goal`    | `muscle_gain`, `strength`, `general_fitness`, `recomposition` | `goal`         |
| `experience`      | `beginner`, `intermediate`, `advanced`                        | `goal`         |
| `days_per_week`   | Ganzzahl 1–7                                                  | `availability` |
| `session_minutes` | Ganzzahl 20–150 (Vorschläge 30/45/60/75/90)                   | `availability` |
| `environment`     | `gym`, `home`, `mixed`                                        | `availability` |
| `starting_point`  | `new_plan`, `existing_plan`, `undecided`                      | `preferences`  |

Mehrfachziele sind über `preferences.secondary_goals` möglich; das Hauptziel
bleibt in `primary_goal` eindeutig.

### Optionale Angaben

`preferred_split`, `preferred_exercises`, `avoided_exercises`,
`available_equipment`, `existing_routine`, `known_starting_loads`, `notes`.

### Validierungsregeln

- Pflichtfelder müssen vorliegen, **bevor** ein vollständiger Planvorschlag
  angefordert wird (`PROFILE_INCOMPLETE`).
- Optionale Felder dürfen fehlen und blockieren nie.
- Unrealistische Eingaben werden **nicht** stillschweigend übernommen: Werte
  außerhalb der Bänder lehnt das Schema ab, statt zu runden oder zu clampen.
- Innerhalb der Bänder ist eine ungewöhnliche Wahl eine **Empfehlung**, kein
  Fehler. Sieben Trainingstage oder 30-Minuten-Einheiten sind legitim; Arnold
  weist darauf hin und plant entsprechend.
- Startgewichte werden nur übernommen, wenn Lastdefinition **und** Ausführung
  eindeutig sind. 20 kg „pro Kurzhantel" und 20 kg „Maschinenanzeige" sind
  verschiedene Tatsachen; ohne diese Angaben bleibt das Gewicht leer.
- Eine bestehende Routine ist selten vollständig. Fehlende Sätze oder
  Wiederholungen werden als offen **gekennzeichnet**, nicht erfunden. Was für
  die Aktivierung nötig ist, muss vor der Bestätigung ergänzt werden.
- Freitext wird gespeichert, aber **nie** als Serveranweisung interpretiert. Im
  Brief erscheint er getrennt unter `user_statements`, ausdrücklich als
  Nutzerangabe.

### Datensparsamkeit

Es existiert **kein** Feld für medizinische Diagnosen, Krankengeschichten,
Verletzungen oder Gesundheitsprofile — ein Test prüft, dass ein solches Feld
vom Schema abgelehnt wird. Nennt ein Nutzer freiwillig eine körperliche
Einschränkung, bleibt das Freitext und wird nicht zur Grundlage einer
medizinischen Aussage. Arnold erteilt keine Trainingsfreigaben.

### Fehlercodes der Profilprüfung

`MISSING_PRIMARY_GOAL`, `MISSING_EXPERIENCE`, `MISSING_DAYS_PER_WEEK`,
`MISSING_SESSION_MINUTES`, `MISSING_ENVIRONMENT`, `MISSING_STARTING_POINT`,
`IMPLAUSIBLE_SESSION_MINUTES`, `IMPLAUSIBLE_DAYS_PER_WEEK`,
`INCOMPLETE_STARTING_LOAD`, `UNKNOWN_EXERCISE_REFERENCE`,
`EXISTING_ROUTINE_INCOMPLETE`, `EQUIPMENT_ENVIRONMENT_MISMATCH`,
`PROPOSAL_DAYS_MISMATCH`, `PROPOSAL_NO_SESSION`, `PROPOSAL_EMPTY_SESSION`.

Jede Finding trägt `field` und `step`, damit die UI sie direkt am betroffenen
Eingabefeld anzeigen kann statt in einem Banner.

---

## 6. Dynamische Frageführung

Fünf Schritte, nach Bedeutung gebündelt — keine sechs getrennten Formulare.

| Schritt        | Inhalt                                                                |
| -------------- | --------------------------------------------------------------------- |
| `welcome`      | Was ist Arnold, was wird eingerichtet, Start-Button.                  |
| `goal`         | Trainingsziel + Erfahrung.                                            |
| `availability` | Tage pro Woche + Dauer je Einheit + Umgebung.                         |
| `preferences`  | Ausgangssituation + bevorzugte/gemiedene Übungen + Geräte + Freitext. |
| `summary`      | Alle Angaben, jede Zeile änderbar, Planvorschlag anfordern.           |

Danach: `plan_proposal` → `plan_review` → `confirmation` →
`google_connection`.

### UX-Regeln

1. Wenige Interaktionen; jede Pflichtangabe ist eine Auswahl, kein Textfeld.
2. Keine redundanten Fragen.
3. Keine Standardwerte für Pflichtangaben — nichts ist vorausgewählt.
4. Alle Werte änderbar, auch aus der Zusammenfassung heraus.
5. Keine automatische Auswahl aufgrund ungesicherter Annahmen.
6. Fortschritt sichtbar („3 von 6 Pflichtangaben erfasst").
7. Vorheriger Schritt jederzeit möglich.
8. Optionale Fragen überspringbar — als echter Button, nicht als Hinweis.
9. Validierungsfehler direkt am Feld (`role="alert"`, `aria-describedby`).
10. Kein Datenverlust beim Navigieren: Antworten sind vor jeder Navigation
    gespeichert.

Der Willkommensschritt ist eine reine UI-Angelegenheit, kein Serverstatus: eine
neue Sitzung entsteht in `COLLECTING_PROFILE`, damit ein Chat-Turn sofort eine
Antwort speichern kann. Die UI zeigt den Willkommensschritt, solange noch keine
Angabe existiert.

### Sprache

Die Oberfläche ist deutschsprachig. Enum-Werte sind **Speicherschlüssel** und
werden nie angezeigt; sichtbare Beschriftungen kommen aus `GOAL_LABEL`,
`EXPERIENCE_LABEL`, `ENVIRONMENT_LABEL`, `STARTING_POINT_LABEL`, `STATUS_LABEL`,
`STEP_LABEL` und `REQUIRED_FIELD_LABEL`. Mehrsprachigkeit bedeutet damit, diese
Maps zu tauschen. Ein Test prüft, dass kein Enum-Wert in einer gerenderten
Oberfläche vorkommt.

---

## 7. Gesprächsführung über ChatGPT

Siehe `ARNOLD-ONBOARDING-CONVERSATION.md` für die Agent-Anleitung.

| Nutzeräußerung                                 | Erwartetes Verhalten                                                                    |
| ---------------------------------------------- | --------------------------------------------------------------------------------------- |
| „Ich möchte Arnold einrichten."                | `start_arnold_onboarding`, oder gültige Sitzung fortsetzen.                             |
| „Ich habe Erfahrung und gehe viermal ins Gym." | `update_onboarding_profile` mit drei Feldern.                                           |
| „Eigentlich lieber nur dreimal die Woche."     | `update_onboarding_profile` mit `days_per_week: 3`.                                     |
| „Zeig mir meinen Einrichtungsstand."           | `get_onboarding_state`.                                                                 |
| „Erstelle mir den Trainingsplan."              | `request_onboarding_plan` → `get_onboarding_brief` → `submit_onboarding_plan_proposal`. |
| „Tausche Kniebeugen gegen Beinpresse."         | `update_plan_draft` (Task 005) am referenzierten Draft.                                 |

Ein Patch **mischt**: nicht übergebene Felder bleiben unverändert. Darum genügt
für „doch nur dreimal" ein einzelnes Feld.

ChatGPT und die UI verwenden dieselbe serverseitige Sitzung und dieselben
Validierungsregeln.

### Fehlende sichere Sitzungsbindung

Steht kein sicherer persistenter Sitzungskontext zur Verfügung, wird das
transparent gemeldet: `OnboardingState.resume` nennt `durable`,
`cross_device: false` und einen Hinweistext, der in der UI erscheint. Eine
vollständige Wiederaufnahme über Geräte hinweg wird **nicht** behauptet.

---

## 8. Session-Persistenz und Wiederaufnahme

### Repository

`OnboardingStateRepository` (`src/server/onboarding/repository.ts`):

```typescript
createSession(record): Promise<OnboardingRecord>
getSession(sessionId): Promise<OnboardingRecord | undefined>
updateSession(record, expectedRevision): Promise<OnboardingRecord>
expireSession(sessionId): Promise<OnboardingRecord | undefined>
purge(now): Promise<number>
readonly durability: "memory" | "local" | "distributed"
```

Zwei Implementierungen:

- `InMemoryOnboardingRepository` — ein Prozess, für Unit-Tests.
- `FileOnboardingRepository` — lokales Journal, atomar über Temp-Datei und
  `rename` mit Modus `0600`, wie das Operationsjournal aus Task 004. Überlebt
  einen Serverneustart und macht damit die Wiederaufnahmetests aussagekräftig.
  Ausdrücklich **kein** verteilter Speicher.

Der gespeicherte Datensatz trennt Öffentliches von Geheimem:

```typescript
{
  session: OnboardingSession;
  token_fingerprint: string; // SHA-256 des Nachweises, nie der Nachweis
  owner_subject: string;
  applied: Record<string, number>; // request_id -> erzeugte Revision
}
```

### Revisions- und Idempotenzstrategie

- Jeder akzeptierte Schreibvorgang erhöht `session.revision` um 1.
- Ein Aufrufer kann `expected_revision` mitsenden; weicht sie ab, wird mit
  `REVISION_CONFLICT` abgelehnt, statt zu überschreiben.
- `applied` merkt sich die angewendeten `request_id`s mit der erzeugten
  Revision. Eine Wiederholung liefert den gespeicherten Stand mit
  `replayed: true` zurück und wendet **nichts** erneut an. Die Map ist auf 64
  Einträge begrenzt.
- `updateSession` lehnt zusätzlich jeden Versuch ab, Nachweis, Eigentümer oder
  Erstellungszeit einer bestehenden Sitzung zu ändern (Session-Fixation).
- Planschreibvorgänge nutzen das Ledger aus Task 004: eine wiederholte
  Vorschlagsübergabe erzeugt keinen zweiten Entwurf, weil die `request_id` des
  Onboardings deterministisch auf eine Plan-`request_id` abgebildet wird.

### Session-Lifecycle

| Aspekt              | Regel                                                                |
| ------------------- | -------------------------------------------------------------------- |
| Ablaufzeit          | Standard 24 Stunden (`expires_at_utc`).                              |
| Abgelaufene Sitzung | Akzeptiert nur noch `CANCEL`; Status wird als `EXPIRED` dargestellt. |
| Aufbewahrung        | 7 Tage nach Ablauf (`ONBOARDING_RETENTION_MS`), danach einsammelbar. |
| Einsammeln          | `purge` läuft bei jedem `startOnboarding`, nicht als Hintergrundjob. |
| Neustart            | Ausdrücklich über `start_arnold_onboarding`.                         |
| Logs                | Keine personenbezogenen Informationen, keine Session-Secrets.        |

### Wiederaufnahme

Unterstützt **innerhalb einer nachweislich zugeordneten Sitzung**: wer den
Nachweis besitzt, setzt fort. Belegt für Reload der App und für einen
Serverneustart mit Datei-Journal.

Eine Wiederzuordnung nach Schließen des Chats oder Gerätewechsel ist eine
**Abhängigkeit von Task 007**: ohne authentifizierte Nutzeridentität gibt es
nichts, woran eine Sitzung erneut gebunden werden könnte. `resume.cross_device`
ist daher ein literal `false` im Vertrag.

---

## 9. MCP-Onboarding-Tools

Datei: `src/server/mcp-onboarding.ts`. Alle Werkzeuge haben Zod-Input- und
Output-Schemas, `structuredContent`, MCP-Annotationen und verständliche
Beschreibungen.

| Tool                              | Funktion                                        | Schreibend     |
| --------------------------------- | ----------------------------------------------- | -------------- |
| `show_arnold_onboarding`          | Interaktives Onboarding öffnen (App-Resource).  | ja             |
| `start_arnold_onboarding`         | Einrichtung starten oder fortsetzen.            | ja             |
| `get_onboarding_state`            | Aktuellen Stand laden.                          | nein           |
| `update_onboarding_profile`       | Profildaten speichern/ändern, Schritt wechseln. | ja             |
| `get_onboarding_brief`            | Strukturierte Angaben für ChatGPT.              | nein           |
| `request_onboarding_plan`         | Planvorschlagsphase beginnen.                   | ja             |
| `submit_onboarding_plan_proposal` | KI-Planvorschlag validiert speichern.           | ja             |
| `get_onboarding_plan`             | Aktuellen Planentwurf laden.                    | nein           |
| `confirm_onboarding_plan`         | Validierten Plan bestätigen.                    | ja             |
| `revise_onboarding_plan`          | Bestätigten Plan zurück in die Bearbeitung.     | ja             |
| `get_onboarding_handoff`          | Bereitschaft für OAuth prüfen.                  | ja (repariert) |
| `cancel_onboarding`               | Einrichtung kontrolliert abbrechen.             | ja             |

### Rückgabewerte

Schreibende Tools antworten mit `OnboardingResponse`:

```typescript
{
  ok: boolean;
  operation: string;
  request_id: string;
  replayed: boolean;        // true, wenn die request_id bereits angewendet war
  state: OnboardingState | null;   // der tatsächlich gespeicherte Zustand
  session_token: string | null;    // nur beim Erzeugen der Sitzung
  error: { code; message; retryable; details } | null;
}
```

Erfolg wird erst gemeldet, wenn das Repository den Schreibvorgang bestätigt hat.
Eine Ablehnung liefert `ok: false`, den **unveränderten** Zustand und den Grund
— sie ist informativ, nicht destruktiv.

### Der Sitzungsnachweis in Tool-Ausgaben

`session_token` erscheint ausschließlich im `structuredContent` des Aufrufs, der
die Sitzung erzeugt. Er steht **nie** in einem Text-Block, weil dieser Text in
den Chatverlauf wandert. Die Zusammenfassungszeile nennt weder Sitzungs-ID noch
Nachweis.

### Bestehende Tools

`show_arnold_dashboard` und die Task-004/005-Werkzeuge bleiben unverändert
verfügbar. Das Onboarding ist eine **eigene** App-Resource
(`ui://arnold/onboarding-v1.html`); das Dashboard
(`ui://arnold/dashboard-v2.html`) bleibt davon unberührt. Ein Deployment ohne
`OnboardingService` veröffentlicht kein einziges Onboarding-Tool.

---

## 10. KI-Planvorschlagsprozess

### Architekturentscheidung

Für Task 006 ist **ChatGPT die Planvorschlags-Engine**. Es ist kein zusätzlicher
OpenAI-API-Key nötig, und der MCP-Server ruft von sich aus **kein** weiteres
Sprachmodell auf.

### Ablauf

1. Profil wird validiert (`PROFILE_INCOMPLETE`, falls unvollständig).
2. `request_onboarding_plan` öffnet die Phase.
3. `get_onboarding_brief` liefert den strukturierten Onboarding-Brief.
4. ChatGPT erstellt daraus einen Planvorschlag.
5. `submit_onboarding_plan_proposal` übergibt ihn.
6. Der Backend-Service validiert fachlich (§5) **und** strukturell über
   `TrainingPlanService.createTrainingPlan` mit `origin: "ai_proposal"`.
7. Der Plan wird als bearbeitbarer **Draft** bereitgestellt.
8. Die UI zeigt ihn im eingebetteten Planeditor.
9. Erst nach ausdrücklicher Bestätigung geht es weiter.

### Der Brief

`OnboardingBrief` enthält Ziel, Erfahrung, Verfügbarkeit, Umgebung,
Ausgangssituation, Vorlieben, den verwendbaren Übungskatalog mit gültigen
`exercise_id`-Werten, ein Zeitbudget in Übungen pro Einheit, sowie zwei Listen,
die den Unterschied zwischen plausiblem und erfundenem Plan machen:

- `constraints` — harte Randbedingungen (genaue Anzahl Trainingstage,
  Übungsbudget, gültige Satz-/Wiederholungsbereiche, nur Katalog-IDs, Umgebung,
  ausschließlich Krafttraining, gemiedene und bevorzugte Übungen).
- `must_not_invent` — keine Trainingsgewichte erfinden, keine Übungs-IDs
  erfinden, keine Leistungswerte behaupten, keine medizinischen Aussagen, keine
  Wirksamkeitsversprechen, den Plan nicht als gespeichert oder aktiviert
  darstellen, bevor der Nutzer bestätigt hat.

Freitext des Nutzers steht getrennt in `user_statements` und ist ausdrücklich
Nutzerangabe, keine Anweisung.

### Technische Anforderungen

- Der Vorschlag verwendet das Domain-Modell aus Task 005
  (`TrainingSessionInput`).
- `exercise_id`-Werte werden gegen den Katalog validiert; erfundene IDs werden
  mit `PLAN_PROPOSAL_INVALID` abgelehnt.
- Trainingshäufigkeit und verfügbare Zeit gehen in den Brief ein; eine
  Abweichung der Tageszahl ist ein **Hinweis**, kein Fehler (der Nutzer kann sie
  im Editor anpassen — ein harter Abbruch würde einen Plan ablehnen, den er
  vielleicht will).
- Satzanzahlen und Wiederholungsbereiche prüft der Planservice.
- Kein automatisch aktivierter Plan: es gibt keinen Codepfad vom Onboarding zur
  Aktivierung.
- Keine Google-Sheets-Schreiboperationen.

### Unbekannte Startgewichte

Hat der Nutzer kein Gewicht genannt, bleibt `target_load_kg` leer. Es werden
keine angeblich bekannten Leistungswerte erfunden. Die Oberfläche sagt das
ausdrücklich: „Zielgewichte, die du nicht genannt hast, bleiben leer."

### Host-Grenzen und ehrliche Übergabe

Die installierte MCP-Apps-Version bietet der UI keine unterstützte Möglichkeit,
eine Modellgenerierung anzustoßen: `@modelcontextprotocol/ext-apps` stellt
`callServerTool` bereit — also Serverwerkzeuge —, aber keine Sampling- oder
Prompt-Schnittstelle zum Host-Modell.

Deshalb implementiert Task 006 einen **ehrlichen Übergabezustand**: der Schritt
`plan_proposal` erklärt, was im Chat zu sagen ist, und bietet als einzige Aktion
ein echtes „Nach dem Vorschlag suchen" (ein Reload). Es gibt **keinen** Button,
der eine nicht vorhandene KI-Generierung vortäuscht, und keine eigene
inoffizielle ChatGPT-Bridge. Ein Test prüft, dass kein solches Steuerelement
existiert.

---

## 11. Bestehenden Trainingsplan übernehmen

Ein gleichwertiger zweiter Weg (`starting_point: "existing_plan"`):

1. Der Nutzer wählt „Ich habe schon einen Plan".
2. Er beschreibt seine Trainingstage im Chat.
3. Er kann Übungen, Sätze und Wiederholungen angeben.
4. ChatGPT strukturiert die Angaben (`origin: "existing_routine"`).
5. Das Backend validiert den Plan wie jeden anderen Vorschlag.
6. Der Planeditor zeigt die übernommene Struktur.
7. Der Nutzer korrigiert.
8. Anschließend bestätigt er.

Der Brief erhält in diesem Fall die Randbedingung, die bestehende Routine zu
übernehmen und nur fehlende Angaben zu ergänzen — die Struktur des Nutzers wird
nicht ohne Not ersetzt.

Eine bestehende Routine ist nicht automatisch vollständig: fehlende Angaben
werden als offen gekennzeichnet (`EXISTING_ROUTINE_INCOMPLETE`). Was für die
Aktivierung erforderlich ist, muss vor der Bestätigung ergänzt werden.

**Nicht** implementiert: automatische Extraktion aus PDF-Dateien oder Fotos.
Strukturierte Chat-Eingaben und bestehende Planobjekte genügen.

---

## 12. Integration des TrainingPlanService

Der Planeditor aus Task 005 wird **unverändert** wiederverwendet:
`TrainingPlanEditorView` wird mit `embedded` gemountet.

Der Nutzer kann im Onboarding: Trainingstage ansehen, hinzufügen, entfernen,
umbenennen, umsortieren und duplizieren; Übungen hinzufügen, austauschen,
entfernen und umsortieren; Sätze, Wiederholungsbereiche, Zielgewichte, Pausen,
Notizen und Ausführungen bearbeiten; den Plan prüfen.

### Architekturregeln

- Die tatsächliche Planbearbeitung bleibt im `TrainingPlanService`. Jede
  Änderung ist ein typisierter Edit an `update_plan_draft`.
- Der Onboarding-Service entwickelt **keine** eigene Planversionierung. Er
  speichert eine Referenz (`plan_version_id`, `row_revision`), nie eine Kopie
  der Planstruktur — eine zweite Kopie wäre eine zweite Wahrheit.
- Die Onboarding-State-Machine steuert nur, **wann** der Editor verfügbar ist
  und wann ein bestätigter Plan weitergehen darf.

### `embedded`

`embedded` passt den Editor an einen tragenden Prozess an: es unterdrückt die
Versionshistorie (auf einem Erstlauf gibt es nichts zu zeigen) **und** die
Lifecycle-Steuerelemente „Bestätigen und aktivieren" sowie „Entwurf verwerfen".
Der Grund ist fachlich: im Onboarding besitzt die Einrichtung den Lebenszyklus.
Eine Aktivierung aus dem Editor würde den Entwurf unveränderbar machen und das
Onboarding in eine Sackgasse führen; ein Verwerfen würde die Version entfernen,
auf die die Einrichtung noch verweist. Das **Bearbeiten** ist in beiden Modi
identisch.

### Nach Änderungen

Jede Änderung erhöht `row_revision` des Entwurfs. Eine ältere Bestätigung ist
danach nicht mehr gültig — auch dann, wenn die Änderung aus dem Editor oder aus
dem Chat kam, ohne dass das Onboarding davon erfuhr: `get_onboarding_handoff`
vergleicht bei jedem Lesen und setzt die Einrichtung bei Abweichung zurück nach
`REVIEWING_PLAN`.

---

## 13. Planvorschau und Bestätigung

### Angezeigt werden

Planname, Trainingsziel, Trainingstage pro Woche, Namen der Einheiten, Übungen
pro Einheit, Satzanzahlen, Wiederholungsbereiche, geplante Ausführungen,
optionale Zielgewichte und Hinweise bei offenen Angaben.

### Nutzeraktionen

„Plan bearbeiten" (der eingebettete Editor), „Zurück zu meinen Angaben",
„Plan bestätigen".

### Bestätigungsregeln

1. Der Plan ist vollständig validiert (`validation.valid`).
2. Ein Plan-Draft existiert und wird von der Sitzung referenziert.
3. Die Planrevision stimmt — geprüft gegen den Stand **jetzt**, nicht gegen den
   Stand der Prüfung.
4. Der Nutzer bestätigt ausdrücklich (`confirmed: true` in einem Dialog).
5. Die Bestätigung bezieht sich auf genau diese Planversion und Revision.
6. Sie wird nachvollziehbar gespeichert (`OnboardingPlanConfirmation` +
   Audit-Event `ONBOARDING_PLAN_CONFIRMED`).
7. Änderungen danach machen sie ungültig — am Plan **oder** am Profil.

Eine erfolgreiche Validierung ist **keine** Bestätigung. Eine veraltete
Bestätigung wird mit `STALE_CONFIRMATION` abgewiesen.

Die Bestätigung ist zusätzlich an die **Profilrevision** gebunden: der Plan wurde
für bestimmte Angaben freigegeben. Ändert der Nutzer danach eine Angabe, ist die
Freigabe überholt, auch wenn keine Planzeile bewegt wurde.

### Was die Bestätigung bedeutet

**„Dieser Plan ist vom Nutzer zur Einrichtung freigegeben."**

Sie bedeutet **nicht**: „Der Plan wurde in einer persönlichen Google-Sheets-Datei
aktiviert." Die tatsächliche Übernahme in den Nutzertracker erfolgt erst im
Provisioning aus Task 007. Dialog und Handoff-Screen sagen das ausdrücklich.

Auf eine erfolgreiche Bestätigung folgen zwei echte Maschinenübergänge in einem
Vorgang: `CONFIRM_PLAN` → `PLAN_CONFIRMED` und `PREPARE_HANDOFF` →
`AWAITING_GOOGLE_CONNECTION`. Die Freigabe ist die letzte Nutzeraktion dieser
Phase; ein zweiter Button, der sie nur wiederholt, wäre eine Scheininteraktion.

---

## 14. OAuth-Handoff-Vertrag

### UI-Zustand

**„Dein Trainingsplan ist bereit."** Darunter: „Im nächsten Schritt verbinden
wir dein Google-Konto, damit Arnold deine persönliche Trainingsdatei erstellen
und deine Fortschritte speichern kann."

Der Button „Google-Konto verbinden" ist **deaktiviert** und als nächster
Entwicklungsschritt gekennzeichnet. Der Screen sagt ausdrücklich: es wurde kein
Google-Konto verbunden, keine Datei angelegt und kein Plan in einer
Trainingsdatei aktiviert.

### Handoff-Objekt

```typescript
interface OnboardingHandoff {
  onboarding_session_id: string;
  status:
    "not_ready" | "ready_for_google_connection" | "superseded" | "completed"; // nie von Task 006 gesetzt
  confirmed_plan_version_id: string | null;
  confirmed_plan_revision: number | null;
  profile_revision: number | null;
  confirmation_timestamp: string | null;
  current_plan_revision: number | null; // der Stand jetzt
  oauth_state_binding: string | null;
  blocked_reason: string | null;
  google_connection_pending: true; // in Task 006 immer
}
```

Es enthält ausschließlich validierte Referenzen: keinen Sitzungsnachweis, keine
Profilinhalte, keine personenbezogenen Daten. Es ist damit vollständig
protokollierbar — ein Test prüft das.

### `oauth_state_binding`

Ein opaker SHA-256-Wert über Sitzungs-ID, bestätigte Revision und
Token-Fingerprint. Er ist stabil für einen bestätigten Plan, ändert sich mit der
Revision und lässt sich nicht in den Sitzungsnachweis zurückrechnen.

Er ist eine **Bindung**, kein Berechtigungsnachweis: Task 007 muss die Sitzung
weiterhin selbst autorisieren. Task 006 implementiert bewusst keinen
OAuth-Ersatz um ihn herum.

### In Task 006 implementiert

Bestätigtes Handoff-Objekt; Zustand `AWAITING_GOOGLE_CONNECTION`; saubere
Anzeige des nächsten Schritts; technische Schnittstelle für das spätere
Provisioning; erneutes Laden und Validieren des bestätigten Planentwurfs;
Fehlerverhalten bei ungültigem oder abgelaufenem Handoff.

### Nicht implementiert

Google OAuth Consent Screen, Authorization Code Flow, Token-Austausch,
Speicherung von Refresh Tokens, Google-Drive-Dateikopien, Erstellung produktiver
persönlicher Tracker, automatische Aktivierung eines Plans im Google Sheet.

---

## 15. Sicherheit vor OAuth

### Der Sitzungsnachweis

Eine Einrichtung wird mit einem 256-Bit-Geheimnis erzeugt
(`randomBytes(32).toString("base64url")`). Der Client behält es; der Server
speichert nur den SHA-256. Drei Mechanismen schützen die anonyme Sitzung:

1. **Der Nachweis ist Pflicht.** Eine Sitzungs-ID allein ist keine Berechtigung.
   Wer nur eine ID rät, erhält nichts.
2. **Der Vergleich ist konstant-zeitig** (`timingSafeEqual`). Ein Timing-Orakel
   auf einen Sitzungs-Token ist ein realer Angriffsweg.
3. **Produktion schließt dicht.** `DenyOnboardingAccessControl` lehnt jeden
   Aufruf mit `AUTH_REQUIRED` ab, bis eine geprüfte Identität eingebunden ist.
   Ein Umschalten des Modus kann anonyme Sitzungen nicht versehentlich
   freilegen.

Eine unbekannte ID und ein falscher Nachweis werden gleich beantwortet: ob eine
ID existiert, ist selbst eine Information, die ein Aufrufer ohne Nachweis nicht
erhalten darf.

### Betriebsmodi

| Modus        | Verhalten                                                                    |
| ------------ | ---------------------------------------------------------------------------- |
| `fixture`    | Synthetische Profile, ein fester synthetischer Subject, isolierte Sitzungen. |
| `production` | Jeder Aufruf `AUTH_REQUIRED`, bis Task 007 eine Identität liefert.           |

Zwei vom Fixture-Guard erzeugte Sitzungen können einander trotz gemeinsamen
Subjects **nicht** lesen, weil der Nachweis je Sitzung unterschiedlich ist.

### Verbindliche Sicherheitsregeln

- Keine ungeschützte globale Onboarding-Session.
- Keine beliebige Session-ID als Berechtigungsnachweis.
- Keine produktive Aktivierung ohne verifizierte Identität.
- Keine OAuth-Tokens gespeichert.
- Keine echten Google-Dateien beschrieben.
- Keine Gesundheitsdiagnosen erfasst.
- Keine Session-Secrets protokolliert.
- Keine Nutzerantworten als Systemanweisungen ausgeführt.
- Keine unvalidierten Planstrukturen aktiviert.
- Keine Bestätigung ohne konkreten Planversionsbezug.
- Keine automatische Aktivierung durch einen Modellvorschlag.

### Datenschutz und Aufbewahrung

Onboarding-Daten liegen ausschließlich im Backend-Repository, nie in den sechs
Arnold-Tabellen. Audit-Events tragen Feldnamen und Enum-/Zahlenwerte, aber
keinen Freitext: eine Profiländerung wird als „preferences geändert" mit der
Anzahl der Schlüssel festgehalten, nicht mit dem Inhalt.

Aufbewahrung: 24 Stunden Gültigkeit, 7 Tage Nachlauf, dann einsammelbar.
`purge` läuft bei jedem Start einer neuen Einrichtung. Verwaiste Entwürfe
werden damit nicht unbegrenzt gespeichert.

---

## 16. UI-Komponenten

Datei: `src/ui/components/onboarding.tsx`, `src/ui/views/OnboardingView.tsx`,
`src/ui/hooks/useOnboarding.ts`.

| Komponente                    | Aufgabe                                               |
| ----------------------------- | ----------------------------------------------------- |
| `OnboardingLayout`            | Kartenrahmen, Kopf, Zurück-Steuerung, Fußzeile.       |
| `OnboardingProgressBar`       | Fortschritt + Schrittliste, als `role="progressbar"`. |
| `WelcomeStep`                 | Einstieg; nennt ausdrücklich, was noch nicht geht.    |
| `GoalStep`                    | Trainingsziel + Erfahrung.                            |
| `AvailabilityStep`            | Tage + Dauer + Umgebung.                              |
| `PreferencesStep`             | Ausgangssituation + optionale Angaben + Freitext.     |
| `ProfileSummaryStep`          | Zusammenfassung, jede Zeile änderbar.                 |
| `PlanGenerationStep`          | Ehrliche Übergabe an den Chat.                        |
| `PlanConfirmationDialog`      | Freigabe genau einer Revision, modal.                 |
| `GoogleConnectionHandoffStep` | „Dein Trainingsplan ist bereit."                      |
| `OnboardingErrorState`        | Fehler mit Wiederholung und Neustart.                 |
| `OnboardingResumeState`       | Abgelaufen / abgebrochen, kontrollierter Neustart.    |
| `OnboardingIssues`            | Hinweise und Empfehlungen je Schritt.                 |
| `ChoiceGroup`                 | Auswahlkarten als echte Radiogruppe.                  |
| `CancelOnboardingButton`      | Abbruch mit kurzer Rückfrage.                         |

### Gestaltung

Modern und aufgeräumt auf denselben Design-Tokens wie das Dashboard;
einspaltig, maximal 720 px, damit es im ChatGPT-App-Panel funktioniert;
reagiert auf helle und dunkle Host-Themes über `data-theme` und die geteilten
CSS-Variablen; große Interaktionsflächen (mindestens 48 px hohe Auswahlkarten);
kurze Erklärungen; Fortschritt sichtbar; Fehler am Schritt; keine technischen
IDs in der Oberfläche.

### Zugänglichkeit

Jede Pflichtangabe ist ein `<fieldset>` mit `<legend>` und echten
Radio-Inputs. Die Inputs sind transparent, aber **vollflächig** — bewusst nicht
der 1-px-Trick: ein Control ohne Fläche ist unzuverlässig aktivierbar. So
funktionieren Mausklick, `Space` und die Pfeiltasten nativ.

Der sichtbare Text ist auch der Accessible Name (`aria-label` auf dem Input),
damit ein Screenreader „Muskelaufbau" liest und nicht `muscle_gain`. Hinweise
hängen über `aria-describedby` am Input. Fehler sind `role="alert"` und über
`aria-describedby` mit ihrer Gruppe verbunden. Der Accessible Name der
Zurück-Steuerung enthält ihren sichtbaren Text (WCAG 2.5.3).

### Keine Scheininteraktionen

Jeder Button löst eine funktionierende Aktion aus. Was noch nicht verfügbar ist
— die Google-Verbindung — ist deaktiviert und als nächster Entwicklungsschritt
gekennzeichnet.

### Schreibvorgänge der UI

Alle Schreibvorgänge laufen über eine Warteschlange. Zwei schnell
aufeinanderfolgende Antworten würden sonst dieselbe Revision beanspruchen, und
die zweite — die Antwort, die der Nutzer gerade gegeben hat — würde mit
`REVISION_CONFLICT` verworfen. Das Speichern einer Antwort verschiebt außerdem
nie den Schritt auf dem Bildschirm; `current_step` dient der Wiederaufnahme.

---

## 17. Fehler- und Leerzustände

Alle Fehler besitzen einen maschinenlesbaren Code, ermöglichen eine
verständliche Nutzererklärung, erhalten den bisherigen gültigen Zustand,
verursachen keinen fachlich ungültigen Übergang und täuschen keine erfolgreiche
Einrichtung vor.

### Onboarding

| Situation                           | Verhalten                                                       |
| ----------------------------------- | --------------------------------------------------------------- |
| Nutzer bricht ab                    | `CANCELLED`; Entwurf bleibt lesbar, nichts gelöscht.            |
| Nutzer startet erneut               | Neue Sitzung; `purge` räumt Altlasten.                          |
| Pflichtinformationen fehlen         | `PROFILE_INCOMPLETE`, Felder einzeln benannt.                   |
| Angaben nach Planvorschlag geändert | Zurück nach `REVIEWING_PLAN`, Handoff `superseded`.             |
| Nach Bestätigung erneut bearbeiten  | `REVISE_PLAN`; Bestätigung ungültig.                            |
| Abgelaufene Sitzung                 | `SESSION_EXPIRED`; Wiederherstellungszustand mit Neustart.      |
| Verbindungsverlust                  | Zustand wird neu gelesen; nichts wird als gespeichert gemeldet. |
| Veralteter UI-Zustand               | `REVISION_CONFLICT`; gespeicherter Stand wird angezeigt.        |

### Planvorschlag

| Situation                         | Code                                                      |
| --------------------------------- | --------------------------------------------------------- |
| Ungültige Exercise-ID             | `PLAN_PROPOSAL_INVALID`                                   |
| Plan ohne Übungen / leere Einheit | `PLAN_PROPOSAL_INVALID`                                   |
| Ungültiger Wiederholungsbereich   | `PLAN_PROPOSAL_INVALID`                                   |
| Tageszahl passt nicht zum Wunsch  | Hinweis `PROPOSAL_DAYS_MISMATCH`                          |
| Nicht verfügbare Geräte           | Randbedingung im Brief; Hinweis                           |
| Vorschlag nicht speicherbar       | `PLAN_WRITE_UNAVAILABLE` / Fehler des Planservice         |
| Modellinteraktion unterbrochen    | Zustand bleibt `WAITING_FOR_PLAN_PROPOSAL`; Reload-Aktion |
| Vorschlag zweimal eingereicht     | `replayed: true`, kein zweiter Entwurf                    |

### Planeditor

Parallele Änderungen, veraltete Revision, ungültige Eingaben und fehlgeschlagene
Planvalidierung behandelt der `TrainingPlanService` aus Task 005 unverändert
(`REVISION_CONFLICT`, `PLAN_INVALID`, `VALIDATION_ERROR`). Schließt der Nutzer
die UI während des Speicherns, bleibt die `request_id` erhalten und ein erneuter
Aufruf gleicht ab statt zu wiederholen.

### Übergabe

| Situation                          | Verhalten                                                                   |
| ---------------------------------- | --------------------------------------------------------------------------- |
| Plan nicht bestätigt               | `status: "not_ready"` mit Begründung.                                       |
| Handoff verweist auf alte Revision | `status: "superseded"`, Revisionen benannt, Rückkehr nach `REVIEWING_PLAN`. |
| Session abgelaufen                 | `SESSION_EXPIRED`.                                                          |
| OAuth noch nicht implementiert     | Button deaktiviert, `google_connection_pending: true`.                      |
| Direktversuch auf `COMPLETED`      | `OAUTH_NOT_IMPLEMENTED`.                                                    |

### Leerzustände

Das Dashboard aus Task 003 bleibt unverändert und enthält bewusst **keinen**
Onboarding-Button; das Onboarding ist eine eigene App-Resource. Ein Browsertest
prüft beides.

---

## 18. Integrationsanforderungen für Task 007

1. **Identität.** `OnboardingAccessControl` durch einen Guard ersetzen, der
   einen verifizierten Google-Subject auflöst (`kind: "authenticated"`).
   `DenyOnboardingAccessControl` ist die heutige, absichtlich dichte Variante.
2. **OAuth-`state`-Bindung.** `oauth_state_binding` beim Start des Flows
   mitführen und im Callback gegen die Sitzung prüfen. Der Wert allein ist kein
   Berechtigungsnachweis; die Sitzung ist weiterhin zu autorisieren.
3. **Provisioning.** Nach erfolgreicher Erstellung der persönlichen Datei das
   Ereignis `GOOGLE_CONNECTED` mit `provisioning_verified: true` auslösen. Nur
   dann erreicht die Einrichtung `COMPLETED`.
4. **Planaktivierung.** Erst im Provisioning, über
   `TrainingPlanService.activateTrainingPlan` mit einer Bestätigung, die exakt
   `confirmed_plan_version_id` und `confirmed_plan_revision` nennt. Der Handoff
   ist nur bei `status === "ready_for_google_connection"` handlungsfähig.
5. **Persistenz.** `FileOnboardingRepository` gegen ein verteiltes Backend
   tauschen (`durability: "distributed"`), damit Mehrinstanzbetrieb und
   Cross-Device-Wiederaufnahme möglich werden. `resume.cross_device` ist erst
   dann wahrheitsfähig.
6. **Sheets-Schreibpfad.** `PLANS` und `PLAN_ITEMS` in den Google-Schreibadapter
   aufnehmen und `test_sheet` im Planservice zulassen (siehe Task-005-Vertrag).

---

## 19. Testfälle

| Datei                                    | Umfang                                                                                                                                                                                                                                                                                                                                                                  |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tests/onboarding-state-machine.test.ts` | 41 Tests: jeder Übergang, jede Ablehnung, Rückwärtsbewegung, Ablauf, Abbruch, Idempotenz, Unerreichbarkeit von `COMPLETED`, Konsistenz von `allowedEvents`.                                                                                                                                                                                                             |
| `tests/onboarding-profile.test.ts`       | 37 Tests: Vollständigkeit, alle Enum-Werte, Grenzwerte, Startgewichte, bestehende Routine, Fortschritt, Zeitbudget, Brief, Vorschlagsabgleich.                                                                                                                                                                                                                          |
| `tests/onboarding-service.test.ts`       | 57 Tests: Start, Patch-Semantik, Revisionskonflikt, Idempotenz, Vorschlag, Bestätigung, Ungültigwerden, Handoff, Abbruch, Ablauf, Wiederaufnahme, Produktionsmodus, keine Google-Schreibzugriffe, Audit.                                                                                                                                                                |
| `tests/onboarding-security.test.ts`      | 32 Tests: Token-Erzeugung und -Vergleich, Guards, Isolation zweier Sitzungen, unberechtigte Abfrage, Repository-Regeln, Session-Fixation, Nebenläufigkeit, Aufbewahrung, Dateijournal, Neustart, OAuth-Bindung.                                                                                                                                                         |
| `tests/onboarding-mcp.test.ts`           | 34 Tests: Tool-Discovery, Beschreibungen, Annotationen, Resources, Zod-Validierung, strukturierte Fehler, Gesprächsfluss, geteilter Zustand mit dem Planeditor, Bestätigung, Handoff, Idempotenz, unveränderte Bestandstools.                                                                                                                                           |
| `tests/onboarding-ui-render.test.tsx`    | 33 Tests: Komponenten gegen echte Serverausgaben, keine Enum-Werte, keine IDs, Fortschritt, Zusammenfassung, ehrliche Übergabe, Bestätigungsdialog, Handoff, Fehler- und Wiederaufnahmezustände, keine Scheinmeldungen.                                                                                                                                                 |
| `tests/e2e/onboarding.spec.ts`           | 17 Browsertests: vollständiger Durchlauf bis zum Handoff, Bearbeiten und Neubinden der Bestätigung, bestehende Routine, Rückwärtsnavigation, Feldfehler, Zusammenfassungssprünge, Wiederaufnahme, fehlender Nachweis, Ablauf, abgelehnter Schreibvorgang, keine Scheinmeldungen, Mobile, helles und dunkles Theme, Tastaturbedienung, WCAG A/AA, unberührtes Dashboard. |

### Testdaten

Ausschließlich synthetische Profile und Trainingspläne auf isolierten
In-Memory-Trackern. Keine realen Trainingsdaten, kein Google-Zugriff, kein
Google-Token.

---

## 20. Bekannte Grenzen

1. **Keine Cross-Device-Wiederaufnahme.** Ohne authentifizierte Identität gibt
   es nichts, woran eine Sitzung erneut gebunden werden könnte.
   `resume.cross_device` ist literal `false`. Abhängigkeit: Task 007.
2. **Keine Modellinteraktion aus der UI.** Die installierte MCP-Apps-Version
   bietet dafür keine unterstützte Schnittstelle. Der Planvorschlag entsteht im
   Chat; die UI führt ehrlich dorthin.
3. **Kein produktiver Betrieb.** `production` lehnt jeden Aufruf ab. Schreibende
   Planoperationen laufen ausschließlich im Fixture-Modus (Grenze aus Task 005).
4. **Journal nicht verteilt.** `FileOnboardingRepository` ist ein lokales
   Journal für einen Prozess, kein verteilter Speicher.
5. **Keine Dokument-Extraktion.** Bestehende Pläne werden aus strukturierten
   Chat-Eingaben übernommen, nicht aus PDFs oder Fotos.
6. **Kein Cardio, keine Ernährung, keine Gesundheitsprofile.** Bewusst außerhalb
   des Umfangs; es existieren keine Felder dafür.
7. **`COMPLETED` ist unerreichbar.** Der Status existiert im Vertrag für Task
   007 und wird in Task 006 nie gemeldet.
