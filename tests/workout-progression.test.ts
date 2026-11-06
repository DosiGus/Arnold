/**
 * The progression engine inside "so gemacht": what the card proposes is
 * what log_workout saves, and the cases where Arnold keeps last time's
 * values instead of recommending anything.
 */
import { describe, expect, it } from "vitest";
import { createFixtureLogging } from "../src/server/workout/fixture";
import {
  proposeActivePlan,
  proposeExercise,
} from "../src/server/workout/proposal";
import type { ArnoldDataset } from "../src/shared/arnold-schema-v1";
import {
  WriteResponseSchema,
  type WriteResponse,
} from "../src/shared/workout-contract";

function ok(response: WriteResponse) {
  expect(response.error).toBeNull();
  WriteResponseSchema.parse(response);
  return response.result!;
}
const day = (date: string, exercises: unknown[]) => ({
  request_id: crypto.randomUUID(),
  workout_date_local: date,
  timezone: "Europe/Berlin",
  plan_version_id: "fixture-plan-v1",
  session_id: "fixture-push",
  source: "ui",
  exercises,
});
const benchAt = (load: number, ...reps: number[]) => ({
  plan_item_id: "fixture-item-1",
  sets: reps.map((r) => ({ reps: r, load_kg: load })),
});
const incline = { plan_item_id: "fixture-item-2", load_kg: 20 };

async function logged(...days: [string, unknown[]][]) {
  const r = createFixtureLogging();
  for (const [date, exercises] of days)
    ok(await r.service.execute("log_workout", day(date, exercises)));
  return r;
}

const benchProposal = (data: ArnoldDataset) =>
  proposeActivePlan(data)[0].exercises[0];

describe("progression in the session proposal", () => {
  it("proposes one step more after every set reached the top", async () => {
    const r = await logged(["2026-10-20", [benchAt(60, 12, 12, 12), incline]]);
    const bench = benchProposal(await r.store.read());
    expect(bench.source).toBe("progression");
    expect(bench.progression).toMatchObject({
      decision: "increase",
      change_kg: 2.5,
      rep_min: 8,
      rep_max: 12,
    });
    expect(bench.sets.map((s) => [s.reps, s.load_kg])).toEqual([
      [8, 62.5],
      [8, 62.5],
      [8, 62.5],
    ]);
  });

  it("saves exactly what it proposed", async () => {
    const r = await logged(["2026-10-20", [benchAt(60, 12, 12, 12), incline]]);
    const shown = benchProposal(await r.store.read());
    const saved = ok(
      await r.service.execute("log_workout", {
        ...day("2026-10-22", []),
        exercises: undefined,
      }),
    );
    expect(
      saved.sets
        .filter((s) => s.exercise_id === "fixture-bench")
        .map((s) => ({ reps: s.reps, load_kg: s.load_kg, side: s.side })),
    ).toEqual(shown.sets);
  });

  it("deloads after missing the range twice and is not fooled by the deload", async () => {
    const r = await logged(
      ["2026-10-20", [benchAt(80, 6, 6, 5), incline]],
      ["2026-10-22", [benchAt(80, 6, 5, 5), incline]],
    );
    const bench = benchProposal(await r.store.read());
    expect(bench.progression).toMatchObject({
      decision: "reduce",
      reason: "missed_range",
      change_kg: -7.5,
    });
    expect(bench.sets.map((s) => [s.reps, s.load_kg])).toEqual([
      [8, 72.5],
      [8, 72.5],
      [8, 72.5],
    ]);
    // Done as proposed: the lighter session builds repetitions from here.
    ok(await r.service.execute("log_workout", day("2026-10-24", [])));
    const after = benchProposal(await r.store.read());
    expect(after.progression?.decision).toBe("more_reps");
    expect(after.sets.map((s) => [s.reps, s.load_kg])[0]).toEqual([9, 72.5]);
  });

  it("recomputes a corrected workout from the sessions before it", async () => {
    const r = await logged(
      ["2026-10-20", [benchAt(60, 12, 12, 12), incline]],
      ["2026-10-22", [benchAt(62.5, 8, 8, 8), incline]],
    );
    const data = await r.store.read();
    const newest = data.workouts.find(
      (w) => w.workout_date_local === "2026-10-22",
    )!;
    const exercise = data.exercises.find(
      (e) => e.exercise_id === "fixture-bench",
    )!;
    const item = data.planItems.find(
      (i) => i.plan_item_id === "fixture-item-1",
    )!;
    const replaced = proposeExercise(data, exercise, item, {
      excludeWorkoutId: newest.workout_id,
    });
    expect(replaced.progression?.decision).toBe("increase");
    expect(replaced.sets[0].load_kg).toBe(62.5);
  });

  it("keeps last time's values when the plan has no repetition range", async () => {
    const r = await logged(["2026-10-20", [benchAt(60, 12, 12, 12), incline]]);
    const data = await r.store.read();
    const exercise = data.exercises.find(
      (e) => e.exercise_id === "fixture-bench",
    )!;
    const item = {
      ...data.planItems.find((i) => i.plan_item_id === "fixture-item-1")!,
      rep_min: null,
      rep_max: null,
    };
    const proposed = proposeExercise(data, exercise, item);
    expect(proposed.source).toBe("last_time");
    expect(proposed.progression).toBeUndefined();
    expect(proposed.sets.map((s) => [s.reps, s.load_kg])[0]).toEqual([12, 60]);
    // An exercise outside the plan (a swap or an extra) never gets one.
    expect(proposeExercise(data, exercise, undefined).source).toBe("last_time");
  });

  it("starts the history anew when the exercise was measured differently", async () => {
    const r = await logged(
      ["2026-10-20", [benchAt(80, 6, 6, 6), incline]],
      [
        "2026-10-22",
        [
          {
            plan_item_id: "fixture-item-1",
            load_basis: "machine_display",
            sets: [
              { reps: 6, load_kg: 50 },
              { reps: 6, load_kg: 50 },
            ],
          },
          incline,
        ],
      ],
    );
    const bench = benchProposal(await r.store.read());
    // Two misses, but measured two ways: no deload, the machine counts alone.
    expect(bench.conventions.load_basis).toBe("machine_display");
    expect(bench.progression?.decision).toBe("more_reps");
    expect(bench.sets.map((s) => [s.reps, s.load_kg])).toEqual([
      [7, 50],
      [7, 50],
    ]);
  });
  it("saves last time's values when the user says so explicitly", async () => {
    const r = await logged(["2026-10-20", [benchAt(60, 12, 12, 12), incline]]);
    const saved = ok(
      await r.service.execute("log_workout", {
        ...day("2026-10-22", []),
        same_as_last_time: true,
      }),
    );
    expect(
      saved.sets
        .filter((s) => s.exercise_id === "fixture-bench")
        .map((s) => [s.reps, s.load_kg]),
    ).toEqual([
      [12, 60],
      [12, 60],
      [12, 60],
    ]);
  });
});
