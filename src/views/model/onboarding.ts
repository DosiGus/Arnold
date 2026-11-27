/**
 * Arnold's onboarding state → the setup card's model, and the card's taps →
 * an `update_onboarding_profile` patch.
 *
 * Formatting and mapping only: progress ("x von y"), completeness, the plan's
 * weekly sets and the example week all come from the server. The card never
 * counts or derives a figure itself; unknown stays unknown (a missing weight
 * is "Gewicht offen", a missing set count "?").
 */
import { RUN_TYPE_NAMES } from "../../analytics/running/catalog.js";
import { MOBILITY_CATALOG } from "../../shared/mobility-catalog.js";
import {
  modulesOf,
  SPLIT_LABEL,
  type OnboardingProfile,
  type OnboardingProfilePatch,
  type OnboardingState,
  type PlanInsights,
  type RequiredProfileField,
  type RunBackground,
  type StrengthBackground,
  type Split,
  type TrainingPlace,
} from "../../shared/onboarding-contract.js";
import { requiredFieldsOf } from "../../shared/onboarding-profile.js";
import type { TrainingPlanVersion } from "../../shared/plan-contract.js";
import {
  GOALS,
  type Goal,
  type OnboardingView,
  type Phase,
  type Plan,
  type PlanDay,
  type PlanExercise,
  type Profile,
  type RequiredRow,
  type Wearable,
} from "../demo/model.js";

/* ------------------------------------------------------------ profile */

const PLACES_OF_ENVIRONMENT: Record<string, TrainingPlace[]> = {
  gym: ["gym"],
  home: ["home"],
  outdoor: ["outdoor"],
  // "Gemischt" is defined as "mal Studio, mal zuhause".
  mixed: ["gym", "home"],
};

/** The card's profile from the stored one. */
export function cardProfileOf(p: OnboardingProfile): Profile {
  const t = p.training;
  const modules = modulesOf(t);
  const goals = [t.primary_goal, ...(t.secondary_goals ?? [])].filter(
    (g): g is Goal => g !== null && (GOALS as readonly string[]).includes(g),
  );
  const places =
    t.places ?? (t.environment ? PLACES_OF_ENVIRONMENT[t.environment] : []);
  const mobilityWanted = t.mobility?.wants === true ? t.mobility : undefined;
  return {
    path: p.path,
    ...(p.person.age_years !== undefined ? { age: p.person.age_years } : {}),
    ...(p.person.height_cm !== undefined ? { height: p.person.height_cm } : {}),
    ...(p.person.body_weight_kg !== undefined
      ? { weight: p.person.body_weight_kg }
      : {}),
    ...(p.person.sex !== undefined ? { sex: p.person.sex } : {}),
    ...(goals.length ? { goals } : {}),
    ...(t.strength_background ? { strengthStand: t.strength_background } : {}),
    ...(t.days_per_week !== null ? { days: t.days_per_week } : {}),
    ...(t.session_minutes !== null ? { minutes: t.session_minutes } : {}),
    ...(places.length ? { places } : {}),
    // Strength is always part of Arnold.
    strength: true,
    run: modules.running,
    mobility:
      modules.mobility_sessions ??
      (modules.mobility && !modules.morning_routine),
    morning: modules.morning_routine,
    ...(t.run?.aims?.length ? { runGoals: t.run.aims } : {}),
    ...(t.run?.background ? { runStand: t.run.background } : {}),
    ...(t.mobility_focus?.length ? { mobilityFocus: t.mobility_focus } : {}),
    ...(t.mobility_placement ? { placement: t.mobility_placement } : {}),
    ...(t.morning_minutes
      ? { morningMinutes: t.morning_minutes }
      : mobilityWanted?.morning
        ? { morningMinutes: mobilityWanted.morning.minutes }
        : {}),
    ...(t.job ? { job: t.job } : {}),
    ...(t.notes ? { notes: t.notes } : {}),
  };
}

const has = (o: object, key: string) =>
  Object.prototype.hasOwnProperty.call(o, key);

/**
 * The patch for a burst of card taps. `current` is the stored profile the
 * taps apply to; lists and the run answer replace the stored ones.
 */
