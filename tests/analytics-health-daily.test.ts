import { describe, expect, it } from "vitest";
import {
  dailyHealthRecovery,
  type DailyHealthInput,
} from "../src/analytics/index.js";

/** Invented values only. */
const day = (
  local_date: string,
  values: Partial<DailyHealthInput> = {},
): DailyHealthInput => ({
  local_date,
  resting_hr_bpm: null,
  body_battery_high: null,
  body_battery_end_of_day: null,
  sleep_seconds: null,
  sleep_score: null,
  ...values,
});

describe("dailyHealthRecovery", () => {
  it("is unknown everywhere without days", () => {
    expect(dailyHealthRecovery([], "2026-11-16")).toEqual({
      reference_date: "2026-11-16",
      resting_hr: null,
      resting_hr_median_28d: null,
      body_battery: null,
      sleep: null,
    });
  });

  it("takes the newest known value of each kind, with its own day", () => {
    const result = dailyHealthRecovery(
      [
        day("2026-11-14", { resting_hr_bpm: 50, sleep_seconds: 25_000 }),
        day("2026-11-16", { body_battery_high: 82 }),
        day("2026-11-15", { resting_hr_bpm: 54, sleep_score: 77 }),
      ],
      "2026-11-16",
    );
    expect(result.resting_hr).toEqual({ value: 54, local_date: "2026-11-15" });
    expect(result.body_battery).toEqual({
      high: 82,
      end_of_day: null,
      local_date: "2026-11-16",
    });
    expect(result.sleep).toEqual({
      seconds: null,
      score: 77,
      local_date: "2026-11-15",
    });
  });

  it("forms the median over the 28 days up to the reference day, with the count", () => {
    const days = [
      day("2026-10-19", { resting_hr_bpm: 90 }), // day 29 before: outside
      day("2026-10-20", { resting_hr_bpm: 50 }), // first day of the window
      day("2026-11-01", { resting_hr_bpm: 54 }),
      day("2026-11-02", { resting_hr_bpm: null }),
      day("2026-11-10", { resting_hr_bpm: 52 }),
      day("2026-11-16", { resting_hr_bpm: 56 }),
      day("2026-11-17", { resting_hr_bpm: 99 }), // after the reference day
    ];
    expect(
      dailyHealthRecovery(days, "2026-11-16").resting_hr_median_28d,
    ).toEqual({ value: 53, count: 4 });
    expect(
      dailyHealthRecovery(days.slice(0, 3), "2026-11-16").resting_hr_median_28d,
    ).toEqual({ value: 52, count: 2 });
  });

  it("ignores days after the reference day and never turns unknown into 0", () => {
    const result = dailyHealthRecovery(
      [
        day("2026-11-17", { resting_hr_bpm: 40, body_battery_high: 99 }),
        day("2026-11-16"),
      ],
      "2026-11-16",
    );
    expect(result.resting_hr).toBeNull();
    expect(result.body_battery).toBeNull();
    expect(JSON.stringify(result)).not.toContain(":0");
  });

  it("refuses a malformed reference day", () => {
    expect(() => dailyHealthRecovery([], "16.11.2026")).toThrow(RangeError);
  });
});
