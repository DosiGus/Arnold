/**
 * The start screen's figures (src/analytics/home.ts, goals.ts). All data is
 * invented; dates are calendar strings, never derived from a clock.
 */
import { describe, expect, test } from "vitest";
import { buildHomeAnalytics } from "../src/analytics";
import { goalProgress } from "../src/analytics/goals";
import {
  bodyWeight,
  dataset,
  exercise,
  goal,
  plan,
  planItem,
  set,
  workout,
} from "./fixtures/arnold-analytics";

const day = (id: string, date: string, extra: Record<string, unknown> = {}) =>
  workout({ workout_id: id, workout_date_local: date, ...extra });

describe("streak", () => {
  test("counts weeks that reached the goal, any days, and keeps the running week open", () => {
    // Goal 2 days per week. Week of 5 Jan: 2 days, 12 Jan: 1 day,
    // 19 Jan: 2, 26 Jan: 2, 2 Feb (current, reference 3 Feb): 1 so far.
    const workouts = [
      day("a", "2026-01-05"),
      day("b", "2026-01-09"),
      day("c", "2026-01-13"),
      day("d", "2026-01-20"),
      day("e", "2026-01-25"),
      day("f", "2026-01-26"),
      day("g", "2026-01-31"),
      day("h", "2026-02-02"),
    ];
    const home = buildHomeAnalytics(dataset({ workouts }), {
      reference_date: "2026-02-03",
      weekly_goal_training_days: 2,
    });
    expect(home.streak.current).toBe(2);
    expect(home.streak.longest).toBe(2);
    expect(home.streak.is_best).toBe(true);
    expect(home.streak.current_week_training_days).toBe(1);
    expect(home.streak.weeks).toHaveLength(8);
    expect(home.streak.weeks.at(-1)).toMatchObject({
      week_start: "2026-02-02",
      is_current_week: true,
      goal_met: false,
    });
    expect(home.streak.weeks.slice(-5).map((w) => w.goal_met)).toEqual([
      true,
      false,
      true,
      true,
      false,
    ]);
  });

  test("reports no streak without a weekly goal instead of inventing one", () => {
    const home = buildHomeAnalytics(
      dataset({ workouts: [day("a", "2026-01-05")] }),
      { reference_date: "2026-01-06" },
    );
    expect(home.streak.current).toBeNull();
    expect(home.streak.weekly_goal).toBeNull();
  });
});

describe("year, month and strength", () => {
  test("counts completed workouts of the reference year and finds the best month", () => {
    const workouts = [
      day("a", "2025-12-30"),
      day("b", "2026-01-05"),
      day("c", "2026-02-02"),
      day("d", "2026-02-04"),
      day("x", "2026-02-05", { status: "cancelled" }),
    ];
    const home = buildHomeAnalytics(dataset({ workouts }), {
      reference_date: "2026-02-06",
    });
    expect(home.workouts_this_year).toBe(3);
    expect(home.best_month).toEqual({ month: "2026-02", workouts: 2 });
  });

  test("strength change compares the first and last estimated 1RM per exercise", () => {
    const workouts = [day("a", "2026-01-05"), day("b", "2026-02-02")];
    const sets = [
      set({ set_id: "s1", workout_id: "a", load_kg: 100, reps: 5 }),
      set({ set_id: "s2", workout_id: "b", load_kg: 110, reps: 5 }),
    ];
    const home = buildHomeAnalytics(dataset({ workouts, sets }), {
      reference_date: "2026-02-03",
    });
    expect(home.strength_change.percent).toBeCloseTo(10, 5);
    expect(home.strength_change.since).toBe("2026-01-05");
    expect(home.muscle_groups).toEqual([
      expect.objectContaining({
        name: "chest",
        strength_change_pct: expect.closeTo(10, 5),
        records: 1,
        sets_per_week: 0.25,
      }),
    ]);
  });
});

