/**
 * Goals and body weight: the changes behind the five goal operations.
 *
 * Runs inside `WorkoutLoggingService.execute`, so every write goes through
 * `commitWrite` like a set: one transaction with audit and receipt, a
 * request_id for retries and a revision check for edits. Nothing is deleted:
 * a goal is archived, a measurement voided.
 */
import { currentGoalValue, goalPoints } from "../../analytics/goals.js";
import {
  ArnoldBodyWeightSchema,
  ArnoldGoalSchema,
  GOAL_TARGET_MAX,
  isExerciseGoalKind,
  type ArnoldDataset,
  type ArnoldGoal,
  type ArnoldGoalKind,
} from "../../shared/arnold-schema-v1.js";
import {
  WriteInputs,
  type WriteResult,
} from "../../shared/workout-contract.js";
import { WriteError, type EntityChange } from "./infrastructure.js";

export const GOAL_OPERATIONS = [
  "create_training_goal",
  "update_training_goal",
  "archive_training_goal",
  "log_body_weight",
  "void_body_weight",
] as const;
export type GoalOperation = (typeof GOAL_OPERATIONS)[number];

export const isGoalOperation = (
  operation: string,
): operation is GoalOperation =>
  (GOAL_OPERATIONS as readonly string[]).includes(operation);

type Built = { changes: EntityChange[]; result: WriteResult };

function goal(data: ArnoldDataset, id: string): ArnoldGoal {
  const row = data.goals.find((g) => g.goal_id === id);
  if (!row) throw new WriteError("GOAL_NOT_FOUND", "Ziel nicht gefunden.");
  return row;
}

function revision(row: { row_revision: number }, expected: number) {
  if (row.row_revision !== expected)
    throw new WriteError(
      "REVISION_CONFLICT",
      "Revision veraltet. Datensatz erneut laden.",
      false,
      [`current_revision=${row.row_revision}`],
    );
}

/** Units in words, for the error when a target is out of range. */
const TARGET_UNIT: Record<ArnoldGoalKind, string> = {
  body_weight: "kg",
  exercise_load: "kg",
  exercise_reps: "Wiederholungen",
  run_distance: "km",
  run_duration: "Minuten",
  run_time_for_distance: "Sekunden",
};

/** A target the kind can hold: in range, whole repetitions and seconds. */
function checkTarget(kind: ArnoldGoalKind, value: number) {
  if (value > GOAL_TARGET_MAX[kind])
    throw new WriteError(
      "VALIDATION_ERROR",
      `Der Zielwert ist zu groß (höchstens ${GOAL_TARGET_MAX[kind]} ${TARGET_UNIT[kind]}).`,
    );
  if (kind === "exercise_reps" && !Number.isInteger(value))
    throw new WriteError(
      "VALIDATION_ERROR",
      "Wiederholungsziele sind ganze Zahlen.",
    );
  if (kind === "run_time_for_distance" && !Number.isInteger(value))
    throw new WriteError(
      "VALIDATION_ERROR",
      "Zeitziele sind ganze Sekunden (25 Minuten = 1500).",
    );
}

const emptyResult = (): WriteResult => ({
  workout: null,
  sets: [],
  exercise: null,
  goal: null,
  body_weight: null,
  warnings: [],
});

