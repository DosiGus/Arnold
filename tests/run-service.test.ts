/**
 * The run service against the real test Postgres: the watch functions
 * (upcoming, detail, result, effort), heart rate only with consent, replay
 * and conflicts by request_id, and that a second user sees nothing.
 */
import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { analyseRuns, RunNotFoundError } from "../src/server/run/analysis";
import { RunService } from "../src/server/run/service";
import type { AuthorizationGuard } from "../src/server/workout/infrastructure";
import {
  RUN_SEGMENT_KINDS,
  RunSegmentStatusSchema,
} from "../src/shared/run-contract";
import { appDatabase, newAccount } from "./fixtures/arnold-db.js";

const db = appDatabase();
afterAll(() => db.close());

type Account = Awaited<ReturnType<typeof newAccount>>;
const service = (account: Account, consent: boolean) =>
  new RunService({
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
    healthConsent: async () => consent,
  });

const DAY = 86_400_000;
const day = (offset = 0) =>
  new Date(Date.now() + offset * DAY).toISOString().slice(0, 10);
const iso = (offsetMs: number) => new Date(Date.now() + offsetMs).toISOString();
const watchRun = (extra: Record<string, unknown> = {}) => ({
  request_id: randomUUID(),
  session_uuid: randomUUID(),
  workout_date_local: day(),
  utc_offset_min: 0,
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
});
const hr = { avg: 140, max: 160, zone_s: null, zones: null, zones_sport: null };

async function planToday(runs: RunService) {
  const planned = await runs.execute("plan_run", {
    request_id: randomUUID(),
    timezone: "UTC",
    workout_date_local: day(),
    run_type: "base",
    minutes: 45,
  });
  expect(planned.ok).toBe(true);
  return planned.result!.run!.workout_id;
}

