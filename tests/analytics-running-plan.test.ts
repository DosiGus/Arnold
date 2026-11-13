import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  HARD_RUN_TYPES,
  jsonBytes,
  RUN_ENVIRONMENTS,
  RUN_LIMITS,
  RUN_TYPES,
  RUN_WATCH_BUDGET_BYTES,
  RunPrescriptionSchema,
  expandedSegmentCount,
  type RunEnvironment,
  type RunPrescription,
  type RunType,
} from "../src/shared/run-contract.js";
import {
  ALARM_DEFAULTS,
  buildRunPrescription,
  hrZones,
  PACE_TARGET_TYPES,
  RUN_CATALOG,
  RUN_EXPERIENCES,
  RUN_RULES_VERSION,
  RUN_TYPE_NAMES,
  runExperience,
  runLevelCeiling,
  standardRunPlan,
  tempoZones,
  type RunExperience,
  type RunPlanInput,
} from "../src/analytics/running/index.js";

const PACES = tempoZones(48)!;
const SEG = { kind: 0, durType: 1, dur: 2, tType: 3, low: 4, high: 5 } as const;

function plan(input: RunPlanInput) {
  const result = buildRunPrescription(input);
  if (!result.ok) throw new Error(`refused: ${result.message}`);
  return result;
}
const base = (
  run_type: RunType,
  environment: RunEnvironment = "outdoor",
  experience: RunExperience = "intermediate",
  extra: Partial<RunPlanInput> = {},
): RunPlanInput => ({ run_type, environment, experience, ...extra });

/** The segments in execution order. */
function expand(p: RunPrescription) {
  const out: (typeof p.s)[number][] = [];
  const repeatAt = new Map((p.rp ?? []).map((r) => [r[0], r]));
  for (let i = 0; i < p.s.length;) {
    const r = repeatAt.get(i);
    if (r) {
      for (let n = 0; n < r[2]; n += 1)
        for (let j = r[0]; j <= r[1]; j += 1) out.push(p.s[j]);
      i = r[1] + 1;
    } else out.push(p.s[i++]);
  }
  return out;
}
const isShort = (s: readonly number[]) =>
  (s[SEG.durType] === 1 && s[SEG.dur] < 120) ||
  (s[SEG.durType] === 2 && s[SEG.dur] < 400);

describe("catalog", () => {
  it("has the 14 run types of the contract in order, with names that fit the watch", () => {
    expect(RUN_CATALOG.map((c) => c.type)).toEqual([...RUN_TYPES]);
    expect(RUN_CATALOG).toHaveLength(14);
    for (const entry of RUN_CATALOG) {
      expect(entry.name).toBe(RUN_TYPE_NAMES[entry.type]);
      expect(entry.name.length).toBeLessThanOrEqual(RUN_LIMITS.wireName);
      expect(entry.hard).toBe(HARD_RUN_TYPES.includes(entry.type));
    }
    expect(RUN_CATALOG.find((c) => c.type === "hills")!.environments).toEqual([
      "outdoor",
      "treadmill",
    ]);
  });

  it("derives the experience cautiously", () => {
    const e = (months: number | null, minutes: number | null) =>
      runExperience({
        running_experience_months: months,
        base_minutes_per_week: minutes,
      });
    expect(e(null, 200)).toBe("beginner");
    expect(e(12, null)).toBe("beginner");
    expect(e(2, 300)).toBe("beginner");
    expect(e(36, 89)).toBe("beginner");
    expect(e(12, 120)).toBe("intermediate");
    expect(e(23, 400)).toBe("intermediate");
    expect(e(24, 239)).toBe("intermediate");
    expect(e(24, 240)).toBe("advanced");
  });
});

