/**
 * The figures of the start screen: streak, year, strength, muscle groups,
 * records and goals.
 *
 * Pure like the rest of the engine. Everything is computed from completed
 * workouts and calendar dates as written (`workout_date_local`); no clock is
 * read, the reference date comes in from the caller.
 */
import type { ArnoldLoadBasis } from "../shared/arnold-schema-v1.js";
import { weekActivity, weekStreak, type RunDays } from "./activity.js";
import type { PreparedInput } from "./eligibility.js";
import { goalProgress, type GoalProgress } from "./goals.js";
import { addDays, compareDate, monthKey, weekStart } from "./period.js";
import { computeRecords } from "./records.js";
import { computeRunRecords, type RunRecord } from "./run-records.js";
import type { RunInput } from "./running/metrics/index.js";
import { round } from "./validation.js";
import type { PersonalRecord } from "./types.js";

/** Weeks shown in the streak strip, the current one included. */
export const STREAK_STRIP_WEEKS = 8;
/** Window of the per-muscle-group strength change. */
export const MUSCLE_GAIN_WINDOW_DAYS = 56;
/** Window of the per-muscle-group sets per week. */
export const MUSCLE_SETS_WINDOW_DAYS = 28;
/** Label for exercises without a usable muscle group. */
export const OTHER_MUSCLE_GROUP = "Sonstiges";

export type HomeStreakWeek = Readonly<{
  week_start: string;
  training_days: number;
  goal_met: boolean;
  is_current_week: boolean;
}>;

export type HomeStreak = Readonly<{
  /** Training days per week that make a week count; null without a plan. */
  weekly_goal: number | null;
  current: number | null;
  longest: number | null;
  /** True when the current streak is the longest one so far. */
  is_best: boolean;
  current_week_training_days: number;
  /** Oldest first; the last entry is the current week. */
  weeks: readonly HomeStreakWeek[];
}>;

export type HomeRecord = Readonly<{
  /** Stable key: the set that set the record. */
  key: string;
  exercise_id: string;
  metric: "max_load" | "max_reps_at_load" | "max_reps_bodyweight";
  /** kg for max_load, repetitions otherwise. */
  value: number;
  previous_value: number;
  load_kg: number | null;
  reps: number | null;
  load_basis: ArnoldLoadBasis;
  achieved_on: string;
  workout_id: string;
}>;

export type HomeExerciseRecords = Readonly<{
  exercise_id: string;
  /** The record set most recently. */
  latest: HomeRecord;
  count: number;
  /** Every record of the exercise, newest first. */
  history: readonly HomeRecord[];
}>;

export type HomeMuscleGroup = Readonly<{
  name: string;
  /** Average change of the estimated 1RM in the last eight weeks, in percent. */
  strength_change_pct: number | null;
  records: number;
  /** Working sets per week over the last four weeks. */
  sets_per_week: number;
}>;

export type HomeExerciseBest = Readonly<{
  exercise_id: string;
  /** Heaviest working set in the exercise's own load convention. */
  best_load_kg: number | null;
  best_load_reps: number | null;
  load_basis: ArnoldLoadBasis;
  /** Most repetitions in one working set. */
  best_reps: number | null;
}>;

export type HomeNextSession = Readonly<{
  plan_version_id: string;
  session_id: string;
  session_name: string;
  exercise_count: number;
}>;

export type HomeAnalytics = Readonly<{
  reference_date: string | null;
  /** The plan session after the last one trained; the first one to begin with. */
  next_session: HomeNextSession | null;
  streak: HomeStreak;
  workouts_this_year: number;
  /** Average change of the estimated 1RM across all exercises since the start. */
  strength_change: Readonly<{
    percent: number | null;
    since: string | null;
    exercises: number;
  }>;
  best_month: Readonly<{ month: string; workouts: number }> | null;
  muscle_groups: readonly HomeMuscleGroup[];
  records: readonly HomeRecord[];
  records_by_exercise: readonly HomeExerciseRecords[];
  /** Running records over every completed run (src/analytics/run-records.ts). */
  run_records: readonly RunRecord[];
  goals: readonly GoalProgress[];
  exercise_bests: readonly HomeExerciseBest[];
  latest_body_weight: Readonly<{ date: string; weight_kg: number }> | null;
}>;

