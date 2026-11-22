/**
 * Reading Garmin's answers (Personal API) tolerantly: the helpers shared by
 * garmin-personal.ts and the readers of the extended daily values (sleep
 * stages, respiration, blood oxygen, activity, skin temperature, fitness,
 * training).
 *
 * UNGEPRÜFT BIS ZUM ERSTEN ECHTEN ABRUF: Garmin documents the Personal API
 * only in part. Every field name below is a candidate taken from Garmin's
 * public Connect data model and from what is known about the web API, not a
 * confirmed name of this API. A candidate that does not exist leaves the
 * value NULL (never 0, never an error); the answer itself is kept raw
 * (health_daily_raw) so a wrong name can be fixed and the days read again.
 * The raw answers are cleaned first: nothing that looks like a key or a token
 * is kept, and a payload is cut down to a fixed size.
 *
 * Pure: no I/O, no clock.
 */
import type { DailyHealthDay } from "./source.js";

export type Values = Partial<DailyHealthDay>;
export type Dated = { local_date: string; values: Values };
type Rec = Record<string, unknown>;

const DATE = /^\d{4}-\d{2}-\d{2}$/;

export const record = (v: unknown): Rec | null =>
  typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Rec) : null;

/** A whole number in range, else null. Garmin's "no value" is never 0 here. */
export function whole(v: unknown, min: number, max: number): number | null {
  if (typeof v !== "number" || !Number.isFinite(v)) return null;
  const n = Math.round(v);
  return n >= min && n <= max ? n : null;
}

/** A number with `digits` decimals in range, else null. */
export function decimal(
  v: unknown,
  min: number,
  max: number,
  digits: number,
): number | null {
  if (typeof v !== "number" || !Number.isFinite(v)) return null;
  const f = 10 ** digits;
  const n = Math.round(v * f) / f;
  return n >= min && n <= max ? n : null;
}

export function dateOf(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const d = v.slice(0, 10);
  return DATE.test(d) ? d : null;
}

/** Lower case identifier (a-z, 0-9, _) of 1..40 characters, else null. */
export function identifier(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const id = v
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return id.length >= 1 && id.length <= 40 ? id : null;
}

/**
 * A local wall-clock time as YYYY-MM-DDTHH:MM:SS. Garmin's "...Local"
 * timestamps are milliseconds that already carry the local wall clock as if
 * it were UTC (ungeprüft); they are only formatted, never shifted. A text
 * with a zone suffix (Z, +01:00) is UTC or offset-based and therefore not
 * accepted: the local day must never come from a UTC conversion.
 */
export function localTime(v: unknown): string | null {
  if (typeof v === "number" && Number.isFinite(v)) {
    if (v < 946_684_800_000 || v > 4_102_444_800_000) return null;
    return new Date(v).toISOString().slice(0, 19);
  }
  if (typeof v === "string") {
    const m = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}:\d{2})(\.\d+)?$/.exec(
      v.trim(),
    );
    return m ? `${m[1]}T${m[2]}` : null;
  }
  return null;
}

const lowerKeys = (r: Rec) => {
  const out = new Map<string, unknown>();
  for (const [k, v] of Object.entries(r)) out.set(k.toLowerCase(), v);
  return out;
};

/**
 * The first present (not null) value of the candidate names, names in order
 * of preference, searched case-insensitively in each scope in order.
 */
export function pick(scopes: (Rec | null)[], names: string[]): unknown {
  const maps = scopes.filter((s): s is Rec => s !== null).map(lowerKeys);
  for (const name of names) {
    const key = name.toLowerCase();
    for (const map of maps) {
      const v = map.get(key);
      if (v !== undefined && v !== null) return v;
    }
  }
  return undefined;
}

/** The record itself and the records directly inside it. */
export function withNested(r: Rec | null): Rec[] {
  if (!r) return [];
  return [
    r,
    ...Object.values(r)
      .map(record)
      .filter((v): v is Rec => v !== null),
  ];
}

/**
 * Searches the whole answer breadth-first (to a depth) for the candidate
 * names and returns the first present value, names in order of preference.
 * For answers whose nesting is not known (training status).
 */
export function deepPick(root: unknown, names: string[], maxDepth = 8) {
  const wanted = new Set(names.map((n) => n.toLowerCase()));
  const found = new Map<string, unknown>();
  let level: unknown[] = [root];
  for (let depth = 0; depth <= maxDepth && level.length > 0; depth++) {
    const next: unknown[] = [];
    for (const node of level) {
      if (Array.isArray(node)) next.push(...node);
      else if (record(node)) {
        for (const [k, v] of Object.entries(node as Rec)) {
          const key = k.toLowerCase();
          if (wanted.has(key) && v !== null && v !== undefined)
            if (!found.has(key)) found.set(key, v);
          if (typeof v === "object" && v !== null) next.push(v);
        }
      }
    }
    level = next;
  }
  for (const name of names) {
    const v = found.get(name.toLowerCase());
    if (v !== undefined) return v;
  }
  return undefined;
}

