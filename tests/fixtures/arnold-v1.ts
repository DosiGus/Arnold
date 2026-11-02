/**
 * A small, complete Arnold v1 dataset for the domain tests, as plain mutable
 * objects so a test can break exactly one field and check the schema's
 * answer. Every catalog name, stable ID, plan and training value below is
 * newly invented test data.
 */
import { ArnoldDatasetSchema } from "../../src/shared/arnold-schema-v1";

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

type Row = Record<string, unknown>;
export type V1Data = {
  config: Record<string, string>;
  configEntries: { key: string; value: string; description: string | null }[];
  exercises: Row[];
  plans: Row[];
  planItems: Row[];
  workouts: Row[];
  sets: Row[];
};
export type FixtureTable = Exclude<keyof V1Data, "config" | "configEntries">;

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

/** Changes one field of one row. */
export function setField(
  data: V1Data,
  table: FixtureTable,
  index: number,
  column: string,
  value: unknown,
) {
  data[table][index][column] = value;
}

/** Changes a CONFIG value in both its normalised and its entry form. */
export function setConfig(data: V1Data, key: string, value: string) {
  const entry = data.configEntries.find((e) => e.key === key);
  if (!entry) throw Error("Unknown fixture setting");
  entry.value = value;
  data.config[key] = value;
}

export const parse = (data: V1Data) => ArnoldDatasetSchema.parse(data);

export function v1Data(): V1Data {
  const plans: Row[] = [];
  const planItems: Row[] = [];
  for (const [version, status] of [
    [1, "archived"],
    [2, "active"],
    [3, "draft"],
  ] as const) {
    plans.push({
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
    });
    planItems.push({
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
    });
  }
  return {
    config: { ...configValues },
    configEntries: Object.entries(configValues).map(([key, value]) => ({
      key,
      value,
      description: `Synthetic ${key}`,
    })),
    exercises: [
      {
        ...technical,
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
        ...technical,
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
    ],
    plans,
    planItems,
    workouts: [
      {
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
      },
      {
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
      },
    ],
    sets: [
      { ...setBase },
      {
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
      },
    ],
  };
}

export function emptyHistory(): V1Data {
  const data = v1Data();
  data.workouts = [];
  data.sets = [];
  return data;
}

export function templateData(): V1Data {
  const data = emptyHistory();
  data.plans = [];
  data.planItems = [];
  setConfig(data, "file_role", "MASTER_TEMPLATE");
  setConfig(data, "tracker_id", "TEMPLATE_UNASSIGNED");
  return data;
}
