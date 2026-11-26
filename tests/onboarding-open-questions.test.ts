/**
 * MOB-003: the open questions of the setup.
 *
 * The questions come from the server in a fixed order (required answers, run
 * details, mobility once, mobility details), mobility never blocks a plan, a
 * "no" is final, defaults never overwrite what the user named, and a state
 * saved before mobility existed still loads and asks sensible questions.
 */
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  OnboardingProfilePatchSchema,
  OnboardingProfileSchema,
  OnboardingStateSchema,
  OpenQuestionSchema,
  type OnboardingProfile,
  type OnboardingProfilePatch,
} from "../src/shared/onboarding-contract";
import {
  buildBrief,
  mergeProfile,
  missingRequiredFields,
  openQuestions,
  runSetupState,
} from "../src/shared/onboarding-profile";
import { createFixtureOnboarding } from "../src/server/onboarding/fixture";

const rid = () => randomUUID();

const empty = (): OnboardingProfile => ({
  path: null,
  person: {},
  training: {
    primary_goal: null,
    experience: null,
    days_per_week: null,
    session_minutes: null,
    environment: null,
  } as OnboardingProfile["training"],
  revision: 0,
  updated_at_utc: null,
});

const TRAINING = {
  primary_goal: "muscle_gain",
  experience: "intermediate",
  days_per_week: 3,
  session_minutes: 60,
  environment: "gym",
} as const;

const merged = (
  before: OnboardingProfile,
  patch: OnboardingProfilePatch,
): OnboardingProfile => ({
  ...before,
  ...mergeProfile(before, patch),
});

const ids = (profile: OnboardingProfile) =>
  openQuestions(profile, runSetupState(profile.training)).map((q) => q.id);

