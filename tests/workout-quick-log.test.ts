import { afterAll, describe, expect, it } from "vitest";
import { createHash, randomUUID } from "node:crypto";
import { WriteInputs } from "../src/shared/workout-contract";
import type { WatchUpload } from "../src/server/workout/service";
import { appDatabase, asOwner, newAccount } from "./fixtures/arnold-db";
import { createFixtureLogging } from "../src/server/workout/fixture";
import { proposeActivePlan } from "../src/server/workout/proposal";
import { buildArnoldDashboardAnalytics } from "../src/analytics";
import {
  WriteResponseSchema,
  type WriteResponse,
} from "../src/shared/workout-contract";

function ok(response: WriteResponse) {
  expect(response.error).toBeNull();
  expect(response.ok).toBe(true);
  WriteResponseSchema.parse(response);
  return response.result!;
}
function code(response: WriteResponse, expected: string) {
  expect(response.ok).toBe(false);
  expect(response.error?.code).toBe(expected);
  WriteResponseSchema.parse(response);
  return response.error!;
}
const base = (extra: Record<string, unknown> = {}) => ({
  request_id: crypto.randomUUID(),
  workout_date_local: "2026-10-20",
  timezone: "Europe/Berlin",
  plan_version_id: "fixture-plan-v1",
  session_id: "fixture-push",
  source: "ui",
  ...extra,
});
/** The fixture plan has no target weights, so the first time needs them. */
const firstTime = (extra: Record<string, unknown> = {}) =>
  base({
    exercises: [
      { plan_item_id: "fixture-item-1", load_kg: 60 },
      { plan_item_id: "fixture-item-2", load_kg: 20 },
    ],
    ...extra,
  });
const completed = async (r: ReturnType<typeof createFixtureLogging>) =>
  buildArnoldDashboardAnalytics(await r.store.read()).activity
    .completed_workouts.value;

