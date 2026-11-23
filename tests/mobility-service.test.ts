/**
 * MOB-005: the mobility service. Synthetic data only.
 *
 * Profile, overview, logging in the chat and the result of the watch. Every
 * write goes through commitWrite (request_id, fingerprint, audit, receipt);
 * mobility is neither load nor a training day.
 */
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { buildDashboardView } from "../src/server/arnold-presenter";
import { buildHomeAnalytics, buildScores } from "../src/analytics";
import { storeSource } from "../src/server/arnold-source";
import { createFixturePlanning } from "../src/server/plan/fixture";
import { createFixtureOnboarding } from "../src/server/onboarding/fixture";
import type { OnboardingService } from "../src/server/onboarding/service";
import type { OnboardingProfilePatch } from "../src/shared/onboarding-contract";
import type { MobilityPreference } from "../src/shared/mobility-contract";
import { mobilityDayInputsOf } from "../src/server/mobility/day";
import { isMobilityWorkout } from "../src/shared/arnold-schema-v1";
import { LogMobilityResponseSchema } from "../src/shared/mobility-contract";
import { harness, NOW, type Harness } from "./fixtures/arnold-plan";

const M = [
  "mob_neck_rolls",
  "mob_neck_side",
  "mob_shoulder_circles",
  "mob_arm_circles",
  "mob_doorway_chest",
];
const F = [
  "mob_cat_cow",
  "mob_childs_pose",
  "mob_thread_needle",
  "mob_open_book",
  "mob_worlds_greatest",
  "mob_kneeling_hip_flexor",
  "mob_pigeon",
];
const BERLIN = "Europe/Berlin";

const morningOp = {
  type: "add_mobility_session",
  kind: "morning",
  session_name: "Morgenroutine",
  minutes: 10,
  exercise_ids: M,
  weekdays: [1, 2, 3, 4, 5, 6, 7],
};
const ownDayOp = {
  type: "add_mobility_session",
  kind: "session",
  session_name: "Beweglichkeit",
  minutes: 20,
  exercise_ids: F,
  weekdays: [1],
};
const afterPushOp = {
  type: "add_mobility_session",
  kind: "session",
  session_name: "Nach dem Push",
  minutes: 15,
  exercise_ids: F.slice(0, 6),
  placement: "after_strength",
  after_session_id: "pfx-s-push",
};

let n = 0;
const rid = () => `r-${++n}-${randomUUID().slice(0, 8)}`;

/** The active plan of the fixture plus mobility routines, activated. */
async function withMobilityPlan(
  h: Harness,
  ops = [morningOp, ownDayOp, afterPushOp],
) {
  const draft = (
    await h.ok("create_plan_version", {
      request_id: rid(),
      source_plan_version_id: "pfx-v2",
    })
  ).plan!.version;
  const edited = (
    await h.ok("update_plan_draft", {
      request_id: rid(),
      plan_version_id: draft.plan_version_id,
      expected_row_revision: draft.row_revision,
      edits: ops,
    })
  ).plan!.version;
  await h.ok("activate_training_plan", {
    request_id: rid(),
    plan_version_id: edited.plan_version_id,
    expected_row_revision: edited.row_revision,
    confirmation: {
      plan_version_id: edited.plan_version_id,
      row_revision: edited.row_revision,
      confirmed: true as const,
    },
  });
  h.advance();
  return edited;
}

const sessionOf = (h: Harness, name: string) =>
  h
    .dataset()
    .then((d) =>
      (d.planMobilitySessions ?? []).find(
        (s) => s.session_name === name && s.status === "active",
      )!,
    );

const wanted = {
  wants: true as const,
  morning: { weekdays: ["mon", "wed"] as const, minutes: 10 as const },
  sessions: null,
  stiff_areas: ["hips" as const],
};

