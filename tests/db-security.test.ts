/**
 * The guarantee that matters most: one user never sees or changes another
 * user's data. Checked against a real Postgres with the same migration and
 * the same server role (`arnold_app`) as production.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { inject } from "vitest";
import { Database } from "../src/server/db/database";
import { PostgresIdentityRepository } from "../src/server/db/identity";
import { migrate } from "../src/server/db/migrate";
import {
  TEST_ISSUER,
  appDatabase,
  asOwner,
  logOneSet,
  newAccount,
} from "./fixtures/arnold-db";

let db: Database;
beforeAll(() => {
  db = appDatabase();
});
afterAll(() => db.close());

const count = async (userId: string | null, table: string) => {
  const sql = `select count(*)::int as n from arnold.${table}`;
  if (!userId) return (await db.query<{ n: number }>(sql)).rows[0].n;
  return db.asUser(
    userId,
    async (c) => (await c.query<{ n: number }>(sql)).rows[0].n,
  );
};

describe("row level security", () => {
  it("shows a user only their own rows, even without a where clause", async () => {
    const alice = await newAccount(db);
    const bob = await newAccount(db);
    await logOneSet(alice);
    for (const table of ["workouts", "sets"]) {
      expect(await count(alice.userId, table), table).toBe(1);
      expect(await count(bob.userId, table), table).toBe(0);
    }
    // Both have their own starter catalog; neither sees the other's.
    const aliceExercises = await count(alice.userId, "exercises");
    expect(aliceExercises).toBeGreaterThan(10);
    expect(await count(bob.userId, "exercises")).toBe(aliceExercises);
    expect((await bob.store.read()).workouts).toEqual([]);
    expect((await alice.store.read()).workouts).toHaveLength(1);
  });

  it("shows nothing at all without a user context", async () => {
    const alice = await newAccount(db);
    await logOneSet(alice);
    for (const table of [
      "users",
      "identity_connections",
      "exercises",
      "plan_versions",
      "plan_items",
      "workouts",
      "sets",
      "operations",
      "audit_events",
      "onboarding_sessions",
      "watch_devices",
      "health_consents",
      "workout_recordings",
      "workout_health",
      // Mobility (migration 009).
      "mobility_profiles",
      "plan_mobility_sessions",
      "mobility_results",
    ])
      expect(await count(null, table), table).toBe(0);
  });

  it("refuses to write a row for another user", async () => {
    const alice = await newAccount(db);
    const bob = await newAccount(db);
    await expect(
      db.asUser(bob.userId, (c) =>
        c.query(
          `insert into arnold.workouts (user_id, workout_id, workout_date_local, timezone, status, source, created_at_utc, updated_at_utc, row_revision)
           values ($1, 'stolen', '2026-10-29', 'Europe/Berlin', 'in_progress', 'chat', '2026-10-29T10:00:00Z', '2026-10-29T10:00:00Z', 1)`,
          [alice.userId],
        ),
      ),
    ).rejects.toMatchObject({ code: "42501" });
    expect(await count(alice.userId, "workouts")).toBe(0);
  });

  it("cannot change or reference another user's rows", async () => {
    const alice = await newAccount(db);
    const bob = await newAccount(db);
    const workoutId = await logOneSet(alice);
    const updated = await db.asUser(bob.userId, (c) =>
      c.query("update arnold.sets set reps = 99 where workout_id = $1", [
        workoutId,
      ]),
    );
    expect(updated.rowCount).toBe(0);
    // A set of Bob's pointing at Alice's workout does not exist for Bob.
    await expect(
      db.asUser(bob.userId, (c) =>
        c.query(
          `insert into arnold.sets (user_id, set_id, workout_id, exercise_id, exercise_name_snapshot, exercise_order, set_number, set_type, reps, reps_basis, load_kg, load_basis, implement_count, execution_mode, side, status, source, created_at_utc, updated_at_utc, row_revision)
           values ($1, 'x', $2, 'bench-press', 'Bankdrücken', 1, 1, 'working', 5, 'total', 50, 'total', 1, 'bilateral_simultaneous', 'both', 'active', 'chat', '2026-10-29T10:00:00Z', '2026-10-29T10:00:00Z', 1)`,
          [bob.userId, workoutId],
        ),
      ),
    ).rejects.toMatchObject({ code: "23503" });
    const reps = (await alice.store.read()).sets[0].reps;
    expect(reps).toBe(10);
  });

  it("gives the server role no destructive or structural rights", async () => {
    const alice = await newAccount(db);
    await logOneSet(alice);
    for (const statement of [
      "delete from arnold.sets",
      "delete from arnold.workouts",
      "truncate arnold.sets",
      "delete from arnold.mobility_profiles",
      "delete from arnold.plan_mobility_sessions",
      "delete from arnold.mobility_results",
      "truncate arnold.mobility_results",
      "alter table arnold.mobility_results add column x int",
      "drop table arnold.mobility_profiles",
      "alter table arnold.sets add column x int",
      "create table arnold.x (id int)",
      "drop table arnold.sets",
      "update arnold.users set status = 'ACTIVE'",
      "insert into arnold.users (user_id) values ('usr_00000000-0000-4000-8000-000000000000')",
    ])
      await expect(
        db.asUser(alice.userId, (c) => c.query(statement)),
        statement,
      ).rejects.toMatchObject({ code: expect.stringMatching(/^42/) });
    expect(await count(alice.userId, "sets")).toBe(1);
  });

  it("keeps the mobility tables (migration 009) to their owner, also on account deletion", async () => {
    const alice = await newAccount(db);
    const bob = await newAccount(db);
    const stamp = "2026-11-22T06:00:00Z";
    const workoutId = randomUUID();
    await db.asUser(alice.userId, async (c) => {
      await c.query(
        `insert into arnold.mobility_profiles (user_id, mobility_profile_id, wants, morning_weekdays, morning_minutes, created_at_utc, updated_at_utc, row_revision)
         values ($1, 'mp', true, '{1,3,5}', 10, $2, $2, 1)`,
        [alice.userId, stamp],
      );
      await c.query(
        `insert into arnold.plan_versions (user_id, plan_version_id, plan_family_id, version_no, name, status, created_at_utc, updated_at_utc, row_revision)
         values ($1, 'pv-mob', 'pf-mob', 1, 'Plan', 'draft', $2, $2, 1)`,
        [alice.userId, stamp],
      );
      await c.query(
        `insert into arnold.plan_mobility_sessions (user_id, plan_mobility_session_id, plan_version_id, session_id, session_order, session_name, kind, placement, weekdays, minutes, template, status, row_revision)
         values ($1, 'pms', 'pv-mob', 's-mob', 1, 'Morgen', 'morning', 'own_day', '{1}', 5, '{}', 'active', 1)`,
        [alice.userId],
      );
      await c.query(
        `insert into arnold.workouts (user_id, workout_id, workout_date_local, timezone, status, source, created_at_utc, updated_at_utc, row_revision, activity_type)
         values ($1, $2, '2026-11-22', 'Europe/Berlin', 'completed', 'chat', $3, $3, 1, 'mobility')`,
        [alice.userId, workoutId, stamp],
      );
      await c.query(
        `insert into arnold.mobility_results (user_id, workout_id, kind, exercises_total, exercises_done, exercises_skipped, items, result_source, catalog_version, rules_version, created_at_utc, updated_at_utc, row_revision)
         values ($1, $2, 'morning', 0, 0, 0, '[]', 'chat', 'mob-1', 'r', $3, $3, 1)`,
        [alice.userId, workoutId, stamp],
      );
    });
    const tables = [
      "mobility_profiles",
      "plan_mobility_sessions",
      "mobility_results",
    ];
    for (const table of tables) {
      expect(await count(alice.userId, table), table).toBe(1);
      expect(await count(bob.userId, table), table).toBe(0);
      expect(await count(null, table), table).toBe(0);
      const changed = await db.asUser(bob.userId, (c) =>
        c.query(`update arnold.${table} set row_revision = row_revision + 1`),
      );
      expect(changed.rowCount, table).toBe(0);
    }
    // Bob cannot hang his own result on Alice's workout.
    await expect(
      db.asUser(bob.userId, (c) =>
        c.query(
          `insert into arnold.mobility_results (user_id, workout_id, kind, exercises_total, exercises_done, exercises_skipped, items, result_source, catalog_version, rules_version, created_at_utc, updated_at_utc, row_revision)
           values ($1, $2, 'morning', 0, 0, 0, '[]', 'chat', 'mob-1', 'r', $3, $3, 1)`,
          [bob.userId, workoutId, stamp],
        ),
      ),
    ).rejects.toMatchObject({ code: "23503" });
    expect(await alice.identities.remove(alice.userId)).toBe(true);
    const left = await asOwner(async (c) => {
      const totals: number[] = [];
      for (const table of [...tables, "workouts", "plan_versions"])
        totals.push(
          (
            await c.query<{ n: number }>(
              `select count(*)::int as n from arnold.${table} where user_id = $1`,
              [alice.userId],
            )
          ).rows[0].n,
        );
      return totals;
    });
    expect(left).toEqual([0, 0, 0, 0, 0]);
  });

  it("refuses a malformed user id before any query runs", async () => {
    await expect(
      db.asUser("' or 1=1 --", async () => undefined),
    ).rejects.toThrow("Ungültige Nutzerkennung");
  });

  it("starts only as a role that cannot bypass the policies", async () => {
    await expect(db.assertReady()).resolves.toBeUndefined();
    const owner = new Database({ url: inject("databaseAdminUrl") });
    try {
      await expect(owner.assertReady()).rejects.toThrow("arnold_app");
    } finally {
      await owner.close();
    }
  });
});

describe("accounts", () => {
  it("creates exactly one account per login, even under concurrency", async () => {
    const identities = new PostgresIdentityRepository(db);
    const subject = `same-${randomUUID()}`;
    const results = await Promise.all(
      Array.from({ length: 10 }, () =>
        identities.register(TEST_ISSUER, subject),
      ),
    );
    const ids = new Set(results.map((r) => r.user.user_id));
    expect(ids.size).toBe(1);
    expect(results.filter((r) => r.created)).toHaveLength(1);
    // The same subject at another issuer is another person.
    const other = await identities.register(
      "https://other.issuer.test/",
      subject,
    );
    expect(other.user.user_id).not.toBe(results[0].user.user_id);
  });

  it("does not write on every request", async () => {
    const identities = new PostgresIdentityRepository(db);
    const subject = `seen-${randomUUID()}`;
    const first = await identities.register(TEST_ISSUER, subject);
    const again = await identities.register(TEST_ISSUER, subject);
    expect(again.connection.last_seen_at_utc).toBe(
      first.connection.last_seen_at_utc,
    );
    expect(await identities.find(TEST_ISSUER, `unknown-${randomUUID()}`)).toBe(
      undefined,
    );
  });

  it("deletes every row of an account and nothing of anyone else", async () => {
    const alice = await newAccount(db);
    const bob = await newAccount(db);
    await logOneSet(alice);
    await logOneSet(bob);
    expect(await alice.identities.remove(alice.userId)).toBe(true);
    const left = await asOwner(async (c) => {
      const totals: Record<string, number> = {};
      for (const table of [
        "users",
        "identity_connections",
        "exercises",
        "workouts",
        "sets",
        "operations",
        "audit_events",
        "mobility_profiles",
        "plan_mobility_sessions",
        "mobility_results",
      ])
        totals[table] = (
          await c.query<{ n: number }>(
            `select count(*)::int as n from arnold.${table} where user_id = $1`,
            [alice.userId],
          )
        ).rows[0].n;
      return totals;
    });
    expect(
      Object.values(left).every((n) => n === 0),
      JSON.stringify(left),
    ).toBe(true);
    expect((await bob.store.read()).workouts).toHaveLength(1);
    // The same login later starts over with a new, empty account.
    const again = await alice.identities.register(TEST_ISSUER, alice.subject);
    expect(again.created).toBe(true);
    expect(again.user.user_id).not.toBe(alice.userId);
  });

  it("applies migrations exactly once", async () => {
    expect(await migrate(inject("databaseAdminUrl"))).toEqual([]);
  });
});

describe("connection settings", () => {
  it("always verifies the certificate of a remote database", async () => {
    const { connectionConfig } = await import("../src/server/db/database");
    const remote = connectionConfig(
      "postgres://arnold_app.ref:pw@pooler.example.com:5432/postgres?sslmode=disable",
    );
    expect(remote.ssl).toEqual({ rejectUnauthorized: true });
    expect(remote).toMatchObject({
      host: "pooler.example.com",
      user: "arnold_app.ref",
      database: "postgres",
    });
    const pinned = connectionConfig(
      "postgres://u:p@db.example.com/postgres",
      "-----BEGIN CERTIFICATE-----",
    );
    expect(pinned.ssl).toMatchObject({
      rejectUnauthorized: true,
      ca: "-----BEGIN CERTIFICATE-----",
    });
    expect(connectionConfig("postgres://u:p@127.0.0.1:5/x").ssl).toBe(false);
    expect(() => connectionConfig("mysql://u:p@h/x")).toThrow("postgres://");
  });
});

describe("server connection for Supabase", () => {
  it("derives the arnold_app user from the owner URL", async () => {
    const { appUrlFor } = await import("../src/server/db/app-role");
    expect(
      appUrlFor(
        "postgres://postgres.abcref:secret@aws-0-eu-central-1.pooler.supabase.com:5432/postgres?sslmode=require",
        "new-password",
      ),
    ).toBe(
      "postgres://arnold_app.abcref:new-password@aws-0-eu-central-1.pooler.supabase.com:5432/postgres",
    );
    expect(appUrlFor("postgres://postgres:s@127.0.0.1:5/postgres", "p")).toBe(
      "postgres://arnold_app:p@127.0.0.1:5/postgres",
    );
  });
});
