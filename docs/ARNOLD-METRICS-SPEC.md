# Arnold Metrics Spec v1

Verbindliche Spezifikation der **Arnold Analytics Engine** in `src/analytics/`.

`metrics_version` ist `1.0.0`. Jede Änderung an einer Formel, an einer Eignungsregel oder an einer Statuszuordnung erfordert eine neue `metrics_version`. Das Rohdatenschema (`arnold.training_raw` / `1.0.0`, siehe [ARNOLD-DATA-CONTRACT.md](ARNOLD-DATA-CONTRACT.md)) wird dadurch nicht berührt.

> **Für künftige Entwickler und KI-Agents:** Dieses Dokument beschreibt bewusste Entscheidungen, keine Zufälle. Bevor eine Berechnung geändert wird, muss der entsprechende Abschnitt gelesen und die Änderung hier dokumentiert werden. Insbesondere ist `Volumen = Gewicht × Wiederholungen` **keine** allgemein gültige Formel; siehe [Abschnitt 4](#4-gewichtskonventionen) und [Abschnitt 5](#5-ausführungen).

## 1 Architektur und Grenzen der Engine

```text
ArnoldDataset  →  Arnold Analytics Engine  →  ArnoldDashboardAnalytics
```

| Datei                          | Aufgabe                                                                     |
| ------------------------------ | --------------------------------------------------------------------------- |
| `src/analytics/index.ts`       | Öffentliche Oberfläche                                                      |
| `src/analytics/types.ts`       | Zod-Schemas und Typen aller Ergebnisstrukturen, `METRICS_VERSION`           |
| `src/analytics/period.ts`      | Kalenderarithmetik, Montagswochen, ISO-Wochenlabels                         |
| `src/analytics/validation.ts`  | Filterprüfung, Metrik-Hüllen, überlaufsichere Rundung, kontrollierte Fehler |
| `src/analytics/load.ts`        | Last- und Wiederholungskonventionen pro Satz, Epley                         |
| `src/analytics/eligibility.ts` | Einmaliger Durchlauf: Eignung, Filter, Satzanalysen, Integritätsbefunde     |
| `src/analytics/volume.ts`      | Volumenaggregation nach Kanal, Satztyp, Übung, Einheit, Woche               |
| `src/analytics/activity.ts`    | Einheiten, Trainingstage, Frequenz, Wochenstreak                            |
| `src/analytics/records.ts`     | Bestleistungen                                                              |
| `src/analytics/progress.ts`    | Übungsverlauf und Recharts-fertige Serien                                   |
| `src/analytics/plans.ts`       | Planerfüllung und Planhistorie                                              |
| `src/analytics/trends.ts`      | Wochen- und Monatsvergleiche                                                |
| `src/analytics/quality.ts`     | Datenqualität und Auswertbarkeit                                            |
| `src/analytics/dashboard.ts`   | Zusammenbau und Validierung des DTO                                         |

Abweichung vom vorgeschlagenen Dateiplan: `trends.ts` und `quality.ts` ersetzen den vorgeschlagenen gemeinsamen Zuschnitt, weil Wochen-/Monatsvergleiche und Datenqualität zwei getrennte Verantwortlichkeiten sind. `validation.ts` enthält Filterprüfung **und** die numerischen Hüllen, damit es genau eine Stelle gibt, an der ein Ergebniswert entsteht.

Garantierte Eigenschaften, durch `tests/analytics-architecture.test.ts` abgesichert:

- Die Schicht importiert ausschließlich `zod` und `../shared/arnold-schema-v1.js`.
- Kein Google-, HTTP-, MCP-, Express-, React-, Recharts- oder Dateisystemzugriff.
- Kein Zugriff auf die Systemuhr: `new Date()` und `Date.now()` kommen nicht vor.
- Keine Mutation der Eingabe; Ergebnisse sind eingefroren und JSON-serialisierbar.
- Gleiche Eingabe und gleiche Optionen ergeben dasselbe Ergebnis.

Die Engine bekommt bereits validierte Domain-Daten. Referenzielle Integrität und eindeutige IDs sind durch `ArnoldDatasetSchema` zugesichert. Trotzdem werden doppelte IDs und ins Leere zeigende Referenzen erkannt, ausgeschlossen und in `data_quality.integrity_defects` gemeldet, statt einen Absturz zu verursachen.

Die bestehende Demo-Berechnung `src/shared/calculations.ts` bleibt unverändert und unabhängig.

Eine einzige bestehende Konfiguration wurde geändert: `tsconfig.server.json` schließt zusätzlich `src/analytics` ein. Damit prüft `npm run build` die ESM-Spezifizierer der Schicht unter `NodeNext` und gibt sie als `dist/analytics/` aus, sodass ein späteres Arbeitspaket sie ohne weitere Build-Änderung verwenden kann. Quellcode, Laufzeitverhalten, HTTP-Routen und MCP-Tools bleiben unberührt.

## 2 Öffentliche Oberfläche

```ts
import { buildArnoldDashboardAnalytics } from "./src/analytics/index.js";

const analytics = buildArnoldDashboardAnalytics(dataset, {
  filter: {
    from: "2026-01-01",
    to: "2026-01-31",
    exercise_ids: ["ex-bar-press"],
  },
  reference_date: "2026-01-31",
  weekly_goal_training_days: 3,
  progress_exercise_ids: null,
  include_series: true,
});
```

| Option                      | Standard                   | Bedeutung                                                               |
| --------------------------- | -------------------------- | ----------------------------------------------------------------------- |
| `filter`                    | leer                       | Siehe [Abschnitt 9](#9-filter)                                          |
| `reference_date`            | letztes Datum im Datensatz | Anker für „laufende Woche“ und „aktueller Monat“; **keine Systemuhr**   |
| `weekly_goal_training_days` | `null`                     | Wochenziel in Trainingstagen, 1–7; ohne Wert kein Streak                |
| `progress_exercise_ids`     | `null`                     | Begrenzt `exercise_progress`; `null` bedeutet alle vorkommenden Übungen |
| `include_series`            | `true`                     | `false` liefert Kennzahlen ohne Verlaufsserien                          |
| `validate`                  | `true`                     | `false` überspringt die Zod-Prüfung der Ausgabe                         |

`prepareAnalytics(dataset, options)` gibt den gemeinsamen Satzdurchlauf heraus, damit ein Aufrufer mehrere Abschnitte ohne erneute Iteration über eine lange Satzhistorie berechnen kann.

Fehler: `AnalyticsFilterError` bei ungültigem Filter, `AnalyticsOptionsError` bei Optionen außerhalb des dokumentierten Bereichs. Ein **gültiger** Filter ohne Treffer ist kein Fehler, sondern liefert gültige leere Ergebnisobjekte.

## 3 Einheitliche Ausgabeformate

Jede öffentliche Zahl ist in `MetricValue` gehüllt:

```ts
type MetricValue = {
  metric: string; // technischer Name der Kennzahl
  value: number | null; // endliche Zahl oder null für "unbekannt"
  unit:
    "kg" | "reps" | "sets" | "workouts" | "days" | "weeks" | "ratio" | "count";
  status: "valid" | "partial" | "not_available" | "invalid";
  reasons: AnalyticsReason[]; // maschinenlesbar, dedupliziert, sortiert
  coverage: Coverage | null; // Abdeckung eines Aggregats
};
```

| Status          | Bedeutung                                                        |
| --------------- | ---------------------------------------------------------------- |
| `valid`         | Aus vollständigen, eindeutigen Daten berechnet                   |
| `partial`       | Berechnet, deckt aber nicht jeden geeigneten Beitrag ab          |
| `not_available` | Aus den vorliegenden Daten nicht berechenbar; `value` ist `null` |
| `invalid`       | Eingabe ist in sich widersprüchlich; es wird kein Wert gemeldet  |

`coverage` weist Abdeckung transparent aus:

```ts
type Coverage = {
  eligible_sets: number; // geeignete Beiträge
  included_sets: number; // tatsächlich eingerechnete Beiträge
  excluded_sets: number;
  excluded_reasons: AnalyticsReason[];
};
```

Weitere Konventionen:

- **`0` und `null` sind verschieden.** `0` bedeutet „tatsächlich null“, `null` bedeutet „unbekannt“.
- Kein `NaN`, kein `Infinity`. Die Ausgabe wird gegen `ArnoldDashboardAnalyticsSchema` geprüft; Zod lehnt nicht endliche Zahlen ab.
- Kilogrammwerte werden auf sechs Dezimalstellen gerundet, um Float-Rauschen zu entfernen. Ein bereits extremer Wert wird nicht skaliert, weil die Skalierung selbst überlaufen würde; stattdessen greifen die Endlichkeitsprüfungen.
- Keine Zugangsdaten, keine Datei-IDs, keine Rohzeilen im Ergebnis.

## 4 Gewichtskonventionen

`load_basis` beschreibt, **was** die dokumentierte Zahl in `load_kg` bedeutet. Die Engine mischt diese Bedeutungen niemals unbeschriftet.

| `load_basis`      | Bedeutung                      | `load_reference`  | Volumenkanal      | In 1RM?              |
| ----------------- | ------------------------------ | ----------------- | ----------------- | -------------------- |
| `total`           | Gesamte externe Last           | `total`           | `free_weight`     | ja                   |
| `per_implement`   | Last pro Hantel oder Gerät     | `per_implement`   | `free_weight`     | ja, **pro Gerät**    |
| `machine_display` | Angezeigte Maschinenlast       | `machine_display` | `machine_display` | ja, gerätespezifisch |
| `added`           | Zusatzlast bei Eigengewicht    | `added_external`  | `added_external`  | nein                 |
| `assistance`      | Unterstützungslast             | `assistance`      | keiner            | nein                 |
| `bodyweight_only` | Bewegung mit dem Körpergewicht | `bodyweight`      | keiner            | nein                 |

### Volumenkanäle

Kanäle werden getrennt ausgewiesen, weil sie **physikalisch nicht vergleichbar** sind:

- `free_weight` – Gesamtsystemlast aus freien Gewichten.
- `machine_display` – gerätespezifische Anzeige. Eine Maschine mit 60 kg Anzeige entspricht keiner Langhantel mit 60 kg.
- `added_external` – Zusatzlast über einer **unbekannten** Körpermasse.

`volume.nominal_volume` summiert alle berechenbaren Kanäle und ist damit eine Dokumentationskennzahl gemischter Konvention. `volume.comparable_free_weight_volume` enthält ausschließlich `free_weight` und schließt die übrigen Beiträge mit einem Grund aus. `volume.by_channel` liefert jeden Kanal einzeln.

### Nicht berechenbare Lasten

- `bodyweight_only`: Ohne verwertbare Körpergewichtsmessung ist die bewegte Gesamtlast **unbekannt**, nicht null. Grund: `bodyweight_total_load_unavailable`. Auch ein ausdrücklich gespeichertes `load_kg = 0` bleibt unbekannt, weil die 0 dort „keine Zusatzlast“ und nicht „keine Last“ bedeutet.
- `assistance`: Unterstützung **reduziert** die bewegte Last. Ein nominales Volumen daraus wäre irreführend, und ein „Rekord“ wäre invertiert (weniger Unterstützung ist besser). Grund: `assistance_load_not_volume_comparable`. Unterstützungssätze erzeugen weder Volumen noch Last- oder 1RM-Rekorde.
- `added`: Das zusätzliche externe Lastvolumen **wird** berechnet, der Status ist aber `partial` mit Grund `added_load_total_unavailable`. Die Engine gibt die Zusatzlast niemals als vollständig bewegte Last aus.

## 5 Ausführungen

Maßgeblich ist die **tatsächliche Ausführung des Satzes** (`execution_mode`, `implement_count`, `side`, `reps_basis`), nicht der Default-Wert aus dem Übungskatalog. Die Katalog-Defaults sind Vorschläge für die Eingabe und werden von der Engine nicht gelesen.

### Bewegte Geräte pro Wiederholung

```text
implements_per_rep = execution_mode === "alternating" ? 1 : implement_count
```

Bei alternierender Ausführung wird pro Wiederholung genau ein Gerät bewegt, auch wenn zwei gehalten werden.

### Normalisierte Wiederholungen

```text
sides_trained = execution_mode === "alternating" ? 2 : 1
total_reps     = reps_basis === "per_side" ? reps * sides_trained : reps
```

Ein unilateraler Satz ist **ein** Datensatz für **eine** Seite; links und rechts sind zwei Satzdatensätze.

`reps_basis = "per_side"` zusammen mit `execution_mode = "bilateral_simultaneous"` ist widersprüchlich: beide Gliedmaßen bewegen sich gleichzeitig, eine Seitenzahl ist nicht bestimmbar. Status `invalid`, Grund `reps_basis_ambiguous_for_execution_mode`. Es wird **nicht** geraten.

### Last pro Wiederholung und nominales Satzvolumen

```text
load_per_rep       = load_basis === "per_implement" ? load_kg * implements_per_rep : load_kg
nominal_volume_set = load_per_rep * total_reps
```

### Geprüfte Beispiele

Jede Zeile ist in `tests/analytics-load.test.ts` als Testfall abgelegt.

| Fall | Satz                                                                                  | Rechnung              | Ergebnis | Kanal             |
| ---- | ------------------------------------------------------------------------------------- | --------------------- | -------- | ----------------- |
| A    | Langhantel, 70 kg `total`, 1 Gerät, bilateral, 10 Wdh. `total`                        | `70 × 10`             | 700 kg   | `free_weight`     |
| B    | Kurzhantel, 20 kg `per_implement`, 2 Geräte, bilateral, 10 Wdh. `total`               | `(20 × 2) × 10`       | 400 kg   | `free_weight`     |
| C    | Einarmiges Rudern rechts, 20 kg `per_implement`, 1 Gerät, unilateral, 10 Wdh. `total` | `20 × 10`             | 200 kg   | `free_weight`     |
| C    | dieselbe Übung links als zweiter Satzdatensatz                                        | `20 × 10`             | 200 kg   | `free_weight`     |
| C    | beide Seiten zusammen                                                                 | `200 + 200`           | 400 kg   | `free_weight`     |
| D    | Alternierende Curls, 12 kg `per_implement`, 2 Geräte, 10 Wdh. **`total`**             | `(12 × 1) × 10`       | 120 kg   | `free_weight`     |
| D    | dieselbe Übung, 10 Wdh. **`per_side`**                                                | `(12 × 1) × (10 × 2)` | 240 kg   | `free_weight`     |
| E    | Butterfly-Maschine, 60 kg `machine_display`, 10 Wdh. `total`                          | `60 × 10`             | 600 kg   | `machine_display` |
| F    | Klimmzüge, 10 kg `added`, 8 Wdh. `total`                                              | `10 × 8`              | 80 kg    | `added_external`  |
| –    | Klimmzüge `bodyweight_only`, 12 Wdh.                                                  | nicht berechenbar     | `null`   | keiner            |

Fall D ist der Grund, warum `reps_basis` nicht ignoriert werden darf: dieselben 12 kg und dieselbe „10“ ergeben 120 kg oder 240 kg.

Fall F ist der Grund, warum `added` nicht als Gesamtlast gilt: die tatsächlich bewegte Masse wäre Körpergewicht plus 10 kg, und das Körpergewicht ist in `arnold.training_raw` nicht enthalten.

## 6 Eignung von Workouts und Sätzen

| Ebene   | Regel                                                                                                                    |
| ------- | ------------------------------------------------------------------------------------------------------------------------ |
| Workout | Standardmäßig zählt nur `status = "completed"`. `planned`, `in_progress`, `cancelled` und `voided` zählen nicht.         |
| Workout | Der Filter `workout_statuses` kann die Auswahl absichtlich erweitern; der Standard bleibt `["completed"]`.               |
| Satz    | Nur `status = "active"`. Stornierte Sätze werden mit Grund `set_voided` ausgeschlossen.                                  |
| Satz    | Ein Satz ohne existierende Übung oder ohne existierendes Workout wird ausgeschlossen und als Integritätsbefund gemeldet. |

### Satztypen und Eimer

| `set_type`                 | Eimer          | Volumen | Rekorde und 1RM |
| -------------------------- | -------------- | ------- | --------------- |
| `warmup`                   | `warmup`       | ja      | nein            |
| `working`                  | `working`      | ja      | ja              |
| `drop`, `failure`, `other` | `supplemental` | ja      | nein            |

Begründung: Drop-, Fehler- und sonstige Sätze sind echte Arbeit und gehören ins Volumen, sind aber keine vergleichbaren Versuche. Ein Drop-Satz bei reduzierter Last darf keinen Lastrekord setzen, und ein Aufwärmsatz mit einer Wiederholung darf kein 1RM erzeugen. Diese Regel ist bewusst konservativ.

`volume.by_bucket` weist Aufwärm-, Arbeits- und Zusatzsätze getrennt aus.

## 7 Trainingsaktivität

Alle Kalenderzuordnungen verwenden `workout_date_local` wörtlich. UTC-Zeitstempel werden **nie** in Kalendertage umgerechnet.

| Kennzahl                         | Regel                                                                          |
| -------------------------------- | ------------------------------------------------------------------------------ |
| `workouts`                       | Anzahl geeigneter Workouts im Zeitraum                                         |
| `training_days`                  | Anzahl **verschiedener** Kalenderdaten mit mindestens einem geeigneten Workout |
| `average_workouts_per_week`      | `workouts / Anzahl Montagswochen des Zeitraums`                                |
| `average_training_days_per_week` | `training_days / Anzahl Montagswochen des Zeitraums`                           |
| `training_days_current_month`    | Trainingstage im Monat von `reference_date`                                    |
| `weeks[]`                        | Je Montagswoche: Workouts und Trainingstage                                    |

Zwei Workouts an einem Datum sind **zwei Einheiten** und **ein Trainingstag**.

### Wochenlogik

- Der Wochenbeginn ist **Montag**.
- Der Wochenschlüssel ist das Montagsdatum (`week_start`). Damit ist ein Bucket über einen Jahreswechsel hinweg eindeutig.
- `iso_year` und `iso_week` folgen ISO-8601: der Donnerstag einer Woche bestimmt ihr ISO-Jahr. Geprüfte Beispiele: `2026-01-01 → 2026-W01` (Montag 2025-12-29), `2026-12-31 → 2026-W53`, `2027-01-01 → 2026-W53`, `2027-01-04 → 2027-W01`.
- Wochen ohne Training bleiben als Nullbucket erhalten, damit eine Lücke sichtbar ist statt aus dem Diagramm zu verschwinden.

### Wochenstreak

- Ohne `weekly_goal_training_days` wird **kein** Streak gemeldet: `not_available` mit Grund `weekly_goal_not_configured`. Es gibt keine eingebaute Annahme von drei Trainingstagen.
- Die Woche von `reference_date` ist die **laufende** Woche. Sie zerstört einen in abgeschlossenen Wochen erreichten Streak nie und verlängert ihn erst, wenn ihr Ziel bereits erfüllt ist (`includes_current_week`).
- `completed_weeks_streak` zählt von der letzten abgeschlossenen Woche rückwärts, solange das Ziel erfüllt ist. Eine Woche ohne Eintrag hat null Trainingstage und beendet den Streak.
- `longest_streak` ist der längste Lauf erfüllter Wochen im betrachteten Bereich; die laufende Woche geht nur ein, wenn ihr Ziel erfüllt ist.
- `current_week_training_days` und `current_week_goal_met` werden immer separat ausgewiesen.

Später kann das Wochenziel aus Nutzereinstellungen oder aus `plans.days_per_week` stammen. Die Engine leitet es **nicht** automatisch ab, weil ein stillschweigend geratenes Ziel einen Streak erfindet; der Aufrufer übergibt es ausdrücklich.

## 8 Bestleistungen

### Vergleichbarkeitsschlüssel

```text
comparability.key = exercise_id | load_basis | execution_mode | implement_count | side?
```

`side` ist nur bei `execution_mode = "unilateral"` Teil des Schlüssels, weil links und rechts dort unterschiedliche Gliedmaßen sind. Bei bilateraler und alternierender Ausführung folgt `side` bereits aus dem Modus.

`reps_basis` ist **nicht** Teil des Schlüssels, weil es die Last nicht verändert. Für Wiederholungsrekorde wird stattdessen die normalisierte Wiederholungszahl pro Gliedmaße verwendet (siehe unten).

Ein einarmiger Curl rechts wird dadurch nie mit einem beidarmigen Curl verglichen, und eine Kurzhantellast pro Gerät nie mit einer Langhantel-Gesamtlast.

### Rekordtypen

| Metrik                    | Gruppe                          | Wert                                          | Einheit |
| ------------------------- | ------------------------------- | --------------------------------------------- | ------- |
| `max_load`                | Vergleichbarkeitsschlüssel      | `load_kg` wie dokumentiert, nicht umgerechnet | kg      |
| `max_reps_at_load`        | Schlüssel **und** konkrete Last | Wiederholungen pro Gliedmaße                  | reps    |
| `estimated_1rm`           | Vergleichbarkeitsschlüssel      | Höchste gültige Epley-Schätzung               | kg      |
| `exercise_workout_volume` | Übung **und** Volumenkanal      | Höchstes Volumen einer Übung in einer Einheit | kg      |

`max_load` gibt die dokumentierte Last unverändert aus; der Schlüssel fixiert `load_basis` und `implement_count`, und `load_reference` beschriftet den Wert. Eine `per_implement`-Last trägt zusätzlich den Grund `value_is_per_implement`, eine Maschinenlast `value_is_machine_specific`.

`exercise_workout_volume` summiert innerhalb einer Einheit **ohne Aufwärmsätze**, getrennt nach Kanal, damit ein Aufwärmblock keinen Volumenrekord erzeugt und Maschinen- nicht mit Freihantelvolumen vermischt wird. Dieser Rekordtyp hat bewusst keinen Vergleichbarkeitsschlüssel (`comparability: null`), weil eine Einheit mehrere Ausführungsvarianten derselben Übung enthalten kann; `exercise_id` und `channel` beschriften ihn.

Nur `working`-Sätze erzeugen Rekorde. Eigengewichts- und Unterstützungssätze erzeugen keine Last- und keine 1RM-Rekorde.

### PR-Regel und Tie-Breaker

- Der **erste** gültige Wert einer Gruppe wird als `kind: "initial"` gemeldet und bildet den Referenzwert.
- Ein **strikt höherer** Wert wird als `kind: "improvement"` mit `previous_value` und `improvement` gemeldet.
- Das **Wiederholen** eines bestehenden Rekords ist kein neuer Rekord. Datum und Satz bleiben beim **frühesten** Vorkommen, `occurrences` zählt hoch.
- Ein niedrigerer Wert lässt den Rekord unberührt.
- Bei gleichem Wert am gleichen Kalenderdatum entscheidet die stabile Satzreihenfolge: `workout_date_local`, dann `started_at_utc` oder ersatzweise `created_at_utc`, dann `workout_id`, dann `exercise_order`, `set_number`, `set_id`. Der erste Treffer dieser Ordnung behält den Rekord.
- `events_in_period` listet jedes Rekordereignis chronologisch, `max_load` und die anderen Arrays enthalten den jeweils **aktuellen** Rekord.

**Grenze:** Rekorde gelten innerhalb der analysierten Auswahl. Mit einem Datumsfilter sind die Referenzwerte die des Fensters. Ein echter Allzeitrekord erfordert einen Aufruf ohne Datumsfilter.

## 9 Geschätzte Maximalkraft

```text
estimated_1rm = load_kg × (1 + reps / 30)        für 2 ≤ reps ≤ 10
estimated_1rm = load_kg                          für reps = 1
```

Verbindliche Einschränkungen:

- Die Kennzahl ist eine **Schätzung** nach Epley, kein Messwert. Sie wird in `metric: "estimated_1rm"` und in den Gründen beschriftet.
- Wiederholungsbereich für v1: **1 bis 10**. Außerhalb: `not_available` mit Grund `reps_out_of_epley_range`. Oberhalb von zehn Wiederholungen wird Epley fachlich unzuverlässig; es wird kein Wert geraten.
- Nur `working`-Sätze. Sonst `set_type_not_working`.
- Keine Berechnung bei fehlender, nicht endlicher oder nicht positiver Last (`load_not_positive`).
- Keine Berechnung aus unklarer Gewichtsdefinition: `added` und `assistance` ergeben `load_basis_not_one_rm_comparable`, `bodyweight_only` ergibt `bodyweight_total_load_unavailable`.
- Bei `per_implement` wird die Last **nicht** verdoppelt. Das Ergebnis ist ein Wert **pro Gerät** und trägt den Grund `value_is_per_implement`.
- Maschinenwerte werden berechnet, aber als gerätespezifisch gekennzeichnet (`value_is_machine_specific`).
- Die für Epley maßgebliche Wiederholungszahl ist die Zahl der Wiederholungen **einer Gliedmaße in Folge**:

  | `execution_mode`         | `reps_basis` | Wiederholungen für Epley           |
  | ------------------------ | ------------ | ---------------------------------- |
  | `bilateral_simultaneous` | `total`      | `reps`                             |
  | `bilateral_simultaneous` | `per_side`   | widersprüchlich → `invalid`        |
  | `unilateral`             | `total`      | `reps`                             |
  | `unilateral`             | `per_side`   | `reps`                             |
  | `alternating`            | `per_side`   | `reps`                             |
  | `alternating`            | `total`      | nicht bestimmbar → `not_available` |

  Der letzte Fall ist `reps_per_side_ambiguous`: zehn alternierende Wiederholungen insgesamt wären fünf pro Seite, bei neun aber viereinhalb. Eine nicht ganzzahlige Wiederholungszahl ist keine zulässige Epley-Eingabe, und die Engine rundet hier nicht.

Aus 1RM-Schätzungen werden **keine** medizinischen oder sportwissenschaftlichen Aussagen, Empfehlungen oder Erfolgsversprechen abgeleitet.

## 10 Übungsfortschritt

Gruppierung erfolgt **ausschließlich über `exercise_id`**. Eine Übung behält damit eine durchgehende Historie, auch wenn sie den Split, die Session oder die Planversion gewechselt hat: Bankdrücken im Januar am Push-Tag und im April im Oberkörpertraining ist dieselbe Übungshistorie.

| Feld                          | Regel                                                                                                   |
| ----------------------------- | ------------------------------------------------------------------------------------------------------- |
| `first_training_date`         | Frühestes Datum mit einem geeigneten Satz dieser Übung                                                  |
| `last_training_date`          | Spätestes solches Datum                                                                                 |
| `workouts`                    | Anzahl verschiedener Workouts mit dieser Übung                                                          |
| `working_sets`, `warmup_sets` | Satzanzahl je Eimer                                                                                     |
| `last_working_load`           | Letzte **dokumentierte** Arbeitslast; es wird bis zum letzten Satz mit verwertbarer Last zurückgegangen |
| `max_comparable_load`         | Höchstlast innerhalb der dominanten Variante                                                            |
| `best_estimated_1rm`          | Beste gültige Epley-Schätzung innerhalb der dominanten Variante                                         |
| `nominal_volume`              | Nominales Volumen aller geeigneten Sätze dieser Übung                                                   |
| `variants[]`                  | Jede Ausführungsvariante mit Satzanzahl, Höchstlast und bestem 1RM                                      |

**Dominante Variante:** die Variante mit den meisten Arbeitssätzen. Tie-Breaker: höhere Maximallast, dann lexikografisch der Vergleichbarkeitsschlüssel. Grund: eine Schlagzeilenzahl darf keine Kurzhantellast pro Gerät mit einer Langhantel-Gesamtlast mischen. Die übrigen Varianten bleiben in `variants` vollständig erhalten.

### Serien für Recharts

```ts
type Series = {
  exercise_id: string | null;
  metric: string;
  unit: MetricUnit;
  load_reference: LoadReference | null;
  aggregation: "max" | "sum" | "mean" | "last";
  status: MetricStatus;
  reasons: AnalyticsReason[];
  points: { date: string; value: number }[]; // aufsteigend nach Datum
};
```

| Serie                       | Aggregation pro Datum | Grundmenge            |
| --------------------------- | --------------------- | --------------------- |
| `max_load`                  | `max`                 | dominante Variante    |
| `estimated_1rm`             | `max`                 | dominante Variante    |
| `nominal_volume`            | `sum`                 | alle geeigneten Sätze |
| `total_reps`                | `sum`                 | Arbeitssätze          |
| `mean_reps_per_working_set` | `mean`                | Arbeitssätze          |

Die Aggregationsregel ist Teil der Metrikdefinition. Mehrere Workouts am gleichen Datum werden dadurch zusammengefasst und **nie** gegenseitig überschrieben. `aggregation` steht in jeder Serie, damit ein Diagramm die Regel anzeigen kann.

`include_series: false` liefert alle Kennzahlen ohne Punkte, wenn eine schlanke Antwort gewünscht ist.

## 11 Planerfüllung

### Planhistorie

Eine Planversion gilt an einem lokalen Kalendertag `D`, wenn `activated_at_utc` gesetzt ist, ihr Datumsanteil `≤ D` liegt, und `retired_at_utc` entweder leer ist oder ihr Datumsanteil `> D` liegt. Eine Version ohne Aktivierung – etwa `status = "draft"` – gilt nie.

`activated_at_utc` und `retired_at_utc` sind UTC-Instanzen, das Trainingsdatum ist lokal. Verglichen wird daher nur der Datumsanteil. Ein Planwechsel genau am Tag eines Workouts wird der **neueren** Version zugerechnet. Das ist eine dokumentierte Näherung; ein zeitzonengenauer Vergleich wäre erst mit einer Instanzsemantik für das lokale Datum möglich.

Bei mehreren passenden Versionen entscheidet die höhere `version_no`, dann das spätere Aktivierungsdatum, dann die ID.

### Kennzahlen

| Kennzahl                              | Regel                                                                                         |
| ------------------------------------- | --------------------------------------------------------------------------------------------- |
| `planned_sessions`                    | Je Montagswoche des Zeitraums die `days_per_week` der zu Wochenbeginn geltenden Version       |
| `completed_attributable_workouts`     | Geeignete Workouts mit `plan_version_id` **und** existierender `session_id` in dieser Version |
| `unattributed_workouts`               | Geeignete Workouts ohne diese Zuordnung, etwa spontane Einheiten                              |
| `session_adherence_rate`              | `completed_attributable_workouts / planned_sessions`                                          |
| `planned_working_sets`                | Summe der `target_sets` der aktiven Planpositionen der **tatsächlich absolvierten** Sessions  |
| `completed_attributable_working_sets` | Arbeitssätze in zuordenbaren Workouts                                                         |
| `set_adherence_rate`                  | `completed_attributable_working_sets / planned_working_sets`                                  |
| `plan_windows[]`                      | Je Planversion die Wochen, in denen sie galt, und ihre geplanten Einheiten                    |
| `weeks_without_plan[]`                | Wochen ohne geltende Planversion                                                              |
| `deviations[]`                        | Abweichungen je zuordenbarem Workout                                                          |

**Keine erfundenen Kalendertage.** Ein Plan nennt nur eine Trainingshäufigkeit, keine verbindlichen Wochentage. Die Engine leitet daraus ausschließlich eine Wochenzahl ab und behauptet nie, an welchem Tag trainiert werden sollte. Wochen ohne geltende Version werden in `weeks_without_plan` gelistet, nicht aufgefüllt.

Erfüllungsquoten werden **nicht** auf 1 begrenzt: mehr Einheiten als geplant ergeben einen Wert über 1.

### Abweichungstypen

| `kind`                     | Bedeutung                                                          |
| -------------------------- | ------------------------------------------------------------------ |
| `missing_planned_exercise` | Geplante Übung der Session wurde in dieser Einheit nicht trainiert |
| `set_count_deviation`      | Geplante Übung trainiert, aber mit abweichender Arbeitssatzanzahl  |
| `unplanned_exercise`       | Trainierte Übung ist keine aktive Planposition dieser Session      |

Abweichungen werden nur für **zuordenbare** Workouts gemeldet. Für ein spontanes Workout ohne Planbezug wäre jede Übung „unplanned“, was keine Information trägt; solche Einheiten erscheinen in `unattributed_workouts`.

### Nicht berechenbare Erfüllungskennzahlen

- `days_per_week` fehlt: `planned_sessions` ist `not_available` mit `plan_days_per_week_not_configured`, die Quote ebenfalls. Es wird keine Häufigkeit geraten.
- `target_sets` fehlt: `planned_working_sets` ist `not_available` mit `plan_target_sets_not_configured`.
- Keine Planversion im Datensatz: der ganze Abschnitt ist `not_available` mit `no_plan_version_applicable`.
- Teilweise abgedeckter Zeitraum: Status `partial`, und die betroffenen Wochen stehen in `weeks_without_plan`.

Eine aus dem aktuellen Plan entfernte Übung (`plan_items.status = "removed"`) bleibt historisch gültig: ihre Sätze bleiben in Volumen, Rekorden und Fortschritt, sie zählt aber nicht mehr als geplante Position. `data_quality.removed_plan_items_in_use` weist das aus.

## 12 Wochen- und Monatsvergleiche

`weekly_trends.weekly[]` und `weekly_trends.monthly[]` enthalten je Bucket Einheiten, Trainingstage, Arbeitssätze, nominales Volumen und die Differenz zum Vorbucket. Fehlt ein Vorbucket oder ist einer der beiden Werte unbekannt, ist die Differenz `not_available` mit `no_previous_reference_value`. Buckets ohne Training bleiben als Nullbucket erhalten.

## 13 Filter

| Filter             | Typ                        | Wirkung                                                         |
| ------------------ | -------------------------- | --------------------------------------------------------------- |
| `from`, `to`       | `YYYY-MM-DD`, **inklusiv** | Grenzen auf `workout_date_local`                                |
| `exercise_ids`     | IDs                        | Begrenzt Sätze; ein Workout bleibt nur mit passendem Satz übrig |
| `plan_version_ids` | IDs                        | Begrenzt Workouts                                               |
| `session_ids`      | IDs                        | Begrenzt Workouts                                               |
| `workout_ids`      | IDs                        | Begrenzt Workouts                                               |
| `set_types`        | Satztypen                  | Begrenzt Sätze; ein Workout bleibt nur mit passendem Satz übrig |
| `workout_statuses` | Workout-Status             | Ersetzt den Standard `["completed"]`                            |

- Filter arbeiten ausschließlich mit **stabilen IDs**, nie mit Namen. Eine Übung, eine Session oder ein Plan darf umbenannt werden, ohne dass eine gespeicherte Auswertung oder ein gespeicherter Filter bricht.
- Setzt ein Filter Sätze ein (`exercise_ids`, `set_types`), bleiben nur Workouts mit mindestens einem passenden Satz geeignet. Damit bedeutet „Workouts“ unter einem Übungsfilter genau „Einheiten mit dieser Übung“.
- `metadata.filter` enthält den normalisierten Filter; IDs sind dedupliziert.
- Ungültige Filter erzeugen `AnalyticsFilterError`: kein echtes Kalenderdatum, `from` nach `to`, leere ID-Liste, unbekannter Satztyp oder Status.
- Ein gültiger Filter ohne Treffer liefert gültige leere Objekte: `workouts = 0`, `nominal_volume = 0`, leere Arrays, `data_quality.analyzable = false`.

## 14 Behandlung fehlender Informationen

| Situation                                   | Ergebnis                                                                |
| ------------------------------------------- | ----------------------------------------------------------------------- |
| Keine geeigneten Workouts                   | Zählwerte `0`, Mittelwerte `not_available` mit `no_eligible_workouts`   |
| Geeignete Workouts ohne Sätze               | Volumen `0` – ein echter Nullwert –, `no_eligible_sets` in der Qualität |
| Alle geeigneten Sätze nicht berechenbar     | Volumen `null` mit `not_available`, **nie** `0`                         |
| Einzelne Sätze nicht berechenbar            | Volumen `partial` mit Abdeckung und Gründen                             |
| Widersprüchliche Ausführung                 | `invalid`, kein Wert                                                    |
| Last überschreitet den Zahlenbereich        | `invalid` bzw. `not_available` mit `volume_not_finite`; nie `Infinity`  |
| Doppelte oder ins Leere zeigende Referenzen | Satz ausgeschlossen, `data_quality.integrity_defects` zählt den Befund  |

`data_quality` enthält zusätzlich Statusverteilungen über den gesamten Datensatz (`workouts_by_status`, `sets_by_status`, `sets_by_type`), die Eignungs- und Berechenbarkeitszahlen, die Ausschlussgründe (`set_exclusions`), die Vorbehalte berechenbarer Sätze (`set_caveats`) sowie Hinweise auf `retired`-Übungen und `removed`-Planpositionen, die historisch weiterhin verwendet werden.

### Gründe

Alle Gründe sind in `AnalyticsReasonSchema` abschließend aufgezählt. Auswahl:

| Grund                                     | Bedeutung                                                   |
| ----------------------------------------- | ----------------------------------------------------------- |
| `bodyweight_total_load_unavailable`       | Körpermasse unbekannt, Gesamtlast nicht bestimmbar          |
| `assistance_load_not_volume_comparable`   | Unterstützung reduziert die Last und ergibt kein Volumen    |
| `added_load_total_unavailable`            | Zusatzlast berechnet, Gesamtlast unbekannt                  |
| `machine_load_not_free_weight_comparable` | Maschinenlast nicht mit freien Gewichten vergleichbar       |
| `value_is_per_implement`                  | Wert gilt pro Gerät, nicht als Gesamtlast                   |
| `value_is_machine_specific`               | Wert gilt für dieses Gerät                                  |
| `reps_basis_ambiguous_for_execution_mode` | `per_side` bei gleichzeitig bilateraler Ausführung          |
| `reps_per_side_ambiguous`                 | Alternierende Gesamtwiederholungen nicht je Seite auflösbar |
| `reps_out_of_epley_range`                 | Wiederholungen außerhalb von 1 bis 10                       |
| `load_basis_not_one_rm_comparable`        | Gewichtsdefinition für eine 1RM-Schätzung nicht geeignet    |
| `weekly_goal_not_configured`              | Kein Wochenziel übergeben                                   |
| `plan_days_per_week_not_configured`       | Plan nennt keine Trainingshäufigkeit                        |
| `plan_target_sets_not_configured`         | Planposition nennt keine Satzvorgabe                        |
| `no_plan_version_applicable`              | Keine geltende Planversion                                  |
| `no_previous_reference_value`             | Kein Vergleichswert vorhanden                               |

## 15 Beispielergebnisse

Erzeugt aus einem synthetischen Datensatz mit zwei Einheiten: Langhantelpresse mit 70 kg × 10 und 72,5 kg × 8 am 2026-01-05 nach Plan, einarmiges Rudern 30 kg pro Gerät × 10 je Seite und ein Eigengewichtssatz am 2026-01-08 ohne Plan; `reference_date` 2026-01-09, Wochenziel zwei Trainingstage.

Nominales Volumen mit Abdeckung – der Eigengewichtssatz ist unbekannt, nicht null:

```json
{
  "metric": "nominal_volume",
  "value": 1880,
  "unit": "kg",
  "status": "partial",
  "reasons": ["bodyweight_total_load_unavailable"],
  "coverage": {
    "eligible_sets": 5,
    "included_sets": 4,
    "excluded_sets": 1,
    "excluded_reasons": ["bodyweight_total_load_unavailable"]
  }
}
```

Ein Lastrekord mit vollständiger Vergleichbarkeit und Vorgängerwert:

```json
{
  "metric": "max_load",
  "exercise_id": "ex-bar-press",
  "comparability": {
    "key": "ex-bar-press|total|bilateral_simultaneous|1|-",
    "exercise_id": "ex-bar-press",
    "load_basis": "total",
    "execution_mode": "bilateral_simultaneous",
    "implement_count": 1,
    "side": null
  },
  "load_reference": "total",
  "channel": "free_weight",
  "value": 72.5,
  "unit": "kg",
  "at_load_kg": 72.5,
  "reps": 8,
  "achieved_on": "2026-01-05",
  "workout_id": "w-1",
  "set_id": "s-2",
  "previous_value": 70,
  "improvement": 2.5,
  "kind": "improvement",
  "occurrences": 1,
  "status": "valid",
  "reasons": []
}
```

Das einarmige Rudern erzeugt **zwei** Rekorde mit den Schlüsseln `ex-db-row|per_implement|unilateral|1|right` und `…|left`, beide mit Grund `value_is_per_implement`.

Eine Verlaufsserie; `70 × (1 + 10/30) = 93,333333`:

```json
{
  "exercise_id": "ex-bar-press",
  "metric": "estimated_1rm",
  "unit": "kg",
  "load_reference": "total",
  "aggregation": "max",
  "status": "valid",
  "reasons": [],
  "points": [{ "date": "2026-01-05", "value": 93.333333 }]
}
```

Planerfüllung – zwei geplante Einheiten in einer Woche, eine davon zuordenbar absolviert:

```json
{
  "planned_sessions": { "value": 2, "unit": "workouts", "status": "valid" },
  "completed_attributable_workouts": {
    "value": 1,
    "unit": "workouts",
    "status": "valid"
  },
  "session_adherence_rate": { "value": 0.5, "unit": "ratio", "status": "valid" }
}
```

Datenqualität:

```json
{
  "analyzable": true,
  "status": "partial",
  "reasons": ["bodyweight_total_load_unavailable"],
  "eligible_workouts": 2,
  "eligible_sets": 5,
  "computable_sets": 4,
  "set_exclusions": { "bodyweight_total_load_unavailable": 1 }
}
```

## 16 Bekannte Grenzen und bewusst nicht unterstützte Berechnungen

**Grundsatz:** Nominales Trainingsvolumen ist eine konventionelle Dokumentationskennzahl, kein physiologischer Messwert. Unterschiedliche Maschinen, Übungen und Ausführungen sind nicht zwangsläufig direkt vergleichbar. Die Engine liefert nachvollziehbare Zahlen, keine Trainingsbewertung.

Bewusst **nicht** umgesetzt:

- **Körpergewicht und effektive Eigengewichtslast.** `arnold.training_raw` enthält keine Körpermasse. Eigengewichtsvolumen, Eigengewichts-1RM und die bewegte Gesamtlast bei `added` bleiben `not_available`. Das ist die größte offene Rohdatenlücke.
- **Unterstützungsrekorde.** Für `assistance` wäre weniger Last besser; eine invertierte Rekordlogik ist nicht definiert.
- **Übergreifende Vergleichbarkeit.** `family_key` ist freier Gruppierungstext ohne Leistungsäquivalenz. Varianten einer Familie werden nicht zu einem Rekord zusammengefasst.
- **Maschinenkalibrierung.** Eine Maschinenanzeige wird nicht in eine physikalische Last umgerechnet.
- **1RM über zehn Wiederholungen** und andere Formeln als Epley.
- **Allzeitrekorde unter einem Datumsfilter.** Referenzwerte stammen immer aus der analysierten Auswahl.
- **Verbindliche Plan-Wochentage.** Das Schema kennt nur `days_per_week`; konkrete Kalendertage werden nicht erfunden.
- **Zeitzonengenauer Planwechsel.** Für die Planzuordnung wird nur der Datumsanteil der UTC-Zeitstempel verglichen.
- **Automatisches Wochenziel.** Ohne ausdrücklichen Parameter kein Streak.
- **Belastungssteuerung, Ermüdungsmodelle, Progressionsvorschläge, Trainingsempfehlungen** sowie jede medizinische oder sportwissenschaftliche Bewertung.
- **Anbindung.** Die Engine ist weder an MCP-Tools noch an die React-Oberfläche angeschlossen; das ist Gegenstand eines separaten Arbeitspakets.

Weitere Einschränkung: Drop-, Fehler- und sonstige Sätze zählen ins Volumen, aber nicht in Rekorde und 1RM. Diese konservative Entscheidung kann eine echte Bestleistung aus einem `failure`-Satz übersehen. Eine Änderung erfordert eine neue `metrics_version`.

## 17 Prüfstand

```bash
npm run typecheck
npm test
npm run build
npm run test:e2e
npm run format:check
```

Testdateien der Engine:

| Datei                                  | Abdeckung                                                           |
| -------------------------------------- | ------------------------------------------------------------------- |
| `tests/analytics-load.test.ts`         | Beispiele A–F, Gewichtskonventionen, Ausführungen, Epley-Grenzen    |
| `tests/analytics-volume.test.ts`       | Kanäle, Satzeimer, Abdeckung, Gruppierungen, Nullbuckets            |
| `tests/analytics-activity.test.ts`     | Trainingstage, Wochen-/Jahresgrenze, Status, Frequenz, Streak       |
| `tests/analytics-records.test.ts`      | Erster PR, Verbesserung, Wiederholung, Varianten, Planwechsel       |
| `tests/analytics-progress.test.ts`     | Verlauf, Serienaggregation, Varianten, leere Auswahl                |
| `tests/analytics-plans.test.ts`        | Planhistorie, Erfüllung, Abweichungen, fehlende Vorgaben            |
| `tests/analytics-dashboard.test.ts`    | DTO, Filter, Fehlerfälle, Datenqualität, Determinismus, Extremwerte |
| `tests/analytics-architecture.test.ts` | Architekturgrenzen der Schicht                                      |
| `tests/fixtures/arnold-analytics.ts`   | Vollständig synthetische Datensatz-Bauteile                         |

Alle Fixtures sind erfunden. Es werden keine echten Trainingsdaten und keine Einträge aus der Masterdatei verwendet.
