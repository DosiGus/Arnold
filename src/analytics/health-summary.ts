/**
 * The health screen's figures from the stored daily Garmin values: the
 * newest day, the averages of the last seven days and the sleep scores of the
 * last seven nights. Pure, no I/O, no clock: the reference day comes from the
 * caller (the user's local calendar day).
 *
 * Unknown is null, never 0: an average rests only on the days that have the
 * value, and is null when none has it. Days after the reference day and
 * before the seven-day window are ignored. Local types on purpose: the layer
 * imports nothing from the server.
 */
export const HEALTH_WINDOW_DAYS = 7;

/** One stored local day, as far as the screen needs it. */
export interface HealthDayInput {
  local_date: string;
  resting_hr_bpm: number | null;
  hrv_last_night_ms: number | null;
  hrv_status: string | null;
  body_battery_high: number | null;
  spo2_avg_pct: number | null;
  sleep_seconds: number | null;
  sleep_score: number | null;
  sleep_deep_seconds: number | null;
  sleep_light_seconds: number | null;
  sleep_rem_seconds: number | null;
  sleep_awake_seconds: number | null;
  steps: number | null;
  intensity_minutes_moderate: number | null;
  intensity_minutes_vigorous: number | null;
  kcal_total: number | null;
  vo2max_running: number | null;
  fitness_age: number | null;
  chronological_age: number | null;
  training_readiness_score: number | null;
  training_readiness_level: string | null;
  training_status: string | null;
}

const AVERAGED = [
  "resting_hr_bpm",
  "hrv_last_night_ms",
  "body_battery_high",
  "spo2_avg_pct",
  "sleep_score",
  "steps",
  "intensity_minutes",
  "kcal_total",
] as const;
type Averaged = (typeof AVERAGED)[number];

export interface HealthSummary {
  reference_date: string;
  /** Newest day in the window with any value; null when there is none. */
  latest_date: string | null;
  latest: {
    resting_hr_bpm: number | null;
    hrv_last_night_ms: number | null;
    hrv_status: string | null;
    body_battery_high: number | null;
    spo2_avg_pct: number | null;
    sleep_seconds: number | null;
    sleep_score: number | null;
    sleep_deep_seconds: number | null;
    sleep_light_seconds: number | null;
    sleep_rem_seconds: number | null;
    sleep_awake_seconds: number | null;
    steps: number | null;
    /** Garmin's convention: vigorous minutes count double. */
    intensity_minutes: number | null;
    kcal_total: number | null;
  };
  /** Average over the days of the window that have the value. */
  avg7: Record<Averaged, number | null>;
  /** Sleep score of each of the seven nights, oldest first. */
  sleep_week: { local_date: string; score: number | null }[];
  /** Newest known value in the window; these are not measured daily. */
  fitness: {
    vo2max_running: number | null;
    fitness_age: number | null;
    chronological_age: number | null;
    training_readiness_score: number | null;
    training_readiness_level: string | null;
    training_status: string | null;
  };
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

function shiftDate(date: string, days: number): string {
  const ms = Date.parse(`${date}T00:00:00Z`) + days * 86_400_000;
  return new Date(ms).toISOString().slice(0, 10);
}

const known = (v: number | null | undefined): v is number =>
  typeof v === "number" && Number.isFinite(v);

const oneDecimal = (n: number) => Math.round(n * 10) / 10;

function intensity(d: HealthDayInput): number | null {
  return known(d.intensity_minutes_moderate) &&
    known(d.intensity_minutes_vigorous)
    ? d.intensity_minutes_moderate + 2 * d.intensity_minutes_vigorous
    : null;
}

function valueOf(d: HealthDayInput, key: Averaged): number | null {
  return key === "intensity_minutes" ? intensity(d) : d[key];
}

const LATEST_KEYS = [
  "resting_hr_bpm",
  "hrv_last_night_ms",
  "body_battery_high",
  "spo2_avg_pct",
  "sleep_seconds",
  "sleep_score",
  "sleep_deep_seconds",
  "sleep_light_seconds",
  "sleep_rem_seconds",
  "sleep_awake_seconds",
  "steps",
  "intensity_minutes_moderate",
  "intensity_minutes_vigorous",
  "kcal_total",
] as const;

const hasAny = (d: HealthDayInput) =>
  LATEST_KEYS.some((k) => known(d[k])) || d.hrv_status !== null;

export function healthSummary(
  days: readonly HealthDayInput[],
  referenceDate: string,
): HealthSummary {
  if (!DATE.test(referenceDate))
    throw new RangeError("referenceDate must be YYYY-MM-DD");
  const first = shiftDate(referenceDate, -(HEALTH_WINDOW_DAYS - 1));
  // Oldest first, one entry per day, only the window.
  const byDate = new Map<string, HealthDayInput>();
  for (const d of days)
    if (
      DATE.test(d.local_date) &&
      d.local_date >= first &&
      d.local_date <= referenceDate
    )
      byDate.set(d.local_date, d);
  const window = [...byDate.values()].sort((a, b) =>
    a.local_date.localeCompare(b.local_date),
  );

  const latestDay = [...window].reverse().find(hasAny) ?? null;
  const newest = <T>(pick: (d: HealthDayInput) => T | null): T | null => {
    for (let i = window.length - 1; i >= 0; i--) {
      const v = pick(window[i]!);
      if (v !== null && v !== undefined) return v;
    }
    return null;
  };

  const avg7 = Object.fromEntries(
    AVERAGED.map((key) => {
      const values = window.map((d) => valueOf(d, key)).filter(known);
      return [
        key,
        values.length
          ? oneDecimal(values.reduce((a, b) => a + b, 0) / values.length)
          : null,
      ];
    }),
  ) as Record<Averaged, number | null>;

  const l = latestDay;
  return {
    reference_date: referenceDate,
    latest_date: l?.local_date ?? null,
    latest: {
      resting_hr_bpm: l?.resting_hr_bpm ?? null,
      hrv_last_night_ms: l?.hrv_last_night_ms ?? null,
      hrv_status: l?.hrv_status ?? null,
      body_battery_high: l?.body_battery_high ?? null,
      spo2_avg_pct: l?.spo2_avg_pct ?? null,
      sleep_seconds: l?.sleep_seconds ?? null,
      sleep_score: l?.sleep_score ?? null,
      sleep_deep_seconds: l?.sleep_deep_seconds ?? null,
      sleep_light_seconds: l?.sleep_light_seconds ?? null,
      sleep_rem_seconds: l?.sleep_rem_seconds ?? null,
      sleep_awake_seconds: l?.sleep_awake_seconds ?? null,
      steps: l?.steps ?? null,
      intensity_minutes: l ? intensity(l) : null,
      kcal_total: l?.kcal_total ?? null,
    },
    avg7,
    sleep_week: Array.from({ length: HEALTH_WINDOW_DAYS }, (_, i) => {
      const date = shiftDate(first, i);
      return { local_date: date, score: byDate.get(date)?.sleep_score ?? null };
    }),
    fitness: {
      vo2max_running: newest((d) => d.vo2max_running),
      fitness_age: newest((d) => d.fitness_age),
      chronological_age: newest((d) => d.chronological_age),
      training_readiness_score: newest((d) => d.training_readiness_score),
      training_readiness_level: newest((d) => d.training_readiness_level),
      training_status: newest((d) => d.training_status),
    },
  };
}
