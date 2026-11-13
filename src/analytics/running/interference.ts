import type { RunType } from "../../shared/run-contract.js";
import { HARD_RUN_TYPES } from "../../shared/run-contract.js";
import { addDays, compareDate } from "../period.js";
import {
  day,
  dayLabel,
  type TrainingFocus,
  type WeekNote,
} from "./week-context.js";

/**
 * Strength and running together (ARN-RUN, spec "Kraft und Laufen zusammen"):
 * which strength days are heavy leg days, and the hints for runs around them.
 * A violation is a hint with a reason, never a block. Pure: no I/O.
 */

/** Working sets for the legs from which a strength session is a heavy leg day. */
export const HEAVY_LEG_MIN_WORKING_SETS = 6;
/** Hours between a hard run and leg training on the same day, at least. */
export const SAME_DAY_GAP_HOURS = 6;

/**
 * Primary muscles that count as legs (spec: Beine, Gesäß, Oberschenkel). The
 * exercise catalog stores `legs` and `glutes`; user exercises may carry the
 * German or a more specific name. Calves alone do not make a heavy leg day.
 */
export const LEG_MUSCLES: ReadonlySet<string> = new Set([
  "legs",
  "leg",
  "glutes",
  "glute",
  "quads",
  "quadriceps",
  "hamstrings",
  "thighs",
  "beine",
  "bein",
  "gesäß",
  "gesaess",
  "po",
  "oberschenkel",
  "beinstrecker",
  "beinbeuger",
]);

export const isLegMuscle = (muscle: string | null | undefined) =>
  muscle !== null &&
  muscle !== undefined &&
  LEG_MUSCLES.has(muscle.trim().toLowerCase());

/** One strength day: done (from the dataset) or planned. */
export interface StrengthDay {
  readonly date: string;
  /** Working sets for the legs; null = unknown. */
  readonly leg_sets: number | null;
  /** True from six leg sets on; null = unknown (treated with caution). */
  readonly heavy_legs: boolean | null;
  readonly planned: boolean;
}

/** The dataset fields this module reads (a validated `ArnoldDataset` fits). */
export interface StrengthDataInput {
  readonly workouts: readonly {
    readonly workout_id: string;
    readonly workout_date_local: string;
    readonly status: string;
    readonly activity_type?: string | null;
  }[];
  readonly sets: readonly {
    readonly workout_id: string;
    readonly exercise_id: string | null;
    readonly set_type: string;
  }[];
  readonly exercises: readonly {
    readonly exercise_id: string;
    readonly primary_muscle: string | null;
  }[];
}

const heavy = (sets: number | null) =>
  sets === null ? null : sets >= HEAVY_LEG_MIN_WORKING_SETS;

/**
 * Strength days from the stored training: completed strength workouts, one
 * entry per calendar day (`workout_date_local`), leg working sets summed over
 * the sessions of that day. Warm-up sets do not count. A set whose exercise
 * is unknown makes the count a lower bound; if that could decide a heavy leg
 * day, the day is unknown.
 */
export function strengthDays(data: StrengthDataInput): StrengthDay[] {
  const muscles = new Map(
    data.exercises.map((e) => [e.exercise_id, e.primary_muscle]),
  );
  const workouts = new Map(
    data.workouts
      .filter(
        (w) =>
          (w.activity_type ?? "strength") === "strength" &&
          w.status === "completed",
      )
      .map((w) => [w.workout_id, day(w.workout_date_local)]),
  );
  const byDate = new Map<string, { legs: number; unknown: number }>();
  for (const date of workouts.values())
    if (!byDate.has(date)) byDate.set(date, { legs: 0, unknown: 0 });
  for (const set of data.sets) {
    const date = workouts.get(set.workout_id);
    if (date === undefined || set.set_type === "warmup") continue;
    const entry = byDate.get(date)!;
    const muscle =
      set.exercise_id === null ? undefined : muscles.get(set.exercise_id);
    if (muscle === undefined) entry.unknown += 1;
    else if (isLegMuscle(muscle)) entry.legs += 1;
  }
  return [...byDate]
    .sort(([a], [b]) => compareDate(a, b))
    .map(([date, { legs, unknown }]) => {
      const decided =
        legs >= HEAVY_LEG_MIN_WORKING_SETS ||
        legs + unknown < HEAVY_LEG_MIN_WORKING_SETS;
      return {
        date,
        leg_sets: unknown === 0 ? legs : null,
        heavy_legs: decided ? legs >= HEAVY_LEG_MIN_WORKING_SETS : null,
        planned: false,
      };
    });
}

