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
] as const;
export const LEVELS = ["beginner", "intermediate", "advanced"] as const;
export const PLACES = ["gym", "home", "outdoor"] as const;
export const RUN_GOALS = ["fitness", "faster", "longer"] as const;
export const MOB_FOCUS = [
  "neck",
  "lower_back",
  "hips",
  "knees",
  "ankles",
  "general",
] as const;
export const MORNING_MINUTES = [5, 10, 15] as const;
export const JOBS = ["sitting", "moving", "physical", "mixed"] as const;
export const SEXES = ["female", "male", "diverse"] as const;

export type RunGoal = (typeof RUN_GOALS)[number];
export type MobFocus = (typeof MOB_FOCUS)[number];
export type Job = (typeof JOBS)[number];
export type Stand = {
  recent?: "regular" | "irregular" | "none" | "gt10" | "lt10";
  years?: "lt1" | "1to3" | "gt3";
  pause?: "none" | "lt3m" | "3to12m" | "gt12m";
};
export const STAND_RECENT = [
  { value: "regular", label: "Regelmäßig" },
  { value: "irregular", label: "Unregelmäßig" },
  { value: "none", label: "Gar nicht" },
] as const;
export const STAND_RECENT_RUN = [
  { value: "gt10", label: "Mehr als 10" },
  { value: "lt10", label: "Weniger als 10" },
  { value: "none", label: "Gar nicht" },
] as const;
export const STAND_YEARS = [
  { value: "lt1", label: "Unter 1 Jahr" },
  { value: "1to3", label: "1 bis 3 Jahre" },
  { value: "gt3", label: "Über 3 Jahre" },
] as const;
export const STAND_PAUSE = [
  { value: "none", label: "Keine" },
  { value: "lt3m", label: "Unter 3 Monate" },
  { value: "3to12m", label: "3 bis 12 Monate" },
  { value: "gt12m", label: "Über 1 Jahr" },
] as const;
/** The pause question only matters when training was not regular lately. */
export const standNeedsPause = (st?: Stand) =>
  !!st?.recent && st.recent !== "regular" && st.recent !== "gt10";
export const standDone = (st?: Stand) =>
  !!st?.recent && !!st.years && (!standNeedsPause(st) || !!st.pause);
const label = <T extends string>(
  list: readonly { value: T; label: string }[],
  v?: T,
) => list.find((o) => o.value === v)?.label;
export const standText = (st?: Stand) =>
  standDone(st)
    ? [
        label(STAND_RECENT, st!.recent) ?? label(STAND_RECENT_RUN, st!.recent),
        label(STAND_YEARS, st!.years),
        standNeedsPause(st) ? `Pause: ${label(STAND_PAUSE, st!.pause)}` : null,
      ]
        .filter(Boolean)
        .join(", ")
    : null;
/** Rough level for weight estimates, derived from the training status. */
export function levelOf(st?: Stand): Level {
  if (!st?.years || st.years === "lt1") return "beginner";
  if (st.recent !== "regular" && st.pause !== "lt3m") return "beginner";
  return st.years === "gt3" ? "advanced" : "intermediate";
}

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
  goals?: Goal[];
  strengthStand?: Stand;
  days?: number;
  minutes?: number;
  places?: Place[];
  run: boolean;
  mobility: boolean;
  strength: boolean;
  morning: boolean;
  runGoals?: RunGoal[];
  runStand?: Stand;
  mobilityFocus?: MobFocus[];
  morningMinutes?: number;
  job?: Job;
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
  /** Primary muscle group (strength only), for the weekly volume overview. */
  muscle?: string;
  /** Free text for runs, mobility and morning routine (instead of sets × reps). */
  detail?: string;
};
export type PlanKind = "strength" | "run" | "mobility" | "morning";
export type PlanDay = {
  id: string;
  kind: PlanKind;
  name: string;
  focus: string;
  exercises: PlanExercise[];
};
/**
 * Why the plan looks the way it does. Written by the model from the saved
 * answers (the demo writes a stand-in). The set counts are NOT in here: the
 * card counts them from the plan itself, the model only supplies the range
 * that fits the goal and a short note.
 */
