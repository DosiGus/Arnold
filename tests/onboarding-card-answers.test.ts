/**
 * The setup card's answers (Skybridge frontend, Kevin's decisions 26.11.2026):
 * training status instead of minutes, running goals, everyday activity,
 * places, mobility goals with standard values, and the plan card's figures
 * (weekly sets, example week) plus the plan explanation.
 */
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  buildPlanInsights,
  WEEKLY_SET_RANGES,
} from "../src/analytics/plan-insights";
import { createFixtureOnboarding } from "../src/server/onboarding/fixture";
import { recordSetupRunProfile } from "../src/server/onboarding/run-profile";
import {
  CARD_MOBILITY_DEFAULTS,
  experienceOf,
  OnboardingProfileSchema,
  OnboardingRunSchema,
  stiffAreasOf,
  type OnboardingProfile,
  type OnboardingProfilePatch,
} from "../src/shared/onboarding-contract";
import {
  buildProgress,
  mergeProfile,
  missingRequiredFields,
} from "../src/shared/onboarding-profile";

const rid = () => randomUUID();

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
): OnboardingProfile =>
  OnboardingProfileSchema.parse({
    ...mergeProfile(before, patch),
    revision: before.revision + 1,
    updated_at_utc: null,
  });

const BASICS: NonNullable<OnboardingProfilePatch["training"]> = {
  primary_goal: "muscle_gain",
  days_per_week: 3,
  session_minutes: 60,
  places: ["gym"],
  strength_background: { recent: "regular", years: "1to3" },
};

describe("training status → experience", () => {
  it("is cautious and unknown while incomplete", () => {
    expect(experienceOf(undefined)).toBeNull();
    expect(experienceOf({ recent: "regular" })).toBeNull();
    // Not regular lately: the break must be answered first.
    expect(experienceOf({ recent: "irregular", years: "gt3" })).toBeNull();
    expect(experienceOf({ recent: "regular", years: "lt1" })).toBe("beginner");
    expect(experienceOf({ recent: "regular", years: "1to3" })).toBe(
      "intermediate",
    );
    expect(experienceOf({ recent: "regular", years: "gt3" })).toBe("advanced");
    expect(experienceOf({ recent: "none", years: "gt3", pause: "gt12m" })).toBe(
      "beginner",
    );
    expect(experienceOf({ recent: "none", years: "gt3", pause: "lt3m" })).toBe(
      "advanced",
    );
    expect(experienceOf({ recent: "gt10", years: "1to3" })).toBe(
      "intermediate",
    );
  });

  it("sets experience from the card and opens it again when the status changes", () => {
    let p = merged(empty(), { training: { ...BASICS } });
    expect(p.training.experience).toBe("intermediate");
    expect(p.training.environment).toBe("gym");
    p = merged(p, {
      training: { strength_background: { recent: "none", years: "1to3" } },
    });
    expect(p.training.experience).toBeNull();
    expect(missingRequiredFields(p)).toEqual(["training.experience"]);
  });

  it("several places are mixed, a chat environment drops the places", () => {
    let p = merged(empty(), { training: { places: ["gym", "home"] } });
    expect(p.training.environment).toBe("mixed");
    p = merged(p, { training: { environment: "home" } });
    expect(p.training.places).toBeUndefined();
    expect(p.training.environment).toBe("home");
    p = merged(p, { training: { places: [] } });
    expect(p.training.environment).toBeNull();
  });

  it("a goal can be cleared again", () => {
    let p = merged(empty(), { training: { primary_goal: "strength" } });
    p = merged(p, { training: { primary_goal: null, secondary_goals: [] } });
    expect(p.training.primary_goal).toBeNull();
  });
});

describe("running from the card", () => {
  it("needs the goals and a complete status, never the minutes", () => {
    let p = merged(empty(), {
      training: {
        ...BASICS,
        modules: { running: true, mobility: false, morning_routine: false },
      },
    });
    expect(missingRequiredFields(p)).toEqual([
      "training.run.aims",
      "training.run.background",
    ]);
    p = merged(p, {
      training: {
        run: { aims: ["faster", "longer"], background: { recent: "lt10" } },
      },
    });
    expect(missingRequiredFields(p)).toEqual(["training.run.background"]);
    p = merged(p, {
      training: {
        run: {
          aims: ["faster", "longer"],
          background: { recent: "lt10", years: "lt1", pause: "3to12m" },
        },
      },
    });
    expect(missingRequiredFields(p)).toEqual([]);
  });

  it("hands over a cautious start: runs and place only, minutes unknown", async () => {
    const calls: Record<string, unknown>[] = [];
    const runs = {
      dataset: async () => ({ runProfiles: [] }) as never,
      execute: (async (_tool: string, input: Record<string, unknown>) => {
        calls.push(input);
        return { ok: true };
      }) as never,
    };
    await recordSetupRunProfile(
      runs,
      OnboardingRunSchema.parse({
        aims: ["fitness"],
        background: { recent: "none", years: "lt1", pause: "gt12m" },
      }),
      "s-1",
      {},
    );
    await recordSetupRunProfile(
      runs,
      OnboardingRunSchema.parse({
        aims: ["faster"],
        background: { recent: "gt10", years: "gt3" },
      }),
      "s-2",
      {},
    );
    expect(calls[0]).toMatchObject({
      goal: "fitness",
      runs_per_week: 2,
      preferred_environment: "outdoor",
    });
    expect(calls[0]).not.toHaveProperty("base_minutes_per_week");
    expect(calls[0]).not.toHaveProperty("longest_run_4w_min");
    expect(calls[1]!.runs_per_week).toBe(3);
  });
});

