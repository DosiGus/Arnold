/**
 * The run service: profile, planning and results of single runs.
 *
 * Every write goes through `commitWrite` (request_id, revisions, audit and
 * receipt in one transaction); data is only reached through the user's store
 * (`Database.asUser`). Arnold decides what is prescribed: paces, zones,
 * durations and intensity come from the engine in src/analytics/running, never
 * from the caller. A value that is not known stays null with a reason.
 */
import { z } from "zod";
import {
  buildRunPrescription,
  referenceTempoZones,
  type RunPlan,
} from "../../analytics/running/index.js";
import {
  ArnoldRunProfileSchema,
  ArnoldRunSchema,
  ArnoldWorkoutSchema,
  type ArnoldDataset,
  type ArnoldRun,
  type ArnoldRunProfile,
  type ArnoldWorkout,
} from "../../shared/arnold-schema-v1.js";
import {
  RUN_WATCH_API_VERSION,
  RunWriteInputs,
  RunWriteResponseSchema,
  WatchRunDetailSchema,
  WatchRunRequestSchema,
  WatchRunResponseSchema,
  WatchRunRpeRequestSchema,
  WatchRunRpeResponseSchema,
  WatchRunsUpcomingSchema,
  type RunEnvironment,
  type RunType,
  type RunWriteOperation,
  type RunWriteResponse,
  type RunWriteResult,
  type WatchRunDetail,
  type WatchRunRequest,
  type WatchRunsUpcoming,
} from "../../shared/run-contract.js";
import { WATCH_MIN_APP_VERSION } from "../../shared/watch-contract.js";
import type { WriteResult } from "../../shared/workout-contract.js";
import { recoveryFor } from "../../shared/write-recovery.js";
import { STORAGE_RETRY_MESSAGE, commitWrite } from "../plan/commit.js";
import {
  WriteError,
  canonical,
  entityId,
  fingerprint,
  uuid7,
  type Actor,
  type AuditEvent,
  type EntityChange,
} from "../workout/infrastructure.js";
import {
  WorkoutLoggingService,
  type LoggingOptions,
} from "../workout/service.js";
import { watchEntry, watchSegments } from "./watch.js";
import {
  experienceOf,
  localDay,
  plannedTotals,
  profileView,
  referenceOf,
  runView,
} from "./views.js";
import {
  findDuplicateRun,
  requirePair,
  writeRunResult,
  type ResultSegment,
  type RunPair,
} from "./result.js";

export interface RunServiceOptions extends LoggingOptions {
  /**
   * Whether the user gave the health consent. Absent means no: heart rate is
   * then never stored (fail closed, D-RUN-07).
   */
  healthConsent?: (actor: Actor) => Promise<boolean>;
}

const OPERATION_LABEL: Record<RunWriteOperation, string> = {
  update_run_profile: "Laufprofil",
  plan_run: "Lauf geplant",
  update_planned_run: "Geplanten Lauf geändert",
  cancel_planned_run: "Geplanten Lauf abgesagt",
  log_run: "Lauf gespeichert",
  rate_run: "Anstrengung gespeichert",
};
export { OPERATION_LABEL as RUN_OPERATION_LABEL };

const AUDITED_FIELDS = [
  "status",
  "run_type",
  "environment",
  "rpe",
  "hr_status",
  "result_source",
  "goal",
  "runs_per_week",
  "preferred_environment",
] as const;

const DAY_MS = 86_400_000;
const addDays = (day: string, days: number) =>
  new Date(Date.parse(`${day}T00:00:00Z`) + days * DAY_MS)
    .toISOString()
    .slice(0, 10);
const MAX_DAYS_AHEAD = 366;

export type WatchRunResponse = z.infer<typeof WatchRunResponseSchema>;
export type WatchRunRpeResponse = z.infer<typeof WatchRunRpeResponseSchema>;
type WatchOperation = "save_watch_run" | "set_watch_rpe";

/** The answer of a watch function: the value or the error the route maps. */
export type WatchOutcome<T> =
  | { ok: true; value: T }
  | {
      ok: false;
      error: {
        code: string;
        message: string;
        retryable: boolean;
        details: string[];
        recovery: string;
      };
    };

const emptyResult = (): WriteResult => ({
  workout: null,
  sets: [],
  exercise: null,
  warnings: [],
});

/** One audit event per changed row; values and status only. */
function auditEvents(
  operation: RunWriteOperation | WatchOperation,
  requestId: string,
  changes: readonly EntityChange[],
  actor: Actor,
  now: string,
): AuditEvent[] {
  const out: AuditEvent[] = [];
  const value = (row: object | null, key: string) =>
    row ? (row as Record<string, unknown>)[key] : undefined;
  for (const c of changes) {
    let event_type: AuditEvent["event_type"];
    if (c.table === "workouts") {
      if (!c.before)
        event_type =
          c.after.status === "planned" ? "WORKOUT_CREATED" : "WORKOUT_LOGGED";
      else if (c.before.status === c.after.status)
        continue; // the run row of the same entity carries RUN_UPDATED
      else
        event_type =
          c.after.status === "completed"
            ? "WORKOUT_COMPLETED"
            : c.after.status === "cancelled"
              ? "WORKOUT_CANCELLED"
              : "WORKOUT_VOIDED";
    } else if (c.table === "runs")
      event_type = c.before ? "RUN_UPDATED" : "RUN_CREATED";
    else if (c.table === "runSegments") event_type = "RUN_SEGMENT_CREATED";
    else if (c.table === "runProfiles") event_type = "RUN_PROFILE_UPDATED";
    else throw new Error(`Unexpected table ${c.table} in ${operation}`);
    out.push({
      operation_id: requestId,
      event_type,
      entity_id: entityId(c.after),
      at: now,
      actor: actor.subject,
      previous_revision: c.before?.row_revision ?? null,
      new_revision: c.after.row_revision,
      result: "verified",
      changed_fields: Object.keys(c.after).filter(
        (key) =>
          !c.before ||
          canonical(value(c.after, key)) !== canonical(value(c.before, key)),
      ),
      correction_reason: null,
      changes: Object.fromEntries(
        AUDITED_FIELDS.filter(
          (field) =>
            field in c.after &&
            (!c.before ||
              canonical(value(c.after, field)) !==
                canonical(value(c.before, field))),
        ).map((field) => [
          field,
          {
            before: c.before ? value(c.before, field) : null,
            after: value(c.after, field),
          },
        ]),
      ),
    });
  }
  return out;
}

