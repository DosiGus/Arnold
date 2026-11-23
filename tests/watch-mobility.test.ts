/**
 * MOB-006: the mobility routes of the watch API against the test Postgres.
 * Real watch tokens, real accounts and the real mobility and plan services;
 * only the setup gate is stubbed. Covers today's list, the routine (ETag/304,
 * German and English), the mark `mv`, the byte budgets with the longest
 * catalog texts, the upload (new, repeated, conflict, unknown field), the
 * access classes, the user's calendar day, and the delivery status that needs
 * the mobility mark for a plan with mobility. All values are invented.
 */
import { afterAll, afterEach, describe, expect, it } from "vitest";
import express from "express";
import type { Server } from "node:http";
import { createHash, randomUUID } from "node:crypto";
import { mountWatchApi } from "../src/server/watch/router.js";
import {
  hasWatchMobility,
  mobilityMark,
  mobilityRoutes,
  routineBody,
  todayBody,
} from "../src/server/watch/mobility.js";
import { planRoutes } from "../src/server/watch/plan.js";
import {
  currentMobilityMark,
  currentPlanMark,
  deliveryOf,
  watchDelivery,
} from "../src/server/watch/delivery.js";
import type { DatabaseArnoldRuntime } from "../src/server/db/runtime.js";
import {
  hashWatchToken,
  newWatchToken,
} from "../src/server/auth/watch-token.js";
import { WATCH_ROUTE_ACCESS } from "../src/server/auth/tool-access.js";
import { MobilityService } from "../src/server/mobility/service.js";
import {
  mobilityDayInputsOf,
  type MobilityDayInputs,
  type MobilityDaySession,
} from "../src/server/mobility/day.js";
import { TrainingPlanService } from "../src/server/plan/service.js";
import type { AuthorizationGuard } from "../src/server/workout/infrastructure.js";
import {
  MOBILITY_CATALOG,
  mobilityExercise,
} from "../src/shared/mobility-catalog.js";
import {
  MOBILITY_WATCH_BUDGET_BYTES,
  WatchMobilityResponseSchema,
  WatchMobilityRoutineSchema,
  WatchMobilityTodaySchema,
} from "../src/shared/mobility-contract.js";
import { jsonBytes } from "../src/shared/run-contract.js";
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

const ZONE = "Europe/Berlin";
// A Monday evening in Berlin (UTC+1): 2026-11-23 23:30 local = 22:30 UTC.
const NOW = "2026-11-23T22:30:00Z";
const MORNING_IDS = [
  "mob_neck_rolls",
  "mob_neck_side",
  "mob_shoulder_circles",
  "mob_arm_circles",
  "mob_doorway_chest",
];
const FLOOR_IDS = [
  "mob_cat_cow",
  "mob_childs_pose",
  "mob_thread_needle",
  "mob_open_book",
  "mob_worlds_greatest",
  "mob_kneeling_hip_flexor",
];

/** An account with a paired watch (Berlin), the plan service and the mobility service. */
async function athlete(now = NOW) {
  const account = await newAccount(db);
  const authorization: AuthorizationGuard = {
    authorize: async () => ({
      subject: account.userId,
      trackerId: account.trackerId,
      verified: true,
      kind: "authenticated",
      permissions: ["write", "correct_completed"],
    }),
  } as AuthorizationGuard;
  const options = {
    mode: "database" as const,
    trackerId: account.trackerId,
    store: account.store,
    authorization,
    clock: () => new Date(now),
  };
  const device = sha(randomUUID()),
    code = sha(randomUUID()),
    token = newWatchToken();
  await db.query("select * from arnold.start_watch_pairing($1,$2,$3,600)", [
    device,
    code,
    "Forerunner 255",
  ]);
  await db.asUser(account.userId, (c) =>
    c.query("select * from arnold.approve_watch_pairing($1,$2)", [code, ZONE]),
  );
  const deviceId = `wdv_${randomUUID()}`;
  await db.query("select * from arnold.redeem_watch_pairing($1,$2,$3)", [
    device,
    hashWatchToken(token),
    deviceId,
  ]);
  return {
    ...account,
    token,
    deviceId,
    mobility: new MobilityService(options),
    plans: new TrainingPlanService(options),
  };
}
type Athlete = Awaited<ReturnType<typeof athlete>>;

