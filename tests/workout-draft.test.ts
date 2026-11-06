import { describe, expect, it } from "vitest";
import type { ArnoldExercise } from "../src/shared/arnold-schema-v1";
import type {
  ProposedExercise,
  SessionProposal,
  SetConventions,
} from "../src/shared/workout-contract";
import {
  carryOver,
  draftFromProposal,
  asLastTime,
  changeOf,
  exerciseSummary,
  hasRecommendation,
  lastTimeLine,
  progressionForModel,
  setUniform,
  similarExercises,
  swapExercise,
  unchanged,
} from "../src/ui/workout-draft";

const total: SetConventions = {
  load_basis: "total",
  execution_mode: "bilateral_simultaneous",
  implement_count: 1,
  reps_basis: "total",
};
const dumbbells: SetConventions = {
  ...total,
  load_basis: "per_implement",
  implement_count: 2,
};
const bodyweight: SetConventions = { ...total, load_basis: "bodyweight_only" };

const sets = (n: number, reps: number, load: number | null) =>
  Array.from({ length: n }, () => ({
    reps,
    load_kg: load,
    side: "both" as const,
  }));

function proposed(
  id: string,
  exercise: string,
  over: Partial<ProposedExercise> = {},
): ProposedExercise {
  return {
    plan_item_id: id,
    exercise_id: exercise,
    exercise_name: exercise,
    conventions: total,
    sets: sets(3, 10, 60),
    source: "last_time",
    last_date: "2026-11-01",
    target_sets: 3,
    rep_min: 8,
    rep_max: 10,
    missing: [],
    ...over,
  };
}
const day = (
  version: string,
  exercises: ProposedExercise[],
): SessionProposal => ({
  plan_version_id: version,
  session_id: "push",
  session_name: "Push",
  session_order: 1,
  exercises,
});

function catalogEntry(
  exercise_id: string,
  primary_muscle: string,
  family_key = exercise_id,
  over: Partial<ArnoldExercise> = {},
): ArnoldExercise {
  return {
    exercise_id,
    name_de: exercise_id,
    name_en: null,
    family_key,
    variant_key: exercise_id,
    equipment: "Langhantel",
    primary_muscle,
    default_load_basis: "total",
    default_execution_mode: "bilateral_simultaneous",
    default_implement_count: 1,
    status: "active",
    created_at_utc: "2026-01-01T00:00:00Z",
    updated_at_utc: "2026-01-01T00:00:00Z",
    row_revision: 1,
    ...over,
  } as ArnoldExercise;
}

describe("exerciseSummary", () => {
  it("puts the weight on top and the volume below", () => {
    expect(
      exerciseSummary({ conventions: total, sets: sets(3, 10, 60) }),
    ).toEqual({ load: "60 kg", volume: "3 × 10", missing: false });
  });
  it("says two dumbbells short", () => {
    expect(
      exerciseSummary({ conventions: dumbbells, sets: sets(3, 12, 22.5) }).load,
    ).toBe("2 × 22,5 kg");
  });
  it("keeps machine and added weight short", () => {
    const machine = { ...total, load_basis: "machine_display" as const };
    const added = { ...total, load_basis: "added" as const };
    expect(
      exerciseSummary({ conventions: machine, sets: sets(3, 10, 45) }).load,
    ).toBe("45 kg");
    expect(
      exerciseSummary({ conventions: added, sets: sets(3, 8, 10) }).load,
    ).toBe("+10 kg");
  });
  it("names bodyweight and never zeroes an unknown weight", () => {
    expect(
      exerciseSummary({ conventions: bodyweight, sets: sets(4, 8, null) }).load,
    ).toBe("Körpergewicht");
    expect(
      exerciseSummary({ conventions: total, sets: sets(3, 10, null) }),
    ).toEqual({ load: "Gewicht fehlt", volume: "3 × 10", missing: true });
  });
  it("keeps the set count when sets differ", () => {
    const pyramid = [
      { reps: 10, load_kg: 60, side: "both" as const },
      { reps: 8, load_kg: 70, side: "both" as const },
    ];
    expect(exerciseSummary({ conventions: total, sets: pyramid })).toEqual({
      load: "60–70 kg",
      volume: "2 Sätze · 10, 8",
      missing: false,
    });
  });
});

