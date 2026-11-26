/**
 * Arnold's goals (dashboard `home.goals`) → the goals screen, and the
 * screen's form → `create_training_goal` / `update_training_goal` /
 * `archive_training_goal` arguments.
 *
 * Mapping only: start value, current value and progress come from
 * `src/analytics/goals.ts`. Arnold knows body weight (kg), the weight of an
 * exercise (kg), repetitions of an exercise, and three running goals: a
 * distance in one run (km), minutes in one run, and a time for 5 or 10 km
 * (mm:ss, lower is better). The form offers exactly those. A target is the
 * user's own number, never filled in or guessed.
 */
import type {
  ArnoldDashboardView,
  HomeGoal,
} from "../../shared/arnold-view.js";
import { goalValueText, kmText, num } from "./dashboard.js";

export const BODY_WEIGHT = "body_weight";
export const RUNNING = "running";

/** Units of a stored goal, as the list and the change form show them. */
export type GoalUnit = "kg" | "Wdh." | "km" | "Min." | "mm:ss";
/** What the form's unit switch offers; "5 km" and "10 km" are time goals. */
export type GoalFormUnit = GoalUnit | "5 km" | "10 km";

/** Distances a time goal can be set for in the form. */
const TIME_GOAL_METERS: Partial<Record<GoalFormUnit, number>> = {
  "5 km": 5000,
  "10 km": 10_000,
};

export type LiveGoal = {
  id: string;
  revision: number;
  name: string;
  current: string;
  target: string;
  /** The target as typed text, to prefill the change form. */
  targetText: string;
  unit: GoalUnit;
  progress: number | null;
};

export type GoalChoice = { value: string; label: string };

const UNIT: Record<HomeGoal["unit"], GoalUnit> = {
  kg: "kg",
  reps: "Wdh.",
  km: "km",
  min: "Min.",
  s: "mm:ss",
};

/** "24:30" for a time, "10,5" for kilometres, "62,5" otherwise. */
function editText(g: HomeGoal): string {
  if (g.unit === "s") return goalValueText(g.target_value, "s");
  if (g.unit === "km") return kmText(g.target_value);
  return num(g.target_value);
}

export function goalRows(home: ArnoldDashboardView["home"]): LiveGoal[] {
  return home.goals.map((g) => ({
    id: g.goal_id,
    revision: g.row_revision,
    name: g.name,
    current:
      g.current_value === null ? "–" : goalValueText(g.current_value, g.unit),
    target: goalValueText(g.target_value, g.unit),
    targetText: editText(g),
    unit: UNIT[g.unit],
    progress: g.progress,
  }));
}

/**
 * What a goal can be about: body weight, then the exercises of today's
 * catalog, the trained ones first.
 */
export function goalChoices(view: ArnoldDashboardView): GoalChoice[] {
  const exercises = view.exercises
    .filter((e) => e.in_current_catalog && !e.retired)
    .sort(
      (a, b) =>
        Number(b.logged_sets > 0) - Number(a.logged_sets > 0) ||
        a.name.localeCompare(b.name, "de"),
    )
    .map((e) => ({ value: e.exercise_id, label: e.name }));
  return [
    { value: BODY_WEIGHT, label: "Körpergewicht" },
    { value: RUNNING, label: "Laufen" },
    ...exercises,
  ];
}

/**
 * Units the form offers for a choice: body weight is always in kg; running
 * is a distance (km), a duration (Min.) or a time for 5 or 10 km.
 */
export const unitsFor = (choice: string): GoalFormUnit[] =>
  choice === BODY_WEIGHT
    ? ["kg"]
    : choice === RUNNING
      ? ["km", "Min.", "5 km", "10 km"]
      : ["kg", "Wdh."];

/** The input hint for a unit: a time is typed as minutes and seconds. */
export const placeholderFor = (unit: string): string =>
  unit === "mm:ss" || unit in TIME_GOAL_METERS ? "mm:ss" : "Zielwert";

