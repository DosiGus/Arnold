import { describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createFixtureLogging,
  workoutFixtureDataset,
  writeModeFromEnv,
} from "../src/server/workout/fixture";
import { WorkoutLoggingService } from "../src/server/workout/service";
import {
  DenyAuthorizationGuard,
  FileOperationLedger,
  FixtureAuthorizationGuard,
  InMemoryArnoldWriteRepository,
  InMemoryAuditLog,
  InMemoryOperationLedger,
  InProcessWriteCoordinator,
  WriteError,
  uuid7,
  type ArnoldWriteRepository,
  type OperationLedger,
} from "../src/server/workout/infrastructure";
import { buildArnoldDashboardAnalytics } from "../src/analytics";
import { ArnoldDatasetSchema } from "../src/shared/arnold-schema-v1";
import {
  WriteResponseSchema,
  type WriteResponse,
} from "../src/shared/workout-contract";

const startInput = (extra = {}) => ({
  request_id: "start",
  workout_date_local: "2026-10-20",
  timezone: "Europe/Berlin",
  session_name: "Freies Demo-Training",
  ...extra,
});
export const setInput = (extra = {}) => ({
  exercise_id: "fixture-bench",
  set_type: "working",
  reps: 10,
  reps_basis: "total",
  load_kg: 70,
  load_basis: "total",
  implement_count: 1,
  execution_mode: "bilateral_simultaneous",
  side: "both",
  ...extra,
});
function ok(response: WriteResponse) {
  expect(response.error).toBeNull();
  expect(response.ok).toBe(true);
  WriteResponseSchema.parse(response);
  return response.result!;
}
const code = (r: WriteResponse, expected: string) => {
  expect(r.ok).toBe(false);
  expect(r.error?.code).toBe(expected);
  WriteResponseSchema.parse(r);
};
async function running(runtime = createFixtureLogging()) {
  const workout = ok(await runtime.service.startWorkout(startInput())).workout!;
  return { ...runtime, workout };
}
async function withSet() {
  const r = await running();
  const set = ok(
    await r.service.logWorkoutSets({
      request_id: "sets",
      workout_id: r.workout.workout_id,
      sets: [setInput()],
    }),
  ).sets[0];
  return { ...r, set };
}
function custom(
  repository: ArnoldWriteRepository,
  ledger: OperationLedger = new InMemoryOperationLedger(),
  audit = new InMemoryAuditLog(),
) {
  return new WorkoutLoggingService({
    mode: "fixture",
    trackerId: "arnold-fixture-tracker",
    repository,
    ledger,
    audit,
    coordinator: new InProcessWriteCoordinator(),
    authorization: new FixtureAuthorizationGuard("arnold-fixture-tracker"),
    invalidate() {},
  });
}

