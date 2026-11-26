import type { ArnoldDataset } from "../shared/arnold-schema-v1.js";
import { DEFAULT_WORKOUT_STATUSES, type PreparedInput } from "./eligibility.js";
import {
  addDays,
  compareDate,
  isoWeek,
  monthKey,
  weekStart,
  weekStartsBetween,
} from "./period.js";
import { exact, metric, round, unavailable } from "./validation.js";
import type { AnalyticsReason } from "./types.js";
import type { ScoreRunInput } from "./scores.js";
import type { RunRecapInput } from "./recap.js";
import type { RunInput } from "./running/metrics/types.js";

export type WeekActivity = Readonly<{
  week_start: string;
  iso_year: number;
  iso_week: number;
  is_current_week: boolean;
  workouts: number;
  training_days: number;
}>;

/**
 * A dataset as the store source hands it over: strength training only, plus the
 * calendar days of completed runs. Runs never reach the strength figures; the
 * server's loader reads those days from the raw data and attaches them here so
 * the pure engine can count them as training days (RUN-022).
 */
export type DatasetWithRunDays = ArnoldDataset &
  Readonly<{
    runTrainingDates?: readonly string[];
    /** Completed runs as the scores need them (UX-009); nothing else reads them. */
    runScoreInputs?: readonly ScoreRunInput[];
    /** Completed runs as the recap after a run needs them (UX-014). */
    runRecapInputs?: readonly RunRecapInput[];
    /** Completed runs as running records and run goals read them. */
    runRecordInputs?: readonly RunInput[];
  }>;

/**
 * Calendar days (`workout_date_local`) of completed runs, ascending and without
 * duplicates. A planned, in-progress, cancelled or voided run is not a day the
 * user trained. Works on a dataset that still contains its runs; one already
 * reduced to strength training carries the days in `runTrainingDates`.
 */
export function runTrainingDates(dataset: ArnoldDataset): readonly string[] {
  return Object.freeze(
    [
      ...new Set(
        dataset.workouts
          .filter((w) => w.activity_type === "run" && w.status === "completed")
          .map((w) => w.workout_date_local),
      ),
    ].sort(compareDate),
  );
}

/** Every run day the dataset knows: its own completed runs and the carried days. */
export function runTrainingDatesOf(
  dataset: DatasetWithRunDays,
): readonly string[] {
  const carried = dataset.runTrainingDates ?? [];
  const own = runTrainingDates(dataset);
  return carried.length
    ? Object.freeze([...new Set([...own, ...carried])].sort(compareDate))
    : own;
}

/**
 * The run days that count for one analysis, and the input widened to cover them.
 * Strength figures keep reading the original input.
 */
export type RunDays = Readonly<{
  /** Completed-run days inside the selection, ascending, unique. */
  dates: readonly string[];
  /** The input with its period, reference date and training dates widened. */
  input: PreparedInput;
}>;

/**
 * Applies a selection to the run days. A date range narrows them. A filter that
 * asks for specific exercises, set types, plans, sessions or workouts is about
 * strength training and leaves runs out, and so does a status selection without
 * `completed` (a run counts only once it is completed). Returns `undefined` when
 * no run day remains, so the strength-only path stays exactly as it was.
 *
 * An explicit reference date is kept; otherwise the current week follows the
 * newest activity of either kind.
 */