export class RunService {
  readonly mode: LoggingOptions["mode"];
  private readonly logging: WorkoutLoggingService;

  constructor(readonly options: RunServiceOptions) {
    this.mode = options.mode;
    this.logging = new WorkoutLoggingService(options);
  }

  /**
   * The user's complete data (runs included) for the read tools. The shared
   * data source shows strength training only, so runs are read from the store
   * after the same caller check as a write.
   */
  async dataset(context: unknown): Promise<ArnoldDataset> {
    await this.actor(context);
    return this.options.store.read();
  }

  /** The verified caller; the same checks as the workout tools. */
  actor(context: unknown, permission?: "write" | "correct_completed") {
    return this.logging.actor(context, permission);
  }

  protected id() {
    return this.options.id?.() ?? uuid7();
  }

  protected clock() {
    return this.options.clock ?? (() => new Date());
  }

  /** The health consent, read just before the write; any failure is "no". */
  protected async consent(actor: Actor) {
    try {
      return (await this.options.healthConsent?.(actor)) === true;
    } catch {
      return false;
    }
  }

  async execute(
    operation: RunWriteOperation,
    raw: unknown,
    context?: unknown,
  ): Promise<RunWriteResponse> {
    const requestId =
      raw &&
      typeof raw === "object" &&
      "request_id" in raw &&
      typeof raw.request_id === "string"
        ? raw.request_id
        : "";
    try {
      const actor = await this.actor(context);
      const input = RunWriteInputs[operation].parse(raw) as {
        request_id: string;
      };
      const outcome = await commitWrite<WriteResult>({
        trackerId: this.options.trackerId,
        store: this.options.store,
        requestId: input.request_id,
        fingerprint: fingerprint({ operation, input }),
        actorSubject: actor.subject,
        clock: this.clock(),
        build: async (dataset, now) => {
          const built = await this.build(
            operation,
            raw,
            dataset,
            actor,
            context,
            now,
          );
          return {
            ...built,
            audit: auditEvents(
              operation,
              input.request_id,
              built.changes,
              actor,
              now,
            ),
          };
        },
      });
      const data = await this.options.store.read();
      return RunWriteResponseSchema.parse({
        ok: true,
        operation,
        request_id: input.request_id,
        replayed: outcome.replayed,
        result: this.assemble(operation, input, outcome.result, data),
        error: null,
      });
    } catch (error) {
      return failure(operation, requestId, error);
    }
  }

  /** The tool answer, put together from the receipt and the stored rows. */
  private assemble(
    operation: RunWriteOperation,
    input: object,
    result: WriteResult,
    data: ArnoldDataset,
  ): RunWriteResult {
    const profileRow = data.runProfiles[0] ?? null;
    const profile = profileRow ? profileView(profileRow) : null;
    const workout = result.workout
      ? (data.workouts.find(
          (w) => w.workout_id === result.workout!.workout_id,
        ) ?? result.workout)
      : null;
    const run = workout
      ? data.runs.find((r) => r.workout_id === workout.workout_id)
      : undefined;
    const raw = input as Record<string, unknown>;
    const earlier =
      operation === "update_planned_run"
        ? (raw.workout_id as string)
        : operation === "log_run"
          ? ((raw.planned_workout_id ?? raw.replaces_workout_id) as
              string | undefined)
          : undefined;
    return {
      profile,
      run:
        workout && run
          ? runView(
              workout,
              run,
              data.runSegments.filter(
                (s) => s.workout_id === workout.workout_id,
              ),
            )
          : null,
      replaced_workout_id:
        workout && earlier && earlier !== workout.workout_id ? earlier : null,
      rationale: run?.rationale ? run.rationale.split("\n") : [],
      warnings: result.warnings,
      hr_discarded:
        operation === "log_run" &&
        raw.hr_avg_bpm !== undefined &&
        !!run &&
        run.hr_status !== "recorded",
    };
  }

  private async build(
    operation: RunWriteOperation,
    raw: unknown,
    data: ArnoldDataset,
    actor: Actor,
    context: unknown,
    now: string,
  ): Promise<{ changes: EntityChange[]; result: WriteResult }> {
    const changes: EntityChange[] = [];
    const result = emptyResult();
    switch (operation) {
      case "update_run_profile":
        this.updateProfile(raw, data, now, changes);
        break;
      case "plan_run":
        result.workout = this.planRun(raw, data, now, changes, result);
        break;
      case "update_planned_run":
        result.workout = this.updatePlanned(raw, data, now, changes, result);
        break;
      case "cancel_planned_run":
        result.workout = this.cancelPlanned(raw, data, now, changes);
        break;
      case "log_run":
        result.workout = await this.logRun(
          raw,
          data,
          actor,
          context,
          now,
          changes,
          result,
        );
        break;
      case "rate_run":
        result.workout = await this.rateRun(raw, data, context, now, changes);
        break;
    }
    return { changes, result };
  }

  /* ----------------------------------------------------------- profile */

