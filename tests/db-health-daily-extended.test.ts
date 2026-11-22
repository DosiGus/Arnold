/**
 * Migration 008 (extended daily health values and raw Garmin answers)
 * against the real test Postgres: user separation, writing only with the
 * health consent, revocation erases the raw answers too, CHECK ranges,
 * account deletion cascades, the sync stores values, raw answers and endpoint
 * outcomes, and the rollback script 8 → 7 → 8. All values are invented.
 */
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import pg from "pg";
import { afterAll, describe, expect, inject, it } from "vitest";
import { migrate } from "../src/server/db/migrate";
import {
  DailyHealthSync,
  readDailyHealth,
  readDailyHealthRange,
  readDailyHealthRaw,
} from "../src/server/health/sync";
import {
  DAILY_HEALTH_COLUMNS,
  type DailyHealthDay,
  type DailyHealthFetchResult,
  EMPTY_ANSWER,
  type DailyHealthPullSource,
  type DailyHealthRaw,
  type FetchDaysOptions,
} from "../src/server/health/source";
import { appDatabase, asOwner, newAccount } from "./fixtures/arnold-db.js";

const db = appDatabase();
afterAll(() => db.close());

type Account = Awaited<ReturnType<typeof newAccount>>;

const grantConsent = (account: Account) =>
  db.asUser(account.userId, (c) =>
    c.query(
      `insert into arnold.health_consents (user_id, scope, text_version, granted_at)
       values ($1, 'garmin_health', 'test', now())`,
      [account.userId],
    ),
  );

const revokeConsent = (account: Account) =>
  db.asUser(account.userId, (c) =>
    c.query(
      `update arnold.health_consents set revoked_at = now()
        where user_id = $1 and scope = 'garmin_health' and revoked_at is null`,
      [account.userId],
    ),
  );

const insertRaw = (
  account: Account,
  date: string,
  endpoint: string,
  payload: unknown,
  forUser = account.userId,
) =>
  db.asUser(account.userId, (c) =>
    c.query(
      `insert into arnold.health_daily_raw (user_id, local_date, endpoint, payload)
       values ($1, $2, $3, $4::jsonb)`,
      [forUser, date, endpoint, JSON.stringify(payload)],
    ),
  );

const setColumn = (
  account: Account,
  date: string,
  column: string,
  value: unknown,
) =>
  db.asUser(account.userId, (c) =>
    c.query(
      `insert into arnold.health_daily (user_id, local_date, source, ${column})
       values ($1, $2, 'garmin_personal', $3)`,
      [account.userId, date, value],
    ),
  );

const count = (userId: string, table: string) =>
  asOwner(
    async (c) =>
      (
        await c.query<{ n: number }>(
          `select count(*)::int as n from arnold.${table} where user_id = $1`,
          [userId],
        )
      ).rows[0].n,
  );

