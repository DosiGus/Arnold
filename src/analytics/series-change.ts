/**
 * Change shown next to a chart: first against last known value of the points
 * on screen. Unknown points (null) are skipped, never read as 0; with fewer
 * than two known values there is no change.
 */
import { round } from "./validation.js";

export type SeriesChange = { from: number; to: number; delta: number };

export function firstLastChange(
  values: readonly (number | null)[],
): SeriesChange | null {
  const known = values.filter(
    (v): v is number => v !== null && Number.isFinite(v),
  );
  if (known.length < 2) return null;
  const from = known[0]!;
  const to = known[known.length - 1]!;
  return { from, to, delta: round(to - from) };
}
