import { z } from "zod";

export const ARNOLD_SCHEMA_ID = "arnold.training_raw";
export const ARNOLD_SCHEMA_VERSION = "1.0.0";
export const ARNOLD_TABLES = [
  "CONFIG",
  "EXERCISES",
  "PLANS",
  "PLAN_ITEMS",
  "WORKOUTS",
  "SETS",
] as const;
export type ArnoldTable = (typeof ARNOLD_TABLES)[number];
export const ARNOLD_TABLE_HEADERS = {
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
} as const satisfies Record<ArnoldTable, readonly string[]>;

export const ArnoldIdSchema = z
  .string()
  .min(1)
  .refine(
    (value) => value === value.trim() && !/[\u0000-\u001f\u007f]/.test(value),
    "ID darf keine Rand-Leerzeichen oder Steuerzeichen enthalten.",
  );
const text = z
  .string()
  .refine((value) => value.trim().length > 0, "Text darf nicht leer sein.");
const optionalText = text.nullable();
const positiveInt = z.number().int().positive();
const nonnegativeInt = z.number().int().nonnegative();
const load = z.number().nonnegative();
export const ArnoldUtcTimestampSchema = z.iso
  .datetime()
  .refine(
    (value) => value.endsWith("Z"),
    "Zeitstempel muss UTC mit Z verwenden.",
  );
export const ArnoldLoadBasisSchema = z.enum([
  "total",
  "per_implement",
  "machine_display",
  "added",
  "assistance",
  "bodyweight_only",
]);
export const ArnoldExecutionModeSchema = z.enum([
  "bilateral_simultaneous",
  "unilateral",
  "alternating",
]);
export const ArnoldSourceSchema = z.enum([
  "chat",
  "ui",
  "manual_import",
  "sync",
]);
const technical = {
  created_at_utc: ArnoldUtcTimestampSchema,
  updated_at_utc: ArnoldUtcTimestampSchema,
  row_revision: positiveInt,
};
const chronological = (row: {
  created_at_utc: string;
  updated_at_utc: string;
}) => Date.parse(row.updated_at_utc) >= Date.parse(row.created_at_utc);

export const ArnoldConfigSchema = z
  .strictObject({
    schema_id: z.literal(ARNOLD_SCHEMA_ID),
    schema_version: z.literal(ARNOLD_SCHEMA_VERSION),
    template_version: z
      .string()
      .regex(/^\d+\.\d+\.\d+$/, "Template-Version muss x.y.z sein."),
    file_role: z.enum(["MASTER_TEMPLATE", "USER_TRACKER"]),
    tracker_id: ArnoldIdSchema,
    unit_mass: z.literal("kg"),
    date_storage: z.literal("ISO-8601"),
    raw_data_policy: z.literal("NO_CALCULATED_COLUMNS"),
    onboarding_storage: z.literal("BACKEND_ONLY"),
    plan_history: z.literal("IMMUTABLE_VERSION_IDS"),
    write_policy: z.literal("MCP_BACKEND_ONLY"),
    master_data_policy: z.literal("NO_REAL_USER_DATA"),
    deleted_record_policy: z.literal("TOMBSTONE"),
    schema_fingerprint: z.literal(
      "CONFIG|EXERCISES|PLANS|PLAN_ITEMS|WORKOUTS|SETS",
    ),
  })
  .superRefine((row, ctx) => {
    if (
      (row.file_role === "MASTER_TEMPLATE") !==
      (row.tracker_id === "TEMPLATE_UNASSIGNED")
    )
      ctx.addIssue({
        code: "custom",
        path: ["tracker_id"],
        message:
          "Master-Vorlage und Nutzer-Tracker benötigen unterschiedliche Tracker-IDs; TEMPLATE_UNASSIGNED ist nur für MASTER_TEMPLATE gültig.",
      });
  })
  .readonly();
export const ArnoldConfigEntrySchema = z
  .strictObject({ key: text, value: text, description: optionalText })
  .readonly();
export const ArnoldExerciseSchema = z
  .strictObject({
    exercise_id: ArnoldIdSchema,
    name_de: text,
    name_en: optionalText,
    family_key: text,
    variant_key: text,
    equipment: text,
    primary_muscle: text,
    default_load_basis: ArnoldLoadBasisSchema,
    default_execution_mode: ArnoldExecutionModeSchema,
    default_implement_count: positiveInt,
    status: z.enum(["active", "retired"]),
    ...technical,
  })
  .refine(chronological, {
    path: ["updated_at_utc"],
    message: "updated_at_utc liegt vor created_at_utc.",
  })
  .readonly();
