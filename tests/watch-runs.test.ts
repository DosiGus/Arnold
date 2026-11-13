/**
 * RUN-009: the run routes of the watch API against the test Postgres. Real
 * watch tokens, real accounts and the real run service; only the setup gate
 * is stubbed. Covers every route (success, missing/wrong token, a stranger's
 * token), ETag/304, the byte budgets, 20 repeats without a duplicate, the
 * error cases, and that no heart-rate value or zone bound reaches the
 * database without the health consent.
 */
import { afterAll, afterEach, describe, expect, it } from "vitest";
import express from "express";
import type { Server } from "node:http";
import { createHash, randomUUID } from "node:crypto";
import { mountWatchApi } from "../src/server/watch/router.js";
import { runRoutes } from "../src/server/watch/runs.js";
import type { DatabaseArnoldRuntime } from "../src/server/db/runtime.js";
import {
  hashWatchToken,
  newWatchToken,
} from "../src/server/auth/watch-token.js";
import { RunService } from "../src/server/run/service.js";
import type { AuthorizationGuard } from "../src/server/workout/infrastructure.js";
import { deletionSummary } from "../src/server/account/deletion.js";
import { WATCH_ROUTE_ACCESS } from "../src/server/auth/tool-access.js";
import {
  RUN_SEGMENT_KINDS,
  RUN_WATCH_BUDGET_BYTES,
  RunSegmentStatusSchema,
  WatchRunDetailSchema,
  WatchRunResponseSchema,
  WatchRunRpeResponseSchema,
  WatchRunsUpcomingSchema,
  jsonBytes,
} from "../src/shared/run-contract.js";
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
const berlinDay = (offsetDays = 0) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: ZONE }).format(
    new Date(Date.now() + offsetDays * 86_400_000),
  );
const today = berlinDay();
const berlinOffsetMin = () => {
  const name = new Intl.DateTimeFormat("en-US", {
    timeZone: ZONE,
    timeZoneName: "longOffset",
  })
    .formatToParts(new Date())
    .find((p) => p.type === "timeZoneName")!.value;
  const m = /GMT([+-])(\d{2}):(\d{2})/.exec(name)!;
  return (m[1] === "-" ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3]));
};
const iso = (offsetMs: number) =>
  new Date(Date.now() + offsetMs).toISOString().replace(/\.\d{3}Z$/, "Z");

type Account = Awaited<ReturnType<typeof newAccount>>;

/** An account with a paired watch (Berlin) and a run service reading the real consent. */
async function athlete() {
  const account = await newAccount(db);
  const runs = new RunService({
    mode: "database",
    trackerId: account.trackerId,
    store: account.store,
    authorization: {
      authorize: async () => ({
        subject: account.userId,
        trackerId: account.trackerId,
        verified: true,
        kind: "authenticated",
        permissions: ["write", "correct_completed"],
      }),
    } as AuthorizationGuard,
    healthConsent: async () =>
      db.asUser(
        account.userId,
        async (c) =>
          (
            await c.query(
              `select 1 from arnold.health_consents
                where user_id = $1 and scope = 'garmin_health' and revoked_at is null`,
              [account.userId],
            )
          ).rowCount === 1,
      ),
  });
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
  await db.query("select * from arnold.redeem_watch_pairing($1,$2,$3)", [
    device,
    hashWatchToken(token),
    `wdv_${randomUUID()}`,
  ]);
  return { ...account, runs, token };
}
type Athlete = Awaited<ReturnType<typeof athlete>>;

const grantConsent = (a: Athlete) =>
  db.asUser(a.userId, (c) =>
    c.query(
      `insert into arnold.health_consents (user_id, scope, text_version, granted_at)
       values ($1, 'garmin_health', 'test', now())`,
      [a.userId],
    ),
  );

