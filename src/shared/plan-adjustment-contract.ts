/**
 * Adjustment for a while (UX-008): inputs and outputs of the four tools.
 *
 * An adjustment is created as a draft, shown in the card "Anpassung auf
 * Zeit" and only takes effect once the user confirms it (button in the card
 * or an explicit yes in the chat). It never changes the active plan; after
 * its last day the normal plan applies again by itself.
 */
import { z } from "zod";
import {
  ArnoldIdSchema,
  ArnoldPlanAdjustmentSchema,
  PLAN_ADJUSTMENT_MAX_DAYS,
} from "./arnold-schema-v1.js";
import { PlanChangeSchema } from "./plan-contract.js";
import { toolErrorSchema } from "./write-recovery.js";
import { WatchDeliverySchema } from "./watch-contract.js";

const id = ArnoldIdSchema;
const request = { request_id: z.string().min(1).max(128) };
const isoDate = z.iso.date();

const timezone = z
  .string()
  .min(1)
  .max(64)
  .refine((value) => {
    try {
      new Intl.DateTimeFormat("en", { timeZone: value });
      return true;
    } catch {
      return false;
    }
  }, "Unbekannte Zeitzone (IANA, z. B. Europe/Berlin).")
  .describe(
    "Zeitzone des Nutzers (IANA, z. B. Europe/Berlin), Pflicht. Anfang, Ende und „heute“ zählen in dieser Zone. Ist eine Uhr gekoppelt, deren Zone nehmen; sonst einmal fragen.",
  );

export const PlanAdjustmentKindSchema = z
  .enum(["today", "week", "month", "range"])
  .describe(
    "today: nur heute (z. B. „heute nur 20 Minuten“). week: ab heute bis Sonntag dieser Woche. month: ab heute bis Monatsende, Ziel Stand halten. range: start_date_local bis end_date_local (z. B. Urlaub). Höchstens 56 Tage.",
  );

export const PlanAdjustmentInputs = {
  create_plan_adjustment: z
    .strictObject({
      ...request,
      timezone,
      kind: PlanAdjustmentKindSchema,
      start_date_local: isoDate
        .optional()
        .describe("Nur bei kind range: erster Tag (inklusive)."),
      end_date_local: isoDate
        .optional()
        .describe("Nur bei kind range: letzter Tag (inklusive)."),
      minutes_per_session: z
        .number()
        .int()
        .min(10)
        .max(180)
        .optional()
        .describe(
          "Minuten pro Einheit, so wie der Nutzer sie nennt. Pflicht bei today. Arnold kürzt Übungen, Sätze und Pausen selbst.",
        ),
      sessions_per_week: z
        .number()
        .int()
        .min(1)
        .max(7)
        .optional()
        .describe(
          "Trainingstage pro Woche im Zeitraum, nur wenn der Nutzer weniger Tage nennt. Bei month Standard 2.",
        ),
      replacements: z
        .array(
          z.strictObject({
            from_exercise_id: id,
            to_exercise_id: id,
          }),
        )
        .max(20)
        .optional()
        .describe(
          "Übungen für die Geräte vor Ort tauschen (IDs aus get_arnold_dashboard.exercises). Das geplante Gewicht entfällt dann.",
        ),
      remove_exercise_ids: z
        .array(id)
        .max(20)
        .optional()
        .describe("Übungen, die im Zeitraum wegfallen (z. B. kein Gerät)."),
      reason: z
        .string()
        .trim()
        .min(1)
        .max(80)
        .optional()
        .describe("Kurzer Anlass in Worten des Nutzers, z. B. „Urlaub“."),
    })
    .superRefine((input, ctx) => {
      const range = input.kind === "range";
      if (range && (!input.start_date_local || !input.end_date_local))
        ctx.addIssue({
          code: "custom",
          path: ["start_date_local"],
          message: "Bei kind range gehören Anfang und Ende dazu.",
        });
      if (!range && (input.start_date_local || input.end_date_local))
        ctx.addIssue({
          code: "custom",
          path: ["kind"],
          message: "Anfang und Ende nur bei kind range angeben.",
        });
      if (input.kind === "today" && input.minutes_per_session === undefined)
        ctx.addIssue({
          code: "custom",
          path: ["minutes_per_session"],
          message: "Für heute gehört die Zeit in Minuten dazu.",
        });
    }),
  confirm_plan_adjustment: z.strictObject({
    ...request,
    plan_adjustment_id: id,
    expected_row_revision: z.number().int().positive(),
  }),
  cancel_plan_adjustment: z.strictObject({
    ...request,
    plan_adjustment_id: id,
    expected_row_revision: z.number().int().positive(),
  }),
} as const;
export type PlanAdjustmentWriteOperation = keyof typeof PlanAdjustmentInputs;

