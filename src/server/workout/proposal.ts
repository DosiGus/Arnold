import type {
  ArnoldDataset,
  ArnoldExercise,
  ArnoldPlanItem,
  ArnoldSet,
} from "../../shared/arnold-schema-v1.js";
import type {
  ProposedExercise,
  ProposedSet,
  SessionProposal,
  SetConventions,
} from "../../shared/workout-contract.js";

/**
 * What "so gemacht" saves for a plan session: per exercise the working sets of
 * the last completed workout with that exercise, else the plan's own targets.
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

/** The working sets of the newest completed workout that has this exercise. */
export function lastTime(
  data: Data,
  exerciseId: string,
  options: { before?: string; excludeWorkoutId?: string } = {},
): { date: string; sets: ArnoldSet[] } | undefined {
  for (const workout of completedNewestFirst(data, options.before)) {
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
    if (sets.length) return { date: workout.workout_date_local, sets };
  }
  return undefined;
}

const bodyweight = (c: SetConventions) => c.load_basis === "bodyweight_only";

/**
 * One exercise of the proposal. With history the last sets are copied (with
 * their own conventions); otherwise the plan target is expanded into sets.
 */
export function proposeExercise(
  data: Data,
  exercise: ArnoldExercise,
  item: ArnoldPlanItem | undefined,
  options: { before?: string; excludeWorkoutId?: string } = {},
): ProposedExercise {
  const last = lastTime(data, exercise.exercise_id, options);
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
    return {
      ...base,
      conventions,
      sets: last.sets.map((s) => ({
        reps: s.reps,
        load_kg: bodyweight(conventions) ? null : s.load_kg,
        side: s.side,
      })),
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
  options: { before?: string; excludeWorkoutId?: string } = {},
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