describe("health_daily_raw", () => {
  it("lets each user see only their own answers, never write for another user", async () => {
    const alice = await newAccount(db);
    const bob = await newAccount(db);
    await grantConsent(alice);
    await grantConsent(bob);
    await insertRaw(alice, "2026-11-10", "daily_sleep", { a: 1 });
    await insertRaw(bob, "2026-11-10", "daily_sleep", { b: 2 });

    const seen = await readDailyHealthRaw(
      db,
      bob.userId,
      "2026-11-01",
      "2026-11-30",
    );
    expect(seen).toEqual([
      { local_date: "2026-11-10", endpoint: "daily_sleep", payload: { b: 2 } },
    ]);
    await expect(
      insertRaw(bob, "2026-11-11", "daily_sleep", {}, alice.userId),
    ).rejects.toBeTruthy();
    await db.asUser(bob.userId, (c) =>
      c.query("delete from arnold.health_daily_raw where user_id = $1", [
        alice.userId,
      ]),
    );
    expect(await count(alice.userId, "health_daily_raw")).toBe(1);
  });

  it("needs the health consent to write", async () => {
    const alice = await newAccount(db);
    await expect(
      insertRaw(alice, "2026-11-10", "daily_sleep", {}),
    ).rejects.toMatchObject({ code: "23514" });
    await grantConsent(alice);
    await insertRaw(alice, "2026-11-10", "daily_sleep", {});
    await revokeConsent(alice);
    await expect(
      insertRaw(alice, "2026-11-11", "daily_sleep", {}),
    ).rejects.toMatchObject({ code: "23514" });
  });

  it("is erased with the consent revocation, nobody else's", async () => {
    const alice = await newAccount(db);
    const bob = await newAccount(db);
    await grantConsent(alice);
    await grantConsent(bob);
    await insertRaw(alice, "2026-11-10", "daily_sleep", { a: 1 });
    await insertRaw(alice, "2026-11-10", "fitness_age", { a: 2 });
    await insertRaw(bob, "2026-11-10", "daily_sleep", { b: 1 });
    await setColumn(alice, "2026-11-10", "steps", 1234);

    await revokeConsent(alice);

    expect(await count(alice.userId, "health_daily_raw")).toBe(0);
    expect(await count(alice.userId, "health_daily")).toBe(0);
    expect(await count(bob.userId, "health_daily_raw")).toBe(1);
  });

  it("is removed with the account", async () => {
    const alice = await newAccount(db);
    await grantConsent(alice);
    await insertRaw(alice, "2026-11-10", "daily_sleep", { a: 1 });
    expect(await alice.identities.remove(alice.userId)).toBe(true);
    expect(await count(alice.userId, "health_daily_raw")).toBe(0);
  });

  it("keeps one answer per day and endpoint, limits size and endpoint names", async () => {
    const alice = await newAccount(db);
    await grantConsent(alice);
    await insertRaw(alice, "2026-11-10", "daily_sleep", { a: 1 });
    await expect(
      insertRaw(alice, "2026-11-10", "daily_sleep", { a: 2 }),
    ).rejects.toMatchObject({ code: "23505" });
    await expect(
      insertRaw(alice, "2026-11-10", "/sleep-service/sleep/dailySleep", {}),
    ).rejects.toMatchObject({ code: "23514" });
    await expect(
      insertRaw(alice, "2026-11-10", "big", { blob: "x".repeat(270_000) }),
    ).rejects.toMatchObject({ code: "23514" });
    await insertRaw(alice, "2026-11-10", "ok_size", {
      blob: "x".repeat(200_000),
    });
  });
});

describe("health_daily: extended columns", () => {
  it("are NULL by default and refuse impossible values", async () => {
    const alice = await newAccount(db);
    await grantConsent(alice);
    await setColumn(alice, "2026-11-12", "resting_hr_bpm", null);
    const row = await db.asUser(
      alice.userId,
      async (c) =>
        (await c.query("select * from arnold.health_daily")).rows[0] as Record<
          string,
          unknown
        >,
    );
    for (const column of Object.keys(DAILY_HEALTH_COLUMNS))
      expect(row[column], column).toBeNull();

    const bad: [string, unknown][] = [
      ["steps", -1],
      ["steps", 300_000],
      ["spo2_avg_pct", 0],
      ["spo2_avg_pct", 101],
      ["respiration_sleep_avg", 0],
      ["sleep_deep_seconds", 90_000],
      ["sleep_start_local", "2026-11-12T23:10:00Z"],
      ["sleep_end_local", "yesterday"],
      ["skin_temp_deviation_c", 12],
      ["vo2max_running", 2],
      ["training_readiness_score", 101],
      ["training_status", "Productive 5"],
      ["training_readiness_level", ""],
      ["load_ratio", -1],
    ];
    let n = 13;
    for (const [column, value] of bad)
      await expect(
        setColumn(alice, `2026-11-${n++}`, column, value),
        `${column}=${String(value)}`,
      ).rejects.toMatchObject({ code: "23514" });
  });

  it("hold known values and read back as numbers", async () => {
    const alice = await newAccount(db);
    await grantConsent(alice);
    await db.asUser(alice.userId, (c) =>
      c.query(
        `insert into arnold.health_daily
           (user_id, local_date, source, steps, sleep_start_local, respiration_sleep_avg,
            skin_temp_deviation_c, vo2max_running, load_ratio, training_status)
         values ($1, '2026-11-10', 'garmin_personal', 9000, '2026-11-09T23:10:00',
                 13.2, -0.4, 52.3, 1.08, 'productive_5')`,
        [alice.userId],
      ),
    );
    const [day] = await readDailyHealthRange(
      db,
      alice.userId,
      "2026-11-01",
      "2026-11-30",
    );
    expect(day).toMatchObject({
      local_date: "2026-11-10",
      steps: 9000,
      sleep_start_local: "2026-11-09T23:10:00",
      respiration_sleep_avg: 13.2,
      skin_temp_deviation_c: -0.4,
      vo2max_running: 52.3,
      load_ratio: 1.08,
      training_status: "productive_5",
      acute_load: null,
    });
    expect(typeof day.vo2max_running).toBe("number");
    // Another user sees nothing of it, and the range is respected.
    const bob = await newAccount(db);
    expect(await readDailyHealth(db, bob.userId, "2026-01-01")).toEqual([]);
    expect(
      await readDailyHealthRange(db, alice.userId, "2026-11-11", "2026-11-30"),
    ).toEqual([]);
  });
});