describe("every run type × experience × environment", () => {
  for (const type of RUN_TYPES)
    for (const experience of RUN_EXPERIENCES)
      for (const environment of RUN_ENVIRONMENTS)
        for (const withPaces of [false, true]) {
          const name = `${type} · ${experience} · ${environment} · ${withPaces ? "with reference" : "no reference"}`;
          it(name, () => {
            const input = base(type, environment, experience, {
              paces: withPaces ? PACES : null,
            });
            const result = buildRunPrescription(input);
            if (type === "hills" && environment === "track") {
              expect(result).toMatchObject({
                ok: false,
                reason: "environment_not_supported",
              });
              return;
            }
            if (!result.ok) throw new Error(result.message);
            const p = result.prescription;

            // schema, budgets, limits
            expect(RunPrescriptionSchema.safeParse(p).success).toBe(true);
            expect(jsonBytes(p)).toBeLessThanOrEqual(
              RUN_WATCH_BUDGET_BYTES.prescriptionTypical,
            );
            expect(expandedSegmentCount(p.s, p.rp)).toBeLessThanOrEqual(
              RUN_LIMITS.maxSegments,
            );
            expect(p.n.length).toBeLessThanOrEqual(RUN_LIMITS.wireName);
            expect(p.h!.length).toBeLessThanOrEqual(RUN_LIMITS.wireHint);
            expect(p.k).toBe(RUN_TYPES.indexOf(type));
            expect(p.e).toBe(RUN_ENVIRONMENTS.indexOf(environment));
            expect(result.rules_version).toBe(RUN_RULES_VERSION);
            expect(result.rationale.length).toBeGreaterThanOrEqual(2);
            expect(result.summary.hard).toBe(HARD_RUN_TYPES.includes(type));

            const segments = expand(p);
            const paceSegments = segments.filter((s) => s[SEG.tType] === 2);

            // pace targets: reference only, never on a treadmill, never under 2 min / 400 m
            if (!withPaces || environment === "treadmill")
              expect(paceSegments).toHaveLength(0);
            for (const s of paceSegments) {
              expect(isShort(s)).toBe(false);
              expect(s[SEG.kind]).toBe(1);
            }
            if (
              withPaces &&
              environment !== "treadmill" &&
              PACE_TARGET_TYPES.includes(type)
            )
              expect(paceSegments.length).toBeGreaterThan(0);
            expect(result.summary.pace_targets).toBe(paceSegments.length > 0);

            // alarms follow the targets
            expect(p.a?.pace !== undefined).toBe(paceSegments.length > 0);
            if (environment === "treadmill") expect(p.a?.pace).toBeUndefined();
            const hrWork = segments.some(
              (s) =>
                s[SEG.kind] === 1 && (s[SEG.tType] === 1 || s[SEG.tType] === 3),
            );
            expect(p.a?.hi !== undefined).toBe(hrWork);
            if (p.a?.lo) expect(hrWork).toBe(true);
            // warm-up and cool-down carry no heart-rate target (no heart-rate alarm there)
            for (const s of segments)
              if (s[SEG.kind] === 0 || s[SEG.kind] === 3)
                expect([0, 4]).toContain(s[SEG.tType]);
            // short work never has a pace target
            for (const s of segments)
              if (s[SEG.kind] === 1 && isShort(s))
                expect(s[SEG.tType]).not.toBe(2);

            // effort and structure
            expect(segments.some((s) => s[SEG.kind] === 1)).toBe(true);
            if (type === "free") expect(p.r).toBeUndefined();
            else expect(p.r).toBeGreaterThanOrEqual(1);

            // deterministic
            expect(buildRunPrescription(input)).toEqual(result);
          });
        }
});

