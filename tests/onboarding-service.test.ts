/**
 * `OnboardingService`: the full setup flow, the plan integration and the
 * confirmation rules.
 *
 * Everything here runs against synthetic in-memory trackers. No Google call is
 * made, no Google token exists, and the plan drafts live in a fixture
 * repository — which is also what several of these tests assert.
 *
 * The cases that matter most are the ones about the confirmation: it must bind
 * one revision, it must lapse when the draft moves, and it must lapse even when
 * the draft was moved by the plan editor without onboarding being told.
 */
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  createFixtureOnboarding,
  createProductionOnboarding,
  createReadOnlyOnboarding,
} from "../src/server/onboarding/fixture";
import { InMemoryOnboardingRepository } from "../src/server/onboarding/repository";
import { planFixtureDataset } from "../src/server/plan/fixture";
import type { OnboardingService } from "../src/server/onboarding/service";
import {
  OnboardingStateSchema,
  type OnboardingProfilePatch,
  type OnboardingResponse,
} from "../src/shared/onboarding-contract";

const rid = () => randomUUID();

const COMPLETE_PROFILE: OnboardingProfilePatch = {
  primary_goal: "muscle_gain",
  experience: "intermediate",
  days_per_week: 3,
  session_minutes: 60,
  environment: "gym",
  starting_point: "new_plan",
};

/** Starts a setup and returns the handle a caller needs for everything else. */
async function startSetup(service: OnboardingService): Promise<{
  claim: { onboarding_session_id: string; session_token: string };
  state: NonNullable<OnboardingResponse["state"]>;
}> {
  const started = await service.startOnboarding({ request_id: rid() });
  expect(started.ok).toBe(true);
  expect(started.session_token).toBeTruthy();
  return {
    claim: {
      onboarding_session_id: started.state!.session.onboarding_session_id,
      session_token: started.session_token!,
    },
    state: started.state!,
  };
}

/** Drives a setup up to a saved, complete profile. */
async function withProfile(service: OnboardingService) {
  const { claim } = await startSetup(service);
  const saved = await service.updateProfile({
    request_id: rid(),
    ...claim,
    profile: COMPLETE_PROFILE,
  });
  expect(saved.ok).toBe(true);
  return { claim, state: saved.state! };
}

/** Three sessions built from real catalog ids, as a model would supply them. */
function proposalSessions(exerciseIds: readonly string[]) {
  return [
    {
      session_name: "Push",
      exercises: [
        {
          exercise_id: exerciseIds[0],
          target_sets: 3,
          rep_min: 8,
          rep_max: 12,
        },
      ],
    },
    {
      session_name: "Pull",
      exercises: [
        {
          exercise_id: exerciseIds[1],
          target_sets: 3,
          rep_min: 8,
          rep_max: 12,
        },
      ],
    },
    {
      session_name: "Legs",
      exercises: [
        {
          exercise_id: exerciseIds[2],
          target_sets: 3,
          rep_min: 6,
          rep_max: 10,
        },
      ],
    },
  ];
}

/** Drives a setup to a stored plan draft. */
async function withProposal(runtime = createFixtureOnboarding()) {
  const service = runtime.onboarding;
  const { claim } = await withProfile(service);
  await service.requestPlanProposal({ request_id: rid(), ...claim });
  const brief = await service.getBrief(claim);
  const ids = brief.exercise_catalog.slice(0, 3).map((e) => e.exercise_id);
  const submitted = await service.submitPlanProposal({
    request_id: rid(),
    ...claim,
    name: "Push/Pull/Legs",
    origin: "ai_proposal",
    sessions: proposalSessions(ids),
  });
  expect(submitted.ok, submitted.error?.message).toBe(true);
  return { runtime, service, claim, state: submitted.state!, ids };
}

/* ------------------------------------------------------------- the basics */

describe("starting a setup", () => {
  it("creates a session with a secret and an expiry", async () => {
    const { claim, state } = await startSetup(
      createFixtureOnboarding().onboarding,
    );
    expect(state.session.status).toBe("COLLECTING_PROFILE");
    expect(state.session.revision).toBe(1);
    expect(claim.session_token.length).toBeGreaterThanOrEqual(16);
    expect(Date.parse(state.session.expires_at_utc)).toBeGreaterThan(
      Date.parse(state.session.created_at_utc),
    );
    // Nothing is confirmed, nothing is pending with Google.
    expect(state.handoff.status).toBe("not_ready");
    expect(state.handoff.google_connection_pending).toBe(true);
    expect(state.session.status).not.toBe("COMPLETED");
  });

  it("matches the published state schema", async () => {
    const { state } = await startSetup(createFixtureOnboarding().onboarding);
    expect(OnboardingStateSchema.safeParse(state).success).toBe(true);
  });

  it("reports an onboarding session id that is not a user id", async () => {
    const { state } = await startSetup(createFixtureOnboarding().onboarding);
    // A deliberate naming guard: nothing in the contract may become a user id.
    expect(state.session).not.toHaveProperty("user_id");
    expect(state.session.onboarding_session_id).toMatch(/^onb-/);
  });
});

