/**
 * Projection of the six Arnold tables onto the training plan domain model.
 *
 * This module is pure: dataset in, domain objects out, no clock, no IDs, no
 * writes. That matters because the same projection answers a read tool, feeds
 * the editor, and is the input of validation and comparison — so a plan can
 * never look different depending on who asked.
 *
 * The central subtlety is that a *session* is not a row. PLAN_ITEMS carries
 * `session_id`, `session_order` and `session_name` on every position, so a
 * session is the set of positions sharing an id, and its name and order are a
 * property those positions must agree on. The dataset contract enforces that
 * agreement; here we read it back and surface a disagreement as a finding
 * rather than silently picking one row's opinion.
 */
import type {
  ArnoldDataset,
  ArnoldExercise,
  ArnoldPlanItem,
  ArnoldPlanVersion,
} from "../../shared/arnold-schema-v1.js";
import {
  PLAN_SCHEMA_LIMITS,
  type PlanExerciseOption,
  type PlannedExercise,
  type TrainingPlan,
  type TrainingPlanVersion,
  type TrainingPlanVersionSummary,
  type TrainingSession,
} from "../../shared/plan-contract.js";

/** Lexicographic comparison; never locale-dependent, so output is stable. */
const byText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * All positions of one version, grouped into sessions.
 *
 * Sessions are ordered by `session_order`, then by name and id so that two
 * sessions that (invalidly) share an order still come out deterministically
 * instead of in storage row order.
 */
export function sessionsOf(
  dataset: ArnoldDataset,
  planVersionId: string,
  options: { includeRemoved?: boolean } = {},
): TrainingSession[] {
  const exercises = new Map(
    dataset.exercises.map((row) => [row.exercise_id, row]),
  );
  const groups = new Map<string, ArnoldPlanItem[]>();
  for (const item of dataset.planItems) {
    if (item.plan_version_id !== planVersionId) continue;
    const bucket = groups.get(item.session_id);
    if (bucket) bucket.push(item);
    else groups.set(item.session_id, [item]);
  }
  const sessions: TrainingSession[] = [];
  for (const [session_id, items] of groups) {
    const active = items.filter((item) => item.status === "active");
    // A session that holds nothing but tombstones has been removed from this
    // draft. Its rows stay so historical names remain resolvable.
    if (!active.length && !options.includeRemoved) continue;
    // The identity rows must agree on name and order; prefer an active row's
    // view, because a stale tombstone must never rename a live session.
    const identity = active[0] ?? items[0];
    const listed = options.includeRemoved ? items : active;
    sessions.push({
      session_id,
      session_name: identity.session_name,
      session_order: identity.session_order,
      exercises: [...listed]
        .sort(
          (a, b) =>
            a.exercise_order - b.exercise_order ||
            byText(a.plan_item_id, b.plan_item_id),
        )
        .map((item) => plannedExercise(item, exercises.get(item.exercise_id))),
      removed_exercise_count: items.length - active.length,
      persisted: true,
    });
  }
  return sessions.sort(
    (a, b) =>
      a.session_order - b.session_order ||
      byText(a.session_name, b.session_name) ||
      byText(a.session_id, b.session_id),
  );
}

/** One PLAN_ITEMS row with its catalog label resolved for display. */
export function plannedExercise(
  item: ArnoldPlanItem,
  exercise: ArnoldExercise | undefined,
): PlannedExercise {
  return {
    plan_item_id: item.plan_item_id,
    session_id: item.session_id,
    exercise_id: item.exercise_id,
    // A dangling reference is named as such rather than rendered as a blank row.
    exercise_name: exercise?.name_de ?? "Unbekannte Übung",
    exercise_equipment: exercise?.equipment ?? "",
    exercise_primary_muscle: exercise?.primary_muscle ?? "",
    exercise_active: exercise?.status === "active",
    exercise_order: item.exercise_order,
    target_sets: item.target_sets,
    rep_min: item.rep_min,
    rep_max: item.rep_max,
    target_load_kg: item.target_load_kg,
    target_load_basis: item.target_load_basis,
    target_execution_mode: item.target_execution_mode,
    target_implement_count: item.target_implement_count,
    rest_seconds: item.rest_seconds,
    notes: item.notes,
    status: item.status,
    row_revision: item.row_revision,
  };
}

