/**
 * UX-008: adjustment for a while.
 *
 * All data is synthetic (plan fixture "Push Pull Legs angepasst", pfx-v2).
 * The clock is fixed in every test; no test depends on the time or zone of
 * the machine it runs on.
 */
import { describe, expect, it } from "vitest";
import { harness, type Harness } from "./fixtures/arnold-plan";
import {
  adjustmentPeriod,
  appliesAt,
  isBasicExercise,
  runningAdjustment,
  shortenSession,
  trainingView,
  type AdjustedItem,
} from "../src/server/plan/adjustment-rules";
import { estimateSessionMinutes } from "../src/analytics/session-duration";
import { exerciseBudget } from "../src/shared/onboarding-profile";
import { nextSession } from "../src/analytics/home";
import { prepareAnalyticsInput } from "../src/analytics/eligibility";
import { proposeActivePlan } from "../src/server/workout/proposal";
import { buildDirectory, planMark } from "../src/server/watch/plan";
import { WorkoutLoggingService } from "../src/server/workout/service";
import { FixtureAuthorizationGuard } from "../src/server/workout/infrastructure";
import {
  PlanAdjustmentWriteResponseSchema,
  type PlanAdjustmentWriteOperation,
} from "../src/shared/plan-adjustment-contract";
import {
  ArnoldDatasetSchema,
  type ArnoldDataset,
  type ArnoldExercise,
  type ArnoldPlanAdjustment,
  type ArnoldPlanItem,
} from "../src/shared/arnold-schema-v1";

// Tuesday, 17 November 2026, 10:00 in Berlin.
const NOW = "2026-11-17T09:00:00Z";
const TZ = "Europe/Berlin";

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

let requests = 0;
const rid = () => `adj-${++requests}`;

async function write(
  h: Harness,
  operation: PlanAdjustmentWriteOperation,
  input: Record<string, unknown>,
) {
  return PlanAdjustmentWriteResponseSchema.parse(
    await h.plans.adjustments.execute(operation, input),
  );
}

async function create(h: Harness, input: Record<string, unknown>) {
  const response = await write(h, "create_plan_adjustment", {
    request_id: rid(),
    timezone: TZ,
    ...input,
  });
  expect(
    response.error,
    `${response.error?.code} ${response.error?.message}`,
  ).toBeNull();
  return response.result!.plan_adjustment;
}

async function confirm(h: Harness, adjustment: ArnoldPlanAdjustment) {
  const response = await write(h, "confirm_plan_adjustment", {
    request_id: rid(),
    plan_adjustment_id: adjustment.plan_adjustment_id,
    expected_row_revision: adjustment.row_revision,
  });
  expect(response.error).toBeNull();
  return response.result!.plan_adjustment;
}

const activeRows = (data: ArnoldDataset) => ({
  plan: data.plans.find((p) => p.plan_version_id === "pfx-v2"),
  items: data.planItems.filter((i) => i.plan_version_id === "pfx-v2"),
});

/** A confirmed adjustment row for the pure rules. */
const row = (
  start: string,
  end: string,
  timezone = TZ,
): ArnoldPlanAdjustment => ({
  plan_adjustment_id: "pa-1",
  plan_version_id: "temp-1",
  base_plan_version_id: "pfx-v2",
  kind: "range",
  start_date_local: start,
  end_date_local: end,
  timezone,
  minutes_per_session: null,
  sessions_per_week: null,
  reason: null,
  status: "confirmed",
  confirmed_at_utc: "2026-11-17T08:00:00.000Z",
  cancelled_at_utc: null,
  created_at_utc: "2026-11-17T08:00:00.000Z",
  updated_at_utc: "2026-11-17T08:00:00.000Z",
  row_revision: 2,
});

