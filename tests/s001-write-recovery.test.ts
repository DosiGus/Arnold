import { describe, expect, it } from "vitest";
import {
  FixtureAuthorizationGuard,
  InMemoryArnoldWriteRepository,
  InMemoryAuditLog,
  InMemoryOperationLedger,
  InProcessWriteCoordinator,
  WriteError,
  RejectedWriteError,
  fingerprint,
  type ArnoldWriteRepository,
  type AuditLogRepository,
  type AuthorizationGuard,
  type EntityChange,
  type OperationLedger,
} from "../src/server/workout/infrastructure";
import { WorkoutLoggingService } from "../src/server/workout/service";
import { TrainingPlanService } from "../src/server/plan/service";
import { planFixtureDataset } from "../src/server/plan/fixture";
import { ArnoldDatasetSchema } from "../src/shared/arnold-schema-v1";
import { session } from "./fixtures/arnold-plan";

export const start = {
  request_id: "start",
  workout_date_local: "2026-10-20",
  timezone: "Europe/Berlin",
  session_name: "S001 free",
};
export const setInput = {
  exercise_id: "plan-fx-bench",
  set_type: "working",
  reps: 10,
  reps_basis: "total",
  load_kg: 50,
  load_basis: "total",
  implement_count: 1,
  execution_mode: "bilateral_simultaneous",
  side: "both",
};
function setup(
  overrides: {
    read?: (
      memory: InMemoryArnoldWriteRepository,
    ) => Promise<ReturnType<typeof planFixtureDataset>>;
    apply?: (
      changes: readonly EntityChange[],
      memory: InMemoryArnoldWriteRepository,
    ) => Promise<void>;
    audit?: AuditLogRepository;
    ledger?: OperationLedger;
    authorization?: AuthorizationGuard;
    clock?: () => Date;
  } = {},
) {
  const dataset = planFixtureDataset();
  const memory = new InMemoryArnoldWriteRepository(dataset);
  const repository: ArnoldWriteRepository = {
    kind: "fixture",
    read: () => (overrides.read ? overrides.read(memory) : memory.read()),
    apply: (changes) =>
      overrides.apply
        ? overrides.apply(changes, memory)
        : memory.apply(changes),
  };
  const ledger = overrides.ledger ?? new InMemoryOperationLedger();
  const audit = overrides.audit ?? new InMemoryAuditLog();
  const coordinator = new InProcessWriteCoordinator();
  const options = {
    mode: "fixture" as const,
    trackerId: dataset.config.tracker_id,
    repository,
    ledger,
    audit,
    coordinator,
    authorization:
      overrides.authorization ??
      new FixtureAuthorizationGuard(dataset.config.tracker_id),
    clock: overrides.clock ?? (() => new Date("2026-10-27T12:00:00Z")),
    invalidate() {},
  };
  return {
    memory,
    repository,
    ledger,
    audit,
    coordinator,
    tracker: dataset.config.tracker_id,
    plans: new TrainingPlanService({ ...options, read: repository.read }),
    workouts: new WorkoutLoggingService(options),
  };
}
type Runtime = ReturnType<typeof setup>;
const createPlan = (r: Runtime, request_id: string, context?: unknown) =>
  r.plans.execute(
    "create_training_plan",
    { request_id, name: "S001", sessions: [session("S001")] },
    context,
  );
const send = (
  r: Runtime,
  domain: "plan" | "workout",
  request = "original",
  context?: unknown,
) =>
  domain === "plan"
    ? createPlan(r, request, context)
    : r.workouts.startWorkout({ ...start, request_id: request }, context);

