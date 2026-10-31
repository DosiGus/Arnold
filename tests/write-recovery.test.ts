/**
 * B3: every failed write, setup or Google call says what to do next.
 *
 * Adapted from the S001 branch (s001-write-recovery). The recovery protocol of
 * main is kept: a definite rejection goes back to "prepared" and the same
 * request_id may be sent again; an unknown outcome stays bound to its
 * request_id until it can be reconciled.
 */
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  FixtureAuthorizationGuard,
  InMemoryArnoldWriteRepository,
  InMemoryAuditLog,
  InMemoryOperationLedger,
  InProcessWriteCoordinator,
  WriteError,
  type ArnoldWriteRepository,
  type EntityChange,
} from "../src/server/workout/infrastructure";
import { WorkoutLoggingService } from "../src/server/workout/service";
import { TrainingPlanService } from "../src/server/plan/service";
import { planFixtureDataset } from "../src/server/plan/fixture";
import { createFixtureOnboarding } from "../src/server/onboarding/fixture";
import { accountToolFailure } from "../src/server/connected/mcp-google";
import { GoogleConnectionError } from "../src/server/google/connection-service";
import { OnboardingErrorCodeSchema } from "../src/shared/onboarding-contract";
import { PlanErrorCodeSchema } from "../src/shared/plan-contract";
import { WriteErrorCodeSchema } from "../src/shared/workout-contract";
import {
  RECOVERY_HINT,
  RecoverySchema,
  recoveryFor,
} from "../src/shared/write-recovery";
import { session } from "./fixtures/arnold-plan";

const start = {
  request_id: "original",
  workout_date_local: "2026-10-20",
  timezone: "Europe/Berlin",
  session_name: "Recovery",
};

function setup(
  apply?: (
    changes: readonly EntityChange[],
    memory: InMemoryArnoldWriteRepository,
  ) => Promise<void>,
) {
  const dataset = planFixtureDataset();
  const memory = new InMemoryArnoldWriteRepository(dataset);
  const repository: ArnoldWriteRepository = {
    kind: "fixture",
    read: () => memory.read(),
    apply: (changes) =>
      apply ? apply(changes, memory) : memory.apply(changes),
  };
  const ledger = new InMemoryOperationLedger();
  const options = {
    mode: "fixture" as const,
    trackerId: dataset.config.tracker_id,
    repository,
    ledger,
    audit: new InMemoryAuditLog(),
    coordinator: new InProcessWriteCoordinator(),
    authorization: new FixtureAuthorizationGuard(dataset.config.tracker_id),
    clock: () => new Date("2026-10-27T12:00:00Z"),
    invalidate() {},
  };
  return {
    memory,
    plans: new TrainingPlanService({ ...options, read: repository.read }),
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
    it("a definite rejection tells the caller to retry the same request", async () => {
      let reject = true;
      const r = setup(async (changes, memory) => {
        if (reject) {
          reject = false;
          throw new WriteError(
            "STORAGE_UNAVAILABLE",
            "Google-Schreibquote erreicht.",
            true,
          );
        }
        await memory.apply(changes);
      });
      const before = await r.memory.read();
      const denied = await send(r, domain);
      expect(denied.ok).toBe(false);
      expect(denied.error).toMatchObject({
        code: "STORAGE_UNAVAILABLE",
        recovery: "retry_same_request",
      });
      expect(await r.memory.read()).toEqual(before);
      const retried = await send(r, domain);
      expect(retried.ok).toBe(true);
      expect((await send(r, domain)).replayed).toBe(true);
    });

    it("an unknown outcome stays on the same request_id until reconciled", async () => {
      let changes: readonly EntityChange[] = [];
      let calls = 0;
      const r = setup(async (c) => {
        changes = c;
        calls++;
        throw new Error("timeout");
      });
      const first = await send(r, domain);
      expect(first.error).toMatchObject({
        code: "COMMIT_STATUS_UNKNOWN",
        recovery: "retry_same_request",
        retryable: true,
      });
      await r.memory.apply(changes);
      const recovered = await send(r, domain);
      expect(recovered.ok).toBe(true);
      expect(calls).toBe(1);
    });

    it("an expired Google grant asks to reconnect, then the same request works", async () => {
      let expired = true;
      const r = setup(async (changes, memory) => {
        if (expired)
          throw new GoogleConnectionError(
            "GOOGLE_REAUTH_REQUIRED",
            "Der Google-Zugriff wurde widerrufen.",
          );
        await memory.apply(changes);
      });
      const refused = await send(r, domain);
      expect(refused.error).toMatchObject({
        code: "GOOGLE_REAUTH_REQUIRED",
        recovery: "reconnect_google",
        retryable: false,
      });
      expired = false;
      expect((await send(r, domain)).ok).toBe(true);
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
    const claim = {
      onboarding_session_id: started.state!.session.onboarding_session_id,
      session_token: started.session_token!,
    };
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

describe("Google account tools: recovery on every failure", () => {
  const meta = (result: ReturnType<typeof accountToolFailure>) =>
    result._meta.arnold;

  it("asks to reconnect for an expired grant", () => {
    const result = accountToolFailure(
      new GoogleConnectionError("GOOGLE_REAUTH_REQUIRED", "abgelaufen"),
    );
    expect(meta(result)).toEqual({
      code: "GOOGLE_REAUTH_REQUIRED",
      retryable: false,
      recovery: "reconnect_google",
    });
    expect(result.content[0].text).toContain(RECOVERY_HINT.reconnect_google);
  });

  it("retries an unreachable Google and an unclear file creation", () => {
    expect(
      meta(
        accountToolFailure(
          new GoogleConnectionError("GOOGLE_UNAVAILABLE", "nicht erreichbar"),
        ),
      ),
    ).toMatchObject({ retryable: true, recovery: "retry_same_request" });
    expect(
      meta(
        accountToolFailure(
          new WriteError("COMMIT_STATUS_UNKNOWN", "unklar", true),
        ),
      ),
    ).toMatchObject({ recovery: "retry_same_request" });
  });

  it("reports an unknown failure without its message", () => {
    const result = accountToolFailure(new Error("geheimer Google-Text"));
    expect(meta(result)).toMatchObject({
      code: "STORAGE_UNAVAILABLE",
      recovery: "retry_same_request",
    });
    expect(result.content[0].text).not.toContain("geheimer");
  });

  it("refuses a foreign file permanently", () => {
    expect(
      meta(
        accountToolFailure(
          new WriteError("PERMISSION_DENIED", "Fremde Datei."),
        ),
      ),
    ).toMatchObject({ recovery: "contact_support" });
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
