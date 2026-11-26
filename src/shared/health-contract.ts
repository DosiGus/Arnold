/**
 * `get_health_data` (app only): the health screen's figures from the stored
 * daily Garmin values, computed by `src/analytics/health-summary.ts`.
 *
 * Only with the active consent `garmin_health`. Without it, or without a
 * source of watch values, no value leaves the server: `status` says why and
 * `summary` is null. Unknown is null, never 0.
 */
import { z } from "zod";

const isoDate = z.iso.date();
const n = z.number().finite().nullable();
const label = z.string().min(1).max(40).nullable();

export const HealthDataInputSchema = z.object({
  timezone: z
    .string()
    .min(1)
    .max(64)
    .optional()
    .describe("IANA-Zeitzone des Nutzers, z. B. Europe/Berlin."),
});

export const HealthSummarySchema = z.object({
  reference_date: isoDate,
  latest_date: isoDate.nullable(),
  latest: z.object({
    resting_hr_bpm: n,
    hrv_last_night_ms: n,
    hrv_status: label,
    body_battery_high: n,
    spo2_avg_pct: n,
    sleep_seconds: n,
    sleep_score: n,
    sleep_deep_seconds: n,
    sleep_light_seconds: n,
    sleep_rem_seconds: n,
    sleep_awake_seconds: n,
    steps: n,
    intensity_minutes: n,
    kcal_total: n,
  }),
  avg7: z.object({
    resting_hr_bpm: n,
    hrv_last_night_ms: n,
    body_battery_high: n,
    spo2_avg_pct: n,
    sleep_score: n,
    steps: n,
    intensity_minutes: n,
    kcal_total: n,
  }),
  sleep_week: z.array(z.object({ local_date: isoDate, score: n })),
  fitness: z.object({
    vo2max_running: n,
    fitness_age: n,
    chronological_age: n,
    training_readiness_score: n,
    training_readiness_level: label,
    training_status: label,
  }),
});
export type HealthSummaryView = z.infer<typeof HealthSummarySchema>;

export const HealthDataSchema = z.object({
  /**
   * consented: values (possibly none yet); no_consent: the user has not
   * agreed or revoked; not_connected: this server has no watch values.
   */
  status: z.enum(["consented", "no_consent", "not_connected"]),
  summary: HealthSummarySchema.nullable(),
});
export type HealthData = z.infer<typeof HealthDataSchema>;
