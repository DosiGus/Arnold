/**
 * The three scores of the overview (UX-009): Konstanz, Fortschritt, Erholung.
 *
 * Pure and deterministic: no clock, no I/O. The reference day and, for the
 * watch fallback, the current instant come in from the caller. Every score is
 * a whole number 0–100 (rounded half up) or "noch zu wenig Daten" with a
 * reason, never a guessed number. Each result carries exactly the parts one
 * explanatory sentence needs; the UI only words them.
 *
 * Formulas as confirmed by the owner (sheet row UX-009, column K, answers
 * F1–F7). Calendar days come from `workout_date_local` and `local_date`.
 */
import {
  BASELINE_MIN_VALUES,
  BASELINE_WINDOW_DAYS,
  dailyHealthBaselines,
  type DailyHealthInput,
} from "./health-daily.js";
import type { PreparedInput } from "./eligibility.js";
import { addDays, compareDate, daysBetween, weekStart } from "./period.js";
import { isHardRun } from "./running/interference.js";
import type { ArnoldDataset } from "../shared/arnold-schema-v1.js";

// ---------------------------------------------------------------- constants

export const CONSISTENCY_WEEKS = 8;
export const CONSISTENCY_MIN_WEEKS = 3;
export const PROGRESS_WINDOW_DAYS = 21;
export const PROGRESS_MIN_COMPARISONS = 3;
export const PROGRESS_REPS_CAP = 12;
export const PROGRESS_MIN_RUN_M = 3000;
export const RECOVERY_RECENT_DAYS = 7;
export const RECOVERY_BASE_DAYS = 28;
export const RECOVERY_FALLBACK_HOURS = 72;

// ------------------------------------------------------------------- inputs

/** One working set of a completed strength workout. */
export type ScoreSetInput = Readonly<{
  date: string;
  exercise_id: string;
  /** Exercise, load definition, execution mode and implement count. */
  comparison_key: string;
  load_basis: ArnoldDataset["sets"][number]["load_basis"];
  /** Documented load inside its comparison key; null when unknown. */
  load_kg: number | null;
  /** Repetitions per limb; null when unknown. */
  reps: number | null;
}>;

/** One completed run. Unknown values stay null. */
export type ScoreRunInput = Readonly<{
  workout_id: string;
  date: string;
  run_type: ArnoldDataset["runs"][number]["run_type"];
  distance_m: number | null;
  duration_s: number | null;
  hr_avg_bpm: number | null;
}>;

/** A "before" snapshot of a watch workout (workout_health). */
export type ScoreSnapshotInput = Readonly<{
  at_utc: string;
  resting_hr: number | null;
  body_battery: number | null;
}>;

/**
 * What the server could read of the watch values. `unavailable` means the
 * read failed: only the training part counts then.
 */
export type ScoreHealthInput =
  | Readonly<{ status: "unavailable" }>
  | Readonly<{ status: "no_consent" }>
  | Readonly<{
      status: "consented";
      daily: readonly DailyHealthInput[];
      before: readonly ScoreSnapshotInput[];
      /** The current instant (UTC, ISO); only for the 72-hour window. */
      now_utc: string;
    }>;

export type ScoreInput = Readonly<{
  reference_date: string | null;
  weekly_goal: number | null;
  /** Calendar days of completed workouts of either kind. */
  training_dates: readonly string[];
  /** Working sets of completed strength workouts. */
  sets: readonly ScoreSetInput[];
  runs: readonly ScoreRunInput[];
  health: ScoreHealthInput;
}>;

// ------------------------------------------------------------------ results

export type ConsistencyScore = Readonly<{
  status: "ok" | "insufficient_data";
  value: number | null;
  reason: "no_data" | "no_weekly_goal" | "too_few_weeks" | null;
  weekly_goal: number | null;
  /** Completed weeks counted (at most 8). */
  weeks_counted: number;
  /** Of those, weeks that reached the goal. */
  weeks_goal_met: number;
}>;

export type ProgressRunMetric =
  "easy_pace" | "easy_efficiency" | "fast_pace" | "longest_run";
export type ProgressVerdict = "up" | "same" | "down";

export type ProgressScore = Readonly<{
  status: "ok" | "insufficient_data";
  value: number | null;
  reason: "no_data" | "too_few_comparisons" | null;
  /** Comparison values found (exercises plus run values). */
  compared: number;
  improved: number;
  held: number;
  exercises_compared: number;
  exercises_improved: number;
  runs: readonly Readonly<{
    metric: ProgressRunMetric;
    verdict: ProgressVerdict;
  }>[];
}>;

