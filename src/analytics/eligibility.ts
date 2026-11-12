import { strengthTrainingView } from "../shared/arnold-schema-v1.js";
import type {
  ArnoldDataset,
  ArnoldExercise,
  ArnoldPlanItem,
  ArnoldPlanVersion,
  ArnoldSet,
  ArnoldWorkout,
} from "../shared/arnold-schema-v1.js";
import { analyzeSetLoad, type SetLoadAnalysis } from "./load.js";
import {
  compareDate,
  isoWeek,
  weekStart,
  weekStartsBetween,
} from "./period.js";
import { bump, compareTuple, tupleKey } from "./validation.js";
import type { AnalyticsFilter, AnalyticsReason } from "./types.js";

/** Only a completed workout is a session the user actually performed. */
export const DEFAULT_WORKOUT_STATUSES = Object.freeze([
  "completed",
]) as readonly ArnoldWorkout["status"][];

export type PreparedWorkout = Readonly<{
  workout: ArnoldWorkout;
  /** True only for `status = "completed"`, regardless of the status filter. */
  completed: boolean;
  date: string;
  week_start: string;
  iso_year: number;
  iso_week: number;
  analyses: readonly SetLoadAnalysis[];
}>;

export type PreparedInput = Readonly<{
  dataset: ArnoldDataset;
  filter: AnalyticsFilter;
  exercisesById: ReadonlyMap<string, ArnoldExercise>;
  plansById: ReadonlyMap<string, ArnoldPlanVersion>;
  planItemsById: ReadonlyMap<string, ArnoldPlanItem>;
  /** `plan_version_id|session_id` to the plan items of that session. */
  planItemsBySession: ReadonlyMap<string, readonly ArnoldPlanItem[]>;
  workouts: readonly PreparedWorkout[];
  /** The completed subset; every metric that claims completion uses this. */
  completedWorkouts: readonly PreparedWorkout[];
  analyses: readonly SetLoadAnalysis[];
  trainingDates: readonly string[];
  completedTrainingDates: readonly string[];
  periodFrom: string | null;
  periodTo: string | null;
  referenceDate: string | null;
  periodWeeks: readonly string[];
  dataFirstDate: string | null;
  dataLastDate: string | null;
  eligibleSets: number;
  computableSets: number;
  workoutsByStatus: ReadonlyMap<string, number>;
  setsByStatus: ReadonlyMap<string, number>;
  setsByType: ReadonlyMap<string, number>;
  setExclusions: ReadonlyMap<AnalyticsReason, number>;
  setCaveats: ReadonlyMap<AnalyticsReason, number>;
  integrityDefects: ReadonlyMap<AnalyticsReason, number>;
  retiredExercisesInUse: readonly string[];
  removedPlanItemsInUse: readonly string[];
}>;

function matches(
  allowed: readonly string[] | null,
  value: string | null,
): boolean {
  if (!allowed) return true;
  return value !== null && allowed.includes(value);
}

/** Stable chronological order; the started timestamp separates same-day sessions. */
function workoutOrder(workout: ArnoldWorkout): (string | number)[] {
  return [
    workout.workout_date_local,
    workout.started_at_utc ?? workout.created_at_utc,
    workout.workout_id,
  ];
}

/** Numeric set order, so set 10 follows set 2 instead of preceding it. */
function setOrder(set: ArnoldSet): (string | number)[] {
  return [set.exercise_order, set.set_number, set.set_id];
}

/**
 * One pass over the raw dataset that produces every per-set figure the other
 * modules reuse, so a long set history is never walked repeatedly.
 *
 * The input is expected to have passed `ArnoldDatasetSchema`. Duplicate IDs and
 * dangling references cannot survive that validation, but they are still
 * detected and excluded here instead of throwing, so a caller that assembles a
 * dataset by hand gets a reported defect rather than a crash.
 */