  private updateProfile(
    raw: unknown,
    data: ArnoldDataset,
    now: string,
    changes: EntityChange[],
  ) {
    const input = RunWriteInputs.update_run_profile.parse(raw);
    const before = data.runProfiles[0] ?? null;
    if (before) {
      if (input.expected_row_revision === undefined)
        throw new WriteError(
          "VALIDATION_ERROR",
          "Es gibt schon ein Laufprofil: expected_row_revision aus get_run_profile angeben.",
        );
      revision(before, input.expected_row_revision);
    } else if (input.expected_row_revision !== undefined)
      throw new WriteError(
        "VALIDATION_ERROR",
        "Es gibt noch kein Laufprofil; expected_row_revision weglassen.",
      );
    const base: ArnoldRunProfile = before ?? {
      run_profile_id: this.id(),
      goal: "fitness",
      race_date: null,
      target_time_s: null,
      reference_distance_m: null,
      reference_time_s: null,
      reference_date: null,
      reference_source: null,
      running_experience_months: null,
      runs_per_week: 3,
      long_run_weekday: null,
      preferred_environment: "outdoor",
      base_minutes_per_week: null,
      longest_run_4w_min: null,
      alarm_settings: null,
      created_at_utc: now,
      updated_at_utc: now,
      row_revision: 0,
    };
    const set = <K extends keyof ArnoldRunProfile>(
      key: K,
      value: ArnoldRunProfile[K] | undefined,
    ): Partial<ArnoldRunProfile> =>
      value === undefined ? {} : { [key]: value };
    const reference =
      input.reference === undefined
        ? {}
        : input.reference === null
          ? {
              reference_distance_m: null,
              reference_time_s: null,
              reference_date: null,
              reference_source: null,
            }
          : {
              reference_distance_m: input.reference.distance_m,
              reference_time_s: input.reference.time_s,
              reference_date: input.reference.date,
              reference_source: input.reference.source,
            };
    const after = ArnoldRunProfileSchema.parse({
      ...base,
      ...set("goal", input.goal),
      ...set("race_date", input.race_date),
      ...set("target_time_s", input.target_time_s),
      ...reference,
      ...set("running_experience_months", input.running_experience_months),
      ...set("runs_per_week", input.runs_per_week),
      ...set("long_run_weekday", input.long_run_weekday),
      ...set("preferred_environment", input.preferred_environment),
      ...set("base_minutes_per_week", input.base_minutes_per_week),
      ...set("longest_run_4w_min", input.longest_run_4w_min),
      ...set("alarm_settings", input.alarm_settings),
      updated_at_utc: now,
      row_revision: base.row_revision + 1,
    });
    changes.push({ table: "runProfiles", before, after });
  }

  /* ------------------------------------------------------ prescription */

  /**
   * Arnold's prescription for what the user asked for. The caller only chose
   * type, environment and length; paces, zones and intensity are the engine's.
   */
  private prescribe(
    data: ArnoldDataset,
    want: {
      run_type: RunType;
      environment?: RunEnvironment;
      minutes?: number;
      meters?: number;
      fast_finish?: boolean;
      level?: number;
    },
    today: string,
    warnings: string[],
  ): { plan: Extract<RunPlan, { ok: true }>; environment: RunEnvironment } {
    const profile = data.runProfiles[0] ?? null;
    if (!profile)
      warnings.push(
        "Noch kein Laufprofil: Arnold plant vorsichtig als Einsteiger und ohne Tempovorgaben. Das Laufprofil (Erfahrung, Referenzleistung) mit update_run_profile ergänzen.",
      );
    const environment =
      want.environment ?? profile?.preferred_environment ?? "outdoor";
    const zones = referenceTempoZones(referenceOf(profile), today);
    const plan = buildRunPrescription({
      run_type: want.run_type,
      environment,
      experience: experienceOf(profile),
      minutes: want.minutes ?? null,
      meters: want.meters ?? null,
      level: want.level ?? 0,
      paces: zones.value,
      pace_reason: zones.reason,
      hr_zones: null,
      fast_finish: want.fast_finish,
      alarms: profile?.alarm_settings
        ? { hr: profile.alarm_settings.hr, pace: profile.alarm_settings.pace }
        : null,
    });
    if (!plan.ok) throw new WriteError("VALIDATION_ERROR", plan.message);
    for (const a of plan.adjustments) warnings.push(a.reason);
    for (const n of plan.notes) warnings.push(n.text);
    return { plan, environment };
  }

  private plannedRow(
    id: string,
    plan: Extract<RunPlan, { ok: true }>,
    environment: RunEnvironment,
    run_type: RunType,
    now: string,
  ): ArnoldRun {
    return ArnoldRunSchema.parse({
      workout_id: id,
      run_type,
      environment,
      prescription: plan.prescription,
      rationale: plan.rationale.join("\n"),
      rules_version: plan.rules_version,
      timer_s: null,
      elapsed_s: null,
      distance_m: null,
      distance_source: null,
      ascent_m: null,
      descent_m: null,
      cadence_spm: null,
      calories_kcal: null,
      te_aerobic: null,
      te_anaerobic: null,
      rpe: null,
      splits_100m: null,
      pause_count: null,
      result_source: null,
      hr_status: null,
      hr_avg_bpm: null,
      hr_max_bpm: null,
      hr_zone_seconds: null,
      created_at_utc: now,
      updated_at_utc: now,
      row_revision: 1,
    });
  }

  private plannedWorkout(
    plan: Extract<RunPlan, { ok: true }>,
    date: string,
    timezone: string,
    now: string,
  ): ArnoldWorkout {
    return ArnoldWorkoutSchema.parse({
      workout_id: this.id(),
      client_session_id: null,
      workout_date_local: date,
      timezone,
      started_at_utc: null,
      ended_at_utc: null,
      plan_version_id: null,
      session_id: null,
      session_name_snapshot: plan.prescription.n,
      status: "planned",
      source: "chat",
      notes: null,
      created_at_utc: now,
      updated_at_utc: now,
      row_revision: 1,
      activity_type: "run",
    });
  }

