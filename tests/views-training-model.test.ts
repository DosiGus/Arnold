/**
 * The training card's model (src/views/model/training.ts): Arnold's proposal
 * becomes the card's rows, ticked sets become one log_workout input; unknown
 * weights stay unknown, untouched exercises are skipped, bad input is named.
 */
import { describe, expect, it } from "vitest";
import {
  LogWorkoutExerciseSchema,
  type SessionProposal,
} from "../src/shared/workout-contract";
import {
  logWorkoutInput,
  rowsOf,
  trainingDayOf,
} from "../src/views/model/training";

const conventions = {
  load_basis: "total",
  execution_mode: "bilateral_simultaneous",
  implement_count: 1,
  reps_basis: "total",
} as const;

const proposal: SessionProposal = {
  plan_version_id: "pv-1",
  session_id: "s-1",
  session_name: "Push",
  session_order: 1,
  exercises: [
    {
      plan_item_id: "pi-bench",
      exercise_id: "bench",
      exercise_name: "Bankdrücken",
      conventions,
      sets: [
        { reps: 8, load_kg: 62.5, side: "both" },
        { reps: 8, load_kg: 62.5, side: "both" },
      ],
      source: "progression",
      last_date: "2026-11-20",
      target_sets: 2,
      rep_min: 8,
      rep_max: 12,
      missing: [],
    },
    {
      plan_item_id: "pi-dips",
      exercise_id: "dips",
      exercise_name: "Dips",
      conventions: { ...conventions, load_basis: "bodyweight_only" },
      sets: [{ reps: 10, load_kg: null, side: "both" }],
      source: "plan",
      last_date: null,
      target_sets: 1,
      rep_min: 10,
      rep_max: 10,
      missing: [],
    },
  ],
};

const options = {
  requestId: "r-1",
  date: "2026-11-26",
  timezone: "Europe/Berlin",
};

describe("training card model", () => {
  it("shows Arnold's proposal set by set, an unknown weight empty", () => {
    const day = trainingDayOf(proposal);
    expect(day.exercises.map((e) => [e.name, e.sets, e.reps, e.kg])).toEqual([
      ["Bankdrücken", 2, "8–12", 62.5],
      ["Dips", 1, "10", null],
    ]);
    expect(rowsOf(proposal)).toEqual({
      "pi-bench": [
        { kg: "62,5", reps: "8", done: false },
        { kg: "62,5", reps: "8", done: false },
      ],
      "pi-dips": [{ kg: "", reps: "10", done: false }],
    });
  });

  it("sends the ticked sets as typed, skips untouched exercises", () => {
    const rows = rowsOf(proposal);
    rows["pi-bench"]![0] = { kg: "65", reps: "9", done: true };
    rows["pi-bench"]![1] = { kg: "62,5", reps: "8", done: false };
    const built = logWorkoutInput(proposal, rows, options);
    expect(built).toEqual({
      ok: true,
      input: {
        request_id: "r-1",
        workout_date_local: "2026-11-26",
        timezone: "Europe/Berlin",
        plan_version_id: "pv-1",
        session_id: "s-1",
        exercises: [
          { plan_item_id: "pi-bench", sets: [{ reps: 9, load_kg: 65 }] },
          { plan_item_id: "pi-dips", skip: true },
        ],
      },
    });
    if (built.ok)
      for (const e of built.input.exercises as unknown[])
        expect(LogWorkoutExerciseSchema.safeParse(e).success).toBe(true);
  });

  it("never sends a bodyweight set with a weight of 0", () => {
    const rows = rowsOf(proposal);
    rows["pi-dips"]![0]!.done = true;
    const built = logWorkoutInput(proposal, rows, options);
    expect(built.ok && built.input.exercises).toContainEqual({
      plan_item_id: "pi-dips",
      sets: [{ reps: 10 }],
    });
  });

  it("names a ticked set without repetitions or with a wrong weight", () => {
    const rows = rowsOf(proposal);
    rows["pi-bench"]![0] = { kg: "60", reps: "", done: true };
    expect(logWorkoutInput(proposal, rows, options)).toEqual({
      ok: false,
      error:
        "Bei Bankdrücken fehlen die Wiederholungen eines erledigten Satzes.",
    });
    rows["pi-bench"]![0] = { kg: "sechzig", reps: "8", done: true };
    expect(logWorkoutInput(proposal, rows, options).ok).toBe(false);
  });
});
