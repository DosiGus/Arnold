/**
 * Migration 011 (plan explanation) against the real test Postgres: the
 * explanation is written through the plan service (commitWrite), read back
 * unchanged, absent for a plan without one, only visible to its owner, and
 * the rollback script 11 → 10 → 11 works. All values are invented.
 */
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import pg from "pg";
import { afterAll, describe, expect, inject, it } from "vitest";
import { migrate } from "../src/server/db/migrate";
import { appDatabase, asOwner, newAccount } from "./fixtures/arnold-db.js";

const db = appDatabase();
afterAll(() => db.close());

const EXPLANATION = {
  summary: "Zwei Ganzkörpereinheiten zum Einstieg.",
  split: "Bei zwei Tagen trainiert jede Einheit den ganzen Körper.",
  exercises: [{ name: "Bankdrücken", reason: "Grundübung für die Brust." }],
  progression: "Erst Wiederholungen aufbauen, dann mehr Gewicht.",
  adjust: ["Mach den Plan kürzer"],
  unknowns: ["Startgewichte sind vorsichtig geschätzt."],
};

const session = (name: string) => ({
  session_name: name,
  exercises: [
    { exercise_id: "bench-press", target_sets: 3, rep_min: 8, rep_max: 12 },
  ],
});

type Account = Awaited<ReturnType<typeof newAccount>>;
async function createPlan(account: Account, explanation?: object) {
  const response = await account.plans.createTrainingPlan({
    request_id: randomUUID(),
    name: "Testplan",
    origin: "ai_proposal",
    sessions: [session("A"), session("B")],
    ...(explanation ? { explanation } : {}),
  });
  expect(response.ok, response.error?.message).toBe(true);
  return response.result!.plan!.version;
}

describe("plan_versions.explanation", () => {
  it("stores the explanation with the draft and reads it back unchanged", async () => {
    const account = await newAccount(db);
    const version = await createPlan(account, EXPLANATION);
    expect(version.explanation).toEqual(EXPLANATION);
    const reread = await account.plans.getPlan({
      plan_version_id: version.plan_version_id,
    });
    expect(reread.plan.explanation).toEqual(EXPLANATION);
  });

  it("is absent for a plan without one, and only visible to its owner", async () => {
    const alice = await newAccount(db);
    const bob = await newAccount(db);
    const plain = await createPlan(alice);
    expect(plain).not.toHaveProperty("explanation");
    await createPlan(alice, EXPLANATION);
    const seen = await db.asUser(
      bob.userId,
      async (c) =>
        (
          await c.query(
            "select explanation from arnold.plan_versions where explanation is not null",
          )
        ).rows,
    );
    expect(seen).toEqual([]);
  });
});

describe("rollback script 011 → 10 → 11", () => {
  it("drops the column and the receipts carrying it, and 011 applies again", async () => {
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
    const columns = async () =>
      (
        await exec(
          `select column_name from information_schema.columns
            where table_schema = 'arnold' and table_name = 'plan_versions'`,
        )
      ).rows.map((r) => r.column_name as string);
    try {
      expect(await migrate(url.toString())).toEqual([
        1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12,
      ]);
      expect(await columns()).toContain("explanation");
      const userId = `usr_${randomUUID()}`;
      await exec(
        "insert into arnold.users (user_id, tracker_id) values ($1, $2)",
        [userId, `trk_${randomUUID()}`],
      );
      await exec(
        `insert into arnold.operations (user_id, request_id, fingerprint, actor, changes, result)
         values ($1, 'r-expl', 'f', 'a', $2, '{}'), ($1, 'r-plain', 'f', 'a', $3, '{}')`,
        [
          userId,
          JSON.stringify([
            { table: "plans", before: null, after: { explanation: {} } },
          ]),
          JSON.stringify([{ table: "plans", before: null, after: {} }]),
        ],
      );
      await exec(await readFile("db/rollback/012_down.sql", "utf8"));
      const script = await readFile("db/rollback/011_down.sql", "utf8");
      await exec(script);
      expect(await columns()).not.toContain("explanation");
      expect(
        (await exec("select request_id from arnold.operations")).rows,
      ).toEqual([{ request_id: "r-plain" }]);
      expect(
        (
          await exec(
            "select max(version)::int as v from arnold.schema_migrations",
          )
        ).rows[0].v,
      ).toBe(10);
      await expect(exec(script)).rejects.toThrow(/not applied/);
      expect(await migrate(url.toString())).toEqual([11, 12]);
      expect(await columns()).toContain("explanation");
    } finally {
      await asOwner((c) => c.query(`drop database ${name} with (force)`));
    }
  });
});
