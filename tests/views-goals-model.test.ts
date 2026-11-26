/**
 * The goals screen's model (src/views/model/goals.ts): Arnold's goals become
 * rows (unknown current value stays "–"), the form becomes exactly one of
 * Arnold's goal kinds (strength, body weight, running), and bad targets are
 * named, never sent.
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
  placeholderFor,
  unitsFor,
  updateGoalInput,
  bodyWeightInput,
  latestWeightText,
} from "../src/views/model/goals";

const goal = (over: Partial<HomeGoal>): HomeGoal => ({
  goal_id: "g-1",
  row_revision: 3,
  kind: "exercise_load",
  exercise_id: "bench",
  name: "Bankdrücken",
  unit: "kg",
  load_basis: "total",
  run_distance_m: null,
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

  it("shows running goals in km, minutes and mm:ss", () => {
    const rows = goalRows({
      goals: [
        goal({
          kind: "run_distance",
          unit: "km",
          exercise_id: null,
          load_basis: null,
          name: "Laufen: Strecke am Stück",
          target_value: 10,
          current_value: 7.25,
        }),
        goal({
          kind: "run_duration",
          unit: "min",
          exercise_id: null,
          load_basis: null,
          target_value: 60,
          current_value: 42.5,
        }),
        goal({
          kind: "run_time_for_distance",
          unit: "s",
          exercise_id: null,
          load_basis: null,
          run_distance_m: 5000,
          target_value: 1500,
          current_value: 1563,
        }),
      ],
    } as unknown as ArnoldDashboardView["home"]);
    expect(
      rows.map((r) => [r.current, r.target, r.targetText, r.unit]),
    ).toEqual([
      ["7,25 km", "10 km", "10", "km"],
      ["42,5 Min.", "60 Min.", "60", "Min."],
      ["26:03", "25:00", "25:00", "mm:ss"],
    ]);
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
      "Laufen",
      "Bankdrücken",
      "Bizepscurl",
      "Rudern",
    ]);
  });

  it("allows only kg for body weight", () => {
    expect(unitsFor("body_weight")).toEqual(["kg"]);
    expect(unitsFor("bench")).toEqual(["kg", "Wdh."]);
    expect(unitsFor("running")).toEqual(["km", "Min.", "5 km", "10 km"]);
    expect(placeholderFor("5 km")).toBe("mm:ss");
    expect(placeholderFor("km")).toBe("Zielwert");
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

  it("builds running goals: distance, minutes, and a time for 5 or 10 km", () => {
    const cases = [
      [{ choice: "running", unit: "km", target: "10,5" }, "run_distance", 10.5],
      [{ choice: "running", unit: "Min.", target: "45" }, "run_duration", 45],
      [
        { choice: "running", unit: "5 km", target: "24:30" },
        "run_time_for_distance",
        1470,
      ],
      [
        { choice: "running", unit: "10 km", target: "0:52:10" },
        "run_time_for_distance",
        3130,
      ],
    ] as const;
    for (const [form, kind, value] of cases) {
      const built = createGoalInput(form, "r-1");
      expect(built.ok, JSON.stringify(form)).toBe(true);
      if (!built.ok) continue;
      expect(built.input).toMatchObject({ kind, target_value: value });
      expect("exercise_id" in built.input).toBe(false);
      expect(
        WriteInputs.create_training_goal.safeParse(built.input).success,
      ).toBe(true);
    }
    const tenK = createGoalInput(
      { choice: "running", unit: "10 km", target: "52:10" },
      "r",
    );
    expect(tenK.ok && tenK.input.run_distance_m).toBe(10_000);
    for (const target of ["", "abc", "24:75", "0:00", "-3"])
      expect(
        createGoalInput({ choice: "running", unit: "5 km", target }, "r").ok,
      ).toBe(false);
  });

  it("changes a time goal typed as mm:ss", () => {
    const [row] = goalRows({
      goals: [
        goal({
          kind: "run_time_for_distance",
          unit: "s",
          exercise_id: null,
          load_basis: null,
          run_distance_m: 5000,
          target_value: 1500,
        }),
      ],
    } as unknown as ArnoldDashboardView["home"]);
    const upd = updateGoalInput(row!, "23:45", "r-2");
    expect(upd.ok && upd.input.target_value).toBe(1425);
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

describe("body weight by hand", () => {
  const day = {
    requestId: "11111111-1111-4111-8111-111111111111",
    date: "2026-11-26",
    timezone: "Europe/Berlin",
  };

  it("writes the user's own number for their calendar day", () => {
    const built = bodyWeightInput(" 82,5 ", day);
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(WriteInputs.log_body_weight.parse(built.input)).toMatchObject({
      measured_on: "2026-11-26",
      weight_kg: 82.5,
    });
  });

  it("never turns an empty or impossible entry into a number", () => {
    for (const text of ["", "0", "abc", "12", "900"])
      expect(bodyWeightInput(text, day).ok).toBe(false);
  });

  it("shows the newest stored weight, or nothing", () => {
    const view = (latest: unknown) =>
      ({ home: { latest_body_weight: latest } }) as never;
    expect(latestWeightText(view(null))).toBeNull();
    expect(
      latestWeightText(view({ date: "2026-11-24", weight_kg: 82.5 })),
    ).toBe("82,5 kg · 24. Nov.");
  });
});