export type RecoveryPart = "sleep" | "resting_hr" | "hrv" | "body_battery";
export type RecoveryDeduction =
  "load_increase" | "consecutive_days" | RecoveryPart;

export type RecoveryScore = Readonly<{
  status: "ok" | "insufficient_data";
  value: number | null;
  reason:
    | "no_data"
    | "too_short_history"
    | "too_few_training_weeks"
    | "no_base_load"
    | null;
  /** Training part T, rounded; null without enough data. */
  training_part: number | null;
  /** Watch part U, rounded; null when no watch value counts. */
  watch_part: number | null;
  /** Why U is or is not used. */
  watch: "used" | "no_consent" | "no_values" | "unavailable";
  watch_source: "daily" | "before_workout" | null;
  /** Watch values that counted, rounded. */
  parts: readonly Readonly<{ kind: RecoveryPart; value: number }>[];
  strongest_deduction: Readonly<{
    kind: RecoveryDeduction;
    points: number;
  }> | null;
  best: Readonly<{ kind: RecoveryPart | "training"; value: number }> | null;
  /** Load of the last 7 days against the 4-week average, e.g. 1.25. */
  load_ratio: number | null;
  consecutive_days: number;
}>;

export type Scores = Readonly<{
  consistency: ConsistencyScore;
  progress: ProgressScore;
  recovery: RecoveryScore;
}>;

// ------------------------------------------------------------------ helpers

/** Commercial rounding to a whole number; float noise never tips a half. */
export function roundScore(value: number): number {
  return Math.max(0, Math.min(100, Math.floor(value + 0.5 + 1e-9)));
}

const clamp = (value: number, low: number, high: number) =>
  Math.min(high, Math.max(low, value));

const mean = (values: readonly number[]) =>
  values.reduce((sum, v) => sum + v, 0) / values.length;

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

const known = (v: number | null | undefined): v is number =>
  typeof v === "number" && Number.isFinite(v);

const firstDate = (dates: readonly string[]) =>
  dates.length ? [...dates].sort(compareDate)[0] : null;

const inRange = (date: string, from: string, to: string) =>
  compareDate(date, from) >= 0 && compareDate(date, to) <= 0;

// ---------------------------------------------------------------- Konstanz

export function consistencyScore(
  input: Pick<ScoreInput, "reference_date" | "weekly_goal" | "training_dates">,
): ConsistencyScore {
  const empty = {
    weekly_goal: input.weekly_goal,
    weeks_counted: 0,
    weeks_goal_met: 0,
  };
  const first = firstDate(input.training_dates);
  if (input.reference_date === null || first === null)
    return {
      status: "insufficient_data",
      value: null,
      reason: "no_data",
      ...empty,
    };
  const current = weekStart(input.reference_date);
  const earliest = weekStart(first);
  const daysByWeek = new Map<string, Set<string>>();
  for (const date of input.training_dates) {
    const week = weekStart(date);
    const days = daysByWeek.get(week) ?? new Set<string>();
    days.add(date);
    daysByWeek.set(week, days);
  }
  const weeks: number[] = [];
  for (let i = 1; i <= CONSISTENCY_WEEKS; i += 1) {
    const week = addDays(current, -7 * i);
    if (compareDate(week, earliest) < 0) break;
    weeks.push(daysByWeek.get(week)?.size ?? 0);
  }
  const goal = input.weekly_goal;
  const counted = {
    weekly_goal: goal,
    weeks_counted: weeks.length,
    weeks_goal_met: goal ? weeks.filter((d) => d >= goal).length : 0,
  };
  if (!goal)
    return {
      status: "insufficient_data",
      value: null,
      reason: "no_weekly_goal",
      ...counted,
    };
  if (weeks.length < CONSISTENCY_MIN_WEEKS)
    return {
      status: "insufficient_data",
      value: null,
      reason: "too_few_weeks",
      ...counted,
    };
  return {
    status: "ok",
    value: roundScore(mean(weeks.map((d) => Math.min(1, d / goal))) * 100),
    reason: null,
    ...counted,
  };
}

// -------------------------------------------------------------- Fortschritt

/** 1 better by more than the band, 0.5 within it, 0 otherwise. */
function verdictOf(a: number, b: number, band: number): ProgressVerdict {
  const change = (a - b) / b;
  if (change > band + 1e-12) return "up";
  if (change >= -band - 1e-12) return "same";
  return "down";
}
const points = (v: ProgressVerdict) =>
  v === "up" ? 1 : v === "same" ? 0.5 : 0;

