/**
 * Onboarding 2.0 profile contract (RDS-003): modules and their required
 * answers, anchor weights as weight × repetitions, the anchor per equipment,
 * and the mat rule of the morning routine. Synthetic data only.
 */
import { describe, expect, it } from "vitest";
import {
  KnownLoadsSchema,
  OnboardingModulesSchema,
  OnboardingProfileSchema,
  OnboardingRunSchema,
  modulesOf,
  normalizeKnownLoads,
  requiredFieldsFor,
  type OnboardingModules,
  type OnboardingProfile,
  type OnboardingProfilePatch,
} from "../src/shared/onboarding-contract";
import {
  buildBrief,
  buildProgress,
  isProfileComplete,
  knownLoadAnchors,
  mergeProfile,
  missingRequiredFields,
  openQuestions,
  runSetupState,
} from "../src/shared/onboarding-profile";
import {
  MOBILITY_CATALOG,
  allowedInMorning,
  mobilityExercise,
} from "../src/shared/mobility-catalog";
import { buildMobilityRoutine } from "../src/analytics/mobility/timing";
import { estimateStartLoad } from "../src/analytics/start-load";
import { recordSetupRunProfile } from "../src/server/onboarding/run-profile";

const STRENGTH = [
  "training.primary_goal",
  "training.experience",
  "training.days_per_week",
  "training.session_minutes",
  "training.environment",
];
const RUN = ["training.run.aims", "training.run.background"];

const modules = (partial: Partial<OnboardingModules>): OnboardingModules => ({
  running: false,
  mobility: false,
  morning_routine: false,
  ...partial,
});

