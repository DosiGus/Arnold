/**
 * Migration 007 (adjustments for a while) against the real test Postgres:
 * user separation, the 'temporary' plan status, the table's checks, account
 * deletion cascades, and the rollback script 7 → 6 → 7 on a database of its
 * own. All values are invented.
 */
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import pg from "pg";
import { afterAll, describe, expect, inject, it } from "vitest";
import { migrate } from "../src/server/db/migrate";
import { appDatabase, asOwner, newAccount } from "./fixtures/arnold-db.js";

const db = appDatabase();
afterAll(() => db.close());

const STAMP = "2026-11-17T08:00:00.000Z";

type Account = Awaited<ReturnType<typeof newAccount>>;

/** A plan version straight in SQL, as the given user. */
async function version(
  account: Account,
  status: "active" | "temporary",
): Promise<string> {
  const id = `pv_${randomUUID()}`;
  await db.asUser(account.userId, (c) =>
    c.query(
      `insert into arnold.plan_versions (user_id, plan_version_id, plan_family_id, version_no, name, status, activated_at_utc, created_at_utc, updated_at_utc, row_revision)
       values ($1, $2, $3, 1, 'Testplan', $4, $5, $6, $6, 1)`,
      [
        account.userId,
        id,
        `pf_${randomUUID()}`,
        status,
        status === "active" ? STAMP : null,
        STAMP,
      ],
    ),
  );
  return id;
}

const adjustmentRow = (
  account: Account,
  planVersionId: string,
  basePlanVersionId: string,
  extra: Partial<{
    start: string;
    end: string;
    status: string;
    confirmed: string | null;
  }> = {},
) =>
  db.asUser(account.userId, (c) =>
    c.query(
      `insert into arnold.plan_adjustments (user_id, plan_adjustment_id, plan_version_id, base_plan_version_id, kind, start_date_local, end_date_local, timezone, status, confirmed_at_utc, created_at_utc, updated_at_utc, row_revision)
       values ($1, $2, $3, $4, 'range', $5, $6, 'Europe/Berlin', $7, $8, $9, $9, 1)`,
      [
        account.userId,
        `pa_${randomUUID()}`,
        planVersionId,
        basePlanVersionId,
        extra.start ?? "2026-11-20",
        extra.end ?? "2026-11-22",
        extra.status ?? "draft",
        extra.confirmed ?? null,
        STAMP,
      ],
    ),
  );

const count = (userId: string) =>
  asOwner(
    async (c) =>
      (
        await c.query<{ n: number }>(
          "select count(*)::int as n from arnold.plan_adjustments where user_id = $1",
          [userId],
        )
      ).rows[0].n,
  );

describe("plan_adjustments: user separation", () => {
  it("lets each user see only their own adjustments, never write for another user", async () => {
    const alice = await newAccount(db);
    const bob = await newAccount(db);
    const aliceBase = await version(alice, "active");
    const aliceTemp = await version(alice, "temporary");
    await adjustmentRow(alice, aliceTemp, aliceBase);

    const seen = await db.asUser(bob.userId, (c) =>
      c.query("select plan_adjustment_id from arnold.plan_adjustments"),
    );
    expect(seen.rowCount).toBe(0);
    // Bob cannot write a row for Alice (policy own_rows) …
    await expect(
      db.asUser(bob.userId, (c) =>
        c.query(
          `insert into arnold.plan_adjustments (user_id, plan_adjustment_id, plan_version_id, base_plan_version_id, kind, start_date_local, end_date_local, timezone, status, created_at_utc, updated_at_utc, row_revision)
           values ($1, 'pa_x', $2, $3, 'today', '2026-11-20', '2026-11-20', 'UTC', 'draft', $4, $4, 1)`,
          [alice.userId, aliceTemp, aliceBase, STAMP],
        ),
      ),
    ).rejects.toThrow();
    // … nor point his own row at Alice's plan versions (references with user_id).
    await expect(
      db.asUser(bob.userId, (c) =>
        c.query(
          `insert into arnold.plan_adjustments (user_id, plan_adjustment_id, plan_version_id, base_plan_version_id, kind, start_date_local, end_date_local, timezone, status, created_at_utc, updated_at_utc, row_revision)
           values ($1, 'pa_y', $2, $3, 'today', '2026-11-20', '2026-11-20', 'UTC', 'draft', $4, $4, 1)`,
          [bob.userId, aliceTemp, aliceBase, STAMP],
        ),
      ),
    ).rejects.toThrow();
    // Rows are never deleted one by one.
    await expect(
      db.asUser(alice.userId, (c) =>
        c.query("delete from arnold.plan_adjustments"),
      ),
    ).rejects.toThrow();
    expect(await count(alice.userId)).toBe(1);
  });
});

