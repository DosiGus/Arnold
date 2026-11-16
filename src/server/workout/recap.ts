/**
 * Rückblick for the overview: the engine's selection (`src/analytics/recap.ts`)
 * plus the "seen" receipt (UX-006).
 *
 * The recap is shown only when there is a real new workout and its receipt
 * does not exist. If the receipt cannot be read, nothing is shown: once too
 * little beats showing it every time.
 */
import { computeRecap } from "../../analytics/recap.js";
import type { ArnoldDashboardView } from "../../shared/arnold-view.js";
import type { ArnoldDataset } from "../../shared/arnold-schema-v1.js";
import type { ArnoldRecap } from "../../shared/recap-contract.js";
import { proposeActivePlan } from "./proposal.js";
import type { WorkoutLoggingService } from "./service.js";

export async function recapFor(
  dataset: ArnoldDataset,
  view: ArnoldDashboardView,
  referenceDate: string,
  logging: Pick<WorkoutLoggingService, "isRecapSeen"> | undefined,
): Promise<ArnoldRecap | null> {
  if (!logging || view.state !== "ready") return null;
  const core = computeRecap(
    dataset,
    view.home,
    proposeActivePlan(dataset),
    referenceDate,
  );
  if (!core) return null;
  const summary = view.recent_workouts.find(
    (w) => w.workout_id === core.workout_id,
  );
  if (!summary) return null;
  try {
    if (await logging.isRecapSeen(core.workout_id)) return null;
  } catch {
    return null;
  }
  return {
    ...core,
    title: summary.title,
    from_watch: summary.from_watch,
    exercise_count: summary.exercise_count,
    working_set_count: summary.working_set_count,
  };
}

/** The view with its recap; the recap never makes the overview fail. */
export async function withRecap(
  dataset: ArnoldDataset,
  view: ArnoldDashboardView,
  referenceDate: string,
  logging: Pick<WorkoutLoggingService, "isRecapSeen"> | undefined,
): Promise<ArnoldDashboardView> {
  try {
    return {
      ...view,
      recap: await recapFor(dataset, view, referenceDate, logging),
    };
  } catch {
    return { ...view, recap: null };
  }
}
