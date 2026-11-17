/**
 * Migration 004 (running) against the real test Postgres: user separation,
 * references with user_id, heart rate only with consent, cascade on account
 * deletion, the store round trip of schema 1.1.0, and the rollback script
 * 4 → 3 → 4 on a database of its own.
 */
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import pg from "pg";
import { afterAll, describe, expect, inject, it } from "vitest";
import { migrate } from "../src/server/db/migrate";
import { commitWrite } from "../src/server/plan/commit";
import { fingerprint } from "../src/server/workout/infrastructure";
import type { EntityChange } from "../src/server/workout/infrastructure";
import type {
  ArnoldRun,
  ArnoldRunSegment,
  ArnoldWorkout,
} from "../src/shared/arnold-schema-v1";
import {
  appDatabase,
  asOwner,
  logOneSet,
  newAccount,
} from "./fixtures/arnold-db.js";

const db = appDatabase();
afterAll(() => db.close());

type Account = Awaited<ReturnType<typeof newAccount>>;
const STAMP = "2026-11-13T18:00:00.000Z";
const RUN_TABLES = [
  "run_profiles",
  "plan_run_sessions",
  "runs",
  "run_segments",
  "run_hr_zones",
];

function runWorkout(status: "planned" | "completed"): ArnoldWorkout {
  return {
    workout_id: randomUUID(),
    workout_date_local: "2026-11-13",
    timezone: "Europe/Berlin",
    started_at_utc: status === "completed" ? "2026-11-13T17:00:00.000Z" : null,
    ended_at_utc: status === "completed" ? "2026-11-13T17:47:00.000Z" : null,
    plan_version_id: null,
    session_id: null,
    session_name_snapshot: "Grundlage Zone 2",
    status,
    source: status === "completed" ? "sync" : "chat",
    notes: null,
    created_at_utc: STAMP,
    updated_at_utc: STAMP,
    row_revision: 1,
    activity_type: "run",
  };
}

function runRow(workout: ArnoldWorkout, heartRate: boolean): ArnoldRun {
  const done = workout.status === "completed";
  return {
    workout_id: workout.workout_id,
    run_type: "base",
    environment: "outdoor",
    prescription: {
      k: 1,
      n: "Grundlage Zone 2",
      e: 0,
      s: [[1, 1, 2700, 1, 1, 2]],
      a: { hi: [20, 3, 300, 60] },
      h: "Locker laufen, Gespräch möglich.",
      r: 3,
    },
    rationale: "Grundlage für die Woche.",
    rules_version: "run-rules-test",
    timer_s: done ? 2700 : null,
    elapsed_s: done ? 2820 : null,
    distance_m: done ? 7420 : null,
    distance_source: done ? "gps" : null,
    ascent_m: done ? 41 : null,
    descent_m: done ? 39 : null,
    cadence_spm: done ? 168 : null,
    calories_kcal: done ? 512 : null,
    te_aerobic: done ? 2.8 : null,
    te_anaerobic: done ? 0.4 : null,
    rpe: done ? 3 : null,
    splits_100m: done
      ? Array.from({ length: 74 }, (_, i) => (i + 1) * 36)
      : null,
    pause_count: done ? 1 : null,
    result_source: done ? "watch" : null,
    hr_status: !done ? null : heartRate ? "recorded" : "no_consent",
    hr_avg_bpm: heartRate ? 141 : null,
    hr_max_bpm: heartRate ? 156 : null,
    hr_zone_seconds: heartRate ? [300, 2100, 300, 0, 0] : null,
    created_at_utc: STAMP,
    updated_at_utc: STAMP,
    row_revision: 1,
  };
}

function segmentRow(workoutId: string, heartRate: boolean): ArnoldRunSegment {
  return {
    run_segment_id: randomUUID(),
    workout_id: workoutId,
    segment_index: 0,
    repetition: null,
    kind: "work",
    planned_duration_type: "seconds",
    planned_duration_value: 2700,
    target_type: "hr_zone",
    target_low: 1,
    target_high: 2,
    timer_s: 2700,
    distance_m: 7420,
    time_in_target_s: 2410,
    status: "completed",
    hr_avg_bpm: heartRate ? 141 : null,
    hr_max_bpm: heartRate ? 156 : null,
    created_at_utc: STAMP,
    updated_at_utc: STAMP,
    row_revision: 1,
  };
}

