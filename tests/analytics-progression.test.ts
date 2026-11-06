import { describe, expect, it } from "vitest";
import {
  deloadLoad,
  recommendProgression,
  stalledSessions,
  weightStep,
  type ProgressionInput,
  type ProgressionSession,
} from "../src/analytics/progression";

type Set = { reps: number; load_kg: number | null; side?: string };

/** Sessions newest first: one entry per session, `[load, reps...]`. */
const sessions = (
  ...list: [number | null, ...number[]][]
): ProgressionSession<Set>[] =>
  list.map(([load, ...reps], i) => ({
    date: `2026-11-${String(20 - i).padStart(2, "0")}`,
    sets: reps.map((r) => ({ reps: r, load_kg: load, side: "both" })),
  }));

const barbell = (
  list: ProgressionSession<Set>[],
  over: Partial<ProgressionInput<Set>> = {},
): ProgressionInput<Set> => ({
  sessions: list,
  load_basis: "total",
  rep_min: 8,
  rep_max: 10,
  step_kg: 2.5,
  ...over,
});

const recommended = (input: ProgressionInput<Set>) => {
  const result = recommendProgression(input);
  if (result.status !== "recommended")
    throw new Error(`not recommended: ${result.reason}`);
  return result;
};

describe("double progression", () => {
  it("adds one step and goes back to the bottom when every set reached the top", () => {
    const r = recommended(barbell(sessions([80, 10, 10, 10])));
    expect(r.progression.decision).toBe("increase");
    expect(r.progression.reason).toBe("all_sets_at_top");
    expect(r.progression.change_kg).toBe(2.5);
    expect(r.sets).toEqual([
      { reps: 8, load_kg: 82.5, side: "both" },
      { reps: 8, load_kg: 82.5, side: "both" },
      { reps: 8, load_kg: 82.5, side: "both" },
    ]);
    expect(r.progression.last_sets).toEqual([
      { reps: 10, load_kg: 80 },
      { reps: 10, load_kg: 80 },
      { reps: 10, load_kg: 80 },
    ]);
    expect(r.progression.last_date).toBe("2026-11-20");
  });

  it("keeps the weight and asks for one more repetition per set within the range", () => {
    const r = recommended(barbell(sessions([80, 10, 9, 8])));
    expect(r.progression.decision).toBe("more_reps");
    expect(r.progression.change_kg).toBe(0);
    expect(r.sets.map((s) => [s.load_kg, s.reps])).toEqual([
      [80, 10],
      [80, 10],
      [80, 9],
    ]);
  });

  it("never asks for more than the top of the range", () => {
    const r = recommended(barbell(sessions([80, 12, 10, 7])));
    expect(r.progression.decision).toBe("more_reps");
    expect(r.sets.map((s) => s.reps)).toEqual([10, 10, 8]);
  });

  it("treats a fixed number of repetitions as a range of one", () => {
    const top = recommended(
      barbell(sessions([60, 5, 5, 5]), { rep_min: 5, rep_max: 5 }),
    );
    expect(top.progression.decision).toBe("increase");
    expect(top.sets.map((s) => [s.load_kg, s.reps])[0]).toEqual([62.5, 5]);
    const onlyMax = recommended(
      barbell(sessions([60, 10, 10]), { rep_min: null, rep_max: 10 }),
    );
    expect(onlyMax.progression).toMatchObject({ rep_min: 10, rep_max: 10 });
    expect(onlyMax.progression.decision).toBe("increase");
  });

  it("raises every set of a pyramid by the same step", () => {
    const r = recommended(
      barbell([
        {
          date: "2026-11-20",
          sets: [
            { reps: 10, load_kg: 60 },
            { reps: 10, load_kg: 65 },
            { reps: 10, load_kg: 70 },
          ],
        },
      ]),
    );
    expect(r.sets.map((s) => s.load_kg)).toEqual([62.5, 67.5, 72.5]);
  });

  it("uses the equipment's step and never drifts off two decimals", () => {
    const dumbbell = recommended(
      barbell(sessions([22, 12, 12]), {
        load_basis: "per_implement",
        rep_min: 10,
        rep_max: 12,
        step_kg: 2,
      }),
    );
    expect(dumbbell.sets[0]).toMatchObject({ load_kg: 24, reps: 10 });
    const odd = recommended(barbell(sessions([47.3, 10, 10])));
    expect(odd.sets[0].load_kg).toBe(49.8);
  });
});