  private planRun(
    raw: unknown,
    data: ArnoldDataset,
    now: string,
    changes: EntityChange[],
    result: WriteResult,
  ) {
    const input = RunWriteInputs.plan_run.parse(raw);
    const today = localDay(now, input.timezone);
    const date = input.workout_date_local ?? today;
    if (date < today)
      throw new WriteError(
        "VALIDATION_ERROR",
        `Das Datum ${date} liegt in der Vergangenheit (heute ist ${today}). Einen schon gelaufenen Lauf mit log_run eintragen. Es wurde nichts gespeichert.`,
      );
    if (date > addDays(today, MAX_DAYS_AHEAD))
      throw new WriteError(
        "VALIDATION_ERROR",
        `Das Datum ${date} liegt mehr als ein Jahr voraus. Den Nutzer nach dem richtigen Datum fragen.`,
      );
    const same = data.workouts.find(
      (w) =>
        w.activity_type === "run" &&
        w.status === "planned" &&
        w.workout_date_local === date &&
        data.runs.find((r) => r.workout_id === w.workout_id)?.run_type ===
          input.run_type,
    );
    if (same && !input.confirm_duplicate)
      throw new WriteError(
        "DUPLICATE_WORKOUT",
        `Für ${date} ist schon ein Lauf dieser Art geplant. Den Nutzer fragen, ob ein zweiter gewollt ist; nur nach ausdrücklichem Ja mit confirm_duplicate: true erneut senden. Es wurde nichts gespeichert.`,
        false,
        [same.workout_id],
      );
    const { plan, environment } = this.prescribe(
      data,
      input,
      today,
      result.warnings,
    );
    const workout = this.plannedWorkout(plan, date, input.timezone, now);
    changes.push({ table: "workouts", before: null, after: workout });
    changes.push({
      table: "runs",
      before: null,
      after: this.plannedRow(
        workout.workout_id,
        plan,
        environment,
        input.run_type,
        now,
      ),
    });
    return workout;
  }

  private updatePlanned(
    raw: unknown,
    data: ArnoldDataset,
    now: string,
    changes: EntityChange[],
    result: WriteResult,
  ) {
    const input = RunWriteInputs.update_planned_run.parse(raw);
    const before = requirePair(data, input.workout_id);
    revision(before.workout, input.expected_row_revision);
    if (before.workout.status !== "planned")
      throw new WriteError(
        "INVALID_STATUS_TRANSITION",
        "Nur ein geplanter Lauf kann geändert werden. Ein gelaufener wird mit log_run (replaces_workout_id) korrigiert.",
      );
    const timezone = input.timezone ?? before.workout.timezone;
    const today = localDay(now, timezone);
    const date = input.workout_date_local ?? before.workout.workout_date_local;
    if (date < today && input.workout_date_local !== undefined)
      throw new WriteError(
        "VALIDATION_ERROR",
        `Das Datum ${date} liegt in der Vergangenheit (heute ist ${today}). Es wurde nichts geändert.`,
      );
    if (date > addDays(today, MAX_DAYS_AHEAD))
      throw new WriteError(
        "VALIDATION_ERROR",
        `Das Datum ${date} liegt mehr als ein Jahr voraus.`,
      );
    const rebuild =
      input.run_type !== undefined ||
      (input.environment !== undefined &&
        input.environment !== before.run.environment);
    let plan: Extract<RunPlan, { ok: true }> | null = null;
    let environment = input.environment ?? before.run.environment;
    let runType = input.run_type ?? before.run.run_type;
    if (rebuild) {
      let length = { minutes: input.minutes, meters: input.meters };
      if (length.minutes === undefined && length.meters === undefined) {
        // Only the environment changes: keep the planned length.
        const totals = before.run.prescription
          ? plannedTotals(before.run.prescription)
          : { total_s: null, distance_m: null };
        if (totals.total_s !== null)
          length = {
            minutes: Math.round(totals.total_s / 60),
            meters: undefined,
          };
        else if (totals.distance_m !== null)
          length = { minutes: undefined, meters: totals.distance_m };
        else
          throw new WriteError(
            "VALIDATION_ERROR",
            "Dieser Lauf hat keine feste Länge: für die Änderung minutes oder meters angeben.",
          );
      }
      ({ plan, environment } = this.prescribe(
        data,
        {
          run_type: runType,
          environment,
          ...length,
          fast_finish: input.fast_finish,
        },
        today,
        result.warnings,
      ));
    }
    const prescription = plan?.prescription ?? before.run.prescription;
    const samePlace =
      date === before.workout.workout_date_local &&
      (prescription?.n ?? before.workout.session_name_snapshot) ===
        before.workout.session_name_snapshot;
    const runFields = plan
      ? {
          run_type: runType,
          environment,
          prescription: plan.prescription,
          rationale: plan.rationale.join("\n"),
          rules_version: plan.rules_version,
        }
      : { environment };
    if (samePlace) {
      const workout = ArnoldWorkoutSchema.parse({
        ...before.workout,
        updated_at_utc: now,
        row_revision: before.workout.row_revision + 1,
      });
      changes.push({
        table: "workouts",
        before: before.workout,
        after: workout,
      });
      changes.push({
        table: "runs",
        before: before.run,
        after: ArnoldRunSchema.parse({
          ...before.run,
          ...runFields,
          updated_at_utc: now,
          row_revision: before.run.row_revision + 1,
        }),
      });
      return workout;
    }
    // Date or name moved: stable columns, so a new planned run replaces it.
    const workout = ArnoldWorkoutSchema.parse({
      ...before.workout,
      workout_id: this.id(),
      workout_date_local: date,
      timezone,
      session_name_snapshot:
        prescription?.n ?? before.workout.session_name_snapshot,
      created_at_utc: now,
      updated_at_utc: now,
      row_revision: 1,
    });
    changes.push({ table: "workouts", before: null, after: workout });
    changes.push({
      table: "runs",
      before: null,
      after: ArnoldRunSchema.parse({
        ...before.run,
        ...runFields,
        workout_id: workout.workout_id,
        created_at_utc: now,
        updated_at_utc: now,
        row_revision: 1,
      }),
    });
    changes.push({
      table: "workouts",
      before: before.workout,
      after: ArnoldWorkoutSchema.parse({
        ...before.workout,
        status: "cancelled",
        updated_at_utc: now,
        row_revision: before.workout.row_revision + 1,
      }),
    });
    return workout;
  }

