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
 * Two kinds of paths:
 *   - REQUIRED (the three above): a failure fails the fetch with a named
 *     code, as before.
 *   - OPTIONAL (extended values, garmin-extended.ts): paths the Personal API
 *     documents only in part or not at all. Whether they exist for this key,
 *     and what their answers look like, is "ungeprüft bis zum ersten echten
 *     Abruf". A failure, a 403/404/204 or an unexpected format never fails
 *     the fetch and never overwrites a known value; it is noted per endpoint
 *     (ok, empty, unavailable, error) without any response text. Only a 429
 *     stops the optional requests (the fetch then reports rateLimited).
 *     Every successful answer is also kept raw (cleaned) for later reading.
 *     The number of optional requests per fetch is capped.
 *
 * The key lives in a private field and only in the token request header.
 * The token lives only in memory. Neither ever reaches an error, a result
 * or a log line: failures are named codes, never response text.
 */
import {
  compact,
  dateOf,
  hasValues,
  rawPayload,
  readFitnessAge,
  readMaxMet,
  readSleepDetail,
  readSpo2,
  readStepsDaily,
  readTrainingReadiness,
  readTrainingStatus,
  record,
  sleepValues,
  splitByDay,
  summaryExtras,
  whole,
  type Dated,
  type Values,
} from "./garmin-extended.js";
import {
  DAILY_HEALTH_COLUMNS,
  type DailyHealthColumn,
  type DailyHealthDay,
  type DailyHealthFailure,
  type DailyHealthFetchResult,
  type DailyHealthPullSource,
  type DailyHealthRaw,
  type EndpointOutcome,
  type FetchDaysOptions,
  type HrvStatus,
} from "./source.js";

export const GARMIN_PERSONAL_BASE_URL =
  "https://personal.connectapi.garmin.com";
const TOKEN_PATH =
  "/personalapitoken-service/personal-api/personal-api-key/token";
const SLEEP_MAX_DAYS = 31;
// The HRV range limit is not documented; 28 days stays below every other one.
const HRV_MAX_DAYS = 28;
// Range limits of the optional range endpoints are not documented either.
const OPTIONAL_RANGE_DAYS = 28;
/** Upper limit of optional requests (not the token) in one fetch. */
export const MAX_OPTIONAL_REQUESTS = 60;
/** An optional endpoint that failed this often in one fetch is left out for the rest of it. */
const ENDPOINT_STRIKES = 2;
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

/** What one request came back with. Never carries response text. */
type Answer =
  | { kind: "json"; json: unknown }
  | { kind: "empty" }
  // 401/403/404: the key may not use this path (or the path does not exist).
  | { kind: "refused"; status: number }
  | { kind: "error" };

interface RangeEndpoint {
  name: string;
  /** Only fills what the required paths left unknown. */
  fill?: boolean;
  path: (from: string, to: string) => string;
  query?: (from: string, to: string) => Record<string, string>;
  read: (json: unknown) => Dated[];
}

interface DayEndpoint {
  name: string;
  /** Only fills what the required paths left unknown. */
  fill?: boolean;
  path: (date: string) => string;
  query?: (date: string) => Record<string, string>;
  read: (json: unknown, date: string) => Dated | null;
}

// Paths: the first three from the list of Garmin's public Personal API
// documentation as far as known; training readiness and training status
// are guesses for this API (ungeprüft bis zum ersten echten Abruf).
const RANGE_ENDPOINTS: RangeEndpoint[] = [
  {
    name: "steps_daily",
    fill: true,
    path: (a, b) => `/usersummary-service/stats/steps/daily/${a}/${b}`,
    read: readStepsDaily,
  },
  {
    name: "max_met_daily",
    path: (a, b) => `/metrics-service/metrics/maxmet/daily/${a}/${b}`,
    read: readMaxMet,
  },
  {
    // Only kept raw: the day's values come from the required summaries.
    name: "body_battery_daily",
    path: () => "/wellness-service/wellness/bodyBattery/reports/daily",
    query: (a, b) => ({ startDate: a, endDate: b }),
    read: () => [],
  },
];