describe("similarExercises", () => {
  const catalog = [
    catalogEntry("bench", "Brust", "bench_press"),
    catalogEntry("db-bench", "Brust", "bench_press"),
    catalogEntry("chest-press", "Brust"),
    catalogEntry("old-fly", "Brust", "fly", { status: "retired" }),
    catalogEntry("row", "Rücken"),
  ];
  it("offers the same muscle group, the same movement first", () => {
    expect(
      similarExercises(catalog, "bench").map((e) => e.exercise_id),
    ).toEqual(["db-bench", "chest-press"]);
  });
  it("offers nothing for an unknown exercise", () => {
    expect(similarExercises(catalog, "missing")).toEqual([]);
  });
});

describe("draft against proposal", () => {
  const before = day("v1", [proposed("i1", "bench"), proposed("i2", "row")]);

  it("an untouched draft saves the plan as proposed", () => {
    const draft = draftFromProposal(before);
    expect(unchanged(draft, before)).toBe(true);
    const heavier = {
      ...draft,
      exercises: [
        setUniform(draft.exercises[0], { load_kg: 62.5 }),
        draft.exercises[1],
      ],
    };
    expect(unchanged(heavier, before)).toBe(false);
  });

  it("a swap for today starts without a weight", () => {
    const draft = draftFromProposal(before);
    const swapped = swapExercise(
      draft.exercises[0],
      catalogEntry("db-bench", "Brust"),
    );
    expect(swapped.replaces).toBe("bench");
    expect(swapped.sets.every((s) => s.load_kg === null)).toBe(true);
    expect(swapped.sets).toHaveLength(3);
  });

  it("keeps the other changes when the plan replaces one exercise", () => {
    const draft = draftFromProposal(before);
    const edited = {
      exercises: [
        draft.exercises[0],
        setUniform(draft.exercises[1], { reps: 12 }),
      ],
      skipped: [],
    };
    // New version: new plan item ids, bench replaced by dumbbell bench.
    const after = day("v2", [
      proposed("n1", "db-bench", {
        sets: sets(3, 10, null),
        missing: ["load"],
      }),
      proposed("n2", "row"),
    ]);
    const next = carryOver(edited, before, after);
    expect(next.exercises.map((e) => e.plan_item_id)).toEqual(["n1", "n2"]);
    expect(next.exercises[0].exercise_id).toBe("db-bench");
    expect(next.exercises[0].sets[0].load_kg).toBeNull();
    expect(next.exercises[1].sets.every((s) => s.reps === 12)).toBe(true);
  });

  it("keeps a skipped position skipped across the plan change", () => {
    const draft = draftFromProposal(before);
    const skipped = {
      exercises: [draft.exercises[0]],
      skipped: [{ plan_item_id: "i2", exercise_name: "row" }],
    };
    const after = day("v2", [
      proposed("n1", "db-bench"),
      proposed("n2", "row"),
    ]);
    const next = carryOver(skipped, before, after);
    expect(next.skipped).toEqual([
      { plan_item_id: "n2", exercise_name: "row" },
    ]);
    expect(next.exercises.map((e) => e.plan_item_id)).toEqual(["n1"]);
  });
});