export function resolveRunDays(
  input: PreparedInput,
  runDates: readonly string[],
  explicitReference: boolean,
): RunDays | undefined {
  const filter = input.filter;
  if (
    filter.exercise_ids !== null ||
    filter.set_types !== null ||
    filter.plan_version_ids !== null ||
    filter.session_ids !== null ||
    filter.workout_ids !== null ||
    !(filter.workout_statuses ?? DEFAULT_WORKOUT_STATUSES).includes("completed")
  )
    return undefined;
  const dates = [
    ...new Set(
      runDates.filter(
        (date) =>
          (filter.from === null || compareDate(date, filter.from) >= 0) &&
          (filter.to === null || compareDate(date, filter.to) <= 0),
      ),
    ),
  ].sort(compareDate);
  if (!dates.length) return undefined;
  const first = dates[0];
  const last = dates.at(-1)!;
  const periodFrom =
    input.periodFrom === null || compareDate(first, input.periodFrom) < 0
      ? first
      : input.periodFrom;
  const periodTo =
    input.periodTo === null || compareDate(last, input.periodTo) > 0
      ? last
      : input.periodTo;
  const union = (known: readonly string[]) =>
    Object.freeze([...new Set([...known, ...dates])].sort(compareDate));
  return Object.freeze({
    dates: Object.freeze(dates),
    input: Object.freeze({
      ...input,
      trainingDates: union(input.trainingDates),
      completedTrainingDates: union(input.completedTrainingDates),
      periodFrom,
      periodTo,
      periodWeeks: Object.freeze(weekStartsBetween(periodFrom, periodTo)),
      referenceDate:
        explicitReference ||
        (input.referenceDate !== null &&
          compareDate(last, input.referenceDate) <= 0)
          ? input.referenceDate
          : last,
    }),
  });
}

/**
 * Weeks start on Monday and are keyed by their Monday date, which keeps the
 * bucket unambiguous across a year boundary. Calendar grouping always uses
 * `workout_date_local`, never a UTC timestamp. With `runs`, the days of
 * completed runs count as training days (never as workouts).
 */
export function weekActivity(
  input: PreparedInput,
  runs?: RunDays,
): WeekActivity[] {
  const base = runs?.input ?? input;
  const days = new Map<string, Set<string>>();
  const counts = new Map<string, number>();
  for (const week of base.periodWeeks) {
    days.set(week, new Set());
    counts.set(week, 0);
  }
  for (const date of runs?.dates ?? []) {
    const week = weekStart(date);
    if (!days.has(week)) {
      days.set(week, new Set());
      counts.set(week, 0);
    }
    days.get(week)!.add(date);
  }
  for (const workout of input.workouts) {
    const week = workout.week_start;
    if (!days.has(week)) {
      days.set(week, new Set());
      counts.set(week, 0);
    }
    days.get(week)!.add(workout.date);
    counts.set(week, counts.get(week)! + 1);
  }
  const currentWeek =
    base.referenceDate === null ? null : weekStart(base.referenceDate);
  return [...days.keys()].sort(compareDate).map((week_start) =>
    Object.freeze({
      week_start,
      ...isoWeek(week_start),
      is_current_week: week_start === currentWeek,
      workouts: counts.get(week_start)!,
      training_days: days.get(week_start)!.size,
    }),
  );
}

/**
 * Consecutive Monday-based weeks that reached the weekly training-day goal.
 *
 * The week containing the reference date is still in progress: it never breaks a
 * streak earned in completed weeks, and it only extends the streak once the goal
 * is already met. Without an explicit goal no streak is reported; the engine
 * does not assume a default training frequency.
 */
