/**
 * Start weights: Arnold's estimate in the analytics layer, and how the setup
 * fills a proposed plan with it. Synthetic fixture data only.
 */
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  canEstimateStartLoad,
  estimateStartLoad,
} from "../src/analytics/start-load";
import { createFixtureOnboarding } from "../src/server/onboarding/fixture";
import { newTrackerDataset } from "../src/server/account/catalog";
import { planFixtureDataset } from "../src/server/plan/fixture";

/** A new tracker: the starter catalog, no plan yet. */
const starter = () =>
  createFixtureOnboarding({
    dataset: newTrackerDataset(planFixtureDataset("empty").config.tracker_id),
  }).onboarding;

const rid = () => randomUUID();
const man = {
  sex: "male",
  body_weight_kg: 80,
  age_years: 30,
  experience: "intermediate",
} as const;

describe("estimateStartLoad", () => {
  it("starts an intermediate man of 80 kg on the light side", () => {
    expect(
      estimateStartLoad({ ...man, exercise_id: "bench-press", reps: 10 }),
    ).toBe(55);
    expect(estimateStartLoad({ ...man, exercise_id: "squat", reps: 10 })).toBe(
      65,
    );
  });

  it("rounds to what the equipment allows", () => {
    const dumbbell = estimateStartLoad({
      ...man,
      exercise_id: "dumbbell-shoulder-press",
      reps: 10,
    })!;
    expect(dumbbell % 2).toBe(0);
    const machine = estimateStartLoad({
      ...man,
      exercise_id: "leg-press",
      reps: 10,
    })!;
    expect(machine % 5).toBe(0);
    // An empty bar is the lightest barbell weight.
    expect(
      estimateStartLoad({
        exercise_id: "overhead-press",
        reps: 12,
        sex: "female",
        body_weight_kg: 55,
        experience: "beginner",
      }),
    ).toBe(20);
  });

  it("goes lighter for beginners, women, older people and more reps", () => {
    const base = estimateStartLoad({
      ...man,
      exercise_id: "lat-pulldown",
      reps: 10,
    })!;
    for (const change of [
      { experience: "beginner" as const },
      { sex: "female" as const },
      { age_years: 65 },
      { reps: 15 },
    ])
      expect(
        estimateStartLoad({
          ...man,
          exercise_id: "lat-pulldown",
          reps: 10,
          ...change,
        })!,
      ).toBeLessThan(base);
  });

  it("is the same for the same answers", () => {
    const input = { ...man, exercise_id: "barbell-row", reps: 8 };
    expect(estimateStartLoad(input)).toBe(estimateStartLoad(input));
  });

  it("follows a weight the user named, for the whole group", () => {
    const known = { "bench-press": 90 };
    const bench = estimateStartLoad({
      ...man,
      exercise_id: "bench-press",
      reps: 10,
      known,
    })!;
    expect(bench).toBeGreaterThan(80);
    expect(bench).toBeLessThanOrEqual(90);
    // Shoulder press follows the bench press, the squat does not.
    expect(
      estimateStartLoad({
        ...man,
        exercise_id: "overhead-press",
        reps: 10,
        known,
      })!,
    ).toBeGreaterThan(
      estimateStartLoad({ ...man, exercise_id: "overhead-press", reps: 10 })!,
    );
    expect(
      estimateStartLoad({ ...man, exercise_id: "squat", reps: 10, known }),
    ).toBe(estimateStartLoad({ ...man, exercise_id: "squat", reps: 10 }));
  });

  it("moves with the switch: lighter, normal, heavier", () => {
    const at = (level: "lighter" | "normal" | "heavier") =>
      estimateStartLoad({ ...man, exercise_id: "leg-press", reps: 10, level })!;
    expect(at("lighter")).toBeLessThan(at("normal"));
    expect(at("heavier")).toBeGreaterThan(at("normal"));
  });

  it("has nothing for bodyweight or unknown exercises", () => {
    expect(canEstimateStartLoad("pull-up")).toBe(false);
    expect(
      estimateStartLoad({ ...man, exercise_id: "pull-up", reps: 8 }),
    ).toBeNull();
    expect(
      estimateStartLoad({ ...man, exercise_id: "custom-thing", reps: 8 }),
    ).toBeNull();
  });
});

