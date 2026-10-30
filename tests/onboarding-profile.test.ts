/**
 * Profile validation, the brief and the proposal fit check.
 *
 * Three themes run through these tests. A missing answer blocks and an unusual
 * answer does not: Arnold must not refuse to help because it would have
 * planned differently. The two paths ask for different things: "Plan mit
 * Arnold" needs the Training card, "Eigener Plan" needs nothing but the
 * choice. And the brief tells a model what it may *not* invent, because that
 * list is the only thing standing between a plausible plan and a fabricated one.
 */
import { describe, expect, it } from "vitest";
import {
  buildBrief,
  buildProgress,
  exerciseBudget,
  exerciseChoices,
  isPersonComplete,
  isProfileComplete,
  missingRequiredFields,
  validateProfile,
  validateProposalAgainstProfile,
} from "../src/server/onboarding/profile";
import { mergeProfile } from "../src/server/onboarding/service";
import { migrateLegacyRecord } from "../src/server/onboarding/repository";
import { planFixtureDataset } from "../src/server/plan/fixture";
import { newTrackerDataset } from "../src/server/connected/catalog";
import {
  OnboardingBriefSchema,
  OnboardingProfilePatchSchema,
  OnboardingSessionSchema,
  SESSION_MINUTES_MAX,
  SESSION_MINUTES_MIN,
  TRAINING_REQUIRED_FIELDS,
  splitsForDays,
  stepForStatus,
  type OnboardingProfile,
  type Training,
} from "../src/shared/onboarding-contract";
import {
  STARTER_EXERCISES,
  exercisesFor,
} from "../src/shared/exercise-starter-catalog";

const dataset = planFixtureDataset("empty");
const anExercise = dataset.exercises[0];

const empty = (): OnboardingProfile => ({
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
});

const complete = (
  training: Partial<Training> = {},
  rest: Partial<OnboardingProfile> = {},
): OnboardingProfile => ({
  ...empty(),
  path: "arnold_plan",
  training: {
    primary_goal: "muscle_gain",
    experience: "intermediate",
    days_per_week: 3,
    session_minutes: 60,
    environment: "gym",
    ...training,
  },
  revision: 1,
  updated_at_utc: "2026-05-01T10:00:00Z",
  ...rest,
});

const ownPlan = (): OnboardingProfile => ({
  ...empty(),
  path: "own_plan",
  revision: 1,
  updated_at_utc: "2026-05-01T10:00:00Z",
});

describe("the two paths", () => {
  it("asks only for the path before anything else", () => {
    expect(missingRequiredFields(empty())).toEqual(["path"]);
    expect(isProfileComplete(empty())).toBe(false);
    const result = validateProfile(empty());
    expect(result.errors[0].code).toBe("MISSING_PATH");
    expect(result.errors[0].step).toBe("welcome");
  });

  it("needs the five training answers for a plan by Arnold", () => {
    const profile = { ...empty(), path: "arnold_plan" as const };
    expect(missingRequiredFields(profile)).toEqual(
      TRAINING_REQUIRED_FIELDS.map((field) => `training.${field}`),
    );
    expect(isProfileComplete(complete())).toBe(true);
  });

  it("needs nothing more for an own plan", () => {
    expect(missingRequiredFields(ownPlan())).toEqual([]);
    expect(isProfileComplete(ownPlan())).toBe(true);
    expect(validateProfile(ownPlan()).valid).toBe(true);
  });

  it("reports exactly the one training answer still open, at the cards", () => {
    const profile = complete({ environment: null });
    expect(missingRequiredFields(profile)).toEqual(["training.environment"]);
    const result = validateProfile(profile);
    expect(result.valid).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].field).toBe("training.environment");
    expect(result.errors[0].step).toBe("profile");
  });

  it("opens the screen that belongs to the path", () => {
    expect(stepForStatus("COLLECTING_PROFILE", null)).toBe("welcome");
    expect(stepForStatus("COLLECTING_PROFILE", "arnold_plan")).toBe("profile");
    expect(stepForStatus("PROFILE_READY", "own_plan")).toBe("own_plan");
    expect(stepForStatus("REVIEWING_PLAN", "own_plan")).toBe("plan_review");
  });
});

