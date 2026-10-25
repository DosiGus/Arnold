import type { PreparedInput } from "./eligibility.js";
import { freezeReasons, tally } from "./validation.js";
import type { AnalyticsReason } from "./types.js";

/**
 * Reports how far the selection can be analysed at all. Everything here is a
 * property of the data, not a judgement: a voided set or an uncomputable
 * bodyweight load is normal documentation, and the counters make it visible
 * instead of hiding it inside a total.
 */
export function computeDataQuality(input: PreparedInput) {
  const reasons: AnalyticsReason[] = [];
  if (!input.workouts.length) reasons.push("no_eligible_workouts");
  else if (!input.eligibleSets) reasons.push("no_eligible_sets");
  else if (!input.computableSets) reasons.push("no_computable_sets");
  const defects = [...input.integrityDefects.keys()];
  const analyzable = input.workouts.length > 0 && input.computableSets > 0;
  return Object.freeze({
    analyzable,
    status: !analyzable
      ? ("not_available" as const)
      : defects.length || input.computableSets < input.eligibleSets
        ? ("partial" as const)
        : ("valid" as const),
    reasons: freezeReasons([
      ...reasons,
      ...defects,
      ...(input.computableSets < input.eligibleSets
        ? input.setExclusions.keys()
        : []),
    ]),
    data_first_date: input.dataFirstDate,
    data_last_date: input.dataLastDate,
    workouts_by_status: tally(input.workoutsByStatus),
    sets_by_status: tally(input.setsByStatus),
    sets_by_type: tally(input.setsByType),
    eligible_workouts: input.workouts.length,
    eligible_sets: input.eligibleSets,
    computable_sets: input.computableSets,
    set_exclusions: tally(input.setExclusions),
    set_caveats: tally(input.setCaveats),
    integrity_defects: tally(input.integrityDefects),
    retired_exercises_in_use: input.retiredExercisesInUse,
    removed_plan_items_in_use: input.removedPlanItemsInUse,
  });
}
