import { describe, expect, it } from "vitest";
import {
  BEST_EFFORT_DISTANCES,
  decoupling,
  edwardsLoad,
  fastestWindow,
  intensityDistribution,
  kilometreTimes,
  loadRatio,
  paceSecondsPerKm,
  personalBests,
  runFulfilment,
  runLoad,
  runMetrics,
  runTrend,
  segmentResult,
  srpeLoad,
  weekFulfilment,
  weekMetrics,
  workShareInTarget,
  zoneTime,
  type PlannedRunInput,
  type RunHrSample,
  type RunInput,
  type RunSegmentInput,
} from "../src/analytics/running/metrics/index";

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

const withHr = (zones: number[], over: Partial<RunInput> = {}) =>
  run({
    hr_status: "recorded",
    hr_avg_bpm: 140,
    hr_max_bpm: 170,
    hr_zone_seconds: zones,
    ...over,
  });

const segment = (over: Partial<RunSegmentInput> = {}): RunSegmentInput => ({
  segment_index: 0,
  repetition: null,
  kind: "work",
  planned_duration_type: "seconds",
  planned_duration_value: 600,
  target_type: "pace",
  target_low: 280,
  target_high: 300,
  timer_s: 600,
  distance_m: 2000,
  time_in_target_s: 540,
  status: "completed",
  hr_avg_bpm: null,
  hr_max_bpm: null,
  ...over,
});

describe("pace from timer time", () => {
  it("uses timer time, so pauses do not slow the pace", () => {
    expect(paceSecondsPerKm(900, 3000)).toEqual({ value: 300, reason: null });
    const paused = run({ timer_s: 1500, elapsed_s: 1800, distance_m: 5000 });
    expect(runMetrics(paused).pace_s_per_km.value).toBe(300);
  });

  it("says why a pace is unknown instead of returning 0", () => {
    expect(paceSecondsPerKm(null, 3000).reason).toBe("timer_missing");
    expect(paceSecondsPerKm(0, 3000).reason).toBe("timer_zero");
    expect(paceSecondsPerKm(900, null).reason).toBe("distance_missing");
    expect(paceSecondsPerKm(900, 0).reason).toBe("distance_zero");
    expect(paceSecondsPerKm(null, 3000).value).toBeNull();
  });
});

describe("kilometre times from 100 m checkpoints", () => {
  it("gives the seconds of every full kilometre and leaves the partial one out", () => {
    const splits = splitsOf([1000, 300], [1000, 330], [500, 360]);
    expect(kilometreTimes(run({ splits_100m: splits })).value).toEqual([
      300, 330,
    ]);
  });

  it("is unknown below one kilometre, without splits and with broken splits", () => {
    expect(
      kilometreTimes(run({ splits_100m: splitsOf([900, 300]) })).reason,
    ).toBe("distance_not_covered");
    expect(kilometreTimes(run()).reason).toBe("no_splits");
    expect(kilometreTimes(run({ splits_100m: [] })).reason).toBe("no_splits");
    expect(kilometreTimes(run({ splits_100m: [30, 20, 60] })).reason).toBe(
      "splits_invalid",
    );
    expect(
      kilometreTimes(run({ status: "planned", splits_100m: [30] })).reason,
    ).toBe("run_not_completed");
  });
});