describe("the Person card", () => {
  it("is optional: an empty card never blocks", () => {
    expect(validateProfile(complete()).valid).toBe(true);
    expect(isPersonComplete(complete())).toBe(false);
  });

  it("recommends the basics without demanding them", () => {
    const result = validateProfile(complete());
    expect(
      result.recommendations.some(
        (issue) => issue.code === "PERSON_INCOMPLETE",
      ),
    ).toBe(true);
  });

  it("is checked off once age, sex, height and weight are in", () => {
    const profile = complete(
      {},
      {
        person: {
          age_years: 32,
          sex: "female",
          height_cm: 168,
          body_weight_kg: 63.5,
        },
      },
    );
    expect(isPersonComplete(profile)).toBe(true);
    expect(
      validateProfile(profile).recommendations.some(
        (issue) => issue.code === "PERSON_INCOMPLETE",
      ),
    ).toBe(false);
  });

  it("refuses implausible body values at the schema boundary", () => {
    for (const person of [
      { age_years: 9 },
      { age_years: 130 },
      { height_cm: 80 },
      { body_weight_kg: 12 },
      { sex: "other" },
      { protect_areas: ["heart"] },
    ])
      expect(OnboardingProfilePatchSchema.safeParse({ person }).success).toBe(
        false,
      );
  });

  it("accepts null to remove an answer", () => {
    expect(
      OnboardingProfilePatchSchema.safeParse({
        person: { body_weight_kg: null },
      }).success,
    ).toBe(true);
  });
});

describe("the Training card", () => {
  it("accepts every goal, experience level, day count and place", () => {
    for (const primary_goal of [
      "muscle_gain",
      "strength",
      "fat_loss",
      "general_fitness",
    ] as const)
      expect(validateProfile(complete({ primary_goal })).valid).toBe(true);
    for (const experience of ["beginner", "intermediate", "advanced"] as const)
      expect(validateProfile(complete({ experience })).valid).toBe(true);
    for (let days = 1; days <= 7; days++)
      expect(validateProfile(complete({ days_per_week: days })).valid).toBe(
        true,
      );
    for (const environment of ["gym", "home", "outdoor", "mixed"] as const)
      expect(validateProfile(complete({ environment })).valid).toBe(true);
  });

  it("rejects unknown values and implausible numbers at the schema boundary", () => {
    for (const training of [
      { primary_goal: "bodybuilding" },
      { experience: "pro" },
      { environment: "office" },
      { days_per_week: 0 },
      { days_per_week: 8 },
      { session_minutes: 19 },
      { session_minutes: 151 },
      { training_days: ["monday"] },
      { split: "bro" },
      { preferred_exercise_ids: ["invented-exercise"] },
      { focus_muscle_groups: ["chest", "back", "legs", "arms"] },
    ])
      expect(
        OnboardingProfilePatchSchema.safeParse({ training }).success,
        JSON.stringify(training),
      ).toBe(false);
    for (const minutes of [SESSION_MINUTES_MIN, 60, SESSION_MINUTES_MAX])
      expect(
        OnboardingProfilePatchSchema.safeParse({
          training: { session_minutes: minutes },
        }).success,
      ).toBe(true);
  });

  it("refuses an exercise that is preferred and avoided at once", () => {
    expect(
      OnboardingProfilePatchSchema.safeParse({
        training: {
          preferred_exercise_ids: ["squat"],
          avoided_exercise_ids: ["squat"],
        },
      }).success,
    ).toBe(false);
  });

  it("refuses an empty patch", () => {
    expect(OnboardingProfilePatchSchema.safeParse({}).success).toBe(false);
  });

  it("treats a demanding week and a short session as advice", () => {
    for (const training of [{ days_per_week: 7 }, { session_minutes: 30 }]) {
      const result = validateProfile(complete(training));
      expect(result.valid).toBe(true);
      expect(result.recommendations.length).toBeGreaterThan(0);
    }
  });

  it("notes a split that does not fit the days, without blocking", () => {
    const result = validateProfile(
      complete({ days_per_week: 2, split: "push_pull_legs" }),
    );
    expect(result.valid).toBe(true);
    expect(
      result.recommendations.some(
        (issue) => issue.code === "SPLIT_DAYS_MISMATCH",
      ),
    ).toBe(true);
    expect(
      validateProfile(
        complete({ days_per_week: 3, split: "push_pull_legs" }),
      ).recommendations.some((issue) => issue.code === "SPLIT_DAYS_MISMATCH"),
    ).toBe(false);
  });

  it("asks about equipment for training at home or outdoors", () => {
    for (const environment of ["home", "outdoor"] as const)
      expect(
        validateProfile(complete({ environment })).recommendations.some(
          (issue) => issue.code === "EQUIPMENT_ENVIRONMENT_MISMATCH",
        ),
      ).toBe(true);
    expect(
      validateProfile(
        complete({ environment: "home", equipment: ["dumbbells"] }),
      ).recommendations.some(
        (issue) => issue.code === "EQUIPMENT_ENVIRONMENT_MISMATCH",
      ),
    ).toBe(false);
  });

  it("warns about a favourite that the place makes impossible", () => {
    const result = validateProfile(
      complete({ environment: "home", preferred_exercise_ids: ["leg-press"] }),
    );
    expect(result.valid).toBe(true);
    expect(result.warnings[0].code).toBe("PREFERRED_EXERCISE_UNAVAILABLE");
    expect(result.warnings[0].message).toContain("Beinpresse");
  });
});