export const ArnoldPlanVersionSchema = z
  .strictObject({
    plan_version_id: ArnoldIdSchema,
    plan_family_id: ArnoldIdSchema,
    version_no: positiveInt,
    name: text,
    split_key: optionalText,
    status: z.enum(["draft", "active", "archived"]),
    goal_key: optionalText,
    days_per_week: positiveInt.max(7).nullable(),
    activated_at_utc: ArnoldUtcTimestampSchema.nullable(),
    retired_at_utc: ArnoldUtcTimestampSchema.nullable(),
    ...technical,
  })
  .refine(chronological, {
    path: ["updated_at_utc"],
    message: "updated_at_utc liegt vor created_at_utc.",
  })
  .superRefine((row, ctx) => {
    if (
      row.activated_at_utc &&
      row.retired_at_utc &&
      Date.parse(row.retired_at_utc) < Date.parse(row.activated_at_utc)
    )
      ctx.addIssue({
        code: "custom",
        path: ["retired_at_utc"],
        message: "Planende liegt vor der Aktivierung.",
      });
  })
  .readonly();
export const ArnoldPlanItemSchema = z
  .strictObject({
    plan_item_id: ArnoldIdSchema,
    plan_version_id: ArnoldIdSchema,
    session_id: ArnoldIdSchema,
    session_order: positiveInt,
    session_name: text,
    exercise_id: ArnoldIdSchema,
    exercise_order: positiveInt,
    target_sets: positiveInt.nullable(),
    rep_min: nonnegativeInt.nullable(),
    rep_max: nonnegativeInt.nullable(),
    target_load_kg: load.nullable(),
    target_load_basis: ArnoldLoadBasisSchema.nullable(),
    target_execution_mode: ArnoldExecutionModeSchema.nullable(),
    target_implement_count: positiveInt.nullable(),
    rest_seconds: nonnegativeInt.nullable(),
    notes: optionalText,
    status: z.enum(["active", "removed"]),
    row_revision: positiveInt,
  })
  .superRefine((row, ctx) => {
    if (
      row.rep_min !== null &&
      row.rep_max !== null &&
      row.rep_max < row.rep_min
    )
      ctx.addIssue({
        code: "custom",
        path: ["rep_max"],
        message: "rep_max muss mindestens rep_min sein.",
      });
  })
  .readonly();
export const ArnoldWorkoutSchema = z
  .strictObject({
    workout_id: ArnoldIdSchema,
    workout_date_local: z.iso.date(),
    timezone: text.refine((value) => {
      try {
        new Intl.DateTimeFormat("en", { timeZone: value });
        return true;
      } catch {
        return false;
      }
    }, "Unbekannte Zeitzone."),
    started_at_utc: ArnoldUtcTimestampSchema.nullable(),
    ended_at_utc: ArnoldUtcTimestampSchema.nullable(),
    plan_version_id: ArnoldIdSchema.nullable(),
    session_id: ArnoldIdSchema.nullable(),
    session_name_snapshot: optionalText,
    status: z.enum([
      "planned",
      "in_progress",
      "completed",
      "cancelled",
      "voided",
    ]),
    source: ArnoldSourceSchema,
    notes: optionalText,
    ...technical,
  })
  .refine(chronological, {
    path: ["updated_at_utc"],
    message: "updated_at_utc liegt vor created_at_utc.",
  })
  .superRefine((row, ctx) => {
    if (
      row.started_at_utc &&
      row.ended_at_utc &&
      Date.parse(row.ended_at_utc) < Date.parse(row.started_at_utc)
    )
      ctx.addIssue({
        code: "custom",
        path: ["ended_at_utc"],
        message: "Workout-Ende liegt vor dem Beginn.",
      });
  })
  .readonly();
