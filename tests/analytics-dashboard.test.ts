import { describe, expect, test } from "vitest";
import {
  AnalyticsFilterError,
  AnalyticsOptionsError,
  METRICS_VERSION,
  buildArnoldDashboardAnalytics,
  parseAnalyticsFilter,
  prepareAnalytics,
} from "../src/analytics";
import {
  dataset,
  exercise,
  plan,
  planItem,
  set,
  unvalidatedDataset,
  workout,
} from "./fixtures/arnold-analytics";

function walk(value: unknown, visit: (leaf: unknown) => void): void {
  if (Array.isArray(value)) value.forEach((entry) => walk(entry, visit));
  else if (value && typeof value === "object")
    Object.values(value).forEach((entry) => walk(entry, visit));
  else visit(value);
}

const sample = () =>
  dataset({
    exercises: [exercise(), exercise({ exercise_id: "ex-row" })],
    plans: [plan()],
    planItems: [planItem()],
    workouts: [
      workout({
        workout_id: "w-1",
        workout_date_local: "2026-01-05",
        plan_version_id: "plan-v1",
        session_id: "session-a",
      }),
      workout({ workout_id: "w-2", workout_date_local: "2026-01-12" }),
    ],
    sets: [
      set({
        set_id: "s-1",
        workout_id: "w-1",
        plan_item_id: "item-1",
        load_kg: 70,
        reps: 10,
      }),
      set({
        set_id: "s-2",
        workout_id: "w-1",
        exercise_id: "ex-row",
        exercise_order: 2,
        set_type: "warmup",
        load_kg: 40,
        reps: 12,
      }),
      set({ set_id: "s-3", workout_id: "w-2", load_kg: 75, reps: 8 }),
    ],
  });

describe("dashboard analytics output", () => {
  test("metadata describes the conventions and echoes the filter", () => {
    const analytics = buildArnoldDashboardAnalytics(sample(), {
      filter: { from: "2026-01-01", to: "2026-01-31" },
      reference_date: "2026-01-15",
    });
    expect(analytics.metadata.metrics_version).toBe(METRICS_VERSION);
    expect(analytics.metadata.schema_id).toBe("arnold.training_raw");
    expect(analytics.metadata.schema_version).toBe("1.2.0");
    expect(analytics.metadata.week_starts_on).toBe("monday");
    expect(analytics.metadata.unit_mass).toBe("kg");
    expect(analytics.metadata.period).toEqual({
      from: "2026-01-01",
      to: "2026-01-31",
      weeks: 5,
      reference_date: "2026-01-15",
    });
    expect(analytics.metadata.filter.from).toBe("2026-01-01");
    expect(analytics.metadata.dataset_counts).toEqual({
      exercises: 2,
      plans: 1,
      plan_items: 1,
      workouts: 2,
      sets: 3,
    });
  });

  test("the result carries no credentials or raw row payloads", () => {
    const text = JSON.stringify(buildArnoldDashboardAnalytics(sample()));
    for (const forbidden of [
      "keyFile",
      "credentials",
      "private_key",
      "spreadsheetId",
      "created_at_utc",
      "exercise_name_snapshot",
    ])
      expect(text).not.toContain(forbidden);
  });

  test("the result is JSON-serialisable without NaN or Infinity", () => {
    const analytics = buildArnoldDashboardAnalytics(sample(), {
      weekly_goal_training_days: 2,
    });
    const roundTrip = JSON.parse(JSON.stringify(analytics));
    expect(roundTrip).toEqual(analytics);
    walk(roundTrip, (leaf) => {
      if (typeof leaf === "number") expect(Number.isFinite(leaf)).toBe(true);
    });
  });

  test("the same input produces the same output and never mutates the dataset", () => {
    const data = sample();
    const before = JSON.stringify(data);
    const first = buildArnoldDashboardAnalytics(data);
    const second = buildArnoldDashboardAnalytics(data);
    expect(second).toEqual(first);
    expect(JSON.stringify(data)).toBe(before);
  });

  test("an extreme load is reported as uncomputable, never as Infinity", () => {
    const analytics = buildArnoldDashboardAnalytics(
      dataset({
        workouts: [workout({ workout_id: "w-1" })],
        sets: [set({ workout_id: "w-1", load_kg: Number.MAX_VALUE, reps: 10 })],
      }),
    );
    expect(analytics.volume.nominal_volume.value).toBeNull();
    expect(analytics.volume.nominal_volume.status).toBe("not_available");
    expect(analytics.volume.nominal_volume.reasons).toContain(
      "volume_not_finite",
    );
  });
});

