import { describe, expect, it } from "vitest";
import {
  predictRaceTime,
  RACE_DISTANCES_M,
  referenceTempoZones,
  referenceValidUntil,
  referenceVdot,
  tempoZones,
  vdotOf,
  VDOT_MAX,
  VDOT_MIN,
  formatPace,
  paceMid,
  type RunReference,
} from "../src/analytics/running/vdot.js";

/**
 * Published reference values: the VDOT table of Daniels' Running Formula as
 * reproduced in the pace table of shuichi-running.com ("VDOT Running Pace
 * Table", per mile; race times and the E/T/I/R velocity fractions 0.59–0.74,
 * 0.88, 0.95–1.00, 1.05–1.20). Paces per mile are converted to seconds per km.
 */
const hms = (text: string) =>
  text.split(":").reduce((total, part) => total * 60 + Number(part), 0);
const perMile = (text: string) => hms(text) / 1.609344;

interface Row {
  vdot: number;
  marathon: string;
  half: string;
  tenK: string;
  fiveK: string;
  eSlow: string;
  eFast: string;
  t: string;
  iSlow: string;
  iFast: string;
  rSlow: string;
  rFast: string;
}
const TABLE: Row[] = [
  {
    vdot: 30,
    marathon: "4:49:49",
    half: "2:21:17",
    tenK: "1:03:49",
    fiveK: "30:40",
    eSlow: "14:02",
    eFast: "11:48",
    t: "10:18",
    iSlow: "9:43",
    iFast: "9:18",
    rSlow: "8:58",
    rFast: "8:03",
  },
  {
    vdot: 40,
    marathon: "3:49:37",
    half: "1:50:54",
    tenK: "50:00",
    fiveK: "24:06",
    eSlow: "11:14",
    eFast: "9:25",
    t: "8:12",
    iSlow: "7:42",
    iFast: "7:24",
    rSlow: "7:06",
    rFast: "6:23",
  },
  {
    vdot: 50,
    marathon: "3:10:40",
    half: "1:31:31",
    tenK: "41:19",
    fiveK: "19:56",
    eSlow: "9:26",
    eFast: "7:53",
    t: "6:50",
    iSlow: "6:26",
    iFast: "6:10",
    rSlow: "5:56",
    rFast: "5:19",
  },
  {
    vdot: 60,
    marathon: "2:43:22",
    half: "1:18:08",
    tenK: "35:21",
    fiveK: "17:02",
    eSlow: "8:09",
    eFast: "6:47",
    t: "5:54",
    iSlow: "5:33",
    iFast: "5:19",
    rSlow: "5:07",
    rFast: "4:35",
  },
  {
    vdot: 70,
    marathon: "2:23:13",
    half: "1:08:22",
    tenK: "31:00",
    fiveK: "14:55",
    eSlow: "7:13",
    eFast: "6:00",
    t: "5:12",
    iSlow: "4:55",
    iFast: "4:42",
    rSlow: "4:30",
    rFast: "4:03",
  },
  {
    vdot: 80,
    marathon: "2:07:43",
    half: "1:00:56",
    tenK: "27:42",
    fiveK: "13:18",
    eSlow: "6:28",
    eFast: "5:23",
    t: "4:40",
    iSlow: "4:24",
    iFast: "4:13",
    rSlow: "4:03",
    rFast: "3:39",
  },
];

