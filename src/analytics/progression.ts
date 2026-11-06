import { z } from "zod";
import type { ArnoldLoadBasis } from "../shared/arnold-schema-v1.js";

/**
 * Progression: what an exercise should be trained with next time, from what
 * was actually lifted. This is the trainer's arithmetic; the chat model only
 * explains it and never computes a weight itself.
 *
 * The method is double progression, the common rule for strength training
 * with a repetition range (for example 3 sets of 8–10):
 *
 *   - Every working set reached the top of the range last time:
 *     one weight step more, back to the bottom of the range.
 *   - Otherwise: the same weight, one repetition more per set (up to the top).
 *   - Most sets below the bottom of the range two sessions in a row, or three
 *     sessions in a row without any progress at the same weight: about 10 %
 *     lighter, at the bottom of the range, and work back up from there.
 *
 * Bodyweight and assisted exercises progress by repetitions only; the weight
 * of a person is not Arnold's to change. Everything here is deterministic:
 * the same history always gives the same recommendation. Nothing is guessed:
 * without a repetition range or with an unknown weight there is no
 * recommendation, and the caller keeps last time's values.
 */

/** Version of the progression rules; bump it whenever a rule changes. */
export const PROGRESSION_VERSION = "1.0.0";

/** A deload takes about this share off the weight. */
export const DELOAD_FACTOR = 0.9;
/** Sessions in a row without progress at the same weight before a deload. */
export const STALL_SESSIONS = 3;
/** Sessions in a row mostly below the range before the weight goes down. */
export const MISSED_SESSIONS = 2;
/** At most this many past sessions are looked at. */
export const PROGRESSION_HISTORY = 6;

export const ProgressionDecisionSchema = z.enum([
  /** One weight step more, back to the bottom of the range. */
  "increase",
  /** Same weight, one repetition more per set. */
  "more_reps",
  /** Top of the range reached without a weight to raise (bodyweight, assisted). */
  "top_reached",
  /** About 10 % lighter, at the bottom of the range. */
  "reduce",
]);
export type ProgressionDecision = z.infer<typeof ProgressionDecisionSchema>;

export const ProgressionReasonSchema = z.enum([
  /** Every working set reached the top of the range. */
  "all_sets_at_top",
  /** Within (or once below) the range: build repetitions first. */
  "building_reps",
  /** Most sets below the range in the last sessions. */
  "missed_range",
  /** No progress at the same weight for several sessions. */
  "stalled",
]);
export type ProgressionReason = z.infer<typeof ProgressionReasonSchema>;

/** One set: repetitions and weight (null for bodyweight). */
export interface ProgressionSet {
  reps: number;
  load_kg: number | null;
}

/** The working sets of one completed session, in set order. */
export interface ProgressionSession<S extends ProgressionSet = ProgressionSet> {
  date: string;
  sets: readonly S[];
}

export interface ProgressionInput<S extends ProgressionSet = ProgressionSet> {
  /**
   * Past sessions of this exercise, newest first, all measured the same way
   * (load basis, execution mode, implement count). Only working sets.
   */
  sessions: readonly ProgressionSession<S>[];
  load_basis: ArnoldLoadBasis;
  rep_min: number | null;
  rep_max: number | null;
  /** The smallest weight step of the equipment, in the load basis. */
  step_kg: number;
}

/** The recommendation as the card and the chat see it. */
export const ProgressionSchema = z.strictObject({
  version: z.literal(PROGRESSION_VERSION),
  decision: ProgressionDecisionSchema,
  reason: ProgressionReasonSchema,
  /** Weight change per set against last time; 0 when only reps change. */
  change_kg: z.number(),
  /** The bottom and top of the repetition range the rule worked with. */
  rep_min: z.number().int().positive(),
  rep_max: z.number().int().positive(),
  /** Last time: date and the working sets the recommendation is built on. */
  last_date: z.iso.date(),
  last_sets: z.array(
    z.strictObject({
      reps: z.number().int().nonnegative(),
      load_kg: z.number().nonnegative().nullable(),
    }),
  ),
  /** Sessions in a row without progress at the same weight (0 when there was). */
  stalled_sessions: z.number().int().nonnegative(),
});
export type Progression = z.infer<typeof ProgressionSchema>;

export type ProgressionResult<S extends ProgressionSet = ProgressionSet> =
  | { status: "recommended"; progression: Progression; sets: S[] }
  | {
      status: "not_available";
      reason: "no_history" | "no_rep_range" | "load_unknown";
    };

/** Weight changes with this basis; bodyweight and assistance progress by reps. */
const hasWeight = (basis: ArnoldLoadBasis) =>
  basis === "total" ||
  basis === "per_implement" ||
  basis === "machine_display" ||
  basis === "added";

/** Two decimals, so 2.5-steps never drift into 82.49999. */
const kg = (value: number) => Math.round(value * 100) / 100;

/** The heaviest weight of a session (0 for bodyweight). */
const topLoad = (session: ProgressionSession) =>
  Math.max(...session.sets.map((s) => s.load_kg ?? 0));

/** Repetitions done with the session's heaviest weight. */
const repsAtTop = (session: ProgressionSession) => {
  const top = topLoad(session);
  return session.sets
    .filter((s) => (s.load_kg ?? 0) === top)
    .reduce((sum, s) => sum + s.reps, 0);
};

