/**
 * Running records ("Laufrekorde") for the start screen and the records view.
 *
 * Pure, no I/O. Read only from completed runs:
 *
 * - longest run: the stored distance of a run. A treadmill distance is the
 *   machine's estimate (D-RUN-13, `distance_source` "sensor") and never sets a
 *   record; GPS, corrected and manually reported distances count.
 * - longest duration: timer time (`timer_s`, pauses left out) of any
 *   completed run, treadmill included.
 * - fastest kilometre, best 5 km and 10 km (`measuredTimeFor`): the fastest
 *   time over that distance inside one run, from whichever of three measured
 *   sources the run has; the lowest one counts:
 *   1. the watch's 100 m checkpoints (`splits_100m`) of a GPS run, as for the
 *      best efforts in `running/metrics/bests.ts`;
 *   2. consecutive kilometre laps (run segments of kind "lap") whose
 *      distances add up to the distance, at most 0.5 % more; the time is the
 *      sum of their timer times;
 *   3. the whole run, when its measured distance is the distance, at most
 *      0.5 % more ("5 km in 26:10" told in the chat).
 *   A longer stretch only ever makes the time slower, never faster. Nothing
 *   is extrapolated or estimated: a 5.3 km run without checkpoints or laps
 *   has no 5 km time. Treadmill runs and treadmill distances never count.
 *
 * Each record carries its run and date; a record nothing can prove stays
 * `value: null` with a reason, never 0.
 */
import {
  isRunWorkout,
  type ArnoldDataset,
} from "../shared/arnold-schema-v1.js";
import { compareDate } from "./period.js";
import {
  fastestWindow,
  usableSplits,
  type RunInput,
  type RunMetricReason,
} from "./running/metrics/index.js";

export const RUN_RECORD_KEYS = [
  "longest_distance",
  "longest_duration",
  "fastest_1k",
  "best_5k",
  "best_10k",
] as const;
export type RunRecordKey = (typeof RUN_RECORD_KEYS)[number];

export type RunRecord = Readonly<{
  key: RunRecordKey;
  /** Metres for longest_distance, seconds for everything else. */
  unit: "m" | "s";
  value: number | null;
  workout_id: string | null;
  achieved_on: string | null;
  reason: RunMetricReason | null;
}>;

/**
 * A dataset as the store source hands it over may already be reduced to
 * strength training; the runs then travel in `runRecordInputs`.
 */
export type DatasetWithRunInputs = ArnoldDataset &
  Readonly<{ runRecordInputs?: readonly RunInput[] }>;

/** All runs of a dataset in the shape the running metrics read. */
export function runInputsOf(data: ArnoldDataset): RunInput[] {
  const workouts = new Map(data.workouts.map((w) => [w.workout_id, w]));
  const segments = new Map<string, (typeof data.runSegments)[number][]>();
  for (const segment of data.runSegments ?? []) {
    const list = segments.get(segment.workout_id) ?? [];
    list.push(segment);
    segments.set(segment.workout_id, list);
  }
  const inputs: RunInput[] = [];
  for (const run of data.runs ?? []) {
    const workout = workouts.get(run.workout_id);
    if (!workout || !isRunWorkout(workout)) continue;
    inputs.push({
      ...run,
      workout_date_local: workout.workout_date_local,
      status: workout.status,
      started_at_utc: workout.started_at_utc ?? null,
      segments: segments.get(run.workout_id) ?? [],
    });
  }
  return inputs;
}

/** Oldest first: calendar day, then start time, then id. */
const chronological = (a: RunInput, b: RunInput) =>
  compareDate(a.workout_date_local, b.workout_date_local) ||
  (a.started_at_utc ?? "").localeCompare(b.started_at_utc ?? "") ||
  (a.workout_id < b.workout_id ? -1 : a.workout_id > b.workout_id ? 1 : 0);

/**
 * The completed runs a dataset knows: its own and the ones carried next to a
 * strength-only view, each once.
 */
export function completedRunsOf(data: DatasetWithRunInputs): RunInput[] {
  const own = runInputsOf(data);
  const seen = new Set(own.map((r) => r.workout_id));
  return [
    ...own,
    ...(data.runRecordInputs ?? []).filter((r) => !seen.has(r.workout_id)),
  ]
    .filter((r) => r.status === "completed")
    .sort(chronological);
}