describe("the mobility profile", () => {
  it("is not_asked without a row, then yes or no", async () => {
    const h = harness();
    expect((await h.mobility.getOverview(undefined, BERLIN)).profile).toEqual({
      state: "not_asked",
      preference: null,
    });
    const yes = await h.mobility.updateProfile(
      {
        request_id: rid(),
        preference: {
          ...wanted,
          morning: { weekdays: ["wed", "mon"], minutes: 10 },
        },
      },
      undefined,
    );
    expect(yes.ok).toBe(true);
    expect(yes.profile).toEqual({
      state: "yes",
      preference: {
        wants: true,
        morning: { weekdays: ["mon", "wed"], minutes: 10 },
        sessions: null,
        stiff_areas: ["hips"],
      },
    });
    const no = await h.mobility.updateProfile(
      { request_id: rid(), preference: { wants: false } },
      undefined,
    );
    expect(no.profile).toEqual({ state: "no", preference: { wants: false } });
    // "no" keeps no details in the stored row.
    const row = (await h.dataset()).mobilityProfiles![0]!;
    expect(row).toMatchObject({
      wants: false,
      morning_weekdays: null,
      morning_minutes: null,
      sessions_placement: null,
      stiff_areas: [],
      row_revision: 2,
    });
    expect(
      (await h.mobility.getOverview(undefined, BERLIN)).profile.state,
    ).toBe("no");
  });

  it("replays a repeated request_id and refuses it for another answer", async () => {
    const h = harness();
    const request_id = rid();
    const first = await h.mobility.updateProfile(
      { request_id, preference: wanted },
      undefined,
    );
    const again = await h.mobility.updateProfile(
      { request_id, preference: wanted },
      undefined,
    );
    expect(first.replayed).toBe(false);
    expect(again).toMatchObject({ ok: true, replayed: true });
    const other = await h.mobility.updateProfile(
      { request_id, preference: { wants: false } },
      undefined,
    );
    expect(other.ok).toBe(false);
    expect(other.error?.code).toBe("DUPLICATE_OPERATION");
    expect((await h.dataset()).mobilityProfiles).toHaveLength(1);
  });

  it("writes nothing for an answer that equals the stored one", async () => {
    const h = harness();
    await h.mobility.updateProfile(
      { request_id: rid(), preference: wanted },
      undefined,
    );
    const again = await h.mobility.updateProfile(
      { request_id: rid(), preference: wanted },
      undefined,
    );
    expect(again.ok).toBe(true);
    expect((await h.dataset()).mobilityProfiles![0]!.row_revision).toBe(1);
  });

  it("audits the change with values only", async () => {
    const h = harness();
    const request_id = rid();
    await h.mobility.updateProfile(
      { request_id, preference: wanted },
      undefined,
    );
    const events = [...h.store.audit.events.values()].filter(
      (e) => e.operation_id === request_id,
    );
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      event_type: "MOBILITY_PROFILE_UPDATED",
      previous_revision: null,
      new_revision: 1,
    });
    expect(JSON.stringify(events[0]!.changes)).not.toContain("hips");
  });

  it("refuses an answer without details for a yes and an unknown field", async () => {
    const h = harness();
    const bad = await h.mobility.updateProfile(
      {
        request_id: rid(),
        preference: {
          wants: true,
          morning: null,
          sessions: null,
          stiff_areas: [],
        },
      },
      undefined,
    );
    expect(bad.error?.code).toBe("VALIDATION_ERROR");
    const user = await h.mobility.updateProfile(
      { request_id: rid(), preference: { wants: false }, user_id: "someone" },
      undefined,
    );
    expect(user.error?.code).toBe("VALIDATION_ERROR");
    expect((await h.dataset()).mobilityProfiles ?? []).toHaveLength(0);
  });
});

