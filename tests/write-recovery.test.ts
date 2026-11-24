/**
 * B3: every failed write or setup call says what to do next.
 *
 * Writes are one store transaction: they are stored completely or not at
 * all, and a retry with the same request_id is always safe (a stored write is
 * replayed, a missing one is written).
 */
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  FixtureAuthorizationGuard,
  InMemoryArnoldStore,
  WriteError,
  type ArnoldStore,
} from "../src/server/workout/infrastructure";
import { WorkoutLoggingService } from "../src/server/workout/service";
import { TrainingPlanService } from "../src/server/plan/service";
import { planFixtureDataset } from "../src/server/plan/fixture";
import { createFixtureOnboarding } from "../src/server/onboarding/fixture";
import { accountToolFailure } from "../src/server/account/mcp-account";
import { DeletionConfirmationError } from "../src/server/account/deletion";
import { OnboardingErrorCodeSchema } from "../src/shared/onboarding-contract";
import { PlanErrorCodeSchema } from "../src/shared/plan-contract";
import { WriteErrorCodeSchema } from "../src/shared/workout-contract";
import { RecoverySchema, recoveryFor } from "../src/shared/write-recovery";
import { session } from "./fixtures/arnold-plan";

const start = {
  request_id: "original",
  workout_date_local: "2026-10-20",
  timezone: "Europe/Berlin",
  session_name: "Recovery",
};

/**
 * How the next write fails, once:
 *  - `unreachable`: the store refuses before anything happens;
 *  - `before_commit`: the work runs, then the connection drops before the
 *    commit, so nothing is stored;
 *  - `lost_answer`: the commit succeeds, but the answer never arrives.
 */
type Fault = "unreachable" | "before_commit" | "lost_answer";

function setup() {
  const dataset = planFixtureDataset();
  const memory = new InMemoryArnoldStore(dataset);
  let fault: Fault | undefined;
  const store: ArnoldStore = {
    kind: "fixture",
    audit: memory.audit,
    read: () => memory.read(),
    hasOperation: (id) => memory.hasOperation(id),
    async write(work) {
      const next = fault;
      fault = undefined;
      if (next === "unreachable")
        throw new WriteError("STORAGE_UNAVAILABLE", "Nicht erreichbar.", true);
      if (next === "before_commit")
        return memory.write(async (tx) => {
          await work(tx);
          throw new Error("connection lost");
        });
      const result = await memory.write(work);
      if (next === "lost_answer") throw new Error("socket hang up");
      return result;
    },
  };
  const options = {
    mode: "fixture" as const,
    trackerId: dataset.config.tracker_id,
    store,
    authorization: new FixtureAuthorizationGuard(dataset.config.tracker_id),
    clock: () => new Date("2026-10-27T12:00:00Z"),
  };
  return {
    memory,
    failNext: (next: Fault) => {
      fault = next;
    },
    plans: new TrainingPlanService(options),
    workouts: new WorkoutLoggingService(options),
  };
}
type Runtime = ReturnType<typeof setup>;

const send = (r: Runtime, domain: "plan" | "workout", request = "original") =>
  domain === "plan"
    ? r.plans.execute("create_training_plan", {
        request_id: request,
        name: "Recovery",
        sessions: [session("Recovery")],
      })
    : r.workouts.startWorkout({ ...start, request_id: request });

