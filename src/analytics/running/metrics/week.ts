import { HARD_RUN_TYPES, type RunType } from "../../../shared/run-contract.js";
import {
  addDays,
  compareDate,
  isCalendarDate,
  weekStart as mondayOf,
} from "../../period.js";
import {
  edwardsLoad,
  paceSecondsPerKm,
  srpeLoad,
  zoneTime,
  type LoadBasis,
} from "./run.js";
import {
  known,
  unknown,
  type RunInput,
  type RunMetric,
  type RunMetricReason,
  type RunSum,
} from "./types.js";

/** A run counts as a zone 2 run if at least this share of its zone time is zone 2. */
export const ZONE2_RUN_MIN_SHARE = 0.6;

const EASY_TYPES: readonly RunType[] = [
  "recovery",
  "base",
  "long",
  "run_walk",
  "strides",
];
const MODERATE_TYPES: readonly RunType[] = ["progression", "fartlek"];

/** Intensity band of a run type when no heart rate is known; `free` has none. */
export function bandOfRunType(
  type: RunType,
): "low" | "moderate" | "high" | null {
  if (EASY_TYPES.includes(type)) return "low";
  if (MODERATE_TYPES.includes(type)) return "moderate";
  if (HARD_RUN_TYPES.includes(type)) return "high";
  return null;
}

/** Fail closed: a date that is not a real calendar day is an error, never a guess. */
function day(date: string): string {
  if (!isCalendarDate(date))
    throw new RangeError(`Kein Kalenderdatum: ${date}`);
  return date;
}
const weekStart = (date: string) => mondayOf(day(date));

const completedRuns = (runs: readonly RunInput[]) =>
  runs.filter((run) => run.status === "completed");

function sumOf(
  runs: readonly RunInput[],
  pick: (run: RunInput) => number | null,
  missing: RunMetricReason,
): RunSum {
  let value = 0;
  let count = 0;
  for (const run of runs) {
    const part = pick(run);
    if (part === null) continue;
    value += part;
    count += 1;
  }
  if (runs.length === 0) return { value: 0, known: 0, total: 0, reason: null };
  if (count === 0)
    return { value: null, known: 0, total: runs.length, reason: missing };
  return {
    value,
    known: count,
    total: runs.length,
    reason: count < runs.length ? missing : null,
  };
}

/* ------------------------------------------------------- intensity share */

export interface IntensityDistribution {
  /** Zones 1–2, zone 3, zones 4–5 (from heart rate) or by run type. */
  readonly low_s: number;
  readonly moderate_s: number;
  readonly high_s: number;
  /** Time of runs without heart rate and without a type band (free runs). */
  readonly unclassified_s: number;
  /** Which seconds come from heart-rate zones and which from the run type. */
  readonly from_hr_s: number;
  readonly from_run_type_s: number;
  /** `hr`, `run_type` or `mixed`; null if nothing could be classified. */
  readonly basis: "hr" | "run_type" | "mixed" | null;
  readonly share: RunMetric<{
    readonly low: number;
    readonly moderate: number;
    readonly high: number;
  }>;
}

export function intensityDistribution(
  runs: readonly RunInput[],
): IntensityDistribution {
  let low = 0;
  let moderate = 0;
  let high = 0;
  let unclassified = 0;
  let fromHr = 0;
  let fromType = 0;
  const done = completedRuns(runs);
  for (const run of done) {
    const zones = zoneTime(run);
    if (zones.value !== null) {
      const [z1, z2, z3, z4, z5] = zones.value.seconds;
      low += z1 + z2;
      moderate += z3;
      high += z4 + z5;
      fromHr += zones.value.total_s;
      continue;
    }
    if (run.timer_s === null || run.timer_s <= 0) continue;
    const band = bandOfRunType(run.run_type);
    if (band === null) unclassified += run.timer_s;
    else {
      if (band === "low") low += run.timer_s;
      else if (band === "moderate") moderate += run.timer_s;
      else high += run.timer_s;
      fromType += run.timer_s;
    }
  }
  const total = low + moderate + high;
  const basis =
    fromHr > 0 && fromType > 0
      ? "mixed"
      : fromHr > 0
        ? "hr"
        : fromType > 0
          ? "run_type"
          : null;
  let share: IntensityDistribution["share"];
  if (done.length === 0) share = unknown("no_runs");
  else if (total <= 0)
    share = unknown(unclassified > 0 ? "unclassified_run_type" : "no_run_time");
  else
    share = known({
      low: low / total,
      moderate: moderate / total,
      high: high / total,
    });
  return {
    low_s: low,
    moderate_s: moderate,
    high_s: high,
    unclassified_s: unclassified,
    from_hr_s: fromHr,
    from_run_type_s: fromType,
    basis,
    share,
  };
}