/** Keeps only the values that are not null. */
export function compact(values: Record<string, unknown>): Values {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(values))
    if (v !== null && v !== undefined) out[k] = v;
  return out as Values;
}

/** The days' values that are known; nothing known is nothing. */
export const hasValues = (values: Values) => Object.keys(values).length > 0;

// ------------------------------------------------------------ sleep

/**
 * The overall sleep score. `sleepScores` is a map from a component name to
 * { value }; the name of the overall component is not documented. "overall"
 * is the expected one; an unknown shape is null, never an error.
 */
export function overallSleepScore(scores: unknown): number | null {
  const map = record(scores);
  if (!map) return null;
  const key = Object.keys(map).find((k) => k.toLowerCase() === "overall");
  return key ? whole(record(map[key])?.value, 0, 100) : null;
}

/**
 * Sleep values of one sleep record (a DailySleepDTO). The same candidate
 * names serve the summary list and the single-day answer.
 */
export function sleepValues(scopes: (Rec | null)[]): Values {
  const dto = scopes[0];
  return compact({
    sleep_seconds: whole(pick(scopes, ["sleepTimeSeconds"]), 1, 86_400),
    sleep_score: overallSleepScore(dto?.sleepScores),
    sleep_deep_seconds: whole(pick(scopes, ["deepSleepSeconds"]), 0, 86_400),
    sleep_light_seconds: whole(pick(scopes, ["lightSleepSeconds"]), 0, 86_400),
    sleep_rem_seconds: whole(pick(scopes, ["remSleepSeconds"]), 0, 86_400),
    sleep_awake_seconds: whole(pick(scopes, ["awakeSleepSeconds"]), 0, 86_400),
    sleep_awake_count: whole(pick(scopes, ["awakeCount"]), 0, 500),
    sleep_restless_moments: whole(
      pick(scopes, ["restlessMomentsCount", "restlessMoments"]),
      0,
      5000,
    ),
    sleep_start_local: localTime(
      pick(scopes, ["sleepStartTimestampLocal", "sleepStartLocal"]),
    ),
    sleep_end_local: localTime(
      pick(scopes, ["sleepEndTimestampLocal", "sleepEndLocal"]),
    ),
    respiration_sleep_avg: decimal(
      pick(scopes, ["averageRespirationValue", "avgSleepRespirationValue"]),
      1,
      99,
      1,
    ),
    respiration_sleep_low: decimal(
      pick(scopes, ["lowestRespirationValue"]),
      1,
      99,
      1,
    ),
    respiration_sleep_high: decimal(
      pick(scopes, ["highestRespirationValue"]),
      1,
      99,
      1,
    ),
    skin_temp_deviation_c: decimal(
      pick(scopes, [
        "avgSkinTempDeviationC",
        "skinTempDeviationC",
        "averageSkinTemperatureDeviation",
        "skinTemperatureDeviation",
        "nightlySkinTempDeviation",
      ]),
      -10,
      10,
      2,
    ),
  });
}

/** /sleep-service/sleep/dailySleep?date=… → { dailySleepDTO: {...}, ... }. */
export function readSleepDetail(json: unknown, date: string): Dated | null {
  const top = record(json);
  if (!top) return null;
  const dto = record(top.dailySleepDTO) ?? top;
  const values = sleepValues([dto, top]);
  return { local_date: dateOf(dto.calendarDate) ?? date, values };
}

// ------------------------------------------------------------ activity

/**
 * The extra values of one /usersummary-service/v2/dailysummaries entry:
 * activity and the respiration and blood oxygen of the day. (Heart rate,
 * stress and Body Battery are read in garmin-personal.ts.)
 */