async function proposed(
  known?: Record<string, number>,
  exercises = [
    { exercise_id: "bench-press", target_sets: 3, rep_min: 8, rep_max: 10 },
    {
      exercise_id: "squat",
      target_sets: 3,
      rep_min: 6,
      rep_max: 8,
      target_load_kg: 100,
    },
    { exercise_id: "push-up", target_sets: 3, rep_min: 10, rep_max: 15 },
  ],
) {
  const service = starter();
  const started = await service.startOnboarding({ request_id: rid() });
  const claim = {};
  const saved = await service.updateProfile({
    request_id: rid(),
    ...claim,
    profile: {
      path: "arnold_plan",
      person: { sex: "male", body_weight_kg: 80, age_years: 30 },
      training: {
        primary_goal: "muscle_gain",
        experience: "intermediate",
        days_per_week: 1,
        session_minutes: 60,
        environment: "gym",
        ...(known ? { known_loads: known } : {}),
      },
    },
  });
  expect(saved.ok, saved.error?.message).toBe(true);
  const submitted = await service.submitPlanProposal({
    request_id: rid(),
    ...claim,
    name: "Ganzkörper",
    origin: "ai_proposal",
    sessions: [{ session_name: "Ganzkörper", exercises }],
  });
  expect(submitted.ok, submitted.error?.message).toBe(true);
  const state = submitted.state!;
  const items = state.plan!.sessions[0].exercises;
  const load = (id: string) =>
    items.find((e) => e.exercise_id === id)!.target_load_kg;
  return { state, load, items };
}

describe("start weights in the setup's plan proposal", () => {
  it("fills missing weights, keeps given ones, leaves bodyweight empty", async () => {
    const { load } = await proposed();
    expect(load("bench-press")).toBe(
      estimateStartLoad({ ...man, exercise_id: "bench-press", reps: 10 }),
    );
    expect(load("squat")).toBe(100);
    expect(load("push-up")).toBeNull();
  });

  it("uses the weights the user knows", async () => {
    const { load } = await proposed({ "bench-press": 100 });
    expect(load("bench-press")).toBeGreaterThan(85);
  });

  it("hands the card the three levels for every estimable exercise", async () => {
    const { state, items } = await proposed();
    const bench = items.find((e) => e.exercise_id === "bench-press")!;
    const estimate = state.load_estimates.find(
      (e) => e.plan_item_id === bench.plan_item_id,
    )!;
    expect(estimate.normal).toBe(bench.target_load_kg);
    expect(estimate.lighter).toBeLessThan(estimate.normal);
    expect(estimate.heavier).toBeGreaterThan(estimate.normal);
    expect(
      state.load_estimates.some(
        (e) =>
          e.plan_item_id ===
          items.find((i) => i.exercise_id === "push-up")!.plan_item_id,
      ),
    ).toBe(false);
  });

  it("stores and clears the known weights in the profile", async () => {
    const service = starter();
    const started = await service.startOnboarding({ request_id: rid() });
    const claim = {};
    const saved = await service.updateProfile({
      request_id: rid(),
      ...claim,
      profile: { training: { known_loads: { squat: 80 } } },
    });
    expect(saved.state!.session.profile.training.known_loads).toEqual({
      squat: 80,
    });
    const cleared = await service.updateProfile({
      request_id: rid(),
      ...claim,
      profile: { training: { known_loads: null } },
    });
    expect(cleared.state!.session.profile.training).not.toHaveProperty(
      "known_loads",
    );
  });
});
