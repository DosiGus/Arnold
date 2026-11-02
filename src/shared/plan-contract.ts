/**
 * The training plan contract: domain objects, typed edit operations and the
 * input/output schemas of every plan MCP tool.
 *
 * Three rules shape everything here.
 *
 * First, a plan is never a fixed split. `split_key` and `session_name` are free
 * text, the number of sessions is unbounded, and no identifier, label or code
 * path depends on "Push", "Pull" or "Legs". A plan with one recurring session is
 * as valid as one with seven.
 *
 * Second, the domain objects are a *projection* of the six Arnold tables, never
 * a second source of truth. A `TrainingSession` exists because PLAN_ITEMS rows
 * share a `session_id`; it is not a row of its own. That is why the schema below
 * carries `persisted` and why an empty session cannot be stored — see
 * `PLAN_SCHEMA_LIMITS`.
 *
 * Third, every write names the exact version and revision it expects. There is
 * no "save the plan" operation that takes whatever the client currently holds:
 * the client states which revision it edited, and the server refuses anything
 * else.
 */
import { z } from "zod";
import { toolErrorSchema } from "./write-recovery.js";
import {
  ArnoldExecutionModeSchema,
  ArnoldIdSchema,
  ArnoldLoadBasisSchema,
  ArnoldPlanItemSchema,
  ArnoldPlanVersionSchema,
  ArnoldUtcTimestampSchema,
  ARNOLD_SCHEMA_ID,
  ARNOLD_SCHEMA_VERSION,
} from "./arnold-schema-v1.js";

export const PLAN_CONTRACT = "arnold.plan/1";

const id = ArnoldIdSchema;
const positiveInt = z.number().int().positive();
const nonnegativeInt = z.number().int().nonnegative();
const name = z
  .string()
  .min(1)
  .max(120)
  .refine((v) => v.trim().length > 0, "Name darf nicht leer sein.");
const notes = z.string().max(2000);
const request = { request_id: z.string().min(1).max(128) };
const planRow = ArnoldPlanVersionSchema.unwrap().shape;
const itemRow = ArnoldPlanItemSchema.unwrap().shape;

/**
 * What the current data model cannot represent.
 *
 * These are product-visible limits, not implementation details, so they travel
 * with the contract and are surfaced in tool output rather than discovered by a
 * user whose change silently vanished.
 */
export const PLAN_SCHEMA_LIMITS = [
  "EMPTY_SESSION_NOT_PERSISTABLE",
  "NO_SESSION_TABLE",
  "NO_PLAN_ITEM_TIMESTAMPS",
  "SINGLE_ACTIVE_PLAN_ONLY",
] as const;
export const PlanSchemaLimitSchema = z.enum(PLAN_SCHEMA_LIMITS);
export type PlanSchemaLimit = z.infer<typeof PlanSchemaLimitSchema>;

export const PLAN_SCHEMA_LIMIT_TEXT: Record<PlanSchemaLimit, string> = {
  EMPTY_SESSION_NOT_PERSISTABLE:
    "Eine Trainingseinheit ohne Übung kann nicht gespeichert werden, weil eine Einheit nur über ihre Planpositionen existiert. Im Editor bleibt sie sichtbar und ausdrücklich als nicht gespeichert markiert.",
  NO_SESSION_TABLE:
    "Es gibt keine SESSIONS-Tabelle. Name und Reihenfolge einer Einheit liegen auf jeder ihrer Planpositionen und werden gemeinsam geändert.",
  NO_PLAN_ITEM_TIMESTAMPS:
    "PLAN_ITEMS führt keine Zeitstempel. Der Änderungszeitpunkt einer Planposition wird über updated_at_utc der Planversion abgebildet.",
  SINGLE_ACTIVE_PLAN_ONLY:
    "Je Tracker ist genau eine aktive Planversion zulässig. Mehrere parallel aktive Pläne sind in V1 ausgeschlossen.",
};

