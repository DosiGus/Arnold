import { z } from "zod";
import { toolErrorSchema } from "./write-recovery.js";
import {
  ArnoldBodyWeightSchema,
  ArnoldGoalKindSchema,
  ArnoldGoalSchema,
  ArnoldExerciseSchema,
  ArnoldWorkoutSchema,
  ArnoldSetSchema,
  ArnoldPlanItemSchema,
  ArnoldPlanVersionSchema,
  ArnoldIdSchema,
  ArnoldLoadBasisSchema,
  ArnoldExecutionModeSchema,
} from "./arnold-schema-v1.js";

const request = { request_id: z.string().min(1).max(128) };
const id = ArnoldIdSchema;
const text = z.string().min(1).max(4000);
const source = z.enum(["chat", "ui"]).optional();
const s = ArnoldSetSchema.unwrap().shape;
export const SetMeasurementsSchema = z.strictObject({
  set_type: s.set_type,
  reps: s.reps,
  reps_basis: s.reps_basis,
  load_kg: s.load_kg,
  load_basis: s.load_basis,
  implement_count: s.implement_count,
  execution_mode: s.execution_mode,
  side: s.side,
  rpe: s.rpe.optional(),
  rir: s.rir.optional(),
  notes: text.nullable().optional(),
});
export const LogSetSchema = SetMeasurementsSchema.extend({
  exercise_id: id,
  plan_item_id: id.nullable().optional(),
  set_number: s.set_number.optional(),
  exercise_order: s.exercise_order.optional(),
});
/**
 * Values Arnold does not store without an explicit yes from the user (B13):
 * a load above this or more repetitions than this in one set.
 */
export const UNUSUAL_SET_LIMITS = Object.freeze({ load_kg: 500, reps: 100 });
/** Sent only after the user confirmed an unusual value in the chat. */
const unusual = { confirm_unusual_values: z.literal(true).optional() };
const correction = {
  correct_completed: z.boolean().optional(),
  correction_reason: text.optional(),
};
/** How the sets of one exercise are measured; shared by all its sets. */
export const SetConventionsSchema = z.strictObject({
  load_basis: ArnoldLoadBasisSchema,
  execution_mode: ArnoldExecutionModeSchema,
  implement_count: z.number().int().positive(),
  reps_basis: s.reps_basis,
});
export type SetConventions = z.infer<typeof SetConventionsSchema>;
export const ProposedSetSchema = z.strictObject({
  reps: s.reps,
  /** null for bodyweight, or while the weight is still unknown. */
  load_kg: s.load_kg,
  side: s.side,
});
export type ProposedSet = z.infer<typeof ProposedSetSchema>;
/**
 * One exercise of a session as "so gemacht" would save it: the last working
 * sets, else the plan target. `missing` names what is unknown; such an
 * exercise is not saved until it is filled in.
 */
export const ProposedExerciseSchema = z.strictObject({
  plan_item_id: id.nullable(),
  exercise_id: id,
  exercise_name: z.string().min(1),
  conventions: SetConventionsSchema,
  sets: z.array(ProposedSetSchema),
  source: z.enum(["last_time", "plan"]),
  last_date: z.iso.date().nullable(),
  target_sets: z.number().int().positive().nullable(),
  rep_min: z.number().int().nonnegative().nullable(),
  rep_max: z.number().int().nonnegative().nullable(),
  missing: z.array(z.enum(["sets", "reps", "load"])),
});
export type ProposedExercise = z.infer<typeof ProposedExerciseSchema>;
export const SessionProposalSchema = z.strictObject({
  plan_version_id: id,
  session_id: id,
  session_name: z.string().min(1),
  session_order: z.number().int().positive(),
  exercises: z.array(ProposedExerciseSchema),
});
export type SessionProposal = z.infer<typeof SessionProposalSchema>;

/** A set given in `log_workout`; conventions come from the exercise. */
const QuickSetSchema = z.strictObject({
  reps: s.reps,
  load_kg: s.load_kg
    .optional()
    .describe(
      "Gewicht in kg in der Lastdefinition der Übung (z. B. pro Hantel); bei Körpergewicht weglassen.",
    ),
  side: s.side
    .optional()
    .describe("Nur bei einseitigen Übungen: left oder right."),
});
export const LogWorkoutExerciseSchema = z
  .strictObject({
    plan_item_id: id
      .optional()
      .describe(
        "Planposition aus dem Vorschlag, die geändert wird. Ohne plan_item_id wird die Übung zusätzlich angehängt.",
      ),
    exercise_id: id
      .optional()
      .describe(
        "Andere Übung an dieser Planposition (Tausch) oder die zusätzliche Übung.",
      ),
    skip: z
      .boolean()
      .optional()
      .describe("true: diese Planposition heute nicht gemacht."),
    sets: z
      .array(QuickSetSchema)
      .min(1)
      .max(30)
      .optional()
      .describe("Alle Sätze einzeln, wenn sie sich unterscheiden."),
    set_count: z
      .number()
      .int()
      .positive()
      .max(30)
      .optional()
      .describe("Anzahl der Sätze, wenn alle gleich sind."),
    reps: s.reps.optional().describe("Wiederholungen für jeden Satz."),
    load_kg: s.load_kg
      .optional()
      .describe("Gewicht für jeden Satz, in der Lastdefinition der Übung."),
    load_basis: ArnoldLoadBasisSchema.optional().describe(
      "Nur wenn die Last anders gemeint ist als bei der Übung üblich, z. B. added für Zusatzgewicht bei Klimmzügen oder Dips („mit 10 kg Zusatz“), assistance für Unterstützung an der Maschine.",
    ),
  })
  .refine((v) => v.plan_item_id || v.exercise_id, {
    message: "plan_item_id oder exercise_id erforderlich.",
  });
