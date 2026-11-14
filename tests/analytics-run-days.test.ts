/**
 * RUN-022: the calendar days of completed runs count as training days in the
 * activity block, the weekly and monthly trends, the week streak and the start
 * screen. A day with strength training and a run is one day. A planned,
 * in-progress, cancelled or voided run is no training day. Strength figures
 * (workouts, sets, volume, records, progress) never see a run.
 */
import { describe, expect, test } from "vitest";
import {
  buildArnoldDashboardAnalytics,
  buildHomeAnalytics,
  runTrainingDates,
} from "../src/analytics";
import type { DatasetWithRunDays } from "../src/analytics";
import type { ArnoldDataset } from "../src/shared/arnold-schema-v1";
import { dataset, set, workout } from "./fixtures/arnold-analytics";

type Options = Parameters<typeof buildArnoldDashboardAnalytics>[1];

const strength = (id: string, date: string) =>
  workout({ workout_id: id, workout_date_local: date });
const runOf = (id: string, date: string, status = "completed") =>
  workout({
    workout_id: id,
    workout_date_local: date,
    status,
    activity_type: "run",
  });

/** A dataset with the given strength days and run workouts (runs unvalidated). */
function mixed(
  strengthDays: [string, string][],
  runs: Record<string, unknown>[],
): ArnoldDataset {
  const base = dataset({
    workouts: strengthDays.map(([id, date]) => strength(id, date)),
    sets: strengthDays.map(([id], i) =>
      set({ set_id: `s-${i}`, workout_id: id }),
    ),
  });
  return { ...base, workouts: [...base.workouts, ...runs] } as ArnoldDataset;
}

const analytics = (data: ArnoldDataset, options: Options = {}) =>
  buildArnoldDashboardAnalytics(data, options);

describe("which runs count", () => {
  test("a completed run is a training day, once per calendar day", () => {
    expect(
      runTrainingDates({
        ...dataset(),
        workouts: [
          runOf("r-1", "2026-01-07"),
          runOf("r-2", "2026-01-07"),
          runOf("r-3", "2026-01-05"),
        ],
      } as unknown as ArnoldDataset),
    ).toEqual(["2026-01-05", "2026-01-07"]);
  });

  test.each(["planned", "in_progress", "cancelled", "voided"])(
    "a %s run is no training day",
    (status) => {
      const data = mixed(
        [["w-1", "2026-01-05"]],
        [runOf("r-1", "2026-01-07", status)],
      );
      const activity = analytics(data).activity;
      expect(activity.training_days.value).toBe(1);
      expect(activity.completed_training_days.value).toBe(1);
      expect(activity.weeks[0].training_days).toBe(1);
      expect(analytics(data).weekly_trends.weekly[0].trained_dates).toEqual([
        "2026-01-05",
      ]);
    },
  );

  test("strength and a run on the same day are one training day", () => {
    const data = mixed([["w-1", "2026-01-05"]], [runOf("r-1", "2026-01-05")]);
    const result = analytics(data);
    expect(result.activity.training_days.value).toBe(1);
    expect(result.activity.weeks[0].training_days).toBe(1);
    expect(result.weekly_trends.weekly[0].training_days).toBe(1);
    expect(result.weekly_trends.weekly[0].trained_dates).toEqual([
      "2026-01-05",
    ]);
    // The run is no strength workout.
    expect(result.activity.workouts.value).toBe(1);
    expect(result.weekly_trends.weekly[0].workouts).toBe(1);
  });

  test("a run on its own is one training day and no workout", () => {
    const result = analytics(
      mixed([["w-1", "2026-01-05"]], [runOf("r-1", "2026-01-07")]),
    );
    expect(result.activity.training_days.value).toBe(2);
    expect(result.activity.completed_training_days.value).toBe(2);
    expect(result.activity.workouts.value).toBe(1);
    expect(result.activity.weeks).toHaveLength(1);
    expect(result.activity.weeks[0].training_days).toBe(2);
    expect(result.activity.weeks[0].workouts).toBe(1);
    expect(result.weekly_trends.weekly[0].trained_dates).toEqual([
      "2026-01-05",
      "2026-01-07",
    ]);
    expect(result.weekly_trends.monthly[0].training_days).toBe(2);
    expect(result.activity.last_training_date).toBe("2026-01-07");
  });

  test("the calendar day comes from workout_date_local, not from UTC", () => {
    const late = {
      ...runOf("r-1", "2026-01-07"),
      started_at_utc: "2026-01-08T00:30:00Z",
    };
    const result = analytics(mixed([["w-1", "2026-01-05"]], [late]));
    expect(result.weekly_trends.weekly[0].trained_dates).toEqual([
      "2026-01-05",
      "2026-01-07",
    ]);
  });
});

