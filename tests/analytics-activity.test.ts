import { describe, expect, test } from "vitest";
import { buildArnoldDashboardAnalytics } from "../src/analytics";
import { isoWeek, weekStart } from "../src/analytics/period";
import { dataset, set, workout } from "./fixtures/arnold-analytics";

const day = (
  id: string,
  date: string,
  overrides: Record<string, unknown> = {},
) => workout({ workout_id: id, workout_date_local: date, ...overrides });

const activityOf = (
  workouts: Record<string, unknown>[],
  options: Parameters<typeof buildArnoldDashboardAnalytics>[1] = {},
) => buildArnoldDashboardAnalytics(dataset({ workouts }), options).activity;

describe("calendar helpers", () => {
  test("weeks start on Monday", () => {
    expect(weekStart("2026-01-05")).toBe("2026-01-05");
    expect(weekStart("2026-01-11")).toBe("2026-01-05");
    expect(weekStart("2026-01-12")).toBe("2026-01-12");
  });

  test("ISO week labels survive a year boundary", () => {
    expect(isoWeek("2026-01-01")).toEqual({ iso_year: 2026, iso_week: 1 });
    expect(isoWeek("2026-12-28")).toEqual({ iso_year: 2026, iso_week: 53 });
    expect(isoWeek("2027-01-01")).toEqual({ iso_year: 2026, iso_week: 53 });
    expect(isoWeek("2027-01-04")).toEqual({ iso_year: 2027, iso_week: 1 });
  });
});

describe("training activity", () => {
  test("a single workout is one workout on one training day", () => {
    const activity = activityOf([day("w-1", "2026-01-05")]);
    expect(activity.workouts.value).toBe(1);
    expect(activity.training_days.value).toBe(1);
    expect(activity.first_training_date).toBe("2026-01-05");
    expect(activity.last_training_date).toBe("2026-01-05");
    expect(activity.weeks).toHaveLength(1);
  });

  test("two workouts on one date are two workouts but one training day", () => {
    const activity = activityOf([
      day("w-1", "2026-01-05"),
      day("w-2", "2026-01-05"),
    ]);
    expect(activity.workouts.value).toBe(2);
    expect(activity.training_days.value).toBe(1);
    expect(activity.weeks[0].workouts).toBe(2);
    expect(activity.weeks[0].training_days).toBe(1);
  });

  test("a week boundary splits the buckets", () => {
    const activity = activityOf([
      day("w-1", "2026-01-11"),
      day("w-2", "2026-01-12"),
    ]);
    expect(activity.weeks.map((week) => week.week_start)).toEqual([
      "2026-01-05",
      "2026-01-12",
    ]);
    expect(activity.weeks.map((week) => week.workouts)).toEqual([1, 1]);
  });

  test("a year boundary keeps the ISO week of the Monday", () => {
    const activity = activityOf([
      day("w-1", "2026-12-31"),
      day("w-2", "2027-01-01"),
      day("w-3", "2027-01-04"),
    ]);
    expect(activity.workouts.value).toBe(3);
    expect(activity.training_days.value).toBe(3);
    expect(
      activity.weeks.map((week) => [
        week.iso_year,
        week.iso_week,
        week.workouts,
      ]),
    ).toEqual([
      [2026, 53, 2],
      [2027, 1, 1],
    ]);
  });

  test("only completed workouts count as performed sessions", () => {
    const activity = activityOf([
      day("w-done", "2026-01-05"),
      day("w-open", "2026-01-06", { status: "in_progress" }),
      day("w-stop", "2026-01-07", { status: "cancelled" }),
      day("w-void", "2026-01-08", { status: "voided" }),
      day("w-plan", "2026-01-09", { status: "planned" }),
    ]);
    expect(activity.workouts.value).toBe(1);
    expect(activity.training_days.value).toBe(1);
  });

  test("a workout status filter can widen the selection deliberately", () => {
    const activity = activityOf(
      [
        day("w-done", "2026-01-05"),
        day("w-stop", "2026-01-07", { status: "cancelled" }),
      ],
      { filter: { workout_statuses: ["completed", "cancelled"] } },
    );
    expect(activity.workouts.value).toBe(2);
  });

  test("frequency is averaged over the weeks the period spans", () => {
    const activity = activityOf([
      day("w-1", "2026-01-05"),
      day("w-2", "2026-01-07"),
      day("w-3", "2026-01-12"),
    ]);
    expect(activity.weeks).toHaveLength(2);
    expect(activity.average_workouts_per_week.value).toBe(1.5);
    expect(activity.average_training_days_per_week.value).toBe(1.5);
  });

  test("training days of the current month use the reference date", () => {
    const activity = activityOf(
      [
        day("w-1", "2026-01-28"),
        day("w-2", "2026-02-03"),
        day("w-3", "2026-02-05"),
      ],
      { reference_date: "2026-02-10" },
    );
    expect(activity.current_month).toBe("2026-02");
    expect(activity.training_days_current_month.value).toBe(2);
  });

  test("an empty selection reports zero, and averages become unavailable", () => {
    const activity = activityOf([]);
    expect(activity.workouts.value).toBe(0);
    expect(activity.training_days.value).toBe(0);
    expect(activity.average_workouts_per_week.value).toBeNull();
    expect(activity.average_workouts_per_week.reasons).toContain(
      "no_eligible_workouts",
    );
    expect(activity.current_month).toBeNull();
  });
});

