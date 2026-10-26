import { describe, expect, test } from "vitest";
import { buildArnoldDashboardAnalytics } from "../src/analytics";
import { ArnoldDatasetSchema } from "../src/shared/arnold-schema-v1";
import {
  dataset,
  exercise,
  plan,
  planItem,
  rawDataset,
  set,
  workout,
  STAMP,
} from "./fixtures/arnold-analytics";

/**
 * Regressions for the nine findings of the independent QA review of Task 002.
 * Each test reproduces the reported defect and pins the corrected behaviour.
 */
describe("QA F1: a status filter must not turn an unfinished workout into a finished one", () => {
  const cancelled = () =>
    dataset({
      plans: [plan()],
      planItems: [planItem()],
      workouts: [
        workout({
          workout_id: "w-1",
          status: "cancelled",
          plan_version_id: "plan-v1",
          session_id: "session-a",
        }),
      ],
      sets: [set({ workout_id: "w-1", plan_item_id: "item-1" })],
    });

  test("the selection follows the filter, the completion counters never do", () => {
    const a = buildArnoldDashboardAnalytics(cancelled(), {
      filter: { workout_statuses: ["cancelled"] },
    });
    expect(a.activity.workouts.value).toBe(1);
    expect(a.activity.training_days.value).toBe(1);
    expect(a.activity.completed_workouts.value).toBe(0);
    expect(a.activity.completed_training_days.value).toBe(0);
  });

  test("plan adherence counts only finished sessions", () => {
    const a = buildArnoldDashboardAnalytics(cancelled(), {
      filter: { workout_statuses: ["cancelled"] },
    });
    expect(a.plan_adherence.completed_attributable_workouts.value).toBe(0);
    expect(a.plan_adherence.completed_attributable_working_sets.value).toBe(0);
  });

  test("a cancelled session sets no personal record", () => {
    const a = buildArnoldDashboardAnalytics(
      dataset({
        workouts: [workout({ workout_id: "w-1", status: "cancelled" })],
        sets: [set({ workout_id: "w-1", load_kg: 200, reps: 5 })],
      }),
      { filter: { workout_statuses: ["cancelled"] } },
    );
    expect(a.records.max_load).toEqual([]);
    expect(a.records.estimated_1rm).toEqual([]);
    expect(a.records.exercise_workout_volume).toEqual([]);
  });
});

describe("QA F2: volume records must not compare execution variants", () => {
  const variants = () =>
    dataset({
      workouts: [
        workout({ workout_id: "w-1", workout_date_local: "2026-01-05" }),
        workout({ workout_id: "w-2", workout_date_local: "2026-01-06" }),
        workout({ workout_id: "w-3", workout_date_local: "2026-01-07" }),
      ],
      sets: [
        set({ set_id: "s-1", workout_id: "w-1", load_kg: 40, reps: 10 }),
        set({
          set_id: "s-2",
          workout_id: "w-2",
          load_kg: 45,
          reps: 10,
          load_basis: "per_implement",
          implement_count: 1,
          execution_mode: "unilateral",
          side: "right",
        }),
        set({
          set_id: "s-3",
          workout_id: "w-3",
          load_kg: 46,
          reps: 10,
          load_basis: "per_implement",
          implement_count: 1,
          execution_mode: "unilateral",
          side: "left",
        }),
      ],
    });

  test("bilateral, right and left keep separate volume records", () => {
    const records =
      buildArnoldDashboardAnalytics(variants()).records.exercise_workout_volume;
    expect(records).toHaveLength(3);
    expect(
      records.map((record) => [
        record.comparability.execution_mode,
        record.comparability.side,
        record.value,
        record.kind,
        record.previous_value,
      ]),
      // Ordered by comparability key, so each variant stands on its own and
      // none is an improvement over another.
    ).toEqual([
      ["unilateral", "left", 460, "initial", null],
      ["unilateral", "right", 450, "initial", null],
      ["bilateral_simultaneous", null, 400, "initial", null],
    ]);
  });

  test("a volume record always names its comparability and load reference", () => {
    for (const record of buildArnoldDashboardAnalytics(variants()).records
      .exercise_workout_volume) {
      expect(record.comparability.key).toBeTruthy();
      expect(record.load_reference).toBeTruthy();
    }
  });

  test("within one variant a higher session volume is still an improvement", () => {
    const a = buildArnoldDashboardAnalytics(
      dataset({
        workouts: [
          workout({ workout_id: "w-1", workout_date_local: "2026-01-05" }),
          workout({ workout_id: "w-2", workout_date_local: "2026-01-12" }),
        ],
        sets: [
          set({ set_id: "s-1", workout_id: "w-1", load_kg: 70, reps: 10 }),
          set({ set_id: "s-2", workout_id: "w-2", load_kg: 80, reps: 10 }),
        ],
      }),
    );
    expect(a.records.exercise_workout_volume).toHaveLength(1);
    expect(a.records.exercise_workout_volume[0].value).toBe(800);
    expect(a.records.exercise_workout_volume[0].previous_value).toBe(700);
  });
});

