/**
 * Profile validation, the brief and the proposal fit check.
 *
 * Two themes run through these tests. The first is that a missing answer blocks
 * and an unusual answer does not: Arnold must not refuse to help because it
 * would have planned differently. The second is that the brief tells a model
 * what it may *not* invent — unknown loads, unknown exercise ids, performance
 * claims — because that list is the only thing standing between a plausible
 * plan and a fabricated one.
 */
import { describe, expect, it } from "vitest";
import {
  buildBrief,
  buildProgress,
  exerciseBudget,
  isProfileComplete,
  missingRequiredFields,
  validateProfile,
  validateProposalAgainstProfile,
} from "../src/server/onboarding/profile";
import { planFixtureDataset } from "../src/server/plan/fixture";
import {
  OnboardingBriefSchema,
  OnboardingProfilePatchSchema,
  KnownStartingLoadSchema,
  REQUIRED_PROFILE_FIELDS,
  SESSION_MINUTES_MAX,
  SESSION_MINUTES_MIN,
  type OnboardingProfile,
} from "../src/shared/onboarding-contract";

const dataset = planFixtureDataset("empty");
const catalog = new Map(dataset.exercises.map((row) => [row.exercise_id, row]));
const anExercise = dataset.exercises[0];

const empty = (): OnboardingProfile => ({
  primary_goal: null,
  experience: null,
  days_per_week: null,
  session_minutes: null,
  environment: null,
  starting_point: null,
  preferences: {},
  revision: 0,
  updated_at_utc: null,
});

const complete = (
  overrides: Partial<OnboardingProfile> = {},
): OnboardingProfile => ({
  ...empty(),
  primary_goal: "muscle_gain",
  experience: "intermediate",
  days_per_week: 3,
  session_minutes: 60,
  environment: "gym",
  starting_point: "new_plan",
  revision: 1,
  updated_at_utc: "2026-05-01T10:00:00Z",
  ...overrides,
});

describe("completeness", () => {
  it("names every missing required answer in asking order", () => {
    expect(missingRequiredFields(empty())).toEqual([
      ...REQUIRED_PROFILE_FIELDS,
    ]);
    expect(isProfileComplete(empty())).toBe(false);
  });

  it("is complete once all six answers are present", () => {
    expect(missingRequiredFields(complete())).toEqual([]);
    expect(isProfileComplete(complete())).toBe(true);
  });

  it("reports exactly the one answer that is still open", () => {
    const profile = complete({ environment: null });
    expect(missingRequiredFields(profile)).toEqual(["environment"]);
    const result = validateProfile(profile);
    expect(result.valid).toBe(false);
    expect(result.errors).toHaveLength(1);
    // The finding is anchored at the field and the step that collects it, so
    // the UI can render it at the input rather than in a banner.
    expect(result.errors[0].field).toBe("environment");
    expect(result.errors[0].step).toBe("availability");
  });

  it("optional answers never block", () => {
    const result = validateProfile(complete());
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });
});

describe("every valid enum value is accepted", () => {
  it("accepts all four goals", () => {
    for (const goal of [
      "muscle_gain",
      "strength",
      "general_fitness",
      "recomposition",
    ] as const)
      expect(validateProfile(complete({ primary_goal: goal })).valid).toBe(
        true,
      );
  });

  it("accepts beginner, intermediate and advanced", () => {
    for (const experience of ["beginner", "intermediate", "advanced"] as const)
      expect(validateProfile(complete({ experience })).valid).toBe(true);
  });

  it("accepts one through seven training days", () => {
    for (let days = 1; days <= 7; days++)
      expect(validateProfile(complete({ days_per_week: days })).valid).toBe(
        true,
      );
  });

  it("accepts gym, home and mixed", () => {
    for (const environment of ["gym", "home", "mixed"] as const)
      expect(
        validateProfile(
          complete({
            environment,
            preferences:
              environment === "home"
                ? { available_equipment: ["Kurzhanteln"] }
                : {},
          }),
        ).valid,
      ).toBe(true);
  });

  it("accepts all three starting situations", () => {
    for (const starting_point of [
      "new_plan",
      "existing_plan",
      "undecided",
    ] as const)
      expect(validateProfile(complete({ starting_point })).valid).toBe(true);
  });
});