export type PlanExplanation = {
  summary: string;
  split: string;
  volume: { muscle: string; min: number; max: number; note?: string }[];
  exercises: { name: string; reason: string }[];
  progression: string;
  /** Sentences the user can say to change the plan. */
  adjust: string[];
  /** What is estimated or unknown. */
  unknowns: string[];
};
export type Plan = {
  split: string;
  days: PlanDay[];
  explanation?: PlanExplanation;
};

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
  fat_loss: "Abnehmen",
  general_fitness: "Fit bleiben",
};
export const RUN_GOAL_LABEL: Record<RunGoal, string> = {
  fitness: "Fit bleiben",
  faster: "Schneller werden",
  longer: "Länger laufen",
};
export const MOB_FOCUS_LABEL: Record<MobFocus, string> = {
  neck: "Nacken und Schultern",
  lower_back: "Unterer Rücken",
  hips: "Hüfte",
  knees: "Knie",
  ankles: "Füße und Sprunggelenke",
  general: "Allgemein beweglicher",
};
export const JOB_LABEL: Record<Job, string> = {
  sitting: "Viel sitzen",
  moving: "Viel stehen oder gehen",
  physical: "Körperlich anstrengend",
  mixed: "Gemischt",
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
};

export const EMPTY: Profile = {
  path: null,
  run: false,
  mobility: false,
  strength: false,
  morning: false,
};

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
    {
      key: "areas",
      label: "Bereiche",
      value:
        p.strength || p.run || p.mobility || p.morning
          ? [
              p.strength && "Krafttraining",
              p.run && "Laufen",
              p.mobility && "Mobility",
              p.morning && "Morgenroutine",
            ]
              .filter(Boolean)
              .join(", ")
          : null,
    },
  ];
  if (p.strength)
    required.push(
      {
        key: "goal",
        label: "Hauptziel Kraft",
        value: p.goals?.length
          ? p.goals.map((g) => GOAL_LABEL[g]).join(", ")
          : null,
      },
      {
        key: "strengthStand",
        label: "Trainingsstand Kraft",
        value: standText(p.strengthStand),
      },
    );
  if (p.run)
    required.push({
      key: "runGoal",
      label: "Hauptziel Laufen",
      value: p.runGoals?.length
        ? p.runGoals.map((g) => RUN_GOAL_LABEL[g]).join(", ")
        : null,
    });
  if (p.run)
    required.push({
      key: "runStand",
      label: "Trainingsstand Laufen",
      value: standText(p.runStand),
    });
  if (p.mobility)
    required.push({
      key: "mobilityFocus",
      label: "Hauptziel Mobility",
      value: p.mobilityFocus?.length
        ? p.mobilityFocus.map((g) => MOB_FOCUS_LABEL[g]).join(", ")
        : null,
    });
  if (p.morning)
    required.push({
      key: "morningMinutes",
      label: "Dauer der Morgenroutine",
      value: p.morningMinutes ? `${p.morningMinutes} Min.` : null,
    });
  if (p.mobility)
    required.push({
      key: "job",
      label: "Alltag",
      value: p.job ? JOB_LABEL[p.job] : null,
    });
  required.push(
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
      key: "places",
      label: "Ort",
      value: p.places?.length
        ? p.places.map((x) => PLACE_LABEL[x]).join(", ")
        : null,
    },
  );
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
    const old = this.profile;
    this.profile = { ...old, ...patch };
    // Training status arrives in parts: merge it instead of replacing it.
    if (patch.strengthStand)
      this.profile.strengthStand = {
        ...old.strengthStand,
        ...patch.strengthStand,
      };
    if (patch.runStand)
      this.profile.runStand = { ...old.runStand, ...patch.runStand };
    // A changed answer makes an existing plan stale: it must be rebuilt.
    if (this.plan && !this.confirmed) this.plan = null;
  }

  /** Back to an earlier step. Later results are dropped so nothing stale stays. */
  goTo(step: "welcome" | "profile" | "plan") {
    this.done = false;
    this.wearable = "open";
    if (step === "plan") {
      this.confirmed = false;
      return;
    }
    this.plan = null;
    this.confirmed = false;
    if (step === "welcome") this.profile = { ...this.profile, path: null };
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