describe("best efforts", () => {
  // Hand calculation: km 1–5 at 6:00, km 6 at 4:00, km 7–10 at 6:00.
  const splits = splitsOf([5000, 360], [1000, 240], [4000, 360]);

  it("finds the fastest 1 km, 5 km and 10 km", () => {
    expect(splits.at(-1)).toBe(3480);
    expect(fastestWindow(splits, 1000)).toEqual({
      time_s: 240,
      start_m: 5000,
    });
    // Any 5 km window that holds the fast km costs 240 + 4 × 360 = 1680 s;
    // the first such window starts at 1000 m.
    expect(fastestWindow(splits, 5000)).toEqual({
      time_s: 1680,
      start_m: 1000,
    });
    expect(fastestWindow(splits, 10_000)).toEqual({
      time_s: 3480,
      start_m: 0,
    });
    expect(fastestWindow(splits, 21_097.5)).toBeNull();
  });

  it("interpolates the half marathon between two checkpoints", () => {
    // 22 km at 5:00/km: 21 097.5 m take 21.0975 × 300 = 6329.25 s.
    const half = fastestWindow(splitsOf([22_000, 300]), 21_097.5);
    expect(half?.time_s).toBeCloseTo(6329.25, 6);
    expect(half?.start_m).toBe(0);
  });

  it("reports every distance of a run with its own reason", () => {
    const metrics = runMetrics(
      run({ splits_100m: splits, distance_m: 10_000 }),
    );
    expect(metrics.best_efforts["1k"].value?.time_s).toBe(240);
    expect(metrics.best_efforts["10k"].value?.time_s).toBe(3480);
    expect(metrics.best_efforts.half_marathon).toEqual({
      value: null,
      reason: "distance_not_covered",
    });
    expect(BEST_EFFORT_DISTANCES.map((d) => d.key)).toEqual([
      "1k",
      "5k",
      "10k",
      "half_marathon",
    ]);
  });

  it("gives treadmill runs no bests, however fast they were", () => {
    const treadmill = runMetrics(
      run({
        environment: "treadmill",
        distance_source: "sensor",
        splits_100m: splits,
      }),
    );
    for (const { key } of BEST_EFFORT_DISTANCES)
      expect(treadmill.best_efforts[key]).toEqual({
        value: null,
        reason: "treadmill_no_bests",
      });
    expect(treadmill.distance_estimated).toBe(true);
    // The kilometre times of a treadmill run stay available, marked estimated.
    expect(treadmill.kilometre_times_s.value).toHaveLength(10);
  });

  it("needs measured distance, splits and a completed run", () => {
    const reason = (over: Partial<RunInput>) =>
      runMetrics(run({ splits_100m: splits, ...over })).best_efforts["1k"]
        .reason;
    expect(reason({ distance_source: "manual" })).toBe("distance_not_measured");
    expect(reason({ distance_source: "sensor" })).toBe("distance_not_measured");
    expect(reason({ distance_source: null, distance_m: null })).toBe(
      "distance_missing",
    );
    expect(reason({ splits_100m: null })).toBe("no_splits");
    expect(reason({ status: "voided" })).toBe("run_not_completed");
  });

  it("takes the best over all runs; a tie stays with the earlier run", () => {
    const slow = run({
      workout_date_local: "2026-03-01",
      splits_100m: splitsOf([10_000, 360]),
    });
    const fast = run({
      workout_date_local: "2026-03-05",
      splits_100m: splitsOf([10_000, 300]),
    });
    const same = run({
      workout_date_local: "2026-03-07",
      splits_100m: splitsOf([10_000, 300]),
    });
    const bests = personalBests([same, fast, slow]);
    expect(bests["1k"].value).toMatchObject({
      time_s: 300,
      workout_id: fast.workout_id,
      workout_date_local: "2026-03-05",
    });
    expect(bests["10k"].value?.time_s).toBe(3000);
    expect(bests.half_marathon).toEqual({ value: null, reason: "no_runs" });
  });
});

