/**
 * The mobility service: profile, overview and the routines done (ARN-MOB).
 *
 * Every write goes through `commitWrite` (request_id, fingerprint, revisions,
 * audit and receipt in one transaction); data is only reached through the
 * user's store (`Database.asUser`). The user and tracker come from the
 * verified caller, never from an argument. Mobility is neither load nor a
 * training day: a routine is stored as a workout of the activity type
 * "mobility" plus its result row, and no analysis counts it.
 *
 * Dates are the user's local calendar days. The zone comes from the caller
 * (`timezone`), else from the user's last workout; without either the call is
 * refused rather than answered with a UTC day.
 */
import { z } from "zod";
import { MOBILITY_RULES_VERSION } from "../../analytics/mobility/timing.js";
import {
  ArnoldMobilityProfileSchema,
  ArnoldMobilityResultSchema,
  ArnoldWorkoutSchema,
  isMobilityWorkout,
  type ArnoldDataset,
  type ArnoldMobilityProfile,
  type ArnoldWorkout,
} from "../../shared/arnold-schema-v1.js";
import {
  MOBILITY_CATALOG_VERSION,
  MOBILITY_ERROR_CODES,
  MOBILITY_LIMITS,
  MobilityToolInputs,
  UpdateMobilityProfileResponseSchema,
  LogMobilityResponseSchema,
  WatchMobilityRequestSchema,
  WatchMobilityResponseSchema,
  type LogMobilityResponse,
  type MobilityKind,
  type MobilityOverview,
  type MobilityPreference,
  type MobilityProfileView,
  type MobilityResultItem,
  type MobilityTemplate,
  type UpdateMobilityProfileResponse,
  type WatchMobilityRequest,
  type WatchMobilityResponse,
} from "../../shared/mobility-contract.js";
import { RUN_WATCH_API_VERSION } from "../../shared/run-contract.js";
import { WATCH_MIN_APP_VERSION } from "../../shared/watch-contract.js";
import { WEEKDAYS } from "../../shared/weekdays.js";
import type { WriteResult } from "../../shared/workout-contract.js";
import { recoveryFor } from "../../shared/write-recovery.js";
import { STORAGE_RETRY_MESSAGE, commitWrite } from "../plan/commit.js";
import { trainingView } from "../plan/adjustment-rules.js";
import { isTimeZone, localDayOf } from "../reference-day.js";
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
import {
  mobilityAdherenceOf,
  mobilityDayInputsOf,
  mobilityDueToday,
} from "./day.js";

export type MobilityServiceOptions = LoggingOptions;

/** A refusal with a mobility code; the other codes come from `WriteError`. */
export class MobilityError extends Error {
  constructor(
    readonly code: (typeof MOBILITY_ERROR_CODES)[number],
    message: string,
    readonly retryable = false,
    readonly details: string[] = [],
  ) {
    super(message);
  }
}

/** The answer of a watch function: the value or the error the route maps. */
export type MobilityWatchOutcome =
  | { ok: true; value: WatchMobilityResponse }
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

const MOBILITY_CODES: ReadonlySet<string> = new Set(MOBILITY_ERROR_CODES);

/** The error as `{ code, message, retryable, details, recovery }`. */
export function mobilityErrorBody(error: unknown) {
  const failed =
    error instanceof MobilityError || error instanceof WriteError
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
    code: failed.code as string,
    message: failed.message,
    retryable: failed.retryable,
    details: failed.details,
    recovery: recoveryFor(failed.code, failed.retryable),
  };
}

/** The same, narrowed to the codes of the mobility tools. */
function toolError(error: unknown) {
  const body = mobilityErrorBody(error);
  return MOBILITY_CODES.has(body.code)
    ? (body as typeof body & { code: (typeof MOBILITY_ERROR_CODES)[number] })
    : {
        ...body,
        code: "VALIDATION_ERROR" as const,
        recovery: recoveryFor("VALIDATION_ERROR", false),
      };
}

const KIND_NAME: Record<MobilityKind, string> = {
  morning: "Morgenroutine",
  session: "Mobility",
};

/* ------------------------------------------------------------- the profile */

