/**
 * Goals and body weight in the real database: stored through the same write
 * path as sets, read back unchanged, invisible to anyone else, retried without
 * duplicates and deleted with the account.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { Database } from "../src/server/db/database";
import { buildDashboardView } from "../src/server/arnold-presenter";
import {
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

const ownerCount = (table: string, userId: string) =>
  asOwner(
    async (c) =>
      (
        await c.query<{ n: number }>(
          `select count(*)::int as n from arnold.${table} where user_id = $1`,
          [userId],
        )
      ).rows[0].n,
  );

describe("goals and body weight in Postgres", () => {
  it("stores a goal and a body weight, and reads them back unchanged", async () => {
    const alice = await newAccount(db);
    const workoutId = await logOneSet(alice, 80);
    const done = await alice.logging.execute("complete_workout", {
      request_id: randomUUID(),
      workout_id: workoutId,
      expected_row_revision: 1,
    });
    expect(done.ok, JSON.stringify(done.error)).toBe(true);
    const weight = await alice.logging.execute("log_body_weight", {
      request_id: randomUUID(),
      measured_on: "2026-10-29",
      timezone: "Europe/Berlin",
      weight_kg: 84.5,
      source: "ui",
    });
    expect(weight.ok, JSON.stringify(weight.error)).toBe(true);
    const goal = await alice.logging.execute("create_training_goal", {
      request_id: randomUUID(),
      kind: "exercise_load",
      exercise_id: "bench-press",
      target_value: 100,
    });
    expect(goal.ok, JSON.stringify(goal.error)).toBe(true);
    // The start value comes from the stored sets, not from the caller.
    expect(goal.result!.goal).toMatchObject({
      kind: "exercise_load",
      load_basis: "total",
      start_value: 80,
      status: "active",
    });

    const data = await alice.store.read();
    expect(data.goals).toEqual([goal.result!.goal]);
    expect(data.bodyWeights).toEqual([weight.result!.body_weight]);
    // Also physically in the tables, under Alice's id.
    expect(await ownerCount("goals", alice.userId)).toBe(1);
    expect(await ownerCount("body_weights", alice.userId)).toBe(1);

    // And on the dashboard, with progress computed from the sets.
    const view = buildDashboardView(
      data,
      { generatedAt: new Date().toISOString() },
      { reference_date: "2026-10-30" },
    );
    expect(view.home.goals).toHaveLength(1);
    expect(view.home.goals[0]).toMatchObject({
      name: "Bankdrücken",
      current_value: 80,
      target_value: 100,
      progress: 0,
    });
    expect(view.home.latest_body_weight).toMatchObject({
      date: "2026-10-29",
      weight_kg: 84.5,
    });
  });

  it("updates and archives a goal with a revision check", async () => {
    const alice = await newAccount(db);
    const created = await alice.logging.execute("create_training_goal", {
      request_id: randomUUID(),
      kind: "body_weight",
      target_value: 80,
    });
    const goal = created.result!.goal!;
    const stale = await alice.logging.execute("update_training_goal", {
      request_id: randomUUID(),
      goal_id: goal.goal_id,
      expected_row_revision: 7,
      target_value: 78,
    });
    expect(stale.error?.code).toBe("REVISION_CONFLICT");
    const updated = await alice.logging.execute("update_training_goal", {
      request_id: randomUUID(),
      goal_id: goal.goal_id,
      expected_row_revision: 1,
      target_value: 78,
    });
    expect(updated.result!.goal).toMatchObject({
      target_value: 78,
      row_revision: 2,
    });
    const archived = await alice.logging.execute("archive_training_goal", {
      request_id: randomUUID(),
      goal_id: goal.goal_id,
      expected_row_revision: 2,
    });
    expect(archived.result!.goal!.status).toBe("archived");
    const data = await alice.store.read();
    expect(data.goals[0]).toMatchObject({
      status: "archived",
      row_revision: 3,
    });
    // A new goal of the same kind is allowed once the old one is archived.
    const again = await alice.logging.execute("create_training_goal", {
      request_id: randomUUID(),
      kind: "body_weight",
      target_value: 79,
    });
    expect(again.ok).toBe(true);
  });

  it("allows one active goal per kind and exercise, in the schema and in the database", async () => {
    const alice = await newAccount(db);
    const first = await alice.logging.execute("create_training_goal", {
      request_id: randomUUID(),
      kind: "exercise_reps",
      exercise_id: "bench-press",
      target_value: 12,
    });
    expect(first.ok).toBe(true);
    const second = await alice.logging.execute("create_training_goal", {
      request_id: randomUUID(),
      kind: "exercise_reps",
      exercise_id: "bench-press",
      target_value: 15,
    });
    expect(second.error?.code).toBe("GOAL_EXISTS");
    // The database refuses it on its own as well.
    await expect(
      db.asUser(alice.userId, (c) =>
        c.query(
          `insert into arnold.goals (user_id, goal_id, kind, exercise_id, target_value, status, created_at_utc, updated_at_utc, row_revision)
           values ($1, 'dup', 'exercise_reps', 'bench-press', 15, 'active', '2026-10-29T10:00:00Z', '2026-10-29T10:00:00Z', 1)`,
          [alice.userId],
        ),
      ),
    ).rejects.toMatchObject({ code: "23505" });
  });

  it("replays a retried write instead of storing it twice", async () => {
    const alice = await newAccount(db);
    const input = {
      request_id: randomUUID(),
      measured_on: "2026-10-28",
      timezone: "Europe/Berlin",
      weight_kg: 85,
    };
    const first = await alice.logging.execute("log_body_weight", input);
    const again = await alice.logging.execute("log_body_weight", input);
    expect(again.replayed).toBe(true);
    expect(again.result!.body_weight).toEqual(first.result!.body_weight);
    expect((await alice.store.read()).bodyWeights).toHaveLength(1);
  });

  it("keeps one valid weight per day; a second entry voids the first", async () => {
    const alice = await newAccount(db);
    const entry = (weight_kg: number) =>
      alice.logging.execute("log_body_weight", {
        request_id: randomUUID(),
        measured_on: "2026-10-27",
        timezone: "Europe/Berlin",
        weight_kg,
      });
    await entry(86);
    await entry(85.6);
    const rows = (await alice.store.read()).bodyWeights;
    expect(rows.map((r) => [r.weight_kg, r.status])).toEqual([
      [86, "voided"],
      [85.6, "active"],
    ]);
  });

  it("never shows one user's goals or weights to another", async () => {
    const alice = await newAccount(db);
    const bob = await newAccount(db);
    await alice.logging.execute("create_training_goal", {
      request_id: randomUUID(),
      kind: "body_weight",
      target_value: 70,
    });
    await alice.logging.execute("log_body_weight", {
      request_id: randomUUID(),
      measured_on: "2026-10-29",
      timezone: "Europe/Berlin",
      weight_kg: 72,
    });
    const seen = await bob.store.read();
    expect(seen.goals).toEqual([]);
    expect(seen.bodyWeights).toEqual([]);
    for (const table of ["goals", "body_weights"]) {
      const visible = await db.asUser(
        bob.userId,
        async (c) =>
          (
            await c.query<{ n: number }>(
              `select count(*)::int as n from arnold.${table}`,
            )
          ).rows[0].n,
      );
      expect(visible, table).toBe(0);
      // Without a user context nothing at all.
      const none = (
        await db.query<{ n: number }>(
          `select count(*)::int as n from arnold.${table}`,
        )
      ).rows[0].n;
      expect(none, table).toBe(0);
    }
    // Bob cannot change Alice's goal, nor delete anything.
    const changed = await db.asUser(bob.userId, (c) =>
      c.query("update arnold.goals set target_value = 1"),
    );
    expect(changed.rowCount).toBe(0);
    await expect(
      db.asUser(alice.userId, (c) => c.query("delete from arnold.goals")),
    ).rejects.toMatchObject({ code: expect.stringMatching(/^42/) });
  });

  it("refuses a goal on another user's exercise row", async () => {
    const alice = await newAccount(db);
    const bob = await newAccount(db);
    await expect(
      db.asUser(bob.userId, (c) =>
        c.query(
          `insert into arnold.goals (user_id, goal_id, kind, exercise_id, target_value, status, created_at_utc, updated_at_utc, row_revision)
           values ($1, 'x', 'exercise_reps', 'not-an-exercise', 10, 'active', '2026-10-29T10:00:00Z', '2026-10-29T10:00:00Z', 1)`,
          [bob.userId],
        ),
      ),
    ).rejects.toMatchObject({ code: "23503" });
    void alice;
  });

  it("deletes goals and weights with the account", async () => {
    const alice = await newAccount(db);
    await alice.logging.execute("create_training_goal", {
      request_id: randomUUID(),
      kind: "body_weight",
      target_value: 70,
    });
    await alice.logging.execute("log_body_weight", {
      request_id: randomUUID(),
      measured_on: "2026-10-29",
      timezone: "Europe/Berlin",
      weight_kg: 72,
    });
    expect(await alice.identities.remove(alice.userId)).toBe(true);
    expect(await ownerCount("goals", alice.userId)).toBe(0);
    expect(await ownerCount("body_weights", alice.userId)).toBe(0);
  });
});