  private cancelPlanned(
    raw: unknown,
    data: ArnoldDataset,
    now: string,
    changes: EntityChange[],
  ) {
    const input = RunWriteInputs.cancel_planned_run.parse(raw);
    const before = requirePair(data, input.workout_id);
    revision(before.workout, input.expected_row_revision);
    if (before.workout.status !== "planned")
      throw new WriteError(
        "INVALID_STATUS_TRANSITION",
        "Nur ein geplanter Lauf kann abgesagt werden. Ein gespeicherter Lauf wird mit void_workout zurückgenommen.",
      );
    const after = ArnoldWorkoutSchema.parse({
      ...before.workout,
      status: "cancelled",
      notes: input.reason ?? before.workout.notes,
      updated_at_utc: now,
      row_revision: before.workout.row_revision + 1,
    });
    changes.push({ table: "workouts", before: before.workout, after });
    return after;
  }

  /* ----------------------------------------------------------- results */

  private async logRun(
    raw: unknown,
    data: ArnoldDataset,
    actor: Actor,
    context: unknown,
    now: string,
    changes: EntityChange[],
    result: WriteResult,
  ) {
    const input = RunWriteInputs.log_run.parse(raw);
    const today = localDay(now, input.timezone);
    if (input.workout_date_local > today)
      throw new WriteError(
        "DATE_IN_FUTURE",
        `Das Datum ${input.workout_date_local} liegt in der Zukunft (heute ist ${today}). Es wurde nichts gespeichert. Den Nutzer nach dem richtigen Datum fragen; für einen künftigen Lauf plan_run verwenden.`,
      );
    if (
      input.started_at_utc &&
      Date.parse(input.started_at_utc) > Date.parse(now)
    )
      throw new WriteError(
        "DATE_IN_FUTURE",
        "Der Beginn des Laufs liegt in der Zukunft. Es wurde nichts gespeichert.",
      );
    let planned: RunPair | undefined;
    let replaces: RunPair | undefined;
    if (input.planned_workout_id) {
      planned = requirePair(data, input.planned_workout_id);
      if (input.expected_row_revision !== undefined)
        revision(planned.workout, input.expected_row_revision);
      if (planned.workout.status !== "planned")
        throw new WriteError(
          "INVALID_STATUS_TRANSITION",
          "Dieser Lauf ist nicht mehr geplant (schon gelaufen oder abgesagt). Es wurde nichts gespeichert.",
        );
    }
    if (input.replaces_workout_id) {
      replaces = requirePair(data, input.replaces_workout_id);
      revision(replaces.workout, input.expected_row_revision!);
      if (replaces.workout.status !== "completed")
        throw new WriteError(
          "INVALID_STATUS_TRANSITION",
          "Nur ein gespeicherter (abgeschlossener) Lauf kann ersetzt werden.",
        );
      await this.actor(context, "correct_completed");
    }
    const basis = planned ?? replaces;
    const runType = input.run_type ?? basis?.run.run_type ?? "free";
    if (planned && runType !== planned.run.run_type)
      throw new WriteError(
        "VALIDATION_ERROR",
        `Der geplante Lauf ist vom Typ ${planned.run.run_type}; run_type weglassen oder ohne planned_workout_id speichern.`,
      );
    const environment = input.environment ?? basis?.run.environment;
    if (!environment)
      throw new WriteError(
        "VALIDATION_ERROR",
        "Wo wurde gelaufen (environment: outdoor, treadmill oder track)? Den Nutzer fragen; nichts raten.",
        false,
        ["environment"],
      );
    if (planned && input.environment && input.environment !== environment)
      throw new WriteError("VALIDATION_ERROR", "Umgebung weicht vom Plan ab.");
    const except = new Set(
      [planned, replaces].flatMap((p) => (p ? [p.workout.workout_id] : [])),
    );
    const duplicate = findDuplicateRun(
      data,
      {
        date: input.workout_date_local,
        run_type: runType,
        timer_s: input.timer_s,
        distance_m: input.distance_m,
      },
      except,
    );
    if (duplicate && !input.confirm_duplicate)
      throw new WriteError(
        "DUPLICATE_WORKOUT",
        "Ein gleicher Lauf (Tag, Art, Zeit, Distanz) ist schon gespeichert. Den Nutzer fragen, ob ersetzen (replaces_workout_id mit expected_row_revision), zusätzlich speichern (confirm_duplicate: true) oder nichts. Es wurde nichts gespeichert.",
        false,
        [duplicate.workout_id],
      );
    const laps = input.laps ?? [];
    if (laps.reduce((s, l) => s + l.timer_s, 0) > input.timer_s + 60)
      throw new WriteError(
        "VALIDATION_ERROR",
        "Die Runden sind zusammen länger als die Gesamtzeit.",
      );
    const segments: ResultSegment[] = laps.map((lap, i) => ({
      segment_index: i,
      repetition: null,
      kind: "lap",
      planned: null,
      timer_s: lap.timer_s,
      distance_m: lap.distance_m,
      time_in_target_s: null,
      status: "completed",
      hr: null,
    }));
    const startedMs = input.started_at_utc
      ? Date.parse(input.started_at_utc)
      : null;
    const outcome = writeRunResult(
      {
        now,
        id: () => this.id(),
        consent: await this.consent(actor),
        changes,
        warnings: result.warnings,
      },
      {
        date: input.workout_date_local,
        timezone: input.timezone,
        run_type: runType,
        environment,
        result_source: input.source ?? "chat",
        timer_s: input.timer_s,
        elapsed_s: input.elapsed_s ?? null,
        distance_m: input.distance_m,
        distance_source: input.distance_source ?? "manual",
        started_at_utc: input.started_at_utc ?? null,
        ended_at_utc:
          startedMs === null
            ? null
            : new Date(
                startedMs + (input.elapsed_s ?? input.timer_s) * 1000,
              ).toISOString(),
        ascent_m: input.ascent_m ?? null,
        descent_m: input.descent_m ?? null,
        cadence_spm: input.cadence_spm ?? null,
        calories_kcal: input.calories_kcal ?? null,
        rpe: input.rpe ?? null,
        hr:
          input.hr_avg_bpm !== undefined && input.hr_max_bpm !== undefined
            ? { avg: input.hr_avg_bpm, max: input.hr_max_bpm, zone_s: null }
            : null,
        segments,
        notes: input.notes ?? null,
        workout_source: "chat",
      },
      { planned, replaces },
    );
    return outcome.workout;
  }