for (const domain of ["plan", "workout"] as const)
  describe(`${domain}: one recovery protocol`, () => {
    it.each([
      "AUTH_REQUIRED",
      "PERMISSION_DENIED",
      "VALIDATION_ERROR",
    ] as const)(
      "durably rejects %s after intent; same ID and new independent requests can recover",
      async (code) => {
        let reject = true;
        let applied = 0;
        const r = setup({
          apply: async (changes, memory) => {
            if (reject) {
              reject = false;
              throw new RejectedWriteError(
                code,
                "Synthetic definite rejection",
              );
            }
            applied++;
            await memory.apply(changes);
          },
        });
        const before = await r.memory.read();
        const denied = await send(r, domain);
        expect(denied.error).toMatchObject({
          code,
          recovery: "retry_or_new_request",
        });
        expect(await r.memory.read()).toEqual(before);
        expect((await r.ledger.get(r.tracker, "original"))?.state).toBe(
          "rejected",
        );
        expect(await r.ledger.pending(r.tracker)).toHaveLength(0);
        // Another domain can proceed after a *proven* rejection, without finishing it.
        expect(
          (await send(r, domain === "plan" ? "workout" : "plan", "independent"))
            .ok,
        ).toBe(true);
        expect((await send(r, domain)).ok).toBe(true);
        expect((await send(r, domain)).replayed).toBe(true);
        expect(applied).toBe(2);
      },
    );
    it("does not infer rejection proof from a familiar error code", async () => {
      let calls = 0;
      const r = setup({
        apply: async () => {
          calls++;
          throw new WriteError("PERMISSION_DENIED", "No transport proof");
        },
      });
      expect((await send(r, domain)).error).toMatchObject({
        code: "COMMIT_STATUS_UNKNOWN",
        recovery: "retry_same_request",
      });
      expect((await send(r, domain, "other")).error?.code).toBe(
        "COMMIT_STATUS_UNKNOWN",
      );
      expect((await send(r, domain)).error?.code).toBe("COMMIT_STATUS_UNKNOWN");
      expect(calls).toBe(1);
    });
    it("keeps original IDs through a timeout with no visible commit, then reconciles the later commit", async () => {
      let changes: readonly EntityChange[] = [];
      let calls = 0;
      const r = setup({
        apply: async (c) => {
          changes = c;
          calls++;
          throw Error("timeout");
        },
      });
      const first = await send(r, domain);
      expect(first.error?.recovery).toBe("retry_same_request");
      expect(
        (await send(r, domain === "plan" ? "workout" : "plan", "blocked")).error
          ?.code,
      ).toBe("COMMIT_STATUS_UNKNOWN");
      expect((await send(r, domain)).ok).toBe(false);
      expect(calls).toBe(1);
      await r.memory.apply(changes);
      const recovered = await send(r, domain);
      expect(recovered.ok).toBe(true);
      expect(recovered.replayed).toBe(true);
      expect(calls).toBe(1);
      expect(await r.ledger.pending(r.tracker)).toHaveLength(0);
    });
    it("reconciles a committed batch whose transport response is lost without applying it twice", async () => {
      let calls = 0;
      const r = setup({
        apply: async (c, memory) => {
          calls++;
          await memory.apply(c);
          throw Error("lost response");
        },
      });
      expect((await send(r, domain)).ok).toBe(true);
      expect((await send(r, domain)).replayed).toBe(true);
      expect(calls).toBe(1);
    });
    it.each(["audit", "ledger"] as const)(
      "waits for missing %s acknowledgement and deduplicates its audit replay",
      async (phase) => {
        let fail = true;
        let calls = 0;
        const events = new InMemoryAuditLog();
        const disk = new InMemoryOperationLedger();
        const r = setup({
          apply: async (c, memory) => {
            calls++;
            await memory.apply(c);
          },
          audit: {
            append: async (e) => {
              await events.append(e);
              if (phase === "audit" && fail) throw Error("audit ack lost");
            },
          },
          ledger: {
            durability: "memory",
            get: (t, id) => disk.get(t, id),
            pending: (t) => disk.pending(t),
            save: async (e) => {
              if (phase === "ledger" && fail && e.state === "committed")
                throw Error("ledger ack lost");
              await disk.save(e);
            },
          },
        });
        expect((await send(r, domain)).error).toMatchObject({
          code: "COMMIT_STATUS_UNKNOWN",
          recovery: "retry_same_request",
        });
        const size = events.events.size;
        expect(size).toBeGreaterThan(0);
        fail = false;
        expect((await send(r, domain)).ok).toBe(true);
        expect(events.events.size).toBe(size);
        expect(calls).toBe(1);
        expect(
          (await send(r, domain === "plan" ? "workout" : "plan", "next")).ok,
        ).toBe(true);
      },
    );
    it("rejects an unauthenticated caller before intent and allows a fresh authenticated retry", async () => {
      let authorized = false;
      const dataset = planFixtureDataset();
      const fixture = new FixtureAuthorizationGuard(dataset.config.tracker_id);
      const r = setup({
        authorization: {
          authorize: async (...args) => {
            if (!authorized)
              throw new WriteError("AUTH_REQUIRED", "Not authenticated");
            return fixture.authorize(args[0]);
          },
        },
      });
      expect((await send(r, domain)).error).toMatchObject({
        code: "AUTH_REQUIRED",
        recovery: "none",
      });
      expect(await r.ledger.get(r.tracker, "original")).toBeUndefined();
      authorized = true;
      expect((await send(r, domain)).ok).toBe(true);
    });
    it("retains recovery information if authorization is lost while the original intent exists", async () => {
      let authorized = true;
      const dataset = planFixtureDataset();
      const fixture = new FixtureAuthorizationGuard(dataset.config.tracker_id);
      const r = setup({
        apply: async () => {
          throw Error("timeout");
        },
        authorization: {
          authorize: async (...args) => {
            if (!authorized)
              throw new WriteError("PERMISSION_DENIED", "Revoked");
            return fixture.authorize(args[0]);
          },
        },
      });
      expect((await send(r, domain)).error?.code).toBe("COMMIT_STATUS_UNKNOWN");
      authorized = false;
      expect((await send(r, domain)).error).toMatchObject({
        code: "PERMISSION_DENIED",
        recovery: "retry_same_request",
      });
    });
  });

