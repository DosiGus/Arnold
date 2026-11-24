/**
 * Mobility: how long each exercise of a routine lasts (ARN-MOB, D-MOB-05).
 *
 * Pure, without I/O and deterministic: the same request always gives the
 * same routine. The model chooses exercises and a length; Arnold decides the
 * seconds, inside each exercise's catalog bounds.
 *
 * Budget = minutes × 60. Transitions count into it: 5 s between two
 * exercises and 3 s for the side switch of a per-side exercise.
 *
 *   1. Start from each exercise's default seconds.
 *   2. Scale proportionally to the budget, each exercise clamped to
 *      [min_s, max_s] (repeated while clamping frees or takes time).
 *   3. Round to 5 s.
 *   4. Hand the rest out in 5 s steps to the exercises with the most room.
 *
 * Finally the total must lie within max(30 s, 10 % of the budget) of the
 * budget; otherwise the selection cannot fill the time and the result is an
 * error, never a routine that silently misses its length.
 */
import {
  allowedInMorning,
  mobilityExercise,
  type MobilityExercise,
} from "../../shared/mobility-catalog.js";

export const MOBILITY_RULES_VERSION = "mob-timing-1";

/** Seconds between two exercises. */
export const MOBILITY_TRANSITION_S = 5;
/** Seconds for the side switch of a per-side exercise. */
export const MOBILITY_SIDE_SWITCH_S = 3;
/** Every duration is a multiple of this. */
export const MOBILITY_ROUNDING_S = 5;

export type MobilityRoutineKind = "morning" | "session";

/** Allowed lengths and the number of exercises each allows. */
export const MOBILITY_LENGTHS: Readonly<
  Record<
    MobilityRoutineKind,
    Readonly<Record<number, { readonly min: number; readonly max: number }>>
  >
> = Object.freeze({
  morning: Object.freeze({
    5: { min: 3, max: 5 },
    10: { min: 5, max: 8 },
    15: { min: 6, max: 10 },
  }),
  session: Object.freeze({
    15: { min: 6, max: 10 },
    20: { min: 7, max: 12 },
    30: { min: 9, max: 15 },
  }),
});

export const MOBILITY_TIMING_ERROR_CODES = [
  "MOBILITY_BAD_MINUTES",
  "MOBILITY_TOO_MANY_EXERCISES",
  "MOBILITY_TOO_FEW_EXERCISES",
  "MOBILITY_UNKNOWN_EXERCISE",
  "MOBILITY_DUPLICATE_EXERCISE",
  "MOBILITY_NOT_MORNING_SUITABLE",
  /** The selection cannot fill the length within the tolerance. */
  "MOBILITY_BUDGET_UNREACHABLE",
] as const;
export type MobilityTimingErrorCode =
  (typeof MOBILITY_TIMING_ERROR_CODES)[number];

export type MobilityRoutineRequest = {
  kind: MobilityRoutineKind;
  minutes: number;
  exercise_ids: readonly string[];
  /**
   * Whether the user has a mat (D-07). Only `true` lets floor exercises into
   * the morning routine; absent or false means no mat, as before.
   */
  has_mat?: boolean;
};

export type MobilityRoutineItem = {
  exercise_id: string;
  sides: 1 | 2;
  seconds_per_side: number;
  reps: number | null;
};

export type MobilityRoutineResult =
  | {
      ok: true;
      items: MobilityRoutineItem[];
      total_s: number;
      rules_version: typeof MOBILITY_RULES_VERSION;
    }
  | { ok: false; code: MobilityTimingErrorCode; message: string };

/** Allowed distance of the total from the budget, in seconds. */
export function mobilityTolerance(budgetS: number): number {
  return Math.max(30, Math.floor(budgetS * 0.1));
}

const fail = (
  code: MobilityTimingErrorCode,
  message: string,
): MobilityRoutineResult => ({ ok: false, code, message });

const roundTo = (value: number, step: number) =>
  Math.round(value / step) * step;

