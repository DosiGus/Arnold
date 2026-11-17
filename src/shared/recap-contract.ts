import { z } from "zod";
import { ArnoldIdSchema, ArnoldLoadBasisSchema } from "./arnold-schema-v1.js";

/**
 * Rückblick nach dem Training (UX-006).
 *
 * The overview card shows it once, at the top, after a new workout. Every
 * field comes from the server; the card shows and computes nothing. A part the
 * server does not deliver (`records` empty, `week_goal` and `suggestion` null)
 * is not shown at all.
 */
const count = z.number().int().nonnegative();

export const RecapRecordSchema = z.strictObject({
  exercise_id: ArnoldIdSchema,
  exercise_name: z.string().min(1),
  metric: z.enum(["max_load", "max_reps_at_load", "max_reps_bodyweight"]),
  /** kg for max_load, repetitions otherwise. */
  value: z.number().finite(),
  previous_value: z.number().finite(),
  load_kg: z.number().finite().nullable(),
  reps: count.nullable(),
  load_basis: ArnoldLoadBasisSchema,
});

/** The server's own progression for one exercise, for next time. */
export const RecapSuggestionSchema = z.strictObject({
  exercise_id: ArnoldIdSchema,
  exercise_name: z.string().min(1),
  decision: z.enum(["increase", "more_reps", "reduce"]),
  load_basis: ArnoldLoadBasisSchema,
  /** Working weight of the first set next time and last time; null without weight. */
  next_load_kg: z.number().finite().nullable(),
  last_load_kg: z.number().finite().nullable(),
  /** Repetitions of the first set next time and last time. */
  next_reps: count,
  last_reps: count,
});

/** Facts of a new run (UX-014); a value the server does not know is left out. */
export const RecapRunSchema = z.strictObject({
  distance_m: z.number().positive().finite().nullable(),
  duration_s: z.number().positive().finite().nullable(),
  pace_s_per_km: z.number().positive().finite().nullable(),
});

export const ArnoldRecapSchema = z.strictObject({
  /** Absent means a strength workout (before UX-014). */
  kind: z.enum(["strength", "run"]).optional(),
  /** Only for kind "run"; strength fields are then empty and not shown. */
  run: RecapRunSchema.optional(),
  workout_id: ArnoldIdSchema,
  date: z.iso.date(),
  title: z.string().min(1),
  from_watch: z.boolean(),
  exercise_count: count,
  working_set_count: count,
  /** New records of exactly this workout, best first; at most three. */
  records: z.array(RecapRecordSchema).max(3),
  /** Set only when this workout is the one that reached the weekly goal. */
  week_goal: z
    .strictObject({
      goal: z.number().int().positive(),
      training_days: count,
    })
    .nullable(),
  /** At most one; null without a progression from the server. */
  suggestion: RecapSuggestionSchema.nullable(),
  /** Session the suggestion belongs to, so the card can open it. */
  next_session_id: ArnoldIdSchema.nullable(),
});
export type ArnoldRecap = z.infer<typeof ArnoldRecapSchema>;

/** Receipt key of "seen": one per workout, the same on every device. */
export const recapSeenRequestId = (workoutId: string) =>
  `recap-seen:${workoutId}`;

/** Input of `mark_recap_seen`: only the workout; user and key come from the server. */
export const MarkRecapSeenInputSchema = z.strictObject({
  workout_id: ArnoldIdSchema,
});
export type MarkRecapSeenInput = z.infer<typeof MarkRecapSeenInputSchema>;

export const MarkRecapSeenOutputSchema = z.strictObject({
  ok: z.boolean(),
  workout_id: z.string(),
  /** True when it was marked before; nothing was written again. */
  replayed: z.boolean(),
  error: z
    .strictObject({
      code: z.string(),
      message: z.string(),
      retryable: z.boolean(),
    })
    .nullable(),
});
export type MarkRecapSeenOutput = z.infer<typeof MarkRecapSeenOutputSchema>;