export function buildGoalChange(
  operation: GoalOperation,
  raw: unknown,
  data: ArnoldDataset,
  now: string,
  newId: () => string,
): Built {
  const changes: EntityChange[] = [];
  const result = emptyResult();
  const technical = {
    created_at_utc: now,
    updated_at_utc: now,
    row_revision: 1,
  };
  switch (operation) {
    case "create_training_goal": {
      const input = WriteInputs.create_training_goal.parse(raw);
      const forExercise = isExerciseGoalKind(input.kind);
      if (forExercise !== (input.exercise_id !== undefined))
        throw new WriteError(
          "VALIDATION_ERROR",
          forExercise
            ? "Für ein Übungsziel fehlt exercise_id."
            : "Ein Körpergewichts- oder Laufziel hat keine Übung.",
        );
      if (input.kind !== "exercise_load" && input.load_basis !== undefined)
        throw new WriteError(
          "VALIDATION_ERROR",
          "load_basis gehört nur zu einem Gewichtsziel für eine Übung.",
        );
      if (
        (input.kind === "run_time_for_distance") !==
        (input.run_distance_m !== undefined)
      )
        throw new WriteError(
          "VALIDATION_ERROR",
          input.kind === "run_time_for_distance"
            ? "Für ein Zeitziel fehlt die Strecke (run_distance_m, z. B. 5000)."
            : "run_distance_m gehört nur zu einem Zeitziel (run_time_for_distance).",
        );
      checkTarget(input.kind, input.target_value);
      const exercise = forExercise
        ? data.exercises.find(
            (e) => e.exercise_id === input.exercise_id && e.status === "active",
          )
        : undefined;
      if (forExercise && !exercise)
        throw new WriteError(
          "EXERCISE_NOT_FOUND",
          "Aktive Übung nicht gefunden.",
        );
      const basis =
        input.kind === "exercise_load"
          ? (input.load_basis ?? exercise!.default_load_basis)
          : null;
      if (basis === "bodyweight_only" || basis === "assistance")
        throw new WriteError(
          "VALIDATION_ERROR",
          "Für eine Übung mit Körpergewicht oder Unterstützung ein Wiederholungsziel (exercise_reps) setzen.",
        );
      const distance = input.run_distance_m ?? null;
      const existing = data.goals.find(
        (g) =>
          g.status === "active" &&
          g.kind === input.kind &&
          g.exercise_id === (input.exercise_id ?? null) &&
          (g.run_distance_m ?? null) === distance,
      );
      if (existing)
        throw new WriteError(
          "GOAL_EXISTS",
          `Dafür gibt es schon ein aktives Ziel (goal_id ${existing.goal_id}, row_revision ${existing.row_revision}). Mit update_training_goal den Zielwert ändern.`,
          false,
          [`goal_id=${existing.goal_id}`],
        );
      const target = {
        kind: input.kind,
        exercise_id: input.exercise_id ?? null,
        load_basis: basis,
        run_distance_m: distance,
      };
      const start = currentGoalValue(goalPoints(data, target), input.kind);
      result.goal = ArnoldGoalSchema.parse({
        ...technical,
        goal_id: newId(),
        kind: target.kind,
        exercise_id: target.exercise_id,
        load_basis: target.load_basis,
        ...(distance === null ? {} : { run_distance_m: distance }),
        target_value: input.target_value,
        start_value: start?.value ?? null,
        status: "active",
      });
      changes.push({ table: "goals", before: null, after: result.goal });
      break;
    }
    case "update_training_goal":
    case "archive_training_goal": {
      const input =
        operation === "update_training_goal"
          ? WriteInputs.update_training_goal.parse(raw)
          : WriteInputs.archive_training_goal.parse(raw);
      const before = goal(data, input.goal_id);
      revision(before, input.expected_row_revision);
      if (before.status !== "active")
        throw new WriteError(
          "INVALID_STATUS_TRANSITION",
          "Ein archiviertes Ziel kann nicht mehr geändert werden. Ein neues Ziel anlegen.",
        );
      const target =
        "target_value" in input ? (input.target_value as number) : null;
      if (target !== null) checkTarget(before.kind, target);
      const update =
        target !== null
          ? { target_value: target }
          : { status: "archived" as const };
      result.goal = ArnoldGoalSchema.parse({
        ...before,
        ...update,
        updated_at_utc: now,
        row_revision: before.row_revision + 1,
      });
      changes.push({ table: "goals", before, after: result.goal });
      break;
    }
    case "log_body_weight": {
      const input = WriteInputs.log_body_weight.parse(raw);
      const today = new Intl.DateTimeFormat("en-CA", {
        timeZone: input.timezone,
      }).format(new Date(now));
      if (input.measured_on > today)
        throw new WriteError(
          "DATE_IN_FUTURE",
          `Das Datum ${input.measured_on} liegt in der Zukunft (heute ist ${today}). Es wurde nichts gespeichert.`,
        );
      // A second entry on the same day replaces the first; the old one stays
      // as a voided row, so nothing is lost.
      const sameDay = data.bodyWeights.find(
        (w) => w.status === "active" && w.measured_on === input.measured_on,
      );
      if (sameDay)
        changes.push({
          table: "bodyWeights",
          before: sameDay,
          after: ArnoldBodyWeightSchema.parse({
            ...sameDay,
            status: "voided",
            updated_at_utc: now,
            row_revision: sameDay.row_revision + 1,
          }),
        });
      result.body_weight = ArnoldBodyWeightSchema.parse({
        ...technical,
        body_weight_id: newId(),
        measured_on: input.measured_on,
        weight_kg: input.weight_kg,
        status: "active",
        source: input.source ?? "chat",
      });
      changes.push({
        table: "bodyWeights",
        before: null,
        after: result.body_weight,
      });
      break;
    }
    case "void_body_weight": {
      const input = WriteInputs.void_body_weight.parse(raw);
      const before = data.bodyWeights.find(
        (w) => w.body_weight_id === input.body_weight_id,
      );
      if (!before)
        throw new WriteError(
          "BODY_WEIGHT_NOT_FOUND",
          "Körpergewichtseintrag nicht gefunden.",
        );
      revision(before, input.expected_row_revision);
      if (before.status !== "active")
        throw new WriteError(
          "INVALID_STATUS_TRANSITION",
          "Dieser Eintrag ist bereits verworfen.",
        );
      result.body_weight = ArnoldBodyWeightSchema.parse({
        ...before,
        status: "voided",
        updated_at_utc: now,
        row_revision: before.row_revision + 1,
      });
      changes.push({
        table: "bodyWeights",
        before,
        after: result.body_weight,
      });
      break;
    }
  }
  return { changes, result };
}
