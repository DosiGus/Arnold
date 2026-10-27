import { describe, expect, test } from "vitest";
import {
  buildArnoldDashboardAnalytics,
  computeRecords,
  prepareAnalytics,
} from "../src/analytics";
import {
  dataset,
  exercise,
  oneWorkout,
  plan,
  planItem,
  set,
  workout,
} from "./fixtures/arnold-analytics";
import {
  parseArnoldTables,
  ArnoldDataError,
} from "../src/server/arnold-sheet-parser";
import { setCell, v1Tables } from "./fixtures/arnold-v1";

function plannedWorkout(status = "completed") {
  return dataset({
    plans: [plan()],
    planItems: [planItem()],
    workouts: [
      workout({ plan_version_id: "plan-v1", session_id: "session-a", status }),
    ],
    sets: [set({ plan_item_id: "item-1" })],
  });
}

describe("Task 003 QA — inherited Task 002 analytics regressions", () => {
  test.each(["planned", "in_progress", "cancelled"] as const)(
    "F1 %s is not counted as completed training even when selected",
    (status) => {
      const result = buildArnoldDashboardAnalytics(plannedWorkout(status), {
        filter: { workout_statuses: [status] },
      });
      expect.soft(result.activity.completed_workouts.value).toBe(0);
      expect.soft(result.activity.completed_training_days.value).toBe(0);
      expect
        .soft(result.plan_adherence.completed_attributable_workouts.value)
        .toBe(0);
    },
  );

  test("F2 workout-volume records retain execution comparability", () => {
    const result = buildArnoldDashboardAnalytics(
      dataset({
        workouts: [
          workout({
            workout_id: "bilateral",
            workout_date_local: "2026-01-05",
          }),
          workout({ workout_id: "right", workout_date_local: "2026-01-06" }),
          workout({ workout_id: "left", workout_date_local: "2026-01-07" }),
        ],
        sets: [
          set({
            set_id: "b",
            workout_id: "bilateral",
            load_basis: "per_implement",
            implement_count: 2,
            load_kg: 20,
          }),
          set({
            set_id: "r",
            workout_id: "right",
            execution_mode: "unilateral",
            side: "right",
            load_basis: "per_implement",
            load_kg: 45,
          }),
          set({
            set_id: "l",
            workout_id: "left",
            execution_mode: "unilateral",
            side: "left",
            load_basis: "per_implement",
            load_kg: 46,
          }),
        ],
      }),
    );
    expect(result.records.exercise_workout_volume).toHaveLength(3);
    expect(
      result.records.exercise_workout_volume.every(
        (record) => record.comparability !== null,
      ),
    ).toBe(true);
  });

  test("F3 unrelated extra exercises cannot fulfill the planned working sets", () => {
    const result = buildArnoldDashboardAnalytics(
      dataset({
        exercises: [exercise(), exercise({ exercise_id: "extra" })],
        plans: [plan()],
        planItems: [planItem({ target_sets: 3 })],
        workouts: [
          workout({ plan_version_id: "plan-v1", session_id: "session-a" }),
        ],
        sets: [1, 2, 3].map((n) =>
          set({
            set_id: `extra-${n}`,
            set_number: n,
            exercise_id: "extra",
            plan_item_id: null,
          }),
        ),
      }),
    );
    expect(
      result.plan_adherence.completed_attributable_working_sets.value,
    ).toBe(0);
    expect(result.plan_adherence.set_adherence_rate.value).toBe(0);
  });

  test("F4 a midweek plan change cannot yield a complete target using only Monday's plan", () => {
    const result = buildArnoldDashboardAnalytics(
      dataset({
        plans: [
          plan({
            status: "archived",
            days_per_week: 2,
            retired_at_utc: "2026-01-07T12:00:00Z",
          }),
          plan({
            plan_version_id: "plan-v2",
            version_no: 2,
            days_per_week: 4,
            activated_at_utc: "2026-01-07T12:00:00Z",
          }),
        ],
        planItems: [
          planItem(),
          planItem({
            plan_item_id: "item-2",
            plan_version_id: "plan-v2",
            session_id: "session-b",
          }),
        ],
        workouts: [
          workout({
            workout_date_local: "2026-01-08",
            plan_version_id: "plan-v2",
            session_id: "session-b",
          }),
        ],
        sets: [set({ plan_item_id: "item-2" })],
      }),
      { filter: { from: "2026-01-05", to: "2026-01-11" } },
    );
    expect(result.plan_adherence.planned_sessions.status).not.toBe("valid");
  });

  test("F5 monthly filter does not fabricate an empty previous month from the first Monday", () => {
    const result = buildArnoldDashboardAnalytics(
      oneWorkout([{ load_kg: 70 }], { workout_date_local: "2026-02-01" }),
      { filter: { from: "2026-02-01", to: "2026-02-28" } },
    );
    expect(result.weekly_trends.monthly.map((bucket) => bucket.month)).toEqual([
      "2026-02",
    ]);
    expect(
      result.weekly_trends.monthly[0].volume_change_vs_previous_month.value,
    ).toBeNull();
  });

  test("F6 a volume series with unknown contributions remains explicitly partial", () => {
    const result = buildArnoldDashboardAnalytics(
      oneWorkout([
        { load_kg: 70, reps: 10 },
        { load_basis: "bodyweight_only", load_kg: null, reps: 10 },
      ]),
    );
    const progress = result.exercise_progress[0];
    expect(progress.nominal_volume.status).toBe("partial");
    const series = progress.series.find(
      (value) => value.metric === "nominal_volume",
    )!;
    expect(series.status).toBe("partial");
    expect(series.reasons).toContain("bodyweight_total_load_unavailable");
  });

  test("F7 overflow while summing finite sets cannot crash the dashboard", () => {
    const data = oneWorkout([
      { load_kg: 1e308, reps: 1 },
      { load_kg: 1e308, reps: 1 },
    ]);
    expect(() => buildArnoldDashboardAnalytics(data)).not.toThrow();
  });

  test("F7 public record output cannot contain non-finite numbers", () => {
    const data = oneWorkout([
      { load_kg: 1e308, reps: 1 },
      { load_kg: 1e308, reps: 1 },
    ]);
    const result = computeRecords(prepareAnalytics(data));
    expect(
      result.exercise_workout_volume.every((record) =>
        Number.isFinite(record.value),
      ),
    ).toBe(true);
  });

  test("F7 summing individually safe repetition counts cannot crash the dashboard", () => {
    const data = oneWorkout([
      { load_kg: 0, reps: Number.MAX_SAFE_INTEGER },
      { load_kg: 0, reps: Number.MAX_SAFE_INTEGER },
    ]);
    expect(() => buildArnoldDashboardAnalytics(data)).not.toThrow();
  });

  test("F8 the last load uses numeric set order, so set 10 follows set 2", () => {
    const data = oneWorkout([
      { set_number: 2, load_kg: 80 },
      { set_number: 10, load_kg: 60 },
    ]);
    expect(
      buildArnoldDashboardAnalytics(data).exercise_progress[0].last_working_load
        .value,
    ).toBe(60);
  });

  test("F8 tied records retain the first set in numeric set order", () => {
    const data = oneWorkout([
      { set_number: 2, load_kg: 80 },
      { set_number: 10, load_kg: 80 },
    ]);
    expect(buildArnoldDashboardAnalytics(data).records.max_load[0].set_id).toBe(
      "s-1",
    );
  });

  test("F9 opaque plan/session IDs cannot collide through a pipe separator", () => {
    const result = buildArnoldDashboardAnalytics(
      dataset({
        exercises: [exercise(), exercise({ exercise_id: "other" })],
        plans: [
          plan({
            plan_version_id: "p|x",
            status: "archived",
            retired_at_utc: "2026-02-01T00:00:00Z",
          }),
          plan({
            plan_version_id: "p",
            version_no: 2,
            activated_at_utc: "2026-02-01T00:00:00Z",
          }),
        ],
        planItems: [
          planItem({
            plan_item_id: "one",
            plan_version_id: "p|x",
            session_id: "s",
            target_sets: 3,
          }),
          planItem({
            plan_item_id: "two",
            plan_version_id: "p",
            session_id: "x|s",
            exercise_id: "other",
            target_sets: 7,
          }),
        ],
        workouts: [workout({ plan_version_id: "p|x", session_id: "s" })],
        sets: [1, 2, 3].map((n) =>
          set({ set_id: `s-${n}`, set_number: n, plan_item_id: "one" }),
        ),
      }),
    );
    expect(result.plan_adherence.planned_working_sets.value).toBe(3);
    expect(result.plan_adherence.deviations).toEqual([]);
  });
});
