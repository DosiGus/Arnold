/** Raw watch recording metrics. Pure functions: no inferred zones or missing samples. */
export interface RecordingSnapshot {
  at_utc: string;
  body_battery?: number | null;
  stress?: number | null;
  resting_hr?: number | null;
}
export interface RecordingHealth {
  hr?: {
    interval_s: number;
    start_utc: string;
    values: readonly number[];
  } | null;
  before?: RecordingSnapshot | null;
  after?: RecordingSnapshot | null;
}

export interface RecordingPause {
  planned_s: number | null;
  actual_s: number | null;
}
const finite = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v);
const measured = (v: unknown): v is number => finite(v) && v >= 0;

/** Upper bounds are caller-supplied bpm cutoffs. A boundary belongs to the
 * next zone: [0, cutoff1), [cutoff1, cutoff2), … . Missing HR never adds time. */
export function heartRateMetrics(
  hr: RecordingHealth["hr"],
  zoneUpperBounds?: readonly number[],
) {
  if (!hr || !finite(hr.interval_s) || hr.interval_s <= 0) return null;
  const values = hr.values.filter((v) => finite(v) && v > 0);
  if (
    zoneUpperBounds &&
    !zoneUpperBounds.every(
      (v, i) => finite(v) && v > 0 && (i === 0 || v > zoneUpperBounds[i - 1]),
    )
  )
    throw new Error(
      "Heart-rate zone bounds must be positive and strictly increasing.",
    );
  const zones = zoneUpperBounds
    ? Array.from({ length: zoneUpperBounds.length + 1 }, (_, i) => ({
        lower_bpm: i ? zoneUpperBounds[i - 1] : 0,
        upper_bpm: zoneUpperBounds[i] ?? null,
        seconds: 0,
      }))
    : null;
  for (const value of values) {
    const i = zoneUpperBounds?.findIndex((bound) => value < bound) ?? -1;
    if (zones) zones[i < 0 ? zones.length - 1 : i].seconds += hr.interval_s;
  }
  return {
    average_bpm: values.length
      ? values.reduce((sum, v) => sum + v, 0) / values.length
      : null,
    max_bpm: values.length ? Math.max(...values) : null,
    measured_seconds: values.length * hr.interval_s,
    missing_seconds: (hr.values.length - values.length) * hr.interval_s,
    zones,
  };
}

/** Actual versus planned rest, with no invented tolerance or scoring rule.
 * 100% means exactly the planned time; unavailable or zero-length targets
 * have no ratio. Incomplete pairs contribute to neither aggregate total. */
export function pauseMetrics(pauses: readonly RecordingPause[]) {
  const rows = pauses.map((p) => {
    const planned_s = measured(p.planned_s) ? p.planned_s : null;
    const actual_s = measured(p.actual_s) ? p.actual_s : null;
    const complete = planned_s !== null && actual_s !== null;
    return {
      planned_s,
      actual_s,
      delta_s: complete ? actual_s - planned_s : null,
      ratio_pct:
        complete && planned_s > 0 ? (actual_s / planned_s) * 100 : null,
    };
  });
  const complete = rows.filter((p) => p.delta_s !== null);
  const planned_s = complete.reduce((sum, p) => sum + p.planned_s!, 0);
  const actual_s = complete.reduce((sum, p) => sum + p.actual_s!, 0);
  return {
    pauses: rows,
    measured_pauses: complete.length,
    planned_s: complete.length ? planned_s : null,
    actual_s: complete.length ? actual_s : null,
    delta_s: complete.length ? actual_s - planned_s : null,
    ratio_pct:
      complete.length && planned_s > 0 ? (actual_s / planned_s) * 100 : null,
  };
}

/** Snapshot zero is a value (e.g. Body Battery); only HR-series zero is a gap. */
export function healthSnapshotDifferences(
  before: RecordingHealth["before"],
  after: RecordingHealth["after"],
) {
  const difference = (key: "body_battery" | "stress" | "resting_hr") => {
    const a = before?.[key],
      b = after?.[key];
    return finite(a) && finite(b) ? b - a : null;
  };
  return {
    body_battery: difference("body_battery"),
    stress: difference("stress"),
    resting_hr: difference("resting_hr"),
  };
}
export function recordingMetrics(
  health: RecordingHealth,
  pauses: readonly RecordingPause[] = [],
  zoneUpperBounds?: readonly number[],
) {
  return {
    heart_rate: heartRateMetrics(health.hr, zoneUpperBounds),
    rest: pauseMetrics(pauses),
    differences: healthSnapshotDifferences(health.before, health.after),
  };
}