describe("WorkoutLoggingService: creation and references", () => {
  it("creates historical free workouts with UUIDv7, snapshot, null times and revision 1", async () => {
    const r = createFixtureLogging(),
      w = ok(await r.service.startWorkout(startInput())).workout!;
    expect(w).toMatchObject({
      status: "in_progress",
      row_revision: 1,
      plan_version_id: null,
      started_at_utc: null,
      ended_at_utc: null,
      session_name_snapshot: "Freies Demo-Training",
    });
    expect(w.workout_id).toMatch(/^[0-9a-f-]{14}7[0-9a-f-]{21}$/);
    expect((await r.repository.read()).workouts).toEqual([w]);
    expect(uuid7()).not.toBe(uuid7());
  });
  it("resolves only an unambiguous active session and preserves plan version", async () => {
    const r = createFixtureLogging();
    const before = await r.repository.read();
    const w = ok(
      await r.service.startWorkout(startInput({ session_name: "Demo Push" })),
    ).workout!;
    expect(w).toMatchObject({
      plan_version_id: "fixture-plan-v1",
      session_id: "fixture-push",
    });
    expect((await r.repository.read()).plans).toEqual(before.plans);
  });
  it("does not guess an ambiguous session", async () => {
    const d = workoutFixtureDataset();
    const r = createFixtureLogging(
      ArnoldDatasetSchema.parse({
        ...d,
        planItems: [
          ...d.planItems,
          {
            ...d.planItems[0],
            plan_item_id: "ambiguous",
            session_id: "second",
            session_order: 2,
          },
        ],
      }),
    );
    expect(
      ok(
        await r.service.startWorkout(startInput({ session_name: "Demo Push" })),
      ).workout?.plan_version_id,
    ).toBeNull();
  });
  it.each([
    { plan_version_id: "unknown" },
    { plan_version_id: "fixture-plan-v1", session_id: "wrong" },
    { session_id: "fixture-push" },
    { timezone: "Never/Exists" },
    { workout_date_local: "2026-02-30" },
  ])("rejects invalid plan/date/timezone %j", async (extra) => {
    const r = createFixtureLogging();
    code(await r.service.startWorkout(startInput(extra)), "VALIDATION_ERROR");
    expect((await r.repository.read()).workouts).toHaveLength(0);
  });
  it("replays identical request and rejects changed payload or operation", async () => {
    const r = createFixtureLogging(),
      a = await r.service.startWorkout(startInput());
    const b = await r.service.startWorkout(startInput());
    expect(b.replayed).toBe(true);
    expect(b.result).toEqual(a.result);
    code(
      await r.service.startWorkout(startInput({ session_name: "Changed" })),
      "DUPLICATE_OPERATION",
    );
    code(
      await r.service.cancelWorkout({
        request_id: "start",
        workout_id: a.result!.workout!.workout_id,
        expected_row_revision: 1,
      }),
      "DUPLICATE_OPERATION",
    );
    expect((await r.repository.read()).workouts).toHaveLength(1);
  });
});