describe("filters", () => {
  test("date bounds are inclusive", () => {
    const inside = buildArnoldDashboardAnalytics(sample(), {
      filter: { from: "2026-01-05", to: "2026-01-05" },
    });
    expect(inside.activity.workouts.value).toBe(1);
    expect(inside.volume.nominal_volume.value).toBe(1180);
  });

  test("an exercise filter keeps only workouts containing that exercise", () => {
    const analytics = buildArnoldDashboardAnalytics(sample(), {
      filter: { exercise_ids: ["ex-row"] },
    });
    expect(analytics.activity.workouts.value).toBe(1);
    expect(analytics.volume.nominal_volume.value).toBe(480);
    expect(
      analytics.exercise_progress.map((entry) => entry.exercise_id),
    ).toEqual(["ex-row"]);
  });

  test("set type, plan, session and workout filters all select by id", () => {
    expect(
      buildArnoldDashboardAnalytics(sample(), {
        filter: { set_types: ["warmup"] },
      }).volume.nominal_volume.value,
    ).toBe(480);
    expect(
      buildArnoldDashboardAnalytics(sample(), {
        filter: { plan_version_ids: ["plan-v1"] },
      }).activity.workouts.value,
    ).toBe(1);
    expect(
      buildArnoldDashboardAnalytics(sample(), {
        filter: { session_ids: ["session-a"] },
      }).activity.workouts.value,
    ).toBe(1);
    expect(
      buildArnoldDashboardAnalytics(sample(), {
        filter: { workout_ids: ["w-2"] },
      }).volume.nominal_volume.value,
    ).toBe(600);
  });

  test("renaming is irrelevant because filters never use names", () => {
    const renamed = dataset({
      exercises: [exercise({ name_de: "Völlig anderer Name" })],
      workouts: [workout({ workout_id: "w-1" })],
      sets: [set({ workout_id: "w-1", load_kg: 70, reps: 10 })],
    });
    const analytics = buildArnoldDashboardAnalytics(renamed, {
      filter: { exercise_ids: ["ex-bar-press"] },
    });
    expect(analytics.volume.nominal_volume.value).toBe(700);
    expect(analytics.exercise_progress[0].name_de).toBe("Völlig anderer Name");
  });

  test("a valid filter without matches yields valid empty results", () => {
    const analytics = buildArnoldDashboardAnalytics(sample(), {
      filter: { from: "2030-01-01", to: "2030-12-31" },
    });
    expect(analytics.activity.workouts.value).toBe(0);
    expect(analytics.volume.nominal_volume.value).toBe(0);
    expect(analytics.volume.per_workout).toEqual([]);
    expect(analytics.records.max_load).toEqual([]);
    expect(analytics.exercise_progress).toEqual([]);
    expect(analytics.data_quality.analyzable).toBe(false);
    expect(analytics.data_quality.reasons).toContain("no_eligible_workouts");
  });

  test("an inverted date range is a controlled error", () => {
    expect(() =>
      buildArnoldDashboardAnalytics(sample(), {
        filter: { from: "2026-02-01", to: "2026-01-01" },
      }),
    ).toThrow(AnalyticsFilterError);
  });

  test("a date that is not a calendar date is a controlled error", () => {
    expect(() => parseAnalyticsFilter({ from: "2026-02-30" })).toThrow(
      AnalyticsFilterError,
    );
    expect(() => parseAnalyticsFilter({ to: "05.01.2026" })).toThrow(
      AnalyticsFilterError,
    );
  });

  test("an empty id list is rejected rather than silently ignored", () => {
    expect(() => parseAnalyticsFilter({ exercise_ids: [] })).toThrow(
      AnalyticsFilterError,
    );
  });

  test("duplicate filter ids are normalised", () => {
    expect(
      parseAnalyticsFilter({ exercise_ids: ["a", "a", "b"] }).exercise_ids,
    ).toEqual(["a", "b"]);
  });

  test("options outside their documented range are a controlled error", () => {
    expect(() =>
      buildArnoldDashboardAnalytics(sample(), {
        weekly_goal_training_days: 9,
      }),
    ).toThrow(AnalyticsOptionsError);
    expect(() =>
      buildArnoldDashboardAnalytics(sample(), { reference_date: "2026-13-01" }),
    ).toThrow(AnalyticsOptionsError);
  });
});

