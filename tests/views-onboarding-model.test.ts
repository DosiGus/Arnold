/**
 * The new setup card's model (src/views/model/onboarding.ts) against the real
 * fixture onboarding service: card taps become one patch, the stored state
 * comes back as the card shows it, the plan carries Arnold's figures.
 */
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createFixtureOnboarding } from "../src/server/onboarding/fixture";
import type { OnboardingState } from "../src/shared/onboarding-contract";
import { planFixtureDataset } from "../src/server/plan/fixture";
import {
  awaitsChat,
  cardPlanFrom,
  cardProfileOf,
  cardViewOf,
  patchOf,
  phaseOf,
} from "../src/views/model/onboarding";
import type { Profile } from "../src/views/demo/model";

const rid = () => randomUUID();

async function setup() {
  const { onboarding } = createFixtureOnboarding();
  const started = await onboarding.startOnboarding({ request_id: rid() });
  let state = started.state!;
  const tap = async (change: Partial<Profile>) => {
    const profile = patchOf(state.session.profile, change);
    expect(profile).not.toBeNull();
    const res = await onboarding.updateProfile({ request_id: rid(), profile });
    expect(res.ok, res.error?.message).toBe(true);
    state = res.state!;
    return state;
  };
  return { onboarding, tap, state: () => state };
}

