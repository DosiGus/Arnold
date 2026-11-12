/**
 * Running contract (RUN-003): segment encoding, watch payloads and their
 * byte budgets, measured with umlauts and UUIDs as the watch receives them.
 */
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { ArnoldIdSchema } from "../src/shared/arnold-schema-v1";
import {
  RUN_ENVIRONMENTS,
  RUN_LIMITS,
  RUN_TYPES,
  RUN_WATCH_API_VERSION,
  RUN_WATCH_BUDGET_BYTES,
  RunIdSchema,
  RunPrescriptionSchema,
  RunSegmentTupleSchema,
  WatchRunDetailSchema,
  WatchRunRequestSchema,
  WatchRunRpeRequestSchema,
  WatchRunsUpcomingSchema,
  expandedSegmentCount,
  fromCode,
  jsonBytes,
  toCode,
} from "../src/shared/run-contract";
import { WATCH_API_VERSION } from "../src/shared/watch-contract";

const envelope = { api_version: 1, min_app_version: "1.1.0" } as const;
/** The longest name the wire allows, two bytes per character. */
const longName = "Ü".repeat(RUN_LIMITS.wireName);
const longHint = "ä".repeat(RUN_LIMITS.wireHint);

describe("vocabulary", () => {
  it("keeps the wire codes of run types and environments stable", () => {
    // Append-only lists: these positions are on watches in the field.
    expect(RUN_TYPES.indexOf("base")).toBe(1);
    expect(RUN_TYPES.indexOf("free")).toBe(13);
    expect(RUN_TYPES).toHaveLength(14);
    expect(RUN_ENVIRONMENTS).toEqual(["outdoor", "treadmill", "track"]);
    expect(fromCode(RUN_TYPES, toCode(RUN_TYPES, "run_walk"))).toBe("run_walk");
    expect(() => fromCode(RUN_TYPES, 99)).toThrow(RangeError);
  });

  it("uses the same API version and ID rule as the strength routes", () => {
    expect(RUN_WATCH_API_VERSION).toBe(WATCH_API_VERSION);
    for (const value of ["abc", " abc", "a\u0000b", "", "x".repeat(64)])
      expect(RunIdSchema.safeParse(value).success, value).toBe(
        ArnoldIdSchema.safeParse(value).success,
      );
    expect(RunIdSchema.safeParse("x".repeat(65)).success).toBe(false);
  });
});

describe("segment encoding [kind, duration type, value, target type, low, high]", () => {
  const ok = (tuple: unknown) => RunSegmentTupleSchema.safeParse(tuple).success;

  it("accepts each target type within its bounds", () => {
    expect(ok([0, 1, 600, 0, 0, 0])).toBe(true); // 10 min warm-up, no target
    expect(ok([1, 1, 2700, 1, 1, 2])).toBe(true); // 45 min zone 1–2
    expect(ok([1, 2, 800, 2, 225, 235])).toBe(true); // 800 m at 3:45–3:55/km
    expect(ok([1, 1, 1200, 3, 140, 152])).toBe(true); // bpm
    expect(ok([1, 1, 60, 4, 8, 9])).toBe(true); // effort
    expect(ok([4, 0, 0, 0, 0, 0])).toBe(true); // rest until lap key
  });

  it("refuses inconsistent or out-of-range segments", () => {
    expect(ok([5, 1, 60, 0, 0, 0])).toBe(false); // lap is a result kind only
    expect(ok([1, 0, 30, 0, 0, 0])).toBe(false); // open with a value
    expect(ok([1, 1, 0, 0, 0, 0])).toBe(false); // zero seconds
    expect(ok([1, 2, 100_001, 0, 0, 0])).toBe(false); // over 100 km
    expect(ok([1, 1, 60, 1, 0, 6])).toBe(false); // zones are 1–5
    expect(ok([1, 1, 60, 2, 300, 240])).toBe(false); // fast > slow
    expect(ok([1, 1, 60, 0, 1, 1])).toBe(false); // no target, bounds set
    expect(ok([1, 1, 60, 3, 140])).toBe(false); // five numbers
    expect(ok([1, 1, 60.5, 0, 0, 0])).toBe(false); // integers only
  });

  it("encodes 6 × 800 m with repeats and counts the expanded segments", () => {
    const prescription = RunPrescriptionSchema.parse({
      k: toCode(RUN_TYPES, "intervals"),
      n: "6 × 800 m",
      e: 0,
      s: [
        [0, 1, 900, 1, 1, 2],
        [1, 2, 800, 2, 225, 235],
        [2, 1, 180, 0, 0, 0],
        [3, 1, 600, 1, 1, 2],
      ],
      rp: [[1, 2, 6]],
      a: { hi: [20, 3, 300, 60], pace: [15, 5, 20, 30] },
      r: 8,
    });
    expect(expandedSegmentCount(prescription.s, prescription.rp)).toBe(14);
    const bad = (rp: unknown) =>
      RunPrescriptionSchema.safeParse({ ...prescription, rp }).success;
    expect(bad([[1, 4, 2]])).toBe(false); // missing segment
    expect(
      bad([
        [1, 2, 2],
        [2, 3, 2],
      ]),
    ).toBe(false); // overlap
    expect(bad([[2, 1, 2]])).toBe(false); // first > last
    expect(bad([[1, 2, 1]])).toBe(false); // a repeat repeats
    expect(bad([[0, 3, 21]])).toBe(false); // 84 segments after expansion
  });
});