/** Best value of one exercise's sets: estimated max or most repetitions. */
function bestOf(sets: readonly ScoreSetInput[]): number | null {
  let best: number | null = null;
  for (const set of sets) {
    if (!known(set.reps) || set.reps < 1) continue;
    const value =
      set.load_basis === "bodyweight_only"
        ? set.reps
        : known(set.load_kg) && set.load_kg > 0
          ? set.load_kg * (1 + Math.min(set.reps, PROGRESS_REPS_CAP) / 30)
          : null;
    if (value !== null && (best === null || value > best)) best = value;
  }
  return best;
}

export function progressScore(
  input: Pick<ScoreInput, "reference_date" | "sets" | "runs" | "health">,
): ProgressScore {
  const none = {
    compared: 0,
    improved: 0,
    held: 0,
    exercises_compared: 0,
    exercises_improved: 0,
    runs: [],
  };
  if (input.reference_date === null)
    return {
      status: "insufficient_data",
      value: null,
      reason: "no_data",
      ...none,
    };
  const aTo = input.reference_date;
  const aFrom = addDays(aTo, -(PROGRESS_WINDOW_DAYS - 1));
  const bTo = addDays(aFrom, -1);
  const bFrom = addDays(bTo, -(PROGRESS_WINDOW_DAYS - 1));
  const inA = (date: string) => inRange(date, aFrom, aTo);
  const inB = (date: string) => inRange(date, bFrom, bTo);

  // (a) Strength: one value per exercise, in its most used comparison key.
  // Assistance loads run the other way round and are left out.
  const byExercise = new Map<string, Map<string, ScoreSetInput[]>>();
  for (const set of input.sets) {
    if (set.load_basis === "assistance") continue;
    if (!inA(set.date) && !inB(set.date)) continue;
    const keys = byExercise.get(set.exercise_id) ?? new Map();
    const list = keys.get(set.comparison_key) ?? [];
    list.push(set);
    keys.set(set.comparison_key, list);
    byExercise.set(set.exercise_id, keys);
  }
  const verdicts: ProgressVerdict[] = [];
  let exercisesCompared = 0;
  let exercisesImproved = 0;
  for (const [, keys] of [...byExercise].sort(([a], [b]) => (a < b ? -1 : 1))) {
    const candidates = [...keys]
      .map(([key, sets]) => ({
        key,
        a: bestOf(sets.filter((s) => inA(s.date))),
        b: bestOf(sets.filter((s) => inB(s.date))),
        n: sets.length,
      }))
      .filter((c) => c.a !== null && c.b !== null && c.b > 0)
      .sort((x, y) => y.n - x.n || (x.key < y.key ? -1 : 1));
    const chosen = candidates[0];
    if (!chosen) continue;
    const verdict = verdictOf(chosen.a!, chosen.b!, 0.01);
    verdicts.push(verdict);
    exercisesCompared += 1;
    if (verdict === "up") exercisesImproved += 1;
  }

  // (b) Running: up to three values.
  const runs = input.runs.filter(
    (r) =>
      known(r.distance_m) &&
      known(r.duration_s) &&
      r.duration_s > 0 &&
      r.distance_m >= PROGRESS_MIN_RUN_M,
  );
  const speed = (r: ScoreRunInput) => r.distance_m! / r.duration_s!;
  const runVerdicts: { metric: ProgressRunMetric; verdict: ProgressVerdict }[] =
    [];
  const easy = runs.filter((r) => !isHardRun(r.run_type));
  const easyA = easy.filter((r) => inA(r.date));
  const easyB = easy.filter((r) => inB(r.date));
  const consented = input.health.status === "consented";
  const withHr = (list: readonly ScoreRunInput[]) =>
    list.filter((r) => known(r.hr_avg_bpm) && r.hr_avg_bpm > 0);
  if (consented && withHr(easyA).length && withHr(easyB).length) {
    const eff = (list: readonly ScoreRunInput[]) =>
      median(withHr(list).map((r) => speed(r) / r.hr_avg_bpm!));
    runVerdicts.push({
      metric: "easy_efficiency",
      verdict: verdictOf(eff(easyA), eff(easyB), 0.01),
    });
  } else if (easyA.length && easyB.length) {
    runVerdicts.push({
      metric: "easy_pace",
      verdict: verdictOf(
        median(easyA.map(speed)),
        median(easyB.map(speed)),
        0.01,
      ),
    });
  }
  const fast = runs.filter((r) => isHardRun(r.run_type));
  const fastA = fast.filter((r) => inA(r.date));
  const fastB = fast.filter((r) => inB(r.date));
  if (fastA.length && fastB.length)
    runVerdicts.push({
      metric: "fast_pace",
      verdict: verdictOf(
        median(fastA.map(speed)),
        median(fastB.map(speed)),
        0.01,
      ),
    });
  const longest = (list: readonly ScoreRunInput[]) =>
    Math.max(...list.map((r) => r.distance_m!));
  const allA = runs.filter((r) => inA(r.date));
  const allB = runs.filter((r) => inB(r.date));
  if (allA.length && allB.length)
    runVerdicts.push({
      metric: "longest_run",
      verdict: verdictOf(longest(allA), longest(allB), 0.05),
    });

  const all = [...verdicts, ...runVerdicts.map((r) => r.verdict)];
  const parts = {
    compared: all.length,
    improved: all.filter((v) => v === "up").length,
    held: all.filter((v) => v === "same").length,
    exercises_compared: exercisesCompared,
    exercises_improved: exercisesImproved,
    runs: runVerdicts,
  };
  if (all.length < PROGRESS_MIN_COMPARISONS)
    return {
      status: "insufficient_data",
      value: null,
      reason: all.length === 0 ? "no_data" : "too_few_comparisons",
      ...parts,
    };
  return {
    status: "ok",
    value: roundScore(mean(all.map(points)) * 100),
    reason: null,
    ...parts,
  };
}