describe("Arnold's recommendation against last time", () => {
  const progression = (
    over: Partial<NonNullable<ProposedExercise["progression"]>> = {},
  ): NonNullable<ProposedExercise["progression"]> => ({
    version: "1.0.0",
    decision: "increase",
    reason: "all_sets_at_top",
    change_kg: 2.5,
    rep_min: 8,
    rep_max: 10,
    last_date: "2026-11-01",
    last_sets: [
      { reps: 10, load_kg: 80 },
      { reps: 10, load_kg: 80 },
      { reps: 10, load_kg: 80 },
    ],
    stalled_sessions: 0,
    ...over,
  });
  const increased = proposed("i1", "bench", {
    source: "progression",
    sets: sets(3, 8, 82.5),
    progression: progression(),
  });
  const moreReps = proposed("i2", "squat", {
    source: "progression",
    sets: [
      { reps: 6, load_kg: 105, side: "both" },
      { reps: 5, load_kg: 105, side: "both" },
    ],
    progression: progression({
      decision: "more_reps",
      reason: "building_reps",
      change_kg: 0,
      rep_min: 6,
      rep_max: 8,
      last_sets: [
        { reps: 5, load_kg: 105 },
        { reps: 4, load_kg: 105 },
      ],
    }),
  });

  it("names last time with its weight, apart from today's values", () => {
    expect(lastTimeLine(increased)).toBe("Zuletzt 80 kg · 3 × 10");
    expect(lastTimeLine(moreReps)).toBe("Zuletzt 105 kg · 5, 4");
    expect(
      lastTimeLine(
        proposed("i", "row", {
          conventions: dumbbells,
          sets: sets(3, 10, 24),
          progression: progression({
            change_kg: 2,
            last_sets: [
              { reps: 12, load_kg: 22 },
              { reps: 12, load_kg: 22 },
              { reps: 12, load_kg: 22 },
            ],
          }),
        }),
      ),
    ).toBe("Zuletzt 2 × 22 kg · 3 × 12");
    expect(
      lastTimeLine(
        proposed("i", "dips", {
          conventions: bodyweight,
          sets: sets(2, 12, null),
          progression: progression({
            decision: "top_reached",
            change_kg: 0,
            last_sets: [
              { reps: 12, load_kg: null },
              { reps: 13, load_kg: null },
            ],
          }),
        }),
      ),
    ).toBe("Zuletzt Körpergewicht · 12, 13");
    expect(lastTimeLine(proposed("i", "bench"))).toBeUndefined();
  });

  it("counts one-sided sets once per round", () => {
    const unilateral: SetConventions = {
      ...dumbbells,
      execution_mode: "unilateral",
      implement_count: 1,
      reps_basis: "per_side",
    };
    const side = (reps: number, load: number) => [
      { reps, load_kg: load, side: "left" as const },
      { reps, load_kg: load, side: "right" as const },
    ];
    const pair = { reps: 12, load_kg: 20 };
    expect(
      lastTimeLine(
        proposed("i", "row", {
          conventions: unilateral,
          sets: [...side(10, 22), ...side(10, 22), ...side(10, 22)],
          progression: progression({
            change_kg: 2,
            last_sets: [pair, pair, pair, pair, pair, pair],
          }),
        }),
      ),
    ).toBe("Zuletzt 20 kg pro Hantel · 3 × 12 je Seite");
  });

  it("marks what changed: the weight up or down, or the repetitions", () => {
    expect(changeOf(increased)).toEqual({ load: "up" });
    expect(changeOf(moreReps)).toEqual({ reps: "up" });
    expect(
      changeOf(
        proposed("i", "bench", {
          progression: progression({
            decision: "reduce",
            reason: "stalled",
            change_kg: -7.5,
          }),
        }),
      ),
    ).toEqual({ load: "down" });
    expect(
      changeOf(
        proposed("i", "dips", {
          progression: progression({ decision: "top_reached" }),
        }),
      ),
    ).toEqual({});
    expect(changeOf(proposed("i", "bench"))).toEqual({});
  });

  it("switches the whole day back to last time's sets", () => {
    const today = day("v1", [increased, moreReps, proposed("i3", "curl")]);
    expect(hasRecommendation(today)).toBe(true);
    const last = asLastTime(today);
    expect(hasRecommendation(last)).toBe(false);
    expect(last.exercises[0]).toMatchObject({
      source: "last_time",
      sets: sets(3, 10, 80),
    });
    expect(last.exercises[0]).not.toHaveProperty("progression");
    expect(last.exercises[1].sets).toEqual([
      { reps: 5, load_kg: 105, side: "both" },
      { reps: 4, load_kg: 105, side: "both" },
    ]);
    // Without a recommendation an exercise stays as it was.
    expect(last.exercises[2]).toBe(today.exercises[2]);
    // The proposal itself is untouched.
    expect(today.exercises[0].sets).toEqual(sets(3, 8, 82.5));
    expect(hasRecommendation(day("v1", [proposed("i", "curl")]))).toBe(false);
  });

  it("tells the model the rule and never invents a weight for bodyweight", () => {
    const text = progressionForModel(increased);
    expect(text).toContain("+2,5 kg");
    expect(text).toContain("8–10 Wdh.");
    expect(text).toContain("2026-11-01");
    const top = progressionForModel(
      proposed("i", "dips", {
        conventions: bodyweight,
        progression: progression({ decision: "top_reached", change_kg: 0 }),
      }),
    );
    expect(top).toContain("kein Gewicht");
    expect(top).toContain("vom Nutzer nennen lassen");
  });
});
