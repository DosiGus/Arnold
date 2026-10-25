import { describe, expect, test } from "vitest";
import { buildArnoldDashboardAnalytics } from "../src/analytics";
import { planVersionAt } from "../src/analytics/plans";
import { ArnoldPlanVersionSchema } from "../src/shared/arnold-schema-v1";
import {
  dataset,
  exercise,
  plan,
  planItem,
  set,
  workout,
  STAMP,
} from "./fixtures/arnold-analytics";

const v1 = plan({
  plan_version_id: "plan-v1",
  version_no: 1,
  status: "archived",
  days_per_week: 2,
  activated_at_utc: STAMP,
  retired_at_utc: "2026-02-01T00:00:00Z",
});
const v2 = plan({
  plan_version_id: "plan-v2",
  version_no: 2,
  status: "active",
  days_per_week: 3,
  activated_at_utc: "2026-02-01T00:00:00Z",
});
const items = [
  planItem({ plan_item_id: "item-v1-press", plan_version_id: "plan-v1" }),
  planItem({
    plan_item_id: "item-v2-press",
    plan_version_id: "plan-v2",
    session_id: "session-b",
    session_name: "Testeinheit B",
    target_sets: 4,
  }),
  planItem({
    plan_item_id: "item-v2-row",
    plan_version_id: "plan-v2",
    session_id: "session-b",
    session_name: "Testeinheit B",
    exercise_id: "ex-row",
    exercise_order: 2,
    target_sets: 3,
  }),
];

/** One v1 session as planned, one v2 session missing an exercise, one ad-hoc workout. */
function planHistory() {
  return dataset({
    exercises: [exercise(), exercise({ exercise_id: "ex-row" })],
    plans: [v1, v2],
    planItems: items,
    workouts: [
      workout({
        workout_id: "w-1",
        workout_date_local: "2026-01-05",
        plan_version_id: "plan-v1",
        session_id: "session-a",
      }),
      workout({
        workout_id: "w-2",
        workout_date_local: "2026-02-03",
        plan_version_id: "plan-v2",
        session_id: "session-b",
      }),
      workout({ workout_id: "w-3", workout_date_local: "2026-02-05" }),
    ],
    sets: [
      ...[1, 2, 3].map((number) =>
        set({
          set_id: `s-1-${number}`,
          workout_id: "w-1",
          set_number: number,
          plan_item_id: "item-v1-press",
        }),
      ),
      ...[1, 2, 3, 4].map((number) =>
        set({
          set_id: `s-2-${number}`,
          workout_id: "w-2",
          set_number: number,
          plan_item_id: "item-v2-press",
        }),
      ),
      set({ set_id: "s-3-1", workout_id: "w-3" }),
    ],
  });
}

describe("plan version history", () => {
  const plans = [v1, v2].map((raw) => ArnoldPlanVersionSchema.parse(raw));

  test("the version in force on a local date is selected", () => {
    expect(planVersionAt(plans, "2026-01-15")?.plan_version_id).toBe("plan-v1");
    expect(planVersionAt(plans, "2026-02-10")?.plan_version_id).toBe("plan-v2");
  });

  test("a date before any activation has no plan", () => {
    expect(planVersionAt(plans, "2025-12-31")).toBeNull();
  });

  test("a draft version without activation is never in force", () => {
    const draft = ArnoldPlanVersionSchema.parse(
      plan({
        plan_version_id: "plan-v3",
        version_no: 3,
        status: "draft",
        activated_at_utc: null,
      }),
    );
    expect(planVersionAt([draft], "2026-02-10")).toBeNull();
  });
});

