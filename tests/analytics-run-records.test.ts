/**
 * Running records and running goals (src/analytics/run-records.ts, goals.ts).
 * All runs are invented; calendar days are strings, never a clock.
 */
import { describe, expect, it } from "vitest";
import { buildHomeAnalytics } from "../src/analytics";
import { goalPoints, goalProgress } from "../src/analytics/goals";
import {
  computeRunRecords,
  measuredTimeFor,
} from "../src/analytics/run-records";
import type {
  RunInput,
  RunSegmentInput,
} from "../src/analytics/running/metrics/index";
import type { ArnoldGoal } from "../src/shared/arnold-schema-v1";
import { dataset, goal } from "./fixtures/arnold-analytics";

/** Cumulative seconds at each 100 m, at an even pace in seconds per km. */
const evenSplits = (meters: number, perKm: number) =>
  Array.from({ length: meters / 100 }, (_, i) => ((i + 1) * perKm) / 10);

let counter = 0;
const run = (over: Partial<RunInput> = {}): RunInput => {
  counter += 1;
  return {
    workout_id: `run-${counter}`,
    workout_date_local: "2026-03-03",
    status: "completed",
    run_type: "base",
    environment: "outdoor",
    timer_s: 3000,
    elapsed_s: 3000,
    distance_m: 10_000,
    distance_source: "gps",
    ascent_m: null,
    descent_m: null,
    cadence_spm: null,
    calories_kcal: null,
    te_aerobic: null,
    te_anaerobic: null,
    rpe: null,
    splits_100m: null,
    pause_count: 0,
    hr_status: "no_consent",
    hr_avg_bpm: null,
    hr_max_bpm: null,
    hr_zone_seconds: null,
    ...over,
  };
};

const lap = (
  i: number,
  timer_s: number,
  distance_m = 1000,
): RunSegmentInput => ({
  segment_index: i,
  repetition: null,
  kind: "lap",
  planned_duration_type: null,
  planned_duration_value: null,
  target_type: null,
  target_low: null,
  target_high: null,
  timer_s,
  distance_m,
  time_in_target_s: null,
  status: "completed",
  hr_avg_bpm: null,
  hr_max_bpm: null,
});

const byKey = (runs: RunInput[]) =>
  Object.fromEntries(computeRunRecords(runs).map((r) => [r.key, r]));

describe("measuredTimeFor", () => {
  it("takes the fastest window from the 100 m checkpoints of a GPS run", () => {
    // 2 km at 6:00, then 5 km at 5:00, then 1 km at 6:00.
    const splits = [
      ...evenSplits(2000, 360),
      ...evenSplits(5000, 300).map((t) => t + 720),
      ...evenSplits(1000, 360).map((t) => t + 720 + 1500),
    ];
    const r = run({ distance_m: 8000, timer_s: 2580, splits_100m: splits });
    expect(measuredTimeFor(r, 5000)).toBe(1500);
    expect(measuredTimeFor(r, 1000)).toBe(300);
    expect(measuredTimeFor(r, 10_000)).toBeNull();
  });

  it("adds consecutive kilometre laps, never more than 0.5 % over", () => {
    const r = run({
      distance_source: "manual",
      distance_m: 6000,
      timer_s: 1900,
      segments: [330, 320, 300, 310, 305, 335].map((t, i) => lap(i, t)),
    });
    expect(measuredTimeFor(r, 1000)).toBe(300);
    // Laps 2–6: 320 + 300 + 310 + 305 + 335 vs. 1–5: 330 + ... = 1565.
    expect(measuredTimeFor(r, 5000)).toBe(1565);
    const long = run({
      distance_source: "manual",
      distance_m: 5100,
      timer_s: 1600,
      segments: [lap(0, 800, 2600), lap(1, 800, 2500)],
    });
    // 5.1 km is 2 % more than 5 km: no 5 km time, nothing extrapolated.
    expect(measuredTimeFor(long, 5000)).toBeNull();
  });

  it("counts a whole run that is the distance, not a longer or shorter one", () => {
    expect(
      measuredTimeFor(
        run({ distance_source: "manual", distance_m: 5000, timer_s: 1570 }),
        5000,
      ),
    ).toBe(1570);
    expect(
      measuredTimeFor(run({ distance_m: 5300, timer_s: 1600 }), 5000),
    ).toBeNull();
    expect(
      measuredTimeFor(run({ distance_m: 4950, timer_s: 1400 }), 5000),
    ).toBeNull();
  });

  it("never counts treadmill runs or unfinished runs", () => {
    expect(
      measuredTimeFor(
        run({
          environment: "treadmill",
          distance_source: "sensor",
          distance_m: 5000,
          timer_s: 1200,
        }),
        5000,
      ),
    ).toBeNull();
    expect(
      measuredTimeFor(
        run({ status: "in_progress", distance_m: 5000, timer_s: 1200 }),
        5000,
      ),
    ).toBeNull();
  });
});