describe("standard sessions", () => {
  it("base run: 45 minutes Zone 2 for an intermediate runner (S1)", () => {
    const result = plan(
      base("base", "outdoor", "intermediate", { minutes: 45 }),
    );
    expect(result.prescription).toEqual({
      k: 1,
      n: "Grundlage",
      e: 0,
      s: [[1, 1, 2700, 1, 1, 2]],
      a: { hi: [20, 0, 300, 60] },
      h: expect.stringContaining("Zone 2"),
      r: 3,
    });
    expect(result.summary).toMatchObject({
      total_s: 2700,
      work_s: 2700,
      distance_m: null,
      time_is_estimate: false,
    });
    expect(result.adjustments).toEqual([]);
    expect(result.rationale.join(" ")).toContain("Zone 1–2 laut Uhr");
  });

  it("recovery stays in zone 1 with half a zone of tolerance", () => {
    const p = plan(base("recovery")).prescription;
    expect(p.s).toEqual([[1, 1, 1800, 1, 1, 1]]);
    expect(p.a?.hi).toEqual([
      20,
      ALARM_DEFAULTS.hi_recovery_tolerance_bpm,
      300,
      60,
    ]);
    expect(p.r).toBe(2);
  });

  it("describes zones in beats only when they are known", () => {
    const zones = hrZones({ bounds: [95, 114, 133, 152, 171, 190] });
    const known = plan(
      base("base", "outdoor", "intermediate", { hr_zones: zones }),
    );
    expect(known.rationale.join(" ")).toContain("Zone 1–2 (95–133 Schläge)");
    expect(plan(base("base")).rationale.join(" ")).not.toMatch(/Schläge\)/);
  });

  it("long run: drink reminder from 60 minutes, faster finish only for experienced runners", () => {
    expect(plan(base("long")).prescription.dr).toEqual([60, 30]); // 75 min
    expect(
      plan(base("long", "outdoor", "beginner")).prescription.dr,
    ).toBeUndefined(); // 50 min
    const finish = plan(
      base("long", "outdoor", "advanced", { fast_finish: true }),
    );
    expect(finish.prescription.s).toEqual([
      [1, 1, 4500, 1, 1, 2],
      [1, 1, 900, 1, 3, 3],
    ]);
    const novice = plan(
      base("long", "outdoor", "beginner", { minutes: 60, fast_finish: true }),
    );
    expect(novice.prescription.s).toHaveLength(1);
    expect(novice.notes.map((n) => n.code)).toContain("fast_finish_ignored");
    const mid = plan(
      base("long", "outdoor", "intermediate", {
        minutes: 60,
        fast_finish: true,
      }),
    );
    expect(mid.prescription.s).toEqual([
      [1, 1, 3000, 1, 1, 2],
      [1, 1, 600, 1, 3, 3],
    ]);
  });

  it("tempo run: pace band from the reference, otherwise zone 4 with a low-heart-rate alarm", () => {
    const withPace = plan(
      base("tempo", "outdoor", "intermediate", { paces: PACES }),
    ).prescription;
    expect(withPace.s).toEqual([
      [0, 1, 720, 4, 2, 4],
      [1, 1, 1200, 2, PACES.t.fast_s_per_km, PACES.t.slow_s_per_km],
      [3, 1, 600, 4, 1, 3],
    ]);
    expect(withPace.a).toEqual({ pace: [15, 3, 20, 60] });
    const noPace = plan(base("tempo", "outdoor", "intermediate")).prescription;
    expect(noPace.s[1]).toEqual([1, 1, 1200, 1, 4, 4]);
    expect(noPace.a).toEqual({ hi: [20, 0, 300, 60], lo: [30, 0, 900, 60] });
  });

  it("intervals: by time outdoors, by distance on the track with a reference", () => {
    const outdoor = plan(
      base("intervals", "outdoor", "intermediate", { paces: PACES }),
    ).prescription;
    expect(outdoor.s[1]).toEqual([
      1,
      1,
      180,
      2,
      PACES.i.fast_s_per_km,
      PACES.i.slow_s_per_km,
    ]);
    expect(outdoor.s[2]).toEqual([2, 1, 180, 0, 0, 0]); // recovery as long as the work
    expect(outdoor.rp).toEqual([[1, 2, 5]]);
    const track = plan(
      base("intervals", "track", "intermediate", { paces: PACES }),
    ).prescription;
    expect(track.s[1][SEG.durType]).toBe(2);
    expect(track.s[1][SEG.dur]).toBe(800);
    expect(track.s[1][SEG.tType]).toBe(2);
    const trackNoRef = plan(
      base("intervals", "track", "intermediate"),
    ).prescription;
    expect(trackNoRef.s[1]).toEqual([1, 1, 180, 4, 8, 9]);
    expect(trackNoRef.a).toBeUndefined();
  });

  it("short work (repetitions, strides, hills) never gets a pace target or alarm, even with a reference", () => {
    for (const type of ["repetitions", "strides", "hills"] as const) {
      const p = plan(
        base(type, "outdoor", "advanced", { paces: PACES }),
      ).prescription;
      expect(p.a?.pace).toBeUndefined();
      expect(expand(p).filter((s) => s[SEG.tType] === 2)).toHaveLength(0);
    }
    const reps = plan(
      base("repetitions", "outdoor", "advanced", { paces: PACES }),
    ).prescription;
    expect(
      expand(reps)
        .filter((s) => s[SEG.kind] === 1)
        .every(isShort),
    ).toBe(true);
    expect(plan(base("repetitions")).rationale.join(" ")).toContain(
      "ohne Tempoalarm",
    );
  });

  it("strides hang on an easy run and keep the heart-rate alarm there only", () => {
    const p = plan(base("strides", "outdoor", "intermediate")).prescription;
    expect(p.s).toEqual([
      [1, 1, 1800, 1, 1, 2],
      [1, 1, 20, 4, 5, 7],
      [2, 1, 75, 0, 0, 0],
    ]);
    expect(p.rp).toEqual([[1, 2, 6]]);
    expect(p.a).toEqual({ hi: [20, 0, 300, 60] });
  });

  it("run-walk: 8 × (2 min run, 1 min walk) for intermediate runners, effort 4", () => {
    const p = plan(base("run_walk", "outdoor", "intermediate")).prescription;
    expect(p.s).toEqual([
      [0, 1, 300, 0, 0, 0],
      [1, 1, 120, 1, 1, 2],
      [2, 1, 60, 0, 0, 0],
      [3, 1, 300, 0, 0, 0],
    ]);
    expect(p.rp).toEqual([[1, 2, 8]]);
    expect(p.r).toBe(4);
  });

  it("progression: three thirds, the last one at the lower threshold pace or zone 4", () => {
    const noPace = plan(base("progression")).prescription; // 45 min
    expect(noPace.s).toEqual([
      [1, 1, 900, 1, 1, 2],
      [1, 1, 900, 1, 3, 3],
      [1, 1, 900, 1, 4, 4],
    ]);
    const withPace = plan(
      base("progression", "outdoor", "intermediate", { paces: PACES }),
    ).prescription;
    expect(withPace.s[2][SEG.tType]).toBe(2);
    expect(withPace.s[2][SEG.low]).toBeGreaterThanOrEqual(
      PACES.t.fast_s_per_km,
    );
    expect(withPace.s[2][SEG.high]).toBe(PACES.t.slow_s_per_km);
    const byDistance = plan(
      base("progression", "outdoor", "intermediate", { meters: 9000 }),
    ).prescription;
    expect(byDistance.s.map((s) => s[SEG.dur])).toEqual([3000, 3000, 3000]);
    expect(byDistance.s.every((s) => s[SEG.durType] === 2)).toBe(true);
  });

  it("test: 5 km by default, 30 minutes on a treadmill, no target and no alarm", () => {
    const outdoor = plan(base("test", "outdoor", "advanced"));
    expect(outdoor.prescription.s).toEqual([
      [0, 1, 900, 4, 2, 4],
      [1, 2, 5000, 0, 0, 0],
      [3, 1, 600, 4, 1, 3],
    ]);
    expect(outdoor.prescription.a).toBeUndefined();
    expect(outdoor.prescription.r).toBe(10);
    const band = plan(base("test", "treadmill", "advanced"));
    expect(band.prescription.s[1]).toEqual([1, 1, 1800, 0, 0, 0]);
    expect(band.notes.map((n) => n.code)).toContain(
      "test_treadmill_no_reference",
    );
    const bandDistance = plan(
      base("test", "treadmill", "intermediate", { meters: 10_000 }),
    );
    expect(bandDistance.prescription.s[1]).toEqual([1, 1, 1800, 0, 0, 0]);
    expect(bandDistance.notes.map((n) => n.code)).toContain(
      "test_time_instead_of_distance",
    );
    const testMeters = (experience: RunExperience, meters: number) =>
      plan(base("test", "outdoor", experience, { meters })).prescription.s[1][
        SEG.dur
      ];
    expect(testMeters("beginner", 10_000)).toBe(5000);
    expect(testMeters("advanced", 1500)).toBe(3000);
    expect(testMeters("advanced", 21_097)).toBe(21_097);
    const timed = plan(base("test", "outdoor", "advanced", { minutes: 20 }));
    expect(timed.prescription.s[1]).toEqual([1, 1, 1800, 0, 0, 0]);
    expect(timed.adjustments).toEqual([
      expect.objectContaining({ field: "minutes", requested: 20, applied: 30 }),
    ]);
  });

  it("free run: open without a request, with a duration or a distance on request", () => {
    expect(plan(base("free")).prescription.s).toEqual([[1, 0, 0, 0, 0, 0]]);
    expect(plan(base("free")).summary.total_s).toBeNull();
    expect(
      plan(base("free", "outdoor", "intermediate", { minutes: 50 }))
        .prescription.s,
    ).toEqual([[1, 1, 3000, 0, 0, 0]]);
    expect(
      plan(base("free", "outdoor", "intermediate", { meters: 7000 }))
        .prescription.s,
    ).toEqual([[1, 2, 7000, 0, 0, 0]]);
    expect(plan(base("free")).prescription.a).toBeUndefined();
  });
});