type Built =
  { ok: true; input: Record<string, unknown> } | { ok: false; error: string };

const isTime = (unit: GoalFormUnit) =>
  unit === "mm:ss" || unit in TIME_GOAL_METERS;

/** "24:30" or "1:05:00" → seconds; a plain number is minutes. */
function seconds(text: string): number | null {
  const parts = text.split(":").map((p) => p.trim());
  if (parts.some((p) => !/^\d+([.,]\d+)?$/.test(p))) return null;
  const n = parts.map((p) => Number(p.replace(",", ".")));
  if (n.length === 1) return Math.round(n[0]! * 60);
  if (n.length > 3 || n.slice(1).some((x) => x >= 60)) return null;
  return Math.round(n.reduce((sum, x) => sum * 60 + x, 0));
}

function target(text: string, unit: GoalFormUnit): number | string {
  const t = text.trim().replace(",", ".");
  if (isTime(unit)) {
    const s = t === "" ? null : seconds(text.trim());
    if (s === null || s <= 0)
      return "Gib die Zielzeit als Minuten und Sekunden ein, z. B. 24:30.";
    if (s > 86_400) return "Die Zielzeit darf höchstens 24 Stunden sein.";
    return s;
  }
  const n = t === "" ? Number.NaN : Number(t);
  if (!Number.isFinite(n) || n <= 0)
    return "Der Zielwert muss eine Zahl über 0 sein.";
  const max = unit === "km" ? 300 : unit === "Min." ? 1440 : 1000;
  if (n > max) return `Der Zielwert darf höchstens ${max} sein.`;
  if (unit === "Wdh." && !Number.isInteger(n))
    return "Wiederholungen sind eine ganze Zahl.";
  return n;
}

export function createGoalInput(
  form: { choice: string; unit: GoalFormUnit; target: string },
  requestId: string,
): Built {
  if (!form.choice)
    return {
      ok: false,
      error: "Wähle zuerst Übung, Körpergewicht oder Laufen.",
    };
  const value = target(form.target, form.unit);
  if (typeof value === "string") return { ok: false, error: value };
  if (form.choice === BODY_WEIGHT)
    return {
      ok: true,
      input: {
        request_id: requestId,
        kind: "body_weight",
        target_value: value,
        source: "ui",
      },
    };
  if (form.choice === RUNNING) {
    const meters = TIME_GOAL_METERS[form.unit];
    return {
      ok: true,
      input: {
        request_id: requestId,
        kind: meters
          ? "run_time_for_distance"
          : form.unit === "km"
            ? "run_distance"
            : "run_duration",
        ...(meters ? { run_distance_m: meters } : {}),
        target_value: value,
        source: "ui",
      },
    };
  }
  return {
    ok: true,
    input: {
      request_id: requestId,
      kind: form.unit === "kg" ? "exercise_load" : "exercise_reps",
      exercise_id: form.choice,
      target_value: value,
      source: "ui",
    },
  };
}

export function updateGoalInput(
  goal: LiveGoal,
  text: string,
  requestId: string,
): Built {
  const value = target(text, goal.unit);
  if (typeof value === "string") return { ok: false, error: value };
  return {
    ok: true,
    input: {
      request_id: requestId,
      goal_id: goal.id,
      expected_row_revision: goal.revision,
      target_value: value,
    },
  };
}

export const archiveGoalInput = (goal: LiveGoal, requestId: string) => ({
  request_id: requestId,
  goal_id: goal.id,
  expected_row_revision: goal.revision,
});

/** Plain words for the errors a goal write can end with. */
export function goalErrorText(code: string, fallback: string): string {
  if (code === "GOAL_EXISTS")
    return "Dafür gibt es schon ein Ziel. Tipp es in der Liste an, um den Zielwert zu ändern.";
  if (code === "REVISION_CONFLICT")
    return "Das Ziel wurde inzwischen geändert. Die Liste ist jetzt aktuell, versuch es noch einmal.";
  return fallback;
}
