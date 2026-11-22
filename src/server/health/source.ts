/**
 * Daily health values from a supplier (UX-015).
 *
 * The rest of Arnold only knows this interface: one value set per local
 * calendar day, unknown as null (never 0), and a small set of named
 * failures. Which supplier delivers them is a configuration matter:
 *
 *   - "garmin_personal" (built): the server pulls the days of exactly one
 *     configured account with that person's Garmin Personal API key.
 *   - "garmin_starter" (prepared only): Garmin's Business Starter access
 *     pushes days for many users; see DailyHealthPushSource.
 *
 * Field names and limits of Garmin that the public documentation does not
 * settle stay inside the supplier (garmin-personal.ts) and are read
 * tolerantly there.
 */

export type DailyHealthSourceKind = "garmin_personal" | "garmin_starter";

export type HrvStatus = "balanced" | "unbalanced" | "low" | "poor";

/**
 * Every value column of one day, with its kind. The single list the supplier
 * (empty day, "has any value"), the store (insert, merge) and the reader
 * (cast of numeric columns) all use, so a column is added in one place.
 * "int" and "num" are numbers, "text" a string. The columns after
 * hrv_status are the extended values (migration 008); Garmin's field names
 * for them are "ungeprüft bis zum ersten echten Abruf" (garmin-personal.ts).
 */
export const DAILY_HEALTH_COLUMNS = {
  resting_hr_bpm: "int",
  stress_avg: "int",
  body_battery_high: "int",
  body_battery_end_of_day: "int",
  sleep_seconds: "int",
  sleep_score: "int",
  hrv_last_night_ms: "int",
  hrv_status: "text",
  // Sleep stages and times (times: local wall clock, YYYY-MM-DDTHH:MM:SS).
  sleep_deep_seconds: "int",
  sleep_light_seconds: "int",
  sleep_rem_seconds: "int",
  sleep_awake_seconds: "int",
  sleep_awake_count: "int",
  sleep_restless_moments: "int",
  sleep_start_local: "text",
  sleep_end_local: "text",
  // Respiration, breaths per minute.
  respiration_sleep_avg: "num",
  respiration_sleep_low: "num",
  respiration_sleep_high: "num",
  respiration_day_avg: "num",
  respiration_day_low: "num",
  respiration_day_high: "num",
  // Blood oxygen of the day, percent.
  spo2_avg_pct: "int",
  spo2_min_pct: "int",
  // Activity.
  steps: "int",
  step_goal: "int",
  intensity_minutes_moderate: "int",
  intensity_minutes_vigorous: "int",
  floors_climbed: "int",
  kcal_active: "int",
  kcal_total: "int",
  distance_m: "int",
  // Skin temperature deviation from the personal norm, °C.
  skin_temp_deviation_c: "num",
  // Fitness.
  vo2max_running: "num",
  vo2max_cycling: "num",
  fitness_age: "int",
  chronological_age: "int",
  // Training.
  training_readiness_score: "int",
  training_readiness_level: "text",
  training_status: "text",
  acute_load: "num",
  chronic_load: "num",
  load_ratio: "num",
} as const;

export type DailyHealthColumn = keyof typeof DAILY_HEALTH_COLUMNS;

type ColumnValue<K extends DailyHealthColumn> = K extends "hrv_status"
  ? HrvStatus | null
  : (typeof DAILY_HEALTH_COLUMNS)[K] extends "text"
    ? string | null
    : number | null;

/** One local calendar day. Every value is null when the supplier gave none. */
export type DailyHealthDay = {
  /** The user's local calendar day, YYYY-MM-DD, as the supplier reports it. */
  local_date: string;
} & { [K in DailyHealthColumn]: ColumnValue<K> };

/** Garmin's answer of one endpoint for one day, cleaned, as it is stored raw. */
export interface DailyHealthRaw {
  local_date: string;
  /** Arnold's name of the endpoint (for example daily_sleep), not the URL. */
  endpoint: string;
  payload: unknown;
}

/**
 * How an optional endpoint ended: `ok` (answer with content), `empty`
 * (nothing for that day, 204 or no entries), `unavailable` (not offered to
 * this key: 401, 403, 404), `error` (server error, broken or unexpected
 * answer, network failure). Never carries response text.
 */
export type EndpointOutcome = "ok" | "empty" | "unavailable" | "error";

/**
 * Why a fetch failed. `key_expired` is its own state so the overview can
 * later say "Garmin-Schlüssel abgelaufen": the key was refused when a token
 * was requested, which Garmin does for expired and for deleted keys alike;
 * either way the owner has to create a new key.
 */
export type DailyHealthFailure =
  | "key_expired"
  | "key_invalid"
  | "rate_limited"
  | "upstream_error"
  | "network_error";

export type DailyHealthFetchResult =
  | {
      ok: true;
      days: DailyHealthDay[];
      /** The cleaned Garmin answers, one per day and endpoint. */
      raw?: DailyHealthRaw[];
      /** How each optional endpoint ended (name → outcome). */
      endpoints?: Record<string, EndpointOutcome>;
      /**
       * Garmin limited the rate in the middle of the optional requests: what
       * was fetched until then is complete and valid, the rest follows with
       * a later fetch.
       */
      rateLimited?: boolean;
    }
  | { ok: false; failure: DailyHealthFailure };

export interface FetchDaysOptions {
  /**
   * Days (YYYY-MM-DD, inside from..to) for which the single-day endpoints
   * are asked, newest first. Chosen by the caller so the number of requests
   * stays small; without it no single-day endpoint is asked.
   */
  detailDates?: string[];
}

/** A supplier the server asks (pull). */
export interface DailyHealthPullSource {
  readonly kind: DailyHealthSourceKind;
  /** Days from `from` to `to`, both inclusive, YYYY-MM-DD. Never throws. */
  fetchDays(
    from: string,
    to: string,
    options?: FetchDaysOptions,
  ): Promise<DailyHealthFetchResult>;
}

/**
 * Prepared, not built: a supplier that sends days on its own (Garmin
 * Business Starter, push only). An implementation verifies the delivery,
 * maps the supplier's user to an Arnold user through a stored, consented
 * link (never through request data alone) and hands the days to the same
 * store as the pull supplier.
 */
export interface DailyHealthPushSource {
  readonly kind: "garmin_starter";
  /** Checks and reads one delivery; null when it is not a valid delivery. */
  parseDelivery(
    body: unknown,
    headers: Record<string, string | undefined>,
  ): { supplierUserId: string; days: DailyHealthDay[] } | null;
}
