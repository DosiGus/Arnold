import {
  ArnoldDatasetSchema,
  type ArnoldDataset,
} from "../../shared/arnold-schema-v1.js";
import {
  MUSCLE_GROUP_LABEL,
  STARTER_EXERCISES,
} from "../../shared/exercise-starter-catalog.js";

/**
 * A new tracker: the starter exercise catalog and nothing else — no invented
 * workouts, plans, sets or start weights. The catalog is the one the onboarding
 * picker offers, so every exercise a user picked exists in their file.
 */
export function newTrackerDataset(trackerId: string): ArnoldDataset {
  const config = {
    schema_id: "arnold.training_raw",
    schema_version: "1.0.0",
    template_version: "1.0.0",
    file_role: "USER_TRACKER",
    tracker_id: trackerId,
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
  const timestamp = new Date().toISOString();
  return ArnoldDatasetSchema.parse({
    config,
    configEntries: Object.entries(config).map(([key, value]) => ({
      key,
      value,
      description: null,
    })),
    exercises: STARTER_EXERCISES.map((exercise) => ({
      exercise_id: exercise.exercise_id,
      name_de: exercise.name_de,
      name_en: null,
      equipment: exercise.equipment_label,
      primary_muscle: MUSCLE_GROUP_LABEL[exercise.muscle_group],
      family_key: exercise.family_key,
      variant_key: exercise.exercise_id,
      default_load_basis: exercise.load_basis,
      default_execution_mode: exercise.execution_mode,
      default_implement_count: exercise.implement_count,
      status: "active",
      created_at_utc: timestamp,
      updated_at_utc: timestamp,
      row_revision: 1,
    })),
    plans: [],
    planItems: [],
    workouts: [],
    sets: [],
  });
}
