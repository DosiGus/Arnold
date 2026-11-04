import type { PlannedExercise } from "../../../shared/plan-contract";

/* ------------------------------------------------------------ TargetDraft */

export type TargetDraft = {
  target_sets: string;
  rep_min: string;
  rep_max: string;
  target_load_kg: string;
  target_load_basis: string;
  target_execution_mode: string;
  target_implement_count: string;
  rest_seconds: string;
  notes: string;
};

export const draftFromExercise = (exercise: PlannedExercise): TargetDraft => ({
  target_sets:
    exercise.target_sets === null ? "" : String(exercise.target_sets),
  rep_min: exercise.rep_min === null ? "" : String(exercise.rep_min),
  rep_max: exercise.rep_max === null ? "" : String(exercise.rep_max),
  target_load_kg:
    exercise.target_load_kg === null ? "" : String(exercise.target_load_kg),
  target_load_basis: exercise.target_load_basis ?? "",
  target_execution_mode: exercise.target_execution_mode ?? "",
  target_implement_count:
    exercise.target_implement_count === null
      ? ""
      : String(exercise.target_implement_count),
  rest_seconds:
    exercise.rest_seconds === null ? "" : String(exercise.rest_seconds),
  notes: exercise.notes ?? "",
});

/** Turns the form strings back into the typed target payload. */
export function targetsFromDraft(draft: TargetDraft) {
  const number = (value: string) =>
    value.trim() === "" ? null : Number(value);
  return {
    target_sets: number(draft.target_sets),
    rep_min: number(draft.rep_min),
    rep_max: number(draft.rep_max),
    target_load_kg: number(draft.target_load_kg),
    target_load_basis:
      draft.target_load_basis === "" ? null : draft.target_load_basis,
    target_execution_mode:
      draft.target_execution_mode === "" ? null : draft.target_execution_mode,
    target_implement_count: number(draft.target_implement_count),
    rest_seconds: number(draft.rest_seconds),
    notes: draft.notes.trim() === "" ? null : draft.notes.trim(),
  };
}