describe("log_workout: a whole workout in one step", () => {
  it("names the missing weight instead of guessing and stores nothing", async () => {
    const r = createFixtureLogging();
    const error = code(
      await r.service.execute("log_workout", base()),
      "VALIDATION_ERROR",
    );
    expect(error.message).toContain("Demo Bankdrücken (Gewicht)");
    expect(error.message).toContain("Demo Schrägbankdrücken (Gewicht)");
    expect((await r.store.read()).workouts).toHaveLength(0);
  });

  it("saves the plan with given weights as one completed workout", async () => {
    const r = createFixtureLogging();
    const result = ok(await r.service.execute("log_workout", firstTime()));
    expect(result.workout).toMatchObject({
      status: "completed",
      session_name_snapshot: "Demo Push",
      plan_version_id: "fixture-plan-v1",
      session_id: "fixture-push",
      source: "ui",
    });
    expect(result.sets).toHaveLength(6);
    const incline = result.sets.filter(
      (s) => s.exercise_id === "fixture-incline",
    );
    expect(incline.map((s) => s.set_number)).toEqual([1, 2, 3]);
    expect(incline[0]).toMatchObject({
      reps: 12,
      load_kg: 20,
      load_basis: "per_implement",
      implement_count: 2,
      plan_item_id: "fixture-item-2",
      exercise_order: 2,
      set_type: "working",
    });
    expect(await completed(r)).toBe(1);
  });

  it("saves Arnold's recommendation from last time without any changes", async () => {
    const r = createFixtureLogging();
    ok(
      await r.service.execute(
        "log_workout",
        firstTime({
          exercises: [
            {
              plan_item_id: "fixture-item-1",
              sets: [
                { reps: 10, load_kg: 60 },
                { reps: 9, load_kg: 60 },
                { reps: 8, load_kg: 60 },
              ],
            },
            { plan_item_id: "fixture-item-2", load_kg: 20 },
          ],
        }),
      ),
    );
    const proposal = proposeActivePlan(await r.store.read())[0];
    // 10, 9, 8 in a range of 8–12: same weight, one repetition more per set.
    expect(proposal.exercises[0]).toMatchObject({
      source: "progression",
      last_date: "2026-10-20",
      missing: [],
      progression: {
        decision: "more_reps",
        change_kg: 0,
        last_sets: [
          { reps: 10, load_kg: 60 },
          { reps: 9, load_kg: 60 },
          { reps: 8, load_kg: 60 },
        ],
      },
    });
    const again = ok(
      await r.service.execute(
        "log_workout",
        base({ workout_date_local: "2026-10-22" }),
      ),
    );
    expect(
      again.sets
        .filter((s) => s.exercise_id === "fixture-bench")
        .map((s) => [s.reps, s.load_kg]),
    ).toEqual([
      [11, 60],
      [10, 60],
      [9, 60],
    ]);
    expect(await completed(r)).toBe(2);
  });

  it("swaps, skips and adds exercises for this day only", async () => {
    const r = createFixtureLogging();
    const result = ok(
      await r.service.execute(
        "log_workout",
        base({
          exercises: [
            { plan_item_id: "fixture-item-1", exercise_id: "fixture-pullup" },
            { plan_item_id: "fixture-item-2", skip: true },
            {
              exercise_id: "fixture-row",
              set_count: 2,
              reps: 10,
              load_kg: 22,
            },
          ],
        }),
      ),
    );
    const pullups = result.sets.filter(
      (s) => s.exercise_id === "fixture-pullup",
    );
    // The swapped exercise keeps the planned volume but not the plan slot.
    expect(pullups).toHaveLength(3);
    expect(pullups[0]).toMatchObject({
      plan_item_id: null,
      load_kg: null,
      load_basis: "bodyweight_only",
      reps: 12,
    });
    const rows = result.sets.filter((s) => s.exercise_id === "fixture-row");
    expect(rows.map((s) => [s.side, s.set_number])).toEqual([
      ["left", 1],
      ["right", 1],
      ["left", 2],
      ["right", 2],
    ]);
    expect(rows[0]).toMatchObject({ reps_basis: "per_side", load_kg: 22 });
    expect(result.sets.some((s) => s.exercise_id === "fixture-incline")).toBe(
      false,
    );
  });

  it("asks for a weight when a swapped exercise has none yet", async () => {
    const r = createFixtureLogging();
    const error = code(
      await r.service.execute(
        "log_workout",
        firstTime({
          exercises: [
            { plan_item_id: "fixture-item-1", exercise_id: "fixture-row" },
            { plan_item_id: "fixture-item-2", load_kg: 20 },
          ],
        }),
      ),
      "VALIDATION_ERROR",
    );
    expect(error.message).toContain("Demo Rudern einarmig (Gewicht)");
  });

  it("refuses a weight on a bodyweight exercise and future dates", async () => {
    const r = createFixtureLogging();
    code(
      await r.service.execute(
        "log_workout",
        base({
          exercises: [
            {
              plan_item_id: "fixture-item-1",
              exercise_id: "fixture-pullup",
              load_kg: 10,
            },
            { plan_item_id: "fixture-item-2", skip: true },
          ],
        }),
      ),
      "VALIDATION_ERROR",
    );
    code(
      await r.service.execute(
        "log_workout",
        firstTime({ workout_date_local: "2999-01-01" }),
      ),
      "DATE_IN_FUTURE",
    );
  });

  it("replays the same request without a second workout", async () => {
    const r = createFixtureLogging();
    const input = firstTime();
    ok(await r.service.execute("log_workout", input));
    const replay = await r.service.execute("log_workout", input);
    expect(replay.replayed).toBe(true);
    expect((await r.store.read()).workouts).toHaveLength(1);
  });

  it("replaces a saved workout in one step when it is edited", async () => {
    const r = createFixtureLogging();
    const first = ok(await r.service.execute("log_workout", firstTime()));
    const edited = ok(
      await r.service.execute(
        "log_workout",
        firstTime({
          replaces_workout_id: first.workout!.workout_id,
          expected_row_revision: 1,
          exercises: [
            { plan_item_id: "fixture-item-1", load_kg: 65 },
            { plan_item_id: "fixture-item-2", load_kg: 20 },
          ],
        }),
      ),
    );
    const data = await r.store.read();
    expect(
      data.workouts.find((w) => w.workout_id === first.workout!.workout_id),
    ).toMatchObject({ status: "voided", row_revision: 2 });
    expect(
      data.sets
        .filter((s) => s.workout_id === first.workout!.workout_id)
        .every((s) => s.status === "voided"),
    ).toBe(true);
    expect(edited.sets[0].load_kg).toBe(65);
    expect(edited.warnings).toEqual([]);
    expect(await completed(r)).toBe(1);
  });

  it("asks before saving the same session twice on one day", async () => {
    const r = createFixtureLogging();
    const first = ok(await r.service.execute("log_workout", firstTime()));
    const error = code(
      await r.service.execute("log_workout", firstTime()),
      "DUPLICATE_WORKOUT",
    );
    expect(error.message).toContain(first.workout!.workout_id);
    expect(error.message).toContain("replaces_workout_id");
    expect((await r.store.read()).workouts).toHaveLength(1);
    // Another day, or an explicit yes, is fine.
    ok(
      await r.service.execute(
        "log_workout",
        firstTime({ workout_date_local: "2026-10-21" }),
      ),
    );
    const second = ok(
      await r.service.execute(
        "log_workout",
        firstTime({ confirm_duplicate: true }),
      ),
    );
    expect(second.warnings[0]).toContain("2 Trainings „Demo Push“");
  });

  it("never carries a weight over to a swapped or added exercise", async () => {
    const r = createFixtureLogging();
    // History: rows with 22 kg per dumbbell.
    ok(
      await r.service.execute(
        "log_workout",
        firstTime({
          workout_date_local: "2026-10-18",
          exercises: [
            { plan_item_id: "fixture-item-1", load_kg: 60 },
            { plan_item_id: "fixture-item-2", load_kg: 20 },
            { exercise_id: "fixture-row", set_count: 2, reps: 10, load_kg: 22 },
          ],
        }),
      ),
    );
    const swapped = code(
      await r.service.execute(
        "log_workout",
        base({
          exercises: [
            { plan_item_id: "fixture-item-1", exercise_id: "fixture-row" },
          ],
        }),
      ),
      "VALIDATION_ERROR",
    );
    expect(swapped.message).toContain("Demo Rudern einarmig (Gewicht)");
    const added = code(
      await r.service.execute(
        "log_workout",
        base({
          exercises: [{ exercise_id: "fixture-row", set_count: 3, reps: 12 }],
        }),
      ),
      "VALIDATION_ERROR",
    );
    expect(added.message).toContain("Demo Rudern einarmig (Gewicht)");
    // Named, it is saved as said.
    const saved = ok(
      await r.service.execute(
        "log_workout",
        base({
          exercises: [
            { exercise_id: "fixture-row", set_count: 3, reps: 12, load_kg: 24 },
          ],
        }),
      ),
    );
    expect(
      saved.sets
        .filter((s) => s.exercise_id === "fixture-row")
        .every((s) => s.load_kg === 24 && s.reps === 12),
    ).toBe(true);
  });
});