describe("openQuestions", () => {
  it("asks required answers first, then run details, mobility, mobility details", () => {
    let profile = empty();
    expect(ids(profile)).toEqual(["path", "mobility"]);

    profile = merged(profile, {
      path: "arnold_plan",
      training: { primary_goal: "endurance_running" },
    });
    expect(ids(profile)).toEqual([
      "training.experience",
      "training.days_per_week",
      "training.session_minutes",
      "training.environment",
      "run_details",
      "mobility",
    ]);
    // The run details are required answers of the running module (D-01).
    expect(missingRequiredFields(profile).map(String)).toEqual([
      ...ids(profile).slice(0, 4),
      "training.run.aims",
      "training.run.background",
    ]);

    profile = merged(profile, {
      training: {
        experience: "beginner",
        days_per_week: 3,
        session_minutes: 45,
        environment: "outdoor",
        mobility: {
          wants: true,
          morning: { weekdays: ["mon"], minutes: 10 },
          sessions: null,
          stiff_areas: [],
        },
      },
    });
    expect(ids(profile)).toEqual(["run_details", "mobility_details"]);
  });

  it("every question is a short, readable sentence with its fields", () => {
    const profile = merged(empty(), {
      path: "arnold_plan",
      training: {
        mobility: {
          wants: true,
          morning: {
            weekdays: ["mon", "tue", "wed", "thu", "fri", "sat"],
            minutes: 10,
          },
          sessions: null,
          stiff_areas: [],
        },
      },
    });
    const questions = openQuestions(profile, { required: true, ready: false });
    expect(questions.length).toBeGreaterThan(5);
    for (const question of questions) {
      expect(OpenQuestionSchema.safeParse(question).success).toBe(true);
      expect(question.ask.length).toBeLessThanOrEqual(160);
      expect(question.fields.length).toBeGreaterThan(0);
    }
    const byId = Object.fromEntries(questions.map((q) => [q.id, q]));
    expect(byId["training.days_per_week"].fields).toEqual([
      "training.days_per_week",
    ]);
    expect(byId["training.days_per_week"].kind).toBe("required");
    expect(byId.mobility_details.kind).toBe("ask_once");
  });

  it("asks mobility once, in these words, also for an own plan", () => {
    const profile = merged(empty(), { path: "own_plan" });
    const questions = openQuestions(profile, runSetupState(profile.training));
    expect(questions).toEqual([
      {
        id: "mobility",
        kind: "ask_once",
        ask: "Sollen eine Morgenroutine oder Mobility-Einheiten dazukommen?",
        fields: ["training.mobility"],
      },
    ]);
  });

  it("never asks again after a no", () => {
    const profile = merged(
      merged(empty(), { path: "arnold_plan", training: TRAINING }),
      { training: { mobility: { wants: false } } },
    );
    expect(ids(profile)).toEqual([]);
    const own = merged(merged(empty(), { path: "own_plan" }), {
      training: { mobility: { wants: false } },
    });
    expect(ids(own)).toEqual([]);
  });

  it("removes the answer again with null: not asked", () => {
    const answered = merged(merged(empty(), { path: "own_plan" }), {
      training: { mobility: { wants: false } },
    });
    expect(ids(answered)).toEqual([]);
    const cleared = merged(answered, { training: { mobility: null } });
    expect(cleared.training.mobility).toBeUndefined();
    expect(ids(cleared)).toEqual(["mobility"]);
  });

  it("asks the details until stiff areas are named", () => {
    const wants = merged(merged(empty(), { path: "own_plan" }), {
      training: {
        mobility: {
          wants: true,
          morning: { weekdays: ["mon", "wed", "fri"], minutes: 5 },
          sessions: null,
          stiff_areas: [],
        },
      },
    });
    const [details] = openQuestions(wants, runSetupState(wants.training));
    expect(details.id).toBe("mobility_details");
    expect(details.fields).toEqual(["training.mobility.stiff_areas"]);
    expect(details.ask).toContain("steif");
    const done = merged(wants, {
      training: {
        mobility: {
          wants: true,
          morning: { weekdays: ["mon", "wed", "fri"], minutes: 5 },
          sessions: null,
          stiff_areas: ["hips"],
        },
      },
    });
    expect(ids(done)).toEqual([]);
  });

  it("reads the plan back in the details question, every day as 'Jeden Tag'", () => {
    const profile = merged(empty(), {
      path: "own_plan",
      training: {
        mobility: {
          wants: true,
          morning: {
            weekdays: ["mon", "tue", "wed", "thu", "fri", "sat", "sun"],
            minutes: 10,
          },
          sessions: null,
          stiff_areas: [],
        },
      },
    });
    const [details] = openQuestions(profile, runSetupState(profile.training));
    expect(details.ask).toBe(
      "Jeden Tag 10 Minuten Morgenroutine – passt das? Und wo fühlst du dich steif?",
    );
  });
});

describe("no mobility defaults (D-09)", () => {
  it("stores a mobility answer exactly as named", () => {
    const profile = merged(empty(), {
      training: {
        mobility: {
          wants: true,
          morning: { weekdays: ["tue", "thu"], minutes: 5 },
          sessions: null,
          stiff_areas: ["lower_back"],
        },
      },
    });
    expect(profile.training.mobility).toEqual({
      wants: true,
      morning: { weekdays: ["tue", "thu"], minutes: 5 },
      sessions: null,
      stiff_areas: ["lower_back"],
    });
  });

  it("refuses a yes without its details instead of filling them in", () => {
    for (const mobility of [
      { wants: true },
      { wants: true, morning: {}, sessions: null, stiff_areas: [] },
      { wants: true, morning: null, sessions: {}, stiff_areas: [] },
    ])
      expect(
        OnboardingProfilePatchSchema.safeParse({ training: { mobility } })
          .success,
      ).toBe(false);
  });

  it("leaves the missing details as open questions", () => {
    const profile = merged(empty(), {
      path: "arnold_plan",
      training: {
        modules: { running: false, mobility: true, morning_routine: true },
      },
    });
    const fields = openQuestions(
      profile,
      runSetupState(profile.training),
    ).flatMap((question) => question.fields);
    expect(fields).toEqual(
      expect.arrayContaining(["training.mobility.stiff_areas"]),
    );
    expect(profile.training.mobility).toBeUndefined();
  });

  it("a no stays a no", () => {
    const profile = merged(empty(), {
      training: { mobility: { wants: false } },
    });
    expect(profile.training.mobility).toEqual({ wants: false });
  });
});