describe("segments", () => {
  it("gives the share in the target band and the completion", () => {
    const result = segmentResult(segment());
    expect(result.share_in_target.value).toBeCloseTo(0.9, 10);
    expect(result.completion.value).toBe(1);
    expect(result.pace_s_per_km.value).toBe(300);
  });

  it("measures a distance segment against its metres", () => {
    const result = segmentResult(
      segment({
        planned_duration_type: "meters",
        planned_duration_value: 800,
        timer_s: 170,
        distance_m: 760,
        time_in_target_s: 170,
      }),
    );
    expect(result.completion.value).toBeCloseTo(0.95, 10);
    expect(result.share_in_target.value).toBe(1);
  });

  it("is unknown without target, planned duration or time in band", () => {
    expect(
      segmentResult(segment({ target_type: "none" })).share_in_target.reason,
    ).toBe("no_target");
    expect(
      segmentResult(segment({ time_in_target_s: null })).share_in_target.reason,
    ).toBe("time_in_target_missing");
    expect(
      segmentResult(segment({ planned_duration_type: "open" })).completion
        .reason,
    ).toBe("no_planned_duration");
    expect(
      segmentResult(
        segment({ planned_duration_type: null, planned_duration_value: null }),
      ).completion.reason,
    ).toBe("no_planned_duration");
  });

  it("counts a skipped segment as nothing done, not as unknown completion", () => {
    const skipped = segmentResult(
      segment({ status: "skipped", timer_s: 0, distance_m: 0 }),
    );
    expect(skipped.completion).toEqual({ value: 0, reason: null });
    expect(skipped.share_in_target.reason).toBe("segment_skipped");
    expect(skipped.pace_s_per_km.reason).toBe("segment_skipped");
  });

  it("combines the work segments: share in band over time, fulfilment as mean", () => {
    const segments = [
      segment({ kind: "warmup", target_type: "none", segment_index: 0 }),
      segment({
        segment_index: 1,
        timer_s: 600,
        time_in_target_s: 540,
      }),
      segment({
        segment_index: 2,
        timer_s: 300,
        time_in_target_s: 60,
        planned_duration_value: 600,
      }),
    ];
    // (540 + 60) of (600 + 300) seconds of work.
    expect(workShareInTarget(segments).value).toBeCloseTo(600 / 900, 10);
    // 600/600 = 1 and 300/600 = 0.5: mean 0.75.
    expect(runFulfilment(segments).value).toBeCloseTo(0.75, 10);
    // Over-delivery is capped at 1.
    expect(runFulfilment([segment({ timer_s: 900 })]).value).toBe(1);
    // A skipped work segment drags the mean down.
    expect(
      runFulfilment([
        segment(),
        segment({ segment_index: 1, status: "skipped", timer_s: 0 }),
      ]).value,
    ).toBe(0.5);
  });

  it("is unknown without segments or without prescribed work", () => {
    expect(workShareInTarget([]).reason).toBe("no_segments");
    expect(runFulfilment([]).reason).toBe("no_segments");
    expect(
      runFulfilment([segment({ planned_duration_type: "open" })]).reason,
    ).toBe("no_planned_work");
    expect(workShareInTarget([segment({ kind: "warmup" })]).reason).toBe(
      "no_target",
    );
  });
});

describe("zone time and load", () => {
  const zones = [600, 1200, 600, 300, 300]; // 3000 s

  it("gives seconds and shares per zone", () => {
    const result = zoneTime(withHr(zones)).value!;
    expect(result.total_s).toBe(3000);
    expect(result.share[1]).toBeCloseTo(0.4, 10);
    expect(result.share.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 10);
  });

  it("names the reason for missing heart rate", () => {
    for (const status of [
      "no_consent",
      "no_sensor",
      "not_provided",
      "consent_revoked",
    ] as const)
      expect(zoneTime(run({ hr_status: status })).reason).toBe(`hr_${status}`);
    expect(zoneTime(run({ hr_status: null })).reason).toBe("hr_not_recorded");
    expect(zoneTime(withHr(zones, { hr_zone_seconds: null })).reason).toBe(
      "zone_seconds_missing",
    );
    expect(zoneTime(withHr([0, 0, 0, 0, 0])).reason).toBe("zone_seconds_empty");
  });

  it("calculates sRPE as effort × minutes of timer time", () => {
    expect(srpeLoad(run({ rpe: 6, timer_s: 3000 })).value).toBe(300);
    expect(srpeLoad(run({ rpe: null })).reason).toBe("rpe_missing");
    expect(srpeLoad(run({ rpe: 6, timer_s: null })).reason).toBe(
      "timer_missing",
    );
  });

  it("calculates Edwards load as minutes per zone × zone number", () => {
    // 10 × 1 + 20 × 2 + 10 × 3 + 5 × 4 + 5 × 5 = 125
    expect(edwardsLoad(withHr(zones)).value).toBeCloseTo(125, 10);
    expect(edwardsLoad(run()).reason).toBe("hr_no_consent");
  });

  it("prefers sRPE, falls back to Edwards and never reports 0 for unknown", () => {
    expect(runLoad(withHr(zones, { rpe: 6 })).primary.value).toEqual({
      basis: "srpe",
      value: 300,
    });
    expect(runLoad(withHr(zones)).primary.value).toMatchObject({
      basis: "edwards",
    });
    expect(runLoad(run())).toMatchObject({
      primary: { value: null, reason: "no_load_known" },
      srpe: { value: null, reason: "rpe_missing" },
      edwards: { value: null, reason: "hr_no_consent" },
    });
  });
});