describe("log_workout: findings of the ChatGPT stress test", () => {
  it("uses the newest values also for a past day, and a set count keeps them", async () => {
    const r = createFixtureLogging();
    // Newer workout first, then a day before it is logged.
    ok(
      await r.service.execute(
        "log_workout",
        firstTime({
          workout_date_local: "2026-10-20",
          exercises: [
            { plan_item_id: "fixture-item-1", reps: 15, load_kg: 60 },
            { plan_item_id: "fixture-item-2", load_kg: 20 },
          ],
        }),
      ),
    );
    const past = ok(
      await r.service.execute(
        "log_workout",
        base({
          workout_date_local: "2026-10-10",
          exercises: [{ plan_item_id: "fixture-item-1", set_count: 2 }],
        }),
      ),
    );
    // 15 repetitions are above the range of 8–12: one step up, back to 8.
    const bench = past.sets.filter((s) => s.exercise_id === "fixture-bench");
    expect(bench.map((s) => [s.reps, s.load_kg])).toEqual([
      [8, 62.5],
      [8, 62.5],
    ]);
  });

  it("logs added weight on a bodyweight exercise", async () => {
    const r = createFixtureLogging();
    const pullups = (extra: Record<string, unknown> = {}) =>
      base({
        exercises: [
          { plan_item_id: "fixture-item-2", skip: true },
          { plan_item_id: "fixture-item-1", skip: true },
          {
            exercise_id: "fixture-pullup",
            set_count: 3,
            reps: 8,
            load_kg: 10,
            ...extra,
          },
        ],
      });
    // Without the basis a weight on a bodyweight exercise is refused.
    const plain = code(
      await r.service.execute("log_workout", pullups()),
      "VALIDATION_ERROR",
    );
    expect(plain.message).toContain("Körpergewicht");
    const saved = ok(
      await r.service.execute("log_workout", pullups({ load_basis: "added" })),
    );
    expect(saved.sets).toHaveLength(3);
    expect(saved.sets[0]).toMatchObject({
      load_basis: "added",
      load_kg: 10,
      reps: 8,
    });
  });
});

