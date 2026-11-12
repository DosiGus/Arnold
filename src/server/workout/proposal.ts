import { isStrengthWorkout } from "../../shared/arnold-schema-v1.js";
import type {
  ArnoldDataset,
  ArnoldExercise,
  ArnoldPlanItem,
  ArnoldSet,
} from "../../shared/arnold-schema-v1.js";
import {
  PROGRESSION_HISTORY,
  recommendProgression,
  weightStep,
} from "../../analytics/progression.js";
import type {
  ProposedExercise,
  ProposedSet,
  SessionProposal,
  SetConventions,
} from "../../shared/workout-contract.js";

/**
 * What "so gemacht" saves for a plan session, per exercise:
 *
 *   1. Arnold's recommendation (src/analytics/progression.ts) built on the
 *      working sets of the last completed workouts with that exercise, when
 *      the plan gives a repetition range;
 *   2. else last time's working sets as they were;
 *   3. else the plan's own targets.
 *
 * Nothing is guessed: a missing weight or repetition count stays missing and
 * the exercise is marked, so the user (or the chat) fills it in first.
 *
 * The card shows exactly this, and `log_workout` builds its sets from the same
 * function, so what the user saw is what is saved.
 */

type Data = Pick<
  ArnoldDataset,
  "workouts" | "sets" | "exercises" | "planItems"
>;

export interface ProposalOptions {
  /** Only workouts on or before this calendar day. */
  before?: string;
  /** Leave out this workout, the one being replaced. */
  excludeWorkoutId?: string;
  /** false: last time's values as they were, without a recommendation. */
  progression?: boolean;
}

/** The conventions of a set come from the plan item, else from the exercise. */
export function conventionsFor(
  exercise: ArnoldExercise,
  item?: ArnoldPlanItem,
): SetConventions {
  const execution_mode =
    item?.target_execution_mode ?? exercise.default_execution_mode;
  return {
    load_basis: item?.target_load_basis ?? exercise.default_load_basis,
    execution_mode,
    implement_count:
      item?.target_implement_count ?? exercise.default_implement_count,
    reps_basis: execution_mode === "unilateral" ? "per_side" : "total",
  };
}

/** Sides one planned set is logged as. */
export function sidesFor(
  execution: SetConventions["execution_mode"],
): ArnoldSet["side"][] {
  if (execution === "unilateral") return ["left", "right"];
  if (execution === "alternating") return ["alternating"];
  return ["both"];
}

/** Completed workouts, newest first; the same day falls back to creation. */
function completedNewestFirst(data: Data, before?: string) {
  return data.workouts
    .filter(
      (w) =>
        w.status === "completed" &&
        isStrengthWorkout(w) &&
        (before === undefined || w.workout_date_local <= before),
    )
    .sort(
      (a, b) =>
        b.workout_date_local.localeCompare(a.workout_date_local) ||
        (b.ended_at_utc ?? b.created_at_utc).localeCompare(
          a.ended_at_utc ?? a.created_at_utc,
        ),
    );
}

/**
 * The working sets of the newest completed workouts that have this exercise,
 * newest first, at most `limit` of them.
 */
export function pastSessions(
  data: Data,
  exerciseId: string,
  options: ProposalOptions = {},
  limit = 1,
): { date: string; sets: ArnoldSet[] }[] {
  const found: { date: string; sets: ArnoldSet[] }[] = [];
  for (const workout of completedNewestFirst(data, options.before)) {
    if (found.length >= limit) break;
    if (workout.workout_id === options.excludeWorkoutId) continue;
    const sets = data.sets
      .filter(
        (s) =>
          s.workout_id === workout.workout_id &&
          s.exercise_id === exerciseId &&
          s.status === "active" &&
          s.set_type === "working",
      )
      .sort((a, b) => a.set_number - b.set_number);
    if (sets.length) found.push({ date: workout.workout_date_local, sets });
  }
  return found;
}

/** Same load basis, execution and implements: the sets measure the same thing. */
const sameMeasure = (a: ArnoldSet, b: ArnoldSet) =>
  a.load_basis === b.load_basis &&
  a.execution_mode === b.execution_mode &&
  a.implement_count === b.implement_count &&
  a.reps_basis === b.reps_basis;

const bodyweight = (c: SetConventions) => c.load_basis === "bodyweight_only";

/**
 * One exercise of the proposal. With history the last sets are copied (with
 * their own conventions); otherwise the plan target is expanded into sets.
 */
