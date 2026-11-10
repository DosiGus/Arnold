import type { ArnoldExercise } from "../shared/arnold-schema-v1.js";

const muscleOf = (e: ArnoldExercise) => e.primary_muscle.trim().toLowerCase();

/**
 * Exercises for the same muscle group, the closest variants first: the same
 * movement family, then the rest by name.
 */
export function similarExercises(
  catalog: readonly ArnoldExercise[],
  exerciseId: string,
): ArnoldExercise[] {
  const current = catalog.find((e) => e.exercise_id === exerciseId);
  if (!current) return [];
  return catalog
    .filter(
      (e) =>
        e.exercise_id !== exerciseId &&
        e.status === "active" &&
        (muscleOf(e) === muscleOf(current) ||
          e.family_key === current.family_key),
    )
    .sort(
      (a, b) =>
        Number(b.family_key === current.family_key) -
          Number(a.family_key === current.family_key) ||
        a.name_de.localeCompare(b.name_de, "de"),
    );
}