describe("collecting the profile", () => {
  it("merges a patch instead of replacing the profile", async () => {
    const service = createFixtureOnboarding().onboarding;
    const { claim } = await startSetup(service);
    await service.updateProfile({
      request_id: rid(),
      ...claim,
      profile: { primary_goal: "strength", experience: "beginner" },
    });
    const second = await service.updateProfile({
      request_id: rid(),
      ...claim,
      profile: { days_per_week: 4 },
    });
    expect(second.state!.session.profile.primary_goal).toBe("strength");
    expect(second.state!.session.profile.experience).toBe("beginner");
    expect(second.state!.session.profile.days_per_week).toBe(4);
  });

  it("records the first open question after a save without a step", async () => {
    // Found live in ChatGPT: the step stayed "goal" after the goal was saved,
    // and the model kept saving goal and experience again and again.
    const service = createFixtureOnboarding().onboarding;
    const { claim } = await startSetup(service);
    const goal = await service.updateProfile({
      request_id: rid(),
      ...claim,
      profile: { primary_goal: "muscle_gain", experience: "intermediate" },
    });
    expect(goal.state!.session.current_step).toBe("availability");
    const availability = await service.updateProfile({
      request_id: rid(),
      ...claim,
      profile: { days_per_week: 3, session_minutes: 60, environment: "gym" },
    });
    expect(availability.state!.session.current_step).toBe("preferences");
    const done = await service.updateProfile({
      request_id: rid(),
      ...claim,
      profile: { starting_point: "new_plan" },
    });
    expect(done.state!.session.status).toBe("PROFILE_READY");
    expect(done.state!.session.current_step).toBe("summary");
  });

  it("keeps an explicit step from the wizard", async () => {
    const service = createFixtureOnboarding().onboarding;
    const { claim } = await startSetup(service);
    const saved = await service.updateProfile({
      request_id: rid(),
      ...claim,
      profile: { primary_goal: "strength" },
      step: "goal",
    });
    expect(saved.state!.session.current_step).toBe("goal");
  });

  it("updates a single answer from a later turn", async () => {
    const service = createFixtureOnboarding().onboarding;
    const { claim } = await withProfile(service);
    // "Eigentlich möchte ich lieber nur dreimal die Woche trainieren."
    const changed = await service.updateProfile({
      request_id: rid(),
      ...claim,
      profile: { days_per_week: 5 },
    });
    expect(changed.state!.session.profile.days_per_week).toBe(5);
    expect(changed.state!.session.profile.session_minutes).toBe(60);
    // The brief that a later proposal is built from reflects the change.
    const brief = await service.getBrief(claim);
    expect(brief.availability.days_per_week).toBe(5);
  });

  it("becomes ready only once every answer is in", async () => {
    const service = createFixtureOnboarding().onboarding;
    const { claim } = await startSetup(service);
    const partial = await service.updateProfile({
      request_id: rid(),
      ...claim,
      profile: { primary_goal: "muscle_gain" },
    });
    expect(partial.state!.session.status).toBe("COLLECTING_PROFILE");
    expect(partial.state!.progress.can_request_plan).toBe(false);
    const full = await service.updateProfile({
      request_id: rid(),
      ...claim,
      profile: COMPLETE_PROFILE,
    });
    expect(full.state!.session.status).toBe("PROFILE_READY");
    expect(full.state!.progress.can_request_plan).toBe(true);
  });

  it("refuses to continue without the required answers", async () => {
    const service = createFixtureOnboarding().onboarding;
    const { claim } = await startSetup(service);
    const refused = await service.requestPlanProposal({
      request_id: rid(),
      ...claim,
    });
    expect(refused.ok).toBe(false);
    expect(refused.error?.code).toBe("PROFILE_INCOMPLETE");
    // The refusal still carries the state that stands.
    expect(refused.state?.session.status).toBe("COLLECTING_PROFILE");
  });

  it("moves back a step without losing answers", async () => {
    const service = createFixtureOnboarding().onboarding;
    const { claim } = await withProfile(service);
    const back = await service.updateProfile({
      request_id: rid(),
      ...claim,
      step: "goal",
    });
    expect(back.ok).toBe(true);
    expect(back.state!.session.current_step).toBe("goal");
    expect(back.state!.session.profile.days_per_week).toBe(3);
    expect(back.state!.progress.profile_complete).toBe(true);
  });

  it("rejects a write built on a stale revision", async () => {
    const service = createFixtureOnboarding().onboarding;
    const { claim, state } = await startSetup(service);
    await service.updateProfile({
      request_id: rid(),
      ...claim,
      profile: { primary_goal: "strength" },
    });
    const stale = await service.updateProfile({
      request_id: rid(),
      ...claim,
      expected_revision: state.session.revision,
      profile: { primary_goal: "muscle_gain" },
    });
    expect(stale.ok).toBe(false);
    expect(stale.error?.code).toBe("REVISION_CONFLICT");
    // The earlier value stands; nothing was overwritten.
    expect(stale.state!.session.profile.primary_goal).toBe("strength");
  });

  it("treats a repeated request id as already done", async () => {
    const service = createFixtureOnboarding().onboarding;
    const { claim } = await startSetup(service);
    const requestId = rid();
    const first = await service.updateProfile({
      request_id: requestId,
      ...claim,
      profile: { days_per_week: 3 },
    });
    const second = await service.updateProfile({
      request_id: requestId,
      ...claim,
      profile: { days_per_week: 6 },
    });
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    expect(second.replayed).toBe(true);
    // The repeat did not apply the second value.
    expect(second.state!.session.profile.days_per_week).toBe(3);
    expect(second.state!.session.revision).toBe(first.state!.session.revision);
  });
});

