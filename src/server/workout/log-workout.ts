/**
 * The deviations of `log_workout` applied to a session proposal: swap, skip,
 * other values, or an extra exercise at the end. Pure; the service turns the
 * result into rows inside its transaction.
 */
import type { ArnoldDataset } from "../../shared/arnold-schema-v1.js";
import type {
  LogWorkoutExercise,
  ProposedExercise,
  ProposedSet,
} from "../../shared/workout-contract.js";
import { WriteError } from "./infrastructure.js";
import { conventionsFor, proposeExercise, sidesFor } from "./proposal.js";

export const MISSING_LABEL = {
  sets: "Sätze",
  reps: "Wiederholungen",
  load: "Gewicht",
} as const;

/** Which of sets, reps and load are still unknown for these sets. */
function missingOf(
  slot: ProposedExercise,
  sets: ProposedSet[],
  repsGiven: boolean,
): ProposedExercise["missing"] {
  const missing: ProposedExercise["missing"] = [];
  if (!sets.length) missing.push("sets");
  if (!repsGiven && slot.missing.includes("reps")) missing.push("reps");
  if (
    slot.conventions.load_basis !== "bodyweight_only" &&
    (!sets.length || sets.some((s) => s.load_kg === null))
  )
    missing.push("load");
  return missing;
}

/** Sets after the shorthand or explicit values of one change. */
function withValues(
  slot: ProposedExercise,
  change: LogWorkoutExercise,
): ProposedExercise {
  const bodyweight = slot.conventions.load_basis === "bodyweight_only";
  if (
    bodyweight &&
    [change.load_kg, ...(change.sets ?? []).map((s) => s.load_kg)].some(
      (l) => l !== undefined && l !== null && l > 0,
    )
  )
    throw new WriteError(
      "VALIDATION_ERROR",
      `${slot.exercise_name} wird mit Körpergewicht erfasst; dafür kein Gewicht angeben.`,
    );
  const sides = sidesFor(slot.conventions.execution_mode);
  if (change.sets) {
    const sets = change.sets.map((q) => ({
      reps: q.reps,
      load_kg: bodyweight ? null : (q.load_kg ?? null),
      side: q.side ?? sides[0],
    }));
    return { ...slot, sets, missing: missingOf(slot, sets, true) };
  }
  let sets = slot.sets;
  if (change.set_count !== undefined) {
    const per = sides.length;
    const groups: ProposedSet[][] = [];
    for (let i = 0; i < sets.length; i += per)
      groups.push(sets.slice(i, i + per));
    const template =
      groups.at(-1) ??
      sides.map((side) => ({
        reps: change.reps ?? 0,
        load_kg: bodyweight ? null : (change.load_kg ?? null),
        side,
      }));
    const resized: ProposedSet[][] = [];
    for (let n = 0; n < change.set_count; n++)
      resized.push(groups[n] ?? template);
    sets = resized.flat();
  }
  if (change.reps !== undefined)
    sets = sets.map((s) => ({ ...s, reps: change.reps! }));
  if (change.load_kg !== undefined)
    sets = sets.map((s) => ({
      ...s,
      load_kg: bodyweight ? null : change.load_kg!,
    }));
  return {
    ...slot,
    sets,
    missing: missingOf(slot, sets, change.reps !== undefined),
  };
}

/**
 * Applies the deviations of `log_workout` to the proposal: swap, skip, other
 * values, or an extra exercise at the end.
 */
export function applyChanges(
  data: ArnoldDataset,
  proposal: readonly ProposedExercise[],
  changes: readonly LogWorkoutExercise[],
  options: { before?: string; excludeWorkoutId?: string },
): ProposedExercise[] {
  const slots = [...proposal];
  const exercise = (id: string) => {
    const found = data.exercises.find(
      (e) => e.exercise_id === id && e.status === "active",
    );
    if (!found)
      throw new WriteError(
        "EXERCISE_NOT_FOUND",
        "Aktive Übung nicht gefunden.",
      );
    return found;
  };
  for (const change of changes) {
    if (!change.plan_item_id) {
      if (change.skip)
        throw new WriteError(
          "VALIDATION_ERROR",
          "Weglassen braucht die Planposition (plan_item_id).",
        );
      const extra = proposeExercise(
        data,
        exercise(change.exercise_id!),
        undefined,
        options,
      );
      slots.push(withValues(extra, change));
      continue;
    }
    const index = slots.findIndex(
      (s) => s.plan_item_id === change.plan_item_id,
    );
    if (index < 0)
      throw new WriteError(
        "VALIDATION_ERROR",
        "Planposition gehört nicht zu diesem Trainingstag oder wurde schon geändert.",
      );
    if (change.skip) {
      slots.splice(index, 1);
      continue;
    }
    let slot = slots[index];
    if (change.exercise_id && change.exercise_id !== slot.exercise_id) {
      const next = exercise(change.exercise_id);
      const swapped = proposeExercise(data, next, undefined, options);
      if (swapped.source === "last_time") slot = swapped;
      else {
        // No history for the new exercise: keep the planned volume, but the
        // weight of another exercise says nothing about this one.
        const conventions = conventionsFor(next);
        const sides = sidesFor(conventions.execution_mode);
        const oldSides = sidesFor(slot.conventions.execution_mode).length;
        const count =
          slot.target_sets ??
          Math.max(1, Math.round(slot.sets.length / oldSides));
        const reps = slot.sets[0]?.reps ?? slot.rep_max ?? slot.rep_min ?? 0;
        const sets: ProposedSet[] = [];
        for (let n = 0; n < count; n++)
          for (const side of sides) sets.push({ reps, load_kg: null, side });
        slot = {
          ...swapped,
          target_sets: slot.target_sets,
          rep_min: slot.rep_min,
          rep_max: slot.rep_max,
          sets,
          missing: [],
        };
        slot = { ...slot, missing: missingOf(slot, sets, reps > 0) };
      }
    }
    slots[index] = withValues(slot, change);
  }
  return slots;
}
