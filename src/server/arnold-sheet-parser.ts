import { z } from "zod";
import {
  ARNOLD_TABLES,
  ARNOLD_TABLE_HEADERS,
  ArnoldConfigSchema,
  ArnoldConfigEntrySchema,
  ArnoldExerciseSchema,
  ArnoldPlanVersionSchema,
  ArnoldPlanItemSchema,
  ArnoldWorkoutSchema,
  ArnoldSetSchema,
  ArnoldDatasetSchema,
  type ArnoldDataset,
  type ArnoldTable,
} from "../shared/arnold-schema-v1.js";

export type ArnoldSheetCell = string | number | boolean | null;
export type ArnoldTableValues = Readonly<
  Record<ArnoldTable, readonly (readonly ArnoldSheetCell[])[]>
>;
export interface ArnoldDataIssue {
  readonly code: string;
  readonly table?: ArnoldTable;
  readonly row?: number;
  readonly column?: string;
  readonly message: string;
}
export class ArnoldDataError extends Error {
  readonly issues: readonly ArnoldDataIssue[];
  constructor(issues: readonly ArnoldDataIssue[]) {
    const visible = issues.slice(0, 100);
    super(
      visible
        .map(
          (issue) =>
            [
              issue.table,
              issue.row === undefined ? undefined : `Zeile ${issue.row}`,
              issue.column,
            ]
              .filter(Boolean)
              .join(" / ") + `: ${issue.message}`,
        )
        .join("\n"),
    );
    this.name = "ArnoldDataError";
    this.issues = Object.freeze(
      visible.map((issue) => Object.freeze({ ...issue })),
    );
  }
}
const schemas = {
  CONFIG: ArnoldConfigEntrySchema,
  EXERCISES: ArnoldExerciseSchema,
  PLANS: ArnoldPlanVersionSchema,
  PLAN_ITEMS: ArnoldPlanItemSchema,
  WORKOUTS: ArnoldWorkoutSchema,
  SETS: ArnoldSetSchema,
} as const;
const numberColumns = new Set([
  "default_implement_count",
  "row_revision",
  "version_no",
  "days_per_week",
  "session_order",
  "exercise_order",
  "target_sets",
  "rep_min",
  "rep_max",
  "target_load_kg",
  "target_implement_count",
  "rest_seconds",
  "set_number",
  "reps",
  "load_kg",
  "implement_count",
  "rpe",
  "rir",
]);
const isBlank = (cell: ArnoldSheetCell | undefined) =>
  cell === undefined || cell === null || cell === "";
const numeric = (cell: ArnoldSheetCell): unknown => {
  if (typeof cell === "number") return cell;
  // UNFORMATTED/FORMULA values are native numbers. Accept unambiguous base-10 text too;
  // never parse booleans, hexadecimal, localized punctuation or prefixes with parseFloat.
  if (
    typeof cell === "string" &&
    /^-?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(cell)
  )
    return Number(cell);
  return cell;
};
export function arnoldColumnLetter(index: number): string {
  let result = "";
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26))
    result = String.fromCharCode(65 + ((n - 1) % 26)) + result;
  return result;
}
function fail(issues: readonly ArnoldDataIssue[]): never {
  throw new ArnoldDataError(issues);
}

