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

/** One local calendar day. Every value is null when the supplier gave none. */
export interface DailyHealthDay {
  /** The user's local calendar day, YYYY-MM-DD, as the supplier reports it. */
  local_date: string;
  resting_hr_bpm: number | null;
  stress_avg: number | null;
  body_battery_high: number | null;
  body_battery_end_of_day: number | null;
  sleep_seconds: number | null;
  sleep_score: number | null;
  hrv_last_night_ms: number | null;
  hrv_status: HrvStatus | null;
}

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
  | { ok: true; days: DailyHealthDay[] }
  | { ok: false; failure: DailyHealthFailure };

/** A supplier the server asks (pull). */
export interface DailyHealthPullSource {
  readonly kind: DailyHealthSourceKind;
  /** Days from `from` to `to`, both inclusive, YYYY-MM-DD. Never throws. */
  fetchDays(from: string, to: string): Promise<DailyHealthFetchResult>;
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
