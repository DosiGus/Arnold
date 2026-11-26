/**
 * Migration 012 (running goals) against the real test Postgres: running goals
 * are written through the goal service (commitWrite), start from the stored
 * runs, read back unchanged, keep one active goal per distance, stay with
 * their owner, reach the start screen through the store source with the
 * running records, and the rollback script 12 → 11 → 12 works. All values are
 * invented.
 */
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import pg from "pg";
import { afterAll, describe, expect, inject, it } from "vitest";
import { buildHomeAnalytics } from "../src/analytics";
import { storeSource } from "../src/server/arnold-source";
import { migrate } from "../src/server/db/migrate";
import { commitWrite } from "../src/server/plan/commit";
import {
  fingerprint,
  type EntityChange,
} from "../src/server/workout/infrastructure";
import type { ArnoldRun, ArnoldWorkout } from "../src/shared/arnold-schema-v1";
import { appDatabase, asOwner, newAccount } from "./fixtures/arnold-db.js";

const db = appDatabase();
afterAll(() => db.close());

type Account = Awaited<ReturnType<typeof newAccount>>;
const STAMP = "2026-11-20T18:00:00.000Z";

/** One completed outdoor run, stored through commitWrite (the write path). */
async function storeRun(
  account: Account,
  date: string,
  distance_m: number,
  timer_s: number,
) {
  const workout: ArnoldWorkout = {
    workout_id: randomUUID(),
    workout_date_local: date,
    timezone: "Europe/Berlin",
    started_at_utc: `${date}T17:00:00.000Z`,
    ended_at_utc: `${date}T18:00:00.000Z`,
    plan_version_id: null,
    session_id: null,
    session_name_snapshot: "Freier Lauf",
    status: "completed",
    source: "chat",
    notes: null,
    created_at_utc: STAMP,
    updated_at_utc: STAMP,
    row_revision: 1,
    activity_type: "run",
  };
  const run: ArnoldRun = {
    workout_id: workout.workout_id,
    run_type: "base",
    environment: "outdoor",
    prescription: null,
    rationale: null,
    rules_version: null,
    timer_s,
    elapsed_s: timer_s,
    distance_m,
    distance_source: "manual",
    ascent_m: null,
    descent_m: null,
    cadence_spm: null,
    calories_kcal: null,
    te_aerobic: null,
    te_anaerobic: null,
    rpe: null,
    splits_100m: null,
    pause_count: null,
    result_source: "chat",
    hr_status: "not_provided",
    hr_avg_bpm: null,
    hr_max_bpm: null,
    hr_zone_seconds: null,
    created_at_utc: STAMP,
    updated_at_utc: STAMP,
    row_revision: 1,
  };
  const changes: EntityChange[] = [
    { table: "workouts", before: null, after: workout },
    { table: "runs", before: null, after: run },
  ];
  const requestId = randomUUID();
  await commitWrite({
    trackerId: account.trackerId,
    store: account.store,
    requestId,
    fingerprint: fingerprint(["test_run_goals", requestId]),
    actorSubject: account.userId,
    clock: () => new Date(STAMP),
    build: () => ({
      changes,
      audit: [],
      result: { workout, sets: [], exercise: null, warnings: [] },
    }),
  });
  return workout.workout_id;
}

const createGoal = (account: Account, args: Record<string, unknown>) =>
  account.logging.execute("create_training_goal", {
    request_id: randomUUID(),
    ...args,
  });