describe("implausible and unknown values", () => {
  it("rejects an unknown enum value at the schema boundary", () => {
    expect(
      OnboardingProfilePatchSchema.safeParse({ primary_goal: "bodybuilding" })
        .success,
    ).toBe(false);
    expect(
      OnboardingProfilePatchSchema.safeParse({ experience: "pro" }).success,
    ).toBe(false);
    expect(
      OnboardingProfilePatchSchema.safeParse({ environment: "outdoor" })
        .success,
    ).toBe(false);
  });

  it("rejects day counts outside one to seven", () => {
    for (const days of [0, -1, 8, 2.5])
      expect(
        OnboardingProfilePatchSchema.safeParse({ days_per_week: days }).success,
      ).toBe(false);
  });

  it("rejects a session length outside the plausible band", () => {
    for (const minutes of [5, 19, 151, 600])
      expect(
        OnboardingProfilePatchSchema.safeParse({ session_minutes: minutes })
          .success,
      ).toBe(false);
    for (const minutes of [SESSION_MINUTES_MIN, 60, SESSION_MINUTES_MAX])
      expect(
        OnboardingProfilePatchSchema.safeParse({ session_minutes: minutes })
          .success,
      ).toBe(true);
  });

  it("refuses an empty patch", () => {
    expect(OnboardingProfilePatchSchema.safeParse({}).success).toBe(false);
  });

  it("treats a demanding but legal week as advice, not an error", () => {
    const result = validateProfile(complete({ days_per_week: 7 }));
    expect(result.valid).toBe(true);
    expect(
      result.recommendations.some(
        (issue) => issue.code === "IMPLAUSIBLE_DAYS_PER_WEEK",
      ),
    ).toBe(true);
  });

  it("treats a short session as advice, not an error", () => {
    const result = validateProfile(complete({ session_minutes: 30 }));
    expect(result.valid).toBe(true);
    expect(
      result.recommendations.some(
        (issue) => issue.code === "IMPLAUSIBLE_SESSION_MINUTES",
      ),
    ).toBe(true);
  });
});

describe("starting loads", () => {
  it("needs the load convention, not just a number", () => {
    expect(
      KnownStartingLoadSchema.safeParse({
        exercise_id: anExercise.exercise_id,
        load_kg: 60,
      }).success,
    ).toBe(false);
    expect(
      KnownStartingLoadSchema.safeParse({
        exercise_id: anExercise.exercise_id,
        load_kg: 60,
        load_basis: anExercise.default_load_basis,
        execution_mode: anExercise.default_execution_mode,
      }).success,
    ).toBe(true);
  });

  it("warns about a load for an exercise outside the catalog", () => {
    const result = validateProfile(
      complete({
        preferences: {
          known_starting_loads: [
            {
              exercise_id: "does-not-exist",
              load_kg: 50,
              load_basis: "total",
              execution_mode: "bilateral_simultaneous",
            },
          ],
        },
      }),
      catalog,
    );
    // A warning, not an error: the rest of the profile is perfectly usable.
    expect(result.valid).toBe(true);
    expect(
      result.warnings.some(
        (issue) => issue.code === "UNKNOWN_EXERCISE_REFERENCE",
      ),
    ).toBe(true);
  });

  it("warns when the stated basis disagrees with the catalog", () => {
    const perImplement = dataset.exercises.find(
      (row) => row.default_load_basis === "per_implement",
    )!;
    const result = validateProfile(
      complete({
        preferences: {
          known_starting_loads: [
            {
              exercise_id: perImplement.exercise_id,
              load_kg: 20,
              load_basis: "total",
              execution_mode: perImplement.default_execution_mode,
            },
          ],
        },
      }),
      catalog,
    );
    expect(
      result.warnings.some(
        (issue) => issue.code === "INCOMPLETE_STARTING_LOAD",
      ),
    ).toBe(true);
  });
});