/** The watch API for these accounts; each token reaches only its own. */
async function serve(accounts: Athlete[], setupRequired = () => false) {
  const byUser = new Map(accounts.map((a) => [a.userId, a]));
  const runtime = {
    options: { db, auth: { assertActive: async () => {} } },
    forUser: async (context: { userId: string }) => {
      const account = byUser.get(context.userId)!;
      return {
        onboarding: { setupRequired: async () => setupRequired() },
        store: account.store,
        runs: account.runs,
      };
    },
    exclusive: <T>(_c: unknown, action: () => Promise<T>) => action(),
  } as unknown as DatabaseArnoldRuntime;
  const app = express();
  app.use(express.json());
  mountWatchApi(app, { runtime, routes: runRoutes(runtime) });
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

async function plan(a: Athlete, extra: Record<string, unknown> = {}) {
  const planned = await a.runs.execute("plan_run", {
    request_id: randomUUID(),
    timezone: ZONE,
    workout_date_local: today,
    run_type: "base",
    minutes: 45,
    ...extra,
  });
  expect(planned.ok, JSON.stringify(planned.error)).toBe(true);
  return planned.result!.run!.workout_id;
}

const hr = {
  avg: 140,
  max: 162,
  zone_s: [60, 600, 1200, 600, 240],
  zones: [100, 120, 140, 160, 175, 190],
  zones_sport: "running",
};
const lap = (i: number) => ({
  i,
  rep: null,
  kind: RUN_SEGMENT_KINDS.indexOf("lap"),
  st: RunSegmentStatusSchema.options.indexOf("completed"),
  t: 600,
  dm: 1500,
  tz: null,
});

function result(extra: Record<string, unknown> = {}) {
  return {
    request_id: `wr_${randomUUID()}`,
    session_uuid: randomUUID(),
    workout_date_local: today,
    utc_offset_min: berlinOffsetMin(),
    started_at_utc: iso(-3_600_000),
    ended_at_utc: iso(-600_000),
    environment: "outdoor",
    run_type: "base",
    timer_s: 2700,
    elapsed_s: 2800,
    distance_m: 7000,
    distance_source: "gps",
    splits: [],
    pauses: 0,
    segments: [],
    ...extra,
  };
}

const rows = (sql: string, params: unknown[]) =>
  asOwner(async (c) => (await c.query(sql, params)).rows);

describe("route classes", () => {
  it("classifies every run route", () => {
    expect(WATCH_ROUTE_ACCESS).toMatchObject({
      "GET /runs/upcoming": "WATCH_READ",
      "GET /runs/:id": "WATCH_READ",
      "POST /runs": "WATCH_WRITE",
      "PATCH /runs/:session_uuid/rpe": "WATCH_WRITE",
    });
  });
});

describe("tokens and strangers", () => {
  it("refuses a missing or wrong token on every route with the same 401", async () => {
    const a = await athlete();
    const call = await serve([a]);
    const id = await plan(a);
    const uuid = randomUUID();
    const routes: [string, string, unknown?][] = [
      ["GET", "/runs/upcoming"],
      ["GET", `/runs/${id}`],
      ["POST", "/runs", result()],
      ["PATCH", `/runs/${uuid}/rpe`, { request_id: "r1", rpe: 5 }],
    ];
    for (const [method, path, body] of routes) {
      for (const token of [null, newWatchToken()]) {
        const response = await call(method, path, token, body);
        expect(response.status, `${method} ${path}`).toBe(401);
        expect((await response.json()).error.code).toBe("AUTH_REQUIRED");
      }
    }
    expect(
      (await a.store.read()).workouts.some((w) => w.status === "completed"),
    ).toBe(false);
  });

  it("shows a stranger nothing of another account's runs", async () => {
    const [a, b] = [await athlete(), await athlete()];
    const call = await serve([a, b]);
    const id = await plan(a);
    const body = result({ planned_workout_id: id });
    expect((await call("POST", "/runs", a.token, body)).status).toBe(201);
    // b's list is empty, b's read of a's id looks like a missing one
    const list = await call("GET", "/runs/upcoming", b.token);
    expect((await list.json()).runs).toEqual([]);
    expect((await call("GET", `/runs/${id}`, b.token)).status).toBe(404);
    // b cannot rate a's run: the id is unknown to b
    const rated = await call(
      "PATCH",
      `/runs/${body.session_uuid}/rpe`,
      b.token,
      { request_id: "x1", rpe: 9 },
    );
    expect(rated.status).toBe(409);
    expect((await rated.json()).error.code).toBe("WORKOUT_PENDING");
    // b may use the same session_uuid for its own run; a's is untouched
    const own = await call(
      "POST",
      "/runs",
      b.token,
      result({ session_uuid: body.session_uuid }),
    );
    expect(own.status).toBe(201);
    const mine = (await a.store.read()).runs.find((r) => r.workout_id === id)!;
    expect(mine.rpe).toBeNull();
    expect((await b.store.read()).runs).toHaveLength(1);
  });

  it("asks for the setup first", async () => {
    const a = await athlete();
    const call = await serve([a], () => true);
    for (const [method, path, body] of [
      ["GET", "/runs/upcoming"],
      ["POST", "/runs", result()],
    ] as const) {
      const response = await call(method, path, a.token, body);
      expect(response.status).toBe(409);
      expect((await response.json()).error.code).toBe("SETUP_REQUIRED");
    }
  });
});

describe("GET /runs/upcoming and GET /runs/:id", () => {
  it("lists today's run with consent and tag, answers 304, and reads the prescription", async () => {
    const a = await athlete();
    const call = await serve([a]);
    const id = await plan(a);
    const response = await call("GET", "/runs/upcoming", a.token);
    expect(response.status).toBe(200);
    const etag = response.headers.get("etag")!;
    expect(etag).toMatch(/^"[0-9a-f]{64}"$/);
    const list = WatchRunsUpcomingSchema.parse(await response.json());
    expect(list).toMatchObject({ d: today, hc: false, next: null });
    expect(list.runs).toHaveLength(1);
    expect(list.runs[0]).toMatchObject({ id, d: today, m: 45, dm: null });
    const again = await call("GET", "/runs/upcoming", a.token, undefined, {
      "if-none-match": etag,
    });
    expect(again.status).toBe(304);
    expect(await again.text()).toBe("");
    await grantConsent(a);
    const consented = await call("GET", "/runs/upcoming", a.token);
    expect((await consented.json()).hc).toBe(true);
    expect(consented.headers.get("etag")).not.toBe(etag);

    const detail = await call("GET", `/runs/${id}`, a.token);
    expect(detail.status).toBe(200);
    const detailTag = detail.headers.get("etag")!;
    expect(detailTag).toBe(`"${list.runs[0]!.tag}"`);
    const body = WatchRunDetailSchema.parse(await detail.json());
    expect(body.id).toBe(id);
    expect(body.p.s.length).toBeGreaterThan(0);
    const cached = await call("GET", `/runs/${id}`, a.token, undefined, {
      "if-none-match": detailTag,
    });
    expect(cached.status).toBe(304);
    // an unknown or malformed id is a missing one
    expect((await call("GET", `/runs/${randomUUID()}`, a.token)).status).toBe(
      404,
    );
    expect((await call("GET", "/runs/%20", a.token)).status).toBe(404);
  });

  it("keeps a full week with umlauts within 1500 and a long prescription within 3000 bytes", async () => {
    const a = await athlete();
    const call = await serve([a]);
    const types = [
      "recovery",
      "base",
      "long",
      "progression",
      "tempo",
      "threshold_intervals",
      "intervals",
    ];
    const ids: string[] = [];
    for (const [i, run_type] of types.entries())
      ids.push(
        await plan(a, {
          run_type,
          workout_date_local: berlinDay(i),
          minutes: undefined,
          ...(run_type === "intervals" ? { meters: 6000 } : { minutes: 60 }),
        }),
      );
    const list = await call("GET", "/runs/upcoming", a.token);
    const text = await list.text();
    expect(JSON.parse(text).runs).toHaveLength(7);
    expect(Buffer.byteLength(text)).toBeLessThanOrEqual(
      RUN_WATCH_BUDGET_BYTES.upcoming,
    );
    for (const id of ids) {
      const detail = await call("GET", `/runs/${id}`, a.token);
      expect(Buffer.byteLength(await detail.text())).toBeLessThanOrEqual(
        RUN_WATCH_BUDGET_BYTES.prescription,
      );
    }
  });

  it("fits the largest legal list (seven runs and the next one, 24-letter names with umlauts, uuids) into 1500 bytes", () => {
    const entry = (d?: string) => ({
      id: randomUUID(),
      ...(d ? { d } : {}),
      n: "ÄÖÜäöüßÄÖÜäöüßÄÖÜäöüßÄÖÜäöüß".slice(0, 24),
      k: 13,
      m: 600,
      dm: 42195,
      e: 2,
      tag: "A".repeat(12),
    });
    const body = WatchRunsUpcomingSchema.parse({
      api_version: 1,
      min_app_version: "1.0.0",
      d: today,
      hc: true,
      runs: Array.from({ length: 7 }, () => entry(today)),
      next: entry(),
    });
    expect(jsonBytes(body)).toBeLessThanOrEqual(
      RUN_WATCH_BUDGET_BYTES.upcoming,
    );
  });
});

describe("POST /runs", () => {
  it("completes a planned run in one write and replays 20 times without a duplicate", async () => {
    const a = await athlete();
    const call = await serve([a]);
    const planned = await plan(a);
    const body = result({ planned_workout_id: planned });
    const saved = await call("POST", "/runs", a.token, body);
    expect(saved.status).toBe(201);
    const first = WatchRunResponseSchema.parse(await saved.json());
    expect(first).toMatchObject({
      workout_id: planned,
      replayed: false,
      hr_discarded: false,
    });
    for (let i = 0; i < 20; i++) {
      const again = await call("POST", "/runs", a.token, body);
      expect(again.status).toBe(200);
      expect(WatchRunResponseSchema.parse(await again.json())).toMatchObject({
        workout_id: planned,
        replayed: true,
      });
    }
    const data = await a.store.read();
    expect(data.workouts.filter((w) => w.activity_type === "run")).toHaveLength(
      1,
    );
    expect(data.runs).toHaveLength(1);
    expect(data.workouts[0]).toMatchObject({
      status: "completed",
      client_session_id: body.session_uuid,
    });
    expect(data.runs[0]).toMatchObject({
      result_source: "watch",
      timer_s: 2700,
      distance_m: 7000,
    });
    // one receipt for the one write
    const receipts = await rows(
      "select 1 from arnold.operations where user_id = $1 and request_id = $2",
      [a.userId, body.request_id],
    );
    expect(receipts).toHaveLength(1);
  });

  it("saves a free run with segments and splits (no plan reference)", async () => {
    const a = await athlete();
    const call = await serve([a]);
    const body = result({
      distance_m: 4000,
      timer_s: 1500,
      elapsed_s: 1600,
      splits: Array.from({ length: 40 }, (_, i) => (i + 1) * 36),
      segments: [lap(0), lap(1)],
    });
    const saved = await call("POST", "/runs", a.token, body);
    expect(saved.status).toBe(201);
    const data = await a.store.read();
    expect(data.runs).toHaveLength(1);
    expect(data.runSegments).toHaveLength(2);
    expect(data.runs[0]!.splits_100m).toHaveLength(40);
  });

  it("refuses the same request id with other content, the same recording with a new request id, and a second twin run until confirmed", async () => {
    const a = await athlete();
    const call = await serve([a]);
    const body = result();
    expect((await call("POST", "/runs", a.token, body)).status).toBe(201);
    const changed = await call("POST", "/runs", a.token, {
      ...body,
      timer_s: 2600,
    });
    expect(changed.status).toBe(409);
    expect((await changed.json()).error).toMatchObject({
      code: "DUPLICATE_OPERATION",
      retryable: false,
    });
    const sameRecording = await call("POST", "/runs", a.token, {
      ...body,
      request_id: `wr_${randomUUID()}`,
    });
    expect(sameRecording.status).toBe(409);
    expect((await sameRecording.json()).error.code).toBe("DUPLICATE_WORKOUT");
    // another recording of an equal run (day, type, time, distance)
    const twin = result({ started_at_utc: body.started_at_utc });
    const asked = await call("POST", "/runs", a.token, twin);
    expect(asked.status).toBe(409);
    expect((await asked.json()).error.code).toBe("DUPLICATE_WORKOUT");
    const confirmed = await call("POST", "/runs", a.token, {
      ...twin,
      confirm_duplicate: true,
    });
    expect(confirmed.status).toBe(201);
    expect((await a.store.read()).runs).toHaveLength(2);
  });

  it("answers DUPLICATE_WORKOUT for a planned run that is done, and saves it as its own run once confirmed", async () => {
    const a = await athlete();
    const call = await serve([a]);
    const planned = await plan(a);
    expect(
      (
        await call(
          "POST",
          "/runs",
          a.token,
          result({ planned_workout_id: planned }),
        )
      ).status,
    ).toBe(201);
    const other = result({
      planned_workout_id: planned,
      timer_s: 2000,
      elapsed_s: 2100,
      distance_m: 5000,
    });
    const refused = await call("POST", "/runs", a.token, other);
    expect(refused.status).toBe(409);
    expect((await refused.json()).error.code).toBe("DUPLICATE_WORKOUT");
    const confirmed = await call("POST", "/runs", a.token, {
      ...other,
      confirm_duplicate: true,
    });
    expect(confirmed.status).toBe(201);
    expect((await a.store.read()).runs).toHaveLength(2);
  });

  it("refuses a date or start in the future and invalid bodies, writing nothing", async () => {
    const a = await athlete();
    const call = await serve([a]);
    const future = await call(
      "POST",
      "/runs",
      a.token,
      result({ workout_date_local: berlinDay(3) }),
    );
    expect(future.status).toBe(422);
    expect((await future.json()).error.code).toBe("DATE_IN_FUTURE");
    const later = await call(
      "POST",
      "/runs",
      a.token,
      result({ started_at_utc: iso(3_600_000), ended_at_utc: iso(7_200_000) }),
    );
    expect(later.status).toBe(422);
    expect((await later.json()).error.code).toBe("DATE_IN_FUTURE");
    for (const broken of [
      { ...result(), timer_s: 9999 },
      { ...result(), session_uuid: "nope" },
      { ...result(), extra: 1 },
    ]) {
      const response = await call("POST", "/runs", a.token, broken);
      expect(response.status).toBe(422);
      expect((await response.json()).error.code).toBe("VALIDATION_ERROR");
    }
    const notJson = await call("POST", "/runs", a.token, undefined, {
      "content-type": "text/plain",
    });
    expect(notJson.status).toBe(415);
    expect((await a.store.read()).runs).toHaveLength(0);
  });

  it("takes up to 64 KB and refuses more", async () => {
    const a = await athlete();
    const call = await serve([a]);
    const big = result({
      distance_m: 60_000,
      timer_s: 20_000,
      elapsed_s: 20_100,
      splits: Array.from({ length: 600 }, (_, i) => (i + 1) * 30),
      segments: Array.from({ length: 80 }, (_, i) => lap(i)),
    });
    expect(jsonBytes(big)).toBeLessThan(64 * 1024);
    expect((await call("POST", "/runs", a.token, big)).status).toBe(201);
    const tooBig = { ...result(), padding: "x".repeat(70 * 1024) };
    expect((await call("POST", "/runs", a.token, tooBig)).status).toBe(413);
  });
});

describe("heart rate, zone bounds and no_sensor", () => {
  it("drops heart rate and zone bounds without the consent and says so", async () => {
    const a = await athlete();
    const call = await serve([a]);
    const body = result({ hr });
    const saved = await call("POST", "/runs", a.token, body);
    expect(saved.status).toBe(201);
    expect(WatchRunResponseSchema.parse(await saved.json())).toMatchObject({
      hr_discarded: true,
    });
    const [run] = await rows(
      `select hr_status, hr_avg_bpm, hr_max_bpm, hr_zone_seconds from arnold.runs where user_id = $1`,
      [a.userId],
    );
    expect(run).toEqual({
      hr_status: "no_consent",
      hr_avg_bpm: null,
      hr_max_bpm: null,
      hr_zone_seconds: null,
    });
    expect(
      await rows("select 1 from arnold.run_hr_zones where user_id = $1", [
        a.userId,
      ]),
    ).toHaveLength(0);
    expect(
      await rows(
        "select 1 from arnold.run_segments where user_id = $1 and hr_avg_bpm is not null",
        [a.userId],
      ),
    ).toHaveLength(0);
  });

  it("stores heart rate, segment heart rate and the zone bounds with the consent, once per run", async () => {
    const a = await athlete();
    await grantConsent(a);
    const call = await serve([a]);
    const body = result({ hr, segments: [{ ...lap(0), hr: [138, 150] }] });
    const saved = await call("POST", "/runs", a.token, body);
    expect(saved.status).toBe(201);
    const response = WatchRunResponseSchema.parse(await saved.json());
    expect(response.hr_discarded).toBe(false);
    const [run] = await rows(
      "select hr_status, hr_avg_bpm, hr_max_bpm, hr_zone_seconds from arnold.runs where user_id = $1",
      [a.userId],
    );
    expect(run).toMatchObject({
      hr_status: "recorded",
      hr_avg_bpm: 140,
      hr_max_bpm: 162,
      hr_zone_seconds: [60, 600, 1200, 600, 240],
    });
    for (let i = 0; i < 3; i++)
      expect((await call("POST", "/runs", a.token, body)).status).toBe(200);
    const zones = await rows(
      "select zones_id, sport, bounds, workout_id from arnold.run_hr_zones where user_id = $1",
      [a.userId],
    );
    expect(zones).toEqual([
      {
        zones_id: body.session_uuid,
        sport: "running",
        bounds: [100, 120, 140, 160, 175, 190],
        workout_id: response.workout_id,
      },
    ]);
  });

  it("keeps the zone bounds of another account out of reach and deletes them with a revocation", async () => {
    const [a, b] = [await athlete(), await athlete()];
    await grantConsent(a);
    const call = await serve([a, b]);
    expect((await call("POST", "/runs", a.token, result({ hr }))).status).toBe(
      201,
    );
    expect(
      await db.asUser(
        b.userId,
        async (c) =>
          (await c.query("select 1 from arnold.run_hr_zones")).rowCount,
      ),
    ).toBe(0);
    await db.asUser(a.userId, async (c) => {
      await c.query(
        "update arnold.health_consents set revoked_at = now() where user_id = $1",
        [a.userId],
      );
      await c.query("select arnold.erase_run_health()");
    });
    expect(
      await rows("select 1 from arnold.run_hr_zones where user_id = $1", [
        a.userId,
      ]),
    ).toHaveLength(0);
  });

  it("marks a run without a heart-rate sensor (hr null) as no_sensor, also without consent", async () => {
    const a = await athlete();
    const call = await serve([a]);
    expect(
      (await call("POST", "/runs", a.token, result({ hr: null }))).status,
    ).toBe(201);
    expect(
      (
        await call(
          "POST",
          "/runs",
          a.token,
          result({ timer_s: 1800, elapsed_s: 1850, distance_m: 4000 }),
        )
      ).status,
    ).toBe(201);
    const statuses = await rows(
      "select hr_status, timer_s from arnold.runs where user_id = $1 order by timer_s",
      [a.userId],
    );
    // hr absent: nothing was sent, and without the consent that is no_consent
    expect(statuses.map((r) => r.hr_status)).toEqual([
      "no_consent",
      "no_sensor",
    ]);
    await grantConsent(a);
    expect(
      (
        await call(
          "POST",
          "/runs",
          a.token,
          result({
            timer_s: 1200,
            elapsed_s: 1300,
            distance_m: 3000,
            hr: null,
          }),
        )
      ).status,
    ).toBe(201);
    expect(
      (
        await call(
          "POST",
          "/runs",
          a.token,
          result({ timer_s: 1000, elapsed_s: 1100, distance_m: 2500 }),
        )
      ).status,
    ).toBe(201);
    const withConsent = await rows(
      "select hr_status, timer_s from arnold.runs where user_id = $1 and timer_s <= 1200 order by timer_s",
      [a.userId],
    );
    expect(withConsent.map((r) => r.hr_status)).toEqual([
      "not_provided",
      "no_sensor",
    ]);
  });
});

describe("PATCH /runs/:session_uuid/rpe", () => {
  it("sets the effort after the result, replays it, and refuses other content or an unknown run", async () => {
    const a = await athlete();
    const call = await serve([a]);
    const body = result();
    expect((await call("POST", "/runs", a.token, body)).status).toBe(201);
    const patch = { request_id: `rp_${randomUUID()}`, rpe: 6 };
    const rated = await call(
      "PATCH",
      `/runs/${body.session_uuid}/rpe`,
      a.token,
      patch,
    );
    expect(rated.status).toBe(200);
    expect(WatchRunRpeResponseSchema.parse(await rated.json())).toMatchObject({
      rpe: 6,
      replayed: false,
    });
    for (let i = 0; i < 20; i++) {
      const again = await call(
        "PATCH",
        `/runs/${body.session_uuid}/rpe`,
        a.token,
        patch,
      );
      expect(again.status).toBe(200);
      expect((await again.json()).replayed).toBe(true);
    }
    const [run] = (await a.store.read()).runs;
    expect(run).toMatchObject({ rpe: 6, row_revision: 2 });
    const other = await call(
      "PATCH",
      `/runs/${body.session_uuid}/rpe`,
      a.token,
      {
        ...patch,
        rpe: 7,
      },
    );
    expect(other.status).toBe(409);
    expect((await other.json()).error.code).toBe("DUPLICATE_OPERATION");
    // run not arrived yet: the watch sends again later
    const pending = await call("PATCH", `/runs/${randomUUID()}/rpe`, a.token, {
      request_id: `rp_${randomUUID()}`,
      rpe: 5,
    });
    expect(pending.status).toBe(409);
    expect(await pending.json()).toMatchObject({
      error: { code: "WORKOUT_PENDING", retryable: true },
    });
    for (const [path, broken] of [
      ["/runs/not-a-uuid/rpe", { request_id: "r", rpe: 5 }],
      [`/runs/${randomUUID()}/rpe`, { request_id: "r", rpe: 11 }],
      [`/runs/${randomUUID()}/rpe`, { rpe: 5 }],
    ] as const) {
      const response = await call("PATCH", path, a.token, broken);
      expect(response.status).toBe(422);
    }
  });
});

describe("account deletion text", () => {
  it("names runs, run profile, zone bounds and planned runs", () => {
    const text = deletionSummary().stored_items.join(" ");
    expect(text).toMatch(/Läufe/);
    expect(text).toMatch(/Laufprofil/);
    expect(text).toMatch(/Pulszonen/);
    expect(text).toMatch(/Garmin-Uhren.*Trainingsaufzeichnungen.*Messwerte/);
  });
});

describe("logs", () => {
  it("never carry measurements, tokens or ids of runs", async () => {
    const a = await athlete();
    const call = await serve([a]);
    const lines: string[] = [];
    const original = console.log;
    process.env.ARNOLD_TOOL_LOG = "json";
    console.log = (line: unknown) => void lines.push(String(line));
    try {
      const body = result({ hr, distance_m: 7123 });
      await call("POST", "/runs", a.token, body);
      await call("POST", "/runs", a.token, { ...body, timer_s: 2600 });
      await call("GET", `/runs/${randomUUID()}`, a.token);
    } finally {
      console.log = original;
      delete process.env.ARNOLD_TOOL_LOG;
    }
    const text = lines.join("\n");
    expect(text).toContain("watch POST /runs");
    expect(text).not.toContain(a.token);
    expect(text).not.toMatch(/7123|"avg"|session_uuid/);
  });
});