describe("the overview", () => {
  it("shows today's routines of the active plan, after strength only when it is next", async () => {
    const h = harness();
    await withMobilityPlan(h);
    // 2026-06-01 is a Monday.
    const overview = await h.mobility.getOverview(undefined, BERLIN);
    expect(overview.today.date_local).toBe("2026-06-01");
    expect(
      overview.today.items.map((i) => [i.session_name, i.kind, i.done]),
    ).toEqual([
      ["Morgenroutine", "morning", false],
      ["Beweglichkeit", "session", false],
      ["Nach dem Push", "session", false],
    ]);
    expect(overview.today.items[0]!.template.exercise_ids).toEqual(M);
    // Not Monday: only the morning routine and what follows the next strength.
    const tuesday = harness(undefined, { now: "2026-06-02T08:00:00Z" });
    await withMobilityPlan(tuesday);
    expect(
      (await tuesday.mobility.getOverview(undefined, BERLIN)).today.items.map(
        (i) => i.session_name,
      ),
    ).toEqual(["Morgenroutine", "Nach dem Push"]);
  });

  it("leaves a routine after strength out when another strength session is next", async () => {
    const h = harness();
    await withMobilityPlan(h, [
      morningOp,
      { ...afterPushOp, after_session_id: "pfx-s-legs" },
    ]);
    const inputs = mobilityDayInputsOf(await h.dataset());
    expect(inputs.next_strength_session_id).not.toBe("pfx-s-legs");
    expect(
      (await h.mobility.getOverview(undefined, BERLIN)).today.items.map(
        (i) => i.session_name,
      ),
    ).toEqual(["Morgenroutine"]);
  });

  it("marks a routine done after it was logged and lists it as recent", async () => {
    const h = harness();
    await withMobilityPlan(h);
    const morning = await sessionOf(h, "Morgenroutine");
    const logged = await h.mobility.logMobility(
      {
        request_id: rid(),
        kind: "morning",
        session_id: morning.session_id,
        timezone: BERLIN,
      },
      undefined,
    );
    expect(logged.ok).toBe(true);
    const overview = await h.mobility.getOverview(undefined, BERLIN);
    expect(overview.today.items.find((i) => i.kind === "morning")!.done).toBe(
      true,
    );
    expect(overview.recent).toEqual([
      {
        workout_id: logged.workout_id,
        date_local: "2026-06-01",
        kind: "morning",
        session_name: "Morgenroutine",
        timer_s: null,
        exercises_done: M.length,
        exercises_total: M.length,
        source: "chat",
      },
    ]);
  });

  it("counts adherence from the activation day and never shows 0 without a plan", async () => {
    const none = harness();
    expect(
      (await none.mobility.getOverview(undefined, BERLIN)).adherence,
    ).toMatchObject({
      planned_count: 0,
      done_count: 0,
      ratio: null,
      streak_days: 0,
      days: 28,
    });
    const h = harness(undefined, { now: "2026-06-04T08:00:00Z" });
    await withMobilityPlan(h, [morningOp]);
    // Activated Thursday 2026-06-04: nothing before counts as missed.
    const morning = await sessionOf(h, "Morgenroutine");
    expect(
      (await h.mobility.getOverview(undefined, BERLIN)).adherence,
    ).toMatchObject({
      planned_count: 0,
      ratio: null,
    });
    await h.mobility.logMobility(
      {
        request_id: rid(),
        kind: "morning",
        session_id: morning.session_id,
        timezone: BERLIN,
      },
      undefined,
    );
    const done = (await h.mobility.getOverview(undefined, BERLIN)).adherence;
    expect(done).toMatchObject({
      planned_count: 1,
      done_count: 1,
      ratio: 1,
      streak_days: 1,
    });
  });

  it("refuses without a time zone when the user has no earlier workout, and uses the last one otherwise", async () => {
    const h = harness("draft_only");
    const error = await h.mobility.getOverview(undefined).catch((e) => e);
    expect(String(error.message)).toContain("Zeitzone");
    const withWorkout = harness();
    // The fixture's workouts were logged in Europe/Berlin.
    expect(
      (await withWorkout.mobility.getOverview(undefined)).today.date_local,
    ).toBe("2026-06-01");
    await expect(
      withWorkout.mobility.getOverview(undefined, "Mars/Olympus"),
    ).rejects.toThrow(/Zeitzone/);
  });
});