describe("days in the user's zone", () => {
  it("means today, until Sunday, until month end", () => {
    expect(adjustmentPeriod("today", "2026-11-17")).toEqual({
      start: "2026-11-17",
      end: "2026-11-17",
      capped: false,
    });
    // Tuesday → Sunday of the same week.
    expect(adjustmentPeriod("week", "2026-11-17").end).toBe("2026-11-22");
    // A Sunday is its own last day.
    expect(adjustmentPeriod("week", "2026-11-22").end).toBe("2026-11-22");
    expect(adjustmentPeriod("month", "2026-11-17").end).toBe("2026-11-30");
    expect(adjustmentPeriod("month", "2028-02-03").end).toBe("2028-02-29");
    expect(adjustmentPeriod("month", "2026-12-31").end).toBe("2026-12-31");
  });

  it("applies from local midnight of the first day to local midnight after the last", () => {
    const a = row("2026-11-20", "2026-11-22");
    // Berlin is UTC+1 in November.
    expect(appliesAt(a, new Date("2026-11-19T22:59:59Z"))).toBe(false);
    expect(appliesAt(a, new Date("2026-11-19T23:00:00Z"))).toBe(true);
    expect(appliesAt(a, new Date("2026-11-22T22:59:59Z"))).toBe(true);
    expect(appliesAt(a, new Date("2026-11-22T23:00:00Z"))).toBe(false);
  });

  it("counts midnight in the adjustment's own zone, east and west of UTC", () => {
    const tokyo = row("2026-11-20", "2026-11-20", "Asia/Tokyo"); // UTC+9
    expect(appliesAt(tokyo, new Date("2026-11-19T14:59:59Z"))).toBe(false);
    expect(appliesAt(tokyo, new Date("2026-11-19T15:00:00Z"))).toBe(true);
    expect(appliesAt(tokyo, new Date("2026-11-20T14:59:59Z"))).toBe(true);
    expect(appliesAt(tokyo, new Date("2026-11-20T15:00:00Z"))).toBe(false);
    const la = row("2026-11-20", "2026-11-20", "America/Los_Angeles"); // UTC-8
    expect(appliesAt(la, new Date("2026-11-20T07:59:59Z"))).toBe(false);
    expect(appliesAt(la, new Date("2026-11-20T08:00:00Z"))).toBe(true);
    expect(appliesAt(la, new Date("2026-11-21T07:59:59Z"))).toBe(true);
    expect(appliesAt(la, new Date("2026-11-21T08:00:00Z"))).toBe(false);
  });

  it("never applies a draft or a cancelled adjustment", () => {
    const at = new Date("2026-11-20T12:00:00Z");
    expect(
      appliesAt({ ...row("2026-11-20", "2026-11-20"), status: "draft" }, at),
    ).toBe(false);
    expect(
      appliesAt(
        { ...row("2026-11-20", "2026-11-20"), status: "cancelled" },
        at,
      ),
    ).toBe(false);
  });
});

describe("shortening a session to the minutes", () => {
  const exercise = (id: string, family: string): ArnoldExercise =>
    ({
      exercise_id: id,
      family_key: family,
      primary_muscle: id,
    }) as unknown as ArnoldExercise;
  const exercises = new Map(
    [
      ["curl", "curl"],
      ["squat", "squat"],
      ["raise", "raise"],
      ["bench", "press"],
      ["row", "row"],
      ["crunch", "flexion"],
    ].map(([id, family]) => [id, exercise(id, family)]),
  );
  const item = (id: string, order: number): AdjustedItem => ({
    source: {
      exercise_order: order,
      exercise_id: id,
    } as unknown as ArnoldPlanItem,
    exercise_id: id,
    target_sets: 4,
    rest_seconds: 180,
    replaced: false,
  });
  const session = ["curl", "squat", "raise", "bench", "row", "crunch"].map(
    (id, i) => item(id, i + 1),
  );

  it("keeps the basic exercises first, at most the budget of UX-012, in plan order", () => {
    const short = shortenSession(session, exercises, 20);
    expect(short.length).toBeLessThanOrEqual(exerciseBudget(20).max);
    expect(
      short.every((i) => isBasicExercise(exercises.get(i.exercise_id))),
    ).toBe(true);
    expect(short.map((i) => i.exercise_id)).toEqual(["squat", "bench", "row"]);
  });

  it("fits the estimate and lowers sets and rests", () => {
    for (const minutes of [10, 15, 20, 25, 45]) {
      const short = shortenSession(session, exercises, minutes);
      const estimate = estimateSessionMinutes(
        short.map((i) => ({
          sets: i.target_sets,
          rest_seconds: i.rest_seconds,
        })),
      )!;
      expect(estimate, `${minutes} min`).toBeLessThanOrEqual(minutes);
      expect(short.length).toBeGreaterThanOrEqual(1);
      for (const i of short) {
        expect(i.target_sets!).toBeLessThanOrEqual(minutes < 30 ? 2 : 3);
        expect(i.rest_seconds!).toBeLessThanOrEqual(minutes < 30 ? 60 : 90);
      }
    }
  });

  it("keeps an unknown set count unknown", () => {
    const unknown = shortenSession(
      [{ ...item("squat", 1), target_sets: null }],
      exercises,
      20,
    );
    expect(unknown[0]!.target_sets).toBeNull();
  });
});

