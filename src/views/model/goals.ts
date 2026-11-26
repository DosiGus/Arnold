/**
 * Arnold's goals (dashboard `home.goals`) → the goals screen, and the
 * screen's form → `create_training_goal` / `update_training_goal` /
 * `archive_training_goal` arguments.
 *
 * Mapping only: start value, current value and progress come from
 * `src/analytics/goals.ts`. Arnold knows three kinds of goal: body weight
 * (kg), the weight of an exercise (kg) and repetitions of an exercise; the
 * form offers exactly those. A target is the user's own number, never filled
 * in or guessed.
 */
import type {
  ArnoldDashboardView,
  HomeGoal,
} from "../../shared/arnold-view.js";
import { num } from "./dashboard.js";

export const BODY_WEIGHT = "body_weight";

export type GoalUnit = "kg" | "Wdh.";

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

const unitOf = (g: HomeGoal): GoalUnit => (g.unit === "kg" ? "kg" : "Wdh.");

export function goalRows(home: ArnoldDashboardView["home"]): LiveGoal[] {
  return home.goals.map((g) => {
    const unit = unitOf(g);
    return {
      id: g.goal_id,
      revision: g.row_revision,
      name: g.name,
      current:
        g.current_value === null ? "–" : `${num(g.current_value)} ${unit}`,
      target: `${num(g.target_value)} ${unit}`,
      targetText: num(g.target_value),
      unit,
      progress: g.progress,
    };
  });
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
  return [{ value: BODY_WEIGHT, label: "Körpergewicht" }, ...exercises];
}

/** Units the form offers for a choice: body weight is always in kg. */
export const unitsFor = (choice: string): GoalUnit[] =>
  choice === BODY_WEIGHT ? ["kg"] : ["kg", "Wdh."];

type Built =
  { ok: true; input: Record<string, unknown> } | { ok: false; error: string };

function target(text: string, unit: GoalUnit): number | string {
  const t = text.trim().replace(",", ".");
  const n = t === "" ? Number.NaN : Number(t);
  if (!Number.isFinite(n) || n <= 0)
    return "Der Zielwert muss eine Zahl über 0 sein.";
  if (n > 1000) return "Der Zielwert darf höchstens 1000 sein.";
  if (unit === "Wdh." && !Number.isInteger(n))
    return "Wiederholungen sind eine ganze Zahl.";
  return n;
}

export function createGoalInput(
  form: { choice: string; unit: GoalUnit; target: string },
  requestId: string,
): Built {
  if (!form.choice)
    return { ok: false, error: "Wähle zuerst Übung oder Körpergewicht." };
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