describe("log_mobility", () => {
  it("saves a routine of the plan with workout, result and audit in one step", async () => {
    const h = harness();
    await withMobilityPlan(h);
    const morning = await sessionOf(h, "Morgenroutine");
    const request_id = rid();
    const input = {
      request_id,
      kind: "morning" as const,
      session_id: morning.session_id,
      minutes: 9,
      timezone: BERLIN,
    };
    const first = LogMobilityResponseSchema.parse(
      await h.mobility.logMobility(input, undefined),
    );
    expect(first).toMatchObject({ ok: true, replayed: false });
    const data = await h.dataset();
    const workout = data.workouts.find(
      (w) => w.workout_id === first.workout_id,
    )!;
    expect(workout).toMatchObject({
      activity_type: "mobility",
      status: "completed",
      source: "chat",
      workout_date_local: "2026-06-01",
      plan_version_id: morning.plan_version_id,
      session_id: morning.session_id,
      session_name_snapshot: "Morgenroutine",
    });
    expect(workout.client_session_id ?? null).toBeNull();
    expect(
      data.mobilityResults!.find((r) => r.workout_id === first.workout_id),
    ).toMatchObject({
      kind: "morning",
      result_source: "chat",
      ended_early: false,
      minutes_planned: 10,
      timer_s: 540,
      elapsed_s: null,
      exercises_total: M.length,
      exercises_done: M.length,
      exercises_skipped: 0,
      items: [],
      catalog_version: morning.template.catalog_version,
      rules_version: morning.template.rules_version,
    });
    const events = [...h.store.audit.events.values()].filter(
      (e) => e.operation_id === request_id,
    );
    expect(events.map((e) => e.event_type).sort()).toEqual([
      "MOBILITY_LOGGED",
      "WORKOUT_LOGGED",
    ]);
    // The same request_id replays and stores nothing more.
    const again = await h.mobility.logMobility(input, undefined);
    expect(again).toMatchObject({
      ok: true,
      replayed: true,
      workout_id: first.workout_id,
    });
    expect((await h.dataset()).workouts.filter(isMobilityWorkout)).toHaveLength(
      1,
    );
    // The same request_id for other content is refused.
    const other = await h.mobility.logMobility(
      { ...input, minutes: 5 },
      undefined,
    );
    expect(other.error?.code).toBe("DUPLICATE_OPERATION");
  });

  it("takes the morning routine of the plan when no session_id is given", async () => {
    const h = harness();
    await withMobilityPlan(h);
    const logged = await h.mobility.logMobility(
      { request_id: rid(), kind: "morning", timezone: BERLIN },
      undefined,
    );
    const morning = await sessionOf(h, "Morgenroutine");
    const workout = (await h.dataset()).workouts.find(
      (w) => w.workout_id === logged.workout_id,
    )!;
    expect(workout.session_id).toBe(morning.session_id);
  });

  it("saves a free routine without a plan, with unknown time staying unknown", async () => {
    const h = harness();
    const logged = await h.mobility.logMobility(
      { request_id: rid(), kind: "session", timezone: BERLIN },
      undefined,
    );
    expect(logged.ok).toBe(true);
    const data = await h.dataset();
    expect(
      data.workouts.find((w) => w.workout_id === logged.workout_id),
    ).toMatchObject({
      plan_version_id: null,
      session_id: null,
      session_name_snapshot: "Mobility",
    });
    expect(data.mobilityResults![0]).toMatchObject({
      minutes_planned: null,
      timer_s: null,
      exercises_total: 0,
      exercises_done: 0,
      plan_version_id: null,
    });
    const timed = await h.mobility.logMobility(
      {
        request_id: rid(),
        kind: "session",
        minutes: 20,
        confirm_duplicate: true,
        timezone: BERLIN,
      },
      undefined,
    );
    expect(
      (await h.dataset()).mobilityResults!.find(
        (r) => r.workout_id === timed.workout_id,
      ),
    ).toMatchObject({
      minutes_planned: 20,
      timer_s: 1200,
    });
  });

  it("asks before the same routine is logged twice on a day", async () => {
    const h = harness();
    await withMobilityPlan(h);
    const morning = await sessionOf(h, "Morgenroutine");
    const base = {
      kind: "morning" as const,
      session_id: morning.session_id,
      timezone: BERLIN,
    };
    const first = await h.mobility.logMobility(
      { request_id: rid(), ...base },
      undefined,
    );
    const second = await h.mobility.logMobility(
      { request_id: rid(), ...base },
      undefined,
    );
    expect(second).toMatchObject({ ok: false, replayed: false });
    expect(second.error).toMatchObject({
      code: "DUPLICATE_MOBILITY",
      retryable: false,
      details: [first.workout_id],
    });
    expect((await h.dataset()).workouts.filter(isMobilityWorkout)).toHaveLength(
      1,
    );
    const confirmed = await h.mobility.logMobility(
      { request_id: rid(), ...base, confirm_duplicate: true },
      undefined,
    );
    expect(confirmed.ok).toBe(true);
    expect((await h.dataset()).workouts.filter(isMobilityWorkout)).toHaveLength(
      2,
    );
    // Another day is no duplicate.
    const yesterday = await h.mobility.logMobility(
      { request_id: rid(), ...base, workout_date_local: "2026-05-31" },
      undefined,
    );
    expect(yesterday.ok).toBe(true);
  });

  it("refuses an unknown session, a wrong kind and a date in the future", async () => {
    const h = harness();
    await withMobilityPlan(h);
    const own = await sessionOf(h, "Beweglichkeit");
    const unknown = await h.mobility.logMobility(
      {
        request_id: rid(),
        kind: "morning",
        session_id: "nope",
        timezone: BERLIN,
      },
      undefined,
    );
    expect(unknown.error?.code).toBe("MOBILITY_SESSION_NOT_FOUND");
    const kind = await h.mobility.logMobility(
      {
        request_id: rid(),
        kind: "morning",
        session_id: own.session_id,
        timezone: BERLIN,
      },
      undefined,
    );
    expect(kind.error?.code).toBe("VALIDATION_ERROR");
    const future = await h.mobility.logMobility(
      {
        request_id: rid(),
        kind: "morning",
        workout_date_local: "2026-06-02",
        timezone: BERLIN,
      },
      undefined,
    );
    expect(future.error?.code).toBe("DATE_IN_FUTURE");
    expect((await h.dataset()).workouts.filter(isMobilityWorkout)).toHaveLength(
      0,
    );
  });

  it("takes the date from the user's calendar, also shortly after midnight", async () => {
    // 23:30 UTC on 2026-06-01: already the 2nd in Auckland, still the 1st in Los Angeles.
    const h = harness("empty", { now: "2026-06-01T23:30:00Z" });
    const auckland = await h.mobility.logMobility(
      { request_id: rid(), kind: "session", timezone: "Pacific/Auckland" },
      undefined,
    );
    const la = await h.mobility.logMobility(
      { request_id: rid(), kind: "session", timezone: "America/Los_Angeles" },
      undefined,
    );
    const data = await h.dataset();
    const day = (id: string | undefined) =>
      data.workouts.find((w) => w.workout_id === id)!;
    expect(day(auckland.workout_id)).toMatchObject({
      workout_date_local: "2026-06-02",
      timezone: "Pacific/Auckland",
    });
    expect(day(la.workout_id)).toMatchObject({
      workout_date_local: "2026-06-01",
      timezone: "America/Los_Angeles",
    });
    // Without a zone and without any workout nothing is guessed from UTC.
    const none = harness("empty", { now: "2026-06-01T23:30:00Z" });
    const refused = await none.mobility.logMobility(
      { request_id: rid(), kind: "session" },
      undefined,
    );
    expect(refused.error?.code).toBe("VALIDATION_ERROR");
    expect(refused.error?.details).toEqual(["timezone"]);
  });

  it("accepts no user or tracker id in the input", async () => {
    const h = harness();
    for (const extra of [{ user_id: "x" }, { tracker_id: "x" }]) {
      const response = await h.mobility.logMobility(
        { request_id: rid(), kind: "session", timezone: BERLIN, ...extra },
        undefined,
      );
      expect(response.error?.code).toBe("VALIDATION_ERROR");
    }
  });
});