/** Targets and execution of one planned exercise. All fields are optional. */
export const PlannedExerciseTargetsSchema = z.strictObject({
  target_sets: itemRow.target_sets,
  rep_min: itemRow.rep_min,
  rep_max: itemRow.rep_max,
  target_load_kg: itemRow.target_load_kg,
  target_load_basis: itemRow.target_load_basis,
  target_execution_mode: itemRow.target_execution_mode,
  target_implement_count: itemRow.target_implement_count,
  rest_seconds: itemRow.rest_seconds,
  notes: notes.nullable(),
});
export type PlannedExerciseTargets = z.infer<
  typeof PlannedExerciseTargetsSchema
>;
const partialTargets = PlannedExerciseTargetsSchema.partial();

/** One exercise inside one session, with the catalog label resolved for display. */
export const PlannedExerciseSchema = z.strictObject({
  plan_item_id: id,
  session_id: id,
  exercise_id: id,
  /** Resolved from EXERCISES; display only. Never an identity. */
  exercise_name: z.string(),
  exercise_equipment: z.string(),
  exercise_primary_muscle: z.string(),
  /** False when the catalog entry is retired, so the UI can mark it. */
  exercise_active: z.boolean(),
  exercise_order: positiveInt,
  ...PlannedExerciseTargetsSchema.shape,
  status: itemRow.status,
  row_revision: positiveInt,
});
export type PlannedExercise = z.infer<typeof PlannedExerciseSchema>;

/** A planned training day or session type. Its name is free text. */
export const TrainingSessionSchema = z.strictObject({
  session_id: id,
  session_name: z.string(),
  session_order: positiveInt,
  exercises: z.array(PlannedExerciseSchema),
  /** Tombstoned positions, counted but not listed. */
  removed_exercise_count: nonnegativeInt,
  /**
   * False only for a session the editor holds locally that has no storable
   * position yet. A session read back from storage is always persisted.
   */
  persisted: z.boolean(),
});
export type TrainingSession = z.infer<typeof TrainingSessionSchema>;

/** One immutable-once-activated state of a plan. */
export const TrainingPlanVersionSchema = z.strictObject({
  plan_version_id: id,
  plan_family_id: id,
  version_no: positiveInt,
  name: z.string(),
  split_key: planRow.split_key,
  status: planRow.status,
  goal_key: planRow.goal_key,
  days_per_week: planRow.days_per_week,
  activated_at_utc: planRow.activated_at_utc,
  retired_at_utc: planRow.retired_at_utc,
  created_at_utc: ArnoldUtcTimestampSchema,
  updated_at_utc: ArnoldUtcTimestampSchema,
  row_revision: positiveInt,
  sessions: z.array(TrainingSessionSchema),
  session_count: nonnegativeInt,
  exercise_count: nonnegativeInt,
  /** True while content may still be edited, i.e. exactly for a draft. */
  editable: z.boolean(),
  /** Completed workouts already bound to this version; never changed by an edit. */
  workout_count: nonnegativeInt,
});
export type TrainingPlanVersion = z.infer<typeof TrainingPlanVersionSchema>;

/** Compact row for listings and history. */
export const TrainingPlanVersionSummarySchema = z.strictObject({
  plan_version_id: id,
  plan_family_id: id,
  version_no: positiveInt,
  name: z.string(),
  split_key: planRow.split_key,
  status: planRow.status,
  goal_key: planRow.goal_key,
  days_per_week: planRow.days_per_week,
  activated_at_utc: planRow.activated_at_utc,
  retired_at_utc: planRow.retired_at_utc,
  created_at_utc: ArnoldUtcTimestampSchema,
  updated_at_utc: ArnoldUtcTimestampSchema,
  row_revision: positiveInt,
  session_count: nonnegativeInt,
  exercise_count: nonnegativeInt,
  workout_count: nonnegativeInt,
  session_names: z.array(z.string()),
});
export type TrainingPlanVersionSummary = z.infer<
  typeof TrainingPlanVersionSummarySchema
>;