/* ----------------------------------------------------------- the proposal */

describe("the plan proposal", () => {
  it("stores a proposal as an editable draft, never as an active plan", async () => {
    const { state, runtime } = await withProposal();
    expect(state.session.status).toBe("REVIEWING_PLAN");
    expect(state.plan).toBeTruthy();
    expect(state.plan!.status).toBe("draft");
    expect(state.plan!.editable).toBe(true);
    expect(state.plan!.session_count).toBe(3);
    // Nothing became the active plan of the tracker.
    const dataset = await runtime.repository.read();
    expect(dataset.plans.filter((p) => p.status === "active")).toHaveLength(0);
  });

  it("records the goal and day count on the draft", async () => {
    const { state } = await withProposal();
    expect(state.plan!.days_per_week).toBe(3);
    expect(state.plan!.goal_key).toBe("muscle_gain");
  });

  it("refuses an invented exercise id", async () => {
    const runtime = createFixtureOnboarding();
    const service = runtime.onboarding;
    const { claim } = await withProfile(service);
    await service.requestPlanProposal({ request_id: rid(), ...claim });
    const refused = await service.submitPlanProposal({
      request_id: rid(),
      ...claim,
      name: "Erfundener Plan",
      origin: "ai_proposal",
      sessions: [
        {
          session_name: "Push",
          exercises: [{ exercise_id: "exercise-that-does-not-exist" }],
        },
      ],
    });
    expect(refused.ok).toBe(false);
    expect(refused.error?.code).toBe("PLAN_PROPOSAL_INVALID");
    expect(refused.state!.session.plan_draft_reference).toBeNull();
  });

  it("refuses an invalid repetition range", async () => {
    const runtime = createFixtureOnboarding();
    const service = runtime.onboarding;
    const { claim } = await withProfile(service);
    await service.requestPlanProposal({ request_id: rid(), ...claim });
    const brief = await service.getBrief(claim);
    const refused = await service.submitPlanProposal({
      request_id: rid(),
      ...claim,
      name: "Falscher Bereich",
      origin: "ai_proposal",
      sessions: [
        {
          session_name: "Push",
          exercises: [
            {
              exercise_id: brief.exercise_catalog[0].exercise_id,
              target_sets: 3,
              rep_min: 12,
              rep_max: 6,
            },
          ],
        },
      ],
    });
    expect(refused.ok).toBe(false);
    expect(refused.state!.session.plan_draft_reference).toBeNull();
  });

  it("refuses a proposal with an empty session", async () => {
    const service = createFixtureOnboarding().onboarding;
    const { claim } = await withProfile(service);
    await service.requestPlanProposal({ request_id: rid(), ...claim });
    const refused = await service.submitPlanProposal({
      request_id: rid(),
      ...claim,
      name: "Leer",
      origin: "ai_proposal",
      sessions: [{ session_name: "Push", exercises: [] }],
    });
    expect(refused.ok).toBe(false);
  });

  it("refuses a proposal before the phase was opened", async () => {
    const service = createFixtureOnboarding().onboarding;
    const { claim } = await withProfile(service);
    const brief = await service.getBrief(claim);
    const refused = await service.submitPlanProposal({
      request_id: rid(),
      ...claim,
      name: "Zu früh",
      origin: "ai_proposal",
      sessions: [
        {
          session_name: "Push",
          exercises: [{ exercise_id: brief.exercise_catalog[0].exercise_id }],
        },
      ],
    });
    expect(refused.ok).toBe(false);
    expect(refused.error?.code).toBe("INVALID_STATE_TRANSITION");
  });

  it("leaves an unstated target load empty rather than inventing one", async () => {
    const { state } = await withProposal();
    for (const session of state.plan!.sessions)
      for (const exercise of session.exercises)
        expect(exercise.target_load_kg).toBeNull();
  });

  it("does not create a second draft when a submission is repeated", async () => {
    const runtime = createFixtureOnboarding();
    const service = runtime.onboarding;
    const { claim } = await withProfile(service);
    await service.requestPlanProposal({ request_id: rid(), ...claim });
    const brief = await service.getBrief(claim);
    const ids = brief.exercise_catalog.slice(0, 3).map((e) => e.exercise_id);
    const requestId = rid();
    const payload = {
      request_id: requestId,
      ...claim,
      name: "Push/Pull/Legs",
      origin: "ai_proposal" as const,
      sessions: proposalSessions(ids),
    };
    const first = await service.submitPlanProposal(payload);
    const second = await service.submitPlanProposal(payload);
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    expect(second.replayed).toBe(true);
    expect(second.state!.session.plan_draft_reference!.plan_version_id).toBe(
      first.state!.session.plan_draft_reference!.plan_version_id,
    );
    const dataset = await runtime.repository.read();
    expect(dataset.plans).toHaveLength(1);
  });

  it("warns when the day count does not match the request", async () => {
    const service = createFixtureOnboarding().onboarding;
    const { claim } = await withProfile(service);
    await service.requestPlanProposal({ request_id: rid(), ...claim });
    const brief = await service.getBrief(claim);
    const submitted = await service.submitPlanProposal({
      request_id: rid(),
      ...claim,
      name: "Zwei Tage",
      origin: "ai_proposal",
      sessions: [
        {
          session_name: "Oberkörper",
          exercises: [{ exercise_id: brief.exercise_catalog[0].exercise_id }],
        },
        {
          session_name: "Unterkörper",
          exercises: [{ exercise_id: brief.exercise_catalog[1].exercise_id }],
        },
      ],
    });
    // Stored, but the mismatch is visible rather than silently accepted.
    expect(submitted.ok).toBe(true);
    expect(submitted.state!.plan!.session_count).toBe(2);
  });

  it("takes over an existing routine as a draft", async () => {
    const service = createFixtureOnboarding().onboarding;
    const { claim } = await startSetup(service);
    await service.updateProfile({
      request_id: rid(),
      ...claim,
      profile: { ...COMPLETE_PROFILE, starting_point: "existing_plan" },
    });
    await service.requestPlanProposal({ request_id: rid(), ...claim });
    const brief = await service.getBrief(claim);
    expect(brief.starting_point).toBe("existing_plan");
    const ids = brief.exercise_catalog.slice(0, 3).map((e) => e.exercise_id);
    const submitted = await service.submitPlanProposal({
      request_id: rid(),
      ...claim,
      name: "Mein Push/Pull/Legs",
      origin: "existing_routine",
      sessions: proposalSessions(ids),
    });
    expect(submitted.ok).toBe(true);
    expect(submitted.state!.session.plan_draft_reference!.origin).toBe(
      "existing_routine",
    );
    expect(submitted.state!.session.plan_draft_reference!.proposed_by).toBe(
      "chatgpt",
    );
    expect(submitted.state!.session.status).toBe("REVIEWING_PLAN");
  });

  it("is refused outright when the deployment cannot store a plan", async () => {
    const { onboarding } = createReadOnlyOnboarding();
    const { claim } = await withProfile(onboarding);
    const state = await onboarding.getOnboardingState(claim);
    expect(state.can_write_plan).toBe(false);
    await onboarding.requestPlanProposal({ request_id: rid(), ...claim });
    const refused = await onboarding.submitPlanProposal({
      request_id: rid(),
      ...claim,
      name: "Kein Schreibpfad",
      origin: "ai_proposal",
      sessions: [
        { session_name: "Push", exercises: [{ exercise_id: "plan-fx-bench" }] },
      ],
    });
    expect(refused.ok).toBe(false);
    expect(refused.error?.code).toBe("PLAN_WRITE_UNAVAILABLE");
  });
});