describe("the three cases of the owner", () => {
  it("„Ich habe heute nur 20 Minuten“: the session due today, shortened, only today", async () => {
    const h = harness("active_ppl", { now: NOW });
    const before = await h.dataset();
    const due = nextSession(prepareAnalyticsInput(before, ALL))!;
    const view = await create(h, { kind: "today", minutes_per_session: 20 });
    expect(view.adjustment).toMatchObject({
      kind: "today",
      status: "draft",
      start_date_local: "2026-11-17",
      end_date_local: "2026-11-17",
    });
    expect(view.normal_from).toBe("2026-11-18");
    expect(view.sessions.map((s) => s.session_id)).toEqual([due.session_id]);
    const [session] = view.sessions;
    expect(session!.exercises.length).toBeLessThanOrEqual(
      exerciseBudget(20).max,
    );
    expect(session!.minutes!).toBeLessThanOrEqual(20);
    // Old → new names only what changed, never the other sessions.
    expect(view.changes.length).toBeGreaterThan(0);
    expect(view.changes.every((c) => c.session_id === due.session_id)).toBe(
      true,
    );
  });

  it("says so instead of adjusting when today was already trained", async () => {
    const h = harness("active_ppl", { now: NOW });
    const logging = new WorkoutLoggingService({
      mode: "fixture",
      trackerId: (await h.dataset()).config.tracker_id,
      store: h.store,
      authorization: new FixtureAuthorizationGuard(
        (await h.dataset()).config.tracker_id,
      ),
      clock: () => new Date(NOW),
    });
    const started = await logging.startWorkout({
      request_id: "w-today",
      workout_date_local: "2026-11-17",
      timezone: TZ,
      session_name: "Pull",
    });
    expect(started.ok, started.error?.message).toBe(true);
    const workout = started.result!.workout!;
    const logged = await logging.logWorkoutSets({
      request_id: "w-today-set",
      workout_id: workout.workout_id,
      sets: [
        {
          exercise_id: "plan-fx-bench",
          set_type: "working",
          reps: 8,
          reps_basis: "total",
          load_kg: 60,
          load_basis: "total",
          implement_count: 1,
          execution_mode: "bilateral_simultaneous",
          side: "both",
        },
      ],
    });
    expect(logged.ok, logged.error?.message).toBe(true);
    const current = (await h.dataset()).workouts.find(
      (w) => w.workout_id === workout.workout_id,
    )!;
    const done = await logging.completeWorkout({
      request_id: "w-today-done",
      workout_id: workout.workout_id,
      expected_row_revision: current.row_revision,
    });
    expect(done.ok, done.error?.message).toBe(true);
    const before = await h.dataset();
    const refused = await write(h, "create_plan_adjustment", {
      request_id: rid(),
      timezone: TZ,
      kind: "today",
      minutes_per_session: 20,
    });
    expect(refused.error?.code).toBe("ALREADY_TRAINED_TODAY");
    expect(refused.error?.message).toContain("schon trainiert");
    expect(await h.dataset()).toEqual(before);
  });

  it("„Ich habe diese Woche wenig Zeit“: until Sunday, fewer days, shorter", async () => {
    const h = harness("active_ppl", { now: NOW });
    const view = await create(h, {
      kind: "week",
      sessions_per_week: 2,
      minutes_per_session: 30,
    });
    expect(view.adjustment.start_date_local).toBe("2026-11-17");
    expect(view.adjustment.end_date_local).toBe("2026-11-22");
    expect(view.sessions).toHaveLength(2);
    for (const s of view.sessions) expect(s.minutes!).toBeLessThanOrEqual(30);
    // Starts with the session that is due next.
    const due = nextSession(prepareAnalyticsInput(await h.dataset(), ALL))!;
    expect(view.sessions[0]!.session_id).toBe(due.session_id);
    expect(
      view.changes.some(
        (c) =>
          c.field === "days_per_week" && c.before === "3" && c.after === "2",
      ),
    ).toBe(true);
  });

  it("„Ich habe diesen Monat keine Zeit“: until month end, short full-body sessions", async () => {
    const h = harness("active_ppl", { now: NOW });
    const view = await create(h, { kind: "month" });
    expect(view.adjustment.end_date_local).toBe("2026-11-30");
    expect(view.normal_from).toBe("2026-12-01");
    expect(view.sessions).toHaveLength(2);
    const data = await h.dataset();
    const muscle = new Map(
      data.exercises.map((e) => [e.exercise_id, e.primary_muscle]),
    );
    for (const s of view.sessions) {
      expect(s.session_name).toMatch(/^Ganzkörper kurz [AB]$/);
      expect(s.minutes!).toBeLessThanOrEqual(30);
      const groups = s.exercises.map((e) => muscle.get(e.exercise_id));
      // A full-body session: no muscle group twice where the plan allows it.
      expect(new Set(groups).size).toBe(groups.length);
    }
  });

  it("a holiday: a range with exercises swapped for what is there", async () => {
    const h = harness("active_ppl", { now: NOW });
    const view = await create(h, {
      kind: "range",
      start_date_local: "2026-12-01",
      end_date_local: "2026-12-14",
      reason: "Urlaub",
      replacements: [
        {
          from_exercise_id: "plan-fx-bench",
          to_exercise_id: "plan-fx-db-bench",
        },
      ],
    });
    const swapped = view.sessions
      .flatMap((s) => s.exercises)
      .find((e) => e.exercise_id === "plan-fx-db-bench")!;
    expect(swapped.replaced).toBe(true);
    const data = await h.dataset();
    const row = data.planItems.find(
      (i) =>
        i.plan_version_id === view.adjustment.plan_version_id &&
        i.exercise_id === "plan-fx-db-bench",
    )!;
    // The planned load of another exercise is unknown, never carried over.
    expect(row.target_load_kg).toBeNull();
  });

  it("refuses a range in the past or longer than 56 days", async () => {
    const h = harness("active_ppl", { now: NOW });
    for (const [start, end] of [
      ["2026-11-16", "2026-11-20"],
      ["2026-11-17", "2027-01-12"],
    ]) {
      const refused = await write(h, "create_plan_adjustment", {
        request_id: rid(),
        timezone: TZ,
        kind: "range",
        start_date_local: start,
        end_date_local: end,
        minutes_per_session: 30,
      });
      expect(refused.error?.code, `${start}..${end}`).toBe("VALIDATION_ERROR");
    }
    // 56 days including the first is still fine.
    await create(h, {
      kind: "range",
      start_date_local: "2026-11-17",
      end_date_local: "2027-01-11",
      minutes_per_session: 30,
    });
  });
});