export const ArnoldSetSchema = z
  .strictObject({
    set_id: ArnoldIdSchema,
    workout_id: ArnoldIdSchema,
    exercise_id: ArnoldIdSchema,
    plan_item_id: ArnoldIdSchema.nullable(),
    exercise_name_snapshot: text,
    exercise_order: positiveInt,
    set_number: positiveInt,
    set_type: z.enum(["warmup", "working", "drop", "failure", "other"]),
    reps: nonnegativeInt,
    reps_basis: z.enum(["total", "per_side"]),
    load_kg: load.nullable(),
    load_basis: ArnoldLoadBasisSchema,
    implement_count: positiveInt,
    execution_mode: ArnoldExecutionModeSchema,
    side: z.enum(["both", "left", "right", "alternating"]),
    rpe: z.number().min(1).max(10).nullable(),
    rir: nonnegativeInt.nullable(),
    notes: optionalText,
    status: z.enum(["active", "voided"]),
    source: ArnoldSourceSchema,
    ...technical,
  })
  .refine(chronological, {
    path: ["updated_at_utc"],
    message: "updated_at_utc liegt vor created_at_utc.",
  })
  .superRefine((row, ctx) => {
    if (
      row.load_basis === "bodyweight_only"
        ? row.load_kg !== null && row.load_kg !== 0
        : row.load_kg === null
    )
      ctx.addIssue({
        code: "custom",
        path: ["load_kg"],
        message:
          "bodyweight_only erlaubt null oder 0; andere Lastdefinitionen benötigen eine nichtnegative Last.",
      });
    if (
      row.load_basis === "assistance" &&
      row.load_kg !== null &&
      row.load_kg <= 0
    )
      ctx.addIssue({
        code: "custom",
        path: ["load_kg"],
        message: "Unterstützung benötigt eine positive Lastangabe.",
      });
    const allowed =
      row.execution_mode === "bilateral_simultaneous"
        ? ["both"]
        : row.execution_mode === "unilateral"
          ? ["left", "right"]
          : ["alternating"];
    if (!allowed.includes(row.side))
      ctx.addIssue({
        code: "custom",
        path: ["side"],
        message: "Seite passt nicht zur Ausführungsart.",
      });
  })
  .readonly();

const datasetBase = z.strictObject({
  config: ArnoldConfigSchema,
  configEntries: z.array(ArnoldConfigEntrySchema).readonly(),
  exercises: z.array(ArnoldExerciseSchema).readonly(),
  plans: z.array(ArnoldPlanVersionSchema).readonly(),
  planItems: z.array(ArnoldPlanItemSchema).readonly(),
  workouts: z.array(ArnoldWorkoutSchema).readonly(),
  sets: z.array(ArnoldSetSchema).readonly(),
});
export const ArnoldDatasetSchema = datasetBase
  .superRefine((data, ctx) => {
    const issue = (path: (string | number)[], message: string) =>
      ctx.addIssue({ code: "custom", path, message });
    const index = <T extends object>(
      rows: readonly T[],
      key: keyof T,
      table: string,
    ) => {
      const map = new Map<unknown, T>();
      rows.forEach((row, i) => {
        if (map.has(row[key])) issue([table, i, String(key)], "Doppelte ID.");
        else map.set(row[key], row);
      });
      return map;
    };
    const exercises = index(data.exercises, "exercise_id", "exercises");
    const plans = index(data.plans, "plan_version_id", "plans");
    const items = index(data.planItems, "plan_item_id", "planItems");
    const workouts = index(data.workouts, "workout_id", "workouts");
    index(data.sets, "set_id", "sets");
    const configKeys = new Set<string>();
    data.configEntries.forEach((row, i) => {
      if (configKeys.has(row.key))
        issue(["configEntries", i, "key"], "Doppelter CONFIG-Schlüssel.");
      configKeys.add(row.key);
      if (
        !(row.key in data.config) ||
        data.config[row.key as keyof typeof data.config] !== row.value
      )
        issue(
          ["configEntries", i, "value"],
          "CONFIG-Eintrag stimmt nicht mit der normalisierten Konfiguration überein.",
        );
    });
    for (const key of Object.keys(data.config))
      if (!configKeys.has(key))
        issue(["config", key], "CONFIG-Schlüssel fehlt.");
    if (data.plans.filter((p) => p.status === "active").length > 1)
      issue(["plans"], "Mehr als eine aktive Planversion.");
    const versions = new Set<string>();
    data.plans.forEach((row, i) => {
      const key = JSON.stringify([row.plan_family_id, row.version_no]);
      if (versions.has(key))
        issue(
          ["plans", i, "version_no"],
          "Versionsnummer innerhalb der Planfamilie doppelt.",
        );
      versions.add(key);
    });
    const sessions = new Map<string, { name: string; order: number }>();
    data.planItems.forEach((row, i) => {
      if (!plans.has(row.plan_version_id))
        issue(["planItems", i, "plan_version_id"], "Referenz auf PLANS fehlt.");
      if (!exercises.has(row.exercise_id))
        issue(["planItems", i, "exercise_id"], "Referenz auf EXERCISES fehlt.");
      const key = JSON.stringify([row.plan_version_id, row.session_id]);
      const previous = sessions.get(key);
      if (
        previous &&
        (previous.name !== row.session_name ||
          previous.order !== row.session_order)
      )
        issue(
          ["planItems", i, "session_id"],
          "Session-Name oder Reihenfolge innerhalb der Planversion widersprüchlich.",
        );
      else
        sessions.set(key, { name: row.session_name, order: row.session_order });
    });
    data.workouts.forEach((row, i) => {
      if (row.plan_version_id !== null && !plans.has(row.plan_version_id))
        issue(["workouts", i, "plan_version_id"], "Referenz auf PLANS fehlt.");
      if (
        row.session_id !== null &&
        (row.plan_version_id === null ||
          !sessions.has(JSON.stringify([row.plan_version_id, row.session_id])))
      )
        issue(
          ["workouts", i, "session_id"],
          "Session existiert nicht in der referenzierten Planversion.",
        );
    });
    const activeSets = new Set<string>();
    data.sets.forEach((row, i) => {
      const workout = workouts.get(row.workout_id);
      if (!workout)
        issue(["sets", i, "workout_id"], "Referenz auf WORKOUTS fehlt.");
      if (!exercises.has(row.exercise_id))
        issue(["sets", i, "exercise_id"], "Referenz auf EXERCISES fehlt.");
      if (row.plan_item_id !== null) {
        const item = items.get(row.plan_item_id);
        if (!item)
          issue(["sets", i, "plan_item_id"], "Referenz auf PLAN_ITEMS fehlt.");
        else if (
          workout &&
          (workout.plan_version_id !== item.plan_version_id ||
            (workout.session_id !== null &&
              workout.session_id !== item.session_id) ||
            row.exercise_id !== item.exercise_id)
        )
          issue(
            ["sets", i, "plan_item_id"],
            "Planposition passt nicht zu Planversion, Session oder Übung des Satzes.",
          );
      }
      if (row.status === "active") {
        const key = JSON.stringify([
          row.workout_id,
          row.exercise_id,
          row.set_number,
          row.side,
          row.set_type,
        ]);
        if (activeSets.has(key))
          issue(
            ["sets", i, "set_number"],
            "Doppelter aktiver Satz aus Workout, Übung, Satznummer, Seite und Satztyp.",
          );
        activeSets.add(key);
      }
    });
    if (
      data.config.file_role === "MASTER_TEMPLATE" &&
      (data.plans.length ||
        data.planItems.length ||
        data.workouts.length ||
        data.sets.length)
    )
      issue(
        ["config", "file_role"],
        "MASTER_TEMPLATE darf keine Trainingspläne oder Nutzer-Trainingslogs enthalten.",
      );
  })
  .readonly();

