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
      expect(await migrate(url.toString())).toEqual([1, 2, 3, 4, 5]);
      expect(await tables()).toEqual(["health_daily", "health_daily_sync"]);
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
      expect(await migrate(url.toString())).toEqual([5]);
      expect(await tables()).toEqual(["health_daily", "health_daily_sync"]);
    } finally {
      await asOwner((c) => c.query(`drop database ${name} with (force)`));
    }
  });
});