describe("running goals in Postgres", () => {
  it("start from the stored runs, read back unchanged and reach the start screen", async () => {
    const alice = await newAccount(db);
    const fiveK = await storeRun(alice, "2026-11-10", 5000, 1580);
    const long = await storeRun(alice, "2026-11-15", 8400, 3000);

    const distance = await createGoal(alice, {
      kind: "run_distance",
      target_value: 10,
    });
    expect(distance.ok, JSON.stringify(distance.error)).toBe(true);
    expect(distance.result!.goal).toMatchObject({ start_value: 8.4 });
    expect(distance.result!.goal).not.toHaveProperty("run_distance_m");
    const time5 = await createGoal(alice, {
      kind: "run_time_for_distance",
      run_distance_m: 5000,
      target_value: 1500,
    });
    expect(time5.result!.goal).toMatchObject({
      run_distance_m: 5000,
      start_value: 1580,
    });
    const time10 = await createGoal(alice, {
      kind: "run_time_for_distance",
      run_distance_m: 10_000,
      target_value: 3300,
    });
    expect(time10.result!.goal).toMatchObject({ start_value: null });
    const twice = await createGoal(alice, {
      kind: "run_time_for_distance",
      run_distance_m: 5000,
      target_value: 1450,
    });
    expect(twice.error?.code).toBe("GOAL_EXISTS");

    const data = await alice.store.read();
    expect(data.goals).toEqual([
      distance.result!.goal,
      time5.result!.goal,
      time10.result!.goal,
    ]);

    // Through the store source: the dataset is strength-only, the runs travel
    // along for records and goals.
    const loaded = (
      await storeSource(alice.store, {
        synthetic: false,
        label: "Test",
        description: "Test",
      }).load()
    ).dataset;
    expect(loaded.runs).toEqual([]);
    const home = buildHomeAnalytics(loaded, { reference_date: "2026-11-20" });
    const records = Object.fromEntries(home.run_records.map((r) => [r.key, r]));
    expect(records.longest_distance).toMatchObject({
      value: 8400,
      workout_id: long,
    });
    expect(records.best_5k).toMatchObject({ value: 1580, workout_id: fiveK });
    expect(records.best_10k.value).toBeNull();
    const goals = Object.fromEntries(home.goals.map((g) => [g.goal_id, g]));
    expect(goals[distance.result!.goal!.goal_id]).toMatchObject({
      current_value: 8.4,
      unit: "km",
    });
    expect(goals[time5.result!.goal!.goal_id]).toMatchObject({
      current_value: 1580,
      unit: "s",
      achieved: false,
    });
    expect(goals[time10.result!.goal!.goal_id]).toMatchObject({
      current_value: null,
      progress: null,
    });
  });

  it("the database itself refuses a second active goal for a distance and a run goal with an exercise", async () => {
    const alice = await newAccount(db);
    const goal = await createGoal(alice, {
      kind: "run_time_for_distance",
      run_distance_m: 5000,
      target_value: 1500,
    });
    expect(goal.ok).toBe(true);
    const insert = (values: string) =>
      db.asUser(alice.userId, (c) =>
        c.query(
          `insert into arnold.goals (user_id, goal_id, kind, exercise_id, load_basis, target_value, start_value, status, created_at_utc, updated_at_utc, row_revision, run_distance_m)
           values ${values}`,
          [alice.userId, randomUUID(), STAMP],
        ),
      );
    await expect(
      insert(
        `($1, $2, 'run_time_for_distance', null, null, 1400, null, 'active', $3, $3, 1, 5000)`,
      ),
    ).rejects.toMatchObject({ code: "23505" });
    await expect(
      insert(
        `($1, $2, 'run_distance', 'bench-press', null, 10, null, 'active', $3, $3, 1, null)`,
      ),
    ).rejects.toMatchObject({ code: "23514" });
    await expect(
      insert(
        `($1, $2, 'run_distance', null, null, 10, null, 'active', $3, $3, 1, 5000)`,
      ),
    ).rejects.toMatchObject({ code: "23514" });
    await expect(
      insert(
        `($1, $2, 'run_time_for_distance', null, null, 3000, null, 'active', $3, $3, 1, null)`,
      ),
    ).rejects.toMatchObject({ code: "23514" });
  });

  it("only its owner sees a running goal", async () => {
    const alice = await newAccount(db);
    const bob = await newAccount(db);
    await createGoal(alice, { kind: "run_duration", target_value: 60 });
    const seen = await db.asUser(
      bob.userId,
      async (c) =>
        (
          await c.query(
            "select goal_id from arnold.goals where kind like 'run_%'",
          )
        ).rows,
    );
    expect(seen).toEqual([]);
    expect((await bob.store.read()).goals).toEqual([]);
  });
});

describe("rollback script 012 → 11 → 12", () => {
  it("removes running goals and their receipts, keeps the rest, and 012 applies again", async () => {
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
            where table_schema = 'arnold' and table_name = 'goals'`,
        )
      ).rows.map((r) => r.column_name as string);
    try {
      expect(await migrate(url.toString())).toEqual([
        1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12,
      ]);
      expect(await columns()).toContain("run_distance_m");
      const userId = `usr_${randomUUID()}`;
      await exec(
        "insert into arnold.users (user_id, tracker_id) values ($1, $2)",
        [userId, `trk_${randomUUID()}`],
      );
      await exec(
        `insert into arnold.goals (user_id, goal_id, kind, exercise_id, load_basis, target_value, start_value, status, created_at_utc, updated_at_utc, row_revision, run_distance_m)
         values ($1, 'g-bw', 'body_weight', null, null, 75, null, 'active', $2, $2, 1, null),
                ($1, 'g-5k', 'run_time_for_distance', null, null, 1500, null, 'active', $2, $2, 1, 5000),
                ($1, 'g-km', 'run_distance', null, null, 10, null, 'archived', $2, $2, 2, null)`,
        [userId, STAMP],
      );
      await exec(
        `insert into arnold.operations (user_id, request_id, fingerprint, actor, changes, result)
         values ($1, 'r-run', 'f', 'a', $2, '{}'), ($1, 'r-bw', 'f', 'a', $3, '{}')`,
        [
          userId,
          JSON.stringify([
            {
              table: "goals",
              before: null,
              after: { kind: "run_time_for_distance" },
            },
          ]),
          JSON.stringify([
            { table: "goals", before: null, after: { kind: "body_weight" } },
          ]),
        ],
      );
      const script = await readFile("db/rollback/012_down.sql", "utf8");
      await exec(script);
      expect(await columns()).not.toContain("run_distance_m");
      expect((await exec("select goal_id from arnold.goals")).rows).toEqual([
        { goal_id: "g-bw" },
      ]);
      expect(
        (await exec("select request_id from arnold.operations")).rows,
      ).toEqual([{ request_id: "r-bw" }]);
      expect(
        (
          await exec(
            "select max(version)::int as v from arnold.schema_migrations",
          )
        ).rows[0].v,
      ).toBe(11);
      // The old rules are back: a running goal no longer fits.
      await expect(
        exec(
          `insert into arnold.goals (user_id, goal_id, kind, exercise_id, load_basis, target_value, start_value, status, created_at_utc, updated_at_utc, row_revision)
           values ($1, 'g-x', 'run_distance', null, null, 10, null, 'active', $2, $2, 1)`,
          [userId, STAMP],
        ),
      ).rejects.toMatchObject({ code: "23514" });
      await expect(exec(script)).rejects.toThrow(/not applied/);
      expect(await migrate(url.toString())).toEqual([12]);
      expect(await columns()).toContain("run_distance_m");
    } finally {
      await asOwner((c) => c.query(`drop database ${name} with (force)`));
    }
  });
});