/** The logical plan family: one routine across all of its versions. */
export const TrainingPlanSchema = z.strictObject({
  plan_family_id: id,
  /** Name of the newest version; a family has no name of its own in the schema. */
  name: z.string(),
  active_plan_version_id: id.nullable(),
  latest_version_no: positiveInt,
  draft_plan_version_ids: z.array(id),
  versions: z.array(TrainingPlanVersionSummarySchema),
});
export type TrainingPlan = z.infer<typeof TrainingPlanSchema>;

/**
 * A plan version together with its provenance.
 *
 * Used for the version an editor is working on and for the one a write
 * produced, so a caller always learns what a change was derived from.
 */
export const PlanDraftSchema = z.strictObject({
  version: TrainingPlanVersionSchema,
  /** The version this draft was derived from, when it was. */
  based_on_plan_version_id: id.nullable(),
  /** Schema limits that currently affect this draft. */
  schema_limits: z.array(PlanSchemaLimitSchema),
});
export type PlanDraft = z.infer<typeof PlanDraftSchema>;

/* ------------------------------------------------------------------ changes */

export const PLAN_CHANGE_KINDS = [
  "plan_renamed",
  "plan_metadata_changed",
  "session_added",
  "session_removed",
  "session_renamed",
  "session_reordered",
  "exercise_added",
  "exercise_removed",
  "exercise_replaced",
  "exercise_reordered",
  "targets_changed",
  "execution_changed",
] as const;
export const PlanChangeKindSchema = z.enum(PLAN_CHANGE_KINDS);
export type PlanChangeKind = z.infer<typeof PlanChangeKindSchema>;

/**
 * One traceable difference between two plan states.
 *
 * Both machine-readable (`kind`, ids, `field`, `before`, `after`) and
 * ready for a compact UI (`label`), so a change summary needs no second
 * interpretation layer in React.
 */
export const PlanChangeSchema = z.strictObject({
  kind: PlanChangeKindSchema,
  session_id: id.nullable(),
  session_name: z.string().nullable(),
  plan_item_id: id.nullable(),
  exercise_id: id.nullable(),
  exercise_name: z.string().nullable(),
  field: z.string().nullable(),
  before: z.string().nullable(),
  after: z.string().nullable(),
  label: z.string(),
});
export type PlanChange = z.infer<typeof PlanChangeSchema>;

export const PlanVersionComparisonSchema = z.strictObject({
  from: TrainingPlanVersionSummarySchema,
  to: TrainingPlanVersionSummarySchema,
  same_family: z.boolean(),
  changes: z.array(PlanChangeSchema),
  summary: z.strictObject({
    sessions_added: nonnegativeInt,
    sessions_removed: nonnegativeInt,
    sessions_renamed: nonnegativeInt,
    sessions_reordered: nonnegativeInt,
    exercises_added: nonnegativeInt,
    exercises_removed: nonnegativeInt,
    exercises_replaced: nonnegativeInt,
    exercises_reordered: nonnegativeInt,
    targets_changed: nonnegativeInt,
    execution_changed: nonnegativeInt,
    total: nonnegativeInt,
  }),
  /** Plain-language lines, already ordered for display. */
  headline: z.array(z.string()),
});
export type PlanVersionComparison = z.infer<typeof PlanVersionComparisonSchema>;

/* --------------------------------------------------------------- validation */

export const PLAN_VALIDATION_CODES = [
  "PLAN_VERSION_NOT_FOUND",
  "PLAN_NOT_A_DRAFT",
  "NO_SESSION",
  "NO_ACTIVE_EXERCISE",
  "EMPTY_SESSION",
  "UNKNOWN_EXERCISE",
  "RETIRED_EXERCISE",
  "INCONSISTENT_SESSION",
  "DUPLICATE_SESSION_ORDER",
  "DUPLICATE_EXERCISE_ORDER",
  "DUPLICATE_PLAN_ITEM_ID",
  "INVALID_SET_COUNT",
  "INVALID_REP_RANGE",
  "INVALID_REST",
  "INVALID_TARGET_LOAD",
  "INVALID_EXECUTION",
  "LOAD_BASIS_MISMATCH",
  "UNSUPPORTED_STRUCTURE",
  "SCHEMA_VERSION_MISMATCH",
  "DUPLICATE_EXERCISE_IN_SESSION",
  "DAYS_PER_WEEK_MISMATCH",
  "MISSING_TARGET_SETS",
  "WIDE_REP_RANGE",
] as const;
export const PlanValidationCodeSchema = z.enum(PLAN_VALIDATION_CODES);
export type PlanValidationCode = z.infer<typeof PlanValidationCodeSchema>;

