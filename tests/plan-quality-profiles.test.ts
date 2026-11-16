import { describe, expect, it } from "vitest";
import {
  buildBrief,
  exerciseBudget,
  validateProposalAgainstProfile,
} from "../src/server/onboarding/profile";
import { createFixturePlanning } from "../src/server/plan/fixture";
import { newTrackerDataset } from "../src/server/account/catalog";
import { PlanWriteResponseSchema } from "../src/shared/plan-contract";
import {
  EXPECTED,
  QUALITY_PROFILES,
  availableIds,
  flawedPlan,
  toOnboardingProfile,
  type Sess,
} from "./fixtures/plan-quality-profiles";

/**
 * The quality set: twenty invented people, each with a good and a flawed plan.
 *
 * The claim is the server's, not the skill's: whatever model drafted the plan,
 * a good plan goes through without a single finding and a flawed one is either
 * refused (nothing saved) or named in plain language.
 */
const NOW = new Date("2026-06-01T08:00:00Z");

function runtime() {
  let n = 0;
  return createFixturePlanning(newTrackerDataset("quality-tracker"), {
    id: () => `q-${++n}`,
    clock: () => NOW,
  });
}

async function save(sessions: Sess[], request_id: string) {
  const rt = runtime();
  const response = PlanWriteResponseSchema.parse(
    await rt.plans.execute("create_training_plan", {
      request_id,
      name: "Testplan",
      origin: "ai_proposal",
      sessions,
    }),
  );
  return response;
}

describe("the quality set", () => {
  it("has twenty profiles with distinct keys", () => {
    expect(QUALITY_PROFILES).toHaveLength(20);
    expect(new Set(QUALITY_PROFILES.map((p) => p.key)).size).toBe(20);
  });

  it("covers beginners to experts, 2 to 6 days, gym, home and outdoors, running and protected areas", () => {
    const training = QUALITY_PROFILES.map((p) => p.training);
    expect(new Set(training.map((t) => t.experience))).toEqual(
      new Set(["beginner", "intermediate", "advanced"]),
    );
    const days = training.map((t) => t.days_per_week!);
    expect(Math.min(...days)).toBe(2);
    expect(Math.max(...days)).toBe(6);
    expect(new Set(training.map((t) => t.environment))).toEqual(
      new Set(["gym", "home", "outdoor", "mixed"]),
    );
    expect(
      training.some((t) => t.secondary_goals?.includes("endurance_running")),
    ).toBe(true);
    expect(QUALITY_PROFILES.some((p) => p.protect.length)).toBe(true);
    // every kind of flaw is exercised at least twice
    const kinds = QUALITY_PROFILES.map((p) => p.defect);
    // (the three profile rules of UX-012 have one profile each)
    const single = [
      "avoided_exercise",
      "missing_equipment",
      "over_time_budget",
    ];
    for (const kind of Object.keys(EXPECTED))
      expect(kinds.filter((k) => k === kind).length).toBeGreaterThanOrEqual(
        single.includes(kind) ? 1 : 2,
      );
  });
});

describe.each(QUALITY_PROFILES)("$key · $label", (profile) => {
  const onboarding = toOnboardingProfile(profile);

  it("has test data that is itself sound", () => {
    const available = availableIds(profile);
    const { max } = exerciseBudget(profile.training.session_minutes ?? 60);
    for (const session of profile.good) {
      expect(session.exercises.length).toBeLessThanOrEqual(max);
      for (const e of session.exercises)
        expect(available.has(e.exercise_id)).toBe(true);
    }
    expect(new Set(profile.good.map((s) => s.session_name)).size).toBe(
      profile.good.length,
    );
    expect(profile.good).toHaveLength(profile.training.days_per_week!);
    // the brief names the day count and the time the plan is held to
    const brief = buildBrief(onboarding, {
      onboarding_session_id: "o-1",
      exercises: newTrackerDataset("quality-tracker").exercises,
      now: "2026-06-01T08:00:00Z",
    });
    const constraints = brief.constraints.join(" ");
    expect(constraints).toContain(
      `Genau ${profile.training.days_per_week} Trainingseinheiten`,
    );
    expect(constraints).toContain(
      `${profile.training.session_minutes ?? 60} Minuten`,
    );
  });

  it("takes the good plan without a single finding", async () => {
    const fit = validateProposalAgainstProfile(onboarding, profile.good);
    expect(fit.valid).toBe(true);
    expect(fit.warnings).toEqual([]);

    const response = await save(profile.good, `good-${profile.key}`);
    expect(response.ok).toBe(true);
    const validation = response.result!.validation!;
    expect(validation.valid).toBe(true);
    expect(validation.errors).toEqual([]);
    expect(validation.warnings).toEqual([]);
  });

  it("refuses or names the flawed plan", async () => {
    const plan = flawedPlan(profile);
    const expected = EXPECTED[profile.defect];
    const fit = validateProposalAgainstProfile(onboarding, plan);

    if ("fitError" in expected) {
      expect(fit.valid).toBe(false);
      expect(fit.errors.map((i) => i.code)).toContain(expected.fitError);
      return;
    }
    if ("fitWarning" in expected) {
      expect(fit.warnings.map((i) => i.code)).toContain(expected.fitWarning);
      return;
    }
    // The fit check has no complaint; the plan service has.
    expect(fit.valid).toBe(true);
    const response = await save(plan, `bad-${profile.key}`);
    if ("refused" in expected) {
      expect(response.ok).toBe(false);
      expect(response.error!.code).toBe(expected.refused);
      expect(response.error!.message).toContain(expected.says);
      return;
    }
    expect(response.ok).toBe(true);
    const validation = response.result!.validation!;
    expect(validation.warnings.map((i) => i.code)).toContain(expected.warning);
    // plain language, no codes in the sentence
    for (const w of validation.warnings) expect(w.message).toMatch(/[a-zäöü]/);
  });
});
