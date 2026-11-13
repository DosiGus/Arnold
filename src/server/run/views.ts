/**
 * What the run tools show: rows turned into small views. Nothing is computed
 * here that the engine or the metrics own (paces and zones come from
 * src/analytics/running); a value that is not there is null with a reason.
 */
import { paceSecondsPerKm } from "../../analytics/running/metrics/index.js";
import {
  referenceTempoZones,
  referenceValidUntil,
  runExperience,
  type RunExperience,
} from "../../analytics/running/index.js";
import type {
  ArnoldRun,
  ArnoldRunProfile,
  ArnoldRunSegment,
  ArnoldWorkout,
} from "../../shared/arnold-schema-v1.js";
import {
  RUN_DURATION_TYPES,
  RUN_SEGMENT_KINDS,
  RUN_TARGET_TYPES,
  type RunPrescription,
  type RunProfileResponse,
  type RunProfileView,
  type RunView,
} from "../../shared/run-contract.js";

/** The local calendar day of an instant in a time zone (never a UTC cut). */
export const localDay = (iso: string, timeZone: string) =>
  new Intl.DateTimeFormat("en-CA", { timeZone }).format(new Date(iso));

/** One executed position of a prescription, repeats unrolled. */
export interface ExpandedSegment {
  readonly tuple: RunPrescription["s"][number];
  /** Repetition inside its block, null outside a repeat. */
  readonly repetition: number | null;
}

/** The prescription in execution order, as the watch runs it. */
export function expandPrescription(
  prescription: RunPrescription,
): ExpandedSegment[] {
  const repeats = prescription.rp ?? [];
  const out: ExpandedSegment[] = [];
  for (let i = 0; i < prescription.s.length; i++) {
    const block = repeats.find(([first]) => first === i);
    if (!block) {
      out.push({ tuple: prescription.s[i], repetition: null });
      continue;
    }
    const [first, last, count] = block;
    for (let n = 1; n <= count; n++)
      for (let j = first; j <= last; j++)
        out.push({ tuple: prescription.s[j], repetition: n });
    i = last;
  }
  return out;
}

/**
 * Planned time and distance, only when every segment is defined that way;
 * otherwise unknown (an open or mixed run has no honest total).
 */
export function plannedTotals(prescription: RunPrescription) {
  const all = expandPrescription(prescription);
  const sum = (type: number) =>
    all.every(({ tuple }) => tuple[1] === type)
      ? all.reduce((s, { tuple }) => s + tuple[2], 0)
      : null;
  return { total_s: sum(1), distance_m: sum(2) };
}

export const segmentKindOf = (code: number) => RUN_SEGMENT_KINDS[code];
export const durationTypeOf = (code: number) => RUN_DURATION_TYPES[code];
export const targetTypeOf = (code: number) => RUN_TARGET_TYPES[code];

const HR_REASON = {
  recorded: null,
  no_consent: "no_consent",
  no_sensor: "no_sensor",
  not_provided: "not_provided",
  consent_revoked: "consent_revoked",
} as const;