/**
 * One finding. `severity` separates what blocks activation from what is merely
 * worth knowing: training-science advice is never a storage error.
 */
export const PlanValidationIssueSchema = z.strictObject({
  code: PlanValidationCodeSchema,
  severity: z.enum(["error", "warning", "recommendation"]),
  message: z.string(),
  session_id: id.nullable(),
  plan_item_id: id.nullable(),
  exercise_id: id.nullable(),
  field: z.string().nullable(),
});
export type PlanValidationIssue = z.infer<typeof PlanValidationIssueSchema>;

export const PlanValidationResultSchema = z.strictObject({
  /** True only when no blocking error remains; warnings do not block. */
  valid: z.boolean(),
  plan_version_id: id,
  row_revision: positiveInt,
  status: planRow.status,
  schema_id: z.literal(ARNOLD_SCHEMA_ID),
  schema_version: z.literal(ARNOLD_SCHEMA_VERSION),
  errors: z.array(PlanValidationIssueSchema),
  warnings: z.array(PlanValidationIssueSchema),
  recommendations: z.array(PlanValidationIssueSchema),
  /** True when a confirmation for exactly this revision may be issued. */
  activatable: z.boolean(),
});
export type PlanValidationResult = z.infer<typeof PlanValidationResultSchema>;

export const PlanActivationResultSchema = z.strictObject({
  plan_version_id: id,
  plan_family_id: id,
  version_no: positiveInt,
  activated_at_utc: ArnoldUtcTimestampSchema,
  row_revision: positiveInt,
  archived_plan_version_id: id.nullable(),
  archived_at_utc: ArnoldUtcTimestampSchema.nullable(),
  /** Only ever true once both rows are stored in one transaction. */
  verified: z.literal(true),
});
export type PlanActivationResult = z.infer<typeof PlanActivationResultSchema>;

/* --------------------------------------------------------------- operations */

/** A new planned exercise as supplied by a caller. */
export const PlannedExerciseInputSchema = z.strictObject({
  exercise_id: id,
  exercise_order: positiveInt.optional(),
  ...partialTargets.shape,
});
export type PlannedExerciseInput = z.infer<typeof PlannedExerciseInputSchema>;

/** A session as supplied when a whole plan is proposed at once. */
export const TrainingSessionInputSchema = z.strictObject({
  session_name: name,
  session_order: positiveInt.optional(),
  exercises: z.array(PlannedExerciseInputSchema).min(1).max(60),
});
export type TrainingSessionInput = z.infer<typeof TrainingSessionInputSchema>;

/**
 * The typed draft edits.
 *
 * Preferring these over "write back the whole table" is what makes a conflict
 * detectable and an audit event meaningful. `replace_draft_sessions` exists for
 * a genuinely wholesale redesign, and is still checked field by field against
 * the expected revision before anything is written.
 */
