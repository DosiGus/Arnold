import { z } from "zod";
import {
  ARNOLD_SCHEMA_ID,
  ARNOLD_SCHEMA_VERSION,
  type ArnoldDataset,
} from "../shared/arnold-schema-v1.js";
import { computeActivity } from "./activity.js";
import { prepareAnalyticsInput, type PreparedInput } from "./eligibility.js";
import { isCalendarDate } from "./period.js";
import { computePlanAdherence } from "./plans.js";
import { computeExerciseProgress } from "./progress.js";
import { computeDataQuality } from "./quality.js";
import { computeRecords } from "./records.js";
import { computeTrends } from "./trends.js";
import {
  AnalyticsOptionsError,
  parseAnalyticsFilter,
  type AnalyticsFilterInput,
} from "./validation.js";
import { computeVolume } from "./volume.js";
import {
  ArnoldDashboardAnalyticsSchema,
  METRICS_VERSION,
  type ArnoldDashboardAnalytics,
} from "./types.js";

const optionsSchema = z
  .strictObject({
    filter: z.unknown().optional(),
    /** Anchor for "current week" and "current month"; no wall clock is read. */
    reference_date: z
      .string()
      .refine(isCalendarDate, "reference_date muss YYYY-MM-DD sein.")
      .nullish(),
    /** Training days per week the user aims for; no default is assumed. */
    weekly_goal_training_days: z.number().int().min(1).max(7).nullish(),
    progress_exercise_ids: z.array(z.string().min(1)).min(1).nullish(),
    include_series: z.boolean().optional(),
    validate: z.boolean().optional(),
  })
  .partial();

export type AnalyticsOptions = Omit<z.input<typeof optionsSchema>, "filter"> & {
  filter?: AnalyticsFilterInput;
};

/**
 * Prepares the shared per-set analysis for a dataset and a filter. Exposed so a
 * caller that needs several sections can reuse one pass over the set history.
 */
export function prepareAnalytics(
  dataset: ArnoldDataset,
  options: AnalyticsOptions = {},
): PreparedInput {
  const parsed = optionsSchema.safeParse(options);
  if (!parsed.success)
    throw new AnalyticsOptionsError(
      parsed.error.issues.map(
        (issue) => `${issue.path.join(".") || "options"}: ${issue.message}`,
      ),
    );
  return prepareAnalyticsInput(
    dataset,
    parseAnalyticsFilter(options.filter ?? {}),
    parsed.data.reference_date ?? null,
  );
}

/**
 * The single public entry point of the analytics engine.
 *
 * Pure with respect to its input: the dataset is never mutated, no clock, file
 * system or network is touched, and the same dataset with the same options always
 * produces the same object. The result is validated against its Zod schema, so
 * no `NaN`, no `Infinity` and no unlabelled unit can leave this function.
 */
export function buildArnoldDashboardAnalytics(
  dataset: ArnoldDataset,
  options: AnalyticsOptions = {},
): ArnoldDashboardAnalytics {
  const parsed = optionsSchema.safeParse(options);
  if (!parsed.success)
    throw new AnalyticsOptionsError(
      parsed.error.issues.map(
        (issue) => `${issue.path.join(".") || "options"}: ${issue.message}`,
      ),
    );
  const filter = parseAnalyticsFilter(options.filter ?? {});
  const input = prepareAnalyticsInput(
    dataset,
    filter,
    parsed.data.reference_date ?? null,
  );
  const result = {
    metadata: {
      metrics_version: METRICS_VERSION,
      schema_id: ARNOLD_SCHEMA_ID,
      schema_version: ARNOLD_SCHEMA_VERSION,
      tracker_id: dataset.config.tracker_id,
      file_role: dataset.config.file_role,
      period: {
        from: input.periodFrom,
        to: input.periodTo,
        weeks: input.periodWeeks.length,
        reference_date: input.referenceDate,
      },
      filter,
      week_starts_on: "monday",
      unit_mass: "kg",
      dataset_counts: {
        exercises: dataset.exercises.length,
        plans: dataset.plans.length,
        plan_items: dataset.planItems.length,
        workouts: dataset.workouts.length,
        sets: dataset.sets.length,
      },
    },
    activity: computeActivity(
      input,
      parsed.data.weekly_goal_training_days ?? null,
    ),
    volume: computeVolume(input),
    records: computeRecords(input),
    exercise_progress: computeExerciseProgress(
      input,
      parsed.data.progress_exercise_ids ?? null,
      parsed.data.include_series ?? true,
    ),
    weekly_trends: computeTrends(input),
    plan_adherence: computePlanAdherence(input),
    data_quality: computeDataQuality(input),
  };
  return parsed.data.validate === false
    ? (result as ArnoldDashboardAnalytics)
    : ArnoldDashboardAnalyticsSchema.parse(result);
}
