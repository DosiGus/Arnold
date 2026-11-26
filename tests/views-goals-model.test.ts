/**
 * The goals screen's model (src/views/model/goals.ts): Arnold's goals become
 * rows (unknown current value stays "–"), the form becomes exactly one of
 * Arnold's three goal kinds, and bad targets are named, never sent.
 */
import { describe, expect, it } from "vitest";
import type { ArnoldDashboardView, HomeGoal } from "../src/shared/arnold-view";
import { WriteInputs } from "../src/shared/workout-contract";
import {
  archiveGoalInput,
  createGoalInput,
  goalChoices,
  goalErrorText,
  goalRows,
  unitsFor,
  updateGoalInput,
} from "../src/views/model/goals";

const goal = (over: Partial<HomeGoal>): HomeGoal => ({
  goal_id: "g-1",
  row_revision: 3,
  kind: "exercise_load",
  exercise_id: "bench",
  name: "Bankdrücken",
  unit: "kg",
  load_basis: "total",
  target_value: 80,
  start_value: 60,
  current_value: 62.5,
  current_date: "2026-11-20",
  progress: 0.125,
  achieved: false,
  rate_per_week: null,
  eta_weeks: null,
  points: [],
  ...over,
});

const option = (
  id: string,
  name: string,
  over: Partial<ArnoldDashboardView["exercises"][number]> = {},
) => ({
  exercise_id: id,
  name,
  equipment: null,
  primary_muscle: null,
  default_load_basis: null,
  default_execution_mode: null,
  in_current_catalog: true,
  retired: false,
  logged_sets: 0,
  last_trained_on: null,
  ...over,
});

describe("goalRows", () => {
  it("formats current and target with the goal's unit", () => {
    const [row] = goalRows({
      goals: [goal({})],
    } as unknown as ArnoldDashboardView["home"]);
    expect(row).toMatchObject({
      id: "g-1",
      revision: 3,
      name: "Bankdrücken",
      current: "62,5 kg",
      target: "80 kg",
      targetText: "80",
      unit: "kg",
      progress: 0.125,
    });
  });

  it("keeps an unmeasured goal unknown, not 0", () => {
    const [row] = goalRows({
      goals: [
        goal({
          kind: "exercise_reps",
          unit: "reps",
          name: "Klimmzug",
          current_value: null,
          progress: null,
          target_value: 12,
        }),
      ],
    } as unknown as ArnoldDashboardView["home"]);
    expect(row!.current).toBe("–");
    expect(row!.target).toBe("12 Wdh.");
    expect(row!.progress).toBeNull();
  });
});

describe("goalChoices", () => {
  it("offers body weight, then current exercises, trained ones first", () => {
    const choices = goalChoices({
      exercises: [
        option("row", "Rudern"),
        option("bench", "Bankdrücken", { logged_sets: 12 }),
        option("old", "Alte Übung", { retired: true }),
        option("hist", "Nur Verlauf", { in_current_catalog: false }),
        option("curl", "Bizepscurl"),
      ],
    } as unknown as ArnoldDashboardView);
    expect(choices.map((c) => c.label)).toEqual([
      "Körpergewicht",
      "Bankdrücken",
      "Bizepscurl",
      "Rudern",
    ]);
  });

  it("allows only kg for body weight", () => {
    expect(unitsFor("body_weight")).toEqual(["kg"]);
    expect(unitsFor("bench")).toEqual(["kg", "Wdh."]);
  });
});

describe("goal writes", () => {
  it("builds valid create inputs for all three kinds", () => {
    const cases = [
      [{ choice: "body_weight", unit: "kg", target: "78,5" }, "body_weight"],
      [{ choice: "bench", unit: "kg", target: "80" }, "exercise_load"],
      [{ choice: "pullup", unit: "Wdh.", target: "12" }, "exercise_reps"],
    ] as const;
    for (const [form, kind] of cases) {
      const built = createGoalInput(form, "r-1");
      expect(built.ok).toBe(true);
      if (!built.ok) continue;
      expect(built.input.kind).toBe(kind);
      expect(
        WriteInputs.create_training_goal.safeParse(built.input).success,
      ).toBe(true);
    }
    const bw = createGoalInput(
      { choice: "body_weight", unit: "kg", target: "78,5" },
      "r",
    );
    expect(bw.ok && bw.input).toMatchObject({ target_value: 78.5 });
    expect(bw.ok && "exercise_id" in bw.input).toBe(false);
  });

  it("names a bad target instead of sending it", () => {
    for (const target of ["", "0", "-5", "abc", "1200"])
      expect(
        createGoalInput({ choice: "bench", unit: "kg", target }, "r").ok,
      ).toBe(false);
    expect(
      createGoalInput({ choice: "pullup", unit: "Wdh.", target: "8,5" }, "r")
        .ok,
    ).toBe(false);
    expect(
      createGoalInput({ choice: "", unit: "kg", target: "5" }, "r").ok,
    ).toBe(false);
  });

  it("changes and ends a goal with its revision", () => {
    const [row] = goalRows({
      goals: [goal({})],
    } as unknown as ArnoldDashboardView["home"]);
    const upd = updateGoalInput(row!, "85", "r-2");
    expect(upd.ok && upd.input).toEqual({
      request_id: "r-2",
      goal_id: "g-1",
      expected_row_revision: 3,
      target_value: 85,
    });
    expect(
      WriteInputs.archive_training_goal.safeParse(archiveGoalInput(row!, "r-3"))
        .success,
    ).toBe(true);
  });

  it("explains an existing goal in plain words", () => {
    expect(goalErrorText("GOAL_EXISTS", "x")).toMatch(/schon ein Ziel/);
    expect(goalErrorText("OTHER", "Fallback")).toBe("Fallback");
  });
});