describe("decoupling", () => {
  // 60 min: 6000 m in the first 1800 s, 5000 m in the second 1800 s.
  const splits = splitsOf([6000, 300], [5000, 360]);
  const samples = (first: number, second: number): RunHrSample[] =>
    Array.from({ length: 721 }, (_, i) => ({
      t_s: i * 5,
      bpm: i * 5 < 1800 ? first : second,
    }));
  const longRun = (over: Partial<RunInput> = {}) =>
    withHr([0, 3600, 0, 0, 0], {
      run_type: "long",
      timer_s: 3600,
      elapsed_s: 3600,
      distance_m: 11_000,
      splits_100m: splits,
      hr_samples: samples(140, 145),
      ...over,
    });

  it("compares speed per heartbeat of the first and the second half", () => {
    const result = decoupling(longRun()).value!;
    // EF1 = (6000/1800)/140, EF2 = (5000/1800)/145
    expect(result.percent).toBeCloseTo(
      (1 - 5000 / 1800 / 145 / (6000 / 1800 / 140)) * 100,
      8,
    );
    expect(result.percent).toBeCloseTo(19.54, 2);
    expect(result.notable).toBe(true);
    expect(result.first_half.hr_avg).toBe(140);
    expect(result.second_half.speed_mps).toBeCloseTo(5000 / 1800, 10);
  });

  it("is zero, not notable, for an even run", () => {
    const even = longRun({
      splits_100m: splitsOf([11_000, 327.2727272727]),
      hr_samples: samples(140, 140),
    });
    const result = decoupling(even).value!;
    expect(Math.abs(result.percent)).toBeLessThan(1e-6);
    expect(result.notable).toBe(false);
  });

  it("is a mild drift of under 5 % that is not notable", () => {
    // Pace and heart rate nearly constant, 3 beats of drift on 140.
    const mild = longRun({
      splits_100m: splitsOf([5500, 327.2727], [5500, 327.2727]),
      hr_samples: samples(140, 143),
    });
    const result = decoupling(mild).value!;
    expect(result.percent).toBeCloseTo((1 - 140 / 143) * 100, 3);
    expect(result.notable).toBe(false);
  });

  it("needs consent, 45 minutes, outdoor distance, splits and samples", () => {
    expect(decoupling(longRun({ hr_status: "no_consent" })).reason).toBe(
      "hr_no_consent",
    );
    expect(decoupling(longRun({ timer_s: 2699 })).reason).toBe(
      "shorter_than_45_min",
    );
    expect(decoupling(longRun({ timer_s: 2700 })).reason).toBeNull();
    expect(decoupling(longRun({ environment: "treadmill" })).reason).toBe(
      "treadmill_estimated_distance",
    );
    expect(decoupling(longRun({ splits_100m: null })).reason).toBe("no_splits");
    expect(decoupling(longRun({ hr_samples: undefined })).reason).toBe(
      "hr_samples_missing",
    );
    expect(
      decoupling(longRun({ hr_samples: samples(140, 145).slice(0, 100) }))
        .reason,
    ).toBe("hr_samples_insufficient");
    expect(decoupling(longRun({ timer_s: null })).reason).toBe("timer_missing");
    expect(decoupling(longRun({ status: "planned" })).reason).toBe(
      "run_not_completed",
    );
  });
});

