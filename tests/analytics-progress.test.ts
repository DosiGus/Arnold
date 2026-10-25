import { describe, expect, test } from "vitest";
import { buildArnoldDashboardAnalytics } from "../src/analytics";
import { dataset, exercise, set, workout } from "./fixtures/arnold-analytics";

type Entry = { id: string; date: string; sets: Record<string, unknown>[] };

function history(entries: Entry[], exercises = [exercise()]) {
  return dataset({
    exercises,
    workouts: entries.map((entry) =>
      workout({ workout_id: entry.id, workout_date_local: entry.date }),
    ),
    sets: entries.flatMap((entry) =>
      entry.sets.map((raw, index) =>
        set({
          set_id: `${entry.id}-${index + 1}`,
          workout_id: entry.id,
          set_number: index + 1,
          ...raw,
        }),
      ),
    ),
  });
}

const progressOf = (
  entries: Entry[],
  exercises?: ReturnType<typeof exercise>[],
) =>
  buildArnoldDashboardAnalytics(history(entries, exercises)).exercise_progress;

const seriesOf = (
  progress: ReturnType<typeof progressOf>[number],
  metric: string,
) => progress.series.find((entry) => entry.metric === metric)!;

describe("exercise progress", () => {
  test("counts, dates and loads come from the exercise's own sets", () => {
    const [progress] = progressOf([
      {
        id: "w-1",
        date: "2026-01-05",
        sets: [
          { set_type: "warmup", load_kg: 40, reps: 10 },
          { load_kg: 70, reps: 8 },
        ],
      },
      { id: "w-2", date: "2026-02-10", sets: [{ load_kg: 75, reps: 6 }] },
    ]);
    expect(progress.exercise_id).toBe("ex-bar-press");
    expect(progress.exercise_known).toBe(true);
    expect(progress.first_training_date).toBe("2026-01-05");
    expect(progress.last_training_date).toBe("2026-02-10");
    expect(progress.workouts.value).toBe(2);
    expect(progress.working_sets.value).toBe(2);
    expect(progress.warmup_sets.value).toBe(1);
    expect(progress.last_working_load.value).toBe(75);
    expect(progress.max_comparable_load.value).toBe(75);
    expect(progress.best_estimated_1rm.value).toBe(90);
    expect(progress.nominal_volume.value).toBe(1410);
  });

  test("an exercise trained in different sessions keeps one history", () => {
    const [progress] = progressOf([
      {
        id: "w-push",
        date: "2026-01-05",
        sets: [{ load_kg: 70, reps: 8 }],
      },
      {
        id: "w-upper",
        date: "2026-04-06",
        sets: [{ load_kg: 80, reps: 8 }],
      },
    ]);
    expect(progress.workouts.value).toBe(2);
    expect(seriesOf(progress, "max_load").points).toEqual([
      { date: "2026-01-05", value: 70 },
      { date: "2026-04-06", value: 80 },
    ]);
  });

  test("two workouts on one date are aggregated, never overwritten", () => {
    const [progress] = progressOf([
      { id: "w-am", date: "2026-01-05", sets: [{ load_kg: 70, reps: 10 }] },
      { id: "w-pm", date: "2026-01-05", sets: [{ load_kg: 80, reps: 6 }] },
    ]);
    expect(seriesOf(progress, "max_load").aggregation).toBe("max");
    expect(seriesOf(progress, "max_load").points).toEqual([
      { date: "2026-01-05", value: 80 },
    ]);
    expect(seriesOf(progress, "nominal_volume").points).toEqual([
      { date: "2026-01-05", value: 1180 },
    ]);
    expect(seriesOf(progress, "total_reps").points).toEqual([
      { date: "2026-01-05", value: 16 },
    ]);
    expect(seriesOf(progress, "mean_reps_per_working_set").points).toEqual([
      { date: "2026-01-05", value: 8 },
    ]);
  });

  test("load variants are listed and the dominant one leads the headline", () => {
    const [progress] = progressOf([
      {
        id: "w-1",
        date: "2026-01-05",
        sets: [
          { load_kg: 70, reps: 8 },
          { load_kg: 72, reps: 8, set_number: 2 },
          {
            load_kg: 100,
            load_basis: "machine_display",
            reps: 8,
            set_number: 3,
          },
        ],
      },
    ]);
    expect(progress.variants).toHaveLength(2);
    expect(progress.max_comparable_load.value).toBe(72);
    expect(progress.max_comparable_load_comparability?.load_basis).toBe(
      "total",
    );
    expect(progress.last_working_load_reference).toBe("machine_display");
    expect(
      progress.variants.map((variant) => [
        variant.comparability.load_basis,
        variant.working_sets,
        variant.max_load.value,
      ]),
    ).toEqual([
      ["machine_display", 1, 100],
      ["total", 2, 72],
    ]);
  });

  test("a bodyweight-only history reports no load but keeps the counts", () => {
    const [progress] = progressOf([
      {
        id: "w-1",
        date: "2026-01-05",
        sets: [{ load_kg: null, load_basis: "bodyweight_only", reps: 12 }],
      },
    ]);
    expect(progress.working_sets.value).toBe(1);
    expect(progress.last_working_load.value).toBeNull();
    expect(progress.last_working_load.reasons).toContain(
      "bodyweight_total_load_unavailable",
    );
    expect(progress.max_comparable_load.value).toBeNull();
    expect(progress.best_estimated_1rm.value).toBeNull();
    expect(progress.nominal_volume.value).toBeNull();
    expect(progress.nominal_volume.status).toBe("not_available");
  });

  test("an explicitly requested exercise without data yields a valid empty entry", () => {
    const progress = buildArnoldDashboardAnalytics(
      history([{ id: "w-1", date: "2026-01-05", sets: [{ load_kg: 70 }] }]),
      { progress_exercise_ids: ["ex-unused"] },
    ).exercise_progress;
    expect(progress).toHaveLength(1);
    expect(progress[0].exercise_id).toBe("ex-unused");
    expect(progress[0].status).toBe("not_available");
    expect(progress[0].reasons).toContain("no_eligible_sets");
    expect(progress[0].workouts.value).toBe(0);
    expect(progress[0].series.every((entry) => entry.points.length === 0)).toBe(
      true,
    );
  });

  test("series can be switched off for a lean payload", () => {
    const progress = buildArnoldDashboardAnalytics(
      history([{ id: "w-1", date: "2026-01-05", sets: [{ load_kg: 70 }] }]),
      { include_series: false },
    ).exercise_progress;
    expect(progress[0].series).toEqual([]);
    expect(progress[0].max_comparable_load.value).toBe(70);
  });

  test("a series only names a reason when something was actually skipped", () => {
    const [clean] = progressOf([
      { id: "w-1", date: "2026-01-05", sets: [{ load_kg: 70, reps: 8 }] },
    ]);
    expect(seriesOf(clean, "estimated_1rm").reasons).toEqual([]);

    const [mixed] = progressOf([
      {
        id: "w-1",
        date: "2026-01-05",
        sets: [
          { load_kg: 70, reps: 8 },
          { load_kg: 60, reps: 15, set_number: 2 },
        ],
      },
    ]);
    expect(seriesOf(mixed, "estimated_1rm").points).toHaveLength(1);
    expect(seriesOf(mixed, "estimated_1rm").reasons).toEqual([
      "reps_out_of_epley_range",
    ]);
  });

  test("a retired exercise stays a valid historical reference", () => {
    const [progress] = progressOf(
      [{ id: "w-1", date: "2026-01-05", sets: [{ load_kg: 70, reps: 8 }] }],
      [exercise({ status: "retired" })],
    );
    expect(progress.exercise_known).toBe(true);
    expect(progress.max_comparable_load.value).toBe(70);
  });
});
