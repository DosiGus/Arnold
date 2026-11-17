/**
 * The recap's "seen" receipt in the real database: written under the user's
 * own id, invisible to anyone else, the same on a repeat.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import type { EntityChange } from "../src/server/workout/infrastructure";
import { commitWrite } from "../src/server/plan/commit";
import { fingerprint } from "../src/server/workout/infrastructure";
import { Database } from "../src/server/db/database";
import { recapSeenRequestId } from "../src/shared/recap-contract";
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

const completed = async (account: Awaited<ReturnType<typeof newAccount>>) => {
  const workoutId = await logOneSet(account, 80);
  const done = await account.logging.execute("complete_workout", {
    request_id: randomUUID(),
    workout_id: workoutId,
    expected_row_revision: 1,
  });
  expect(done.ok, JSON.stringify(done.error)).toBe(true);
  return workoutId;
};

describe("recap receipt in Postgres", () => {
  it("is stored for the user only and a stranger neither sees nor sets it", async () => {
    const alice = await newAccount(db);
    const bob = await newAccount(db);
    const workoutId = await completed(alice);
    expect(await alice.logging.isRecapSeen(workoutId)).toBe(false);
    const marked = await alice.logging.markRecapSeen({ workout_id: workoutId });
    expect(marked).toMatchObject({ ok: true, replayed: false });
    expect(await alice.logging.isRecapSeen(workoutId)).toBe(true);
    // Bob cannot see Alice's receipt (row level security, user_id in the key).
    expect(await bob.logging.isRecapSeen(workoutId)).toBe(false);
    // Bob cannot mark Alice's workout: it is not his.
    expect(
      await bob.logging.markRecapSeen({ workout_id: workoutId }),
    ).toMatchObject({ ok: false, error: { code: "WORKOUT_NOT_FOUND" } });
    expect(await bob.store.hasOperation(recapSeenRequestId(workoutId))).toBe(
      false,
    );
    // Physically one receipt, under Alice's id, with no data changes.
    const rows = await asOwner(
      async (c) =>
        (
          await c.query(
            "select user_id, changes from arnold.operations where request_id = $1",
            [recapSeenRequestId(workoutId)],
          )
        ).rows,
    );
    expect(rows).toEqual([{ user_id: alice.userId, changes: [] }]);
    // A repeat changes nothing.
    expect(
      await alice.logging.markRecapSeen({ workout_id: workoutId }),
    ).toMatchObject({ ok: true, replayed: true });
  });

  it("refuses a workout that is not completed", async () => {
    const alice = await newAccount(db);
    const open = await logOneSet(alice, 60);
    expect(
      await alice.logging.markRecapSeen({ workout_id: open }),
    ).toMatchObject({
      ok: false,
      error: { code: "INVALID_STATUS_TRANSITION" },
    });
    expect(await alice.logging.isRecapSeen(open)).toBe(false);
  });

  it("the receipt of a completed run is the same solution: own, once, refused when planned", async () => {
    const alice = await newAccount(db);
    const bob = await newAccount(db);
    const stamp = "2026-11-13T18:00:00.000Z";
    const tech = {
      created_at_utc: stamp,
      updated_at_utc: stamp,
      row_revision: 1,
    };
    const store = async (status: "completed" | "planned") => {
      const id = randomUUID();
      const done = status === "completed";
      const changes: EntityChange[] = [
        {
          table: "workouts",
          before: null,
          after: {
            workout_id: id,
            workout_date_local: "2026-11-13",
            timezone: "Europe/Berlin",
            started_at_utc: done ? stamp : null,
            ended_at_utc: done ? stamp : null,
            plan_version_id: null,
            session_id: null,
            session_name_snapshot: "Grundlage",
            status,
            source: "chat",
            notes: null,
            activity_type: "run",
            ...tech,
          },
        },
        {
          table: "runs",
          before: null,
          after: {
            workout_id: id,
            run_type: "base",
            environment: "outdoor",
            prescription: null,
            rationale: null,
            rules_version: null,
            timer_s: done ? 2700 : null,
            elapsed_s: done ? 2800 : null,
            distance_m: done ? 7000 : null,
            distance_source: done ? "manual" : null,
            ascent_m: null,
            descent_m: null,
            cadence_spm: null,
            calories_kcal: null,
            te_aerobic: null,
            te_anaerobic: null,
            rpe: null,
            splits_100m: null,
            pause_count: null,
            result_source: done ? "chat" : null,
            hr_status: done ? "not_provided" : null,
            hr_avg_bpm: null,
            hr_max_bpm: null,
            hr_zone_seconds: null,
            ...tech,
          },
        },
      ];
      const requestId = randomUUID();
      await commitWrite({
        trackerId: alice.trackerId,
        store: alice.store,
        requestId,
        fingerprint: fingerprint(["test_run_recap", requestId]),
        actorSubject: alice.userId,
        clock: () => new Date(stamp),
        build: () => ({
          changes,
          audit: [],
          result: { workout: null, sets: [], exercise: null, warnings: [] },
        }),
      });
      return id;
    };
    const done = await store("completed");
    const planned = await store("planned");
    expect(await alice.logging.isRecapSeen(done)).toBe(false);
    expect(
      await alice.logging.markRecapSeen({ workout_id: done }),
    ).toMatchObject({ ok: true, replayed: false });
    expect(await alice.logging.isRecapSeen(done)).toBe(true);
    expect(
      await alice.logging.markRecapSeen({ workout_id: done }),
    ).toMatchObject({ ok: true, replayed: true });
    // Not Bob's run, not Bob's receipt.
    expect(await bob.logging.isRecapSeen(done)).toBe(false);
    expect(await bob.logging.markRecapSeen({ workout_id: done })).toMatchObject(
      {
        ok: false,
        error: { code: "WORKOUT_NOT_FOUND" },
      },
    );
    expect(
      await alice.logging.markRecapSeen({ workout_id: planned }),
    ).toMatchObject({
      ok: false,
      error: { code: "INVALID_STATUS_TRANSITION" },
    });
    expect(await alice.logging.isRecapSeen(planned)).toBe(false);
  });
});
