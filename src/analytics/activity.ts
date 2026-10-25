import type { PreparedInput } from "./eligibility.js";
import {
  addDays,
  compareDate,
  isoWeek,
  monthKey,
  weekStart,
} from "./period.js";
import { exact, metric, round, unavailable } from "./validation.js";
import type { AnalyticsReason } from "./types.js";

export type WeekActivity = Readonly<{
  week_start: string;
  iso_year: number;
  iso_week: number;
  is_current_week: boolean;
  workouts: number;
  training_days: number;
}>;

/**
 * Weeks start on Monday and are keyed by their Monday date, which keeps the
 * bucket unambiguous across a year boundary. Calendar grouping always uses
 * `workout_date_local`, never a UTC timestamp.
 */
export function weekActivity(input: PreparedInput): WeekActivity[] {
  const days = new Map<string, Set<string>>();
  const counts = new Map<string, number>();
  for (const week of input.periodWeeks) {
    days.set(week, new Set());
    counts.set(week, 0);
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
    input.referenceDate === null ? null : weekStart(input.referenceDate);
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
) {
  const weeks = weekActivity(input);
  const weekCount = weeks.length;
  const empty: AnalyticsReason[] = input.workouts.length
    ? []
    : ["no_eligible_workouts"];
  const month =
    input.referenceDate === null ? null : monthKey(input.referenceDate);
  return Object.freeze({
    workouts: exact("workouts", input.workouts.length, "workouts"),
    training_days: exact("training_days", input.trainingDates.length, "days"),
    average_workouts_per_week: weekCount
      ? metric(
          "average_workouts_per_week",
          round(input.workouts.length / weekCount),
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
          round(input.trainingDates.length / weekCount),
          "days",
          "valid",
          empty,
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
            input.trainingDates.filter((date) => monthKey(date) === month)
              .length,
            "days",
          ),
    current_month: month,
    first_training_date: input.trainingDates[0] ?? null,
    last_training_date: input.trainingDates.at(-1) ?? null,
    weeks: Object.freeze(weeks),
    week_streak: weekStreak(weeks, input.referenceDate, weeklyGoalTrainingDays),
  });
}
