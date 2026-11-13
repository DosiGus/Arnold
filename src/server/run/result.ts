/**
 * Turns a run result into row changes. One place for chat, screenshot and
 * watch, so a planned run is completed, replaced or moved the same way and the
 * heart-rate rule (only with the health consent, D-RUN-07) cannot differ.
 *
 * Stable columns of a workout (date, name, source, plan reference) never
 * change, so a result on another day than planned cancels the planned run and
 * writes a new completed one; a result on the planned day completes it in
 * place. Nothing here reads a clock or the network.
 */
import { RUN_TYPE_NAMES } from "../../analytics/running/index.js";
import {
  ArnoldRunSchema,
  ArnoldRunSegmentSchema,
  ArnoldWorkoutSchema,
  type ArnoldRun,
  type ArnoldRunSegment,
  type ArnoldWorkout,
} from "../../shared/arnold-schema-v1.js";
import type { RunPrescription, RunType } from "../../shared/run-contract.js";
import { WriteError, type EntityChange } from "../workout/infrastructure.js";

export interface RunHeartRate {
  readonly avg: number;
  readonly max: number;
  readonly zone_s: readonly number[] | null;
}

export interface ResultSegment {
  readonly segment_index: number;
  readonly repetition: number | null;
  readonly kind: ArnoldRunSegment["kind"];
  /** What was prescribed; null for a lap of a free run. */
  readonly planned: {
    readonly duration_type: NonNullable<
      ArnoldRunSegment["planned_duration_type"]
    >;
    readonly duration_value: number;
    readonly target_type: NonNullable<ArnoldRunSegment["target_type"]>;
    readonly target_low: number;
    readonly target_high: number;
  } | null;
  readonly timer_s: number;
  readonly distance_m: number;
  readonly time_in_target_s: number | null;
  readonly status: ArnoldRunSegment["status"];
  readonly hr: readonly [number, number] | null;
}

export interface RunResultInput {
  readonly date: string;
  readonly timezone: string;
  readonly run_type: RunType;
  readonly environment: ArnoldRun["environment"];
  readonly result_source: NonNullable<ArnoldRun["result_source"]>;
  readonly timer_s: number;
  readonly elapsed_s: number | null;
  readonly distance_m: number;
  readonly distance_source: NonNullable<ArnoldRun["distance_source"]>;
  readonly started_at_utc: string | null;
  readonly ended_at_utc: string | null;
  readonly ascent_m: number | null;
  readonly descent_m: number | null;
  readonly cadence_spm: number | null;
  readonly calories_kcal: number | null;
  readonly rpe: number | null;
  readonly te_aerobic?: number | null;
  readonly te_anaerobic?: number | null;
  readonly pause_count?: number | null;
  readonly splits_100m?: readonly number[] | null;
  /** Heart rate as sent; stored only with the health consent. */
  readonly hr: RunHeartRate | null;
  /** The device has no heart-rate sensor (watch only). */
  readonly no_sensor?: boolean;
  readonly segments: readonly ResultSegment[];
  readonly notes: string | null;
  readonly client_session_id?: string | null;
  /** Source of a NEW workout row; chat for text, sync for the watch. */
  readonly workout_source: "chat" | "sync";
  /** For a run without a planned one: what it was prescribed, if anything. */
  readonly fresh?: {
    readonly prescription: RunPrescription | null;
    readonly rationale: string | null;
    readonly rules_version: string | null;
    readonly plan_version_id: string | null;
    readonly session_id: string | null;
    readonly name: string | null;
  };
}

export interface RunPair {
  readonly workout: ArnoldWorkout;
  readonly run: ArnoldRun;
}

export interface ResultContext {
  readonly now: string;
  readonly id: () => string;
  /** Health consent as read just before the write. */
  readonly consent: boolean;
  readonly changes: EntityChange[];
  readonly warnings: string[];
}

export interface ResultOutcome {
  readonly workout: ArnoldWorkout;
  readonly run: ArnoldRun;
  /** Heart-rate values were sent and not stored. */
  readonly hr_discarded: boolean;
  /** The planned or replaced workout this result took off the books. */
  readonly replaced_workout_id: string | null;
}

