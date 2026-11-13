import type {
  ArnoldRun,
  ArnoldRunSegment,
} from "../../../shared/arnold-schema-v1.js";

/**
 * Running metrics (ARN-RUN, spec "Kennzahlen"): pure functions over finished
 * runs. No I/O, no clock; calendar days come only from `workout_date_local`.
 * Bump the version whenever a formula, a threshold or a reason changes.
 */
export const RUN_METRICS_VERSION = "1.0.0";

/**
 * Why a value is unknown. A number that cannot be computed is never 0: it is
 * `{ value: null, reason }` with exactly one of these codes.
 */
export const RUN_METRIC_REASONS = [
  // the run itself
  "run_not_completed",
  "timer_missing",
  "timer_zero",
  "distance_missing",
  "distance_zero",
  "distance_not_measured",
  "no_splits",
  "splits_invalid",
  "distance_not_covered",
  "treadmill_no_bests",
  "treadmill_estimated_distance",
  // segments
  "no_segments",
  "segment_skipped",
  "no_target",
  "time_in_target_missing",
  "no_planned_duration",
  "no_planned_work",
  // heart rate (D-RUN-07)
  "hr_no_consent",
  "hr_no_sensor",
  "hr_not_provided",
  "hr_consent_revoked",
  "hr_not_recorded",
  "zone_seconds_missing",
  "zone_seconds_empty",
  "hr_samples_missing",
  "hr_samples_insufficient",
  "shorter_than_45_min",
  // load
  "rpe_missing",
  "no_load_known",
  // aggregates
  "no_runs",
  "no_run_time",
  "no_pace_data",
  "no_zone2_runs",
  "nothing_due",
  "history_too_short",
  "chronic_load_zero",
  "unclassified_run_type",
] as const;
export type RunMetricReason = (typeof RUN_METRIC_REASONS)[number];

/** A known value, or no value and the reason. */
export type RunMetric<T> =
  | { readonly value: T; readonly reason: null }
  | { readonly value: null; readonly reason: RunMetricReason };

export const known = <T>(value: T): RunMetric<T> => ({ value, reason: null });
export const unknown = <T>(reason: RunMetricReason): RunMetric<T> => ({
  value: null,
  reason,
});

/**
 * A sum over several runs. `known` of `total` runs contributed; the sum is
 * null only if none did, and `reason` names what is missing when known < total.
 */
export interface RunSum {
  readonly value: number | null;
  readonly known: number;
  readonly total: number;
  readonly reason: RunMetricReason | null;
}

/** One heart-rate sample: timer seconds since the start of the run. */
export interface RunHrSample {
  readonly t_s: number;
  readonly bpm: number;
}

export type RunSegmentInput = Pick<
  ArnoldRunSegment,
  | "segment_index"
  | "repetition"
  | "kind"
  | "planned_duration_type"
  | "planned_duration_value"
  | "target_type"
  | "target_low"
  | "target_high"
  | "timer_s"
  | "distance_m"
  | "time_in_target_s"
  | "status"
  | "hr_avg_bpm"
  | "hr_max_bpm"
>;

/**
 * One run as the metrics read it: the stored run row, the workout fields it
 * needs, its segments and (optionally) the heart-rate samples that arrived
 * over the health path. `started_at_utc` only orders runs of the same day; it
 * never decides which day or week a run belongs to.
 */
export type RunInput = Pick<
  ArnoldRun,
  | "workout_id"
  | "run_type"
  | "environment"
  | "timer_s"
  | "elapsed_s"
  | "distance_m"
  | "distance_source"
  | "ascent_m"
  | "descent_m"
  | "cadence_spm"
  | "calories_kcal"
  | "te_aerobic"
  | "te_anaerobic"
  | "rpe"
  | "splits_100m"
  | "pause_count"
  | "hr_status"
  | "hr_avg_bpm"
  | "hr_max_bpm"
  | "hr_zone_seconds"
> & {
  readonly workout_date_local: string;
  readonly status:
    "planned" | "in_progress" | "completed" | "cancelled" | "voided";
  readonly started_at_utc?: string | null;
  readonly segments?: readonly RunSegmentInput[];
  readonly hr_samples?: readonly RunHrSample[];
};

/** Why a run has no heart-rate values, as a metric reason. */
export function hrMissingReason(
  run: Pick<RunInput, "hr_status">,
): RunMetricReason {
  switch (run.hr_status) {
    case "no_consent":
      return "hr_no_consent";
    case "no_sensor":
      return "hr_no_sensor";
    case "not_provided":
      return "hr_not_provided";
    case "consent_revoked":
      return "hr_consent_revoked";
    default:
      return "hr_not_recorded";
  }
}