describe("environment", () => {
  it("never prescribes a pace on the treadmill, with or without a reference", () => {
    for (const type of RUN_TYPES) {
      const p = plan(
        base(type, "treadmill", "advanced", { paces: PACES }),
      ).prescription;
      expect(expand(p).some((s) => s[SEG.tType] === 2)).toBe(false);
      expect(p.a?.pace).toBeUndefined();
    }
    expect(
      plan(base("tempo", "treadmill", "advanced", { paces: PACES })).notes.map(
        (n) => n.code,
      ),
    ).toContain("treadmill_no_pace");
    // all segments by time on the treadmill, even when a distance was asked
    for (const type of RUN_TYPES) {
      const p = plan(
        base(type, "treadmill", "advanced", { meters: 8000 }),
      ).prescription;
      expect(p.s.every((s) => s[SEG.durType] !== 2)).toBe(true);
    }
    expect(
      plan(base("base", "treadmill", "advanced", { meters: 8000 })).notes.map(
        (n) => n.code,
      ),
    ).toContain("treadmill_distance_estimated");
    expect(plan(base("base", "treadmill")).prescription.h).toContain(
      "Laufband",
    );
  });

  it("refuses hill repeats on a track and notes the incline on a treadmill", () => {
    expect(buildRunPrescription(base("hills", "track"))).toMatchObject({
      ok: false,
      reason: "environment_not_supported",
    });
    expect(plan(base("hills", "treadmill")).notes.map((n) => n.code)).toContain(
      "hills_treadmill_incline",
    );
  });

  it("explains a missing pace by its reason", () => {
    const text = plan(
      base("tempo", "outdoor", "intermediate", {
        pace_reason: "reference_too_old",
      }),
    ).rationale.join(" ");
    expect(text).toContain("älter als 12 Wochen");
    expect(text).toContain("nicht nach Tempo");
    expect(plan(base("tempo")).notes.map((n) => n.code)).toContain(
      "no_pace_reference",
    );
  });
});