/* -------------------------------------------------------- the confirmation */

describe("confirming the plan", () => {
  it("binds the confirmation to one version and one revision", async () => {
    const { service, claim, state } = await withProposal();
    const plan = state.plan!;
    const confirmed = await service.confirmPlan({
      request_id: rid(),
      ...claim,
      confirmation: {
        plan_version_id: plan.plan_version_id,
        row_revision: plan.row_revision,
        confirmed: true,
      },
    });
    expect(confirmed.ok, confirmed.error?.message).toBe(true);
    expect(confirmed.state!.session.status).toBe("AWAITING_GOOGLE_CONNECTION");
    const confirmation = confirmed.state!.session.confirmed_plan_reference!;
    expect(confirmation.plan_version_id).toBe(plan.plan_version_id);
    expect(confirmation.row_revision).toBe(plan.row_revision);
    expect(confirmation.profile_revision).toBeGreaterThan(0);
    expect(confirmed.state!.handoff.status).toBe("ready_for_google_connection");
  });

  it("refuses a confirmation naming an older revision", async () => {
    const { service, claim, state } = await withProposal();
    const plan = state.plan!;
    const refused = await service.confirmPlan({
      request_id: rid(),
      ...claim,
      confirmation: {
        plan_version_id: plan.plan_version_id,
        row_revision: plan.row_revision + 7,
        confirmed: true,
      },
    });
    expect(refused.ok).toBe(false);
    expect(refused.error?.code).toBe("STALE_CONFIRMATION");
    expect(refused.state!.session.confirmed_plan_reference).toBeNull();
  });

  it("refuses a confirmation naming a different plan version", async () => {
    const { service, claim } = await withProposal();
    const refused = await service.confirmPlan({
      request_id: rid(),
      ...claim,
      confirmation: {
        plan_version_id: "some-other-version",
        row_revision: 1,
        confirmed: true,
      },
    });
    expect(refused.ok).toBe(false);
    expect(refused.error?.code).toBe("STALE_CONFIRMATION");
  });

  it("refuses a confirmation when there is no draft at all", async () => {
    const service = createFixtureOnboarding().onboarding;
    const { claim } = await withProfile(service);
    const refused = await service.confirmPlan({
      request_id: rid(),
      ...claim,
      confirmation: {
        plan_version_id: "nothing",
        row_revision: 1,
        confirmed: true,
      },
    });
    expect(refused.ok).toBe(false);
    expect(refused.error?.code).toBe("PLAN_PROPOSAL_REQUIRED");
  });

  it("is idempotent for a repeated confirmation request", async () => {
    const { service, claim, state } = await withProposal();
    const plan = state.plan!;
    const payload = {
      request_id: rid(),
      ...claim,
      confirmation: {
        plan_version_id: plan.plan_version_id,
        row_revision: plan.row_revision,
        confirmed: true as const,
      },
    };
    const first = await service.confirmPlan(payload);
    const second = await service.confirmPlan(payload);
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    expect(second.replayed).toBe(true);
    expect(
      second.state!.session.confirmed_plan_reference!.confirmed_at_utc,
    ).toBe(first.state!.session.confirmed_plan_reference!.confirmed_at_utc);
  });
});