describe("sets and execution semantics", () => {
  it("writes three distinct rows atomically, preserves actual numbers and snapshots", async () => {
    const r = await running();
    const result = ok(
      await r.service.logWorkoutSets({
        request_id: "batch",
        workout_id: r.workout.workout_id,
        sets: [
          setInput({ load_kg: 60, reps: 10 }),
          setInput({ load_kg: 70, reps: 8 }),
          setInput({ load_kg: 70.123456789, reps: 7 }),
        ],
      }),
    );
    expect(result.sets.map((s) => s.set_number)).toEqual([1, 2, 3]);
    expect(new Set(result.sets.map((s) => s.set_id)).size).toBe(3);
    expect(result.sets[2]).toMatchObject({
      load_kg: 70.123456789,
      exercise_name_snapshot: "Demo Bankdrücken",
      row_revision: 1,
    });
    expect(Object.keys(result.sets[0])).not.toContain("volume");
    expect((await r.repository.read()).sets).toEqual(result.sets);
  });
  it.each([
    setInput({ exercise_id: "missing" }),
    setInput({ reps: -1 }),
    setInput({ load_kg: -2 }),
    setInput({ execution_mode: "unilateral", side: "both" }),
    setInput({ reps_basis: "per_side" }),
    setInput({
      execution_mode: "unilateral",
      side: "right",
      implement_count: 2,
    }),
    setInput({
      execution_mode: "alternating",
      side: "alternating",
      implement_count: 3,
    }),
    setInput({ rpe: 11 }),
    setInput({ rir: -1 }),
    setInput({ load_kg: null }),
    setInput({ plan_item_id: "wrong" }),
  ])("rejects entire batch without any partial rows %j", async (bad) => {
    const r = await running();
    const response = await r.service.logWorkoutSets({
      request_id: "bad",
      workout_id: r.workout.workout_id,
      sets: [setInput(), bad],
    });
    expect(response.ok).toBe(false);
    expect((await r.repository.read()).sets).toHaveLength(0);
  });
  it("rejects missing workout and retired exercises", async () => {
    const r = await running();
    code(
      await r.service.logWorkoutSets({
        request_id: "bad",
        workout_id: "missing",
        sets: [setInput()],
      }),
      "WORKOUT_NOT_FOUND",
    );
    const d = workoutFixtureDataset(),
      retired = createFixtureLogging(
        ArnoldDatasetSchema.parse({
          ...d,
          exercises: d.exercises.map((e) => ({ ...e, status: "retired" })),
        }),
      );
    const w = ok(await retired.service.startWorkout(startInput())).workout!;
    code(
      await retired.service.logWorkoutSets({
        request_id: "retired",
        workout_id: w.workout_id,
        sets: [setInput()],
      }),
      "EXERCISE_NOT_FOUND",
    );
  });
  it.each([
    {
      load_basis: "per_implement",
      load_kg: 20,
      implement_count: 2,
      expected: 400,
    },
    {
      load_basis: "per_implement",
      load_kg: 20,
      execution_mode: "unilateral",
      side: "right",
      expected: 200,
    },
    {
      load_basis: "per_implement",
      load_kg: 20,
      implement_count: 2,
      execution_mode: "alternating",
      side: "alternating",
      reps_basis: "per_side",
      expected: 400,
    },
    {
      load_basis: "per_implement",
      load_kg: 20,
      implement_count: 2,
      execution_mode: "alternating",
      side: "alternating",
      reps_basis: "total",
      expected: 200,
    },
  ])(
    "shares Analytics conventions without weight conversion %j",
    async ({ expected, ...spec }) => {
      const r = await running();
      const saved = ok(
        await r.service.logWorkoutSets({
          request_id: "sets",
          workout_id: r.workout.workout_id,
          sets: [setInput(spec)],
        }),
      );
      expect(saved.sets[0].load_kg).toBe(20);
      ok(
        await r.service.completeWorkout({
          request_id: "done",
          workout_id: r.workout.workout_id,
          expected_row_revision: 1,
        }),
      );
      expect(
        buildArnoldDashboardAnalytics(await r.repository.read()).volume
          .nominal_volume.value,
      ).toBe(expected);
    },
  );
  it("keeps left/right rows separate with the same set number; warmups and spontaneous work are valid", async () => {
    const r = await running();
    const saved = ok(
      await r.service.logWorkoutSets({
        request_id: "sets",
        workout_id: r.workout.workout_id,
        sets: [
          setInput({
            execution_mode: "unilateral",
            side: "left",
            set_number: 1,
          }),
          setInput({
            execution_mode: "unilateral",
            side: "right",
            set_number: 1,
          }),
          setInput({ set_type: "warmup", plan_item_id: null }),
        ],
      }),
    );
    expect(saved.sets).toHaveLength(3);
    expect(saved.sets[0].set_id).not.toBe(saved.sets[1].set_id);
  });
  it.each([null, 0])(
    "accepts bodyweight convention load=%j",
    async (load_kg) => {
      const r = await running();
      ok(
        await r.service.logWorkoutSets({
          request_id: "body",
          workout_id: r.workout.workout_id,
          sets: [setInput({ load_basis: "bodyweight_only", load_kg })],
        }),
      );
    },
  );
  it("checks planned exercise/session and sequence conflicts", async () => {
    const r = createFixtureLogging();
    const w = ok(
      await r.service.startWorkout(startInput({ session_name: "Demo Push" })),
    ).workout!;
    code(
      await r.service.logWorkoutSets({
        request_id: "wrong",
        workout_id: w.workout_id,
        sets: [setInput({ plan_item_id: "fixture-item-2" })],
      }),
      "VALIDATION_ERROR",
    );
    ok(
      await r.service.logWorkoutSets({
        request_id: "good",
        workout_id: w.workout_id,
        sets: [setInput({ plan_item_id: "fixture-item-1" })],
      }),
    );
    code(
      await r.service.logWorkoutSets({
        request_id: "duplicate-number",
        workout_id: w.workout_id,
        sets: [setInput({ set_number: 1 })],
      }),
      "VALIDATION_ERROR",
    );
    code(
      await r.service.logWorkoutSets({
        request_id: "wrong-order",
        workout_id: w.workout_id,
        sets: [setInput({ exercise_order: 5 })],
      }),
      "VALIDATION_ERROR",
    );
  });
});