// ----------------------------------------------------------------- Erholung

/** Load points per day: working sets plus run minutes / 5, hard runs double. */
function loadPoints(
  input: Pick<ScoreInput, "sets" | "runs">,
): Map<string, number> {
  const byDay = new Map<string, number>();
  const add = (date: string, value: number) =>
    byDay.set(date, (byDay.get(date) ?? 0) + value);
  for (const set of input.sets) add(set.date, 1);
  for (const run of input.runs)
    // A run without a known duration adds no points: its load is unknown,
    // not zero, so nothing is invented for it.
    if (known(run.duration_s) && run.duration_s > 0)
      add(
        run.date,
        (run.duration_s / 60 / 5) * (isHardRun(run.run_type) ? 2 : 1),
      );
  return byDay;
}

const sumBetween = (byDay: Map<string, number>, from: string, to: string) =>
  [...byDay].reduce(
    (sum, [date, value]) => (inRange(date, from, to) ? sum + value : sum),
    0,
  );

/** Consecutive training days ending today, or yesterday when today is free. */
function consecutiveDays(dates: ReadonlySet<string>, reference: string) {
  let day = dates.has(reference) ? reference : addDays(reference, -1);
  let count = 0;
  while (dates.has(day)) {
    count += 1;
    day = addDays(day, -1);
  }
  return count;
}

type WatchResult = {
  status: RecoveryScore["watch"];
  source: RecoveryScore["watch_source"];
  parts: { kind: RecoveryPart; value: number }[];
};

function restingHrPart(current: number, baseline: number) {
  return clamp(100 - 10 * Math.max(0, current - baseline), 0, 100);
}

