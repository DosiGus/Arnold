/**
 * RUN-026: the setup goal "Ausdauer und Laufen" (endurance_running).
 *
 * The contract round trip (old profiles stay valid), the fail-closed gate on
 * the run answers, the hand-over to the run profile when the setup finishes,
 * and that repeating the finish never saves the run profile twice.
 */
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createFixtureOnboarding } from "../src/server/onboarding/fixture";
import { OnboardingService } from "../src/server/onboarding/service";
import {
  GOAL_LABEL,
  OnboardingProfileSchema,
  OnboardingProfilePatchSchema,
  OnboardingRunSchema,
  OnboardingStateSchema,
  TRAINING_GOALS,
  type OnboardingProfilePatch,
} from "../src/shared/onboarding-contract";
import { mergeProfile } from "../src/server/onboarding/service";

const rid = () => randomUUID();

const RUN = {
  goal: "10k",
  runs_per_week: 3,
  base_minutes_per_week: 120,
  longest_run_4w_min: 45,
  preferred_environment: "outdoor",
} as const;

const profileWith = (
  goals: {
    primary_goal: string;
    secondary_goals?: string[];
    modules?: object;
  },
  run?: object | null,
): OnboardingProfilePatch =>
  ({
    path: "arnold_plan",
    training: {
      ...goals,
      experience: "intermediate",
      days_per_week: 3,
      session_minutes: 60,
      environment: "gym",
      ...(run !== undefined ? { run } : {}),
    },
  }) as OnboardingProfilePatch;

async function startSetup(service: OnboardingService) {
  const started = await service.startOnboarding({ request_id: rid() });
  return {};
}

/** Drives a setup with a saved profile to a confirmed plan. */
async function confirmed(
  service: OnboardingService,
  profile: OnboardingProfilePatch,
) {
  const claim = await startSetup(service);
  const saved = await service.updateProfile({
    request_id: rid(),
    ...claim,
    profile,
  });
  expect(saved.ok, saved.error?.message).toBe(true);
  const brief = await service.getBrief(claim);
  const ids = brief.exercise_catalog.slice(0, 3).map((e) => e.exercise_id);
  const submitted = await service.submitPlanProposal({
    request_id: rid(),
    ...claim,
    name: "Mein Plan",
    origin: "ai_proposal",
    sessions: ids.map((exercise_id, i) => ({
      session_name: `Einheit ${i + 1}`,
      exercises: [{ exercise_id, target_sets: 3, rep_min: 8, rep_max: 12 }],
    })),
  });
  expect(submitted.ok, submitted.error?.message).toBe(true);
  const plan = submitted.state!.plan!;
  const done = await service.confirmPlan({
    request_id: rid(),
    ...claim,
    confirmation: {
      plan_version_id: plan.plan_version_id,
      row_revision: plan.row_revision,
      confirmed: true,
    },
  });
  expect(done.ok, done.error?.message).toBe(true);
  return claim;
}