/* ---------------------------------------------------------- fulfilment */

/** A run that was planned for a day: still planned, done, or taken off the plan. */
export interface PlannedRunInput {
  readonly workout_id: string;
  readonly workout_date_local: string;
  readonly status:
    "planned" | "in_progress" | "completed" | "cancelled" | "voided";
}

export interface WeekFulfilment {
  readonly planned: number;
  readonly completed: number;
  /** Planned for a day before the reference date and not done (D-RUN-15: not made up). */
  readonly missed: number;
  /** Planned for the reference date or later. */
  readonly open: number;
  /** completed / (completed + missed); open runs are not due yet. */
  readonly rate: RunMetric<number>;
}

export function weekFulfilment(
  planned: readonly PlannedRunInput[],
  week: string,
  reference_date: string,
): WeekFulfilment {
  const start = weekStart(week);
  day(reference_date);
  const mine = planned.filter(
    (run) =>
      weekStart(run.workout_date_local) === start &&
      run.status !== "cancelled" &&
      run.status !== "voided",
  );
  const completed = mine.filter((run) => run.status === "completed").length;
  const pending = mine.filter((run) => run.status !== "completed");
  const missed = pending.filter(
    (run) => compareDate(run.workout_date_local, day(reference_date)) < 0,
  ).length;
  const due = completed + missed;
  return {
    planned: mine.length,
    completed,
    missed,
    open: pending.length - missed,
    rate: due === 0 ? unknown("nothing_due") : known(completed / due),
  };
}

/* ----------------------------------------------------------------- week */

export interface WeekMetrics {
  readonly week_start: string;
  readonly week_end: string;
  readonly run_count: number;
  readonly distance_m: RunSum;
  readonly timer_s: RunSum;
  /** Distance-weighted average pace of the runs with timer and distance. */
  readonly pace_s_per_km: RunMetric<number>;
  /** Timer time of runs of type `long` ÷ timer time of all runs; 0 if there was none. */
  readonly long_run_share: RunMetric<number>;
  readonly intensity: IntensityDistribution;
  readonly fulfilment: WeekFulfilment;
  readonly load_srpe: RunSum;
  readonly load_edwards: RunSum;
  /** Pace of the zone 2 runs (recorded heart rate, outdoors). */
  readonly zone2_pace_s_per_km: RunMetric<number>;
}

function weightedPace(runs: readonly RunInput[]): number | null {
  let time = 0;
  let distance = 0;
  for (const run of runs) {
    if (paceSecondsPerKm(run.timer_s, run.distance_m).value === null) continue;
    time += run.timer_s!;
    distance += run.distance_m!;
  }
  return distance > 0 ? time / (distance / 1000) : null;
}