/** Pure parser: keeps IDs, raw loads, execution definitions, nullable values and tombstones. */
export function parseArnoldTables(tables: ArnoldTableValues): ArnoldDataset {
  const actual = Object.keys(tables);
  if (
    actual.length !== ARNOLD_TABLES.length ||
    ARNOLD_TABLES.some((table) => !Object.hasOwn(tables, table))
  )
    fail([
      {
        code: "TABLES",
        message:
          "Genau CONFIG, EXERCISES, PLANS, PLAN_ITEMS, WORKOUTS und SETS erforderlich.",
      },
    ]);
  const parsed: Partial<Record<ArnoldTable, unknown[]>> = {};
  const physicalRows: Partial<Record<ArnoldTable, number[]>> = {};
  for (const table of ARNOLD_TABLES) {
    const rows = tables[table],
      headers = ARNOLD_TABLE_HEADERS[table];
    const header = rows[0] ?? [];
    const headerIssues: ArnoldDataIssue[] = [];
    headers.forEach((name, i) => {
      if (header[i] !== name)
        headerIssues.push({
          code: "HEADER",
          table,
          row: 1,
          column: arnoldColumnLetter(i),
          message: `Pflichtspalte ${name} fehlt oder steht nicht an der vorgesehenen Position.`,
        });
    });
    if (header.slice(headers.length).some((cell) => !isBlank(cell)))
      headerIssues.push({
        code: "HEADER",
        table,
        row: 1,
        message: "Zusätzliche unbekannte Spaltenüberschrift.",
      });
    if (headerIssues.length) fail(headerIssues);
    const values: unknown[] = [],
      positions: number[] = [];
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      if (row.every(isBlank)) continue;
      if (row.slice(headers.length).some((cell) => !isBlank(cell)))
        fail([
          {
            code: "EXTRA_CELL",
            table,
            row: i + 1,
            message: "Daten außerhalb der definierten Spalten.",
          },
        ]);
      const formulaColumn = row.findIndex(
        (cell) => typeof cell === "string" && cell.startsWith("="),
      );
      if (formulaColumn !== -1)
        fail([
          {
            code: "FORMULA",
            table,
            row: i + 1,
            column: headers[formulaColumn],
            message: "Formeln sind im Rohdatenschema nicht zulässig.",
          },
        ]);
      const value = Object.fromEntries(
        headers.map((name, column) => {
          const cell = row[column];
          return [
            name,
            isBlank(cell)
              ? null
              : numberColumns.has(name)
                ? numeric(cell!)
                : cell,
          ];
        }),
      );
      const validated = schemas[table].safeParse(value);
      if (!validated.success)
        fail(
          validated.error.issues.map((issue) => ({
            code: "VALUE",
            table,
            row: i + 1,
            column:
              typeof issue.path[0] === "string" ? issue.path[0] : undefined,
            message: issue.message,
          })),
        );
      values.push(validated.data);
      positions.push(i + 1);
    }
    parsed[table] = values;
    physicalRows[table] = positions;
  }
  const entries = parsed.CONFIG as z.infer<typeof ArnoldConfigEntrySchema>[];
  const keyRows = new Map<string, number>();
  entries.forEach((entry, i) => {
    if (keyRows.has(entry.key))
      fail([
        {
          code: "DUPLICATE_CONFIG_KEY",
          table: "CONFIG",
          row: physicalRows.CONFIG![i],
          column: "key",
          message: "Doppelter CONFIG-Schlüssel.",
        },
      ]);
    if (!Object.hasOwn(ArnoldConfigSchema.unwrap().shape, entry.key))
      fail([
        {
          code: "CONFIG",
          table: "CONFIG",
          row: physicalRows.CONFIG![i],
          column: "key",
          message: "Unbekannter CONFIG-Schlüssel für Schema v1.",
        },
      ]);
    keyRows.set(entry.key, physicalRows.CONFIG![i]);
  });
  const config = ArnoldConfigSchema.safeParse(
    Object.fromEntries(entries.map((entry) => [entry.key, entry.value])),
  );
  if (!config.success)
    fail(
      config.error.issues.map((issue) => ({
        code: "CONFIG",
        table: "CONFIG",
        row: keyRows.get(String(issue.path[0])),
        column: "value",
        message: issue.path[0]
          ? `${String(issue.path[0])}: ${issue.message}`
          : issue.message,
      })),
    );
  const dataset = ArnoldDatasetSchema.safeParse({
    config: config.data,
    configEntries: entries,
    exercises: parsed.EXERCISES,
    plans: parsed.PLANS,
    planItems: parsed.PLAN_ITEMS,
    workouts: parsed.WORKOUTS,
    sets: parsed.SETS,
  });
  const tableByField = {
    config: "CONFIG",
    configEntries: "CONFIG",
    exercises: "EXERCISES",
    plans: "PLANS",
    planItems: "PLAN_ITEMS",
    workouts: "WORKOUTS",
    sets: "SETS",
  } as const;
  if (!dataset.success)
    fail(
      dataset.error.issues.map((issue) => {
        const table = tableByField[issue.path[0] as keyof typeof tableByField];
        const row =
          issue.path[0] === "config"
            ? keyRows.get(String(issue.path[1]))
            : typeof issue.path[1] === "number"
              ? physicalRows[table]?.[issue.path[1]]
              : undefined;
        return {
          code: "DATASET",
          table,
          row,
          column:
            typeof issue.path.at(-1) === "string"
              ? String(issue.path.at(-1))
              : undefined,
          message: issue.message,
        };
      }),
    );
  return dataset.data;
}