const NO_CONSENT_WARNING =
  "Pulswerte wurden verworfen: Für Gesundheitsdaten liegt keine Einwilligung vor. Der Lauf ist ohne Puls gespeichert.";

/** The status of a heart-rate result and what is stored of it. */
function heartRate(input: RunResultInput, consent: boolean) {
  const recorded = input.hr !== null && consent;
  const hr_status: NonNullable<ArnoldRun["hr_status"]> = recorded
    ? "recorded"
    : input.hr
      ? "no_consent"
      : input.no_sensor
        ? "no_sensor"
        : consent
          ? "not_provided"
          : "no_consent";
  return {
    hr_status,
    hr_avg_bpm: recorded ? input.hr!.avg : null,
    hr_max_bpm: recorded ? input.hr!.max : null,
    hr_zone_seconds:
      recorded && input.hr!.zone_s ? [...input.hr!.zone_s] : null,
    discarded: input.hr !== null && !consent,
    recorded,
  };
}

/**
 * Writes the result of one run.
 *
 * `planned` is the planned run this result fulfils; `replaces` a saved
 * (completed) run it corrects. Never both.
 */
export function writeRunResult(
  ctx: ResultContext,
  input: RunResultInput,
  target: { planned?: RunPair; replaces?: RunPair },
): ResultOutcome {
  const { now, changes, warnings } = ctx;
  const hr = heartRate(input, ctx.consent);
  if (hr.discarded) warnings.push(NO_CONSENT_WARNING);
  if (input.elapsed_s === null)
    warnings.push(
      "Gesamtzeit nicht angegeben: die Timerzeit wird als Gesamtzeit gespeichert.",
    );
  const tech = { updated_at_utc: now };
  const resultFields = {
    timer_s: input.timer_s,
    elapsed_s: input.elapsed_s ?? input.timer_s,
    distance_m: input.distance_m,
    distance_source: input.distance_source,
    ascent_m: input.ascent_m,
    descent_m: input.descent_m,
    cadence_spm: input.cadence_spm,
    calories_kcal: input.calories_kcal,
    te_aerobic: input.te_aerobic ?? null,
    te_anaerobic: input.te_anaerobic ?? null,
    rpe: input.rpe,
    splits_100m: input.splits_100m ? [...input.splits_100m] : null,
    pause_count: input.pause_count ?? null,
    result_source: input.result_source,
    hr_status: hr.hr_status,
    hr_avg_bpm: hr.hr_avg_bpm,
    hr_max_bpm: hr.hr_max_bpm,
    hr_zone_seconds: hr.hr_zone_seconds,
  };
  const planned = target.planned;
  const inPlace =
    planned !== undefined && planned.workout.workout_date_local === input.date;
  let workout: ArnoldWorkout;
  let run: ArnoldRun;
  let replaced: string | null = null;

  if (inPlace) {
    workout = ArnoldWorkoutSchema.parse({
      ...planned.workout,
      client_session_id:
        input.client_session_id ?? planned.workout.client_session_id ?? null,
      started_at_utc: input.started_at_utc,
      ended_at_utc: input.ended_at_utc,
      status: "completed",
      notes: input.notes ?? planned.workout.notes,
      ...tech,
      row_revision: planned.workout.row_revision + 1,
    });
    run = ArnoldRunSchema.parse({
      ...planned.run,
      ...resultFields,
      ...tech,
      row_revision: planned.run.row_revision + 1,
    });
    changes.push({
      table: "workouts",
      before: planned.workout,
      after: workout,
    });
    changes.push({ table: "runs", before: planned.run, after: run });
  } else {
    const fresh = input.fresh;
    const prescription =
      planned?.run.prescription ?? fresh?.prescription ?? null;
    workout = ArnoldWorkoutSchema.parse({
      workout_id: ctx.id(),
      client_session_id: input.client_session_id ?? null,
      workout_date_local: input.date,
      timezone: input.timezone,
      started_at_utc: input.started_at_utc,
      ended_at_utc: input.ended_at_utc,
      plan_version_id:
        planned?.workout.plan_version_id ?? fresh?.plan_version_id ?? null,
      session_id: planned?.workout.session_id ?? fresh?.session_id ?? null,
      session_name_snapshot:
        planned?.workout.session_name_snapshot ??
        fresh?.name ??
        prescription?.n ??
        RUN_TYPE_NAMES[input.run_type],
      status: "completed",
      source: input.workout_source,
      notes: input.notes,
      created_at_utc: now,
      updated_at_utc: now,
      row_revision: 1,
      activity_type: "run",
    });
    run = ArnoldRunSchema.parse({
      workout_id: workout.workout_id,
      run_type: input.run_type,
      environment: input.environment,
      prescription,
      rationale: planned?.run.rationale ?? fresh?.rationale ?? null,
      rules_version: planned?.run.rules_version ?? fresh?.rules_version ?? null,
      ...resultFields,
      created_at_utc: now,
      updated_at_utc: now,
      row_revision: 1,
    });
    changes.push({ table: "workouts", before: null, after: workout });
    changes.push({ table: "runs", before: null, after: run });
    if (planned) {
      replaced = planned.workout.workout_id;
      changes.push({
        table: "workouts",
        before: planned.workout,
        after: ArnoldWorkoutSchema.parse({
          ...planned.workout,
          status: "cancelled",
          ...tech,
          row_revision: planned.workout.row_revision + 1,
        }),
      });
    }
    if (target.replaces) {
      replaced = target.replaces.workout.workout_id;
      changes.push({
        table: "workouts",
        before: target.replaces.workout,
        after: ArnoldWorkoutSchema.parse({
          ...target.replaces.workout,
          status: "voided",
          ...tech,
          row_revision: target.replaces.workout.row_revision + 1,
        }),
      });
    }
  }

  // Segments: always new rows of the (new or completed) run.
  input.segments.forEach((segment) => {
    const p = segment.planned;
    const withHr = hr.recorded && segment.hr !== null;
    changes.push({
      table: "runSegments",
      before: null,
      after: ArnoldRunSegmentSchema.parse({
        run_segment_id: ctx.id(),
        workout_id: workout.workout_id,
        segment_index: segment.segment_index,
        repetition: segment.repetition,
        kind: segment.kind,
        planned_duration_type: p?.duration_type ?? null,
        planned_duration_value: p?.duration_value ?? null,
        target_type: p?.target_type ?? null,
        target_low: p?.target_low ?? null,
        target_high: p?.target_high ?? null,
        timer_s: segment.timer_s,
        distance_m: segment.distance_m,
        time_in_target_s: segment.time_in_target_s,
        status: segment.status,
        hr_avg_bpm: withHr ? segment.hr![0] : null,
        hr_max_bpm: withHr ? segment.hr![1] : null,
        created_at_utc: now,
        updated_at_utc: now,
        row_revision: 1,
      }),
    });
  });

  return {
    workout,
    run,
    hr_discarded: hr.discarded,
    replaced_workout_id: replaced,
  };
}

