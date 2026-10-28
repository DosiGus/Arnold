import { describe, expect, it } from "vitest";
import {
  ArnoldSheetsWriteAdapter,
  ARNOLD_MASTER_SPREADSHEET_ID,
  type TestSheetWriteOptions,
} from "../src/server/arnold-sheets-write-adapter";
import { FakeArnoldWriteSheets } from "./fixtures/arnold-write-sheets";
import { fixtureFileId, setConfig, templateTables } from "./fixtures/arnold-v1";
import {
  ArnoldExerciseSchema,
  ArnoldWorkoutSchema,
} from "../src/shared/arnold-schema-v1";
import { WorkoutLoggingService } from "../src/server/workout/service";
import {
  InMemoryAuditLog,
  InMemoryOperationLedger,
  InProcessWriteCoordinator,
  type AuthorizationGuard,
} from "../src/server/workout/infrastructure";

const opts = async (
  f: FakeArnoldWriteSheets,
): Promise<TestSheetWriteOptions> => {
  const { ArnoldSheetsReadAdapter } =
    await import("../src/server/arnold-sheets-read-adapter");
  const data = await new ArnoldSheetsReadAdapter(
    { spreadsheetId: fixtureFileId },
    f,
  ).getDataset();
  return {
    spreadsheetId: fixtureFileId,
    dedicatedTestSpreadsheetId: fixtureFileId,
    allowTestSheetWrites: true,
    trackerId: data.config.tracker_id,
    privateConnection: true,
    authorizeWrite: async () => ({
      subject: "synthetic-google-boundary",
      trackerId: data.config.tracker_id,
      permissions: ["write"],
      verified: true,
      kind: "authenticated",
    }),
    sleep: async () => {},
  };
};
const newWorkout = (extra = {}) =>
  ArnoldWorkoutSchema.parse({
    workout_id: "write-workout",
    workout_date_local: "2026-10-01",
    timezone: "Europe/Berlin",
    started_at_utc: null,
    ended_at_utc: null,
    plan_version_id: null,
    session_id: null,
    session_name_snapshot: "Write fixture",
    status: "in_progress",
    source: "chat",
    notes: null,
    created_at_utc: "2026-10-01T12:00:00Z",
    updated_at_utc: "2026-10-01T12:00:00Z",
    row_revision: 1,
    ...extra,
  });
async function setup() {
  const fake = new FakeArnoldWriteSheets(),
    options = await opts(fake),
    adapter = new ArnoldSheetsWriteAdapter(options, fake);
  return { fake, options, adapter };
}