/** How many completed or running workouts are bound to a version. */
export function workoutCount(
  dataset: ArnoldDataset,
  planVersionId: string,
): number {
  return dataset.workouts.filter(
    (workout) =>
      workout.plan_version_id === planVersionId &&
      workout.status !== "voided" &&
      workout.status !== "cancelled",
  ).length;
}

/** Full projection of one version, sessions included. */
export function projectVersion(
  dataset: ArnoldDataset,
  plan: ArnoldPlanVersion,
  options: { includeRemoved?: boolean } = {},
): TrainingPlanVersion {
  const sessions = sessionsOf(dataset, plan.plan_version_id, options);
  return {
    plan_version_id: plan.plan_version_id,
    plan_family_id: plan.plan_family_id,
    version_no: plan.version_no,
    name: plan.name,
    split_key: plan.split_key,
    status: plan.status,
    goal_key: plan.goal_key,
    days_per_week: plan.days_per_week,
    activated_at_utc: plan.activated_at_utc,
    retired_at_utc: plan.retired_at_utc,
    created_at_utc: plan.created_at_utc,
    updated_at_utc: plan.updated_at_utc,
    row_revision: plan.row_revision,
    sessions,
    session_count: sessions.filter((s) =>
      s.exercises.some((e) => e.status === "active"),
    ).length,
    exercise_count: sessions.reduce(
      (total, session) =>
        total + session.exercises.filter((e) => e.status === "active").length,
      0,
    ),
    // Content is editable exactly while the version is a draft. Nothing else in
    // the system may widen this.
    editable: plan.status === "draft",
    workout_count: workoutCount(dataset, plan.plan_version_id),
  };
}

export function summarizeVersion(
  dataset: ArnoldDataset,
  plan: ArnoldPlanVersion,
): TrainingPlanVersionSummary {
  const sessions = sessionsOf(dataset, plan.plan_version_id);
  return {
    plan_version_id: plan.plan_version_id,
    plan_family_id: plan.plan_family_id,
    version_no: plan.version_no,
    name: plan.name,
    split_key: plan.split_key,
    status: plan.status,
    goal_key: plan.goal_key,
    days_per_week: plan.days_per_week,
    activated_at_utc: plan.activated_at_utc,
    retired_at_utc: plan.retired_at_utc,
    created_at_utc: plan.created_at_utc,
    updated_at_utc: plan.updated_at_utc,
    row_revision: plan.row_revision,
    session_count: sessions.length,
    exercise_count: sessions.reduce(
      (total, session) => total + session.exercises.length,
      0,
    ),
    workout_count: workoutCount(dataset, plan.plan_version_id),
    session_names: sessions.map((session) => session.session_name),
  };
}

/**
 * The plan families, newest version first inside each.
 *
 * A family has no row of its own, so its name is the name of its active
 * version, else of its newest version that is not archived: a draft that was
 * thrown away never renames the plan the user trains with.
 */