describe("one run, all metrics", () => {
  it("is all unknown with a reason for a run that is not completed", () => {
    const planned = runMetrics(run({ status: "planned", timer_s: null }));
    expect(planned.pace_s_per_km.reason).toBe("run_not_completed");
    expect(planned.distance_m.reason).toBe("run_not_completed");
    expect(planned.timer_s.reason).toBe("run_not_completed");
    expect(planned.segments).toEqual([]);
    expect(planned.decoupling.reason).toBe("run_not_completed");
  });

  it("sorts segments by index and does not change its input", () => {
    const input = run({
      segments: [segment({ segment_index: 2 }), segment({ segment_index: 0 })],
    });
    const frozen = JSON.stringify(input);
    const metrics = runMetrics(input);
    expect(metrics.segments.map((s) => s.segment_index)).toEqual([0, 2]);
    expect(JSON.stringify(input)).toBe(frozen);
    expect(runMetrics(input)).toEqual(metrics);
  });
});

describe("invariant: an unknown value is never 0", () => {
  const nodes = (
    value: unknown,
    found: { value: unknown; reason: unknown }[],
  ) => {
    if (value && typeof value === "object") {
      const record = value as Record<string, unknown>;
      if ("value" in record && "reason" in record)
        found.push(record as { value: unknown; reason: unknown });
      for (const child of Object.values(record)) nodes(child, found);
    }
    return found;
  };

  it("holds for every metric of varied runs, weeks and ratios", () => {
    const runs = [
      run(),
      run({ status: "planned", timer_s: null, distance_m: null }),
      run({ timer_s: 0, distance_m: 0 }),
      run({ environment: "treadmill", splits_100m: splitsOf([2000, 330]) }),
      withHr([0, 0, 0, 0, 0], { rpe: 5 }),
      run({ segments: [segment({ planned_duration_type: "open" })] }),
    ];
    const found = [
      ...runs.flatMap((r) => nodes(runMetrics(r), [])),
      ...nodes(weekMetrics(runs, [], "2026-03-03", "2026-03-08"), []),
      ...nodes(loadRatio(runs, "2026-03-08"), []),
    ];
    expect(found.length).toBeGreaterThan(40);
    for (const node of found) {
      const sum = node as { known?: number; total?: number };
      if (sum.known !== undefined) {
        // A sum over several runs may be partial (value and reason); it is
        // null, never 0, when no run contributed.
        if (sum.known === 0 && sum.total! > 0) expect(node.value).toBeNull();
        continue;
      }
      if (node.reason !== null) expect(node.value).toBeNull();
      else expect(node.value).not.toBeNull();
    }
  });
});

/* ------------------------------------------------------------------ week */

// The week of Monday 2026-03-02 to Sunday 2026-03-08.
const A = withHr([500, 1900, 600, 0, 0], {
  workout_id: "A",
  workout_date_local: "2026-03-03",
  run_type: "base",
  timer_s: 3000,
  distance_m: 8000,
  rpe: 3,
});
const B = run({
  workout_id: "B",
  workout_date_local: "2026-03-05",
  run_type: "tempo",
  timer_s: 2400,
  distance_m: 7000,
  rpe: 7,
  hr_status: "no_sensor",
});
const C = run({
  workout_id: "C",
  workout_date_local: "2026-03-08",
  run_type: "long",
  timer_s: 5400,
  distance_m: 14_000,
  rpe: null,
});

