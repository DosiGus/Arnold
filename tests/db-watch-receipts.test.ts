/**
 * Migration 006 (watch plan receipts) against the real test Postgres: user
 * separation, mark format, account deletion cascades, and the rollback
 * script 6 → 5 → 6 on a database of its own. All values are invented.
 */
import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import pg from "pg";
import { afterAll, describe, expect, inject, it } from "vitest";
import { migrate } from "../src/server/db/migrate";
import { appDatabase, asOwner, newAccount } from "./fixtures/arnold-db.js";

const db = appDatabase();
afterAll(() => db.close());

type Account = Awaited<ReturnType<typeof newAccount>>;

async function watch(account: Account) {
  const deviceId = `wdv_${randomUUID()}`;
  await db.asUser(account.userId, (c) =>
    c.query(
      `insert into arnold.watch_devices (user_id, device_id, token_hash, label, timezone)
       values ($1, $2, $3, 'Forerunner 255', 'Europe/Berlin')`,
      [
        account.userId,
        deviceId,
        createHash("sha256").update(randomUUID()).digest(),
      ],
    ),
  );
  return deviceId;
}

const receipt = (account: Account, deviceId: string, mark: string) =>
  db.asUser(account.userId, (c) =>
    c.query(
      `insert into arnold.watch_plan_receipts (user_id, device_id, plan_mark)
       values ($1, $2, $3)`,
      [account.userId, deviceId, mark],
    ),
  );

const count = (userId: string) =>
  asOwner(
    async (c) =>
      (
        await c.query<{ n: number }>(
          "select count(*)::int as n from arnold.watch_plan_receipts where user_id = $1",
          [userId],
        )
      ).rows[0].n,
  );

describe("watch_plan_receipts: user separation", () => {
  it("lets each user see only their own receipts, never write for another user", async () => {
    const alice = await newAccount(db);
    const bob = await newAccount(db);
    const aliceWatch = await watch(alice);
    const bobWatch = await watch(bob);
    await receipt(alice, aliceWatch, "0123456789abcdef");
    await receipt(bob, bobWatch, "fedcba9876543210");

    const seen = await db.asUser(
      bob.userId,
      async (c) =>
        (
          await c.query<{ user_id: string; plan_mark: string }>(
            "select user_id, plan_mark from arnold.watch_plan_receipts",
          )
        ).rows,
    );
    expect(seen).toEqual([
      { user_id: bob.userId, plan_mark: "fedcba9876543210" },
    ]);

    // Bob cannot write a receipt in Alice's name, not even for her watch.
    await expect(
      db.asUser(bob.userId, (c) =>
        c.query(
          `insert into arnold.watch_plan_receipts (user_id, device_id, plan_mark)
           values ($1, $2, '0000000000000000')`,
          [alice.userId, aliceWatch],
        ),
      ),
    ).rejects.toBeTruthy();
    // Nor can he point his own row at Alice's watch (the FK carries user_id).
    await expect(
      receipt(bob, aliceWatch, "0000000000000000"),
    ).rejects.toBeTruthy();
    // Bob's update never reaches Alice's row.
    await db.asUser(bob.userId, (c) =>
      c.query(
        "update arnold.watch_plan_receipts set plan_mark = '1111111111111111' where user_id = $1",
        [alice.userId],
      ),
    );
    const alices = await db.asUser(
      alice.userId,
      async (c) =>
        (await c.query("select plan_mark from arnold.watch_plan_receipts"))
          .rows,
    );
    expect(alices).toEqual([{ plan_mark: "0123456789abcdef" }]);
    // The server role has no delete right on receipts.
    await expect(
      db.asUser(alice.userId, (c) =>
        c.query("delete from arnold.watch_plan_receipts"),
      ),
    ).rejects.toMatchObject({ code: "42501" });
  });

  it("refuses a mark that is not 16 lowercase hex characters", async () => {
    const alice = await newAccount(db);
    const id = await watch(alice);
    for (const bad of ["", "0123456789ABCDEF", "0123", "0123456789abcdef0"])
      await expect(receipt(alice, id, bad), bad).rejects.toMatchObject({
        code: "23514",
      });
  });

  it("goes with the account", async () => {
    const alice = await newAccount(db);
    await receipt(alice, await watch(alice), "0123456789abcdef");
    expect(await count(alice.userId)).toBe(1);
    await asOwner((c) =>
      c.query("delete from arnold.users where user_id = $1", [alice.userId]),
    );
    expect(await count(alice.userId)).toBe(0);
  });
});

