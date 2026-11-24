/**
 * The run details of the setup, handed to the run service as an ordinary
 * `update_run_profile` write once the setup is finished.
 *
 * Nothing here touches a table: the run service checks the caller, the
 * revision and the request id like for any other run profile write.
 */
import type { OnboardingRun } from "../../shared/onboarding-contract.js";
import type { RunService } from "../run/service.js";

/**
 * The run goal the run profile stores when the setup named none. Since
 * Onboarding 2.0 (D-01) the goal is optional, but the run profile keeps
 * one; "fitness" is the goal without a race distance, so nothing is
 * invented: no distance, no date, no target time.
 */
export const RUN_GOAL_WITHOUT_ANSWER = "fitness" as const;

/** The `update_run_profile` fields the setup answered; names are the run contract's. */
function wanted(run: OnboardingRun) {
  return {
    goal: run.goal ?? RUN_GOAL_WITHOUT_ANSWER,
    runs_per_week: run.runs_per_week,
    base_minutes_per_week: run.base_minutes_per_week,
    longest_run_4w_min: run.longest_run_4w_min,
    preferred_environment: run.preferred_environment,
    ...(run.race_date !== undefined ? { race_date: run.race_date } : {}),
    ...(run.target_time_s !== undefined
      ? { target_time_s: run.target_time_s }
      : {}),
    ...(run.reference !== undefined ? { reference: run.reference } : {}),
  };
}

/**
 * Writes the setup's run answers into the user's run profile: creates it, or
 * changes the existing one on its current revision. Repeating the call after
 * it went through does nothing (the stored profile already holds the values),
 * and a retry of an interrupted write uses the same request id.
 */
export async function recordSetupRunProfile(
  runs: Pick<RunService, "dataset" | "execute">,
  run: OnboardingRun,
  sessionId: string,
  context: unknown,
): Promise<void> {
  const existing = (await runs.dataset(context)).runProfiles[0] ?? null;
  const fields = wanted(run);
  if (existing) {
    const stored: Record<string, unknown> = {
      goal: existing.goal,
      runs_per_week: existing.runs_per_week,
      base_minutes_per_week: existing.base_minutes_per_week,
      longest_run_4w_min: existing.longest_run_4w_min,
      preferred_environment: existing.preferred_environment,
      race_date: existing.race_date,
      target_time_s: existing.target_time_s,
    };
    const sameReference =
      !fields.reference ||
      (existing.reference_distance_m === fields.reference.distance_m &&
        existing.reference_time_s === fields.reference.time_s &&
        existing.reference_date === fields.reference.date &&
        existing.reference_source === fields.reference.source);
    const { reference: _reference, ...plain } = fields as Record<
      string,
      unknown
    >;
    if (
      sameReference &&
      Object.entries(plain).every(([key, value]) => stored[key] === value)
    )
      return;
  }
  const response = await runs.execute(
    "update_run_profile",
    {
      // The revision is part of the id: the same state retries the same write.
      request_id: `setup-run-${sessionId}-r${existing?.row_revision ?? 0}`,
      ...(existing ? { expected_row_revision: existing.row_revision } : {}),
      ...fields,
    },
    context,
  );
  if (!response.ok)
    throw new Error(response.error?.message ?? "Laufprofil nicht gespeichert.");
}