export function runView(
  workout: ArnoldWorkout,
  run: ArnoldRun,
  segments: readonly ArnoldRunSegment[],
): RunView {
  if (workout.status === "in_progress")
    throw new Error("A run is never in progress.");
  const p = run.prescription;
  const totals = p ? plannedTotals(p) : null;
  const done = workout.status === "completed";
  const pace = done ? paceSecondsPerKm(run.timer_s, run.distance_m) : null;
  const unknown: { field: string; reason: string }[] = [];
  if (done) {
    if (run.rpe === null) unknown.push({ field: "rpe", reason: "not_given" });
    if (run.hr_status && run.hr_status !== "recorded")
      unknown.push({ field: "heart_rate", reason: HR_REASON[run.hr_status]! });
    for (const field of [
      "ascent_m",
      "descent_m",
      "cadence_spm",
      "calories_kcal",
    ] as const)
      if (run[field] === null) unknown.push({ field, reason: "not_provided" });
    if (pace && pace.value === null)
      unknown.push({ field: "pace", reason: pace.reason });
  }
  return {
    workout_id: workout.workout_id,
    row_revision: workout.row_revision,
    workout_date_local: workout.workout_date_local,
    status: workout.status as RunView["status"],
    run_type: run.run_type,
    environment: run.environment,
    name: p?.n ?? workout.session_name_snapshot,
    hint: p?.h ?? null,
    planned:
      p && totals
        ? {
            ...totals,
            segments: p.s.length,
            has_pace_targets: p.s.some((s) => s[3] === 2),
            alarms: { hr: !!p.a?.hi, pace: !!p.a?.pace, lo: !!p.a?.lo },
          }
        : null,
    result:
      done && run.result_source
        ? {
            result_source: run.result_source,
            timer_s: run.timer_s,
            elapsed_s: run.elapsed_s,
            distance_m: run.distance_m,
            distance_source: run.distance_source,
            pace_s_per_km: pace?.value == null ? null : Math.round(pace.value),
            rpe: run.rpe,
            hr_status: run.hr_status ?? "not_provided",
            hr_avg_bpm: run.hr_avg_bpm,
            hr_max_bpm: run.hr_max_bpm,
            calories_kcal: run.calories_kcal,
            cadence_spm: run.cadence_spm,
            ascent_m: run.ascent_m,
            descent_m: run.descent_m,
            lap_count: segments.filter((s) => s.kind === "lap").length,
          }
        : null,
    unknown,
  };
}

export function profileView(row: ArnoldRunProfile): RunProfileView {
  const hasReference = row.reference_distance_m !== null;
  return {
    run_profile_id: row.run_profile_id,
    row_revision: row.row_revision,
    goal: row.goal,
    race_date: row.race_date,
    target_time_s: row.target_time_s,
    reference: hasReference
      ? {
          distance_m: row.reference_distance_m!,
          time_s: row.reference_time_s!,
          date: row.reference_date!,
          source: row.reference_source!,
        }
      : null,
    running_experience_months: row.running_experience_months,
    runs_per_week: row.runs_per_week,
    long_run_weekday: row.long_run_weekday,
    preferred_environment: row.preferred_environment,
    base_minutes_per_week: row.base_minutes_per_week,
    longest_run_4w_min: row.longest_run_4w_min,
    alarm_settings: row.alarm_settings,
  };
}

/** The reference of a profile in the shape the engine reads. */
export const referenceOf = (profile: ArnoldRunProfile | null) =>
  profile
    ? {
        distance_m: profile.reference_distance_m,
        time_s: profile.reference_time_s,
        date: profile.reference_date,
        source: profile.reference_source,
      }
    : null;

export const experienceOf = (
  profile: ArnoldRunProfile | null,
): RunExperience =>
  profile
    ? runExperience(profile)
    : runExperience({
        running_experience_months: null,
        base_minutes_per_week: null,
      });

/** What Arnold derived from the profile on `today`; never set by the model. */
export function profileResponse(
  profile: ArnoldRunProfile | null,
  today: string,
): RunProfileResponse {
  const zones = referenceTempoZones(referenceOf(profile), today);
  const missing: string[] = [];
  if (!profile) missing.push("run_profile");
  else {
    if (profile.running_experience_months === null)
      missing.push("running_experience_months");
    if (profile.base_minutes_per_week === null)
      missing.push("base_minutes_per_week");
    if (profile.reference_distance_m === null)
      missing.push("reference (Test, Wettkampf oder eigene Angabe)");
  }
  return {
    profile: profile ? profileView(profile) : null,
    derived: {
      experience: experienceOf(profile),
      reference_valid: zones.value !== null,
      reference_reason: zones.reason,
      reference_valid_until:
        zones.value !== null && profile?.reference_date
          ? referenceValidUntil(profile.reference_date)
          : null,
      vdot: zones.value?.vdot ?? null,
      pace_zones:
        zones.value === null
          ? null
          : (JSON.parse(JSON.stringify(zones.value)) as Record<
              string,
              unknown
            >),
    },
    missing,
  };
}
