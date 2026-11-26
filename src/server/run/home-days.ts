/**
 * The planned and completed runs of one user as the start screen reads them
 * (src/analytics/home.ts). Rows turned into plain facts: nothing is computed
 * here beyond the prescription totals the run views already own.
 */
import { RUN_TYPE_NAMES } from "../../analytics/running/catalog.js";
import type { HomeRunDay, HomeRunInputs } from "../../analytics/home.js";
import {
  isRunWorkout,
  type ArnoldDataset,
} from "../../shared/arnold-schema-v1.js";
import { plannedTotals } from "./views.js";
import { activeRunPlan } from "./week.js";

/** A dataset reduced to strength training carries its runs here. */
export type DatasetWithHomeRuns = ArnoldDataset &
  Readonly<{ homeRuns?: HomeRunInputs }>;

/** Reads the complete dataset (the plan that applies now). */
export function homeRunsOf(data: ArnoldDataset): HomeRunInputs {
  const rows = new Map((data.runs ?? []).map((r) => [r.workout_id, r]));
  const runs: HomeRunDay[] = [];
  for (const workout of data.workouts) {
    const { status } = workout;
    if (
      !isRunWorkout(workout) ||
      (status !== "planned" && status !== "completed")
    )
      continue;
    const run = rows.get(workout.workout_id);
    if (!run) continue;
    const totals = run.prescription ? plannedTotals(run.prescription) : null;
    const done = status === "completed";
    runs.push({
      workout_id: workout.workout_id,
      date: workout.workout_date_local,
      status,
      name:
        workout.session_name_snapshot?.trim() ||
        run.prescription?.n ||
        RUN_TYPE_NAMES[run.run_type],
      planned_seconds: totals?.total_s ?? null,
      planned_distance_m: totals?.distance_m ?? null,
      timer_s: done ? run.timer_s : null,
      distance_m: done ? run.distance_m : null,
    });
  }
  return { has_run_plan: activeRunPlan(data) !== null, runs };
}