describe("void_workout: taking a saved workout back", () => {
  it("voids the workout and its sets, never deletes, checks the revision", async () => {
    const r = createFixtureLogging();
    const saved = ok(await r.service.execute("log_workout", firstTime()));
    code(
      await r.service.execute("void_workout", {
        request_id: "stale",
        workout_id: saved.workout!.workout_id,
        expected_row_revision: 7,
        correction_reason: "Versehentlich eingetragen",
      }),
      "REVISION_CONFLICT",
    );
    const voided = ok(
      await r.service.execute("void_workout", {
        request_id: "undo",
        workout_id: saved.workout!.workout_id,
        expected_row_revision: 1,
        correction_reason: "Versehentlich eingetragen",
      }),
    );
    expect(voided.workout?.status).toBe("voided");
    expect(voided.sets).toHaveLength(6);
    const data = await r.store.read();
    expect(data.sets).toHaveLength(6);
    expect(data.sets.every((s) => s.status === "voided")).toBe(true);
    expect(await completed(r)).toBe(0);
    code(
      await r.service.execute("void_workout", {
        request_id: "again",
        workout_id: saved.workout!.workout_id,
        expected_row_revision: 2,
        correction_reason: "Nochmal",
      }),
      "INVALID_STATUS_TRANSITION",
    );
  });
});