describe("mobility is not load and not a training day", () => {
  it("leaves scores, streak and the dashboard figures unchanged by logged routines", async () => {
    const h = harness();
    await withMobilityPlan(h);
    const ctx = { generatedAt: "2026-06-01T08:00:00Z" };
    const figures = async () => {
      const dataset = (
        await storeSource(h.store, {
          synthetic: true,
          label: "t",
          description: "t",
        }).load()
      ).dataset;
      const view = buildDashboardView(dataset, ctx, {
        reference_date: "2026-06-01",
      });
      const opts = {
        reference_date: "2026-06-01",
        weekly_goal_training_days: 3,
      };
      return {
        kpis: view.kpis,
        weeks: view.weeks,
        records: view.records,
        scores: buildScores(dataset, {
          ...opts,
          health: { status: "no_consent" },
        }),
        home: buildHomeAnalytics(dataset, opts),
      };
    };
    const before = await figures();
    const morning = await sessionOf(h, "Morgenroutine");
    await h.mobility.logMobility(
      {
        request_id: rid(),
        kind: "morning",
        session_id: morning.session_id,
        minutes: 10,
        timezone: BERLIN,
      },
      undefined,
    );
    await h.mobility.logMobility(
      { request_id: rid(), kind: "session", minutes: 30, timezone: BERLIN },
      undefined,
    );
    expect((await h.dataset()).workouts.filter(isMobilityWorkout)).toHaveLength(
      2,
    );
    expect(await figures()).toEqual(before);
  });
});

describe("void_workout with a mobility routine", () => {
  it("takes the routine back: the workout is voided, adherence and recent skip it", async () => {
    const h = harness();
    await withMobilityPlan(h);
    const morning = await sessionOf(h, "Morgenroutine");
    const logged = await h.mobility.logMobility(
      {
        request_id: rid(),
        kind: "morning",
        session_id: morning.session_id,
        timezone: BERLIN,
      },
      undefined,
    );
    expect(
      (await h.mobility.getOverview(undefined, BERLIN)).recent,
    ).toHaveLength(1);
    const voided = await h.service.execute(
      "void_workout",
      {
        request_id: rid(),
        workout_id: logged.workout_id,
        expected_row_revision: 1,
        correction_reason: "Versehentlich gespeichert.",
      },
      undefined,
    );
    expect(voided.error).toBeNull();
    expect(voided.result?.workout?.status).toBe("voided");
    const overview = await h.mobility.getOverview(undefined, BERLIN);
    expect(overview.recent).toEqual([]);
    expect(overview.today.items.find((i) => i.kind === "morning")!.done).toBe(
      false,
    );
    expect(overview.adherence.done_count).toBe(0);
    // The result row stays with its (voided) workout; the data stays valid.
    expect((await h.dataset()).mobilityResults).toHaveLength(1);
    // The same routine can be logged again without a duplicate question.
    const again = await h.mobility.logMobility(
      {
        request_id: rid(),
        kind: "morning",
        session_id: morning.session_id,
        timezone: BERLIN,
      },
      undefined,
    );
    expect(again.ok).toBe(true);
  });
});

