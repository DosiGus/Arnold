import { known, unknown, type RunInput, type RunMetric } from "./types.js";

/**
 * Splits are the cumulative timer seconds at each full 100 m (D-RUN-14), so
 * `splits[k - 1]` is the time at k × 100 m and the time at 0 m is 0.
 */
export const SPLIT_METERS = 100;

export const cumulativeAt = (splits: readonly number[], index: number) =>
  index === 0 ? 0 : splits[index - 1];

/** True if the splits are finite and never decrease. */
export const splitsAreValid = (splits: readonly number[]) =>
  splits.every(
    (value, i) =>
      Number.isFinite(value) &&
      value >= 0 &&
      (i === 0 || value >= splits[i - 1]),
  );

/**
 * Timer seconds at `meters` by linear interpolation between two checkpoints,
 * or null beyond the last checkpoint.
 */
export function timeAtMeters(
  splits: readonly number[],
  meters: number,
): number | null {
  const position = meters / SPLIT_METERS;
  const index = Math.floor(position + 1e-9);
  const fraction = position - index;
  if (index > splits.length) return null;
  const start = cumulativeAt(splits, index);
  if (Math.abs(fraction) < 1e-9) return start;
  if (index + 1 > splits.length) return null;
  return start + fraction * (cumulativeAt(splits, index + 1) - start);
}

/** Metres at `seconds` by linear interpolation, or null beyond the last checkpoint. */
export function metersAtTime(
  splits: readonly number[],
  seconds: number,
): number | null {
  if (splits.length === 0 || seconds > splits[splits.length - 1]) return null;
  for (let i = 0; i < splits.length; i += 1) {
    const from = cumulativeAt(splits, i);
    const to = cumulativeAt(splits, i + 1);
    if (seconds > to) continue;
    return to > from
      ? SPLIT_METERS * (i + (seconds - from) / (to - from))
      : SPLIT_METERS * i;
  }
  return null;
}

/** The splits of a run, or the reason there are none to rely on. */
export function usableSplits(
  run: Pick<RunInput, "status" | "splits_100m">,
): RunMetric<readonly number[]> {
  if (run.status !== "completed") return unknown("run_not_completed");
  const splits = run.splits_100m;
  if (!splits || splits.length === 0) return unknown("no_splits");
  if (!splitsAreValid(splits)) return unknown("splits_invalid");
  return known(splits);
}
