import { z } from "zod";
import {
  RUN_LIMITS,
  RunAlarmSettingsSchema,
  RunDistanceSourceSchema,
  RunDurationTypeSchema,
  RunEnvironmentSchema,
  RunGoalSchema,
  RunHrStatusSchema,
  RunPrescriptionSchema,
  RunReferenceSourceSchema,
  RunResultSourceSchema,
  RunSegmentKindSchema,
  RunSegmentStatusSchema,
  RunSessionTemplateSchema,
  RunSplitsSchema,
  RunTargetTypeSchema,
  RunTypeSchema,
  RunZoneSecondsSchema,
} from "./run-contract.js";

export const ARNOLD_SCHEMA_ID = "arnold.training_raw";
/**
 * 1.1.0 (migration 004) adds running: workouts.activity_type, run profile,
 * run sessions of a plan version, runs and run segments. Additive: every
 * 1.0.0 dataset is a valid 1.1.0 dataset.
 */
export const ARNOLD_SCHEMA_VERSION = "1.1.0";
/** Versions whose stored results (write receipts) still read back. */
export const ARNOLD_COMPATIBLE_SCHEMA_VERSIONS = ["1.0.0", "1.1.0"] as const;
export const ArnoldSchemaVersionSchema = z.enum(
  ARNOLD_COMPATIBLE_SCHEMA_VERSIONS,
);
export const ARNOLD_TABLES = [
  "CONFIG",
  "EXERCISES",
  "PLANS",
  "PLAN_ITEMS",
  "WORKOUTS",
  "SETS",
  "GOALS",
  "BODY_WEIGHTS",
  "RUN_PROFILES",
  "PLAN_RUN_SESSIONS",
  "RUNS",
  "RUN_SEGMENTS",
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
    "activity_type",
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
  GOALS: [
    "goal_id",
    "kind",
    "exercise_id",
    "load_basis",
    "target_value",
    "start_value",
    "status",
    "created_at_utc",
    "updated_at_utc",
    "row_revision",
  ],
  BODY_WEIGHTS: [
    "body_weight_id",
    "measured_on",
    "weight_kg",
    "status",
    "source",
    "created_at_utc",
    "updated_at_utc",
    "row_revision",
  ],
  RUN_PROFILES: [
    "run_profile_id",
    "goal",
    "race_date",
    "target_time_s",
    "reference_distance_m",
    "reference_time_s",
    "reference_date",
    "reference_source",
    "running_experience_months",
    "runs_per_week",
    "long_run_weekday",
    "preferred_environment",
    "base_minutes_per_week",
    "longest_run_4w_min",
    "alarm_settings",
    "created_at_utc",
    "updated_at_utc",
    "row_revision",
  ],
  PLAN_RUN_SESSIONS: [
    "plan_run_session_id",
    "plan_version_id",
    "session_id",
    "session_order",
    "session_name",
    "run_type",
    "template",
    "preferred_weekday",
    "status",
    "row_revision",
  ],
  RUNS: [
    "workout_id",
    "run_type",
    "environment",
    "prescription",
    "rationale",
    "rules_version",
    "timer_s",
    "elapsed_s",
    "distance_m",
    "distance_source",
    "ascent_m",
    "descent_m",
    "cadence_spm",
    "calories_kcal",
    "te_aerobic",
    "te_anaerobic",
    "rpe",
    "splits_100m",
    "pause_count",
    "result_source",
    "hr_status",
    "hr_avg_bpm",
    "hr_max_bpm",
    "hr_zone_seconds",
    "created_at_utc",
    "updated_at_utc",
    "row_revision",
  ],
  RUN_SEGMENTS: [
    "run_segment_id",
    "workout_id",
    "segment_index",
    "repetition",
    "kind",
    "planned_duration_type",
    "planned_duration_value",
    "target_type",
    "target_low",
    "target_high",
    "timer_s",
    "distance_m",
    "time_in_target_s",
    "status",
    "hr_avg_bpm",
    "hr_max_bpm",
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
    // A 1.0.0 dataset is a valid 1.1.0 dataset (the change is additive).
    schema_version: ArnoldSchemaVersionSchema,
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
    if (row.status === "draft") {
      if (row.activated_at_utc !== null)
        ctx.addIssue({
          code: "custom",
          path: ["activated_at_utc"],
          message: "Ein Entwurf darf noch keinen Aktivierungszeitpunkt haben.",
        });
      if (row.retired_at_utc !== null)
        ctx.addIssue({
          code: "custom",
          path: ["retired_at_utc"],
          message: "Ein Entwurf darf noch keinen Archivierungszeitpunkt haben.",
        });
    } else {
      if (row.activated_at_utc === null)
        ctx.addIssue({
          code: "custom",
          path: ["activated_at_utc"],
          message:
            "Aktive und archivierte Planversionen benötigen einen Aktivierungszeitpunkt.",
        });
      if (row.status === "active" && row.retired_at_utc !== null)
        ctx.addIssue({
          code: "custom",
          path: ["retired_at_utc"],
          message:
            "Eine aktive Planversion darf nicht bereits beendet oder archiviert sein.",
        });
      if (row.status === "archived" && row.retired_at_utc === null)
        ctx.addIssue({
          code: "custom",
          path: ["retired_at_utc"],
          message:
            "Eine archivierte Planversion benötigt einen Archivierungszeitpunkt.",
        });
    }

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
/** What a workout is (1.1.0). */
export const ArnoldActivityTypeSchema = z.enum(["strength", "run"]);
export type ArnoldActivityType = z.infer<typeof ArnoldActivityTypeSchema>;
/** True for strength workouts, including rows written before 1.1.0. */
export const isStrengthWorkout = (workout: {
  activity_type?: ArnoldActivityType;
}) => (workout.activity_type ?? "strength") === "strength";

export const ArnoldWorkoutSchema = z
  .strictObject({
    workout_id: ArnoldIdSchema,
    client_session_id: ArnoldIdSchema.nullable().optional(),
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
    /**
     * 1.1.0: strength or run. Absent means strength, so rows and receipts
     * written before the column existed read back unchanged.
     */
    activity_type: ArnoldActivityTypeSchema.optional(),
  })
  .refine(chronological, {
    path: ["updated_at_utc"],
    message: "updated_at_utc liegt vor created_at_utc.",
  })
  .superRefine((row, ctx) => {
    if (row.activity_type === "run" && row.status === "in_progress")
      ctx.addIssue({
        code: "custom",
        path: ["status"],
        message:
          "Ein Lauf wird erst nach dem Ende gespeichert und ist nie in_progress.",
      });
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

/**
 * A goal the user set: a body weight, or a load or repetition count for one
 * exercise. Only the target is stored; how far the user has come is computed
 * by the analytics engine from sets and body weight entries, never stored.
 */
export const ArnoldGoalKindSchema = z.enum([
  "body_weight",
  "exercise_load",
  "exercise_reps",
]);
export const ArnoldGoalSchema = z
  .strictObject({
    goal_id: ArnoldIdSchema,
    kind: ArnoldGoalKindSchema,
    /** Required for exercise goals, null for a body weight goal. */
    exercise_id: ArnoldIdSchema.nullable(),
    /** The load convention of an exercise_load target ("24 kg pro Hantel"). */
    load_basis: ArnoldLoadBasisSchema.nullable(),
    /** kg for body_weight and exercise_load, repetitions for exercise_reps. */
    target_value: z.number().positive().max(1000),
    /** The value when the goal was set; null when nothing was known yet. */
    start_value: z.number().nonnegative().max(1000).nullable(),
    status: z.enum(["active", "archived"]),
    ...technical,
  })
  .refine(chronological, {
    path: ["updated_at_utc"],
    message: "updated_at_utc liegt vor created_at_utc.",
  })
  .superRefine((row, ctx) => {
    const exercise = row.kind !== "body_weight";
    if (exercise !== (row.exercise_id !== null))
      ctx.addIssue({
        code: "custom",
        path: ["exercise_id"],
        message:
          "Übungsziele brauchen eine Übung, ein Körpergewichtsziel keine.",
      });
    if ((row.kind === "exercise_load") !== (row.load_basis !== null))
      ctx.addIssue({
        code: "custom",
        path: ["load_basis"],
        message:
          "Nur ein Gewichtsziel für eine Übung trägt eine Lastdefinition.",
      });
    if (row.load_basis === "bodyweight_only" || row.load_basis === "assistance")
      ctx.addIssue({
        code: "custom",
        path: ["load_basis"],
        message:
          "Für Eigengewicht und Unterstützung gibt es kein Gewichtsziel.",
      });
    if (row.kind === "exercise_reps" && !Number.isInteger(row.target_value))
      ctx.addIssue({
        code: "custom",
        path: ["target_value"],
        message: "Wiederholungsziele sind ganze Zahlen.",
      });
  })
  .readonly();

/** One body weight measurement on a local calendar day. Never deleted, only voided. */
export const ArnoldBodyWeightSchema = z
  .strictObject({
    body_weight_id: ArnoldIdSchema,
    measured_on: z.iso.date(),
    weight_kg: z.number().min(20).max(400),
    status: z.enum(["active", "voided"]),
    source: ArnoldSourceSchema,
    ...technical,
  })
  .refine(chronological, {
    path: ["updated_at_utc"],
    message: "updated_at_utc liegt vor created_at_utc.",
  })
  .readonly();

/* ------------------------------------------------------- running (1.1.0) */

const runSeconds = z.number().int().nonnegative().max(RUN_LIMITS.maxSeconds);
const runMeters = z.number().int().nonnegative().max(RUN_LIMITS.maxMeters);
const bpm = z.number().int().min(30).max(250);
const weekday = z.number().int().min(1).max(7);

/**
 * The run profile: one row per user, changed with a revision. Holds what the
 * user said (goal, reference, preferences); zones and paces are derived by
 * the engine, never stored here.
 */
export const ArnoldRunProfileSchema = z
  .strictObject({
    run_profile_id: ArnoldIdSchema,
    goal: RunGoalSchema,
    race_date: z.iso.date().nullable(),
    target_time_s: runSeconds.positive().nullable(),
    /** Reference performance: all four fields or none. */
    reference_distance_m: runMeters.positive().nullable(),
    reference_time_s: runSeconds.positive().nullable(),
    reference_date: z.iso.date().nullable(),
    reference_source: RunReferenceSourceSchema.nullable(),
    running_experience_months: z.number().int().min(0).max(1200).nullable(),
    runs_per_week: z.number().int().min(1).max(7),
    /** ISO weekday, 1 = Monday. */
    long_run_weekday: weekday.nullable(),
    preferred_environment: RunEnvironmentSchema,
    base_minutes_per_week: z.number().int().min(0).max(3000).nullable(),
    longest_run_4w_min: z.number().int().min(0).max(600).nullable(),
    alarm_settings: RunAlarmSettingsSchema.nullable(),
    ...technical,
  })
  .refine(chronological, {
    path: ["updated_at_utc"],
    message: "updated_at_utc liegt vor created_at_utc.",
  })
  .superRefine((row, ctx) => {
    const reference = [
      row.reference_distance_m,
      row.reference_time_s,
      row.reference_date,
      row.reference_source,
    ];
    if (reference.some((v) => v === null) && reference.some((v) => v !== null))
      ctx.addIssue({
        code: "custom",
        path: ["reference_distance_m"],
        message:
          "Eine Referenzleistung braucht Distanz, Zeit, Datum und Quelle.",
      });
    if (row.goal === "fitness" && row.race_date !== null)
      ctx.addIssue({
        code: "custom",
        path: ["race_date"],
        message: "Ein Wettkampfdatum gibt es nur für ein Streckenziel.",
      });
    if (row.target_time_s !== null && row.goal === "fitness")
      ctx.addIssue({
        code: "custom",
        path: ["target_time_s"],
        message: "Eine Zielzeit gibt es nur für ein Streckenziel.",
      });
  })
  .readonly();

/**
 * A run session of a plan version ("Laufeinheit"). Shares the session_id
 * space of the version with the strength sessions in PLAN_ITEMS.
 */
export const ArnoldPlanRunSessionSchema = z
  .strictObject({
    plan_run_session_id: ArnoldIdSchema,
    plan_version_id: ArnoldIdSchema,
    session_id: ArnoldIdSchema,
    session_order: positiveInt,
    session_name: text,
    run_type: RunTypeSchema,
    template: RunSessionTemplateSchema,
    /** ISO weekday, 1 = Monday. */
    preferred_weekday: weekday.nullable(),
    status: z.enum(["active", "removed"]),
    row_revision: positiveInt,
  })
  .readonly();

/**
 * One run: one-to-one with a workout of activity_type "run". A planned run
 * (workout status "planned") carries only its prescription; the result
 * fields are filled when it is done. Heart-rate values are only present with
 * hr_status "recorded", which needs the health consent (D-RUN-07).
 * Paces and kilometre times are derived (src/analytics), never stored.
 */
export const ArnoldRunSchema = z
  .strictObject({
    workout_id: ArnoldIdSchema,
    run_type: RunTypeSchema,
    environment: RunEnvironmentSchema,
    /** Snapshot of what was prescribed; null for a free or logged run. */
    prescription: RunPrescriptionSchema.nullable(),
    rationale: optionalText,
    rules_version: optionalText,
    timer_s: runSeconds.nullable(),
    elapsed_s: runSeconds.nullable(),
    distance_m: runMeters.nullable(),
    distance_source: RunDistanceSourceSchema.nullable(),
    ascent_m: runMeters.nullable(),
    descent_m: runMeters.nullable(),
    cadence_spm: z.number().int().min(1).max(300).nullable(),
    calories_kcal: z.number().int().min(0).max(20_000).nullable(),
    te_aerobic: z.number().min(0).max(5).nullable(),
    te_anaerobic: z.number().min(0).max(5).nullable(),
    rpe: z.number().int().min(1).max(10).nullable(),
    /** Cumulative timer seconds at each full 100 m. */
    splits_100m: RunSplitsSchema.nullable(),
    pause_count: z.number().int().min(0).max(1000).nullable(),
    result_source: RunResultSourceSchema.nullable(),
    /** Null until there is a result. */
    hr_status: RunHrStatusSchema.nullable(),
    hr_avg_bpm: bpm.nullable(),
    hr_max_bpm: bpm.nullable(),
    hr_zone_seconds: RunZoneSecondsSchema.nullable(),
    ...technical,
  })
  .refine(chronological, {
    path: ["updated_at_utc"],
    message: "updated_at_utc liegt vor created_at_utc.",
  })
  .superRefine((row, ctx) => {
    const issue = (path: string, message: string) =>
      ctx.addIssue({ code: "custom", path: [path], message });
    const recorded = row.hr_status === "recorded";
    if (recorded !== (row.hr_avg_bpm !== null && row.hr_max_bpm !== null))
      issue(
        "hr_status",
        "Pulswerte gibt es genau dann, wenn hr_status recorded ist.",
      );
    if (!recorded && row.hr_zone_seconds !== null)
      issue("hr_zone_seconds", "Zonenzeiten nur mit erfassten Pulswerten.");
    if (
      row.hr_avg_bpm !== null &&
      row.hr_max_bpm !== null &&
      row.hr_avg_bpm > row.hr_max_bpm
    )
      issue("hr_avg_bpm", "Durchschnittspuls über dem Maximalpuls.");
    if (
      row.timer_s !== null &&
      row.elapsed_s !== null &&
      row.timer_s > row.elapsed_s
    )
      issue("timer_s", "Timerzeit länger als die Gesamtzeit.");
    if ((row.distance_m === null) !== (row.distance_source === null))
      issue("distance_source", "Eine Distanz braucht ihre Quelle.");
  })
  .readonly();

/** One executed segment of a run, or one kilometre lap of a free run. */
export const ArnoldRunSegmentSchema = z
  .strictObject({
    run_segment_id: ArnoldIdSchema,
    workout_id: ArnoldIdSchema,
    segment_index: z
      .number()
      .int()
      .min(0)
      .max(RUN_LIMITS.maxSegments - 1),
    /** Repetition inside its block, null outside a repeat. */
    repetition: z.number().int().min(1).max(50).nullable(),
    kind: RunSegmentKindSchema,
    /** What was prescribed for it; null for a lap of a free run. */
    planned_duration_type: RunDurationTypeSchema.nullable(),
    planned_duration_value: z.number().int().nonnegative().nullable(),
    target_type: RunTargetTypeSchema.nullable(),
    target_low: z.number().int().nonnegative().nullable(),
    target_high: z.number().int().nonnegative().nullable(),
    timer_s: runSeconds,
    distance_m: runMeters,
    time_in_target_s: runSeconds.nullable(),
    status: RunSegmentStatusSchema,
    hr_avg_bpm: bpm.nullable(),
    hr_max_bpm: bpm.nullable(),
    ...technical,
  })
  .refine(chronological, {
    path: ["updated_at_utc"],
    message: "updated_at_utc liegt vor created_at_utc.",
  })
  .superRefine((row, ctx) => {
    const issue = (path: string, message: string) =>
      ctx.addIssue({ code: "custom", path: [path], message });
    const planned = [
      row.planned_duration_type,
      row.planned_duration_value,
      row.target_type,
      row.target_low,
      row.target_high,
    ];
    if (planned.some((v) => v === null) && planned.some((v) => v !== null))
      issue("planned_duration_type", "Vorgabe des Abschnitts unvollständig.");
    if ((row.kind === "lap") !== (row.planned_duration_type === null))
      issue("kind", "Nur Kilometerrunden freier Läufe haben keine Vorgabe.");
    if (
      row.target_low !== null &&
      row.target_high !== null &&
      row.target_low > row.target_high
    )
      issue("target_low", "Untere Grenze über der oberen.");
    if (row.time_in_target_s !== null && row.time_in_target_s > row.timer_s)
      issue("time_in_target_s", "Zeit im Zielband länger als der Abschnitt.");
    if ((row.hr_avg_bpm === null) !== (row.hr_max_bpm === null))
      issue("hr_avg_bpm", "Durchschnitts- und Maximalpuls nur zusammen.");
    if (
      row.hr_avg_bpm !== null &&
      row.hr_max_bpm !== null &&
      row.hr_avg_bpm > row.hr_max_bpm
    )
      issue("hr_avg_bpm", "Durchschnittspuls über dem Maximalpuls.");
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
  // Added after 1.0.0 without changing its meaning: a dataset written before
  // goals existed simply has none.
  goals: z.array(ArnoldGoalSchema).readonly().default([]),
  bodyWeights: z.array(ArnoldBodyWeightSchema).readonly().default([]),
  // 1.1.0, running. Absent in a 1.0.0 dataset.
  runProfiles: z.array(ArnoldRunProfileSchema).readonly().default([]),
  planRunSessions: z.array(ArnoldPlanRunSessionSchema).readonly().default([]),
  runs: z.array(ArnoldRunSchema).readonly().default([]),
  runSegments: z.array(ArnoldRunSegmentSchema).readonly().default([]),
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
    // Run sessions share the session_id space of their plan version.
    const runSessions = new Set<string>();
    index(data.planRunSessions, "plan_run_session_id", "planRunSessions");
    data.planRunSessions.forEach((row, i) => {
      if (!plans.has(row.plan_version_id))
        issue(
          ["planRunSessions", i, "plan_version_id"],
          "Referenz auf PLANS fehlt.",
        );
      const key = JSON.stringify([row.plan_version_id, row.session_id]);
      if (runSessions.has(key) || sessions.has(key))
        issue(
          ["planRunSessions", i, "session_id"],
          "Session-ID innerhalb der Planversion doppelt.",
        );
      runSessions.add(key);
    });
    data.workouts.forEach((row, i) => {
      if (row.plan_version_id !== null && !plans.has(row.plan_version_id))
        issue(["workouts", i, "plan_version_id"], "Referenz auf PLANS fehlt.");
      const own = isStrengthWorkout(row) ? sessions : runSessions;
      if (
        row.session_id !== null &&
        (row.plan_version_id === null ||
          !own.has(JSON.stringify([row.plan_version_id, row.session_id])))
      )
        issue(
          ["workouts", i, "session_id"],
          "Session existiert nicht in der referenzierten Planversion.",
        );
    });
    const runs = index(data.runs, "workout_id", "runs");
    data.workouts.forEach((row, i) => {
      if (!isStrengthWorkout(row) && !runs.has(row.workout_id))
        issue(["workouts", i, "activity_type"], "Zum Lauf fehlt RUNS.");
    });
    data.runs.forEach((row, i) => {
      const workout = workouts.get(row.workout_id);
      if (!workout || isStrengthWorkout(workout)) {
        issue(
          ["runs", i, "workout_id"],
          "Referenz auf ein Training der Art run fehlt.",
        );
        return;
      }
      const result = [
        row.timer_s,
        row.elapsed_s,
        row.distance_m,
        row.result_source,
        row.hr_status,
      ];
      if (workout.status === "planned" && result.some((v) => v !== null))
        issue(["runs", i, "timer_s"], "Ein geplanter Lauf hat kein Ergebnis.");
      if (workout.status === "planned" && row.rpe !== null)
        issue(["runs", i, "rpe"], "Ein geplanter Lauf hat keine Anstrengung.");
      if (workout.status === "completed" && result.some((v) => v === null))
        issue(
          ["runs", i, "timer_s"],
          "Ein abgeschlossener Lauf braucht Zeiten, Distanz, Quelle und hr_status.",
        );
    });
    index(data.runSegments, "run_segment_id", "runSegments");
    const segmentSlots = new Set<string>();
    data.runSegments.forEach((row, i) => {
      const run = runs.get(row.workout_id);
      if (!run) {
        issue(["runSegments", i, "workout_id"], "Referenz auf RUNS fehlt.");
        return;
      }
      if (workouts.get(row.workout_id)?.status === "planned")
        issue(
          ["runSegments", i, "workout_id"],
          "Ein geplanter Lauf hat keine gelaufenen Abschnitte.",
        );
      const slot = JSON.stringify([row.workout_id, row.segment_index]);
      if (segmentSlots.has(slot))
        issue(["runSegments", i, "segment_index"], "Abschnitt doppelt.");
      segmentSlots.add(slot);
      if (row.hr_avg_bpm !== null && run.hr_status !== "recorded")
        issue(
          ["runSegments", i, "hr_avg_bpm"],
          "Pulswerte eines Abschnitts nur bei erfassten Pulswerten des Laufs.",
        );
    });
    if (data.runProfiles.length > 1)
      issue(["runProfiles"], "Höchstens ein Laufprofil.");
    index(data.runProfiles, "run_profile_id", "runProfiles");
    const activeSets = new Set<string>();
    data.sets.forEach((row, i) => {
      const workout = workouts.get(row.workout_id);
      if (!workout)
        issue(["sets", i, "workout_id"], "Referenz auf WORKOUTS fehlt.");
      else if (!isStrengthWorkout(workout))
        issue(["sets", i, "workout_id"], "Ein Lauf hat keine Sätze.");
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
    index(data.goals, "goal_id", "goals");
    index(data.bodyWeights, "body_weight_id", "bodyWeights");
    const activeGoals = new Set<string>();
    data.goals.forEach((row, i) => {
      if (row.exercise_id !== null && !exercises.has(row.exercise_id))
        issue(["goals", i, "exercise_id"], "Referenz auf EXERCISES fehlt.");
      if (row.status !== "active") return;
      const key = JSON.stringify([row.kind, row.exercise_id]);
      if (activeGoals.has(key))
        issue(
          ["goals", i, "kind"],
          "Für diese Art und Übung gibt es schon ein aktives Ziel.",
        );
      activeGoals.add(key);
    });
    const weighedDays = new Set<string>();
    data.bodyWeights.forEach((row, i) => {
      if (row.status !== "active") return;
      if (weighedDays.has(row.measured_on))
        issue(
          ["bodyWeights", i, "measured_on"],
          "Pro Tag gibt es höchstens einen gültigen Körpergewichtseintrag.",
        );
      weighedDays.add(row.measured_on);
    });
    if (
      data.config.file_role === "MASTER_TEMPLATE" &&
      (data.goals.length ||
        data.bodyWeights.length ||
        data.runProfiles.length ||
        data.planRunSessions.length ||
        data.runs.length ||
        data.runSegments.length)
    )
      issue(
        ["config", "file_role"],
        "MASTER_TEMPLATE darf keine Ziele, Körpergewichte oder Laufdaten enthalten.",
      );
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
export type ArnoldGoal = z.infer<typeof ArnoldGoalSchema>;
export type ArnoldGoalKind = z.infer<typeof ArnoldGoalKindSchema>;
export type ArnoldBodyWeight = z.infer<typeof ArnoldBodyWeightSchema>;
export type ArnoldRunProfile = z.infer<typeof ArnoldRunProfileSchema>;
export type ArnoldPlanRunSession = z.infer<typeof ArnoldPlanRunSessionSchema>;
export type ArnoldRun = z.infer<typeof ArnoldRunSchema>;
export type ArnoldRunSegment = z.infer<typeof ArnoldRunSegmentSchema>;

/**
 * The dataset as every strength reader sees it: strength workouts that took
 * place or are taking place, their sets, and no running data. Planned
 * workouts and runs are left out, so strength figures stay exactly what they
 * were before running existed (ARN-RUN, RUN-003). Pure; the input is not
 * changed.
 */
export function strengthTrainingView(data: ArnoldDataset): ArnoldDataset {
  // The engine also reads unvalidated datasets (its own defect handling), in
  // which the 1.1.0 arrays may be missing.
  const hasRunning =
    data.runProfiles?.length ||
    data.planRunSessions?.length ||
    data.runs?.length ||
    data.runSegments?.length ||
    data.workouts.some((w) => !isStrengthWorkout(w) || w.status === "planned");
  if (!hasRunning) return data;
  const workouts = data.workouts.filter(
    (w) => isStrengthWorkout(w) && w.status !== "planned",
  );
  const kept = new Set(workouts.map((w) => w.workout_id));
  return Object.freeze({
    ...data,
    workouts: Object.freeze(workouts),
    sets: Object.freeze(data.sets.filter((s) => kept.has(s.workout_id))),
    runProfiles: Object.freeze([]),
    planRunSessions: Object.freeze([]),
    runs: Object.freeze([]),
    runSegments: Object.freeze([]),
  });
}

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

export type ArnoldLoadBasis = z.infer<typeof ArnoldLoadBasisSchema>;
export type ArnoldExecutionMode = z.infer<typeof ArnoldExecutionModeSchema>;
export type ArnoldSource = z.infer<typeof ArnoldSourceSchema>;
export type ArnoldRepsBasis = ArnoldSet["reps_basis"];
export type ArnoldSide = ArnoldSet["side"];
export type ArnoldSetType = ArnoldSet["set_type"];
export type ArnoldWorkoutStatus = ArnoldWorkout["status"];