describe("plan adherence", () => {
  const adherence = () =>
    buildArnoldDashboardAnalytics(planHistory()).plan_adherence;

  test("planned sessions come from the weekly frequency of the version in force", () => {
    const result = adherence();
    expect(result.planned_sessions.value).toBe(11);
    expect(result.planned_sessions.unit).toBe("workouts");
    expect(
      result.plan_windows.map((window) => [
        window.plan_version_id,
        window.applicable_week_starts.length,
        window.planned_sessions.value,
      ]),
    ).toEqual([
      ["plan-v1", 4, 8],
      ["plan-v2", 1, 3],
    ]);
    expect(result.weeks_without_plan).toEqual([]);
  });

  test("only workouts with a matching plan session are attributable", () => {
    const result = adherence();
    expect(result.completed_attributable_workouts.value).toBe(2);
    expect(result.unattributed_workouts.value).toBe(1);
    expect(result.session_adherence_rate.value).toBe(0.181818);
    expect(result.session_adherence_rate.unit).toBe("ratio");
  });

  test("planned and performed working sets are compared per session", () => {
    const result = adherence();
    expect(result.planned_working_sets.value).toBe(10);
    expect(result.completed_attributable_working_sets.value).toBe(7);
    expect(result.set_adherence_rate.value).toBe(0.7);
  });

  test("a planned exercise that was not trained is reported as a deviation", () => {
    const result = adherence();
    expect(
      result.deviations.map((entry) => [
        entry.kind,
        entry.workout_id,
        entry.exercise_id,
        entry.planned_working_sets,
        entry.actual_working_sets,
        entry.deviation,
      ]),
    ).toEqual([["missing_planned_exercise", "w-2", "ex-row", 3, 0, -3]]);
  });

  test("an extra exercise inside a planned session is reported as unplanned", () => {
    const base = planHistory();
    const extended = dataset({
      exercises: [...base.exercises],
      plans: [v1, v2],
      planItems: items,
      workouts: [...base.workouts],
      sets: [
        ...base.sets,
        set({
          set_id: "s-2-extra",
          workout_id: "w-2",
          exercise_id: "ex-row",
          exercise_order: 9,
          set_number: 1,
          plan_item_id: null,
        }),
      ],
    });
    const result = buildArnoldDashboardAnalytics(extended).plan_adherence;
    expect(
      result.deviations
        .filter((entry) => entry.exercise_id === "ex-row")
        .map((entry) => [entry.kind, entry.actual_working_sets]),
    ).toEqual([["set_count_deviation", 1]]);
  });

  test("a missing weekly frequency is not guessed", () => {
    const result = buildArnoldDashboardAnalytics(
      dataset({
        plans: [plan({ days_per_week: null })],
        planItems: [planItem()],
        workouts: [
          workout({
            workout_id: "w-1",
            workout_date_local: "2026-01-05",
            plan_version_id: "plan-v1",
            session_id: "session-a",
          }),
        ],
        sets: [set({ workout_id: "w-1", plan_item_id: "item-1" })],
      }),
    ).plan_adherence;
    expect(result.planned_sessions.value).toBeNull();
    expect(result.planned_sessions.reasons).toContain(
      "plan_days_per_week_not_configured",
    );
    expect(result.session_adherence_rate.value).toBeNull();
    expect(result.completed_attributable_workouts.value).toBe(1);
  });

  test("a missing target set count is not guessed", () => {
    const result = buildArnoldDashboardAnalytics(
      dataset({
        plans: [plan()],
        planItems: [planItem({ target_sets: null })],
        workouts: [
          workout({
            workout_id: "w-1",
            workout_date_local: "2026-01-05",
            plan_version_id: "plan-v1",
            session_id: "session-a",
          }),
        ],
        sets: [set({ workout_id: "w-1", plan_item_id: "item-1" })],
      }),
    ).plan_adherence;
    expect(result.planned_working_sets.value).toBeNull();
    expect(result.planned_working_sets.reasons).toContain(
      "plan_target_sets_not_configured",
    );
    expect(result.set_adherence_rate.value).toBeNull();
  });

  test("weeks before any plan activation are listed, not filled in", () => {
    const result = buildArnoldDashboardAnalytics(
      dataset({
        plans: [plan({ activated_at_utc: "2026-01-12T00:00:00Z" })],
        planItems: [planItem()],
        workouts: [
          workout({ workout_id: "w-1", workout_date_local: "2026-01-05" }),
          workout({
            workout_id: "w-2",
            workout_date_local: "2026-01-14",
            plan_version_id: "plan-v1",
            session_id: "session-a",
          }),
        ],
        sets: [
          set({ set_id: "s-1", workout_id: "w-1" }),
          set({ set_id: "s-2", workout_id: "w-2", plan_item_id: "item-1" }),
        ],
      }),
    ).plan_adherence;
    expect(result.weeks_without_plan).toEqual(["2026-01-05"]);
    expect(result.planned_sessions.value).toBe(3);
    expect(result.planned_sessions.status).toBe("partial");
    expect(result.status).toBe("partial");
  });

  test("a dataset without plans reports adherence as unavailable", () => {
    const result = buildArnoldDashboardAnalytics(
      dataset({
        workouts: [workout({ workout_id: "w-1" })],
        sets: [set({ workout_id: "w-1" })],
      }),
    ).plan_adherence;
    expect(result.status).toBe("not_available");
    expect(result.reasons).toContain("no_plan_version_applicable");
    expect(result.plan_windows).toEqual([]);
    expect(result.deviations).toEqual([]);
  });

  test("an exercise removed from the current plan keeps its history", () => {
    const result = buildArnoldDashboardAnalytics(
      dataset({
        plans: [plan()],
        planItems: [planItem({ status: "removed" })],
        workouts: [
          workout({
            workout_id: "w-1",
            workout_date_local: "2026-01-05",
            plan_version_id: "plan-v1",
            session_id: "session-a",
          }),
        ],
        sets: [set({ workout_id: "w-1", plan_item_id: "item-1", load_kg: 70 })],
      }),
    );
    expect(result.data_quality.removed_plan_items_in_use).toEqual(["item-1"]);
    expect(result.exercise_progress[0].max_comparable_load.value).toBe(70);
    expect(result.plan_adherence.planned_working_sets.value).toBeNull();
    expect(result.plan_adherence.deviations.map((entry) => entry.kind)).toEqual(
      ["unplanned_exercise"],
    );
  });
});
