/**
 * The redesigned setup: several goals, and the body weight from the Person
 * card becoming the first entry on the goals card. Synthetic fixture data.
 */
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createFixtureOnboarding } from "../src/server/onboarding/fixture";

const rid = () => randomUUID();

async function setup(person: Record<string, unknown> = {}) {
  const runtime = createFixtureOnboarding();
  const service = runtime.onboarding;
  const started = await service.startOnboarding({ request_id: rid() });
  const claim = {
    onboarding_session_id: started.state!.session.onboarding_session_id,
    session_token: started.session_token!,
  };
  const saved = await service.updateProfile({
    request_id: rid(),
    ...claim,
    profile: {
      path: "arnold_plan",
      person,
      training: {
        primary_goal: "muscle_gain",
        // The primary goal repeated here is dropped, never doubled.
        secondary_goals: ["general_fitness", "muscle_gain"],
        experience: "intermediate",
        days_per_week: 3,
        session_minutes: 50,
        environment: "gym",
        notes: "Ich will Klimmzüge lernen.",
      },
    },
  });
  expect(saved.ok, saved.error?.message).toBe(true);
  return { runtime, service, claim, state: saved.state! };
}

async function finish(
  service: Awaited<ReturnType<typeof setup>>["service"],
  claim: Awaited<ReturnType<typeof setup>>["claim"],
) {
  await service.requestPlanProposal({ request_id: rid(), ...claim });
  const brief = await service.getBrief(claim);
  const ids = brief.exercise_catalog.slice(0, 3).map((e) => e.exercise_id);
  const submitted = await service.submitPlanProposal({
    request_id: rid(),
    ...claim,
    name: "Push/Pull/Legs",
    origin: "ai_proposal",
    sessions: ids.map((exercise_id, i) => ({
      session_name: ["Push", "Pull", "Legs"][i],
      exercises: [{ exercise_id, target_sets: 3, rep_min: 8, rep_max: 12 }],
    })),
  });
  expect(submitted.ok, submitted.error?.message).toBe(true);
  const plan = submitted.state!.plan!;
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
  const finished = await service.finishSetup({ request_id: rid(), ...claim });
  expect(finished.ok, finished.error?.message).toBe(true);
  expect(finished.state!.session.status).toBe("COMPLETED");
  return finished;
}

describe("several goals", () => {
  it("keeps the primary goal first and the others beside it", async () => {
    const { state } = await setup();
    expect(state.session.profile.training.primary_goal).toBe("muscle_gain");
    expect(state.session.profile.training.secondary_goals).toEqual([
      "general_fitness",
    ]);
  });

  it("passes the further goals and the user's own words to the plan brief", async () => {
    const { service, claim } = await setup();
    await service.requestPlanProposal({ request_id: rid(), ...claim });
    const brief = await service.getBrief(claim);
    expect(brief.goal).toMatchObject({
      primary: "muscle_gain",
      secondary: ["general_fitness"],
      secondary_labels: ["Fit und gesund bleiben"],
    });
    expect(brief.constraints.join(" ")).toContain(
      "Zusätzlich gewünscht: Fit und gesund bleiben",
    );
    expect(brief.availability?.session_minutes).toBe(50);
    expect(brief.user_statements.map((s) => s.text)).toContain(
      "Ich will Klimmzüge lernen.",
    );
  });

  it("clears the further goals with an empty list", async () => {
    const { service, claim } = await setup();
    const cleared = await service.updateProfile({
      request_id: rid(),
      ...claim,
      profile: { training: { secondary_goals: [] } },
    });
    expect(cleared.state!.session.profile.training).not.toHaveProperty(
      "secondary_goals",
    );
  });
});

describe("start weight", () => {
  it("becomes the first body weight entry once the setup is finished", async () => {
    const { runtime, service, claim } = await setup({ body_weight_kg: 84.5 });
    expect((await runtime.store.read()).bodyWeights).toEqual([]);
    await finish(service, claim);
    const weights = (await runtime.store.read()).bodyWeights;
    expect(weights).toHaveLength(1);
    expect(weights[0]).toMatchObject({ weight_kg: 84.5, status: "active" });
    // Finishing again changes nothing and writes no second entry.
    const again = await service.finishSetup({ request_id: rid(), ...claim });
    expect(again.ok).toBe(true);
    expect((await runtime.store.read()).bodyWeights).toHaveLength(1);
  });

  it("writes nothing when no weight was given", async () => {
    const { runtime, service, claim } = await setup();
    await finish(service, claim);
    expect((await runtime.store.read()).bodyWeights).toEqual([]);
  });
});