describe("week metrics", () => {
  const week = weekMetrics([A, B, C], [], "2026-03-04", "2026-03-08");

  it("counts, sums and averages by calendar week from Monday", () => {
    expect(week.week_start).toBe("2026-03-02");
    expect(week.week_end).toBe("2026-03-08");
    expect(week.run_count).toBe(3);
    expect(week.distance_m).toEqual({
      value: 29_000,
      known: 3,
      total: 3,
      reason: null,
    });
    expect(week.timer_s.value).toBe(10_800);
    // 10 800 s over 29 km, weighted by distance.
    expect(week.pace_s_per_km.value).toBeCloseTo(10_800 / 29, 10);
  });

  it("gives the long-run share of the run time", () => {
    expect(week.long_run_share.value).toBe(0.5);
    const noLong = weekMetrics([A, B], [], "2026-03-04", "2026-03-08");
    expect(noLong.long_run_share).toEqual({ value: 0, reason: null });
  });

  it("distributes intensity by heart-rate time, else by run type, and says so", () => {
    const { intensity } = week;
    // A (heart rate): low 2400, moderate 600. B tempo: high 2400. C long: low 5400.
    expect(intensity).toMatchObject({
      low_s: 7800,
      moderate_s: 600,
      high_s: 2400,
      from_hr_s: 3000,
      from_run_type_s: 7800,
      unclassified_s: 0,
      basis: "mixed",
    });
    expect(intensity.share.value!.low).toBeCloseTo(7800 / 10_800, 10);
    expect(intensityDistribution([A]).basis).toBe("hr");
    expect(intensityDistribution([B, C]).basis).toBe("run_type");
  });

  it("leaves free runs without heart rate unclassified instead of guessing", () => {
    const free = run({ run_type: "free", timer_s: 1800 });
    const result = intensityDistribution([free]);
    expect(result.unclassified_s).toBe(1800);
    expect(result.basis).toBeNull();
    expect(result.share).toEqual({
      value: null,
      reason: "unclassified_run_type",
    });
    expect(intensityDistribution([]).share.reason).toBe("no_runs");
  });

  it("sums load only over runs that have one and says how many", () => {
    // sRPE: A 3 × 50 = 150, B 7 × 40 = 280, C has no effort.
    expect(week.load_srpe).toEqual({
      value: 430,
      known: 2,
      total: 3,
      reason: "rpe_missing",
    });
    // Edwards: only A has heart rate: 500/60 + 2 × 1900/60 + 3 × 600/60.
    expect(week.load_edwards.value).toBeCloseTo(500 / 60 + 3800 / 60 + 30, 10);
    expect(week.load_edwards).toMatchObject({
      known: 1,
      total: 3,
      reason: "hr_not_recorded",
    });
  });

  it("takes the zone 2 pace from outdoor runs with mostly zone 2 time", () => {
    // Only A: 1900 of 3000 s in zone 2 (63 %), 3000 s over 8 km.
    expect(week.zone2_pace_s_per_km.value).toBeCloseTo(375, 10);
    const none = weekMetrics([B, C], [], "2026-03-04", "2026-03-08");
    expect(none.zone2_pace_s_per_km.reason).toBe("no_zone2_runs");
    const treadmill = weekMetrics(
      [{ ...A, environment: "treadmill" }],
      [],
      "2026-03-04",
      "2026-03-08",
    );
    expect(treadmill.zone2_pace_s_per_km.reason).toBe("no_zone2_runs");
  });

  it("is a genuine zero for an empty week and unknown for what needs runs", () => {
    const empty = weekMetrics([A, B, C], [], "2026-03-11", "2026-03-15");
    expect(empty.run_count).toBe(0);
    expect(empty.distance_m).toEqual({
      value: 0,
      known: 0,
      total: 0,
      reason: null,
    });
    expect(empty.pace_s_per_km.reason).toBe("no_runs");
    expect(empty.long_run_share.reason).toBe("no_runs");
  });

  it("marks a sum unknown, not 0, when no run has the value", () => {
    const noDistance = weekMetrics(
      [run({ distance_m: null, distance_source: null })],
      [],
      "2026-03-03",
      "2026-03-08",
    );
    expect(noDistance.distance_m).toEqual({
      value: null,
      known: 0,
      total: 1,
      reason: "distance_missing",
    });
    expect(noDistance.pace_s_per_km.reason).toBe("no_pace_data");
  });

  it("ignores runs that are planned, cancelled or voided", () => {
    const others = (["planned", "cancelled", "voided"] as const).map((status) =>
      run({ status, workout_date_local: "2026-03-04" }),
    );
    expect(
      weekMetrics([...others, A], [], "2026-03-04", "2026-03-08").run_count,
    ).toBe(1);
  });
});