describe("saveWatchMobility", () => {
  const uuid = () => randomUUID();
  async function request(h: Harness, over: Record<string, unknown> = {}) {
    const morning = await sessionOf(h, "Morgenroutine");
    return {
      request_id: `gm_${uuid()}`,
      session_uuid: uuid(),
      plan_version_id: morning.plan_version_id,
      session_id: morning.session_id,
      kind: "morning",
      workout_date_local: "2026-06-01",
      utc_offset_min: 120,
      started_at_utc: "2026-06-01T06:00:00Z",
      ended_at_utc: "2026-06-01T06:10:00Z",
      timer_s: 560,
      elapsed_s: 600,
      ended_early: false,
      ex: morning.template.exercise_ids.map((c) => ({ c, st: "done", t: 100 })),
      ...over,
    };
  }

  it("saves a routine from the watch, replays it and refuses the same recording under a new id", async () => {
    const h = harness();
    await withMobilityPlan(h);
    const req = await request(h);
    const first = await h.mobility.saveWatchMobility(req, undefined, BERLIN);
    expect(first).toMatchObject({ ok: true, value: { replayed: false } });
    const workoutId = first.ok ? first.value.workout_id : "";
    const data = await h.dataset();
    expect(data.workouts.find((w) => w.workout_id === workoutId)).toMatchObject(
      {
        activity_type: "mobility",
        source: "sync",
        client_session_id: req.session_uuid,
        started_at_utc: req.started_at_utc,
        ended_at_utc: req.ended_at_utc,
        timezone: BERLIN,
      },
    );
    expect(
      data.mobilityResults!.find((r) => r.workout_id === workoutId),
    ).toMatchObject({
      result_source: "watch",
      ended_early: false,
      exercises_total: M.length,
      exercises_done: M.length,
      exercises_skipped: 0,
      timer_s: 560,
      elapsed_s: 600,
      items: req.ex,
    });
    const again = await h.mobility.saveWatchMobility(req, undefined, BERLIN);
    expect(again).toMatchObject({
      ok: true,
      value: { replayed: true, workout_id: workoutId },
    });
    const conflict = await h.mobility.saveWatchMobility(
      { ...req, request_id: `gm_${uuid()}` },
      undefined,
      BERLIN,
    );
    expect(conflict).toMatchObject({
      ok: false,
      error: { code: "DUPLICATE_WORKOUT", details: [workoutId] },
    });
    // The same request_id with other content is another operation.
    const changed = await h.mobility.saveWatchMobility(
      { ...req, timer_s: 500 },
      undefined,
      BERLIN,
    );
    expect(changed).toMatchObject({
      ok: false,
      error: { code: "DUPLICATE_OPERATION" },
    });
    expect((await h.dataset()).workouts.filter(isMobilityWorkout)).toHaveLength(
      1,
    );
  });

  it("stores a routine ended early with what was done and skipped", async () => {
    const h = harness();
    await withMobilityPlan(h);
    const morning = await sessionOf(h, "Morgenroutine");
    const ids = morning.template.exercise_ids;
    const req = await request(h, {
      ended_early: true,
      ex: [
        { c: ids[0], st: "done", t: 60 },
        { c: ids[1], st: "skipped", t: 0 },
        { c: ids[2], st: "partial", t: 20 },
      ],
    });
    const saved = await h.mobility.saveWatchMobility(req, undefined, BERLIN);
    expect(saved.ok).toBe(true);
    const row = (await h.dataset()).mobilityResults![0]!;
    expect(row).toMatchObject({
      ended_early: true,
      exercises_total: ids.length,
      exercises_done: 1,
      // A partly done exercise counts as skipped.
      exercises_skipped: 2,
    });
  });

  it("applies the ended_early rules", async () => {
    const h = harness();
    await withMobilityPlan(h);
    const morning = await sessionOf(h, "Morgenroutine");
    const ids = morning.template.exercise_ids;
    const code = async (over: Record<string, unknown>) => {
      const r = await h.mobility.saveWatchMobility(
        await request(h, over),
        undefined,
        BERLIN,
      );
      return r.ok ? "ok" : r.error.code;
    };
    // Not all exercises reported, but not ended early.
    expect(await code({ ex: [{ c: ids[0], st: "done", t: 60 }] })).toBe(
      "VALIDATION_ERROR",
    );
    // A partial exercise only with ended_early.
    expect(
      await code({
        ex: ids.map((c, i) => ({ c, st: i === 0 ? "partial" : "done", t: 30 })),
      }),
    ).toBe("VALIDATION_ERROR");
    // An exercise that is not in the routine.
    expect(
      await code({
        ended_early: true,
        ex: [{ c: "mob_pigeon", st: "done", t: 30 }],
      }),
    ).toBe("VALIDATION_ERROR");
    // Twice the same exercise.
    expect(
      await code({
        ended_early: true,
        ex: [
          { c: ids[0], st: "done", t: 30 },
          { c: ids[0], st: "done", t: 30 },
        ],
      }),
    ).toBe("VALIDATION_ERROR");
    expect((await h.dataset()).mobilityResults ?? []).toHaveLength(0);
  });

  it("saves a free routine with the reported exercises as its total", async () => {
    const h = harness();
    const req = {
      request_id: `gm_${uuid()}`,
      session_uuid: uuid(),
      kind: "session",
      workout_date_local: "2026-06-01",
      utc_offset_min: 120,
      started_at_utc: "2026-06-01T06:00:00Z",
      ended_at_utc: "2026-06-01T06:05:00Z",
      timer_s: 280,
      elapsed_s: 300,
      ended_early: false,
      ex: [
        { c: "mob_cat_cow", st: "done", t: 60 },
        { c: "mob_pigeon", st: "skipped", t: 0 },
      ],
    };
    const saved = await h.mobility.saveWatchMobility(req, undefined, BERLIN);
    expect(saved.ok).toBe(true);
    expect((await h.dataset()).mobilityResults![0]).toMatchObject({
      plan_version_id: null,
      session_id: null,
      exercises_total: 2,
      exercises_done: 1,
      exercises_skipped: 1,
      minutes_planned: null,
    });
  });

  it("refuses a plan routine that does not exist, the future and a bad zone", async () => {
    const h = harness();
    await withMobilityPlan(h);
    const code = async (over: Record<string, unknown>, zone = BERLIN) => {
      const r = await h.mobility.saveWatchMobility(
        await request(h, over),
        undefined,
        zone,
      );
      return r.ok ? "ok" : r.error.code;
    };
    expect(await code({ session_id: "gone" })).toBe("VALIDATION_ERROR");
    expect(await code({ workout_date_local: "2026-06-03" })).toBe(
      "DATE_IN_FUTURE",
    );
    expect(
      await code({
        started_at_utc: "2026-06-01T09:00:00Z",
        ended_at_utc: "2026-06-01T09:10:00Z",
      }),
    ).toBe("DATE_IN_FUTURE");
    expect(await code({}, "Mars/Olympus")).toBe("VALIDATION_ERROR");
    expect(await code({ kind: "session" })).toBe("VALIDATION_ERROR");
    expect((await h.dataset()).workouts.filter(isMobilityWorkout)).toHaveLength(
      0,
    );
  });

  it("is a plain value for a service that failed closed", async () => {
    const planning = createFixturePlanning();
    const bad = await planning.mobility.saveWatchMobility(
      { nonsense: true },
      undefined,
      BERLIN,
    );
    expect(bad).toMatchObject({
      ok: false,
      error: { code: "VALIDATION_ERROR" },
    });
  });
});