export function summaryExtras(summary: Rec): Values {
  const scopes = withNested(summary);
  return compact({
    steps: whole(pick(scopes, ["totalSteps", "steps"]), 0, 200_000),
    step_goal: whole(pick(scopes, ["dailyStepGoal", "stepGoal"]), 0, 200_000),
    intensity_minutes_moderate: whole(
      pick(scopes, ["moderateIntensityMinutes"]),
      0,
      2880,
    ),
    intensity_minutes_vigorous: whole(
      pick(scopes, ["vigorousIntensityMinutes"]),
      0,
      2880,
    ),
    floors_climbed: whole(
      pick(scopes, ["floorsAscended", "floorsClimbed"]),
      0,
      2000,
    ),
    kcal_active: whole(
      pick(scopes, ["activeKilocalories", "activeKcal"]),
      0,
      20_000,
    ),
    kcal_total: whole(
      pick(scopes, ["totalKilocalories", "totalKcal"]),
      0,
      20_000,
    ),
    distance_m: whole(
      pick(scopes, ["totalDistanceMeters", "distanceMeters"]),
      0,
      1_000_000,
    ),
    respiration_day_avg: decimal(
      pick(scopes, ["avgWakingRespirationValue", "averageRespirationValue"]),
      1,
      99,
      1,
    ),
    respiration_day_low: decimal(
      pick(scopes, ["lowestRespirationValue"]),
      1,
      99,
      1,
    ),
    respiration_day_high: decimal(
      pick(scopes, ["highestRespirationValue"]),
      1,
      99,
      1,
    ),
    spo2_avg_pct: whole(
      pick(scopes, ["averageSpo2", "averageSpo2Value", "avgSpo2"]),
      1,
      100,
    ),
    spo2_min_pct: whole(
      pick(scopes, ["lowestSpo2", "lowestSpo2Value", "minSpo2"]),
      1,
      100,
    ),
  });
}

/** Entries of a list answer: the array itself or the first array inside it. */
export function entries(json: unknown): Rec[] {
  let list: unknown = json;
  if (!Array.isArray(list)) {
    const top = record(json);
    list = top ? Object.values(top).find((v) => Array.isArray(v)) : undefined;
  }
  return Array.isArray(list)
    ? (list as unknown[]).map(record).filter((v): v is Rec => v !== null)
    : [];
}

const entryDate = (e: Rec) =>
  dateOf(pick([e], ["calendarDate", "date", "day", "calendarDateLocal"]));

/** /usersummary-service/stats/steps/daily/{start}/{end} → [{ calendarDate, totalSteps, ... }]. */
export function readStepsDaily(json: unknown): Dated[] {
  const out: Dated[] = [];
  for (const e of entries(json)) {
    const local_date = entryDate(e);
    if (!local_date) continue;
    const values = compact({
      steps: whole(pick([e], ["totalSteps", "steps"]), 0, 200_000),
      step_goal: whole(pick([e], ["stepGoal", "dailyStepGoal"]), 0, 200_000),
      distance_m: whole(
        pick([e], ["totalDistance", "totalDistanceMeters"]),
        0,
        1_000_000,
      ),
    });
    if (hasValues(values)) out.push({ local_date, values });
  }
  return out;
}

/** The blood oxygen of /wellness-service/wellness/daily/spo2acclimation/{date}. */
export function readSpo2(json: unknown, date: string): Dated | null {
  const top = record(json);
  if (!top) return null;
  const scopes = withNested(top);
  return {
    local_date: date,
    values: compact({
      spo2_avg_pct: whole(
        pick(scopes, ["averageSpo2", "averageSpO2", "avgSpo2", "spo2Avg"]),
        1,
        100,
      ),
      spo2_min_pct: whole(
        pick(scopes, ["lowestSpo2", "lowestSpO2", "minSpo2", "spo2Min"]),
        1,
        100,
      ),
    }),
  };
}

// ------------------------------------------------------------ fitness

/**
 * /metrics-service/metrics/maxmet/daily/{start}/{end} → a list of
 * { generic: { calendarDate, vo2MaxPreciseValue, fitnessAge }, cycling: {...} }
 * (shape from Garmin Connect's web API, ungeprüft); a flat entry works too.
 */
export function readMaxMet(json: unknown): Dated[] {
  const out: Dated[] = [];
  for (const e of entries(json)) {
    const generic = record(e.generic) ?? e;
    const cycling = record(e.cycling);
    const local_date = entryDate(generic) ?? entryDate(e);
    if (!local_date) continue;
    const vo2 = ["vo2MaxPreciseValue", "vo2MaxValue"];
    const values = compact({
      vo2max_running: decimal(pick([generic], vo2), 5, 100, 1),
      vo2max_cycling: decimal(pick([cycling], vo2), 5, 100, 1),
      fitness_age: whole(pick([generic], ["fitnessAge"]), 10, 100),
    });
    if (hasValues(values)) out.push({ local_date, values });
  }
  return out;
}

/** /fitnessage-service/fitnessage/v2/{date}. */
export function readFitnessAge(json: unknown, date: string): Dated | null {
  if (!record(json)) return null;
  return {
    local_date: date,
    values: compact({
      fitness_age: whole(deepPick(json, ["fitnessAge"]), 10, 100),
      chronological_age: whole(
        deepPick(json, ["chronologicalAge", "chronologicalAgeYears"]),
        5,
        120,
      ),
    }),
  };
}

// ------------------------------------------------------------ training

/**
 * /metrics-service/metrics/trainingreadiness/{date}: a record or a list of
 * records with `score` and `level`. NOT confirmed for the Personal API;
 * treated as optional.
 */