describe("rollback script 006 → 5 → 6", () => {
  it("brings the schema back to version 5 and migration 006 applies again", async () => {
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
          `select table_name from information_schema.tables where table_schema = 'arnold' and table_name = 'watch_plan_receipts'`,
        )
      ).rows.map((r) => r.table_name as string);
    try {
      expect(await migrate(url.toString())).toEqual([
        1, 2, 3, 4, 5, 6, 7, 8, 9, 10,
      ]);
      expect(await tables()).toEqual(["watch_plan_receipts"]);
      // 007 and 008 sit on top and have to go first.
      await exec(await readFile("db/rollback/010_down.sql", "utf8"));
      await exec(await readFile("db/rollback/009_down.sql", "utf8"));
      await exec(await readFile("db/rollback/008_down.sql", "utf8"));
      await exec(await readFile("db/rollback/007_down.sql", "utf8"));
      const script = await readFile("db/rollback/006_down.sql", "utf8");
      await exec(script);
      expect(
        (
          await exec(
            "select max(version)::int as v from arnold.schema_migrations",
          )
        ).rows[0].v,
      ).toBe(5);
      expect(await tables()).toEqual([]);
      await expect(exec(script)).rejects.toThrow(/not applied/);
      expect(await migrate(url.toString())).toEqual([6, 7, 8, 9, 10]);
      expect(await tables()).toEqual(["watch_plan_receipts"]);
    } finally {
      await asOwner((c) => c.query(`drop database ${name} with (force)`));
    }
  });
});

describe("watch_plan_receipts.mobility_mark (migration 009)", () => {
  const MOBILITY = "89abcdef01234567";

  const markOf = (account: Account, deviceId: string) =>
    db.asUser(
      account.userId,
      async (c) =>
        (
          await c.query<{ plan_mark: string; mobility_mark: string | null }>(
            "select plan_mark, mobility_mark from arnold.watch_plan_receipts where device_id = $1",
            [deviceId],
          )
        ).rows[0],
    );

  it("is empty for a watch that confirmed only the plan mark", async () => {
    const account = await newAccount(db);
    const deviceId = await watch(account);
    await receipt(account, deviceId, "0123456789abcdef");
    expect(await markOf(account, deviceId)).toEqual({
      plan_mark: "0123456789abcdef",
      mobility_mark: null,
    });
  });

  it("stores the mark of the confirmed mobility, replaces it and keeps it when a later confirmation has none", async () => {
    const account = await newAccount(db);
    const deviceId = await watch(account);
    const confirm = (planMark: string, mobilityMark: string | null) =>
      db.asUser(account.userId, (c) =>
        c.query(
          `insert into arnold.watch_plan_receipts (user_id, device_id, plan_mark, mobility_mark, confirmed_at)
           values ($1, $2, $3, $4, now())
           on conflict (user_id, device_id)
           do update set plan_mark = excluded.plan_mark,
                         mobility_mark = coalesce(excluded.mobility_mark, watch_plan_receipts.mobility_mark),
                         confirmed_at = excluded.confirmed_at`,
          [account.userId, deviceId, planMark, mobilityMark],
        ),
      );
    await confirm("0123456789abcdef", MOBILITY);
    expect((await markOf(account, deviceId))?.mobility_mark).toBe(MOBILITY);
    await confirm("fedcba9876543210", null);
    expect(await markOf(account, deviceId)).toEqual({
      plan_mark: "fedcba9876543210",
      mobility_mark: MOBILITY,
    });
    await confirm("fedcba9876543210", "0000000000000000");
    expect((await markOf(account, deviceId))?.mobility_mark).toBe(
      "0000000000000000",
    );
  });

  it("refuses a mobility mark that is not 16 lowercase hex characters", async () => {
    const account = await newAccount(db);
    const deviceId = await watch(account);
    await receipt(account, deviceId, "0123456789abcdef");
    for (const bad of ["ABCDEF0123456789", "0123", "0123456789abcdeg", ""])
      await expect(
        db.asUser(account.userId, (c) =>
          c.query(
            "update arnold.watch_plan_receipts set mobility_mark = $2 where device_id = $1",
            [deviceId, bad],
          ),
        ),
      ).rejects.toThrow();
  });

  it("is readable only by its own user", async () => {
    const alice = await newAccount(db);
    const bob = await newAccount(db);
    const aliceWatch = await watch(alice);
    await receipt(alice, aliceWatch, "0123456789abcdef");
    await db.asUser(alice.userId, (c) =>
      c.query(
        "update arnold.watch_plan_receipts set mobility_mark = $2 where device_id = $1",
        [aliceWatch, MOBILITY],
      ),
    );
    const seenByBob = await db.asUser(
      bob.userId,
      async (c) =>
        (await c.query("select mobility_mark from arnold.watch_plan_receipts"))
          .rows,
    );
    expect(seenByBob).toEqual([]);
  });
});