describe("plan_adjustments: checks", () => {
  it("refuses an end before the start, a confirmed row without time and a retired temporary version", async () => {
    const alice = await newAccount(db);
    const base = await version(alice, "active");
    const temp = await version(alice, "temporary");
    await expect(
      adjustmentRow(alice, temp, base, {
        start: "2026-11-22",
        end: "2026-11-20",
      }),
    ).rejects.toThrow();
    await expect(
      adjustmentRow(alice, temp, base, {
        status: "confirmed",
        confirmed: null,
      }),
    ).rejects.toThrow();
    await expect(
      db.asUser(alice.userId, (c) =>
        c.query(
          "update arnold.plan_versions set activated_at_utc = $3 where user_id = $1 and plan_version_id = $2",
          [alice.userId, temp, STAMP],
        ),
      ),
    ).rejects.toThrow();
    await expect(
      db.asUser(alice.userId, (c) =>
        c.query(
          "update arnold.plan_versions set status = 'paused' where user_id = $1 and plan_version_id = $2",
          [alice.userId, temp],
        ),
      ),
    ).rejects.toThrow();
    await adjustmentRow(alice, temp, base, {
      status: "confirmed",
      confirmed: STAMP,
    });
    expect(await count(alice.userId)).toBe(1);
  });

  it("goes with the account", async () => {
    const alice = await newAccount(db);
    const base = await version(alice, "active");
    const temp = await version(alice, "temporary");
    await adjustmentRow(alice, temp, base);
    await asOwner((c) =>
      c.query("delete from arnold.users where user_id = $1", [alice.userId]),
    );
    expect(await count(alice.userId)).toBe(0);
  });
});

describe("rollback script 007 → 6 → 7", () => {
  it("removes adjustments and temporary versions, keeps workouts, and 007 applies again", async () => {
    const admin = new URL(inject("databaseAdminUrl"));
    const name = `arnold_rollback_${randomUUID().replaceAll("-", "")}`;
    await asOwner((c) => c.query(`create database ${name}`));
    const url = new URL(admin);
    url.pathname = `/${name}`;
    const exec = async (sql: string, values: unknown[] = []) => {
      const client = new pg.Client({ connectionString: url.toString() });
      await client.connect();
      try {
        return await client.query(sql, values);
      } finally {
        await client.end();
      }
    };
    const tables = async () =>
      (
        await exec(
          `select table_name from information_schema.tables where table_schema = 'arnold' and table_name = 'plan_adjustments'`,
        )
      ).rows.map((r) => r.table_name as string);
    try {
      expect(await migrate(url.toString())).toEqual([1, 2, 3, 4, 5, 6, 7]);
      expect(await tables()).toEqual(["plan_adjustments"]);
      const userId = `usr_${randomUUID()}`;
      await exec("insert into arnold.users (user_id) values ($1)", [userId]);
      await exec(
        `insert into arnold.plan_versions (user_id, plan_version_id, plan_family_id, version_no, name, status, activated_at_utc, created_at_utc, updated_at_utc, row_revision)
         values ($1, 'base', 'f1', 1, 'Plan', 'active', $2, $2, $2, 1),
                ($1, 'temp', 'f2', 1, 'Anpassung', 'temporary', null, $2, $2, 1)`,
        [userId, STAMP],
      );
      await exec(
        `insert into arnold.plan_adjustments (user_id, plan_adjustment_id, plan_version_id, base_plan_version_id, kind, start_date_local, end_date_local, timezone, status, confirmed_at_utc, created_at_utc, updated_at_utc, row_revision)
         values ($1, 'pa', 'temp', 'base', 'today', '2026-11-17', '2026-11-17', 'Europe/Berlin', 'confirmed', $2, $2, $2, 1)`,
        [userId, STAMP],
      );
      await exec(
        `insert into arnold.workouts (user_id, workout_id, plan_version_id, workout_date_local, timezone, status, source, created_at_utc, updated_at_utc, row_revision)
         values ($1, 'w1', 'temp', '2026-11-17', 'Europe/Berlin', 'completed', 'chat', $2, $2, 1)`,
        [userId, STAMP],
      );
      const script = await readFile("db/rollback/007_down.sql", "utf8");
      await exec(script);
      expect(
        (
          await exec(
            "select max(version)::int as v from arnold.schema_migrations",
          )
        ).rows[0].v,
      ).toBe(6);
      expect(await tables()).toEqual([]);
      expect(
        (await exec("select plan_version_id from arnold.plan_versions")).rows,
      ).toEqual([{ plan_version_id: "base" }]);
      expect(
        (await exec("select workout_id, plan_version_id from arnold.workouts"))
          .rows,
      ).toEqual([{ workout_id: "w1", plan_version_id: null }]);
      await expect(exec(script)).rejects.toThrow(/not applied/);
      expect(await migrate(url.toString())).toEqual([7]);
      expect(await tables()).toEqual(["plan_adjustments"]);
    } finally {
      await asOwner((c) => c.query(`drop database ${name} with (force)`));
    }
  });
});