for (const domain of ["plan", "workout"] as const)
  describe(`${domain} service: recovery on every failure`, () => {
    for (const fault of ["unreachable", "before_commit"] as const)
      it(`stores nothing when the store fails (${fault}) and the same request works later`, async () => {
        const r = setup();
        const before = await r.memory.read();
        r.failNext(fault);
        const denied = await send(r, domain);
        expect(denied.ok).toBe(false);
        expect(denied.error).toMatchObject({
          code: "STORAGE_UNAVAILABLE",
          recovery: "retry_same_request",
          retryable: true,
        });
        expect(await r.memory.read()).toEqual(before);
        expect(r.memory.operations.size).toBe(0);
        const retried = await send(r, domain);
        expect(retried.ok).toBe(true);
        expect(retried.replayed).toBe(false);
        expect((await send(r, domain)).replayed).toBe(true);
        expect(r.memory.operations.size).toBe(1);
      });

    it("a lost answer is replayed on retry, never stored twice", async () => {
      const r = setup();
      r.failNext("lost_answer");
      const first = await send(r, domain);
      expect(first.error).toMatchObject({
        code: "STORAGE_UNAVAILABLE",
        recovery: "retry_same_request",
      });
      const stored = await r.memory.read();
      const recovered = await send(r, domain);
      expect(recovered.ok).toBe(true);
      expect(recovered.replayed).toBe(true);
      expect(await r.memory.read()).toEqual(stored);
      expect(r.memory.operations.size).toBe(1);
    });

    it("invalid input needs no retry", async () => {
      const r = setup();
      const refused =
        domain === "plan"
          ? await r.plans.execute("create_training_plan", {
              request_id: "bad",
              name: "",
              sessions: [],
            })
          : await r.workouts.startWorkout({ request_id: "bad" });
      expect(refused.error).toMatchObject({
        code: "VALIDATION_ERROR",
        recovery: "none",
      });
    });
  });

describe("plan service: a stale revision asks to reload", () => {
  it("returns reload_then_retry for REVISION_CONFLICT", async () => {
    const r = setup();
    const created = await r.plans.execute("create_training_plan", {
      request_id: "original",
      name: "Recovery",
      sessions: [session("Recovery")],
    });
    expect(created.ok).toBe(true);
    const plan = created.result!.plan!.version;
    const stale = await r.plans.execute("update_plan_draft", {
      request_id: "stale",
      plan_version_id: plan.plan_version_id,
      expected_row_revision: plan.row_revision + 5,
      edits: [{ type: "update_plan_metadata", name: "Neu" }],
    });
    expect(stale.error).toMatchObject({
      code: "REVISION_CONFLICT",
      recovery: "reload_then_retry",
    });
  });
});

describe("onboarding service: recovery on every failure", () => {
  it("an expired setup must be started over", async () => {
    let now = new Date("2026-05-01T10:00:00Z");
    const service = createFixtureOnboarding({
      sessionTtlMs: 60_000,
      clock: () => now,
    }).onboarding;
    const started = await service.startOnboarding({ request_id: randomUUID() });
    const claim = {};
    now = new Date("2026-05-01T11:00:00Z");
    const refused = await service.updateProfile({
      request_id: randomUUID(),
      ...claim,
      profile: { training: { days_per_week: 3 } },
    });
    expect(refused.error).toMatchObject({
      code: "SESSION_EXPIRED",
      recovery: "start_over",
    });
  });

  it("a wrong session secret needs no retry", async () => {
    const service = createFixtureOnboarding().onboarding;
    const started = await service.startOnboarding({ request_id: randomUUID() });
    const refused = await service.updateProfile({
      request_id: randomUUID(),
      onboarding_session_id: started.state!.session.onboarding_session_id,
      session_token: "x".repeat(43),
      profile: { training: { days_per_week: 3 } },
    });
    expect(refused.ok).toBe(false);
    expect(RecoverySchema.parse(refused.error!.recovery)).toBe(
      recoveryFor(refused.error!.code, refused.error!.retryable),
    );
  });
});

describe("account tools: recovery on every failure", () => {
  const meta = (result: ReturnType<typeof accountToolFailure>) =>
    result._meta.arnold;

  it("asks to start the deletion over for an invalid confirmation", () => {
    expect(meta(accountToolFailure(new DeletionConfirmationError()))).toEqual({
      code: "CONFIRMATION_INVALID",
      retryable: false,
      recovery: "start_over",
    });
  });

  it("reports an unknown failure without its message", () => {
    const result = accountToolFailure(new Error("geheimer Datenbanktext"));
    expect(meta(result)).toMatchObject({
      code: "STORAGE_UNAVAILABLE",
      recovery: "retry_same_request",
    });
    expect(result.content[0].text).not.toContain("geheimer");
  });
});

describe("every error code has a valid next step", () => {
  it.each([
    ...WriteErrorCodeSchema.options,
    ...PlanErrorCodeSchema.options,
    ...OnboardingErrorCodeSchema.options,
  ])("%s", (code) => {
    for (const retryable of [true, false])
      expect(
        RecoverySchema.safeParse(recoveryFor(code, retryable)).success,
      ).toBe(true);
  });
});
