/**
 * The week tools of the run service (RUN-008): `schedule_run_week` in two
 * steps and `get_run_week`. The preview changes nothing; the confirmation
 * writes the proposal the user saw, once (request_id), through `commitWrite`
 * with audit and receipt in one transaction, and moves the level of each run
 * session to the level Arnold planned it at.
 */
import { addDays, weekStart } from "../../analytics/period.js";
import {
  RUN_RULES_VERSION,
  weekContext,
} from "../../analytics/running/index.js";
import {
  ArnoldPlanRunSessionSchema,
  ArnoldRunSchema,
  ArnoldWorkoutSchema,
  type ArnoldDataset,
  type ArnoldRun,
  type ArnoldWorkout,
} from "../../shared/arnold-schema-v1.js";
import {
  GetRunWeekInputSchema,
  RunWeekResponseSchema,
  ScheduleRunWeekInputSchema,
  ScheduleRunWeekResponseSchema,
  type RunWeekResponse,
  type RunWeekRun,
  type ScheduleRunWeekInput,
  type ScheduleRunWeekResponse,
  type ScheduleRunWeekResult,
} from "../../shared/run-contract.js";
import type { WriteResult } from "../../shared/workout-contract.js";
import { commitWrite } from "../plan/commit.js";
import {
  WriteError,
  fingerprint,
  uuid7,
  type Actor,
  type AuditEvent,
  type EntityChange,
} from "../workout/infrastructure.js";
import { errorBody, type RunService } from "./service.js";
import {
  WINDOW_DAYS,
  activeRunPlan,
  buildWeekSetup,
  levelChanges,
  previewHash,
  previewResult,
  proposeWeek,
  proposedRun,
  weekDays,
} from "./week.js";
import { localDay } from "./views.js";
import type { RunWeekSchedule } from "../../analytics/running/index.js";

/** Whole-week summary line of the receipt. */
const RECEIPT_NOTE = "Woche geplant";