function streakOf(
  input: PreparedInput,
  weeklyGoal: number | null,
  runs?: RunDays,
): HomeStreak {
  // Training days include completed runs; everything else on this screen stays
  // strength-only.
  const reference = (runs?.input ?? input).referenceDate;
  const weeks = weekActivity(input, runs);
  const streak = weekStreak(weeks, reference, weeklyGoal);
  const byWeek = new Map(weeks.map((w) => [w.week_start, w]));
  const anchor = reference ?? input.dataLastDate ?? weeks.at(-1)?.week_start;
  const strip: HomeStreakWeek[] = [];
  if (anchor) {
    const current = weekStart(anchor);
    for (let i = STREAK_STRIP_WEEKS - 1; i >= 0; i -= 1) {
      const week = addDays(current, -7 * i);
      const days = byWeek.get(week)?.training_days ?? 0;
      strip.push(
        Object.freeze({
          week_start: week,
          training_days: days,
          goal_met: weeklyGoal !== null && days >= weeklyGoal,
          is_current_week: i === 0 && reference !== null,
        }),
      );
    }
  }
  const current = streak.completed_weeks_streak.value;
  const longest = streak.longest_streak.value;
  return Object.freeze({
    weekly_goal: weeklyGoal,
    current,
    longest,
    is_best: current !== null && current > 0 && current === longest,
    current_week_training_days: streak.current_week_training_days,
    weeks: Object.freeze(strip),
  });
}

/** Best estimated 1RM per day for one exercise, in its most used comparability. */
function oneRmSeries(input: PreparedInput) {
  const byKey = new Map<
    string,
    { exercise_id: string; days: Map<string, number> }
  >();
  for (const workout of input.completedWorkouts)
    for (const analysis of workout.analyses) {
      if (analysis.bucket !== "working" || analysis.one_rm_kg === null)
        continue;
      const key = analysis.comparability.key;
      let entry = byKey.get(key);
      if (!entry) {
        entry = { exercise_id: analysis.set.exercise_id, days: new Map() };
        byKey.set(key, entry);
      }
      const day = entry.days.get(analysis.date);
      if (day === undefined || analysis.one_rm_kg > day)
        entry.days.set(analysis.date, analysis.one_rm_kg);
    }
  const dominant = new Map<string, Map<string, number>>();
  for (const [key, entry] of [...byKey].sort(([a], [b]) => (a < b ? -1 : 1))) {
    const current = dominant.get(entry.exercise_id);
    if (!current || entry.days.size > current.size)
      dominant.set(entry.exercise_id, entry.days);
    void key;
  }
  return dominant;
}

/** First against last day inside the window, as a percentage. */
function changePct(days: Map<string, number>, from: string | null) {
  const points = [...days.entries()]
    .filter(([date]) => from === null || compareDate(date, from) >= 0)
    .sort(([a], [b]) => compareDate(a, b));
  if (points.length < 2) return null;
  const first = points[0];
  const last = points[points.length - 1];
  if (first[1] <= 0) return null;
  return {
    pct: ((last[1] - first[1]) / first[1]) * 100,
    since: first[0],
  };
}

const average = (values: readonly number[]) =>
  values.length
    ? round(values.reduce((sum, v) => sum + v, 0) / values.length)
    : null;

/**
 * Records the way a person counts them: more weight, or more repetitions at
 * the same weight. Bodyweight exercises count more repetitions. The first time
 * an exercise is done is a starting point, not a record. One exercise in one
 * workout is at most one record, even when it beat two things at once or both
 * sides of a one-arm exercise improved: a heavier load wins over more
 * repetitions, a higher value over a lower one.
 */
function recordsOf(input: PreparedInput): HomeRecord[] {
  const events = computeRecords(input).events_in_period;
  const bySet = new Map<string, HomeRecord>();
  const rank = (r: HomeRecord) => (r.metric === "max_load" ? 1 : 0);
  const add = (record: HomeRecord) => {
    const slot = `${record.exercise_id}|${record.workout_id}`;
    const existing = bySet.get(slot);
    if (
      !existing ||
      rank(record) > rank(existing) ||
      (rank(record) === rank(existing) && record.value > existing.value)
    )
      bySet.set(slot, record);
  };
  for (const event of events as readonly PersonalRecord[]) {
    if (
      event.kind !== "improvement" ||
      event.previous_value === null ||
      event.set_id === null ||
      (event.metric !== "max_load" && event.metric !== "max_reps_at_load")
    )
      continue;
    add(
      Object.freeze({
        key: event.set_id,
        exercise_id: event.exercise_id,
        metric: event.metric,
        value: event.value,
        previous_value: event.previous_value,
        load_kg: event.at_load_kg,
        reps: event.reps,
        load_basis: event.comparability?.load_basis ?? "total",
        achieved_on: event.achieved_on,
        workout_id: event.workout_id,
      }),
    );
  }
  // Bodyweight repetitions have no comparable load, so the engine's records
  // leave them out. Counted here per exercise and execution.
  const best = new Map<string, number>();
  for (const workout of input.completedWorkouts)
    for (const analysis of workout.analyses) {
      const set = analysis.set;
      if (analysis.bucket !== "working" || set.load_basis !== "bodyweight_only")
        continue;
      const reps = analysis.one_rm_reps ?? analysis.total_reps;
      if (reps === null || reps < 1) continue;
      const key = analysis.comparability.key;
      const previous = best.get(key);
      if (previous !== undefined && reps > previous)
        add(
          Object.freeze({
            key: set.set_id,
            exercise_id: set.exercise_id,
            metric: "max_reps_bodyweight",
            value: reps,
            previous_value: previous,
            load_kg: null,
            reps,
            load_basis: "bodyweight_only",
            achieved_on: analysis.date,
            workout_id: set.workout_id,
          }),
        );
      if (previous === undefined || reps > previous) best.set(key, reps);
    }
  return [...bySet.values()].sort(
    (a, b) =>
      compareDate(b.achieved_on, a.achieved_on) ||
      (a.key < b.key ? 1 : a.key > b.key ? -1 : 0),
  );
}