export const PlanEditSchema = z.discriminatedUnion("type", [
  z.strictObject({
    type: z.literal("update_plan_metadata"),
    name: name.optional(),
    split_key: z.string().min(1).max(60).nullable().optional(),
    goal_key: z.string().min(1).max(60).nullable().optional(),
    days_per_week: positiveInt.max(7).nullable().optional(),
  }),
  z.strictObject({
    type: z.literal("add_session"),
    session_name: name,
    session_order: positiveInt.optional(),
    /** At least one exercise: an empty session has no storable row. */
    exercises: z.array(PlannedExerciseInputSchema).min(1).max(60),
  }),
  z.strictObject({
    type: z.literal("rename_session"),
    session_id: id,
    session_name: name,
  }),
  z.strictObject({
    type: z.literal("reorder_sessions"),
    /** Every active session exactly once; the array order is the new order. */
    session_ids: z.array(id).min(1).max(30),
  }),
  z.strictObject({
    type: z.literal("duplicate_session"),
    session_id: id,
    session_name: name.optional(),
  }),
  z.strictObject({ type: z.literal("remove_session"), session_id: id }),
  z.strictObject({
    type: z.literal("add_plan_exercise"),
    session_id: id,
    exercise_id: id,
    exercise_order: positiveInt.optional(),
    ...partialTargets.shape,
  }),
  z.strictObject({
    type: z.literal("replace_plan_exercise"),
    plan_item_id: id,
    new_exercise_id: id,
    ...partialTargets.shape,
  }),
  z.strictObject({
    type: z.literal("remove_plan_exercise"),
    plan_item_id: id,
  }),
  z.strictObject({
    type: z.literal("reorder_plan_exercises"),
    session_id: id,
    /** Every active position of the session exactly once. */
    plan_item_ids: z.array(id).min(1).max(60),
  }),
  z.strictObject({
    type: z.literal("update_plan_exercise_targets"),
    plan_item_id: id,
    targets: partialTargets.refine(
      (v) => Object.keys(v).length > 0,
      "Mindestens ein Zielwert erforderlich.",
    ),
  }),
  z.strictObject({
    type: z.literal("update_plan_exercise_execution"),
    plan_item_id: id,
    target_execution_mode: ArnoldExecutionModeSchema.nullable(),
    target_implement_count: positiveInt.nullable().optional(),
    target_load_basis: ArnoldLoadBasisSchema.nullable().optional(),
  }),
  z.strictObject({
    type: z.literal("replace_draft_sessions"),
    sessions: z.array(TrainingSessionInputSchema).min(1).max(30),
  }),
]);
export type PlanEdit = z.infer<typeof PlanEditSchema>;
export type PlanEditType = PlanEdit["type"];

/**
 * An exercise the user trains that is not in the catalog (B11).
 *
 * The sessions of the same call refer to it by `key` in place of an
 * exercise_id. Arnold creates it as the user's own exercise in the same write
 * as the plan, or reuses an existing exercise with the same name. Unknown
 * defaults are filled conservatively and can be edited later.
 */
export const CustomExerciseInputSchema = z.strictObject({
  /** Placeholder used as exercise_id in the sessions, e.g. "custom:1". */
  key: z
    .string()
    .regex(
      /^custom:[a-z0-9-]{1,40}$/,
      'key beginnt mit "custom:" und enthält nur a-z, 0-9 und Bindestriche.',
    ),
  name_de: name,
  equipment: z.string().trim().min(1).max(60).optional(),
  primary_muscle: z.string().trim().min(1).max(60).optional(),
  default_load_basis: ArnoldLoadBasisSchema.optional(),
  default_execution_mode: ArnoldExecutionModeSchema.optional(),
  default_implement_count: positiveInt.max(4).optional(),
});
export type CustomExerciseInput = z.infer<typeof CustomExerciseInputSchema>;

/* -------------------------------------------------------------- tool inputs */