describe("safety limits and requests", () => {
  const dur = (input: RunPlanInput) => plan(input).prescription.s[0][SEG.dur];

  it("clamps a requested duration to the limits and reports it", () => {
    const long = plan(base("base", "outdoor", "beginner", { minutes: 120 }));
    expect(long.prescription.s[0][SEG.dur]).toBe(45 * 60);
    expect(long.adjustments).toEqual([
      expect.objectContaining({
        field: "minutes",
        requested: 120,
        applied: 45,
      }),
    ]);
    expect(dur(base("base", "outdoor", "advanced", { minutes: 5 }))).toBe(
      30 * 60,
    );
    expect(dur(base("recovery", "outdoor", "advanced", { minutes: 90 }))).toBe(
      40 * 60,
    );
    expect(dur(base("long", "outdoor", "advanced", { minutes: 400 }))).toBe(
      150 * 60,
    );
    expect(dur(base("free", "outdoor", "beginner", { minutes: 600 }))).toBe(
      60 * 60,
    );
  });

  it("clamps a requested distance via the limits of the run type", () => {
    const far = plan(base("long", "outdoor", "beginner", { meters: 40_000 }));
    expect(far.prescription.s[0][SEG.durType]).toBe(2);
    expect(far.prescription.s[0][SEG.dur]).toBeLessThan(40_000);
    expect(far.prescription.s[0][SEG.dur] % 100).toBe(0);
    expect(far.adjustments[0]).toMatchObject({
      field: "meters",
      requested: 40_000,
    });
    const ok = plan(
      base("long", "outdoor", "intermediate", { meters: 14_000 }),
    );
    expect(ok.prescription.s[0][SEG.dur]).toBe(14_000);
    expect(ok.summary).toMatchObject({
      distance_m: 14_000,
      time_is_estimate: true,
    });
    expect(ok.adjustments).toEqual([]);
  });

  it("fits structured sessions to a requested duration inside the repetition limits", () => {
    const fitted = plan(
      base("intervals", "outdoor", "intermediate", { minutes: 50 }),
    );
    expect(fitted.prescription.rp![0][2]).toBe(5); // 22 min frame + 5 × 6 min = 52
    expect(fitted.summary.total_s).toBe(52 * 60);
    expect(
      plan(base("intervals", "outdoor", "intermediate", { minutes: 120 }))
        .prescription.rp![0][2],
    ).toBe(6); // at most 6 repetitions
    const small = plan(
      base("intervals", "outdoor", "advanced", { minutes: 20 }),
    );
    expect(small.prescription.rp![0][2]).toBe(5); // at least 5 repetitions
    expect(small.adjustments).toEqual([
      expect.objectContaining({ field: "minutes", requested: 20 }),
    ]);
    const tempo = plan(base("tempo", "outdoor", "advanced", { minutes: 200 }));
    expect(tempo.prescription.s[1][SEG.dur]).toBe(40 * 60);
    const converted = plan(
      base("intervals", "outdoor", "intermediate", { meters: 8000 }),
    );
    expect(converted.notes.map((n) => n.code)).toContain("distance_converted");
    expect(converted.summary.time_is_estimate).toBe(true);
  });

  it("limits beginners and flags hard sessions", () => {
    for (const type of HARD_RUN_TYPES)
      expect(
        plan(base(type, "outdoor", "beginner")).notes.map((n) => n.code),
      ).toContain("beginner_hard");
    expect(
      plan(base("base", "outdoor", "beginner")).notes.map((n) => n.code),
    ).not.toContain("beginner_hard");
    const sprints = plan(
      base("repetitions", "outdoor", "beginner", { minutes: 90 }),
    ).prescription;
    expect(sprints.rp![0][2]).toBeLessThanOrEqual(8);
    expect(sprints.s[1][SEG.dur]).toBeLessThanOrEqual(30);
  });

  it("switches the heart-rate and pace alarms off by profile setting", () => {
    expect(
      plan(
        base("base", "outdoor", "intermediate", {
          alarms: { hr: false, pace: true },
        }),
      ).prescription.a,
    ).toBeUndefined();
    expect(
      plan(
        base("tempo", "outdoor", "intermediate", {
          paces: PACES,
          alarms: { hr: true, pace: false },
        }),
      ).prescription.a,
    ).toBeUndefined();
    expect(
      plan(
        base("tempo", "outdoor", "intermediate", {
          alarms: { hr: false, pace: false },
        }),
      ).prescription.a,
    ).toBeUndefined();
  });

  it("refuses senseless input instead of guessing", () => {
    const bad: Partial<RunPlanInput>[] = [
      { minutes: 0 },
      { minutes: -5 },
      { minutes: Number.NaN },
      { meters: -1 },
      { meters: Number.POSITIVE_INFINITY },
      { minutes: 30, meters: 5000 },
      { level: -1 },
      { level: Number.NaN },
      { run_type: "sprint" as RunType },
      { environment: "road" as RunEnvironment },
      { experience: "pro" as RunExperience },
    ];
    for (const extra of bad)
      expect(buildRunPrescription({ ...base("base"), ...extra })).toMatchObject(
        { ok: false, reason: "invalid_input" },
      );
  });
});