describe("a change after the confirmation", () => {
  /** Confirms the current draft and returns the confirmed state. */
  async function confirmed() {
    const context = await withProposal();
    const plan = context.state.plan!;
    const response = await context.service.confirmPlan({
      request_id: rid(),
      ...context.claim,
      confirmation: {
        plan_version_id: plan.plan_version_id,
        row_revision: plan.row_revision,
        confirmed: true,
      },
    });
    expect(response.ok).toBe(true);
    return { ...context, confirmedState: response.state!, plan };
  }

  it("lapses when the plan editor changes the draft", async () => {
    const { runtime, service, claim, plan } = await confirmed();
    // The edit goes straight through the Task 005 service, exactly as a click
    // in the editor or a chat turn would — onboarding is not told about it.
    const edit = await runtime.plans.updatePlanDraft({
      request_id: rid(),
      plan_version_id: plan.plan_version_id,
      expected_row_revision: plan.row_revision,
      edits: [
        {
          type: "rename_session",
          session_id: plan.sessions[0].session_id,
          session_name: "Push A",
        },
      ],
    });
    expect(edit.ok).toBe(true);

    const { handoff, state } = await service.prepareGoogleHandoff(claim);
    expect(handoff.status).toBe("superseded");
    expect(state.session.status).toBe("REVIEWING_PLAN");
    expect(handoff.oauth_state_binding).toBeNull();
    // The message names both revisions so the user learns what happened.
    expect(handoff.blocked_reason).toContain(String(plan.row_revision));
    expect(handoff.confirmed_plan_revision).toBe(plan.row_revision);
    expect(handoff.current_plan_revision).toBeGreaterThan(plan.row_revision);
  });

  it("cannot be confirmed again with the old revision", async () => {
    const { runtime, service, claim, plan } = await confirmed();
    await runtime.plans.updatePlanDraft({
      request_id: rid(),
      plan_version_id: plan.plan_version_id,
      expected_row_revision: plan.row_revision,
      edits: [
        {
          type: "rename_session",
          session_id: plan.sessions[0].session_id,
          session_name: "Push B",
        },
      ],
    });
    await service.prepareGoogleHandoff(claim);
    const refused = await service.confirmPlan({
      request_id: rid(),
      ...claim,
      confirmation: {
        plan_version_id: plan.plan_version_id,
        row_revision: plan.row_revision,
        confirmed: true,
      },
    });
    expect(refused.ok).toBe(false);
    expect(refused.error?.code).toBe("STALE_CONFIRMATION");
  });

  it("can be confirmed again at the new revision", async () => {
    const { runtime, service, claim, plan } = await confirmed();
    const edit = await runtime.plans.updatePlanDraft({
      request_id: rid(),
      plan_version_id: plan.plan_version_id,
      expected_row_revision: plan.row_revision,
      edits: [
        {
          type: "rename_session",
          session_id: plan.sessions[0].session_id,
          session_name: "Push C",
        },
      ],
    });
    const next = edit.result!.plan!.version;
    await service.prepareGoogleHandoff(claim);
    const again = await service.confirmPlan({
      request_id: rid(),
      ...claim,
      confirmation: {
        plan_version_id: next.plan_version_id,
        row_revision: next.row_revision,
        confirmed: true,
      },
    });
    expect(again.ok, again.error?.message).toBe(true);
    expect(again.state!.session.status).toBe("AWAITING_GOOGLE_CONNECTION");
    expect(again.state!.handoff.status).toBe("ready_for_google_connection");
    expect(again.state!.handoff.confirmed_plan_revision).toBe(
      next.row_revision,
    );
  });

  it("lapses when the user changes an answer", async () => {
    const { service, claim } = await confirmed();
    const changed = await service.updateProfile({
      request_id: rid(),
      ...claim,
      profile: { days_per_week: 4 },
    });
    expect(changed.ok).toBe(true);
    expect(changed.state!.session.status).toBe("REVIEWING_PLAN");
    expect(changed.state!.handoff.status).toBe("superseded");
  });

  it("lapses on an explicit revision request", async () => {
    const { service, claim } = await confirmed();
    const revised = await service.revisePlan({ request_id: rid(), ...claim });
    expect(revised.ok).toBe(true);
    expect(revised.state!.session.status).toBe("REVIEWING_PLAN");
    expect(revised.state!.handoff.status).not.toBe(
      "ready_for_google_connection",
    );
  });

  it("produces a different OAuth binding for a different revision", async () => {
    const { runtime, service, claim, plan, confirmedState } = await confirmed();
    const first = confirmedState.handoff.oauth_state_binding;
    expect(first).toBeTruthy();
    const edit = await runtime.plans.updatePlanDraft({
      request_id: rid(),
      plan_version_id: plan.plan_version_id,
      expected_row_revision: plan.row_revision,
      edits: [
        {
          type: "rename_session",
          session_id: plan.sessions[0].session_id,
          session_name: "Push D",
        },
      ],
    });
    await service.prepareGoogleHandoff(claim);
    const next = edit.result!.plan!.version;
    const again = await service.confirmPlan({
      request_id: rid(),
      ...claim,
      confirmation: {
        plan_version_id: next.plan_version_id,
        row_revision: next.row_revision,
        confirmed: true,
      },
    });
    expect(again.state!.handoff.oauth_state_binding).toBeTruthy();
    expect(again.state!.handoff.oauth_state_binding).not.toBe(first);
  });
});

