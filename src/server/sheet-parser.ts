import { createHash } from "node:crypto";
import {
  DateSchema,
  SetSchema,
  SplitSchema,
  type Snapshot,
  type Split,
} from "../shared/schemas.js";

type Cell = string | number | boolean | null;
export interface SheetRows {
  inputRows: Cell[][];
  computedRows: Cell[][];
  headerRow: number;
  spreadsheetId: string;
  sheetId: number;
  spreadsheetTitle: string;
  sheetTitle: string;
  fetchedAt: string;
}
const clean = (value: Cell | undefined) =>
  String(value ?? "")
    .normalize("NFKC")
    .trim();
const stableId = (kind: string, value: string) =>
  `${kind}-${createHash("sha256").update(value).digest("hex").slice(0, 24)}`;
const number = (value: Cell | undefined): number | undefined => {
  if (value === null || value === undefined || clean(value) === "")
    return undefined;
  if (typeof value === "number")
    return Number.isFinite(value) ? value : undefined;
  const normalized = clean(value).replace(/\s/g, "").replace(",", ".");
  if (!/^-?\d+(\.\d+)?$/.test(normalized)) return undefined;
  const result = Number(normalized);
  return Number.isFinite(result) ? result : undefined;
};
export function sheetDate(value: Cell | undefined): string {
  let result: string;
  if (typeof value === "number") {
    // Google Sheets stores dates as days since 1899-12-30. Fractions are times.
    result = new Date(Date.UTC(1899, 11, 30) + Math.floor(value) * 86400000)
      .toISOString()
      .slice(0, 10);
  } else {
    const text = clean(value);
    const german = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(text);
    result = german
      ? `${german[3]}-${german[2].padStart(2, "0")}-${german[1].padStart(2, "0")}`
      : text;
  }
  DateSchema.parse(result);
  if (result < "2000-01-01" || result > "2100-12-31")
    throw new Error("Datum außerhalb des unterstützten Bereichs 2000–2100.");
  return result;
}
const requiredInputHeaders = [
  "Datum",
  "Einheit",
  "Übung",
  "Satz",
  "Wdh.",
  "Gewicht / Zusatz (kg)",
  "RPE",
];
const requiredComputedHeaders = [
  "Typ",
  "Effektive Last (kg)",
  "Satz-ID",
  "Duplikat",
  "Zeile ok",
];

/** Reads only the authorized Trainingslog columns A:G and O:S, never notes or other tabs. */
export function parseTrainingSheet(rows: SheetRows): Snapshot {
  if (
    !requiredInputHeaders.every(
      (name, i) => clean(rows.inputRows[0]?.[i]) === name,
    ) ||
    !requiredComputedHeaders.every(
      (name, i) => clean(rows.computedRows[0]?.[i]) === name,
    )
  ) {
    throw new Error(
      "Die Spaltenstruktur von Trainingslog hat sich geändert. Erwartet: Eingaben A:G und berechnete Spalten O:S in der konfigurierten Kopfzeile.",
    );
  }
  const snapshot: Snapshot = {
    version: 1,
    exercises: [],
    workouts: [],
    sets: [],
    requests: {},
  };
  const exercises = new Set<string>(),
    workouts = new Set<string>(),
    setKeys = new Set<string>();
  const warnings: string[] = [];
  let rowCount = 0,
    skippedRows = 0;
  const skip = (row: number, reason: string) => {
    skippedRows++;
    if (warnings.length < 20) warnings.push(`Zeile ${row}: ${reason}`);
  };
  for (let i = 1; i < rows.inputRows.length; i++) {
    const input = rows.inputRows[i] ?? [];
    if (input.every((value) => clean(value) === "")) continue;
    rowCount++;
    const rowNumber = rows.headerRow + i;
    const computed = rows.computedRows[i] ?? [];
    if (clean(computed[3])) {
      skip(rowNumber, "als Duplikat markiert; nicht doppelt gezählt.");
      continue;
    }
    if (clean(computed[4]).toLowerCase() !== "ok") {
      skip(rowNumber, "unvollständiger oder nicht freigegebener Satz.");
      continue;
    }
    try {
      const date = sheetDate(input[0]);
      const splitText = clean(input[1]);
      const split: Split = SplitSchema.parse(
        splitText === "Beine" ? "Legs" : splitText,
      );
      const exerciseName = clean(input[2]);
      if (!exerciseName || exerciseName.length > 200)
        throw new Error("Übung fehlt oder ist zu lang.");
      const type = clean(computed[0]);
      if (type !== "Gewicht" && type !== "Eigengewicht")
        throw new Error("Unbekannter Lasttyp.");
      const effective = number(computed[1]);
      const kg =
        type === "Eigengewicht" ? effective : (effective ?? number(input[5]));
      if (kg === undefined) throw new Error("Effektive Last fehlt.");
      const setNumber = number(input[3]);
      const reps = number(input[4]);
      const rpe = number(input[6]);
      if (clean(input[6]) && rpe === undefined)
        throw new Error("RPE ist keine Zahl.");
      const exerciseId = stableId(
        "sheet-exercise",
        exerciseName.toLocaleLowerCase("de-DE"),
      );
      const workoutId = `${date}-${split.toLowerCase()}`;
      const key =
        clean(computed[2]) || `${date}|${split}|${exerciseId}|${setNumber}`;
      if (setKeys.has(key)) {
        skip(rowNumber, "identische Satz-ID; nicht doppelt gezählt.");
        continue;
      }
      const set = SetSchema.parse({
        id: stableId(
          "sheet-set",
          `${rows.spreadsheetId}|${rows.sheetId}|${key}`,
        ),
        workoutId,
        exerciseId,
        setNumber,
        kg,
        reps,
        ...(rpe === undefined ? {} : { rpe }),
      });
      setKeys.add(key);
      if (!exercises.has(exerciseId)) {
        snapshot.exercises.push({ id: exerciseId, name: exerciseName, split });
        exercises.add(exerciseId);
      }
      if (!workouts.has(workoutId)) {
        snapshot.workouts.push({ id: workoutId, date, split });
        workouts.add(workoutId);
      }
      snapshot.sets.push(set);
    } catch {
      // Never copy private cell contents into tool errors, logs, or diagnostics.
      skip(
        rowNumber,
        "Datum, Übung, Last, Satznummer, Wiederholungen oder RPE ungültig.",
      );
    }
  }
  snapshot.connection = {
    provider: "google_sheets",
    synthetic: false,
    readOnly: true,
    spreadsheetTitle: rows.spreadsheetTitle,
    sheetTitle: rows.sheetTitle,
    fetchedAt: rows.fetchedAt,
    rowCount,
    skippedRows,
    warnings,
  };
  return snapshot;
}