export function proposeExercise(
  data: Data,
  exercise: ArnoldExercise,
  item: ArnoldPlanItem | undefined,
  options: ProposalOptions = {},
): ProposedExercise {
  const history = pastSessions(
    data,
    exercise.exercise_id,
    options,
    PROGRESSION_HISTORY,
  );
  const last = history[0];
  const base = {
    plan_item_id: item?.plan_item_id ?? null,
    exercise_id: exercise.exercise_id,
    exercise_name: exercise.name_de,
    target_sets: item?.target_sets ?? null,
    rep_min: item?.rep_min ?? null,
    rep_max: item?.rep_max ?? null,
  };
  if (last) {
    const first = last.sets[0];
    const conventions: SetConventions = {
      load_basis: first.load_basis,
      execution_mode: first.execution_mode,
      implement_count: first.implement_count,
      reps_basis: first.reps_basis,
    };
    const lastSets: ProposedSet[] = last.sets.map((s) => ({
      reps: s.reps,
      load_kg: bodyweight(conventions) ? null : s.load_kg,
      side: s.side,
    }));
    // Only sessions measured like the last one: a switch from dumbbells to
    // the barbell, or from both sides to one, starts the history anew.
    const comparable: { date: string; sets: ProposedSet[] }[] = [];
    for (const session of history) {
      if (!session.sets.every((s) => sameMeasure(s, first))) break;
      comparable.push({
        date: session.date,
        sets: session.sets.map((s) => ({
          reps: s.reps,
          load_kg: bodyweight(conventions) ? null : s.load_kg,
          side: s.side,
        })),
      });
    }
    // The first session is the last one, so it always holds lastSets' values.
    const next =
      item && options.progression !== false
        ? recommendProgression({
            sessions: comparable,
            load_basis: conventions.load_basis,
            rep_min: item.rep_min,
            rep_max: item.rep_max,
            step_kg: weightStep(exercise.equipment, conventions.load_basis),
          })
        : undefined;
    if (next?.status === "recommended")
      return {
        ...base,
        conventions,
        sets: next.sets,
        source: "progression",
        last_date: last.date,
        progression: next.progression,
        missing: [],
      };
    return {
      ...base,
      conventions,
      sets: lastSets,
      source: "last_time",
      last_date: last.date,
      missing: [],
    };
  }
  const conventions = conventionsFor(exercise, item);
  const reps = item?.rep_max ?? item?.rep_min ?? null;
  const count = item?.target_sets ?? null;
  const load = bodyweight(conventions) ? null : (item?.target_load_kg ?? null);
  const missing: ProposedExercise["missing"] = [];
  if (count === null) missing.push("sets");
  if (reps === null) missing.push("reps");
  if (!bodyweight(conventions) && load === null) missing.push("load");
  const sets: ProposedSet[] = [];
  for (let n = 0; n < (count ?? 0); n++)
    for (const side of sidesFor(conventions.execution_mode))
      sets.push({ reps: reps ?? 0, load_kg: load, side });
  return {
    ...base,
    conventions,
    sets,
    source: "plan",
    last_date: null,
    missing,
  };
}

/** The active plan items of one session, in plan order. */
export function sessionItems(
  data: Pick<ArnoldDataset, "planItems">,
  planVersionId: string,
  sessionId: string,
) {
  return data.planItems
    .filter(
      (i) =>
        i.plan_version_id === planVersionId &&
        i.session_id === sessionId &&
        i.status === "active",
    )
    .sort((a, b) => a.exercise_order - b.exercise_order);
}

/** The proposal for one session of a plan version. */
export function proposeSession(
  data: Data,
  planVersionId: string,
  sessionId: string,
  options: ProposalOptions = {},
): SessionProposal | undefined {
  const items = sessionItems(data, planVersionId, sessionId);
  if (!items.length) return undefined;
  const exercises = new Map(data.exercises.map((e) => [e.exercise_id, e]));
  return {
    plan_version_id: planVersionId,
    session_id: sessionId,
    session_name: items[0].session_name,
    session_order: items[0].session_order,
    exercises: items.flatMap((item) => {
      const exercise = exercises.get(item.exercise_id);
      return exercise ? [proposeExercise(data, exercise, item, options)] : [];
    }),
  };
}

/** Proposals for every session of the active plan, in session order. */
export function proposeActivePlan(
  data: Pick<
    ArnoldDataset,
    "workouts" | "sets" | "exercises" | "planItems" | "plans"
  >,
  before?: string,
): SessionProposal[] {
  const active = data.plans.find((p) => p.status === "active");
  if (!active) return [];
  const sessions = [
    ...new Map(
      data.planItems
        .filter(
          (i) =>
            i.plan_version_id === active.plan_version_id &&
            i.status === "active",
        )
        .map((i) => [i.session_id, i.session_order] as const),
    ),
  ].sort((a, b) => a[1] - b[1]);
  return sessions.flatMap(([sessionId]) => {
    const proposal = proposeSession(data, active.plan_version_id, sessionId, {
      before,
    });
    return proposal ? [proposal] : [];
  });
}
