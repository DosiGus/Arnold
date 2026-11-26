import {
  isRunGoalKind,
  isStrengthWorkout,
} from "../shared/arnold-schema-v1.js";
import type {
  ArnoldGoal,
  ArnoldGoalKind,
  ArnoldLoadBasis,
} from "../shared/arnold-schema-v1.js";
import { addDays, compareDate, daysBetween } from "./period.js";
import {
  completedRunsOf,
  hasMeasuredDistance,
  measuredTimeFor,
  type DatasetWithRunInputs,
} from "./run-records.js";
import type { RunInput } from "./running/metrics/index.js";
import { round } from "./validation.js";

/** What a goal measures; the same shape for a stored goal and one being set. */
export type GoalTarget = Readonly<{
  kind: ArnoldGoalKind;
  exercise_id: string | null;
  load_basis: ArnoldLoadBasis | null;
  /** Metres of a run_time_for_distance goal. */
  run_distance_m?: number | null;
}>;

/** The unit a goal is counted in. */
export type GoalUnit = "kg" | "reps" | "km" | "min" | "s";

export const goalUnit = (kind: ArnoldGoalKind): GoalUnit =>
  kind === "exercise_reps"
    ? "reps"
    : kind === "run_distance"
      ? "km"
      : kind === "run_duration"
        ? "min"
        : kind === "run_time_for_distance"
          ? "s"
          : "kg";

/** A time goal: less is better, the best value is the lowest. */
export const lowerIsBetter = (kind: ArnoldGoalKind) =>
  kind === "run_time_for_distance";

/** One measurement on the way to a goal: a day and the best value that day. */
export type GoalPoint = Readonly<{ date: string; value: number }>;

export type GoalProgress = Readonly<{
  goal_id: string;
  kind: ArnoldGoalKind;
  exercise_id: string | null;
  load_basis: ArnoldLoadBasis | null;
  run_distance_m: number | null;
  unit: GoalUnit;
  target_value: number;
  /** Where the goal started; the stored value, or the first measurement. */
  start_value: number | null;
  current_value: number | null;
  current_date: string | null;
  /** 0 to 1, null while nothing is known. */
  progress: number | null;
  achieved: boolean;
  /** Change per week over the last eight weeks of measurements, null when unknown. */
  rate_per_week: number | null;
  /** Weeks to the target at that rate; null when not heading towards it. */
  eta_weeks: number | null;
  /** All measurements, oldest first, for the chart. */
  points: readonly GoalPoint[];
}>;

/** How many weeks of measurements the rate looks at. */
export const GOAL_RATE_WINDOW_DAYS = 56;

/** One value per run for a running goal, or null when the run proves nothing. */
function runGoalValue(run: RunInput, target: GoalTarget): number | null {
  switch (target.kind) {
    case "run_distance":
      return hasMeasuredDistance(run) ? round(run.distance_m! / 1000) : null;
    case "run_duration":
      return run.timer_s !== null && run.timer_s > 0
        ? round(run.timer_s / 60)
        : null;
    case "run_time_for_distance":
      return target.run_distance_m
        ? measuredTimeFor(run, target.run_distance_m)
        : null;
    default:
      return null;
  }
}

/**
 * The measurements a goal is judged by, one per calendar day.
 *
 * - body weight: the valid entry of each day;
 * - exercise load: the heaviest working set of a completed workout, counted
 *   only in the load convention of the goal (24 kg per dumbbell stays per
 *   dumbbell);
 * - exercise reps: the most repetitions in one working set of a completed
 *   workout;
 * - run distance: the longest measured distance of a completed run in km
 *   (treadmill estimates never count);
 * - run duration: the longest timer time of a completed run in minutes;
 * - run time for a distance: the fastest measured time over that distance
 *   inside one completed run, in seconds (`measuredTimeFor` in
 *   run-records.ts: 100 m checkpoints, kilometre laps or the whole run).
 *   Never extrapolated from a shorter run or estimated.
 *
 * Warm-up sets, voided sets and unfinished workouts never count. Running
 * goals read the dataset's own runs and the ones a strength-only view carries
 * (`runRecordInputs`), or `runs` when the caller has them at hand.
 */
