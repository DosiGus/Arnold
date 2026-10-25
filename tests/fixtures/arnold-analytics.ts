import {
  ArnoldDatasetSchema,
  type ArnoldDataset,
} from "../../src/shared/arnold-schema-v1";

// Every identifier, name, plan and training value below is invented for tests.
// No value is taken from a real tracker or from the published master catalog.
export const STAMP = "2026-01-01T06:00:00Z";
const technical = {
  created_at_utc: STAMP,
  updated_at_utc: STAMP,
  row_revision: 1,
};

export const CONFIG_VALUES = {
  schema_id: "arnold.training_raw",
  schema_version: "1.0.0",
  template_version: "1.0.0",
  file_role: "USER_TRACKER",
  tracker_id: "analytics-test-tracker",
  unit_mass: "kg",
  date_storage: "ISO-8601",
  raw_data_policy: "NO_CALCULATED_COLUMNS",
  onboarding_storage: "BACKEND_ONLY",
  plan_history: "IMMUTABLE_VERSION_IDS",
  write_policy: "MCP_BACKEND_ONLY",
  master_data_policy: "NO_REAL_USER_DATA",
  deleted_record_policy: "TOMBSTONE",
  schema_fingerprint: "CONFIG|EXERCISES|PLANS|PLAN_ITEMS|WORKOUTS|SETS",
} as const;

type Raw = Record<string, unknown>;

export function exercise(overrides: Raw = {}): Raw {
  return {
    ...technical,
    exercise_id: "ex-bar-press",
    name_de: "Testpresse Langhantel",
    name_en: null,
    family_key: "test_press",
    variant_key: "test_bar",
    equipment: "barbell",
    primary_muscle: "chest",
    default_load_basis: "total",
    default_execution_mode: "bilateral_simultaneous",
    default_implement_count: 1,
    status: "active",
    ...overrides,
  };
}

export function plan(overrides: Raw = {}): Raw {
  return {
    ...technical,
    plan_version_id: "plan-v1",
    plan_family_id: "plan-family",
    version_no: 1,
    name: "Testplan",
    split_key: null,
    status: "active",
    goal_key: null,
    days_per_week: 3,
    activated_at_utc: STAMP,
    retired_at_utc: null,
    ...overrides,
  };
}

export function planItem(overrides: Raw = {}): Raw {
  return {
    plan_item_id: "item-1",
    plan_version_id: "plan-v1",
    session_id: "session-a",
    session_order: 1,
    session_name: "Testeinheit A",
    exercise_id: "ex-bar-press",
    exercise_order: 1,
    target_sets: 3,
    rep_min: 8,
    rep_max: 12,
    target_load_kg: 70,
    target_load_basis: "total",
    target_execution_mode: "bilateral_simultaneous",
    target_implement_count: 1,
    rest_seconds: 120,
    notes: null,
    status: "active",
    row_revision: 1,
    ...overrides,
  };
}

export function workout(overrides: Raw = {}): Raw {
  return {
    ...technical,
    workout_id: "w-1",
    workout_date_local: "2026-01-05",
    timezone: "Europe/Berlin",
    started_at_utc: null,
    ended_at_utc: null,
    plan_version_id: null,
    session_id: null,
    session_name_snapshot: null,
    status: "completed",
    source: "ui",
    notes: null,
    ...overrides,
  };
}

export function set(overrides: Raw = {}): Raw {
  return {
    ...technical,
    set_id: "s-1",
    workout_id: "w-1",
    exercise_id: "ex-bar-press",
    plan_item_id: null,
    exercise_name_snapshot: "Testpresse Langhantel",
    exercise_order: 1,
    set_number: 1,
    set_type: "working",
    reps: 10,
    reps_basis: "total",
    load_kg: 70,
    load_basis: "total",
    implement_count: 1,
    execution_mode: "bilateral_simultaneous",
    side: "both",
    rpe: null,
    rir: null,
    notes: null,
    status: "active",
    source: "ui",
    ...overrides,
  };
}

export type DatasetParts = {
  exercises?: Raw[];
  plans?: Raw[];
  planItems?: Raw[];
  workouts?: Raw[];
  sets?: Raw[];
  /** Widened to plain strings so cases like MASTER_TEMPLATE are expressible. */
  config?: Partial<Record<keyof typeof CONFIG_VALUES, string>>;
};

/** Shape of a dataset before validation; used for defect-handling tests. */
export function rawDataset(parts: DatasetParts = {}): unknown {
  const config = { ...CONFIG_VALUES, ...parts.config };
  return {
    config,
    configEntries: Object.entries(config).map(([key, value]) => ({
      key,
      value,
      description: null,
    })),
    exercises: parts.exercises ?? [exercise()],
    plans: parts.plans ?? [],
    planItems: parts.planItems ?? [],
    workouts: parts.workouts ?? [],
    sets: parts.sets ?? [],
  };
}

/** A dataset that passed the same validation the Google read adapter applies. */
export function dataset(parts: DatasetParts = {}): ArnoldDataset {
  return ArnoldDatasetSchema.parse(rawDataset(parts));
}

/** Bypasses validation so the engine can be probed with defects it must survive. */
export function unvalidatedDataset(parts: DatasetParts = {}): ArnoldDataset {
  return rawDataset(parts) as ArnoldDataset;
}

/** Convenience for a single completed workout on one date with the given sets. */
export function oneWorkout(sets: Raw[], overrides: Raw = {}): ArnoldDataset {
  return dataset({
    exercises: [exercise()],
    workouts: [workout(overrides)],
    sets: sets.map((entry, index) =>
      set({ set_id: `s-${index + 1}`, set_number: index + 1, ...entry }),
    ),
  });
}