describe("run-only users and weeks beyond the strength history", () => {
  test("a user with only runs has training days and a current week", () => {
    const data = mixed(
      [],
      [runOf("r-1", "2026-01-07"), runOf("r-2", "2026-01-14")],
    );
    const result = analytics(data, { weekly_goal_training_days: 1 });
    expect(result.activity.workouts.value).toBe(0);
    expect(result.activity.training_days.value).toBe(2);
    expect(result.activity.weeks.map((w) => w.week_start)).toEqual([
      "2026-01-05",
      "2026-01-12",
    ]);
    expect(result.activity.weeks.at(-1)?.is_current_week).toBe(true);
    expect(result.activity.week_streak.completed_weeks_streak.value).toBe(2);
    expect(result.activity.average_training_days_per_week.value).toBe(1);
    expect(result.weekly_trends.weekly.map((w) => w.training_days)).toEqual([
      1, 1,
    ]);
  });

  test("a run after the last strength day moves the current week", () => {
    const data = mixed([["w-1", "2026-01-05"]], [runOf("r-1", "2026-01-14")]);
    const result = analytics(data);
    expect(result.activity.weeks.map((w) => w.week_start)).toEqual([
      "2026-01-05",
      "2026-01-12",
    ]);
    expect(result.activity.weeks.at(-1)?.is_current_week).toBe(true);
    // The strength period, and so every strength figure, is unchanged.
    expect(result.metadata.period.to).toBe("2026-01-05");
  });

  test("an explicit reference date is kept", () => {
    const data = mixed([["w-1", "2026-01-05"]], [runOf("r-1", "2026-01-14")]);
    const result = analytics(data, { reference_date: "2026-01-06" });
    expect(
      result.activity.weeks.find((w) => w.is_current_week)?.week_start,
    ).toBe("2026-01-05");
  });
});

describe("week streak", () => {
  test("run days help a week reach the weekly goal", () => {
    // Goal 2: each week has one strength day plus one run day.
    const data = mixed(
      [
        ["w-1", "2026-01-05"],
        ["w-2", "2026-01-12"],
        ["w-3", "2026-01-19"],
      ],
      [runOf("r-1", "2026-01-07"), runOf("r-2", "2026-01-14")],
    );
    const result = analytics(data, {
      weekly_goal_training_days: 2,
      reference_date: "2026-01-21",
    });
    expect(result.activity.weeks.map((w) => w.training_days)).toEqual([
      2, 2, 1,
    ]);
    const streak = result.activity.week_streak;
    expect(streak.completed_weeks_streak.value).toBe(2);
    expect(streak.longest_streak.value).toBe(2);
    expect(streak.current_week_training_days).toBe(1);
    expect(streak.current_week_goal_met).toBe(false);
    // Without the runs the same weeks fall short of the goal.
    const without = analytics(
      mixed(
        [
          ["w-1", "2026-01-05"],
          ["w-2", "2026-01-12"],
          ["w-3", "2026-01-19"],
        ],
        [],
      ),
      { weekly_goal_training_days: 2, reference_date: "2026-01-21" },
    );
    expect(without.activity.week_streak.completed_weeks_streak.value).toBe(0);
  });

  test("the start screen's streak strip counts run days", () => {
    const data = mixed(
      [["w-1", "2026-01-05"]],
      [runOf("r-1", "2026-01-07"), runOf("r-2", "2026-01-08", "planned")],
    );
    const home = buildHomeAnalytics(data, {
      weekly_goal_training_days: 2,
      reference_date: "2026-01-09",
    });
    expect(home.streak.current_week_training_days).toBe(2);
    expect(home.streak.weeks.at(-1)).toMatchObject({
      week_start: "2026-01-05",
      training_days: 2,
      goal_met: true,
      is_current_week: true,
    });
    expect(home.streak.current).toBe(1);
  });
});