describe("mobility from the card", () => {
  const cardModules = (sessions: boolean, morning: boolean) => ({
    running: false,
    mobility: sessions || morning,
    morning_routine: morning,
    mobility_sessions: sessions,
  });

  it("asks goals and everyday activity, fills the rest with standards", () => {
    let p = merged(empty(), {
      training: { ...BASICS, modules: cardModules(true, false) },
    });
    expect(missingRequiredFields(p)).toEqual([
      "training.mobility_focus",
      "training.job",
    ]);
    expect(p.training.mobility).toBeUndefined();
    p = merged(p, {
      training: { mobility_focus: ["neck", "knees"], job: "sitting" },
    });
    expect(missingRequiredFields(p)).toEqual([]);
    expect(p.training.mobility).toEqual({
      wants: true,
      morning: null,
      sessions: {
        placement: "arnold_decides",
        per_week: CARD_MOBILITY_DEFAULTS.per_week,
        minutes: CARD_MOBILITY_DEFAULTS.after_strength_minutes,
      },
      stiff_areas: ["neck", "shoulders", "hamstrings"],
    });
    p = merged(p, { training: { mobility_placement: "own_days" } });
    expect(p.training.mobility).toMatchObject({
      sessions: { placement: "own_days", minutes: 20 },
    });
  });

  it("a morning routine alone needs only its minutes", () => {
    let p = merged(empty(), {
      training: { ...BASICS, modules: cardModules(false, true) },
    });
    expect(missingRequiredFields(p)).toEqual(["training.morning_minutes"]);
    p = merged(p, { training: { morning_minutes: 10 } });
    expect(missingRequiredFields(p)).toEqual([]);
    expect(p.training.mobility).toEqual({
      wants: true,
      morning: {
        weekdays: [...CARD_MOBILITY_DEFAULTS.morning_weekdays],
        minutes: 10,
      },
      sessions: null,
      stiff_areas: [],
    });
    // Switched off again: the answer goes, nothing stale stays.
    p = merged(p, { training: { modules: cardModules(false, false) } });
    expect(p.training.mobility).toBeUndefined();
  });

  it("general mobility is the general routine without areas", () => {
    expect(stiffAreasOf(["general"])).toEqual([]);
    expect(stiffAreasOf(["hips", "general", "hips"])).toEqual(["hips"]);
  });

  it("progress counts the card's questions", () => {
    const p = merged(empty(), {
      training: { ...BASICS, modules: cardModules(true, true) },
    });
    const progress = buildProgress(p, {
      step: "profile",
      can_request_plan: false,
      can_confirm_plan: false,
    });
    // path + 5 strength answers + focus, job + morning minutes.
    expect(progress.total_required).toBe(9);
    expect(progress.answered_required).toBe(6);
  });
});

describe("plan insights (pure)", () => {
  const muscles: Record<string, string> = {
    bench: "chest",
    row: "back",
    squat: "legs",
    curl: "arms",
  };
  const input = (experience: "beginner" | "advanced" | null) => ({
    sessions: [
      {
        session_id: "a",
        exercises: [
          { exercise_id: "bench", target_sets: 3 },
          { exercise_id: "row", target_sets: 3 },
          { exercise_id: "mystery", target_sets: 3 },
        ],
      },
      {
        session_id: "b",
        exercises: [
          { exercise_id: "squat", target_sets: 4 },
          { exercise_id: "bench", target_sets: null },
        ],
      },
    ],
    runs: [{ preferred_weekday: null }],
    mobility: [
      {
        kind: "session" as const,
        placement: "after_strength" as const,
        weekdays: [],
        after_session_id: "b",
      },
      {
        kind: "morning" as const,
        placement: "own_day" as const,
        weekdays: [1, 3, 5],
        after_session_id: null,
      },
    ],
    muscleOf: (id: string) => muscles[id] ?? null,
    groups: ["chest", "back", "shoulders", "arms", "legs", "glutes", "core"],
    experience,
    trainingDays: [],
  });

  it("counts direct sets, never an unknown, with the range of the experience", () => {
    const out = buildPlanInsights(input("beginner"));
    const row = (g: string) =>
      out.weekly_sets.find((r) => r.muscle_group === g);
    expect(row("legs")).toEqual({
      muscle_group: "legs",
      sets: 4,
      min: 6,
      max: 10,
    });
    expect(row("chest")!.sets).toBe(3);
    // A main group without sets is listed with 0, a small one is not.
    expect(row("shoulders")!.sets).toBe(0);
    expect(row("core")).toBeUndefined();
    expect(out.uncounted_exercise_ids).toEqual(["mystery", "bench"]);
    expect(buildPlanInsights(input(null)).weekly_sets[0]!.min).toBeNull();
  });

  it("spreads the example week: strength apart, runs on free days, mobility after its session", () => {
    const out = buildPlanInsights(input("advanced"));
    const kinds = out.week.map((d) => d.kinds);
    expect(kinds[0]).toEqual(["strength"]);
    expect(kinds[3]).toEqual(["strength", "mobility"]);
    expect(kinds.flat().filter((k) => k === "run")).toHaveLength(1);
    expect(kinds[0]).not.toContain("run");
    expect(out.morning_weekdays).toEqual([1, 3, 5]);
  });

  it("uses the user's fixed training days", () => {
    const out = buildPlanInsights({
      ...input("advanced"),
      trainingDays: [2, 6],
    });
    expect(out.week[1]!.kinds).toContain("strength");
    expect(out.week[5]!.kinds).toContain("strength");
  });

  it("matches the table in trainingswissenschaft.md of both skills", () => {
    for (const skill of ["arnold-coach", "arnold-trainingsplan"]) {
      const text = readFileSync(
        `plugins/arnold/skills/${skill}/references/trainingswissenschaft.md`,
        "utf8",
      );
      const range = (label: string) => {
        const m = text.match(
          new RegExp(`\\| ${label}\\s*\\| (\\d+)–(\\d+)\\s*\\|`),
        );
        return m ? { min: Number(m[1]), max: Number(m[2]) } : null;
      };
      expect(range("Anfänger")).toEqual(WEEKLY_SET_RANGES.beginner);
      expect(range("Fortgeschritten")).toEqual(WEEKLY_SET_RANGES.intermediate);
      expect(range("Erfahren")).toEqual(WEEKLY_SET_RANGES.advanced);
    }
  });
});