describe("log_workout for watch uploads (GAR-B2-05)", () => {
  const db = appDatabase();
  afterAll(() => db.close());
  const sha = (v: string) => createHash("sha256").update(v).digest();
  const day = "2026-11-02";
  const times = {
    started_at_utc: "2026-11-02T17:00:00Z",
    ended_at_utc: "2026-11-02T17:50:00Z",
  };
  const watchInput = (extra: Record<string, unknown> = {}) => ({
    request_id: randomUUID(),
    workout_date_local: day,
    timezone: "Europe/Berlin",
    session_name: "Uhr-Test",
    exercises: [
      { exercise_id: "bench-press", sets: [{ reps: 8, load_kg: 60 }] },
    ],
    ...times,
    ...extra,
  });
  /** An account with one paired watch, through the 003 functions. */
  async function pairedAccount() {
    const account = await newAccount(db);
    const device = sha(randomUUID()),
      code = sha(randomUUID()),
      deviceId = `wdv_${randomUUID()}`;
    await db.query("select * from arnold.start_watch_pairing($1,$2,$3,600)", [
      device,
      code,
      "Forerunner 255",
    ]);
    await db.asUser(account.userId, (c) =>
      c.query("select * from arnold.approve_watch_pairing($1,$2)", [
        code,
        "Europe/Berlin",
      ]),
    );
    await db.query("select * from arnold.redeem_watch_pairing($1,$2,$3)", [
      device,
      sha(randomUUID()),
      deviceId,
    ]);
    return { ...account, deviceId };
  }
  const upload = (deviceId: string, clientSessionId = randomUUID()) =>
    ({
      client_session_id: clientSessionId,
      device_id: deviceId,
      app_version: "1.0.0",
      set_timings: [
        {
          exercise_order: 1,
          set_number: 1,
          side: "both",
          started_at_utc: "2026-11-02T17:01:00Z",
          ended_at_utc: "2026-11-02T17:01:40Z",
          rest_before_s: null,
        },
      ],
    }) satisfies WatchUpload;
  const recordings = (userId: string, clientSessionId: string) =>
    db.asUser(
      userId,
      async (c) =>
        (
          await c.query(
            "select device_id, started_at_utc, ended_at_utc, set_timings, app_version from arnold.workout_recordings where client_session_id = $1",
            [clientSessionId],
          )
        ).rows,
    );

  it("checks start and end like start_workout and complete_workout", async () => {
    const r = createFixtureLogging();
    const at = (extra: Record<string, unknown>) =>
      r.service.execute("log_workout", firstTime(extra));
    code(
      await at({ started_at_utc: "2026-10-19T21:00:00Z" }),
      "VALIDATION_ERROR",
    );
    code(
      await at({ ended_at_utc: "2026-10-19T20:00:00Z" }),
      "VALIDATION_ERROR",
    );
    code(
      await at({
        started_at_utc: "2026-10-20T17:00:00Z",
        ended_at_utc: "2026-10-20T16:00:00Z",
      }),
      "VALIDATION_ERROR",
    );
    expect((await r.store.read()).workouts).toHaveLength(0);
    const saved = ok(
      await at({
        started_at_utc: "2026-10-20T16:00:00Z",
        ended_at_utc: "2026-10-20T17:05:00Z",
      }),
    );
    expect(saved.workout).toMatchObject({
      started_at_utc: "2026-10-20T16:00:00Z",
      ended_at_utc: "2026-10-20T17:05:00Z",
      source: "ui",
    });
    expect(saved.workout).not.toHaveProperty("client_session_id");
  });

  it("never lets /mcp set source sync or a client session", () => {
    expect(() =>
      WriteInputs.log_workout.parse(watchInput({ source: "sync" })),
    ).toThrow();
    expect(() =>
      WriteInputs.log_workout.parse(
        watchInput({ client_session_id: randomUUID() }),
      ),
    ).toThrow();
  });

  it("fails closed on a store without recordings and stores nothing", async () => {
    const r = createFixtureLogging();
    const refused = await r.service.logWatchWorkout(
      firstTime(times_on("2026-10-20")),
      upload("wdv_00000000-0000-0000-0000-000000000000"),
    );
    code(refused, "PERMISSION_DENIED");
    expect((await r.store.read()).workouts).toHaveLength(0);
  });

  it("stores workout, sets and recording in one write with source sync, and replays", async () => {
    const a = await pairedAccount();
    const input = watchInput(),
      watch = upload(a.deviceId);
    const saved = ok(await a.logging.logWatchWorkout(input, watch));
    expect(saved.workout).toMatchObject({
      source: "sync",
      client_session_id: watch.client_session_id,
      ...times,
    });
    expect(saved.sets.every((set) => set.source === "sync")).toBe(true);
    expect(await recordings(a.userId, watch.client_session_id)).toEqual([
      {
        device_id: a.deviceId,
        ...times,
        set_timings: watch.set_timings,
        app_version: "1.0.0",
      },
    ]);
    const again = await a.logging.logWatchWorkout(input, watch);
    expect(again.replayed).toBe(true);
    expect(again.result?.workout?.workout_id).toBe(saved.workout!.workout_id);
    expect(await recordings(a.userId, watch.client_session_id)).toHaveLength(1);
    // Same request id, other recording: a different operation.
    code(
      await a.logging.logWatchWorkout(input, {
        ...watch,
        app_version: "1.0.1",
      }),
      "DUPLICATE_OPERATION",
    );
    const audit = await asOwner(
      async (c) =>
        (
          await c.query(
            "select event_type from arnold.audit_events where user_id = $1 and operation_id = $2",
            [a.userId, input.request_id],
          )
        ).rows,
    );
    expect(audit.map((e) => e.event_type).sort()).toEqual([
      "SET_CREATED",
      "WORKOUT_LOGGED",
    ]);
  });

  it("rolls the workout back when the recording cannot be stored", async () => {
    const a = await pairedAccount(),
      other = await pairedAccount();
    // Another user's watch: the foreign key (user_id, device_id) refuses it.
    const refused = await a.logging.logWatchWorkout(
      watchInput(),
      upload(other.deviceId),
    );
    expect(refused.ok).toBe(false);
    expect((await a.store.read()).workouts).toHaveLength(0);
  });

  it("Ersetzen nimmt Aufzeichnung mit: a replacement in ChatGPT keeps the client session", async () => {
    const a = await pairedAccount();
    const watch = upload(a.deviceId);
    const saved = ok(await a.logging.logWatchWorkout(watchInput(), watch));
    const replaced = ok(
      await a.logging.execute("log_workout", {
        request_id: randomUUID(),
        workout_date_local: day,
        timezone: "Europe/Berlin",
        session_name: "Uhr-Test",
        exercises: [
          { exercise_id: "bench-press", sets: [{ reps: 10, load_kg: 60 }] },
        ],
        replaces_workout_id: saved.workout!.workout_id,
        expected_row_revision: 1,
        source: "chat",
      }),
    );
    expect(replaced.workout).toMatchObject({
      client_session_id: watch.client_session_id,
      source: "chat",
    });
    const workouts = (await a.store.read()).workouts;
    expect(workouts.map((w) => [w.status, w.client_session_id]).sort()).toEqual(
      [
        ["completed", watch.client_session_id],
        ["voided", watch.client_session_id],
      ],
    );
    // The recording is keyed by the client session and follows untouched.
    expect(await recordings(a.userId, watch.client_session_id)).toHaveLength(1);
  });
});

/** start/end inside the fixture day. */
function times_on(date: string) {
  return {
    started_at_utc: `${date}T16:00:00Z`,
    ended_at_utc: `${date}T17:00:00Z`,
  };
}