describe("the contract", () => {
  it("knows the goal in both directions and as label", () => {
    expect(TRAINING_GOALS).toContain("endurance_running");
    expect(GOAL_LABEL.endurance_running).toBe("Ausdauer und Laufen");
    const profile = {
      path: "arnold_plan",
      person: {},
      training: {
        primary_goal: "endurance_running",
        secondary_goals: ["strength"],
        experience: "beginner",
        days_per_week: 3,
        session_minutes: 45,
        environment: "outdoor",
        run: { ...RUN, race_date: "2027-05-09", target_time_s: 3000 },
      },
      revision: 1,
      updated_at_utc: null,
    };
    const parsed = OnboardingProfileSchema.parse(profile);
    expect(
      OnboardingProfileSchema.parse(JSON.parse(JSON.stringify(parsed))),
    ).toEqual(parsed);
    const asSecondary = OnboardingProfileSchema.parse({
      ...profile,
      training: {
        ...profile.training,
        primary_goal: "strength",
        secondary_goals: ["endurance_running"],
      },
    });
    expect(asSecondary.training.secondary_goals).toEqual(["endurance_running"]);
  });

  it("keeps an old profile without run details valid and unchanged", () => {
    const old = {
      path: "arnold_plan",
      person: { age_years: 40 },
      training: {
        primary_goal: "muscle_gain",
        secondary_goals: ["general_fitness"],
        experience: "intermediate",
        days_per_week: 4,
        session_minutes: 60,
        environment: "gym",
      },
      revision: 3,
      updated_at_utc: null,
    };
    expect(OnboardingProfileSchema.parse(old)).toEqual(old);
  });

  it("refuses run details with a missing required answer or a wrong value", () => {
    const { base_minutes_per_week: _minutes, ...noMinutes } = RUN;
    const { longest_run_4w_min: _longest, ...noLongest } = RUN;
    expect(OnboardingRunSchema.safeParse(noMinutes).success).toBe(false);
    expect(OnboardingRunSchema.safeParse(noLongest).success).toBe(false);
    expect(
      OnboardingRunSchema.safeParse({ ...RUN, goal: "marathon" }).success,
    ).toBe(false);
    expect(
      OnboardingRunSchema.safeParse({ ...RUN, runs_per_week: 0 }).success,
    ).toBe(false);
    expect(
      OnboardingRunSchema.safeParse({ ...RUN, tempo_s_per_km: 300 }).success,
    ).toBe(false);
    expect(
      OnboardingProfilePatchSchema.safeParse({
        training: { run: { goal: "5k" } },
      }).success,
    ).toBe(false);
  });

  it("merges run details and removes them with null", () => {
    const base = mergeProfile(
      {
        path: null,
        person: {},
        training: {
          primary_goal: null,
          experience: null,
          days_per_week: null,
          session_minutes: null,
          environment: null,
        },
        revision: 0,
        updated_at_utc: null,
      },
      profileWith({ primary_goal: "endurance_running" }, RUN),
    );
    expect(base.training.run).toEqual(RUN);
    const cleared = mergeProfile(
      {
        ...base,
        revision: 1,
        updated_at_utc: null,
      },
      { training: { run: null } },
    );
    expect(cleared.training.run).toBeUndefined();
  });

  it("gives an older state without run_setup the default of nothing required", async () => {
    const service = createFixtureOnboarding().onboarding;
    const claim = await startSetup(service);
    const state = await service.getOnboardingState(claim);
    const { run_setup: _run, ...old } = JSON.parse(JSON.stringify(state));
    expect(OnboardingStateSchema.parse(old).run_setup).toEqual({
      required: false,
      ready: true,
    });
  });
});