describe("DailyHealthSync with extended values", () => {
  const NOW = Date.parse("2026-11-16T08:00:00Z");
  const blank = (local_date: string): DailyHealthDay => {
    const day: Record<string, unknown> = { local_date };
    for (const k of Object.keys(DAILY_HEALTH_COLUMNS)) day[k] = null;
    return day as DailyHealthDay;
  };

  function setup(
    account: Account,
    results: DailyHealthFetchResult[],
    extra: Pick<DailyHealthPullSource, "detailEndpoints" | "readStored"> = {},
  ) {
    const calls: { from: string; to: string; options?: FetchDaysOptions }[] =
      [];
    let now = NOW;
    const source: DailyHealthPullSource = {
      kind: "garmin_personal",
      ...extra,
      fetchDays: async (from, to, options) => {
        calls.push({ from, to, options });
        return results.shift() ?? { ok: true, days: [] };
      },
    };
    const lines: string[] = [];
    const sync = new DailyHealthSync({
      db,
      source,
      config: {
        state: "active",
        source: "garmin_personal",
        apiKey: "unused-in-this-test",
        userId: account.userId,
        refreshHours: 6,
      },
      now: () => now,
      log: (line) => lines.push(line),
    });
    return {
      sync,
      calls,
      lines,
      advance: (h: number) => (now += h * 3600_000),
    };
  }

  const syncRow = (account: Account) =>
    db.asUser(
      account.userId,
      async (c) =>
        (
          await c.query<{
            last_outcome: string;
            endpoint_outcomes: Record<string, string>;
          }>(
            "select last_outcome, endpoint_outcomes from arnold.health_daily_sync",
          )
        ).rows[0],
    );

  it("stores values, raw answers and endpoint outcomes, and keeps known values", async () => {
    const alice = await newAccount(db);
    await grantConsent(alice);
    const first = { ...blank("2026-11-15"), steps: 9000, vo2max_running: 52.3 };
    const second = { ...blank("2026-11-15"), sleep_deep_seconds: 5400 };
    const t = setup(alice, [
      {
        ok: true,
        days: [first],
        raw: [
          {
            local_date: "2026-11-10",
            endpoint: "daily_summary",
            payload: { x: 1 },
          },
        ],
        endpoints: { daily_sleep: "unavailable", fitness_age: "ok" },
      },
      {
        ok: true,
        days: [second],
        raw: [
          {
            local_date: "2026-11-10",
            endpoint: "daily_summary",
            payload: { x: 2 },
          },
        ],
        endpoints: { daily_sleep: "ok" },
      },
    ]);
    expect(await t.sync.refresh(alice.userId)).toEqual({
      ran: true,
      outcome: "ok",
      days: 1,
    });
    // First fetch: the last 3 days plus the backfill of 7 older ones.
    expect(t.calls[0].options?.detailDates).toHaveLength(10);
    expect(t.calls[0].options?.detailDates?.[0]).toBe("2026-11-16");
    expect(await syncRow(alice)).toEqual({
      last_outcome: "ok",
      endpoint_outcomes: { daily_sleep: "unavailable", fitness_age: "ok" },
    });
    t.advance(7);
    await t.sync.refresh(alice.userId);
    // The day with a raw answer is no longer a backfill candidate.
    expect(t.calls[1].options?.detailDates).not.toContain("2026-11-10");
    expect(t.calls[1].options?.detailDates).toContain("2026-11-15");
    const [stored] = await readDailyHealth(db, alice.userId, "2026-11-01");
    expect(stored).toMatchObject({
      steps: 9000,
      vo2max_running: 52.3,
      sleep_deep_seconds: 5400,
    });
    // Replaced per day and endpoint.
    expect(
      await readDailyHealthRaw(db, alice.userId, "2026-11-01", "2026-11-30"),
    ).toEqual([
      {
        local_date: "2026-11-10",
        endpoint: "daily_summary",
        payload: { x: 2 },
      },
    ]);
    expect((await syncRow(alice)).endpoint_outcomes).toEqual({
      daily_sleep: "ok",
    });
  });

  it("stores what was fetched before Garmin's rate limit and names the outcome", async () => {
    const alice = await newAccount(db);
    await grantConsent(alice);
    const t = setup(alice, [
      {
        ok: true,
        rateLimited: true,
        days: [{ ...blank("2026-11-15"), steps: 100 }],
        endpoints: { steps_daily: "ok" },
      },
    ]);
    expect(await t.sync.refresh(alice.userId)).toEqual({
      ran: true,
      outcome: "rate_limited",
      days: 1,
    });
    expect((await syncRow(alice)).last_outcome).toBe("rate_limited");
    expect(await count(alice.userId, "health_daily")).toBe(1);
  });

  it("a failed fetch leaves the last endpoint outcomes in place", async () => {
    const alice = await newAccount(db);
    await grantConsent(alice);
    const t = setup(alice, [
      {
        ok: true,
        days: [blank("2026-11-15")],
        endpoints: { fitness_age: "ok" },
      },
      { ok: false, failure: "upstream_error" },
    ]);
    await t.sync.refresh(alice.userId);
    t.advance(7);
    await t.sync.refresh(alice.userId);
    expect(await syncRow(alice)).toEqual({
      last_outcome: "upstream_error",
      endpoint_outcomes: { fitness_age: "ok" },
    });
  });

  it("drops one refused raw answer without losing the day values", async () => {
    const alice = await newAccount(db);
    await grantConsent(alice);
    const t = setup(alice, [
      {
        ok: true,
        days: [{ ...blank("2026-11-15"), steps: 5 }],
        raw: [
          {
            local_date: "2026-11-15",
            endpoint: "too_big",
            payload: { b: "x".repeat(300_000) },
          },
          { local_date: "2026-11-15", endpoint: "fine", payload: { a: 1 } },
          {
            local_date: "2026-11-15",
            endpoint: "bad name!",
            payload: { a: 1 },
          },
        ],
      },
    ]);
    expect(await t.sync.refresh(alice.userId)).toMatchObject({
      outcome: "ok",
      days: 1,
    });
    expect(
      (
        await readDailyHealthRaw(db, alice.userId, "2026-11-01", "2026-11-30")
      ).map((r) => r.endpoint),
    ).toEqual(["fine"]);
    expect(
      (await readDailyHealth(db, alice.userId, "2026-11-01"))[0].steps,
    ).toBe(5);
  });

  it("writes nothing, not even raw answers, when the consent is gone", async () => {
    const alice = await newAccount(db);
    await grantConsent(alice);
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const sync = new DailyHealthSync({
      db,
      source: {
        kind: "garmin_personal",
        fetchDays: async () => {
          await gate;
          return {
            ok: true,
            days: [{ ...blank("2026-11-15"), steps: 5 }],
            raw: [{ local_date: "2026-11-15", endpoint: "fine", payload: {} }],
          };
        },
      },
      config: {
        state: "active",
        source: "garmin_personal",
        apiKey: "unused-in-this-test",
        userId: alice.userId,
        refreshHours: 6,
      },
      now: () => NOW,
      log: () => {},
    });
    const run = sync.refresh(alice.userId);
    await new Promise((r) => setTimeout(r, 100));
    await revokeConsent(alice);
    release();
    expect(await run).toMatchObject({ outcome: "no_consent", days: 0 });
    expect(await count(alice.userId, "health_daily")).toBe(0);
    expect(await count(alice.userId, "health_daily_raw")).toBe(0);
  });

  it("backfills by single-day answers only, and does not ask an empty day again", async () => {
    const alice = await newAccount(db);
    await grantConsent(alice);
    const t = setup(
      alice,
      [
        {
          ok: true,
          days: [{ ...blank("2026-11-10"), steps: 1 }],
          raw: [
            // A required range answer for an older day: not a detail answer.
            {
              local_date: "2026-11-10",
              endpoint: "daily_summary",
              payload: { a: 1 },
            },
            // Garmin had nothing for this day.
            {
              local_date: "2026-11-09",
              endpoint: "daily_sleep",
              payload: EMPTY_ANSWER,
            },
            {
              local_date: "2026-11-08",
              endpoint: "daily_sleep",
              payload: { b: 1 },
            },
          ],
        },
      ],
      { detailEndpoints: ["daily_sleep", "fitness_age"] },
    );
    await t.sync.refresh(alice.userId);
    t.advance(7);
    await t.sync.refresh(alice.userId);
    const second = t.calls[1].options?.detailDates ?? [];
    expect(second).toContain("2026-11-10");
    expect(second).not.toContain("2026-11-09");
    expect(second).not.toContain("2026-11-08");
  });

  it("never lets an empty marker replace a real answer, a real answer replaces it", async () => {
    const alice = await newAccount(db);
    await grantConsent(alice);
    const day = (raw: DailyHealthRaw[]): DailyHealthFetchResult => ({
      ok: true,
      days: [{ ...blank("2026-11-15"), steps: 1 }],
      raw,
    });
    const t = setup(alice, [
      day([
        {
          local_date: "2026-11-15",
          endpoint: "daily_sleep",
          payload: { a: 1 },
        },
        {
          local_date: "2026-11-14",
          endpoint: "daily_sleep",
          payload: EMPTY_ANSWER,
        },
      ]),
      day([
        {
          local_date: "2026-11-15",
          endpoint: "daily_sleep",
          payload: EMPTY_ANSWER,
        },
        {
          local_date: "2026-11-14",
          endpoint: "daily_sleep",
          payload: { b: 2 },
        },
      ]),
    ]);
    await t.sync.refresh(alice.userId);
    t.advance(7);
    await t.sync.refresh(alice.userId);
    expect(
      await readDailyHealthRaw(db, alice.userId, "2026-11-01", "2026-11-30"),
    ).toEqual([
      { local_date: "2026-11-14", endpoint: "daily_sleep", payload: { b: 2 } },
      { local_date: "2026-11-15", endpoint: "daily_sleep", payload: { a: 1 } },
    ]);
  });

  it("reads the stored answers of the last 35 days again after a fetch", async () => {
    const alice = await newAccount(db);
    await grantConsent(alice);
    // Stored earlier, read wrongly then: the corrected reading fills them.
    await insertRaw(alice, "2026-11-01", "x", { kcal: 2100 });
    await insertRaw(alice, "2026-10-01", "x", { kcal: 1900 });
    await setColumn(alice, "2026-11-01", "steps", 4000);
    const t = setup(
      alice,
      [
        {
          ok: true,
          days: [{ ...blank("2026-11-15"), steps: 9 }],
          raw: [
            {
              local_date: "2026-11-15",
              endpoint: "x",
              payload: { kcal: 2500 },
            },
          ],
        },
      ],
      {
        readStored: (raw) =>
          raw
            .filter((r) => r.endpoint === "x")
            .map((r) => ({
              ...blank(r.local_date),
              kcal_total: (r.payload as { kcal: number }).kcal,
            })),
      },
    );
    expect(await t.sync.refresh(alice.userId)).toMatchObject({
      outcome: "ok",
      days: 1,
    });
    const days = await readDailyHealth(db, alice.userId, "2026-09-01");
    expect(days.map((d) => [d.local_date, d.kcal_total, d.steps])).toEqual([
      // Known value kept, re-read value added.
      ["2026-11-01", 2100, 4000],
      ["2026-11-15", 2500, 9],
    ]);
    expect(t.lines.at(-1)).toContain('"reread":2');
  });
});