/** The profile as the tools show it; no row means the question was not asked. */
export function mobilityProfileView(
  row: ArnoldMobilityProfile | undefined,
): MobilityProfileView {
  if (!row) return { state: "not_asked", preference: null };
  const mat = row.has_mat === undefined ? {} : { has_mat: row.has_mat };
  if (!row.wants) return { state: "no", preference: { wants: false }, ...mat };
  return {
    ...mat,
    state: "yes",
    preference: {
      wants: true,
      morning:
        row.morning_weekdays && row.morning_minutes
          ? {
              weekdays: [...row.morning_weekdays]
                .sort((a, b) => a - b)
                .map((day) => WEEKDAYS[day - 1]!),
              minutes: row.morning_minutes,
            }
          : null,
      sessions:
        row.sessions_placement && row.sessions_per_week && row.sessions_minutes
          ? {
              placement: row.sessions_placement,
              per_week: row.sessions_per_week,
              minutes: row.sessions_minutes,
            }
          : null,
      stiff_areas: [...row.stiff_areas],
    },
  };
}

/** The stored columns for an answer ("no" keeps no details). */
function preferenceColumns(preference: MobilityPreference) {
  if (!preference.wants)
    return {
      wants: false,
      morning_weekdays: null,
      morning_minutes: null,
      sessions_placement: null,
      sessions_per_week: null,
      sessions_minutes: null,
      stiff_areas: [],
    } as const;
  return {
    wants: true,
    morning_weekdays: preference.morning
      ? [...preference.morning.weekdays]
          .map((day) => WEEKDAYS.indexOf(day) + 1)
          .sort((a, b) => a - b)
      : null,
    morning_minutes: preference.morning?.minutes ?? null,
    sessions_placement: preference.sessions?.placement ?? null,
    sessions_per_week: preference.sessions?.per_week ?? null,
    sessions_minutes: preference.sessions?.minutes ?? null,
    stiff_areas: [...preference.stiff_areas],
  } as const;
}

/* ------------------------------------------------------------------ audit */

/** Fields whose before/after values an audit event records (no free text). */
const AUDITED_FIELDS = [
  "wants",
  "has_mat",
  "morning_minutes",
  "sessions_placement",
  "sessions_per_week",
  "sessions_minutes",
  "status",
  "kind",
  "result_source",
  "ended_early",
  "exercises_total",
  "exercises_done",
  "exercises_skipped",
] as const;

type Operation =
  "update_mobility_profile" | "log_mobility" | "save_watch_mobility";

/** One audit event per changed row; values and status only. */
function auditEvents(
  requestId: string,
  changes: readonly EntityChange[],
  actor: Actor,
  now: string,
): AuditEvent[] {
  const value = (row: object | null, key: string) =>
    row ? (row as Record<string, unknown>)[key] : undefined;
  return changes.map((c) => {
    let event_type: AuditEvent["event_type"];
    if (c.table === "workouts") event_type = "WORKOUT_LOGGED";
    else if (c.table === "mobilityResults") event_type = "MOBILITY_LOGGED";
    else if (c.table === "mobilityProfiles")
      event_type = "MOBILITY_PROFILE_UPDATED";
    else throw new Error(`Unexpected table ${c.table} in a mobility write`);
    return {
      operation_id: requestId,
      event_type,
      entity_id: entityId(c.after),
      at: now,
      actor: actor.subject,
      previous_revision: c.before?.row_revision ?? null,
      new_revision: c.after.row_revision,
      result: "verified" as const,
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
    };
  });
}

/* ---------------------------------------------------------------- service */

/** The routine of the active plan a log refers to. */
type PlanRoutine = {
  plan_version_id: string;
  session_id: string;
  name: string;
  minutes: number;
  kind: MobilityKind;
  template: MobilityTemplate;
};

/** What a stored routine is made of. */
type ResultInput = {
  date: string;
  timezone: string;
  kind: MobilityKind;
  plan: PlanRoutine | null;
  result_source: "watch" | "chat";
  workout_source: "chat" | "sync";
  minutes_planned: number | null;
  timer_s: number | null;
  elapsed_s: number | null;
  total: number;
  done: number;
  skipped: number;
  ended_early: boolean;
  items: MobilityResultItem[];
  started_at_utc: string | null;
  ended_at_utc: string | null;
  client_session_id: string | null;
};

export class MobilityService {
  readonly mode: LoggingOptions["mode"];
  private readonly logging: WorkoutLoggingService;

  constructor(readonly options: MobilityServiceOptions) {
    this.mode = options.mode;
    this.logging = new WorkoutLoggingService(options);
  }

  /** The verified caller; the same checks as the workout tools. */
  actor(context: unknown, permission?: "write" | "correct_completed") {
    return this.logging.actor(context, permission);
  }

