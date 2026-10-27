import {
  isDiscardedPlan,
  type ArnoldPlanVersion,
} from "../shared/arnold-schema-v1.js";
import type { PreparedInput, PreparedWorkout } from "./eligibility.js";
import { addDays, compareDate } from "./period.js";
import {
  compareTuple,
  coverage,
  exact,
  freezeReasons,
  metric,
  round,
  tupleKey,
  unavailable,
} from "./validation.js";
import type { AnalyticsReason, MetricValue } from "./types.js";

type Deviation = {
  kind:
    "missing_planned_exercise" | "unplanned_exercise" | "set_count_deviation";
  workout_id: string;
  date: string;
  plan_version_id: string | null;
  session_id: string | null;
  exercise_id: string;
  planned_working_sets: number | null;
  actual_working_sets: number;
  deviation: number | null;
};

/**
 * The plan version that was in force on a local calendar date.
 *
 * A draft is never in force, even if it carries an activation timestamp: the
 * raw schema rejects that combination, but the engine must not let an upstream
 * defect promote an unreleased plan over the active one.
 *
 * `activated_at_utc` and `retired_at_utc` are UTC instants while the training
 * date is local, so only their date part is compared. A plan that changes hands
 * on the very day of a workout is therefore attributed to the newer version.
 */
export function planVersionAt(
  plans: readonly ArnoldPlanVersion[],
  date: string,
): ArnoldPlanVersion | null {
  const candidates = plans.filter(
    (plan) =>
      plan.status !== "draft" &&
      plan.activated_at_utc !== null &&
      compareDate(plan.activated_at_utc.slice(0, 10), date) <= 0 &&
      (plan.retired_at_utc === null ||
        compareDate(plan.retired_at_utc.slice(0, 10), date) > 0),
  );
  return (
    [...candidates].sort((a, b) => {
      if (a.version_no !== b.version_no) return b.version_no - a.version_no;
      const activation = compareDate(
        b.activated_at_utc!.slice(0, 10),
        a.activated_at_utc!.slice(0, 10),
      );
      return activation !== 0
        ? activation
        : a.plan_version_id < b.plan_version_id
          ? -1
          : 1;
    })[0] ?? null
  );
}

/** Sum that stays `partial` while any contribution is unknown, and never guesses. */
function sumWithGaps(
  name: string,
  unit: MetricValue["unit"],
  values: readonly (number | null)[],
  gapReasons: Iterable<AnalyticsReason>,
): MetricValue {
  const reasons = freezeReasons(gapReasons);
  const present = values.filter((value): value is number => value !== null);
  if (!present.length)
    return unavailable(name, unit, values.length ? reasons : []);
  const sum = present.reduce((total, value) => total + value, 0);
  if (!Number.isFinite(sum))
    return metric(name, null, unit, "invalid", ["aggregate_not_finite"]);
  return metric(
    name,
    round(sum),
    unit,
    present.length === values.length ? "valid" : "partial",
    present.length === values.length ? [] : reasons,
  );
}

function rate(
  name: string,
  achieved: MetricValue,
  planned: MetricValue,
): MetricValue {
  if (planned.value === null || achieved.value === null)
    return unavailable(name, "ratio", [
      ...planned.reasons,
      "no_previous_reference_value",
    ]);
  if (planned.value === 0)
    return unavailable(name, "ratio", ["no_plan_version_applicable"]);
  const value = round(achieved.value / planned.value);
  if (!Number.isFinite(value))
    return metric(name, null, "ratio", "invalid", ["aggregate_not_finite"]);
  return metric(
    name,
    value,
    "ratio",
    planned.status === "partial" ? "partial" : "valid",
    planned.reasons,
  );
}

/**
 * Rule-based plan adherence.
 *
 * The engine never invents concrete weekdays: a plan only states how many
 * sessions a week it intends, so the planned session count is derived from
 * `days_per_week` per calendar week. Every day of a week inside the period is
 * checked, so a plan swap in the middle of a week is recognised rather than
 * silently resolved to whichever version happened to hold on the Monday.
 *
 * Only completed workouts count as performed sessions, whatever the
 * `workout_statuses` filter admits, and only working sets of an active planned
 * position count towards adherence. Extra work is reported separately.
 */