const DAY_ENDPOINTS: DayEndpoint[] = [
  {
    name: "daily_sleep",
    path: () => "/sleep-service/sleep/dailySleep",
    query: (d) => ({ date: d }),
    read: readSleepDetail,
  },
  {
    name: "spo2_acclimation",
    fill: true,
    path: (d) => `/wellness-service/wellness/daily/spo2acclimation/${d}`,
    read: readSpo2,
  },
  {
    name: "fitness_age",
    path: (d) => `/fitnessage-service/fitnessage/v2/${d}`,
    read: readFitnessAge,
  },
  {
    name: "training_readiness",
    path: (d) => `/metrics-service/metrics/trainingreadiness/${d}`,
    read: readTrainingReadiness,
  },
  {
    name: "training_status",
    path: (d) => `/metrics-service/metrics/trainingstatus/aggregated/${d}`,
    read: readTrainingStatus,
  },
];

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

  async fetchDays(
    from: string,
    to: string,
    options: FetchDaysOptions = {},
  ): Promise<DailyHealthFetchResult> {
    try {
      const days = new Map<string, DailyHealthDay>();
      const raw = new Map<string, DailyHealthRaw>();
      const day = (date: string) => {
        let entry = days.get(date);
        if (!entry) {
          entry = emptyDay(date);
          days.set(date, entry);
        }
        return entry;
      };
      const inRange = (date: string) => date >= from && date <= to;
      const keep = (endpoint: string, date: string, payload: unknown) => {
        if (!inRange(date)) return;
        const cleaned = rawPayload(payload);
        if (cleaned !== null)
          raw.set(`${date}|${endpoint}`, {
            local_date: date,
            endpoint,
            payload: cleaned,
          });
      };

      // ---- required
      const summaries = await this.#get(
        "/usersummary-service/v2/dailysummaries",
        {
          startDate: from,
          endDate: to,
        },
      );
      for (const s of readDailySummaries(summaries))
        merge(day(s.local_date), s.values);
      for (const [date, payload] of splitByDay(record(summaries)?.data ?? null))
        keep("daily_summary", date, payload);
      for (const [a, b] of chunks(from, to, SLEEP_MAX_DAYS)) {
        const sleep = await this.#get(
          "/sleep-service/sleep/dailySleepSummariesByDate",
          { startDate: a, endDate: b },
        );
        for (const s of readSleep(sleep)) merge(day(s.local_date), s.values);
        for (const [date, payload] of splitByDay(sleep))
          keep("sleep_summary", date, payload);
      }
      for (const [a, b] of chunks(from, to, HRV_MAX_DAYS)) {
        const hrv = await this.#get(`/hrv-service/hrv/daily/${a}/${b}`, {});
        for (const s of readHrv(hrv)) merge(day(s.local_date), s.values);
        for (const [date, payload] of splitByDay(
          record(hrv)?.hrvSummaries ?? null,
        ))
          keep("hrv", date, payload);
      }

      // ---- optional
      const outcomes = new Map<string, EndpointOutcome[]>();
      const note = (name: string, outcome: EndpointOutcome) =>
        outcomes.set(name, [...(outcomes.get(name) ?? []), outcome]);
      const strikes = new Map<string, number>();
      let requests = 0;
      let rateLimited = false;
      // Unavailable once: not asked again in this fetch. Errors: after a few.
      const skipped = (name: string) =>
        (strikes.get(name) ?? 0) >= ENDPOINT_STRIKES;
      const strike = (name: string, outcome: EndpointOutcome) => {
        if (outcome === "unavailable") strikes.set(name, ENDPOINT_STRIKES);
        else if (outcome === "error")
          strikes.set(name, (strikes.get(name) ?? 0) + 1);
      };
      const ask = async (
        name: string,
        path: string,
        query: Record<string, string>,
      ): Promise<Answer | null> => {
        if (rateLimited || requests >= MAX_OPTIONAL_REQUESTS) return null;
        requests++;
        try {
          return await this.#request(path, query);
        } catch (error) {
          if (
            error instanceof SupplierFailure &&
            error.failure === "rate_limited"
          ) {
            rateLimited = true;
            return null;
          }
          // Network failure, token trouble: this endpoint only (settle notes it).
          return { kind: "error" };
        }
      };
      // The outcome of an answer, and its values kept for the day(s).
      const settle = (
        name: string,
        answer: Answer,
        dated: Dated[],
        payloads: Map<string, unknown>,
        fill: boolean,
      ): void => {
        let outcome: EndpointOutcome;
        if (answer.kind === "refused") outcome = "unavailable";
        else if (answer.kind === "error") outcome = "error";
        else if (answer.kind === "empty") outcome = "empty";
        else if (!isContainer(answer.json)) outcome = "error";
        else if (isEmptyContainer(answer.json)) outcome = "empty";
        else {
          const known = dated.filter((d) => hasValues(d.values));
          for (const d of known) {
            if (inRange(d.local_date)) merge(day(d.local_date), d.values, fill);
          }
          for (const [date, payload] of payloads) keep(name, date, payload);
          // Answer kept; ok only when something in it was understood (or the
          // endpoint is only kept raw), otherwise "unexpected format".
          outcome = known.length > 0 || RAW_ONLY.has(name) ? "ok" : "error";
        }
        note(name, outcome);
        strike(name, outcome);
      };

      for (const endpoint of RANGE_ENDPOINTS) {
        for (const [a, b] of chunks(from, to, OPTIONAL_RANGE_DAYS)) {
          if (skipped(endpoint.name)) break;
          const answer = await ask(
            endpoint.name,
            endpoint.path(a, b),
            endpoint.query?.(a, b) ?? {},
          );
          if (!answer) break;
          const json = answer.kind === "json" ? answer.json : null;
          settle(
            endpoint.name,
            answer,
            json === null ? [] : endpoint.read(json),
            json === null ? new Map() : splitByDay(json),
            endpoint.fill === true,
          );
        }
      }
      const detailDates = [
        ...new Set((options.detailDates ?? []).filter((d) => inRange(d))),
      ]
        .filter((d) => dateOf(d) === d)
        .sort()
        .reverse();
      for (const date of detailDates) {
        for (const endpoint of DAY_ENDPOINTS) {
          if (skipped(endpoint.name)) continue;
          const answer = await ask(
            endpoint.name,
            endpoint.path(date),
            endpoint.query?.(date) ?? {},
          );
          if (!answer) break;
          const json = answer.kind === "json" ? answer.json : null;
          const read = json === null ? null : endpoint.read(json, date);
          settle(
            endpoint.name,
            answer,
            read ? [{ ...read, local_date: date }] : [],
            json === null ? new Map() : new Map([[date, json]]),
            endpoint.fill === true,
          );
        }
        if (rateLimited || requests >= MAX_OPTIONAL_REQUESTS) break;
      }

      const endpoints: Record<string, EndpointOutcome> = {};
      for (const [name, list] of outcomes) endpoints[name] = summarize(list);
      return {
        ok: true,
        days: [...days.values()]
          .filter((d) => inRange(d.local_date))
          .filter(hasAnyValue)
          .sort((a, b) => a.local_date.localeCompare(b.local_date)),
        raw: [...raw.values()],
        endpoints,
        ...(rateLimited ? { rateLimited: true } : {}),
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

  /**
   * One GET. Throws SupplierFailure only for what stops everything (a refused
   * token, 429, network); other outcomes are returned as an Answer.
   */
  async #request(path: string, query: Record<string, string>): Promise<Answer> {
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
      if (
        response.status === 401 ||
        response.status === 403 ||
        response.status === 404
      )
        return { kind: "refused", status: response.status };
      if (response.status === 429) throw new SupplierFailure("rate_limited");
      if (response.status === 204) return { kind: "empty" };
      if (!response.ok) return { kind: "error" };
      const text = await response.text();
      if (text.trim() === "") return { kind: "empty" };
      try {
        return { kind: "json", json: JSON.parse(text) as unknown };
      } catch {
        return { kind: "error" };
      }
    }
  }

  /** A required path: every failure is a named failure of the whole fetch. */
  async #get(path: string, query: Record<string, string>): Promise<unknown> {
    const answer = await this.#request(path, query);
    if (answer.kind === "json") return answer.json;
    if (answer.kind === "empty") return null;
    if (answer.kind === "refused" && answer.status !== 404)
      throw new SupplierFailure("key_invalid");
    throw new SupplierFailure("upstream_error");
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