  /* ------------------------------------------------------------- watch */

  /**
   * `GET /runs/upcoming`: planned runs today and the next six days (dated,
   * ascending) and the next run session of the active plan. The route is
   * RUN-009; this only reads the caller's own data.
   */
  async upcoming(
    context: unknown,
    timezone: string,
    now: Date = this.clock()(),
  ): Promise<WatchRunsUpcoming> {
    const actor = await this.actor(context);
    const data = await this.options.store.read();
    const today = localDay(now.toISOString(), timezone);
    const last = addDays(today, 6);
    const runs = data.workouts
      .filter(
        (w) =>
          w.activity_type === "run" &&
          w.status === "planned" &&
          w.workout_date_local >= today &&
          w.workout_date_local <= last,
      )
      .sort(
        (a, b) =>
          a.workout_date_local.localeCompare(b.workout_date_local) ||
          a.created_at_utc.localeCompare(b.created_at_utc),
      )
      .flatMap((w) => {
        const prescription = data.runs.find(
          (r) => r.workout_id === w.workout_id,
        )?.prescription;
        return prescription
          ? [watchEntry(w.workout_id, w.workout_date_local, prescription)]
          : [];
      })
      .slice(0, 7);
    const session = this.nextPlanSession(data);
    const plan = session
      ? this.sessionPrescription(data, session, today)
      : null;
    return WatchRunsUpcomingSchema.parse({
      api_version: RUN_WATCH_API_VERSION,
      min_app_version: WATCH_MIN_APP_VERSION,
      d: today,
      hc: await this.consent(actor),
      runs,
      next:
        session && plan
          ? watchEntry(
              session.plan_run_session_id,
              undefined,
              plan.prescription,
            )
          : null,
    });
  }

  /**
   * `GET /runs/:id`: the stored prescription of a planned run, or the one
   * the engine builds for a run session of the plan. Null when the id is not
   * one of the caller's (a stranger's id looks like a missing one).
   */
  async detail(
    context: unknown,
    id: string,
    timezone: string,
    now: Date = this.clock()(),
  ): Promise<WatchRunDetail | null> {
    await this.actor(context);
    const data = await this.options.store.read();
    const planned = data.workouts.find(
      (w) =>
        w.workout_id === id &&
        w.activity_type === "run" &&
        w.status === "planned",
    );
    let prescription =
      (planned &&
        data.runs.find((r) => r.workout_id === planned.workout_id)
          ?.prescription) ||
      null;
    if (!prescription) {
      const session = data.planRunSessions.find(
        (s) => s.plan_run_session_id === id && s.status === "active",
      );
      prescription = session
        ? (this.sessionPrescription(
            data,
            session,
            localDay(now.toISOString(), timezone),
          )?.prescription ?? null)
        : null;
    }
    return prescription
      ? WatchRunDetailSchema.parse({
          api_version: RUN_WATCH_API_VERSION,
          min_app_version: WATCH_MIN_APP_VERSION,
          id,
          p: prescription,
        })
      : null;
  }

  /**
   * The run session after the last one done in the active plan (the first if
   * none was done yet); null without an active plan with run sessions.
   */
  private nextPlanSession(data: ArnoldDataset) {
    const plan = [...data.plans]
      .filter((p) => p.status === "active" && p.activated_at_utc !== null)
      .sort((a, b) =>
        b.activated_at_utc!.localeCompare(a.activated_at_utc!),
      )[0];
    if (!plan) return null;
    const sessions = data.planRunSessions
      .filter(
        (s) =>
          s.plan_version_id === plan.plan_version_id && s.status === "active",
      )
      .sort((a, b) => a.session_order - b.session_order);
    if (!sessions.length) return null;
    const lastDone = data.workouts
      .filter(
        (w) =>
          w.activity_type === "run" &&
          w.status === "completed" &&
          w.plan_version_id === plan.plan_version_id &&
          sessions.some((s) => s.session_id === w.session_id),
      )
      .sort(
        (a, b) =>
          b.workout_date_local.localeCompare(a.workout_date_local) ||
          b.created_at_utc.localeCompare(a.created_at_utc),
      )[0];
    const at = lastDone
      ? sessions.findIndex((s) => s.session_id === lastDone.session_id)
      : -1;
    return sessions[(at + 1) % sessions.length]!;
  }

  /** The engine's prescription for a plan run session; null if it cannot be built. */
  private sessionPrescription(
    data: ArnoldDataset,
    session: ArnoldDataset["planRunSessions"][number],
    today: string,
  ) {
    const t = session.template;
    try {
      return this.prescribe(
        data,
        {
          run_type: session.run_type,
          environment: t.environment ?? undefined,
          ...(t.minutes
            ? { minutes: t.minutes[0] }
            : t.meters
              ? { meters: t.meters[0] }
              : {}),
          level: t.level,
        },
        today,
        [],
      ).plan;
    } catch {
      return null;
    }
  }

