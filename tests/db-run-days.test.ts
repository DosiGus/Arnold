/**
 * RUN-022 against the real test Postgres: the store source hands the dashboard
 * the calendar days of a user's own completed runs, and only those. Planned and
 * voided runs add nothing, another user's runs never appear, and the days count
 * as training days in the analytics.
 */
import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import {
  buildArnoldDashboardAnalytics,
  buildHomeAnalytics,
} from "../src/analytics";
import { storeSource } from "../src/server/arnold-source";
import { commitWrite } from "../src/server/plan/commit";
import { fingerprint } from "../src/server/workout/infrastructure";
import type { EntityChange } from "../src/server/workout/infrastructure";
import type { ArnoldRun, ArnoldWorkout } from "../src/shared/arnold-schema-v1";
import { appDatabase, logOneSet, newAccount } from "./fixtures/arnold-db.js";

const db = appDatabase();
afterAll(() => db.close());

type Account = Awaited<ReturnType<typeof newAccount>>;
const STAMP = "2026-11-13T18:00:00.000Z";

function runWorkout(
  date: string,
  status: "planned" | "completed" | "voided",
): ArnoldWorkout {
  const done = status === "completed";
  return {
    workout_id: randomUUID(),
    workout_date_local: date,
    timezone: "Europe/Berlin",
    started_at_utc: done ? `${date}T17:00:00.000Z` : null,
    ended_at_utc: done ? `${date}T17:47:00.000Z` : null,
    plan_version_id: null,
    session_id: null,
    session_name_snapshot: "Grundlage Zone 2",
    status,
    source: done ? "sync" : "chat",
    notes: null,
    created_at_utc: STAMP,
    updated_at_utc: STAMP,
    row_revision: 1,
    activity_type: "run",
  };
}

function runRow(workout: ArnoldWorkout): ArnoldRun {
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
    rationale: null,
    rules_version: "run-rules-test",
    timer_s: done ? 2700 : null,
    elapsed_s: done ? 2820 : null,
    distance_m: done ? 7420 : null,
    distance_source: done ? "gps" : null,
    ascent_m: null,
    descent_m: null,
    cadence_spm: null,
    calories_kcal: null,
    te_aerobic: null,
    te_anaerobic: null,
    rpe: done ? 3 : null,
    splits_100m: null,
    pause_count: null,
    result_source: done ? "watch" : null,
    hr_status: done ? "not_provided" : null,
    hr_avg_bpm: null,
    hr_max_bpm: null,
    hr_zone_seconds: null,
    created_at_utc: STAMP,
    updated_at_utc: STAMP,
    row_revision: 1,
  };
}

/** Stores one run through commitWrite, the one write path. */
async function storeRun(
  account: Account,
  date: string,
  status: "planned" | "completed" | "voided",
) {
  const workout = runWorkout(date, status);
  const changes: EntityChange[] = [
    { table: "workouts", before: null, after: workout },
    { table: "runs", before: null, after: runRow(workout) },
  ];
  const requestId = randomUUID();
  await commitWrite({
    trackerId: account.trackerId,
    store: account.store,
    requestId,
    fingerprint: fingerprint(["test_run_days", requestId]),
    actorSubject: account.userId,
    clock: () => new Date(STAMP),
    build: () => ({
      changes,
      audit: [],
      result: { workout, sets: [], exercise: null, warnings: [] },
    }),
  });
}

const load = async (account: Account) =>
  (
    await storeSource(account.store, {
      synthetic: false,
      label: "Test",
      description: "Test",
    }).load()
  ).dataset;

describe("run days from the store source", () => {
  it("carries the days of completed runs and nothing else", async () => {
    const alice = await newAccount(db);
    await storeRun(alice, "2026-11-13", "completed");
    await storeRun(alice, "2026-11-13", "completed");
    await storeRun(alice, "2026-11-14", "planned");
    await storeRun(alice, "2026-11-12", "voided");
    const dataset = await load(alice);
    expect(
      (dataset as { runTrainingDates?: string[] }).runTrainingDates,
    ).toEqual(["2026-11-13"]);
    // The dataset itself stays strength-only.
    expect(dataset.workouts).toEqual([]);
    expect(dataset.runs).toEqual([]);
  });

  it("counts a run day once together with a strength workout on the same day", async () => {
    const alice = await newAccount(db);
    const workoutId = await logOneSet(alice);
    const done = await alice.logging.execute("complete_workout", {
      request_id: randomUUID(),
      workout_id: workoutId,
      expected_row_revision: 1,
    });
    expect(done.ok, JSON.stringify(done.error)).toBe(true);
    // logOneSet trains on 2026-10-29; the run is on the same calendar day.
    await storeRun(alice, "2026-10-29", "completed");
    const dataset = await load(alice);
    const analytics = buildArnoldDashboardAnalytics(dataset);
    expect(analytics.activity.training_days.value).toBe(1);
    expect(analytics.activity.workouts.value).toBe(1);
    await storeRun(alice, "2030-01-02", "completed");
    const more = buildArnoldDashboardAnalytics(await load(alice));
    expect(more.activity.training_days.value).toBe(2);
    expect(more.activity.workouts.value).toBe(1);
    expect(
      buildHomeAnalytics(await load(alice), {
        weekly_goal_training_days: 1,
      }).streak.weeks.at(-1)?.training_days,
    ).toBe(1);
  });

  it("never shows another user's runs", async () => {
    const alice = await newAccount(db);
    const bob = await newAccount(db);
    await storeRun(alice, "2026-11-13", "completed");
    const aliceData = await load(alice);
    const bobData = await load(bob);
    expect(
      (aliceData as { runTrainingDates?: string[] }).runTrainingDates,
    ).toEqual(["2026-11-13"]);
    expect(
      (bobData as { runTrainingDates?: string[] }).runTrainingDates,
    ).toBeUndefined();
    const bobActivity = buildArnoldDashboardAnalytics(bobData).activity;
    expect(bobActivity.training_days.value).toBe(0);
    expect(bobActivity.weeks).toEqual([]);
  });
});