export type LogWorkoutExercise = z.infer<typeof LogWorkoutExerciseSchema>;

export const WriteInputs = {
  start_workout: z.strictObject({
    ...request,
    workout_date_local: z.iso.date(),
    timezone: ArnoldWorkoutSchema.unwrap().shape.timezone,
    session_name: text,
    plan_version_id: id.optional(),
    session_id: id.optional(),
    notes: text.optional(),
    started_at_utc: z.iso
      .datetime()
      .refine((v) => v.endsWith("Z"))
      .optional(),
    source,
  }),
  log_workout_sets: z.strictObject({
    ...request,
    workout_id: id,
    sets: z.array(LogSetSchema).min(1).max(100),
    source,
    ...unusual,
  }),
  update_set: z.strictObject({
    ...request,
    set_id: id,
    expected_row_revision: z.number().int().positive(),
    changes: SetMeasurementsSchema.partial().refine(
      (v) => Object.keys(v).length > 0,
      "Mindestens eine Änderung erforderlich.",
    ),
    ...correction,
    ...unusual,
  }),
  void_set: z.strictObject({
    ...request,
    set_id: id,
    expected_row_revision: z.number().int().positive(),
    ...correction,
  }),
  complete_workout: z.strictObject({
    ...request,
    workout_id: id,
    expected_row_revision: z.number().int().positive(),
    ended_at_utc: z.iso
      .datetime()
      .refine((v) => v.endsWith("Z"))
      .optional(),
  }),
  cancel_workout: z.strictObject({
    ...request,
    workout_id: id,
    expected_row_revision: z.number().int().positive(),
  }),
  log_workout: z.strictObject({
    ...request,
    workout_date_local: z.iso.date(),
    timezone: ArnoldWorkoutSchema.unwrap().shape.timezone,
    plan_version_id: id.optional(),
    session_id: id
      .optional()
      .describe(
        "Trainingstag des Plans; ohne Änderungen werden die Sätze aus dem Vorschlag gespeichert (letztes Mal, sonst Planziel).",
      ),
    session_name: text
      .optional()
      .describe("Name des Trainings; Pflicht ohne session_id."),
    exercises: z
      .array(LogWorkoutExerciseSchema)
      .max(30)
      .optional()
      .describe(
        "Nur Abweichungen vom Vorschlag: Tausch, Weglassen, andere Werte oder zusätzliche Übungen. Ohne session_id die vollständige Liste.",
      ),
    replaces_workout_id: id
      .optional()
      .describe(
        "Ersetzt ein bereits gespeichertes Training desselben Tages (Bearbeiten); das alte wird verworfen.",
      ),
    expected_row_revision: z
      .number()
      .int()
      .positive()
      .optional()
      .describe("Revision des ersetzten Trainings."),
    notes: text.optional(),
    confirm_duplicate: z
      .literal(true)
      .optional()
      .describe(
        "Nur nach ausdrücklichem Ja: dasselbe Training am selben Tag ein weiteres Mal speichern.",
      ),
    source,
    ...unusual,
  }),
  void_workout: z.strictObject({
    ...request,
    workout_id: id,
    expected_row_revision: z.number().int().positive(),
    correction_reason: text,
  }),
  create_exercise: z.strictObject({
    ...request,
    name_de: text,
    name_en: text.nullable().optional(),
    family_key: text,
    variant_key: text,
    equipment: text,
    primary_muscle: text,
    default_load_basis: ArnoldExerciseSchema.unwrap().shape.default_load_basis,
    default_execution_mode:
      ArnoldExerciseSchema.unwrap().shape.default_execution_mode,
    default_implement_count: z.number().int().positive(),
  }),
  create_training_goal: z.strictObject({
    ...request,
    kind: ArnoldGoalKindSchema,
    exercise_id: id
      .optional()
      .describe("Übungs-ID; nur für exercise_load und exercise_reps."),
    target_value: z
      .number()
      .positive()
      .max(1000)
      .describe(
        "Zielwert: kg für body_weight und exercise_load, Wiederholungen für exercise_reps.",
      ),
    load_basis: ArnoldGoalSchema.unwrap()
      .shape.load_basis.unwrap()
      .optional()
      .describe(
        "Nur für exercise_load: Lastdefinition des Ziels; ohne Angabe die der Übung.",
      ),
    source,
  }),
  update_training_goal: z.strictObject({
    ...request,
    goal_id: id,
    expected_row_revision: z.number().int().positive(),
    target_value: z.number().positive().max(1000),
  }),
  archive_training_goal: z.strictObject({
    ...request,
    goal_id: id,
    expected_row_revision: z.number().int().positive(),
  }),
  log_body_weight: z.strictObject({
    ...request,
    measured_on: z.iso
      .date()
      .describe("Lokales Kalenderdatum der Messung, YYYY-MM-DD."),
    timezone: ArnoldWorkoutSchema.unwrap().shape.timezone,
    weight_kg: ArnoldBodyWeightSchema.unwrap().shape.weight_kg,
    source,
  }),
  void_body_weight: z.strictObject({
    ...request,
    body_weight_id: id,
    expected_row_revision: z.number().int().positive(),
  }),
} as const;
export type WriteOperation = keyof typeof WriteInputs;
export type WriteInput<K extends WriteOperation> = z.infer<
  (typeof WriteInputs)[K]