  /**
   * `POST /runs`: the result of one finished run from the watch. Same result
   * logic as log_run (a planned run is completed, heart rate is stored only
   * with the health consent and otherwise dropped and reported). request_id
   * makes a repeat harmless; the same session_uuid under a new request_id is
   * DUPLICATE_WORKOUT. `timezone` is the user's IANA zone (the watch only
   * knows its offset).
   */
  async saveWatchRun(
    raw: unknown,
    context: unknown,
    timezone: string,
  ): Promise<WatchOutcome<WatchRunResponse>> {
    try {
      const actor = await this.actor(context);
      const request = WatchRunRequestSchema.parse(raw);
      const outcome = await commitWrite<WriteResult>({
        trackerId: this.options.trackerId,
        store: this.options.store,
        requestId: request.request_id,
        fingerprint: fingerprint({ operation: "save_watch_run", request }),
        actorSubject: actor.subject,
        clock: this.clock(),
        build: async (data, now) => {
          const changes: EntityChange[] = [];
          const result = emptyResult();
          result.workout = await this.watchRun(
            request,
            data,
            actor,
            timezone,
            now,
            changes,
            result,
          );
          return {
            changes,
            result,
            audit: auditEvents(
              "save_watch_run",
              request.request_id,
              changes,
              actor,
              now,
            ),
          };
        },
      });
      const data = await this.options.store.read();
      const workoutId = outcome.result.workout!.workout_id;
      const run = data.runs.find((r) => r.workout_id === workoutId);
      return {
        ok: true,
        value: WatchRunResponseSchema.parse({
          api_version: RUN_WATCH_API_VERSION,
          min_app_version: WATCH_MIN_APP_VERSION,
          workout_id: workoutId,
          replayed: outcome.replayed,
          hr_discarded:
            request.hr != null && !!run && run.hr_status !== "recorded",
        }),
      };
    } catch (error) {
      return { ok: false, error: errorBody(error) };
    }
  }

  private async watchRun(
    request: WatchRunRequest,
    data: ArnoldDataset,
    actor: Actor,
    timezone: string,
    now: string,
    changes: EntityChange[],
    result: WriteResult,
  ) {
    try {
      localDay(now, timezone);
    } catch {
      throw new WriteError("VALIDATION_ERROR", "Ungültige Zeitzone.");
    }
    const localToday = new Date(
      Date.parse(now) + request.utc_offset_min * 60_000,
    )
      .toISOString()
      .slice(0, 10);
    if (
      request.workout_date_local > localToday ||
      Date.parse(request.started_at_utc) > Date.parse(now) + 10 * 60_000
    )
      throw new WriteError(
        "DATE_IN_FUTURE",
        "Der Lauf liegt in der Zukunft. Es wurde nichts gespeichert.",
      );
    const known = data.workouts.find(
      (w) => w.client_session_id === request.session_uuid,
    );
    if (known)
      throw new WriteError(
        "DUPLICATE_WORKOUT",
        "Diese Aufzeichnung ist schon gespeichert.",
        false,
        [known.workout_id],
      );
    const run_type = request.run_type;
    let planned: RunPair | undefined;
    let fresh: Parameters<typeof writeRunResult>[1]["fresh"];
    if (request.planned_workout_id) {
      planned = requirePair(data, request.planned_workout_id);
      if (planned.workout.status !== "planned")
        throw new WriteError(
          "INVALID_STATUS_TRANSITION",
          "Dieser Lauf ist nicht mehr geplant (schon gelaufen oder abgesagt). Es wurde nichts gespeichert.",
        );
      if (planned.run.run_type !== run_type)
        throw new WriteError(
          "VALIDATION_ERROR",
          `Der geplante Lauf ist vom Typ ${planned.run.run_type}.`,
        );
      if (planned.run.environment !== request.environment)
        throw new WriteError(
          "VALIDATION_ERROR",
          "Umgebung weicht vom geplanten Lauf ab.",
        );
    } else if (request.plan_version_id) {
      const session = data.planRunSessions.find(
        (s) =>
          s.plan_version_id === request.plan_version_id &&
          s.session_id === request.session_id &&
          s.status === "active",
      );
      if (!session)
        throw new WriteError(
          "VALIDATION_ERROR",
          "Die Planeinheit gibt es nicht (mehr).",
        );
      if (session.run_type !== run_type)
        throw new WriteError(
          "VALIDATION_ERROR",
          `Die Planeinheit ist vom Typ ${session.run_type}.`,
        );
      const plan = this.sessionPrescription(data, session, localToday);
      fresh = {
        prescription: plan?.prescription ?? null,
        rationale: plan ? plan.rationale.join("\n") : null,
        rules_version: plan?.rules_version ?? null,
        plan_version_id: session.plan_version_id,
        session_id: session.session_id,
        name: session.session_name,
      };
    }
    const duplicate = findDuplicateRun(
      data,
      {
        date: request.workout_date_local,
        run_type,
        timer_s: request.timer_s,
        distance_m: request.distance_m,
      },
      new Set(planned ? [planned.workout.workout_id] : []),
    );
    if (duplicate && !request.confirm_duplicate)
      throw new WriteError(
        "DUPLICATE_WORKOUT",
        "Ein gleicher Lauf (Tag, Art, Zeit, Distanz) ist schon gespeichert.",
        false,
        [duplicate.workout_id],
      );
    const prescription =
      planned?.run.prescription ?? fresh?.prescription ?? null;
    return writeRunResult(
      {
        now,
        id: () => this.id(),
        consent: await this.consent(actor),
        changes,
        warnings: result.warnings,
      },
      {
        date: request.workout_date_local,
        timezone,
        run_type,
        environment: request.environment,
        result_source: "watch",
        timer_s: request.timer_s,
        elapsed_s: request.elapsed_s,
        distance_m: request.distance_m,
        distance_source: request.distance_source,
        started_at_utc: request.started_at_utc,
        ended_at_utc: request.ended_at_utc,
        ascent_m: request.ascent_m ?? null,
        descent_m: request.descent_m ?? null,
        cadence_spm: request.cadence_spm ?? null,
        calories_kcal: request.calories_kcal ?? null,
        te_aerobic: request.te_aerobic ?? null,
        te_anaerobic: request.te_anaerobic ?? null,
        pause_count: request.pauses,
        splits_100m: request.splits,
        rpe: request.rpe ?? null,
        hr: request.hr
          ? {
              avg: request.hr.avg,
              max: request.hr.max,
              zone_s: request.hr.zone_s,
            }
          : null,
        segments: watchSegments(request, prescription, result.warnings),
        notes: null,
        client_session_id: request.session_uuid,
        workout_source: "sync",
        fresh,
      },
      { planned },
    ).workout;
  }

