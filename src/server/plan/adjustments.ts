/**
 * Adjustment for a while (UX-008): the service that writes adjustments.
 *
 * Three writes, each through `commitWrite` (revision, request_id, audit and
 * receipt in one transaction, serialised per user):
 *
 *   - create: a draft adjustment plus its temporary plan version, built from
 *     the active plan by the pure rules in adjustment-rules.ts;
 *   - confirm: makes it apply on its days; refused when it overlaps another
 *     confirmed adjustment;
 *   - cancel: a draft or a confirmed one, also while it runs; the normal plan
 *     applies again at once.
 *
 * The active plan is never written. The temporary version is frozen from the
 * moment it is created; changing an adjustment means cancelling it and
 * creating a new one.
 */
import {
  PLAN_ADJUSTMENT_MAX_DAYS,
  ArnoldPlanAdjustmentSchema,
  ArnoldPlanItemSchema,
  ArnoldPlanVersionSchema,
  type ArnoldDataset,
  type ArnoldExercise,
  type ArnoldPlanAdjustment,
  type ArnoldPlanItem,
  type ArnoldPlanVersion,
} from "../../shared/arnold-schema-v1.js";
import {
  GetPlanAdjustmentsInputSchema,
  PlanAdjustmentErrorCodeSchema,
  PlanAdjustmentInputs,
  PlanAdjustmentListSchema,
  PlanAdjustmentWriteResponseSchema,
  type PlanAdjustmentErrorCode,
  type PlanAdjustmentList,
  type PlanAdjustmentResult,
  type PlanAdjustmentView,
  type PlanAdjustmentWriteOperation,
  type PlanAdjustmentWriteResponse,
} from "../../shared/plan-adjustment-contract.js";
import { recoveryFor } from "../../shared/write-recovery.js";
import { prepareAnalyticsInput } from "../../analytics/eligibility.js";
import { nextSession } from "../../analytics/home.js";
import { addDays, daysBetween } from "../../analytics/period.js";
import { estimateSessionMinutes } from "../../analytics/session-duration.js";
import {
  WriteError,
  fingerprint,
  type Actor,
  type ArnoldStore,
  type AuditEvent,
  type EntityChange,
} from "../workout/infrastructure.js";
import { localDayOf } from "../reference-day.js";
import { commitWrite, STORAGE_RETRY_MESSAGE } from "./commit.js";
import { diffVersions } from "./comparison.js";
import { activePlan, projectVersion } from "./domain.js";
import { PlanError } from "./errors.js";
import {
  adjustedSessions,
  adjustmentPeriod,
  appliesAt,
  overlapping,
  runningAdjustment,
  sessionsOfVersion,
  type AdjustedSession,
} from "./adjustment-rules.js";
import type { TrainingPlanService } from "./service.js";

class AdjustmentError extends Error {
  constructor(
    readonly code: PlanAdjustmentErrorCode,
    message: string,
    readonly retryable = false,
    readonly details: string[] = [],
  ) {
    super(message);
  }
}
const fail = (code: PlanAdjustmentErrorCode, message: string) =>
  new AdjustmentError(code, message);

function toAdjustmentError(error: unknown): AdjustmentError {
  if (error instanceof AdjustmentError) return error;
  if (error instanceof PlanError || error instanceof WriteError) {
    const mapped = PlanAdjustmentErrorCodeSchema.safeParse(error.code);
    return new AdjustmentError(
      mapped.success ? mapped.data : "VALIDATION_ERROR",
      error.message,
      error.retryable,
      error.details,
    );
  }
  if (error && typeof error === "object" && "issues" in error)
    return new AdjustmentError(
      "VALIDATION_ERROR",
      "Eingaben sind nicht eindeutig oder ungültig.",
      false,
      (error as { issues: { path: PropertyKey[]; message: string }[] }).issues
        .slice(0, 5)
        .map((i) => `${i.path.map(String).join(".")}: ${i.message}`),
    );
  return new AdjustmentError(
    "STORAGE_UNAVAILABLE",
    STORAGE_RETRY_MESSAGE,
    true,
  );
}

/** "Mo., 24.11." — short, readable aloud. */
export function dayLabel(date: string): string {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  const weekday = ["So.", "Mo.", "Di.", "Mi.", "Do.", "Fr.", "Sa."][
    new Date(Date.UTC(y, m - 1, d)).getUTCDay()
  ];
  return `${weekday} ${String(d).padStart(2, "0")}.${String(m).padStart(2, "0")}.`;
}