/** Stores rows through commitWrite, the one write path. */
async function write(account: Account, changes: EntityChange[]) {
  const requestId = randomUUID();
  const workout = changes.find((c) => c.table === "workouts")?.after ?? null;
  return commitWrite({
    trackerId: account.trackerId,
    store: account.store,
    requestId,
    fingerprint: fingerprint(["test_run", requestId]),
    actorSubject: account.userId,
    clock: () => new Date(STAMP),
    build: () => ({
      changes,
      audit: [],
      result: {
        workout: workout as ArnoldWorkout | null,
        sets: [],
        exercise: null,
        warnings: [],
      },
    }),
  });
}

async function storeRun(
  account: Account,
  status: "planned" | "completed" = "completed",
  heartRate = false,
) {
  const workout = runWorkout(status);
  const run = runRow(workout, heartRate);
  const changes: EntityChange[] = [
    { table: "workouts", before: null, after: workout },
    { table: "runs", before: null, after: run },
  ];
  const segment =
    status === "completed" ? segmentRow(workout.workout_id, heartRate) : null;
  if (segment)
    changes.push({ table: "runSegments", before: null, after: segment });
  await write(account, changes);
  return { workout, run, segment };
}

const grantConsent = (account: Account) =>
  db.asUser(account.userId, (c) =>
    c.query(
      `insert into arnold.health_consents (user_id, scope, text_version, granted_at)
       values ($1, 'garmin_health', 'test', now())`,
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

describe("schema 1.1.0 in the store", () => {
  it("stores planned and completed runs through commitWrite and reads them back unchanged", async () => {
    const alice = await newAccount(db);
    const planned = await storeRun(alice, "planned");
    const done = await storeRun(alice, "completed");
    const data = await alice.store.read();
    expect(data.workouts.map((w) => w.activity_type)).toEqual(["run", "run"]);
    expect(data.runs).toEqual([planned.run, done.run]);
    expect(data.runSegments).toEqual([done.segment]);
    // A strength workout still reads back without activity_type.
    await logOneSet(alice);
    const strength = (await alice.store.read()).workouts.at(-1)!;
    expect("activity_type" in strength).toBe(false);
    expect(
      await asOwner(
        async (c) =>
          (
            await c.query(
              "select activity_type from arnold.workouts where user_id = $1 and workout_id = $2",
              [alice.userId, strength.workout_id],
            )
          ).rows[0].activity_type,
      ),
    ).toBe("strength");
  });

  it("refuses sets on a run and a run that is in progress", async () => {
    const alice = await newAccount(db);
    const { workout } = await storeRun(alice);
    await expect(
      db.asUser(alice.userId, (c) =>
        c.query(
          `insert into arnold.workouts (user_id, workout_id, workout_date_local, timezone, status, source, created_at_utc, updated_at_utc, row_revision, activity_type)
           values ($1, $2, '2026-11-13', 'Europe/Berlin', 'in_progress', 'chat', $3, $3, 1, 'run')`,
          [alice.userId, randomUUID(), STAMP],
        ),
      ),
    ).rejects.toMatchObject({ code: "23514" });
    const strengthStart = await alice.logging.execute("log_workout_sets", {
      request_id: randomUUID(),
      workout_id: workout.workout_id,
      sets: [
        {
          exercise_id: "bench-press",
          set_type: "working",
          reps: 10,
          reps_basis: "total",
          load_kg: 60,
          load_basis: "total",
          implement_count: 1,
          execution_mode: "bilateral_simultaneous",
          side: "both",
        },
      ],
    });
    expect(strengthStart.ok).toBe(false);
    expect((await alice.store.read()).sets).toHaveLength(0);
  });
});

describe("row level security on the running tables", () => {
  it("shows another user nothing, not even without a where clause", async () => {
    const alice = await newAccount(db);
    const bob = await newAccount(db);
    await grantConsent(alice);
    await storeRun(alice, "completed", true);
    await db.asUser(alice.userId, (c) =>
      c.query(
        `insert into arnold.run_hr_zones (user_id, zones_id, sport, bounds, recorded_at_utc)
         values ($1, 'z1', 'running', '{98,118,137,157,176,196}', $2)`,
        [alice.userId, STAMP],
      ),
    );
    for (const table of RUN_TABLES) {
      const seen = await db.asUser(bob.userId, (c) =>
        c.query(`select * from arnold.${table}`),
      );
      expect(seen.rowCount, table).toBe(0);
      const none = await db.query(`select * from arnold.${table}`);
      expect(none.rowCount, `${table} without user`).toBe(0);
    }
    const bobData = await bob.store.read();
    expect(bobData.runs).toEqual([]);
    expect(bobData.runSegments).toEqual([]);
    expect(await count(alice.userId, "run_segments")).toBe(1);
  });

  it("refuses rows for another user and references across users", async () => {
    const alice = await newAccount(db);
    const bob = await newAccount(db);
    const { workout } = await storeRun(alice);
    // A row with Alice's user_id written in Bob's context: policy violation.
    await expect(
      db.asUser(bob.userId, (c) =>
        c.query(
          `insert into arnold.run_profiles (user_id, run_profile_id, goal, runs_per_week, preferred_environment, created_at_utc, updated_at_utc, row_revision)
           values ($1, 'rp', 'fitness', 3, 'outdoor', $2, $2, 1)`,
          [alice.userId, STAMP],
        ),
      ),
    ).rejects.toMatchObject({ code: "42501" });
    // Bob's own row pointing at Alice's run: the reference includes user_id.
    await expect(
      db.asUser(bob.userId, (c) =>
        c.query(
          `insert into arnold.run_segments (user_id, run_segment_id, workout_id, segment_index, kind, timer_s, distance_m, status, created_at_utc, updated_at_utc, row_revision)
           values ($1, 's', $2, 0, 'lap', 300, 1000, 'completed', $3, $3, 1)`,
          [bob.userId, workout.workout_id, STAMP],
        ),
      ),
    ).rejects.toMatchObject({ code: "23503" });
    await expect(
      db.asUser(bob.userId, (c) =>
        c.query(
          `insert into arnold.runs (user_id, workout_id, run_type, environment, created_at_utc, updated_at_utc, row_revision)
           values ($1, $2, 'base', 'outdoor', $3, $3, 1)`,
          [bob.userId, workout.workout_id, STAMP],
        ),
      ),
    ).rejects.toMatchObject({ code: "23503" });
    const plan = await asOwner(
      async (c) =>
        (
          await c.query(
            "select plan_version_id from arnold.plan_versions where user_id = $1 limit 1",
            [alice.userId],
          )
        ).rows[0]?.plan_version_id ?? "pv-none",
    );
    await expect(
      db.asUser(bob.userId, (c) =>
        c.query(
          `insert into arnold.plan_run_sessions (user_id, plan_run_session_id, plan_version_id, session_id, session_order, session_name, run_type, template, status, row_revision)
           values ($1, 'prs', $2, 's', 1, 'Lauf', 'base', '{"level":0}', 'active', 1)`,
          [bob.userId, plan],
        ),
      ),
    ).rejects.toMatchObject({ code: "23503" });
  });

  it("lets a run belong only to a workout of activity_type run", async () => {
    const alice = await newAccount(db);
    const strengthId = await logOneSet(alice);
    await expect(
      db.asUser(alice.userId, (c) =>
        c.query(
          `insert into arnold.runs (user_id, workout_id, run_type, environment, created_at_utc, updated_at_utc, row_revision)
           values ($1, $2, 'base', 'outdoor', $3, $3, 1)`,
          [alice.userId, strengthId, STAMP],
        ),
      ),
    ).rejects.toMatchObject({ code: "23503" });
  });

  it("gives the server role no DELETE except on heart-rate zones", async () => {
    const alice = await newAccount(db);
    await storeRun(alice);
    for (const table of [
      "run_profiles",
      "plan_run_sessions",
      "runs",
      "run_segments",
    ]) {
      await expect(
        db.asUser(alice.userId, (c) => c.query(`delete from arnold.${table}`)),
        table,
      ).rejects.toMatchObject({ code: "42501" });
      await expect(
        db.asUser(alice.userId, (c) => c.query(`truncate arnold.${table}`)),
        table,
      ).rejects.toMatchObject({ code: "42501" });
    }
    await expect(
      db.asUser(alice.userId, (c) =>
        c.query("delete from arnold.run_hr_zones"),
      ),
    ).resolves.toBeDefined();
    await expect(
      db.asUser(alice.userId, (c) =>
        c.query("update arnold.run_hr_zones set sport = 'generic'"),
      ),
    ).rejects.toMatchObject({ code: "42501" });
  });
});

describe("heart rate only with consent (D-RUN-07)", () => {
  it("refuses heart-rate values and zone bounds without an active consent", async () => {
    const alice = await newAccount(db);
    await expect(storeRun(alice, "completed", true)).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
    expect(await count(alice.userId, "runs")).toBe(0);
    await expect(
      db.asUser(alice.userId, (c) =>
        c.query(
          `insert into arnold.run_hr_zones (user_id, zones_id, sport, bounds, recorded_at_utc)
           values ($1, 'z1', 'running', '{98,118,137,157,176,196}', $2)`,
          [alice.userId, STAMP],
        ),
      ),
    ).rejects.toMatchObject({ code: "23514" });
    // Without heart rate the run is stored, with its reason.
    const { run } = await storeRun(alice, "completed", false);
    expect(run.hr_status).toBe("no_consent");
    expect(await count(alice.userId, "runs")).toBe(1);
  });

  it("refuses values without their reason, and zone bounds that do not ascend", async () => {
    const alice = await newAccount(db);
    await grantConsent(alice);
    const { workout } = await storeRun(alice);
    await expect(
      db.asUser(alice.userId, (c) =>
        c.query(
          "update arnold.runs set hr_avg_bpm = 140, hr_max_bpm = 150 where workout_id = $1",
          [workout.workout_id],
        ),
      ),
    ).rejects.toMatchObject({ code: "23514" });
    await expect(
      db.asUser(alice.userId, (c) =>
        c.query(
          `insert into arnold.run_hr_zones (user_id, zones_id, sport, bounds, recorded_at_utc)
           values ($1, 'z1', 'running', '{98,118,118,157,176,196}', $2)`,
          [alice.userId, STAMP],
        ),
      ),
    ).rejects.toMatchObject({ code: "23514" });
  });

  it("erases heart rate of runs on revocation and keeps the rest of the run", async () => {
    const alice = await newAccount(db);
    const bob = await newAccount(db);
    await grantConsent(alice);
    await grantConsent(bob);
    const { workout } = await storeRun(alice, "completed", true);
    await storeRun(bob, "completed", true);
    await db.asUser(alice.userId, (c) =>
      c.query(
        `insert into arnold.run_hr_zones (user_id, zones_id, sport, bounds, recorded_at_utc, workout_id)
         values ($1, 'z1', 'running', '{98,118,137,157,176,196}', $2, $3)`,
        [alice.userId, STAMP, workout.workout_id],
      ),
    );
    const erased = await db.asUser(alice.userId, async (c) => {
      await c.query(
        "update arnold.health_consents set revoked_at = now() where user_id = $1",
        [alice.userId],
      );
      return (
        await c.query<{ n: number }>("select arnold.erase_run_health() as n")
      ).rows[0].n;
    });
    expect(erased).toBe(3); // zones, run, segment
    const data = await alice.store.read();
    expect(data.runs[0]).toMatchObject({
      hr_status: "consent_revoked",
      hr_avg_bpm: null,
      hr_max_bpm: null,
      hr_zone_seconds: null,
      row_revision: 2,
      distance_m: 7420,
    });
    expect(data.runSegments[0]).toMatchObject({
      hr_avg_bpm: null,
      row_revision: 2,
    });
    expect(await count(alice.userId, "run_hr_zones")).toBe(0);
    // Bob's values are untouched.
    expect((await bob.store.read()).runs[0].hr_avg_bpm).toBe(141);
    await expect(
      db.query("select arnold.erase_run_health()"),
    ).rejects.toMatchObject({ code: "42501" });
  });
});

describe("account deletion", () => {
  it("removes every running row of the account and nothing of anyone else", async () => {
    const alice = await newAccount(db);
    const bob = await newAccount(db);
    await grantConsent(alice);
    await storeRun(alice, "planned");
    await storeRun(alice, "completed", true);
    await storeRun(bob);
    await db.asUser(alice.userId, (c) =>
      c.query(
        `insert into arnold.run_hr_zones (user_id, zones_id, sport, bounds, recorded_at_utc)
         values ($1, 'z1', 'running', '{98,118,137,157,176,196}', $2)`,
        [alice.userId, STAMP],
      ),
    );
    await write(alice, [
      {
        table: "runProfiles",
        before: null,
        after: {
          run_profile_id: randomUUID(),
          goal: "10k",
          race_date: "2027-02-15",
          target_time_s: 3000,
          reference_distance_m: 5000,
          reference_time_s: 1500,
          reference_date: "2026-11-01",
          reference_source: "race",
          running_experience_months: 24,
          runs_per_week: 3,
          long_run_weekday: 7,
          preferred_environment: "outdoor",
          base_minutes_per_week: 120,
          longest_run_4w_min: 70,
          alarm_settings: { hr: true, pace: true, km_split: true },
          created_at_utc: STAMP,
          updated_at_utc: STAMP,
          row_revision: 1,
        },
      },
    ]);
    expect((await alice.store.read()).runProfiles).toHaveLength(1);
    expect(await alice.identities.remove(alice.userId)).toBe(true);
    for (const table of [...RUN_TABLES, "workouts"])
      expect(await count(alice.userId, table), table).toBe(0);
    expect((await bob.store.read()).runs).toHaveLength(1);
  });
});

describe("rollback script 004 → 3 → 4", () => {
  it("brings the schema back to version 3 and migration 004 applies again", async () => {
    const admin = new URL(inject("databaseAdminUrl"));
    const name = `arnold_rollback_${randomUUID().replaceAll("-", "")}`;
    await asOwner((c) => c.query(`create database ${name}`));
    const url = new URL(admin);
    url.pathname = `/${name}`;
    const connect = async () => {
      const client = new pg.Client({ connectionString: url.toString() });
      await client.connect();
      return client;
    };
    const userId = `usr_${randomUUID()}`;
    const exec = async (sql: string, values: unknown[] = []) => {
      const client = await connect();
      try {
        return await client.query(sql, values);
      } finally {
        await client.end();
      }
    };
    const columns = async () =>
      (
        await exec(
          `select table_name from information_schema.tables where table_schema = 'arnold' order by 1`,
        )
      ).rows.map((r) => r.table_name as string);
    try {
      expect(await migrate(url.toString())).toEqual([1, 2, 3, 4, 5, 6]);
      // 005 and 006 sit on top of 004 and are undone first (db/rollback).
      const LATER = [
        "health_daily",
        "health_daily_sync",
        "watch_plan_receipts",
      ];
      const before3 = (await columns()).filter(
        (t) => !RUN_TABLES.includes(t) && !LATER.includes(t),
      );
      // Data on both sides of the line: a strength workout stays, a run goes.
      await exec("insert into arnold.users (user_id) values ($1)", [userId]);
      const strength = randomUUID();
      const run = randomUUID();
      for (const [id, type] of [
        [strength, "strength"],
        [run, "run"],
      ])
        await exec(
          `insert into arnold.workouts (user_id, workout_id, workout_date_local, timezone, status, source, created_at_utc, updated_at_utc, row_revision, activity_type)
           values ($1, $2, '2026-11-13', 'Europe/Berlin', 'completed', 'chat', $3, $3, 1, $4)`,
          [userId, id, STAMP, type],
        );
      await exec(
        `insert into arnold.runs (user_id, workout_id, run_type, environment, created_at_utc, updated_at_utc, row_revision)
         values ($1, $2, 'base', 'outdoor', $3, $3, 1)`,
        [userId, run, STAMP],
      );
      await exec(
        `insert into arnold.operations (user_id, request_id, fingerprint, actor, changes, result)
         values ($1, 'r-run', 'f', 'a', $2, '{}'), ($1, 'r-strength', 'f', 'a', $3, '{}')`,
        [
          userId,
          JSON.stringify([{ table: "runs", before: null, after: {} }]),
          JSON.stringify([{ table: "workouts", before: null, after: {} }]),
        ],
      );

      await exec(await readFile("db/rollback/006_down.sql", "utf8"));
      await exec(await readFile("db/rollback/005_down.sql", "utf8"));
      await exec(await readFile("db/rollback/004_down.sql", "utf8"));

      expect(
        (
          await exec(
            "select max(version)::int as v from arnold.schema_migrations",
          )
        ).rows[0].v,
      ).toBe(3);
      expect(await columns()).toEqual(before3);
      const workoutColumns = (
        await exec(
          `select column_name from information_schema.columns where table_schema = 'arnold' and table_name = 'workouts'`,
        )
      ).rows.map((r) => r.column_name);
      expect(workoutColumns).not.toContain("activity_type");
      expect(
        (await exec("select workout_id from arnold.workouts")).rows.map(
          (r) => r.workout_id,
        ),
      ).toEqual([strength]);
      expect(
        (await exec("select request_id from arnold.operations")).rows.map(
          (r) => r.request_id,
        ),
      ).toEqual(["r-strength"]);
      expect(
        (
          await exec(
            "select count(*)::int as n from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'arnold' and p.proname in ('erase_run_health', 'require_health_consent')",
          )
        ).rows[0].n,
      ).toBe(0);
      // A second run of the script refuses instead of half-applying.
      await expect(
        exec(await readFile("db/rollback/004_down.sql", "utf8")),
      ).rejects.toThrow(/not applied/);

      expect(await migrate(url.toString())).toEqual([4, 5, 6]);
      expect(
        (await exec("select activity_type from arnold.workouts")).rows,
      ).toEqual([{ activity_type: "strength" }]);
      expect(
        (await columns()).filter((t) => RUN_TABLES.includes(t)).sort(),
      ).toEqual([...RUN_TABLES].sort());
    } finally {
      await asOwner((c) => c.query(`drop database ${name} with (force)`));
    }
  });
});
