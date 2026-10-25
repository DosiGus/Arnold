import type { ArnoldSheetCell } from "../../src/server/arnold-sheet-parser";
import type { ArnoldSheetsReadTransport } from "../../src/server/arnold-sheets-read-adapter";
// Header vectors are an independent transcription of the published v1 contract.
// Every catalog name, stable ID, plan and training value below is newly invented test data.
export const V1_HEADERS = {
  CONFIG: ["key", "value", "description"],
  EXERCISES: [
    "exercise_id",
    "name_de",
    "name_en",
    "family_key",
    "variant_key",
    "equipment",
    "primary_muscle",
    "default_load_basis",
    "default_execution_mode",
    "default_implement_count",
    "status",
    "created_at_utc",
    "updated_at_utc",
    "row_revision",
  ],
  PLANS: [
    "plan_version_id",
    "plan_family_id",
    "version_no",
    "name",
    "split_key",
    "status",
    "goal_key",
    "days_per_week",
    "activated_at_utc",
    "retired_at_utc",
    "created_at_utc",
    "updated_at_utc",
    "row_revision",
  ],
  PLAN_ITEMS: [
    "plan_item_id",
    "plan_version_id",
    "session_id",
    "session_order",
    "session_name",
    "exercise_id",
    "exercise_order",
    "target_sets",
    "rep_min",
    "rep_max",
    "target_load_kg",
    "target_load_basis",
    "target_execution_mode",
    "target_implement_count",
    "rest_seconds",
    "notes",
    "status",
    "row_revision",
  ],
  WORKOUTS: [
    "workout_id",
    "workout_date_local",
    "timezone",
    "started_at_utc",
    "ended_at_utc",
    "plan_version_id",
    "session_id",
    "session_name_snapshot",
    "status",
    "source",
    "notes",
    "created_at_utc",
    "updated_at_utc",
    "row_revision",
  ],
  SETS: [
    "set_id",
    "workout_id",
    "exercise_id",
    "plan_item_id",
    "exercise_name_snapshot",
    "exercise_order",
    "set_number",
    "set_type",
    "reps",
    "reps_basis",
    "load_kg",
    "load_basis",
    "implement_count",
    "execution_mode",
    "side",
    "rpe",
    "rir",
    "notes",
    "status",
    "source",
    "created_at_utc",
    "updated_at_utc",
    "row_revision",
  ],
} as const;
export type FixtureTable = keyof typeof V1_HEADERS;
export type V1Tables = Record<FixtureTable, ArnoldSheetCell[][]>;
export const fixtureFileId = "synthetic-arnold-v1-workbook";
export const stamp = "2026-10-01T12:00:00Z";
export const technical = {
  created_at_utc: stamp,
  updated_at_utc: stamp,
  row_revision: 1,
};
export const configValues = {
  schema_id: "arnold.training_raw",
  schema_version: "1.0.0",
  template_version: "1.0.0",
  file_role: "USER_TRACKER",
  tracker_id: "synthetic-user-tracker",
  unit_mass: "kg",
  date_storage: "ISO-8601",
  raw_data_policy: "NO_CALCULATED_COLUMNS",
  onboarding_storage: "BACKEND_ONLY",
  plan_history: "IMMUTABLE_VERSION_IDS",
  write_policy: "MCP_BACKEND_ONLY",
  master_data_policy: "NO_REAL_USER_DATA",
  deleted_record_policy: "TOMBSTONE",
  schema_fingerprint: "CONFIG|EXERCISES|PLANS|PLAN_ITEMS|WORKOUTS|SETS",
};
export function row(
  table: FixtureTable,
  values: Record<string, ArnoldSheetCell>,
): ArnoldSheetCell[] {
  return V1_HEADERS[table].map((key) => values[key] ?? null);
}
export function setCell(
  tables: V1Tables,
  table: FixtureTable,
  record: number,
  column: string,
  value: ArnoldSheetCell,
) {
  const index = (V1_HEADERS[table] as readonly string[]).indexOf(column);
  if (index < 0) throw Error("Invalid fixture column");
  tables[table][record + 1][index] = value;
}
export function setConfig(tables: V1Tables, key: string, value: string) {
  const r = tables.CONFIG.find((r) => r[0] === key);
  if (!r) throw Error("Unknown fixture setting");
  r[1] = value;
}
export const setBase = {
  ...technical,
  set_id: "test-set-1",
  workout_id: "test-workout-1",
  exercise_id: "test-exercise-db",
  plan_item_id: "test-item-v1",
  exercise_name_snapshot: "Historischer Testname",
  exercise_order: 1,
  set_number: 1,
  set_type: "working",
  reps: 10,
  reps_basis: "total",
  load_kg: 20.123456789,
  load_basis: "per_implement",
  implement_count: 2,
  execution_mode: "bilateral_simultaneous",
  side: "both",
  rpe: 8,
  rir: 2,
  notes: null,
  status: "active",
  source: "chat",
};
export function v1Tables(): V1Tables {
  const tables = Object.fromEntries(
    Object.entries(V1_HEADERS).map(([key, header]) => [key, [[...header]]]),
  ) as V1Tables;
  tables.CONFIG.push(
    ...Object.entries(configValues).map(([key, value]) => [
      key,
      value,
      `Synthetic ${key}`,
    ]),
  );
  tables.EXERCISES.push(
    ...[
      {
        exercise_id: "test-exercise-db",
        name_de: "Umbenannte Test-Presse",
        name_en: null,
        family_key: "test_press",
        variant_key: "test_db",
        equipment: "dumbbell",
        primary_muscle: "chest",
        default_load_basis: "per_implement",
        default_execution_mode: "bilateral_simultaneous",
        default_implement_count: 2,
        status: "retired",
      },
      {
        exercise_id: "test-exercise-bar",
        name_de: "Test-Langhantel",
        name_en: "Test bar",
        family_key: "test_press",
        variant_key: "test_bar",
        equipment: "barbell",
        primary_muscle: "chest",
        default_load_basis: "total",
        default_execution_mode: "bilateral_simultaneous",
        default_implement_count: 1,
        status: "active",
      },
    ].map((exercise) => row("EXERCISES", { ...technical, ...exercise })),
  );
  for (const [version, status] of [
    [1, "archived"],
    [2, "active"],
    [3, "draft"],
  ] as const) {
    tables.PLANS.push(
      row("PLANS", {
        ...technical,
        plan_version_id: `test-plan-v${version}`,
        plan_family_id: "test-plan-family",
        version_no: version,
        name: `Freier Testplan ${version}`,
        split_key: "custom_full_body",
        status,
        goal_key: null,
        days_per_week: 2,
        activated_at_utc: version === 3 ? null : stamp,
        retired_at_utc: version === 1 ? stamp : null,
      }),
    );
    tables.PLAN_ITEMS.push(
      row("PLAN_ITEMS", {
        plan_item_id: `test-item-v${version}`,
        plan_version_id: `test-plan-v${version}`,
        session_id: `test-session-v${version}`,
        session_order: 1,
        session_name: "Gleicher frei gewählter Name",
        exercise_id: "test-exercise-db",
        exercise_order: 1,
        target_sets: 3,
        rep_min: 8,
        rep_max: 12,
        target_load_kg: 20,
        target_load_basis: "per_implement",
        target_execution_mode: "bilateral_simultaneous",
        target_implement_count: 2,
        rest_seconds: 90,
        notes: null,
        status: "active",
        row_revision: 1,
      }),
    );
  }
  tables.WORKOUTS.push(
    row("WORKOUTS", {
      ...technical,
      workout_id: "test-workout-1",
      workout_date_local: "2026-10-02",
      timezone: "Pacific/Auckland",
      started_at_utc: "2026-10-01T12:00:00Z",
      ended_at_utc: null,
      plan_version_id: "test-plan-v1",
      session_id: "test-session-v1",
      session_name_snapshot: "Historische Einheit",
      status: "completed",
      source: "chat",
      notes: null,
    }),
    row("WORKOUTS", {
      ...technical,
      workout_id: "test-workout-adhoc",
      workout_date_local: "2026-10-02",
      timezone: "Europe/Berlin",
      started_at_utc: null,
      ended_at_utc: null,
      plan_version_id: null,
      session_id: null,
      session_name_snapshot: null,
      status: "in_progress",
      source: "ui",
      notes: null,
    }),
  );
  tables.SETS.push(
    row("SETS", setBase),
    row("SETS", {
      ...setBase,
      set_id: "test-set-bar",
      workout_id: "test-workout-adhoc",
      exercise_id: "test-exercise-bar",
      plan_item_id: null,
      exercise_name_snapshot: "Test-Stange",
      load_kg: 70,
      load_basis: "total",
      implement_count: 1,
      reps: 0,
      set_type: "failure",
      rpe: null,
      rir: 0,
    }),
  );
  return tables;
}
export function emptyHistory(): V1Tables {
  const tables = v1Tables();
  tables.WORKOUTS.splice(1);
  tables.SETS.splice(1);
  return tables;
}
export function templateTables(): V1Tables {
  const tables = emptyHistory();
  tables.PLANS.splice(1);
  tables.PLAN_ITEMS.splice(1);
  setConfig(tables, "file_role", "MASTER_TEMPLATE");
  setConfig(tables, "tracker_id", "TEMPLATE_UNASSIGNED");
  return tables;
}
export class FakeArnoldSheets implements ArnoldSheetsReadTransport {
  calls: { path: string; params: Readonly<Record<string, string>> }[] = [];
  tables = v1Tables();
  metadata = {
    spreadsheetId: fixtureFileId,
    sheets: Object.keys(V1_HEADERS).map((title, index) => ({
      properties: {
        sheetId: 100 + index,
        title,
        index,
        gridProperties: { rowCount: 1000, columnCount: 26 },
      },
      merges: [] as unknown[],
    })),
  };
  failure: unknown;
  grid(table: FixtureTable) {
    const sheet = this.metadata.sheets.find(
      (sheet) => sheet.properties.title === table,
    );
    if (!sheet) throw Error("Unknown fixture sheet");
    return {
      spreadsheetId: fixtureFileId,
      sheets: [
        {
          properties: { sheetId: sheet.properties.sheetId, title: table },
          data: [
            {
              startRow: 0,
              startColumn: 0,
              rowData: this.tables[table].map((row) => ({
                values: row.map((value) => ({
                  userEnteredValue:
                    value === null
                      ? undefined
                      : typeof value === "object"
                        ? { formulaValue: value.formulaValue }
                        : typeof value === "string"
                          ? { stringValue: value }
                          : typeof value === "number"
                            ? { numberValue: value }
                            : { boolValue: value },
                })),
              })),
            },
          ],
        },
      ],
    };
  }
  async get<T>(
    path: string,
    params: Readonly<Record<string, string>>,
  ): Promise<T> {
    this.calls.push({ path, params });
    if (this.failure) throw this.failure;
    if (path !== fixtureFileId) throw Error("Unexpected transport route");
    if (!params.ranges) return structuredClone(this.metadata) as T;
    const table = /^'([A-Z_]+)'!/.exec(params.ranges)?.[1] as
      FixtureTable | undefined;
    if (!table || !(table in this.tables))
      throw Error("Unexpected transport range");
    return structuredClone(this.grid(table)) as T;
  }
}