describe("QA F3: extra work must not fulfil a skipped plan position", () => {
  const onlyOtherExercise = () =>
    dataset({
      exercises: [exercise(), exercise({ exercise_id: "ex-b" })],
      plans: [plan()],
      planItems: [planItem({ target_sets: 3 })],
      workouts: [
        workout({
          workout_id: "w-1",
          plan_version_id: "plan-v1",
          session_id: "session-a",
        }),
      ],
      sets: [1, 2, 3].map((number) =>
        set({
          set_id: `s-${number}`,
          workout_id: "w-1",
          set_number: number,
          exercise_id: "ex-b",
          exercise_order: 2,
        }),
      ),
    });

  test("three sets of the wrong exercise are nought per cent adherence", () => {
    const result =
      buildArnoldDashboardAnalytics(onlyOtherExercise()).plan_adherence;
    expect(result.planned_working_sets.value).toBe(3);
    expect(result.completed_attributable_working_sets.value).toBe(0);
    expect(result.unplanned_working_sets.value).toBe(3);
    expect(result.set_adherence_rate.value).toBe(0);
    expect(result.reasons).toContain("working_set_not_planned");
  });

  test("the skipped position and the extra work are both reported", () => {
    const result =
      buildArnoldDashboardAnalytics(onlyOtherExercise()).plan_adherence;
    expect(
      result.deviations.map((entry) => [entry.kind, entry.exercise_id]),
    ).toEqual([
      ["missing_planned_exercise", "ex-bar-press"],
      ["unplanned_exercise", "ex-b"],
    ]);
  });

  test("a session performed as planned still reaches full adherence", () => {
    const result = buildArnoldDashboardAnalytics(
      dataset({
        plans: [plan()],
        planItems: [planItem({ target_sets: 3 })],
        workouts: [
          workout({
            workout_id: "w-1",
            plan_version_id: "plan-v1",
            session_id: "session-a",
          }),
        ],
        sets: [1, 2, 3].map((number) =>
          set({
            set_id: `s-${number}`,
            workout_id: "w-1",
            set_number: number,
            plan_item_id: "item-1",
          }),
        ),
      }),
    ).plan_adherence;
    expect(result.completed_attributable_working_sets.value).toBe(3);
    expect(result.unplanned_working_sets.value).toBe(0);
    expect(result.set_adherence_rate.value).toBe(1);
    expect(result.deviations).toEqual([]);
  });
});

describe("QA F4: historical plan versions", () => {
  test("a week shared by two versions has no reliable target", () => {
    const result = buildArnoldDashboardAnalytics(
      dataset({
        plans: [
          plan({
            plan_version_id: "p-old",
            version_no: 1,
            status: "archived",
            days_per_week: 2,
            activated_at_utc: STAMP,
            retired_at_utc: "2026-01-07T00:00:00Z",
          }),
          plan({
            plan_version_id: "p-new",
            version_no: 2,
            status: "active",
            days_per_week: 4,
            activated_at_utc: "2026-01-07T00:00:00Z",
          }),
        ],
        planItems: [
          planItem({ plan_item_id: "i-old", plan_version_id: "p-old" }),
          planItem({ plan_item_id: "i-new", plan_version_id: "p-new" }),
        ],
        workouts: [
          workout({ workout_id: "w-1", workout_date_local: "2026-01-08" }),
        ],
        sets: [set({ workout_id: "w-1" })],
      }),
      { filter: { from: "2026-01-05", to: "2026-01-11" } },
    ).plan_adherence;
    expect(result.planned_sessions.value).toBeNull();
    expect(result.planned_sessions.status).toBe("not_available");
    expect(result.planned_sessions.reasons).toContain(
      "plan_changed_within_week",
    );
    // Both versions held part of the week, so both appear.
    expect(result.plan_windows.map((window) => window.plan_version_id)).toEqual(
      ["p-new", "p-old"],
    );
  });

  test("a draft never displaces the active version", () => {
    // The raw schema rejects a draft with an activation timestamp, so the
    // engine is probed with the defect directly.
    const defective = rawDataset({
      plans: [
        plan({
          plan_version_id: "p-active",
          version_no: 1,
          status: "active",
          days_per_week: 3,
        }),
        plan({
          plan_version_id: "p-draft",
          version_no: 7,
          status: "draft",
          days_per_week: 7,
          activated_at_utc: STAMP,
        }),
      ],
      planItems: [planItem({ plan_version_id: "p-active" })],
      workouts: [workout({ workout_id: "w-1" })],
      sets: [set({ workout_id: "w-1" })],
    });
    expect(ArnoldDatasetSchema.safeParse(defective).success).toBe(false);
    const result = buildArnoldDashboardAnalytics(
      defective as Parameters<typeof buildArnoldDashboardAnalytics>[0],
    ).plan_adherence;
    expect(result.planned_sessions.value).toBe(3);
    expect(result.plan_windows.map((window) => window.plan_version_id)).toEqual(
      ["p-active"],
    );
  });
});