describe("the loader's carried run days", () => {
  test("a strength-only dataset with carried run days gives the same figures", () => {
    const full = mixed([["w-1", "2026-01-05"]], [runOf("r-1", "2026-01-07")]);
    const carried: DatasetWithRunDays = {
      ...dataset({
        workouts: [strength("w-1", "2026-01-05")],
        sets: [set({ set_id: "s-0", workout_id: "w-1" })],
      }),
      runTrainingDates: ["2026-01-07"],
    };
    expect(analytics(carried)).toEqual(analytics(full));
    expect(
      buildHomeAnalytics(carried, { weekly_goal_training_days: 2 }),
    ).toEqual(buildHomeAnalytics(full, { weekly_goal_training_days: 2 }));
  });
});

describe("what the selection does with runs", () => {
  const data = mixed(
    [
      ["w-1", "2026-01-05"],
      ["w-2", "2026-01-19"],
    ],
    [runOf("r-1", "2026-01-07"), runOf("r-2", "2026-01-21")],
  );

  test("a date range keeps only the run days inside it", () => {
    const result = analytics(data, {
      filter: { from: "2026-01-05", to: "2026-01-11" },
    });
    expect(result.activity.training_days.value).toBe(2);
    expect(result.activity.last_training_date).toBe("2026-01-07");
  });

  test("a strength-specific filter leaves runs out", () => {
    const days = (filter: NonNullable<Options>["filter"]) =>
      analytics(data, { filter }).activity.training_days.value;
    expect(days({})).toBe(4);
    expect(days({ exercise_ids: ["ex-bar-press"] })).toBe(2);
    expect(days({ set_types: ["working"] })).toBe(2);
    expect(days({ workout_ids: ["w-1"] })).toBe(1);
  });

  test("a status selection without completed counts no run", () => {
    const result = analytics(data, {
      filter: { workout_statuses: ["planned"] },
    });
    expect(result.activity.training_days.value).toBe(0);
    expect(result.activity.completed_training_days.value).toBe(0);
  });
});

describe("strength figures do not move", () => {
  test("volume, records, progress, workouts and sets are the same with runs", () => {
    const strengthDays: [string, string][] = [
      ["w-1", "2026-01-05"],
      ["w-2", "2026-01-12"],
    ];
    const withRuns = analytics(
      mixed(strengthDays, [
        runOf("r-1", "2026-01-05"),
        runOf("r-2", "2026-02-02"),
      ]),
    );
    const without = analytics(mixed(strengthDays, []));
    expect(withRuns.volume).toEqual(without.volume);
    expect(withRuns.records).toEqual(without.records);
    expect(withRuns.exercise_progress).toEqual(without.exercise_progress);
    expect(withRuns.plan_adherence).toEqual(without.plan_adherence);
    expect(withRuns.data_quality).toEqual(without.data_quality);
    expect(withRuns.activity.workouts).toEqual(without.activity.workouts);
    expect(withRuns.activity.average_workouts_per_week).toEqual(
      without.activity.average_workouts_per_week,
    );
    expect(
      withRuns.weekly_trends.weekly
        .slice(0, 2)
        .map((w) => [w.workouts, w.working_sets, w.nominal_volume]),
    ).toEqual(
      without.weekly_trends.weekly.map((w) => [
        w.workouts,
        w.working_sets,
        w.nominal_volume,
      ]),
    );
  });
});