describe("the start screen line", () => {
  it("shows the morning routine and Dranbleiben only after a yes", async () => {
    const h = harness(undefined, { now: "2026-06-04T08:00:00Z" });
    await withMobilityPlan(h, [morningOp]);
    const load = async () => {
      const dataset = (
        await storeSource(h.store, {
          synthetic: true,
          label: "t",
          description: "t",
        }).load()
      ).dataset;
      return buildDashboardView(
        dataset,
        { generatedAt: "2026-06-04T08:00:00Z" },
        { reference_date: "2026-06-04" },
      ).home;
    };
    // The plan has a routine but the user never answered: no line.
    expect((await load()).mobility).toBeUndefined();
    await h.mobility.updateProfile(
      { request_id: rid(), preference: wanted },
      undefined,
    );
    const open = (await load()).mobility!;
    expect(open).toMatchObject({ morning: "open", sessions_open: 0 });
    expect(open.line).toContain("Morgenroutine noch offen");
    await h.mobility.logMobility(
      { request_id: rid(), kind: "morning", timezone: BERLIN },
      undefined,
    );
    const done = (await load()).mobility!;
    expect(done.morning).toBe("done");
    expect(done.line).toContain("Morgenroutine erledigt");
    expect(done.adherence).toMatchObject({
      planned_count: 1,
      done_count: 1,
      ratio: 1,
    });
    // A "no" shows nothing.
    await h.mobility.updateProfile(
      { request_id: rid(), preference: { wants: false } },
      undefined,
    );
    expect((await load()).mobility).toBeUndefined();
  });
});

describe("the constants of the fixture clock", () => {
  it("starts on a Monday", () => {
    expect(new Date(NOW).getUTCDay()).toBe(1);
  });
});