describe("computeRunRecords", () => {
  it("names the run and date of every record", () => {
    const a = run({
      workout_id: "a",
      workout_date_local: "2026-03-01",
      distance_m: 5000,
      timer_s: 1560,
    });
    const b = run({
      workout_id: "b",
      workout_date_local: "2026-03-08",
      distance_m: 12_400,
      timer_s: 4300,
    });
    const c = run({
      workout_id: "c",
      workout_date_local: "2026-03-10",
      environment: "treadmill",
      distance_source: "sensor",
      distance_m: 20_000,
      timer_s: 5400,
    });
    const records = byKey([a, b, c]);
    expect(records.longest_distance).toMatchObject({
      value: 12_400,
      unit: "m",
      workout_id: "b",
      achieved_on: "2026-03-08",
    });
    // The treadmill run is the longest by time; its distance never counts.
    expect(records.longest_duration).toMatchObject({
      value: 5400,
      workout_id: "c",
    });
    expect(records.best_5k).toMatchObject({ value: 1560, workout_id: "a" });
    expect(records.best_10k).toMatchObject({
      value: null,
      reason: "distance_not_covered",
    });
    expect(records.fastest_1k.value).toBeNull();
  });

  it("keeps the earlier run on a tie", () => {
    const records = byKey([
      run({
        workout_id: "late",
        workout_date_local: "2026-03-09",
        distance_m: 5000,
        timer_s: 1500,
      }),
      run({
        workout_id: "early",
        workout_date_local: "2026-03-02",
        distance_m: 5000,
        timer_s: 1500,
      }),
    ]);
    expect(records.best_5k.workout_id).toBe("early");
  });

  it("stays unknown without runs, never 0", () => {
    const records = computeRunRecords([]);
    expect(records.map((r) => r.key)).toEqual([
      "longest_distance",
      "longest_duration",
      "fastest_1k",
      "best_5k",
      "best_10k",
    ]);
    for (const r of records) {
      expect(r.value).toBeNull();
      expect(r.reason).toBe("no_runs");
      expect(r.workout_id).toBeNull();
    }
  });

  it("ignores planned and cancelled runs", () => {
    const records = byKey([
      run({ status: "planned", distance_m: 30_000 }),
      run({ status: "cancelled", distance_m: 30_000 }),
    ]);
    expect(records.longest_distance.value).toBeNull();
  });
});

const runGoal = (over: Record<string, unknown>) =>
  goal({
    kind: "run_distance",
    exercise_id: null,
    load_basis: null,
    target_value: 10,
    ...over,
  });

const withRuns = (goals: Record<string, unknown>[], runs: RunInput[]) => ({
  ...dataset({ goals }),
  runRecordInputs: runs,
});