/** A plan with one strength day, a morning routine, a Saturday session and one after strength; activated. */
async function activePlan(a: Athlete, withMobility = true) {
  const created = await a.plans.execute("create_training_plan", {
    request_id: randomUUID(),
    name: "Testplan",
    days_per_week: 2,
    sessions: [
      {
        session_name: "A",
        exercises: [
          { exercise_id: "squat", target_sets: 3, rep_min: 6, rep_max: 8 },
        ],
      },
    ],
  });
  expect(created.error).toBeNull();
  let version = created.result!.plan!.version;
  if (withMobility) {
    const strengthSession = (await a.store.read()).planItems.find(
      (i) => i.plan_version_id === version.plan_version_id,
    )!.session_id;
    const edited = await a.plans.execute("update_plan_draft", {
      request_id: randomUUID(),
      plan_version_id: version.plan_version_id,
      expected_row_revision: version.row_revision,
      edits: [
        {
          type: "add_mobility_session",
          kind: "morning",
          session_name: "Morgenroutine",
          minutes: 10,
          exercise_ids: MORNING_IDS,
          weekdays: [1, 2, 3, 4, 5, 6, 7],
        },
        {
          type: "add_mobility_session",
          kind: "session",
          session_name: "Hüfte öffnen",
          minutes: 15,
          exercise_ids: FLOOR_IDS,
          weekdays: [6],
        },
        {
          type: "add_mobility_session",
          kind: "session",
          session_name: "Nach dem Training",
          minutes: 15,
          exercise_ids: FLOOR_IDS,
          placement: "after_strength",
          after_session_id: strengthSession,
        },
      ],
    });
    expect(edited.error, JSON.stringify(edited.error)).toBeNull();
    version = edited.result!.plan!.version;
  }
  const activated = await a.plans.execute("activate_training_plan", {
    request_id: randomUUID(),
    plan_version_id: version.plan_version_id,
    expected_row_revision: version.row_revision,
    confirmation: {
      plan_version_id: version.plan_version_id,
      row_revision: version.row_revision,
      confirmed: true,
    },
  });
  expect(activated.error).toBeNull();
  return version.plan_version_id;
}

