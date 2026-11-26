/**
 * The training card's model (src/views/model/training.ts): Arnold's proposal
 * becomes the card's rows, ticked sets become one log_workout input; unknown
 * weights stay unknown, untouched exercises are skipped, bad input is named.
 */
import { describe, expect, it } from "vitest";
import {
  LogSetSchema,
  LogWorkoutExerciseSchema,
  type SessionProposal,
  type WorkoutContext,
} from "../src/shared/workout-contract";
import {
  logWorkoutInput,
  newSetsOf,
  openWorkoutOf,
  resumeRows,
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

describe("an open training", () => {
  const stored = [
    {
      status: "active",
      plan_item_id: "pi-bench",
      exercise_id: "bench",
      set_number: 1,
      load_kg: 60,
      reps: 9,
    },
  ] as unknown as WorkoutContext["sets"];

  it("is the latest unfinished strength training", () => {
    const w = (id: string, status: string, created_at_utc: string) => ({
      workout_id: id,
      status,
      created_at_utc,
    });
    const context = {
      workouts: [
        w("old", "in_progress", "2026-11-01T10:00:00Z"),
        w("new", "in_progress", "2026-11-20T10:00:00Z"),
      ],
    } as unknown as WorkoutContext;
    expect(openWorkoutOf(context)?.workout_id).toBe("new");
  });

  it("keeps stored sets and sends only the newly ticked ones", () => {
    const rows = resumeRows(proposal, stored);
    expect(rows["pi-bench"]).toEqual([
      { kg: "60", reps: "9", done: true, stored: true },
      { kg: "62,5", reps: "8", done: false },
    ]);
    expect(newSetsOf(proposal, rows)).toEqual({ ok: true, sets: [] });
    rows["pi-bench"]![1]!.done = true;
    const built = newSetsOf(proposal, rows);
    if (!built.ok) throw new Error(built.error);
    expect(built.sets).toHaveLength(1);
    expect(LogSetSchema.parse(built.sets[0])).toMatchObject({
      plan_item_id: "pi-bench",
      reps: 8,
      load_kg: 62.5,
      set_type: "working",
    });
  });
});