  /** The user's complete data, after the same caller check as a write. */
  async dataset(context: unknown): Promise<ArnoldDataset> {
    await this.actor(context);
    return this.options.store.read();
  }

  protected id() {
    return this.options.id?.() ?? uuid7();
  }

  protected clock() {
    return this.options.clock ?? (() => new Date());
  }

  /** The zone: the caller's, else that of the last workout; never UTC. */
  private zone(data: ArnoldDataset, explicit?: string): string {
    if (explicit !== undefined) {
      if (!isTimeZone(explicit))
        throw new MobilityError(
          "VALIDATION_ERROR",
          "Unbekannte Zeitzone (IANA, z. B. Europe/Berlin).",
        );
      return explicit;
    }
    const last = [...data.workouts]
      .sort((a, b) => b.created_at_utc.localeCompare(a.created_at_utc))
      .find((w) => isTimeZone(w.timezone));
    if (last) return last.timezone;
    throw new MobilityError(
      "VALIDATION_ERROR",
      "Die Zeitzone des Nutzers fehlt (timezone, IANA, z. B. Europe/Berlin). Es wurde nichts gespeichert; mit Zeitzone erneut aufrufen.",
      false,
      ["timezone"],
    );
  }

  /* ----------------------------------------------------------- overview */

  /**
   * `get_mobility_overview`: profile state, today's routines, "Dranbleiben"
   * and the last five routines. Reads only the caller's own data.
   */
  async getOverview(
    context: unknown,
    timezone?: string,
  ): Promise<MobilityOverview> {
    await this.actor(context);
    const data = await this.options.store.read();
    const now = this.clock()();
    const zone = this.zone(data, timezone);
    return this.overviewOf(data, localDayOf(now, zone), zone, now);
  }

  private overviewOf(
    data: ArnoldDataset,
    today: string,
    timezone: string,
    now: Date,
  ): MobilityOverview {
    const view = trainingView(data, now);
    const inputs = mobilityDayInputsOf(view);
    const results = new Map(
      (data.mobilityResults ?? []).map((r) => [r.workout_id, r]),
    );
    const recent = data.workouts
      .filter((w) => isMobilityWorkout(w) && w.status === "completed")
      .sort(
        (a, b) =>
          b.workout_date_local.localeCompare(a.workout_date_local) ||
          b.created_at_utc.localeCompare(a.created_at_utc),
      )
      .flatMap((w) => {
        const r = results.get(w.workout_id);
        return r
          ? [
              {
                workout_id: w.workout_id,
                date_local: w.workout_date_local,
                kind: r.kind,
                session_name: w.session_name_snapshot,
                timer_s: r.timer_s,
                exercises_done: r.exercises_done,
                exercises_total: r.exercises_total,
                source: r.result_source,
                ended_early: r.ended_early,
              },
            ]
          : [];
      })
      .slice(0, MOBILITY_LIMITS.recent);
    const adherence = mobilityAdherenceOf(inputs, today, timezone);
    return {
      profile: mobilityProfileView(data.mobilityProfiles?.[0]),
      today: {
        date_local: today,
        items: mobilityDueToday(inputs, today).map(({ session, done }) => ({
          session_id: session.session_id,
          kind: session.kind,
          session_name: session.session_name,
          minutes: session.minutes,
          done,
          template: session.template,
        })),
      },
      adherence: {
        planned_count: adherence.planned_count,
        done_count: adherence.done_count,
        ratio: adherence.ratio,
        streak_days: adherence.streak_days,
        days: adherence.days,
      },
      recent,
    };
  }

  /* -------------------------------------------------------- tool writes */

  /** `update_mobility_profile`: the user's answer about mobility. */
  async updateProfile(
    raw: unknown,
    context: unknown,
  ): Promise<UpdateMobilityProfileResponse> {
    try {
      const actor = await this.actor(context);
      const input = MobilityToolInputs.update_mobility_profile.parse(raw);
      const outcome = await commitWrite<WriteResult>({
        trackerId: this.options.trackerId,
        store: this.options.store,
        requestId: input.request_id,
        fingerprint: fingerprint({
          operation: "update_mobility_profile" satisfies Operation,
          input,
        }),
        actorSubject: actor.subject,
        clock: this.clock(),
        build: (data, now) => {
          const changes: EntityChange[] = [];
          this.buildProfile(
            input.preference,
            input.has_mat,
            data,
            now,
            changes,
          );
          return {
            changes,
            result: emptyResult(),
            audit: auditEvents(input.request_id, changes, actor, now),
          };
        },
      });
      const data = await this.options.store.read();
      return UpdateMobilityProfileResponseSchema.parse({
        ok: true,
        replayed: outcome.replayed,
        profile: mobilityProfileView(data.mobilityProfiles?.[0]),
        error: null,
      });
    } catch (error) {
      return { ok: false, replayed: false, error: toolError(error) };
    }
  }