export function computePlanAdherence(input: PreparedInput) {
  const plans = input.dataset.plans.filter((plan) => !isDiscardedPlan(plan));
  const sessionKey = (workout: PreparedWorkout) =>
    workout.workout.plan_version_id !== null &&
    workout.workout.session_id !== null
      ? tupleKey([workout.workout.plan_version_id, workout.workout.session_id])
      : null;
  const attributable = input.completedWorkouts.filter((workout) => {
    const key = sessionKey(workout);
    const plan = input.plansById.get(workout.workout.plan_version_id ?? "");
    return (
      key !== null &&
      !!plan &&
      !isDiscardedPlan(plan) &&
      plan.status !== "draft" &&
      input.planItemsBySession.has(key)
    );
  });
  const attributableIds = new Set(
    attributable.map((workout) => workout.workout.workout_id),
  );

  // Weekly targets, one calendar week at a time.
  const weeksWithoutPlan: string[] = [];
  const weekValues: (number | null)[] = [];
  const weekGapReasons: AnalyticsReason[] = [];
  const windowWeeks = new Map<string, string[]>();
  for (const week of input.periodWeeks) {
    const versions = new Map<string, ArnoldPlanVersion>();
    for (let offset = 0; offset < 7; offset++) {
      const day = addDays(week, offset);
      if (input.periodFrom !== null && compareDate(day, input.periodFrom) < 0)
        continue;
      if (input.periodTo !== null && compareDate(day, input.periodTo) > 0)
        continue;
      const plan = planVersionAt(plans, day);
      if (plan) versions.set(plan.plan_version_id, plan);
    }
    if (!versions.size) {
      weeksWithoutPlan.push(week);
      weekValues.push(null);
      weekGapReasons.push("no_plan_version_applicable");
      continue;
    }
    for (const id of versions.keys()) {
      const bucket = windowWeeks.get(id);
      if (bucket) bucket.push(week);
      else windowWeeks.set(id, [week]);
    }
    if (versions.size > 1) {
      // Two plans shared this week. Their targets cannot be split across days
      // without inventing weekdays, so the weekly target stays unknown.
      weekValues.push(null);
      weekGapReasons.push("plan_changed_within_week");
      continue;
    }
    const only = [...versions.values()][0];
    weekValues.push(only.days_per_week);
    if (only.days_per_week === null)
      weekGapReasons.push("plan_days_per_week_not_configured");
  }

  const planned_sessions = sumWithGaps(
    "planned_sessions",
    "workouts",
    weekValues,
    weekGapReasons,
  );

  // Planned working sets follow the sessions that were actually performed.
  const plannedSetValues: (number | null)[] = [];
  const plannedSetGaps: AnalyticsReason[] = [];
  const deviations: Deviation[] = [];
  let attributableWorkingSets = 0;
  let unplannedWorkingSets = 0;
  for (const workout of attributable) {
    const key = sessionKey(workout)!;
    const items = (input.planItemsBySession.get(key) ?? []).filter(
      (item) => item.status === "active",
    );
    const planned = new Set(items.map((item) => item.exercise_id));
    const actual = new Map<string, number>();
    for (const analysis of workout.analyses)
      if (analysis.bucket === "working")
        actual.set(
          analysis.set.exercise_id,
          (actual.get(analysis.set.exercise_id) ?? 0) + 1,
        );

    for (const item of items) {
      plannedSetValues.push(item.target_sets);
      if (item.target_sets === null)
        plannedSetGaps.push("plan_target_sets_not_configured");
      const performed = actual.get(item.exercise_id) ?? 0;
      if (performed === 0)
        deviations.push({
          kind: "missing_planned_exercise",
          workout_id: workout.workout.workout_id,
          date: workout.date,
          plan_version_id: workout.workout.plan_version_id,
          session_id: workout.workout.session_id,
          exercise_id: item.exercise_id,
          planned_working_sets: item.target_sets,
          actual_working_sets: 0,
          deviation: item.target_sets === null ? null : -item.target_sets,
        });
      else if (item.target_sets !== null && performed !== item.target_sets)
        deviations.push({
          kind: "set_count_deviation",
          workout_id: workout.workout.workout_id,
          date: workout.date,
          plan_version_id: workout.workout.plan_version_id,
          session_id: workout.workout.session_id,
          exercise_id: item.exercise_id,
          planned_working_sets: item.target_sets,
          actual_working_sets: performed,
          deviation: performed - item.target_sets,
        });
    }

    // Work on an exercise the session does not plan is extra work. It must not
    // fill the gap left by a planned exercise that was skipped.
    for (const [exercise_id, performed] of [...actual].sort(([a], [b]) =>
      a < b ? -1 : 1,
    )) {
      if (planned.has(exercise_id)) {
        attributableWorkingSets += performed;
        continue;
      }
      unplannedWorkingSets += performed;
      deviations.push({
        kind: "unplanned_exercise",
        workout_id: workout.workout.workout_id,
        date: workout.date,
        plan_version_id: workout.workout.plan_version_id,
        session_id: workout.workout.session_id,
        exercise_id,
        planned_working_sets: null,
        actual_working_sets: performed,
        deviation: null,
      });
    }
  }

  const planned_working_sets = sumWithGaps(
    "planned_working_sets",
    "sets",
    plannedSetValues,
    plannedSetGaps,
  );
  const completed_attributable_workouts = exact(
    "completed_attributable_workouts",
    attributable.length,
    "workouts",
  );
  const completed_attributable_working_sets = metric(
    "completed_attributable_working_sets",
    attributableWorkingSets,
    "sets",
    "valid",
    [],
    coverage(input.eligibleSets, attributableWorkingSets, [
      ...(unplannedWorkingSets ? (["working_set_not_planned"] as const) : []),
    ]),
  );

  const reasons: AnalyticsReason[] = [];
  if (!plans.length) reasons.push("no_plan_version_applicable");
  if (weeksWithoutPlan.length) reasons.push("no_plan_version_applicable");
  if (weekGapReasons.includes("plan_changed_within_week"))
    reasons.push("plan_changed_within_week");
  if (input.completedWorkouts.length && !attributable.length)
    reasons.push("workout_not_attributable_to_plan");
  if (unplannedWorkingSets) reasons.push("working_set_not_planned");

  return Object.freeze({
    status: plans.length
      ? reasons.length
        ? ("partial" as const)
        : ("valid" as const)
      : ("not_available" as const),
    reasons: freezeReasons(reasons),
    plan_windows: Object.freeze(
      [...windowWeeks.entries()]
        .sort(([a], [b]) => (a < b ? -1 : 1))
        .flatMap(([plan_version_id, weeks]) => {
          const plan = input.plansById.get(plan_version_id);
          if (!plan) return [];
          return [
            Object.freeze({
              plan_version_id,
              plan_family_id: plan.plan_family_id,
              version_no: plan.version_no,
              name: plan.name,
              status: plan.status,
              days_per_week: plan.days_per_week,
              applicable_week_starts: Object.freeze(
                [...new Set(weeks)].sort(compareDate),
              ),
              planned_sessions: sumWithGaps(
                "planned_sessions",
                "workouts",
                [...new Set(weeks)].map(() => plan.days_per_week),
                ["plan_days_per_week_not_configured"],
              ),
              completed_attributable_workouts: attributable.filter(
                (workout) =>
                  workout.workout.plan_version_id === plan_version_id,
              ).length,
            }),
          ];
        }),
    ),
    weeks_without_plan: Object.freeze(weeksWithoutPlan),
    planned_sessions,
    completed_attributable_workouts,
    unattributed_workouts: exact(
      "unattributed_workouts",
      input.completedWorkouts.filter(
        (workout) => !attributableIds.has(workout.workout.workout_id),
      ).length,
      "workouts",
    ),
    session_adherence_rate: rate(
      "session_adherence_rate",
      completed_attributable_workouts,
      planned_sessions,
    ),
    planned_working_sets,
    completed_attributable_working_sets,
    unplanned_working_sets: exact(
      "unplanned_working_sets",
      unplannedWorkingSets,
      "sets",
    ),
    set_adherence_rate: rate(
      "set_adherence_rate",
      completed_attributable_working_sets,
      planned_working_sets,
    ),
    deviations: Object.freeze(
      deviations
        .sort((a, b) =>
          compareTuple(
            [a.date, a.workout_id, a.kind, a.exercise_id],
            [b.date, b.workout_id, b.kind, b.exercise_id],
          ),
        )
        .map((entry) => Object.freeze(entry)),
    ),
  });
}