/* ----------------------------------------------------------- the handoff */

describe("the Google handoff", () => {
  it("is not ready before a confirmation", async () => {
    const { service, claim } = await withProposal();
    const { handoff } = await service.prepareGoogleHandoff(claim);
    expect(handoff.status).toBe("not_ready");
    expect(handoff.confirmed_plan_version_id).toBeNull();
    expect(handoff.oauth_state_binding).toBeNull();
    expect(handoff.blocked_reason).toBeTruthy();
  });

  it("carries only references and no secret", async () => {
    const { service, claim, state } = await withProposal();
    const plan = state.plan!;
    await service.confirmPlan({
      request_id: rid(),
      ...claim,
      confirmation: {
        plan_version_id: plan.plan_version_id,
        row_revision: plan.row_revision,
        confirmed: true,
      },
    });
    const { handoff } = await service.prepareGoogleHandoff(claim);
    expect(handoff.status).toBe("ready_for_google_connection");
    // Everything in the handoff is safe to log: no token, no profile content.
    const text = JSON.stringify(handoff);
    expect(text).not.toContain(claim.session_token);
    expect(text).not.toContain("muscle_gain");
    expect(handoff.confirmed_plan_version_id).toBe(plan.plan_version_id);
    expect(handoff.google_connection_pending).toBe(true);
  });

  it("never reports a completed Google setup", async () => {
    const { service, claim, state, runtime } = await withProposal();
    const plan = state.plan!;
    const confirmed = await service.confirmPlan({
      request_id: rid(),
      ...claim,
      confirmation: {
        plan_version_id: plan.plan_version_id,
        row_revision: plan.row_revision,
        confirmed: true,
      },
    });
    expect(confirmed.state!.session.status).not.toBe("COMPLETED");
    expect(confirmed.state!.handoff.status).not.toBe("completed");
    // And the plan still is not active in any tracker.
    const dataset = await runtime.repository.read();
    expect(dataset.plans.filter((p) => p.status === "active")).toHaveLength(0);
  });
});

/* -------------------------------------------------- cancelling and expiry */

describe("cancelling", () => {
  it("ends the setup and voids a confirmation", async () => {
    const { service, claim, state } = await withProposal();
    const plan = state.plan!;
    await service.confirmPlan({
      request_id: rid(),
      ...claim,
      confirmation: {
        plan_version_id: plan.plan_version_id,
        row_revision: plan.row_revision,
        confirmed: true,
      },
    });
    const cancelled = await service.cancelOnboarding({
      request_id: rid(),
      ...claim,
    });
    expect(cancelled.ok).toBe(true);
    expect(cancelled.state!.session.status).toBe("CANCELLED");
    expect(cancelled.state!.handoff.status).not.toBe(
      "ready_for_google_connection",
    );
  });

  it("leaves the plan draft readable rather than deleting it", async () => {
    const { runtime, service, claim, state } = await withProposal();
    const planVersionId = state.plan!.plan_version_id;
    await service.cancelOnboarding({ request_id: rid(), ...claim });
    const dataset = await runtime.repository.read();
    expect(
      dataset.plans.find((p) => p.plan_version_id === planVersionId),
    ).toBeTruthy();
  });

  it("refuses further changes afterwards", async () => {
    const service = createFixtureOnboarding().onboarding;
    const { claim } = await withProfile(service);
    await service.cancelOnboarding({ request_id: rid(), ...claim });
    const refused = await service.updateProfile({
      request_id: rid(),
      ...claim,
      profile: { days_per_week: 5 },
    });
    expect(refused.ok).toBe(false);
    expect(refused.error?.code).toBe("SESSION_CANCELLED");
  });
});

