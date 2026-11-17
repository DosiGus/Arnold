import { recoveryFor } from "../../shared/write-recovery.js";
import { z } from "zod";
import { analyzeSetLoad } from "../../analytics/load.js";
import {
  isStrengthWorkout,
  ArnoldExerciseSchema,
  ArnoldSetSchema,
  ArnoldWorkoutSchema,
  type ArnoldDataset,
  type ArnoldSet,
  type ArnoldWorkout,
} from "../../shared/arnold-schema-v1.js";
import {
  UNUSUAL_SET_LIMITS,
  WriteInputs,
  WriteResponseSchema,
  type WriteOperation,
  type WriteResponse,
  type WriteResult,
} from "../../shared/workout-contract.js";
import {
  STORAGE_RETRY_MESSAGE,
  commitWrite,
  type WatchRecordingRow,
  type WatchSetTiming,
} from "../plan/commit.js";
import {
  WriteError,
  canonical,
  entityId,
  fingerprint,
  uuid7,
  type Actor,
  type ArnoldStore,
  type AuditEvent,
  type AuthorizationGuard,
  type EntityChange,
  type Permission,
  type WriteMode,
} from "./infrastructure.js";
import {
  MarkRecapSeenInputSchema,
  recapSeenRequestId,
  type MarkRecapSeenOutput,
} from "../../shared/recap-contract.js";
import { buildGoalChange, isGoalOperation } from "./goals.js";
import { proposeSession } from "./proposal.js";
import { MISSING_LABEL, applyChanges } from "./log-workout.js";

/**
 * Refuses values that are almost certainly a slip (1000 kg, 300 reps) until
 * the user confirmed them in the chat (B13, corpus case W2).
 */
function assertUsualValues(
  sets: readonly { load_kg?: number | null; reps?: number }[],
  confirmed: true | undefined,
) {
  if (confirmed) return;
  const unusual = sets.filter(
    (set) =>
      (set.load_kg ?? 0) > UNUSUAL_SET_LIMITS.load_kg ||
      (set.reps ?? 0) > UNUSUAL_SET_LIMITS.reps,
  );
  if (unusual.length)
    throw new WriteError(
      "CONFIRMATION_REQUIRED",
      `Ungewöhnlicher Wert (über ${UNUSUAL_SET_LIMITS.load_kg} kg oder über ${UNUSUAL_SET_LIMITS.reps} Wiederholungen). Es wurde nichts gespeichert. Den Nutzer fragen, ob der Wert stimmt; nur nach ausdrücklichem Ja mit confirm_unusual_values: true erneut senden.`,
      false,
      unusual.map(
        (set) => `load_kg=${set.load_kg ?? "–"}, reps=${set.reps ?? "–"}`,
      ),
    );
}

/**
 * What only the watch route sets (07 D-08, D-09). It is a separate argument,
 * never part of the tool input, so /mcp can neither claim `source: sync` nor
 * pick a client session.
 */
export interface WatchUpload {
  client_session_id: string;
  device_id: string;
  app_version: string;
  set_timings: readonly WatchSetTiming[];
}
interface InternalWrite {
  source: "sync";
  watch: WatchUpload;
}

export interface LoggingOptions {
  mode: WriteMode;
  trackerId: string;
  store: ArnoldStore;
  authorization: AuthorizationGuard;
  clock?: () => Date;
  id?: () => string;
}
const events = {
  start_workout: "WORKOUT_CREATED",
  log_workout_sets: "SET_CREATED",
  update_set: "SET_UPDATED",
  void_set: "SET_VOIDED",
  complete_workout: "WORKOUT_COMPLETED",
  cancel_workout: "WORKOUT_CANCELLED",
  log_workout: "WORKOUT_LOGGED",
  void_workout: "WORKOUT_VOIDED",
  create_exercise: "EXERCISE_CREATED",
  create_training_goal: "GOAL_CREATED",
  update_training_goal: "GOAL_UPDATED",
  archive_training_goal: "GOAL_ARCHIVED",
  log_body_weight: "BODY_WEIGHT_LOGGED",
  void_body_weight: "BODY_WEIGHT_VOIDED",
} as const satisfies Record<WriteOperation, string>;
const normalize = (s: string) =>
  s
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, "");
/**
 * The event of one changed row. `log_workout` and `void_workout` change a
 * workout and its sets together, so each row gets the event that fits it.
 */
function eventType(
  operation: WriteOperation,
  change: EntityChange,
): AuditEvent["event_type"] {
  const table = (change as { table: string }).table;
  if (operation === "log_workout")
    return table === "sets"
      ? change.before
        ? "SET_VOIDED"
        : "SET_CREATED"
      : change.before
        ? "WORKOUT_VOIDED"
        : "WORKOUT_LOGGED";
  if (operation === "void_workout")
    return table === "sets" ? "SET_VOIDED" : "WORKOUT_VOIDED";
  return events[operation];
}