describe("card taps → service → card", () => {
  it("round-trips every card answer", async () => {
    const { tap } = await setup();
    await tap({ path: "arnold_plan" });
    expect(phaseOf(await tap({ weight: 80, sex: "female" }), "open")).toBe(
      "profile",
    );
    await tap({ goals: ["muscle_gain", "fat_loss"] });
    await tap({
      strengthStand: { recent: "irregular", years: "gt3", pause: "lt3m" },
    });
    await tap({ days: 4, minutes: 60, places: ["home"] });
    await tap({ run: true, mobility: true, morning: true });
    await tap({
      runGoals: ["longer"],
      runStand: { recent: "none", years: "lt1", pause: "gt12m" },
    });
    await tap({
      mobilityFocus: ["lower_back"],
      placement: "own_days",
      job: "moving",
    });
    const s = await tap({ morningMinutes: 5, notes: "  Knie schonen " });
    const card = cardProfileOf(s.session.profile);
    expect(card).toMatchObject({
      path: "arnold_plan",
      weight: 80,
      sex: "female",
      goals: ["muscle_gain", "fat_loss"],
      strengthStand: { recent: "irregular", years: "gt3", pause: "lt3m" },
      days: 4,
      minutes: 60,
      places: ["home"],
      strength: true,
      run: true,
      mobility: true,
      morning: true,
      runGoals: ["longer"],
      mobilityFocus: ["lower_back"],
      placement: "own_days",
      job: "moving",
      morningMinutes: 5,
      notes: "Knie schonen",
    });
    expect(s.session.profile.training.experience).toBe("advanced");
    const view = cardViewOf(s, "open");
    expect(view.canCreatePlan).toBe(true);
    expect(view.answered).toBe(view.total);
    expect(view.required.every((r) => r.value !== null)).toBe(true);
  });

  it("clears answers again and shows what is missing with the card's labels", async () => {
    const { tap } = await setup();
    await tap({ path: "arnold_plan", goals: ["strength"] });
    const s = await tap({ goals: [], weight: undefined });
    expect(s.session.profile.training.primary_goal).toBeNull();
    expect(s.session.profile.person.body_weight_kg).toBeUndefined();
    const missing = cardViewOf(s, "open")
      .required.filter((r) => r.value === null)
      .map((r) => r.label);
    expect(missing).toContain("Hauptziel Kraft");
    expect(missing).toContain("Trainingsstand Kraft");
  });

  it("shows the plan with Arnold's weekly sets and example week, confirms and finishes", async () => {
    const { onboarding, tap } = await setup();
    await tap({
      path: "arnold_plan",
      goals: ["muscle_gain"],
      strengthStand: { recent: "regular", years: "lt1" },
      days: 2,
      minutes: 60,
      places: ["gym"],
    });
    const requested = await onboarding.requestPlanProposal({
      request_id: rid(),
    });
    expect(cardViewOf(requested.state!, "open").phase).toBe("profile");
    const brief = await onboarding.getBrief({});
    const ids = brief.exercise_catalog.slice(0, 2).map((e) => e.exercise_id);
    const proposed = await onboarding.submitPlanProposal({
      request_id: rid(),
      name: "Plan",
      origin: "ai_proposal",
      sessions: ids.map((exercise_id, i) => ({
        session_name: `Tag ${i + 1}`,
        exercises: [{ exercise_id, target_sets: 3, rep_min: 8, rep_max: 8 }],
      })),
    });
    const state: OnboardingState = proposed.state!;
    const view = cardViewOf(state, "open");
    expect(view.phase).toBe("plan");
    const plan = view.plan!;
    expect(plan.days).toHaveLength(2);
    expect(plan.days[0]!.exercises[0]).toMatchObject({ sets: 3, reps: "8" });
    expect(plan.week).toHaveLength(7);
    expect(plan.week!.flat().filter((k) => k === "strength")).toHaveLength(2);
    expect(plan.weeklySets!.every((r) => r.min === 6 && r.max === 10)).toBe(
      true,
    );
    // No explanation was written: the card shows none, never an invented one.
    expect(plan.explanation).toBeUndefined();

    const done = await onboarding.confirmPlan({
      request_id: rid(),
      confirmation: {
        plan_version_id: state.plan!.plan_version_id,
        row_revision: state.plan!.row_revision,
        confirmed: true,
      },
    });
    expect(done.ok, done.error?.message).toBe(true);
    expect(cardViewOf(done.state!, "open").phase).toBe("wearable");
    // The card finishes the setup (if the confirmation did not already) before
    // it leaves the watch step.
    const finished =
      done.state!.session.status === "COMPLETED"
        ? done
        : await onboarding.finishSetup({ request_id: rid() });
    expect(finished.state!.session.status).toBe("COMPLETED");
    expect(cardViewOf(finished.state!, "open").phase).toBe("wearable");
    // Choosing "Uhr koppeln" keeps the step until paired or skipped.
    expect(cardViewOf(finished.state!, "connect").phase).toBe("wearable");
    expect(cardViewOf(finished.state!, "paired").phase).toBe("done");
    expect(cardViewOf(finished.state!, "later").phase).toBe("done");
  });

  it("reads the plan card after the setup: plan, figures, saved answers", async () => {
    const { onboarding } = createFixtureOnboarding({
      dataset: planFixtureDataset(),
    });
    const card = await onboarding.planCard({});
    expect(card.plan).not.toBeNull();
    // No stored setup: no range is claimed.
    expect(card.profile).toBeNull();
    expect(card.plan_insights!.weekly_sets.every((r) => r.min === null)).toBe(
      true,
    );
    const plan = cardPlanFrom(
      card.plan,
      card.plan_insights,
      card.load_estimates,
    )!;
    expect(plan.split).toBe("Push / Pull / Beine");
    expect(plan.days.length).toBe(card.plan!.session_count);
    expect(plan.week).toHaveLength(7);
  });

  it("answers without a plan instead of failing", async () => {
    const { onboarding } = createFixtureOnboarding();
    const card = await onboarding.planCard({});
    expect(card).toMatchObject({ plan: null, plan_insights: null });
  });
});

describe("awaitsChat", () => {
  const state = (status: string, path: string | null, plan: unknown = null) =>
    ({ session: { status, profile: { path } }, plan }) as never;

  it("reads on while Arnold builds or the own plan is still to come", () => {
    expect(awaitsChat(state("WAITING_FOR_PLAN_PROPOSAL", "arnold_plan"))).toBe(
      true,
    );
    expect(awaitsChat(state("COLLECTING_PROFILE", "own_plan"))).toBe(true);
  });

  it("stops once the plan is there or the setup is done", () => {
    expect(awaitsChat(state("REVIEWING_PLAN", "own_plan", {}))).toBe(false);
    expect(awaitsChat(state("COMPLETED", "own_plan"))).toBe(false);
    expect(awaitsChat(state("COLLECTING_PROFILE", "arnold_plan"))).toBe(false);
  });
});
