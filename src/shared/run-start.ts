/**
 * The cautious running start the setup derives from the card's running
 * status (Kevin, 26.11.2026: the card asks the status, not the minutes).
 *
 * Only planning settings are derived, never measurements: how many runs a
 * week the plan starts with and where they are planned by default. Weekly
 * minutes and the longest run stay unknown unless the user named them, and
 * the run engine reads unknown as beginner (`runExperience`).
 *
 * Pure, no I/O.
 */
import type { OnboardingRun } from "./onboarding-contract.js";

/** Planned runs a week when the user named none: more only after regular running. */
export function runsPerWeekOf(
  run: Pick<OnboardingRun, "runs_per_week" | "background"> | undefined,
): number | null {
  if (!run) return null;
  if (run.runs_per_week !== undefined) return run.runs_per_week;
  const recent = run.background?.recent;
  if (recent === undefined) return null;
  return recent === "gt10" ? 3 : 2;
}

/** Where runs are planned when the user named no place: outside. */
export const RUN_ENVIRONMENT_WITHOUT_ANSWER = "outdoor" as const;
