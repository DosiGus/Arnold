import { describe, expect, it } from "vitest";
import {
  adaptRunLevel,
  checkRunWeek,
  decouplingPercent,
  easyRunsTooHard,
  fulfilmentOf,
  legLoadOn,
  plannedStrengthDay,
  runInterference,
  strengthDays,
  type AdaptationRun,
  type StrengthDay,
} from "../src/analytics/running/index.js";
import { addDays } from "../src/analytics/period.js";
import {
  dataset,
  exercise,
  unvalidatedDataset,
  set,
  workout,
} from "./fixtures/arnold-analytics.js";
import {
  TODAY,
  planned,
  profile,
  run,
  steadyHistory,
} from "./analytics-running-week-helpers.js";

/* ------------------------------------------------------------- adaptation */

/** A completed base run with planned minutes, its actual time and RPE. */
const done = (
  daysAgo: number,
  actual: number,
  rpe: number | null,
  plannedMin = 40,
  type: AdaptationRun["run_type"] = "base",
): AdaptationRun => ({
  ...run(daysAgo, actual, type),
  planned_minutes: plannedMin,
  rpe,
});

const adapt = (
  history: AdaptationRun[],
  level = 1,
  type: AdaptationRun["run_type"] = "base",
) =>
  adaptRunLevel({ run_type: type, level, experience: "intermediate", history });

describe("adaptRunLevel: next level, hold, back", () => {
  it("goes to the next level after two runs of at least 90 % with RPE at most as expected", () => {
    const decision = adapt([done(2, 40, 3), done(5, 36, 3)]);
    expect(decision.decision).toBe("next");
    expect(decision.level).toBe(2);
    expect(decision.runs_considered).toBe(2);
    expect(decision.reasons.join(" ")).toContain("nächste Stufe");
  });

  it("holds with only one run of the type (never on one run)", () => {
    const decision = adapt([done(2, 40, 3)]);
    expect(decision.decision).toBe("hold");
    expect(decision.level).toBe(1);
  });

  it("holds when the effort was above the expectation", () => {
    const decision = adapt([done(2, 40, 4), done(5, 40, 3)]);
    expect(decision.decision).toBe("hold");
    expect(decision.level).toBe(1);
  });

  it("holds between 75 % and 90 % fulfilment", () => {
    expect(adapt([done(2, 32, 3), done(5, 40, 3)]).decision).toBe("hold");
  });

  it("holds when RPE or duration is unknown (unknown is never 0 or good)", () => {
    const decision = adapt([done(2, 40, null), done(5, 40, 3)]);
    expect(decision.decision).toBe("hold");
    expect(decision.reasons.join(" ")).toContain("unbekannt");
    const noTime = adapt([
      { ...done(2, 40, 3), timer_s: null },
      done(5, 40, 3),
    ]);
    expect(noTime.decision).toBe("hold");
  });

  it("goes one level back after two runs with RPE two above the expectation", () => {
    const decision = adapt([done(2, 40, 5), done(5, 40, 6)]);
    expect(decision.decision).toBe("back");
    expect(decision.level).toBe(0);
  });

  it("goes one level back after two runs under 75 % fulfilment", () => {
    const decision = adapt([done(2, 20, 3), done(5, 28, 3)], 2);
    expect(decision.decision).toBe("back");
    expect(decision.level).toBe(1);
  });

  it("goes back when one run was too hard and the other not completed enough", () => {
    expect(adapt([done(2, 40, 5), done(5, 20, 3)], 2).decision).toBe("back");
  });

  it("never goes below level 0", () => {
    const decision = adapt([done(2, 20, 6), done(5, 20, 6)], 0);
    expect(decision.level).toBe(0);
    expect(decision.decision).toBe("hold");
  });

  it("uses only the last two runs of the type, newest first", () => {
    const decision = adapt([
      done(30, 10, 8),
      done(2, 40, 3),
      done(5, 40, 3),
      done(9, 10, 8),
    ]);
    expect(decision.decision).toBe("next");
  });

  it("ignores runs that were not completed or are of another type", () => {
    const decision = adapt([
      done(2, 40, 3),
      { ...done(4, 40, 3), status: "cancelled" },
      done(5, 40, 3, 40, "tempo"),
    ]);
    expect(decision.decision).toBe("hold");
    expect(decision.runs_considered).toBe(1);
  });

  it("does not climb past the ceiling", () => {
    const first = adapt([done(2, 40, 3), done(5, 40, 3)], 0);
    let level = first.level;
    for (let i = 0; i < 100; i += 1) {
      const next = adapt([done(2, 40, 3), done(5, 40, 3)], level);
      expect(next.level).toBeGreaterThanOrEqual(level);
      if (next.level === level) break;
      level = next.level;
    }
    const top = adapt([done(2, 40, 3), done(5, 40, 3)], level);
    expect(top.decision).toBe("hold");
    expect(top.reasons.join(" ")).toContain("höchste Stufe");
  });

  it("does not step up run types that have no levels (free runs)", () => {
    const decision = adapt([done(2, 40, 3), done(5, 40, 3)], 0, "free");
    expect(decision.decision).toBe("hold");
  });
});

