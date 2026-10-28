# Arnold – Trainingsplan-Vertrag

**Vertrag:** `arnold.plan/1`
**Datenschema:** `arnold.training_raw`, Version `1.0.0`
**Stand:** Task 005 – Trainingsplanverwaltung, Versionierung und visueller Planeditor
**Betriebsmodus:** schreibende Planoperationen ausschließlich im Fixture-Modus

Dieses Dokument ist der verbindliche Vertrag für alle Planoperationen in Arnold.
Es beschreibt, was gespeichert werden kann, was ausdrücklich **nicht** gespeichert
werden kann, und welche Zusagen die Anwendung einhält.

---

## Inhalt

1. [Fachliches Domain-Modell](#1-fachliches-domain-modell)
2. [Planfamilien und Planversionen](#2-planfamilien-und-planversionen)
3. [Lebenszyklus der Pläne](#3-lebenszyklus-der-pläne)
4. [Unveränderlichkeit aktiver Versionen](#4-unveränderlichkeit-aktiver-versionen)
5. [Session-ID-Strategie](#5-session-id-strategie)
6. [Planposition-ID-Strategie](#6-planposition-id-strategie)
7. [Erstellung neuer Pläne](#7-erstellung-neuer-pläne)
8. [Erstellung neuer Versionen](#8-erstellung-neuer-versionen)
9. [Bearbeitungsoperationen](#9-bearbeitungsoperationen)
10. [Planvalidierung](#10-planvalidierung)
11. [Planaktivierung](#11-planaktivierung)
12. [Historische Trainingsplanverwaltung](#12-historische-trainingsplanverwaltung)
13. [Workout-Referenzen](#13-workout-referenzen)
14. [MCP-Tools](#14-mcp-tools)
15. [Input- und Output-Schemas](#15-input--und-output-schemas)
16. [Idempotenz](#16-idempotenz)
17. [Nebenläufigkeit](#17-nebenläufigkeit)
18. [Audit-Ereignisse](#18-audit-ereignisse)
19. [Sicherheitsregeln](#19-sicherheitsregeln)
20. [Planeditor-Komponenten](#20-planeditor-komponenten)
21. [UI-Zustände](#21-ui-zustände)
22. [Integration mit Task 004](#22-integration-mit-task-004)
23. [Vorbereitung für Task 006](#23-vorbereitung-für-task-006)
24. [Grenzen des Google-Sheets-Schemas](#24-grenzen-des-google-sheets-schemas)
25. [Bekannte technische Risiken](#25-bekannte-technische-risiken)

---

## 1. Fachliches Domain-Modell

Die Domain-Objekte sind eine **Projektion** der sechs bestehenden Arnold-Tabellen,
keine zweite Datenhaltung. Es gibt kein konkurrierendes Planmodell.

| Objekt                  | Bedeutung                                                            | Abbildung im Schema                              |
| ----------------------- | -------------------------------------------------------------------- | ------------------------------------------------ |
| `TrainingPlan`          | Die logische Planfamilie – „mein Push/Pull/Legs" über alle Versionen | Gruppierung von `PLANS` über `plan_family_id`    |
| `TrainingPlanVersion`   | Ein konkreter Stand eines Plans                                      | eine Zeile in `PLANS`                            |
| `TrainingSession`       | Ein geplanter Trainingstag beziehungsweise Einheitentyp              | Menge der `PLAN_ITEMS` mit gleicher `session_id` |
| `PlannedExercise`       | Eine Übung innerhalb einer Einheit                                   | eine Zeile in `PLAN_ITEMS`                       |
| `PlanDraft`             | Eine bearbeitbare Planversion samt Herkunft                          | `PLANS`-Zeile mit `status = draft`               |
| `PlanChange`            | Eine nachvollziehbare Einzeländerung zwischen zwei Planständen       | abgeleitet, nicht gespeichert                    |
| `PlanValidationResult`  | Strukturiertes Prüfergebnis                                          | abgeleitet, nicht gespeichert                    |
| `PlanVersionComparison` | Unterschied zwischen zwei Versionen                                  | abgeleitet, nicht gespeichert                    |
| `PlanActivationResult`  | Bestätigtes Ergebnis einer Aktivierung                               | abgeleitet aus zwei `PLANS`-Zeilen               |

**Zentrale Eigenheit:** Eine `TrainingSession` ist _keine eigene Zeile_. Sie
existiert ausschließlich über ihre Planpositionen. `session_name` und
`session_order` liegen auf **jeder** Planposition der Einheit und müssen
übereinstimmen – der Datenvertrag erzwingt das. Daraus folgt unmittelbar die
wichtigste Schemagrenze: eine Trainingseinheit ohne Übung ist nicht speicherbar
(siehe [§24](#24-grenzen-des-google-sheets-schemas)).

### Freiheit der Trainingsstruktur

Es gibt **keine** feste Split-Logik. Verbindlich zugesagt und durch Tests belegt:

- `split_key` ist freier Text und optional; kein Codepfad verzweigt darauf.
- `session_name` ist freier Text (bis 120 Zeichen); kein Codepfad verzweigt darauf.
- Die Anzahl der Trainingseinheiten ist nicht begrenzt (Schema-Obergrenze 30 pro
  Entwurfsoperation), die Anzahl der Übungen pro Einheit ebenso (Obergrenze 60).
- Ein Plan mit **einer** wiederkehrenden Einheit ist genauso gültig wie einer mit
  fünf; `days_per_week` und die Anzahl der Einheiten dürfen abweichen (rotierende
  Pläne) und erzeugen höchstens eine Empfehlung.
- Keine Funktion hängt von einem Übungsnamen ab. Identität ist immer
  `exercise_id`; Namen sind reine Anzeige.

---

## 2. Planfamilien und Planversionen

```text
TrainingPlan (plan_family_id = PF_001)
├── TrainingPlanVersion  version_no 1   status archived
├── TrainingPlanVersion  version_no 2   status active
└── TrainingPlanVersion  version_no 3   status draft
```

- Eine **Planfamilie** ist dieselbe Routine über die Zeit. Sie hat keine eigene
  Zeile; ihr Name ist der Name ihrer neuesten Version.
- Eine **Planversion** ist ein konkreter Stand. `version_no` ist innerhalb der
  Familie eindeutig (durch den Datenvertrag erzwungen und zusätzlich vor jedem
  Schreibvorgang geprüft, Fehlercode `VERSION_NUMBER_CONFLICT`).
- Eine Änderung an derselben Routine behält die `plan_family_id`.
- Ein eigenständiger neuer Plan erhält eine **neue** `plan_family_id` und beginnt
  bei `version_no = 1`.

---

## 3. Lebenszyklus der Pläne

```text
          create_training_plan / create_plan_version
                          │
                          ▼
                      ┌───────┐
                      │ draft │
                      └───┬───┘
            activate_…    │    archive_plan_draft
              ┌───────────┴───────────┐
              ▼                       ▼
         ┌────────┐              ┌──────────┐
         │ active │─────────────▶│ archived │
         └────────┘  Aktivierung └──────────┘
                     einer neuen      │
                     Version          ▼
                                   (Endzustand)
```

Genau drei Übergänge existieren:

| Von      | Nach       | Ausgelöst durch                                      |
| -------- | ---------- | ---------------------------------------------------- |
| `draft`  | `active`   | `activate_training_plan` mit gültiger Bestätigung    |
| `active` | `archived` | Aktivierung einer Nachfolgeversion (im selben Batch) |
| `draft`  | `archived` | `archive_plan_draft` (Entwurf verwerfen)             |

**Kein Übergang führt zurück nach `draft`.** Eine aktive oder archivierte Version
ist ein historischer Datensatz. „Wieder nach dem alten Plan trainieren" bedeutet:
eine **neue** Draft-Version auf Grundlage der alten erzeugen.

Implementiert in `src/server/plan/domain.ts` (`PLAN_TRANSITIONS`, `canTransition`).

### Entscheidungsregel V1

Je Tracker darf **maximal eine** Planversion `active` sein. Beliebig viele
`archived`-Versionen und beliebig viele `draft`-Versionen sind erlaubt. Die
Einschränkung wird an drei Stellen gehalten:

1. `ArnoldDatasetSchema` lehnt einen Datensatz mit zwei aktiven Plänen ab.
2. Die Aktivierung archiviert die bisherige Version im **selben** atomaren Batch.
3. `validate_training_plan` meldet eine nicht-Draft-Version als nicht aktivierbar.

---

## 4. Unveränderlichkeit aktiver Versionen

Sobald eine Version aktiviert wurde, ist ihr **Inhalt** endgültig. Das ist in
drei unabhängigen Schichten abgesichert (Defence in Depth):

| Schicht            | Datei                       | Regel                                                                                                           |
| ------------------ | --------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Service            | `plan/service.ts`           | `update_plan_draft` lehnt jede Version mit `status != draft` ab → `PLAN_NOT_EDITABLE`                           |
| Änderungsvalidator | `workout/infrastructure.ts` | eine `planItems`-Änderung an einer Version, die nicht Draft ist, wird abgelehnt → `PERMISSION_DENIED`           |
| Änderungsvalidator | `workout/infrastructure.ts` | an einer nicht-Draft-`PLANS`-Zeile dürfen `name`, `split_key`, `goal_key`, `days_per_week` nicht mehr abweichen |

Die zweite und dritte Regel greifen auch dann, wenn ein Aufrufer den Service
umgehen würde. Zwei Tests in `tests/plan-versioning.test.ts` rufen
`repository.apply(...)` direkt auf und belegen die Ablehnung.

Zusätzlich sind auf **jeder** Zeile stabile Spalten definiert, die eine
Änderung niemals verschieben darf:

| Tabelle      | Unveränderliche Spalten                                             |
| ------------ | ------------------------------------------------------------------- |
| `PLANS`      | `plan_version_id`, `plan_family_id`, `version_no`, `created_at_utc` |
| `PLAN_ITEMS` | `plan_item_id`, `plan_version_id`, `session_id`                     |

Eine Planposition wandert also nie in eine andere Version oder eine andere
Trainingseinheit. Das Verschieben einer Übung zwischen Einheiten ist eine neue
Zeile plus ein Tombstone, keine In-Place-Änderung.

---

## 5. Session-ID-Strategie

| Situation                                                      | `session_id`                              |
| -------------------------------------------------------------- | ----------------------------------------- |
| Neue Planfamilie (`create_training_plan`)                      | neu je Einheit                            |
| Neue Version derselben Familie (`create_plan_version`)         | **stabil** für fortgeführte Einheiten     |
| Neue Version als eigenständige Familie (`as_new_family: true`) | neu je Einheit                            |
| Einheit hinzugefügt (`add_session`)                            | neu                                       |
| Einheit dupliziert (`duplicate_session`)                       | neu                                       |
| Einheit umbenannt (`rename_session`)                           | unverändert                               |
| Einheit umsortiert (`reorder_sessions`)                        | unverändert                               |
| Einheit entfernt (`remove_session`)                            | unverändert, Positionen werden tombstoned |

Eine stabile `session_id` innerhalb der Familie ist das, was „mein Push-Tag"
über Versionen hinweg verbindet: Workouts und Analytics sprechen weiter über
denselben Trainingstag.

### Umbenennungen und Historie

Eine Umbenennung aktualisiert `session_name` auf **allen** Positionen der
Einheit im Entwurf – auch auf den Tombstones, weil der Datenvertrag
Übereinstimmung innerhalb der Einheit verlangt.

Historische Anzeigen bleiben davon unberührt: `WORKOUTS.session_name_snapshot`
hält den Namen, der zum Zeitpunkt des Trainings gültig war, und wird von keiner
Planoperation angefasst. Ebenso behalten frühere Planversionen ihren eigenen
Namen – eine Umbenennung in Version 3 ändert Version 2 nicht.

---

## 6. Planposition-ID-Strategie

| Situation                                 | `plan_item_id`                                 |
| ----------------------------------------- | ---------------------------------------------- |
| Neue Version (jede Art)                   | **neu für jede Position**, ohne Ausnahme       |
| Übung hinzugefügt                         | neu                                            |
| Übung durch eine **andere** Übung ersetzt | neu; die alte Position wird `status = removed` |
| Übung durch **dieselbe** Übung „ersetzt"  | unverändert – fachlich eine Zieländerung       |
| Zielwerte oder Ausführung geändert        | unverändert, `row_revision + 1`                |
| Reihenfolge geändert                      | unverändert, `exercise_order` neu              |
| Übung entfernt                            | unverändert, `status = removed`                |

**Nichts wird physisch gelöscht.** Entfernen heißt `status = removed`
(Tombstone, entsprechend `deleted_record_policy = TOMBSTONE`). Dadurch bleibt
jede historische `plan_item_id`-Referenz aus `SETS` auflösbar.

### Reihenfolge

`session_order` und `exercise_order` werden beim Speichern aus der
Anzeigereihenfolge neu durchnummeriert (1…n). Doppelte oder lückenhafte Werte
sind über die Bearbeitungsoperationen **nicht erreichbar**.

Ausnahme und bewusste Festlegung: Eine entfernte Einheit behält ihren letzten
`session_order`-Wert. Dieser Wert ist inert – entfernte Einheiten werden nicht
angezeigt, nicht validiert und nicht in die Eindeutigkeitsprüfung einbezogen.
Die Eindeutigkeit von `session_order` gilt also für die **aktiven** Einheiten
einer Version.

---

## 7. Erstellung neuer Pläne

Tool: `create_training_plan`

```json
{
  "request_id": "uuid",
  "name": "Push Pull Legs",
  "split_key": "ppl",
  "goal_key": "hypertrophy",
  "days_per_week": 3,
  "origin": "manual",
  "sessions": [
    {
      "session_name": "Push",
      "exercises": [
        {
          "exercise_id": "ex_bench",
          "target_sets": 3,
          "rep_min": 8,
          "rep_max": 10,
          "target_load_kg": 70,
          "target_load_basis": "total"
        }
      ]
    }
  ]
}
```

Regeln:

- Der Plan wird **immer** als `draft` erstellt. Es gibt keinen Pfad, der bei der
  Erstellung aktiviert.
- Ohne `plan_family_id` entsteht eine neue Planfamilie; mit `plan_family_id`
  wird eine bestehende Routine fortgeführt (nächste freie `version_no`).
- Jede Einheit braucht mindestens eine Übung (Schemagrenze, siehe §24).
- Einheitennamen müssen innerhalb des Plans eindeutig sein (normalisiert
  verglichen, damit „Push" und „push " kollidieren). Das hält die
  Session-Erkennung von Task 004 eindeutig.
- `exercise_id` muss im Katalog existieren → sonst `EXERCISE_NOT_FOUND`.
- `origin` dokumentiert die Herkunft (`manual`, `ai_proposal`, `imported`,
  `clone`). Ein `ai_proposal` erhält zusätzlich einen ausdrücklichen Hinweis,
  dass er erst nach Bestätigung aktiviert wird.

### Vorbelegung von Zielwerten

| Feld                                                                           | Quelle                                           |
| ------------------------------------------------------------------------------ | ------------------------------------------------ |
| `target_load_basis`                                                            | Katalog-Default der Übung, falls nicht angegeben |
| `target_execution_mode`                                                        | Katalog-Default der Übung, falls nicht angegeben |
| `target_implement_count`                                                       | Katalog-Default der Übung, falls nicht angegeben |
| `target_sets`, `rep_min`, `rep_max`, `target_load_kg`, `rest_seconds`, `notes` | `null`, falls nicht angegeben                    |

Ausführung und Gewichtsdefinition sind **Eigenschaften der Bewegung** und
stammen deshalb aus dem Katalog. Sätze, Wiederholungen und Zielgewicht sind eine
Trainingsvorgabe – die erfindet der Server nicht. Der Editor füllt dafür
sichtbare, änderbare Vorschläge (3 Sätze, 8–12 Wiederholungen, 120 s) in das
Formular; gespeichert wird nur, was der Nutzer bestätigt hat.

---

## 8. Erstellung neuer Versionen

Tool: `create_plan_version` (identisch: `clone_plan_version`)

```json
{
  "request_id": "uuid",
  "source_plan_version_id": "PV_002",
  "as_new_family": false
}
```

Ablauf:

1. Quellversion lesen – **nur lesen**, in jedem Fall.
2. Neue `plan_version_id`; `version_no` = höchste Nummer der Familie + 1.
3. Alle aktiven Positionen der Quelle neu anlegen, mit **neuen**
   `plan_item_id`-Werten und unveränderten `exercise_id`-Referenzen.
4. `session_id` bleibt stabil (gleiche Familie) oder wird neu vergeben
   (`as_new_family: true`).
5. Status `draft`.

Die Quellversion ist danach **byteidentisch**. Mehrere Tests vergleichen dazu
den kanonischen Hash der Quellzeilen vor und nach der Operation.

`as_new_family: true` ist der Weg für „erstelle zusätzlich einen
Oberkörper/Unterkörper-Plan auf Basis meines aktuellen" – es entsteht eine
unabhängige Routine mit eigenen Session-IDs.

---

## 9. Bearbeitungsoperationen

Ein Entwurf wird über **ein** Tool geändert: `update_plan_draft`. Es nimmt eine
Liste typisierter Operationen und wendet sie als **eine** zusammengehörige
Änderung mit **einer** Revisionserhöhung an.

```json
{
  "request_id": "uuid",
  "plan_version_id": "PV_003",
  "expected_row_revision": 4,
  "edits": [
    {
      "type": "replace_plan_exercise",
      "plan_item_id": "item_001",
      "new_exercise_id": "ex_incline_db_press"
    },
    {
      "type": "add_session",
      "session_name": "Arme",
      "exercises": [{ "exercise_id": "ex_curl" }]
    }
  ]
}
```

### Operationen

| `type`                           | Wirkung                                                                            |
| -------------------------------- | ---------------------------------------------------------------------------------- |
| `update_plan_metadata`           | Name, Split, Ziel, Trainingstage pro Woche                                         |
| `add_session`                    | neue Einheit mit mindestens einer Übung, optional an fester Position               |
| `rename_session`                 | Name auf allen Positionen der Einheit                                              |
| `reorder_sessions`               | vollständige neue Reihenfolge aller aktiven Einheiten                              |
| `duplicate_session`              | neue Session-ID, neue Positions-IDs, gleiche Übungen und Ziele; Original unberührt |
| `remove_session`                 | alle Positionen der Einheit tombstonen                                             |
| `add_plan_exercise`              | Position anlegen, Katalog-Defaults übernehmen, optional an fester Position         |
| `replace_plan_exercise`          | andere Übung → neue Position-ID + Tombstone; gleiche Übung → Zieländerung          |
| `remove_plan_exercise`           | Position tombstonen                                                                |
| `reorder_plan_exercises`         | vollständige neue Reihenfolge innerhalb einer Einheit                              |
| `update_plan_exercise_targets`   | Sätze, Wiederholungsbereich, Zielgewicht, Gewichtsdefinition, Pause, Notiz         |
| `update_plan_exercise_execution` | Ausführung, Geräteanzahl, Gewichtsdefinition                                       |
| `replace_draft_sessions`         | vollständige Neugestaltung: alle Positionen tombstonen, Struktur neu aufbauen      |

### Warum typisierte Operationen

Ein ungeprüftes Überschreiben eines Tabellenbereichs macht einen Konflikt
unsichtbar und ein Audit-Ereignis bedeutungslos. `replace_draft_sessions`
existiert für eine echte Neugestaltung und läuft durch dieselben Prüfungen:
erwartete Revision, Referenzvalidierung, eine zusammenhängende Operation, kein
Überschreiben historischer Datensätze.

### Verhalten beim Austausch

Beim Austausch gegen eine **andere** Bewegungsvariante werden Sätze,
Wiederholungen und Pause übernommen, **Zielgewicht und Gewichtsdefinition
jedoch nicht**: „70 kg gesamt" ist nicht „70 kg pro Hantel". Die neue Position
startet mit der Gewichtsdefinition des neuen Katalogeintrags und ohne
Zielgewicht, sofern keines angegeben wird.

---

## 10. Planvalidierung

Tool: `validate_training_plan`. Das Ergebnis liegt zusätzlich **jeder**
schreibenden Antwort bei, damit die UI keinen zweiten Aufruf braucht.

### Drei Register

| Register          | Bedeutung                                                 | Blockiert Aktivierung |
| ----------------- | --------------------------------------------------------- | --------------------- |
| `errors`          | Die Daten wären falsch, mehrdeutig oder nicht darstellbar | **ja**                |
| `warnings`        | Ein echter Befund, der den Plan nicht falsch macht        | nein                  |
| `recommendations` | Trainingswissenschaftliche Hinweise                       | nein                  |

Eine niedrige oder hohe Anzahl von Trainingstagen ist **kein** technischer
Fehler. Trainingswissenschaftliche Empfehlungen sind ausdrücklich nicht Teil der
Speicherungsgarantie.

### Prüfungen

| Code                            | Register       | Prüfung                                                                             |
| ------------------------------- | -------------- | ----------------------------------------------------------------------------------- |
| `PLAN_VERSION_NOT_FOUND`        | error          | Existiert die Planversion?                                                          |
| `PLAN_NOT_A_DRAFT`              | error          | Ist die Version ein Entwurf?                                                        |
| `NO_SESSION`                    | error          | Mindestens eine Trainingseinheit?                                                   |
| `NO_ACTIVE_EXERCISE`            | error          | Mindestens eine aktive Übung im Plan?                                               |
| `EMPTY_SESSION`                 | error          | Enthält jede Einheit eine aktive Übung?                                             |
| `UNSUPPORTED_STRUCTURE`         | error          | Nicht speicherbare Struktur (noch nicht persistierte Einheit)                       |
| `UNKNOWN_EXERCISE`              | error          | Alle `exercise_id` im Katalog vorhanden?                                            |
| `RETIRED_EXERCISE`              | warning        | Katalogeintrag ausgemustert                                                         |
| `INCONSISTENT_SESSION`          | error          | Session-IDs konsistent?                                                             |
| `DUPLICATE_SESSION_ORDER`       | error          | Reihenfolge der Einheiten eindeutig?                                                |
| `DUPLICATE_EXERCISE_ORDER`      | error          | Reihenfolge der Übungen eindeutig?                                                  |
| `DUPLICATE_PLAN_ITEM_ID`        | error          | Planpositions-IDs eindeutig?                                                        |
| `INVALID_SET_COUNT`             | error          | Ganze Zahl 1…50                                                                     |
| `INVALID_REP_RANGE`             | error          | `rep_min <= rep_max`, ganze Zahlen 0…1000                                           |
| `INVALID_REP_RANGE`             | warning        | nur eine Seite des Bereichs gesetzt                                                 |
| `WIDE_REP_RANGE`                | recommendation | Bereich weiter als 10 Wiederholungen                                                |
| `INVALID_TARGET_LOAD`           | error          | 0…1000 kg; kein Zielgewicht bei `bodyweight_only`; positive Angabe bei `assistance` |
| `LOAD_BASIS_MISMATCH`           | error          | Zielgewicht **ohne** Gewichtsdefinition                                             |
| `LOAD_BASIS_MISMATCH`           | warning        | Gewichtsdefinition weicht vom Katalog-Default ab                                    |
| `INVALID_EXECUTION`             | error          | `unilateral` ⇒ ein Gerät; `alternating` ⇒ höchstens zwei                            |
| `INVALID_EXECUTION`             | warning        | Geräteanzahl ohne Ausführungsart                                                    |
| `INVALID_REST`                  | error          | ganze Sekunden, 0…86400                                                             |
| `MISSING_TARGET_SETS`           | warning        | keine Zielsätze – Planeinhaltung nicht berechenbar                                  |
| `DUPLICATE_EXERCISE_IN_SESSION` | warning        | Übung mehrfach in einer Einheit                                                     |
| `DAYS_PER_WEEK_MISMATCH`        | recommendation | `days_per_week` ≠ Anzahl der Einheiten                                              |
| `SCHEMA_VERSION_MISMATCH`       | error          | Schemaversion passt nicht                                                           |

**Ein Zielgewicht ohne Gewichtsdefinition ist ein Fehler, keine Warnung.** „70"
ohne Angabe, ob gesamt oder pro Hantel, ist genau die Mehrdeutigkeit, die dieses
Projekt nicht speichert.

### Ergebnisform

```json
{
  "valid": false,
  "plan_version_id": "PV_003",
  "row_revision": 4,
  "status": "draft",
  "schema_id": "arnold.training_raw",
  "schema_version": "1.0.0",
  "errors": [
    {
      "code": "INVALID_REP_RANGE",
      "severity": "error",
      "message": "Das Wiederholungsminimum darf nicht größer als das Maximum sein.",
      "session_id": "session_push",
      "plan_item_id": "item_004",
      "exercise_id": "ex_bench",
      "field": "rep_max"
    }
  ],
  "warnings": [],
  "recommendations": [],
  "activatable": false
}
```

`activatable` ist genau dann `true`, wenn keine Fehler vorliegen **und** die
Version ein Entwurf ist. Nur dann darf für diese Revision eine Bestätigung
ausgestellt werden.

### Sofortige Ablehnung beim Schreiben

Ein Entwurf darf unfertig gespeichert werden – das ist der Sinn eines Entwurfs
(fehlende Zielsätze etwa sind nur eine Warnung). Strukturell unmögliche oder
mehrdeutige Änderungen werden jedoch **gar nicht** geschrieben, sondern mit
`VALIDATION_ERROR` abgelehnt: unbekannte Übung, doppelte IDs oder
Reihenfolgewerte, inkonsistente Session, ungültiger Wiederholungsbereich,
ungültige Satzanzahl, ungültiges Zielgewicht, ungültige Ausführung, ungültige
Pause, Zielgewicht ohne Definition.

---

## 11. Planaktivierung

Tool: `activate_training_plan`

```json
{
  "request_id": "uuid",
  "plan_version_id": "PV_003",
  "expected_row_revision": 4,
  "confirmation": {
    "plan_version_id": "PV_003",
    "row_revision": 4,
    "confirmed": true
  }
}
```

### Voraussetzungen

1. Geprüfte Nutzeridentität (im Fixture-Modus die Fixture-Identität).
2. Der Entwurf existiert und ist ein Entwurf.
3. `expected_row_revision` stimmt mit der gespeicherten Revision überein.
4. Die `confirmation` nennt **dieselbe** Planversion und **dieselbe** Revision.
5. Die Validierung ergibt keine Fehler.
6. Kein konkurrierender Vorgang ist offen (Ledger-Abgleich).

### Schritte (ein atomarer Batch)

1. Aktuell aktive Version ermitteln.
2. Entwurf gegen die aktuelle Revision validieren.
3. Bestätigung gegen Planversion **und** Revision prüfen.
4. Bisherige aktive Version → `archived`, `retired_at_utc` setzen.
5. Entwurf → `active`, `activated_at_utc` setzen.
6. Beide `row_revision` erhöhen.
7. Readback: beide Zeilen müssen genau so vorliegen.
8. Audit-Ereignisse schreiben, Journal auf `committed` setzen.

Schritte 4 und 5 liegen im **selben** Batch. Es gibt keinen Zeitpunkt mit zwei
aktiven Plänen und keinen mit null aktiven Plänen.

### Bestätigung ist nicht Validierung

Eine erfolgreiche technische Prüfung ist **keine** Nutzerbestätigung. Die
`confirmation` kann serverseitig nicht hergeleitet werden – sie muss die konkret
angezeigte Planversion und Revision nennen. Wird der Entwurf nach dem
Prüfschritt noch geändert, steigt seine Revision und die alte Bestätigung wird
mit `STALE_CONFIRMATION` abgelehnt. Im Editor ist das abgedeckt: die Bestätigung
wird aus der **aktuellen** Revision gebildet, nicht aus der beim Öffnen des
Dialogs gespeicherten.

Die endgültige Identitätsbindung erfolgt mit der produktiven Authentifizierung.

### Unklarer Commit-Status

Lässt sich die Aktivierung nicht eindeutig bestätigen, antwortet der Service mit
`COMMIT_STATUS_UNKNOWN` und `retryable: true`. Es wird **keine** Erfolgsmeldung
ausgegeben. Der Aufrufer muss denselben `request_id` erneut senden; der
Vorgang wird dann abgeglichen, nicht wiederholt.

---

## 12. Historische Trainingsplanverwaltung

| Tool                    | Antwort                                                                  |
| ----------------------- | ------------------------------------------------------------------------ |
| `get_training_plan`     | eine Version mit Einheiten, Übungen, Zielwerten, Prüfergebnis            |
| `list_training_plans`   | Planfamilien mit allen Versionen, Status, Lebenszyklusdaten              |
| `get_plan_history`      | Versionen chronologisch, neueste zuerst, mit Abstand zur aktiven Version |
| `compare_plan_versions` | strukturierter Unterschied zweier Versionen                              |

`get_plan_history` liefert pro Eintrag `change_count_vs_active` – die Anzahl der
Unterschiede zur aktuell aktiven Version. „Version 1 – 7 Unterschiede zum
aktuellen Plan" ist handlungsleitend, eine nackte Datumsliste nicht.

### Vergleich

Erkannte Änderungsarten: `plan_renamed`, `plan_metadata_changed`,
`session_added`, `session_removed`, `session_renamed`, `session_reordered`,
`exercise_added`, `exercise_removed`, `exercise_replaced`,
`exercise_reordered`, `targets_changed`, `execution_changed`.

Zuordnungsregeln:

- **Einheiten** werden innerhalb einer Familie über `session_id` gepaart, über
  Familiengrenzen hinweg über den normalisierten Namen.
- **Übungen** werden immer über `exercise_id` gepaart, nie über den Namen.
- Ein **Austausch** wird nur dann als solcher gemeldet, wenn an derselben
  Position eine Bewegung verschwindet und eine andere erscheint und keine der
  beiden anderswo in der Einheit vorkommt. Andernfalls sind es unabhängiges
  Entfernen und Hinzufügen – eine andere Beschreibung wäre falsch.
- **Reihenfolge** wird über den Rang unter den vorhandenen Einheiten verglichen,
  nicht über die gespeicherte Zahl: eine Lücke aus einer entfernten Einheit ist
  keine Umsortierung durch den Nutzer.

Die Ausgabe ist maschinenlesbar (`kind`, IDs, `field`, `before`, `after`) **und**
anzeigefertig (`label`, `headline`).

### Alte Version wiederverwenden

1. Archivierte Version lesen.
2. `create_plan_version` erzeugt einen neuen Entwurf auf ihrer Grundlage.
3. Neue `plan_version_id`, neue `plan_item_id`-Werte.
4. Nutzer passt an.
5. Nutzer bestätigt und aktiviert.
6. Die historische Originalversion bleibt unverändert.

---

## 13. Workout-Referenzen

Zusagen, jeweils durch Tests belegt:

1. **Abgeschlossene Workouts bleiben an ihrer Planversion.** Keine
   Planoperation schreibt nach `WORKOUTS` oder `SETS` – der Planservice hat
   dafür keinen Codepfad.
2. **Laufende Workouts behalten ihre Planreferenz.** `plan_version_id` und
   `session_id` eines Workouts sind unveränderliche Spalten. Eine Planänderung
   tauscht die Übungen eines laufenden Trainings nicht aus.
3. **Geloggte Gewichte werden nie überschrieben.** Eine Änderung an
   `target_load_kg` berührt `SETS.load_kg` nicht.
4. **Historische Session-Namen bleiben nachvollziehbar** über
   `WORKOUTS.session_name_snapshot`.
5. **Historische Planpositionen bleiben auflösbar**, weil Entfernen ein
   Tombstone ist.
6. **Analytics funktioniert über Planversionen hinweg.** `planVersionAt()`
   wählt die zum Trainingsdatum gültige Version; archivierte Versionen bleiben
   auswertbar.

### Beispiel

```text
Plan V1 (Push/Pull/Legs, aktiv)
  └── Workout W1 am 10.02., Push, Bankdrücken 70 kg × 10

Nutzer ersetzt Bankdrücken durch Kurzhantel-Bankdrücken
  → Plan V2 (draft) → bestätigt → aktiv; V1 archiviert

Ergebnis:
  W1 referenziert weiter V1
  Die Sätze von W1 bleiben: 70 kg gesamt × 10
  Neue Workouts referenzieren V2
  Die Kurzhantelvariante hat ihre eigene exercise_id
```

---

## 14. MCP-Tools

### Lesend (immer registriert, wenn die Planverwaltung eingebunden ist)

| Tool                      | Funktion                                                           |
| ------------------------- | ------------------------------------------------------------------ |
| `get_training_plan`       | Planversion laden (ohne ID: die aktive, sonst der neueste Entwurf) |
| `list_training_plans`     | Pläne und Versionen auflisten                                      |
| `get_plan_history`        | historische Versionen mit Abstand zur aktiven Version              |
| `validate_training_plan`  | Planentwurf prüfen                                                 |
| `compare_plan_versions`   | Planänderungen vergleichen                                         |
| `get_plan_editor_context` | Alles für eine Editoransicht in einem Aufruf                       |

### Schreibend (nur bei aktivem Schreibmodus registriert)

| Tool                     | Funktion                             | `destructiveHint` |
| ------------------------ | ------------------------------------ | ----------------- |
| `create_training_plan`   | neuen Planentwurf anlegen            | `false`           |
| `create_plan_version`    | neue Version eines bestehenden Plans | `false`           |
| `clone_plan_version`     | Alias für den Wiederherstellungspfad | `false`           |
| `update_plan_draft`      | typisierte Änderungen am Entwurf     | `false`           |
| `activate_training_plan` | bestätigten Entwurf aktivieren       | `true`            |
| `archive_plan_draft`     | Entwurf verwerfen                    | `true`            |

Alle schreibenden Tools: `readOnlyHint: false`, `idempotentHint: true`,
`openWorldHint: false`. Alle lesenden Tools: `readOnlyHint: true`,
`destructiveHint: false`, `idempotentHint: true`.

Ist keine Planverwaltung eingebunden, wird **kein** Plan-Tool registriert. Eine
rein lesende Verbindung bewirbt also keine Planänderung.

### API-Design

Statt eines Tools je Kleinänderung bündelt `update_plan_draft` alle
Änderungsarten als typisierte Operationen. Das hält die Toolliste für ein Modell
lesbar, macht eine mehrschrittige Änderung zu **einer** Revision und sorgt
dafür, dass Chat und UI exakt denselben Codepfad benutzen.

---

## 15. Input- und Output-Schemas

Alle Schemas liegen in `src/shared/plan-contract.ts` und sind Zod-Schemas; sie
werden als MCP-`inputSchema`/`outputSchema` veröffentlicht, und jede Antwort
enthält `structuredContent`.

### Gemeinsame Eingabefelder

| Feld                    | Pflicht                                   | Bedeutung                            |
| ----------------------- | ----------------------------------------- | ------------------------------------ |
| `request_id`            | bei jeder Schreiboperation                | Idempotenzschlüssel, 1…128 Zeichen   |
| `plan_version_id`       | bei Entwurfs- und Lebenszyklusoperationen | Zielversion                          |
| `expected_row_revision` | bei Entwurfs- und Lebenszyklusoperationen | erwartete Revision                   |
| `confirmation`          | nur bei `activate_training_plan`          | Bestätigung von Version und Revision |

### Schreibantwort

```json
{
  "ok": true,
  "operation": "update_plan_draft",
  "request_id": "uuid",
  "replayed": false,
  "result": {
    "plan": {
      "version": { "...": "TrainingPlanVersion" },
      "based_on_plan_version_id": null,
      "schema_limits": []
    },
    "activation": null,
    "validation": { "...": "PlanValidationResult" },
    "changes": [{ "...": "PlanChange" }],
    "warnings": [],
    "schema_limits": []
  },
  "error": null
}
```

Bei `ok: false` ist `result` immer `null` und `error` gesetzt:

```json
{
  "code": "REVISION_CONFLICT",
  "message": "…",
  "retryable": false,
  "details": ["current_row_revision=5"]
}
```

### Fehlercodes

`VALIDATION_ERROR`, `PLAN_NOT_FOUND`, `PLAN_VERSION_NOT_FOUND`,
`SESSION_NOT_FOUND`, `PLAN_ITEM_NOT_FOUND`, `EXERCISE_NOT_FOUND`,
`EXERCISE_AMBIGUOUS`, `PLAN_NOT_EDITABLE`, `PLAN_INVALID`,
`INVALID_STATUS_TRANSITION`, `REVISION_CONFLICT`, `VERSION_NUMBER_CONFLICT`,
`CONFIRMATION_REQUIRED`, `STALE_CONFIRMATION`, `ACTIVE_PLAN_CONFLICT`,
`DUPLICATE_OPERATION`, `SCHEMA_MISMATCH`, `UNSUPPORTED_BY_SCHEMA`,
`TEMPLATE_WRITE_FORBIDDEN`, `AUTH_REQUIRED`, `PERMISSION_DENIED`,
`STORAGE_UNAVAILABLE`, `COMMIT_STATUS_UNKNOWN`.

---

## 16. Idempotenz

Jede Schreiboperation trägt eine `request_id`. Die Verarbeitung nutzt das
Operationsjournal aus Task 004 – **dasselbe** Journal, nicht ein zweites:

1. Journaleintrag zu `(tracker_id, request_id)` suchen.
2. Gleiche ID, **anderer** Payload oder anderer Akteur → `DUPLICATE_OPERATION`.
3. Eintrag `committed` → gespeichertes Ergebnis zurückgeben, `replayed: true`.
   Zuvor wird geprüft, dass die bestätigten Zeilen noch vorhanden und nicht
   zurückgefallen sind; andernfalls `COMMIT_STATUS_UNKNOWN`.
4. Ein anderer, unfertiger Vorgang muss zuerst geklärt werden.
5. Vor dem Speichern wird `dispatching` journalisiert, damit ein Absturz
   mitten im Schreibvorgang danach erkennbar ist.
6. Erfolg wird erst nach Readback, Audit und Journal-Commit gemeldet.

Belegt: zweimaliges `activate_training_plan` mit derselben `request_id`
aktiviert genau einmal und liefert beim zweiten Mal denselben
Aktivierungszeitpunkt mit `replayed: true`.

---

## 17. Nebenläufigkeit

### Optimistische Sperre

Die `row_revision` der `PLANS`-Zeile ist der **einzige** Konkurrenz-Token eines
Entwurfs. Jede Entwurfsänderung erhöht sie – auch wenn nur Positionen bewegt
wurden. Eine Änderung mit veralteter Revision wird mit `REVISION_CONFLICT`
abgelehnt und nennt die aktuelle Revision in `details`.

### Serialisierung

Alle Schreibvorgänge eines Trackers laufen durch denselben
`WriteCoordinator` wie das Workout-Logging aus Task 004. Eine Planaktivierung
und ein Satz-Write auf demselben Tracker können sich deshalb nicht
verschränken. Zwei gleichzeitige `create_plan_version`-Aufrufe erhalten
unterschiedliche, lückenlose Versionsnummern.

### Grenzen

Der Koordinator hat Prozess-Scope (`scope: "process"`), das Journal ist
`memory` oder `local`. Für mehrere Serverinstanzen auf demselben Tracker wären
eine verteilte Sperre und ein verteiltes Journal nötig. Siehe
[§25](#25-bekannte-technische-risiken).

Google Sheets kennt keine transaktionalen Constraints. Die Anwendung behandelt
Schreibkonflikte deshalb ausschließlich über diese serverseitige Koordination.
Eine **externe manuelle Änderung** an der Tabelle ist damit nicht abgedeckt;
der Google-Schreibadapter aus Task 004 erkennt eine unerwartete Fremdänderung
über einen Fingerprint und sperrt den Tracker, bis sie geklärt ist.

---

## 18. Audit-Ereignisse

Die Audit-Struktur aus Task 004 wird erweitert, nicht ersetzt. Ereignisse
werden über `(operation_id, entity_id, event_type)` dedupliziert, sodass ein
Replay nicht doppelt protokolliert.

| Ereignis                 | Entität           | Ausgelöst durch                               |
| ------------------------ | ----------------- | --------------------------------------------- |
| `PLAN_CREATED`           | `plan_version_id` | `create_training_plan`                        |
| `PLAN_DRAFT_CREATED`     | `plan_version_id` | `create_training_plan`, `create_plan_version` |
| `PLAN_DRAFT_UPDATED`     | `plan_version_id` | `update_plan_draft`                           |
| `PLAN_DRAFT_ARCHIVED`    | `plan_version_id` | `archive_plan_draft`                          |
| `PLAN_VALIDATED`         | `plan_version_id` | Aktivierung (hält die bestätigte Revision)    |
| `PLAN_ACTIVATED`         | `plan_version_id` | `activate_training_plan`                      |
| `PLAN_ARCHIVED`          | `plan_version_id` | Archivierung der Vorgängerversion             |
| `SESSION_ADDED`          | `session_id`      | Einheit hinzugefügt oder dupliziert           |
| `SESSION_UPDATED`        | `session_id`      | Einheit umbenannt oder verschoben             |
| `SESSION_REMOVED`        | `session_id`      | Einheit entfernt                              |
| `PLAN_EXERCISE_ADDED`    | `plan_item_id`    | Übung hinzugefügt                             |
| `PLAN_EXERCISE_REPLACED` | `plan_item_id`    | Übung ausgetauscht                            |
| `PLAN_EXERCISE_REMOVED`  | `plan_item_id`    | Übung entfernt                                |

Jedes Ereignis trägt `operation_id`, `entity_id`, `at`, `actor`,
`previous_revision`, `new_revision`, `result: "verified"`, `changed_fields` und
`changes` (Vorher/Nachher der betroffenen Felder).

Zielwert-, Ausführungs- und Reihenfolgeänderungen haben keinen eigenen
Ereignistyp; sie werden im `changes`-Feld von `PLAN_DRAFT_UPDATED` geführt,
geschlüsselt nach `<plan_item_id>.<feld>`.

**Datensparsamkeit:** protokolliert wird nur das handelnde Subjekt, keine
weiteren personenbezogenen Daten.

---

## 19. Sicherheitsregeln

| Regel                              | Umsetzung                                                                                                                   |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Master-Vorlage niemals beschreiben | `file_role = MASTER_TEMPLATE` → `TEMPLATE_WRITE_FORBIDDEN` vor jedem Schreibvorgang                                         |
| Arnold-Masterdatei gesperrt        | Die Spreadsheet-ID der Masterdatei lässt den Schreibadapter nicht konstruieren                                              |
| Nur der eigene Tracker             | `tracker_id` des Datensatzes muss zur Service-Konfiguration und zum Akteur passen                                           |
| Geprüfte Identität                 | Nicht verifizierter Akteur → `AUTH_REQUIRED`; fehlende Berechtigung → `PERMISSION_DENIED`                                   |
| Keine produktiven Schreibzugriffe  | `mode: "production"` lässt den Service nicht konstruieren                                                                   |
| Kein Google-Schreibpfad für Pläne  | `mode: "test_sheet"` lässt den Planservice nicht konstruieren; der Google-Adapter kennt nur `WORKOUTS`, `SETS`, `EXERCISES` |
| Keine zweite Auth-Schicht          | Der `AuthorizationGuard` aus Task 004 wird unverändert verwendet                                                            |
| Keine echten Nutzerdaten in Tests  | Ausschließlich synthetische Fixtures                                                                                        |

### Betriebsmodus

Schreibende Planoperationen sind in dieser Task **ausschließlich** im
Fixture-Modus möglich. Der Konstruktor von `TrainingPlanService` lehnt
`production` und `test_sheet` ab. `PLANS` und `PLAN_ITEMS` haben bewusst
**keinen** Google-Schreibpfad: der Schreibadapter aus Task 004 führt nur die
drei Domänentabellen und weist alles andere mit `PERMISSION_DENIED` ab.

Alle produktiven Schreibaktionen bleiben deaktiviert, solange die nötige
Authentifizierung und Schreibkoordination nicht implementiert sind.

---

## 20. Planeditor-Komponenten

Wiederverwendbare Komponenten in `src/ui/components/plan.tsx`, die Ansicht in
`src/ui/views/TrainingPlanEditorView.tsx`:

| Komponente               | Aufgabe                                                |
| ------------------------ | ------------------------------------------------------ |
| `TrainingPlanEditorView` | Der Editor; eine Ansicht für den gesamten Lebenszyklus |
| `TrainingSessionCard`    | Eine Trainingseinheit mit Aktionen                     |
| `PlannedExerciseRow`     | Eine Übung; häufige Zieländerungen direkt in der Karte |
| `ExercisePicker`         | Katalogsuche über Name, Gerät, Muskelgruppe            |
| `ExerciseSettingsPanel`  | Alle Einstellungen einer Planposition im Dialog        |
| `PlanOverview`           | Der Plan als Lesefassung mit Kennzahlen                |
| `PlanVersionHistory`     | Frühere Versionen, Ansehen und Wiederverwenden         |
| `PlanChangeSummary`      | Änderungsübersicht, gruppiert                          |
| `PlanValidationPanel`    | Prüfergebnis in drei Registern                         |
| `PlanActivationDialog`   | Bestätigung mit Nennung von Version und Revision       |
| `PlanDialog`             | Modal mit Fokusfang und Escape                         |

### Funktionen

Auswählen, Hinzufügen, Umbenennen, Umsortieren, Duplizieren und Entfernen von
Trainingseinheiten; Hinzufügen, Entfernen, Austauschen und Umsortieren von
Übungen; Bearbeiten von Zielsätzen, Wiederholungsbereichen, Zielgewichten und
Ausführungen; Entwurf speichern, Änderungen prüfen, gültigen Plan bestätigen und
aktivieren, Entwurf verwerfen, frühere Versionen anzeigen und wiederverwenden,
neuen Trainingsplan anlegen.

### UX-Regeln

- Häufige Aktionen (Sätze, Wiederholungen, Zielgewicht) sind **direkt in der
  Übungskarte** erreichbar; seltenere Einstellungen liegen im Detaildialog. Kein
  Seitenwechsel.
- Technische IDs sind nie primäre Beschriftung, nur Kleingedrucktes.
- Standardwerte für Ausführung und Gewichtsdefinition kommen aus dem
  Übungskatalog.
- Ein geplantes Gewicht ist immer als Ziel benannt und trägt immer seine
  Gewichtsdefinition („Ziel 20 kg pro Hantel"). Die Formulierung stammt
  ausschließlich aus `formatLoad` – die eine Stelle, die eine Lastkonvention in
  Text übersetzt.
- Änderungen sind vor der Aktivierung überprüfbar.
- Navigation allein aktiviert nie einen Plan.
- Eingaben bleiben bei einem Netzwerkfehler erhalten; der Vorgang wird mit
  derselben Operations-ID geprüft, nicht wiederholt.
- Bedienbar per Tastatur, mobil nutzbar, Screenreader-Beschriftungen an allen
  Aktionen, Hell- und Dunkel-Theme über die bestehenden Design-Tokens.
- Hinweistexte sind `aria-describedby`-Beschreibungen, nicht Teil des
  Feldnamens.

---

## 21. UI-Zustände

| Zustand                  | Bedeutung                            |
| ------------------------ | ------------------------------------ |
| `NO_PLAN`                | Noch kein Trainingsplan hinterlegt   |
| `VIEWING_ACTIVE`         | Der aktive Plan wird gelesen         |
| `EDITING_DRAFT`          | Ein Entwurf wird bearbeitet          |
| `SAVING_DRAFT`           | Änderung wird gespeichert            |
| `DRAFT_SAVED`            | Entwurf gespeichert                  |
| `VALIDATING_DRAFT`       | Entwurf wird geprüft                 |
| `DRAFT_INVALID`          | Entwurf nicht aktivierbar            |
| `READY_FOR_CONFIRMATION` | Geprüft, kann bestätigt werden       |
| `ACTIVATING`             | Aktivierung läuft                    |
| `ACTIVATION_CONFIRMED`   | Plan ist aktiv                       |
| `CONFLICT`               | Offener oder konkurrierender Vorgang |
| `ERROR`                  | Fehler                               |

### Regeln

- Der Editor öffnet auf dem **aktiven** Plan. Offene Entwürfe werden gesondert
  angeboten; „Plan bearbeiten" öffnet einen vorhandenen Entwurf oder erzeugt
  eine neue Version. Ein aktiver Plan kann nicht direkt bearbeitet werden.
- Beim ersten Bearbeiten erklärt die UI: „Du bearbeitest eine neue Version
  deines Trainingsplans. Deine bisherigen Trainingsdaten bleiben erhalten."
- Nicht gespeicherte lokale Einheiten sind als solche gekennzeichnet und
  blockieren die Aktivierung.
- Bei einem Konflikt werden fremde Änderungen nicht überschrieben; der Entwurf
  wird neu geladen und der Fehler benannt.
- Erfolg erscheint ausschließlich nach bestätigtem Backend-Ergebnis.
- Nach erfolgreicher Aktivierung wird der aktualisierte aktive Plan geladen.
- Eine veraltete Revision kann nicht unbemerkt aktiviert werden.

---

## 22. Integration mit Task 004

Die Planverwaltung **teilt** mit dem Workout-Logging:

| Baustein                | Geteilt                                                        |
| ----------------------- | -------------------------------------------------------------- |
| `ArnoldWriteRepository` | ja – dasselbe Repository je Tracker                            |
| `OperationLedger`       | ja – eine Idempotenz über beide Domänen                        |
| `WriteCoordinator`      | ja – Schreibvorgänge serialisieren gegeneinander               |
| `AuditLogRepository`    | ja – ein Audit-Trail je Tracker                                |
| `AuthorizationGuard`    | ja – keine zweite Authentifizierungsschicht                    |
| `changedDataset`        | ja – ein Änderungsvalidator, erweitert um `PLANS`/`PLAN_ITEMS` |

Zusagen im Zusammenspiel:

1. `start_workout` nutzt die aktuell aktivierte Planversion.
2. Spontane Workouts ohne Planbezug bleiben möglich.
3. Planänderungen verändern keine vergangenen Workout-Datensätze.
4. Laufende Workouts behalten ihre ursprüngliche Planreferenz.
5. Änderungen an Zielgewichten überschreiben keine geloggten Gewichte.
6. Der Workout-Logger lädt neue Planinformationen über `get_workout`.
7. Analytics über mehrere Planversionen bleibt funktionsfähig.

### Erweiterungen an Task-004-Dateien

| Datei                            | Änderung                                                                                                                                                                                                |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `workout/infrastructure.ts`      | `EntityChange` um `plans`/`planItems`; `entityId`; `createdAt`-Helfer (PLAN_ITEMS führt keine Zeitstempel); Audit-Ereignistypen; Journal-Ergebnis als Union; Unveränderlichkeitsregeln für Plantabellen |
| `shared/workout-contract.ts`     | unverändert                                                                                                                                                                                             |
| `arnold-sheets-write-adapter.ts` | Tabellenliste typisiert; Plantabellen bleiben ausgeschlossen                                                                                                                                            |
| `workout/service.ts`             | eine Zeile: `createdAt(...)` statt direktem Feldzugriff                                                                                                                                                 |
| `ui/client.ts`                   | strukturierte Plan-Schreibfehler werden wie Workout-Fehler durchgereicht statt als Transportfehler geworfen                                                                                             |

**Offener Punkt:** Das Commit-Protokoll liegt nun zweimal vor – als
parametrisierter `commitWrite` in `plan/commit.ts` und als Inline-Variante in
`WorkoutLoggingService.execute`. Beide halten dieselbe Reihenfolge und
dieselben Garantien. Das Zusammenführen des Workout-Service auf `commitWrite`
ist eine empfohlene Folgeaufgabe; sie wurde hier bewusst nicht durchgeführt, um
nicht committete Arbeit an `workout/service.ts` nicht zu überschreiben.

---

## 23. Vorbereitung für Task 006

Vorhanden und wiederverwendbar:

- `TrainingPlanEditorView` nimmt `embedded` an und blendet dann die
  Historie aus. Die Komponente setzt keinen vorhandenen Plan voraus und zeigt
  für einen leeren Tracker einen Anlage-Pfad.
- `create_training_plan` nimmt einen **vollständigen, strukturierten**
  Planvorschlag entgegen – aus manueller Erstellung, aus einem bestehenden
  Nutzerplan, aus einem strukturierten KI-Vorschlag oder als Kopie einer
  früheren Version. Das Feld `origin` dokumentiert die Quelle; der Service setzt
  keine KI-Erzeugung voraus.
- Ein KI-Vorschlag wird als Entwurf gespeichert und zusätzlich mit einem
  Hinweis versehen, dass er erst nach ausdrücklicher Bestätigung aktiv wird.
  Es gibt **keinen** Pfad, der einen Vorschlag ohne Bestätigung aktiviert.

Bewusst **nicht** implementiert (Aufgabengrenze): Onboarding-State-Machine,
eigenständige KI-Plangenerierung, Google OAuth, automatische Erstellung
persönlicher Tracker-Dateien.

---

## 24. Grenzen des Google-Sheets-Schemas

Die Grenzen sind Teil des Vertrags (`PLAN_SCHEMA_LIMITS`) und werden in der
Toolausgabe mitgeliefert, statt vom Nutzer entdeckt zu werden.

### `EMPTY_SESSION_NOT_PERSISTABLE`

Eine Trainingseinheit existiert nur über ihre Planpositionen. Eine Einheit ohne
Übung hat keine Zeile und ist **nicht speicherbar**.

Umgang: Der Editor darf eine leere Einheit vorübergehend halten; sie ist
ausdrücklich als „Noch nicht gespeichert" gekennzeichnet, blockiert die
Aktivierung und wird nicht als dauerhaft gespeicherte Session ausgegeben
(`persisted: false`). Mit der ersten Übung wird sie über `add_session` echt.
`add_session` verlangt deshalb mindestens eine Übung.

**Migrationsvorschlag:** eigene Tabelle `SESSIONS`
(`session_id`, `plan_version_id`, `session_order`, `session_name`, `status`,
`row_revision`); `PLAN_ITEMS` referenziert nur noch `session_id`. Damit wären
leere Einheiten, Session-Metadaten und eine echte Session-Umbenennung ohne
Massenupdate möglich. Erfordert `schema_version 1.1.0` und eine Anpassung des
`schema_fingerprint`.

### `NO_SESSION_TABLE`

`session_name` und `session_order` liegen redundant auf jeder Planposition.
Eine Umbenennung ist ein Massenupdate über alle Positionen der Einheit.
Gleiche Migration wie oben.

### `NO_PLAN_ITEM_TIMESTAMPS`

`PLAN_ITEMS` führt weder `created_at_utc` noch `updated_at_utc`. Der
Änderungszeitpunkt einer Planposition wird über `PLANS.updated_at_utc`
abgebildet.

**Migrationsvorschlag:** `created_at_utc` und `updated_at_utc` zu `PLAN_ITEMS`
ergänzen; Bestandszeilen mit `PLANS.created_at_utc` initialisieren.

### `SINGLE_ACTIVE_PLAN_ONLY`

Genau eine aktive Planversion je Tracker. Mehrere parallele aktive Pläne (etwa
Kraft- und Lauftraining nebeneinander) sind in V1 ausgeschlossen.

**Migrationsvorschlag:** `PLANS` um `plan_track_key` ergänzen und die
Eindeutigkeit von „eine aktive Version" auf `(tracker, plan_track_key)`
beziehen; `WORKOUTS` erbt den Track über `plan_version_id`.

### Entwurf verwerfen ohne Aktivierung

`ArnoldPlanVersionSchema` verlangt für `status = archived` ein gesetztes
`activated_at_utc`. Ein nie aktivierter Entwurf kann daher nicht
„sauber" archiviert werden.

**Umgang in V1:** `archive_plan_draft` setzt `activated_at_utc` und
`retired_at_utc` auf **denselben** Zeitpunkt. Dieses Paar ist das dokumentierte
Kennzeichen für „verworfener Entwurf, nie aktiv gewesen". Das Fenster hat Länge
null, weshalb `planVersionAt()` diese Version zu **keinem** Datum auswählen
kann – belegt durch einen Test, der mehrere Daten prüft. Die Schreibantwort
weist ausdrücklich darauf hin, und das Audit-Ereignis
`PLAN_DRAFT_ARCHIVED` hält den wahren Vorgang.

**Migrationsvorschlag:** `PLANS.status` um den Wert `discarded` erweitern **oder**
`activated_at_utc` für `archived` nullable machen. Beides erfordert
`schema_version 1.1.0`.

---

## 25. Bekannte technische Risiken

| Risiko                               | Auswirkung                                                        | Minderung / Status                                                                 |
| ------------------------------------ | ----------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Prozesslokale Schreibkoordination    | Zwei Serverinstanzen auf demselben Tracker könnten verschränken   | Nur eine Instanz je Tracker betreiben; verteilte Sperre offen                      |
| Journal `memory`/`local`             | Idempotenz übersteht keinen Instanzwechsel                        | `FileOperationLedger` übersteht einen Neustart; verteiltes Journal offen           |
| Externe manuelle Tabellenänderung    | Gleichzeitige Fremdänderung ist nicht durch Constraints abgedeckt | Fingerprint-Erkennung im Google-Adapter sperrt den Tracker bis zur Klärung         |
| Verworfener Entwurf als „archiviert" | Rohdatenleser könnte das Paar `activated == retired` fehldeuten   | Dokumentiertes Kennzeichen, Analytics-Test, Migrationsvorschlag in §24             |
| Doppeltes Commit-Protokoll           | Zwei Implementierungen könnten auseinanderlaufen                  | Gleiche Reihenfolge und Garantien; Zusammenführung als Folgeaufgabe (§22)          |
| Entwürfe sammeln sich an             | Viele verworfene Versionen in der Historie                        | Historie filtert nach Status; Aufräumen offen                                      |
| Massenupdate bei Umbenennung         | Eine Umbenennung schreibt alle Positionen der Einheit             | Durch Modell-Diff auf das Nötige begrenzt; echte Lösung ist die `SESSIONS`-Tabelle |
| Keine produktive Autorisierung       | Planänderungen sind nur im Fixture-Modus möglich                  | Beabsichtigt; produktive Freigabe erst mit abgeschlossener Authentifizierung       |

Die Arnold-Masterdatei wurde nicht verändert.

---

## Dateien

### Neu

```text
src/shared/plan-contract.ts            Domain-Modell, Operationen, Tool-Schemas
src/server/plan/domain.ts              Projektion und State Machine
src/server/plan/validation.ts          Planvalidierung in drei Registern
src/server/plan/versioning.ts          Entwurfsmodell und Bearbeitungsoperationen
src/server/plan/comparison.ts          Versionsvergleich
src/server/plan/commit.ts              parametrisiertes Commit-Protokoll
src/server/plan/errors.ts              Fehlervokabular der Plandomäne
src/server/plan/service.ts             TrainingPlanService
src/server/plan/fixture.ts             synthetischer Plan-Runtime
src/server/mcp-plan.ts                 MCP-Tools
src/ui/components/plan.tsx             Editorkomponenten
src/ui/views/TrainingPlanEditorView.tsx  Der Editor
src/ui/hooks/usePlanEditor.ts          UI-State-Machine
docs/ARNOLD-PLAN-CONTRACT.md           Dieses Dokument
```

### Geändert

```text
src/server/workout/infrastructure.ts   Plantabellen im Änderungsvalidator und Audit
src/server/workout/service.ts          createdAt-Helfer statt direktem Feldzugriff
src/server/arnold-sheets-write-adapter.ts  Tabellenliste typisiert, Pläne ausgeschlossen
src/server/mcp-arnold.ts               Plan-Tools registrieren
src/server/http.ts                     Planservice in die Runtime einbinden
src/ui/ArnoldDashboardApp.tsx          Navigationspunkt „Trainingsplan"
src/ui/client.ts                       strukturierte Plan-Schreibfehler durchreichen
src/ui/client/ArnoldMcpClient.ts       Plan-Methoden und Pending-Bookkeeping
src/ui/style.css                       Editor-Styles auf bestehenden Tokens
playwright.config.ts                   Kommentar zu den Fixture-Ports
tests/fixtures/arnold-server.ts        Fixture-Server 8796–8799
```