export function prepareAnalyticsInput(
  dataset: ArnoldDataset,
  filter: AnalyticsFilter,
  referenceDateOption?: string | null,
): PreparedInput {
  // Strength figures only: runs and planned workouts never count (RUN-003).
  dataset = strengthTrainingView(dataset);
  const integrityDefects = new Map<AnalyticsReason, number>();
  const setExclusions = new Map<AnalyticsReason, number>();
  const setCaveats = new Map<AnalyticsReason, number>();

  const exercisesById = new Map<string, ArnoldExercise>();
  for (const exercise of dataset.exercises)
    if (!exercisesById.has(exercise.exercise_id))
      exercisesById.set(exercise.exercise_id, exercise);
  const plansById = new Map<string, ArnoldPlanVersion>();
  for (const plan of dataset.plans)
    if (!plansById.has(plan.plan_version_id))
      plansById.set(plan.plan_version_id, plan);
  const planItemsById = new Map<string, ArnoldPlanItem>();
  const planItemsBySession = new Map<string, ArnoldPlanItem[]>();
  for (const item of dataset.planItems) {
    if (!planItemsById.has(item.plan_item_id))
      planItemsById.set(item.plan_item_id, item);
    const key = tupleKey([item.plan_version_id, item.session_id]);
    const bucket = planItemsBySession.get(key);
    if (bucket) bucket.push(item);
    else planItemsBySession.set(key, [item]);
  }

  const workoutsById = new Map<string, ArnoldWorkout>();
  const workoutsByStatus = new Map<string, number>();
  let dataFirstDate: string | null = null;
  let dataLastDate: string | null = null;
  for (const workout of dataset.workouts) {
    bump(workoutsByStatus, workout.status);
    if (workoutsById.has(workout.workout_id))
      bump(integrityDefects, "duplicate_workout_id");
    else workoutsById.set(workout.workout_id, workout);
    const date = workout.workout_date_local;
    if (dataFirstDate === null || compareDate(date, dataFirstDate) < 0)
      dataFirstDate = date;
    if (dataLastDate === null || compareDate(date, dataLastDate) > 0)
      dataLastDate = date;
  }

  const setsByStatus = new Map<string, number>();
  const setsByType = new Map<string, number>();
  const seenSetIds = new Set<string>();
  const setsByWorkout = new Map<string, ArnoldSet[]>();
  for (const set of dataset.sets) {
    bump(setsByStatus, set.status);
    bump(setsByType, set.set_type);
    if (seenSetIds.has(set.set_id)) {
      bump(integrityDefects, "duplicate_set_id");
      continue;
    }
    seenSetIds.add(set.set_id);
    if (!workoutsById.has(set.workout_id)) {
      bump(integrityDefects, "workout_reference_missing");
      continue;
    }
    const bucket = setsByWorkout.get(set.workout_id);
    if (bucket) bucket.push(set);
    else setsByWorkout.set(set.workout_id, [set]);
  }

  const statuses = filter.workout_statuses ?? DEFAULT_WORKOUT_STATUSES;
  const restrictsSets =
    filter.exercise_ids !== null || filter.set_types !== null;
  const retiredExercisesInUse = new Set<string>();
  const removedPlanItemsInUse = new Set<string>();
  const prepared: PreparedWorkout[] = [];
  let eligibleSets = 0;
  let computableSets = 0;

  for (const workout of [...workoutsById.values()].sort((a, b) =>
    compareTuple(workoutOrder(a), workoutOrder(b)),
  )) {
    const date = workout.workout_date_local;
    if (
      !statuses.includes(workout.status) ||
      (filter.from !== null && compareDate(date, filter.from) < 0) ||
      (filter.to !== null && compareDate(date, filter.to) > 0) ||
      !matches(filter.workout_ids, workout.workout_id) ||
      !matches(filter.plan_version_ids, workout.plan_version_id) ||
      !matches(filter.session_ids, workout.session_id)
    )
      continue;

    const analyses: SetLoadAnalysis[] = [];
    const raw = [...(setsByWorkout.get(workout.workout_id) ?? [])].sort(
      (a, b) => compareTuple(setOrder(a), setOrder(b)),
    );
    for (const set of raw) {
      if (set.status !== "active") {
        bump(setExclusions, "set_voided");
        continue;
      }
      if (!exercisesById.has(set.exercise_id)) {
        bump(integrityDefects, "exercise_reference_missing");
        bump(setExclusions, "exercise_reference_missing");
        continue;
      }
      if (
        !matches(filter.exercise_ids, set.exercise_id) ||
        (filter.set_types !== null && !filter.set_types.includes(set.set_type))
      ) {
        bump(setExclusions, "set_filtered_out");
        continue;
      }
      if (exercisesById.get(set.exercise_id)!.status === "retired")
        retiredExercisesInUse.add(set.exercise_id);
      if (
        set.plan_item_id !== null &&
        planItemsById.get(set.plan_item_id)?.status === "removed"
      )
        removedPlanItemsInUse.add(set.plan_item_id);

      const analysis = analyzeSetLoad(set, date);
      analyses.push(analysis);
      eligibleSets += 1;
      if (analysis.nominal_volume_kg === null)
        for (const reason of analysis.volume_reasons)
          bump(setExclusions, reason);
      else {
        computableSets += 1;
        for (const reason of analysis.volume_reasons) bump(setCaveats, reason);
      }
    }
    if (restrictsSets && analyses.length === 0) continue;
    const week = weekStart(date);
    prepared.push(
      Object.freeze({
        workout,
        completed: workout.status === "completed",
        date,
        week_start: week,
        ...isoWeek(date),
        analyses: Object.freeze(analyses),
      }),
    );
  }

  const trainingDates = [...new Set(prepared.map((entry) => entry.date))].sort(
    compareDate,
  );
  const completed = prepared.filter((entry) => entry.completed);
  const completedTrainingDates = [
    ...new Set(completed.map((entry) => entry.date)),
  ].sort(compareDate);
  const periodFrom = filter.from ?? trainingDates[0] ?? null;
  const periodTo = filter.to ?? trainingDates.at(-1) ?? null;
  const referenceDate =
    referenceDateOption ?? dataLastDate ?? filter.to ?? filter.from ?? null;

  return Object.freeze({
    dataset,
    filter,
    exercisesById,
    plansById,
    planItemsById,
    planItemsBySession: new Map(
      [...planItemsBySession].map(([key, items]) => [
        key,
        Object.freeze(
          [...items].sort((a, b) =>
            compareTuple(
              [a.exercise_order, a.plan_item_id],
              [b.exercise_order, b.plan_item_id],
            ),
          ),
        ),
      ]),
    ),
    workouts: Object.freeze(prepared),
    completedWorkouts: Object.freeze(completed),
    analyses: Object.freeze(prepared.flatMap((entry) => [...entry.analyses])),
    trainingDates: Object.freeze(trainingDates),
    completedTrainingDates: Object.freeze(completedTrainingDates),
    periodFrom,
    periodTo,
    referenceDate,
    periodWeeks: Object.freeze(
      periodFrom && periodTo ? weekStartsBetween(periodFrom, periodTo) : [],
    ),
    dataFirstDate,
    dataLastDate,
    eligibleSets,
    computableSets,
    workoutsByStatus,
    setsByStatus,
    setsByType,
    setExclusions,
    setCaveats,
    integrityDefects,
    retiredExercisesInUse: Object.freeze([...retiredExercisesInUse].sort()),
    removedPlanItemsInUse: Object.freeze([...removedPlanItemsInUse].sort()),
  });
}
