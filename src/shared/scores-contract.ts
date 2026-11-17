/**
 * The three scores of the overview (UX-009) as they travel to the UI.
 *
 * A projection of `src/analytics/scores.ts`: every number is computed there.
 * A score is a whole number 0–100 or `insufficient_data` with a reason, never
 * a guessed value. The parts are what one explanatory sentence needs.
 */
import { z } from "zod";

const score = z.number().int().min(0).max(100);
const count = z.number().int().min(0);
const status = z.enum(["ok", "insufficient_data"]);

export const ConsistencyScoreSchema = z.object({
  status,
  value: score.nullable(),
  reason: z.enum(["no_data", "no_weekly_goal", "too_few_weeks"]).nullable(),
  weekly_goal: z.number().int().min(1).max(7).nullable(),
  weeks_counted: count,
  weeks_goal_met: count,
});

export const ProgressScoreSchema = z.object({
  status,
  value: score.nullable(),
  reason: z.enum(["no_data", "too_few_comparisons"]).nullable(),
  compared: count,
  improved: count,
  held: count,
  exercises_compared: count,
  exercises_improved: count,
  runs: z.array(
    z.object({
      metric: z.enum([
        "easy_pace",
        "easy_efficiency",
        "fast_pace",
        "longest_run",
      ]),
      verdict: z.enum(["up", "same", "down"]),
    }),
  ),
});

const RecoveryPartSchema = z.enum([
  "sleep",
  "resting_hr",
  "hrv",
  "body_battery",
]);

export const RecoveryScoreSchema = z.object({
  status,
  value: score.nullable(),
  reason: z
    .enum([
      "no_data",
      "too_short_history",
      "too_few_training_weeks",
      "no_base_load",
    ])
    .nullable(),
  training_part: score.nullable(),
  watch_part: score.nullable(),
  watch: z.enum(["used", "no_consent", "no_values", "unavailable"]),
  watch_source: z.enum(["daily", "before_workout"]).nullable(),
  parts: z.array(z.object({ kind: RecoveryPartSchema, value: score })),
  strongest_deduction: z
    .object({
      kind: z.union([
        z.enum(["load_increase", "consecutive_days"]),
        RecoveryPartSchema,
      ]),
      points: score,
    })
    .nullable(),
  best: z
    .object({
      kind: z.union([z.literal("training"), RecoveryPartSchema]),
      value: score,
    })
    .nullable(),
  load_ratio: z.number().min(0).nullable(),
  consecutive_days: count,
});

export const ArnoldScoresSchema = z.object({
  consistency: ConsistencyScoreSchema,
  progress: ProgressScoreSchema,
  recovery: RecoveryScoreSchema,
});
export type ArnoldScores = z.infer<typeof ArnoldScoresSchema>;
