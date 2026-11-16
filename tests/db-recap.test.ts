/**
 * The recap's "seen" receipt in the real database: written under the user's
 * own id, invisible to anyone else, the same on a repeat.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
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
});