  /**
   * Writes the answer; an answer that equals the stored one writes nothing.
   * The mat answer (D-07) is changed only when given; absent keeps the stored
   * one, and a profile without one stays without (never a silent false).
   */
  private buildProfile(
    preference: MobilityPreference,
    hasMat: boolean | undefined,
    data: ArnoldDataset,
    now: string,
    changes: EntityChange[],
  ) {
    const before = data.mobilityProfiles?.[0] ?? null;
    const columns = preferenceColumns(preference);
    const mat = hasMat ?? before?.has_mat;
    if (
      before &&
      canonical(mobilityProfileView(before).preference) ===
        canonical(preference) &&
      mat === before.has_mat
    )
      return;
    const after = ArnoldMobilityProfileSchema.parse({
      mobility_profile_id: before?.mobility_profile_id ?? this.id(),
      ...columns,
      ...(mat === undefined ? {} : { has_mat: mat }),
      created_at_utc: before?.created_at_utc ?? now,
      updated_at_utc: now,
      row_revision: (before?.row_revision ?? 0) + 1,
    });
    changes.push({ table: "mobilityProfiles", before, after });
  }

  /** `log_mobility`: a routine the user did, saved at once without coaching. */
  async logMobility(
    raw: unknown,
    context: unknown,
  ): Promise<LogMobilityResponse> {
    try {
      const actor = await this.actor(context);
      const input = MobilityToolInputs.log_mobility.parse(raw);
      const outcome = await commitWrite<WriteResult>({
        trackerId: this.options.trackerId,
        store: this.options.store,
        requestId: input.request_id,
        fingerprint: fingerprint({
          operation: "log_mobility" satisfies Operation,
          input,
        }),
        actorSubject: actor.subject,
        clock: this.clock(),
        build: (data, now) => {
          const changes: EntityChange[] = [];
          const result = emptyResult();
          result.workout = this.buildLog(input, data, now, changes);
          return {
            changes,
            result,
            audit: auditEvents(input.request_id, changes, actor, now),
          };
        },
      });
      return LogMobilityResponseSchema.parse({
        ok: true,
        replayed: outcome.replayed,
        workout_id: outcome.result.workout!.workout_id,
        error: null,
      });
    } catch (error) {
      return { ok: false, replayed: false, error: toolError(error) };
    }
  }

  /** The active routine of the plan that applies now with this id. */
  private planRoutine(
    data: ArnoldDataset,
    now: string,
    pick: (s: {
      session_id: string;
      kind: MobilityKind;
      status: string;
    }) => boolean,
  ): PlanRoutine | null {
    const view = trainingView(data, new Date(now));
    const plan = [...view.plans]
      .filter((p) => p.status === "active" && p.activated_at_utc !== null)
      .sort((a, b) =>
        b.activated_at_utc!.localeCompare(a.activated_at_utc!),
      )[0];
    if (!plan) return null;
    const row = (view.planMobilitySessions ?? [])
      .filter(
        (s) =>
          s.plan_version_id === plan.plan_version_id && s.status === "active",
      )
      .sort((a, b) => a.session_order - b.session_order)
      .find(pick);
    return row
      ? {
          plan_version_id: row.plan_version_id,
          session_id: row.session_id,
          name: row.session_name,
          minutes: row.minutes,
          kind: row.kind,
          template: row.template,
        }
      : null;
  }