/** Fields whose before/after values an audit event records. */
const AUDITED_FIELDS = [
  "status",
  "reps",
  "reps_basis",
  "load_kg",
  "load_basis",
  "implement_count",
  "execution_mode",
  "side",
  "rpe",
  "rir",
  "default_load_basis",
  "default_execution_mode",
  "default_implement_count",
  "kind",
  "target_value",
  "measured_on",
  "weight_kg",
] as const;

/** One audit event per changed row, with the business-relevant fields only. */
function auditEvents(
  operation: WriteOperation,
  input: Record<string, unknown>,
  changes: readonly EntityChange[],
  actor: Actor,
  now: string,
): AuditEvent[] {
  const value = (row: object | null, key: string) =>
    row ? (row as Record<string, unknown>)[key] : undefined;
  return changes.map((c) => ({
    operation_id: String(input.request_id),
    event_type: eventType(operation, c),
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
    correction_reason:
      typeof input.correction_reason === "string"
        ? input.correction_reason
        : null,
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
  }));
}
/**
 * A plan version a workout may be recorded against: not a draft, and a
 * temporary one (UX-008) only once its adjustment was confirmed. A workout
 * of an adjustment cancelled later keeps its version.
 */
/**
 * The plan a session name refers to on a local day: the temporary version of
 * a confirmed adjustment covering that day (UX-008), else the active plan if
 * it was already active then.
 */
function planForDay(data: ArnoldDataset, date: string) {
  const adjustment = (data.planAdjustments ?? []).find(
    (a) =>
      a.status === "confirmed" &&
      a.start_date_local <= date &&
      date <= a.end_date_local,
  );
  if (adjustment)
    return data.plans.find(
      (p) => p.plan_version_id === adjustment.plan_version_id,
    );
  return data.plans.find(
    (p) =>
      p.status === "active" &&
      p.activated_at_utc !== null &&
      p.activated_at_utc.slice(0, 10) <= date,
  );
}

function trainablePlan(data: ArnoldDataset, planVersionId: string): boolean {
  const plan = data.plans.find((p) => p.plan_version_id === planVersionId);
  if (!plan || plan.status === "draft") return false;
  if (plan.status !== "temporary") return true;
  return (data.planAdjustments ?? []).some(
    (a) => a.plan_version_id === planVersionId && a.confirmed_at_utc !== null,
  );
}

