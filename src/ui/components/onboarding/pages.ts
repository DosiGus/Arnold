import type { OnboardingProfile } from "../../../shared/onboarding-contract";

/** The pages of the profile step, in the order the setup walks them. */
export type Page =
  | "person"
  | "goal"
  | "experience"
  | "rhythm"
  | "environment"
  | "wishes"
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
  wishes: "Deine Wünsche für den Plan",
  review: "So wird dein Plan",
};

/** The server fields each page answers, to match its "missing" findings. */
export const PAGE_FIELD: Record<Page, string[]> = {
  person: [],
  goal: ["training.primary_goal"],
  experience: ["training.experience"],
  rhythm: ["training.days_per_week", "training.session_minutes"],
  environment: ["training.environment"],
  wishes: [],
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
  if (!firstMissing) return "review";
  const anyAnswer =
    t.primary_goal !== null ||
    t.experience !== null ||
    t.days_per_week !== null ||
    t.session_minutes !== null ||
    t.environment !== null ||
    Object.keys(profile.person).length > 0;
  return anyAnswer ? firstMissing : "person";
}

/** The page after `current`; an edit started from the review returns there. */
export function nextPage(current: Page, fromReview: boolean): Page {
  if (fromReview) return "review";
  if (current === "person") return "goal";
  const index = QUESTIONS.indexOf(current);
  if (index >= 0 && index < QUESTIONS.length - 1) return QUESTIONS[index + 1];
  if (current === "environment") return "wishes";
  return "review";
}

/** The page before `current`, or null on the first page. */
export function previousPage(current: Page): Page | null {
  if (current === "person") return null;
  if (current === "goal") return "person";
  const index = QUESTIONS.indexOf(current);
  if (index > 0) return QUESTIONS[index - 1];
  if (current === "wishes") return "environment";
  if (current === "review") return "wishes";
  return null;
}
