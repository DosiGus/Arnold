import { compareDate } from "../../period.js";
import {
  cumulativeAt,
  SPLIT_METERS,
  timeAtMeters,
  usableSplits,
} from "./splits.js";
import { known, unknown, type RunInput, type RunMetric } from "./types.js";

/**
 * Best efforts (spec "Bestleistungen"): the fastest 1 km, 5 km, 10 km and
 * half marathon inside a run, from the 100 m checkpoints. A window starts at a
 * checkpoint; its end is interpolated between two checkpoints where the
 * distance is not a multiple of 100 m (half marathon: 21 097.5 m). Time is
 * timer time, so pauses do not count. Treadmill runs never count: their
 * distance is an estimate (D-RUN-13).
 */
export const BEST_EFFORT_DISTANCES = [
  { key: "1k", meters: 1000 },
  { key: "5k", meters: 5000 },
  { key: "10k", meters: 10_000 },
  { key: "half_marathon", meters: 21_097.5 },
] as const;
export type BestEffortKey = (typeof BEST_EFFORT_DISTANCES)[number]["key"];

export interface BestEffort {
  readonly time_s: number;
  /** Where the fastest window starts, in metres from the start of the run. */
  readonly start_m: number;
}

/** The fastest window of `meters` in the splits, or null if the run is shorter. */
export function fastestWindow(
  splits: readonly number[],
  meters: number,
): BestEffort | null {
  let best: BestEffort | null = null;
  for (
    let start = 0;
    start * SPLIT_METERS + meters <= splits.length * SPLIT_METERS + 1e-9;
    start += 1
  ) {
    const end = timeAtMeters(splits, start * SPLIT_METERS + meters);
    if (end === null) break;
    const time = end - cumulativeAt(splits, start);
    if (time <= 0) continue; // checkpoints without elapsed time: not a measurement
    if (best === null || time < best.time_s)
      best = { time_s: time, start_m: start * SPLIT_METERS };
  }
  return best;
}

export type RunBestEfforts = Readonly<
  Record<BestEffortKey, RunMetric<BestEffort>>
>;

/** Best efforts of one run; every distance carries its own reason when unknown. */
export function runBestEfforts(
  run: Pick<
    RunInput,
    "status" | "environment" | "distance_source" | "splits_100m"
  >,
): RunBestEfforts {
  const result = {} as Record<BestEffortKey, RunMetric<BestEffort>>;
  const blocked = (() => {
    if (run.status !== "completed") return "run_not_completed" as const;
    if (run.environment === "treadmill") return "treadmill_no_bests" as const;
    if (run.distance_source === null) return "distance_missing" as const;
    if (run.distance_source !== "gps") return "distance_not_measured" as const;
    return null;
  })();
  const splits = blocked ? null : usableSplits(run);
  for (const { key, meters } of BEST_EFFORT_DISTANCES) {
    if (blocked) result[key] = unknown(blocked);
    else if (splits!.value === null) result[key] = unknown(splits!.reason);
    else {
      const effort = fastestWindow(splits!.value, meters);
      result[key] = effort ? known(effort) : unknown("distance_not_covered");
    }
  }
  return result;
}

export interface PersonalBest extends BestEffort {
  readonly workout_id: string;
  readonly workout_date_local: string;
}

/**
 * The best time per distance over all runs. Ties go to the earlier run, so a
 * later run only replaces a best by beating it.
 */
export function personalBests(
  runs: readonly RunInput[],
): Readonly<Record<BestEffortKey, RunMetric<PersonalBest>>> {
  const ordered = [...runs].sort(
    (a, b) =>
      compareDate(a.workout_date_local, b.workout_date_local) ||
      (a.started_at_utc ?? "").localeCompare(b.started_at_utc ?? ""),
  );
  const result = {} as Record<BestEffortKey, RunMetric<PersonalBest>>;
  const efforts = ordered.map((run) => ({ run, best: runBestEfforts(run) }));
  for (const { key } of BEST_EFFORT_DISTANCES) {
    let best: PersonalBest | null = null;
    for (const { run, best: runBest } of efforts) {
      const effort = runBest[key].value;
      if (effort && (best === null || effort.time_s < best.time_s))
        best = {
          ...effort,
          workout_id: run.workout_id,
          workout_date_local: run.workout_date_local,
        };
    }
    result[key] = best ? known(best) : unknown("no_runs");
  }
  return result;
}