describe("levels", () => {
  it("alternates one more repetition and 30 seconds longer, as the spec says", () => {
    const at = (level: number) => {
      const p = plan(
        base("intervals", "outdoor", "intermediate", { level }),
      ).prescription;
      return { reps: p.rp![0][2], work: p.s[1][SEG.dur] };
    };
    expect(at(0)).toEqual({ reps: 5, work: 180 });
    expect(at(1)).toEqual({ reps: 6, work: 180 });
    expect(at(2)).toEqual({ reps: 6, work: 210 });
    expect(at(3)).toEqual({ reps: 6, work: 240 });
    expect(runLevelCeiling("intervals", "intermediate")).toBe(3);
    expect(at(9)).toEqual({ reps: 6, work: 240 });
  });

  it("adds 5 minutes to base and tempo, 10 to the long run, 2 repetitions to sprints", () => {
    const main = (type: RunType, level: number) =>
      plan(base(type, "outdoor", "intermediate", { level })).prescription;
    expect(main("base", 2).s[0][SEG.dur]).toBe(55 * 60);
    expect(main("long", 2).s[0][SEG.dur]).toBe(95 * 60);
    expect(main("tempo", 1).s[1][SEG.dur]).toBe(25 * 60);
    expect(main("repetitions", 1).rp![0][2]).toBe(10);
  });

  it("run-walk: the running part grows by 30 s and the walking part shrinks by 15 s per level", () => {
    const at = (level: number) => {
      const p = plan(
        base("run_walk", "outdoor", "beginner", { level }),
      ).prescription;
      return [p.s[1][SEG.dur], p.s[2][SEG.dur]];
    };
    expect(at(0)).toEqual([60, 90]);
    expect(at(1)).toEqual([90, 75]);
    expect(at(2)).toEqual([120, 60]);
    for (const experience of RUN_EXPERIENCES) {
      const ceiling = runLevelCeiling("run_walk", experience);
      const result = plan(
        base("run_walk", "outdoor", experience, { level: ceiling }),
      );
      expect(result.summary.total_s!).toBeLessThanOrEqual(
        { beginner: 45, intermediate: 50, advanced: 60 }[experience] * 60,
      );
    }
  });

  it("reports the ceiling instead of overshooting", () => {
    const result = plan(base("base", "outdoor", "beginner", { level: 99 }));
    expect(result.prescription.s[0][SEG.dur]).toBe(45 * 60);
    expect(result.summary).toMatchObject({ level: 3, level_ceiling: 3 });
    expect(result.adjustments).toEqual([
      expect.objectContaining({ field: "level", requested: 99, applied: 3 }),
    ]);
    expect(result.notes.map((n) => n.code)).toContain("level_at_ceiling");
    expect(runLevelCeiling("recovery", "advanced")).toBe(0);
    expect(
      plan(base("recovery", "outdoor", "advanced", { level: 3 })).notes.map(
        (n) => n.code,
      ),
    ).toContain("recovery_not_progressive");
  });

  it("a requested duration replaces the level", () => {
    const result = plan(
      base("base", "outdoor", "intermediate", { level: 4, minutes: 40 }),
    );
    expect(result.prescription.s[0][SEG.dur]).toBe(2400);
    expect(result.summary.level).toBe(0);
    expect(result.notes.map((n) => n.code)).toContain("level_not_used");
  });

  it("every level up to the ceiling is a valid prescription", () => {
    for (const type of RUN_TYPES)
      for (const experience of RUN_EXPERIENCES) {
        const ceiling = runLevelCeiling(type, experience);
        for (let level = 0; level <= ceiling; level += 1) {
          const result = plan(
            base(type, "outdoor", experience, { level, paces: PACES }),
          );
          expect(result.summary.level).toBe(level);
          expect(jsonBytes(result.prescription)).toBeLessThanOrEqual(
            RUN_WATCH_BUDGET_BYTES.prescription,
          );
        }
      }
  });

  it("the track ceiling for intervals by distance follows the distance steps", () => {
    expect(runLevelCeiling("intervals", "advanced", "track", true)).toBe(
      2 + Math.ceil((1200 - 1000) / 100),
    );
    const top = plan(
      base("intervals", "track", "advanced", { paces: PACES, level: 99 }),
    );
    expect(top.prescription.s[1][SEG.dur]).toBe(1200);
  });
});

describe("module hygiene", () => {
  it("uses no clock and no I/O in the plan engine", () => {
    const dir = join(__dirname, "../src/analytics/running");
    const files = readdirSync(dir).filter((f) => f.endsWith(".ts"));
    expect(files).toEqual(
      expect.arrayContaining([
        "catalog.ts",
        "index.ts",
        "prescription.ts",
        "vdot.ts",
        "version.ts",
        "zones.ts",
      ]),
    );
    for (const file of files) {
      const source = readFileSync(join(dir, file), "utf8");
      expect(source, file).not.toMatch(
        /Date\.now|new Date|Math\.random|process\.env|from "node:|require\(/,
      );
    }
  });

  it("standardRunPlan builds the standard session", () => {
    const result = standardRunPlan("base", "advanced", "outdoor");
    expect(result.ok && result.prescription.s[0][SEG.dur]).toBe(3600);
  });
});