describe("when the weight goes down", () => {
  it("takes about 10 % off after missing the range twice", () => {
    const r = recommended(barbell(sessions([80, 6, 6, 5], [80, 7, 6, 6])));
    expect(r.progression.decision).toBe("reduce");
    expect(r.progression.reason).toBe("missed_range");
    expect(r.progression.change_kg).toBe(-7.5);
    expect(r.sets.map((s) => [s.load_kg, s.reps])).toEqual([
      [72.5, 8],
      [72.5, 8],
      [72.5, 8],
    ]);
  });

  it("gives a single bad day another try", () => {
    const r = recommended(barbell(sessions([80, 6, 6, 5], [80, 9, 9, 8])));
    expect(r.progression.decision).toBe("more_reps");
    expect(r.sets.map((s) => s.reps)).toEqual([7, 7, 6]);
  });

  it("counts a session as missed only when most sets fell short", () => {
    const r = recommended(barbell(sessions([80, 8, 8, 6], [80, 8, 8, 6])));
    expect(r.progression.decision).not.toBe("reduce");
  });

  it("deloads after three sessions without progress at the same weight", () => {
    // Oldest to newest 24 → 24 → 25 → 25 reps: the gain two sessions ago
    // ends the count at one.
    const list = sessions(
      [80, 9, 8, 8],
      [80, 9, 8, 8],
      [80, 8, 8, 8],
      [80, 8, 8, 8],
    );
    expect(stalledSessions(list)).toBe(1);
    expect(recommended(barbell(list)).progression.decision).toBe("more_reps");
    // A worse session is no progress either.
    expect(
      stalledSessions(
        sessions([80, 9, 8, 8], [80, 9, 8, 8], [80, 9, 9, 8], [80, 9, 9, 8]),
      ),
    ).toBe(3);

    const flat = sessions(
      [80, 9, 8, 8],
      [80, 9, 8, 8],
      [80, 9, 8, 8],
      [80, 9, 8, 8],
    );
    expect(stalledSessions(flat)).toBe(3);
    const r = recommended(barbell(flat));
    expect(r.progression).toMatchObject({
      decision: "reduce",
      reason: "stalled",
      stalled_sessions: 3,
    });
    expect(r.sets[0]).toMatchObject({ load_kg: 72.5, reps: 8 });
  });

  it("never deloads twice in a row: a lighter session starts a new count", () => {
    const list = sessions(
      [72.5, 9, 8, 8],
      [80, 9, 8, 8],
      [80, 9, 8, 8],
      [80, 9, 8, 8],
    );
    expect(stalledSessions(list)).toBe(0);
    expect(recommended(barbell(list)).progression.decision).toBe("more_reps");
  });

  it("does not count a heavier session as a stall", () => {
    const list = sessions([82.5, 8, 8, 8], [80, 10, 10, 10]);
    expect(stalledSessions(list)).toBe(0);
  });

  it("keeps the lightest step and builds repetitions instead of going to zero", () => {
    expect(deloadLoad(80, 2.5)).toBe(72.5);
    expect(deloadLoad(6, 2)).toBe(4);
    expect(deloadLoad(2, 2)).toBeNull();
    const r = recommended(
      barbell(sessions([2, 5, 5], [2, 5, 5]), {
        load_basis: "per_implement",
        step_kg: 2,
      }),
    );
    expect(r.progression.decision).toBe("more_reps");
    expect(r.sets.map((s) => [s.load_kg, s.reps])).toEqual([
      [2, 6],
      [2, 6],
    ]);
  });
});

