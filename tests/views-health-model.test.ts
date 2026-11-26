/**
 * The Health Data screen's model (src/views/model/health.ts): Arnold's
 * summary labelled and translated; unknown values stay null or "–", sleep
 * phases only where known, the day label honest about older values.
 */
import { describe, expect, it } from "vitest";
import { healthSummary } from "../src/analytics/health-summary";
import { healthDayLabel, healthModel } from "../src/views/model/health";

const base = {
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
};

describe("healthModel", () => {
  it("labels, translates and keeps unknown values unknown", () => {
    const s = healthSummary(
      [
        {
          ...base,
          local_date: "2026-11-26",
          resting_hr_bpm: 52,
          hrv_last_night_ms: 48,
          hrv_status: "balanced",
          sleep_seconds: 27000,
          sleep_score: 82,
          sleep_deep_seconds: 5160,
          sleep_rem_seconds: null,
          vo2max_running: 51,
          fitness_age: 29,
          chronological_age: 31,
          training_readiness_score: 78,
          training_readiness_level: "high",
          training_status: "productive",
        },
      ],
      "2026-11-26",
    );
    const m = healthModel(s);
    expect(m.today[0]).toMatchObject({
      label: "Ruhepuls",
      value: 52,
      avg7: 52,
    });
    expect(m.today[1]).toMatchObject({ value: 48, note: "ausgeglichen" });
    expect(m.today[3]).toMatchObject({ label: "Blutsauerstoff", value: null });
    expect(m.sleep).toMatchObject({ hours: 7.5, score: 82, avg7: 82 });
    expect(m.sleep.note).toBeUndefined();
    expect(m.sleep.phases).toEqual([{ label: "Tief", minutes: 86 }]);
    expect(m.sleep.week.map((w) => w.day)).toEqual([
      "Fr",
      "Sa",
      "So",
      "Mo",
      "Di",
      "Mi",
      "Do",
    ]);
    expect(m.fitness).toEqual([
      { label: "VO2max", value: "51 ml/kg/min" },
      { label: "Fitnessalter", value: "29 Jahre (du bist 31)" },
      { label: "Trainingsbereitschaft", value: "78 von 100", note: "hoch" },
      { label: "Trainingszustand", value: "Produktiv" },
    ]);
    expect(m.activity.map((a) => a.value)).toEqual([null, null, null]);
    expect(healthDayLabel(s)).toBe("heute");
  });

  it("says from which day older values are", () => {
    const s = healthSummary(
      [{ ...base, local_date: "2026-11-24", resting_hr_bpm: 50 }],
      "2026-11-26",
    );
    expect(healthDayLabel(s)).toBe("Stand 24. Nov.");
    expect(healthModel(s).sleep.hours).toBeNull();
    expect(healthModel(s).fitness[0]!.value).toBe("–");
  });
});
