import { describe, expect, it } from "vitest";
import {
  heartRateMetrics,
  pauseMetrics,
  healthSnapshotDifferences,
  recordingMetrics,
} from "../src/analytics/recording.js";
const at = "2026-11-09T10:00:00Z";
describe("watch recording metrics (GAR-B2-01)", () => {
  it("excludes gaps from averages, maxima and zone time, with exact cutoffs", () => {
    const hr = {
      interval_s: 5,
      start_utc: at,
      values: [0, 80, 100, 140, 0, 180],
    };
    expect(heartRateMetrics(hr, [100, 140, 180])).toEqual({
      average_bpm: 125,
      max_bpm: 180,
      measured_seconds: 20,
      missing_seconds: 10,
      zones: [
        { lower_bpm: 0, upper_bpm: 100, seconds: 5 },
        { lower_bpm: 100, upper_bpm: 140, seconds: 5 },
        { lower_bpm: 140, upper_bpm: 180, seconds: 5 },
        { lower_bpm: 180, upper_bpm: null, seconds: 5 },
      ],
    });
    expect(hr.values).toEqual([0, 80, 100, 140, 0, 180]);
  });
  it("keeps unavailable measurements unknown and never infers personal zones", () => {
    expect(heartRateMetrics(null)).toBeNull();
    expect(
      heartRateMetrics({ interval_s: 5, start_utc: at, values: [0, 0] }),
    ).toMatchObject({
      average_bpm: null,
      max_bpm: null,
      measured_seconds: 0,
      missing_seconds: 10,
      zones: null,
    });
    expect(
      heartRateMetrics({ interval_s: 5, start_utc: at, values: [] }),
    ).toMatchObject({ average_bpm: null, max_bpm: null });
    expect(() =>
      heartRateMetrics(
        { interval_s: 5, start_utc: at, values: [90] },
        [140, 100],
      ),
    ).toThrow();
  });
  it("compares actual to planned rests without counting incomplete pairs as zero", () => {
    expect(
      pauseMetrics([
        { planned_s: 120, actual_s: 90 },
        { planned_s: 60, actual_s: 90 },
        { planned_s: 120, actual_s: null },
      ]),
    ).toMatchObject({
      measured_pauses: 2,
      planned_s: 180,
      actual_s: 180,
      delta_s: 0,
      ratio_pct: 100,
      pauses: [
        { delta_s: -30, ratio_pct: 75 },
        { delta_s: 30, ratio_pct: 150 },
        { delta_s: null, ratio_pct: null },
      ],
    });
    expect(pauseMetrics([])).toMatchObject({
      planned_s: null,
      actual_s: null,
      ratio_pct: null,
    });
    expect(pauseMetrics([{ planned_s: 0, actual_s: 0 }]).ratio_pct).toBeNull();
  });
  it("computes after minus before, preserves snapshot zero and missing fields", () => {
    expect(
      healthSnapshotDifferences(
        { at_utc: at, body_battery: 0, stress: 31 },
        { at_utc: at, body_battery: 5, stress: 45, resting_hr: 52 },
      ),
    ).toEqual({ body_battery: 5, stress: 14, resting_hr: null });
    expect(recordingMetrics({}).differences).toEqual({
      body_battery: null,
      stress: null,
      resting_hr: null,
    });
  });
});