export function projectFamilies(dataset: ArnoldDataset): TrainingPlan[] {
  const groups = new Map<string, ArnoldPlanVersion[]>();
  for (const plan of dataset.plans) {
    const bucket = groups.get(plan.plan_family_id);
    if (bucket) bucket.push(plan);
    else groups.set(plan.plan_family_id, [plan]);
  }
  return [...groups]
    .map(([plan_family_id, plans]) => {
      const versions = [...plans]
        .sort(
          (a, b) =>
            b.version_no - a.version_no ||
            byText(b.plan_version_id, a.plan_version_id),
        )
        .map((plan) => summarizeVersion(dataset, plan));
      const active = plans.find((plan) => plan.status === "active") ?? null;
      return {
        plan_family_id,
        name: (
          versions.find((v) => v.status === "active") ??
          versions.find((v) => v.status !== "archived") ??
          versions[0]
        ).name,
        active_plan_version_id: active?.plan_version_id ?? null,
        latest_version_no: Math.max(...plans.map((plan) => plan.version_no)),
        draft_plan_version_ids: versions
          .filter((version) => version.status === "draft")
          .map((version) => version.plan_version_id),
        versions,
      };
    })
    .sort((a, b) => {
      // Active family first, then by most recent activity.
      if (!!a.active_plan_version_id !== !!b.active_plan_version_id)
        return a.active_plan_version_id ? -1 : 1;
      return (
        byText(b.versions[0].updated_at_utc, a.versions[0].updated_at_utc) ||
        byText(a.plan_family_id, b.plan_family_id)
      );
    });
}

export function activePlan(dataset: ArnoldDataset): ArnoldPlanVersion | null {
  return dataset.plans.find((plan) => plan.status === "active") ?? null;
}

/** Drafts, newest touched first. */
export function draftPlans(dataset: ArnoldDataset): ArnoldPlanVersion[] {
  return dataset.plans
    .filter((plan) => plan.status === "draft")
    .sort(
      (a, b) =>
        byText(b.updated_at_utc, a.updated_at_utc) ||
        b.version_no - a.version_no ||
        byText(a.plan_version_id, b.plan_version_id),
    );
}

export function findPlan(
  dataset: ArnoldDataset,
  planVersionId: string,
): ArnoldPlanVersion | undefined {
  return dataset.plans.find((plan) => plan.plan_version_id === planVersionId);
}

/** The catalog as the picker needs it, retired entries excluded. */
export function exerciseOptions(dataset: ArnoldDataset): PlanExerciseOption[] {
  return dataset.exercises
    .filter((exercise) => exercise.status === "active")
    .map((exercise) => ({
      exercise_id: exercise.exercise_id,
      name_de: exercise.name_de,
      name_en: exercise.name_en,
      family_key: exercise.family_key,
      variant_key: exercise.variant_key,
      equipment: exercise.equipment,
      primary_muscle: exercise.primary_muscle,
      default_load_basis: exercise.default_load_basis,
      default_execution_mode: exercise.default_execution_mode,
      default_implement_count: exercise.default_implement_count,
    }))
    .sort(
      (a, b) =>
        byText(a.primary_muscle, b.primary_muscle) ||
        byText(a.name_de, b.name_de) ||
        byText(a.exercise_id, b.exercise_id),
    );
}

/** The structural limits that apply to a tracker regardless of its content. */
export const PLAN_STRUCTURAL_LIMITS = PLAN_SCHEMA_LIMITS.filter(
  (limit) => limit !== "EMPTY_SESSION_NOT_PERSISTABLE",
);

/* ---------------------------------------------------------- state machine */

export type PlanStatus = ArnoldPlanVersion["status"];

/**
 * The plan lifecycle. Exactly three transitions exist, and none of them leads
 * back into `draft`: an activated or archived version is a historical record,
 * and "going back to the old plan" means deriving a *new* draft from it.
 */
export const PLAN_TRANSITIONS: Readonly<
  Record<PlanStatus, readonly PlanStatus[]>
> = Object.freeze({
  draft: Object.freeze(["active", "archived"] as const),
  active: Object.freeze(["archived"] as const),
  archived: Object.freeze([] as const),
});

export function canTransition(from: PlanStatus, to: PlanStatus): boolean {
  return PLAN_TRANSITIONS[from].includes(to);
}

/** True while a version may serve as the basis of a new draft. Any version may. */
export function isReusable(plan: ArnoldPlanVersion): boolean {
  return (
    plan.status === "active" ||
    plan.status === "archived" ||
    plan.status === "draft"
  );
}