describe("rollback script 008 → 7 → 8", () => {
  it("brings the schema back to version 7 and migration 008 applies again", async () => {
    const admin = new URL(inject("databaseAdminUrl"));
    const name = `arnold_rollback_${randomUUID().replaceAll("-", "")}`;
    await asOwner((c) => c.query(`create database ${name}`));
    const url = new URL(admin);
    url.pathname = `/${name}`;
    const exec = async (sql: string, params: unknown[] = []) => {
      const client = new pg.Client({ connectionString: url.toString() });
      await client.connect();
      try {
        return await client.query(sql, params);
      } finally {
        await client.end();
      }
    };
    const hasColumn = async (table: string, column: string) =>
      (
        await exec(
          `select 1 from information_schema.columns where table_schema = 'arnold' and table_name = $1 and column_name = $2`,
          [table, column],
        )
      ).rowCount === 1;
    const hasTable = async (table: string) =>
      (
        await exec(
          `select 1 from information_schema.tables where table_schema = 'arnold' and table_name = $1`,
          [table],
        )
      ).rowCount === 1;
    try {
      expect(await migrate(url.toString())).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
      expect(await hasTable("health_daily_raw")).toBe(true);
      expect(await hasColumn("health_daily", "steps")).toBe(true);
      expect(await hasColumn("health_daily_sync", "endpoint_outcomes")).toBe(
        true,
      );

      const userId = `usr_${randomUUID()}`;
      await exec("insert into arnold.users (user_id) values ($1)", [userId]);
      await exec(
        `insert into arnold.health_consents (user_id, scope, text_version, granted_at)
         values ($1, 'garmin_health', 'test', now())`,
        [userId],
      );
      await exec(
        `insert into arnold.health_daily (user_id, local_date, source, resting_hr_bpm, steps)
         values ($1, '2026-11-10', 'garmin_personal', 52, 9000)`,
        [userId],
      );

      const script = await readFile("db/rollback/008_down.sql", "utf8");
      await exec(script);
      expect(
        (
          await exec(
            "select max(version)::int as v from arnold.schema_migrations",
          )
        ).rows[0].v,
      ).toBe(7);
      expect(await hasTable("health_daily_raw")).toBe(false);
      expect(await hasColumn("health_daily", "steps")).toBe(false);
      expect(await hasColumn("health_daily_sync", "endpoint_outcomes")).toBe(
        false,
      );
      // The values of 005 stay.
      expect(
        (await exec("select resting_hr_bpm from arnold.health_daily")).rows,
      ).toEqual([{ resting_hr_bpm: 52 }]);
      // The revocation trigger works again without the raw table.
      await exec(
        `update arnold.health_consents set revoked_at = now() where user_id = $1`,
        [userId],
      );
      expect((await exec("select 1 from arnold.health_daily")).rowCount).toBe(
        0,
      );
      await expect(exec(script)).rejects.toThrow(/not applied/);
      expect(await migrate(url.toString())).toEqual([8]);
      expect(await hasTable("health_daily_raw")).toBe(true);
    } finally {
      await asOwner((c) => c.query(`drop database ${name} with (force)`));
    }
  });
});