describe("the run gate (fail closed)", () => {
  it("asks for nothing without the running goal", async () => {
    const service = createFixtureOnboarding().onboarding;
    const claim = await startSetup(service);
    const saved = await service.updateProfile({
      request_id: rid(),
      ...claim,
      profile: profileWith({ primary_goal: "strength" }),
    });
    expect(saved.state!.run_setup).toEqual({ required: false, ready: true });
    expect(saved.state!.progress.can_request_plan).toBe(true);
    const brief = await service.getBrief(claim);
    expect(brief.running).toBeUndefined();
    expect(brief.constraints.join(" ")).not.toContain("add_run_session");
  });

  it("refuses plan, brief and proposal until the run details exist", async () => {
    const service = createFixtureOnboarding().onboarding;
    const claim = await startSetup(service);
    const saved = await service.updateProfile({
      request_id: rid(),
      ...claim,
      profile: profileWith({ primary_goal: "endurance_running" }),
    });
    expect(saved.ok).toBe(true);
    expect(saved.state!.run_setup).toEqual({ required: true, ready: false });
    // Since Onboarding 2.0 the run details are required answers (RDS-003).
    expect(saved.state!.progress.profile_complete).toBe(false);
    expect(saved.state!.progress.can_request_plan).toBe(false);
    const request = await service.requestPlanProposal({
      request_id: rid(),
      ...claim,
    });
    expect(request.ok).toBe(false);
    expect(request.error?.code).toBe("PROFILE_INCOMPLETE");
    expect(request.state!.session.status).not.toBe("WAITING_FOR_PLAN_PROPOSAL");
    await expect(service.getBrief(claim)).rejects.toMatchObject({
      code: "PROFILE_INCOMPLETE",
    });
    const proposal = await service.submitPlanProposal({
      request_id: rid(),
      ...claim,
      name: "Plan",
      origin: "ai_proposal",
      sessions: [
        {
          session_name: "A",
          exercises: [
            { exercise_id: "squat", target_sets: 3, rep_min: 8, rep_max: 12 },
          ],
        },
      ],
    });
    expect(proposal.ok).toBe(false);
    expect(proposal.error?.code).toBe("PROFILE_INCOMPLETE");
  });

  it("also asks when running is only a further goal", async () => {
    const service = createFixtureOnboarding().onboarding;
    const claim = await startSetup(service);
    const saved = await service.updateProfile({
      request_id: rid(),
      ...claim,
      profile: profileWith({
        primary_goal: "strength",
        secondary_goals: ["endurance_running"],
      }),
    });
    expect(saved.state!.run_setup).toEqual({ required: true, ready: false });
  });

  it("refuses a patch with incomplete run details and stores nothing", async () => {
    const service = createFixtureOnboarding().onboarding;
    const claim = await startSetup(service);
    const refused = await service.updateProfile({
      request_id: rid(),
      ...claim,
      profile: {
        training: { primary_goal: "endurance_running", run: { goal: "5k" } },
      },
    });
    expect(refused.ok).toBe(false);
    expect(refused.error?.code).toBe("VALIDATION_ERROR");
    const state = await service.getOnboardingState(claim);
    expect(state.session.profile.training.primary_goal).toBeNull();
    expect(state.session.profile.training.run).toBeUndefined();
  });

  it("opens the gate with the run details and hands them to ChatGPT", async () => {
    const service = createFixtureOnboarding().onboarding;
    const claim = await startSetup(service);
    const saved = await service.updateProfile({
      request_id: rid(),
      ...claim,
      profile: profileWith({ primary_goal: "endurance_running" }, RUN),
    });
    expect(saved.state!.run_setup).toEqual({ required: true, ready: true });
    expect(saved.state!.progress.can_request_plan).toBe(true);
    const brief = await service.getBrief(claim);
    expect(brief.running).toEqual(RUN);
    const text = brief.constraints.join(" ");
    expect(text).toContain("add_run_session");
    expect(text).toMatch(/Tempi.*nie selbst/);
    expect(brief.goal?.primary).toBe("endurance_running");
  });
});