const empty = (): OnboardingProfile => ({
  path: "arnold_plan",
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

const merged = (
  before: OnboardingProfile,
  patch: OnboardingProfilePatch,
): OnboardingProfile => ({ ...before, ...mergeProfile(before, patch) });

const STRENGTH_ANSWERS = {
  primary_goal: "muscle_gain",
  experience: "intermediate",
  days_per_week: 3,
  session_minutes: 60,
  environment: "gym",
} as const;

const RUN_ANSWERS = {
  runs_per_week: 2,
  base_minutes_per_week: 60,
  longest_run_4w_min: 40,
  preferred_environment: "outdoor",
} as const;

describe("requiredFieldsFor by modules (D-01)", () => {
  it("strength only: the strength answers", () => {
    expect(requiredFieldsFor("arnold_plan", modules({}))).toEqual(STRENGTH);
    // Without a module choice it is strength only as well.
    expect(requiredFieldsFor("arnold_plan")).toEqual(STRENGTH);
  });

  it("+ running: the run details, no goal among them", () => {
    const fields = requiredFieldsFor("arnold_plan", modules({ running: true }));
    expect(fields).toEqual([...STRENGTH, ...RUN]);
    expect(fields.some((f) => f.includes("goal") && f.includes("run"))).toBe(
      false,
    );
  });

  it("+ mobility: stiff areas, and sessions as the mobility answer", () => {
    expect(
      requiredFieldsFor("arnold_plan", modules({ mobility: true })),
    ).toEqual([
      ...STRENGTH,
      "training.mobility.stiff_areas",
      "training.mobility.sessions",
    ]);
  });

  it("+ mobility with morning routine: minutes, weekdays and the mat", () => {
    expect(
      requiredFieldsFor(
        "arnold_plan",
        modules({ mobility: true, morning_routine: true }),
      ),
    ).toEqual([
      ...STRENGTH,
      "training.mobility.stiff_areas",
      "training.mobility.morning.minutes",
      "training.mobility.morning.weekdays",
      "training.has_mat",
    ]);
  });

  it("all modules together", () => {
    expect(
      requiredFieldsFor(
        "arnold_plan",
        modules({ running: true, mobility: true, morning_routine: true }),
      ),
    ).toHaveLength(STRENGTH.length + RUN.length + 4);
  });

  it("no path asks the path; an own plan asks nothing", () => {
    expect(requiredFieldsFor(null, modules({ running: true }))).toEqual([
      "path",
    ]);
    expect(requiredFieldsFor("own_plan", modules({ running: true }))).toEqual(
      [],
    );
  });

  it("the morning routine belongs to mobility", () => {
    expect(
      OnboardingModulesSchema.safeParse(
        modules({ mobility: false, morning_routine: true }),
      ).success,
    ).toBe(false);
  });
});

describe("completeness and progress follow the modules", () => {
  it("strength only is complete with the strength answers", () => {
    const profile = merged(empty(), {
      training: { ...STRENGTH_ANSWERS, modules: modules({}) },
    });
    expect(missingRequiredFields(profile)).toEqual([]);
    expect(isProfileComplete(profile)).toBe(true);
  });

  it("running needs the run details, the goal is optional", () => {
    let profile = merged(empty(), {
      training: { ...STRENGTH_ANSWERS, modules: modules({ running: true }) },
    });
    expect(missingRequiredFields(profile)).toEqual(RUN);
    const progress = buildProgress(profile, {
      step: "profile",
      can_request_plan: false,
      can_confirm_plan: false,
    });
    expect(progress.total_required).toBe(1 + STRENGTH.length + RUN.length);
    expect(progress.missing_fields).toEqual(RUN);
    expect(progress.profile_complete).toBe(false);
    // One question for the four run fields.
    const questions = openQuestions(profile, runSetupState(profile.training));
    expect(questions.map((q) => q.id)).toEqual(["run_details"]);
    expect(questions[0].fields).toEqual(RUN);

    profile = merged(profile, { training: { run: RUN_ANSWERS } });
    expect(isProfileComplete(profile)).toBe(true);
    expect(profile.training.run?.goal).toBeUndefined();
  });

  it("the run profile no longer hangs on the goal endurance_running", () => {
    const profile = merged(empty(), {
      training: {
        ...STRENGTH_ANSWERS,
        primary_goal: "strength",
        modules: modules({ running: true }),
        run: { ...RUN_ANSWERS, goal: "10k", race_date: "2027-04-01" },
      },
    });
    expect(isProfileComplete(profile)).toBe(true);
    expect(runSetupState(profile.training)).toEqual({
      required: true,
      ready: true,
    });
  });

  it("mobility with morning routine asks days, minutes and the mat", () => {
    let profile = merged(empty(), {
      training: {
        ...STRENGTH_ANSWERS,
        modules: modules({ mobility: true, morning_routine: true }),
      },
    });
    expect(missingRequiredFields(profile)).toEqual([
      "training.mobility.stiff_areas",
      "training.mobility.morning.minutes",
      "training.mobility.morning.weekdays",
      "training.has_mat",
    ]);
    const ids = openQuestions(profile, runSetupState(profile.training)).map(
      (q) => q.id,
    );
    // Days and minutes are one question; the old ask-once question is gone.
    expect(ids).toEqual([
      "training.mobility.stiff_areas",
      "morning_routine",
      "training.has_mat",
    ]);

    profile = merged(profile, {
      training: {
        mobility: {
          wants: true,
          morning: { weekdays: ["mon", "wed", "fri"], minutes: 10 },
          sessions: null,
          // An empty list is an answer: a general routine (D-08).
          stiff_areas: [],
        },
      },
    });
    expect(missingRequiredFields(profile)).toEqual(["training.has_mat"]);
    profile = merged(profile, { training: { has_mat: false } });
    expect(isProfileComplete(profile)).toBe(true);
    // null removes the answer again.
    profile = merged(profile, { training: { has_mat: null } });
    expect(missingRequiredFields(profile)).toEqual(["training.has_mat"]);
  });

  it("protect areas, sex and notes stay optional", () => {
    const profile = merged(empty(), {
      training: {
        ...STRENGTH_ANSWERS,
        modules: modules({ running: true, mobility: true }),
        run: RUN_ANSWERS,
        mobility: {
          wants: true,
          morning: null,
          sessions: { placement: "own_days", per_week: 1, minutes: 15 },
          stiff_areas: ["hips"],
        },
      },
    });
    expect(profile.person).toEqual({});
    expect(profile.training.notes).toBeUndefined();
    expect(isProfileComplete(profile)).toBe(true);
  });
});

describe("modules of setups from before Onboarding 2.0", () => {
  it("derives the modules from goals, run details and the mobility answer", () => {
    const base = empty().training;
    expect(modulesOf(base)).toEqual(modules({}));
    expect(
      modulesOf({ ...base, primary_goal: "endurance_running" }).running,
    ).toBe(true);
    expect(
      modulesOf({ ...base, secondary_goals: ["endurance_running"] }).running,
    ).toBe(true);
    expect(
      modulesOf({ ...base, run: { ...RUN_ANSWERS, goal: "5k" } }).running,
    ).toBe(true);
    expect(
      modulesOf({
        ...base,
        mobility: {
          wants: true,
          morning: { weekdays: ["mon"], minutes: 5 },
          sessions: null,
          stiff_areas: [],
        },
      }),
    ).toEqual(modules({ mobility: true, morning_routine: true }));
    expect(
      modulesOf({
        ...base,
        mobility: {
          wants: true,
          morning: null,
          sessions: { placement: "after_strength", per_week: 2, minutes: 20 },
          stiff_areas: [],
        },
      }),
    ).toEqual(modules({ mobility: true }));
    expect(modulesOf({ ...base, mobility: { wants: false } })).toEqual(
      modules({}),
    );
  });

  it("a stored module choice wins over the derivation", () => {
    expect(
      modulesOf({
        ...empty().training,
        primary_goal: "endurance_running",
        modules: modules({}),
      }).running,
    ).toBe(false);
  });

  it("a stored old profile parses and is not held back by the new mat question", () => {
    const old = OnboardingProfileSchema.parse({
      path: "arnold_plan",
      person: {},
      training: {
        ...STRENGTH_ANSWERS,
        primary_goal: "endurance_running",
        known_loads: { "bench-press": 60, squat: 80 },
        run: { ...RUN_ANSWERS, goal: "10k" },
        mobility: {
          wants: true,
          morning: { weekdays: ["mon"], minutes: 10 },
          sessions: null,
          stiff_areas: ["neck"],
        },
      },
      revision: 4,
      updated_at_utc: null,
    });
    expect(old.training.modules).toBeUndefined();
    expect(isProfileComplete(old)).toBe(true);
  });
});

describe("known_loads as weight × repetitions (D-02, D-03)", () => {
  it("accepts {kg, reps} with 1–12 repetitions for every anchor", () => {
    expect(
      KnownLoadsSchema.parse({
        "bench-press": { kg: 60, reps: 5 },
        "dumbbell-bench-press": { kg: 22, reps: 12 },
        "chest-press-machine": { kg: 50, reps: 1 },
        "lat-pulldown": { kg: 55, reps: 8 },
        "seated-cable-row": { kg: 50, reps: 10 },
        "one-arm-row": { kg: 24, reps: 10 },
        squat: { kg: 80, reps: 6 },
        "leg-press": { kg: 140, reps: 10 },
        "goblet-squat": { kg: 20, reps: 12 },
      }),
    ).toBeTruthy();
    for (const reps of [0, 13, 8.5])
      expect(
        KnownLoadsSchema.safeParse({ squat: { kg: 80, reps } }).success,
        String(reps),
      ).toBe(false);
    expect(
      KnownLoadsSchema.safeParse({ squat: { kg: 0, reps: 5 } }).success,
    ).toBe(false);
    expect(
      KnownLoadsSchema.safeParse({ deadlift: { kg: 100, reps: 5 } }).success,
    ).toBe(false);
  });

  it("the old form, a bare number, stays readable as 9 repetitions", () => {
    const old = KnownLoadsSchema.parse({ "bench-press": 60 });
    expect(normalizeKnownLoads(old)).toEqual({
      "bench-press": { kg: 60, reps: 9 },
    });
    expect(normalizeKnownLoads(undefined)).toEqual({});
  });

  it("picks the anchor per movement from place and equipment", () => {
    expect(knownLoadAnchors("gym", [])).toEqual({
      push: "bench-press",
      pull: "lat-pulldown",
      legs: "squat",
    });
    expect(knownLoadAnchors("home", ["dumbbells", "bench"])).toEqual({
      push: "dumbbell-bench-press",
      pull: "one-arm-row",
      legs: "goblet-squat",
    });
    expect(knownLoadAnchors("home", ["barbell", "bench"])).toEqual({
      push: "bench-press",
      pull: null,
      legs: "squat",
    });
    // Nothing fits: nothing is asked.
    expect(knownLoadAnchors("home", ["resistance_bands"])).toEqual({
      push: null,
      pull: null,
      legs: null,
    });
    // Unknown place: the first of each, as before.
    expect(knownLoadAnchors(null, undefined)).toEqual({
      push: "bench-press",
      pull: "lat-pulldown",
      legs: "squat",
    });
  });
});

describe("start-load with a named weight and its repetitions", () => {
  const man = {
    sex: "male",
    body_weight_kg: 80,
    age_years: 30,
    experience: "intermediate",
  } as const;

  it("uses the named repetitions through the Epley relation", () => {
    const at5 = estimateStartLoad({
      ...man,
      exercise_id: "bench-press",
      reps: 10,
      known: { "bench-press": { kg: 70, reps: 5 } },
    });
    const at12 = estimateStartLoad({
      ...man,
      exercise_id: "bench-press",
      reps: 10,
      known: { "bench-press": { kg: 70, reps: 12 } },
    });
    // 70 kg for 12 is stronger than 70 kg for 5.
    expect(at12!).toBeGreaterThan(at5!);
    // 70 × 5 → 10 reps: 70 / (35/30) × (40/30) × 0.95 ≈ 57 → 57.5.
    expect(at5).toBe(57.5);
  });

  it("the old bare number gives exactly what 9 repetitions give", () => {
    for (const exercise_id of ["bench-press", "incline-dumbbell-press"]) {
      const legacy = estimateStartLoad({
        ...man,
        exercise_id,
        reps: 10,
        known: { "bench-press": 60 },
      });
      const explicit = estimateStartLoad({
        ...man,
        exercise_id,
        reps: 10,
        known: { "bench-press": { kg: 60, reps: 9 } },
      });
      expect(legacy).toBe(explicit);
    }
  });

  it("carries an equipment anchor over its group by the table", () => {
    const fromDumbbell = estimateStartLoad({
      ...man,
      exercise_id: "incline-dumbbell-press",
      reps: 10,
      known: { "dumbbell-bench-press": { kg: 24, reps: 10 } },
    });
    const estimate = estimateStartLoad({
      ...man,
      exercise_id: "incline-dumbbell-press",
      reps: 10,
    });
    expect(fromDumbbell).not.toBeNull();
    expect(fromDumbbell).not.toBe(estimate);
    // Leg press named → goblet squat follows the leg press, not the estimate.
    const goblet = estimateStartLoad({
      ...man,
      exercise_id: "goblet-squat",
      reps: 10,
      known: { "leg-press": { kg: 200, reps: 10 } },
    });
    expect(goblet).toBe(Math.round((200 * (0.3 / 1.5) * 0.95) / 2) * 2);
  });

  it("an exercise that is itself a named anchor follows its own figure", () => {
    const own = estimateStartLoad({
      ...man,
      exercise_id: "dumbbell-bench-press",
      reps: 10,
      known: {
        "bench-press": { kg: 100, reps: 10 },
        "dumbbell-bench-press": { kg: 20, reps: 10 },
      },
    });
    expect(own).toBe(Math.round((20 * 0.95) / 2) * 2);
  });

  it("an invalid figure counts as not named: the cautious estimate (D-04)", () => {
    const estimate = estimateStartLoad({
      ...man,
      exercise_id: "squat",
      reps: 10,
    });
    expect(
      estimateStartLoad({
        ...man,
        exercise_id: "squat",
        reps: 10,
        known: { squat: { kg: 80, reps: 20 } },
      }),
    ).toBe(estimate);
  });

  it("null stays null: no table row, no estimate, even with named weights", () => {
    const known = {
      "bench-press": { kg: 80, reps: 8 },
      squat: { kg: 100, reps: 5 },
      "lat-pulldown": { kg: 60, reps: 10 },
    };
    for (const exercise_id of ["push-up", "pull-up", "unknown-lift"])
      expect(
        estimateStartLoad({ ...man, exercise_id, reps: 10, known }),
      ).toBeNull();
  });
});

describe("the mat (D-07)", () => {
  const floor = MOBILITY_CATALOG.filter((e) => e.needs_mat);
  const standing = MOBILITY_CATALOG.filter((e) => !e.needs_mat);

  it("floor exercises need a mat in the morning; unknown is no mat", () => {
    expect(floor.length).toBe(20);
    expect(allowedInMorning(floor[0], true)).toBe(true);
    expect(allowedInMorning(floor[0], false)).toBe(false);
    expect(allowedInMorning(floor[0], undefined)).toBe(false);
    expect(allowedInMorning(standing[0], undefined)).toBe(true);
  });

  it("the timing engine lets floor exercises into the morning only with has_mat", () => {
    const ids = [standing[0].id, standing[1].id, floor[0].id];
    expect(mobilityExercise(floor[0].id)?.needs_mat).toBe(true);
    const without = buildMobilityRoutine({
      kind: "morning",
      minutes: 5,
      exercise_ids: ids,
    });
    expect(without.ok).toBe(false);
    if (!without.ok) expect(without.code).toBe("MOBILITY_NOT_MORNING_SUITABLE");
    expect(
      buildMobilityRoutine({
        kind: "morning",
        minutes: 5,
        exercise_ids: ids,
        has_mat: false,
      }).ok,
    ).toBe(false);
    expect(
      buildMobilityRoutine({
        kind: "morning",
        minutes: 5,
        exercise_ids: ids,
        has_mat: true,
      }).ok,
    ).toBe(true);
    // Sessions never needed the rule.
    expect(
      buildMobilityRoutine({
        kind: "session",
        minutes: 15,
        exercise_ids: [...ids, standing[2].id, floor[1].id, floor[2].id],
      }).ok,
    ).toBe(true);
  });

  it("the brief tells the model what the mat allows", () => {
    const profile = (has_mat?: boolean) =>
      merged(empty(), {
        training: {
          ...STRENGTH_ANSWERS,
          modules: modules({ mobility: true, morning_routine: true }),
          mobility: {
            wants: true,
            morning: { weekdays: ["mon"], minutes: 10 },
            sessions: null,
            stiff_areas: [],
          },
          ...(has_mat === undefined ? {} : { has_mat }),
        },
      });
    const input = {
      onboarding_session_id: "00000000-0000-4000-8000-000000000001",
      exercises: [],
      now: "2026-11-24T10:00:00.000Z",
    };
    const withMat = buildBrief(profile(true), input);
    expect(withMat.constraints.join("\n")).toContain("needs_mat=true");
    expect(withMat.mobility_catalog![0]).toHaveProperty("needs_mat");
    expect(withMat.mobility_catalog![0]).not.toHaveProperty("morning_ok");
    const noMat = buildBrief(profile(false), input);
    expect(noMat.constraints.join("\n")).toContain("needs_mat=false");
    // Unanswered: the brief is not available, the mat is a required answer.
    expect(() => buildBrief(profile(), input)).toThrow();
  });
});

describe("handing the run details over without a goal", () => {
  it("stores the goal-free running as fitness, never a race distance", async () => {
    const calls: Record<string, unknown>[] = [];
    await recordSetupRunProfile(
      {
        dataset: async () => ({ runProfiles: [] }) as never,
        execute: (async (_tool: string, input: Record<string, unknown>) => {
          calls.push(input);
          return { ok: true };
        }) as never,
      },
      OnboardingRunSchema.parse(RUN_ANSWERS),
      "session-1",
      {},
    );
    expect(calls).toHaveLength(1);
    expect(calls[0].goal).toBe("fitness");
    expect(calls[0]).not.toHaveProperty("race_date");
    expect(calls[0]).not.toHaveProperty("target_time_s");
  });
});