  /**
   * `PATCH /runs/:session_uuid/rpe`: the effort, sent after the result. The
   * run is found by the session id of its upload; request_id makes a repeat
   * harmless.
   */
  async setWatchRpe(
    sessionUuid: string,
    raw: unknown,
    context: unknown,
  ): Promise<WatchOutcome<WatchRunRpeResponse>> {
    try {
      const actor = await this.actor(context);
      const request = WatchRunRpeRequestSchema.parse(raw);
      const outcome = await commitWrite<WriteResult>({
        trackerId: this.options.trackerId,
        store: this.options.store,
        requestId: request.request_id,
        fingerprint: fingerprint({
          operation: "set_watch_rpe",
          sessionUuid,
          request,
        }),
        actorSubject: actor.subject,
        clock: this.clock(),
        build: async (data, now) => {
          const changes: EntityChange[] = [];
          const result = emptyResult();
          const workout = data.workouts.find(
            (w) =>
              w.client_session_id === sessionUuid && w.activity_type === "run",
          );
          if (!workout)
            throw new WriteError("WORKOUT_NOT_FOUND", "Lauf nicht gefunden.");
          const before = requirePair(data, workout.workout_id);
          if (before.workout.status !== "completed")
            throw new WriteError(
              "INVALID_STATUS_TRANSITION",
              "Die Anstrengung gibt es nur für einen gespeicherten Lauf.",
            );
          if (before.run.rpe !== null && before.run.rpe !== request.rpe)
            await this.actor(context, "correct_completed");
          result.workout = this.applyRpe(before, request.rpe, now, changes);
          return {
            changes,
            result,
            audit: auditEvents(
              "set_watch_rpe",
              request.request_id,
              changes,
              actor,
              now,
            ),
          };
        },
      });
      return {
        ok: true,
        value: WatchRunRpeResponseSchema.parse({
          api_version: RUN_WATCH_API_VERSION,
          min_app_version: WATCH_MIN_APP_VERSION,
          workout_id: outcome.result.workout!.workout_id,
          rpe: request.rpe,
          replayed: outcome.replayed,
        }),
      };
    } catch (error) {
      return { ok: false, error: errorBody(error) };
    }
  }

  private async rateRun(
    raw: unknown,
    data: ArnoldDataset,
    context: unknown,
    now: string,
    changes: EntityChange[],
  ) {
    const input = RunWriteInputs.rate_run.parse(raw);
    const before = requirePair(data, input.workout_id);
    if (input.expected_row_revision !== undefined)
      revision(before.workout, input.expected_row_revision);
    if (before.workout.status !== "completed")
      throw new WriteError(
        "INVALID_STATUS_TRANSITION",
        "Die Anstrengung gibt es nur für einen gelaufenen, gespeicherten Lauf.",
      );
    if (before.run.rpe !== null && before.run.rpe !== input.rpe)
      await this.actor(context, "correct_completed");
    return this.applyRpe(before, input.rpe, now, changes);
  }

  /** The new rpe of a saved run: workout and run row both get a new revision. */
  private applyRpe(
    before: RunPair,
    rpe: number,
    now: string,
    changes: EntityChange[],
  ) {
    const workout = ArnoldWorkoutSchema.parse({
      ...before.workout,
      updated_at_utc: now,
      row_revision: before.workout.row_revision + 1,
    });
    changes.push({ table: "workouts", before: before.workout, after: workout });
    changes.push({
      table: "runs",
      before: before.run,
      after: ArnoldRunSchema.parse({
        ...before.run,
        rpe,
        updated_at_utc: now,
        row_revision: before.run.row_revision + 1,
      }),
    });
    return workout;
  }
}

function revision(row: { row_revision: number }, expected: number) {
  if (row.row_revision !== expected)
    throw new WriteError(
      "REVISION_CONFLICT",
      "Revision veraltet. Datensatz erneut laden.",
      false,
      [`current_revision=${row.row_revision}`],
    );
}

function errorBody(error: unknown) {
  const failed =
    error instanceof WriteError
      ? error
      : error instanceof z.ZodError
        ? new WriteError(
            "VALIDATION_ERROR",
            "Eingaben sind nicht eindeutig oder ungültig.",
            false,
            error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
          )
        : new WriteError("STORAGE_UNAVAILABLE", STORAGE_RETRY_MESSAGE, true);
  return {
    code: failed.code,
    message: failed.message,
    retryable: failed.retryable,
    details: failed.details,
    recovery: recoveryFor(failed.code, failed.retryable),
  };
}

function failure(
  operation: RunWriteOperation,
  requestId: string,
  error: unknown,
): RunWriteResponse {
  return {
    ok: false,
    operation,
    request_id: requestId,
    replayed: false,
    result: null,
    error: errorBody(error),
  } as RunWriteResponse;
}