const ALL = {
  from: null,
  to: null,
  exercise_ids: null,
  plan_version_ids: null,
  session_ids: null,
  workout_ids: null,
  set_types: null,
  workout_statuses: null,
} as const;

/** The display of one adjustment: sessions, old → new, the way back. */
export function adjustmentView(
  dataset: ArnoldDataset,
  adjustment: ArnoldPlanAdjustment,
  now: Date,
  capped = false,
): PlanAdjustmentView {
  const exercises = new Map(dataset.exercises.map((e) => [e.exercise_id, e]));
  const temp = dataset.plans.find(
    (p) => p.plan_version_id === adjustment.plan_version_id,
  )!;
  const base = dataset.plans.find(
    (p) => p.plan_version_id === adjustment.base_plan_version_id,
  )!;
  const sessions = sessionsOfVersion(dataset.planItems, temp.plan_version_id);
  const tempProjection = projectVersion(dataset, temp);
  const baseProjection = projectVersion(dataset, base);
  // Runs stay as they are (UX-008 c); "today" compares just the one session.
  const shown = new Set(sessions.map((s) => s.session_id));
  const from = {
    ...baseProjection,
    run_sessions: undefined,
    sessions:
      adjustment.kind === "today"
        ? baseProjection.sessions.filter((s) => shown.has(s.session_id))
        : baseProjection.sessions,
  };
  const to = { ...tempProjection, run_sessions: undefined };
  return {
    adjustment,
    base_plan_name: base.name,
    sessions: sessions.map((session) => ({
      session_id: session.session_id,
      session_name: session.session_name,
      minutes: estimateSessionMinutes(
        session.items.map((i) => ({
          sets: i.target_sets,
          rest_seconds: i.rest_seconds,
        })),
      ),
      exercises: session.items.map((item) => ({
        exercise_id: item.exercise_id,
        exercise_name:
          exercises.get(item.exercise_id)?.name_de ?? "Unbekannte Übung",
        target_sets: item.target_sets,
        rep_min: item.source.rep_min,
        rep_max: item.source.rep_max,
        rest_seconds: item.rest_seconds,
        replaced: item.source.notes === REPLACED_NOTE,
      })),
    })),
    changes: diffVersions(from, to).filter(
      (c) =>
        c.kind !== "plan_renamed" &&
        c.kind !== "exercise_reordered" &&
        c.kind !== "session_reordered",
    ),
    normal_from: addDays(adjustment.end_date_local, 1),
    runs_unchanged: (dataset.planRunSessions ?? []).some(
      (s) =>
        s.plan_version_id === base.plan_version_id && s.status === "active",
    ),
    capped,
    running: appliesAt(adjustment, now),
  };
}

/** Marks a swapped exercise in the temporary version (it has no own column). */
const REPLACED_NOTE = "Getauscht für diesen Zeitraum";

export class PlanAdjustmentService {
  constructor(
    private readonly plans: TrainingPlanService,
    private readonly options: {
      trackerId: string;
      store: ArnoldStore;
      clock?: () => Date;
      id?: () => string;
    },
  ) {}

  private clock() {
    return this.options.clock?.() ?? new Date();
  }

  private newId() {
    return this.options.id?.() ?? crypto.randomUUID();
  }

  /* ------------------------------------------------------------------ reads */

  async list(raw: unknown = {}, canWrite = true): Promise<PlanAdjustmentList> {
    const input = GetPlanAdjustmentsInputSchema.parse(raw ?? {});
    const dataset = await this.options.store.read();
    const now = this.clock();
    const open = (dataset.planAdjustments ?? []).filter((a) =>
      input.plan_adjustment_id
        ? a.plan_adjustment_id === input.plan_adjustment_id
        : a.status !== "cancelled" &&
          localDayOf(now, a.timezone) <= a.end_date_local,
    );
    if (input.plan_adjustment_id && !open.length)
      throw fail("ADJUSTMENT_NOT_FOUND", "Diese Anpassung gibt es nicht.");
    const running = runningAdjustment(dataset, now);
    return PlanAdjustmentListSchema.parse({
      running: running ? adjustmentView(dataset, running, now) : null,
      adjustments: open
        .sort(
          (a, b) =>
            (a.start_date_local < b.start_date_local ? -1 : 1) ||
            (a.created_at_utc < b.created_at_utc ? 1 : -1),
        )
        .map((a) => adjustmentView(dataset, a, now)),
      can_write: canWrite,
      max_days: PLAN_ADJUSTMENT_MAX_DAYS,
    });
  }