describe("calendar days come from workout_date_local only", () => {
  it("keeps a late local run in its week although UTC is already the next day", () => {
    // Sunday 23:30 in UTC−5 is Monday 04:30 UTC.
    const lateSunday = run({
      workout_date_local: "2026-03-08",
      started_at_utc: "2026-03-09T04:30:00Z",
    });
    expect(
      weekMetrics([lateSunday], [], "2026-03-02", "2026-03-09").run_count,
    ).toBe(1);
    expect(
      weekMetrics([lateSunday], [], "2026-03-09", "2026-03-09").run_count,
    ).toBe(0);
  });

  it("puts an early local run in the new week although UTC is still the old one", () => {
    // Monday 01:30 in UTC+2 is Sunday 23:30 UTC.
    const earlyMonday = run({
      workout_date_local: "2026-03-09",
      started_at_utc: "2026-03-08T23:30:00Z",
    });
    expect(
      weekMetrics([earlyMonday], [], "2026-03-02", "2026-03-09").run_count,
    ).toBe(0);
    expect(
      weekMetrics([earlyMonday], [], "2026-03-09", "2026-03-09").run_count,
    ).toBe(1);
  });

  it("starts weeks on Monday across a year boundary", () => {
    const newYear = run({ workout_date_local: "2026-01-01" });
    const week = weekMetrics([newYear], [], "2026-01-01", "2026-01-04");
    expect(week.week_start).toBe("2025-12-29");
    expect(week.week_end).toBe("2026-01-04");
    expect(week.run_count).toBe(1);
  });

  it("refuses a date that is not a calendar date", () => {
    expect(() =>
      weekMetrics(
        [run({ workout_date_local: "2026-02-30" })],
        [],
        "2026-03-02",
        "2026-03-02",
      ),
    ).toThrow(RangeError);
    expect(() => weekMetrics([], [], "not-a-date", "2026-03-02")).toThrow(
      RangeError,
    );
  });
});

describe("plan fulfilment including missed runs", () => {
  const planned = (
    id: string,
    date: string,
    status: PlannedRunInput["status"],
  ): PlannedRunInput => ({
    workout_id: id,
    workout_date_local: date,
    status,
  });

  it("counts done, missed (before the reference day) and open (from it)", () => {
    const result = weekFulfilment(
      [
        planned("1", "2026-03-03", "completed"),
        planned("2", "2026-03-05", "completed"),
        planned("3", "2026-03-06", "planned"),
        planned("4", "2026-03-08", "planned"),
        planned("5", "2026-03-07", "cancelled"),
        planned("6", "2026-03-01", "planned"), // last week, not counted
      ],
      "2026-03-04",
      "2026-03-08",
    );
    expect(result).toMatchObject({
      planned: 4,
      completed: 2,
      missed: 1,
      open: 1,
    });
    expect(result.rate.value).toBeCloseTo(2 / 3, 10);
  });

  it("is unknown while nothing is due and 0 only when everything due was missed", () => {
    expect(
      weekFulfilment(
        [planned("1", "2026-03-06", "planned")],
        "2026-03-02",
        "2026-03-02",
      ).rate,
    ).toEqual({ value: null, reason: "nothing_due" });
    expect(weekFulfilment([], "2026-03-02", "2026-03-08").rate.reason).toBe(
      "nothing_due",
    );
    expect(
      weekFulfilment(
        [planned("1", "2026-03-03", "planned")],
        "2026-03-02",
        "2026-03-08",
      ).rate,
    ).toEqual({ value: 0, reason: null });
  });

  it("appears in the week metrics", () => {
    const week = weekMetrics(
      [A],
      [
        planned("A", "2026-03-03", "completed"),
        planned("x", "2026-03-04", "planned"),
      ],
      "2026-03-02",
      "2026-03-08",
    );
    expect(week.fulfilment.rate.value).toBe(0.5);
  });
});