describe("week streak", () => {
  const fourWeeks = [
    day("w-1", "2026-01-05"),
    day("w-2", "2026-01-07"),
    day("w-3", "2026-01-12"),
    day("w-4", "2026-01-14"),
    day("w-5", "2026-01-19"),
    day("w-6", "2026-01-26"),
    day("w-7", "2026-01-28"),
  ];

  test("no streak is reported without an explicit weekly goal", () => {
    const streak = activityOf(fourWeeks).week_streak;
    expect(streak.weekly_goal_training_days).toBeNull();
    expect(streak.completed_weeks_streak.value).toBeNull();
    expect(streak.completed_weeks_streak.reasons).toEqual([
      "weekly_goal_not_configured",
    ]);
    expect(streak.current_week_goal_met).toBeNull();
  });

  test("the running week extends the streak once its goal is met", () => {
    const streak = activityOf(fourWeeks, {
      weekly_goal_training_days: 2,
      reference_date: "2026-01-28",
    }).week_streak;
    expect(streak.current_week_training_days).toBe(2);
    expect(streak.current_week_goal_met).toBe(true);
    expect(streak.includes_current_week).toBe(true);
    expect(streak.completed_weeks_streak.value).toBe(1);
    expect(streak.longest_streak.value).toBe(2);
  });

  test("an empty running week leaves a completed streak intact", () => {
    const streak = activityOf(fourWeeks, {
      weekly_goal_training_days: 2,
      reference_date: "2026-02-02",
    }).week_streak;
    expect(streak.current_week_training_days).toBe(0);
    expect(streak.current_week_goal_met).toBe(false);
    expect(streak.includes_current_week).toBe(false);
    expect(streak.completed_weeks_streak.value).toBe(1);
  });

  test("a missed week breaks the streak at that point", () => {
    const streak = activityOf(fourWeeks, {
      weekly_goal_training_days: 3,
      reference_date: "2026-01-28",
    }).week_streak;
    expect(streak.completed_weeks_streak.value).toBe(0);
    expect(streak.longest_streak.value).toBe(0);
  });

  test("set data is not required to count training activity", () => {
    const analytics = buildArnoldDashboardAnalytics(
      dataset({
        workouts: [day("w-1", "2026-01-05")],
        sets: [set({ workout_id: "w-1" })],
      }),
      { weekly_goal_training_days: 1, reference_date: "2026-01-05" },
    );
    expect(analytics.activity.week_streak.completed_weeks_streak.value).toBe(1);
  });
});