describe("corrections, tombstones and lifecycle", () => {
  it("corrects stable ID, increments revision, preserves creation time, rejects stale/ambiguous IDs", async () => {
    const r = await withSet();
    const updated = ok(
      await r.service.updateSet({
        request_id: "update",
        set_id: r.set.set_id,
        expected_row_revision: 1,
        changes: { load_kg: 75 },
      }),
    ).sets[0];
    expect(updated).toMatchObject({
      set_id: r.set.set_id,
      created_at_utc: r.set.created_at_utc,
      row_revision: 2,
      load_kg: 75,
    });
    code(
      await r.service.updateSet({
        request_id: "stale",
        set_id: r.set.set_id,
        expected_row_revision: 1,
        changes: { reps: 5 },
      }),
      "REVISION_CONFLICT",
    );
    code(
      await r.service.updateSet({
        request_id: "missing",
        set_id: "last bench",
        expected_row_revision: 1,
        changes: { reps: 5 },
      }),
      "SET_NOT_FOUND",
    );
    expect((r.audit as InMemoryAuditLog).events.size).toBe(3);
  });
  it("voids without deletion, retries idempotently and rejects later mutations", async () => {
    const r = await withSet();
    const input = {
      request_id: "void",
      set_id: r.set.set_id,
      expected_row_revision: 1,
    };
    const a = ok(await r.service.voidSet(input));
    expect(a.sets[0]).toMatchObject({ status: "voided", row_revision: 2 });
    expect((await r.service.voidSet(input)).replayed).toBe(true);
    expect((await r.repository.read()).sets).toHaveLength(1);
    code(
      await r.service.updateSet({
        request_id: "revive",
        set_id: r.set.set_id,
        expected_row_revision: 2,
        changes: { reps: 9 },
      }),
      "INVALID_STATUS_TRANSITION",
    );
    code(
      await r.service.completeWorkout({
        request_id: "done",
        workout_id: r.workout.workout_id,
        expected_row_revision: 1,
      }),
      "VALIDATION_ERROR",
    );
  });
  it("completes and replays completion, then permits only explicit authorized corrections", async () => {
    const r = await withSet();
    const input = {
      request_id: "done",
      workout_id: r.workout.workout_id,
      expected_row_revision: 1,
    };
    expect(ok(await r.service.completeWorkout(input)).workout).toMatchObject({
      status: "completed",
      row_revision: 2,
      ended_at_utc: null,
    });
    expect((await r.service.completeWorkout(input)).replayed).toBe(true);
    code(
      await r.service.updateSet({
        request_id: "silent",
        set_id: r.set.set_id,
        expected_row_revision: 1,
        changes: { load_kg: 75 },
      }),
      "INVALID_STATUS_TRANSITION",
    );
    ok(
      await r.service.updateSet({
        request_id: "authorized",
        set_id: r.set.set_id,
        expected_row_revision: 1,
        changes: { load_kg: 75 },
        correct_completed: true,
        correction_reason: "Tippfehler",
      }),
    );
    const analytics = buildArnoldDashboardAnalytics(await r.repository.read());
    expect(analytics.volume.nominal_volume.value).toBe(750);
    expect(JSON.stringify(analytics.records)).toContain("75");
    ok(
      await r.service.voidSet({
        request_id: "void-completed",
        set_id: r.set.set_id,
        expected_row_revision: 2,
        correct_completed: true,
        correction_reason: "Doppelter Satz",
      }),
    );
    expect(
      buildArnoldDashboardAnalytics(await r.repository.read()).volume
        .nominal_volume.value,
    ).toBe(0);
    expect(
      [...(r.audit as InMemoryAuditLog).events.values()].at(-1)
        ?.correction_reason,
    ).toBe("Doppelter Satz");
  });
  it("cancels without deleting sets and excludes from completed analytics", async () => {
    const r = await withSet();
    ok(
      await r.service.cancelWorkout({
        request_id: "cancel",
        workout_id: r.workout.workout_id,
        expected_row_revision: 1,
      }),
    );
    expect((await r.repository.read()).sets).toHaveLength(1);
    expect(
      buildArnoldDashboardAnalytics(await r.repository.read()).activity
        .completed_workouts.value,
    ).toBe(0);
    code(
      await r.service.completeWorkout({
        request_id: "done",
        workout_id: r.workout.workout_id,
        expected_row_revision: 2,
      }),
      "INVALID_STATUS_TRANSITION",
    );
    code(
      await r.service.logWorkoutSets({
        request_id: "after",
        workout_id: r.workout.workout_id,
        sets: [setInput()],
      }),
      "INVALID_STATUS_TRANSITION",
    );
  });
  it("rejects empty completion and stale workout revisions", async () => {
    const r = await running();
    code(
      await r.service.completeWorkout({
        request_id: "empty",
        workout_id: r.workout.workout_id,
        expected_row_revision: 1,
      }),
      "VALIDATION_ERROR",
    );
    code(
      await r.service.cancelWorkout({
        request_id: "stale",
        workout_id: r.workout.workout_id,
        expected_row_revision: 4,
      }),
      "REVISION_CONFLICT",
    );
  });
});