export function weekStreak(
  weeks: readonly WeekActivity[],
  referenceDate: string | null,
  weeklyGoalTrainingDays: number | null,
) {
  const currentWeek = referenceDate === null ? null : weekStart(referenceDate);
  const byWeek = new Map(weeks.map((week) => [week.week_start, week]));
  const current = currentWeek === null ? null : byWeek.get(currentWeek);
  const currentTrainingDays = current?.training_days ?? 0;
  const goal = weeklyGoalTrainingDays;
  if (goal === null)
    return Object.freeze({
      weekly_goal_training_days: null,
      completed_weeks_streak: unavailable("completed_weeks_streak", "weeks", [
        "weekly_goal_not_configured",
      ]),
      longest_streak: unavailable("longest_streak", "weeks", [
        "weekly_goal_not_configured",
      ]),
      current_week_training_days: currentTrainingDays,
      current_week_goal_met: null,
      includes_current_week: false,
    });

  const met = (week: string) => (byWeek.get(week)?.training_days ?? 0) >= goal;
  const earliest = weeks[0]?.week_start ?? null;
  const currentGoalMet = currentWeek === null ? false : met(currentWeek);
  const lastCompleted =
    currentWeek === null
      ? (weeks.at(-1)?.week_start ?? null)
      : addDays(currentWeek, -7);

  let streak = currentGoalMet ? 1 : 0;
  if (earliest !== null && lastCompleted !== null)
    for (
      let week = lastCompleted;
      compareDate(week, earliest) >= 0 && met(week);
      week = addDays(week, -7)
    )
      streak += 1;

  let longest = 0;
  let run = 0;
  if (earliest !== null) {
    const last =
      currentWeek !== null && currentGoalMet ? currentWeek : lastCompleted;
    for (
      let week = earliest;
      last !== null && compareDate(week, last) <= 0;
      week = addDays(week, 7)
    ) {
      run = met(week) ? run + 1 : 0;
      longest = Math.max(longest, run);
    }
  }
  return Object.freeze({
    weekly_goal_training_days: goal,
    completed_weeks_streak: exact("completed_weeks_streak", streak, "weeks"),
    longest_streak: exact("longest_streak", Math.max(longest, streak), "weeks"),
    current_week_training_days: currentTrainingDays,
    current_week_goal_met: currentWeek === null ? null : currentGoalMet,
    includes_current_week: currentGoalMet,
  });
}

export function computeActivity(
  input: PreparedInput,
  weeklyGoalTrainingDays: number | null,
  runs?: RunDays,
) {
  // Workout figures stay on the strength input; day figures also see run days.
  const days = runs?.input ?? input;
  const weeks = weekActivity(input, runs);
  const weekCount = weeks.length;
  const workoutWeekCount = runs ? weekActivity(input).length : weekCount;
  const empty: AnalyticsReason[] = input.workouts.length
    ? []
    : ["no_eligible_workouts"];
  const emptyDays: AnalyticsReason[] = days.trainingDates.length
    ? []
    : ["no_eligible_workouts"];
  const month =
    days.referenceDate === null ? null : monthKey(days.referenceDate);
  return Object.freeze({
    // `workouts` follows the selection, which a `workout_statuses` filter can
    // widen on purpose. The `completed_*` counters never do: they are the
    // figures that claim a session was actually finished.
    workouts: exact("workouts", input.workouts.length, "workouts"),
    completed_workouts: exact(
      "completed_workouts",
      input.completedWorkouts.length,
      "workouts",
    ),
    training_days: exact("training_days", days.trainingDates.length, "days"),
    completed_training_days: exact(
      "completed_training_days",
      days.completedTrainingDates.length,
      "days",
    ),
    average_workouts_per_week: workoutWeekCount
      ? metric(
          "average_workouts_per_week",
          round(input.workouts.length / workoutWeekCount),
          "workouts",
          "valid",
          empty,
        )
      : unavailable("average_workouts_per_week", "workouts", [
          "no_eligible_workouts",
        ]),
    average_training_days_per_week: weekCount
      ? metric(
          "average_training_days_per_week",
          round(days.trainingDates.length / weekCount),
          "days",
          "valid",
          emptyDays,
        )
      : unavailable("average_training_days_per_week", "days", [
          "no_eligible_workouts",
        ]),
    training_days_current_month:
      month === null
        ? unavailable("training_days_current_month", "days", [
            "no_eligible_workouts",
          ])
        : exact(
            "training_days_current_month",
            days.trainingDates.filter((date) => monthKey(date) === month)
              .length,
            "days",
          ),
    current_month: month,
    first_training_date: days.trainingDates[0] ?? null,
    last_training_date: days.trainingDates.at(-1) ?? null,
    weeks: Object.freeze(weeks),
    week_streak: weekStreak(weeks, days.referenceDate, weeklyGoalTrainingDays),
  });
}