export function readTrainingReadiness(
  json: unknown,
  date: string,
): Dated | null {
  const top = Array.isArray(json) ? entries(json)[0] : record(json);
  if (!top) return null;
  return {
    local_date: date,
    values: compact({
      training_readiness_score: whole(
        pick([top], ["score", "trainingReadinessScore"]),
        0,
        100,
      ),
      training_readiness_level: identifier(
        pick([top], ["level", "trainingReadinessLevel", "readinessLevel"]),
      ),
    }),
  };
}

/**
 * /metrics-service/metrics/trainingstatus/aggregated/{date}: the nesting
 * (per device) is not known, so the names are searched in the whole answer.
 * NOT confirmed for the Personal API; treated as optional. A numeric status
 * code is not guessed into a word: it stays NULL (the raw answer keeps it).
 */
export function readTrainingStatus(json: unknown, date: string): Dated | null {
  if (!record(json) && !Array.isArray(json)) return null;
  const status = deepPick(json, [
    "trainingStatusFeedbackPhrase",
    "trainingStatusKey",
  ]);
  return {
    local_date: date,
    values: compact({
      training_status: identifier(status),
      acute_load: decimal(
        deepPick(json, ["dailyTrainingLoadAcute", "acuteTrainingLoad"]),
        0,
        10_000,
        1,
      ),
      chronic_load: decimal(
        deepPick(json, ["dailyTrainingLoadChronic", "chronicTrainingLoad"]),
        0,
        10_000,
        1,
      ),
      load_ratio: decimal(
        deepPick(json, [
          "dailyAcuteChronicWorkloadRatio",
          "acuteChronicWorkloadRatio",
        ]),
        0,
        99,
        2,
      ),
    }),
  };
}

// ------------------------------------------------------------ raw answers

/** Largest cleaned payload the server stores (the database allows 256 KB of JSON text). */
export const RAW_MAX_BYTES = 120_000;
const SECRET_KEY =
  /token|secret|password|passwd|authorization|api[-_]?key|bearer|credential|cookie/i;
const SECRET_VALUE = /^(?:eyJ[\w-]+\.[\w-]+\.[\w-]*|(?:apikey|bearer)\s+\S+)$/i;
const MAX_DEPTH = 12;

const cleanText = (s: string) =>
  s
    .replaceAll("\u0000", "")
    .replace(
      /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g,
      "",
    );

/** Copy of an answer without anything that looks like a key or a token. */
export function sanitize(value: unknown, depth = 0): unknown {
  if (depth > MAX_DEPTH) return null;
  if (typeof value === "string") {
    // jsonb refuses NUL and lone surrogates: remove them before they get there.
    const text = cleanText(value);
    return SECRET_VALUE.test(text.trim()) || text.length > 4000 ? null : text;
  }
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "boolean" || value === null) return value;
  if (Array.isArray(value)) return value.map((v) => sanitize(v, depth + 1));
  const r = record(value);
  if (!r) return null;
  const out: Rec = {};
  for (const [k, v] of Object.entries(r))
    if (!SECRET_KEY.test(k)) out[cleanText(k)] = sanitize(v, depth + 1);
  return out;
}

const size = (v: unknown) => Buffer.byteLength(JSON.stringify(v), "utf8");

/**
 * Cleans an answer and cuts it to the size limit. An answer that is too big
 * loses its biggest top-level parts first (they are named in `_truncated`);
 * a list is shortened. Null when nothing usable fits.
 */
export function rawPayload(value: unknown): unknown {
  const payload: unknown = sanitize(value);
  if (payload === null || payload === undefined) return null;
  if (size(payload) <= RAW_MAX_BYTES) return payload;
  if (Array.isArray(payload)) {
    let list: unknown[] = payload;
    while (list.length > 1 && size(list) > RAW_MAX_BYTES)
      list = list.slice(0, Math.floor(list.length / 2));
    return size(list) <= RAW_MAX_BYTES ? list : null;
  }
  const r = { ...(payload as Rec) };
  const dropped: string[] = [];
  while (size({ ...r, _truncated: dropped }) > RAW_MAX_BYTES) {
    const biggest = Object.keys(r).sort((a, b) => size(r[b]) - size(r[a]))[0];
    if (biggest === undefined) return null;
    dropped.push(biggest);
    delete r[biggest];
  }
  return { ...r, _truncated: dropped };
}

/**
 * Splits the answer of a range endpoint into one payload per local day: the
 * entries of its list, each by its own date. Entries without a date are not
 * kept (their day is unknown).
 */
export function splitByDay(json: unknown): Map<string, unknown> {
  const days = new Map<string, unknown>();
  for (const e of entries(json)) {
    const date = entryDate(e) ?? entryDate(record(e.generic) ?? {});
    if (date) days.set(date, e);
  }
  return days;
}
