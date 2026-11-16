import { describe, expect, it } from "vitest";
import {
  createFixtureLogging,
  workoutFixtureDataset,
  writeModeFromEnv,
} from "../src/server/workout/fixture";
import { WorkoutLoggingService } from "../src/server/workout/service";
import {
  DenyAuthorizationGuard,
  FixtureAuthorizationGuard,
  InMemoryArnoldStore,
  InMemoryAuditLog,
  WriteError,
  uuid7,
  type ArnoldStore,
  type ArnoldTransaction,
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
function custom(store: ArnoldStore) {
  return new WorkoutLoggingService({
    mode: "fixture",
    trackerId: "arnold-fixture-tracker",
    store,
    authorization: new FixtureAuthorizationGuard("arnold-fixture-tracker"),
  });
}
/** A store whose next write fails once in the given way. */
function faulty(
  memory = new InMemoryArnoldStore(workoutFixtureDataset()),
  fault: "unreachable" | "before_commit" | "lost_answer",
) {
  let pending = true;
  let writes = 0;
  const store: ArnoldStore = {
    kind: "fixture",
    audit: memory.audit,
    read: () => memory.read(),
    hasOperation: (id) => memory.hasOperation(id),
    async write(work) {
      writes++;
      const failing = pending;
      pending = false;
      if (failing && fault === "unreachable")
        throw new WriteError("STORAGE_UNAVAILABLE", "unreachable", true);
      if (failing && fault === "before_commit")
        return memory.write(async (tx) => {
          await work(tx);
          throw new Error("connection lost");
        });
      const result = await memory.write(work);
      if (failing) throw new Error("socket hang up");
      return result;
    },
  };
  return {
    memory,
    store,
    get writes() {
      return writes;
    },
  };
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
    expect((await r.store.read()).workouts).toEqual([w]);
    expect(uuid7()).not.toBe(uuid7());
  });
  it("resolves only an unambiguous active session and preserves plan version", async () => {
    const r = createFixtureLogging();
    const before = await r.store.read();
    const w = ok(
      await r.service.startWorkout(startInput({ session_name: "Demo Push" })),
    ).workout!;
    expect(w).toMatchObject({
      plan_version_id: "fixture-plan-v1",
      session_id: "fixture-push",
    });
    expect((await r.store.read()).plans).toEqual(before.plans);
  });
  it.each([
    { activated: "2026-11-01T00:00:00Z", linked: false },
    { activated: "2026-10-20T00:00:00Z", linked: true },
    { activated: "2026-10-19T00:00:00Z", linked: true },
  ])(
    "only auto-links a plan activated by the workout day: $activated",
    async ({ activated, linked }) => {
      const data = workoutFixtureDataset();
      const r = createFixtureLogging(
        ArnoldDatasetSchema.parse({
          ...data,
          plans: data.plans.map((p) => ({ ...p, activated_at_utc: activated })),
        }),
      );
      const before = await r.store.read();
      const workout = ok(
        await r.service.startWorkout(startInput({ session_name: "Demo Push" })),
      ).workout!;
      expect(workout.plan_version_id).toBe(linked ? "fixture-plan-v1" : null);
      expect(workout.session_id).toBe(linked ? "fixture-push" : null);
      expect((await r.store.read()).plans).toEqual(before.plans);
    },
  );
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
    expect((await r.store.read()).workouts).toHaveLength(0);
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
    expect((await r.store.read()).workouts).toHaveLength(1);
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
    expect((await r.store.read()).sets).toEqual(result.sets);
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
    expect((await r.store.read()).sets).toHaveLength(0);
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
        buildArnoldDashboardAnalytics(await r.store.read()).volume
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
    expect((r.store.audit as InMemoryAuditLog).events.size).toBe(3);
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
    expect((await r.store.read()).sets).toHaveLength(1);
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
    const analytics = buildArnoldDashboardAnalytics(await r.store.read());
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
      buildArnoldDashboardAnalytics(await r.store.read()).volume.nominal_volume
        .value,
    ).toBe(0);
    expect(
      [...(r.store.audit as InMemoryAuditLog).events.values()].at(-1)
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
    expect((await r.store.read()).sets).toHaveLength(1);
    expect(
      buildArnoldDashboardAnalytics(await r.store.read()).activity
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
      before = await r.store.read();
    expect(ok(await r.service.createExercise(exercise)).exercise).toMatchObject(
      { status: "active", row_revision: 1 },
    );
    expect((await r.store.read()).plans).toEqual(before.plans);
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
      store: r.store,
      authorization: new DenyAuthorizationGuard(),
    });
    code(await service.startWorkout(startInput()), "AUTH_REQUIRED");
    const foreign = new WorkoutLoggingService({
      mode: "fixture",
      trackerId: "foreign",
      store: r.store,
      authorization: new FixtureAuthorizationGuard("foreign"),
    });
    code(await foreign.startWorkout(startInput()), "PERMISSION_DENIED");
  });
  it("rejects a template dataset and a mode that does not match the store", async () => {
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
          mode: "database",
          trackerId: "x",
          store: r.store,
          authorization: new DenyAuthorizationGuard(),
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
    expect((await r.store.read()).sets.map((s) => s.set_number)).toEqual([
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
  it("replays a write whose answer was lost after the commit, without a second entity", async () => {
    const f = faulty(undefined, "lost_answer");
    const svc = custom(f.store);
    const a = await svc.startWorkout(startInput());
    expect(a.error).toMatchObject({
      code: "STORAGE_UNAVAILABLE",
      recovery: "retry_same_request",
    });
    const b = await svc.startWorkout(startInput());
    ok(b);
    expect(b.replayed).toBe(true);
    expect((await f.memory.read()).workouts).toHaveLength(1);
    expect(f.memory.operations.size).toBe(1);
  });
  it("recognises a repeated request in a second service over the same store", async () => {
    const store = new InMemoryArnoldStore(workoutFixtureDataset());
    ok(await custom(store).startWorkout(startInput()));
    const restarted = await custom(store).startWorkout(startInput());
    ok(restarted);
    expect(restarted.replayed).toBe(true);
    expect((await store.read()).workouts).toHaveLength(1);
  });
  it("stores nothing when the transaction fails before its commit", async () => {
    const f = faulty(undefined, "before_commit");
    const svc = custom(f.store);
    code(await svc.startWorkout(startInput()), "STORAGE_UNAVAILABLE");
    expect((await f.memory.read()).workouts).toHaveLength(0);
    expect(f.memory.operations.size).toBe(0);
    expect(f.memory.audit.events.size).toBe(0);
    const retried = await svc.startWorkout(startInput());
    ok(retried);
    expect(retried.replayed).toBe(false);
    expect((await f.memory.read()).workouts).toHaveLength(1);
  });
  it("never blocks later writes after a failure", async () => {
    const f = faulty(undefined, "unreachable");
    const svc = custom(f.store);
    code(await svc.startWorkout(startInput()), "STORAGE_UNAVAILABLE");
    ok(await svc.startWorkout(startInput({ request_id: "different" })));
    ok(await svc.startWorkout(startInput()));
    expect((await f.memory.read()).workouts).toHaveLength(2);
  });
});

describe("additional safety boundaries", () => {
  it.each([
    {
      date: "2026-10-20",
      tz: "Europe/Berlin",
      end: "2000-01-01T12:00:00Z",
      valid: false,
    },
    {
      date: "2026-10-20",
      tz: "Europe/Berlin",
      end: "2026-10-19T21:59:59Z",
      valid: false,
    },
    {
      date: "2026-10-20",
      tz: "Europe/Berlin",
      end: "2026-10-19T22:00:00Z",
      valid: true,
    },
    {
      date: "2026-10-20",
      tz: "America/Los_Angeles",
      end: "2026-10-20T06:59:59Z",
      valid: false,
    },
    {
      date: "2026-10-20",
      tz: "America/Los_Angeles",
      end: "2026-10-20T07:00:00Z",
      valid: true,
    },
    {
      date: "2026-10-20",
      tz: "Pacific/Kiritimati",
      end: "2026-10-19T10:00:00Z",
      valid: true,
    },
    {
      date: "2026-03-29",
      tz: "Europe/Berlin",
      end: "2026-03-29T01:30:00Z",
      valid: true,
    },
    {
      date: "2026-10-25",
      tz: "Europe/Berlin",
      end: "2026-10-25T01:30:00Z",
      valid: true,
    },
    {
      date: "2026-10-20",
      tz: "Europe/Berlin",
      end: "2026-10-21T00:30:00Z",
      valid: true,
    },
  ])(
    "validates completion against the local workout day without a start time: $date / $tz / $end",
    async ({ date, tz, end, valid }) => {
      const r = createFixtureLogging();
      const workout = ok(
        await r.service.startWorkout(
          startInput({ workout_date_local: date, timezone: tz }),
        ),
      ).workout!;
      ok(
        await r.service.logWorkoutSets({
          request_id: "sets",
          workout_id: workout.workout_id,
          sets: [setInput()],
        }),
      );
      const before = await r.store.read();
      const result = await r.service.completeWorkout({
        request_id: "complete",
        workout_id: workout.workout_id,
        expected_row_revision: workout.row_revision,
        ended_at_utc: end,
      });
      if (valid) {
        expect(ok(result).workout!.ended_at_utc).toBe(end);
      } else {
        code(result, "VALIDATION_ERROR");
        expect(await r.store.read()).toEqual(before);
      }
    },
  );
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
      store: r.store,
      authorization: guard,
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
    expect((await r.store.read()).sets[0].load_kg).toBe(70);
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
    const event = [...(r.store.audit as InMemoryAuditLog).events.values()].at(
      -1,
    )!;
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
    // A receipt whose rows are gone: the data no longer matches it.
    const empty = new InMemoryArnoldStore(workoutFixtureDataset());
    const mismatched: ArnoldStore = {
      kind: "fixture",
      audit: empty.audit,
      read: () => empty.read(),
      hasOperation: (id) => empty.hasOperation(id),
      write: (work) =>
        empty.write((tx) =>
          work({
            ...tx,
            operation: async (id) => r.store.operations.get(id),
          } satisfies ArnoldTransaction),
        ),
    };
    code(
      await custom(mismatched).startWorkout(startInput()),
      "SCHEMA_MISMATCH",
    );
    expect((await empty.read()).workouts).toHaveLength(0);
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
    expect((await r.store.read()).sets[0].load_kg).toBe(80);
  });
});
