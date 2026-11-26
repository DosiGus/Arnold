/**
 * Invented daily watch values for the synthetic demo runtime (fixture mode
 * only), so the Health Data card has something to show without a Garmin
 * account. Deterministic per calendar day; some values are left unknown on
 * purpose, as a real watch leaves gaps. Never used with a database.
 */
import type { HealthDayInput } from "../../analytics/health-summary.js";
import { addDays } from "../../analytics/period.js";
import type { HealthDaysInput } from "../arnold-source.js";

function day(local_date: string): HealthDayInput {
  const k = Math.floor(Date.parse(`${local_date}T00:00:00Z`) / 86_400_000);
  const gap = k % 9 === 0; // a night without sleep data
  const deep = 70 + (k % 25);
  const rem = 85 + ((k * 7) % 30);
  const awake = 20 + ((k * 3) % 25);
  const light = 220 + ((k * 11) % 50);
  return {
    local_date,
    resting_hr_bpm: 50 + (k % 5),
    hrv_last_night_ms: 40 + ((k * 7) % 15),
    hrv_status: "balanced",
    body_battery_high: 60 + ((k * 11) % 35),
    spo2_avg_pct: 95 + (k % 3),
    sleep_seconds: gap ? null : (deep + rem + light) * 60,
    sleep_score: gap ? null : 65 + ((k * 13) % 30),
    sleep_deep_seconds: gap ? null : deep * 60,
    sleep_light_seconds: gap ? null : light * 60,
    sleep_rem_seconds: gap ? null : rem * 60,
    sleep_awake_seconds: gap ? null : awake * 60,
    steps: 6000 + ((k * 937) % 6000),
    intensity_minutes_moderate: 10 + (k % 25),
    intensity_minutes_vigorous: k % 15,
    kcal_total: 2100 + ((k * 53) % 600),
    vo2max_running: k % 3 === 0 ? 48 : null,
    fitness_age: 29,
    chronological_age: 31,
    training_readiness_score: 55 + ((k * 17) % 40),
    training_readiness_level: "moderate",
    training_status: "productive",
  };
}

export async function demoHealthDays(
  from: string,
  to: string,
): Promise<HealthDaysInput> {
  const days: HealthDayInput[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) days.push(day(d));
  return { status: "consented", days };
}