describe("watch functions of the run service", () => {
  it("lists upcoming runs and reads the prescription; a stranger sees nothing", async () => {
    const [a, b] = [await newAccount(db), await newAccount(db)];
    const [mine, theirs] = [service(a, false), service(b, false)];
    const id = await planToday(mine);
    const list = await mine.upcoming(undefined, "UTC");
    expect(list.d).toBe(day());
    expect(list.hc).toBe(false);
    expect(list.runs).toHaveLength(1);
    expect(list.runs[0]).toMatchObject({ id, d: day(), m: 45, dm: null });
    expect(list.next).toBeNull();
    const detail = await mine.detail(undefined, id, "UTC");
    expect(detail!.p.s.length).toBeGreaterThan(0);
    expect(list.runs[0]!.tag).toMatch(/^[A-Za-z0-9_-]{1,16}$/);
    expect((await theirs.upcoming(undefined, "UTC")).runs).toEqual([]);
    expect(await theirs.detail(undefined, id, "UTC")).toBeNull();
    const data = await b.store.read();
    expect(() =>
      analyseRuns(
        data,
        { view: "run", workout_id: id, timezone: "UTC" },
        new Date(),
      ),
    ).toThrow(RunNotFoundError);
  });

  it("saves the result of a planned run, drops heart rate without consent, replays by request_id", async () => {
    const a = await newAccount(db);
    const runs = service(a, false);
    const planned = await planToday(runs);
    const request = watchRun({ planned_workout_id: planned, hr });
    const saved = await runs.saveWatchRun(request, undefined, "UTC");
    expect(saved).toMatchObject({
      ok: true,
      value: { workout_id: planned, replayed: false, hr_discarded: true },
    });
    const data = await a.store.read();
    const run = data.runs.find((r) => r.workout_id === planned)!;
    expect(data.workouts.find((w) => w.workout_id === planned)!.status).toBe(
      "completed",
    );
    expect(run).toMatchObject({
      result_source: "watch",
      hr_status: "no_consent",
      hr_avg_bpm: null,
    });
    // an identical repeat is the same answer, not a second run
    const again = await runs.saveWatchRun(request, undefined, "UTC");
    expect(again).toMatchObject({ ok: true, value: { replayed: true } });
    // other content under the same request_id
    const other = await runs.saveWatchRun(
      { ...request, timer_s: 2600 },
      undefined,
      "UTC",
    );
    expect(other).toMatchObject({
      ok: false,
      error: { code: "DUPLICATE_OPERATION" },
    });
    // the same recording under a new request_id
    const twice = await runs.saveWatchRun(
      { ...request, request_id: randomUUID() },
      undefined,
      "UTC",
    );
    expect(twice).toMatchObject({
      ok: false,
      error: { code: "DUPLICATE_WORKOUT" },
    });
    expect((await runs.upcoming(undefined, "UTC")).runs).toEqual([]);
  });

  it("stores heart rate and segments of a free run with consent; refuses the future and bad input", async () => {
    const a = await newAccount(db);
    const runs = service(a, true);
    await db.asUser(a.userId, (c) =>
      c.query(
        `insert into arnold.health_consents (user_id, scope, text_version, granted_at)
         values ($1, 'garmin_health', 'test', now())`,
        [a.userId],
      ),
    );
    const request = watchRun({
      hr,
      segments: [
        {
          i: 0,
          rep: null,
          kind: RUN_SEGMENT_KINDS.indexOf("lap"),
          st: RunSegmentStatusSchema.options.indexOf("completed"),
          t: 600,
          dm: 1500,
          tz: null,
        },
      ],
    });
    const saved = await runs.saveWatchRun(request, undefined, "UTC");
    expect(saved).toMatchObject({ ok: true, value: { hr_discarded: false } });
    const data = await a.store.read();
    expect(data.runs[0]).toMatchObject({
      hr_status: "recorded",
      hr_avg_bpm: 140,
      hr_max_bpm: 160,
    });
    expect(data.runSegments).toHaveLength(1);
    const future = await runs.saveWatchRun(
      watchRun({ workout_date_local: day(2) }),
      undefined,
      "UTC",
    );
    expect(future).toMatchObject({
      ok: false,
      error: { code: "DATE_IN_FUTURE" },
    });
    const invalid = await runs.saveWatchRun(
      watchRun({ timer_s: 5000, elapsed_s: 100 }),
      undefined,
      "UTC",
    );
    expect(invalid).toMatchObject({
      ok: false,
      error: { code: "VALIDATION_ERROR" },
    });
    expect((await a.store.read()).runs).toHaveLength(1);
  });

  it("sets the effort afterwards, by session; replay is harmless; a stranger finds nothing", async () => {
    const [a, b] = [await newAccount(db), await newAccount(db)];
    const [mine, theirs] = [service(a, false), service(b, false)];
    const request = watchRun();
    await mine.saveWatchRun(request, undefined, "UTC");
    const rpe = { request_id: randomUUID(), rpe: 6 };
    const first = await mine.setWatchRpe(
      request.session_uuid as string,
      rpe,
      undefined,
    );
    expect(first).toMatchObject({
      ok: true,
      value: { rpe: 6, replayed: false },
    });
    expect(
      await mine.setWatchRpe(request.session_uuid as string, rpe, undefined),
    ).toMatchObject({ ok: true, value: { replayed: true } });
    expect((await a.store.read()).runs[0]!.rpe).toBe(6);
    expect(
      await theirs.setWatchRpe(
        request.session_uuid as string,
        { request_id: randomUUID(), rpe: 3 },
        undefined,
      ),
    ).toMatchObject({ ok: false, error: { code: "WORKOUT_NOT_FOUND" } });
    expect(
      await mine.setWatchRpe(
        request.session_uuid as string,
        { request_id: randomUUID(), rpe: 11 },
        undefined,
      ),
    ).toMatchObject({ ok: false, error: { code: "VALIDATION_ERROR" } });
  });
});