/** True when a run's distance is a measurement, not a treadmill estimate. */
export const hasMeasuredDistance = (run: RunInput) =>
  run.distance_m !== null &&
  run.distance_m > 0 &&
  run.distance_source !== null &&
  run.distance_source !== "sensor" &&
  run.environment !== "treadmill";

/** How much longer than the distance a lap stretch or a whole run may be. */
export const MEASURED_DISTANCE_TOLERANCE = 0.005;

const fits = (covered: number, meters: number) =>
  covered >= meters && covered <= meters * (1 + MEASURED_DISTANCE_TOLERANCE);

/**
 * The fastest measured time over `meters` inside one completed run, in whole
 * seconds, or null when the run cannot prove one (see the file comment).
 */
export function measuredTimeFor(run: RunInput, meters: number): number | null {
  if (
    run.status !== "completed" ||
    run.environment === "treadmill" ||
    run.distance_source === null ||
    run.distance_source === "sensor"
  )
    return null;
  const times: number[] = [];
  if (run.distance_source === "gps") {
    const splits = usableSplits(run).value;
    const effort = splits ? fastestWindow(splits, meters) : null;
    if (effort) times.push(effort.time_s);
  }
  const laps = (run.segments ?? [])
    .filter((s) => s.kind === "lap" && s.status === "completed")
    .sort((a, b) => a.segment_index - b.segment_index);
  for (let start = 0; start < laps.length; start += 1) {
    let distance = 0;
    let time = 0;
    for (let end = start; end < laps.length; end += 1) {
      distance += laps[end]!.distance_m;
      time += laps[end]!.timer_s;
      if (distance >= meters) {
        if (fits(distance, meters) && time > 0) times.push(time);
        break;
      }
    }
  }
  if (
    run.distance_m !== null &&
    run.timer_s !== null &&
    run.timer_s > 0 &&
    fits(run.distance_m, meters)
  )
    times.push(run.timer_s);
  return times.length ? Math.round(Math.min(...times)) : null;
}

const record = (
  key: RunRecordKey,
  unit: RunRecord["unit"],
  found: { value: number; run: RunInput } | null,
  reason: RunMetricReason,
): RunRecord =>
  Object.freeze({
    key,
    unit,
    value: found?.value ?? null,
    workout_id: found?.run.workout_id ?? null,
    achieved_on: found?.run.workout_date_local ?? null,
    reason: found ? null : reason,
  });

/** The highest value; ties keep the earlier run. */
function highest(
  runs: readonly RunInput[],
  pick: (run: RunInput) => number | null,
) {
  let best: { value: number; run: RunInput } | null = null;
  for (const run of runs) {
    const value = pick(run);
    if (value !== null && value > 0 && (best === null || value > best.value))
      best = { value, run };
  }
  return best;
}

/** The running records over every completed run, in RUN_RECORD_KEYS order. */
export function computeRunRecords(
  runs: readonly RunInput[],
): readonly RunRecord[] {
  const completed = runs
    .filter((r) => r.status === "completed")
    .sort(chronological);
  const none = completed.length === 0;
  // The lowest time; ties keep the earlier run.
  const best = (meters: number) => {
    let found: { value: number; run: RunInput } | null = null;
    for (const run of completed) {
      const value = measuredTimeFor(run, meters);
      if (value !== null && (found === null || value < found.value))
        found = { value, run };
    }
    return found;
  };
  // A best time needs a run that measured the whole distance.
  const effortReason: RunMetricReason = none
    ? "no_runs"
    : "distance_not_covered";
  return Object.freeze([
    record(
      "longest_distance",
      "m",
      highest(completed, (r) => (hasMeasuredDistance(r) ? r.distance_m : null)),
      none ? "no_runs" : "distance_not_measured",
    ),
    record(
      "longest_duration",
      "s",
      highest(completed, (r) => r.timer_s),
      none ? "no_runs" : "timer_missing",
    ),
    record("fastest_1k", "s", best(1000), effortReason),
    record("best_5k", "s", best(5000), effortReason),
    record("best_10k", "s", best(10_000), effortReason),
  ]);
}