describe("data quality", () => {
  test("a dataset without workouts is reported as not analysable", () => {
    const analytics = buildArnoldDashboardAnalytics(dataset());
    expect(analytics.data_quality.analyzable).toBe(false);
    expect(analytics.data_quality.status).toBe("not_available");
    expect(analytics.data_quality.data_first_date).toBeNull();
    expect(analytics.activity.weeks).toEqual([]);
    expect(analytics.records.status).toBe("not_available");
  });

  test("a workout without sets is a training day with zero volume", () => {
    const analytics = buildArnoldDashboardAnalytics(
      dataset({ workouts: [workout({ workout_id: "w-1" })] }),
    );
    expect(analytics.activity.workouts.value).toBe(1);
    expect(analytics.volume.nominal_volume.value).toBe(0);
    expect(analytics.data_quality.eligible_sets).toBe(0);
    expect(analytics.data_quality.reasons).toContain("no_eligible_sets");
  });

  test("statuses and set types are counted over the whole dataset", () => {
    const analytics = buildArnoldDashboardAnalytics(
      dataset({
        workouts: [
          workout({ workout_id: "w-1" }),
          workout({
            workout_id: "w-2",
            workout_date_local: "2026-01-06",
            status: "cancelled",
          }),
        ],
        sets: [
          set({ set_id: "s-1", workout_id: "w-1" }),
          set({
            set_id: "s-2",
            workout_id: "w-1",
            set_number: 2,
            set_type: "warmup",
          }),
          set({
            set_id: "s-3",
            workout_id: "w-1",
            set_number: 3,
            status: "voided",
          }),
        ],
      }),
    );
    expect(analytics.data_quality.workouts_by_status).toEqual({
      cancelled: 1,
      completed: 1,
    });
    expect(analytics.data_quality.sets_by_status).toEqual({
      active: 2,
      voided: 1,
    });
    expect(analytics.data_quality.sets_by_type).toEqual({
      warmup: 1,
      working: 2,
    });
    expect(analytics.data_quality.set_exclusions.set_voided).toBe(1);
  });

  test("uncomputable but eligible sets are reported as caveats and exclusions", () => {
    const analytics = buildArnoldDashboardAnalytics(
      dataset({
        workouts: [workout({ workout_id: "w-1" })],
        sets: [
          set({ set_id: "s-1", workout_id: "w-1", load_kg: 70 }),
          set({
            set_id: "s-2",
            workout_id: "w-1",
            set_number: 2,
            load_kg: null,
            load_basis: "bodyweight_only",
          }),
          set({
            set_id: "s-3",
            workout_id: "w-1",
            set_number: 3,
            load_kg: 60,
            load_basis: "machine_display",
          }),
        ],
      }),
    );
    expect(analytics.data_quality.eligible_sets).toBe(3);
    expect(analytics.data_quality.computable_sets).toBe(2);
    expect(
      analytics.data_quality.set_exclusions.bodyweight_total_load_unavailable,
    ).toBe(1);
    expect(
      analytics.data_quality.set_caveats
        .machine_load_not_free_weight_comparable,
    ).toBe(1);
    expect(analytics.data_quality.status).toBe("partial");
  });

  test("a retired exercise still in use is surfaced", () => {
    const analytics = buildArnoldDashboardAnalytics(
      dataset({
        exercises: [exercise({ status: "retired" })],
        workouts: [workout({ workout_id: "w-1" })],
        sets: [set({ workout_id: "w-1" })],
      }),
    );
    expect(analytics.data_quality.retired_exercises_in_use).toEqual([
      "ex-bar-press",
    ]);
  });

  test("defects that validation would reject are excluded instead of crashing", () => {
    const analytics = buildArnoldDashboardAnalytics(
      unvalidatedDataset({
        exercises: [exercise()],
        workouts: [
          workout({ workout_id: "w-1" }),
          workout({ workout_id: "w-1", workout_date_local: "2026-01-06" }),
        ],
        sets: [
          set({ set_id: "s-1", workout_id: "w-1", load_kg: 70, reps: 10 }),
          set({ set_id: "s-1", workout_id: "w-1", set_number: 2 }),
          set({ set_id: "s-2", workout_id: "w-missing" }),
          set({
            set_id: "s-3",
            workout_id: "w-1",
            set_number: 3,
            exercise_id: "ex-missing",
          }),
        ],
      }),
    );
    expect(analytics.data_quality.integrity_defects).toEqual({
      duplicate_set_id: 1,
      duplicate_workout_id: 1,
      exercise_reference_missing: 1,
      workout_reference_missing: 1,
    });
    expect(analytics.data_quality.eligible_sets).toBe(1);
    expect(analytics.volume.nominal_volume.value).toBe(700);
    expect(analytics.data_quality.status).toBe("partial");
  });
});

describe("shared preparation", () => {
  test("one pass can be reused for several sections", () => {
    const input = prepareAnalytics(sample(), {
      filter: { exercise_ids: ["ex-bar-press"] },
    });
    expect(input.workouts).toHaveLength(2);
    expect(input.analyses).toHaveLength(2);
    expect(input.eligibleSets).toBe(2);
    expect(input.computableSets).toBe(2);
    expect(Object.isFrozen(input)).toBe(true);
  });
});
