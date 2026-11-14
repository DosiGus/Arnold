import type { OnboardingProfile } from "../../../shared/onboarding-contract";
import { wantsRunning } from "../../../shared/onboarding-profile";

/** The pages of the profile step, in the order the setup walks them. */
export type Page =
  | "person"
  | "goal"
  | "experience"
  | "rhythm"
  | "environment"
  | "loads"
  | "wishes"
  | "run"
  | "review";

export const QUESTIONS: readonly Page[] = [
  "goal",
  "experience",
  "rhythm",
  "environment",
];

export const TITLE: Record<Page, string> = {
  person: "Ein paar Angaben über dich?",
  goal: "Was ist dein Ziel?",
  experience: "Wie lange trainierst du schon?",
  rhythm: "Wie oft und wie lange?",
  environment: "Wo trainierst du?",
  loads: "Kennst du deine Gewichte?",
  wishes: "Deine Wünsche für den Plan",
  run: "Deine Laufangaben",
  review: "So wird dein Plan",
};

/** "Wie oft und wie lange?" starts here when nothing is stored yet. */
export const RHYTHM_DEFAULT = { days: 3, minutes: 60 } as const;
/** One tap on the minutes row. */
export const MINUTES_STEP = 15;

/** The server fields each page answers, to match its "missing" findings. */
export const PAGE_FIELD: Record<Page, string[]> = {
  person: [],
  goal: ["training.primary_goal"],
  experience: ["training.experience"],
  rhythm: ["training.days_per_week", "training.session_minutes"],
  environment: ["training.environment"],
  loads: [],
  wishes: [],
  run: [],
  review: [],
};

/** Icon size of the fold and review rows. */
export const ICON = 18;

/** The local answers of the wishes page. */
export type WishesDraft = {
  training_days: string[];
  split: string | undefined;
  focus_muscle_groups: string[];
  equipment: string[];
  preferred_exercise_ids: string[];
  avoided_exercise_ids: string[];
  notes: string;
};

export function initialProfileQuestion(profile: OnboardingProfile): Page {
  const t = profile.training;
  const firstMissing: Page | undefined =
    t.primary_goal === null
      ? "goal"
      : t.experience === null
        ? "experience"
        : t.days_per_week === null || t.session_minutes === null
          ? "rhythm"
          : t.environment === null
            ? "environment"
            : undefined;
  if (!firstMissing)
    return wantsRunning(t) && t.run === undefined ? "run" : "review";
  const anyAnswer =
    t.primary_goal !== null ||
    t.experience !== null ||
    t.days_per_week !== null ||
    t.session_minutes !== null ||
    t.environment !== null ||
    Object.keys(profile.person).length > 0;
  return anyAnswer ? firstMissing : "person";
}

/**
 * Whether the setup asks for known weights: only someone with some training
 * behind them, in a gym, knows a bench press or lat pulldown weight. Everyone
 * else gets Arnold's estimate without an extra question.
 */
export function asksForLoads(
  experience: string | null | undefined,
  environment: string | null | undefined,
): boolean {
  return (
    !!experience &&
    experience !== "beginner" &&
    (environment === "gym" || environment === "mixed")
  );
}

/** The page after `current`; an edit started from the review returns there. */
export function nextPage(
  current: Page,
  fromReview: boolean,
  withLoads = false,
  withRun = false,
): Page {
  if (fromReview) return "review";
  if (current === "person") return "goal";
  const index = QUESTIONS.indexOf(current);
  if (index >= 0 && index < QUESTIONS.length - 1) return QUESTIONS[index + 1];
  if (current === "environment") return withLoads ? "loads" : "wishes";
  if (current === "loads") return "wishes";
  if (current === "wishes") return withRun ? "run" : "review";
  return "review";
}

/** The page before `current`, or null on the first page. */
export function previousPage(
  current: Page,
  withLoads = false,
  withRun = false,
): Page | null {
  if (current === "person") return null;
  if (current === "goal") return "person";
  const index = QUESTIONS.indexOf(current);
  if (index > 0) return QUESTIONS[index - 1];
  if (current === "loads") return "environment";
  if (current === "wishes") return withLoads ? "loads" : "environment";
  if (current === "run") return "wishes";
  if (current === "review") return withRun ? "run" : "wishes";
  return null;
}