  private buildLog(
    input: z.infer<typeof MobilityToolInputs.log_mobility>,
    data: ArnoldDataset,
    now: string,
    changes: EntityChange[],
  ): ArnoldWorkout {
    const timezone = this.zone(data, input.timezone);
    const today = localDayOf(new Date(now), timezone);
    const date = input.workout_date_local ?? today;
    if (date > today)
      throw new MobilityError(
        "DATE_IN_FUTURE",
        `Das Datum ${date} liegt in der Zukunft (heute ist ${today}). Es wurde nichts gespeichert. Den Nutzer nach dem richtigen Datum fragen.`,
      );
    let plan: PlanRoutine | null = null;
    if (input.session_id !== undefined) {
      plan = this.planRoutine(
        data,
        now,
        (s) => s.session_id === input.session_id,
      );
      if (!plan)
        throw new MobilityError(
          "MOBILITY_SESSION_NOT_FOUND",
          "Diese Mobility-Routine gibt es im aktiven Plan nicht (mehr). Es wurde nichts gespeichert. Ohne session_id als freie Routine speichern oder mit get_mobility_overview nachsehen.",
        );
      if (plan.kind !== input.kind)
        throw new MobilityError(
          "VALIDATION_ERROR",
          `Die Routine im Plan ist vom Typ ${plan.kind}, nicht ${input.kind}.`,
        );
    } else if (input.kind === "morning")
      plan = this.planRoutine(data, now, (s) => s.kind === "morning");

    const sessionId = plan?.session_id ?? null;
    const duplicate = data.workouts.find(
      (w) =>
        isMobilityWorkout(w) &&
        w.status === "completed" &&
        w.workout_date_local === date &&
        w.session_id === sessionId &&
        (sessionId !== null ||
          data.mobilityResults?.find((r) => r.workout_id === w.workout_id)
            ?.kind === input.kind),
    );
    if (duplicate && !input.confirm_duplicate)
      throw new MobilityError(
        "DUPLICATE_MOBILITY",
        "Diese Routine ist für den Tag schon gespeichert. Den Nutzer fragen, ob sie ein zweites Mal gespeichert werden soll (confirm_duplicate: true) oder nichts. Es wurde nichts gespeichert.",
        false,
        [duplicate.workout_id],
      );

    const total = plan?.template.exercise_ids.length ?? 0;
    return this.writeResult(now, changes, {
      date,
      timezone,
      kind: input.kind,
      plan,
      result_source: "chat",
      workout_source: "chat",
      minutes_planned: plan?.minutes ?? input.minutes ?? null,
      // Only what the user said: unknown stays null, never 0.
      timer_s: input.minutes === undefined ? null : input.minutes * 60,
      elapsed_s: null,
      total,
      done: total,
      skipped: 0,
      ended_early: false,
      items: [],
      started_at_utc: null,
      ended_at_utc: null,
      client_session_id: null,
    });
  }

  /** Workout and result row of one finished routine. */
  private writeResult(
    now: string,
    changes: EntityChange[],
    r: ResultInput,
  ): ArnoldWorkout {
    const workout = ArnoldWorkoutSchema.parse({
      workout_id: this.id(),
      // Left out when there is none: the database does not store a null here,
      // and a receipt must read back equal to the row to be replayed.
      ...(r.client_session_id
        ? { client_session_id: r.client_session_id }
        : {}),
      workout_date_local: r.date,
      timezone: r.timezone,
      started_at_utc: r.started_at_utc,
      ended_at_utc: r.ended_at_utc,
      plan_version_id: r.plan?.plan_version_id ?? null,
      session_id: r.plan?.session_id ?? null,
      session_name_snapshot: r.plan?.name ?? KIND_NAME[r.kind],
      status: "completed",
      source: r.workout_source,
      notes: null,
      created_at_utc: now,
      updated_at_utc: now,
      row_revision: 1,
      activity_type: "mobility",
    });
    const result = ArnoldMobilityResultSchema.parse({
      workout_id: workout.workout_id,
      activity_type: "mobility",
      kind: r.kind,
      plan_version_id: r.plan?.plan_version_id ?? null,
      session_id: r.plan?.session_id ?? null,
      minutes_planned: r.minutes_planned,
      timer_s: r.timer_s,
      elapsed_s: r.elapsed_s,
      exercises_total: r.total,
      exercises_done: r.done,
      exercises_skipped: r.skipped,
      ended_early: r.ended_early,
      items: r.items,
      result_source: r.result_source,
      catalog_version:
        r.plan?.template.catalog_version ?? MOBILITY_CATALOG_VERSION,
      rules_version: r.plan?.template.rules_version ?? MOBILITY_RULES_VERSION,
      created_at_utc: now,
      updated_at_utc: now,
      row_revision: 1,
    });
    changes.push({ table: "workouts", before: null, after: workout });
    changes.push({ table: "mobilityResults", before: null, after: result });
    return workout;
  }

  /* -------------------------------------------------------------- watch */