export function patchOf(
  current: OnboardingProfile,
  change: Partial<Profile>,
): OnboardingProfilePatch | null {
  const before = cardProfileOf(current);
  const next = { ...before, ...change };
  const person: NonNullable<OnboardingProfilePatch["person"]> = {};
  const training: NonNullable<OnboardingProfilePatch["training"]> = {};
  const patch: OnboardingProfilePatch = {};

  if (change.path !== undefined && change.path !== null)
    patch.path = change.path;
  if (has(change, "age")) person.age_years = change.age ?? null;
  if (has(change, "height")) person.height_cm = change.height ?? null;
  if (has(change, "weight")) person.body_weight_kg = change.weight ?? null;
  if (has(change, "sex")) person.sex = change.sex ?? null;

  if (has(change, "goals")) {
    const goals = change.goals ?? [];
    training.primary_goal = goals[0] ?? null;
    training.secondary_goals = goals.slice(1);
  }
  if (has(change, "strengthStand"))
    training.strength_background =
      (change.strengthStand as StrengthBackground | undefined) ?? null;
  if (change.days !== undefined) training.days_per_week = change.days;
  if (change.minutes !== undefined) training.session_minutes = change.minutes;
  if (has(change, "places")) training.places = change.places ?? [];
  if (has(change, "run") || has(change, "mobility") || has(change, "morning"))
    training.modules = {
      running: next.run,
      mobility: next.mobility || next.morning,
      morning_routine: next.morning,
      mobility_sessions: next.mobility,
    };
  if (has(change, "runGoals") || has(change, "runStand")) {
    const run = { ...(current.training.run ?? {}) };
    if (has(change, "runGoals")) run.aims = change.runGoals ?? [];
    if (has(change, "runStand"))
      run.background = (change.runStand as RunBackground | undefined) ?? {};
    if (!run.aims?.length) delete run.aims;
    training.run = run;
  }
  if (has(change, "mobilityFocus"))
    training.mobility_focus = change.mobilityFocus ?? [];
  if (has(change, "placement"))
    training.mobility_placement = change.placement ?? null;
  if (has(change, "morningMinutes"))
    training.morning_minutes = (change.morningMinutes ?? null) as never;
  if (has(change, "job")) training.job = change.job ?? null;
  if (has(change, "notes")) training.notes = change.notes?.trim() || null;

  if (Object.keys(person).length) patch.person = person;
  if (Object.keys(training).length) patch.training = training;
  return Object.keys(patch).length ? patch : null;
}

/* ------------------------------------------------------- required rows */

/** The card's key and label for a required field. */
const ROW: Partial<Record<RequiredProfileField, [string, string]>> = {
  path: ["path", "Wie du starten möchtest"],
  "training.primary_goal": ["goal", "Hauptziel Kraft"],
  "training.experience": ["strengthStand", "Trainingsstand Kraft"],
  "training.run.aims": ["runGoal", "Hauptziel Laufen"],
  "training.run.background": ["runStand", "Trainingsstand Laufen"],
  "training.mobility_focus": ["mobilityFocus", "Hauptziel Mobility"],
  "training.job": ["job", "Alltag"],
  "training.morning_minutes": ["morningMinutes", "Dauer der Morgenroutine"],
  "training.days_per_week": ["days", "Tage pro Woche"],
  "training.session_minutes": ["minutes", "Minuten pro Training"],
  "training.environment": ["places", "Ort"],
};

function requiredRows(state: OnboardingState): RequiredRow[] {
  const missing = new Set(state.progress.missing_fields);
  return requiredFieldsOf(state.session.profile)
    .filter((field) => field !== "path")
    .map((field) => {
      const [key, label] = ROW[field] ?? [field, field];
      return { key, label, value: missing.has(field) ? null : "ok" };
    });
}

/* ---------------------------------------------------------------- plan */

const reps = (min: number | null, max: number | null) =>
  min === null && max === null
    ? "?"
    : min === max || max === null
      ? `${min}`
      : min === null
        ? `${max}`
        : `${min}–${max}`;

/** Short keys older plans carry for the same splits. */
const SPLIT_ALIAS: Record<string, Split> = {
  ppl: "push_pull_legs",
  fullbody: "full_body",
  full_body_3x: "full_body",
  upper_lower_4x: "upper_lower",
};
const splitLabel = (raw: string | null) => {
  const key = raw ? (SPLIT_ALIAS[raw.toLowerCase()] ?? raw) : null;
  return key && key in SPLIT_LABEL
    ? SPLIT_LABEL[key as Split]
    : key && key !== "auto"
      ? key
      : "Dein Aufbau";
};

const mobilityName = new Map(MOBILITY_CATALOG.map((e) => [e.id, e.name_de]));

/** The card's plan from the stored draft plus Arnold's figures. */
export const cardPlanOf = (state: OnboardingState): Plan | null =>
  cardPlanFrom(state.plan, state.plan_insights, state.load_estimates);