describe("QA F5: a month comparison must not invent a month", () => {
  test("a February selection reports February only", () => {
    const a = buildArnoldDashboardAnalytics(
      dataset({
        workouts: [
          workout({ workout_id: "w-1", workout_date_local: "2026-02-10" }),
        ],
        sets: [set({ workout_id: "w-1", load_kg: 70, reps: 10 })],
      }),
      { filter: { from: "2026-02-01", to: "2026-02-28" } },
    );
    expect(
      a.weekly_trends.monthly.map((month) => [
        month.month,
        month.nominal_volume.value,
        month.volume_change_vs_previous_month.value,
      ]),
    ).toEqual([["2026-02", 700, null]]);
  });

  test("a selection spanning two months keeps the real comparison", () => {
    const a = buildArnoldDashboardAnalytics(
      dataset({
        workouts: [
          workout({ workout_id: "w-1", workout_date_local: "2026-01-20" }),
          workout({ workout_id: "w-2", workout_date_local: "2026-02-10" }),
        ],
        sets: [
          set({ set_id: "s-1", workout_id: "w-1", load_kg: 50, reps: 10 }),
          set({ set_id: "s-2", workout_id: "w-2", load_kg: 70, reps: 10 }),
        ],
      }),
      { filter: { from: "2026-01-01", to: "2026-02-28" } },
    );
    expect(
      a.weekly_trends.monthly.map((month) => [
        month.month,
        month.volume_change_vs_previous_month.value,
      ]),
    ).toEqual([
      ["2026-01", null],
      ["2026-02", 200],
    ]);
  });
});

describe("QA F6: a chart must not hide what the aggregate excludes", () => {
  test("series and aggregate agree on status and reason", () => {
    const a = buildArnoldDashboardAnalytics(
      dataset({
        workouts: [workout({ workout_id: "w-1" })],
        sets: [
          set({ set_id: "s-1", workout_id: "w-1", load_kg: 70, reps: 10 }),
          set({
            set_id: "s-2",
            workout_id: "w-1",
            set_number: 2,
            load_kg: null,
            load_basis: "bodyweight_only",
            reps: 12,
          }),
        ],
      }),
    );
    const progress = a.exercise_progress[0];
    const series = progress.series.find(
      (entry) => entry.metric === "nominal_volume",
    )!;
    expect(progress.nominal_volume.status).toBe("partial");
    expect(series.status).toBe("partial");
    expect(series.reasons).toContain("bodyweight_total_load_unavailable");
  });

  test("a fully computable series stays valid without reasons", () => {
    const a = buildArnoldDashboardAnalytics(
      dataset({
        workouts: [workout({ workout_id: "w-1" })],
        sets: [set({ workout_id: "w-1", load_kg: 70, reps: 10 })],
      }),
    );
    for (const series of a.exercise_progress[0].series) {
      expect(series.status, series.metric).toBe("valid");
      expect(series.reasons, series.metric).toEqual([]);
    }
  });
});