describe("the proposal with its explanation (fixture service)", () => {
  it("stores the explanation and returns Arnold's figures", async () => {
    const { onboarding } = createFixtureOnboarding();
    await onboarding.startOnboarding({ request_id: rid() });
    const saved = await onboarding.updateProfile({
      request_id: rid(),
      profile: { path: "arnold_plan", training: { ...BASICS } },
    });
    expect(saved.ok, saved.error?.message).toBe(true);
    expect(saved.state!.progress.can_request_plan).toBe(true);
    expect(saved.state!.plan_insights).toBeNull();
    const brief = await onboarding.getBrief({});
    const ids = brief.exercise_catalog.slice(0, 3).map((e) => e.exercise_id);
    const explanation = {
      summary: "Drei Ganzkörpereinheiten für Muskelaufbau.",
      split: "Bei drei Tagen trainierst du jeden Muskel dreimal.",
      exercises: [{ name: "Kniebeuge", reason: "Grundübung für die Beine." }],
      progression: "Erst Wiederholungen, dann Gewicht.",
      adjust: ["Mach den Plan kürzer"],
      unknowns: ["Startgewichte sind geschätzt."],
      volume_notes: [
        {
          muscle_group: "shoulders" as const,
          note: "Wird beim Drücken mittrainiert.",
        },
      ],
    };
    const submitted = await onboarding.submitPlanProposal({
      request_id: rid(),
      name: "Mein Plan",
      origin: "ai_proposal",
      sessions: ids.map((exercise_id, i) => ({
        session_name: `Einheit ${i + 1}`,
        exercises: [{ exercise_id, target_sets: 3, rep_min: 8, rep_max: 12 }],
      })),
      explanation,
    });
    expect(submitted.ok, submitted.error?.message).toBe(true);
    const state = submitted.state!;
    expect(state.plan!.explanation).toEqual(explanation);
    const insights = state.plan_insights!;
    expect(
      insights.week.filter((d) => d.kinds.includes("strength")),
    ).toHaveLength(3);
    expect(insights.weekly_sets.length).toBeGreaterThan(0);
    for (const row of insights.weekly_sets) {
      expect(row.min).toBe(10);
      expect(row.label).not.toBe(row.muscle_group);
    }
    const shoulders = insights.weekly_sets.find(
      (r) => r.muscle_group === "shoulders",
    );
    if (shoulders && shoulders.sets < 10)
      expect(shoulders.note).toBe("Wird beim Drücken mittrainiert.");
  });

  it("refuses an explanation with set counts that are too long or malformed", async () => {
    const { onboarding } = createFixtureOnboarding();
    await onboarding.startOnboarding({ request_id: rid() });
    await onboarding.updateProfile({
      request_id: rid(),
      profile: { path: "arnold_plan", training: { ...BASICS } },
    });
    const refused = await onboarding.submitPlanProposal({
      request_id: rid(),
      name: "Plan",
      origin: "ai_proposal",
      sessions: [
        {
          session_name: "A",
          exercises: [
            { exercise_id: "x", target_sets: 3, rep_min: 8, rep_max: 12 },
          ],
        },
      ],
      explanation: {
        summary: " ",
        split: "",
        exercises: [],
        progression: "",
        adjust: [],
        unknowns: [],
      },
    });
    expect(refused.ok).toBe(false);
    expect(refused.error?.code).toBe("VALIDATION_ERROR");
  });
});