/** The watch API for these accounts; each token reaches only its own. */
async function serve(accounts: Athlete[], now = NOW) {
  const byUser = new Map(accounts.map((a) => [a.userId, a]));
  const runtime = {
    options: {
      db,
      auth: { assertActive: async () => {} },
      now: () => Date.parse(now),
    },
    forUser: async (context: { userId: string }) => {
      const account = byUser.get(context.userId)!;
      return {
        onboarding: { setupRequired: async () => false },
        store: account.store,
        mobility: account.mobility,
      };
    },
    exclusive: <T>(_c: unknown, action: () => Promise<T>) => action(),
  } as unknown as DatabaseArnoldRuntime;
  const app = express();
  app.use(express.json());
  mountWatchApi(app, {
    runtime,
    routes: [...mobilityRoutes(runtime), ...planRoutes(runtime)],
  });
  const server = app.listen(0, "127.0.0.1");
  servers.push(server);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/watch/v1`;
  return (
    method: string,
    path: string,
    token: string | null,
    body?: unknown,
    headers: Record<string, string> = {},
  ) =>
    fetch(`${base}${path}`, {
      method,
      headers: {
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        "content-type": "application/json",
        "accept-language": "de",
        "x-arnold-watch": "1.0.0/006-B3992-00",
        ...headers,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
}

/* ------------------------------------------------------ pure: marks, budgets */

const timing = (ids: readonly string[]) => {
  const items = ids.map((id) => {
    const e = mobilityExercise(id)!;
    return {
      exercise_id: id,
      sides: e.per_side ? 2 : 1,
      seconds_per_side: e.default_s,
      reps: e.reps,
    };
  });
  return {
    catalog_version: "mob-1",
    rules_version: "r1",
    exercise_ids: [...ids],
    items,
    total_s: items.reduce((n, i) => n + i.sides * i.seconds_per_side, 0),
  };
};

const sessionOf = (
  n: number,
  ids: readonly string[],
  extra: Partial<MobilityDaySession> = {},
): MobilityDaySession => ({
  session_id: `s_00000000-0000-4000-8000-00000000000${n}`,
  kind: n === 1 ? "morning" : "session",
  session_name: n === 1 ? "Morgenroutine" : "Äußere Rotation für Ärzte ü",
  session_order: n,
  minutes: n === 1 ? 10 : 30,
  placement: "own_day",
  weekdays: n === 1 ? [1, 2, 3, 4, 5, 6, 7] : [n],
  after_session_id: null,
  template: timing(ids) as MobilityDaySession["template"],
  ...extra,
});

const inputsOf = (sessions: MobilityDaySession[]): MobilityDayInputs => ({
  wants: true,
  plan_activated_at_utc: "2026-11-01T00:00:00Z",
  sessions,
  next_strength_session_id: null,
  strength_done: [],
  done: [],
});

/** The 15 exercises whose German and English texts are the longest in bytes. */
const longest = [...MOBILITY_CATALOG]
  .sort(
    (a, b) =>
      Buffer.byteLength(b.name_de + b.cue_de) +
      Buffer.byteLength(b.name_en + b.cue_en) -
      (Buffer.byteLength(a.name_de + a.cue_de) +
        Buffer.byteLength(a.name_en + a.cue_en)),
  )
  .slice(0, 15)
  .map((e) => e.id);

describe("mobility mark and budgets (pure)", () => {
  it("keeps five entries with long umlaut names under 1200 bytes and 15 exercises under 2500, in both languages", () => {
    const sessions = [1, 2, 3, 4, 5].map((n) =>
      sessionOf(n, n === 1 ? MORNING_IDS : longest),
    );
    const inputs = inputsOf(sessions);
    for (const lang of ["de", "en"] as const) {
      const list = todayBody(inputs, "2026-11-23", lang);
      expect(list.items).toHaveLength(5);
      expect(jsonBytes(list)).toBeLessThanOrEqual(
        MOBILITY_WATCH_BUDGET_BYTES.today,
      );
      const routine = routineBody(sessions[1]!, lang);
      expect(routine.ex).toHaveLength(15);
      expect(jsonBytes(routine)).toBeLessThanOrEqual(
        MOBILITY_WATCH_BUDGET_BYTES.routine,
      );
      for (const item of list.items)
        expect(item.n.length).toBeLessThanOrEqual(22);
    }
  });

  it("holds the mark independent of the language and the names, and moves it with the plan", () => {
    const base = inputsOf([sessionOf(1, MORNING_IDS), sessionOf(2, FLOOR_IDS)]);
    const mark = mobilityMark(base);
    expect(mark).toMatch(/^[0-9a-f]{16}$/);
    expect(todayBody(base, "2026-11-23", "de").mv).toBe(mark);
    expect(todayBody(base, "2026-11-23", "en").mv).toBe(mark);
    // The tags show the language (names and cues are in them), the mark does not.
    expect(todayBody(base, "2026-11-23", "de").items[0]!.tag).not.toBe(
      todayBody(base, "2026-11-23", "en").items[0]!.tag,
    );
    // A new name or the day changes nothing; weekdays, minutes, exercises or a new routine do.
    const renamed = inputsOf([
      sessionOf(1, MORNING_IDS, { session_name: "Frühstart" }),
      sessionOf(2, FLOOR_IDS),
    ]);
    expect(mobilityMark(renamed)).toBe(mark);
    const changed = (sessions: MobilityDaySession[]) =>
      mobilityMark(inputsOf(sessions));
    expect(
      changed([
        sessionOf(1, MORNING_IDS, { weekdays: [1, 2] }),
        sessionOf(2, FLOOR_IDS),
      ]),
    ).not.toBe(mark);
    expect(
      changed([
        sessionOf(1, MORNING_IDS, { minutes: 5 }),
        sessionOf(2, FLOOR_IDS),
      ]),
    ).not.toBe(mark);
    expect(
      changed([sessionOf(1, MORNING_IDS.slice(0, 4)), sessionOf(2, FLOOR_IDS)]),
    ).not.toBe(mark);
    expect(changed([sessionOf(1, MORNING_IDS)])).not.toBe(mark);
    expect(hasWatchMobility(inputsOf([]))).toBe(false);
  });

  it("gives the weekday mask with bit 0 = Monday and today's bit after strength", () => {
    const after = sessionOf(3, FLOOR_IDS, {
      placement: "after_strength",
      weekdays: [],
      after_session_id: "s_strength",
    });
    const list = todayBody(
      inputsOf([sessionOf(1, MORNING_IDS), sessionOf(2, FLOOR_IDS), after]),
      "2026-11-25", // a Wednesday
      "de",
    );
    expect(list.items.map((i) => [i.k, i.w, i.a])).toEqual([
      ["m", 127, null],
      ["s", 2, null], // weekdays [2] = Tuesday = bit 1
      ["s", 4, "s_strength"], // Wednesday = bit 2
    ]);
  });
});

/* ------------------------------------------------------- HTTP: list, routine */

describe("GET /mobility/today and /mobility/:id", () => {
  it("lists the routines of the plan in the user's calendar, with the mark, an ETag and 304", async () => {
    const a = await athlete();
    await activePlan(a);
    const call = await serve([a]);
    const res = await call("GET", "/mobility/today", a.token);
    expect(res.status).toBe(200);
    const list = WatchMobilityTodaySchema.parse(await res.json());
    // 22:30 UTC on Monday is 23:30 in Berlin: still Monday, the 23rd.
    expect(list.d).toBe("2026-11-23");
    expect(list.items.map((i) => i.k)).toEqual(["m", "s", "s"]);
    expect(list.items.map((i) => i.n)).toEqual([
      "Morgenroutine",
      "Hüfte öffnen",
      "Nach dem Training",
    ]);
    expect(list.items.map((i) => i.w)).toEqual([127, 32, 1]);
    expect(list.items[2]!.a).not.toBeNull();
    expect(list.items.every((i) => i.dn === false)).toBe(true);
    expect(res.headers.get("vary")).toContain("Accept-Language");
    const tag = res.headers.get("etag")!;
    const again = await call("GET", "/mobility/today", a.token, undefined, {
      "if-none-match": tag,
    });
    expect(again.status).toBe(304);
    // The mark is the one of the plan's mobility.
    expect(list.mv).toBe(
      mobilityMark(mobilityDayInputsOf(await a.store.read())),
    );
  });

  it("serves the routine with names from the catalog in German or English, a strong ETag and 304", async () => {
    const a = await athlete();
    await activePlan(a);
    const call = await serve([a]);
    const list = WatchMobilityTodaySchema.parse(
      await (await call("GET", "/mobility/today", a.token)).json(),
    );
    const morning = list.items[0]!;
    const de = await call("GET", `/mobility/${morning.id}`, a.token);
    expect(de.status).toBe(200);
    const routine = WatchMobilityRoutineSchema.parse(await de.json());
    expect(routine.ex.map((e) => e.c)).toEqual(MORNING_IDS);
    const first = mobilityExercise(MORNING_IDS[0]!)!;
    expect(routine.ex[0]).toMatchObject({ n: first.name_de, h: first.cue_de });
    // The tag of the list is the ETag of the routine.
    expect(de.headers.get("etag")).toBe(`"${morning.tag}"`);
    expect(
      (
        await call("GET", `/mobility/${morning.id}`, a.token, undefined, {
          "if-none-match": `"${morning.tag}"`,
        })
      ).status,
    ).toBe(304);

    const en = await call(
      "GET",
      `/mobility/${morning.id}`,
      a.token,
      undefined,
      {
        "accept-language": "en-GB",
      },
    );
    const english = WatchMobilityRoutineSchema.parse(await en.json());
    expect(english.ex[0]).toMatchObject({ n: first.name_en, h: first.cue_en });
    expect(en.headers.get("etag")).not.toBe(de.headers.get("etag"));
    // The same mark in English; the default name is English, the others stay.
    const listEn = WatchMobilityTodaySchema.parse(
      await (
        await call("GET", "/mobility/today", a.token, undefined, {
          "accept-language": "en",
        })
      ).json(),
    );
    expect(listEn.mv).toBe(list.mv);
    expect(listEn.items.map((i) => i.n)).toEqual([
      "Morning routine",
      "Hüfte öffnen",
      "Nach dem Training",
    ]);
  });

  it("answers an unknown, malformed or a stranger's id with 404, and refuses without a token", async () => {
    const a = await athlete();
    const b = await athlete();
    await activePlan(a);
    await activePlan(b);
    const call = await serve([a, b]);
    const mine = WatchMobilityTodaySchema.parse(
      await (await call("GET", "/mobility/today", a.token)).json(),
    ).items[0]!.id;
    expect((await call("GET", "/mobility/s_unknown", a.token)).status).toBe(
      404,
    );
    expect((await call("GET", "/mobility/%20", a.token)).status).toBe(404);
    expect((await call("GET", `/mobility/${mine}`, b.token)).status).toBe(404);
    expect((await call("GET", "/mobility/today", null)).status).toBe(401);
    expect((await call("GET", "/mobility/today", "wrong")).status).toBe(401);
  });

  it("gives an empty list with a mark for a plan without mobility", async () => {
    const a = await athlete();
    await activePlan(a, false);
    const call = await serve([a]);
    const list = WatchMobilityTodaySchema.parse(
      await (await call("GET", "/mobility/today", a.token)).json(),
    );
    expect(list.items).toEqual([]);
    expect(list.mv).toMatch(/^[0-9a-f]{16}$/);
  });

  it("counts today by the user's calendar: just after midnight local time the day has changed", async () => {
    // 23:10 UTC on Monday is 00:10 on Tuesday in Berlin.
    const a = await athlete("2026-11-23T23:10:00Z");
    const planVersion = await activePlan(a);
    const call = await serve([a], "2026-11-23T23:10:00Z");
    const list = WatchMobilityTodaySchema.parse(
      await (await call("GET", "/mobility/today", a.token)).json(),
    );
    expect(list.d).toBe("2026-11-24");
    expect(list.items.every((i) => i.dn === false)).toBe(true);

    // A routine done on the local Tuesday counts as done on Tuesday, not on Monday.
    const session = (await a.store.read()).planMobilitySessions!.find(
      (s) => s.plan_version_id === planVersion && s.kind === "morning",
    )!;
    const sent = await call(
      "POST",
      "/mobility",
      a.token,
      upload(session, "2026-11-24", 60, {
        started_at_utc: "2026-11-23T22:55:00Z",
        ended_at_utc: "2026-11-23T23:03:00Z",
      }),
    );
    expect(sent.status).toBe(201);
    const after = WatchMobilityTodaySchema.parse(
      await (await call("GET", "/mobility/today", a.token)).json(),
    );
    expect(after.items.map((i) => i.dn)).toEqual([true, false, false]);
    const monday = await serve([a], "2026-11-23T20:00:00Z");
    const before = WatchMobilityTodaySchema.parse(
      await (await monday("GET", "/mobility/today", a.token)).json(),
    );
    expect(before.d).toBe("2026-11-23");
    expect(before.items.every((i) => i.dn === false)).toBe(true);
  });
});

/* --------------------------------------------------------------- the upload */

function upload(
  session: {
    plan_version_id: string;
    session_id: string;
    template: { exercise_ids: string[] };
  },
  date: string,
  offset: number,
  extra: Record<string, unknown> = {},
) {
  return {
    request_id: `gm_${randomUUID()}`,
    session_uuid: randomUUID(),
    plan_version_id: session.plan_version_id,
    session_id: session.session_id,
    kind: "morning",
    workout_date_local: date,
    utc_offset_min: offset,
    started_at_utc: "2026-11-23T22:00:00Z",
    ended_at_utc: "2026-11-23T22:08:00Z",
    timer_s: 460,
    elapsed_s: 480,
    ended_early: false,
    ex: session.template.exercise_ids.map((c) => ({ c, st: "done", t: 90 })),
    ...extra,
  };
}

describe("POST /mobility", () => {
  it("stores a routine once (201), answers a repeat with 200 and refuses the recording under a new id (409)", async () => {
    const a = await athlete();
    const planVersion = await activePlan(a);
    const call = await serve([a]);
    const session = (await a.store.read()).planMobilitySessions!.find(
      (s) => s.plan_version_id === planVersion && s.kind === "morning",
    )!;
    const body = upload(session, "2026-11-23", 60);
    const first = await call("POST", "/mobility", a.token, body);
    expect(first.status, await first.clone().text()).toBe(201);
    const stored = WatchMobilityResponseSchema.parse(await first.json());
    expect(stored.replayed).toBe(false);
    const repeat = await call("POST", "/mobility", a.token, body);
    expect(repeat.status).toBe(200);
    expect(
      WatchMobilityResponseSchema.parse(await repeat.json()),
    ).toMatchObject({
      workout_id: stored.workout_id,
      replayed: true,
    });
    const conflict = await call("POST", "/mobility", a.token, {
      ...body,
      request_id: `gm_${randomUUID()}`,
    });
    expect(conflict.status).toBe(409);
    expect(
      ((await conflict.json()) as { error: { code: string } }).error.code,
    ).toBe("DUPLICATE_WORKOUT");
    const rows = await asOwner(
      async (c) =>
        (
          await c.query(
            "select count(*)::int as n from arnold.mobility_results where user_id = $1",
            [a.userId],
          )
        ).rows[0].n,
    );
    expect(rows).toBe(1);
  });

  it("refuses an unknown field with 422 and the field path, never the value", async () => {
    const a = await athlete();
    const planVersion = await activePlan(a);
    const call = await serve([a]);
    const session = (await a.store.read()).planMobilitySessions!.find(
      (s) => s.plan_version_id === planVersion && s.kind === "morning",
    )!;
    const res = await call("POST", "/mobility", a.token, {
      ...upload(session, "2026-11-23", 60),
      hr: { avg: 90 },
    });
    expect(res.status).toBe(422);
    const text = await res.text();
    expect(text).toContain("VALIDATION_ERROR");
    expect(text).not.toContain("90");
    expect(
      (
        await call("POST", "/mobility", a.token, {
          ...upload(session, "2026-11-23", 60),
          timer_s: 9999,
        })
      ).status,
    ).toBe(422);
    expect(
      (await call("POST", "/mobility", a.token, { nonsense: true })).status,
    ).toBe(422);
  });

  it("belongs to the write class for the upload and to the read class for the list and the routine", async () => {
    expect(WATCH_ROUTE_ACCESS).toMatchObject({
      "GET /mobility/today": "WATCH_READ",
      "GET /mobility/:id": "WATCH_READ",
      "POST /mobility": "WATCH_WRITE",
    });
  });
});

/* --------------------------------------------------------- delivery status */

describe("delivery with the mobility mark", () => {
  const strength = "0123456789abcdef";
  const mobile = "fedcba9876543210";
  const watch = (
    plan_mark: string | null,
    mobility_mark: string | null = null,
  ) => ({
    app_version: "1.0.0",
    plan_mark,
    mobility_mark,
  });

  it("needs the mobility mark for a plan with mobility and behaves as before without it (pure)", () => {
    // An older app (no mv) with a plan with mobility: pending, however the plan mark matches.
    expect(deliveryOf(strength, [watch(strength)], mobile)).toBe("pending");
    expect(
      deliveryOf(strength, [watch(strength, "0000000000000000")], mobile),
    ).toBe("pending");
    expect(deliveryOf(strength, [watch(strength, mobile)], mobile)).toBe(
      "delivered",
    );
    // A plan without mobility: exactly the old rule, with or without mv.
    expect(deliveryOf(strength, [watch(strength)], null)).toBe("delivered");
    expect(deliveryOf(strength, [watch(strength, mobile)])).toBe("delivered");
    expect(deliveryOf(strength, [watch("aaaaaaaaaaaaaaaa")], null)).toBe(
      "pending",
    );
    expect(deliveryOf(null, [watch(strength)], mobile)).toBe("unknown");
    expect(deliveryOf(strength, [], mobile)).toBe("no_watch");
  });

  it("goes from pending to delivered once the watch confirms v and mv, and back to pending with a changed plan", async () => {
    const a = await athlete();
    await activePlan(a);
    const call = await serve([a]);
    await call("GET", "/mobility/today", a.token); // the watch app reports its version
    let dataset = await a.store.read();
    const v = currentPlanMark(dataset)!;
    const mv = currentMobilityMark(dataset)!;
    expect(mv).toBe(mobilityMark(mobilityDayInputsOf(dataset)));
    expect(await watchDelivery(db, a.userId, dataset)).toBe("pending");
    // The old app confirms v only.
    expect((await call("POST", "/plan/ack", a.token, { v })).status).toBe(200);
    expect(await watchDelivery(db, a.userId, dataset)).toBe("pending");
    // The new app confirms both.
    expect((await call("POST", "/plan/ack", a.token, { v, mv })).status).toBe(
      200,
    );
    expect(await watchDelivery(db, a.userId, dataset)).toBe("delivered");
    // A later ack without mv keeps the stored mobility mark.
    await call("POST", "/plan/ack", a.token, { v });
    expect(await watchDelivery(db, a.userId, dataset)).toBe("delivered");
    // The mark is stored with the receipt.
    const stored = await db.asUser(
      a.userId,
      async (c) =>
        (
          await c.query<{ mobility_mark: string }>(
            "select mobility_mark from arnold.watch_plan_receipts where device_id = $1",
            [a.deviceId],
          )
        ).rows[0]!.mobility_mark,
    );
    expect(stored).toBe(mv);
    // A malformed mv is refused.
    expect(
      (await call("POST", "/plan/ack", a.token, { v, mv: "xyz" })).status,
    ).toBe(422);
    expect(hasWatchMobility(mobilityDayInputsOf(dataset))).toBe(true);
    dataset = await a.store.read();
  });

  it("delivers a plan without mobility with v alone", async () => {
    const a = await athlete();
    await activePlan(a, false);
    const call = await serve([a]);
    await call("GET", "/mobility/today", a.token); // the watch app reports its version
    const dataset = await a.store.read();
    expect(currentMobilityMark(dataset)).toBeNull();
    expect(await watchDelivery(db, a.userId, dataset)).toBe("pending");
    await call("POST", "/plan/ack", a.token, { v: currentPlanMark(dataset)! });
    expect(await watchDelivery(db, a.userId, dataset)).toBe("delivered");
  });
});