function exerciseBests(input: PreparedInput): HomeExerciseBest[] {
  const bests = new Map<string, HomeExerciseBest>();
  for (const workout of input.completedWorkouts)
    for (const analysis of workout.analyses) {
      const set = analysis.set;
      if (analysis.bucket !== "working") continue;
      const exercise = input.exercisesById.get(set.exercise_id);
      const basis = exercise?.default_load_basis ?? set.load_basis;
      const current = bests.get(set.exercise_id) ?? {
        exercise_id: set.exercise_id,
        best_load_kg: null,
        best_load_reps: null,
        load_basis: basis,
        best_reps: null,
      };
      let next = current;
      if (
        set.load_basis === basis &&
        set.load_kg !== null &&
        basis !== "bodyweight_only" &&
        basis !== "assistance" &&
        (current.best_load_kg === null ||
          set.load_kg > current.best_load_kg ||
          (set.load_kg === current.best_load_kg &&
            set.reps > (current.best_load_reps ?? 0)))
      )
        next = { ...next, best_load_kg: set.load_kg, best_load_reps: set.reps };
      if (next.best_reps === null || set.reps > next.best_reps)
        next = { ...next, best_reps: set.reps };
      bests.set(set.exercise_id, next);
    }
  return [...bests.values()]
    .map((b) => Object.freeze(b))
    .sort((a, b) => (a.exercise_id < b.exercise_id ? -1 : 1));
}

export function nextSession(input: PreparedInput): HomeNextSession | null {
  const plan = input.dataset.plans.find((p) => p.status === "active");
  if (!plan) return null;
  const sessions = new Map<
    string,
    { name: string; order: number; exercises: Set<string> }
  >();
  for (const item of input.dataset.planItems) {
    if (
      item.plan_version_id !== plan.plan_version_id ||
      item.status !== "active"
    )
      continue;
    const entry = sessions.get(item.session_id) ?? {
      name: item.session_name,
      order: item.session_order,
      exercises: new Set<string>(),
    };
    entry.exercises.add(item.exercise_id);
    sessions.set(item.session_id, entry);
  }
  const ordered = [...sessions.entries()].sort(
    ([a, x], [b, y]) => x.order - y.order || (a < b ? -1 : 1),
  );
  if (!ordered.length) return null;
  const last = [...input.dataset.workouts]
    .filter(
      (w) =>
        w.status === "completed" &&
        w.plan_version_id === plan.plan_version_id &&
        w.session_id !== null,
    )
    .sort(
      (a, b) =>
        compareDate(a.workout_date_local, b.workout_date_local) ||
        (a.created_at_utc < b.created_at_utc ? -1 : 1),
    )
    .at(-1);
  const index = last ? ordered.findIndex(([id]) => id === last.session_id) : -1;
  const [session_id, next] = ordered[(index + 1) % ordered.length];
  return Object.freeze({
    plan_version_id: plan.plan_version_id,
    session_id,
    session_name: next.name,
    exercise_count: next.exercises.size,
  });
}

