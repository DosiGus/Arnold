import {
  cumulativeAt,
  metersAtTime,
  SPLIT_METERS,
  usableSplits,
} from "./splits.js";
import { runBestEfforts, type RunBestEfforts } from "./bests.js";
import {
  hrMissingReason,
  known,
  unknown,
  type RunInput,
  type RunMetric,
  type RunSegmentInput,
} from "./types.js";

/** Decoupling needs at least this much timer time (spec "Anpassung nach Läufen"). */
export const DECOUPLING_MIN_TIMER_S = 45 * 60;
/** A decoupling above this many percent is notable. */
export const DECOUPLING_NOTABLE_PERCENT = 5;
/** Heart-rate samples needed in each half of a run for a decoupling. */
export const DECOUPLING_MIN_SAMPLES_PER_HALF = 20;
/** Edwards weight of zone 1 … 5. */
export const EDWARDS_WEIGHTS = [1, 2, 3, 4, 5] as const;

/* ------------------------------------------------------------------- pace */

/** Average pace in seconds per km from timer time (not elapsed time). */
export function paceSecondsPerKm(
  timer_s: number | null,
  distance_m: number | null,
): RunMetric<number> {
  if (timer_s === null) return unknown("timer_missing");
  if (timer_s <= 0) return unknown("timer_zero");
  if (distance_m === null) return unknown("distance_missing");
  if (distance_m <= 0) return unknown("distance_zero");
  return known(timer_s / (distance_m / 1000));
}

/** Seconds per full kilometre, from the 100 m checkpoints; a partial km is left out. */
export function kilometreTimes(
  run: Pick<RunInput, "status" | "splits_100m">,
): RunMetric<readonly number[]> {
  const splits = usableSplits(run);
  if (splits.value === null) return unknown(splits.reason);
  const perKm = 1000 / SPLIT_METERS;
  const full = Math.floor(splits.value.length / perKm);
  if (full === 0) return unknown("distance_not_covered");
  return known(
    Array.from(
      { length: full },
      (_, km) =>
        cumulativeAt(splits.value, (km + 1) * perKm) -
        cumulativeAt(splits.value, km * perKm),
    ),
  );
}

/* --------------------------------------------------------------- segments */

export interface SegmentResult {
  readonly segment_index: number;
  readonly repetition: number | null;
  readonly kind: RunSegmentInput["kind"];
  readonly status: RunSegmentInput["status"];
  readonly timer_s: number;
  readonly distance_m: number;
  readonly pace_s_per_km: RunMetric<number>;
  /** Share of the segment's time inside its target band, 0 to 1. */
  readonly share_in_target: RunMetric<number>;
  /** Done / prescribed (time or distance), not capped; 0 if skipped. */
  readonly completion: RunMetric<number>;
}

export function segmentResult(segment: RunSegmentInput): SegmentResult {
  const skipped = segment.status === "skipped";
  let share: RunMetric<number>;
  if (skipped) share = unknown("segment_skipped");
  else if (segment.target_type === null || segment.target_type === "none")
    share = unknown("no_target");
  else if (segment.time_in_target_s === null)
    share = unknown("time_in_target_missing");
  else if (segment.timer_s <= 0) share = unknown("timer_zero");
  else share = known(Math.min(1, segment.time_in_target_s / segment.timer_s));

  let completion: RunMetric<number>;
  if (
    segment.planned_duration_type === null ||
    segment.planned_duration_type === "open" ||
    !segment.planned_duration_value
  )
    completion = unknown("no_planned_duration");
  else if (skipped) completion = known(0);
  else
    completion = known(
      (segment.planned_duration_type === "seconds"
        ? segment.timer_s
        : segment.distance_m) / segment.planned_duration_value,
    );

  return {
    segment_index: segment.segment_index,
    repetition: segment.repetition,
    kind: segment.kind,
    status: segment.status,
    timer_s: segment.timer_s,
    distance_m: segment.distance_m,
    pace_s_per_km: skipped
      ? unknown("segment_skipped")
      : paceSecondsPerKm(segment.timer_s, segment.distance_m),
    share_in_target: share,
    completion,
  };
}

const byIndex = (a: RunSegmentInput, b: RunSegmentInput) =>
  a.segment_index - b.segment_index;