export class WorkoutLoggingService {
  readonly mode: WriteMode;
  constructor(private options: LoggingOptions) {
    this.mode = options.mode;
    if (this.mode !== "disabled" && this.mode !== options.store.kind)
      throw new WriteError(
        "PERMISSION_DENIED",
        "Schreibmodus passt nicht zum Speicher.",
      );
  }
  async actor(
    context: unknown,
    permission: Permission = "write",
  ): Promise<Actor> {
    if (this.mode === "disabled")
      throw new WriteError(
        "PERMISSION_DENIED",
        "Schreibfunktionen sind deaktiviert.",
      );
    const actor = await this.options.authorization.authorize(
      this.options.trackerId,
      permission,
      context,
    );
    if (!actor?.verified || !actor.subject)
      throw new WriteError(
        "AUTH_REQUIRED",
        "Geprüfte Nutzeridentität erforderlich.",
      );
    if (
      actor.trackerId !== this.options.trackerId ||
      !actor.permissions.includes(permission) ||
      (this.mode === "database" && actor.kind !== "authenticated") ||
      (this.mode === "fixture" && actor.kind !== "fixture")
    )
      throw new WriteError(
        "PERMISSION_DENIED",
        "Keine Berechtigung für diesen Tracker oder Vorgang.",
      );
    return actor;
  }
  /**
   * True when the recap of this workout was acknowledged. Reads the receipt
   * only; a failing read throws, so the caller shows nothing instead of
   * showing the recap again.
   */
  async isRecapSeen(workoutId: string): Promise<boolean> {
    return this.options.store.hasOperation(recapSeenRequestId(workoutId));
  }
  /**
   * Marks the recap of a completed workout as seen (UX-006). The marker is a
   * receipt without data changes under a key derived from the workout, so it
   * is the same on every device and a repeat changes nothing. The user comes
   * from the verified token, the workout must be the user's own and completed.
   */
  async markRecapSeen(
    raw: unknown,
    context?: unknown,
  ): Promise<MarkRecapSeenOutput> {
    const workoutId =
      raw &&
      typeof raw === "object" &&
      "workout_id" in raw &&
      typeof raw.workout_id === "string"
        ? raw.workout_id
        : "";
    try {
      const actor = await this.actor(context);
      const input = MarkRecapSeenInputSchema.parse(raw);
      const requestId = recapSeenRequestId(input.workout_id);
      const outcome = await commitWrite<WriteResult>({
        trackerId: this.options.trackerId,
        store: this.options.store,
        requestId,
        fingerprint: fingerprint({
          operation: "mark_recap_seen",
          workout_id: input.workout_id,
        }),
        actorSubject: actor.subject,
        clock: this.options.clock ?? (() => new Date()),
        build: (dataset, now) => {
          const workout = dataset.workouts.find(
            (w) => w.workout_id === input.workout_id,
          );
          if (!workout)
            throw new WriteError(
              "WORKOUT_NOT_FOUND",
              "Dieses Training gibt es in deinen Daten nicht.",
            );
          if (workout.status !== "completed")
            throw new WriteError(
              "INVALID_STATUS_TRANSITION",
              "Nur ein abgeschlossenes Training hat einen Rückblick.",
            );
          return {
            changes: [],
            result: { workout, sets: [], exercise: null, warnings: [] },
            audit: [
              {
                operation_id: requestId,
                event_type: "RECAP_SEEN",
                entity_id: workout.workout_id,
                at: now,
                actor: actor.subject,
                previous_revision: workout.row_revision,
                new_revision: workout.row_revision,
                result: "verified",
                changed_fields: [],
                correction_reason: null,
                changes: {},
              },
            ],
          };
        },
      });
      return {
        ok: true,
        workout_id: input.workout_id,
        replayed: outcome.replayed,
        error: null,
      };
    } catch (error) {
      const failure =
        error instanceof WriteError
          ? error
          : error instanceof z.ZodError
            ? new WriteError(
                "VALIDATION_ERROR",
                "Eingaben sind nicht eindeutig oder ungültig.",
              )
            : new WriteError(
                "STORAGE_UNAVAILABLE",
                STORAGE_RETRY_MESSAGE,
                true,
              );
      return {
        ok: false,
        workout_id: workoutId,
        replayed: false,
        error: {
          code: failure.code,
          message: failure.message,
          retryable: failure.retryable,
        },
      };
    }
  }
  async execute(
    operation: WriteOperation,
    raw: unknown,
    context?: unknown,
    internal?: InternalWrite,
  ): Promise<WriteResponse> {
    const requestId =
      raw &&
      typeof raw === "object" &&
      "request_id" in raw &&
      typeof raw.request_id === "string"
        ? raw.request_id
        : "";
    try {
      const actor = await this.actor(context);
      const input = WriteInputs[operation].parse(raw);
      if (internal && operation !== "log_workout")
        throw new WriteError(
          "PERMISSION_DENIED",
          "Uhr-Uploads gibt es nur als log_workout.",
        );
      // The watch part belongs to the operation: the same request_id with
      // another recording is a different write.
      const hash = fingerprint(
        internal ? { operation, input, internal } : { operation, input },
      );
      const outcome = await commitWrite<WriteResult>({
        trackerId: this.options.trackerId,
        store: this.options.store,
        requestId: input.request_id,
        fingerprint: hash,
        actorSubject: actor.subject,
        clock: this.options.clock ?? (() => new Date()),
        build: async (dataset, now) => {
          const built = await this.build(
            operation,
            raw,
            dataset,
            actor,
            context,
            now,
            internal,
          );
          return {
            ...built,
            audit: auditEvents(operation, input, built.changes, actor, now),
          };
        },
      });
      return WriteResponseSchema.parse({
        ok: true,
        operation,
        request_id: input.request_id,
        ...outcome,
        error: null,
      });
    } catch (error) {
      const failure =
        error instanceof WriteError
          ? error
          : error instanceof z.ZodError
            ? new WriteError(
                "VALIDATION_ERROR",
                "Eingaben sind nicht eindeutig oder ungültig.",
                false,
                error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
              )
            : new WriteError(
                "STORAGE_UNAVAILABLE",
                STORAGE_RETRY_MESSAGE,
                true,
              );
      return {
        ok: false,
        operation,
        request_id: requestId,
        replayed: false,
        result: null,
        error: {
          code: failure.code,
          message: failure.message,
          retryable: failure.retryable,
          details: failure.details,
          recovery: recoveryFor(failure.code, failure.retryable),
        },
      };
    }
  }
  private id() {
    return this.options.id?.() ?? uuid7();
  }
  private workout(data: ArnoldDataset, id: string) {
    const row = data.workouts.find((w) => w.workout_id === id);
    if (!row)
      throw new WriteError(
        "WORKOUT_NOT_FOUND",
        "Trainingseinheit nicht gefunden.",
      );
    return row;
  }
  private revision(row: { row_revision: number }, expected: number) {
    if (row.row_revision !== expected)
      throw new WriteError(
        "REVISION_CONFLICT",
        "Revision veraltet. Datensatz erneut laden.",
        false,
        [`current_revision=${row.row_revision}`],
      );
  }
  private async editable(
    workout: ArnoldWorkout,
    correction: { correct_completed?: boolean; correction_reason?: string },
    context: unknown,
  ) {
    if (workout.status === "in_progress") return;
    if (
      workout.status === "completed" &&
      correction.correct_completed &&
      correction.correction_reason?.trim()
    ) {
      await this.actor(context, "correct_completed");
      return;
    }
    throw new WriteError(
      "INVALID_STATUS_TRANSITION",
      "Abgeschlossene Einheiten benötigen einen ausdrücklich autorisierten Korrekturvorgang mit Begründung; andere geschlossene Einheiten sind gesperrt.",
    );
  }
  private validateSet(set: ArnoldSet, date: string) {
    const parsed = ArnoldSetSchema.parse(set);
    const analysis = analyzeSetLoad(parsed, date);
    if (
      analysis.volume_reasons.includes(
        "reps_basis_ambiguous_for_execution_mode",
      ) ||
      (parsed.execution_mode === "unilateral" &&
        parsed.implement_count !== 1) ||
      (parsed.execution_mode === "alternating" && parsed.implement_count > 2)
    )
      throw new WriteError(
        "VALIDATION_ERROR",
        "Wiederholungsbasis oder Anzahl der Geräte ist für diese Ausführung nicht eindeutig.",
      );
    return parsed;
  }
  /** Marks a workout and its active sets voided; returns the voided workout. */
  private voidWorkout(
    data: ArnoldDataset,
    before: ArnoldWorkout,
    now: string,
    changes: EntityChange[],
  ) {
    const after = ArnoldWorkoutSchema.parse({
      ...before,
      status: "voided",
      updated_at_utc: now,
      row_revision: before.row_revision + 1,
    });
    changes.push({ table: "workouts", before, after });
    for (const set of data.sets)
      if (set.workout_id === before.workout_id && set.status === "active")
        changes.push({
          table: "sets",
          before: set,
          after: ArnoldSetSchema.parse({
            ...set,
            status: "voided",
            updated_at_utc: now,
            row_revision: set.row_revision + 1,
          }),
        });
    return after;
  }
  /**
   * Resolves the plan version and session of a workout. A session alone
   * belongs to its plan version; a name alone matches one session of the plan
   * that was active on that day.
   */
  private planSession(
    data: ArnoldDataset,
    planVersionId: string | null,
    sessionId: string | null,
    sessionName: string | undefined,
    date: string,
  ) {
    let plan = planVersionId,
      session = sessionId;
    if (!plan && session)
      plan =
        data.planItems.find((i) => i.session_id === session)?.plan_version_id ??
        null;
    if (!plan && !session && sessionName) {
      const active = planForDay(data, date);
      const matches = new Set(
        data.planItems
          .filter(
            (i) =>
              i.plan_version_id === active?.plan_version_id &&
              i.status === "active" &&
              normalize(i.session_name) === normalize(sessionName),
          )
          .map((i) => i.session_id),
      );
      if (active && matches.size === 1) {
        plan = active.plan_version_id;
        session = [...matches][0];
      }
    }
    if (plan && !trainablePlan(data, plan))
      throw new WriteError(
        "VALIDATION_ERROR",
        "Planversion unbekannt oder noch im Entwurf.",
      );
    if (
      session &&
      !data.planItems.some(
        (i) => i.plan_version_id === plan && i.session_id === session,
      )
    )
      throw new WriteError(
        "VALIDATION_ERROR",
        "Session gehört nicht zur Planversion.",
      );
    return { plan, session };
  }
  private async build(
    operation: WriteOperation,
    raw: unknown,
    data: ArnoldDataset,
    _actor: Actor,
    context: unknown,
    now: string,
    internal?: InternalWrite,
  ): Promise<{
    changes: EntityChange[];
    result: WriteResult;
    watchRecording?: WatchRecordingRow;
  }> {
    if (isGoalOperation(operation))
      return buildGoalChange(operation, raw, data, now, () => this.id());
    const changes: EntityChange[] = [];
    let watchRecording: WatchRecordingRow | undefined;
    const result: WriteResult = {
      workout: null,
      sets: [],
      exercise: null,
      warnings: [],
    };
    const technical = {
      created_at_utc: now,
      updated_at_utc: now,
      row_revision: 1,
    };
    switch (operation) {
      case "start_workout": {
        const input = WriteInputs.start_workout.parse(raw);
        let plan = input.plan_version_id ?? null,
          session = input.session_id ?? null;
        if (!plan && session)
          throw new WriteError(
            "VALIDATION_ERROR",
            "Session erfordert eine Planversion.",
          );
        if (!plan && !session) {
          const active = planForDay(data, input.workout_date_local);
          const matches = new Set(
            data.planItems
              .filter(
                (i) =>
                  i.plan_version_id === active?.plan_version_id &&
                  i.status === "active" &&
                  normalize(i.session_name) === normalize(input.session_name),
              )
              .map((i) => i.session_id),
          );
          if (active && matches.size === 1) {
            plan = active.plan_version_id;
            session = [...matches][0];
          }
        }
        if (plan && !trainablePlan(data, plan))
          throw new WriteError(
            "VALIDATION_ERROR",
            "Planversion unbekannt oder noch im Entwurf.",
          );
        if (
          session &&
          !data.planItems.some(
            (i) => i.plan_version_id === plan && i.session_id === session,
          )
        )
          throw new WriteError(
            "VALIDATION_ERROR",
            "Session gehört nicht zur Planversion.",
          );
        const today = new Intl.DateTimeFormat("en-CA", {
          timeZone: input.timezone,
        }).format(new Date(now));
        if (input.workout_date_local > today)
          throw new WriteError(
            "DATE_IN_FUTURE",
            `Das Trainingsdatum ${input.workout_date_local} liegt in der Zukunft (heute ist ${today}). Es wurde nichts gespeichert. Den Nutzer nach dem richtigen Datum fragen.`,
          );
        if (
          input.started_at_utc &&
          new Intl.DateTimeFormat("en-CA", { timeZone: input.timezone }).format(
            new Date(input.started_at_utc),
          ) !== input.workout_date_local
        )
          throw new WriteError(
            "VALIDATION_ERROR",
            "Startzeit passt nicht zum angegebenen lokalen Trainingsdatum.",
          );
        result.workout = ArnoldWorkoutSchema.parse({
          ...technical,
          workout_id: this.id(),
          workout_date_local: input.workout_date_local,
          timezone: input.timezone,
          started_at_utc: input.started_at_utc ?? null,
          ended_at_utc: null,
          plan_version_id: plan,
          session_id: session,
          session_name_snapshot: input.session_name,
          status: "in_progress",
          source: input.source ?? "chat",
          notes: input.notes ?? null,
        });
        changes.push({
          table: "workouts",
          before: null,
          after: result.workout,
        });
        break;
      }
      case "log_workout_sets": {
        const input = WriteInputs.log_workout_sets.parse(raw);
        assertUsualValues(input.sets, input.confirm_unusual_values);
        const workout = this.workout(data, input.workout_id);
        await this.editable(workout, {}, context);
        const previous = [
          ...data.sets.filter((s) => s.workout_id === workout.workout_id),
        ];
        for (const spec of input.sets) {
          const exercise = data.exercises.find(
            (e) => e.exercise_id === spec.exercise_id && e.status === "active",
          );
          if (!exercise)
            throw new WriteError(
              "EXERCISE_NOT_FOUND",
              "Aktive Übung nicht gefunden.",
            );
          if (spec.plan_item_id) {
            const item = data.planItems.find(
              (i) =>
                i.plan_item_id === spec.plan_item_id && i.status === "active",
            );
            if (
              !item ||
              item.exercise_id !== exercise.exercise_id ||
              item.plan_version_id !== workout.plan_version_id ||
              item.session_id !== workout.session_id
            )
              throw new WriteError(
                "VALIDATION_ERROR",
                "Planposition passt nicht zu Übung und Workout-Session.",
              );
          }
          const same = previous.filter(
            (s) => s.exercise_id === exercise.exercise_id,
          );
          const order =
            spec.exercise_order ??
            same[0]?.exercise_order ??
            Math.max(0, ...previous.map((s) => s.exercise_order)) + 1;
          if (
            same.some((s) => s.exercise_order !== order) ||
            previous.some(
              (s) =>
                s.exercise_id !== exercise.exercise_id &&
                s.exercise_order === order,
            )
          )
            throw new WriteError(
              "VALIDATION_ERROR",
              "Übungsreihenfolge ist widersprüchlich.",
            );
          const number =
            spec.set_number ??
            Math.max(
              0,
              ...same
                .filter(
                  (s) => s.side === spec.side && s.set_type === spec.set_type,
                )
                .map((s) => s.set_number),
            ) + 1;
          const row = this.validateSet(
            {
              ...spec,
              ...technical,
              set_id: this.id(),
              workout_id: workout.workout_id,
              exercise_name_snapshot: exercise.name_de,
              exercise_order: order,
              set_number: number,
              plan_item_id: spec.plan_item_id ?? null,
              rpe: spec.rpe ?? null,
              rir: spec.rir ?? null,
              notes: spec.notes ?? null,
              source: input.source ?? "chat",
              status: "active",
            },
            workout.workout_date_local,
          );
          previous.push(row);
          result.sets.push(row);
          changes.push({ table: "sets", before: null, after: row });
          if ((row.load_kg !== null && row.load_kg > 500) || row.reps > 100)
            result.warnings.push(
              "Ungewöhnlicher Wert wurde unverändert erfasst; Eingabe prüfen.",
            );
        }
        result.workout = workout;
        break;
      }
      case "update_set":
      case "void_set": {
        const input =
          operation === "update_set"
            ? WriteInputs.update_set.parse(raw)
            : WriteInputs.void_set.parse(raw);
        const before = data.sets.find((s) => s.set_id === input.set_id);
        if (!before)
          throw new WriteError(
            "SET_NOT_FOUND",
            "Satz nicht gefunden; stabile Satz-ID erforderlich.",
          );
        const workout = this.workout(data, before.workout_id);
        await this.editable(workout, input, context);
        this.revision(before, input.expected_row_revision);
        if (before.status !== "active")
          throw new WriteError(
            "INVALID_STATUS_TRANSITION",
            "Ein stornierter Satz kann nicht erneut verändert werden. Für Wiederholungen dieselbe Operations-ID verwenden.",
          );
        if (operation === "update_set") {
          const update = WriteInputs.update_set.parse(raw);
          assertUsualValues([update.changes], update.confirm_unusual_values);
        }
        const after = this.validateSet(
          {
            ...before,
            ...(operation === "update_set"
              ? WriteInputs.update_set.parse(raw).changes
              : { status: "voided" as const }),
            updated_at_utc: now,
            row_revision: before.row_revision + 1,
          },
          workout.workout_date_local,
        );
        changes.push({ table: "sets", before, after });
        result.sets = [after];
        result.workout = workout;
        break;
      }
      case "complete_workout":
      case "cancel_workout": {
        const input =
          operation === "complete_workout"
            ? WriteInputs.complete_workout.parse(raw)
            : WriteInputs.cancel_workout.parse(raw);
        const before = this.workout(data, input.workout_id);
        this.revision(before, input.expected_row_revision);
        if (
          before.status !== "in_progress" &&
          !(operation === "cancel_workout" && before.status === "planned")
        )
          throw new WriteError(
            "INVALID_STATUS_TRANSITION",
            "Unzulässiger Statuswechsel.",
          );
        if (
          operation === "complete_workout" &&
          !data.sets.some(
            (s) =>
              s.workout_id === before.workout_id &&
              s.status === "active" &&
              s.reps > 0,
          )
        )
          throw new WriteError(
            "VALIDATION_ERROR",
            "Abschluss benötigt mindestens einen aktiven Satz mit Wiederholungen.",
          );
        if (
          "ended_at_utc" in input &&
          typeof input.ended_at_utc === "string" &&
          new Intl.DateTimeFormat("en-CA", {
            timeZone: before.timezone,
          }).format(new Date(input.ended_at_utc)) < before.workout_date_local
        )
          throw new WriteError(
            "VALIDATION_ERROR",
            "Workout-Ende liegt vor dem lokalen Trainingstag.",
          );
        result.workout = ArnoldWorkoutSchema.parse({
          ...before,
          status: operation === "complete_workout" ? "completed" : "cancelled",
          ended_at_utc:
            "ended_at_utc" in input
              ? (input.ended_at_utc ?? null)
              : before.ended_at_utc,
          updated_at_utc: now,
          row_revision: before.row_revision + 1,
        });
        changes.push({ table: "workouts", before, after: result.workout });
        break;
      }
      case "log_workout": {
        const input = WriteInputs.log_workout.parse(raw);
        const today = new Intl.DateTimeFormat("en-CA", {
          timeZone: input.timezone,
        }).format(new Date(now));
        if (input.workout_date_local > today)
          throw new WriteError(
            "DATE_IN_FUTURE",
            `Das Trainingsdatum ${input.workout_date_local} liegt in der Zukunft (heute ist ${today}). Es wurde nichts gespeichert. Den Nutzer nach dem richtigen Datum fragen.`,
          );
        // Start and end are checked like start_workout and complete_workout.
        const localDay = (iso: string) =>
          new Intl.DateTimeFormat("en-CA", { timeZone: input.timezone }).format(
            new Date(iso),
          );
        if (
          input.started_at_utc &&
          localDay(input.started_at_utc) !== input.workout_date_local
        )
          throw new WriteError(
            "VALIDATION_ERROR",
            "Startzeit passt nicht zum angegebenen lokalen Trainingsdatum.",
          );
        if (
          input.ended_at_utc &&
          localDay(input.ended_at_utc) < input.workout_date_local
        )
          throw new WriteError(
            "VALIDATION_ERROR",
            "Workout-Ende liegt vor dem lokalen Trainingstag.",
          );
        if (
          input.started_at_utc &&
          input.ended_at_utc &&
          Date.parse(input.ended_at_utc) < Date.parse(input.started_at_utc)
        )
          throw new WriteError(
            "VALIDATION_ERROR",
            "Workout-Ende liegt vor dem Beginn.",
          );
        if (internal && (!input.started_at_utc || !input.ended_at_utc))
          throw new WriteError(
            "VALIDATION_ERROR",
            "Ein Uhr-Upload braucht Beginn und Ende.",
          );
        const source = internal?.source ?? input.source ?? "chat";
        // Editing a saved workout replaces it: the old one is voided in the
        // same transaction, so there is never a moment with both or neither.
        let replaced: ArnoldWorkout | undefined;
        if (input.replaces_workout_id) {
          replaced = this.workout(data, input.replaces_workout_id);
          if (input.expected_row_revision === undefined)
            throw new WriteError(
              "VALIDATION_ERROR",
              "Zum Ersetzen ist expected_row_revision erforderlich.",
            );
          this.revision(replaced, input.expected_row_revision);
          if (replaced.status !== "completed" || !isStrengthWorkout(replaced))
            throw new WriteError(
              "INVALID_STATUS_TRANSITION",
              "Nur ein abgeschlossenes Krafttraining kann ersetzt werden.",
            );
          await this.actor(context, "correct_completed");
        }
        const { plan, session } = this.planSession(
          data,
          input.plan_version_id ?? null,
          input.session_id ?? null,
          input.session_name,
          input.workout_date_local,
        );
        // Always the newest values, also when a past day is logged: that is
        // what the card and get_workout show. "Alles wie letztes Mal" keeps
        // last time's values instead of Arnold's recommendation.
        const options = {
          excludeWorkoutId: replaced?.workout_id,
          progression: input.same_as_last_time !== true,
        };
        const proposal =
          plan && session
            ? proposeSession(data, plan, session, options)
            : undefined;
        if (!proposal && !input.exercises?.length)
          throw new WriteError(
            "VALIDATION_ERROR",
            "Ohne Trainingstag des Plans die Übungen mit Sätzen angeben.",
          );
        const name = input.session_name ?? proposal?.session_name;
        if (!name)
          throw new WriteError("VALIDATION_ERROR", "Name des Trainings fehlt.");
        const slots = applyChanges(
          data,
          proposal?.exercises ?? [],
          input.exercises ?? [],
          options,
        );
        if (!slots.length)
          throw new WriteError(
            "VALIDATION_ERROR",
            "Es bleibt keine Übung übrig; nichts gespeichert.",
          );
        const incomplete = slots.filter((slot) => slot.missing.length);
        if (incomplete.length)
          throw new WriteError(
            "VALIDATION_ERROR",
            `Es fehlen Angaben: ${incomplete
              .map(
                (slot) =>
                  `${slot.exercise_name} (${slot.missing.map((m) => MISSING_LABEL[m]).join(", ")})`,
              )
              .join(
                "; ",
              )}. Es wurde nichts gespeichert. Den Nutzer nach den fehlenden Werten fragen.`,
            false,
            incomplete.map(
              (slot) =>
                `${slot.plan_item_id ?? slot.exercise_id}: ${slot.missing.join(",")}`,
            ),
          );
        assertUsualValues(
          slots.flatMap((slot) => slot.sets),
          input.confirm_unusual_values,
        );
        if (!slots.some((slot) => slot.sets.some((set) => set.reps > 0)))
          throw new WriteError(
            "VALIDATION_ERROR",
            "Ein Training braucht mindestens einen Satz mit Wiederholungen.",
          );
        // The same session twice on one day is almost always a slip (a second
        // "so gemacht", or the chat logging what was already saved). Arnold
        // asks first, like it does for unusual values.
        const twins = data.workouts.filter(
          (w) =>
            w.status === "completed" &&
            isStrengthWorkout(w) &&
            w.workout_id !== replaced?.workout_id &&
            w.workout_date_local === input.workout_date_local &&
            normalize(w.session_name_snapshot ?? "") === normalize(name),
        );
        if (twins.length && !input.confirm_duplicate)
          throw new WriteError(
            "DUPLICATE_WORKOUT",
            `„${name}“ ist für ${input.workout_date_local} schon gespeichert (workout_id ${twins.map((w) => w.workout_id).join(", ")}). Es wurde nichts gespeichert. Den Nutzer fragen: das gespeicherte Training ersetzen (replaces_workout_id mit expected_row_revision), zusätzlich speichern (confirm_duplicate: true) oder nichts tun.`,
            false,
            twins.map((w) => `workout_id=${w.workout_id}`),
          );
        // A replacement keeps the recording's client session (07 D-09), so
        // the watch's recording and health data follow without a second write.
        const clientSessionId =
          internal?.watch.client_session_id ?? replaced?.client_session_id;
        const workout = ArnoldWorkoutSchema.parse({
          ...technical,
          workout_id: this.id(),
          ...(clientSessionId ? { client_session_id: clientSessionId } : {}),
          workout_date_local: input.workout_date_local,
          timezone: input.timezone,
          started_at_utc: input.started_at_utc ?? null,
          ended_at_utc: input.ended_at_utc ?? null,
          plan_version_id: plan,
          session_id: session,
          session_name_snapshot: name,
          status: "completed",
          source,
          notes: input.notes ?? null,
        });
        if (replaced) this.voidWorkout(data, replaced, now, changes);
        changes.push({ table: "workouts", before: null, after: workout });
        slots.forEach((slot, index) => {
          const numbers = new Map<string, number>();
          for (const planned of slot.sets) {
            const number = (numbers.get(planned.side) ?? 0) + 1;
            numbers.set(planned.side, number);
            const row = this.validateSet(
              {
                ...technical,
                set_id: this.id(),
                workout_id: workout.workout_id,
                exercise_id: slot.exercise_id,
                plan_item_id: slot.plan_item_id,
                exercise_name_snapshot: slot.exercise_name,
                exercise_order: index + 1,
                set_number: number,
                set_type: "working",
                reps: planned.reps,
                reps_basis: slot.conventions.reps_basis,
                load_kg:
                  slot.conventions.load_basis === "bodyweight_only"
                    ? null
                    : planned.load_kg,
                load_basis: slot.conventions.load_basis,
                implement_count: slot.conventions.implement_count,
                execution_mode: slot.conventions.execution_mode,
                side: planned.side,
                rpe: null,
                rir: null,
                notes: null,
                source,
                status: "active",
              },
              workout.workout_date_local,
            );
            result.sets.push(row);
            changes.push({ table: "sets", before: null, after: row });
          }
        });
        if (twins.length)
          result.warnings.push(
            `Für diesen Tag sind jetzt ${twins.length + 1} Trainings „${name}“ gespeichert.`,
          );
        result.workout = workout;
        if (internal)
          watchRecording = {
            client_session_id: internal.watch.client_session_id,
            device_id: internal.watch.device_id,
            started_at_utc: input.started_at_utc!,
            ended_at_utc: input.ended_at_utc!,
            set_timings: internal.watch.set_timings,
            app_version: internal.watch.app_version,
          };
        break;
      }
      case "void_workout": {
        const input = WriteInputs.void_workout.parse(raw);
        const before = this.workout(data, input.workout_id);
        this.revision(before, input.expected_row_revision);
        if (before.status === "completed")
          await this.actor(context, "correct_completed");
        else if (before.status !== "in_progress")
          throw new WriteError(
            "INVALID_STATUS_TRANSITION",
            "Nur ein laufendes oder abgeschlossenes Training kann verworfen werden.",
          );
        result.workout = this.voidWorkout(data, before, now, changes);
        result.sets = changes
          .filter((c) => c.table === "sets")
          .map((c) => c.after as ArnoldSet);
        break;
      }
      case "create_exercise": {
        const { request_id: _request, ...input } =
          WriteInputs.create_exercise.parse(raw);
        const matches = data.exercises.filter(
          (e) =>
            [e.name_de, e.name_en].some(
              (n) =>
                n &&
                [input.name_de, input.name_en].some(
                  (v) => v && normalize(n) === normalize(v),
                ),
            ) ||
            (normalize(e.family_key) === normalize(input.family_key) &&
              normalize(e.variant_key) === normalize(input.variant_key)),
        );
        if (matches.length)
          throw new WriteError(
            "EXERCISE_MATCH_FOUND",
            "Mögliche bestehende Übungen zuerst klären.",
            false,
            matches.map((e) => e.exercise_id),
          );
        if (
          (input.default_execution_mode === "unilateral" &&
            input.default_implement_count !== 1) ||
          (input.default_execution_mode === "alternating" &&
            input.default_implement_count > 2)
        )
          throw new WriteError(
            "VALIDATION_ERROR",
            "Übungsdefaults sind widersprüchlich.",
          );
        result.exercise = ArnoldExerciseSchema.parse({
          ...input,
          name_en: input.name_en ?? null,
          ...technical,
          exercise_id: this.id(),
          status: "active",
        });
        changes.push({
          table: "exercises",
          before: null,
          after: result.exercise,
        });
        break;
      }
    }
    return { changes, result, ...(watchRecording ? { watchRecording } : {}) };
  }
  /** log_workout from the watch route: source sync, recording in the same write. */
  logWatchWorkout(input: unknown, watch: WatchUpload, context?: unknown) {
    return this.execute("log_workout", input, context, {
      source: "sync",
      watch,
    });
  }
  startWorkout(input: unknown, context?: unknown) {
    return this.execute("start_workout", input, context);
  }
  logWorkoutSets(input: unknown, context?: unknown) {
    return this.execute("log_workout_sets", input, context);
  }
  updateSet(input: unknown, context?: unknown) {
    return this.execute("update_set", input, context);
  }
  voidSet(input: unknown, context?: unknown) {
    return this.execute("void_set", input, context);
  }
  completeWorkout(input: unknown, context?: unknown) {
    return this.execute("complete_workout", input, context);
  }
  cancelWorkout(input: unknown, context?: unknown) {
    return this.execute("cancel_workout", input, context);
  }
  createExercise(input: unknown, context?: unknown) {
    return this.execute("create_exercise", input, context);
  }
  createTrainingGoal(input: unknown, context?: unknown) {
    return this.execute("create_training_goal", input, context);
  }
  updateTrainingGoal(input: unknown, context?: unknown) {
    return this.execute("update_training_goal", input, context);
  }
  archiveTrainingGoal(input: unknown, context?: unknown) {
    return this.execute("archive_training_goal", input, context);
  }
  logBodyWeight(input: unknown, context?: unknown) {
    return this.execute("log_body_weight", input, context);
  }
  voidBodyWeight(input: unknown, context?: unknown) {
    return this.execute("void_body_weight", input, context);
  }
}