describe("one tracker across plan and workout services", () => {
  it("binds request IDs to payload, operation and actor even after a definitive rejection", async () => {
    const r = setup({
      apply: async () => {
        throw new RejectedWriteError("PERMISSION_DENIED", "Definite");
      },
      authorization: {
        authorize: async (trackerId, _p, context) => ({
          verified: true,
          kind: "fixture",
          subject: String(context),
          trackerId,
          permissions: ["write", "correct_completed"],
        }),
      },
    });
    await createPlan(r, "shared", "actor-a");
    expect(
      (
        await r.workouts.startWorkout(
          { ...start, request_id: "shared" },
          "actor-a",
        )
      ).error?.code,
    ).toBe("DUPLICATE_OPERATION");
    expect((await createPlan(r, "shared", "actor-b")).error?.code).toBe(
      "DUPLICATE_OPERATION",
    );
    expect(
      (
        await r.plans.execute(
          "create_training_plan",
          {
            request_id: "shared",
            name: "Changed",
            sessions: [session("S001")],
          },
          "actor-a",
        )
      ).error?.code,
    ).toBe("DUPLICATE_OPERATION");
  });
  it("never finalizes another actor's unfinished request", async () => {
    let fail = true;
    const audit = new InMemoryAuditLog();
    const r = setup({
      audit: {
        append: async (e) => {
          if (fail) throw Error("not acknowledged");
          await audit.append(e);
        },
      },
      authorization: {
        authorize: async (trackerId, _p, context) => ({
          verified: true,
          kind: "fixture",
          subject: String(context),
          trackerId,
          permissions: ["write", "correct_completed"],
        }),
      },
    });
    expect((await createPlan(r, "owner", "actor-a")).ok).toBe(false);
    fail = false;
    expect(
      (
        await r.workouts.startWorkout(
          { ...start, request_id: "other" },
          "actor-b",
        )
      ).ok,
    ).toBe(false);
    expect(audit.events.size).toBe(0);
    expect((await createPlan(r, "owner", "actor-a")).ok).toBe(true);
  });
  it("validates the domain result when replaying a journal entry", async () => {
    const r = setup();
    await createPlan(r, "entry");
    const entry = (await r.ledger.get(r.tracker, "entry"))!;
    await r.ledger.save({
      ...entry,
      result: { workout: null, exercise: null, sets: [], warnings: [] },
    });
    expect((await createPlan(r, "entry")).error?.code).toBe("SCHEMA_MISMATCH");
  });
  it("serializes activation with workout creation and preserves the running workout's references", async () => {
    const r = setup();
    const draft = (
      await r.plans.execute("create_plan_version", {
        request_id: "clone",
        source_plan_version_id: "pfx-v2",
      })
    ).result!.plan!.version;
    const [activation, workout] = await Promise.all([
      r.plans.execute("activate_training_plan", {
        request_id: "activate",
        plan_version_id: draft.plan_version_id,
        expected_row_revision: draft.row_revision,
        confirmation: {
          plan_version_id: draft.plan_version_id,
          row_revision: draft.row_revision,
          confirmed: true,
        },
      }),
      r.workouts.startWorkout({
        ...start,
        workout_date_local: "2026-10-27",
        session_name: "Push",
      }),
    ]);
    expect(activation.ok).toBe(true);
    expect(workout.ok).toBe(true);
    const data = ArnoldDatasetSchema.parse(await r.memory.read());
    expect(data.plans.filter((p) => p.status === "active")).toHaveLength(1);
    expect(workout.result!.workout!.plan_version_id).toBe(
      draft.plan_version_id,
    );
    const snapshot = workout.result!.workout!;
    const newer = (
      await r.plans.execute("create_plan_version", {
        request_id: "clone2",
        source_plan_version_id: draft.plan_version_id,
      })
    ).result!.plan!.version;
    await r.plans.execute("activate_training_plan", {
      request_id: "act2",
      plan_version_id: newer.plan_version_id,
      expected_row_revision: newer.row_revision,
      confirmation: {
        plan_version_id: newer.plan_version_id,
        row_revision: newer.row_revision,
        confirmed: true,
      },
    });
    expect(
      (await r.memory.read()).workouts.find(
        (w) => w.workout_id === snapshot.workout_id,
      ),
    ).toEqual(snapshot);
  });
  it("serializes draft editing with set correction without lost updates", async () => {
    const r = setup();
    const draft = (await createPlan(r, "draft")).result!.plan!.version;
    const workout = (await r.workouts.startWorkout(start)).result!.workout!;
    const set = (
      await r.workouts.logWorkoutSets({
        request_id: "sets",
        workout_id: workout.workout_id,
        sets: [setInput],
      })
    ).result!.sets[0];
    const [plan, correction] = await Promise.all([
      r.plans.execute("update_plan_draft", {
        request_id: "edit",
        plan_version_id: draft.plan_version_id,
        expected_row_revision: draft.row_revision,
        edits: [
          {
            type: "rename_session",
            session_id: draft.sessions[0].session_id,
            session_name: "Renamed",
          },
        ],
      }),
      r.workouts.updateSet({
        request_id: "fix",
        set_id: set.set_id,
        expected_row_revision: set.row_revision,
        changes: { load_kg: 55 },
      }),
    ]);
    expect(plan.ok).toBe(true);
    expect(correction.ok).toBe(true);
    const data = await r.memory.read();
    expect(data.sets.find((s) => s.set_id === set.set_id)).toMatchObject({
      load_kg: 55,
      row_revision: 2,
    });
    expect(
      data.planItems.find((i) => i.plan_version_id === draft.plan_version_id)
        ?.session_name,
    ).toBe("Renamed");
  });
  it("protects completed corrections with their separate permission", async () => {
    const r = setup({
      authorization: {
        authorize: async (trackerId, permission) => {
          if (permission === "correct_completed")
            throw new WriteError("PERMISSION_DENIED", "Separate right");
          return {
            subject: "writer",
            verified: true,
            kind: "fixture",
            trackerId,
            permissions: ["write"],
          };
        },
      },
    });
    const before = await r.memory.read();
    const set = before.sets[0];
    expect(
      (
        await r.workouts.updateSet({
          request_id: "forbidden",
          set_id: set.set_id,
          expected_row_revision: set.row_revision,
          changes: { load_kg: 99 },
          correct_completed: true,
          correction_reason: "Synthetic correction",
        })
      ).error?.code,
    ).toBe("PERMISSION_DENIED");
    expect(await r.memory.read()).toEqual(before);
  });
});

