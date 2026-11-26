/**
 * The progress screen's model (src/views/model/stats.ts) and the change next
 * to its charts (src/analytics/series-change.ts): the last weeks up to the
 * current one, unknown volume as a gap, a change only from known values,
 * and the exercise change straight from the analytics comparison.
 */
import { describe, expect, it } from "vitest";
import { firstLastChange } from "../src/analytics/series-change";
import type {
  ArnoldDashboardView,
  ArnoldExerciseProgressView,
} from "../src/shared/arnold-view";
import {
  exerciseSeries,
  rangeStart,
  statsExercises,
  weeklySeries,
} from "../src/views/model/stats";

const week = (
  week_start: string,
  training_days: number,
  nominal_volume: number | null,
  is_current_week = false,
) => ({
  week_start,
  label: week_start,
  iso_year: 2026,
  iso_week: 1,
  is_current_week,
  workouts: training_days,
  training_days,
  trained_dates: [],
  working_sets: 0,
  nominal_volume,
  nominal_volume_status: nominal_volume === null ? "not_available" : "valid",
});

const view = (weeks: ReturnType<typeof week>[], exercises: unknown[] = []) =>
  ({ weeks, exercises }) as unknown as ArnoldDashboardView;

describe("firstLastChange", () => {
  it("compares the first and last known value, skipping unknown ones", () => {
    expect(firstLastChange([null, 4000, null, 4600.5, null])).toEqual({
      from: 4000,
      to: 4600.5,
      delta: 600.5,
    });
  });
  it("gives no change with fewer than two known values", () => {
    expect(firstLastChange([null, 5, null])).toBeNull();
    expect(firstLastChange([])).toBeNull();
  });
  it("counts a real zero as a value", () => {
    expect(firstLastChange([0, 3])?.delta).toBe(3);
  });
});

describe("weeklySeries", () => {
  const weeks = [
    week("2026-10-26", 2, 4000),
    week("2026-11-02", 3, null),
    week("2026-11-09", 0, null),
    week("2026-11-16", 4, 5200),
    week("2026-11-23", 1, 900, true),
  ];

  it("shows the last weeks up to the current one", () => {
    const [volume, days] = weeklySeries(view(weeks), "4");
    expect(volume!.points).toEqual([null, null, 5200, 900]);
    expect(volume!.delta).toBe(-4300);
    expect(days!.points).toEqual([3, 0, 4, 1]);
    expect(days!.delta).toBe(-2);
    expect(rangeStart(view(weeks), "4")).toBe("2026-11-02");
  });

  it("labels the ends with real weeks and gives the scale", () => {
    const [volume] = weeklySeries(view(weeks), "4");
    expect(volume!.axis).toEqual({
      from: "Woche ab 2. Nov.",
      to: "diese Woche",
    });
    expect(volume!.range).toEqual({ low: 900, high: 5200 });
  });

  it("keeps all weeks when there are fewer than the range", () => {
    const [volume] = weeklySeries(view(weeks), "12");
    expect(volume!.points).toEqual([4000, null, null, 5200, 900]);
    expect(rangeStart(view(weeks), "12")).toBe("2026-10-26");
  });

  it("has no series without history", () => {
    expect(weeklySeries(view([]), "8")).toEqual([]);
    expect(rangeStart(view([]), "8")).toBeNull();
  });
});

describe("exercise curve", () => {
  it("offers the trained exercises, most logged sets first", () => {
    expect(
      statsExercises(
        view(
          [],
          [
            { exercise_id: "a", name: "Rudern", logged_sets: 10 },
            { exercise_id: "b", name: "Bankdrücken", logged_sets: 30 },
            { exercise_id: "c", name: "Neu", logged_sets: 0 },
          ],
        ),
      ).map((e) => e.id),
    ).toEqual(["b", "a"]);
    expect(statsExercises(view([], []))).toEqual([]);
  });

  it("takes points and change from the analytics answer", () => {
    const progress = {
      exercise_name: "Bankdrücken",
      selected_series: {
        points: [
          { date: "2026-11-01", value: 70 },
          { date: "2026-11-08", value: 72.5 },
        ],
      },
      selected_comparison: { status: "valid", delta: 2.5 },
    } as unknown as ArnoldExerciseProgressView;
    expect(exerciseSeries(progress)).toEqual({
      key: "e1rm",
      label: "Kraft",
      title: "Bankdrücken · geschätztes 1RM",
      unit: "kg",
      points: [70, 72.5],
      delta: 2.5,
      axis: { from: "1. Nov.", to: "8. Nov." },
      range: { low: 70, high: 72.5 },
    });
    const unavailable = {
      ...progress,
      selected_comparison: { status: "not_available", delta: null },
    } as unknown as ArnoldExerciseProgressView;
    expect(exerciseSeries(unavailable).delta).toBeNull();
  });
});