describe("mobility never blocks a plan", () => {
  it("is not a required field and does not change completeness", async () => {
    const runtime = createFixtureOnboarding();
    const started = await runtime.onboarding.startOnboarding({
      request_id: rid(),
    });
    const claim = {};
    const saved = await runtime.onboarding.updateProfile({
      request_id: rid(),
      ...claim,
      profile: { path: "arnold_plan", training: TRAINING },
    });
    expect(saved.ok, saved.error?.message).toBe(true);
    const state = saved.state!;
    // Mobility is still open, yet the plan can be requested.
    expect(state.open_questions.map((q) => q.id)).toEqual(["mobility"]);
    expect(state.progress.profile_complete).toBe(true);
    expect(state.progress.can_request_plan).toBe(true);
    expect(state.progress.missing_fields).toEqual([]);
    const answered = await runtime.onboarding.updateProfile({
      request_id: rid(),
      ...claim,
      profile: { training: { mobility: { wants: false } } },
    });
    expect(answered.state!.open_questions).toEqual([]);
    expect(answered.state!.progress.can_request_plan).toBe(true);
    expect(answered.state!.progress.percent).toBe(state.progress.percent);
  });

  it("a wanted mobility goes into the brief, a no does not", () => {
    const base = merged(empty(), { path: "arnold_plan", training: TRAINING });
    const input = {
      onboarding_session_id: "00000000-0000-4000-8000-000000000001",
      exercises: [],
      now: "2026-11-22T10:00:00.000Z",
    };
    const without = buildBrief(base, input);
    expect(without.mobility).toBeUndefined();
    expect(without.mobility_catalog).toBeUndefined();
    const declined = buildBrief(
      merged(base, { training: { mobility: { wants: false } } }),
      input,
    );
    expect(declined.mobility).toBeUndefined();
    expect(declined.mobility_catalog).toBeUndefined();

    const wanted = buildBrief(
      merged(base, {
        training: {
          mobility: {
            wants: true,
            morning: { weekdays: ["mon"], minutes: 10 },
            sessions: {
              placement: "arnold_decides",
              per_week: 2,
              minutes: 20,
            },
            stiff_areas: ["hips"],
          },
        },
      }),
      input,
    );
    expect(wanted.mobility?.wants).toBe(true);
    expect(wanted.mobility_catalog).toHaveLength(40);
    expect(wanted.mobility_catalog![0]).not.toHaveProperty("cue_de");
    const text = wanted.constraints.join("\n");
    expect(text).toContain("add_mobility_session");
    expect(text).toContain("needs_mat=false");
    expect(text).toContain("ohne Krafttraining");
    expect(text).toContain("steifen Bereichen");
    expect(text).toMatch(/Sekunden/);
    expect(text).toMatch(/Keine Diagnosen/);
  });
});

describe("states saved before mobility existed", () => {
  it("loads a profile without mobility and asks sensible questions", () => {
    const old = OnboardingProfileSchema.parse({
      path: "arnold_plan",
      person: {},
      training: {
        primary_goal: "strength",
        experience: "beginner",
        days_per_week: 4,
        session_minutes: 60,
        environment: "home",
      },
      revision: 3,
      updated_at_utc: null,
    });
    expect(old.training.mobility).toBeUndefined();
    expect(ids(old)).toEqual(["mobility"]);
  });

  it("a stored state without open_questions parses, with none", async () => {
    const runtime = createFixtureOnboarding();
    const started = await runtime.onboarding.startOnboarding({
      request_id: rid(),
    });
    const { open_questions: _dropped, ...legacy } = started.state!;
    const parsed = OnboardingStateSchema.parse(legacy);
    expect(parsed.open_questions).toEqual([]);
  });

  it("a fresh state carries the questions, an ended one none", async () => {
    const runtime = createFixtureOnboarding();
    const started = await runtime.onboarding.startOnboarding({
      request_id: rid(),
    });
    expect(started.state!.open_questions.map((q) => q.id)).toEqual([
      "path",
      "mobility",
    ]);
    const cancelled = await runtime.onboarding.cancelOnboarding({
      request_id: rid(),
    });
    expect(cancelled.state!.open_questions).toEqual([]);
  });
});
