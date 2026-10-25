import type { PreparedWorkout, PreparedInput } from "./eligibility.js";
import type { SetLoadAnalysis } from "./load.js";
import { compareDate, isoWeek, monthKey, weekStart } from "./period.js";
import { coveredSum, metric, round, unavailable } from "./validation.js";
import type { MetricValue } from "./types.js";

function volumeOf(
  name: string,
  analyses: readonly SetLoadAnalysis[],
): MetricValue {
  return coveredSum(
    name,
    "kg",
    analyses.map((analysis) => analysis.nominal_volume_kg),
    analyses.flatMap((analysis) =>
      analysis.nominal_volume_kg === null ? [...analysis.volume_reasons] : [],
    ),
  );
}

/** Difference to the preceding bucket; null while there is nothing to compare against. */
function change(
  name: string,
  current: MetricValue,
  previous: MetricValue | undefined,
): MetricValue {
  if (!previous || previous.value === null || current.value === null)
    return unavailable(name, "kg", ["no_previous_reference_value"]);
  return metric(
    name,
    round(current.value - previous.value),
    "kg",
    current.status === "partial" || previous.status === "partial"
      ? "partial"
      : "valid",
    [...current.reasons, ...previous.reasons],
  );
}

function group(
  workouts: readonly PreparedWorkout[],
  keyOf: (workout: PreparedWorkout) => string,
  seed: readonly string[],
) {
  const buckets = new Map<
    string,
    { workouts: PreparedWorkout[]; dates: Set<string> }
  >();
  for (const key of seed) buckets.set(key, { workouts: [], dates: new Set() });
  for (const workout of workouts) {
    const key = keyOf(workout);
    const bucket = buckets.get(key) ?? { workouts: [], dates: new Set() };
    bucket.workouts.push(workout);
    bucket.dates.add(workout.date);
    buckets.set(key, bucket);
  }
  return [...buckets.entries()].sort(([a], [b]) => (a < b ? -1 : 1));
}

/**
 * Week and month comparisons. Buckets without any training are kept so a gap is
 * visible as a zero instead of disappearing from the chart.
 */
export function computeTrends(input: PreparedInput) {
  const currentWeek =
    input.referenceDate === null ? null : weekStart(input.referenceDate);
  const weeklyBuckets = group(
    input.workouts,
    (workout) => workout.week_start,
    input.periodWeeks,
  );
  const weekly: {
    week_start: string;
    iso_year: number;
    iso_week: number;
    is_current_week: boolean;
    workouts: number;
    training_days: number;
    working_sets: number;
    nominal_volume: MetricValue;
    volume_change_vs_previous_week: MetricValue;
  }[] = [];
  for (const [week_start, bucket] of weeklyBuckets) {
    const analyses = bucket.workouts.flatMap((workout) => [
      ...workout.analyses,
    ]);
    const nominal_volume = volumeOf("weekly_nominal_volume", analyses);
    weekly.push({
      week_start,
      ...isoWeek(week_start),
      is_current_week: week_start === currentWeek,
      workouts: bucket.workouts.length,
      training_days: bucket.dates.size,
      working_sets: analyses.filter((analysis) => analysis.bucket === "working")
        .length,
      nominal_volume,
      volume_change_vs_previous_week: change(
        "weekly_volume_change",
        nominal_volume,
        weekly.at(-1)?.nominal_volume,
      ),
    });
  }

  const months = [
    ...new Set([
      ...input.periodWeeks.map(monthKey),
      ...input.workouts.map((workout) => monthKey(workout.date)),
    ]),
  ].sort(compareDate);
  const monthlyBuckets = group(
    input.workouts,
    (workout) => monthKey(workout.date),
    months,
  );
  const monthly: {
    month: string;
    workouts: number;
    training_days: number;
    working_sets: number;
    nominal_volume: MetricValue;
    volume_change_vs_previous_month: MetricValue;
  }[] = [];
  for (const [month, bucket] of monthlyBuckets) {
    const analyses = bucket.workouts.flatMap((workout) => [
      ...workout.analyses,
    ]);
    const nominal_volume = volumeOf("monthly_nominal_volume", analyses);
    monthly.push({
      month,
      workouts: bucket.workouts.length,
      training_days: bucket.dates.size,
      working_sets: analyses.filter((analysis) => analysis.bucket === "working")
        .length,
      nominal_volume,
      volume_change_vs_previous_month: change(
        "monthly_volume_change",
        nominal_volume,
        monthly.at(-1)?.nominal_volume,
      ),
    });
  }

  return Object.freeze({
    weekly: Object.freeze(weekly.map((entry) => Object.freeze(entry))),
    monthly: Object.freeze(monthly.map((entry) => Object.freeze(entry))),
  });
}