  /* ----------------------------------------------------------------- writes */

  async execute(
    operation: PlanAdjustmentWriteOperation,
    raw: unknown,
    context?: unknown,
  ): Promise<PlanAdjustmentWriteResponse> {
    const requestId =
      raw &&
      typeof raw === "object" &&
      "request_id" in raw &&
      typeof raw.request_id === "string"
        ? raw.request_id
        : "";
    try {
      const actor = await this.plans.actor(context);
      const input = PlanAdjustmentInputs[operation].parse(raw);
      const outcome = await commitWrite<PlanAdjustmentResult>({
        trackerId: this.options.trackerId,
        store: this.options.store,
        requestId: input.request_id,
        fingerprint: fingerprint({ operation, input }),
        actorSubject: actor.subject,
        clock: () => this.clock(),
        build: (dataset, now) =>
          operation === "create_plan_adjustment"
            ? this.buildCreate(
                PlanAdjustmentInputs.create_plan_adjustment.parse(input),
                dataset,
                actor,
                now,
              )
            : this.buildStatus(
                operation,
                PlanAdjustmentInputs.confirm_plan_adjustment.parse(input),
                dataset,
                actor,
                now,
              ),
      });
      return PlanAdjustmentWriteResponseSchema.parse({
        ok: true,
        operation,
        request_id: input.request_id,
        replayed: outcome.replayed,
        result: outcome.result,
        error: null,
      });
    } catch (error) {
      const failure = toAdjustmentError(error);
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

  private event(
    event_type: AuditEvent["event_type"],
    entity_id: string,
    operation_id: string,
    actor: Actor,
    at: string,
    previous: number | null,
    next: number,
    fields: Record<string, { before: unknown; after: unknown }>,
  ): AuditEvent {
    return {
      operation_id,
      event_type,
      entity_id,
      at,
      actor: actor.subject,
      previous_revision: previous,
      new_revision: next,
      result: "verified",
      changed_fields: Object.keys(fields),
      correction_reason: null,
      changes: fields,
    };
  }

  private buildCreate(
    input: ReturnType<
      (typeof PlanAdjustmentInputs)["create_plan_adjustment"]["parse"]
    >,
    dataset: ArnoldDataset,
    actor: Actor,
    nowIso: string,
  ) {
    const now = new Date(nowIso);
    const today = localDayOf(now, input.timezone);
    const base = activePlan(dataset);
    if (!base)
      throw fail(
        "PLAN_NOT_FOUND",
        "Es gibt noch keinen aktiven Plan, den Arnold anpassen könnte.",
      );

    // Days, in the user's zone.
    let start: string, end: string;
    let capped = false;
    if (input.kind === "range") {
      start = input.start_date_local!;
      end = input.end_date_local!;
      if (start < today)
        throw fail(
          "VALIDATION_ERROR",
          "Der Zeitraum beginnt in der Vergangenheit. Eine Anpassung beginnt frühestens heute.",
        );
      if (end < start)
        throw fail("VALIDATION_ERROR", "Das Ende liegt vor dem Anfang.");
      if (daysBetween(start, end) + 1 > PLAN_ADJUSTMENT_MAX_DAYS)
        throw fail(
          "VALIDATION_ERROR",
          `Eine Anpassung auf Zeit dauert höchstens ${PLAN_ADJUSTMENT_MAX_DAYS} Tage.`,
        );
    } else ({ start, end, capped } = adjustmentPeriod(input.kind, today));

    const taken = overlapping(dataset, start, end);
    if (taken) throw overlapError(taken);

    const exercises = new Map(dataset.exercises.map((e) => [e.exercise_id, e]));
    for (const id of [
      ...(input.replacements ?? []).map((r) => r.to_exercise_id),
    ])
      if (exercises.get(id)?.status !== "active")
        throw fail(
          "EXERCISE_NOT_FOUND",
          `Die Übung „${id}“ gibt es im Katalog nicht.`,
        );

    // "today": already trained today, or nothing due, is said, not adjusted.
    const next = nextSession(prepareAnalyticsInput(dataset, ALL));
    if (input.kind === "today") {
      const trained = dataset.workouts.some(
        (w) =>
          (w.activity_type ?? "strength") === "strength" &&
          w.status === "completed" &&
          w.workout_date_local === today,
      );
      if (trained)
        throw fail(
          "ALREADY_TRAINED_TODAY",
          "Heute wurde schon trainiert. Es gibt heute nichts mehr zu kürzen.",
        );
    }
    const sessions = adjustedSessions(
      sessionsOfVersion(dataset.planItems, base.plan_version_id),
      exercises,
      {
        kind: input.kind,
        minutes_per_session: input.minutes_per_session ?? null,
        sessions_per_week: input.sessions_per_week ?? null,
        replacements: input.replacements ?? [],
        remove_exercise_ids: input.remove_exercise_ids ?? [],
      },
      next && next.plan_version_id === base.plan_version_id
        ? next.session_id
        : null,
    );
    if (sessions === "NO_SESSION_TODAY")
      throw fail(
        "NO_SESSION_TODAY",
        "Heute ist keine Krafteinheit geplant. Es gibt nichts zu kürzen.",
      );
    if (sessions === "NO_SESSION_LEFT")
      throw fail(
        "VALIDATION_ERROR",
        "Ohne diese Übungen bleibt keine Einheit übrig. Weniger Übungen weglassen oder andere tauschen.",
      );
    if (sessions === "NOTHING_TO_ADJUST")
      throw fail(
        "VALIDATION_ERROR",
        "Für den Zeitraum ist nichts angegeben, was sich ändern soll: Minuten pro Einheit, Trainingstage pro Woche oder Übungen zum Tauschen.",
      );

    // The temporary version: own family, the base's name, never activated.
    const planVersionId = this.newId();
    const version: ArnoldPlanVersion = ArnoldPlanVersionSchema.parse({
      plan_version_id: planVersionId,
      plan_family_id: this.newId(),
      version_no: 1,
      name: base.name,
      split_key: base.split_key,
      status: "temporary",
      goal_key: base.goal_key,
      days_per_week:
        input.kind === "today"
          ? base.days_per_week
          : input.sessions_per_week !== undefined || input.kind === "month"
            ? sessions.length
            : base.days_per_week,
      activated_at_utc: null,
      retired_at_utc: null,
      created_at_utc: nowIso,
      updated_at_utc: nowIso,
      row_revision: 1,
    });
    const items = sessions.flatMap((session, k) =>
      itemRows(session, k, planVersionId, input.kind, exercises, () =>
        this.newId(),
      ),
    );
    const adjustment = ArnoldPlanAdjustmentSchema.parse({
      plan_adjustment_id: this.newId(),
      plan_version_id: planVersionId,
      base_plan_version_id: base.plan_version_id,
      kind: input.kind,
      start_date_local: start,
      end_date_local: end,
      timezone: input.timezone,
      minutes_per_session: input.minutes_per_session ?? null,
      sessions_per_week: input.sessions_per_week ?? null,
      reason: input.reason ?? null,
      status: "draft",
      confirmed_at_utc: null,
      cancelled_at_utc: null,
      created_at_utc: nowIso,
      updated_at_utc: nowIso,
      row_revision: 1,
    });
    const changes: EntityChange[] = [
      { table: "plans", before: null, after: version },
      ...items.map((after): EntityChange => ({
        table: "planItems",
        before: null,
        after,
      })),
      { table: "planAdjustments", before: null, after: adjustment },
    ];
    const next_dataset = {
      ...dataset,
      plans: [...dataset.plans, version],
      planItems: [...dataset.planItems, ...items],
      planAdjustments: [...(dataset.planAdjustments ?? []), adjustment],
    } as ArnoldDataset;
    return {
      changes,
      result: {
        plan_adjustment: adjustmentView(next_dataset, adjustment, now, capped),
      },
      audit: [
        this.event(
          "PLAN_ADJUSTMENT_CREATED",
          adjustment.plan_adjustment_id,
          input.request_id,
          actor,
          nowIso,
          null,
          1,
          {
            kind: { before: null, after: adjustment.kind },
            start_date_local: { before: null, after: start },
            end_date_local: { before: null, after: end },
            status: { before: null, after: "draft" },
          },
        ),
      ],
    };
  }

  private buildStatus(
    operation: Exclude<PlanAdjustmentWriteOperation, "create_plan_adjustment">,
    input: {
      request_id: string;
      plan_adjustment_id: string;
      expected_row_revision: number;
    },
    dataset: ArnoldDataset,
    actor: Actor,
    nowIso: string,
  ) {
    const now = new Date(nowIso);
    const before = (dataset.planAdjustments ?? []).find(
      (a) => a.plan_adjustment_id === input.plan_adjustment_id,
    );
    if (!before)
      throw fail("ADJUSTMENT_NOT_FOUND", "Diese Anpassung gibt es nicht.");
    if (before.row_revision !== input.expected_row_revision)
      throw fail(
        "REVISION_CONFLICT",
        "Die Anpassung wurde inzwischen geändert. Neu laden und noch einmal versuchen.",
      );
    const confirm = operation === "confirm_plan_adjustment";
    if (confirm) {
      if (before.status !== "draft")
        throw fail(
          "INVALID_STATUS_TRANSITION",
          before.status === "confirmed"
            ? "Diese Anpassung gilt schon."
            : "Diese Anpassung ist abgesagt. Für einen neuen Zeitraum eine neue anlegen.",
        );
      if (localDayOf(now, before.timezone) > before.end_date_local)
        throw fail(
          "VALIDATION_ERROR",
          "Der Zeitraum dieser Anpassung ist schon vorbei.",
        );
      const taken = overlapping(
        dataset,
        before.start_date_local,
        before.end_date_local,
        before.plan_adjustment_id,
      );
      if (taken) throw overlapError(taken);
    } else if (before.status === "cancelled")
      throw fail(
        "INVALID_STATUS_TRANSITION",
        "Diese Anpassung ist schon abgesagt.",
      );

    const after = ArnoldPlanAdjustmentSchema.parse({
      ...before,
      status: confirm ? "confirmed" : "cancelled",
      confirmed_at_utc: confirm ? nowIso : before.confirmed_at_utc,
      cancelled_at_utc: confirm ? null : nowIso,
      updated_at_utc: nowIso,
      row_revision: before.row_revision + 1,
    });
    const next_dataset = {
      ...dataset,
      planAdjustments: (dataset.planAdjustments ?? []).map((a) =>
        a.plan_adjustment_id === after.plan_adjustment_id ? after : a,
      ),
    } as ArnoldDataset;
    return {
      changes: [
        { table: "planAdjustments", before, after } satisfies EntityChange,
      ],
      result: { plan_adjustment: adjustmentView(next_dataset, after, now) },
      audit: [
        this.event(
          confirm ? "PLAN_ADJUSTMENT_CONFIRMED" : "PLAN_ADJUSTMENT_CANCELLED",
          after.plan_adjustment_id,
          input.request_id,
          actor,
          nowIso,
          before.row_revision,
          after.row_revision,
          { status: { before: before.status, after: after.status } },
        ),
      ],
    };
  }
}

function overlapError(taken: ArnoldPlanAdjustment) {
  return fail(
    "ADJUSTMENT_OVERLAP",
    `Vom ${dayLabel(taken.start_date_local)} bis ${dayLabel(taken.end_date_local)} gilt schon eine Anpassung. Sag sie zuerst ab oder wähle einen anderen Zeitraum.`,
  );
}

/** The plan rows of one adjusted session in the temporary version. */
function itemRows(
  session: AdjustedSession,
  index: number,
  planVersionId: string,
  kind: ArnoldPlanAdjustment["kind"],
  exercises: ReadonlyMap<string, ArnoldExercise>,
  id: () => string,
): ArnoldPlanItem[] {
  return session.items.map((item, i) => {
    const exercise = exercises.get(item.exercise_id);
    return ArnoldPlanItemSchema.parse({
      plan_item_id: id(),
      plan_version_id: planVersionId,
      session_id: session.session_id,
      // In the order they come up, starting with the next one due.
      session_order: index + 1,
      session_name: session.session_name,
      exercise_id: item.exercise_id,
      exercise_order: kind === "month" ? i + 1 : item.source.exercise_order,
      target_sets: item.target_sets,
      rep_min: item.source.rep_min,
      rep_max: item.source.rep_max,
      // A swapped exercise has no planned load: unknown, never carried over.
      target_load_kg: item.replaced ? null : item.source.target_load_kg,
      target_load_basis: item.replaced
        ? (exercise?.default_load_basis ?? null)
        : item.source.target_load_basis,
      target_execution_mode: item.replaced
        ? (exercise?.default_execution_mode ?? null)
        : item.source.target_execution_mode,
      target_implement_count: item.replaced
        ? null
        : item.source.target_implement_count,
      rest_seconds: item.rest_seconds,
      notes: item.replaced ? REPLACED_NOTE : item.source.notes,
      status: "active",
      row_revision: 1,
    });
  });
}
