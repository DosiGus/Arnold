/**
 * Invented people and their plans, for the plan quality tests.
 *
 * Every profile is made up. Each has one good plan (a trainer would hand it
 * out; the server must take it without a single finding) and one flawed plan
 * (the server must refuse or flag it). Exercise ids are the ones of the
 * starter catalog, so the plans are real in the sense that matters: they
 * could be saved as they are.
 */
import {
  exercisesFor,
  type Equipment,
} from "../../src/shared/exercise-starter-catalog";
import type {
  OnboardingProfile,
  Training,
} from "../../src/shared/onboarding-contract";

export type Ex = {
  exercise_id: string;
  target_sets?: number;
  rep_min?: number;
  rep_max?: number;
  rest_seconds?: number;
};
export type Sess = { session_name: string; exercises: Ex[] };

export type DefectKind =
  | "unknown_exercise"
  | "empty_session"
  | "missing_day"
  | "too_many_sets"
  | "no_rep_range"
  | "no_rest"
  | "duplicate_names"
  | "inverted_range"
  // UX-012: three rules against what the profile says
  | "avoided_exercise"
  | "missing_equipment"
  | "over_time_budget";

export type QualityProfile = {
  key: string;
  label: string;
  training: Partial<Training>;
  protect: readonly string[];
  good: Sess[];
  defect: DefectKind;
};

type Level = "beginner" | "intermediate" | "advanced";

/** Day templates: [name, exercise ids]; the first id is the main lift. */
const T = {
  fb1: [
    "Beinfokus",
    [
      "leg-press",
      "dumbbell-bench-press",
      "lat-pulldown",
      "leg-curl",
      "lateral-raise",
    ],
  ],
  fb2: [
    "Rückenfokus",
    [
      "goblet-squat",
      "seated-cable-row",
      "dumbbell-shoulder-press",
      "romanian-deadlift",
      "dumbbell-curl",
    ],
  ],
  fb3: [
    "Brustfokus",
    ["bench-press", "one-arm-row", "lunge", "triceps-pushdown", "crunch"],
  ],
  up1: [
    "Oberkörper schwer",
    [
      "bench-press",
      "seated-cable-row",
      "incline-dumbbell-press",
      "one-arm-row",
      "triceps-pushdown",
    ],
  ],
  up2: [
    "Oberkörper locker",
    [
      "dumbbell-shoulder-press",
      "lat-pulldown",
      "chest-press-machine",
      "lateral-raise",
      "dumbbell-curl",
    ],
  ],
  lo1: [
    "Beine schwer",
    ["squat", "romanian-deadlift", "lunge", "leg-curl", "calf-raise"],
  ],
  lo2: [
    "Beine & Po",
    [
      "leg-press",
      "hip-thrust",
      "leg-extension",
      "leg-curl",
      "hanging-leg-raise",
    ],
  ],
  push: [
    "Brust & Schultern",
    [
      "bench-press",
      "dumbbell-shoulder-press",
      "incline-dumbbell-press",
      "lateral-raise",
      "triceps-pushdown",
    ],
  ],
  pull: [
    "Rücken & Bizeps",
    [
      "lat-pulldown",
      "seated-cable-row",
      "one-arm-row",
      "face-pull",
      "dumbbell-curl",
    ],
  ],
  legs: [
    "Beine & Core",
    ["squat", "romanian-deadlift", "leg-press", "leg-curl", "calf-raise"],
  ],
  push2: [
    "Schulterdrücken & Brust",
    [
      "dumbbell-shoulder-press",
      "chest-press-machine",
      "dumbbell-bench-press",
      "lateral-raise",
      "triceps-pushdown",
    ],
  ],
  pull2: [
    "Rudern & Rücken",
    ["barbell-row", "lat-pulldown", "face-pull", "dumbbell-curl"],
  ],
  legs2: [
    "Kniebeuge & Beine",
    ["goblet-squat", "hip-thrust", "leg-extension", "leg-curl", "calf-raise"],
  ],
  hb1: [
    "Beinfokus",
    [
      "goblet-squat",
      "dumbbell-bench-press",
      "one-arm-row",
      "lunge",
      "lateral-raise",
    ],
  ],
  hb2: [
    "Rückenfokus",
    [
      "one-arm-row",
      "dumbbell-shoulder-press",
      "glute-bridge",
      "push-up",
      "dumbbell-curl",
    ],
  ],
  hb3: [
    "Brustfokus",
    ["incline-dumbbell-press", "goblet-squat", "one-arm-row", "lateral-raise"],
  ],
  bw1: [
    "Drücken & Beine",
    ["push-up", "lunge", "pull-up", "glute-bridge", "crunch"],
  ],
  bw2: [
    "Ziehen & Po",
    ["pull-up", "glute-bridge", "dips", "calf-raise", "hanging-leg-raise"],
  ],
  bw3: [
    "Core & Beine",
    ["lunge", "calf-raise", "push-up", "hanging-leg-raise"],
  ],
  bd1: [
    "Bänder & Beine",
    ["band-row", "glute-bridge", "lunge", "push-up", "crunch"],
  ],
} as const satisfies Record<string, readonly [string, readonly string[]]>;
type TemplateKey = keyof typeof T;

