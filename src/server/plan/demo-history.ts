/**
 * Nine weeks of invented training history on top of the plan fixture.
 *
 * Only for the synthetic profile (local preview, the ChatGPT fixture test): a
 * start screen with a streak, records and goals needs more than two workouts
 * to show anything. Everything here is made up and generated relative to the
 * day the server starts, so the screen always looks current. Never used with
 * a database.
 */
import {
  ArnoldDatasetSchema,
  type ArnoldBodyWeight,
  type ArnoldDataset,
  type ArnoldGoal,
  type ArnoldSet,
  type ArnoldWorkout,
} from "../../shared/arnold-schema-v1.js";
import { planFixtureDataset } from "./fixture.js";

const WEEKS = 9;
/** Monday-based offsets: legs on Monday, push on Tuesday, pull on Thursday. */
const DAY_OF_SESSION: Record<string, number> = {
  "pfx-s-legs": 0,
  "pfx-s-push": 1,
  "pfx-s-pull": 3,
};

function addDays(date: string, days: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function monday(date: string): string {
  const d = new Date(`${date}T12:00:00Z`);
  return addDays(date, -((d.getUTCDay() + 6) % 7));
}

const roundTo = (value: number, step: number) =>
  Math.round(value / step) * step;

export function demoHistoryDataset(today: string): ArnoldDataset {
  const base = planFixtureDataset("active_ppl");
  const plan = base.plans.find((p) => p.status === "active")!;
  const items = base.planItems.filter(
    (i) => i.plan_version_id === plan.plan_version_id && i.status === "active",
  );
  const exercises = new Map(base.exercises.map((e) => [e.exercise_id, e]));
  const workouts: ArnoldWorkout[] = [];
  const sets: ArnoldSet[] = [];
  const thisWeek = monday(today);

  for (let w = WEEKS - 1; w >= 0; w -= 1) {
    const week = addDays(thisWeek, -7 * w);
    const step = WEEKS - 1 - w; // 0 = oldest week
    for (const [session, offset] of Object.entries(DAY_OF_SESSION)) {
      const date = addDays(week, offset);
      if (date > today) continue;
      // One missed session early on, so the streak starts after it.
      if (step === 1 && session === "pfx-s-pull") continue;
      const sessionItems = items
        .filter((i) => i.session_id === session)
        .sort((a, b) => a.exercise_order - b.exercise_order);
      if (!sessionItems.length) continue;
      const workoutId = `demo-w-${date}-${session}`;
      const stamp = `${date}T17:00:00.000Z`;
      workouts.push({
        workout_id: workoutId,
        workout_date_local: date,
        timezone: "Europe/Berlin",
        started_at_utc: stamp,
        ended_at_utc: `${date}T18:00:00.000Z`,
        plan_version_id: plan.plan_version_id,
        session_id: session,
        session_name_snapshot: sessionItems[0].session_name,
        status: "completed",
        source: "chat",
        notes: null,
        created_at_utc: stamp,
        updated_at_utc: `${date}T18:00:00.000Z`,
        row_revision: 2,
      });
      for (const item of sessionItems) {
        const exercise = exercises.get(item.exercise_id)!;
        const basis = item.target_load_basis ?? exercise.default_load_basis;
        const mode =
          item.target_execution_mode ?? exercise.default_execution_mode;
        const implementCount =
          item.target_implement_count ?? exercise.default_implement_count;
        const target = item.target_load_kg;
        const load =
          basis === "bodyweight_only" || target === null
            ? basis === "bodyweight_only"
              ? null
              : 20
            : roundTo(
                target * (0.95 + 0.0375 * Math.floor(step / 2)),
                basis === "per_implement" ? 1 : 2.5,
              );
        const repMax = item.rep_max ?? 10;
        const repMin = item.rep_min ?? Math.max(1, repMax - 2);
        const reps =
          basis === "bodyweight_only"
            ? 4 + Math.floor(step / 2)
            : Math.min(
                repMax,
                repMin + (step % 2) + Math.floor(item.exercise_order / 3),
              );
        const sides =
          mode === "unilateral"
            ? (["left", "right"] as const)
            : ([mode === "alternating" ? "alternating" : "both"] as const);
        for (let n = 1; n <= (item.target_sets ?? 3); n += 1)
          for (const side of sides)
            sets.push({
              set_id: `demo-s-${date}-${item.plan_item_id}-${n}-${side}`,
              workout_id: workoutId,
              exercise_id: item.exercise_id,
              plan_item_id: item.plan_item_id,
              exercise_name_snapshot: exercise.name_de,
              exercise_order: item.exercise_order,
              set_number: n,
              set_type: "working",
              reps: n === 1 ? reps : Math.max(1, reps - (n - 1)),
              reps_basis: "total",
              load_kg: load,
              load_basis: basis,
              implement_count: implementCount,
              execution_mode: mode,
              side,
              rpe: null,
              rir: null,
              notes: null,
              status: "active",
              source: "chat",
              created_at_utc: stamp,
              updated_at_utc: stamp,
              row_revision: 1,
            });
      }
    }
  }

  const first = addDays(thisWeek, -7 * (WEEKS - 1));
  const created = `${first}T08:00:00.000Z`;
  const goal = (
    goal_id: string,
    kind: ArnoldGoal["kind"],
    exercise_id: string | null,
    load_basis: ArnoldGoal["load_basis"],
    target_value: number,
    start_value: number,
  ): ArnoldGoal => ({
    goal_id,
    kind,
    exercise_id,
    load_basis,
    target_value,
    start_value,
    status: "active",
    created_at_utc: created,
    updated_at_utc: created,
    row_revision: 1,
  });
  const bench = items.find((i) => i.exercise_id === "plan-fx-bench");
  const goals: ArnoldGoal[] = [
    goal("demo-goal-weight", "body_weight", null, null, 80, 88),
    ...(bench
      ? [
          goal(
            "demo-goal-bench",
            "exercise_load",
            "plan-fx-bench",
            "total",
            100,
            roundTo((bench.target_load_kg ?? 70) * 0.8, 2.5),
          ),
        ]
      : []),
    goal("demo-goal-pullup", "exercise_reps", "plan-fx-pullup", null, 10, 4),
  ];
  const bodyWeights: ArnoldBodyWeight[] = [];
  for (let w = 0; w < WEEKS; w += 1) {
    const date = addDays(first, 7 * w);
    if (date > today) break;
    bodyWeights.push({
      body_weight_id: `demo-bw-${date}`,
      measured_on: date,
      weight_kg: Math.round((88 - w * 0.45) * 10) / 10,
      status: "active",
      source: "chat",
      created_at_utc: `${date}T07:00:00.000Z`,
      updated_at_utc: `${date}T07:00:00.000Z`,
      row_revision: 1,
    });
  }

  return ArnoldDatasetSchema.parse({
    ...base,
    workouts: [...base.workouts, ...workouts],
    sets: [...base.sets, ...sets],
    goals,
    bodyWeights,
  });
}