describe("an existing routine", () => {
  it("marks a day without exercises as needing completion", () => {
    const result = validateProfile(
      complete({
        starting_point: "existing_plan",
        preferences: { existing_routine: [{ session_name: "Push" }] },
      }),
      catalog,
    );
    expect(
      result.warnings.some(
        (issue) => issue.code === "EXISTING_ROUTINE_INCOMPLETE",
      ),
    ).toBe(true);
  });

  it("marks missing sets or reps without inventing them", () => {
    const result = validateProfile(
      complete({
        starting_point: "existing_plan",
        preferences: {
          existing_routine: [
            { session_name: "Push", exercises: [{ name: "Bankdrücken" }] },
          ],
        },
      }),
      catalog,
    );
    expect(
      result.warnings.filter(
        (issue) => issue.code === "EXISTING_ROUTINE_INCOMPLETE",
      ).length,
    ).toBeGreaterThan(0);
    // Still usable: an incomplete routine is a starting point, not a failure.
    expect(result.valid).toBe(true);
  });
});

describe("progress", () => {
  it("counts answers and never exceeds 100", () => {
    const partial = buildProgress(complete({ environment: null }), {
      step: "availability",
      can_request_plan: false,
      can_confirm_plan: false,
    });
    expect(partial.answered_required).toBe(5);
    expect(partial.total_required).toBe(6);
    expect(partial.profile_complete).toBe(false);
    expect(partial.percent).toBeLessThan(100);

    const done = buildProgress(complete(), {
      step: "confirmation",
      can_request_plan: true,
      can_confirm_plan: true,
    });
    expect(done.profile_complete).toBe(true);
    expect(done.percent).toBeLessThanOrEqual(100);
    expect(done.percent).toBeGreaterThan(partial.percent);
  });

  it("marks the summary complete only when every answer is in", () => {
    expect(
      buildProgress(complete({ primary_goal: null }), {
        step: "summary",
        can_request_plan: false,
        can_confirm_plan: false,
      }).completed_steps,
    ).not.toContain("summary");
    expect(
      buildProgress(complete(), {
        step: "summary",
        can_request_plan: true,
        can_confirm_plan: false,
      }).completed_steps,
    ).toContain("summary");
  });
});

describe("the exercise budget", () => {
  it("grows with the available time and stays sane at the edges", () => {
    expect(exerciseBudget(30).max).toBeLessThan(exerciseBudget(90).max);
    expect(exerciseBudget(20).max).toBeGreaterThanOrEqual(3);
    expect(exerciseBudget(150).max).toBeLessThanOrEqual(10);
    for (const minutes of [20, 30, 45, 60, 75, 90, 120, 150]) {
      const budget = exerciseBudget(minutes);
      expect(budget.min).toBeGreaterThanOrEqual(2);
      expect(budget.min).toBeLessThanOrEqual(budget.max);
    }
  });
});