const BY_LEVEL: Record<
  Level,
  {
    first: [number, number, number, number];
    rest: [number, number, number, number];
  }
> = {
  // sets, rep_min, rep_max, rest_seconds
  beginner: { first: [3, 10, 12, 120], rest: [2, 10, 15, 90] },
  intermediate: { first: [3, 8, 12, 120], rest: [3, 10, 15, 75] },
  advanced: { first: [4, 6, 10, 150], rest: [3, 10, 15, 75] },
};

const build = (level: Level, keys: TemplateKey[]): Sess[] =>
  keys.map((key) => {
    const [name, ids] = T[key];
    return {
      session_name: name,
      exercises: ids.map((exercise_id, index) => {
        const [target_sets, rep_min, rep_max, rest_seconds] =
          BY_LEVEL[level][index === 0 ? "first" : "rest"];
        return { exercise_id, target_sets, rep_min, rep_max, rest_seconds };
      }),
    };
  });

const P = (
  key: string,
  label: string,
  level: Level,
  keys: TemplateKey[],
  training: Partial<Training>,
  defect: DefectKind,
  protect: readonly string[] = [],
): QualityProfile => ({
  key,
  label,
  training: {
    experience: level,
    days_per_week: keys.length,
    ...training,
  },
  protect,
  good: build(level, keys).map((session) =>
    // 30 minutes hold three exercises, see exerciseBudget.
    (training.session_minutes ?? 60) <= 30
      ? { ...session, exercises: session.exercises.slice(0, 3) }
      : session,
  ),
  defect,
});