type Partial_ = Dated;

/** Endpoints whose answer is only kept raw (no value is read from it). */
const RAW_ONLY = new Set(["body_battery_daily"]);

function emptyDay(local_date: string): DailyHealthDay {
  const day: Record<string, unknown> = { local_date };
  for (const key of Object.keys(DAILY_HEALTH_COLUMNS)) day[key] = null;
  return day as DailyHealthDay;
}

const VALUE_KEYS = Object.keys(DAILY_HEALTH_COLUMNS) as DailyHealthColumn[];

function hasAnyValue(day: DailyHealthDay) {
  return VALUE_KEYS.some((k) => day[k] !== null);
}

/**
 * Known values go in; a null (unknown) never overwrites a known value. With
 * `fill` a value only goes in where the day has none yet.
 */
function merge(day: DailyHealthDay, values: Values, fill = false) {
  const target = day as Record<string, unknown>;
  for (const [k, v] of Object.entries(values))
    if (v !== null && v !== undefined && !(fill && target[k] !== null))
      target[k] = v;
}

const isContainer = (v: unknown) => Array.isArray(v) || record(v) !== null;
const isEmptyContainer = (v: unknown) =>
  Array.isArray(v) ? v.length === 0 : Object.keys(record(v) ?? {}).length === 0;

/** One outcome for an endpoint asked several times: ok beats the rest. */
function summarize(list: EndpointOutcome[]): EndpointOutcome {
  for (const o of ["ok", "error", "unavailable"] as const)
    if (list.includes(o)) return o;
  return "empty";
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
        ...compact({
          resting_hr_bpm: whole(hr?.restingValue, 20, 250),
          // Garmin uses negative stress values for "not measured".
          stress_avg: whole(stress?.avgLevel, 0, 100),
          body_battery_high: whole(bb?.maxValue, 0, 100),
          body_battery_end_of_day: whole(bb?.endOfDayValue, 0, 100),
        }),
        // Activity, respiration, blood oxygen (garmin-extended.ts).
        ...summaryExtras(s),
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
    out.push({ local_date, values: sleepValues([s]) });
  }
  return out;
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
      values: compact({
        hrv_last_night_ms: whole(s.lastNightAvg, 1, 500),
        hrv_status:
          typeof s.status === "string"
            ? (HRV_STATUS[s.status.toUpperCase()] ?? null)
            : null,
      }),
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