describe("confirm, return, cancel", () => {
  it("takes effect only once confirmed and never touches the active plan", async () => {
    const h = harness("active_ppl", { now: NOW });
    const before = activeRows(await h.dataset());
    const view = await create(h, { kind: "today", minutes_per_session: 20 });
    // A draft does not apply.
    expect(runningAdjustment(await h.dataset(), new Date(NOW))).toBeNull();
    const done = await confirm(h, view.adjustment);
    expect(done.adjustment.status).toBe("confirmed");
    expect(done.running).toBe(true);
    const after = await h.dataset();
    expect(activeRows(after)).toEqual(before);
    // The stored data still holds against the full contract.
    expect(ArnoldDatasetSchema.safeParse(after).success).toBe(true);
  });

  it("lays the adjustment over the plan for training, and returns by itself after the last day", async () => {
    const h = harness("active_ppl", { now: NOW });
    const view = await create(h, { kind: "today", minutes_per_session: 20 });
    await confirm(h, view.adjustment);
    const data = await h.dataset();
    const temp = view.adjustment.plan_version_id;

    const during = trainingView(data, new Date(NOW));
    expect(
      nextSession(prepareAnalyticsInput(during, ALL))!.plan_version_id,
    ).toBe(temp);
    expect(proposeActivePlan(during).map((p) => p.plan_version_id)).toEqual([
      temp,
    ]);

    // 18 November, 00:00 in Berlin: no write, the normal plan again.
    const next = new Date("2026-11-17T23:00:00Z");
    const afterwards = trainingView(data, next);
    expect(afterwards).toBe(data);
    expect(
      nextSession(prepareAnalyticsInput(afterwards, ALL))!.plan_version_id,
    ).toBe("pfx-v2");
    // One minute earlier it still applies.
    expect(
      runningAdjustment(data, new Date("2026-11-17T22:59:00Z")),
    ).not.toBeNull();
  });

  it("gives the watch the adjusted sessions and a new plan mark", async () => {
    const h = harness("active_ppl", { now: NOW });
    const normal = await h.dataset();
    const normalMark = planMark(normal);
    const view = await create(h, { kind: "today", minutes_per_session: 20 });
    // A draft changes nothing on the watch.
    expect(planMark(trainingView(await h.dataset(), new Date(NOW)))).toBe(
      normalMark,
    );
    await confirm(h, view.adjustment);
    const during = trainingView(await h.dataset(), new Date(NOW));
    const directory = buildDirectory(during, "de");
    expect(directory.p).toBe(view.adjustment.plan_version_id);
    expect(directory.days.map((d) => d.id)).toEqual(
      view.sessions.map((s) => s.session_id),
    );
    expect(planMark(during)).not.toBe(normalMark);
    // After the last day the watch gets the normal plan with its old mark.
    expect(
      planMark(
        trainingView(await h.dataset(), new Date("2026-11-18T06:00:00Z")),
      ),
    ).toBe(normalMark);
  });

  it("cancels at once, also while running", async () => {
    const h = harness("active_ppl", { now: NOW });
    const view = await create(h, { kind: "week", minutes_per_session: 30 });
    const confirmed = await confirm(h, view.adjustment);
    const response = await write(h, "cancel_plan_adjustment", {
      request_id: rid(),
      plan_adjustment_id: confirmed.adjustment.plan_adjustment_id,
      expected_row_revision: confirmed.adjustment.row_revision,
    });
    expect(response.result!.plan_adjustment.adjustment.status).toBe(
      "cancelled",
    );
    expect(runningAdjustment(await h.dataset(), new Date(NOW))).toBeNull();
  });

  it("refuses an overlapping adjustment with a readable text", async () => {
    const h = harness("active_ppl", { now: NOW });
    const week = await create(h, { kind: "week", minutes_per_session: 30 });
    // Two drafts may overlap; the second confirmation is refused.
    const today = await create(h, { kind: "today", minutes_per_session: 20 });
    await confirm(h, week.adjustment);
    const refused = await write(h, "confirm_plan_adjustment", {
      request_id: rid(),
      plan_adjustment_id: today.adjustment.plan_adjustment_id,
      expected_row_revision: today.adjustment.row_revision,
    });
    expect(refused.error?.code).toBe("ADJUSTMENT_OVERLAP");
    expect(refused.error?.message).toBe(
      "Vom Di. 17.11. bis So. 22.11. gilt schon eine Anpassung. Sag sie zuerst ab oder wähle einen anderen Zeitraum.",
    );
    // A new draft for those days is refused right away.
    const again = await write(h, "create_plan_adjustment", {
      request_id: rid(),
      timezone: TZ,
      kind: "range",
      start_date_local: "2026-11-22",
      end_date_local: "2026-11-24",
      minutes_per_session: 30,
    });
    expect(again.error?.code).toBe("ADJUSTMENT_OVERLAP");
    // The day after the week is free.
    await create(h, {
      kind: "range",
      start_date_local: "2026-11-23",
      end_date_local: "2026-11-24",
      minutes_per_session: 30,
    });
  });

  it("is idempotent per request_id and refuses a reused id for another payload", async () => {
    const h = harness("active_ppl", { now: NOW });
    const input = {
      request_id: "same-id",
      timezone: TZ,
      kind: "today",
      minutes_per_session: 20,
    };
    const first = await write(h, "create_plan_adjustment", input);
    const second = await write(h, "create_plan_adjustment", input);
    expect(first.ok && second.ok).toBe(true);
    expect(second.replayed).toBe(true);
    expect(second.result).toEqual(first.result);
    expect((await h.dataset()).planAdjustments).toHaveLength(1);
    const other = await write(h, "create_plan_adjustment", {
      ...input,
      minutes_per_session: 25,
    });
    expect(other.error?.code).toBe("DUPLICATE_OPERATION");
    expect((await h.dataset()).planAdjustments).toHaveLength(1);
  });
});