describe("splits for a number of days", () => {
  it("always offers Arnold's choice first", () => {
    for (let days = 1; days <= 7; days++)
      expect(splitsForDays(days)[0]).toBe("auto");
  });

  it("follows the trainer's rule of thumb", () => {
    expect(splitsForDays(2)).toEqual(["auto", "full_body", "upper_lower"]);
    expect(splitsForDays(3)).toEqual(["auto", "full_body", "push_pull_legs"]);
    expect(splitsForDays(4)).toContain("upper_lower");
    expect(splitsForDays(4)).toContain("body_part");
    expect(splitsForDays(6)).toContain("push_pull_legs");
    expect(splitsForDays(6)).not.toContain("full_body");
  });
});

describe("the exercise picker", () => {
  it("offers the whole list in a gym", () => {
    expect(exercisesFor("gym")).toHaveLength(STARTER_EXERCISES.length);
  });

  it("offers only bodyweight at home without equipment", () => {
    const home = exercisesFor("home", []);
    expect(home.length).toBeGreaterThan(0);
    expect(home.every((exercise) => exercise.needs.length === 0)).toBe(true);
  });

  it("adds what the user owns", () => {
    const ids = exercisesFor("home", ["dumbbells"]).map((e) => e.exercise_id);
    expect(ids).toContain("dumbbell-curl");
    expect(ids).not.toContain("leg-press");
    expect(ids).not.toContain("dumbbell-bench-press"); // needs a bench too
  });

  it("counts the bars of a park outdoors", () => {
    const ids = exercisesFor("outdoor", []).map((e) => e.exercise_id);
    expect(ids).toContain("pull-up");
    expect(ids).toContain("dips");
    expect(ids).not.toContain("bench-press");
  });

  it("covers every muscle group in a gym, with labels", () => {
    const choices = exerciseChoices(complete());
    expect(new Set(choices.map((c) => c.muscle_group)).size).toBe(7);
    expect(choices.every((c) => c.muscle_group_label.length > 0)).toBe(true);
  });

  it("is the catalog a new tracker is seeded with", () => {
    const seeded = newTrackerDataset("trk_test").exercises.map(
      (e) => e.exercise_id,
    );
    expect(seeded).toEqual(STARTER_EXERCISES.map((e) => e.exercise_id));
  });

  it("keeps the ids existing trackers already use", () => {
    const ids = STARTER_EXERCISES.map((e) => e.exercise_id);
    for (const id of [
      "bench-press",
      "dumbbell-bench-press",
      "lateral-raise",
      "one-arm-row",
      "lat-pulldown",
      "pull-up",
      "squat",
      "leg-press",
      "leg-curl",
    ])
      expect(ids).toContain(id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("merging a patch", () => {
  it("keeps what the patch does not mention", () => {
    const merged = mergeProfile(complete(), {
      training: { session_minutes: 45 },
    });
    expect(merged.training.session_minutes).toBe(45);
    expect(merged.training.primary_goal).toBe("muscle_gain");
    expect(merged.path).toBe("arnold_plan");
  });

  it("lets fixed weekdays decide the number of days", () => {
    const merged = mergeProfile(complete(), {
      training: { training_days: ["fri", "mon", "wed", "mon"] },
    });
    expect(merged.training.training_days).toEqual(["mon", "wed", "fri"]);
    expect(merged.training.days_per_week).toBe(3);
  });

  it("drops fixed weekdays when a different count is chosen", () => {
    const withDays = {
      ...complete(),
      ...mergeProfile(complete(), {
        training: { training_days: ["mon", "wed", "fri"] },
      }),
    };
    const merged = mergeProfile(withDays, { training: { days_per_week: 4 } });
    expect(merged.training.days_per_week).toBe(4);
    expect(merged.training.training_days).toBeUndefined();
  });

  it("removes an answer on null and a list on []", () => {
    const withPerson = complete(
      { equipment: ["dumbbells"] },
      { person: { body_weight_kg: 80, age_years: 30 } },
    );
    const merged = mergeProfile(withPerson, {
      person: { body_weight_kg: null },
      training: { equipment: [] },
    });
    expect(merged.person).toEqual({ age_years: 30 });
    expect(merged.training.equipment).toBeUndefined();
  });

  it("moves an exercise from avoided to preferred instead of keeping both", () => {
    const before = complete({ avoided_exercise_ids: ["squat", "deadlift"] });
    const merged = mergeProfile(before, {
      training: { preferred_exercise_ids: ["squat"] },
    });
    expect(merged.training.preferred_exercise_ids).toEqual(["squat"]);
    expect(merged.training.avoided_exercise_ids).toEqual(["deadlift"]);
  });
});

describe("progress", () => {
  it("counts the path as the first answer and never exceeds 100", () => {
    const context = {
      step: "welcome" as const,
      can_request_plan: false,
      can_confirm_plan: false,
    };
    expect(buildProgress(empty(), context).percent).toBe(0);
    const started = buildProgress(
      { ...empty(), path: "arnold_plan" },
      { ...context, step: "profile" },
    );
    expect(started.answered_required).toBe(1);
    expect(started.total_required).toBe(6);
    const done = buildProgress(complete(), {
      ...context,
      step: "profile",
      can_confirm_plan: true,
    });
    expect(done.percent).toBeLessThanOrEqual(100);
    expect(done.training_complete).toBe(true);
    expect(done.completed_steps).toEqual(["welcome", "profile"]);
  });

  it("is complete right after choosing an own plan", () => {
    const progress = buildProgress(ownPlan(), {
      step: "own_plan",
      can_request_plan: true,
      can_confirm_plan: false,
    });
    expect(progress.profile_complete).toBe(true);
    expect(progress.training_complete).toBe(false);
    expect(progress.completed_steps).toEqual(["welcome", "own_plan"]);
  });
});

describe("the exercise budget", () => {
  it("grows with the available time and stays sane at the edges", () => {
    expect(exerciseBudget(30).max).toBeLessThan(exerciseBudget(90).max);
    for (const minutes of [20, 30, 45, 60, 90, 150]) {
      const budget = exerciseBudget(minutes);
      expect(budget.max).toBeGreaterThanOrEqual(3);
      expect(budget.max).toBeLessThanOrEqual(10);
      expect(budget.min).toBeGreaterThanOrEqual(2);
      expect(budget.min).toBeLessThanOrEqual(budget.max);
    }
  });
});

describe("the brief for a plan by Arnold", () => {
  const input = {
    onboarding_session_id: "onb-test",
    exercises: newTrackerDataset("trk_test").exercises,
    now: "2026-05-01T12:00:00Z",
  };
  const brief = () =>
    buildBrief(
      complete(
        {
          training_days: ["mon", "wed", "fri"],
          split: "auto",
          focus_muscle_groups: ["legs"],
          preferred_exercise_ids: ["bench-press"],
          avoided_exercise_ids: ["squat"],
          notes: "Ich trainiere am liebsten morgens.",
        },
        { person: { age_years: 41, protect_areas: ["knee"] } },
      ),
      input,
    );

  it("matches its schema and carries the stated facts", () => {
    const value = brief();
    expect(OnboardingBriefSchema.safeParse(value).success).toBe(true);
    expect(value.path).toBe("arnold_plan");
    expect(value.availability?.days_per_week).toBe(3);
    expect(value.availability?.training_days).toEqual(["mon", "wed", "fri"]);
    expect(value.goal?.primary_label).toBe("Muskeln aufbauen");
    expect(value.experience_label).toBe("Fortgeschritten");
    expect(value.environment_label).toBe("Fitnessstudio");
    expect(value.person.age_years).toBe(41);
  });

  it("names the days, the time budget and the split as constraints", () => {
    const text = brief().constraints.join(" ");
    expect(text).toContain("Genau 3 Trainingseinheiten");
    expect(text).toContain("Mo, Mi, Fr");
    expect(text).toContain("60 Minuten");
    expect(text).toContain("Ganzkörper");
  });

  it("passes body areas on as a preference, never as a diagnosis", () => {
    const text = brief().constraints.join(" ");
    expect(text).toContain("Knie");
    expect(text).toContain("keine Diagnose");
  });

  it("carries focus, favourites and avoided exercises by name", () => {
    const value = brief();
    const text = value.constraints.join(" ");
    expect(text).toContain("Schwerpunkt auf Beine");
    expect(text).toContain("Bankdrücken");
    expect(text).toContain("nicht einplanen: Kniebeugen");
    expect(value.preferred_exercises[0]).toEqual({
      exercise_id: "bench-press",
      name_de: "Bankdrücken",
      in_catalog: true,
    });
  });

  it("forbids inventing loads, exercises and performance claims", () => {
    const text = brief().must_not_invent.join(" ");
    expect(text).toContain("Trainingsgewichte");
    expect(text).toContain("Übungs-IDs");
    expect(text).toContain("medizinischen");
  });

  it("groups free text as user data rather than as an instruction", () => {
    expect(brief().user_statements).toEqual([
      { field: "training.notes", text: "Ich trainiere am liebsten morgens." },
    ]);
  });

  it("restricts home training to what the user owns", () => {
    const text = buildBrief(
      complete({ environment: "home", equipment: ["dumbbells"] }),
      input,
    ).constraints.join(" ");
    expect(text).toContain("zuhause");
    expect(text).toContain("Kurzhanteln");
  });

  it("refuses to build a brief from an incomplete profile", () => {
    expect(() => buildBrief(complete({ environment: null }), input)).toThrow();
    expect(() => buildBrief(empty(), input)).toThrow();
  });
});

describe("the brief for an own plan", () => {
  const value = buildBrief(ownPlan(), {
    onboarding_session_id: "onb-test",
    exercises: dataset.exercises,
    now: "2026-05-01T12:00:00Z",
  });

  it("matches its schema and states the task", () => {
    expect(OnboardingBriefSchema.safeParse(value).success).toBe(true);
    expect(value.path).toBe("own_plan");
    expect(value.task).toContain("existing_routine");
    expect(value.availability).toBeNull();
    expect(value.goal).toBeNull();
  });

  it("asks to transcribe, not to improve, and to leave gaps open", () => {
    const text = value.constraints.join(" ");
    expect(text).toContain("so übernehmen, wie er ist");
    expect(text).toContain("Foto");
    expect(text).toContain("open_questions");
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

  it("rejects a proposal with no session or an empty session", () => {
    expect(validateProposalAgainstProfile(complete(), []).errors[0].code).toBe(
      "PROPOSAL_NO_SESSION",
    );
    expect(
      validateProposalAgainstProfile(complete(), [
        { session_name: "Leer", exercises: [] },
      ]).errors[0].code,
    ).toBe("PROPOSAL_EMPTY_SESSION");
  });

  it("warns but does not block when the day count differs", () => {
    const result = validateProposalAgainstProfile(complete(), [
      session("Oberkörper"),
      session("Unterkörper"),
    ]);
    expect(result.valid).toBe(true);
    expect(result.warnings[0].code).toBe("PROPOSAL_DAYS_MISMATCH");
  });

  it("takes an own plan with any number of days", () => {
    const result = validateProposalAgainstProfile(ownPlan(), [
      session("A"),
      session("B"),
      session("C"),
      session("D"),
      session("E"),
    ]);
    expect(result.valid).toBe(true);
    expect(result.warnings).toEqual([]);
  });
});

describe("a setup stored before the two paths", () => {
  const legacy = (
    profile: Record<string, unknown>,
    status = "PROFILE_READY",
  ) => ({
    session: {
      onboarding_session_id: "onb-legacy",
      status,
      current_step: "summary",
      schema_version: "1.0.0",
      created_at_utc: "2026-05-01T10:00:00Z",
      updated_at_utc: "2026-05-01T10:00:00Z",
      expires_at_utc: "2026-05-02T10:00:00Z",
      revision: 4,
      profile: {
        primary_goal: "recomposition",
        experience: "beginner",
        days_per_week: 3,
        session_minutes: 45,
        environment: "home",
        starting_point: "new_plan",
        preferences: { notes: "morgens", preferred_split: "PPL" },
        revision: 3,
        updated_at_utc: "2026-05-01T10:00:00Z",
        ...profile,
      },
      plan_draft_reference: null,
      confirmed_plan_reference: null,
      handoff_status: "not_ready",
      last_error: null,
      tracker_id: "trk_test",
    },
  });

  it("keeps the answers a plan needs and lands on the right screen", () => {
    const migrated = migrateLegacyRecord(legacy({})) as {
      session: unknown;
    };
    const session = OnboardingSessionSchema.parse(migrated.session);
    expect(session.profile.path).toBe("arnold_plan");
    expect(session.profile.training.primary_goal).toBe("fat_loss");
    expect(session.profile.training.days_per_week).toBe(3);
    expect(session.profile.training.notes).toBe("morgens");
    expect(session.current_step).toBe("profile");
    expect(session.revision).toBe(4);
  });

  it("maps an existing plan to the own-plan path", () => {
    const migrated = migrateLegacyRecord(
      legacy({ starting_point: "existing_plan" }),
    ) as { session: unknown };
    expect(OnboardingSessionSchema.parse(migrated.session).profile.path).toBe(
      "own_plan",
    );
  });

  it("leaves a current record untouched", () => {
    const current = { session: { schema_version: "2.0.0" } };
    expect(migrateLegacyRecord(current)).toBe(current);
  });
});