export type ArnoldConfig = z.infer<typeof ArnoldConfigSchema>;
export type ArnoldConfigEntry = z.infer<typeof ArnoldConfigEntrySchema>;
export type ArnoldExercise = z.infer<typeof ArnoldExerciseSchema>;
export type ArnoldPlanVersion = z.infer<typeof ArnoldPlanVersionSchema>;
export type ArnoldPlanItem = z.infer<typeof ArnoldPlanItemSchema>;
export type ArnoldWorkout = z.infer<typeof ArnoldWorkoutSchema>;
export type ArnoldSet = z.infer<typeof ArnoldSetSchema>;
export type ArnoldDataset = z.infer<typeof ArnoldDatasetSchema>;

/** ID-based indexes, scoped to one validated dataset; labels and physical row order are never keys. */
export function indexArnoldDataset(data: ArnoldDataset) {
  const byId = <T>(
    rows: readonly T[],
    key: (row: T) => string,
  ): ReadonlyMap<string, T> => new Map(rows.map((row) => [key(row), row]));
  const grouped = new Map<string, ArnoldSet[]>();
  for (const workout of data.workouts) grouped.set(workout.workout_id, []);
  for (const set of data.sets) grouped.get(set.workout_id)!.push(set);
  const setsByWorkoutId: ReadonlyMap<string, readonly ArnoldSet[]> = new Map(
    [...grouped].map(([id, sets]) => [id, Object.freeze(sets)]),
  );
  return Object.freeze({
    exercisesById: byId(data.exercises, (row) => row.exercise_id),
    plansByVersionId: byId(data.plans, (row) => row.plan_version_id),
    planItemsById: byId(data.planItems, (row) => row.plan_item_id),
    workoutsById: byId(data.workouts, (row) => row.workout_id),
    setsById: byId(data.sets, (row) => row.set_id),
    setsByWorkoutId: setsByWorkoutId as ReadonlyMap<
      string,
      readonly ArnoldSet[]
    >,
  });
}