function watchPart(health: ScoreHealthInput, reference: string): WatchResult {
  if (health.status === "unavailable")
    return { status: "unavailable", source: null, parts: [] };
  if (health.status === "no_consent")
    return { status: "no_consent", source: null, parts: [] };
  const yesterday = addDays(reference, -1);
  const fresh = (date: string) => inRange(date, yesterday, reference);
  const parts: { kind: RecoveryPart; value: number }[] = [];
  const daily = health.daily.filter(
    (d) => compareDate(d.local_date, reference) <= 0,
  );
  const base = dailyHealthBaselines(daily, reference);

  // Sleep: Garmin's own score; without it, duration against its own median.
  const sleepScoreDay = [...daily]
    .filter((d) => fresh(d.local_date))
    .sort((a, b) => compareDate(b.local_date, a.local_date))
    .find((d) => known(d.sleep_score));
  if (sleepScoreDay)
    parts.push({
      kind: "sleep",
      value: clamp(sleepScoreDay.sleep_score!, 0, 100),
    });
  else if (
    base.sleep_seconds &&
    fresh(base.sleep_seconds.local_date) &&
    base.sleep_seconds.baseline &&
    base.sleep_seconds.baseline.value > 0
  )
    parts.push({
      kind: "sleep",
      value:
        100 *
        Math.min(
          1,
          base.sleep_seconds.value / base.sleep_seconds.baseline.value,
        ),
    });

  if (
    base.resting_hr &&
    fresh(base.resting_hr.local_date) &&
    base.resting_hr.baseline
  )
    parts.push({
      kind: "resting_hr",
      value: restingHrPart(
        base.resting_hr.value,
        base.resting_hr.baseline.value,
      ),
    });

  if (
    base.hrv &&
    fresh(base.hrv.local_date) &&
    base.hrv.baseline &&
    base.hrv.baseline.value > 0
  ) {
    const below =
      ((base.hrv.baseline.value - base.hrv.value) / base.hrv.baseline.value) *
      100;
    parts.push({
      kind: "hrv",
      value: clamp(100 - 4 * Math.max(0, below), 0, 100),
    });
  }

  const batteryDay = [...daily]
    .filter((d) => fresh(d.local_date))
    .sort((a, b) => compareDate(b.local_date, a.local_date))
    .find((d) => known(d.body_battery_high));
  if (batteryDay)
    parts.push({
      kind: "body_battery",
      value: clamp(batteryDay.body_battery_high!, 0, 100),
    });

  if (parts.length) return { status: "used", source: "daily", parts };

  // No daily values: fresh "before" values of a watch workout (≤ 72 h).
  const now = Date.parse(health.now_utc);
  if (!Number.isFinite(now))
    return { status: "no_values", source: null, parts: [] };
  const snapshots = health.before
    .map((s) => ({ ...s, at: Date.parse(s.at_utc) }))
    .filter((s) => Number.isFinite(s.at) && s.at <= now)
    .sort((a, b) => b.at - a.at || (a.at_utc < b.at_utc ? -1 : 1));
  const latest = snapshots.find(
    (s) =>
      now - s.at <= RECOVERY_FALLBACK_HOURS * 3_600_000 &&
      (known(s.resting_hr) || known(s.body_battery)),
  );
  if (!latest) return { status: "no_values", source: null, parts: [] };
  if (known(latest.resting_hr)) {
    const from = latest.at - BASELINE_WINDOW_DAYS * 86_400_000;
    const before = snapshots
      .filter((s) => s.at < latest.at && s.at >= from)
      .map((s) => s.resting_hr)
      .filter(known);
    if (before.length >= BASELINE_MIN_VALUES)
      parts.push({
        kind: "resting_hr",
        value: restingHrPart(latest.resting_hr, median(before)),
      });
  }
  if (known(latest.body_battery))
    parts.push({
      kind: "body_battery",
      value: clamp(latest.body_battery, 0, 100),
    });
  return parts.length
    ? { status: "used", source: "before_workout", parts }
    : { status: "no_values", source: null, parts: [] };
}