describe("temporary versions stay out of the plan flows", () => {
  it("are never listed, a draft, comparable, a basis or activatable", async () => {
    const h = harness("active_ppl", { now: NOW });
    const view = await create(h, { kind: "today", minutes_per_session: 20 });
    const temp = view.adjustment.plan_version_id;
    const ids = (await h.plans.list()).families.flatMap((f) =>
      f.versions.map((v) => v.plan_version_id),
    );
    expect(ids).not.toContain(temp);
    expect(
      (await h.plans.history()).entries.map((e) => e.version.plan_version_id),
    ).not.toContain(temp);
    const context = await h.plans.context({});
    expect(context.drafts.map((d) => d.plan_version_id)).not.toContain(temp);
    await expect(h.plans.getPlan({ plan_version_id: temp })).rejects.toThrow();
    await expect(
      h.plans.compare({
        from_plan_version_id: "pfx-v2",
        to_plan_version_id: temp,
      }),
    ).rejects.toThrow();
    for (const [operation, input] of [
      [
        "activate_training_plan",
        {
          plan_version_id: temp,
          expected_row_revision: 1,
          confirmation: {
            plan_version_id: temp,
            row_revision: 1,
            confirmed: true,
          },
        },
      ],
      [
        "archive_plan_draft",
        { plan_version_id: temp, expected_row_revision: 1 },
      ],
      [
        "update_plan_draft",
        {
          plan_version_id: temp,
          expected_row_revision: 1,
          edits: [
            { type: "rename_session", session_id: "x", session_name: "y" },
          ],
        },
      ],
      ["create_plan_version", { source_plan_version_id: temp }],
    ] as const) {
      const error = await h.fails(operation, { request_id: rid(), ...input });
      expect(error.code, operation).toBe("PLAN_VERSION_NOT_FOUND");
    }
    // The active plan is still the one the plan tools report.
    expect((await h.plans.getPlan()).plan.plan_version_id).toBe("pfx-v2");
  });

  it("records a workout on a temporary version only once it was confirmed", async () => {
    const h = harness("active_ppl", { now: NOW });
    const view = await create(h, { kind: "today", minutes_per_session: 20 });
    const trackerId = (await h.dataset()).config.tracker_id;
    const logging = new WorkoutLoggingService({
      mode: "fixture",
      trackerId,
      store: h.store,
      authorization: new FixtureAuthorizationGuard(trackerId),
      clock: () => new Date(NOW),
    });
    const start = (request_id: string) =>
      logging.startWorkout({
        request_id,
        workout_date_local: "2026-11-17",
        timezone: TZ,
        session_name: view.sessions[0]!.session_name,
        plan_version_id: view.adjustment.plan_version_id,
        session_id: view.sessions[0]!.session_id,
      });
    expect((await start("w-draft")).error?.code).toBe("VALIDATION_ERROR");
    await confirm(h, view.adjustment);
    const started = await start("w-confirmed");
    expect(started.ok, started.error?.message).toBe(true);
  });
});
