/**
 * What the plan proposal card shows besides the plan itself: weekly sets per
 * muscle group with the range that fits the experience, and an example week.
 * Pure, no I/O. The card only draws these numbers; it never counts itself.
 *
 * Sets are counted as direct working sets of the exercise's primary muscle
 * group, which is what the card says ("Direkte Arbeitssätze pro
 * Muskelgruppe"). An exercise without a set count or a muscle group is
 * reported, never counted as 0.
 *
 * The ranges are the table "Wochensätze pro Muskelgruppe" in
 * `trainingswissenschaft.md` (both skills, kept equal; a test compares the
 * table with these numbers).
 */

export const PLAN_INSIGHTS_VERSION = "1.0.0";

export type InsightExperience = "beginner" | "intermediate" | "advanced";

/** Weekly direct sets per muscle group that fit the experience. */
export const WEEKLY_SET_RANGES: Readonly<
  Record<InsightExperience, { readonly min: number; readonly max: number }>
> = {
  beginner: { min: 6, max: 10 },
  intermediate: { min: 10, max: 16 },
  advanced: { min: 12, max: 20 },
};

/** Groups always listed, even without sets, so a gap is visible. */
export const MAIN_MUSCLE_GROUPS = ["chest", "back", "shoulders", "legs"];

export interface InsightExercise {
  readonly exercise_id: string;
  readonly target_sets: number | null;
}
export interface InsightSession {
  readonly session_id: string;
  readonly exercises: readonly InsightExercise[];
}
export interface InsightRun {
  /** ISO weekday, 1 = Monday; null = no preference. */
  readonly preferred_weekday: number | null;
}
export interface InsightMobility {
  readonly kind: "morning" | "session";
  readonly placement: "own_day" | "after_strength";
  readonly weekdays: readonly number[];
  readonly after_session_id: string | null;
}

export interface PlanInsightsInput {
  readonly sessions: readonly InsightSession[];
  readonly runs: readonly InsightRun[];
  readonly mobility: readonly InsightMobility[];
  /** exercise_id → muscle group key, or null when unknown. */
  readonly muscleOf: (exerciseId: string) => string | null;
  readonly groups: readonly string[];
  readonly experience: InsightExperience | null;
  /** Fixed strength weekdays the user chose (1–7), if any. */
  readonly trainingDays: readonly number[];
}

export type WeekKind = "strength" | "run" | "mobility";

export interface PlanInsights {
  readonly version: typeof PLAN_INSIGHTS_VERSION;
  readonly weekly_sets: readonly {
    readonly muscle_group: string;
    readonly sets: number;
    /** Null when the experience is unknown: no range is claimed then. */
    readonly min: number | null;
    readonly max: number | null;
  }[];
  /** Exercises whose sets are not counted (no set count or no muscle group). */
  readonly uncounted_exercise_ids: readonly string[];
  /** Seven days, Monday first. */
  readonly week: readonly {
    readonly weekday: number;
    readonly kinds: WeekKind[];
  }[];
  readonly morning_weekdays: readonly number[];
}

/** Strength days for n sessions, spread so that rest days fall between. */
const SPREAD: readonly (readonly number[])[] = [
  [],
  [1],
  [1, 4],
  [1, 3, 5],
  [1, 2, 4, 5],
  [1, 2, 4, 5, 6],
  [1, 2, 3, 4, 5, 6],
  [1, 2, 3, 4, 5, 6, 7],
];

export function buildPlanInsights(input: PlanInsightsInput): PlanInsights {
  // ------------------------------------------------------------ weekly sets
  const sets = new Map<string, number>();
  const uncounted: string[] = [];
  for (const session of input.sessions)
    for (const exercise of session.exercises) {
      const group = input.muscleOf(exercise.exercise_id);
      if (group === null || exercise.target_sets === null) {
        uncounted.push(exercise.exercise_id);
        continue;
      }
      sets.set(group, (sets.get(group) ?? 0) + exercise.target_sets);
    }
  const range = input.experience ? WEEKLY_SET_RANGES[input.experience] : null;
  const weekly_sets = input.groups
    .filter(
      (group) =>
        (sets.get(group) ?? 0) > 0 ||
        (input.sessions.length > 0 && MAIN_MUSCLE_GROUPS.includes(group)),
    )
    .map((group) => ({
      muscle_group: group,
      sets: sets.get(group) ?? 0,
      min: range?.min ?? null,
      max: range?.max ?? null,
    }))
    .sort((a, b) => b.sets - a.sets);

  // ----------------------------------------------------------- example week
  const days: WeekKind[][] = Array.from({ length: 7 }, () => []);
  const strength = input.sessions.length;
  const fixed =
    input.trainingDays.length === strength && strength > 0
      ? [...input.trainingDays].sort((a, b) => a - b)
      : null;
  const strengthDays = fixed ?? SPREAD[Math.min(strength, 7)]!.slice();
  // More than seven sessions wrap around the week.
  for (let i = 0; i < strength; i++)
    days[(strengthDays[i % strengthDays.length]! - 1) % 7]!.push("strength");
  const sessionDay = new Map(
    input.sessions.map((s, i) => [
      s.session_id,
      strengthDays[i % strengthDays.length]!,
    ]),
  );

  /** A free day, preferring one away from strength days. */
  const freeDay = (): number => {
    const score = (d: number) =>
      days[d - 1]!.length * 10 +
      (days[(d + 5) % 7]!.includes("strength") ? 1 : 0) +
      (days[d % 7]!.includes("strength") ? 1 : 0);
    let best = 1;
    for (let d = 2; d <= 7; d++) if (score(d) < score(best)) best = d;
    return best;
  };

  for (const run of input.runs)
    days[(run.preferred_weekday ?? freeDay()) - 1]!.push("run");

  const morning = new Set<number>();
  for (const routine of input.mobility) {
    if (routine.kind === "morning") {
      for (const day of routine.weekdays) morning.add(day);
      continue;
    }
    const after =
      routine.placement === "after_strength" && routine.after_session_id
        ? sessionDay.get(routine.after_session_id)
        : undefined;
    const day = after ?? routine.weekdays[0] ?? freeDay();
    days[day - 1]!.push("mobility");
  }

  return {
    version: PLAN_INSIGHTS_VERSION,
    weekly_sets,
    uncounted_exercise_ids: uncounted,
    week: days.map((kinds, i) => ({ weekday: i + 1, kinds })),
    morning_weekdays: [...morning].sort((a, b) => a - b),
  };
}