/** A prescription at the limits: 80 segments, longest name and hint. */
function extremePrescription() {
  return {
    k: toCode(RUN_TYPES, "threshold_intervals"),
    n: longName,
    e: 2,
    s: Array.from(
      { length: RUN_LIMITS.maxSegments },
      () => [4, 2, 100_000, 3, 250, 250] as const,
    ),
    a: {
      hi: [600, 120, 3600, 3600],
      lo: [600, 120, 3600, 3600],
      pace: [600, 120, 3600, 3600],
    },
    h: longHint,
    dr: [600, 600],
    r: 10,
  };
}

describe("GET /runs/:id", () => {
  it("stays within 3000 bytes at the limits", () => {
    const body = WatchRunDetailSchema.parse({
      ...envelope,
      id: randomUUID(),
      p: extremePrescription(),
    });
    expect(jsonBytes(body)).toBeLessThanOrEqual(
      RUN_WATCH_BUDGET_BYTES.prescription,
    );
  });

  it("stays within 1500 bytes for a typical interval session", () => {
    const body = WatchRunDetailSchema.parse({
      ...envelope,
      id: randomUUID(),
      p: {
        k: toCode(RUN_TYPES, "intervals"),
        n: "Intervalle 6 × 800 m",
        e: 2,
        s: [
          [0, 1, 900, 1, 1, 2],
          [1, 2, 800, 2, 225, 235],
          [2, 1, 180, 0, 0, 0],
          [3, 1, 600, 1, 1, 2],
        ],
        rp: [[1, 2, 6]],
        a: { hi: [20, 3, 300, 60], pace: [15, 5, 20, 30] },
        h: "Locker einlaufen, Belastungen gleichmäßig, Trabpausen ruhig.",
        r: 8,
      },
    });
    expect(jsonBytes(body)).toBeLessThanOrEqual(
      RUN_WATCH_BUDGET_BYTES.prescriptionTypical,
    );
  });

  it("refuses a name or hint longer than the wire allows", () => {
    const p = extremePrescription();
    expect(
      RunPrescriptionSchema.safeParse({ ...p, n: `${longName}x` }).success,
    ).toBe(false);
    expect(
      RunPrescriptionSchema.safeParse({ ...p, h: `${longHint}x` }).success,
    ).toBe(false);
    expect(
      RunPrescriptionSchema.safeParse({ ...p, s: [...p.s, p.s[0]] }).success,
    ).toBe(false);
  });
});

describe("GET /runs/upcoming", () => {
  const entry = (d?: string) => ({
    id: randomUUID(),
    ...(d ? { d } : {}),
    n: longName,
    k: toCode(RUN_TYPES, "threshold_intervals"),
    m: 600,
    dm: 100_000,
    e: 2,
    tag: "AbCdEfGhIjKlMnOp",
  });
  const full = () => ({
    ...envelope,
    d: "2026-11-13",
    hc: true,
    runs: [13, 14, 15, 16, 17, 18, 19].map((day) => entry(`2026-11-${day}`)),
    next: entry(),
  });

  it("stays within 1500 bytes with seven runs, the next session, umlauts and UUIDs", () => {
    const body = WatchRunsUpcomingSchema.parse(full());
    expect(jsonBytes(body)).toBeLessThanOrEqual(
      RUN_WATCH_BUDGET_BYTES.upcoming,
    );
  });

  it("refuses an eighth run, undated or unsorted runs and a dated next session", () => {
    const body = full();
    const parse = (value: unknown) =>
      WatchRunsUpcomingSchema.safeParse(value).success;
    expect(parse({ ...body, runs: [...body.runs, entry("2026-11-19")] })).toBe(
      false,
    );
    expect(parse({ ...body, runs: [entry()] })).toBe(false);
    expect(parse({ ...body, runs: [...body.runs].reverse() })).toBe(false);
    expect(parse({ ...body, runs: [entry("2026-11-12")] })).toBe(false);
    expect(parse({ ...body, next: entry("2026-11-20") })).toBe(false);
    expect(parse({ ...body, runs: [], next: null })).toBe(true);
  });
});