export const PlanWriteInputs = {
  create_training_plan: z.strictObject({
    ...request,
    name,
    split_key: z.string().min(1).max(60).optional(),
    goal_key: z.string().min(1).max(60).optional(),
    days_per_week: positiveInt.max(7).optional(),
    sessions: z.array(TrainingSessionInputSchema).min(1).max(30),
    /** Where the structure came from. A proposal is never activated by itself. */
    origin: z.enum(["manual", "ai_proposal", "imported", "clone"]).optional(),
    /** Continue an existing routine instead of starting a new family. */
    plan_family_id: id.optional(),
    /** Exercises outside the catalog, referenced by key in `sessions`. */
    custom_exercises: z.array(CustomExerciseInputSchema).max(20).optional(),
  }),
  create_plan_version: z.strictObject({
    ...request,
    source_plan_version_id: id,
    name: name.optional(),
    /** True starts an independent routine; false continues the same family. */
    as_new_family: z.boolean().optional(),
  }),
  update_plan_draft: z.strictObject({
    ...request,
    plan_version_id: id,
    expected_row_revision: positiveInt,
    edits: z.array(PlanEditSchema).min(1).max(50),
  }),
  activate_training_plan: z.strictObject({
    ...request,
    plan_version_id: id,
    expected_row_revision: positiveInt,
    /**
     * The user's explicit consent to exactly this version and revision. A
     * successful validation is not a confirmation, so this cannot be derived
     * server-side.
     */
    confirmation: z.strictObject({
      plan_version_id: id,
      row_revision: positiveInt,
      confirmed: z.literal(true),
    }),
  }),
  archive_plan_draft: z.strictObject({
    ...request,
    plan_version_id: id,
    expected_row_revision: positiveInt,
    reason: z.string().min(1).max(500).optional(),
  }),
} as const;
export type PlanWriteOperation = keyof typeof PlanWriteInputs;
export type PlanWriteInput<K extends PlanWriteOperation> = z.infer<
  (typeof PlanWriteInputs)[K]
>;

export const PlanReadInputs = {
  get_training_plan: z.strictObject({
    plan_version_id: id.optional(),
    /** Without an id: the active version, else the newest draft. */
    include_removed: z.boolean().optional(),
  }),
  list_training_plans: z.strictObject({
    statuses: z.array(planRow.status).min(1).optional(),
    plan_family_id: id.optional(),
  }),
  get_plan_history: z.strictObject({ plan_family_id: id.optional() }),
  validate_training_plan: z.strictObject({ plan_version_id: id }),
  compare_plan_versions: z.strictObject({
    from_plan_version_id: id,
    to_plan_version_id: id,
  }),
} as const;

/* ------------------------------------------------------------- tool outputs */

export const PlanWriteResultSchema = z.strictObject({
  /** The version the operation produced or touched, fully projected. */
  plan: PlanDraftSchema.nullable(),
  /** Set only by `activate_training_plan`. */
  activation: PlanActivationResultSchema.nullable(),
  /** Validation of the resulting draft, so the UI needs no second round trip. */
  validation: PlanValidationResultSchema.nullable(),
  /** What this operation changed, for a review step. */
  changes: z.array(PlanChangeSchema),
  warnings: z.array(z.string()),
  /** Named structural limits that applied to this operation. */
  schema_limits: z.array(PlanSchemaLimitSchema),
});
export type PlanWriteResult = z.infer<typeof PlanWriteResultSchema>;

export const PlanErrorCodeSchema = z.enum([
  "VALIDATION_ERROR",
  "PLAN_NOT_FOUND",
  "PLAN_VERSION_NOT_FOUND",
  "SESSION_NOT_FOUND",
  "PLAN_ITEM_NOT_FOUND",
  "EXERCISE_NOT_FOUND",
  "EXERCISE_AMBIGUOUS",
  "PLAN_NOT_EDITABLE",
  "PLAN_INVALID",
  "INVALID_STATUS_TRANSITION",
  "REVISION_CONFLICT",
  "VERSION_NUMBER_CONFLICT",
  "CONFIRMATION_REQUIRED",
  "STALE_CONFIRMATION",
  "ACTIVE_PLAN_CONFLICT",
  "DUPLICATE_OPERATION",
  "SCHEMA_MISMATCH",
  "UNSUPPORTED_BY_SCHEMA",
  "TEMPLATE_WRITE_FORBIDDEN",
  "AUTH_REQUIRED",
  "PERMISSION_DENIED",
  "STORAGE_UNAVAILABLE",
]);
export type PlanErrorCode = z.infer<typeof PlanErrorCodeSchema>;

