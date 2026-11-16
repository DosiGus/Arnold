/**
 * Supplier "persönlicher Schlüssel": Garmin Connect Personal API (UX-015).
 *
 * Documented by Garmin (developer.garmin.com/gc-developer-program/personal,
 * Swagger 1.0.0, and Garmin's own sample github.com/garmin/connect-personal-api-python):
 *   - token: POST {base}/personalapitoken-service/personal-api/personal-api-key/token
 *     with `Authorization: ApiKey <key>`; the answer is the token (a JWT)
 *     as text, valid 24 h, no refresh token.
 *   - data: `Authorization: Bearer <token>`.
 *   - GET /usersummary-service/v2/dailysummaries?startDate&endDate (≤ 1 year)
 *   - GET /sleep-service/sleep/dailySleepSummariesByDate?startDate&endDate (≤ 31 days)
 *   - GET /hrv-service/hrv/daily/{from}/{to} (204 = no data)
 *
 * Not settled by the documentation and therefore read tolerantly here
 * ("ungeprüft bis zum ersten echten Abruf"): the key of the overall sleep
 * score inside `sleepScores`, the status codes for an expired key and for
 * rate limiting, the longest HRV range, a JSON-wrapped token answer.
 *
 * The key lives in a private field and only in the token request header.
 * The token lives only in memory. Neither ever reaches an error, a result
 * or a log line: failures are named codes, never response text.
 */
import type {
  DailyHealthDay,
  DailyHealthFailure,
  DailyHealthFetchResult,
  DailyHealthPullSource,
  HrvStatus,
} from "./source.js";

export const GARMIN_PERSONAL_BASE_URL =
  "https://personal.connectapi.garmin.com";
const TOKEN_PATH =
  "/personalapitoken-service/personal-api/personal-api-key/token";
const SLEEP_MAX_DAYS = 31;
// The HRV range limit is not documented; 28 days stays below every other one.
const HRV_MAX_DAYS = 28;
const DAY_MS = 86_400_000;
const TIMEOUT_MS = 15_000;
// Garmin's sample renews a token an hour before it runs out.
const TOKEN_MARGIN_MS = 60 * 60 * 1000;
const TOKEN_FALLBACK_MS = 23 * 60 * 60 * 1000;

type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export interface GarminPersonalOptions {
  apiKey: string;
  fetch?: FetchLike;
  now?: () => number;
  baseUrl?: string;
}

class SupplierFailure {
  constructor(readonly failure: DailyHealthFailure) {}
}

export class GarminPersonalSource implements DailyHealthPullSource {
  readonly kind = "garmin_personal" as const;
  readonly #apiKey: string;
  #token?: { value: string; renewAt: number };
  readonly #fetch: FetchLike;
  readonly #now: () => number;
  readonly #baseUrl: string;

