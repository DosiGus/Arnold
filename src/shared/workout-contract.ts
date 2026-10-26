import { z } from "zod";
import {
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
  "INVALID_STATUS_TRANSITION",
  "REVISION_CONFLICT",
  "DUPLICATE_OPERATION",
  "SCHEMA_MISMATCH",
  "TEMPLATE_WRITE_FORBIDDEN",
  "AUTH_REQUIRED",
  "PERMISSION_DENIED",
  "STORAGE_UNAVAILABLE",
  "COMMIT_STATUS_UNKNOWN",
  "EXERCISE_MATCH_FOUND",
]);
export type WriteErrorCode = z.infer<typeof WriteErrorCodeSchema>;
export const WriteResultSchema = z.strictObject({
  workout: ArnoldWorkoutSchema.nullable(),
  sets: z.array(ArnoldSetSchema),
  exercise: ArnoldExerciseSchema.nullable(),
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
    error: z
      .strictObject({
        code: WriteErrorCodeSchema,
        message: z.string(),
        retryable: z.boolean(),
        details: z.array(z.string()),
      })
      .nullable(),
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
  write_mode: z.enum(["disabled", "fixture", "test_sheet", "production"]),
  can_write: z.boolean(),
  can_correct_completed: z.boolean(),
});
export type WorkoutContext = z.infer<typeof WorkoutContextSchema>;
