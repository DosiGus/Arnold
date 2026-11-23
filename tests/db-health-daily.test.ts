/**
 * Migration 005 (daily health values) against the real test Postgres: user
 * separation, writing only with the health consent, revocation erases,
 * account deletion cascades, unknown stays NULL, and the rollback script
 * 5 → 4 → 5 on a database of its own. All values are invented.
 */
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import pg from "pg";
import { afterAll, describe, expect, inject, it } from "vitest";
import { migrate } from "../src/server/db/migrate";
import { opensOverview } from "../src/server/http";
import { DailyHealthSync, readDailyHealth } from "../src/server/health/sync";
import {
  DAILY_HEALTH_COLUMNS,
  type DailyHealthDay,
  type DailyHealthFetchResult,
  type DailyHealthPullSource,
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

const insertDay = (account: Account, date: string, resting: number | null) =>
  db.asUser(account.userId, (c) =>
    c.query(
      `insert into arnold.health_daily (user_id, local_date, source, resting_hr_bpm)
       values ($1, $2, 'garmin_personal', $3)`,
      [account.userId, date, resting],
    ),
  );

const insertSync = (account: Account) =>
  db.asUser(account.userId, (c) =>
    c.query(
      `insert into arnold.health_daily_sync (user_id, source, last_attempt_at, last_success_at, last_outcome)
       values ($1, 'garmin_personal', now(), now(), 'ok')`,
      [account.userId],
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

describe("health_daily: user separation", () => {
  it("lets each user see only their own days, and never write for another user", async () => {
    const alice = await newAccount(db);
    const bob = await newAccount(db);
    await grantConsent(alice);
    await grantConsent(bob);
    await insertDay(alice, "2026-11-10", 52);
    await insertDay(bob, "2026-11-10", 61);

    const seen = await db.asUser(
      bob.userId,
      async (c) =>
        (
          await c.query<{ user_id: string; resting_hr_bpm: number }>(
            "select user_id, resting_hr_bpm from arnold.health_daily",
          )
        ).rows,
    );
    expect(seen).toEqual([{ user_id: bob.userId, resting_hr_bpm: 61 }]);

    // Bob cannot write a row in Alice's name.
    await expect(
      db.asUser(bob.userId, (c) =>
        c.query(
          `insert into arnold.health_daily (user_id, local_date, source)
           values ($1, '2026-11-11', 'garmin_personal')`,
          [alice.userId],
        ),
      ),
    ).rejects.toBeTruthy();
    // Bob's update or delete never reaches Alice's rows.
    await db.asUser(bob.userId, (c) =>
      c.query("delete from arnold.health_daily where user_id = $1", [
        alice.userId,
      ]),
    );
    expect(await count(alice.userId, "health_daily")).toBe(1);
  });

  it("keeps unknown values as NULL, not 0", async () => {
    const alice = await newAccount(db);
    await grantConsent(alice);
    await insertDay(alice, "2026-11-12", null);
    const row = await db.asUser(
      alice.userId,
      async (c) =>
        (await c.query("select * from arnold.health_daily")).rows[0] as Record<
          string,
          unknown
        >,
    );
    for (const column of [
      "resting_hr_bpm",
      "stress_avg",
      "body_battery_high",
      "body_battery_end_of_day",
      "sleep_seconds",
      "sleep_score",
      "hrv_last_night_ms",
      "hrv_status",
    ])
      expect(row[column], column).toBeNull();
    // A 0 resting heart rate is refused by the check, never stored.
    await expect(insertDay(alice, "2026-11-13", 0)).rejects.toMatchObject({
      code: "23514",
    });
  });
});

describe("health_daily: consent", () => {
  it("refuses writing without an active consent", async () => {
    const alice = await newAccount(db);
    await expect(insertDay(alice, "2026-11-10", 52)).rejects.toMatchObject({
      code: "23514",
    });
    await grantConsent(alice);
    await revokeConsent(alice);
    await expect(insertDay(alice, "2026-11-10", 52)).rejects.toMatchObject({
      code: "23514",
    });
    expect(await count(alice.userId, "health_daily")).toBe(0);
  });

  it("erases the user's days and fetch state on revocation, nobody else's", async () => {
    const alice = await newAccount(db);
    const bob = await newAccount(db);
    await grantConsent(alice);
    await grantConsent(bob);
    await insertDay(alice, "2026-11-10", 52);
    await insertDay(alice, "2026-11-11", 53);
    await insertSync(alice);
    await insertDay(bob, "2026-11-10", 61);
    await insertSync(bob);

    await revokeConsent(alice);

    expect(await count(alice.userId, "health_daily")).toBe(0);
    expect(await count(alice.userId, "health_daily_sync")).toBe(0);
    expect(await count(bob.userId, "health_daily")).toBe(1);
    expect(await count(bob.userId, "health_daily_sync")).toBe(1);
  });

  it("removes everything on account deletion", async () => {
    const alice = await newAccount(db);
    await grantConsent(alice);
    await insertDay(alice, "2026-11-10", 52);
    await insertSync(alice);
    expect(await alice.identities.remove(alice.userId)).toBe(true);
    expect(await count(alice.userId, "health_daily")).toBe(0);
    expect(await count(alice.userId, "health_daily_sync")).toBe(0);
  });
});

describe("rollback script 005 → 4 → 5", () => {
  it("brings the schema back to version 4 and migration 005 applies again", async () => {
    const admin = new URL(inject("databaseAdminUrl"));
    const name = `arnold_rollback_${randomUUID().replaceAll("-", "")}`;
    await asOwner((c) => c.query(`create database ${name}`));
    const url = new URL(admin);
    url.pathname = `/${name}`;
    const exec = async (sql: string) => {
      const client = new pg.Client({ connectionString: url.toString() });
      await client.connect();
      try {
        return await client.query(sql);
      } finally {
        await client.end();
      }
    };
    const tables = async () =>
      (
        await exec(
          `select table_name from information_schema.tables where table_schema = 'arnold' and table_name like 'health_daily%' order by 1`,
        )
      ).rows.map((r) => r.table_name as string);
    try {
      expect(await migrate(url.toString())).toEqual([
        1, 2, 3, 4, 5, 6, 7, 8, 9,
      ]);
      expect(await tables()).toEqual([
        "health_daily",
        "health_daily_raw",
        "health_daily_sync",
      ]);
      // 006 to 008 sit on top of 005 and are undone first (db/rollback).
      await exec(await readFile("db/rollback/009_down.sql", "utf8"));
      await exec(await readFile("db/rollback/008_down.sql", "utf8"));
      await exec(await readFile("db/rollback/007_down.sql", "utf8"));
      await exec(await readFile("db/rollback/006_down.sql", "utf8"));
      const script = await readFile("db/rollback/005_down.sql", "utf8");
      await exec(script);
      expect(
        (
          await exec(
            "select max(version)::int as v from arnold.schema_migrations",
          )
        ).rows[0].v,
      ).toBe(4);
      expect(await tables()).toEqual([]);
      expect(
        (
          await exec(
            "select count(*)::int as n from pg_trigger where tgname = 'health_consents_erase_daily'",
          )
        ).rows[0].n,
      ).toBe(0);
      await expect(exec(script)).rejects.toThrow(/not applied/);
      expect(await migrate(url.toString())).toEqual([5, 6, 7, 8, 9]);
      expect(await tables()).toEqual([
        "health_daily",
        "health_daily_raw",
        "health_daily_sync",
      ]);
    } finally {
      await asOwner((c) => c.query(`drop database ${name} with (force)`));
    }
  });
});

describe("DailyHealthSync (fetch and store, invented supplier)", () => {
  const day = (local_date: string, resting: number | null): DailyHealthDay => {
    const blank: Record<string, unknown> = { local_date };
    for (const k of Object.keys(DAILY_HEALTH_COLUMNS)) blank[k] = null;
    return {
      ...(blank as DailyHealthDay),
      resting_hr_bpm: resting,
      body_battery_high: 80,
    };
  };
  const NOW = Date.parse("2026-11-16T08:00:00Z");

  function setup(account: Account, results: DailyHealthFetchResult[]) {
    const ranges: [string, string][] = [];
    const lines: string[] = [];
    let now = NOW;
    const source: DailyHealthPullSource = {
      kind: "garmin_personal",
      fetchDays: async (from, to) => {
        ranges.push([from, to]);
        return results.shift() ?? { ok: true, days: [] };
      },
    };
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
      ranges,
      lines,
      advance: (hours: number) => (now += hours * 3600_000),
    };
  }

  it("fetches only the configured user, only with consent, 35 days first, then the missing days", async () => {
    const alice = await newAccount(db);
    const bob = await newAccount(db);
    const t = setup(alice, [
      { ok: true, days: [day("2026-11-14", 52), day("2026-11-15", 53)] },
      { ok: true, days: [day("2026-11-15", null), day("2026-11-16", 51)] },
    ]);
    expect(await t.sync.refresh(bob.userId)).toEqual({
      ran: false,
      why: "other_user",
    });
    expect(await t.sync.refresh(alice.userId)).toEqual({
      ran: false,
      why: "no_consent",
    });
    await grantConsent(alice);
    expect(await t.sync.refresh(alice.userId)).toEqual({
      ran: true,
      outcome: "ok",
      days: 2,
    });
    expect(t.ranges[0]).toEqual(["2026-10-13", "2026-11-16"]);
    // Within the refresh interval nothing is fetched.
    t.advance(5);
    expect(await t.sync.refresh(alice.userId)).toEqual({
      ran: false,
      why: "recent",
    });
    t.advance(2);
    await t.sync.refresh(alice.userId);
    // This invented supplier stores no raw answers, so the days stay open
    // for the backfill and the range reaches back to the oldest of them.
    expect(t.ranges[1]).toEqual(["2026-11-07", "2026-11-16"]);
    const stored = await readDailyHealth(db, alice.userId, "2026-01-01");
    // A value Garmin no longer sends is kept, unknown stays null.
    expect(stored.map((d) => [d.local_date, d.resting_hr_bpm])).toEqual([
      ["2026-11-14", 52],
      ["2026-11-15", 53],
      ["2026-11-16", 51],
    ]);
    expect(stored[0].sleep_score).toBeNull();
    expect(await count(bob.userId, "health_daily")).toBe(0);
    expect(t.lines.every((l) => !l.includes(alice.userId))).toBe(true);
  });

  it("records an expired key as its own state and keeps the stored days", async () => {
    const alice = await newAccount(db);
    await grantConsent(alice);
    const t = setup(alice, [
      { ok: true, days: [day("2026-11-15", 52)] },
      { ok: false, failure: "key_expired" },
    ]);
    await t.sync.refresh(alice.userId);
    t.advance(7);
    expect(await t.sync.refresh(alice.userId)).toEqual({
      ran: true,
      outcome: "key_expired",
      days: 0,
    });
    const sync = await db.asUser(
      alice.userId,
      async (c) =>
        (
          await c.query<{ last_outcome: string; last_success_at: Date }>(
            "select last_outcome, last_success_at from arnold.health_daily_sync",
          )
        ).rows[0],
    );
    expect(sync.last_outcome).toBe("key_expired");
    expect(sync.last_success_at.getTime()).toBe(NOW);
    expect(await count(alice.userId, "health_daily")).toBe(1);
    expect(t.lines.at(-1)).toContain('"outcome":"key_expired"');
  });

  it("never lets the overview wait or fail, and runs one fetch at a time", async () => {
    const alice = await newAccount(db);
    await grantConsent(alice);
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    let calls = 0;
    const sync = new DailyHealthSync({
      db,
      config: {
        state: "active",
        source: "garmin_personal",
        apiKey: "unused-in-this-test",
        userId: alice.userId,
        refreshHours: 6,
      },
      source: {
        kind: "garmin_personal",
        fetchDays: async () => {
          calls++;
          await gate;
          throw new Error("supplier broke");
        },
      },
      log: () => {},
    });
    expect(() => sync.onOverviewOpened(alice.userId)).not.toThrow();
    await new Promise((r) => setTimeout(r, 200));
    expect(await sync.refresh(alice.userId)).toEqual({
      ran: false,
      why: "running",
    });
    release();
    await new Promise((r) => setTimeout(r, 100));
    expect(calls).toBe(1);
  });

  it("opens the fetch only for the overview, not for other cards", () => {
    const call = (args: object) => ({
      jsonrpc: "2.0",
      method: "tools/call",
      params: { name: "show_arnold_dashboard", arguments: args },
    });
    expect(opensOverview(call({}))).toBe(true);
    expect(opensOverview([call({ card: null })])).toBe(true);
    expect(opensOverview(call({ card: "today" }))).toBe(false);
    expect(opensOverview({ method: "tools/list" })).toBe(false);
    expect(opensOverview(undefined)).toBe(false);
  });
});