describe("fulfilmentOf", () => {
  it("is time over plan, capped at 1, and unknown without a plan or time", () => {
    expect(fulfilmentOf(done(1, 20, 3))).toBeCloseTo(0.5);
    expect(fulfilmentOf(done(1, 80, 3))).toBe(1);
    expect(
      fulfilmentOf({ ...done(1, 20, 3), planned_minutes: null }),
    ).toBeNull();
    expect(fulfilmentOf({ ...done(1, 20, 3), timer_s: null })).toBeNull();
  });
});

/* ---------------------------------------------------- easy runs too hard */

/** Zone seconds with `above` of 100 in zones 3 to 5. */
const zones = (above: number): number[] => [
  0,
  100 - above,
  above / 2,
  above / 4,
  above / 4,
];
const withZones = (
  daysAgo: number,
  above: number,
  type: AdaptationRun["run_type"] = "base",
): AdaptationRun => ({
  ...done(daysAgo, 40, 3, 40, type),
  hr_status: "recorded",
  hr_zone_seconds: zones(above),
});

describe("easy runs too hard", () => {
  it("flags two easy runs with more than 20 % of the zone time above zone 2", () => {
    const history = [withZones(2, 30), withZones(4, 25, "recovery")];
    const result = easyRunsTooHard(history);
    expect(result.too_hard).toBe(true);
    expect(result.shares).toEqual([0.3, 0.25]);
  });

  it("does not flag exactly 20 %, one run, or missing zone times (unknown)", () => {
    expect(easyRunsTooHard([withZones(2, 20), withZones(4, 20)]).too_hard).toBe(
      false,
    );
    expect(easyRunsTooHard([withZones(2, 30)]).too_hard).toBe(false);
    expect(easyRunsTooHard([withZones(2, 30), done(4, 40, 3)]).too_hard).toBe(
      false,
    );
    expect(
      easyRunsTooHard([
        withZones(2, 30),
        { ...withZones(4, 30), hr_status: "no_consent" },
      ]).too_hard,
    ).toBe(false);
  });

  it("blocks the next level and suggests slowing down; beginners get walking breaks", () => {
    const history = [
      { ...withZones(2, 40), rpe: 3 },
      { ...withZones(4, 40), rpe: 3 },
    ];
    const adult = adaptRunLevel({
      run_type: "base",
      level: 1,
      experience: "intermediate",
      history,
    });
    expect(adult.decision).toBe("hold");
    expect(adult.easy_too_hard).toBe(true);
    expect(adult.suggest_walk_breaks).toBe(false);
    expect(adult.reasons.join(" ")).toContain("langsamer");
    const beginner = adaptRunLevel({
      run_type: "base",
      level: 1,
      experience: "beginner",
      history,
    });
    expect(beginner.decision).toBe("hold");
    expect(beginner.suggest_walk_breaks).toBe(true);
    expect(beginner.reasons.join(" ")).toContain("Gehpausen");
  });
});

/* --------------------------------------------------------- decoupling */

/** Cumulative seconds at each 100 m for pieces of [metres, seconds per km]. */
const splitsOf = (...pieces: [number, number][]) => {
  const result: number[] = [];
  let time = 0;
  for (const [meters, perKm] of pieces)
    for (let i = 0; i < meters / 100; i += 1) {
      time += perKm / 10;
      result.push(time);
    }
  return result;
};
const samples = (first: number, second: number) =>
  Array.from({ length: 721 }, (_, i) => ({
    t_s: i * 5,
    bpm: i * 5 < 1800 ? first : second,
  }));
const longWithHr = (daysAgo: number, bpm2: number, rpe = 4): AdaptationRun => ({
  ...run(daysAgo, 60, "long"),
  planned_minutes: 60,
  rpe,
  environment: "outdoor",
  distance_m: 11_000,
  distance_source: "gps",
  hr_status: "recorded",
  hr_zone_seconds: [0, 3600, 0, 0, 0],
  splits_100m: splitsOf([5500, 327.2727], [5500, 327.2727]),
  hr_samples: samples(140, bpm2),
});

