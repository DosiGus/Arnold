/**
 * GAR-B2-06: a training from the watch, against the test Postgres. Real
 * watch tokens, real accounts with an active plan, the real logging service
 * and store; only the setup gate is set by the test.
 */
import { afterAll, afterEach, describe, expect, it } from "vitest";
import express from "express";
import type { Server } from "node:http";
import { createHash, randomUUID } from "node:crypto";
import {
  mapUpload,
  offsetMinutes,
  workoutRoutes,
  zoneForUpload,
} from "../src/server/watch/workouts.js";
import { mountWatchApi, WatchApiError } from "../src/server/watch/router.js";
import type { DatabaseArnoldRuntime } from "../src/server/db/runtime.js";
import {
  hashWatchToken,
  newWatchToken,
} from "../src/server/auth/watch-token.js";
import { WatchWorkoutResponseSchema } from "../src/shared/watch-contract.js";
import { appDatabase, asOwner, newAccount } from "./fixtures/arnold-db.js";

const db = appDatabase(10);
const servers: Server[] = [];
afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (s) =>
        new Promise<void>((resolve) => {
          s.close(() => resolve());
          s.closeAllConnections();
        }),
    ),
  );
});
afterAll(() => db.close());
const sha = (v: string) => createHash("sha256").update(v).digest();

/** Yesterday in Berlin, so the test never depends on the hour it runs. */
const day = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Berlin",
}).format(new Date(Date.now() - 86_400_000));
const startedAt = `${day}T12:00:00Z`;
const endedAt = `${day}T13:00:00Z`;
const t0 = Date.parse(startedAt) / 1000;
const berlinOffset = offsetMinutes("Europe/Berlin", new Date(startedAt));

type Account = Awaited<ReturnType<typeof newAccount>>;

/** An account with an active two-exercise plan and a paired watch. */
async function athlete() {
  const account = await newAccount(db);
  const created = await account.plans.createTrainingPlan({
    request_id: randomUUID(),
    name: "Uhr-Plan",
    sessions: [
      {
        session_name: "Oberkörper",
        exercises: [
          {
            exercise_id: "bench-press",
            target_sets: 3,
            rep_min: 6,
            rep_max: 10,
            target_load_kg: 60,
          },
          {
            exercise_id: "one-arm-row",
            target_sets: 2,
            rep_min: 8,
            rep_max: 12,
            target_load_kg: 24,
          },
        ],
      },
    ],
  });
  expect(created.ok, JSON.stringify(created.error)).toBe(true);
  const version = created.result!.plan!.version;
  const activated = await account.plans.activateTrainingPlan({
    request_id: randomUUID(),
    plan_version_id: version.plan_version_id,
    expected_row_revision: version.row_revision,
    confirmation: {
      plan_version_id: version.plan_version_id,
      row_revision: version.row_revision,
      confirmed: true,
    },
  });
  expect(activated.ok, JSON.stringify(activated.error)).toBe(true);
  const data = await account.store.read();
  const items = data.planItems
    .filter((i) => i.plan_version_id === version.plan_version_id)
    .sort((a, b) => a.exercise_order - b.exercise_order);
  const device = sha(randomUUID()),
    code = sha(randomUUID()),
    token = newWatchToken();
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
    hashWatchToken(token),
    `wdv_${randomUUID()}`,
  ]);
  return {
    ...account,
    token,
    plan: version.plan_version_id,
    session: items[0]!.session_id,
    bench: items[0]!.plan_item_id,
    row: items[1]!.plan_item_id,
  };
}