function plannedRunRow(
  id: string,
  run: RunWeekSchedule["runs"][number],
  now: string,
): ArnoldRun {
  return ArnoldRunSchema.parse({
    workout_id: id,
    run_type: run.run_type,
    environment: run.environment,
    prescription: run.plan.prescription,
    rationale: run.plan.rationale.join("\n"),
    rules_version: run.plan.rules_version,
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

function weekAudit(
  requestId: string,
  changes: readonly EntityChange[],
  actor: Actor,
  now: string,
): AuditEvent[] {
  const events: AuditEvent[] = [];
  for (const change of changes) {
    const id =
      "workout_id" in change.after
        ? change.after.workout_id
        : "plan_run_session_id" in change.after
          ? change.after.plan_run_session_id
          : null;
    if (id === null) continue;
    let event_type: AuditEvent["event_type"];
    let fields: Record<string, { before: unknown; after: unknown }>;
    if (change.table === "workouts") {
      event_type = "WORKOUT_CREATED";
      fields = {
        status: { before: null, after: change.after.status },
        workout_date_local: {
          before: null,
          after: change.after.workout_date_local,
        },
      };
    } else if (change.table === "runs") {
      event_type = "RUN_CREATED";
      fields = {
        run_type: { before: null, after: change.after.run_type },
        environment: { before: null, after: change.after.environment },
      };
    } else if (change.table === "planRunSessions") {
      event_type = "SESSION_UPDATED";
      fields = {
        level: {
          before: change.before?.template.level ?? null,
          after: change.after.template.level,
        },
      };
    } else continue;
    events.push({
      operation_id: requestId,
      event_type,
      entity_id: id,
      at: now,
      actor: actor.subject,
      previous_revision: change.before?.row_revision ?? null,
      new_revision: change.after.row_revision,
      result: "verified",
      changed_fields: Object.keys(fields),
      correction_reason: null,
      changes: fields,
    });
  }
  return events;
}

export class RunWeekService {
  constructor(private readonly runs: RunService) {}

  private clock() {
    return this.runs.options.clock ?? (() => new Date());
  }

  private id() {
    return this.runs.options.id?.() ?? uuid7();
  }

  /* --------------------------------------------------------- schedule */

  async schedule(
    raw: unknown,
    context?: unknown,
  ): Promise<ScheduleRunWeekResponse> {
    const confirm =
      !!raw &&
      typeof raw === "object" &&
      "confirm" in raw &&
      (raw as { confirm?: unknown }).confirm === true;
    const requestId =
      raw &&
      typeof raw === "object" &&
      "request_id" in raw &&
      typeof (raw as { request_id?: unknown }).request_id === "string"
        ? ((raw as { request_id: string }).request_id as string)
        : null;
    const mode = confirm ? "confirmed" : "preview";
    try {
      const actor = await this.runs.actor(context);
      const input = ScheduleRunWeekInputSchema.parse(raw);
      return confirm
        ? await this.confirm(input, actor)
        : await this.preview(input);
    } catch (error) {
      return ScheduleRunWeekResponseSchema.parse({
        ok: false,
        mode,
        request_id: requestId,
        replayed: false,
        result: null,
        error: errorBody(error),
      });
    }
  }

  private async preview(
    input: ScheduleRunWeekInput,
  ): Promise<ScheduleRunWeekResponse> {
    const data = await this.runs.options.store.read();
    const today = localDay(this.clock()().toISOString(), input.timezone);
    const setup = buildWeekSetup(data, today, input.focus);
    const schedule = proposeWeek(setup);
    return ScheduleRunWeekResponseSchema.parse({
      ok: true,
      mode: "preview",
      request_id: null,
      replayed: false,
      result: previewResult(data, setup, schedule),
      error: null,
    });
  }

  private async confirm(
    input: ScheduleRunWeekInput,
    actor: Actor,
  ): Promise<ScheduleRunWeekResponse> {
    const store = this.runs.options.store;
    const requestId = input.request_id!;
    const outcome = await commitWrite<WriteResult>({
      trackerId: this.runs.options.trackerId,
      store,
      requestId,
      fingerprint: fingerprint({ operation: "schedule_run_week", input }),
      actorSubject: actor.subject,
      clock: this.clock(),
      build: (dataset, now) => {
        const today = localDay(now, input.timezone);
        const setup = buildWeekSetup(dataset, today, input.focus);
        const schedule = proposeWeek(setup);
        if (previewHash(setup, schedule) !== input.preview_hash)
          throw new WriteError(
            "CONFIRMATION_REQUIRED",
            "Die Daten haben sich seit der Vorschau geändert, die Woche würde jetzt anders aussehen. Es wurde nichts gespeichert. Erst eine neue Vorschau (confirm weglassen) zeigen und den Nutzer erneut fragen.",
          );
        if (!schedule.runs.length)
          throw new WriteError(
            "VALIDATION_ERROR",
            "In der Vorschau ist kein Lauf geplant; es gibt nichts zu speichern. Es wurde nichts gespeichert.",
          );
        const changes: EntityChange[] = [];
        let first: ArnoldWorkout | null = null;
        for (const run of schedule.runs) {
          const workout = ArnoldWorkoutSchema.parse({
            workout_id: this.id(),
            client_session_id: null,
            workout_date_local: run.date,
            timezone: input.timezone,
            started_at_utc: null,
            ended_at_utc: null,
            plan_version_id: setup.plan.plan_version_id,
            session_id: run.session_id,
            session_name_snapshot: run.session_name,
            status: "planned",
            source: "chat",
            notes: null,
            created_at_utc: now,
            updated_at_utc: now,
            row_revision: 1,
            activity_type: "run",
          });
          first ??= workout;
          changes.push({ table: "workouts", before: null, after: workout });
          changes.push({
            table: "runs",
            before: null,
            after: plannedRunRow(workout.workout_id, run, now),
          });
        }
        // The level moves with the planning, else a session would only ever
        // step up once.
        for (const change of levelChanges(setup, schedule))
          if (change.from !== change.to) {
            const row = setup.sessions.find(
              (s) => s.session_id === change.session_id,
            )!;
            changes.push({
              table: "planRunSessions",
              before: row,
              after: ArnoldPlanRunSessionSchema.parse({
                ...row,
                template: { ...row.template, level: change.to },
                row_revision: row.row_revision + 1,
              }),
            });
          }
        return {
          changes,
          result: {
            workout: first,
            sets: [],
            exercise: null,
            warnings: [RECEIPT_NOTE, ...schedule.notes.map((n) => n.text)],
          },
          audit: weekAudit(requestId, changes, actor, now),
        };
      },
    });
    // The answer is read back from the stored rows, also for a replay.
    const data = await store.read();
    const today = localDay(this.clock()().toISOString(), input.timezone);
    const result = this.confirmedResult(
      data,
      today,
      input,
      outcome.result.warnings.filter((w) => w !== RECEIPT_NOTE),
    );
    return ScheduleRunWeekResponseSchema.parse({
      ok: true,
      mode: "confirmed",
      request_id: requestId,
      replayed: outcome.replayed,
      result,
      error: null,
    });
  }

  /** The week as stored after the confirmation. */
  private confirmedResult(
    data: ArnoldDataset,
    today: string,
    input: ScheduleRunWeekInput,
    notes: readonly string[],
  ): ScheduleRunWeekResult {
    const active = activeRunPlan(data);
    const to = addDays(today, WINDOW_DAYS - 1);
    const profile = data.runProfiles[0];
    const setup = profile ? buildWeekSetup(data, today, input.focus) : null;
    const context = setup ? weekContext(setup.input) : null;
    return {
      rules_version: RUN_RULES_VERSION,
      from: today,
      to,
      phase: context?.phase ?? "none",
      deload: context?.deload ?? false,
      volume_cap_minutes: context?.volume.minutes ?? 0,
      max_hard: context?.max_hard ?? 0,
      preview_hash: input.preview_hash!,
      days: weekDays(data, today, to, today, active?.sessions ?? []),
      dropped: [],
      notes: notes.map((text) => ({ code: "note", text })),
      levels: [],
      violations: [],
    };
  }

  /* ------------------------------------------------------------- view */

  async view(raw: unknown, context?: unknown): Promise<RunWeekResponse> {
    await this.runs.actor(context);
    const input = GetRunWeekInputSchema.parse(raw);
    const data = await this.runs.options.store.read();
    const today = localDay(this.clock()().toISOString(), input.timezone);
    const from = weekStart(input.date ?? today);
    const to = addDays(from, 6);
    const active = activeRunPlan(data);
    const sessions = active?.sessions ?? [];
    const days = weekDays(data, from, to, today, sessions);
    const runs = days.flatMap((d) => d.runs);
    const count = (status: RunWeekRun["status"]) =>
      runs.filter((r) => r.status === status).length;
    const completed = runs.filter((r) => r.status === "completed");
    const notes: RunWeekResponse["notes"] = [];
    const suggestions: RunWeekResponse["suggestions"] = [];
    if (to >= today) {
      try {
        const setup = buildWeekSetup(data, today);
        const schedule = proposeWeek(setup);
        for (const run of schedule.runs)
          suggestions.push({
            ...proposedRun(run, setup.sessions),
            date: run.date,
          });
        for (const n of schedule.notes)
          notes.push({
            code: n.code,
            text: n.text,
            ...(n.date ? { date: n.date } : {}),
            ...(n.session_id ? { session_id: n.session_id } : {}),
          });
      } catch (error) {
        if (!(error instanceof WriteError)) throw error;
        notes.push({ code: "no_suggestions", text: error.message });
      }
    }
    return RunWeekResponseSchema.parse({
      today,
      week_start: from,
      week_end: to,
      days,
      summary: {
        runs_planned: count("planned"),
        runs_completed: completed.length,
        runs_missed: count("missed"),
        strength_planned: days.reduce(
          (n, d) => n + d.strength.filter((s) => s.status === "planned").length,
          0,
        ),
        strength_completed: days.reduce(
          (n, d) =>
            n + d.strength.filter((s) => s.status === "completed").length,
          0,
        ),
        run_minutes_completed: completed.some((r) => r.timer_s === null)
          ? null
          : completed.reduce((sum, r) => sum + (r.timer_s ?? 0), 0) / 60,
      },
      sessions: sessions.map((s) => ({
        session_id: s.session_id,
        session_name: s.session_name,
        run_type: s.run_type,
        level: s.template.level,
        preferred_weekday: s.preferred_weekday,
      })),
      suggestions,
      notes,
    });
  }
}