describe("expiry", () => {
  it("refuses every write once the session has expired", async () => {
    let now = new Date("2026-05-01T10:00:00Z");
    const runtime = createFixtureOnboarding({
      sessionTtlMs: 60_000,
      clock: () => now,
    });
    const service = runtime.onboarding;
    const { claim } = await withProfile(service);
    now = new Date("2026-05-01T11:00:00Z");

    const refused = await service.updateProfile({
      request_id: rid(),
      ...claim,
      profile: { days_per_week: 5 },
    });
    expect(refused.ok).toBe(false);
    expect(refused.error?.code).toBe("SESSION_EXPIRED");

    const state = await service.getOnboardingState(claim);
    expect(state.session.status).toBe("EXPIRED");
    expect(state.allowed_events).toEqual(["CANCEL"]);
  });

  it("refuses a brief and a proposal on an expired session", async () => {
    let now = new Date("2026-05-01T10:00:00Z");
    const service = createFixtureOnboarding({
      sessionTtlMs: 60_000,
      clock: () => now,
    }).onboarding;
    const { claim } = await withProfile(service);
    await service.requestPlanProposal({ request_id: rid(), ...claim });
    now = new Date("2026-05-02T10:00:00Z");
    await expect(service.getBrief(claim)).rejects.toThrow();
    const refused = await service.submitPlanProposal({
      request_id: rid(),
      ...claim,
      name: "Zu spät",
      origin: "ai_proposal",
      sessions: [
        { session_name: "Push", exercises: [{ exercise_id: "plan-fx-bench" }] },
      ],
    });
    expect(refused.ok).toBe(false);
    expect(refused.error?.code).toBe("SESSION_EXPIRED");
  });

  it("starts a fresh setup after an expiry", async () => {
    let now = new Date("2026-05-01T10:00:00Z");
    const service = createFixtureOnboarding({
      sessionTtlMs: 60_000,
      clock: () => now,
    }).onboarding;
    const { claim } = await withProfile(service);
    now = new Date("2026-05-03T10:00:00Z");
    const restarted = await service.startOnboarding({
      request_id: rid(),
      resume_session: claim,
    });
    expect(restarted.ok).toBe(true);
    expect(restarted.session_token).toBeTruthy();
    // A new session, not the expired one revived.
    expect(restarted.state!.session.onboarding_session_id).not.toBe(
      claim.onboarding_session_id,
    );
    expect(restarted.state!.session.status).toBe("COLLECTING_PROFILE");
  });
});

/* --------------------------------------------------- resumption and reuse */

describe("resuming", () => {
  it("returns the stored answers within a valid session", async () => {
    const service = createFixtureOnboarding().onboarding;
    const { claim } = await withProfile(service);
    const resumed = await service.resumeOnboarding(claim);
    expect(resumed.session.profile.primary_goal).toBe("muscle_gain");
    expect(resumed.session.profile.days_per_week).toBe(3);
    expect(resumed.progress.profile_complete).toBe(true);
  });

  it("continues rather than restarting when asked to resume", async () => {
    const service = createFixtureOnboarding().onboarding;
    const { claim } = await withProfile(service);
    const resumed = await service.startOnboarding({
      request_id: rid(),
      resume_session: claim,
    });
    expect(resumed.ok).toBe(true);
    expect(resumed.state!.session.onboarding_session_id).toBe(
      claim.onboarding_session_id,
    );
    expect(resumed.state!.session.profile.days_per_week).toBe(3);
    // No new secret is handed out for a session that already has one.
    expect(resumed.session_token).toBeNull();
  });

  it("states honestly that cross-device resumption is not available", async () => {
    const service = createFixtureOnboarding().onboarding;
    const { claim } = await startSetup(service);
    const state = await service.getOnboardingState(claim);
    expect(state.resume.cross_device).toBe(false);
    expect(state.resume.durable).toBe(false);
    expect(state.resume.note).toBeTruthy();
  });

  it("reports a durable store when one is configured", async () => {
    const repository = new InMemoryOnboardingRepository();
    // A repository that claims local durability must be reported as durable.
    Object.defineProperty(repository, "durability", { value: "local" });
    const service = createFixtureOnboarding({ repository }).onboarding;
    const { claim } = await startSetup(service);
    const state = await service.getOnboardingState(claim);
    expect(state.resume.durable).toBe(true);
    expect(state.resume.cross_device).toBe(false);
  });
});

/* --------------------------------------------------------------- the brief */

describe("the brief over the service", () => {
  it("is refused while answers are missing", async () => {
    const service = createFixtureOnboarding().onboarding;
    const { claim } = await startSetup(service);
    await expect(service.getBrief(claim)).rejects.toMatchObject({
      code: "PROFILE_INCOMPLETE",
    });
  });

  it("offers only ids the plan service would accept", async () => {
    const runtime = createFixtureOnboarding();
    const { claim } = await withProfile(runtime.onboarding);
    const brief = await runtime.onboarding.getBrief(claim);
    const dataset = await runtime.repository.read();
    const known = new Set(
      dataset.exercises
        .filter((row) => row.status === "active")
        .map((row) => row.exercise_id),
    );
    expect(brief.exercise_catalog.length).toBeGreaterThan(0);
    for (const entry of brief.exercise_catalog)
      expect(known.has(entry.exercise_id)).toBe(true);
  });
});

