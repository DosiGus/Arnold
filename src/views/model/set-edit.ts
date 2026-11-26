/**
 * One stored set → the correction form, and the form → `update_set` /
 * `void_set`. Only what the user changed is sent; an emptied weight is sent as
 * unknown, never as 0.
 */
import type { WorkoutContext } from "../../shared/workout-contract.js";

type StoredSet = WorkoutContext["sets"][number];

export type SetForm = {
  id: string;
  revision: number;
  label: string;
  exercise: string;
  /** False for bodyweight sets: there is no weight to type. */
  hasWeight: boolean;
  kg: string;
  reps: string;
};

const kgText = (kg: number | null) =>
  kg === null ? "" : String(kg).replace(".", ",");

const SIDE: Record<string, string> = { left: " links", right: " rechts" };

/** The sets of one training in workout order; discarded ones are left out. */
export function setForms(sets: readonly StoredSet[]): SetForm[] {
  return sets
    .filter((s) => s.status === "active")
    .sort(
      (a, b) =>
        a.exercise_order - b.exercise_order || a.set_number - b.set_number,
    )
    .map((s) => ({
      id: s.set_id,
      revision: s.row_revision,
      exercise: s.exercise_name_snapshot,
      label: `Satz ${s.set_number}${SIDE[s.side] ?? ""}`,
      hasWeight: s.load_basis !== "bodyweight_only",
      kg: kgText(s.load_kg),
      reps: String(s.reps),
    }));
}

/**
 * Whether the card may correct this training: strength only, open trainings
 * with the write permission, completed ones only with the right to correct.
 */
export function canCorrectSets(context: WorkoutContext): boolean {
  const w = context.workout;
  if (!w || !context.can_write) return false;
  if (w.activity_type !== undefined && w.activity_type !== "strength")
    return false;
  if (w.status === "in_progress") return true;
  return w.status === "completed" && context.can_correct_completed;
}

const correction = (completed: boolean) =>
  completed
    ? { correct_completed: true, correction_reason: "In der Karte korrigiert" }
    : {};

const number = (text: string) => {
  const t = text.trim().replace(",", ".");
  return t === "" ? null : Number(t);
};

/** The `update_set` arguments, null without a change, or why not. */
export function updateSetInput(
  stored: SetForm,
  typed: { kg: string; reps: string },
  completed: boolean,
):
  | { ok: true; input: Record<string, unknown> | null }
  | { ok: false; error: string } {
  const changes: Record<string, number | null> = {};
  if (typed.reps.trim() !== stored.reps) {
    const reps = number(typed.reps);
    if (reps === null || !Number.isInteger(reps) || reps <= 0)
      return {
        ok: false,
        error: "Wiederholungen sind eine ganze Zahl über 0.",
      };
    changes.reps = reps;
  }
  if (stored.hasWeight && typed.kg.trim() !== stored.kg) {
    const kg = number(typed.kg);
    if (kg !== null && (!Number.isFinite(kg) || kg < 0))
      return { ok: false, error: "Das Gewicht ist keine Zahl." };
    changes.load_kg = kg;
  }
  if (!Object.keys(changes).length) return { ok: true, input: null };
  return {
    ok: true,
    input: {
      set_id: stored.id,
      expected_row_revision: stored.revision,
      changes,
      ...correction(completed),
    },
  };
}

export const voidSetInput = (stored: SetForm, completed: boolean) => ({
  set_id: stored.id,
  expected_row_revision: stored.revision,
  ...correction(completed),
});
