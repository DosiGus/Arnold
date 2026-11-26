/**
 * The Health Data card's figures (src/analytics/health-summary.ts): newest
 * day, seven-day averages on known values only, the sleep week with gaps,
 * Garmin's intensity minutes; unknown stays null.
 */
import { describe, expect, it } from "vitest";
import {
  healthSummary,
  type HealthDayInput,
} from "../src/analytics/health-summary";

const empty = (local_date: string): HealthDayInput => ({
  local_date,
  resting_hr_bpm: null,
  hrv_last_night_ms: null,
  hrv_status: null,
  body_battery_high: null,
  spo2_avg_pct: null,
  sleep_seconds: null,
  sleep_score: null,
  sleep_deep_seconds: null,
  sleep_light_seconds: null,
  sleep_rem_seconds: null,
  sleep_awake_seconds: null,
  steps: null,
  intensity_minutes_moderate: null,
  intensity_minutes_vigorous: null,
  kcal_total: null,
  vo2max_running: null,
  fitness_age: null,
  chronological_age: null,
  training_readiness_score: null,
  training_readiness_level: null,
  training_status: null,
});
const day = (date: string, v: Partial<HealthDayInput>) => ({
  ...empty(date),
  ...v,
});

describe("healthSummary", () => {
  it("averages known values only and takes the newest day", () => {
    const s = healthSummary(
      [
        day("2026-11-20", { resting_hr_bpm: 50, sleep_score: 70 }),
        day("2026-11-22", { resting_hr_bpm: null, sleep_score: 80 }),
        day("2026-11-25", { resting_hr_bpm: 55, steps: 9000 }),
        day("2026-11-26", {}), // nothing measured yet today
        day("2026-11-27", { resting_hr_bpm: 99 }), // after the reference day
        day("2026-11-10", { resting_hr_bpm: 30 }), // before the window
      ],
      "2026-11-26",
    );
    expect(s.latest_date).toBe("2026-11-25");
    expect(s.latest.resting_hr_bpm).toBe(55);
    expect(s.latest.sleep_score).toBeNull();
    expect(s.avg7.resting_hr_bpm).toBe(52.5);
    expect(s.avg7.sleep_score).toBe(75);
    expect(s.avg7.spo2_avg_pct).toBeNull();
    expect(s.sleep_week.map((w) => [w.local_date, w.score])).toEqual([
      ["2026-11-20", 70],
      ["2026-11-21", null],
      ["2026-11-22", 80],
      ["2026-11-23", null],
      ["2026-11-24", null],
      ["2026-11-25", null],
      ["2026-11-26", null],
    ]);
  });

  it("counts vigorous intensity minutes double, unknown when one part is", () => {
    const s = healthSummary(
      [
        day("2026-11-25", {
          intensity_minutes_moderate: 20,
          intensity_minutes_vigorous: 10,
        }),
        day("2026-11-26", {
          intensity_minutes_moderate: 30,
          intensity_minutes_vigorous: null,
          steps: 100,
        }),
      ],
      "2026-11-26",
    );
    expect(s.latest.intensity_minutes).toBeNull();
    expect(s.avg7.intensity_minutes).toBe(40);
  });

  it("takes fitness values from the newest day that has them", () => {
    const s = healthSummary(
      [
        day("2026-11-21", {
          vo2max_running: 47,
          training_status: "productive",
        }),
        day("2026-11-24", { vo2max_running: 48 }),
        day("2026-11-26", { steps: 10 }),
      ],
      "2026-11-26",
    );
    expect(s.fitness.vo2max_running).toBe(48);
    expect(s.fitness.training_status).toBe("productive");
    expect(s.fitness.fitness_age).toBeNull();
  });

  it("has no values without days", () => {
    const s = healthSummary([], "2026-11-26");
    expect(s.latest_date).toBeNull();
    expect(Object.values(s.avg7).every((v) => v === null)).toBe(true);
    expect(s.sleep_week).toHaveLength(7);
  });

  it("refuses a reference day that is not a date", () => {
    expect(() => healthSummary([], "26.11.2026")).toThrow(RangeError);
  });
});