describe("catalog and safety modes", () => {
  const exercise = {
    request_id: "exercise",
    name_de: "Demo Bulgarian Split Squat",
    family_key: "squat",
    variant_key: "bulgarian",
    equipment: "Kurzhantel",
    primary_muscle: "Beine",
    default_load_basis: "per_implement",
    default_execution_mode: "unilateral",
    default_implement_count: 1,
  };
  it("creates a variant and audit event without modifying plans", async () => {
    const r = createFixtureLogging(),
      before = await r.repository.read();
    expect(ok(await r.service.createExercise(exercise)).exercise).toMatchObject(
      { status: "active", row_revision: 1 },
    );
    expect((await r.repository.read()).plans).toEqual(before.plans);
    code(
      await r.service.createExercise({ ...exercise, request_id: "again" }),
      "EXERCISE_MATCH_FOUND",
    );
  });
  it("detects normalized name variants", async () => {
    const r = createFixtureLogging();
    code(
      await r.service.createExercise({
        ...exercise,
        name_de: "DEMO  Bankdrücken",
      }),
      "EXERCISE_MATCH_FOUND",
    );
  });
  it("defaults closed and refuses production/test_sheet from env even with MCP_ACCESS private", () => {
    expect(writeModeFromEnv({})).toBe("disabled");
    for (const mode of ["production", "test_sheet", "invalid", "fixture"])
      expect(() =>
        writeModeFromEnv({ ARNOLD_WRITE_MODE: mode, MCP_ACCESS: "private" }),
      ).toThrow();
    expect(
      writeModeFromEnv({
        ARNOLD_WRITE_MODE: "fixture",
        STORAGE_MODE: "arnold_fixture",
      }),
    ).toBe("fixture");
  });
  it("requires identity and tracker permission even through the application service", async () => {
    const r = createFixtureLogging();
    const service = new WorkoutLoggingService({
      mode: "fixture",
      trackerId: "arnold-fixture-tracker",
      repository: r.repository,
      ledger: r.ledger,
      audit: r.audit,
      coordinator: new InProcessWriteCoordinator(),
      authorization: new DenyAuthorizationGuard(),
      invalidate() {},
    });
    code(await service.startWorkout(startInput()), "AUTH_REQUIRED");
    const foreign = new WorkoutLoggingService({
      mode: "fixture",
      trackerId: "foreign",
      repository: r.repository,
      ledger: r.ledger,
      audit: r.audit,
      coordinator: new InProcessWriteCoordinator(),
      authorization: new FixtureAuthorizationGuard("foreign"),
      invalidate() {},
    });
    code(await foreign.startWorkout(startInput()), "PERMISSION_DENIED");
  });
  it("rejects template repository and mismatched/production modes", async () => {
    const d = workoutFixtureDataset(),
      config = {
        ...d.config,
        file_role: "MASTER_TEMPLATE",
        tracker_id: "TEMPLATE_UNASSIGNED",
      };
    const master = ArnoldDatasetSchema.parse({
      ...d,
      config,
      configEntries: Object.entries(config).map(([key, value]) => ({
        key,
        value,
        description: null,
      })),
      plans: [],
      planItems: [],
    });
    code(
      await createFixtureLogging(master).service.startWorkout(startInput()),
      "TEMPLATE_WRITE_FORBIDDEN",
    );
    const r = createFixtureLogging();
    expect(
      () =>
        new WorkoutLoggingService({
          mode: "production",
          trackerId: "x",
          repository: r.repository,
          ledger: r.ledger,
          audit: r.audit,
          coordinator: new InProcessWriteCoordinator(),
          authorization: new DenyAuthorizationGuard(),
          invalidate() {},
        }),
    ).toThrow();
  });
});