/** The metrics of one calendar week (Monday to Sunday) from `workout_date_local`. */
export function weekMetrics(
  runs: readonly RunInput[],
  planned: readonly PlannedRunInput[],
  weekDate: string,
  reference_date: string,
): WeekMetrics {
  const start = weekStart(weekDate);
  const inWeek = completedRuns(runs).filter(
    (run) => weekStart(run.workout_date_local) === start,
  );
  const timer = sumOf(inWeek, (run) => run.timer_s, "timer_missing");
  const longTime = inWeek
    .filter((run) => run.run_type === "long")
    .reduce((sum, run) => sum + (run.timer_s ?? 0), 0);

  let pace: RunMetric<number>;
  const weighted = weightedPace(inWeek);
  if (inWeek.length === 0) pace = unknown("no_runs");
  else pace = weighted === null ? unknown("no_pace_data") : known(weighted);

  const zone2 = inWeek.filter(
    (run) =>
      run.environment !== "treadmill" &&
      (zoneTime(run).value?.share[1] ?? 0) >= ZONE2_RUN_MIN_SHARE,
  );
  const zone2Pace = weightedPace(zone2);

  return {
    week_start: start,
    week_end: addDays(start, 6),
    run_count: inWeek.length,
    distance_m: sumOf(inWeek, (run) => run.distance_m, "distance_missing"),
    timer_s: timer,
    pace_s_per_km: pace,
    long_run_share:
      inWeek.length === 0
        ? unknown("no_runs")
        : !timer.value
          ? unknown("no_run_time")
          : known(longTime / timer.value),
    intensity: intensityDistribution(inWeek),
    fulfilment: weekFulfilment(planned, start, reference_date),
    load_srpe: sumOf(inWeek, (run) => srpeLoad(run).value, "rpe_missing"),
    load_edwards: sumOf(
      inWeek,
      (run) => edwardsLoad(run).value,
      "hr_not_recorded",
    ),
    zone2_pace_s_per_km:
      zone2Pace === null ? unknown("no_zone2_runs") : known(zone2Pace),
  };
}

/**
 * The last `weeks` calendar weeks up to and including the week of `end_date`,
 * oldest first, empty weeks included (8 to 12 weeks, spec "Trends").
 */
export function runTrend(
  runs: readonly RunInput[],
  planned: readonly PlannedRunInput[],
  end_date: string,
  weeks = 12,
  reference_date = end_date,
): readonly WeekMetrics[] {
  const last = weekStart(end_date);
  return Array.from({ length: Math.max(0, Math.floor(weeks)) }, (_, i) =>
    weekMetrics(
      runs,
      planned,
      addDays(last, -7 * (Math.floor(weeks) - 1 - i)),
      reference_date,
    ),
  );
}

/* ---------------------------------------------------------- 7:28 ratio */

export interface LoadRatio {
  /** Load of the last 7 days ÷ weekly average of the last 28 days. */
  readonly ratio: number;
  readonly acute: number;
  readonly chronic_weekly: number;
  readonly basis: LoadBasis;
  /** Runs of the 28 days with a known load, and all runs of the 28 days. */
  readonly known_runs: number;
  readonly total_runs: number;
}

/**
 * Acute:chronic load ratio (7 to 28 days, an orientation, not a diagnosis).
 * The windows end on `reference_date`. Unknown without 28 days of history
 * (the earliest run, or `history_start`), and for runs without a load on the
 * chosen basis the known loads count and `known_runs` says how many.
 */
export function loadRatio(
  runs: readonly RunInput[],
  reference_date: string,
  basis: LoadBasis = "srpe",
  history_start?: string,
): RunMetric<LoadRatio> {
  day(reference_date);
  if (history_start !== undefined) day(history_start);
  const done = completedRuns(runs);
  for (const run of done) day(run.workout_date_local);
  if (done.length === 0) return unknown("no_runs");
  const earliest =
    history_start ??
    done.reduce(
      (min, run) =>
        compareDate(run.workout_date_local, min) < 0
          ? run.workout_date_local
          : min,
      done[0].workout_date_local,
    );
  const chronicStart = addDays(reference_date, -27);
  if (compareDate(earliest, chronicStart) > 0)
    return unknown("history_too_short");
  const acuteStart = addDays(reference_date, -6);
  const window = done.filter(
    (run) =>
      compareDate(run.workout_date_local, chronicStart) >= 0 &&
      compareDate(run.workout_date_local, reference_date) <= 0,
  );
  const load = (run: RunInput) =>
    (basis === "srpe" ? srpeLoad(run) : edwardsLoad(run)).value;
  let acute = 0;
  let chronic = 0;
  let count = 0;
  for (const run of window) {
    const value = load(run);
    if (value === null) continue;
    count += 1;
    chronic += value;
    if (compareDate(run.workout_date_local, acuteStart) >= 0) acute += value;
  }
  if (window.length > 0 && count === 0) return unknown("no_load_known");
  if (chronic <= 0) return unknown("chronic_load_zero");
  const chronic_weekly = chronic / 4;
  return known({
    ratio: acute / chronic_weekly,
    acute,
    chronic_weekly,
    basis,
    known_runs: count,
    total_runs: window.length,
  });
}
