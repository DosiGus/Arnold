import { describe, expect, test } from "vitest";
import { buildArnoldDashboardAnalytics } from "../src/analytics";
import {
  dataset,
  exercise,
  oneWorkout,
  set,
  workout,
} from "./fixtures/arnold-analytics";

const volumeOf = (sets: Record<string, unknown>[]) =>
  buildArnoldDashboardAnalytics(oneWorkout(sets)).volume;

describe("volume aggregation", () => {
  test("free-weight sets add up and report full coverage", () => {
    const volume = volumeOf([
      { load_kg: 70, reps: 10 },
      { load_kg: 80, reps: 8 },
    ]);
    expect(volume.nominal_volume.value).toBe(1340);
    expect(volume.nominal_volume.status).toBe("valid");
    expect(volume.nominal_volume.coverage).toEqual({
      eligible_sets: 2,
      included_sets: 2,
      excluded_sets: 0,
      excluded_reasons: [],
    });
    expect(volume.comparable_free_weight_volume.value).toBe(1340);
  });

  test("warm-up, working and supplemental sets are reported separately", () => {
    const volume = volumeOf([
      { set_type: "warmup", load_kg: 40, reps: 10 },
      { set_type: "working", load_kg: 80, reps: 5 },
      { set_type: "drop", load_kg: 60, reps: 6 },
    ]);
    expect(volume.by_bucket.warmup.value).toBe(400);
    expect(volume.by_bucket.working.value).toBe(400);
    expect(volume.by_bucket.supplemental.value).toBe(360);
    expect(volume.nominal_volume.value).toBe(1160);
  });

  test("channels stay apart and the comparable total excludes the others", () => {
    const volume = volumeOf([
      { load_kg: 70, reps: 10 },
      { set_number: 2, load_kg: 60, load_basis: "machine_display", reps: 10 },
      { set_number: 3, load_kg: 10, load_basis: "added", reps: 8 },
    ]);
    expect(volume.by_channel.free_weight.value).toBe(700);
    expect(volume.by_channel.machine_display.value).toBe(600);
    expect(volume.by_channel.added_external.value).toBe(80);
    expect(volume.nominal_volume.value).toBe(1380);
    expect(volume.comparable_free_weight_volume.value).toBe(700);
    expect(volume.comparable_free_weight_volume.status).toBe("partial");
    expect(
      volume.comparable_free_weight_volume.coverage?.excluded_reasons,
    ).toEqual([
      "added_load_total_unavailable",
      "machine_load_not_free_weight_comparable",
    ]);
  });

  test("an uncomputable set makes the total partial and names the reason", () => {
    const volume = volumeOf([
      { load_kg: 70, reps: 10 },
      {
        set_number: 2,
        load_kg: null,
        load_basis: "bodyweight_only",
        reps: 12,
      },
    ]);
    expect(volume.nominal_volume.value).toBe(700);
    expect(volume.nominal_volume.status).toBe("partial");
    expect(volume.nominal_volume.coverage).toEqual({
      eligible_sets: 2,
      included_sets: 1,
      excluded_sets: 1,
      excluded_reasons: ["bodyweight_total_load_unavailable"],
    });
  });

  test("voided sets never contribute", () => {
    const analytics = buildArnoldDashboardAnalytics(
      oneWorkout([
        { load_kg: 70, reps: 10 },
        { set_number: 2, load_kg: 999, reps: 10, status: "voided" },
      ]),
    );
    expect(analytics.volume.nominal_volume.value).toBe(700);
    expect(analytics.data_quality.set_exclusions.set_voided).toBe(1);
  });

  test("a cancelled workout contributes no volume", () => {
    const analytics = buildArnoldDashboardAnalytics(
      oneWorkout([{ load_kg: 70, reps: 10 }], { status: "cancelled" }),
    );
    expect(analytics.volume.nominal_volume.value).toBe(0);
    expect(analytics.volume.per_workout).toEqual([]);
  });

  test("volume is grouped per exercise, per workout and per calendar week", () => {
    const analytics = buildArnoldDashboardAnalytics(
      dataset({
        exercises: [exercise(), exercise({ exercise_id: "ex-row" })],
        workouts: [
          workout({ workout_id: "w-1", workout_date_local: "2026-01-05" }),
          workout({ workout_id: "w-2", workout_date_local: "2026-01-14" }),
        ],
        sets: [
          set({ set_id: "s-1", workout_id: "w-1", load_kg: 70, reps: 10 }),
          set({
            set_id: "s-2",
            workout_id: "w-1",
            exercise_id: "ex-row",
            exercise_order: 2,
            load_kg: 50,
            reps: 10,
          }),
          set({ set_id: "s-3", workout_id: "w-2", load_kg: 75, reps: 10 }),
        ],
      }),
    );
    expect(
      analytics.volume.per_exercise.map((entry) => [
        entry.exercise_id,
        entry.nominal_volume.value,
      ]),
    ).toEqual([
      ["ex-bar-press", 1450],
      ["ex-row", 500],
    ]);
    expect(
      analytics.volume.per_workout.map((entry) => [
        entry.workout_id,
        entry.nominal_volume.value,
      ]),
    ).toEqual([
      ["w-1", 1200],
      ["w-2", 750],
    ]);
    expect(
      analytics.volume.per_week.map((entry) => [
        entry.week_start,
        entry.nominal_volume.value,
      ]),
    ).toEqual([
      ["2026-01-05", 1200],
      ["2026-01-12", 750],
    ]);
  });

  test("a week without training is kept as a zero bucket", () => {
    const analytics = buildArnoldDashboardAnalytics(
      dataset({
        workouts: [
          workout({ workout_id: "w-1", workout_date_local: "2026-01-05" }),
          workout({ workout_id: "w-2", workout_date_local: "2026-01-19" }),
        ],
        sets: [
          set({ set_id: "s-1", workout_id: "w-1" }),
          set({ set_id: "s-2", workout_id: "w-2" }),
        ],
      }),
    );
    expect(analytics.volume.per_week.map((entry) => entry.week_start)).toEqual([
      "2026-01-05",
      "2026-01-12",
      "2026-01-19",
    ]);
    expect(analytics.volume.per_week[1].nominal_volume.value).toBe(0);
    expect(analytics.volume.per_week[1].sets).toBe(0);
  });

  test("repetitions are summed over the normalised repetition count", () => {
    const volume = volumeOf([
      {
        load_kg: 12,
        load_basis: "per_implement",
        implement_count: 2,
        execution_mode: "alternating",
        side: "alternating",
        reps: 10,
        reps_basis: "per_side",
      },
    ]);
    expect(volume.by_bucket.working.value).toBe(240);
    expect(volume.nominal_volume.coverage?.included_sets).toBe(1);
  });
});