export function buildMobilityRoutine(
  request: MobilityRoutineRequest,
): MobilityRoutineResult {
  const { kind, minutes, exercise_ids } = request;
  const lengths = MOBILITY_LENGTHS[kind];
  const bounds =
    lengths && Number.isInteger(minutes) ? lengths[minutes] : undefined;
  if (!bounds)
    return fail(
      "MOBILITY_BAD_MINUTES",
      kind === "morning"
        ? "Die Morgenroutine dauert 5, 10 oder 15 Minuten."
        : "Eine Mobility-Einheit dauert 15, 20 oder 30 Minuten.",
    );

  const exercises: MobilityExercise[] = [];
  const seen = new Set<string>();
  for (const id of exercise_ids) {
    const exercise = mobilityExercise(id);
    if (!exercise)
      return fail(
        "MOBILITY_UNKNOWN_EXERCISE",
        `Die Übung ${id} gibt es im Mobility-Katalog nicht.`,
      );
    if (seen.has(id))
      return fail(
        "MOBILITY_DUPLICATE_EXERCISE",
        `Die Übung ${exercise.name_de} ist doppelt ausgewählt.`,
      );
    seen.add(id);
    if (kind === "morning" && !allowedInMorning(exercise, request.has_mat))
      return fail(
        "MOBILITY_NOT_MORNING_SUITABLE",
        `${exercise.name_de} braucht eine Matte und passt nicht in die Morgenroutine.`,
      );
    exercises.push(exercise);
  }
  if (exercises.length > bounds.max)
    return fail(
      "MOBILITY_TOO_MANY_EXERCISES",
      `Für ${minutes} Minuten passen höchstens ${bounds.max} Übungen.`,
    );
  if (exercises.length < bounds.min)
    return fail(
      "MOBILITY_TOO_FEW_EXERCISES",
      `Für ${minutes} Minuten braucht es mindestens ${bounds.min} Übungen.`,
    );

  const budget = minutes * 60;
  const sides = exercises.map((e) => (e.per_side ? 2 : 1));
  const transitions =
    MOBILITY_TRANSITION_S * (exercises.length - 1) +
    MOBILITY_SIDE_SWITCH_S * sides.filter((s) => s === 2).length;
  const work = budget - transitions;

  // Steps 1 and 2: defaults, scaled to the work budget with clamping. Each
  // pass fixes the exercises that hit a bound and rescales the rest.
  const seconds = exercises.map((e) => e.default_s);
  const fixed = exercises.map(() => false);
  for (let pass = 0; pass < exercises.length; pass++) {
    const fixedTime = seconds.reduce(
      (sum, s, i) => (fixed[i] ? sum + s * sides[i] : sum),
      0,
    );
    const freeDefault = exercises.reduce(
      (sum, e, i) => (fixed[i] ? sum : sum + e.default_s * sides[i]),
      0,
    );
    if (freeDefault === 0) break;
    const factor = (work - fixedTime) / freeDefault;
    let clamped = false;
    exercises.forEach((e, i) => {
      if (fixed[i]) return;
      const scaled = e.default_s * factor;
      if (scaled <= e.min_s || scaled >= e.max_s) {
        seconds[i] = scaled <= e.min_s ? e.min_s : e.max_s;
        fixed[i] = true;
        clamped = true;
      } else seconds[i] = scaled;
    });
    if (!clamped) break;
  }

  // Step 3: round to 5 s inside the bounds (catalog bounds are multiples of 5).
  exercises.forEach((e, i) => {
    seconds[i] = Math.min(
      e.max_s,
      Math.max(e.min_s, roundTo(seconds[i], MOBILITY_ROUNDING_S)),
    );
  });

  // Step 4: hand out the rest. Each step moves one exercise by 5 s per side,
  // picked by the most room in that direction (ties: the order of the
  // selection). A step is taken only when it brings the total closer.
  let rest = work - seconds.reduce((sum, s, i) => sum + s * sides[i], 0);
  for (;;) {
    const direction = rest > 0 ? 1 : -1;
    let best = -1;
    let bestRoom = 0;
    exercises.forEach((e, i) => {
      const delta = MOBILITY_ROUNDING_S * sides[i];
      if (Math.abs(rest - direction * delta) >= Math.abs(rest)) return;
      const room = direction > 0 ? e.max_s - seconds[i] : seconds[i] - e.min_s;
      if (room >= MOBILITY_ROUNDING_S && room > bestRoom) {
        best = i;
        bestRoom = room;
      }
    });
    if (best < 0) break;
    seconds[best] += direction * MOBILITY_ROUNDING_S;
    rest -= direction * MOBILITY_ROUNDING_S * sides[best];
  }

  const total =
    transitions + seconds.reduce((sum, s, i) => sum + s * sides[i], 0);
  if (Math.abs(total - budget) > mobilityTolerance(budget))
    return fail(
      "MOBILITY_BUDGET_UNREACHABLE",
      total < budget
        ? `Diese Übungen füllen ${minutes} Minuten nicht. Bitte mehr oder andere Übungen wählen.`
        : `Diese Übungen passen nicht in ${minutes} Minuten. Bitte weniger Übungen wählen.`,
    );

  return {
    ok: true,
    items: exercises.map((e, i) => ({
      exercise_id: e.id,
      sides: sides[i] as 1 | 2,
      seconds_per_side: seconds[i],
      reps: e.reps,
    })),
    total_s: total,
    rules_version: MOBILITY_RULES_VERSION,
  };
}