describe("records", () => {
  test("a one-arm exercise with both sides better is one record, not two", () => {
    const row = exercise({
      exercise_id: "ex-row",
      name_de: "Rudern einarmig",
      primary_muscle: "back",
      default_load_basis: "per_implement",
      default_execution_mode: "unilateral",
    });
    const side = (id: string, w: string, s: "left" | "right", kg: number) =>
      set({
        set_id: id,
        workout_id: w,
        exercise_id: "ex-row",
        exercise_name_snapshot: "Rudern einarmig",
        load_kg: kg,
        load_basis: "per_implement",
        execution_mode: "unilateral",
        side: s,
      });
    const home = buildHomeAnalytics(
      dataset({
        exercises: [row],
        workouts: [day("a", "2026-01-05"), day("b", "2026-01-12")],
        sets: [
          side("s1", "a", "left", 20),
          side("s2", "a", "right", 20),
          side("s3", "b", "left", 22),
          side("s4", "b", "right", 22),
        ],
      }),
      { reference_date: "2026-01-13" },
    );
    expect(home.records).toHaveLength(1);
    expect(home.records[0]).toMatchObject({
      metric: "max_load",
      value: 22,
      previous_value: 20,
      load_basis: "per_implement",
      achieved_on: "2026-01-12",
    });
    expect(home.records_by_exercise[0]).toMatchObject({ count: 1 });
  });

  test("more bodyweight repetitions count as a record; the first time does not", () => {
    const pullup = exercise({
      exercise_id: "ex-pull",
      name_de: "Klimmzüge",
      default_load_basis: "bodyweight_only",
    });
    const reps = (id: string, w: string, n: number) =>
      set({
        set_id: id,
        workout_id: w,
        exercise_id: "ex-pull",
        exercise_name_snapshot: "Klimmzüge",
        load_kg: null,
        load_basis: "bodyweight_only",
        reps: n,
      });
    const home = buildHomeAnalytics(
      dataset({
        exercises: [pullup],
        workouts: [day("a", "2026-01-05"), day("b", "2026-01-12")],
        sets: [reps("s1", "a", 5), reps("s2", "b", 7)],
      }),
      { reference_date: "2026-01-13" },
    );
    expect(
      home.records.map((r) => [r.metric, r.value, r.previous_value]),
    ).toEqual([["max_reps_bodyweight", 7, 5]]);
  });

  test("an unfinished workout never sets a record", () => {
    const home = buildHomeAnalytics(
      dataset({
        workouts: [
          day("a", "2026-01-05"),
          day("b", "2026-01-12", { status: "in_progress" }),
        ],
        sets: [
          set({ set_id: "s1", workout_id: "a", load_kg: 60 }),
          set({ set_id: "s2", workout_id: "b", load_kg: 80 }),
        ],
      }),
      { reference_date: "2026-01-13" },
    );
    expect(home.records).toEqual([]);
  });
});

describe("goals", () => {
  test("a body weight goal goes down, with a rate and an estimate", () => {
    const data = dataset({
      goals: [
        goal({
          kind: "body_weight",
          exercise_id: null,
          load_basis: null,
          target_value: 80,
          start_value: 86,
        }),
      ],
      bodyWeights: [
        bodyWeight({
          body_weight_id: "b1",
          measured_on: "2026-01-05",
          weight_kg: 86,
        }),
        bodyWeight({
          body_weight_id: "b2",
          measured_on: "2026-01-19",
          weight_kg: 85,
        }),
        bodyWeight({
          body_weight_id: "b3",
          measured_on: "2026-01-19",
          weight_kg: 99,
          status: "voided",
        }),
        bodyWeight({
          body_weight_id: "b4",
          measured_on: "2026-02-02",
          weight_kg: 84,
        }),
      ],
    });
    const progress = goalProgress(data, data.goals[0]);
    expect(progress.current_value).toBe(84);
    expect(progress.progress).toBeCloseTo(1 / 3, 5);
    expect(progress.achieved).toBe(false);
    expect(progress.rate_per_week).toBeCloseTo(-0.5, 5);
    expect(progress.eta_weeks).toBe(8);
    expect(progress.points.map((p) => p.value)).toEqual([86, 85, 84]);
  });

  test("an exercise goal counts only completed working sets in its load convention", () => {
    const data = dataset({
      workouts: [
        day("a", "2026-01-05"),
        day("b", "2026-01-19"),
        day("c", "2026-01-20", { status: "in_progress" }),
      ],
      sets: [
        set({ set_id: "s1", workout_id: "a", load_kg: 80 }),
        set({
          set_id: "w1",
          workout_id: "a",
          set_number: 2,
          load_kg: 95,
          set_type: "warmup",
        }),
        set({ set_id: "s2", workout_id: "b", load_kg: 90 }),
        set({ set_id: "s3", workout_id: "c", load_kg: 120 }),
      ],
      goals: [goal({ start_value: 80, target_value: 100 })],
    });
    const progress = goalProgress(data, data.goals[0]);
    expect(progress.current_value).toBe(90);
    expect(progress.progress).toBeCloseTo(0.5, 5);
    expect(progress.rate_per_week).toBeCloseTo(5, 5);
    expect(progress.eta_weeks).toBe(2);
  });

  test("a reached goal is achieved and full", () => {
    const data = dataset({
      workouts: [day("a", "2026-01-05")],
      sets: [set({ set_id: "s1", workout_id: "a", reps: 12 })],
      goals: [
        goal({
          kind: "exercise_reps",
          load_basis: null,
          target_value: 12,
          start_value: 8,
        }),
      ],
    });
    const progress = goalProgress(data, data.goals[0]);
    expect(progress).toMatchObject({
      achieved: true,
      progress: 1,
      eta_weeks: null,
      unit: "reps",
    });
  });

  test("without a measurement the progress stays unknown, never 0", () => {
    const data = dataset({ goals: [goal()] });
    const progress = goalProgress(data, data.goals[0]);
    expect(progress.current_value).toBeNull();
    expect(progress.progress).toBeNull();
  });

  test("only active goals reach the start screen", () => {
    const home = buildHomeAnalytics(
      dataset({
        goals: [
          goal(),
          goal({
            goal_id: "goal-2",
            status: "archived",
            kind: "exercise_reps",
            load_basis: null,
            target_value: 10,
          }),
        ],
      }),
      { reference_date: "2026-01-06" },
    );
    expect(home.goals.map((g) => g.goal_id)).toEqual(["goal-1"]);
  });
});

