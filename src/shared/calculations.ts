import type {
  Dashboard,
  Filter,
  ProgressOutput,
  Snapshot,
  TrainingSet,
  Workout,
  WorkoutDetail,
} from "./schemas.js";

export const round = (n: number) =>
  Math.round((n + Number.EPSILON) * 100) / 100;
export const trainingVolume = (sets: Pick<TrainingSet, "kg" | "reps">[]) =>
  round(sets.reduce((n, s) => n + s.kg * s.reps, 0));
/** Epley approximation. For a true single, the lifted weight is the estimate. */
export const estimated1RM = (kg: number, reps: number) =>
  round(reps === 1 ? kg : kg * (1 + reps / 30));
export function setsPerExercise(sets: TrainingSet[]): Record<string, number> {
  return sets.reduce<Record<string, number>>((counts, s) => {
    counts[s.exerciseId] = (counts[s.exerciseId] ?? 0) + 1;
    return counts;
  }, {});
}
export function validateRange(filter: Filter) {
  if (filter.startDate && filter.endDate && filter.startDate > filter.endDate)
    throw new Error("Das Startdatum muss vor dem Enddatum liegen.");
}
export function filteredWorkouts(
  snapshot: Snapshot,
  filter: Filter = {},
): WorkoutDetail[] {
  validateRange(filter);
  return snapshot.workouts
    .filter(
      (w) =>
        (!filter.split || w.split === filter.split) &&
        (!filter.startDate || w.date >= filter.startDate) &&
        (!filter.endDate || w.date <= filter.endDate),
    )
    .map((w) => {
      const sets = snapshot.sets.filter((s) => s.workoutId === w.id);
      return {
        ...w,
        sets,
        setCount: sets.length,
        volume: trainingVolume(sets),
        exerciseCount: new Set(sets.map((s) => s.exerciseId)).size,
      };
    })
    .sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id));
}
export function weekStart(date: string) {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() - ((value.getUTCDay() + 6) % 7));
  return value.toISOString().slice(0, 10);
}
export function workoutsPerWeek(workouts: WorkoutDetail[]) {
  if (!workouts.length) return [];
  const sorted = [...workouts].sort((a, b) => a.date.localeCompare(b.date));
  const weeks: Dashboard["weeks"] = [];
  const last = weekStart(sorted.at(-1)!.date);
  for (let cursor = weekStart(sorted[0].date); cursor <= last;) {
    const subset = workouts.filter((w) => weekStart(w.date) === cursor);
    weeks.push({
      week: cursor,
      workouts: subset.length,
      trainingDays: new Set(subset.map((w) => w.date)).size,
      sets: subset.reduce((n, w) => n + w.setCount, 0),
      volume: round(subset.reduce((n, w) => n + w.volume, 0)),
    });
    const next = new Date(`${cursor}T00:00:00Z`);
    next.setUTCDate(next.getUTCDate() + 7);
    cursor = next.toISOString().slice(0, 10);
  }
  return weeks;
}
/** A personal record is the heaviest set; ties prefer more reps, then the latest date. */
export function personalRecords(
  snapshot: Snapshot,
  workouts: WorkoutDetail[],
): Dashboard["records"] {
  return snapshot.exercises.flatMap((exercise) => {
    const candidates = workouts
      .flatMap((w) =>
        w.sets
          .filter((s) => s.exerciseId === exercise.id)
          .map((s) => ({ ...s, date: w.date })),
      )
      .sort(
        (a, b) =>
          b.kg - a.kg || b.reps - a.reps || b.date.localeCompare(a.date),
      );
    const best = candidates[0];
    return best
      ? [
          {
            exerciseId: exercise.id,
            exercise: exercise.name,
            kg: best.kg,
            reps: best.reps,
            estimated1RM: estimated1RM(best.kg, best.reps),
            date: best.date,
          },
        ]
      : [];
  });
}
export function buildDashboard(
  snapshot: Snapshot,
  filter: Filter = {},
): Dashboard {
  const workouts = filteredWorkouts(snapshot, filter);
  const sets = workouts.flatMap((w) => w.sets);
  const weeks = workoutsPerWeek(workouts);
  const days = new Set(workouts.map((w) => w.date)).size;
  return {
    synthetic: snapshot.connection?.synthetic ?? true,
    source: snapshot.connection?.provider ?? "local_demo",
    ...(snapshot.connection ? { connection: snapshot.connection } : {}),
    totals: {
      workouts: workouts.length,
      sets: sets.length,
      volume: trainingVolume(sets),
      trainingDays: days,
      daysPerWeek: weeks.length ? round(days / weeks.length) : 0,
    },
    period: {
      start: workouts.at(-1)?.date ?? null,
      end: workouts[0]?.date ?? null,
    },
    exercises: snapshot.exercises,
    workouts,
    weeks,
    records: personalRecords(snapshot, workouts),
  };
}
export function exerciseProgress(
  snapshot: Snapshot,
  exerciseId: string,
  filter: Filter = {},
): ProgressOutput {
  const exercise = snapshot.exercises.find((e) => e.id === exerciseId);
  if (!exercise)
    throw new Error(
      "Unbekannte Übung. Verwende eine Übungs-ID aus get_dashboard_data.",
    );
  const workouts = filteredWorkouts(snapshot, filter);
  const byDate = new Map<string, TrainingSet[]>();
  for (const workout of workouts)
    byDate.set(workout.date, [
      ...(byDate.get(workout.date) ?? []),
      ...workout.sets.filter((s) => s.exerciseId === exerciseId),
    ]);
  const points = [...byDate]
    .filter(([, sets]) => sets.length)
    .map(([date, sets]) => ({
      date,
      maxKg: Math.max(...sets.map((s) => s.kg)),
      averageReps: round(sets.reduce((n, s) => n + s.reps, 0) / sets.length),
      volume: trainingVolume(sets),
      estimated1RM: Math.max(...sets.map((s) => estimated1RM(s.kg, s.reps))),
      sets: sets.length,
    }))
    .sort((a, b) => a.date.localeCompare(b.date));
  return {
    synthetic: snapshot.connection?.synthetic ?? true,
    exercise,
    points,
  };
}