/** More than half of the sets ended below the bottom of the range. */
const missed = (session: ProgressionSession, repMin: number) =>
  session.sets.filter((s) => s.reps < repMin).length * 2 > session.sets.length;

/**
 * Sessions in a row, newest first, that did not beat the one before at the
 * same weight. A lighter session (a deload, or the user's own choice) starts
 * a new count, so a deload is never followed straight by another one.
 */
export function stalledSessions(sessions: readonly ProgressionSession[]) {
  let count = 0;
  for (let i = 0; i + 1 < sessions.length; i++) {
    const now = sessions[i];
    const before = sessions[i + 1];
    if (topLoad(now) !== topLoad(before)) break;
    if (repsAtTop(now) > repsAtTop(before)) break;
    count++;
  }
  return count;
}

/** About 10 % lighter on the equipment's steps; null when it cannot go lower. */
export function deloadLoad(load: number, step: number): number | null {
  let next = kg(Math.round((load * DELOAD_FACTOR) / step) * step);
  if (next >= load) next = kg(load - step);
  return next > 0 ? next : null;
}

/**
 * The recommendation for the next session of one exercise. `sets` are last
 * time's sets with the recommended weight and repetitions; any other field
 * of a set (such as its side) is kept as it was.
 */
export function recommendProgression<S extends ProgressionSet>(
  input: ProgressionInput<S>,
): ProgressionResult<S> {
  const sessions = input.sessions
    .slice(0, PROGRESSION_HISTORY)
    .filter((s) => s.sets.length > 0);
  const last = sessions[0];
  if (!last) return { status: "not_available", reason: "no_history" };

  // A fixed number (10) is a range of one; a range needs a positive top.
  const bottom = input.rep_min ?? input.rep_max;
  const top = input.rep_max ?? input.rep_min;
  if (!bottom || !top || bottom > top)
    return { status: "not_available", reason: "no_rep_range" };

  const weighted = hasWeight(input.load_basis);
  if (
    weighted &&
    last.sets.some((s) => s.load_kg === null || !Number.isFinite(s.load_kg))
  )
    return { status: "not_available", reason: "load_unknown" };
  if (weighted && !(input.step_kg > 0))
    return { status: "not_available", reason: "load_unknown" };

  const stalled = stalledSessions(sessions);
  const base = {
    version: PROGRESSION_VERSION,
    rep_min: bottom,
    rep_max: top,
    last_date: last.date,
    last_sets: last.sets.map((s) => ({ reps: s.reps, load_kg: s.load_kg })),
    stalled_sessions: stalled,
  } as const;
  const recommend = (
    decision: ProgressionDecision,
    reason: ProgressionReason,
    change: number,
    sets: S[],
  ): ProgressionResult<S> => ({
    status: "recommended",
    progression: ProgressionSchema.parse({
      ...base,
      decision,
      reason,
      change_kg: kg(change),
    }),
    sets,
  });
  const moreReps = (reason: ProgressionReason) =>
    recommend(
      "more_reps",
      reason,
      0,
      last.sets.map((s) => ({ ...s, reps: Math.min(s.reps + 1, top) })),
    );

  // Not reaching the range twice, or no progress for a while: lighter, and
  // work back up. Only where there is a weight to take off.
  const missedTwice =
    sessions.length >= MISSED_SESSIONS &&
    sessions.slice(0, MISSED_SESSIONS).every((s) => missed(s, bottom));
  if (weighted && (missedTwice || stalled >= STALL_SESSIONS)) {
    const reason = missedTwice ? "missed_range" : "stalled";
    const lighter = last.sets.map((s) => deloadLoad(s.load_kg!, input.step_kg));
    if (lighter.every((l) => l !== null))
      return recommend(
        "reduce",
        reason,
        lighter[0]! - last.sets[0].load_kg!,
        last.sets.map((s, i) => ({ ...s, load_kg: lighter[i], reps: bottom })),
      );
    // Already at the lightest step: keep the weight and build repetitions.
    return moreReps("building_reps");
  }

  if (last.sets.every((s) => s.reps >= top)) {
    if (!weighted)
      return recommend(
        "top_reached",
        "all_sets_at_top",
        0,
        last.sets.map((s) => ({ ...s, reps: top })),
      );
    return recommend(
      "increase",
      "all_sets_at_top",
      input.step_kg,
      last.sets.map((s) => ({
        ...s,
        load_kg: kg(s.load_kg! + input.step_kg),
        reps: bottom,
      })),
    );
  }

  return moreReps("building_reps");
}

/**
 * The smallest weight step of an exercise, in its load basis: from the
 * equipment where it is known, else from the load basis. Deliberately the
 * step most gyms have, so a recommendation can always be put on the bar.
 */
export function weightStep(
  equipment: string,
  loadBasis: ArnoldLoadBasis,
): number {
  const e = equipment.toLowerCase();
  if (/kurzhantel|dumbbell/.test(e)) return 2;
  if (/kettlebell/.test(e)) return 4;
  if (/langhantel|barbell|sz-|ez-/.test(e)) return 2.5;
  if (/kabel|cable/.test(e)) return 2.5;
  if (/maschine|machine|gerät/.test(e)) return 5;
  if (loadBasis === "per_implement") return 2;
  if (loadBasis === "machine_display") return 5;
  return 2.5;
}
