/**
 * Migration 009 (mobility) against the real test Postgres: every check of the
 * three new tables, user separation, cascade on account deletion, the store
 * round trip of schema 1.2.0 through commitWrite, and the rollback script
 * 9 → 8 → 9 on a database of its own with strength and running data that
 * neither direction may touch.
 */
import { randomBytes, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import pg from "pg";
import { afterAll, describe, expect, inject, it } from "vitest";
import { Database } from "../src/server/db/database";
import { migrate } from "../src/server/db/migrate";
import { commitWrite } from "../src/server/plan/commit";
import { fingerprint } from "../src/server/workout/infrastructure";
import type { EntityChange } from "../src/server/workout/infrastructure";
import type {
  ArnoldMobilityProfile,
  ArnoldMobilityResult,
  ArnoldPlanMobilitySession,
  ArnoldPlanVersion,
  ArnoldRun,
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
const STAMP = "2026-11-22T06:00:00.000Z";
const MOBILITY_TABLES = [
  "mobility_profiles",
  "plan_mobility_sessions",
  "mobility_results",
];
const technical = {
  created_at_utc: STAMP,
  updated_at_utc: STAMP,
  row_revision: 1,
};

const template = {
  catalog_version: "mob-1",
  rules_version: "mob-timing-1",
  exercise_ids: ["mob_neck_rolls", "mob_shoulder_circles"],
  items: [
    {
      exercise_id: "mob_neck_rolls",
      sides: 1,
      seconds_per_side: 45,
      reps: null,
    },
    {
      exercise_id: "mob_shoulder_circles",
      sides: 1,
      seconds_per_side: 45,
      reps: null,
    },
  ],
  total_s: 95,
} as const;

const resultItems = [
  { c: "mob_neck_rolls", st: "done", t: 45 },
  { c: "mob_shoulder_circles", st: "done", t: 45 },
] as const;

/* ---------------------------------------------------------------- rows */

function draftPlan(): ArnoldPlanVersion {
  return {
    plan_version_id: `pv-${randomUUID()}`,
    plan_family_id: `pf-${randomUUID()}`,
    version_no: 1,
    name: "Testplan",
    split_key: null,
    status: "draft",
    goal_key: null,
    days_per_week: 3,
    activated_at_utc: null,
    retired_at_utc: null,
    ...technical,
  };
}

function profileRow(
  over: Partial<ArnoldMobilityProfile> = {},
): ArnoldMobilityProfile {
  return {
    mobility_profile_id: randomUUID(),
    wants: true,
    morning_weekdays: [1, 3, 5],
    morning_minutes: 10,
    sessions_placement: "own_days",
    sessions_per_week: 1,
    sessions_minutes: 20,
    stiff_areas: ["hips", "upper_back"],
    ...technical,
    ...over,
  };
}

function sessionRow(
  planVersionId: string,
  over: Partial<ArnoldPlanMobilitySession> = {},
): ArnoldPlanMobilitySession {
  return {
    plan_mobility_session_id: randomUUID(),
    plan_version_id: planVersionId,
    session_id: `sess-mob-${randomUUID()}`,
    session_name: "Morgenroutine",
    session_order: 10,
    kind: "morning",
    placement: "own_day",
    weekdays: [1, 3, 5],
    after_session_id: null,
    minutes: 10,
    template,
    status: "active",
    row_revision: 1,
    ...over,
  } as ArnoldPlanMobilitySession;
}

function mobilityWorkout(over: Partial<ArnoldWorkout> = {}): ArnoldWorkout {
  return {
    workout_id: randomUUID(),
    workout_date_local: "2026-11-22",
    timezone: "Europe/Berlin",
    started_at_utc: "2026-11-22T06:30:00.000Z",
    ended_at_utc: "2026-11-22T06:40:00.000Z",
    plan_version_id: null,
    session_id: null,
    session_name_snapshot: "Morgenroutine",
    status: "completed",
    source: "sync",
    notes: null,
    ...technical,
    activity_type: "mobility",
    ...over,
  };
}

function resultRow(
  workout: ArnoldWorkout,
  over: Partial<ArnoldMobilityResult> = {},
): ArnoldMobilityResult {
  return {
    workout_id: workout.workout_id,
    activity_type: "mobility",
    kind: "morning",
    plan_version_id: workout.plan_version_id,
    session_id: workout.session_id,
    minutes_planned: 10,
    timer_s: 540,
    elapsed_s: 600,
    exercises_total: 2,
    exercises_done: 2,
    exercises_skipped: 0,
    ended_early: false,
    items: resultItems,
    result_source: "watch",
    catalog_version: "mob-1",
    rules_version: "mob-timing-1",
    ...technical,
    ...over,
  } as ArnoldMobilityResult;
}

function runWorkout(): { workout: ArnoldWorkout; run: ArnoldRun } {
  const workout: ArnoldWorkout = {
    workout_id: randomUUID(),
    workout_date_local: "2026-11-21",
    timezone: "Europe/Berlin",
    started_at_utc: "2026-11-21T17:00:00.000Z",
    ended_at_utc: "2026-11-21T17:45:00.000Z",
    plan_version_id: null,
    session_id: null,
    session_name_snapshot: "Grundlage",
    status: "completed",
    source: "chat",
    notes: null,
    ...technical,
    activity_type: "run",
  };
  const run: ArnoldRun = {
    workout_id: workout.workout_id,
    run_type: "base",
    environment: "outdoor",
    prescription: null,
    rationale: null,
    rules_version: null,
    timer_s: 2700,
    elapsed_s: 2700,
    distance_m: 7000,
    distance_source: "manual",
    ascent_m: null,
    descent_m: null,
    cadence_spm: null,
    calories_kcal: null,
    te_aerobic: null,
    te_anaerobic: null,
    rpe: 3,
    splits_100m: null,
    pause_count: null,
    result_source: "chat",
    hr_status: "not_provided",
    hr_avg_bpm: null,
    hr_max_bpm: null,
    hr_zone_seconds: null,
    ...technical,
  };
  return { workout, run };
}

/* ------------------------------------------------------------- helpers */

/** Stores rows through commitWrite, the one write path. */
async function write(account: Account, changes: EntityChange[]) {
  const requestId = randomUUID();
  const workout = changes.find((c) => c.table === "workouts")?.after ?? null;
  return commitWrite({
    trackerId: account.trackerId,
    store: account.store,
    requestId,
    fingerprint: fingerprint(["test_mobility", requestId]),
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

/** A draft plan with a morning routine, stored through commitWrite. */
async function storePlan(account: Account) {
  const plan = draftPlan();
  const morning = sessionRow(plan.plan_version_id);
  await write(account, [
    { table: "plans", before: null, after: plan },
    { table: "planMobilitySessions", before: null, after: morning },
  ]);
  return { plan, morning };
}

/** A done mobility routine with its result, stored through commitWrite. */
async function storeRoutine(
  account: Account,
  over: Partial<ArnoldMobilityResult> = {},
  workoutOver: Partial<ArnoldWorkout> = {},
) {
  const workout = mobilityWorkout(workoutOver);
  const result = resultRow(workout, over);
  await write(account, [
    { table: "workouts", before: null, after: workout },
    { table: "mobilityResults", before: null, after: result },
  ]);
  return { workout, result };
}

const JSON_COLUMNS = new Set(["template", "items"]);
/** A raw insert in the user's context, past the Zod schema: only the database checks. */
function insertRow(
  database: Database,
  userId: string,
  table: string,
  row: Record<string, unknown>,
) {
  const keys = Object.keys(row);
  return database.asUser(userId, (c) =>
    c.query(
      `insert into arnold.${table} (user_id, ${keys.join(", ")}) values ($1, ${keys
        .map((_, i) => `$${i + 2}`)
        .join(", ")})`,
      [
        userId,
        ...keys.map((k) =>
          JSON_COLUMNS.has(k) && row[k] !== null
            ? JSON.stringify(row[k])
            : row[k],
        ),
      ],
    ),
  );
}

const rejectsWith = async (work: Promise<unknown>, code: string) =>
  expect(work).rejects.toMatchObject({ code });

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

/** A plan version inserted directly, for the raw check tests. */
async function rawPlan(userId: string) {
  const plan = draftPlan();
  await insertRow(db, userId, "plan_versions", { ...plan });
  return plan.plan_version_id;
}

/** A completed workout inserted directly. */
async function rawWorkout(
  userId: string,
  activityType: "strength" | "run" | "mobility",
  status = "completed",
) {
  const id = randomUUID();
  await insertRow(db, userId, "workouts", {
    workout_id: id,
    workout_date_local: "2026-11-22",
    timezone: "Europe/Berlin",
    status,
    source: "chat",
    ...technical,
    activity_type: activityType,
  });
  return id;
}

const rawResult = (
  userId: string,
  workoutId: string,
  over: Record<string, unknown> = {},
) =>
  insertRow(db, userId, "mobility_results", {
    workout_id: workoutId,
    kind: "session",
    exercises_total: 2,
    exercises_done: 2,
    exercises_skipped: 0,
    items: resultItems,
    result_source: "chat",
    catalog_version: "mob-1",
    rules_version: "mob-timing-1",
    ...technical,
    ...over,
  });

/** The profile as raw columns (snake_case, like the row). */
const rawProfile = (userId: string, over: Record<string, unknown> = {}) =>
  insertRow(db, userId, "mobility_profiles", {
    ...profileRow(),
    ...over,
  });

const rawSession = (
  userId: string,
  planVersionId: string,
  over: Record<string, unknown> = {},
) =>
  insertRow(db, userId, "plan_mobility_sessions", {
    ...sessionRow(planVersionId),
    ...over,
  });

/* --------------------------------------------------------------- tests */

describe("migration 009 in the schema", () => {
  it("replaces the activity_type check by name and adds the mobility checks", async () => {
    const rows = await asOwner(
      async (c) =>
        (
          await c.query<{ conname: string; def: string }>(
            `select conname, pg_get_constraintdef(oid) as def
               from pg_constraint
              where conrelid = 'arnold.workouts'::regclass
                and conname in ('workouts_activity_type_check', 'workouts_mobility_not_in_progress')
              order by conname`,
          )
        ).rows,
    );
    expect(rows.map((r) => r.conname)).toEqual([
      "workouts_activity_type_check",
      "workouts_mobility_not_in_progress",
    ]);
    expect(rows[0].def).toContain("mobility");
    for (const table of MOBILITY_TABLES) {
      const security = await asOwner(
        async (c) =>
          (
            await c.query<{ rls: boolean; policies: string[] }>(
              `select c.relrowsecurity as rls,
                      array(select polname::text from pg_policy p where p.polrelid = c.oid) as policies
                 from pg_class c where c.oid = $1::regclass`,
              [`arnold.${table}`],
            )
          ).rows[0],
      );
      expect(security, table).toEqual({ rls: true, policies: ["own_rows"] });
      const grants = await asOwner(async (c) =>
        (
          await c.query<{ privilege_type: string }>(
            `select privilege_type from information_schema.role_table_grants
                where grantee = 'arnold_app' and table_schema = 'arnold' and table_name = $1
                order by 1`,
            [table],
          )
        ).rows.map((r) => r.privilege_type),
      );
      expect(grants, table).toEqual(["INSERT", "SELECT", "UPDATE"]);
    }
  });
});

describe("mobility profile checks", () => {
  it("allows a profile without wish only without details and stiff areas", async () => {
    const alice = await newAccount(db);
    const none = {
      wants: false,
      morning_weekdays: null,
      morning_minutes: null,
      sessions_placement: null,
      sessions_per_week: null,
      sessions_minutes: null,
      stiff_areas: [],
    };
    await rejectsWith(
      rawProfile(alice.userId, {
        ...none,
        morning_weekdays: [1],
        morning_minutes: 5,
      }),
      "23514",
    );
    await rejectsWith(
      rawProfile(alice.userId, {
        ...none,
        sessions_placement: "own_days",
        sessions_per_week: 1,
        sessions_minutes: 15,
      }),
      "23514",
    );
    await rejectsWith(
      rawProfile(alice.userId, { ...none, stiff_areas: ["neck"] }),
      "23514",
    );
    await expect(rawProfile(alice.userId, none)).resolves.toBeDefined();
  });

  it("sets the morning and the session columns only together, and a wish needs one of them", async () => {
    const alice = await newAccount(db);
    await rejectsWith(
      rawProfile(alice.userId, { morning_minutes: null }),
      "23514",
    );
    await rejectsWith(
      rawProfile(alice.userId, { morning_weekdays: null }),
      "23514",
    );
    await rejectsWith(
      rawProfile(alice.userId, { sessions_per_week: null }),
      "23514",
    );
    await rejectsWith(
      rawProfile(alice.userId, {
        sessions_placement: null,
        sessions_minutes: null,
      }),
      "23514",
    );
    await rejectsWith(
      rawProfile(alice.userId, {
        morning_weekdays: null,
        morning_minutes: null,
        sessions_placement: null,
        sessions_per_week: null,
        sessions_minutes: null,
      }),
      "23514",
    );
    // Morning only and sessions only are both a valid wish.
    await expect(
      rawProfile(alice.userId, {
        sessions_placement: null,
        sessions_per_week: null,
        sessions_minutes: null,
      }),
    ).resolves.toBeDefined();
    // One profile per user.
    await rejectsWith(
      rawProfile(alice.userId, {
        morning_weekdays: null,
        morning_minutes: null,
      }),
      "23505",
    );
  });

  it("refuses values outside the allowed sets", async () => {
    const alice = await newAccount(db);
    for (const over of [
      { morning_minutes: 7 },
      { morning_weekdays: [] },
      { morning_weekdays: [0] },
      { morning_weekdays: [8] },
      { morning_weekdays: [1, 2, 3, 4, 5, 6, 7, 1] },
      { sessions_minutes: 25 },
      { sessions_per_week: 4 },
      { sessions_placement: "evening" },
      { stiff_areas: ["knees"] },
      { row_revision: 0 },
    ])
      await rejectsWith(rawProfile(alice.userId, over), "23514");
    expect(await count(alice.userId, "mobility_profiles")).toBe(0);
  });
});

describe("plan mobility session checks", () => {
  it("holds the shape of a morning routine", async () => {
    const alice = await newAccount(db);
    const plan = await rawPlan(alice.userId);
    for (const over of [
      { minutes: 20 },
      { weekdays: [] },
      { weekdays: [1, 2, 3, 4, 5, 6, 7, 1] },
      { weekdays: [9] },
      { placement: "after_strength", weekdays: [], after_session_id: "s1" },
      { after_session_id: "sess-a" },
      { kind: "evening" },
    ])
      await rejectsWith(rawSession(alice.userId, plan, over), "23514");
    await expect(rawSession(alice.userId, plan)).resolves.toBeDefined();
  });

  it("holds the shape of a session on its own day and after strength", async () => {
    const alice = await newAccount(db);
    const plan = await rawPlan(alice.userId);
    const session = { kind: "session", minutes: 20, weekdays: [2] };
    for (const over of [
      { ...session, minutes: 10 },
      { ...session, weekdays: [2, 4] },
      { ...session, weekdays: [] },
      { ...session, after_session_id: "sess-a" },
    ])
      await rejectsWith(rawSession(alice.userId, plan, over), "23514");
    await expect(
      rawSession(alice.userId, plan, session),
    ).resolves.toBeDefined();
    const after = {
      kind: "session",
      minutes: 15,
      placement: "after_strength",
      weekdays: [],
      after_session_id: "sess-a",
    };
    await rejectsWith(
      rawSession(alice.userId, plan, { ...after, after_session_id: null }),
      "23514",
    );
    await rejectsWith(
      rawSession(alice.userId, plan, { ...after, weekdays: [3] }),
      "23514",
    );
    await rejectsWith(
      rawSession(alice.userId, plan, { ...after, minutes: 45 }),
      "23514",
    );
    await expect(rawSession(alice.userId, plan, after)).resolves.toBeDefined();
  });

  it("allows at most one active morning routine per plan version", async () => {
    const alice = await newAccount(db);
    const plan = await rawPlan(alice.userId);
    const other = await rawPlan(alice.userId);
    await rawSession(alice.userId, plan);
    await rejectsWith(rawSession(alice.userId, plan), "23505");
    // A removed one and one in another version are fine.
    await expect(
      rawSession(alice.userId, plan, { status: "removed" }),
    ).resolves.toBeDefined();
    await expect(rawSession(alice.userId, other)).resolves.toBeDefined();
    // The session_id stays unique within the version.
    const sessionId = "sess-fixed";
    await rawSession(alice.userId, plan, {
      session_id: sessionId,
      kind: "session",
      minutes: 20,
      weekdays: [4],
    });
    await rejectsWith(
      rawSession(alice.userId, plan, {
        session_id: sessionId,
        kind: "session",
        minutes: 20,
        weekdays: [5],
      }),
      "23505",
    );
  });

  it("needs a plan version of the same user", async () => {
    const alice = await newAccount(db);
    await rejectsWith(rawSession(alice.userId, "pv-missing"), "23503");
  });
});

describe("mobility workouts and results", () => {
  it("never stores a mobility workout as planned or in progress", async () => {
    const alice = await newAccount(db);
    await rejectsWith(rawWorkout(alice.userId, "mobility", "planned"), "23514");
    await rejectsWith(
      rawWorkout(alice.userId, "mobility", "in_progress"),
      "23514",
    );
    await expect(
      rawWorkout(alice.userId, "mobility", "completed"),
    ).resolves.toBeDefined();
    await expect(
      rawWorkout(alice.userId, "mobility", "cancelled"),
    ).resolves.toBeDefined();
    // A planned run is still allowed; unknown kinds are not.
    await expect(
      rawWorkout(alice.userId, "run", "planned"),
    ).resolves.toBeDefined();
    await rejectsWith(rawWorkout(alice.userId, "yoga" as never), "23514");
  });

  it("lets a result belong only to a mobility workout", async () => {
    const alice = await newAccount(db);
    const strength = await logOneSet(alice);
    const run = await rawWorkout(alice.userId, "run");
    await rejectsWith(rawResult(alice.userId, strength), "23503");
    await rejectsWith(rawResult(alice.userId, run), "23503");
    await rejectsWith(rawResult(alice.userId, randomUUID()), "23503");
    const mobility = await rawWorkout(alice.userId, "mobility");
    await rejectsWith(
      rawResult(alice.userId, mobility, { activity_type: "strength" }),
      "23514",
    );
    await expect(rawResult(alice.userId, mobility)).resolves.toBeDefined();
    // One result per workout.
    await rejectsWith(rawResult(alice.userId, mobility), "23505");
  });

  it("keeps the counts consistent and lets only an early end fall short", async () => {
    const alice = await newAccount(db);
    const short = {
      exercises_total: 3,
      exercises_done: 1,
      exercises_skipped: 1,
    };
    await rejectsWith(
      rawResult(
        alice.userId,
        await rawWorkout(alice.userId, "mobility"),
        short,
      ),
      "23514",
    );
    await expect(
      rawResult(alice.userId, await rawWorkout(alice.userId, "mobility"), {
        ...short,
        ended_early: true,
        result_source: "watch",
      }),
    ).resolves.toBeDefined();
    for (const over of [
      {
        exercises_total: 2,
        exercises_done: 2,
        exercises_skipped: 1,
        ended_early: true,
      },
      { exercises_total: 21, exercises_done: 21 },
      { exercises_done: -1, exercises_skipped: 3 },
      { timer_s: 700, elapsed_s: 600 },
      { timer_s: -1 },
      { minutes_planned: 0 },
      { result_source: "screenshot" },
      { kind: "evening" },
    ])
      await rejectsWith(
        rawResult(
          alice.userId,
          await rawWorkout(alice.userId, "mobility"),
          over,
        ),
        "23514",
      );
  });

  it("keeps the mobility mark of a watch receipt in its format", async () => {
    const alice = await newAccount(db);
    const deviceId = `wdv_${randomUUID()}`;
    await asOwner((c) =>
      c.query(
        `insert into arnold.watch_devices (user_id, device_id, token_hash, label, timezone)
         values ($1, $2, $3, 'Uhr', 'Europe/Berlin')`,
        [alice.userId, deviceId, randomBytes(32)],
      ),
    );
    const receipt = (mark: string | null) =>
      db.asUser(alice.userId, (c) =>
        c.query(
          `insert into arnold.watch_plan_receipts (user_id, device_id, plan_mark, mobility_mark)
           values ($1, $2, '0123456789abcdef', $3)
           on conflict (user_id, device_id) do update set mobility_mark = excluded.mobility_mark`,
          [alice.userId, deviceId, mark],
        ),
      );
    for (const mark of ["xyz", "0123456789ABCDEF", "0123456789abcde", ""])
      await rejectsWith(receipt(mark), "23514");
    await expect(receipt(null)).resolves.toBeDefined();
    await expect(receipt("fedcba9876543210")).resolves.toBeDefined();
  });
});

describe("schema 1.2.0 in the store", () => {
  it("writes and reads all three tables through commitWrite", async () => {
    const alice = await newAccount(db);
    // Without mobility the optional lists stay absent.
    await logOneSet(alice);
    const plain = await alice.store.read();
    for (const key of [
      "mobilityProfiles",
      "planMobilitySessions",
      "mobilityResults",
    ])
      expect(key in plain, key).toBe(false);

    const profile = profileRow();
    await write(alice, [
      { table: "mobilityProfiles", before: null, after: profile },
    ]);
    const changed: ArnoldMobilityProfile = {
      ...profile,
      sessions_placement: null,
      sessions_per_week: null,
      sessions_minutes: null,
      stiff_areas: ["neck"],
      row_revision: 2,
    };
    await write(alice, [
      { table: "mobilityProfiles", before: profile, after: changed },
    ]);

    const { plan, morning } = await storePlan(alice);
    const ownDay = sessionRow(plan.plan_version_id, {
      session_name: "Mobility Dienstag",
      session_order: 11,
      kind: "session",
      weekdays: [2],
      minutes: 20,
    });
    await write(alice, [
      { table: "planMobilitySessions", before: null, after: ownDay },
    ]);
    // In a draft a routine may still change.
    const moved = { ...ownDay, weekdays: [4], row_revision: 2 };
    await write(alice, [
      { table: "planMobilitySessions", before: ownDay, after: moved },
    ]);

    const planned = await storeRoutine(
      alice,
      {},
      { plan_version_id: plan.plan_version_id, session_id: morning.session_id },
    );
    const early = await storeRoutine(alice, {
      kind: "session",
      minutes_planned: 20,
      exercises_total: 2,
      exercises_done: 1,
      exercises_skipped: 0,
      ended_early: true,
      items: [{ c: "mob_neck_rolls", st: "done", t: 45 }],
    });

    const data = await alice.store.read();
    expect(data.mobilityProfiles).toEqual([changed]);
    expect(data.planMobilitySessions).toEqual([morning, moved]);
    expect(data.mobilityResults).toEqual([planned.result, early.result]);
    const mobility = data.workouts.filter(
      (w) => w.activity_type === "mobility",
    );
    expect(mobility).toEqual([planned.workout, early.workout]);
    // The strength workout still reads back without activity_type.
    expect(data.workouts.filter((w) => !("activity_type" in w))).toHaveLength(
      1,
    );

    expect(await count(alice.userId, "mobility_results")).toBe(2);
  });

  it("freezes the routines of a version once it is no longer a draft", async () => {
    const alice = await newAccount(db);
    const { plan, morning } = await storePlan(alice);
    const active: ArnoldPlanVersion = {
      ...plan,
      status: "active",
      activated_at_utc: STAMP,
      row_revision: 2,
    };
    await write(alice, [{ table: "plans", before: plan, after: active }]);
    await expect(
      write(alice, [
        {
          table: "planMobilitySessions",
          before: morning,
          after: { ...morning, minutes: 15, row_revision: 2 },
        },
      ]),
    ).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
    // No exception like the level of a run: even the template is frozen.
    await expect(
      write(alice, [
        {
          table: "planMobilitySessions",
          before: morning,
          after: {
            ...morning,
            template: { ...morning.template, total_s: 90 },
            row_revision: 2,
          },
        },
      ]),
    ).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
    await expect(
      write(alice, [
        {
          table: "planMobilitySessions",
          before: null,
          after: sessionRow(plan.plan_version_id, {
            kind: "session",
            weekdays: [6],
            minutes: 15,
          }),
        },
      ]),
    ).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
    expect((await alice.store.read()).planMobilitySessions).toEqual([morning]);
  });

  it("keeps identities stable and refuses rows the contract forbids", async () => {
    const alice = await newAccount(db);
    const { workout, result } = await storeRoutine(alice);
    await expect(
      write(alice, [
        {
          table: "mobilityResults",
          before: result,
          after: { ...result, workout_id: randomUUID(), row_revision: 2 },
        },
      ]),
    ).rejects.toMatchObject({ code: "REVISION_CONFLICT" });
    // A mobility workout never turns into a strength workout.
    await expect(
      write(alice, [
        {
          table: "workouts",
          before: workout,
          after: { ...workout, activity_type: "run", row_revision: 2 },
        },
      ]),
    ).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
    // Planned mobility workouts are refused by the contract already.
    await expect(
      storeRoutine(alice, {}, { status: "planned" as never }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect((await alice.store.read()).mobilityResults).toEqual([result]);
  });
});

describe("row level security on the mobility tables", () => {
  it("shows another user nothing, not even without a where clause", async () => {
    const alice = await newAccount(db);
    const bob = await newAccount(db);
    await write(alice, [
      { table: "mobilityProfiles", before: null, after: profileRow() },
    ]);
    await storePlan(alice);
    await storeRoutine(alice);
    for (const table of MOBILITY_TABLES) {
      expect(await count(alice.userId, table), table).toBe(1);
      const seen = await db.asUser(bob.userId, (c) =>
        c.query(`select * from arnold.${table}`),
      );
      expect(seen.rowCount, table).toBe(0);
      const none = await db.query(`select * from arnold.${table}`);
      expect(none.rowCount, `${table} without user`).toBe(0);
    }
    const bobData = await bob.store.read();
    expect(bobData.mobilityResults).toBeUndefined();
    expect(bobData.workouts).toEqual([]);
  });

  it("refuses rows for another user, changes to them and references across users", async () => {
    const alice = await newAccount(db);
    const bob = await newAccount(db);
    await write(alice, [
      { table: "mobilityProfiles", before: null, after: profileRow() },
    ]);
    const { plan } = await storePlan(alice);
    const { workout } = await storeRoutine(alice);
    // Alice's user_id written in Bob's context: policy violation.
    await rejectsWith(
      db.asUser(bob.userId, (c) =>
        c.query(
          `insert into arnold.mobility_profiles (user_id, mobility_profile_id, wants, created_at_utc, updated_at_utc, row_revision)
           values ($1, 'mp', false, $2, $2, 1)`,
          [alice.userId, STAMP],
        ),
      ),
      "42501",
    );
    await rejectsWith(
      db.asUser(bob.userId, (c) =>
        c.query(
          `insert into arnold.mobility_results (user_id, workout_id, kind, exercises_total, exercises_done, exercises_skipped, items, result_source, catalog_version, rules_version, created_at_utc, updated_at_utc, row_revision)
           values ($1, $2, 'session', 0, 0, 0, '[]', 'chat', 'mob-1', 'r', $3, $3, 1)`,
          [alice.userId, workout.workout_id, STAMP],
        ),
      ),
      "42501",
    );
    await rejectsWith(
      db.asUser(bob.userId, (c) =>
        c.query(
          `insert into arnold.plan_mobility_sessions (user_id, plan_mobility_session_id, plan_version_id, session_id, session_order, session_name, kind, placement, weekdays, minutes, template, status, row_revision)
           values ($1, 'pms', $2, 's', 1, 'Morgen', 'morning', 'own_day', '{1}', 5, '{}', 'active', 1)`,
          [alice.userId, plan.plan_version_id],
        ),
      ),
      "42501",
    );
    // Bob's own rows pointing at Alice's plan and workout: the references
    // include user_id.
    await rejectsWith(rawSession(bob.userId, plan.plan_version_id), "23503");
    await rejectsWith(rawResult(bob.userId, workout.workout_id), "23503");
    // Updates of Alice's rows change nothing for Bob.
    for (const statement of [
      "update arnold.mobility_profiles set wants = false",
      "update arnold.plan_mobility_sessions set status = 'removed'",
      "update arnold.mobility_results set exercises_done = 0",
    ]) {
      const updated = await db.asUser(bob.userId, (c) => c.query(statement));
      expect(updated.rowCount, statement).toBe(0);
    }
    const data = await alice.store.read();
    expect(data.mobilityProfiles?.[0].wants).toBe(true);
    expect(data.planMobilitySessions?.[0].status).toBe("active");
    expect(data.mobilityResults?.[0].exercises_done).toBe(2);
  });

  it("gives the server role no DELETE or TRUNCATE", async () => {
    const alice = await newAccount(db);
    await storeRoutine(alice);
    for (const table of MOBILITY_TABLES) {
      await rejectsWith(
        db.asUser(alice.userId, (c) => c.query(`delete from arnold.${table}`)),
        "42501",
      );
      await rejectsWith(
        db.asUser(alice.userId, (c) => c.query(`truncate arnold.${table}`)),
        "42501",
      );
    }
    expect(await count(alice.userId, "mobility_results")).toBe(1);
  });
});

describe("account deletion", () => {
  it("removes every mobility row of the account and nothing of anyone else", async () => {
    const alice = await newAccount(db);
    const bob = await newAccount(db);
    await write(alice, [
      { table: "mobilityProfiles", before: null, after: profileRow() },
    ]);
    await storePlan(alice);
    await storeRoutine(alice);
    await storeRoutine(bob);
    expect(await alice.identities.remove(alice.userId)).toBe(true);
    for (const table of [...MOBILITY_TABLES, "workouts", "plan_versions"])
      expect(await count(alice.userId, table), table).toBe(0);
    expect((await bob.store.read()).mobilityResults).toHaveLength(1);
  });
});

describe("rollback script 009 → 8 → 9", () => {
  it("removes only mobility, refuses the server start on schema 8 and applies again without touching a row", async () => {
    const admin = new URL(inject("databaseAdminUrl"));
    const name = `arnold_mob_${randomUUID().replaceAll("-", "")}`;
    await asOwner((c) => c.query(`create database ${name}`));
    const ownerUrl = new URL(admin);
    ownerUrl.pathname = `/${name}`;
    const appUrl = new URL(inject("databaseUrl"));
    appUrl.pathname = `/${name}`;
    const exec = async (sql: string, values: unknown[] = []) => {
      const client = new pg.Client({ connectionString: ownerUrl.toString() });
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
          `select table_name from information_schema.tables where table_schema = 'arnold' order by 1`,
        )
      ).rows.map((r) => r.table_name as string);
    /** Every row of every table, as text; mobility_mark left out (the column comes and goes). */
    const snapshot = async (only: readonly string[]) => {
      const out: Record<string, { n: number; hash: string | null }> = {};
      for (const table of only)
        out[table] = (
          await exec(
            `select count(*)::int as n,
                    md5(string_agg((to_jsonb(t) - 'mobility_mark')::text, '|'
                                   order by (to_jsonb(t) - 'mobility_mark')::text)) as hash
               from arnold.${table} t`,
          )
        ).rows[0];
      return out;
    };
    const version = async () =>
      (
        await exec(
          "select max(version)::int as v from arnold.schema_migrations",
        )
      ).rows[0].v;
    const local = new Database({ url: appUrl.toString() });
    try {
      expect(await migrate(ownerUrl.toString())).toEqual([
        1, 2, 3, 4, 5, 6, 7, 8, 9, 10,
      ]);
      await expect(local.assertReady()).resolves.toBeUndefined();
      const old = (await tables()).filter((t) => !MOBILITY_TABLES.includes(t));
      // The version list itself moves; everything else must not.
      const dataTables = old.filter((t) => t !== "schema_migrations");

      // Strength and running data, a watch and its receipt.
      const alice = await newAccount(local);
      await logOneSet(alice);
      const { workout: runW, run } = runWorkout();
      await write(alice, [
        { table: "workouts", before: null, after: runW },
        { table: "runs", before: null, after: run },
      ]);
      const deviceId = `wdv_${randomUUID()}`;
      await exec(
        `insert into arnold.watch_devices (user_id, device_id, token_hash, label, timezone)
         values ($1, $2, $3, 'Uhr', 'Europe/Berlin')`,
        [alice.userId, deviceId, randomBytes(32)],
      );
      await exec(
        `insert into arnold.watch_plan_receipts (user_id, device_id, plan_mark)
         values ($1, $2, '0123456789abcdef')`,
        [alice.userId, deviceId],
      );
      const before = await snapshot(dataTables);

      // Mobility on top: profile, a plan with routines, two done routines.
      await write(alice, [
        { table: "mobilityProfiles", before: null, after: profileRow() },
      ]);
      const { plan, morning } = await storePlan(alice);
      await storeRoutine(
        alice,
        {},
        {
          plan_version_id: plan.plan_version_id,
          session_id: morning.session_id,
        },
      );
      await storeRoutine(alice, { kind: "session", result_source: "chat" });
      await exec(
        "update arnold.watch_plan_receipts set mobility_mark = 'fedcba9876543210'",
      );
      expect(
        (await exec("select count(*)::int as n from arnold.mobility_results"))
          .rows[0].n,
      ).toBe(2);

      await exec(await readFile("db/rollback/010_down.sql", "utf8"));

      const down = await readFile("db/rollback/009_down.sql", "utf8");
      await exec(down);

      expect(await version()).toBe(8);
      expect(await tables()).toEqual(old);
      const receiptColumns = (
        await exec(
          `select column_name from information_schema.columns where table_schema = 'arnold' and table_name = 'watch_plan_receipts'`,
        )
      ).rows.map((r) => r.column_name);
      expect(receiptColumns).not.toContain("mobility_mark");
      // Strength and running unchanged, mobility workouts and their receipts
      // gone. The draft plan stays (a plan version is not mobility data).
      const after = await snapshot(dataTables);
      const { plan_versions: planAfter, ...restAfter } = after;
      const { plan_versions: planBefore, ...restBefore } = before;
      expect(restAfter).toEqual(restBefore);
      expect(planAfter.n).toBe(planBefore.n + 1);
      // The old activity_type check is back.
      await expect(
        exec(
          `insert into arnold.workouts (user_id, workout_id, workout_date_local, timezone, status, source, created_at_utc, updated_at_utc, row_revision, activity_type)
           values ($1, $2, '2026-11-22', 'Europe/Berlin', 'completed', 'chat', $3, $3, 1, 'mobility')`,
          [alice.userId, randomUUID(), STAMP],
        ),
      ).rejects.toMatchObject({ code: "23514" });
      const checks = (
        await exec(
          `select conname from pg_constraint where conrelid = 'arnold.workouts'::regclass and conname like 'workouts_%' order by 1`,
        )
      ).rows.map((r) => r.conname);
      expect(checks).toContain("workouts_activity_type_check");
      expect(checks).not.toContain("workouts_mobility_not_in_progress");

      // A server built for schema 9 refuses to start on schema 8.
      await expect(local.assertReady()).rejects.toThrow(
        /Version 8, erwartet 10/,
      );
      // A second run of the script refuses instead of half-applying.
      await expect(exec(down)).rejects.toThrow(/not applied/);

      // 009 on a database with strength and running data changes no row.
      const atEight = await snapshot(dataTables);
      expect(await migrate(ownerUrl.toString())).toEqual([9, 10]);
      expect(await snapshot(dataTables)).toEqual(atEight);
      expect(
        (await tables()).filter((t) => MOBILITY_TABLES.includes(t)),
      ).toEqual([...MOBILITY_TABLES].sort());
      await expect(local.assertReady()).resolves.toBeUndefined();
      const data = await alice.store.read();
      expect(data.workouts.map((w) => w.activity_type ?? "strength")).toEqual([
        "strength",
        "run",
      ]);
      expect("mobilityResults" in data).toBe(false);
    } finally {
      await local.close();
      await asOwner((c) => c.query(`drop database ${name} with (force)`));
    }
  });
});