  constructor(options: GarminPersonalOptions) {
    this.#apiKey = options.apiKey;
    this.#fetch = options.fetch ?? ((url, init) => fetch(url, init));
    this.#now = options.now ?? Date.now;
    this.#baseUrl = (options.baseUrl ?? GARMIN_PERSONAL_BASE_URL).replace(
      /\/+$/,
      "",
    );
  }

  /** Nothing about the key or the token, also not by accident. */
  toJSON() {
    return { kind: this.kind };
  }

  async fetchDays(from: string, to: string): Promise<DailyHealthFetchResult> {
    try {
      const days = new Map<string, DailyHealthDay>();
      const day = (date: string) => {
        let entry = days.get(date);
        if (!entry) {
          entry = emptyDay(date);
          days.set(date, entry);
        }
        return entry;
      };
      const summaries = await this.#get(
        "/usersummary-service/v2/dailysummaries",
        {
          startDate: from,
          endDate: to,
        },
      );
      for (const s of readDailySummaries(summaries))
        Object.assign(day(s.local_date), s.values);
      for (const [a, b] of chunks(from, to, SLEEP_MAX_DAYS)) {
        const sleep = await this.#get(
          "/sleep-service/sleep/dailySleepSummariesByDate",
          { startDate: a, endDate: b },
        );
        for (const s of readSleep(sleep))
          Object.assign(day(s.local_date), s.values);
      }
      for (const [a, b] of chunks(from, to, HRV_MAX_DAYS)) {
        const hrv = await this.#get(`/hrv-service/hrv/daily/${a}/${b}`, {});
        for (const s of readHrv(hrv))
          Object.assign(day(s.local_date), s.values);
      }
      return {
        ok: true,
        days: [...days.values()]
          .filter((d) => d.local_date >= from && d.local_date <= to)
          .filter(hasAnyValue)
          .sort((a, b) => a.local_date.localeCompare(b.local_date)),
      };
    } catch (error) {
      if (error instanceof SupplierFailure)
        return { ok: false, failure: error.failure };
      // Never pass an unknown error's text on: it could quote a header.
      return { ok: false, failure: "network_error" };
    }
  }

  async #accessToken(): Promise<string> {
    if (this.#token && this.#now() < this.#token.renewAt)
      return this.#token.value;
    this.#token = undefined;
    const response = await this.#send(`${this.#baseUrl}${TOKEN_PATH}`, {
      method: "POST",
      headers: { Accept: "*/*", Authorization: `ApiKey ${this.#apiKey}` },
    });
    // A refused key: expired or deleted. The owner needs a new key either way.
    if (response.status === 401 || response.status === 403)
      throw new SupplierFailure("key_expired");
    if (response.status === 429) throw new SupplierFailure("rate_limited");
    if (!response.ok) throw new SupplierFailure("upstream_error");
    const value = readToken(await response.text());
    if (!value) throw new SupplierFailure("upstream_error");
    const expiresAt = jwtExpiry(value) ?? this.#now() + TOKEN_FALLBACK_MS;
    // Renew an hour early; a token with less left (a key about to run
    // out) is used until a minute before its end, not asked for again
    // on every request.
    const early = expiresAt - TOKEN_MARGIN_MS;
    this.#token = {
      value,
      renewAt: early > this.#now() ? early : expiresAt - 60_000,
    };
    return value;
  }

  async #get(path: string, query: Record<string, string>): Promise<unknown> {
    const url = new URL(`${this.#baseUrl}${path}`);
    for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
    for (let attempt = 0; ; attempt++) {
      const token = await this.#accessToken();
      const response = await this.#send(url.toString(), {
        method: "GET",
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${token}`,
        },
      });
      if (response.status === 401 && attempt === 0) {
        // The token may have ended early; one new token, one more try.
        this.#token = undefined;
        continue;
      }
      if (response.status === 401 || response.status === 403)
        throw new SupplierFailure("key_invalid");
      if (response.status === 429) throw new SupplierFailure("rate_limited");
      if (response.status === 204) return null;
      if (!response.ok) throw new SupplierFailure("upstream_error");
      const text = await response.text();
      if (text.trim() === "") return null;
      try {
        return JSON.parse(text) as unknown;
      } catch {
        throw new SupplierFailure("upstream_error");
      }
    }
  }

  async #send(url: string, init: RequestInit): Promise<Response> {
    try {
      return await this.#fetch(url, {
        ...init,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch {
      throw new SupplierFailure("network_error");
    }
  }
}

// ------------------------------------------------------------ reading

type Partial_ = { local_date: string; values: Partial<DailyHealthDay> };

const DATE = /^\d{4}-\d{2}-\d{2}$/;

function emptyDay(local_date: string): DailyHealthDay {
  return {
    local_date,
    resting_hr_bpm: null,
    stress_avg: null,
    body_battery_high: null,
    body_battery_end_of_day: null,
    sleep_seconds: null,
    sleep_score: null,
    hrv_last_night_ms: null,
    hrv_status: null,
  };
}

const VALUE_KEYS = [
  "resting_hr_bpm",
  "stress_avg",
  "body_battery_high",
  "body_battery_end_of_day",
  "sleep_seconds",
  "sleep_score",
  "hrv_last_night_ms",
  "hrv_status",
] as const;

function hasAnyValue(day: DailyHealthDay) {
  return VALUE_KEYS.some((k) => day[k] !== null);
}

const record = (v: unknown): Record<string, unknown> | null =>
  typeof v === "object" && v !== null && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;

/** A whole number in range, else null. Garmin's "no value" is never 0 here. */
function whole(v: unknown, min: number, max: number): number | null {
  if (typeof v !== "number" || !Number.isFinite(v)) return null;
  const n = Math.round(v);
  return n >= min && n <= max ? n : null;
}

function dateOf(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const d = v.slice(0, 10);
  return DATE.test(d) ? d : null;
}

/** /usersummary-service/v2/dailysummaries → { data: [...] }. */
export function readDailySummaries(json: unknown): Partial_[] {
  const list = record(json)?.data;
  if (!Array.isArray(list)) return [];
  const out: Partial_[] = [];
  for (const item of list) {
    const s = record(item);
    const local_date = dateOf(s?.calendarDate);
    if (!s || !local_date) continue;
    const hr = record(s.heartRate);
    const stress = record(s.stress);
    const bb = record(s.bodyBattery);
    out.push({
      local_date,
      values: {
        resting_hr_bpm: whole(hr?.restingValue, 20, 250),
        // Garmin uses negative stress values for "not measured".
        stress_avg: whole(stress?.avgLevel, 0, 100),
        body_battery_high: whole(bb?.maxValue, 0, 100),
        body_battery_end_of_day: whole(bb?.endOfDayValue, 0, 100),
      },
    });
  }
  return out;
}

/** /sleep-service/sleep/dailySleepSummariesByDate → [DailySleepDTO]. */
export function readSleep(json: unknown): Partial_[] {
  const list = Array.isArray(json) ? json : json ? [json] : [];
  const out: Partial_[] = [];
  for (const item of list) {
    const s = record(item);
    const local_date = dateOf(s?.calendarDate);
    if (!s || !local_date) continue;
    out.push({
      local_date,
      values: {
        sleep_seconds: whole(s.sleepTimeSeconds, 1, 86_400),
        sleep_score: overallSleepScore(s.sleepScores),
      },
    });
  }
  return out;
}

/**
 * The overall sleep score. `sleepScores` is a map from a component name to
 * { value }; the name of the overall component is not documented. "overall"
 * is the expected one; an unknown shape is null, never an error.
 */
function overallSleepScore(scores: unknown): number | null {
  const map = record(scores);
  if (!map) return null;
  const key = Object.keys(map).find((k) => k.toLowerCase() === "overall");
  return key ? whole(record(map[key])?.value, 0, 100) : null;
}

const HRV_STATUS: Record<string, HrvStatus> = {
  BALANCED: "balanced",
  UNBALANCED: "unbalanced",
  LOW: "low",
  POOR: "poor",
};

/** /hrv-service/hrv/daily/{from}/{to} → { hrvSummaries: [...] }. */
export function readHrv(json: unknown): Partial_[] {
  const list = record(json)?.hrvSummaries;
  if (!Array.isArray(list)) return [];
  const out: Partial_[] = [];
  for (const item of list) {
    const s = record(item);
    const local_date = dateOf(s?.calendarDate);
    if (!s || !local_date) continue;
    out.push({
      local_date,
      values: {
        hrv_last_night_ms: whole(s.lastNightAvg, 1, 500),
        hrv_status:
          typeof s.status === "string"
            ? (HRV_STATUS[s.status.toUpperCase()] ?? null)
            : null,
      },
    });
  }
  return out;
}

/** The token answer: text per Garmin's sample, tolerated as JSON too. */
function readToken(body: string): string | null {
  const text = body.trim();
  if (text === "") return null;
  if (text.startsWith("{")) {
    try {
      const value = record(JSON.parse(text))?.access_token;
      return typeof value === "string" && value.trim() !== ""
        ? value.trim()
        : null;
    } catch {
      return null;
    }
  }
  return /\s/.test(text) ? null : text;
}

function jwtExpiry(token: string): number | null {
  const part = token.split(".")[1];
  if (!part) return null;
  try {
    const payload = record(
      JSON.parse(Buffer.from(part, "base64url").toString("utf8")),
    );
    return typeof payload?.exp === "number" ? payload.exp * 1000 : null;
  } catch {
    return null;
  }
}

/** Splits an inclusive date range into ranges of at most `size` days. */
export function chunks(from: string, to: string, size: number) {
  const out: [string, string][] = [];
  let start = Date.parse(`${from}T00:00:00Z`);
  const end = Date.parse(`${to}T00:00:00Z`);
  while (start <= end) {
    const stop = Math.min(end, start + (size - 1) * DAY_MS);
    out.push([iso(start), iso(stop)]);
    start = stop + DAY_MS;
  }
  return out;
}

const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