export function goalPoints(
  dataset: DatasetWithRunInputs,
  target: GoalTarget,
  runs?: readonly RunInput[],
): GoalPoint[] {
  const best = new Map<string, number>();
  const lower = lowerIsBetter(target.kind);
  const keep = (date: string, value: number) => {
    const current = best.get(date);
    if (current === undefined || (lower ? value < current : value > current))
      best.set(date, value);
  };
  if (isRunGoalKind(target.kind)) {
    for (const run of runs ?? completedRunsOf(dataset)) {
      if (run.status !== "completed") continue;
      const value = runGoalValue(run, target);
      if (value !== null && value > 0) keep(run.workout_date_local, value);
    }
  } else if (target.kind === "body_weight") {
    // One valid entry per day is guaranteed by the schema.
    for (const row of dataset.bodyWeights)
      if (row.status === "active") best.set(row.measured_on, row.weight_kg);
  } else {
    const completed = new Map(
      dataset.workouts
        .filter((w) => w.status === "completed" && isStrengthWorkout(w))
        .map((w) => [w.workout_id, w.workout_date_local]),
    );
    for (const set of dataset.sets) {
      const date = completed.get(set.workout_id);
      if (
        date === undefined ||
        set.status !== "active" ||
        set.exercise_id !== target.exercise_id ||
        set.set_type === "warmup"
      )
        continue;
      if (target.kind === "exercise_reps") keep(date, set.reps);
      else if (set.load_basis === target.load_basis && set.load_kg !== null)
        keep(date, set.load_kg);
    }
  }
  return [...best.entries()]
    .sort(([a], [b]) => compareDate(a, b))
    .map(([date, value]) => Object.freeze({ date, value }));
}

/**
 * The value a goal stands at now: the latest body weight, or the best value
 * ever for an exercise or running goal (the lowest time for a time goal). A
 * personal best does not go back after an off day.
 */
export function currentGoalValue(
  points: readonly GoalPoint[],
  kind: ArnoldGoalKind,
): GoalPoint | null {
  if (!points.length) return null;
  if (kind === "body_weight") return points[points.length - 1];
  const lower = lowerIsBetter(kind);
  return points.reduce((top, point) =>
    (lower ? point.value < top.value : point.value > top.value) ? point : top,
  );
}

/** Otherwise the best value up to each day, so the line never goes back. */
function chartPoints(
  points: readonly GoalPoint[],
  kind: ArnoldGoalKind,
): GoalPoint[] {
  if (kind === "body_weight") return [...points];
  const lower = lowerIsBetter(kind);
  let top = lower ? Infinity : -Infinity;
  return points.map((point) => {
    top = lower ? Math.min(top, point.value) : Math.max(top, point.value);
    return Object.freeze({ date: point.date, value: top });
  });
}

/**
 * How far a goal has come. Works in both directions: losing weight, lifting
 * more and running a distance faster are all progress towards their own
 * target. A time goal reached the first time it is measured counts as
 * achieved, never as 0 % progress.
 */
export function goalProgress(
  dataset: DatasetWithRunInputs,
  goal: ArnoldGoal,
  runs?: readonly RunInput[],
): GoalProgress {
  const raw = goalPoints(dataset, goal, runs);
  const points = chartPoints(raw, goal.kind);
  const current = currentGoalValue(raw, goal.kind);
  const start = goal.start_value ?? points[0]?.value ?? null;
  const target = goal.target_value;
  let progress: number | null = null;
  let achieved = false;
  if (current !== null && start !== null) {
    const span = target - start;
    const done = current.value - start;
    if (span === 0) progress = 1;
    else progress = Math.min(1, Math.max(0, done / span));
    // A running goal has one direction: further, longer, or faster (a lower
    // time). Body weight and exercise goals follow the start value.
    const downwards = isRunGoalKind(goal.kind)
      ? lowerIsBetter(goal.kind)
      : target < start;
    achieved = downwards ? current.value <= target : current.value >= target;
    if (achieved) progress = 1;
  }

  let rate: number | null = null;
  let eta: number | null = null;
  const last = points.at(-1);
  if (last) {
    const from = addDays(last.date, -GOAL_RATE_WINDOW_DAYS);
    const first = points.find((p) => compareDate(p.date, from) >= 0);
    const days = first ? daysBetween(first.date, last.date) : 0;
    if (first && days >= 7) {
      rate = round(((last.value - first.value) / days) * 7);
      if (rate === 0) rate = null;
    }
    if (rate !== null && current !== null && !achieved) {
      const remaining = target - current.value;
      if (Math.sign(remaining) === Math.sign(rate))
        eta = Math.max(1, Math.ceil(remaining / rate));
    }
  }

  return Object.freeze({
    goal_id: goal.goal_id,
    kind: goal.kind,
    exercise_id: goal.exercise_id,
    load_basis: goal.load_basis,
    run_distance_m: goal.run_distance_m ?? null,
    unit: goalUnit(goal.kind),
    target_value: target,
    start_value: start,
    current_value: current?.value ?? null,
    current_date: current?.date ?? null,
    progress: progress === null ? null : round(progress),
    achieved,
    rate_per_week: rate,
    eta_weeks: eta,
    points: Object.freeze(points),
  });
}
