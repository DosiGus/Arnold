/**
 * get_run_analysis: one run, one week or four weeks, read from the user's own
 * data. Every figure comes from src/analytics/running (no arithmetic here);
 * strength training is counted next to it and never converted into a running
 * load. A value that cannot be given stays `{ value: null, reason }`, never 0.
 */
import { addDays, weekStart } from "../../analytics/period.js";
import {
  loadRatio,
  runMetrics,
  runTrend,
  weekMetrics,
  type PlannedRunInput,
  type RunInput,
} from "../../analytics/running/metrics/index.js";
import {
  isStrengthWorkout,
  type ArnoldDataset,
} from "../../shared/arnold-schema-v1.js";
import type {
  RunAnalysisResponse,
  RunReadInputs,
} from "../../shared/run-contract.js";
import { RunAnalysisResponseSchema } from "../../shared/run-contract.js";
import { localDay, runView } from "./views.js";
import type { z } from "zod";

export type RunAnalysisInput = z.infer<typeof RunReadInputs.get_run_analysis>;

/** A requested run does not exist for this user (or is not a run). */
export class RunNotFoundError extends Error {
  constructor() {
    super("Lauf nicht gefunden.");
    this.name = "RunNotFoundError";
  }
}

/** All runs of the dataset in the shape the metrics read. */
function runInputs(data: ArnoldDataset): RunInput[] {
  const workouts = new Map(data.workouts.map((w) => [w.workout_id, w]));
  const segments = new Map<string, (typeof data.runSegments)[number][]>();
  for (const segment of data.runSegments) {
    const list = segments.get(segment.workout_id) ?? [];
    list.push(segment);
    segments.set(segment.workout_id, list);
  }
  const inputs: RunInput[] = [];
  for (const run of data.runs) {
    const workout = workouts.get(run.workout_id);
    if (!workout || isStrengthWorkout(workout)) continue;
    inputs.push({
      ...run,
      workout_date_local: workout.workout_date_local,
      status: workout.status,
      started_at_utc: workout.started_at_utc ?? null,
      segments: segments.get(run.workout_id) ?? [],
    });
  }
  return inputs;
}

/** Strength next to running: workouts and working sets of a week, only counted. */
function strengthOfWeek(data: ArnoldDataset, start: string) {
  const end = addDays(start, 6);
  const ids = new Set(
    data.workouts
      .filter(
        (w) =>
          isStrengthWorkout(w) &&
          w.status === "completed" &&
          w.workout_date_local >= start &&
          w.workout_date_local <= end,
      )
      .map((w) => w.workout_id),
  );
  const working = data.sets.filter(
    (s) =>
      ids.has(s.workout_id) && s.status === "active" && s.set_type !== "warmup",
  ).length;
  return { workouts: ids.size, working_sets: working };
}

export function analyseRuns(
  data: ArnoldDataset,
  input: RunAnalysisInput,
  now: Date,
): RunAnalysisResponse {
  const today = localDay(now.toISOString(), input.timezone ?? "UTC");
  const reference = input.date ?? today;
  const runs = runInputs(data);
  const planned: PlannedRunInput[] = runs.map((r) => ({
    workout_id: r.workout_id,
    workout_date_local: r.workout_date_local,
    status: r.status,
  }));
  const notes: string[] = [
    "Krafttraining steht daneben (Einheiten und Arbeitssätze) und wird nicht in eine Laufbelastung umgerechnet.",
  ];

  if (input.view === "run") {
    const workout = data.workouts.find(
      (w) => w.workout_id === input.workout_id,
    );
    const run = data.runs.find((r) => r.workout_id === input.workout_id);
    if (!workout || !run || isStrengthWorkout(workout))
      throw new RunNotFoundError();
    const segments = data.runSegments.filter(
      (s) => s.workout_id === workout.workout_id,
    );
    const metrics = runMetrics(
      runs.find((r) => r.workout_id === workout.workout_id)!,
    );
    if (workout.status !== "completed")
      notes.push("Der Lauf ist nicht abgeschlossen: keine Kennzahlen.");
    return RunAnalysisResponseSchema.parse({
      view: "run",
      reference_date: workout.workout_date_local,
      run: {
        view: runView(workout, run, segments),
        metrics: JSON.parse(JSON.stringify(metrics)),
      },
      weeks: [],
      load_ratio: null,
      notes,
    });
  }

  const count = input.view === "week" ? 1 : 4;
  const weeks =
    count === 1
      ? [weekMetrics(runs, planned, reference, today)]
      : runTrend(runs, planned, reference, count, today);
  // The 7:28 ratio looks back from the reference day, never into the future.
  const ratio = loadRatio(runs, reference > today ? today : reference);
  if (ratio.value === null)
    notes.push("Das 7:28-Verhältnis ist noch nicht bekannt (siehe reason).");
  if (weeks.every((w) => w.run_count === 0))
    notes.push("In diesem Zeitraum gibt es keine abgeschlossenen Läufe.");
  return RunAnalysisResponseSchema.parse({
    view: input.view,
    reference_date: reference,
    run: null,
    weeks: weeks.map((w) => {
      const { week_start, week_end, ...running } = w;
      return {
        week_start,
        week_end,
        running: JSON.parse(JSON.stringify(running)),
        strength: strengthOfWeek(data, weekStart(week_start)),
      };
    }),
    load_ratio: JSON.parse(JSON.stringify(ratio)),
    notes,
  });
}
