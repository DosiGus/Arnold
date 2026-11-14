import type { RunDays } from "./activity.js";
import type { PreparedWorkout, PreparedInput } from "./eligibility.js";
import type { SetLoadAnalysis } from "./load.js";
import {
  compareDate,
  isoWeek,
  monthKey,
  monthsBetween,
  weekStart,
} from "./period.js";
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
 *
 * With `runs`, the days of completed runs also count as training days and as
 * trained dates; workouts, sets and volume stay strength-only.
 */
export function computeTrends(input: PreparedInput, runs?: RunDays) {
  const days = runs?.input ?? input;
  const runDatesIn = (keyOf: (date: string) => string) => {
    const byKey = new Map<string, string[]>();
    for (const date of runs?.dates ?? [])
      byKey.set(keyOf(date), [...(byKey.get(keyOf(date)) ?? []), date]);
    return byKey;
  };
  const runWeeks = runDatesIn(weekStart);
  const runMonths = runDatesIn(monthKey);
  const currentWeek =
    days.referenceDate === null ? null : weekStart(days.referenceDate);
  const weeklyBuckets = group(
    input.workouts,
    (workout) => workout.week_start,
    days.periodWeeks,
  );
  const weekly: {
    week_start: string;
    iso_year: number;
    iso_week: number;
    is_current_week: boolean;
    workouts: number;
    training_days: number;
    trained_dates: readonly string[];
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
      training_days: new Set([
        ...bucket.dates,
        ...(runWeeks.get(week_start) ?? []),
      ]).size,
      // Calendar days with a completed session or run, from
      // workout_date_local. Two sessions on one day are one day (D5).
      trained_dates: Object.freeze(
        [
          ...new Set([
            ...bucket.workouts
              .filter((workout) => workout.completed)
              .map((workout) => workout.date),
            ...(runWeeks.get(week_start) ?? []),
          ]),
        ].sort(compareDate),
      ),
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

  // Months come from the period itself. Seeding them from the Monday of the
  // first week would invent a January bucket for a February selection, and the
  // next month would then report an improvement against a month nobody analysed.
  const months = [
    ...new Set([
      ...(days.periodFrom !== null && days.periodTo !== null
        ? monthsBetween(days.periodFrom, days.periodTo)
        : []),
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
      training_days: new Set([...bucket.dates, ...(runMonths.get(month) ?? [])])
        .size,
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