it.each(["plan", "workout"] as const)(
  "%s: a proven rejection remains recoverable even when the immediate readback is unauthorized",
  async (domain) => {
    let readable = true;
    let reject = true;
    let writes = 0;
    const r = setup({
      read: async (memory) => {
        if (!readable) throw new WriteError("AUTH_REQUIRED", "Read revoked");
        return memory.read();
      },
      apply: async (changes, memory) => {
        writes++;
        if (reject) {
          reject = false;
          readable = false;
          throw new RejectedWriteError("AUTH_REQUIRED", "HTTP 401 rejected");
        }
        await memory.apply(changes);
      },
    });
    const failure = await send(r, domain);
    expect(failure.error).toMatchObject({
      code: "AUTH_REQUIRED",
      recovery: "retry_or_new_request",
    });
    readable = true;
    expect((await send(r, domain)).ok).toBe(true);
    expect(writes).toBe(2);
    expect(await r.ledger.pending(r.tracker)).toHaveLength(0);
  },
);

it.each(["plan", "workout"] as const)(
  "%s: a rejected request can be closed atomically, but its ID cannot be reused",
  async (domain) => {
    let reject = true;
    const r = setup({
      apply: async (c, memory) => {
        if (reject) {
          reject = false;
          throw new RejectedWriteError("PERMISSION_DENIED", "Definite");
        }
        await memory.apply(c);
      },
    });
    await send(r, domain);
    expect(
      (await r.workouts.abandonRejected({ request_id: "original" })).abandoned,
    ).toBe(true);
    expect((await r.ledger.get(r.tracker, "original"))?.state).toBe(
      "abandoned",
    );
    expect(
      (await r.workouts.abandonRejected({ request_id: "original" })).ok,
    ).toBe(true);
    expect((await send(r, domain)).error).toMatchObject({
      code: "DUPLICATE_OPERATION",
      recovery: "none",
    });
    expect((await send(r, domain, "new-independent")).ok).toBe(true);
  },
);
it("refuses abandonment when another caller has already resumed the rejected request into an unknown dispatch", async () => {
  let first = true;
  let started!: () => void;
  let release!: () => void;
  const entered = new Promise<void>((r) => {
    started = r;
  });
  const gate = new Promise<void>((r) => {
    release = r;
  });
  const r = setup({
    apply: async () => {
      if (first) {
        first = false;
        throw new RejectedWriteError("PERMISSION_DENIED", "Definite");
      }
      started();
      await gate;
      throw Error("Unknown resumed dispatch");
    },
  });
  await createPlan(r, "original");
  const retry = createPlan(r, "original");
  await entered;
  const abandoned = r.workouts.abandonRejected({ request_id: "original" });
  release();
  await retry;
  expect((await abandoned).error?.code).toBe("COMMIT_STATUS_UNKNOWN");
  expect((await r.ledger.get(r.tracker, "original"))?.state).toBe(
    "dispatching",
  );
});
it("does not let a different actor abandon a rejected intent", async () => {
  const r = setup({
    apply: async () => {
      throw new RejectedWriteError("PERMISSION_DENIED", "Rejected");
    },
    authorization: {
      authorize: async (trackerId, _p, context) => ({
        verified: true,
        kind: "fixture",
        trackerId,
        subject: String(context),
        permissions: ["write"],
      }),
    },
  });
  await createPlan(r, "original", "actor-a");
  expect(
    (await r.workouts.abandonRejected({ request_id: "original" }, "actor-b"))
      .error?.code,
  ).toBe("PERMISSION_DENIED");
  expect((await r.ledger.get(r.tracker, "original"))?.state).toBe("rejected");
});