describe("ArnoldSheetsWriteAdapter: protected atomic batches", () => {
  it("appends a logical batch once and verifies the normalized readback", async () => {
    const { fake, adapter } = await setup();
    await adapter.apply([
      { table: "workouts", before: null, after: newWorkout() },
      {
        table: "workouts",
        before: null,
        after: newWorkout({ workout_id: "write-workout-2" }),
      },
    ]);
    expect(fake.batches).toHaveLength(1);
    expect(fake.batches[0]).toHaveLength(1);
    expect(
      (await adapter.read()).workouts.filter((w) =>
        w.workout_id.startsWith("write-workout"),
      ),
    ).toHaveLength(2);
    expect(
      fake.calls
        .slice(-7)
        .map((c) => c.params.ranges)
        .filter(Boolean),
    ).toHaveLength(6);
  });
  it("uses stringValue for formula-like names and notes, never formulaValue or USER_ENTERED", async () => {
    const { fake, adapter } = await setup();
    const d = await adapter.read();
    const exercise = ArnoldExerciseSchema.parse({
      ...d.exercises[0],
      exercise_id: "formula-text",
      name_de: '=IMPORTXML("https://invalid.example", "//x")',
    });
    await adapter.apply([
      { table: "exercises", before: null, after: exercise },
      { table: "workouts", before: null, after: newWorkout({ notes: "=1+1" }) },
    ]);
    const encoded = JSON.stringify(fake.batches[0]);
    expect(encoded).toContain('"stringValue":"=1+1"');
    expect(encoded).not.toContain('"formulaValue"');
    expect(
      (await adapter.read()).exercises.find(
        (e) => e.exercise_id === "formula-text",
      )?.name_de,
    ).toBe(exercise.name_de);
  });
  it("resolves physical target by stable ID despite blank rows; no cached filtered row index", async () => {
    const { fake, options } = await setup();
    fake.tables.SETS.splice(1, 0, []);
    const adapter = new ArnoldSheetsWriteAdapter(options, fake),
      d = await adapter.read(),
      before = d.sets[0];
    await adapter.apply([
      {
        table: "sets",
        before,
        after: {
          ...before,
          notes: "correct row",
          row_revision: before.row_revision + 1,
          updated_at_utc: "2026-10-20T00:00:00Z",
        },
      },
    ]);
    const batch = fake.batches[0][0];
    expect(
      "updateCells" in batch && batch.updateCells.range.startRowIndex,
    ).toBe(2);
    expect((await adapter.read()).sets[0].notes).toBe("correct row");
  });
  it("rejects stale revisions and attempts to reassign historical references", async () => {
    const { fake, adapter } = await setup(),
      d = await adapter.read(),
      before = d.sets[0];
    await expect(
      adapter.apply([
        {
          table: "sets",
          before: { ...before, row_revision: 99 },
          after: { ...before, row_revision: 100 },
        },
      ]),
    ).rejects.toMatchObject({ code: "REVISION_CONFLICT" });
    await expect(
      adapter.apply([
        {
          table: "sets",
          before,
          after: {
            ...before,
            workout_id: d.workouts[1]?.workout_id ?? "changed",
            row_revision: before.row_revision + 1,
          },
        },
      ]),
    ).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
    expect(fake.batches).toHaveLength(0);
  });
  it.each(["allowTestSheetWrites", "privateConnection"] as const)(
    "requires explicit %s",
    async (flag) => {
      const { fake, options } = await setup();
      expect(
        () => new ArnoldSheetsWriteAdapter({ ...options, [flag]: false }, fake),
      ).toThrow();
    },
  );
  it("rejects missing or unverified writer identity rather than trusting flags", async () => {
    const { fake, options } = await setup();
    expect(
      () =>
        new ArnoldSheetsWriteAdapter(
          { ...options, authorizeWrite: undefined as never },
          fake,
        ),
    ).toThrow();
    const invalid = new ArnoldSheetsWriteAdapter(
      {
        ...options,
        authorizeWrite: async () => ({
          subject: "",
          trackerId: options.trackerId,
          permissions: [],
          verified: true,
          kind: "authenticated",
        }),
      },
      fake,
    );
    await expect(
      invalid.apply([{ table: "workouts", before: null, after: newWorkout() }]),
    ).rejects.toMatchObject({ code: "AUTH_REQUIRED" });
    const foreign = new ArnoldSheetsWriteAdapter(
      {
        ...options,
        authorizeWrite: async () => ({
          subject: "synthetic",
          trackerId: "foreign",
          permissions: ["write"],
          verified: true,
          kind: "authenticated",
        }),
      },
      fake,
    );
    await expect(
      foreign.apply([{ table: "workouts", before: null, after: newWorkout() }]),
    ).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
    expect(fake.batches).toHaveLength(0);
  });
  it("always blocks the fixed master ID, even with apparently valid test flags", async () => {
    const { fake, options } = await setup();
    expect(
      () =>
        new ArnoldSheetsWriteAdapter(
          {
            ...options,
            spreadsheetId: ARNOLD_MASTER_SPREADSHEET_ID,
            dedicatedTestSpreadsheetId: ARNOLD_MASTER_SPREADSHEET_ID,
          },
          fake,
        ),
    ).toThrow(expect.objectContaining({ code: "TEMPLATE_WRITE_FORBIDDEN" }));
    expect(
      () =>
        new ArnoldSheetsWriteAdapter(
          { ...options, dedicatedTestSpreadsheetId: "another-file" },
          fake,
        ),
    ).toThrow();
  });
  it("blocks MASTER_TEMPLATE by CONFIG, unassigned and foreign tracker IDs", async () => {
    const { fake, options } = await setup();
    fake.tables = templateTables();
    await expect(
      new ArnoldSheetsWriteAdapter(options, fake).apply([
        { table: "workouts", before: null, after: newWorkout() },
      ]),
    ).rejects.toMatchObject({ code: "TEMPLATE_WRITE_FORBIDDEN" });
    const other = await setup();
    setConfig(other.fake.tables, "tracker_id", "foreign");
    await expect(other.adapter.read()).rejects.toMatchObject({
      code: "PERMISSION_DENIED",
    });
    expect(
      () =>
        new ArnoldSheetsWriteAdapter(
          { ...options, trackerId: "TEMPLATE_UNASSIGNED" },
          fake,
        ),
    ).toThrow();
  });
  it.each(["schema", "header", "missing_tab", "merged"])(
    "rejects changed structure %s before writing",
    async (kind) => {
      const { fake, adapter } = await setup();
      if (kind === "schema") setConfig(fake.tables, "schema_version", "2.0.0");
      if (kind === "header") fake.tables.SETS[0][0] = "wrong";
      if (kind === "missing_tab") fake.metadata.sheets.pop();
      if (kind === "merged")
        fake.metadata.sheets[0].merges.push({ startRowIndex: 0 });
      await expect(
        adapter.apply([
          { table: "workouts", before: null, after: newWorkout() },
        ]),
      ).rejects.toMatchObject({ code: "SCHEMA_MISMATCH" });
      expect(fake.batches).toHaveLength(0);
    },
  );
  it.each([
    [401, "AUTH_REQUIRED"],
    [403, "PERMISSION_DENIED"],
    [404, "STORAGE_UNAVAILABLE"],
  ] as const)("maps Google %s without retry", async (status, code) => {
    const { fake, adapter } = await setup();
    fake.reject = [status];
    await expect(
      adapter.apply([{ table: "workouts", before: null, after: newWorkout() }]),
    ).rejects.toMatchObject({ code });
    expect(fake.batches).toHaveLength(1);
  });
  it("backs off on definite HTTP 429 rejection and bounds retries", async () => {
    const { fake, options } = await setup();
    const delays: number[] = [];
    const adapter = new ArnoldSheetsWriteAdapter(
      {
        ...options,
        sleep: async (ms) => {
          delays.push(ms);
        },
      },
      fake,
    );
    fake.reject = [429, 429];
    await adapter.apply([
      { table: "workouts", before: null, after: newWorkout() },
    ]);
    expect(delays).toHaveLength(2);
    expect(delays[1]).toBeGreaterThan(delays[0]);
    expect(fake.batches).toHaveLength(3);
    const next = await setup();
    next.fake.reject = [429, 429, 429];
    await expect(
      next.adapter.apply([
        { table: "workouts", before: null, after: newWorkout() },
      ]),
    ).rejects.toMatchObject({ code: "STORAGE_UNAVAILABLE" });
    expect(next.fake.batches).toHaveLength(3);
  });
  it("quarantines out-of-band changes rather than overwriting them", async () => {
    const { fake, adapter } = await setup();
    await adapter.read();
    fake.tables.EXERCISES[1][1] = "manually renamed";
    await expect(
      adapter.apply([{ table: "workouts", before: null, after: newWorkout() }]),
    ).rejects.toMatchObject({ code: "COMMIT_STATUS_UNKNOWN" });
    expect(fake.batches).toHaveLength(0);
  });
  it("reconciles Google commit plus lost response through the ledger and stable IDs", async () => {
    const { fake, adapter, options } = await setup();
    fake.loseResponse = true;
    const TOKEN = Symbol("synthetic test principal");
    const authorization: AuthorizationGuard = {
      async authorize(trackerId, _permission, context) {
        if (context !== TOKEN) throw Error("not verified");
        return {
          subject: "synthetic-test-actor",
          trackerId,
          permissions: ["write"],
          verified: true,
          kind: "authenticated",
        };
      },
    };
    const svc = new WorkoutLoggingService({
      mode: "test_sheet",
      trackerId: options.trackerId,
      repository: adapter,
      ledger: new InMemoryOperationLedger(),
      audit: new InMemoryAuditLog(),
      coordinator: new InProcessWriteCoordinator(),
      authorization,
      invalidate() {},
    });
    const input = {
      request_id: "lost-response",
      workout_date_local: "2026-10-01",
      timezone: "Europe/Berlin",
      session_name: "Synthetic",
    };
    expect((await svc.startWorkout(input, TOKEN)).ok).toBe(true);
    expect((await svc.startWorkout(input, TOKEN)).replayed).toBe(true);
    expect(fake.batches).toHaveLength(1);
    const denied = await svc.startWorkout({
      ...input,
      request_id: "unauthorized",
    });
    expect(denied.ok).toBe(false);
    expect(fake.batches).toHaveLength(1);
  });
});