export const GetPlanAdjustmentsInputSchema = z.strictObject({
  plan_adjustment_id: id
    .optional()
    .describe("Genau diese Anpassung; ohne Angabe die neueste offene."),
});

/** One exercise of an adjusted session, for display. */
export const PlanAdjustmentExerciseSchema = z.strictObject({
  exercise_id: id,
  exercise_name: z.string(),
  target_sets: z.number().int().positive().nullable(),
  rep_min: z.number().int().nonnegative().nullable(),
  rep_max: z.number().int().nonnegative().nullable(),
  rest_seconds: z.number().int().nonnegative().nullable(),
  /** Swapped for the equipment at hand: the planned load does not apply. */
  replaced: z.boolean(),
});

export const PlanAdjustmentSessionSchema = z.strictObject({
  session_id: id,
  session_name: z.string(),
  /** Estimated minutes (analytics/session-duration); null when unknown. */
  minutes: z.number().int().nonnegative().nullable(),
  exercises: z.array(PlanAdjustmentExerciseSchema),
});

export const PlanAdjustmentViewSchema = z.strictObject({
  adjustment: ArnoldPlanAdjustmentSchema,
  /** Name of the plan the adjustment is laid over. */
  base_plan_name: z.string(),
  sessions: z.array(PlanAdjustmentSessionSchema),
  /** Old → new, as in the plan change card. */
  changes: z.array(PlanChangeSchema),
  /** First local day on which the normal plan applies again. */
  normal_from: isoDate,
  /** The base plan has run sessions: they stay as they are. */
  runs_unchanged: z.boolean(),
  /** The period was cut to the 56-day limit. */
  capped: z.boolean(),
  /** True while the adjustment applies today (in its own zone). */
  running: z.boolean(),
});
export type PlanAdjustmentView = z.infer<typeof PlanAdjustmentViewSchema>;

/** Stored with the write receipt, so a replay answers the same. */
export const PlanAdjustmentResultSchema = z.strictObject({
  plan_adjustment: PlanAdjustmentViewSchema,
});
export type PlanAdjustmentResult = z.infer<typeof PlanAdjustmentResultSchema>;

export const PlanAdjustmentErrorCodeSchema = z.enum([
  "VALIDATION_ERROR",
  "PLAN_NOT_FOUND",
  "ADJUSTMENT_NOT_FOUND",
  "ADJUSTMENT_OVERLAP",
  "NO_SESSION_TODAY",
  "ALREADY_TRAINED_TODAY",
  "INVALID_STATUS_TRANSITION",
  "REVISION_CONFLICT",
  "EXERCISE_NOT_FOUND",
  "DUPLICATE_OPERATION",
  "SCHEMA_MISMATCH",
  "TEMPLATE_WRITE_FORBIDDEN",
  "AUTH_REQUIRED",
  "PERMISSION_DENIED",
  "STORAGE_UNAVAILABLE",
]);
export type PlanAdjustmentErrorCode = z.infer<
  typeof PlanAdjustmentErrorCodeSchema
>;

export const PlanAdjustmentWriteResponseSchema = z.strictObject({
  ok: z.boolean(),
  operation: z.enum([
    "create_plan_adjustment",
    "confirm_plan_adjustment",
    "cancel_plan_adjustment",
  ]),
  request_id: z.string(),
  replayed: z.boolean(),
  result: PlanAdjustmentResultSchema.nullable(),
  error: toolErrorSchema(PlanAdjustmentErrorCodeSchema).nullable(),
  /** After a confirmation or cancellation: is the new state on the watch? */
  watch_delivery: WatchDeliverySchema.optional(),
});
export type PlanAdjustmentWriteResponse = z.infer<
  typeof PlanAdjustmentWriteResponseSchema
>;

export const PlanAdjustmentListSchema = z.strictObject({
  /** The adjustment that applies today, if any. */
  running: PlanAdjustmentViewSchema.nullable(),
  /** Open drafts and confirmed adjustments that have not ended, by start. */
  adjustments: z.array(PlanAdjustmentViewSchema),
  can_write: z.boolean(),
  max_days: z.literal(PLAN_ADJUSTMENT_MAX_DAYS),
});
export type PlanAdjustmentList = z.infer<typeof PlanAdjustmentListSchema>;