describe("next session", () => {
  test("follows the last trained session of the active plan and wraps around", () => {
    const items = [
      planItem(),
      planItem({
        plan_item_id: "item-2",
        session_id: "session-b",
        session_order: 2,
        session_name: "Testeinheit B",
      }),
    ];
    const base = { plans: [plan()], planItems: items };
    const none = buildHomeAnalytics(dataset(base), {});
    expect(none.next_session?.session_name).toBe("Testeinheit A");
    const afterB = buildHomeAnalytics(
      dataset({
        ...base,
        workouts: [
          day("a", "2026-01-05", {
            plan_version_id: "plan-v1",
            session_id: "session-a",
          }),
          day("b", "2026-01-07", {
            plan_version_id: "plan-v1",
            session_id: "session-b",
          }),
        ],
      }),
      {},
    );
    expect(afterB.next_session).toMatchObject({
      session_id: "session-a",
      exercise_count: 1,
    });
  });
});

describe("data contract", () => {
  test("refuses two active goals for the same thing and two weights on one day", () => {
    expect(() =>
      dataset({ goals: [goal(), goal({ goal_id: "goal-2" })] }),
    ).toThrow(/aktives Ziel/);
    expect(() =>
      dataset({
        bodyWeights: [bodyWeight(), bodyWeight({ body_weight_id: "bw-2" })],
      }),
    ).toThrow(/höchstens einen/);
  });

  test("refuses a goal that does not fit its kind", () => {
    expect(() => dataset({ goals: [goal({ exercise_id: null })] })).toThrow();
    expect(() =>
      dataset({ goals: [goal({ kind: "body_weight", load_basis: null })] }),
    ).toThrow();
    expect(() =>
      dataset({ goals: [goal({ exercise_id: "unknown" })] }),
    ).toThrow(/EXERCISES/);
  });

  test("a dataset written before goals existed still reads", () => {
    const data = dataset();
    expect(data.goals).toEqual([]);
    expect(data.bodyWeights).toEqual([]);
  });
});

describe("today and the week, per kind", () => {
  const run = (
    workout_id: string,
    date: string,
    status: "planned" | "completed",
  ) => ({
    workout_id,
    date,
    status,
    name: "Grundlage",
    planned_seconds: 2400,
    planned_distance_m: null,
    timer_s: status === "completed" ? 1800 : null,
    distance_m: null,
  });
  const home = buildHomeAnalytics(
    dataset({
      workouts: [
        day("mon", "2026-02-02"),
        day("today", "2026-02-04", { session_name_snapshot: "Push" }),
        day("open", "2026-02-04", { status: "in_progress" }),
      ],
    }),
    {
      reference_date: "2026-02-04",
      day_runs: {
        has_run_plan: true,
        runs: [
          run("r-done", "2026-02-03", "completed"),
          run("r-missed", "2026-02-02", "planned"),
          run("r-today", "2026-02-04", "planned"),
          run("r-later", "2026-02-12", "planned"),
          run("r-next", "2026-02-06", "planned"),
        ],
      },
    },
  );

  test("names what was done today and what is still planned", () => {
    expect(home.today).toMatchObject({
      date: "2026-02-04",
      has_run_plan: true,
    });
    expect(home.today!.done.map((s) => [s.kind, s.name])).toEqual([
      ["strength", "Push"],
    ]);
    expect(home.today!.planned_runs.map((r) => r.workout_id)).toEqual([
      "r-today",
    ]);
    expect(home.today!.next_run?.workout_id).toBe("r-next");
  });

  test("lists the week's completed trainings; unknown distance stays null", () => {
    expect(home.week_sessions.map((s) => s.workout_id)).toEqual([
      "mon",
      "r-done",
      "today",
    ]);
    expect(home.week_sessions[1]).toMatchObject({
      timer_s: 1800,
      distance_m: null,
      working_sets: null,
    });
  });
});