/** Share of the work time that was inside the target band, over all work segments with a target. */
export function workShareInTarget(
  segments: readonly RunSegmentInput[],
): RunMetric<number> {
  if (segments.length === 0) return unknown("no_segments");
  let inBand = 0;
  let time = 0;
  for (const segment of segments) {
    if (segment.kind !== "work") continue;
    const result = segmentResult(segment);
    if (result.share_in_target.value === null) continue;
    inBand += segment.time_in_target_s ?? 0;
    time += segment.timer_s;
  }
  return time > 0 ? known(Math.min(1, inBand / time)) : unknown("no_target");
}

/**
 * Fulfilment of a run: the mean share, capped at 1, of the prescribed work
 * time or distance that was run (skipped work counts 0).
 */
export function runFulfilment(
  segments: readonly RunSegmentInput[],
): RunMetric<number> {
  if (segments.length === 0) return unknown("no_segments");
  const shares = segments
    .filter((segment) => segment.kind === "work")
    .map((segment) => segmentResult(segment).completion.value)
    .filter((value): value is number => value !== null)
    .map((value) => Math.min(1, value));
  return shares.length === 0
    ? unknown("no_planned_work")
    : known(shares.reduce((sum, value) => sum + value, 0) / shares.length);
}

/* ------------------------------------------------------------ heart rate */

export interface ZoneTime {
  /** Seconds in zones 1 to 5. */
  readonly seconds: readonly number[];
  readonly total_s: number;
  /** Share of the zone time per zone, 0 to 1. */
  readonly share: readonly number[];
}

export function zoneTime(
  run: Pick<RunInput, "status" | "hr_status" | "hr_zone_seconds">,
): RunMetric<ZoneTime> {
  if (run.status !== "completed") return unknown("run_not_completed");
  if (run.hr_status !== "recorded") return unknown(hrMissingReason(run));
  if (!run.hr_zone_seconds || run.hr_zone_seconds.length !== 5)
    return unknown("zone_seconds_missing");
  const seconds = [...run.hr_zone_seconds];
  const total = seconds.reduce((sum, value) => sum + value, 0);
  if (total <= 0) return unknown("zone_seconds_empty");
  return known({
    seconds,
    total_s: total,
    share: seconds.map((value) => value / total),
  });
}

/* ------------------------------------------------------------------ load */

/** Session RPE: effort (1–10) × minutes of timer time. */
export function srpeLoad(
  run: Pick<RunInput, "status" | "rpe" | "timer_s">,
): RunMetric<number> {
  if (run.status !== "completed") return unknown("run_not_completed");
  if (run.rpe === null) return unknown("rpe_missing");
  if (run.timer_s === null) return unknown("timer_missing");
  return known((run.rpe * run.timer_s) / 60);
}

/** Edwards load: minutes in each zone × the zone number (weights 1 to 5). */
export function edwardsLoad(
  run: Pick<RunInput, "status" | "hr_status" | "hr_zone_seconds">,
): RunMetric<number> {
  const zones = zoneTime(run);
  if (zones.value === null) return unknown(zones.reason);
  return known(
    zones.value.seconds.reduce(
      (sum, value, i) => sum + (value / 60) * EDWARDS_WEIGHTS[i],
      0,
    ),
  );
}

export type LoadBasis = "srpe" | "edwards";

export interface RunLoad {
  readonly srpe: RunMetric<number>;
  readonly edwards: RunMetric<number>;
  /** sRPE if known, else Edwards, else unknown. The two scales are never added. */
  readonly primary: RunMetric<{ basis: LoadBasis; value: number }>;
}

export function runLoad(run: RunInput): RunLoad {
  const srpe = srpeLoad(run);
  const edwards = edwardsLoad(run);
  const primary: RunLoad["primary"] =
    srpe.value !== null
      ? known({ basis: "srpe", value: srpe.value })
      : edwards.value !== null
        ? known({ basis: "edwards", value: edwards.value })
        : unknown("no_load_known");
  return { srpe, edwards, primary };
}

/* ------------------------------------------------------------ decoupling */

export interface Decoupling {
  /** (EF first half − EF second half) / EF first half × 100; positive = drift. */
  readonly percent: number;
  readonly notable: boolean;
  readonly first_half: { readonly speed_mps: number; readonly hr_avg: number };
  readonly second_half: { readonly speed_mps: number; readonly hr_avg: number };
}

/**
 * Pace-to-heart-rate decoupling: the efficiency factor (speed ÷ heart rate) of
 * the first half of the timer time against the second. Only with recorded
 * heart rate, from 45 minutes, outdoors (a treadmill distance is an
 * estimate) and with enough samples in both halves.
 */