describe("running goals", () => {
  it("a distance goal counts the longest measured run in km", () => {
    const data = withRuns(
      [runGoal({ start_value: 5 })],
      [
        run({ workout_date_local: "2026-03-01", distance_m: 6000 }),
        run({ workout_date_local: "2026-03-08", distance_m: 7500 }),
        run({ workout_date_local: "2026-03-15", distance_m: 5000 }),
        run({
          workout_date_local: "2026-03-16",
          environment: "treadmill",
          distance_source: "sensor",
          distance_m: 15_000,
        }),
      ],
    );
    const p = goalProgress(data, data.goals[0] as ArnoldGoal);
    expect(p).toMatchObject({
      unit: "km",
      current_value: 7.5,
      current_date: "2026-03-08",
      achieved: false,
    });
    expect(p.progress).toBeCloseTo(0.5, 5);
    // The chart line never goes back after a shorter run.
    expect(p.points.map((x) => x.value)).toEqual([6, 7.5, 7.5]);
  });

  it("a duration goal counts timer minutes", () => {
    const data = withRuns(
      [runGoal({ kind: "run_duration", target_value: 60, start_value: 30 })],
      [run({ timer_s: 2700 })],
    );
    const p = goalProgress(data, data.goals[0] as ArnoldGoal);
    expect(p).toMatchObject({ unit: "min", current_value: 45 });
    expect(p.progress).toBeCloseTo(0.5, 5);
  });

  it("a time goal: lower is better, progress goes the right way", () => {
    const data = withRuns(
      [
        runGoal({
          kind: "run_time_for_distance",
          run_distance_m: 5000,
          target_value: 1500,
          start_value: 1700,
        }),
      ],
      [
        run({
          workout_date_local: "2026-03-01",
          distance_m: 5000,
          timer_s: 1650,
        }),
        run({
          workout_date_local: "2026-03-08",
          distance_m: 5000,
          timer_s: 1600,
        }),
        run({
          workout_date_local: "2026-03-15",
          distance_m: 5000,
          timer_s: 1680,
        }),
        // Longer than 5 km and no laps: proves no 5 km time.
        run({
          workout_date_local: "2026-03-20",
          distance_m: 6000,
          timer_s: 1500,
        }),
      ],
    );
    const p = goalProgress(data, data.goals[0] as ArnoldGoal);
    expect(p).toMatchObject({
      unit: "s",
      run_distance_m: 5000,
      current_value: 1600,
      current_date: "2026-03-08",
      achieved: false,
    });
    expect(p.progress).toBeCloseTo(0.5, 5);
    expect(p.points.map((x) => x.value)).toEqual([1650, 1600, 1600]);
    // Getting faster is a negative rate, heading towards the lower target.
    expect(p.rate_per_week).toBeLessThan(0);
    expect(p.eta_weeks).not.toBeNull();
  });

  it("a time goal is achieved once a measured time is at or below it", () => {
    const data = withRuns(
      [
        runGoal({
          kind: "run_time_for_distance",
          run_distance_m: 5000,
          target_value: 1500,
        }),
      ],
      [run({ distance_m: 5000, timer_s: 1490 })],
    );
    // No stored start: the first measurement is the start, and it is
    // already under the target.
    const p = goalProgress(data, data.goals[0] as ArnoldGoal);
    expect(p).toMatchObject({ achieved: true, progress: 1 });
  });

  it("without a measured run the goal stays unknown, never 0", () => {
    const data = withRuns(
      [
        runGoal({
          kind: "run_time_for_distance",
          run_distance_m: 10_000,
          target_value: 3000,
        }),
      ],
      [run({ distance_m: 8000, timer_s: 2400 })],
    );
    const p = goalProgress(data, data.goals[0] as ArnoldGoal);
    expect(p.current_value).toBeNull();
    expect(p.start_value).toBeNull();
    expect(p.progress).toBeNull();
    expect(goalPoints(data, data.goals[0] as ArnoldGoal)).toEqual([]);
  });

  it("reaches the start screen with the running records", () => {
    const home = buildHomeAnalytics(
      withRuns(
        [runGoal({ target_value: 21.1 })],
        [run({ workout_date_local: "2026-03-01", distance_m: 10_000 })],
      ),
      { reference_date: "2026-03-02" },
    );
    expect(home.goals[0]).toMatchObject({
      kind: "run_distance",
      unit: "km",
      current_value: 10,
    });
    expect(
      home.run_records.find((r) => r.key === "longest_distance"),
    ).toMatchObject({
      value: 10_000,
      achieved_on: "2026-03-01",
    });
  });
});