describe("decoupling above 5 % keeps the long run from growing", () => {
  it("reads the decoupling of the long run, null without heart-rate data", () => {
    expect(decouplingPercent(longWithHr(2, 143))).toBeCloseTo(
      (1 - 140 / 143) * 100,
      2,
    );
    expect(decouplingPercent(run(2, 60, "long"))).toBeNull();
  });

  it("lets the long run step up with a small drift", () => {
    const decision = adapt(
      [longWithHr(7, 143), longWithHr(14, 143)],
      1,
      "long",
    );
    expect(decision.decoupling_percent!).toBeLessThan(5);
    expect(decision.decision).toBe("next");
  });

  it("holds the long run above 5 % decoupling and says why", () => {
    const decision = adapt(
      [longWithHr(7, 150), longWithHr(14, 143)],
      1,
      "long",
    );
    expect(decision.decoupling_percent!).toBeGreaterThan(5);
    expect(decision.decision).toBe("hold");
    expect(decision.reasons.join(" ")).toContain("Entkopplung");
  });
});

/* ----------------------------------------------------------- interference */

const date = (offset: number) => addDays(TODAY, offset);

let counter = 0;
const mk = (over: Record<string, unknown> = {}) => {
  counter += 1;
  return set({ set_id: `x-${counter}`, set_number: counter, ...over });
};
/** Strength data as plain objects, for sets the schema would refuse (unknown exercise). */
const unvalidated = (sets: ReturnType<typeof set>[]) =>
  unvalidatedDataset({ workouts: [workout()], sets });

describe("strength days from existing data (fixtures)", () => {
  const legs = (n: number, extra: Record<string, unknown> = {}, offset = 0) =>
    Array.from({ length: n }, (_, i) =>
      mk({
        workout_id: "w-1",
        exercise_id: "ex-squat",
        ...extra,
      }),
    );
  const exercises = [
    exercise({ exercise_id: "ex-squat", primary_muscle: "legs" }),
    exercise({ exercise_id: "ex-hip", primary_muscle: "glutes" }),
    exercise({ exercise_id: "ex-press", primary_muscle: "chest" }),
    exercise({ exercise_id: "ex-calf", primary_muscle: "calves" }),
  ];
  const data = (sets: ReturnType<typeof set>[], over = {}) =>
    dataset({
      exercises,
      workouts: [
        workout({
          workout_id: "w-1",
          workout_date_local: "2026-03-03",
          ...over,
        }),
      ],
      sets,
    });

  it("is a heavy leg day from six working sets of legs or glutes", () => {
    const six = strengthDays(
      data([...legs(4), ...legs(2, { exercise_id: "ex-hip" })]),
    );
    expect(six).toEqual([
      { date: "2026-03-03", leg_sets: 6, heavy_legs: true, planned: false },
    ]);
    const five = strengthDays(data(legs(5)));
    expect(five[0].heavy_legs).toBe(false);
    expect(five[0].leg_sets).toBe(5);
  });

  it("does not count warm-up sets, calves or upper-body sets", () => {
    const days = strengthDays(
      data([
        ...legs(5),
        ...legs(3, { set_type: "warmup" }),
        mk({ exercise_id: "ex-calf" }),
        mk({ exercise_id: "ex-press" }),
      ]),
    );
    expect(days[0].leg_sets).toBe(5);
    expect(days[0].heavy_legs).toBe(false);
  });

  it("ignores workouts that are not completed and keys the day by workout_date_local", () => {
    expect(strengthDays(data(legs(8), { status: "planned" }))).toEqual([]);
    // 23:30 local on the 3rd is the 3rd, even if the UTC time is already the 4th
    const late = strengthDays(
      data(legs(8), {
        started_at_utc: "2026-03-03T22:30:00Z",
        workout_date_local: "2026-03-03",
      }),
    );
    expect(late[0].date).toBe("2026-03-03");
  });

  it("sums the legs of two sessions on one day and keeps unknown exercises unknown", () => {
    const two = strengthDays(
      dataset({
        exercises,
        workouts: [
          workout({ workout_id: "w-1", workout_date_local: "2026-03-03" }),
          workout({ workout_id: "w-2", workout_date_local: "2026-03-03" }),
        ],
        sets: [...legs(3), ...legs(3, { workout_id: "w-2" })],
      }),
    );
    expect(two).toHaveLength(1);
    expect(two[0].leg_sets).toBe(6);
    expect(two[0].heavy_legs).toBe(true);
    // sets without a known exercise could be legs: below the threshold that is unknown
    const unknown = strengthDays(
      unvalidated([
        mk({ exercise_id: "ex-bar-press" }),
        mk({ exercise_id: null }),
      ]),
    );
    expect(unknown[0].heavy_legs).toBe(false);
  });

  it("plans a strength day from plan items (target sets); missing target sets are unknown", () => {
    const heavy = plannedStrengthDay("2026-03-04", [
      { target_sets: 4, primary_muscle: "Beine" },
      { target_sets: 3, primary_muscle: "Gesäß" },
      { target_sets: 5, primary_muscle: "chest" },
    ]);
    expect(heavy).toEqual({
      date: "2026-03-04",
      leg_sets: 7,
      heavy_legs: true,
      planned: true,
    });
    const unknown = plannedStrengthDay("2026-03-04", [
      { target_sets: 3, primary_muscle: "quads" },
      { target_sets: null, primary_muscle: "hamstrings" },
    ]);
    expect(unknown.heavy_legs).toBeNull();
    expect(unknown.leg_sets).toBeNull();
  });
});