describe("the brief", () => {
  const brief = () =>
    buildBrief(
      complete({
        preferences: {
          avoided_exercises: ["Kniebeugen"],
          preferred_exercises: ["Bankdrücken"],
          notes: "Ich trainiere am liebsten morgens.",
        },
      }),
      {
        onboarding_session_id: "onb-test",
        exercises: dataset.exercises,
        now: "2026-05-01T12:00:00Z",
      },
    );

  it("matches its schema and carries the stated facts", () => {
    const result = OnboardingBriefSchema.safeParse(brief());
    expect(result.success).toBe(true);
    const value = brief();
    expect(value.availability.days_per_week).toBe(3);
    expect(value.availability.session_minutes).toBe(60);
    expect(value.goal.primary_label).toBe("Muskelaufbau");
    expect(value.experience_label).toBe("Fortgeschritten");
    expect(value.environment_label).toBe("Fitnessstudio");
  });

  it("offers only active catalog entries with their load conventions", () => {
    const value = brief();
    expect(value.exercise_catalog.length).toBeGreaterThan(0);
    expect(value.exercise_catalog.length).toBe(
      dataset.exercises.filter((row) => row.status === "active").length,
    );
    for (const entry of value.exercise_catalog) {
      expect(catalog.has(entry.exercise_id)).toBe(true);
      expect(entry.default_load_basis).toBeDefined();
      expect(entry.default_execution_mode).toBeDefined();
    }
  });

  it("names the day count and the time budget as hard constraints", () => {
    const text = brief().constraints.join(" ");
    expect(text).toContain("3 Trainingstage");
    expect(text).toContain("60 Minuten");
    expect(text).toContain("exercise_id");
  });

  it("forbids inventing loads, exercises and performance claims", () => {
    const forbidden = brief().must_not_invent.join(" ");
    expect(forbidden).toMatch(/Trainingsgewichte erfinden/);
    expect(forbidden).toMatch(/Übungs-IDs erfinden/);
    expect(forbidden).toMatch(/Leistungswerte/);
    expect(forbidden).toMatch(/medizinische/i);
    // No efficacy promises, and no claim the plan is already stored.
    expect(forbidden).toMatch(/Wirksamkeitsversprechen/);
    expect(forbidden).toMatch(/aktiviert oder gespeichert/);
  });

  it("carries avoided and preferred exercises into the constraints", () => {
    const text = brief().constraints.join(" ");
    expect(text).toContain("Kniebeugen");
    expect(text).toContain("Bankdrücken");
  });

  it("groups free text as user data rather than as an instruction", () => {
    const value = brief();
    expect(value.user_statements).toEqual([
      {
        field: "preferences.notes",
        text: "Ich trainiere am liebsten morgens.",
      },
    ]);
    // The note must not have leaked into the machine-readable rules.
    expect(value.constraints.join(" ")).not.toContain("morgens");
    expect(value.must_not_invent.join(" ")).not.toContain("morgens");
  });

  it("asks for an existing routine to be preserved when that is the situation", () => {
    const value = buildBrief(
      complete({
        starting_point: "existing_plan",
        preferences: {
          existing_routine: [
            {
              session_name: "Push",
              exercises: [{ name: "Bankdrücken", target_sets: 3 }],
            },
          ],
        },
      }),
      {
        onboarding_session_id: "onb-test",
        exercises: dataset.exercises,
        now: "2026-05-01T12:00:00Z",
      },
    );
    expect(value.constraints.join(" ")).toMatch(/bestehende Routine/i);
  });

  it("refuses to build a brief from an incomplete profile", () => {
    expect(() =>
      buildBrief(complete({ days_per_week: null }), {
        onboarding_session_id: "onb-test",
        exercises: dataset.exercises,
        now: "2026-05-01T12:00:00Z",
      }),
    ).toThrow();
  });

  it("restricts home training to the stated equipment", () => {
    const value = buildBrief(
      complete({
        environment: "home",
        preferences: { available_equipment: ["Kurzhanteln"] },
      }),
      {
        onboarding_session_id: "onb-test",
        exercises: dataset.exercises,
        now: "2026-05-01T12:00:00Z",
      },
    );
    expect(value.constraints.join(" ")).toMatch(/zuhause/i);
  });
});

describe("proposal fit against the profile", () => {
  const session = (name: string) => ({
    session_name: name,
    exercises: [{ exercise_id: anExercise.exercise_id }],
  });

  it("accepts a three-day plan for three training days", () => {
    const result = validateProposalAgainstProfile(complete(), [
      session("Push"),
      session("Pull"),
      session("Legs"),
    ]);
    expect(result.valid).toBe(true);
    expect(result.warnings).toEqual([]);
  });

  it("accepts a four-day plan for four training days", () => {
    const result = validateProposalAgainstProfile(
      complete({ days_per_week: 4 }),
      ["A", "B", "C", "D"].map(session),
    );
    expect(result.valid).toBe(true);
    expect(result.warnings).toEqual([]);
  });

  it("rejects a proposal with no session at all", () => {
    const result = validateProposalAgainstProfile(complete(), []);
    expect(result.valid).toBe(false);
    expect(result.errors[0].code).toBe("PROPOSAL_NO_SESSION");
  });

  it("rejects a session without exercises", () => {
    const result = validateProposalAgainstProfile(complete(), [
      { session_name: "Leer", exercises: [] },
    ]);
    expect(result.valid).toBe(false);
    expect(result.errors[0].code).toBe("PROPOSAL_EMPTY_SESSION");
  });

  it("warns but does not block when the day count differs", () => {
    const result = validateProposalAgainstProfile(complete(), [
      session("Oberkörper"),
      session("Unterkörper"),
    ]);
    // The editor lets the user change it; refusing outright would reject a plan
    // they might well want.
    expect(result.valid).toBe(true);
    expect(result.warnings[0].code).toBe("PROPOSAL_DAYS_MISMATCH");
    expect(result.warnings[0].message).toContain("2");
    expect(result.warnings[0].message).toContain("3");
  });
});