describe("idempotency, concurrency and recovery", () => {
  it("serializes parallel identical and distinct requests; same payload with new ID is independent", async () => {
    const r = await running(),
      base = {
        request_id: "same",
        workout_id: r.workout.workout_id,
        sets: [setInput()],
      };
    const results = await Promise.all([
      r.service.logWorkoutSets(base),
      r.service.logWorkoutSets(base),
    ]);
    results.forEach(ok);
    expect(results.filter((r) => r.replayed)).toHaveLength(1);
    const different = await Promise.all([
      r.service.logWorkoutSets({ ...base, request_id: "a" }),
      r.service.logWorkoutSets({ ...base, request_id: "b" }),
    ]);
    different.forEach(ok);
    expect((await r.repository.read()).sets.map((s) => s.set_number)).toEqual([
      1, 2, 3,
    ]);
  });
  it("allows only one parallel update of a revision", async () => {
    const r = await withSet(),
      base = {
        set_id: r.set.set_id,
        expected_row_revision: 1,
        changes: { load_kg: 75 },
      };
    const results = await Promise.all([
      r.service.updateSet({ ...base, request_id: "a" }),
      r.service.updateSet({ ...base, request_id: "b" }),
    ]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.find((r) => !r.ok)?.error?.code).toBe("REVISION_CONFLICT");
  });
  it("reconciles response loss after commit without appending a second entity", async () => {
    const repo = new InMemoryArnoldWriteRepository(workoutFixtureDataset());
    let calls = 0;
    const wrapper: ArnoldWriteRepository = {
      kind: "fixture",
      read: () => repo.read(),
      async apply(changes) {
        calls++;
        await repo.apply(changes);
        throw new WriteError("COMMIT_STATUS_UNKNOWN", "lost");
      },
    };
    const svc = custom(wrapper);
    const a = await svc.startWorkout(startInput());
    ok(a);
    const b = await svc.startWorkout(startInput());
    expect(b.replayed).toBe(true);
    expect(calls).toBe(1);
  });
  it("survives a process restart with the local durable prepared journal after ledger acknowledgement failure", async () => {
    const dir = await mkdtemp(join(tmpdir(), "arnold-ledger-"));
    try {
      const file = join(dir, "operations.json"),
        durable = new FileOperationLedger(file),
        repo = new InMemoryArnoldWriteRepository(workoutFixtureDataset());
      const failing: OperationLedger = {
        durability: "local",
        get: (...args) => durable.get(...args),
        pending: (t) => durable.pending(t),
        async save(e) {
          if (e.state === "committed") throw Error("ack lost");
          await durable.save(e);
        },
      };
      code(
        await custom(repo, failing).startWorkout(startInput()),
        "COMMIT_STATUS_UNKNOWN",
      );
      expect((await repo.read()).workouts).toHaveLength(1);
      const restarted = custom(repo, new FileOperationLedger(file));
      const response = await restarted.startWorkout(startInput());
      ok(response);
      expect(response.replayed).toBe(true);
      expect((await repo.read()).workouts).toHaveLength(1);
      expect((await restarted.startWorkout(startInput())).replayed).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
  it("blocks all new writes when timeout remains ambiguous even if no rows are visible", async () => {
    const repo = new InMemoryArnoldWriteRepository(workoutFixtureDataset());
    let calls = 0;
    const wrapper: ArnoldWriteRepository = {
      kind: "fixture",
      read: () => repo.read(),
      async apply() {
        calls++;
        throw new WriteError("COMMIT_STATUS_UNKNOWN", "timeout");
      },
    };
    const svc = custom(wrapper);
    code(await svc.startWorkout(startInput()), "COMMIT_STATUS_UNKNOWN");
    code(await svc.startWorkout(startInput()), "COMMIT_STATUS_UNKNOWN");
    code(
      await svc.startWorkout(startInput({ request_id: "different" })),
      "COMMIT_STATUS_UNKNOWN",
    );
    expect(calls).toBe(1);
  });
  it("does not dispatch when preparing the ledger fails", async () => {
    const repo = new InMemoryArnoldWriteRepository(workoutFixtureDataset());
    const ledger = new InMemoryOperationLedger();
    ledger.save = async () => {
      throw Error("disk full");
    };
    code(
      await custom(repo, ledger).startWorkout(startInput()),
      "STORAGE_UNAVAILABLE",
    );
    expect((await repo.read()).workouts).toHaveLength(0);
  });
  it("does not announce success until audit persistence is confirmed", async () => {
    const repo = new InMemoryArnoldWriteRepository(workoutFixtureDataset()),
      ledger = new InMemoryOperationLedger(),
      audit = new InMemoryAuditLog();
    audit.append = async () => {
      throw Error("audit unavailable");
    };
    code(
      await custom(repo, ledger, audit).startWorkout(startInput()),
      "COMMIT_STATUS_UNKNOWN",
    );
    const repaired = custom(repo, ledger);
    const replay = await repaired.startWorkout(startInput());
    ok(replay);
    expect(replay.replayed).toBe(true);
    expect((await repo.read()).workouts).toHaveLength(1);
  });
});

describe("additional safety boundaries", () => {
  it("blocks partial storage outcomes and leaves the whole tracker closed", async () => {
    const repo = new InMemoryArnoldWriteRepository(workoutFixtureDataset()),
      base = custom(repo);
    const w = ok(await base.startWorkout(startInput())).workout!;
    let dispatches = 0;
    const partial: ArnoldWriteRepository = {
      kind: "fixture",
      read: () => repo.read(),
      async apply(changes) {
        dispatches++;
        await repo.apply(changes.slice(0, 1));
        throw new WriteError("COMMIT_STATUS_UNKNOWN", "partial");
      },
    };
    const service = custom(partial),
      input = {
        request_id: "partial",
        workout_id: w.workout_id,
        sets: [setInput(), setInput()],
      };
    code(await service.logWorkoutSets(input), "COMMIT_STATUS_UNKNOWN");
    code(await service.logWorkoutSets(input), "COMMIT_STATUS_UNKNOWN");
    code(
      await service.startWorkout(startInput({ request_id: "after-partial" })),
      "COMMIT_STATUS_UNKNOWN",
    );
    expect(dispatches).toBe(1);
    expect((await repo.read()).sets).toHaveLength(1);
  });
  it("cannot correct a completed workout without the separate permission", async () => {
    const r = await withSet();
    ok(
      await r.service.completeWorkout({
        request_id: "done",
        workout_id: r.workout.workout_id,
        expected_row_revision: 1,
      }),
    );
    const guard = {
      async authorize(trackerId: string) {
        return {
          subject: "synthetic-fixture",
          trackerId,
          permissions: ["write"] as const,
          verified: true as const,
          kind: "fixture" as const,
        };
      },
    };
    const service = new WorkoutLoggingService({
      mode: "fixture",
      trackerId: "arnold-fixture-tracker",
      repository: r.repository,
      ledger: r.ledger,
      audit: r.audit,
      authorization: guard,
      coordinator: new InProcessWriteCoordinator(),
      invalidate() {},
    });
    code(
      await service.updateSet({
        request_id: "forbidden",
        set_id: r.set.set_id,
        expected_row_revision: 1,
        changes: { load_kg: 75 },
        correct_completed: true,
        correction_reason: "typo",
      }),
      "PERMISSION_DENIED",
    );
    expect((await r.repository.read()).sets[0].load_kg).toBe(70);
  });
  it("persists numeric before/after audit values without copying free-text notes", async () => {
    const r = await withSet();
    ok(
      await r.service.updateSet({
        request_id: "audit",
        set_id: r.set.set_id,
        expected_row_revision: 1,
        changes: { load_kg: 75, notes: "private synthetic note" },
      }),
    );
    const event = [...(r.audit as InMemoryAuditLog).events.values()].at(-1)!;
    expect(event.changes.load_kg).toEqual({ before: 70, after: 75 });
    expect(JSON.stringify(event)).not.toContain("private synthetic note");
    expect(event.changed_fields).toContain("notes");
  });
  it("rejects mismatched local start dates and backwards end timestamps", async () => {
    const r = createFixtureLogging();
    code(
      await r.service.startWorkout(
        startInput({ started_at_utc: "2026-10-21T12:00:00Z" }),
      ),
      "VALIDATION_ERROR",
    );
    const w = ok(
      await r.service.startWorkout(
        startInput({ started_at_utc: "2026-10-20T12:00:00Z" }),
      ),
    ).workout!;
    ok(
      await r.service.logWorkoutSets({
        request_id: "sets",
        workout_id: w.workout_id,
        sets: [setInput()],
      }),
    );
    code(
      await r.service.completeWorkout({
        request_id: "backwards",
        workout_id: w.workout_id,
        expected_row_revision: 1,
        ended_at_utc: "2026-10-20T11:00:00Z",
      }),
      "VALIDATION_ERROR",
    );
  });
  it("rejects a lost committed dataset instead of claiming that missing rows remain stored", async () => {
    const r = createFixtureLogging();
    ok(await r.service.startWorkout(startInput()));
    const empty = new InMemoryArnoldWriteRepository(workoutFixtureDataset());
    code(
      await custom(empty, r.ledger).startWorkout(startInput()),
      "COMMIT_STATUS_UNKNOWN",
    );
  });
  it("replays a prior result after a later authorized correction without reverting it", async () => {
    const r = await withSet();
    ok(
      await r.service.updateSet({
        request_id: "correct",
        set_id: r.set.set_id,
        expected_row_revision: 1,
        changes: { load_kg: 80 },
      }),
    );
    const replay = await r.service.logWorkoutSets({
      request_id: "sets",
      workout_id: r.workout.workout_id,
      sets: [setInput()],
    });
    expect(replay.replayed).toBe(true);
    expect(replay.result?.sets[0].load_kg).toBe(70);
    expect((await r.repository.read()).sets[0].load_kg).toBe(80);
  });
});
