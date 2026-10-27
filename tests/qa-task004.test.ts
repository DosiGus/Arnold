import { expect, it } from "vitest";
import {
  createFixtureLogging,
  workoutFixtureDataset,
} from "../src/server/workout/fixture";
import { WorkoutLoggingService } from "../src/server/workout/service";
import {
  FixtureAuthorizationGuard,
  InMemoryArnoldWriteRepository,
  InMemoryAuditLog,
  InMemoryOperationLedger,
  InProcessWriteCoordinator,
  RejectedWriteError as WriteError,
} from "../src/server/workout/infrastructure";
import { ArnoldSheetsWriteAdapter } from "../src/server/arnold-sheets-write-adapter";
import { ArnoldSheetsReadAdapter } from "../src/server/arnold-sheets-read-adapter";
import { FakeArnoldWriteSheets } from "./fixtures/arnold-write-sheets";
import { fixtureFileId } from "./fixtures/arnold-v1";
const start = {
  request_id: "start",
  workout_date_local: "2026-10-20",
  timezone: "Europe/Berlin",
  session_name: "Independent QA",
};
const set = {
  exercise_id: "fixture-bench",
  set_type: "working",
  reps: 10,
  reps_basis: "total",
  load_kg: 50,
  load_basis: "total",
  implement_count: 1,
  execution_mode: "bilateral_simultaneous",
  side: "both",
};

it("Q4-01 a definitively rejected operation must not orphan the tracker when the UI clears that request", async () => {
  const memory = new InMemoryArnoldWriteRepository(workoutFixtureDataset());
  const ledger = new InMemoryOperationLedger();
  let rejected = false;
  const service = new WorkoutLoggingService({
    mode: "fixture",
    trackerId: "arnold-fixture-tracker",
    ledger,
    audit: new InMemoryAuditLog(),
    coordinator: new InProcessWriteCoordinator(),
    authorization: new FixtureAuthorizationGuard("arnold-fixture-tracker"),
    invalidate() {},
    repository: {
      kind: "fixture",
      read: () => memory.read(),
      apply: async (changes) => {
        if (!rejected) {
          rejected = true;
          throw new WriteError(
            "PERMISSION_DENIED",
            "Synthetic definite rejection",
          );
        }
        await memory.apply(changes);
      },
    },
  });
  const denied = await service.startWorkout(start);
  expect(denied.error?.code).toBe("PERMISSION_DENIED");
  expect((await memory.read()).workouts).toHaveLength(0);
  const next = await service.startWorkout({
    ...start,
    request_id: "fresh-after-fixed-permission",
  });
  expect(next.error?.code, JSON.stringify(next)).not.toBe(
    "COMMIT_STATUS_UNKNOWN",
  );
  expect(next.ok).toBe(true);
});

it("Q4-02 a known completion time cannot precede the workout's local training date when start time is unknown", async () => {
  const r = createFixtureLogging();
  const w = (await r.service.startWorkout(start)).result!.workout!;
  expect(
    (
      await r.service.logWorkoutSets({
        request_id: "sets",
        workout_id: w.workout_id,
        sets: [set],
      })
    ).ok,
  ).toBe(true);
  const result = await r.service.completeWorkout({
    request_id: "complete",
    workout_id: w.workout_id,
    expected_row_revision: 1,
    ended_at_utc: "2000-01-01T12:00:00Z",
  });
  expect(result.ok, JSON.stringify(result)).toBe(false);
  expect(result.error?.code).toBe("VALIDATION_ERROR");
});

it("Q4-03 same request recovery after definite rejection remains safe", async () => {
  const memory = new InMemoryArnoldWriteRepository(workoutFixtureDataset());
  let reject = true;
  const service = new WorkoutLoggingService({
    mode: "fixture",
    trackerId: "arnold-fixture-tracker",
    ledger: new InMemoryOperationLedger(),
    audit: new InMemoryAuditLog(),
    coordinator: new InProcessWriteCoordinator(),
    authorization: new FixtureAuthorizationGuard("arnold-fixture-tracker"),
    invalidate() {},
    repository: {
      kind: "fixture",
      read: () => memory.read(),
      apply: async (c) => {
        if (reject) {
          reject = false;
          throw new WriteError("PERMISSION_DENIED", "Synthetic");
        }
        await memory.apply(c);
      },
    },
  });
  expect((await service.startWorkout(start)).error?.code).toBe(
    "PERMISSION_DENIED",
  );
  expect((await service.startWorkout(start)).ok).toBe(true);
  expect((await memory.read()).workouts).toHaveLength(1);
});

it("Q4-04 rejects an append that would exceed the reader's configured row limit before storage changes", async () => {
  const fake = new FakeArnoldWriteSheets();
  const meta = fake.metadata.sheets.find(
    (s) => s.properties.title === "EXERCISES",
  )!.properties;
  meta.gridProperties.rowCount = 10000;
  while (fake.tables.EXERCISES.length < 10000) {
    const row = [...fake.tables.EXERCISES[1]];
    row[0] = `qa-exercise-${fake.tables.EXERCISES.length}`;
    fake.tables.EXERCISES.push(row);
  }
  const data = await new ArnoldSheetsReadAdapter(
    { spreadsheetId: fixtureFileId },
    fake,
  ).getDataset();
  const original = fake.batchUpdate.bind(fake);
  fake.batchUpdate = async (id, requests) => {
    await original(id, requests);
    meta.gridProperties.rowCount = Math.max(
      meta.gridProperties.rowCount,
      fake.tables.EXERCISES.length,
    );
  };
  const adapter = new ArnoldSheetsWriteAdapter(
    {
      spreadsheetId: fixtureFileId,
      dedicatedTestSpreadsheetId: fixtureFileId,
      allowTestSheetWrites: true,
      privateConnection: true,
      trackerId: data.config.tracker_id,
      authorizeWrite: async () => ({
        subject: "synthetic-boundary",
        trackerId: data.config.tracker_id,
        permissions: ["write"],
        verified: true,
        kind: "authenticated",
      }),
    },
    fake,
  );
  await expect(
    adapter.apply([
      {
        table: "exercises",
        before: null,
        after: { ...data.exercises[0], exercise_id: "qa-new-at-limit" },
      },
    ]),
  ).rejects.toBeDefined();
  expect(
    fake.batches,
    "No write is permitted beyond the supported row limit",
  ).toHaveLength(0);
});
