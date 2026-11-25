/**
 * Onboarding model for the POC: synthetic, in memory, one user.
 * Content follows Arnold's real onboarding (goal, experience, days, minutes,
 * place are required; person data, modules and wishes are optional).
 * Rule kept from Arnold: an unknown load is unknown, never 0 or a guess.
 */
export const GOALS = [
  "muscle_gain",
  "strength",
  "fat_loss",
  "general_fitness",
  "endurance_running",
] as const;
export const LEVELS = ["beginner", "intermediate", "advanced"] as const;
export const PLACES = ["gym", "home", "outdoor", "mixed"] as const;
export const SEXES = ["female", "male", "diverse"] as const;

export type Goal = (typeof GOALS)[number];
export type Level = (typeof LEVELS)[number];
export type Place = (typeof PLACES)[number];
export type Sex = (typeof SEXES)[number];

export type Profile = {
  path: "arnold_plan" | "own_plan" | null;
  age?: number;
  height?: number;
  weight?: number;
  sex?: Sex;
  goal?: Goal;
  experience?: Level;
  days?: number;
  minutes?: number;
  place?: Place;
  run: boolean;
  mobility: boolean;
  notes?: string;
};

export type PlanExercise = {
  id: string;
  name: string;
  sets: number;
  reps: string;
  /** null = unknown. Never shown as 0. */
  kg: number | null;
  estimated: boolean;
};
export type PlanDay = {
  id: string;
  name: string;
  focus: string;
  exercises: PlanExercise[];
};
export type Plan = { split: string; days: PlanDay[] };

export type Wearable = "open" | "connect" | "later";
export type Phase = "welcome" | "profile" | "plan" | "wearable" | "done";

export type RequiredRow = { key: string; label: string; value: string | null };

export type OnboardingView = {
  phase: Phase;
  profile: Profile;
  required: RequiredRow[];
  answered: number;
  total: number;
  canCreatePlan: boolean;
  plan: Plan | null;
  confirmed: boolean;
  wearable: Wearable;
};

export const GOAL_LABEL: Record<Goal, string> = {
  muscle_gain: "Muskeln aufbauen",
  strength: "Kraft steigern",
  fat_loss: "Fett verlieren",
  general_fitness: "Fit bleiben",
  endurance_running: "Ausdauer und Laufen",
};
export const LEVEL_LABEL: Record<Level, string> = {
  beginner: "Einsteiger",
  intermediate: "Fortgeschritten",
  advanced: "Erfahren",
};
export const PLACE_LABEL: Record<Place, string> = {
  gym: "Studio",
  home: "Zuhause",
  outdoor: "Draußen",
  mixed: "Gemischt",
};

export const EMPTY: Profile = { path: null, run: false, mobility: false };

export type Snapshot = {
  profile: Profile;
  plan: Plan | null;
  confirmed: boolean;
  wearable: Wearable;
  done: boolean;
};

/** Pure: server and view derive the same state from the same snapshot. */
export function viewOf(s: Snapshot): OnboardingView {
  const p = s.profile;
  const required: RequiredRow[] = [
    { key: "goal", label: "Ziel", value: p.goal ? GOAL_LABEL[p.goal] : null },
    {
      key: "experience",
      label: "Erfahrung",
      value: p.experience ? LEVEL_LABEL[p.experience] : null,
    },
    {
      key: "days",
      label: "Tage pro Woche",
      value: p.days ? `${p.days}` : null,
    },
    {
      key: "minutes",
      label: "Minuten pro Training",
      value: p.minutes ? `${p.minutes}` : null,
    },
    {
      key: "place",
      label: "Ort",
      value: p.place ? PLACE_LABEL[p.place] : null,
    },
  ];
  const answered = required.filter((r) => r.value !== null).length;
  const phase: Phase = s.done
    ? "done"
    : s.confirmed
      ? "wearable"
      : s.plan
        ? "plan"
        : p.path
          ? "profile"
          : "welcome";
  return {
    phase,
    profile: p,
    required,
    answered,
    total: required.length,
    canCreatePlan: answered === required.length,
    plan: s.plan,
    confirmed: s.confirmed,
    wearable: s.wearable,
  };
}

export function snapshotOf(v: OnboardingView): Snapshot {
  return {
    profile: v.profile,
    plan: v.plan,
    confirmed: v.confirmed,
    wearable: v.wearable,
    done: v.phase === "done",
  };
}

export class Setup {
  profile: Profile = { ...EMPTY };
  plan: Plan | null = null;
  confirmed = false;
  wearable: Wearable = "open";
  done = false;

  reset() {
    this.profile = { ...EMPTY };
    this.plan = null;
    this.confirmed = false;
    this.wearable = "open";
    this.done = false;
  }

  update(patch: Partial<Profile>) {
    this.profile = { ...this.profile, ...patch };
    // A changed answer makes an existing plan stale: it must be rebuilt.
    if (this.plan && !this.confirmed) this.plan = null;
  }

  view(): OnboardingView {
    return viewOf({
      profile: this.profile,
      plan: this.plan,
      confirmed: this.confirmed,
      wearable: this.wearable,
      done: this.done,
    });
  }
}