export const PlanWriteResponseSchema = z.strictObject({
  ok: z.boolean(),
  operation: z.enum(
    Object.keys(PlanWriteInputs) as [
      PlanWriteOperation,
      ...PlanWriteOperation[],
    ],
  ),
  request_id: z.string(),
  /** True when a repeated request_id returned the already-stored result. */
  replayed: z.boolean(),
  result: PlanWriteResultSchema.nullable(),
  error: toolErrorSchema(PlanErrorCodeSchema).nullable(),
});
export type PlanWriteResponse = z.infer<typeof PlanWriteResponseSchema>;

/** One exercise as offered by the picker. */
export const PlanExerciseOptionSchema = z.strictObject({
  exercise_id: id,
  name_de: z.string(),
  name_en: z.string().nullable(),
  family_key: z.string(),
  variant_key: z.string(),
  equipment: z.string(),
  primary_muscle: z.string(),
  default_load_basis: ArnoldLoadBasisSchema,
  default_execution_mode: ArnoldExecutionModeSchema,
  default_implement_count: positiveInt,
});
export type PlanExerciseOption = z.infer<typeof PlanExerciseOptionSchema>;

/**
 * Everything the plan editor needs for one render: the plan on screen, the
 * families for the history view, the catalog for the picker, and the write
 * capabilities of this connection.
 */
export const PlanContextSchema = z.strictObject({
  plan_contract: z.literal(PLAN_CONTRACT),
  tracker_id: id,
  schema_version: z.literal(ARNOLD_SCHEMA_VERSION),
  /** The version the editor should show, already projected. */
  plan: TrainingPlanVersionSchema.nullable(),
  active_plan_version_id: id.nullable(),
  /** Open drafts, newest first. */
  drafts: z.array(TrainingPlanVersionSummarySchema),
  families: z.array(TrainingPlanSchema),
  exercises: z.array(PlanExerciseOptionSchema),
  validation: PlanValidationResultSchema.nullable(),
  write_mode: z.enum(["disabled", "fixture", "database"]),
  can_write: z.boolean(),
  schema_limits: z.array(PlanSchemaLimitSchema),
  generated_at: ArnoldUtcTimestampSchema,
});
export type PlanContext = z.infer<typeof PlanContextSchema>;

export const TrainingPlanListSchema = z.strictObject({
  plan_contract: z.literal(PLAN_CONTRACT),
  active_plan_version_id: id.nullable(),
  families: z.array(TrainingPlanSchema),
  total_versions: nonnegativeInt,
});
export type TrainingPlanList = z.infer<typeof TrainingPlanListSchema>;

export const PlanHistorySchema = z.strictObject({
  plan_contract: z.literal(PLAN_CONTRACT),
  active_plan_version_id: id.nullable(),
  /** Newest first, across families unless one was requested. */
  entries: z.array(
    z.strictObject({
      version: TrainingPlanVersionSummarySchema,
      /** Difference to the currently active version, when there is one. */
      change_count_vs_active: nonnegativeInt.nullable(),
      /** True while this version may still be reused as a basis. */
      reusable: z.boolean(),
    }),
  ),
});
export type PlanHistory = z.infer<typeof PlanHistorySchema>;

/** The UI states of the plan editor. The server never infers these. */
export const PLAN_EDITOR_STATES = [
  "NO_PLAN",
  "VIEWING_ACTIVE",
  "EDITING_DRAFT",
  "SAVING_DRAFT",
  "DRAFT_SAVED",
  "VALIDATING_DRAFT",
  "DRAFT_INVALID",
  "READY_FOR_CONFIRMATION",
  "ACTIVATING",
  "ACTIVATION_CONFIRMED",
  "CONFLICT",
  "ERROR",
] as const;
export const PlanEditorStateSchema = z.enum(PLAN_EDITOR_STATES);
export type PlanEditorState = z.infer<typeof PlanEditorStateSchema>;