/** The watch API for these accounts; each token reaches only its own. */
async function serve(accounts: Account[], setupRequired = () => false) {
  const byUser = new Map(accounts.map((a) => [a.userId, a]));
  const runtime = {
    options: { db, auth: { assertActive: async () => {} } },
    forUser: async (context: { userId: string }) => {
      const account = byUser.get(context.userId)!;
      return {
        onboarding: { setupRequired: async () => setupRequired() },
        store: account.store,
        service: account.logging,
      };
    },
    exclusive: <T>(_c: unknown, action: () => Promise<T>) => action(),
  } as unknown as DatabaseArnoldRuntime;
  const app = express();
  app.use(express.json());
  mountWatchApi(app, { runtime, routes: workoutRoutes(runtime) });
  const server = app.listen(0, "127.0.0.1");
  servers.push(server);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const url = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/watch/v1/workouts`;
  return (token: string, body: unknown, lang = "de") =>
    fetch(url, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        "accept-language": lang,
        "x-arnold-watch": "1.0.0/006-B3992-00",
      },
      body: JSON.stringify(body),
    });
}

const set = (
  reps: number,
  load_g: number | null,
  at: number,
  side: "both" | "left" | "right" | "alternating" = "both",
) => ({ reps, load_g, side, t0: t0 + at, t1: t0 + at + 40 });

function request(a: Awaited<ReturnType<typeof athlete>>, extra = {}) {
  return {
    request_id: `gw_${randomUUID()}`,
    session_uuid: randomUUID(),
    plan_version_id: a.plan,
    session_id: a.session,
    workout_date_local: day,
    utc_offset_min: berlinOffset,
    started_at_utc: startedAt,
    ended_at_utc: endedAt,
    exercises: [
      {
        plan_item_id: a.bench,
        exercise_id: "bench-press",
        sets: [set(8, 62500, 60), set(8, 62500, 220), set(7, 62500, 380)],
      },
      {
        plan_item_id: a.row,
        exercise_id: "one-arm-row",
        sets: [set(10, 24000, 600, "left"), set(10, 24000, 660, "right")],
      },
    ],
    ...extra,
  };
}

describe("watch upload mapping (GAR-B2-06)", () => {
  it("picks the paired zone, else Etc/GMT±H, else refuses (D-10)", () => {
    const winter = new Date("2026-11-09T12:00:00Z"),
      summer = new Date("2026-07-01T12:00:00Z");
    expect(zoneForUpload("Europe/Berlin", 60, winter)).toBe("Europe/Berlin");
    expect(zoneForUpload("Europe/Berlin", 120, summer)).toBe("Europe/Berlin");
    expect(zoneForUpload("Europe/Berlin", 120, winter)).toBe("Etc/GMT-2");
    expect(zoneForUpload("Europe/Berlin", -300, winter)).toBe("Etc/GMT+5");
    expect(zoneForUpload("Europe/Berlin", 0, winter)).toBe("Etc/GMT");
    expect(() => zoneForUpload("Europe/Berlin", 330, winter)).toThrow(
      WatchApiError,
    );
  });

  it("turns grams into kg, skips what the watch did not do and orders the timings", () => {
    const items = [
      { plan_item_id: "a", exercise_order: 1 },
      { plan_item_id: "b", exercise_order: 2 },
      { plan_item_id: "c", exercise_order: 3 },
    ].map((i) => ({
      ...i,
      plan_version_id: "p",
      session_id: "s",
      status: "active",
    }));
    const { input, timings } = mapUpload(
      {
        request_id: "gw_1",
        session_uuid: randomUUID(),
        plan_version_id: "p",
        session_id: "s",
        workout_date_local: day,
        utc_offset_min: 60,
        started_at_utc: startedAt,
        ended_at_utc: endedAt,
        exercises: [
          // Extra exercise first on the watch, saved last.
          { exercise_id: "x", sets: [set(12, null, 900)] },
          { plan_item_id: "c", exercise_id: "swap", sets: [set(5, 100000, 0)] },
          { plan_item_id: "a", skip: true },
        ],
      },
      { planItems: items as never },
      "Europe/Berlin",
    );
    expect(input.exercises).toEqual([
      { exercise_id: "x", sets: [{ reps: 12, side: "both" }] },
      {
        plan_item_id: "c",
        exercise_id: "swap",
        sets: [{ reps: 5, load_kg: 100, side: "both" }],
      },
      { plan_item_id: "a", skip: true },
      { plan_item_id: "b", skip: true },
    ]);
    expect(timings.map((t) => [t.exercise_order, t.rest_before_s])).toEqual([
      [1, null],
      [2, 860],
    ]);
  });
});

describe("POST /workouts (GAR-B2-06)", () => {
  it("saves a training from the watch with records and next time, and replays it", async () => {
    const a = await athlete();
    const post = await serve([a]);
    const body = request(a);
    const saved = await post(a.token, body);
    expect(saved.status).toBe(201);
    const response = WatchWorkoutResponseSchema.parse(await saved.json());
    expect(response.replayed).toBe(false);
    expect(response.summary.next.map((n) => n.exercise_id).sort()).toEqual([
      "bench-press",
      "one-arm-row",
    ]);
    expect(response.summary.next[0]!.message).toMatch(/^Nächstes Mal /);
    const data = await a.store.read();
    const workout = data.workouts.find(
      (w) => w.workout_id === response.workout_id,
    )!;
    expect(workout).toMatchObject({
      source: "sync",
      client_session_id: body.session_uuid,
      timezone: "Europe/Berlin",
      workout_date_local: day,
      started_at_utc: startedAt,
      ended_at_utc: endedAt,
    });
    const sets = data.sets.filter((s) => s.workout_id === workout.workout_id);
    expect(sets.map((s) => [s.exercise_id, s.side, s.reps, s.load_kg])).toEqual(
      [
        ["bench-press", "both", 8, 62.5],
        ["bench-press", "both", 8, 62.5],
        ["bench-press", "both", 7, 62.5],
        ["one-arm-row", "left", 10, 24],
        ["one-arm-row", "right", 10, 24],
      ],
    );
    const again = await post(a.token, body);
    expect(again.status).toBe(200);
    expect(WatchWorkoutResponseSchema.parse(await again.json())).toMatchObject({
      workout_id: response.workout_id,
      replayed: true,
    });
    expect(
      (await a.store.read()).workouts.filter((w) => w.status === "completed"),
    ).toHaveLength(1);
    // Same request id, other content: refused, nothing written.
    const changed = await post(a.token, {
      ...body,
      exercises: [{ ...body.exercises[0], sets: [set(9, 62500, 60)] }],
    });
    expect(changed.status).toBe(409);
    expect((await changed.json()).error.code).toBe("DUPLICATE_OPERATION");
  });

  it("asks before a second training of the same day and saves it with a new request id", async () => {
    const a = await athlete();
    const post = await serve([a]);
    // The same session logged in ChatGPT before.
    const chat = await a.logging.execute("log_workout", {
      request_id: randomUUID(),
      workout_date_local: day,
      timezone: "Europe/Berlin",
      plan_version_id: a.plan,
      session_id: a.session,
    });
    expect(chat.ok, JSON.stringify(chat.error)).toBe(true);
    const body = request(a);
    const duplicate = await post(a.token, body);
    expect(duplicate.status).toBe(409);
    expect((await duplicate.json()).error).toMatchObject({
      code: "DUPLICATE_WORKOUT",
      retryable: false,
    });
    const confirmed = await post(a.token, {
      ...body,
      request_id: `gw_${randomUUID()}`,
      confirm_duplicate: true,
    });
    expect(confirmed.status).toBe(201);
  });

  it("asks for unusual values and refuses future dates", async () => {
    const a = await athlete();
    const post = await serve([a]);
    const heavy = request(a);
    heavy.exercises[0]!.sets = [set(5, 600000, 60)];
    const unusual = await post(a.token, heavy);
    expect(unusual.status).toBe(422);
    expect((await unusual.json()).error.code).toBe("CONFIRMATION_REQUIRED");
    expect(
      (
        await post(a.token, {
          ...heavy,
          request_id: `gw_${randomUUID()}`,
          confirm_unusual_values: true,
        })
      ).status,
    ).toBe(201);
    const tomorrow = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Europe/Berlin",
    }).format(new Date(Date.now() + 2 * 86_400_000));
    const future = await post(
      a.token,
      request(a, {
        workout_date_local: tomorrow,
        started_at_utc: `${tomorrow}T12:00:00Z`,
        ended_at_utc: `${tomorrow}T13:00:00Z`,
        utc_offset_min: offsetMinutes(
          "Europe/Berlin",
          new Date(`${tomorrow}T12:00:00Z`),
        ),
      }),
    );
    expect(future.status).toBe(422);
    expect((await future.json()).error.code).toBe("DATE_IN_FUTURE");
  });

  it("treats a resend after a change in ChatGPT as sent, and reports SCHEMA_MISMATCH when the stored rows are gone", async () => {
    const a = await athlete();
    const post = await serve([a]);
    const body = request(a);
    const saved = WatchWorkoutResponseSchema.parse(
      await (await post(a.token, body)).json(),
    );
    const replaced = await a.logging.execute("log_workout", {
      request_id: randomUUID(),
      workout_date_local: day,
      timezone: "Europe/Berlin",
      plan_version_id: a.plan,
      session_id: a.session,
      replaces_workout_id: saved.workout_id,
      expected_row_revision: 1,
    });
    expect(replaced.ok, JSON.stringify(replaced.error)).toBe(true);
    // Rows moved on (voided): the receipt still holds, the upload arrived.
    const resent = await post(a.token, body);
    expect(resent.status).toBe(200);
    expect(await resent.json()).toMatchObject({
      workout_id: saved.workout_id,
      replayed: true,
    });
    // Rows of the receipt gone: the data no longer matches it.
    await asOwner((c) =>
      c.query(
        "delete from arnold.sets where user_id = $1 and workout_id = $2",
        [a.userId, saved.workout_id],
      ),
    );
    const mismatch = await post(a.token, body);
    expect(mismatch.status).toBe(409);
    expect((await mismatch.json()).error).toMatchObject({
      code: "SCHEMA_MISMATCH",
      retryable: false,
    });
  });

  it("answers SETUP_REQUIRED and refuses offsets that fit no zone", async () => {
    const a = await athlete();
    const blocked = await serve([a], () => true);
    const setup = await blocked(a.token, request(a));
    expect(setup.status).toBe(409);
    expect((await setup.json()).error.code).toBe("SETUP_REQUIRED");
    const post = await serve([a]);
    const odd = await post(a.token, request(a, { utc_offset_min: 330 }));
    expect(odd.status).toBe(422);
    expect((await odd.json()).error.code).toBe("VALIDATION_ERROR");
    expect((await a.store.read()).workouts).toHaveLength(0);
  });

  it("keeps every watch to its own account (cross-user)", async () => {
    const alice = await athlete(),
      bob = await athlete();
    const post = await serve([alice, bob]);
    // Bob's watch with Alice's plan ids: Bob has no such plan.
    const foreign = await post(bob.token, request(alice));
    expect(foreign.status).toBe(422);
    expect((await alice.store.read()).workouts).toHaveLength(0);
    expect((await bob.store.read()).workouts).toHaveLength(0);
    const own = await post(bob.token, request(bob));
    expect(own.status).toBe(201);
    expect((await alice.store.read()).workouts).toHaveLength(0);
    expect((await bob.store.read()).workouts).toHaveLength(1);
  });
});