/** The card's plan from a stored version, Arnold's figures and estimates. */
export function cardPlanFrom(
  plan: TrainingPlanVersion | null,
  insights: PlanInsights | null,
  loadEstimates: OnboardingState["load_estimates"],
): Plan | null {
  if (!plan) return null;
  const estimates = new Map(loadEstimates.map((e) => [e.plan_item_id, e]));
  const strength: PlanDay[] = plan.sessions
    .map((session) => {
      const items = session.exercises.filter((e) => e.status === "active");
      const exercises: PlanExercise[] = items.map((item) => {
        const est = estimates.get(item.plan_item_id);
        const kg = item.target_load_kg;
        return {
          id: item.plan_item_id,
          name: item.exercise_name,
          sets: item.target_sets,
          reps: reps(item.rep_min, item.rep_max),
          kg,
          estimated:
            kg !== null &&
            est !== undefined &&
            [est.lighter, est.normal, est.heavier].includes(kg),
          muscle: item.exercise_primary_muscle,
        };
      });
      const focus = [...new Set(items.map((i) => i.exercise_primary_muscle))]
        .filter((m) => m && m !== "nicht angegeben")
        .slice(0, 3)
        .join(", ");
      return {
        id: session.session_id,
        kind: "strength" as const,
        name: session.session_name,
        focus,
        exercises,
      };
    })
    .filter((day) => day.exercises.length > 0);
  const runs: PlanDay[] = (plan.run_sessions ?? [])
    .filter((r) => r.status === "active")
    .map((r) => ({
      id: r.session_id,
      kind: "run" as const,
      name: r.session_name,
      focus: RUN_TYPE_NAMES[r.run_type],
      exercises: [
        {
          id: r.plan_run_session_id,
          name: RUN_TYPE_NAMES[r.run_type],
          sets: null,
          reps: "",
          kg: null,
          estimated: false,
          detail: "Dauer und Tempo legt Arnold fest",
        },
      ],
    }));
  const mobility: PlanDay[] = (plan.mobility_sessions ?? [])
    .filter((m) => m.status === "active")
    .map((m) => ({
      id: m.session_id,
      kind: m.kind === "morning" ? ("morning" as const) : ("mobility" as const),
      name: m.session_name,
      focus: `${m.minutes} Min.`,
      exercises: m.template.items.map((item, i) => ({
        id: `${m.session_id}-${i}`,
        name: mobilityName.get(item.exercise_id) ?? item.exercise_id,
        sets: null,
        reps: "",
        kg: null,
        estimated: false,
        detail:
          item.reps !== null
            ? `${item.reps} Wdh.${item.sides === 2 ? " je Seite" : ""}`
            : `${item.seconds_per_side} s${item.sides === 2 ? " je Seite" : ""}`,
      })),
    }));
  const x = plan.explanation;
  return {
    split: splitLabel(plan.split_key),
    days: [...strength, ...runs, ...mobility],
    ...(insights
      ? {
          weeklySets: insights.weekly_sets.map((row) => ({
            muscle: row.label,
            sets: row.sets,
            min: row.min,
            max: row.max,
            note: row.note,
          })),
          week: insights.week.map((d) => d.kinds),
          morningDays: insights.morning_weekdays,
        }
      : {}),
    ...(x
      ? {
          explanation: {
            summary: x.summary,
            split: x.split,
            volume: (insights?.weekly_sets ?? [])
              .filter((row) => row.min !== null && row.max !== null)
              .map((row) => ({
                muscle: row.label,
                min: row.min!,
                max: row.max!,
                ...(row.note ? { note: row.note } : {}),
              })),
            exercises: x.exercises,
            progression: x.progression,
            adjust: x.adjust,
            unknowns: x.unknowns,
          },
        }
      : {}),
  };
}

/* ---------------------------------------------------------------- view */

/** Where the card is, from the server's status. */
export function phaseOf(state: OnboardingState, wearable: Wearable): Phase {
  const s = state.session;
  switch (s.status) {
    case "COMPLETED":
      // The watch step stays until the watch is paired or skipped.
      return wearable === "later" || wearable === "paired"
        ? "done"
        : "wearable";
    case "PLAN_CONFIRMED":
    case "READY_TO_FINISH":
      return "wearable";
    case "REVIEWING_PLAN":
      return state.plan ? "plan" : "profile";
    case "WAITING_FOR_PLAN_PROPOSAL":
      return "profile";
    default:
      return s.profile.path ? "profile" : "welcome";
  }
}

/** The whole card model. `wearable` is the card's own step after the plan. */
export function cardViewOf(
  state: OnboardingState,
  wearable: Wearable,
): OnboardingView {
  return {
    phase: phaseOf(state, wearable),
    profile: cardProfileOf(state.session.profile),
    required: requiredRows(state),
    answered: state.progress.answered_required,
    total: state.progress.total_required,
    canCreatePlan: state.progress.can_request_plan,
    plan: cardPlanOf(state),
    confirmed:
      state.session.status === "PLAN_CONFIRMED" ||
      state.session.status === "READY_TO_FINISH" ||
      state.session.status === "COMPLETED",
    wearable,
  };
}

/** True while ChatGPT is building the plan the card asked for. */
export const isBuilding = (state: OnboardingState) =>
  state.session.status === "WAITING_FOR_PLAN_PROPOSAL";

/**
 * True while the plan comes from the chat: Arnold's plan is being built, or
 * the user's own plan has not been sent yet.
 */
export const awaitsChat = (state: OnboardingState) =>
  isBuilding(state) ||
  (state.session.profile.path === "own_plan" &&
    !state.plan &&
    state.session.status !== "COMPLETED");