describe("QA F7: an overflow must not abort the evaluation", () => {
  test("two individually valid extreme sets do not throw", () => {
    const a = buildArnoldDashboardAnalytics(
      dataset({
        workouts: [workout({ workout_id: "w-1" })],
        sets: [
          set({ set_id: "s-1", workout_id: "w-1", load_kg: 1e308, reps: 1 }),
          set({
            set_id: "s-2",
            workout_id: "w-1",
            set_number: 2,
            load_kg: 1e308,
            reps: 1,
          }),
        ],
      }),
    );
    expect(a.volume.nominal_volume.value).toBeNull();
    expect(a.volume.nominal_volume.status).toBe("invalid");
    // The session total overflows, so no volume record is reportable.
    expect(a.records.exercise_workout_volume).toEqual([]);
    // The individual loads are finite, so the load record still stands.
    expect(a.records.max_load[0].value).toBe(1e308);
  });

  test("an overflowing repetition total is reported, not emitted", () => {
    // Validated data cannot reach this: the raw schema caps a repetition count
    // at the safe integer range, so two sets can never sum beyond it. The
    // guard is proven against defective input the engine must still survive.
    const defective = rawDataset({
      workouts: [workout({ workout_id: "w-1" })],
      sets: [
        set({
          set_id: "s-1",
          workout_id: "w-1",
          load_kg: 0,
          reps: Number.MAX_VALUE,
        }),
        set({
          set_id: "s-2",
          workout_id: "w-1",
          set_number: 2,
          load_kg: 0,
          reps: Number.MAX_VALUE,
        }),
      ],
    });
    expect(ArnoldDatasetSchema.safeParse(defective).success).toBe(false);
    const a = buildArnoldDashboardAnalytics(
      defective as Parameters<typeof buildArnoldDashboardAnalytics>[0],
    );
    expect(a.volume.per_workout[0].reps.value).toBeNull();
    expect(a.volume.per_workout[0].reps.status).toBe("invalid");
    expect(a.volume.per_workout[0].reps.reasons).toContain(
      "aggregate_not_finite",
    );
  });
});

describe("QA F8: set numbers sort numerically", () => {
  test("set 10 is the last set, not the second", () => {
    const a = buildArnoldDashboardAnalytics(
      dataset({
        workouts: [workout({ workout_id: "w-1" })],
        sets: [
          set({
            set_id: "s-a",
            workout_id: "w-1",
            set_number: 2,
            load_kg: 80,
            reps: 5,
          }),
          set({
            set_id: "s-b",
            workout_id: "w-1",
            set_number: 10,
            load_kg: 60,
            reps: 5,
          }),
        ],
      }),
    );
    expect(a.exercise_progress[0].last_working_load.value).toBe(60);
  });

  test("an equal record keeps the numerically earlier set", () => {
    const a = buildArnoldDashboardAnalytics(
      dataset({
        workouts: [workout({ workout_id: "w-1" })],
        sets: [
          set({
            set_id: "s-a",
            workout_id: "w-1",
            set_number: 2,
            load_kg: 70,
            reps: 5,
          }),
          set({
            set_id: "s-b",
            workout_id: "w-1",
            set_number: 10,
            load_kg: 70,
            reps: 5,
          }),
        ],
      }),
    );
    expect(a.records.max_load[0].set_id).toBe("s-a");
    expect(a.records.max_load[0].occurrences).toBe(2);
  });
});

describe("QA F9: composite keys cannot collide", () => {
  test("plan p|x session s stays apart from plan p session x|s", () => {
    const a = buildArnoldDashboardAnalytics(
      dataset({
        plans: [
          plan({ plan_version_id: "p|x", version_no: 1, status: "active" }),
          plan({
            plan_version_id: "p",
            version_no: 2,
            status: "archived",
            retired_at_utc: "2026-06-01T00:00:00Z",
          }),
        ],
        planItems: [
          planItem({
            plan_item_id: "i-1",
            plan_version_id: "p|x",
            session_id: "s",
            target_sets: 3,
          }),
          planItem({
            plan_item_id: "i-2",
            plan_version_id: "p",
            session_id: "x|s",
            target_sets: 7,
          }),
        ],
        workouts: [
          workout({
            workout_id: "w-1",
            plan_version_id: "p|x",
            session_id: "s",
          }),
        ],
        sets: [set({ workout_id: "w-1", plan_item_id: "i-1" })],
      }),
    ).plan_adherence;
    expect(a.planned_working_sets.value).toBe(3);
  });

  test("two exercises whose ids share the separator keep separate records", () => {
    const a = buildArnoldDashboardAnalytics(
      dataset({
        exercises: [
          exercise({ exercise_id: "ex|total" }),
          exercise({ exercise_id: "ex" }),
        ],
        workouts: [workout({ workout_id: "w-1" })],
        sets: [
          set({
            set_id: "s-1",
            workout_id: "w-1",
            exercise_id: "ex|total",
            load_kg: 70,
            reps: 5,
          }),
          set({
            set_id: "s-2",
            workout_id: "w-1",
            exercise_id: "ex",
            exercise_order: 2,
            load_kg: 90,
            reps: 5,
          }),
        ],
      }),
    );
    expect(a.records.max_load).toHaveLength(2);
    expect(
      a.records.max_load.map((record) => [record.exercise_id, record.value]),
    ).toEqual([
      ["ex", 90],
      ["ex|total", 70],
    ]);
  });
});
