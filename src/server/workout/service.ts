import { recoveryFor } from "../../shared/write-recovery.js";
import { z } from "zod";
import { analyzeSetLoad } from "../../analytics/load.js";
import {
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
import { STORAGE_RETRY_MESSAGE, commitWrite } from "../plan/commit.js";
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
import { buildGoalChange, isGoalOperation } from "./goals.js";

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
    event_type: events[operation],
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
  async execute(
    operation: WriteOperation,
    raw: unknown,
    context?: unknown,
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
      const hash = fingerprint({ operation, input });
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
  private async build(
    operation: WriteOperation,
    raw: unknown,
    data: ArnoldDataset,
    _actor: Actor,
    context: unknown,
    now: string,
  ): Promise<{ changes: EntityChange[]; result: WriteResult }> {
    if (isGoalOperation(operation))
      return buildGoalChange(operation, raw, data, now, () => this.id());
    const changes: EntityChange[] = [];
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
          const active = data.plans.find(
            (p) =>
              p.status === "active" &&
              p.activated_at_utc !== null &&
              p.activated_at_utc.slice(0, 10) <= input.workout_date_local,
          );
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
        if (
          plan &&
          !data.plans.some(
            (p) => p.plan_version_id === plan && p.status !== "draft",
          )
        )
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
    return { changes, result };
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