export function recoveryScore(
  input: Pick<
    ScoreInput,
    "reference_date" | "training_dates" | "sets" | "runs" | "health"
  >,
): RecoveryScore {
  const reference = input.reference_date;
  const first = firstDate(input.training_dates);
  const blank = {
    training_part: null,
    watch_part: null,
    watch_source: null,
    parts: [],
    strongest_deduction: null,
    best: null,
    load_ratio: null,
    consecutive_days: 0,
  } as const;
  const watchStatus: RecoveryScore["watch"] =
    input.health.status === "consented" ? "no_values" : input.health.status;
  if (reference === null || first === null)
    return {
      status: "insufficient_data",
      value: null,
      reason: "no_data",
      watch: watchStatus,
      ...blank,
    };
  if (daysBetween(first, reference) < RECOVERY_BASE_DAYS)
    return {
      status: "insufficient_data",
      value: null,
      reason: "too_short_history",
      watch: watchStatus,
      ...blank,
    };
  const recentFrom = addDays(reference, -(RECOVERY_RECENT_DAYS - 1));
  const baseTo = addDays(recentFrom, -1);
  const baseFrom = addDays(baseTo, -(RECOVERY_BASE_DAYS - 1));
  const trainedWeeks = [0, 1, 2, 3].filter((i) => {
    const from = addDays(baseFrom, 7 * i);
    const to = addDays(from, 6);
    return input.training_dates.some((d) => inRange(d, from, to));
  }).length;
  if (trainedWeeks < 2)
    return {
      status: "insufficient_data",
      value: null,
      reason: "too_few_training_weeks",
      watch: watchStatus,
      ...blank,
    };
  const byDay = loadPoints(input);
  const recent = sumBetween(byDay, recentFrom, reference);
  const baseline = sumBetween(byDay, baseFrom, baseTo) / 4;
  if (baseline <= 0)
    return {
      status: "insufficient_data",
      value: null,
      reason: "no_base_load",
      watch: watchStatus,
      ...blank,
    };
  const ratio = recent / baseline;
  const loadDeduction = 70 * clamp(ratio - 1, 0, 1);
  const streak = consecutiveDays(new Set(input.training_dates), reference);
  const streakDeduction = Math.min(30, 10 * Math.max(0, streak - 2));
  const training = Math.max(0, 100 - loadDeduction - streakDeduction);

  const watch = watchPart(input.health, reference);
  const watchValue = watch.parts.length
    ? mean(watch.parts.map((p) => p.value))
    : null;
  const value =
    watchValue === null ? training : 0.5 * training + 0.5 * watchValue;

  const deductions: { kind: RecoveryDeduction; points: number }[] = [
    { kind: "load_increase", points: loadDeduction },
    { kind: "consecutive_days", points: streakDeduction },
    ...watch.parts.map((p) => ({ kind: p.kind, points: 100 - p.value })),
  ];
  const strongest = deductions
    .filter((d) => roundScore(d.points) > 0)
    .sort((a, b) => b.points - a.points)[0];
  const best = watch.parts.length
    ? [...watch.parts].sort((a, b) => b.value - a.value)[0]
    : { kind: "training" as const, value: training };

  return {
    status: "ok",
    value: roundScore(value),
    reason: null,
    training_part: roundScore(training),
    watch_part: watchValue === null ? null : roundScore(watchValue),
    watch: watch.status,
    watch_source: watch.source,
    parts: watch.parts.map((p) => ({
      kind: p.kind,
      value: roundScore(p.value),
    })),
    strongest_deduction: strongest
      ? { kind: strongest.kind, points: roundScore(strongest.points) }
      : null,
    best: { kind: best.kind, value: roundScore(best.value) },
    load_ratio: Math.round(ratio * 100) / 100,
    consecutive_days: streak,
  };
}

// --------------------------------------------------------------- assembly

export function computeScores(input: ScoreInput): Scores {
  return {
    consistency: consistencyScore(input),
    progress: progressScore(input),
    recovery: recoveryScore(input),
  };
}

/**
 * The score inputs from the prepared strength history and the completed runs.
 * Only completed workouts count; only working sets are load.
 */
export function scoreInputOf(
  prepared: PreparedInput,
  options: Readonly<{
    reference_date: string | null;
    weekly_goal: number | null;
    runs: readonly ScoreRunInput[];
    run_dates: readonly string[];
    health: ScoreHealthInput;
  }>,
): ScoreInput {
  const sets: ScoreSetInput[] = [];
  for (const workout of prepared.completedWorkouts)
    for (const analysis of workout.analyses) {
      if (analysis.bucket !== "working") continue;
      const c = analysis.comparability;
      sets.push({
        date: analysis.date,
        exercise_id: c.exercise_id,
        comparison_key: [
          c.exercise_id,
          c.load_basis,
          c.execution_mode,
          c.implement_count,
        ].join("|"),
        load_basis: c.load_basis,
        load_kg: analysis.comparable_load_kg,
        reps: analysis.one_rm_reps ?? analysis.total_reps,
      });
    }
  const dates = new Set<string>([
    ...prepared.completedWorkouts.map((w) => w.date),
    ...options.run_dates,
  ]);
  return {
    reference_date: options.reference_date,
    weekly_goal: options.weekly_goal,
    training_dates: [...dates].sort(compareDate),
    sets,
    runs: options.runs,
    health: options.health,
  };
}

/** Completed runs of a dataset as score inputs (before the strength view). */
export function scoreRunsOf(dataset: ArnoldDataset): ScoreRunInput[] {
  const dates = new Map(
    dataset.workouts
      .filter((w) => w.activity_type === "run" && w.status === "completed")
      .map((w) => [w.workout_id, w.workout_date_local]),
  );
  return (dataset.runs ?? [])
    .filter((r) => dates.has(r.workout_id))
    .map((r) => ({
      workout_id: r.workout_id,
      date: dates.get(r.workout_id)!,
      run_type: r.run_type,
      distance_m: r.distance_m,
      duration_s: r.timer_s ?? r.elapsed_s,
      hr_avg_bpm: r.hr_avg_bpm,
    }))
    .sort(
      (a, b) =>
        compareDate(a.date, b.date) || (a.workout_id < b.workout_id ? -1 : 1),
    );
}