describe("bodyweight and assistance", () => {
  const body = (list: ProgressionSession<Set>[]) =>
    barbell(list, { load_basis: "bodyweight_only", rep_min: 8, rep_max: 12 });

  it("progresses by repetitions and says when the top is reached", () => {
    const more = recommended(body(sessions([null, 10, 9])));
    expect(more.progression.decision).toBe("more_reps");
    expect(more.sets).toEqual([
      { reps: 11, load_kg: null, side: "both" },
      { reps: 10, load_kg: null, side: "both" },
    ]);
    const top = recommended(body(sessions([null, 12, 13])));
    expect(top.progression.decision).toBe("top_reached");
    expect(top.progression.change_kg).toBe(0);
    expect(top.sets.map((s) => s.reps)).toEqual([12, 12]);
  });

  it("never takes weight off a person", () => {
    const r = recommended(body(sessions([null, 4, 4], [null, 4, 4])));
    expect(r.progression.decision).toBe("more_reps");
    expect(r.sets.every((s) => s.load_kg === null)).toBe(true);
  });

  it("treats assistance like bodyweight", () => {
    const r = recommended(
      barbell(sessions([20, 10, 10]), { load_basis: "assistance" }),
    );
    expect(r.progression.decision).toBe("top_reached");
    expect(r.sets[0].load_kg).toBe(20);
  });

  it("adds weight to an added-load exercise like to a barbell", () => {
    const r = recommended(
      barbell(sessions([0, 10, 10]), { load_basis: "added" }),
    );
    expect(r.progression.decision).toBe("increase");
    expect(r.sets[0].load_kg).toBe(2.5);
    const light = recommended(
      barbell(sessions([0, 5, 5], [0, 5, 5]), { load_basis: "added" }),
    );
    expect(light.progression.decision).toBe("more_reps");
  });
});

describe("no recommendation without a sound basis", () => {
  it("needs history, a range and known weights", () => {
    expect(recommendProgression(barbell([]))).toEqual({
      status: "not_available",
      reason: "no_history",
    });
    expect(
      recommendProgression(
        barbell(sessions([80, 10]), { rep_min: null, rep_max: null }),
      ),
    ).toEqual({ status: "not_available", reason: "no_rep_range" });
    expect(
      recommendProgression(
        barbell(sessions([80, 10]), { rep_min: 12, rep_max: 8 }),
      ),
    ).toEqual({ status: "not_available", reason: "no_rep_range" });
    expect(recommendProgression(barbell(sessions([null, 10, 10])))).toEqual({
      status: "not_available",
      reason: "load_unknown",
    });
  });

  it("is deterministic and leaves its input untouched", () => {
    const input = barbell(sessions([80, 10, 10, 10], [77.5, 10, 10, 10]));
    const copy = structuredClone(input);
    expect(recommendProgression(input)).toEqual(recommendProgression(input));
    expect(input).toEqual(copy);
  });
});

describe("weight steps", () => {
  it("follow the equipment, else the load basis", () => {
    expect(weightStep("Langhantel", "total")).toBe(2.5);
    expect(weightStep("Kurzhantel", "per_implement")).toBe(2);
    expect(weightStep("Kurzhantel", "total")).toBe(2);
    expect(weightStep("Maschine", "machine_display")).toBe(5);
    expect(weightStep("Kabelzug", "machine_display")).toBe(2.5);
    expect(weightStep("Kettlebell", "total")).toBe(4);
    expect(weightStep("Spezialstange", "total")).toBe(2.5);
    expect(weightStep("Eigenes Gerät", "machine_display")).toBe(5);
    expect(weightStep("", "per_implement")).toBe(2);
  });
});