export function computeHome(
  input: PreparedInput,
  weeklyGoal: number | null,
  runs?: RunDays,
  /** Completed runs, for running records and running goals. */
  runInputs: readonly RunInput[] = [],
): HomeAnalytics {
  const reference = input.referenceDate ?? input.dataLastDate;
  const completed = input.completedWorkouts;
  const groupOf = (exerciseId: string) =>
    input.exercisesById.get(exerciseId)?.primary_muscle.trim() ||
    OTHER_MUSCLE_GROUP;

  // Strength since the start, and per muscle group over the last weeks.
  const series = oneRmSeries(input);
  const overall: number[] = [];
  let since: string | null = null;
  const gainByGroup = new Map<string, number[]>();
  const gainFrom =
    reference === null
      ? null
      : addDays(reference, -(MUSCLE_GAIN_WINDOW_DAYS - 1));
  for (const [exerciseId, days] of [...series].sort(([a], [b]) =>
    a < b ? -1 : 1,
  )) {
    const all = changePct(days, null);
    if (all) {
      overall.push(all.pct);
      if (since === null || compareDate(all.since, since) < 0)
        since = all.since;
    }
    const recent = changePct(days, gainFrom);
    if (recent) {
      const group = groupOf(exerciseId);
      gainByGroup.set(group, [...(gainByGroup.get(group) ?? []), recent.pct]);
    }
  }

  const records = recordsOf(input);
  const recordsByGroup = new Map<string, number>();
  for (const record of records) {
    const group = groupOf(record.exercise_id);
    recordsByGroup.set(group, (recordsByGroup.get(group) ?? 0) + 1);
  }

  const setsFrom =
    reference === null
      ? null
      : addDays(reference, -(MUSCLE_SETS_WINDOW_DAYS - 1));
  const setsByGroup = new Map<string, number>();
  const trainedGroups = new Set<string>();
  for (const workout of completed)
    for (const analysis of workout.analyses) {
      if (analysis.bucket !== "working") continue;
      const group = groupOf(analysis.set.exercise_id);
      trainedGroups.add(group);
      if (
        setsFrom !== null &&
        compareDate(analysis.date, setsFrom) >= 0 &&
        compareDate(analysis.date, reference!) <= 0
      )
        setsByGroup.set(group, (setsByGroup.get(group) ?? 0) + 1);
    }
  const weeksInWindow = MUSCLE_SETS_WINDOW_DAYS / 7;
  const muscle_groups = [...trainedGroups]
    .sort((a, b) => a.localeCompare(b, "de"))
    .map((name) =>
      Object.freeze({
        name,
        strength_change_pct: average(gainByGroup.get(name) ?? []),
        records: recordsByGroup.get(name) ?? 0,
        sets_per_week: round((setsByGroup.get(name) ?? 0) / weeksInWindow),
      }),
    );

  const months = new Map<string, number>();
  for (const workout of completed)
    months.set(
      monthKey(workout.date),
      (months.get(monthKey(workout.date)) ?? 0) + 1,
    );
  let best_month: HomeAnalytics["best_month"] = null;
  for (const [month, workouts] of [...months].sort(([a], [b]) =>
    a < b ? -1 : 1,
  ))
    if (!best_month || workouts >= best_month.workouts)
      best_month = Object.freeze({ month, workouts });

  const year = reference?.slice(0, 4) ?? null;
  const byExercise = new Map<string, HomeRecord[]>();
  for (const record of records)
    byExercise.set(record.exercise_id, [
      ...(byExercise.get(record.exercise_id) ?? []),
      record,
    ]);

  const dataset = input.dataset;
  const weights = dataset.bodyWeights
    .filter((w) => w.status === "active")
    .sort((a, b) => compareDate(a.measured_on, b.measured_on));
  const lastWeight = weights.at(-1);

  return Object.freeze({
    reference_date: input.referenceDate,
    next_session: nextSession(input),
    streak: streakOf(input, weeklyGoal, runs),
    workouts_this_year:
      year === null
        ? completed.length
        : completed.filter((w) => w.date.startsWith(year)).length,
    strength_change: Object.freeze({
      percent: average(overall),
      since,
      exercises: overall.length,
    }),
    best_month,
    muscle_groups: Object.freeze(muscle_groups),
    records: Object.freeze(records),
    records_by_exercise: Object.freeze(
      [...byExercise.entries()]
        .map(([exercise_id, history]) =>
          Object.freeze({
            exercise_id,
            latest: history[0],
            count: history.length,
            history: Object.freeze(history),
          }),
        )
        .sort(
          (a, b) =>
            compareDate(b.latest.achieved_on, a.latest.achieved_on) ||
            (a.exercise_id < b.exercise_id ? -1 : 1),
        ),
    ),
    run_records: computeRunRecords(runInputs),
    goals: Object.freeze(
      dataset.goals
        .filter((goal) => goal.status === "active")
        .map((goal) => goalProgress(dataset, goal, runInputs)),
    ),
    exercise_bests: Object.freeze(exerciseBests(input)),
    latest_body_weight: lastWeight
      ? Object.freeze({
          date: lastWeight.measured_on,
          weight_kg: lastWeight.weight_kg,
        })
      : null,
  });
}
