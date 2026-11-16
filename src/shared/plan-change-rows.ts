import type { PlanChange } from "./plan-contract.js";

/**
 * Turns the server's plan comparison into the rows of the change card.
 *
 * Pure and free of I/O: the comparison (`compare_plan_versions`) already says
 * what changed, this only decides how one change reads as "label: before →
 * after". The card shows the rows and does no arithmetic of its own.
 */
export type PlanChangeRow = {
  key: string;
  label: string;
  before: string;
  after: string;
};

const NOT_THERE = "nicht dabei";
const GONE = "entfällt";
const UNSET = "nicht gesetzt";

const FIELD_LABEL: Record<string, string> = {
  split_key: "Split",
  goal_key: "Trainingsziel",
  days_per_week: "Trainingstage pro Woche",
  target_sets: "Sätze",
  rep_min: "Wiederholungen ab",
  rep_max: "Wiederholungen bis",
  target_load_kg: "Gewicht",
  target_load_basis: "Gewichtsdefinition",
  rest_seconds: "Pause",
  notes: "Notiz",
  target_execution_mode: "Ausführung",
  target_implement_count: "Anzahl Geräte",
};

const position = (value: string | null) =>
  value === null ? UNSET : `Position ${value}`;

function row(change: PlanChange, index: number): PlanChangeRow {
  const key = `${index}-${change.kind}`;
  const session = change.session_name ?? "Plan";
  const fallbackLabel = change.exercise_name
    ? `${session} · ${change.exercise_name}`
    : session;
  const field = change.field ? (FIELD_LABEL[change.field] ?? change.field) : "";
  switch (change.kind) {
    case "plan_renamed":
      return {
        key,
        label: "Planname",
        before: change.before ?? UNSET,
        after: change.after ?? UNSET,
      };
    case "plan_metadata_changed":
      return {
        key,
        label: field || "Plan",
        before: change.before ?? UNSET,
        after: change.after ?? UNSET,
      };
    case "session_added":
      return {
        key,
        label: "Neuer Trainingstag",
        before: NOT_THERE,
        after: change.after ?? session,
      };
    case "session_removed":
      return {
        key,
        label: "Trainingstag",
        before: change.before ?? session,
        after: GONE,
      };
    case "session_renamed":
      return {
        key,
        label: "Trainingstag umbenannt",
        before: change.before ?? UNSET,
        after: change.after ?? UNSET,
      };
    case "session_reordered":
      return {
        key,
        label: `${session} verschoben`,
        before: position(change.before),
        after: position(change.after),
      };
    case "exercise_added":
      return {
        key,
        label: session,
        before: NOT_THERE,
        after: change.after ?? change.exercise_name ?? UNSET,
      };
    case "exercise_removed":
      return {
        key,
        label: session,
        before: change.before ?? change.exercise_name ?? UNSET,
        after: GONE,
      };
    case "exercise_replaced":
      return {
        key,
        label: session,
        before: change.before ?? UNSET,
        after: change.after ?? UNSET,
      };
    case "exercise_reordered":
      return {
        key,
        label: fallbackLabel,
        before: position(change.before),
        after: position(change.after),
      };
    case "targets_changed":
    case "execution_changed":
      return {
        key,
        label: field ? `${fallbackLabel} · ${field}` : fallbackLabel,
        before: change.before ?? UNSET,
        after: change.after ?? UNSET,
      };
  }
}

export function planChangeRows(
  changes: readonly PlanChange[],
): PlanChangeRow[] {
  return changes.map(row);
}