export const QUALITY_PROFILES: QualityProfile[] = [
  P(
    "p01",
    "Anfängerin, 2 Tage, Studio",
    "beginner",
    ["fb1", "fb2"],
    {
      primary_goal: "general_fitness",
      session_minutes: 45,
      environment: "gym",
    },
    "unknown_exercise",
  ),
  P(
    "p02",
    "Anfänger, 3 Tage, Studio, Muskelaufbau",
    "beginner",
    ["fb1", "fb2", "fb3"],
    { primary_goal: "muscle_gain", session_minutes: 45, environment: "gym" },
    "empty_session",
  ),
  P(
    "p03",
    "Anfänger, 3 Tage, Studio, Abnehmen",
    "beginner",
    ["fb1", "fb2", "fb3"],
    { primary_goal: "fat_loss", session_minutes: 60, environment: "gym" },
    "missing_day",
  ),
  P(
    "p04",
    "Anfängerin, 2 Tage, zuhause mit Kurzhanteln",
    "beginner",
    ["hb1", "hb2"],
    {
      primary_goal: "general_fitness",
      session_minutes: 45,
      environment: "home",
      equipment: ["dumbbells", "bench"],
    },
    "missing_equipment",
  ),
  P(
    "p05",
    "Anfänger, 3 Tage, zuhause ohne Geräte",
    "beginner",
    ["bw1", "bd1"],
    {
      primary_goal: "general_fitness",
      session_minutes: 30,
      environment: "home",
      equipment: ["resistance_bands", "pull_up_bar"],
    },
    "no_rep_range",
  ),
  P(
    "p06",
    "Fortgeschritten, 3 Tage, Studio, Kraft",
    "intermediate",
    ["up1", "lo1", "fb3"],
    { primary_goal: "strength", session_minutes: 60, environment: "gym" },
    "no_rest",
  ),
  P(
    "p07",
    "Fortgeschritten, 4 Tage, Studio, Muskelaufbau",
    "intermediate",
    ["up1", "lo1", "up2", "lo2"],
    { primary_goal: "muscle_gain", session_minutes: 60, environment: "gym" },
    "duplicate_names",
  ),
  P(
    "p08",
    "Fortgeschritten, 4 Tage, Studio, Schwerpunkt Schultern",
    "intermediate",
    ["up1", "lo1", "up2", "lo2"],
    {
      primary_goal: "muscle_gain",
      session_minutes: 75,
      environment: "gym",
      focus_muscle_groups: ["shoulders"],
    },
    "inverted_range",
  ),
  P(
    "p09",
    "Fortgeschritten, 3 Tage, Studio, mit Laufen",
    "intermediate",
    ["fb1", "fb2", "fb3"],
    {
      primary_goal: "muscle_gain",
      secondary_goals: ["endurance_running"],
      session_minutes: 45,
      environment: "gym",
      avoided_exercise_ids: ["deadlift"],
    },
    "avoided_exercise",
  ),
  P(
    "p10",
    "Fortgeschrittene, 4 Tage, Studio, Knie schonen",
    "intermediate",
    ["up1", "lo2", "up2", "legs2"],
    {
      primary_goal: "general_fitness",
      session_minutes: 60,
      environment: "gym",
    },
    "empty_session",
    ["knee"],
  ),
  P(
    "p11",
    "Erfahren, 5 Tage, Studio, Muskelaufbau",
    "advanced",
    ["up1", "lo1", "push", "pull", "legs"],
    { primary_goal: "muscle_gain", session_minutes: 75, environment: "gym" },
    "missing_day",
  ),
  P(
    "p12",
    "Erfahren, 6 Tage, Studio, Push/Pull/Beine",
    "advanced",
    ["push", "pull", "legs", "push2", "pull2", "legs2"],
    { primary_goal: "muscle_gain", session_minutes: 75, environment: "gym" },
    "too_many_sets",
  ),
  P(
    "p13",
    "Erfahren, 4 Tage, Studio, Kraft, unterer Rücken schonen",
    "advanced",
    ["up1", "lo2", "up2", "legs2"],
    { primary_goal: "strength", session_minutes: 90, environment: "gym" },
    "no_rep_range",
    ["lower_back"],
  ),
  P(
    "p14",
    "Erfahrener, 5 Tage, Studio, mit Laufen",
    "advanced",
    ["push", "pull", "legs", "up2", "lo2"],
    {
      primary_goal: "muscle_gain",
      secondary_goals: ["endurance_running"],
      session_minutes: 60,
      environment: "gym",
    },
    "no_rest",
  ),
  P(
    "p15",
    "Fortgeschritten, 3 Tage, zuhause mit Kurzhanteln und Bank",
    "intermediate",
    ["hb1", "hb2", "hb3"],
    {
      primary_goal: "muscle_gain",
      session_minutes: 45,
      environment: "home",
      equipment: ["dumbbells", "bench"],
    },
    "duplicate_names",
  ),
  P(
    "p16",
    "Fortgeschritten, 2 Tage, zuhause, Schulter schonen",
    "intermediate",
    ["hb1", "hb2"],
    {
      primary_goal: "general_fitness",
      session_minutes: 45,
      environment: "home",
      equipment: ["dumbbells", "bench"],
    },
    "inverted_range",
    ["shoulder"],
  ),
  P(
    "p17",
    "Fortgeschritten, 3 Tage, Park mit Klimmzugstange",
    "intermediate",
    ["bw1", "bw2", "bw3"],
    {
      primary_goal: "strength",
      session_minutes: 45,
      environment: "outdoor",
      equipment: ["pull_up_bar", "dip_bars"],
    },
    "unknown_exercise",
  ),
  P(
    "p18",
    "Erfahren, 2 Tage, Studio, wenig Zeit",
    "advanced",
    ["fb1", "fb2"],
    { primary_goal: "strength", session_minutes: 30, environment: "gym" },
    "over_time_budget",
  ),
  P(
    "p19",
    "Anfänger, 4 Tage, Studio und zuhause gemischt",
    "beginner",
    ["up1", "lo2", "up2", "lo1"],
    { primary_goal: "muscle_gain", session_minutes: 60, environment: "mixed" },
    "missing_day",
  ),
  P(
    "p20",
    "Erfahrene, 3 Tage, Studio, mit Laufen und Handgelenk schonen",
    "advanced",
    ["fb1", "fb2", "fb3"],
    {
      primary_goal: "strength",
      secondary_goals: ["endurance_running"],
      session_minutes: 60,
      environment: "gym",
    },
    "too_many_sets",
    ["wrist"],
  ),
];

