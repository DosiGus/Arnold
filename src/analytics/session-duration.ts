/**
 * Estimated duration of one training day (07 D-27). Pure, no I/O.
 *
 * Per exercise: sets × 40 s plus (sets − 1) × rest; between two exercises
 * the previous exercise's rest once as changeover; rounded up to whole
 * minutes. An exercise with an unknown set count makes the whole day
 * unknown: null, never a guess. The 40 s per set is an assumption the owner
 * may change.
 */
export const SECONDS_PER_SET = 40;
export const DEFAULT_REST_SECONDS = 120;

export interface DurationExercise {
  /** Sets to perform; null when unknown. */
  sets: number | null;
  /** Rest between sets in seconds; null means the default of 120 s. */
  rest_seconds: number | null;
}

export function estimateSessionMinutes(
  exercises: readonly DurationExercise[],
): number | null {
  if (!exercises.length) return null;
  let seconds = 0;
  for (const [index, exercise] of exercises.entries()) {
    if (exercise.sets === null || !Number.isFinite(exercise.sets)) return null;
    const rest = exercise.rest_seconds ?? DEFAULT_REST_SECONDS;
    const sets = Math.max(0, exercise.sets);
    seconds += sets * SECONDS_PER_SET + Math.max(0, sets - 1) * rest;
    if (index < exercises.length - 1) seconds += rest;
  }
  return Math.ceil(seconds / 60);
}