/**
 * A planned strength day from plan items (target sets and primary muscle of
 * each exercise). A leg item without target sets makes the day unknown unless
 * the known sets already reach the threshold.
 */
export function plannedStrengthDay(
  date: string,
  items: readonly {
    readonly target_sets: number | null;
    readonly primary_muscle: string | null;
  }[],
): StrengthDay {
  let legs = 0;
  let unknown = false;
  for (const item of items) {
    if (!isLegMuscle(item.primary_muscle)) continue;
    if (item.target_sets === null) unknown = true;
    else legs += item.target_sets;
  }
  const decided = legs >= HEAVY_LEG_MIN_WORKING_SETS || !unknown;
  return {
    date: day(date),
    leg_sets: unknown ? null : legs,
    heavy_legs: decided ? heavy(legs) : null,
    planned: true,
  };
}

/** Leg load of a day: true heavy, null unknown, false light or no strength. */
export function legLoadOn(
  days: readonly StrengthDay[],
  date: string,
): { strength: boolean; heavy: boolean | null } {
  const mine = days.filter((d) => d.date === date);
  if (mine.length === 0) return { strength: false, heavy: false };
  if (mine.some((d) => d.heavy_legs === true))
    return { strength: true, heavy: true };
  if (mine.some((d) => d.heavy_legs === null))
    return { strength: true, heavy: null };
  // Two sessions on one day: their leg sets add up.
  const sum = mine.reduce((total, d) => total + (d.leg_sets ?? 0), 0);
  return { strength: true, heavy: sum >= HEAVY_LEG_MIN_WORKING_SETS };
}

export const isHardRun = (type: RunType) => HARD_RUN_TYPES.includes(type);

/**
 * Interference of one run on `date` with the strength days around it. The
 * day-after rule is a week rule (checked in `checkRunWeek`); this returns
 * the hints for the run: same day as a heavy leg day (gap and order by the
 * main goal), unknown leg load the day before, an easy run on a leg day.
 */
export function runInterference(
  run: {
    readonly date: string;
    readonly run_type: RunType;
    readonly session_id?: string | null;
  },
  days: readonly StrengthDay[],
  focus: TrainingFocus,
): WeekNote[] {
  const notes: WeekNote[] = [];
  const date = day(run.date);
  const same = legLoadOn(days, date);
  const before = legLoadOn(days, addDays(date, -1));
  const hard = isHardRun(run.run_type);
  const ref = run.session_id ? { session_id: run.session_id } : {};
  if (hard && same.strength && same.heavy !== false)
    notes.push({
      code: "hard_on_leg_day",
      date,
      ...ref,
      text:
        `${dayLabel(date)}: harter Lauf und Beintraining am selben Tag. Mindestens ${SAME_DAY_GAP_HOURS} Stunden Abstand; ` +
        (focus === "running"
          ? "Laufziel: zuerst laufen, dann Kraft."
          : "Kraftziel: zuerst Kraft, dann laufen."),
    });
  if (hard && before.strength && before.heavy === null)
    notes.push({
      code: "unknown_leg_load",
      date,
      ...ref,
      text: `${dayLabel(date)}: Die Beinbelastung vom Vortag ist unbekannt. War es ein schwerer Beintag, lauf heute locker statt hart.`,
    });
  if (!hard && same.strength && same.heavy !== false)
    notes.push({
      code: "easy_on_leg_day",
      date,
      ...ref,
      text: `${dayLabel(date)}: Lockerer Lauf am Beintag ist in Ordnung, am besten nach dem Krafttraining.`,
    });
  return notes;
}