describe("POST /runs", () => {
  const base = {
    request_id: randomUUID(),
    session_uuid: randomUUID(),
    planned_workout_id: randomUUID(),
    workout_date_local: "2026-11-13",
    utc_offset_min: 60,
    started_at_utc: "2026-11-13T17:00:00.000Z",
    ended_at_utc: "2026-11-13T17:47:00.000Z",
    environment: "outdoor",
    run_type: "base",
    timer_s: 2700,
    elapsed_s: 2820,
    distance_m: 7420,
    distance_source: "gps",
    ascent_m: 41,
    descent_m: 39,
    cadence_spm: 168,
    calories_kcal: 512,
    te_aerobic: 2.8,
    te_anaerobic: 0.4,
    splits: Array.from({ length: 74 }, (_, i) => (i + 1) * 36),
    pauses: 1,
    segments: [
      { i: 0, rep: null, kind: 1, st: 0, t: 2700, dm: 7420, tz: 2410 },
    ],
    hr: {
      avg: 141,
      max: 156,
      zone_s: [300, 2100, 300, 0, 0],
      zones: [98, 118, 137, 157, 176, 196],
      zones_sport: "running",
    },
    rpe: 3,
  };

  it("accepts a full result and a result without heart rate", () => {
    expect(WatchRunRequestSchema.safeParse(base).success).toBe(true);
    const { hr: _hr, ...noHr } = base;
    expect(WatchRunRequestSchema.safeParse(noHr).success).toBe(true);
  });

  it("refuses contradictions and never takes coordinates", () => {
    const bad = (patch: object) =>
      WatchRunRequestSchema.safeParse({ ...base, ...patch }).success;
    expect(bad({ timer_s: 3000 })).toBe(false); // timer > elapsed
    expect(bad({ ended_at_utc: "2026-11-13T16:00:00.000Z" })).toBe(false);
    expect(bad({ plan_version_id: "pv-1" })).toBe(false); // without session
    expect(bad({ plan_version_id: "pv-1", session_id: "s-1" })).toBe(false); // and planned run
    expect(bad({ splits: [40, 30] })).toBe(false); // decreasing
    expect(bad({ splits: Array.from({ length: 80 }, (_, i) => i) })).toBe(
      false,
    ); // more than the distance
    expect(
      bad({
        hr: { ...base.hr, zones: [98, 118, 118, 157, 176, 196] },
      }),
    ).toBe(false); // zones not ascending
    expect(bad({ lat: 48.1, lon: 11.5 })).toBe(false); // D-RUN-08
    expect(bad({ rpe: 11 })).toBe(false);
  });

  it("fits a 60 km run with 80 segments well under 64 KB", () => {
    const body = WatchRunRequestSchema.parse({
      ...base,
      timer_s: 36_000,
      elapsed_s: 36_000,
      distance_m: 60_000,
      splits: Array.from({ length: 600 }, (_, i) => i * 60),
      segments: Array.from({ length: 80 }, (_, i) => ({
        i,
        rep: 50,
        kind: 1,
        st: 2,
        t: 36_000,
        dm: 100_000,
        tz: 36_000,
        hr: [200, 250],
      })),
    });
    expect(jsonBytes(body)).toBeLessThan(RUN_WATCH_BUDGET_BYTES.result / 4);
  });

  it("takes an effort later with its own request_id", () => {
    expect(
      WatchRunRpeRequestSchema.safeParse({ request_id: "r-1", rpe: 7 }).success,
    ).toBe(true);
    expect(
      WatchRunRpeRequestSchema.safeParse({ request_id: "r-1", rpe: 0 }).success,
    ).toBe(false);
  });
});