describe("VDOT (Daniels/Gilbert) against the published table", () => {
  for (const row of TABLE) {
    it(`race times of VDOT ${row.vdot}`, () => {
      // within 0.4 % of the published time
      for (const [distance, expected] of [
        [RACE_DISTANCES_M.marathon, row.marathon],
        [RACE_DISTANCES_M.half_marathon, row.half],
        [RACE_DISTANCES_M["10k"], row.tenK],
        [RACE_DISTANCES_M["5k"], row.fiveK],
      ] as const) {
        const predicted = predictRaceTime(row.vdot, distance);
        expect(
          Math.abs(predicted - hms(expected)) / hms(expected),
        ).toBeLessThan(0.004);
      }
    });

    it(`VDOT of the published race times of VDOT ${row.vdot}`, () => {
      expect(vdotOf(RACE_DISTANCES_M["5k"], hms(row.fiveK))).toBeCloseTo(
        row.vdot,
        0,
      );
      expect(vdotOf(RACE_DISTANCES_M.marathon, hms(row.marathon))).toBeCloseTo(
        row.vdot,
        0,
      );
    });

    it(`pace zones of VDOT ${row.vdot}`, () => {
      const zones = tempoZones(row.vdot)!;
      const within = (actual: number, perMileText: string) =>
        expect(Math.abs(actual - perMile(perMileText))).toBeLessThanOrEqual(2);
      within(zones.e.slow_s_per_km, row.eSlow);
      within(zones.e.fast_s_per_km, row.eFast);
      within(paceMid(zones.t), row.t);
      within(zones.i.slow_s_per_km, row.iSlow);
      within(zones.i.fast_s_per_km, row.iFast);
      within(zones.r.slow_s_per_km, row.rSlow);
      within(zones.r.fast_s_per_km, row.rFast);
      // marathon pace = marathon time of the table / 42.195 km
      expect(
        Math.abs(paceMid(zones.m) - hms(row.marathon) / 42.195),
      ).toBeLessThanOrEqual(2);
    });
  }

  it("matches the printed Daniels values for VDOT 50 (5 km 19:57, marathon 3:10:49)", () => {
    expect(vdotOf(5000, hms("19:57"))).toBeCloseTo(50, 1);
    expect(vdotOf(42_195, hms("3:10:49"))).toBeCloseTo(50, 1);
  });

  it("orders the zones from slow to fast and every band from fast to slow", () => {
    for (let vdot = VDOT_MIN; vdot <= VDOT_MAX; vdot += 1) {
      const z = tempoZones(vdot)!;
      for (const band of [z.e, z.m, z.t, z.i, z.r])
        expect(band.fast_s_per_km).toBeLessThan(band.slow_s_per_km);
      expect(paceMid(z.e)).toBeGreaterThan(paceMid(z.m));
      expect(paceMid(z.m)).toBeGreaterThan(paceMid(z.t));
      expect(paceMid(z.t)).toBeGreaterThan(paceMid(z.i));
      expect(paceMid(z.i)).toBeGreaterThan(paceMid(z.r));
      // schema bounds of a pace target
      for (const band of [z.e, z.m, z.t, z.i, z.r]) {
        expect(band.fast_s_per_km).toBeGreaterThanOrEqual(120);
        expect(band.slow_s_per_km).toBeLessThanOrEqual(1200);
      }
    }
  });

  it("has no zones outside the table range", () => {
    expect(tempoZones(VDOT_MIN - 0.01)).toBeNull();
    expect(tempoZones(VDOT_MAX + 0.01)).toBeNull();
    expect(tempoZones(Number.NaN)).toBeNull();
  });

  it("formats paces", () => {
    expect(formatPace(275)).toBe("4:35");
    expect(formatPace(305)).toBe("5:05");
  });
});

describe("reference performance", () => {
  const today = "2026-11-13";
  const ok: RunReference = {
    distance_m: 5000,
    time_s: hms("25:00"),
    date: "2026-10-20",
    source: "race",
  };

  it("derives the VDOT (5 km in 25:00 is about 38.3)", () => {
    const result = referenceVdot(ok, today);
    expect(result.reason).toBeNull();
    expect(result.value).toBeCloseTo(38.3, 1);
    expect(referenceTempoZones(ok, today).value?.vdot).toBeCloseTo(38.3, 1);
  });

  const cases: [string, RunReference | null | undefined, string][] = [
    ["missing", null, "reference_missing"],
    [
      "all fields empty",
      { distance_m: null, time_s: null, date: null, source: null },
      "reference_missing",
    ],
    ["no source", { ...ok, source: null }, "reference_source_invalid"],
    [
      "too short",
      { ...ok, distance_m: 2999 },
      "reference_distance_out_of_range",
    ],
    [
      "too long",
      { ...ok, distance_m: 21_501 },
      "reference_distance_out_of_range",
    ],
    [
      "no distance",
      { ...ok, distance_m: null },
      "reference_distance_out_of_range",
    ],
    ["zero time", { ...ok, time_s: 0 }, "reference_time_invalid"],
    ["no time", { ...ok, time_s: null }, "reference_time_invalid"],
    ["bad date", { ...ok, date: "2026-13-40" }, "reference_date_invalid"],
    ["no date", { ...ok, date: null }, "reference_date_invalid"],
    ["future", { ...ok, date: "2026-11-14" }, "reference_in_future"],
    ["13 weeks old", { ...ok, date: "2026-08-12" }, "reference_too_old"],
    ["below table", { ...ok, time_s: hms("40:00") }, "vdot_below_table"],
    ["above table", { ...ok, time_s: hms("11:00") }, "vdot_above_table"],
  ];
  for (const [name, reference, reason] of cases)
    it(`gives no pace for: ${name}`, () => {
      const result = referenceVdot(reference, today);
      expect(result).toEqual({ value: null, reason });
      expect(referenceTempoZones(reference, today)).toEqual({
        value: null,
        reason,
      });
    });

  it("accepts a reference of exactly 84 days and rejects 85", () => {
    expect(
      referenceVdot({ ...ok, date: "2026-08-21" }, today).value,
    ).not.toBeNull();
    expect(referenceVdot({ ...ok, date: "2026-08-20" }, today).reason).toBe(
      "reference_too_old",
    );
    expect(referenceValidUntil("2026-08-21")).toBe("2026-11-13");
  });

  it("accepts the half marathon distance and a test source", () => {
    expect(
      referenceVdot(
        {
          distance_m: 21_097,
          time_s: hms("1:55:00"),
          date: today,
          source: "test",
        },
        today,
      ).value,
    ).toBeCloseTo(vdotOf(21_097, hms("1:55:00")), 6);
  });
});
