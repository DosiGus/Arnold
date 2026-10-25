import type { SetLoadAnalysis } from "./load.js";
import type { PreparedInput } from "./eligibility.js";
import { isoWeek } from "./period.js";
import { coveredSum, freezeReasons } from "./validation.js";
import {
  VolumeChannelSchema,
  SetBucketSchema,
  type AnalyticsReason,
  type MetricValue,
  type SetBucket,
  type VolumeChannel,
} from "./types.js";

const CHANNELS = VolumeChannelSchema.options;
const BUCKETS = SetBucketSchema.options;

export type VolumeBreakdown = Readonly<{
  nominal_volume: MetricValue;
  by_channel: Record<VolumeChannel, MetricValue>;
  by_bucket: Record<SetBucket, MetricValue>;
  sets: number;
  reps: number;
}>;

function split(analyses: readonly SetLoadAnalysis[]) {
  const excluded: AnalyticsReason[] = [];
  const caveats: AnalyticsReason[] = [];
  for (const analysis of analyses)
    for (const reason of analysis.volume_reasons)
      (analysis.nominal_volume_kg === null ? excluded : caveats).push(reason);
  return { excluded, caveats };
}

function sumOf(
  name: string,
  analyses: readonly SetLoadAnalysis[],
): MetricValue {
  const { excluded, caveats } = split(analyses);
  return coveredSum(
    name,
    "kg",
    analyses.map((analysis) => analysis.nominal_volume_kg),
    excluded,
    caveats,
  );
}

/**
 * Nominal volume is a documentation figure: load per repetition times
 * normalised repetitions, summed over every channel that could be computed.
 * Channels are reported separately because machine displays, added load and
 * free weights are not physically comparable.
 */
export function volumeBreakdown(
  analyses: readonly SetLoadAnalysis[],
): VolumeBreakdown {
  const by_channel = Object.fromEntries(
    CHANNELS.map((channel) => [
      channel,
      sumOf(
        `nominal_volume_${channel}`,
        analyses.filter((analysis) => analysis.channel === channel),
      ),
    ]),
  ) as Record<VolumeChannel, MetricValue>;
  const by_bucket = Object.fromEntries(
    BUCKETS.map((bucket) => [
      bucket,
      sumOf(
        `nominal_volume_${bucket}_sets`,
        analyses.filter((analysis) => analysis.bucket === bucket),
      ),
    ]),
  ) as Record<SetBucket, MetricValue>;
  return Object.freeze({
    nominal_volume: sumOf("nominal_volume", analyses),
    by_channel,
    by_bucket,
    sets: analyses.length,
    reps: analyses.reduce(
      (total, analysis) => total + (analysis.total_reps ?? 0),
      0,
    ),
  });
}

/** Free-weight volume only: the subset that may be compared across exercises. */
function comparableFreeWeight(
  analyses: readonly SetLoadAnalysis[],
): MetricValue {
  const excluded: AnalyticsReason[] = [];
  const values: (number | null)[] = [];
  for (const analysis of analyses) {
    if (analysis.channel === "free_weight") {
      values.push(analysis.nominal_volume_kg);
      continue;
    }
    values.push(null);
    excluded.push(
      ...(analysis.nominal_volume_kg === null
        ? analysis.volume_reasons
        : analysis.channel === "machine_display"
          ? (["machine_load_not_free_weight_comparable"] as const)
          : (["added_load_total_unavailable"] as const)),
    );
  }
  return coveredSum(
    "comparable_free_weight_volume",
    "kg",
    values,
    freezeReasons(excluded),
  );
}

export function computeVolume(input: PreparedInput) {
  const byExercise = new Map<string, SetLoadAnalysis[]>();
  const byWeek = new Map<string, SetLoadAnalysis[]>();
  for (const analysis of input.analyses) {
    const exercise = byExercise.get(analysis.set.exercise_id);
    if (exercise) exercise.push(analysis);
    else byExercise.set(analysis.set.exercise_id, [analysis]);
  }
  for (const week of input.periodWeeks) byWeek.set(week, []);
  for (const workout of input.workouts) {
    const bucket = byWeek.get(workout.week_start);
    if (bucket) bucket.push(...workout.analyses);
    else byWeek.set(workout.week_start, [...workout.analyses]);
  }
  const overall = volumeBreakdown(input.analyses);
  return Object.freeze({
    nominal_volume: overall.nominal_volume,
    comparable_free_weight_volume: comparableFreeWeight(input.analyses),
    by_channel: overall.by_channel,
    by_bucket: overall.by_bucket,
    per_exercise: Object.freeze(
      [...byExercise.entries()]
        .sort(([a], [b]) => (a < b ? -1 : 1))
        .map(([exercise_id, analyses]) =>
          Object.freeze({
            exercise_id,
            ...volumeBreakdown(analyses),
          }),
        ),
    ),
    per_workout: Object.freeze(
      input.workouts.map((workout) =>
        Object.freeze({
          workout_id: workout.workout.workout_id,
          date: workout.date,
          ...volumeBreakdown(workout.analyses),
        }),
      ),
    ),
    per_week: Object.freeze(
      [...byWeek.entries()]
        .sort(([a], [b]) => (a < b ? -1 : 1))
        .map(([week_start, analyses]) =>
          Object.freeze({
            week_start,
            ...isoWeek(week_start),
            ...volumeBreakdown(analyses),
          }),
        ),
    ),
  });
}
