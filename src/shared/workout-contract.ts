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
  write_mode: z.enum(["disabled", "fixture", "database"]),
  can_write: z.boolean(),
  can_correct_completed: z.boolean(),
});
export type WorkoutContext = z.infer<typeof WorkoutContextSchema>;