>;
export const WriteErrorCodeSchema = z.enum([
  "VALIDATION_ERROR",
  "EXERCISE_NOT_FOUND",
  "WORKOUT_NOT_FOUND",
  "SET_NOT_FOUND",
  "GOAL_NOT_FOUND",
  "BODY_WEIGHT_NOT_FOUND",
  /** An active goal of that kind for that exercise exists already. */
  "GOAL_EXISTS",
  "INVALID_STATUS_TRANSITION",
  "REVISION_CONFLICT",
  "DUPLICATE_OPERATION",
  "SCHEMA_MISMATCH",
  "TEMPLATE_WRITE_FORBIDDEN",
  "AUTH_REQUIRED",
  "PERMISSION_DENIED",
  "STORAGE_UNAVAILABLE",
  "EXERCISE_MATCH_FOUND",
  /** An unusual value needs the user's explicit yes (B13). */
  "CONFIRMATION_REQUIRED",
  /** The workout date is after today in the workout's time zone (B13). */
  "DATE_IN_FUTURE",
  /** The same session is already saved for that day; ask before a second. */
  "DUPLICATE_WORKOUT",
]);
export type WriteErrorCode = z.infer<typeof WriteErrorCodeSchema>;
export const WriteResultSchema = z.strictObject({
  workout: ArnoldWorkoutSchema.nullable(),
  sets: z.array(ArnoldSetSchema),
  exercise: ArnoldExerciseSchema.nullable(),
  // Added with goals; older stored receipts have neither field.
  goal: ArnoldGoalSchema.nullable().optional(),
  body_weight: ArnoldBodyWeightSchema.nullable().optional(),
  warnings: z.array(z.string()),
});
export type WriteResult = z.infer<typeof WriteResultSchema>;
export const WriteResponseSchema = z
  .strictObject({
    ok: z.boolean(),
    operation: z.enum(
      Object.keys(WriteInputs) as [WriteOperation, ...WriteOperation[]],
    ),
    request_id: z.string(),
    replayed: z.boolean(),
    result: WriteResultSchema.nullable(),
    error: toolErrorSchema(WriteErrorCodeSchema).nullable(),
  })
  .superRefine((value, ctx) => {
    if (
      value.ok
        ? value.result === null || value.error !== null
        : value.result !== null || value.error === null || value.replayed
    )
      ctx.addIssue({
        code: "custom",
        message:
          "Ergebnis und Fehler widersprechen dem bestätigten Operationsstatus.",
      });
  });
export type WriteResponse = z.infer<typeof WriteResponseSchema>;
export const WorkoutContextSchema = z.strictObject({
  tracker_id: ArnoldIdSchema,
  workout: ArnoldWorkoutSchema.nullable(),
  sets: z.array(ArnoldSetSchema),
  workouts: z.array(ArnoldWorkoutSchema),
  exercises: z.array(ArnoldExerciseSchema),
  plans: z.array(ArnoldPlanVersionSchema),
  plan_items: z.array(ArnoldPlanItemSchema),
  /** "So gemacht" for every session of the active plan, in session order. */
  proposals: z.array(SessionProposalSchema),
  write_mode: z.enum(["disabled", "fixture", "database"]),
  can_write: z.boolean(),
  can_correct_completed: z.boolean(),
});
export type WorkoutContext = z.infer<typeof WorkoutContextSchema>;
