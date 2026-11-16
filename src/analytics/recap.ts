/**
 * Rückblick nach dem Training: which workout is "the new one", and what is
 * worth saying about it (UX-006).
 *
 * Pure, reads only. Nothing is calculated that the engine does not already
 * deliver: records come from `HomeAnalytics`, the suggestion from the
 * progression the server put into its proposals, the weekly goal from the
 * streak. This module only selects. Whether the user has seen the recap is
 * not known here (it is a stored receipt, see `src/server/workout/recap.ts`).
 */
import {
  isStrengthWorkout,
  type ArnoldDataset,
} from "../shared/arnold-schema-v1.js";
import type { SessionProposal } from "../shared/workout-contract.js";
import type { ArnoldRecap } from "../shared/recap-contract.js";
import type { HomeAnalytics } from "./home.js";
import { addDays, compareDate, weekStart } from "./period.js";

/** A workout older than this is not "new" any more. */
export const RECAP_MAX_AGE_DAYS = 7;
const MAX_RECORDS = 3;

/** What the engine knows about the new workout; the presenter adds its title and counts. */
export type RecapCore = Pick<
  ArnoldRecap,
  | "workout_id"
  | "date"
  | "records"
  | "week_goal"
  | "suggestion"
  | "next_session_id"
>;

/** The most recent completed strength workout, if it is recent enough. */
export function newestWorkout(
  dataset: Pick<ArnoldDataset, "workouts">,
  referenceDate: string | null,
  maxAgeDays = RECAP_MAX_AGE_DAYS,
) {
  if (referenceDate === null) return null;
  const oldest = addDays(referenceDate, -maxAgeDays);
  const latest = dataset.workouts
    .filter(
      (w) =>
        w.status === "completed" &&
        isStrengthWorkout(w) &&
        compareDate(w.workout_date_local, referenceDate) <= 0 &&
        compareDate(w.workout_date_local, oldest) >= 0,
    )
    .sort(
      (a, b) =>
        compareDate(a.workout_date_local, b.workout_date_local) ||
        (a.created_at_utc < b.created_at_utc ? -1 : 1) ||
        (a.workout_id < b.workout_id ? -1 : 1),
    )
    .at(-1);
  return latest ?? null;
}

const DECISION_RANK = { increase: 0, reduce: 1, more_reps: 2 } as const;

export function computeRecap(
  dataset: Pick<ArnoldDataset, "workouts" | "sets" | "exercises">,
  home: Pick<HomeAnalytics, "records" | "streak" | "next_session">,
  proposals: readonly SessionProposal[],
  referenceDate: string | null,
): RecapCore | null {
  const workout = newestWorkout(dataset, referenceDate);
  if (!workout) return null;
  const name = (exerciseId: string) =>
    dataset.exercises.find((e) => e.exercise_id === exerciseId)?.name_de;

  const records: ArnoldRecap["records"] = [];
  for (const r of home.records) {
    if (r.workout_id !== workout.workout_id) continue;
    const exercise_name = name(r.exercise_id);
    if (!exercise_name) continue;
    records.push({
      exercise_id: r.exercise_id,
      exercise_name,
      metric: r.metric,
      value: r.value,
      previous_value: r.previous_value,
      load_kg: r.load_kg,
      reps: r.reps,
      load_basis: r.load_basis,
    });
  }

  // The goal counts as reached by this workout when the week met it with it
  // and would not have without it.
  const week = home.streak.weeks.find(
    (w) => w.week_start === weekStart(workout.workout_date_local),
  );
  const goal = home.streak.weekly_goal;
  let week_goal: RecapCore["week_goal"] = null;
  if (goal !== null && week?.goal_met) {
    const sameDayOther = dataset.workouts.some(
      (w) =>
        w.workout_id !== workout.workout_id &&
        w.status === "completed" &&
        isStrengthWorkout(w) &&
        w.workout_date_local === workout.workout_date_local,
    );
    const before = week.training_days - (sameDayOther ? 0 : 1);
    if (before < goal) week_goal = { goal, training_days: week.training_days };
  }

  const trained = new Set(
    dataset.sets
      .filter(
        (s) =>
          s.workout_id === workout.workout_id &&
          s.status === "active" &&
          s.set_type === "working",
      )
      .map((s) => s.exercise_id),
  );
  let suggestion: RecapCore["suggestion"] = null;
  let next_session_id: string | null = null;
  let best = Infinity;
  for (const proposal of proposals)
    for (const exercise of proposal.exercises) {
      const p = exercise.progression;
      if (
        exercise.source !== "progression" ||
        !p ||
        p.decision === "top_reached" ||
        !trained.has(exercise.exercise_id) ||
        !exercise.sets.length ||
        !p.last_sets.length
      )
        continue;
      const rank = DECISION_RANK[p.decision];
      if (rank >= best) continue;
      best = rank;
      next_session_id = proposal.session_id;
      suggestion = {
        exercise_id: exercise.exercise_id,
        exercise_name: exercise.exercise_name,
        decision: p.decision,
        load_basis: exercise.conventions.load_basis,
        next_load_kg: exercise.sets[0].load_kg,
        last_load_kg: p.last_sets[0].load_kg,
        next_reps: exercise.sets[0].reps,
        last_reps: p.last_sets[0].reps,
      };
    }

  return {
    workout_id: workout.workout_id,
    date: workout.workout_date_local,
    records: records.slice(0, MAX_RECORDS),
    week_goal,
    suggestion,
    next_session_id,
  };
}
