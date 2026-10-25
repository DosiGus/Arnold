import { describe, expect, it } from "vitest";
import {
  buildDashboard,
  estimated1RM,
  exerciseProgress,
  filteredWorkouts,
  personalRecords,
  setsPerExercise,
  trainingVolume,
  weekStart,
  workoutsPerWeek,
} from "../src/shared/calculations";
import { createFixture } from "../src/server/fixture";

describe("storage-independent calculations", () => {
  it("calculates volume from kg × reps without rounding away half kilograms", () => {
    expect(
      trainingVolume([
        { kg: 50, reps: 10 },
        { kg: 52.5, reps: 8 },
      ]),
    ).toBe(920);
    expect(trainingVolume([{ kg: 7.5, reps: 11 }])).toBe(82.5);
    expect(trainingVolume([])).toBe(0);
  });
  it("estimates Epley 1RM, including a true single and zero load", () => {
    expect(estimated1RM(60, 10)).toBe(80);
    expect(estimated1RM(100, 1)).toBe(100);
    expect(estimated1RM(0, 10)).toBe(0);
  });
  it("preserves the original deterministic 12-workout, 108-set fixture exactly", () => {
    const snapshot = createFixture();
    const dashboard = buildDashboard(snapshot);
    expect(snapshot).toEqual(createFixture());
    expect(dashboard.totals).toEqual({
      workouts: 12,
      sets: 108,
      volume: 40021,
      trainingDays: 12,
      daysPerWeek: 3,
    });
    expect(dashboard.period).toEqual({
      start: "2026-09-28",
      end: "2026-10-23",
    });
    expect(dashboard.weeks.map((w) => w.volume)).toEqual([
      8959, 9656.5, 10354, 11051.5,
    ]);
    expect(new Set(snapshot.sets.map((s) => s.id)).size).toBe(108);
    expect(Object.values(setsPerExercise(snapshot.sets))).toEqual(
      Array(9).fill(12),
    );
  });
  it("uses UTC Monday weeks across year boundaries", () => {
    expect(weekStart("2027-01-03")).toBe("2026-12-28");
    expect(weekStart("2027-01-04")).toBe("2027-01-04");
  });
  it("counts missing calendar weeks as zero and distinct training dates", () => {
    const snapshot = createFixture();
    const items = filteredWorkouts(snapshot);
    const weeks = workoutsPerWeek([
      items.find((w) => w.date === "2026-09-28")!,
      items.find((w) => w.date === "2026-10-19")!,
    ]);
    expect(weeks.map((w) => w.workouts)).toEqual([1, 0, 0, 1]);
    expect(workoutsPerWeek([])).toEqual([]);
  });
  it("filters dates inclusively and filters splits", () => {
    expect(
      filteredWorkouts(createFixture(), {
        startDate: "2026-09-28",
        endDate: "2026-10-02",
      }),
    ).toHaveLength(3);
    expect(
      buildDashboard(createFixture(), { split: "Push" }).totals.volume,
    ).toBe(10571);
    expect(filteredWorkouts(createFixture(), { split: "Legs" })).toHaveLength(
      4,
    );
    expect(() =>
      filteredWorkouts(createFixture(), {
        startDate: "2026-10-05",
        endDate: "2026-10-01",
      }),
    ).toThrow("Startdatum");
  });
  it("reports heaviest records with reps and estimated 1RM", () => {
    const snapshot = createFixture();
    const records = personalRecords(snapshot, filteredWorkouts(snapshot));
    expect(records.find((r) => r.exerciseId === "bench-press")).toEqual({
      exerciseId: "bench-press",
      exercise: "Bankdrücken",
      kg: 57.5,
      reps: 11,
      date: "2026-10-19",
      estimated1RM: 78.58,
    });
  });
  it("aggregates exercise progress once per training date", () => {
    const progress = exerciseProgress(createFixture(), "bench-press");
    expect(progress.points.map((p) => p.maxKg)).toEqual([50, 52.5, 55, 57.5]);
    expect(progress.points[0]).toEqual({
      date: "2026-09-28",
      maxKg: 50,
      averageReps: 10.33,
      volume: 1550,
      estimated1RM: 68.33,
      sets: 3,
    });
    expect(() => exerciseProgress(createFixture(), "unknown")).toThrow(
      "Unbekannte Übung",
    );
  });
  it("handles valid empty ranges without Infinity, NaN, or invented records", () => {
    const empty = buildDashboard(createFixture(), { startDate: "2030-01-01" });
    expect(empty.totals).toEqual({
      workouts: 0,
      sets: 0,
      volume: 0,
      daysPerWeek: 0,
      trainingDays: 0,
    });
    expect(empty.period).toEqual({ start: null, end: null });
    expect(empty.records).toEqual([]);
    expect(
      exerciseProgress(createFixture(), "squat", { endDate: "2020-01-01" })
        .points,
    ).toEqual([]);
  });
});