describe("the hand-over to the run profile", () => {
  it("writes the answers into the run profile once and not again", async () => {
    const runtime = createFixtureOnboarding();
    const service = runtime.onboarding;
    const claim = await confirmed(
      service,
      profileWith(
        { primary_goal: "endurance_running" },
        {
          ...RUN,
          race_date: "2027-05-09",
          reference: {
            distance_m: 5000,
            time_s: 1620,
            date: "2026-10-01",
            source: "user",
          },
        },
      ),
    );
    expect((await runtime.runs.dataset(undefined)).runProfiles).toHaveLength(0);
    const finished = await service.finishSetup({ request_id: rid(), ...claim });
    expect(finished.ok, finished.error?.message).toBe(true);
    const [profile] = (await runtime.runs.dataset(undefined)).runProfiles;
    expect(profile).toMatchObject({
      goal: "10k",
      runs_per_week: 3,
      base_minutes_per_week: 120,
      longest_run_4w_min: 45,
      preferred_environment: "outdoor",
      race_date: "2027-05-09",
      reference_distance_m: 5000,
      reference_time_s: 1620,
      reference_date: "2026-10-01",
      reference_source: "user",
      row_revision: 1,
    });
    // A repeated finish (new request id, as after a lost answer) changes nothing.
    const again = await service.finishSetup({ request_id: rid(), ...claim });
    expect(again.ok).toBe(true);
    const after = (await runtime.runs.dataset(undefined)).runProfiles;
    expect(after).toHaveLength(1);
    expect(after[0].row_revision).toBe(1);
  });

  it("leaves the run profile alone when running is not chosen", async () => {
    const runtime = createFixtureOnboarding();
    // Stored run details alone mean running (modulesOf); a module choice
    // without running leaves the run profile alone.
    const claim = await confirmed(
      runtime.onboarding,
      profileWith(
        {
          primary_goal: "strength",
          modules: { running: false, mobility: false, morning_routine: false },
        },
        RUN,
      ),
    );
    const finished = await runtime.onboarding.finishSetup({
      request_id: rid(),
      ...claim,
    });
    expect(finished.ok).toBe(true);
    expect((await runtime.runs.dataset(undefined)).runProfiles).toHaveLength(0);
  });

  it("reports a refused hand-over and completes it on the next try", async () => {
    const runtime = createFixtureOnboarding();
    const claim = await confirmed(
      runtime.onboarding,
      profileWith({ primary_goal: "endurance_running" }, RUN),
    );
    const execute = runtime.runs.execute.bind(runtime.runs);
    let fail = true;
    runtime.runs.execute = (async (...args: Parameters<typeof execute>) => {
      if (fail) {
        fail = false;
        throw new Error("down");
      }
      return execute(...args);
    }) as typeof execute;
    const first = await runtime.onboarding.finishSetup({
      request_id: rid(),
      ...claim,
    });
    expect(first.ok).toBe(false);
    expect(first.error?.retryable).toBe(true);
    expect((await runtime.runs.dataset(undefined)).runProfiles).toHaveLength(0);
    const second = await runtime.onboarding.finishSetup({
      request_id: rid(),
      ...claim,
    });
    expect(second.ok, second.error?.message).toBe(true);
    expect((await runtime.runs.dataset(undefined)).runProfiles).toHaveLength(1);
  });
});

describe("a deployment without a run service (fail closed, RUN-027)", () => {
  /** The same setup, but the service has no way to keep a run profile. */
  const withoutRunService = (service: OnboardingService) =>
    new OnboardingService({
      ...(service as unknown as { options: Record<string, unknown> }).options,
      recordRunProfile: undefined,
    } as never);

  it("refuses to finish a running setup and activates nothing", async () => {
    const runtime = createFixtureOnboarding();
    const claim = await confirmed(
      runtime.onboarding,
      profileWith({ primary_goal: "endurance_running" }, RUN),
    );
    const bare = withoutRunService(runtime.onboarding);
    const refused = await bare.finishSetup({ request_id: rid(), ...claim });
    expect(refused.ok).toBe(false);
    expect(refused.error?.code).toBe("PLAN_WRITE_UNAVAILABLE");
    expect(refused.error?.message).toContain("Laufangaben");
    const state = await bare.getOnboardingState(claim);
    expect(state.session.status).not.toBe("COMPLETED");
    expect((await runtime.runs.dataset(undefined)).runProfiles).toHaveLength(0);
    // Where the run service exists, the same setup finishes as before.
    const finished = await runtime.onboarding.finishSetup({
      request_id: rid(),
      ...claim,
    });
    expect(finished.ok, finished.error?.message).toBe(true);
    expect((await runtime.runs.dataset(undefined)).runProfiles).toHaveLength(1);
  });

  it("also refuses when running is only a further goal", async () => {
    const runtime = createFixtureOnboarding();
    const claim = await confirmed(
      runtime.onboarding,
      profileWith(
        { primary_goal: "strength", secondary_goals: ["endurance_running"] },
        RUN,
      ),
    );
    const refused = await withoutRunService(runtime.onboarding).finishSetup({
      request_id: rid(),
      ...claim,
    });
    expect(refused.ok).toBe(false);
    expect(refused.error?.code).toBe("PLAN_WRITE_UNAVAILABLE");
  });

  it("finishes a setup without the running goal as before", async () => {
    const runtime = createFixtureOnboarding();
    const claim = await confirmed(
      runtime.onboarding,
      profileWith({ primary_goal: "strength" }),
    );
    const finished = await withoutRunService(runtime.onboarding).finishSetup({
      request_id: rid(),
      ...claim,
    });
    expect(finished.ok, finished.error?.message).toBe(true);
  });
});
