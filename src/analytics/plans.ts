import type { ArnoldPlanVersion } from "../shared/arnold-schema-v1.js";
import type { PreparedInput, PreparedWorkout } from "./eligibility.js";
import { compareDate } from "./period.js";
import {
  coverage,
  exact,
  freezeReasons,
  metric,
  round,
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

function sumWithGaps(
  name: string,
  unit: MetricValue["unit"],
  values: readonly (number | null)[],
  gapReason: AnalyticsReason,
): MetricValue {
  const present = values.filter((value): value is number => value !== null);
  if (!present.length)
    return unavailable(name, unit, values.length ? [gapReason] : []);
  const sum = present.reduce((total, value) => total + value, 0);
  return metric(
    name,
    sum,
    unit,
    present.length === values.length ? "valid" : "partial",
    present.length === values.length ? [] : [gapReason],
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
  return metric(
    name,
    round(achieved.value / planned.value),
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
 * `days_per_week` per calendar week and from the plan version that was in force
 * at the start of that week. Weeks without an applicable plan are listed rather
 * than filled in.
 */
export function computePlanAdherence(input: PreparedInput) {
  const plans = input.dataset.plans;
  const sessionKey = (workout: PreparedWorkout) =>
    workout.workout.plan_version_id !== null &&
    workout.workout.session_id !== null
      ? `${workout.workout.plan_version_id}|${workout.workout.session_id}`
      : null;
  const attributable = input.workouts.filter((workout) => {
    const key = sessionKey(workout);
    return key !== null && input.planItemsBySession.has(key);
  });
  const attributableIds = new Set(
    attributable.map((workout) => workout.workout.workout_id),
  );

  const weeksWithoutPlan: string[] = [];
  const perWeek = new Map<string, number | null>();
  const windowWeeks = new Map<string, string[]>();
  for (const week of input.periodWeeks) {
    const anchor =
      input.periodFrom !== null && compareDate(week, input.periodFrom) < 0
        ? input.periodFrom
        : week;
    const plan = planVersionAt(plans, anchor);
    if (!plan) {
      weeksWithoutPlan.push(week);
      perWeek.set(week, null);
      continue;
    }
    perWeek.set(week, plan.days_per_week);
    const bucket = windowWeeks.get(plan.plan_version_id);
    if (bucket) bucket.push(week);
    else windowWeeks.set(plan.plan_version_id, [week]);
  }

  const planned_sessions = sumWithGaps(
    "planned_sessions",
    "workouts",
    [...perWeek.values()],
    "plan_days_per_week_not_configured",
  );

  // Planned working sets follow the sessions that were actually performed.
  const plannedSetValues: (number | null)[] = [];
  const deviations: Deviation[] = [];
  let completedWorkingSets = 0;
  for (const workout of attributable) {
    const key = sessionKey(workout)!;
    const items = (input.planItemsBySession.get(key) ?? []).filter(
      (item) => item.status === "active",
    );
    const actual = new Map<string, number>();
    for (const analysis of workout.analyses)
      if (analysis.bucket === "working")
        actual.set(
          analysis.set.exercise_id,
          (actual.get(analysis.set.exercise_id) ?? 0) + 1,
        );
    completedWorkingSets += [...actual.values()].reduce(
      (total, value) => total + value,
      0,
    );
    plannedSetValues.push(
      ...items.map((item) =>
        item.target_sets === null ? null : item.target_sets,
      ),
    );
    const planned = new Set(items.map((item) => item.exercise_id));
    for (const item of items) {
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
    for (const [exercise_id, performed] of [...actual].sort(([a], [b]) =>
      a < b ? -1 : 1,
    ))
      if (!planned.has(exercise_id))
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

  const planned_working_sets = sumWithGaps(
    "planned_working_sets",
    "sets",
    plannedSetValues,
    "plan_target_sets_not_configured",
  );
  const completed_attributable_workouts = exact(
    "completed_attributable_workouts",
    attributable.length,
    "workouts",
  );
  const completed_attributable_working_sets = metric(
    "completed_attributable_working_sets",
    completedWorkingSets,
    "sets",
    "valid",
    [],
    coverage(input.eligibleSets, completedWorkingSets, []),
  );

  const reasons: AnalyticsReason[] = [];
  if (!plans.length) reasons.push("no_plan_version_applicable");
  if (weeksWithoutPlan.length) reasons.push("no_plan_version_applicable");
  if (input.workouts.length && !attributable.length)
    reasons.push("workout_not_attributable_to_plan");

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
                [...weeks].sort(compareDate),
              ),
              planned_sessions: sumWithGaps(
                "planned_sessions",
                "workouts",
                weeks.map(() => plan.days_per_week),
                "plan_days_per_week_not_configured",
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
      input.workouts.filter(
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
    set_adherence_rate: rate(
      "set_adherence_rate",
      completed_attributable_working_sets,
      planned_working_sets,
    ),
    deviations: Object.freeze(
      deviations
        .sort((a, b) =>
          `${a.date}|${a.workout_id}|${a.kind}|${a.exercise_id}` <
          `${b.date}|${b.workout_id}|${b.kind}|${b.exercise_id}`
            ? -1
            : 1,
        )
        .map((entry) => Object.freeze(entry)),
    ),
  });
}