/** The profile as the onboarding stores it. */
export const toOnboardingProfile = (p: QualityProfile): OnboardingProfile =>
  ({
    path: "arnold_plan",
    person: p.protect.length ? { protect_areas: [...p.protect] } : {},
    training: {
      primary_goal: "general_fitness",
      environment: "gym",
      session_minutes: 60,
      ...p.training,
      // Running is a module with required run details since Onboarding 2.0
      // (RDS-003); synthetic values for the profiles that run.
      ...(p.training.primary_goal === "endurance_running" ||
      (p.training.secondary_goals ?? []).includes("endurance_running")
        ? {
            run: {
              runs_per_week: 2,
              base_minutes_per_week: 60,
              longest_run_4w_min: 40,
              preferred_environment: "outdoor",
            },
          }
        : {}),
    },
    revision: 1,
    updated_at_utc: "2026-05-01T10:00:00Z",
  }) as unknown as OnboardingProfile;

/** The same plan with exactly the defect of the profile. */
export function flawedPlan(p: QualityProfile): Sess[] {
  const plan: Sess[] = JSON.parse(JSON.stringify(p.good));
  switch (p.defect) {
    case "unknown_exercise":
      plan[0].exercises[1].exercise_id = "erfundene-uebung";
      break;
    case "empty_session":
      plan[plan.length - 1].exercises = [];
      break;
    case "missing_day":
      plan.pop();
      break;
    case "too_many_sets":
      plan[0].exercises[0].target_sets = 30;
      break;
    case "no_rep_range":
      for (const e of plan[0].exercises) {
        delete e.rep_min;
        delete e.rep_max;
      }
      break;
    case "no_rest":
      for (const e of plan[0].exercises) delete e.rest_seconds;
      break;
    case "duplicate_names":
      plan[1].session_name = plan[0].session_name;
      break;
    case "inverted_range":
      plan[0].exercises[0].rep_min = 12;
      plan[0].exercises[0].rep_max = 6;
      break;
    case "avoided_exercise":
      plan[0].exercises[1].exercise_id = p.training.avoided_exercise_ids![0];
      break;
    case "missing_equipment":
      // a machine exercise for someone who trains at home with dumbbells
      plan[0].exercises[1].exercise_id = "leg-press";
      break;
    case "over_time_budget":
      for (const id of ["crunch", "face-pull"])
        plan[0].exercises.push({ ...plan[0].exercises[1], exercise_id: id });
      break;
  }
  return plan;
}

/** What each defect must lead to. */
export const EXPECTED: Record<
  DefectKind,
  | { refused: string; says: string }
  | { fitError: string }
  | { fitWarning: string }
  | { warning: string }
> = {
  unknown_exercise: { refused: "EXERCISE_NOT_FOUND", says: "Übungskatalog" },
  inverted_range: { refused: "VALIDATION_ERROR", says: "Wiederholungsminimum" },
  empty_session: { fitError: "PROPOSAL_EMPTY_SESSION" },
  missing_day: { fitWarning: "PROPOSAL_DAYS_MISMATCH" },
  too_many_sets: { warning: "INVALID_SET_COUNT" },
  no_rep_range: { warning: "INVALID_REP_RANGE" },
  no_rest: { warning: "INVALID_REST" },
  duplicate_names: {
    refused: "VALIDATION_ERROR",
    says: "bereits eine Trainingseinheit",
  },
  avoided_exercise: { fitError: "PROPOSAL_AVOIDED_EXERCISE" },
  missing_equipment: { fitWarning: "PROPOSAL_EQUIPMENT_MISSING" },
  over_time_budget: { fitWarning: "PROPOSAL_OVER_TIME_BUDGET" },
};

/** Ids a person can do where they train (for checking the test data itself). */
export const availableIds = (p: QualityProfile) =>
  new Set(
    exercisesFor(
      (p.training.environment ?? "gym") as "gym" | "home" | "outdoor" | "mixed",
      (p.training.equipment ?? []) as Equipment[],
    ).map((e) => e.exercise_id),
  );