  /**
   * `POST` one finished routine from the watch (the route is MOB-006). The
   * same result logic as `log_mobility`, with the exercises the watch
   * reported. request_id makes a repeat harmless; the same session_uuid under
   * a new request_id is DUPLICATE_WORKOUT. `timezone` is the user's IANA zone
   * (the watch only knows its offset).
   */
  async saveWatchMobility(
    raw: unknown,
    context: unknown,
    timezone: string,
  ): Promise<MobilityWatchOutcome> {
    try {
      const actor = await this.actor(context);
      const request = WatchMobilityRequestSchema.parse(raw);
      const outcome = await commitWrite<WriteResult>({
        trackerId: this.options.trackerId,
        store: this.options.store,
        requestId: request.request_id,
        fingerprint: fingerprint({
          operation: "save_watch_mobility" satisfies Operation,
          request,
        }),
        actorSubject: actor.subject,
        clock: this.clock(),
        build: (data, now) => {
          const changes: EntityChange[] = [];
          const result = emptyResult();
          result.workout = this.buildWatch(
            request,
            data,
            timezone,
            now,
            changes,
          );
          return {
            changes,
            result,
            audit: auditEvents(request.request_id, changes, actor, now),
          };
        },
      });
      return {
        ok: true,
        value: WatchMobilityResponseSchema.parse({
          api_version: RUN_WATCH_API_VERSION,
          min_app_version: WATCH_MIN_APP_VERSION,
          workout_id: outcome.result.workout!.workout_id,
          replayed: outcome.replayed,
        }),
      };
    } catch (error) {
      return { ok: false, error: mobilityErrorBody(error) };
    }
  }

  private buildWatch(
    request: WatchMobilityRequest,
    data: ArnoldDataset,
    timezone: string,
    now: string,
    changes: EntityChange[],
  ): ArnoldWorkout {
    if (!isTimeZone(timezone))
      throw new WriteError("VALIDATION_ERROR", "Ungültige Zeitzone.");
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
        "Die Routine liegt in der Zukunft. Es wurde nichts gespeichert.",
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

    let plan: PlanRoutine | null = null;
    if (request.plan_version_id !== undefined) {
      const row = (data.planMobilitySessions ?? []).find(
        (s) =>
          s.plan_version_id === request.plan_version_id &&
          s.session_id === request.session_id &&
          s.status === "active",
      );
      if (!row)
        throw new WriteError(
          "VALIDATION_ERROR",
          "Die Planeinheit gibt es nicht (mehr).",
        );
      if (row.kind !== request.kind)
        throw new WriteError(
          "VALIDATION_ERROR",
          `Die Planeinheit ist vom Typ ${row.kind}.`,
        );
      plan = {
        plan_version_id: row.plan_version_id,
        session_id: row.session_id,
        name: row.session_name,
        minutes: row.minutes,
        kind: row.kind,
        template: row.template,
      };
    }

    // The counts follow the exercises the watch reported.
    const codes = request.ex.map((item) => item.c);
    if (new Set(codes).size !== codes.length)
      throw new WriteError(
        "VALIDATION_ERROR",
        "Jede Übung höchstens einmal im Ergebnis.",
      );
    if (
      !request.ended_early &&
      request.ex.some((item) => item.st === "partial")
    )
      throw new WriteError(
        "VALIDATION_ERROR",
        "Eine teilweise gemachte Übung gibt es nur bei vorzeitigem Ende (ended_early).",
      );
    if (plan) {
      const inRoutine = new Set(plan.template.exercise_ids);
      if (codes.some((code) => !inRoutine.has(code)))
        throw new WriteError(
          "VALIDATION_ERROR",
          "Das Ergebnis enthält Übungen, die nicht zur Routine gehören.",
        );
    }
    const total = plan ? plan.template.exercise_ids.length : codes.length;
    const done = request.ex.filter((item) => item.st === "done").length;
    const skipped = request.ex.length - done;
    if (!request.ended_early && done + skipped !== total)
      throw new WriteError(
        "VALIDATION_ERROR",
        "Alle Übungen der Routine müssen gemeldet sein, sonst ist sie vorzeitig beendet (ended_early).",
      );

    return this.writeResult(now, changes, {
      date: request.workout_date_local,
      timezone,
      kind: request.kind,
      plan,
      result_source: "watch",
      workout_source: "sync",
      minutes_planned: plan?.minutes ?? null,
      timer_s: request.timer_s,
      elapsed_s: request.elapsed_s,
      total,
      done,
      skipped,
      ended_early: request.ended_early,
      items: request.ex,
      started_at_utc: request.started_at_utc,
      ended_at_utc: request.ended_at_utc,
      client_session_id: request.session_uuid,
    });
  }
}