describe("interference hints", () => {
  const heavy = (offset: number): StrengthDay => ({
    date: date(offset),
    leg_sets: 8,
    heavy_legs: true,
    planned: false,
  });
  const light = (offset: number): StrengthDay => ({
    date: date(offset),
    leg_sets: 2,
    heavy_legs: false,
    planned: false,
  });
  const unknown = (offset: number): StrengthDay => ({
    date: date(offset),
    leg_sets: null,
    heavy_legs: null,
    planned: true,
  });

  it("hints six hours of gap for a hard run on a heavy leg day; run first for a running goal", () => {
    const notes = runInterference(
      { date: date(2), run_type: "tempo" },
      [heavy(2)],
      "running",
    );
    expect(notes.map((n) => n.code)).toEqual(["hard_on_leg_day"]);
    expect(notes[0].text).toContain("6 Stunden");
    expect(notes[0].text).toContain("zuerst laufen");
  });

  it("puts strength first when strength is the main goal", () => {
    const notes = runInterference(
      { date: date(2), run_type: "intervals" },
      [heavy(2)],
      "strength",
    );
    expect(notes[0].text).toContain("zuerst Kraft");
  });

  it("gives no hint for a hard run on a light strength day or a day without strength", () => {
    expect(
      runInterference(
        { date: date(2), run_type: "tempo" },
        [light(2)],
        "running",
      ),
    ).toEqual([]);
    expect(
      runInterference(
        { date: date(3), run_type: "tempo" },
        [heavy(2)],
        "running",
      ),
    ).toEqual([]);
  });

  it("hints that an easy run on a leg day is fine, best after the strength", () => {
    const notes = runInterference(
      { date: date(2), run_type: "base" },
      [heavy(2)],
      "running",
    );
    expect(notes.map((n) => n.code)).toEqual(["easy_on_leg_day"]);
  });

  it("warns about an unknown leg load the day before a hard run", () => {
    const notes = runInterference(
      { date: date(3), run_type: "tempo", session_id: "s-1" },
      [unknown(2)],
      "running",
    );
    expect(notes.map((n) => n.code)).toEqual(["unknown_leg_load"]);
    expect(notes[0].session_id).toBe("s-1");
    expect(
      runInterference(
        { date: date(3), run_type: "base" },
        [unknown(2)],
        "running",
      ),
    ).toEqual([]);
  });

  it("adds the hints to the week check, next to the day-after rule", () => {
    const c = checkRunWeek({
      today: TODAY,
      profile: profile(),
      history: steadyHistory(2, 40),
      strength_days: [heavy(1)],
      runs: [
        planned(date(1), "tempo", 30, 8),
        planned(date(2), "intervals", 30, 8),
      ],
    });
    expect(c.notes.map((n) => n.code)).toContain("hard_on_leg_day");
    expect(c.violations.map((v) => v.rule)).toContain("hard_after_heavy_legs");
  });

  it("combines two sessions on one day and stays cautious when one is unknown", () => {
    expect(legLoadOn([light(1), light(1)], date(1))).toEqual({
      strength: true,
      heavy: false,
    });
    expect(
      legLoadOn(
        [
          { date: date(1), leg_sets: 3, heavy_legs: false, planned: false },
          { date: date(1), leg_sets: 3, heavy_legs: false, planned: false },
        ],
        date(1),
      ),
    ).toEqual({ strength: true, heavy: true });
    expect(legLoadOn([unknown(1), light(1)], date(1)).heavy).toBeNull();
    expect(legLoadOn([], date(1))).toEqual({ strength: false, heavy: false });
  });
});