export function decoupling(run: RunInput): RunMetric<Decoupling> {
  if (run.status !== "completed") return unknown("run_not_completed");
  if (run.hr_status !== "recorded") return unknown(hrMissingReason(run));
  if (run.environment === "treadmill")
    return unknown("treadmill_estimated_distance");
  if (run.timer_s === null) return unknown("timer_missing");
  if (run.timer_s < DECOUPLING_MIN_TIMER_S)
    return unknown("shorter_than_45_min");
  const splits = usableSplits(run);
  if (splits.value === null) return unknown(splits.reason);
  const samples = run.hr_samples ?? [];
  if (samples.length === 0) return unknown("hr_samples_missing");

  const end = splits.value[splits.value.length - 1];
  const distance = splits.value.length * SPLIT_METERS;
  const half = end / 2;
  const halfDistance = metersAtTime(splits.value, half);
  if (end <= 0 || halfDistance === null) return unknown("timer_zero");

  const mean = (from: number, to: number) => {
    const inside = samples.filter(
      (sample) =>
        sample.t_s >= from && (to === end ? sample.t_s <= to : sample.t_s < to),
    );
    return inside.length >= DECOUPLING_MIN_SAMPLES_PER_HALF
      ? inside.reduce((sum, sample) => sum + sample.bpm, 0) / inside.length
      : null;
  };
  const hr1 = mean(0, half);
  const hr2 = mean(half, end);
  if (hr1 === null || hr2 === null) return unknown("hr_samples_insufficient");

  const speed1 = halfDistance / half;
  const speed2 = (distance - halfDistance) / (end - half);
  if (speed1 <= 0 || speed2 <= 0) return unknown("distance_zero");
  const percent = (1 - speed2 / hr2 / (speed1 / hr1)) * 100;
  return known({
    percent,
    notable: percent > DECOUPLING_NOTABLE_PERCENT,
    first_half: { speed_mps: speed1, hr_avg: hr1 },
    second_half: { speed_mps: speed2, hr_avg: hr2 },
  });
}

/* ------------------------------------------------------------ one run */

export interface RunMetrics {
  readonly workout_id: string;
  readonly workout_date_local: string;
  readonly distance_m: RunMetric<number>;
  /** True when the distance is not GPS-measured (treadmill sensor, corrected, manual). */
  readonly distance_estimated: boolean;
  readonly timer_s: RunMetric<number>;
  readonly pace_s_per_km: RunMetric<number>;
  readonly kilometre_times_s: RunMetric<readonly number[]>;
  readonly best_efforts: RunBestEfforts;
  readonly segments: readonly SegmentResult[];
  readonly work_share_in_target: RunMetric<number>;
  readonly fulfilment: RunMetric<number>;
  readonly zones: RunMetric<ZoneTime>;
  readonly load: RunLoad;
  readonly decoupling: RunMetric<Decoupling>;
}

/** All per-run metrics (spec "Kennzahlen: Pro Lauf"). */
export function runMetrics(run: RunInput): RunMetrics {
  const completed = run.status === "completed";
  const segments = [...(run.segments ?? [])].sort(byIndex);
  const distance = !completed
    ? unknown<number>("run_not_completed")
    : run.distance_m === null
      ? unknown<number>("distance_missing")
      : known(run.distance_m);
  const timer = !completed
    ? unknown<number>("run_not_completed")
    : run.timer_s === null
      ? unknown<number>("timer_missing")
      : known(run.timer_s);
  return {
    workout_id: run.workout_id,
    workout_date_local: run.workout_date_local,
    distance_m: distance,
    distance_estimated:
      run.distance_source !== null && run.distance_source !== "gps",
    timer_s: timer,
    pace_s_per_km: completed
      ? paceSecondsPerKm(run.timer_s, run.distance_m)
      : unknown("run_not_completed"),
    kilometre_times_s: kilometreTimes(run),
    best_efforts: runBestEfforts(run),
    segments: completed ? segments.map(segmentResult) : [],
    work_share_in_target: completed
      ? workShareInTarget(segments)
      : unknown("run_not_completed"),
    fulfilment: completed
      ? runFulfilment(segments)
      : unknown("run_not_completed"),
    zones: zoneTime(run),
    load: runLoad(run),
    decoupling: decoupling(run),
  };
}