describe("trend over weeks", () => {
  it("lists twelve weeks oldest first with empty weeks included", () => {
    const trend = runTrend([A, B, C], [], "2026-03-08", 12);
    expect(trend).toHaveLength(12);
    expect(trend[11].week_start).toBe("2026-03-02");
    expect(trend[0].week_start).toBe("2025-12-15");
    expect(trend.every((w) => new Date(w.week_start).getUTCDay() === 1)).toBe(
      true,
    );
    expect(trend.map((w) => w.run_count)).toEqual([
      0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 3,
    ]);
    expect(runTrend([], [], "2026-03-08", 0)).toEqual([]);
  });
});

describe("acute to chronic ratio", () => {
  const dayRun = (date: string, rpe: number, timer_s: number) =>
    run({ workout_date_local: date, rpe, timer_s });
  // Loads: 02-10 → 200, 02-20 → 200, 02-25 → 150, 03-01 → 150, all sRPE.
  const history = [
    dayRun("2026-02-01", 9, 6000), // 900, before the 28-day window, shows the history
    dayRun("2026-02-10", 5, 2400),
    dayRun("2026-02-20", 5, 2400),
    dayRun("2026-02-25", 5, 1800),
    dayRun("2026-03-01", 5, 1800),
  ];

  it("divides the last 7 days by the weekly mean of the last 28", () => {
    const result = loadRatio(history, "2026-03-01").value!;
    // Window 02-02 … 03-01: chronic 700 / 4 = 175; acute 02-23 … 03-01: 300.
    expect(result.chronic_weekly).toBe(175);
    expect(result.acute).toBe(300);
    expect(result.ratio).toBeCloseTo(300 / 175, 10);
    expect(result).toMatchObject({ known_runs: 4, total_runs: 4 });
  });

  it("is unknown with less than 28 days of history", () => {
    expect(loadRatio(history.slice(1), "2026-03-01").reason).toBe(
      "history_too_short",
    );
    // …unless the caller knows the history started earlier.
    expect(
      loadRatio(history.slice(1), "2026-03-01", "srpe", "2026-01-01").value,
    ).not.toBeNull();
  });

  it("is unknown without runs or without any known load", () => {
    expect(loadRatio([], "2026-03-01").reason).toBe("no_runs");
    const noEffort = history.map((r) => ({ ...r, rpe: null }));
    expect(loadRatio(noEffort, "2026-03-01").reason).toBe("no_load_known");
    expect(loadRatio(history, "2026-03-01", "edwards").reason).toBe(
      "no_load_known",
    );
  });

  it("counts only known loads and says how many runs that is", () => {
    const partial = [...history, run({ workout_date_local: "2026-02-27" })];
    expect(loadRatio(partial, "2026-03-01").value).toMatchObject({
      known_runs: 4,
      total_runs: 5,
    });
  });

  it("is unknown when the chronic load is 0", () => {
    const old = [dayRun("2026-01-01", 5, 3000)];
    expect(loadRatio(old, "2026-03-01").reason).toBe("chronic_load_zero");
  });
});