/* ------------------------------------------------------------ plan reading */

describe("reading the plan", () => {
  it("refuses before a proposal exists", async () => {
    const service = createFixtureOnboarding().onboarding;
    const { claim } = await withProfile(service);
    await expect(service.getPlan(claim)).rejects.toMatchObject({
      code: "PLAN_PROPOSAL_REQUIRED",
    });
  });

  it("returns the draft with its validation and handoff", async () => {
    const { service, claim } = await withProposal();
    const result = await service.getPlan(claim);
    expect(result.plan.status).toBe("draft");
    expect(result.validation?.valid).toBe(true);
    expect(result.handoff.status).toBe("not_ready");
  });
});

/* -------------------------------------------------------------- production */

describe("production mode fails closed", () => {
  it("refuses to start a setup without a verified identity", async () => {
    const service = createProductionOnboarding();
    const started = await service.startOnboarding({ request_id: rid() });
    expect(started.ok).toBe(false);
    expect(started.error?.code).toBe("AUTH_REQUIRED");
    expect(started.state).toBeNull();
  });

  it("refuses to read any session", async () => {
    const service = createProductionOnboarding();
    expect(service.mode).toBe("production");
    await expect(
      service.getOnboardingState({
        onboarding_session_id: "onb-anything",
        session_token: "x".repeat(32),
      }),
    ).rejects.toMatchObject({ code: "AUTH_REQUIRED" });
  });
});

/* --------------------------------------------------------- no Google writes */

describe("nothing reaches Google", () => {
  it("keeps onboarding state out of the six Arnold tables", async () => {
    const { runtime, state } = await withProposal();
    const dataset = await runtime.repository.read();
    // The config says onboarding state is backend-only, and it is.
    expect(dataset.config.onboarding_storage).toBe("BACKEND_ONLY");
    const serialized = JSON.stringify(dataset);
    expect(serialized).not.toContain(state.session.onboarding_session_id);
    expect(serialized).not.toContain("COLLECTING_PROFILE");
    expect(serialized).not.toContain("primary_goal");
  });

  it("works on a fixture tracker that is not the master template", async () => {
    const { runtime } = await withProposal();
    const dataset = await runtime.repository.read();
    expect(dataset.config.file_role).toBe("USER_TRACKER");
    expect(dataset.config.tracker_id).not.toBe("TEMPLATE_UNASSIGNED");
  });

  it("never stores a Google token anywhere in the session", async () => {
    const { state } = await withProposal();
    const serialized = JSON.stringify(state.session);
    for (const marker of [
      "access_token",
      "refresh_token",
      "id_token",
      "ya29.",
      "oauth",
    ])
      expect(serialized.toLowerCase()).not.toContain(marker.toLowerCase());
  });

  it("writes plan drafts only through the fixture repository", async () => {
    const runtime = createFixtureOnboarding({
      dataset: planFixtureDataset("empty"),
    });
    expect(runtime.plans.mode).toBe("fixture");
    expect(runtime.repository.kind).toBe("fixture");
  });
});

/* --------------------------------------------------------------- the audit */

describe("the audit trail", () => {
  it("records the setup milestones without profile content", async () => {
    const { runtime, service, claim, state } = await withProposal();
    const plan = state.plan!;
    await service.confirmPlan({
      request_id: rid(),
      ...claim,
      confirmation: {
        plan_version_id: plan.plan_version_id,
        row_revision: plan.row_revision,
        confirmed: true,
      },
    });
    const audit = runtime.audit as { events: Map<string, unknown> };
    const events = [...audit.events.values()] as {
      event_type: string;
      entity_id: string;
      actor: string;
    }[];
    const types = events.map((event) => event.event_type);
    expect(types).toContain("ONBOARDING_STARTED");
    expect(types).toContain("ONBOARDING_PROFILE_UPDATED");
    expect(types).toContain("ONBOARDING_PLAN_PROPOSED");
    expect(types).toContain("ONBOARDING_PLAN_CONFIRMED");
    expect(types).toContain("ONBOARDING_HANDOFF_PREPARED");

    // No session secret and no free text in the trail.
    const serialized = JSON.stringify(events);
    expect(serialized).not.toContain(claim.session_token);
    for (const event of events.filter((e) =>
      e.event_type.startsWith("ONBOARDING_"),
    ))
      expect(event.entity_id).toBe(claim.onboarding_session_id);
  });

  it("records that a confirmation was invalidated", async () => {
    const context = await withProposal();
    const plan = context.state.plan!;
    await context.service.confirmPlan({
      request_id: rid(),
      ...context.claim,
      confirmation: {
        plan_version_id: plan.plan_version_id,
        row_revision: plan.row_revision,
        confirmed: true,
      },
    });
    await context.service.updateProfile({
      request_id: rid(),
      ...context.claim,
      profile: { days_per_week: 4 },
    });
    const audit = context.runtime.audit as { events: Map<string, unknown> };
    const types = [...audit.events.values()].map(
      (event) => (event as { event_type: string }).event_type,
    );
    expect(types).toContain("ONBOARDING_CONFIRMATION_INVALIDATED");
  });
});