/** Same day, same type, same time and distance as a completed run. */
export function findDuplicateRun(
  data: {
    readonly workouts: readonly ArnoldWorkout[];
    readonly runs: readonly ArnoldRun[];
  },
  input: Pick<RunResultInput, "date" | "run_type" | "timer_s" | "distance_m">,
  except: ReadonlySet<string>,
): ArnoldWorkout | undefined {
  return data.workouts.find((w) => {
    if (w.status !== "completed" || w.activity_type !== "run") return false;
    if (except.has(w.workout_id) || w.workout_date_local !== input.date)
      return false;
    const run = data.runs.find((r) => r.workout_id === w.workout_id);
    return (
      run?.run_type === input.run_type &&
      run.timer_s === input.timer_s &&
      run.distance_m === input.distance_m
    );
  });
}

export function requirePair(
  data: {
    readonly workouts: readonly ArnoldWorkout[];
    readonly runs: readonly ArnoldRun[];
  },
  workoutId: string,
): RunPair {
  const workout = data.workouts.find((w) => w.workout_id === workoutId);
  const run = data.runs.find((r) => r.workout_id === workoutId);
  if (!workout || workout.activity_type !== "run" || !run)
    throw new WriteError("WORKOUT_NOT_FOUND", "Lauf nicht gefunden.");
  return { workout, run };
}