/* ------------------------------------------------------- the setup answer */

const TRAINING = {
  primary_goal: "muscle_gain",
  experience: "intermediate",
  days_per_week: 3,
  session_minutes: 60,
  environment: "gym",
} as const;

async function confirmedSetup(
  service: OnboardingService,
  mobility: MobilityPreference,
) {
  const profile: OnboardingProfilePatch = {
    path: "arnold_plan",
    training: { ...TRAINING, mobility },
  };
  const started = await service.startOnboarding({ request_id: rid() });
  const claim = {
    onboarding_session_id: started.state!.session.onboarding_session_id,
    session_token: started.session_token!,
  };
  const saved = await service.updateProfile({
    request_id: rid(),
    ...claim,
    profile,
  });
  expect(saved.ok, saved.error?.message).toBe(true);
  const brief = await service.getBrief(claim);
  const submitted = await service.submitPlanProposal({
    request_id: rid(),
    ...claim,
    name: "Mein Plan",
    origin: "ai_proposal",
    sessions: brief.exercise_catalog.slice(0, 3).map((e, i) => ({
      session_name: `Einheit ${i + 1}`,
      exercises: [
        { exercise_id: e.exercise_id, target_sets: 3, rep_min: 8, rep_max: 12 },
      ],
    })),
  });
  expect(submitted.ok, submitted.error?.message).toBe(true);
  const plan = submitted.state!.plan!;
  const confirmed = await service.confirmPlan({
    request_id: rid(),
    ...claim,
    confirmation: {
      plan_version_id: plan.plan_version_id,
      row_revision: plan.row_revision,
      confirmed: true,
    },
  });
  expect(confirmed.ok, confirmed.error?.message).toBe(true);
  return claim;
}

describe("finishing the setup with a mobility answer", () => {
  it("saves the yes in the profile, once, and a repeated finish changes nothing", async () => {
    const fixture = createFixtureOnboarding();
    const answer: MobilityPreference = {
      wants: true,
      morning: { weekdays: ["mon", "wed", "fri"], minutes: 10 },
      sessions: { placement: "after_strength", per_week: 2, minutes: 15 },
      stiff_areas: ["hips", "neck"],
    };
    const claim = await confirmedSetup(fixture.onboarding, answer);
    const first = await fixture.onboarding.finishSetup({
      request_id: rid(),
      ...claim,
    });
    expect(first.ok, first.error?.message).toBe(true);
    expect(first.state!.session.status).toBe("COMPLETED");
    const rows = (await fixture.store.read()).mobilityProfiles!;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      wants: true,
      morning_weekdays: [1, 3, 5],
      morning_minutes: 10,
      sessions_placement: "after_strength",
      sessions_per_week: 2,
      sessions_minutes: 15,
      stiff_areas: ["hips", "neck"],
      row_revision: 1,
    });
    // The user changes the answer in the chat; a second finish must not undo it.
    await fixture.mobility.updateProfile(
      { request_id: rid(), preference: { wants: false } },
      undefined,
    );
    const second = await fixture.onboarding.finishSetup({
      request_id: rid(),
      ...claim,
    });
    expect(second.ok, second.error?.message).toBe(true);
    expect(second.replayed).toBe(true);
    const after = (await fixture.store.read()).mobilityProfiles!;
    expect(after).toHaveLength(1);
    expect(after[0]).toMatchObject({ wants: false, row_revision: 2 });
  });

  it("saves a no as well, so the question is not asked again", async () => {
    const fixture = createFixtureOnboarding();
    const claim = await confirmedSetup(fixture.onboarding, { wants: false });
    const done = await fixture.onboarding.finishSetup({
      request_id: rid(),
      ...claim,
    });
    expect(done.ok, done.error?.message).toBe(true);
    expect((await fixture.store.read()).mobilityProfiles).toMatchObject([
      { wants: false, morning_weekdays: null, stiff_areas: [] },
    ]);
    expect(
      (await fixture.mobility.getOverview(undefined, BERLIN)).profile.state,
    ).toBe("no");
  });

  it("does not refuse the finish any more: the fixture runtime keeps the answer", async () => {
    const fixture = createFixtureOnboarding();
    const claim = await confirmedSetup(fixture.onboarding, {
      wants: true,
      morning: null,
      sessions: { placement: "own_days", per_week: 1, minutes: 20 },
      stiff_areas: [],
    });
    const done = await fixture.onboarding.finishSetup({
      request_id: rid(),
      ...claim,
    });
    expect(done.error).toBeNull();
    expect(done.state!.session.status).toBe("COMPLETED");
  });
});
