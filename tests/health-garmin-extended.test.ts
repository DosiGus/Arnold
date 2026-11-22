/**
 * Extended daily values (sleep stages, respiration, blood oxygen, activity,
 * skin temperature, fitness, training) and the raw answers, against INVENTED
 * Garmin answers in an ASSUMED shape: Garmin documents the Personal API only
 * in part, so every field name here is a candidate, "ungeprüft bis zum ersten
 * echten Abruf". The tests pin the tolerant reading, not Garmin's format.
 */
import { inspect } from "node:util";
import { describe, expect, it, vi } from "vitest";
import {
  GarminPersonalSource,
  MAX_OPTIONAL_REQUESTS,
  readStoredAnswers,
} from "../src/server/health/garmin-personal";
import { EMPTY_ANSWER } from "../src/server/health/source";
import {
  RAW_MAX_BYTES,
  localTime,
  summaryExtras,
  rawPayload,
  readMaxMet,
  readTrainingStatus,
} from "../src/server/health/garmin-extended";
import {
  BACKFILL_PER_FETCH,
  chooseDetailDates,
} from "../src/server/health/sync";

const KEY = "invented-test-key-9b2e44d1";
const NOW = Date.parse("2026-11-16T08:00:00Z");
const TOKEN = [
  "eyJhbGciOiJub25lIn0",
  Buffer.from(JSON.stringify({ exp: NOW / 1000 + 86_400 })).toString(
    "base64url",
  ),
  "sig",
].join(".");

// ---- invented answers, assumed shapes
const SUMMARIES = {
  data: [
    {
      calendarDate: "2026-11-15",
      heartRate: { restingValue: 51 },
      totalSteps: 9_412,
      dailyStepGoal: 8_000,
      moderateIntensityMinutes: 22,
      vigorousIntensityMinutes: 9,
      floorsAscended: 11,
      activeKilocalories: 540,
      totalKilocalories: 2_610,
      totalDistanceMeters: 7_345.6,
      avgWakingRespirationValue: 14.4,
      lowestRespirationValue: 9,
      highestRespirationValue: 22,
      averageSpo2: 95,
      lowestSpo2: 89,
    },
  ],
};
const SLEEP_DETAIL = {
  dailySleepDTO: {
    calendarDate: "2026-11-15",
    sleepTimeSeconds: 27_000,
    deepSleepSeconds: 5_400,
    lightSleepSeconds: 14_400,
    remSleepSeconds: 7_200,
    awakeSleepSeconds: 900,
    awakeCount: 3,
    restlessMomentsCount: 41,
    // local wall clock as epoch ms: 2026-11-14 23:10:00 and 2026-11-15 06:40:00
    sleepStartTimestampLocal: Date.UTC(2026, 10, 14, 23, 10, 0),
    sleepEndTimestampLocal: Date.UTC(2026, 10, 15, 6, 40, 0),
    averageRespirationValue: 13.2,
    lowestRespirationValue: 10.1,
    highestRespirationValue: 17.8,
    avgSkinTempDeviationC: -0.4,
    sleepScores: { overall: { value: 83 } },
  },
  // would leak if copied into the raw answer
  accessToken: "must-not-be-kept",
};
const MAXMET = [
  {
    generic: {
      calendarDate: "2026-11-15",
      vo2MaxPreciseValue: 52.34,
      fitnessAge: 31,
    },
    cycling: { vo2MaxPreciseValue: 49.9 },
  },
];
const FITNESS_AGE = { chronologicalAge: 34, fitnessAge: 31.4 };
const READINESS = [{ score: 71, level: "HIGH" }];
const STATUS = {
  mostRecentTrainingStatus: {
    latestTrainingStatusData: {
      "1234567": {
        trainingStatusFeedbackPhrase: "PRODUCTIVE_5",
        acuteTrainingLoadDTO: {
          dailyTrainingLoadAcute: 412.6,
          dailyTrainingLoadChronic: 380.2,
          dailyAcuteChronicWorkloadRatio: 1.08,
        },
      },
    },
  },
};

type Route = (url: URL) => Response;
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status });

function fakeGarmin(overrides: Record<string, Route> = {}) {
  const calls: string[] = [];
  const routes: Record<string, Route> = {
    token: () => new Response(TOKEN, { status: 200 }),
    summaries: () => json(SUMMARIES),
    sleepSummaries: () => json([]),
    hrv: () => new Response(null, { status: 204 }),
    steps: () => json([{ calendarDate: "2026-11-15", totalSteps: 9_999 }]),
    maxmet: () => json(MAXMET),
    bodyBattery: () => json([{ date: "2026-11-15", charged: 60 }]),
    dailySleep: () => json(SLEEP_DETAIL),
    spo2: () => new Response("", { status: 404 }),
    fitnessAge: () => json(FITNESS_AGE),
    readiness: () => json(READINESS),
    status: () => json(STATUS),
    ...overrides,
  };
  const fetch = vi.fn(async (raw: string) => {
    const url = new URL(raw);
    const p = url.pathname;
    calls.push(p);
    if (p.includes("personal-api-key/token")) return routes.token(url);
    if (p.includes("dailysummaries")) return routes.summaries(url);
    if (p.includes("dailySleepSummariesByDate"))
      return routes.sleepSummaries(url);
    if (p.includes("/sleep-service/sleep/dailySleep"))
      return routes.dailySleep(url);
    if (p.startsWith("/hrv-service/")) return routes.hrv(url);
    if (p.includes("/stats/steps/daily/")) return routes.steps(url);
    if (p.includes("/maxmet/daily/")) return routes.maxmet(url);
    if (p.includes("bodyBattery")) return routes.bodyBattery(url);
    if (p.includes("spo2acclimation")) return routes.spo2(url);
    if (p.includes("fitnessage")) return routes.fitnessAge(url);
    if (p.includes("trainingreadiness")) return routes.readiness(url);
    if (p.includes("trainingstatus")) return routes.status(url);
    return new Response("", { status: 404 });
  });
  return { fetch, calls };
}

const source = (fetch: ReturnType<typeof fakeGarmin>["fetch"]) =>
  new GarminPersonalSource({ apiKey: KEY, fetch, now: () => NOW });

const DAY = "2026-11-15";
const fetchDay = async (
  garmin: ReturnType<typeof fakeGarmin>,
  detailDates: string[] = [DAY],
) => {
  const result = await source(garmin.fetch).fetchDays(DAY, DAY, {
    detailDates,
  });
  if (!result.ok) throw new Error(`failed: ${result.failure}`);
  return result;
};

describe("extended values", () => {
  it("reads every group from the assumed answers, unknown stays null", async () => {
    const result = await fetchDay(fakeGarmin());
    expect(result.days).toHaveLength(1);
    expect(result.days[0]).toEqual({
      local_date: DAY,
      resting_hr_bpm: 51,
      stress_avg: null,
      body_battery_high: null,
      body_battery_end_of_day: null,
      sleep_seconds: 27_000,
      sleep_score: 83,
      hrv_last_night_ms: null,
      hrv_status: null,
      sleep_deep_seconds: 5_400,
      sleep_light_seconds: 14_400,
      sleep_rem_seconds: 7_200,
      sleep_awake_seconds: 900,
      sleep_awake_count: 3,
      sleep_restless_moments: 41,
      sleep_start_local: "2026-11-14T23:10:00",
      sleep_end_local: "2026-11-15T06:40:00",
      respiration_sleep_avg: 13.2,
      respiration_sleep_low: 10.1,
      respiration_sleep_high: 17.8,
      respiration_day_avg: 14.4,
      respiration_day_low: 9,
      respiration_day_high: 22,
      spo2_avg_pct: 95,
      spo2_min_pct: 89,
      // the required summaries know the steps; the steps path only fills gaps
      steps: 9_412,
      step_goal: 8_000,
      intensity_minutes_moderate: 22,
      intensity_minutes_vigorous: 9,
      floors_climbed: 11,
      kcal_active: 540,
      kcal_total: 2_610,
      distance_m: 7_346,
      skin_temp_deviation_c: -0.4,
      vo2max_running: 52.3,
      vo2max_cycling: 49.9,
      fitness_age: 31,
      chronological_age: 34,
      training_readiness_score: 71,
      training_readiness_level: "high",
      training_status: "productive_5",
      acute_load: 412.6,
      chronic_load: 380.2,
      load_ratio: 1.08,
    });
    expect(result.endpoints).toEqual({
      steps_daily: "ok",
      max_met_daily: "ok",
      body_battery_daily: "ok",
      daily_sleep: "ok",
      spo2_acclimation: "unavailable",
      fitness_age: "ok",
      training_readiness: "ok",
      training_status: "ok",
    });
  });

  it("asks single-day endpoints only for the given days", async () => {
    const garmin = fakeGarmin();
    await fetchDay(garmin, []);
    expect(garmin.calls.some((p) => p.includes("fitnessage"))).toBe(false);
    expect(garmin.calls.some((p) => p.endsWith("/dailySleep"))).toBe(false);
    // range endpoints are still asked
    expect(garmin.calls.some((p) => p.includes("maxmet"))).toBe(true);
  });

  it("keeps the local time as it is: no UTC shift, no zone suffix", () => {
    expect(localTime(Date.UTC(2026, 10, 14, 23, 10, 0))).toBe(
      "2026-11-14T23:10:00",
    );
    expect(localTime("2026-11-14 23:10:00")).toBe("2026-11-14T23:10:00");
    expect(localTime("2026-11-14T23:10:00Z")).toBeNull();
    expect(localTime("2026-11-14T23:10:00+01:00")).toBeNull();
    expect(localTime(12)).toBeNull();
  });

  it("turns values outside the sensible range into null, never 0", async () => {
    const garmin = fakeGarmin({
      summaries: () =>
        json({
          data: [
            {
              calendarDate: DAY,
              totalSteps: -1,
              averageSpo2: 0,
              lowestSpo2: 250,
              avgWakingRespirationValue: -1,
              moderateIntensityMinutes: "n/a",
            },
          ],
        }),
      dailySleep: () => json({ dailySleepDTO: { deepSleepSeconds: 999_999 } }),
      steps: () => json([]),
      maxmet: () =>
        json([{ generic: { calendarDate: DAY, vo2MaxPreciseValue: 3 } }]),
      fitnessAge: () => json({ fitnessAge: 4 }),
      readiness: () => json([{ score: 400, level: "" }]),
      status: () => json({ trainingStatus: 7 }),
    });
    const result = await fetchDay(garmin);
    expect(result.days).toEqual([]);
    expect(result.endpoints).toMatchObject({
      daily_sleep: "error",
      fitness_age: "error",
      training_readiness: "error",
      training_status: "error",
      steps_daily: "empty",
    });
  });

  it("reads training status from an unknown nesting; a numeric status code stays null", () => {
    const read = readTrainingStatus(
      { a: [{ b: { trainingStatus: 7, dailyTrainingLoadAcute: 100 } }] },
      DAY,
    );
    expect(read?.values).toEqual({ acute_load: 100 });
    expect(readMaxMet({ data: [{ calendarDate: DAY }] })).toEqual([]);
  });
});

describe("the real shape of the daily summary (first real fetch, 22.11.2026)", () => {
  it("reads calories, respiration and intensity minutes from their nested blocks", () => {
    const values = summaryExtras({
      calendarDate: "2026-11-21",
      calories: { burnedActive: 325, burnedResting: 2222, burnedTotal: 2547 },
      respiration: { avgValue: 14, minValue: 8, maxValue: 22 },
      intensityMinutes: { goal: 150, moderate: 0, vigorous: 0 },
      pulseOx: { avgAltitudeInMeters: 1231 },
      movement: null,
    });
    expect(values).toMatchObject({
      kcal_active: 325,
      kcal_total: 2547,
      respiration_day_avg: 14,
      respiration_day_low: 8,
      respiration_day_high: 22,
      intensity_minutes_moderate: 0,
      intensity_minutes_vigorous: 0,
    });
    // Nothing measured stays unknown, not 0.
    expect(values.spo2_avg_pct ?? null).toBeNull();
    expect(values.floors_climbed ?? null).toBeNull();
  });
});

describe("optional paths never fail the fetch", () => {
  const failing: Record<string, Route>[] = [
    { maxmet: () => new Response("", { status: 403 }) },
    { fitnessAge: () => new Response(`secret ${KEY}`, { status: 500 }) },
    { readiness: () => new Response(null, { status: 204 }) },
    { status: () => new Response("{not json", { status: 200 }) },
    { dailySleep: () => json("just a string") },
    {
      steps: () => {
        throw new TypeError(`fetch failed ${KEY}`);
      },
    },
  ];

  it("returns the required values whatever an optional path does", async () => {
    for (const routes of failing) {
      const result = await fetchDay(fakeGarmin(routes));
      expect(result.days[0].resting_hr_bpm).toBe(51);
      expect(result.days[0].distance_m).toBe(7_346);
    }
  });

  it("names how each one ended, without any text", async () => {
    const result = await fetchDay(
      fakeGarmin({
        maxmet: () => new Response("", { status: 403 }),
        fitnessAge: () => new Response(`secret ${KEY}`, { status: 500 }),
        readiness: () => new Response(null, { status: 204 }),
        status: () => new Response("{not json", { status: 200 }),
        dailySleep: () => json("just a string"),
        steps: () => {
          throw new TypeError(`fetch failed ${KEY}`);
        },
      }),
    );
    expect(result.endpoints).toMatchObject({
      max_met_daily: "unavailable",
      fitness_age: "error",
      training_readiness: "empty",
      training_status: "error",
      daily_sleep: "error",
      steps_daily: "error",
    });
    const text = JSON.stringify(result);
    expect(text).not.toContain(KEY);
    expect(text).not.toContain(TOKEN);
  });

  it("does not overwrite a known value with an unusable answer", async () => {
    // summaries know the steps; the steps path answers rubbish
    const result = await fetchDay(
      fakeGarmin({
        steps: () => json([{ calendarDate: DAY, totalSteps: -5 }]),
      }),
    );
    expect(result.days[0].steps).toBe(9_412);
  });

  it("stops an endpoint after it was refused once, and after repeated errors", async () => {
    const dates = [
      "2026-11-15",
      "2026-11-14",
      "2026-11-13",
      "2026-11-12",
      "2026-11-11",
    ];
    const garmin = fakeGarmin({
      fitnessAge: () => new Response("", { status: 404 }),
      readiness: () => new Response("", { status: 500 }),
    });
    await source(garmin.fetch).fetchDays("2026-11-11", DAY, {
      detailDates: dates,
    });
    expect(garmin.calls.filter((p) => p.includes("fitnessage"))).toHaveLength(
      1,
    );
    expect(
      garmin.calls.filter((p) => p.includes("trainingreadiness")),
    ).toHaveLength(2);
    expect(garmin.calls.filter((p) => p.endsWith("/dailySleep"))).toHaveLength(
      5,
    );
  });

  it("a 429 on an optional path ends the optional requests, keeps what was read", async () => {
    const garmin = fakeGarmin({
      dailySleep: () => new Response("", { status: 429 }),
    });
    const result = await fetchDay(garmin, [DAY, "2026-11-14"]);
    expect(result.rateLimited).toBe(true);
    expect(result.days[0].resting_hr_bpm).toBe(51);
    expect(garmin.calls.filter((p) => p.endsWith("/dailySleep"))).toHaveLength(
      1,
    );
    expect(garmin.calls.some((p) => p.includes("fitnessage"))).toBe(false);
  });

  it("a 429 on a required path still fails the fetch as rate_limited", async () => {
    const garmin = fakeGarmin({
      summaries: () => new Response("", { status: 429 }),
    });
    expect(await source(garmin.fetch).fetchDays(DAY, DAY)).toEqual({
      ok: false,
      failure: "rate_limited",
    });
  });

  it("caps the optional requests of one fetch", async () => {
    const garmin = fakeGarmin();
    const dates = Array.from(
      { length: 28 },
      (_, i) => `2026-10-${String(i + 1).padStart(2, "0")}`,
    );
    await source(garmin.fetch).fetchDays("2026-10-01", "2026-10-28", {
      detailDates: dates,
    });
    const required = garmin.calls.filter(
      (p) =>
        p.includes("token") ||
        p.includes("dailysummaries") ||
        p.includes("dailySleepSummariesByDate") ||
        p.startsWith("/hrv-service/"),
    ).length;
    expect(garmin.calls.length - required).toBeLessThanOrEqual(
      MAX_OPTIONAL_REQUESTS,
    );
    expect(garmin.calls.length - required).toBe(MAX_OPTIONAL_REQUESTS);
  });
});

describe("raw answers", () => {
  it("keeps the cleaned answer of every successful endpoint, per day", async () => {
    const result = await fetchDay(fakeGarmin());
    const keys = (result.raw ?? []).map((r) => `${r.local_date}|${r.endpoint}`);
    expect(keys.sort()).toEqual(
      [
        "daily_summary",
        "daily_sleep",
        "fitness_age",
        "training_readiness",
        "training_status",
        "steps_daily",
        "max_met_daily",
        "body_battery_daily",
      ]
        .map((e) => `${DAY}|${e}`)
        .sort(),
    );
    const sleep = result.raw?.find((r) => r.endpoint === "daily_sleep");
    // Nothing that looks like a token survives.
    expect(JSON.stringify(sleep?.payload)).not.toContain("must-not-be-kept");
    expect(JSON.stringify(sleep?.payload)).toContain("deepSleepSeconds");
  });

  it("removes key- and token-like content and cuts oversize answers", () => {
    const cleaned = rawPayload({
      ok: 1,
      Authorization: "Bearer abc",
      nested: { api_key: "k", fine: "x", jwt: "eyJhbGciOi.eyJleHAiOjF9.sig" },
    });
    expect(cleaned).toEqual({ ok: 1, nested: { fine: "x", jwt: null } });

    const big = {
      small: 1,
      samples: Array.from({ length: 60_000 }, (_, i) => i),
    };
    const cut = rawPayload(big) as Record<string, unknown>;
    expect(Buffer.byteLength(JSON.stringify(cut))).toBeLessThanOrEqual(
      RAW_MAX_BYTES,
    );
    expect(cut.small).toBe(1);
    expect(cut._truncated).toEqual(["samples"]);
    expect(rawPayload("\u0000x\ud800")).toBe("x");
  });

  it("never lets the key or token reach a result, object or log", async () => {
    const logged: string[] = [];
    for (const m of ["log", "info", "warn", "error", "debug"] as const)
      vi.spyOn(console, m).mockImplementation((...a: unknown[]) => {
        logged.push(a.map(String).join(" "));
      });
    const supplier = source(
      fakeGarmin({
        fitnessAge: () => new Response(`echo ${KEY} ${TOKEN}`, { status: 500 }),
        status: () => json({ token: TOKEN, apiKey: KEY, x: `ApiKey ${KEY}` }),
      }).fetch,
    );
    const result = await supplier.fetchDays(DAY, DAY, { detailDates: [DAY] });
    const text = [
      JSON.stringify(result),
      JSON.stringify(supplier),
      inspect(supplier, { depth: 5 }),
      ...logged,
    ].join("\n");
    expect(text).not.toContain(KEY);
    expect(text).not.toContain(TOKEN);
    vi.restoreAllMocks();
  });
});

describe("choosing the days for single-day requests", () => {
  it("takes the last 3 days always, then the newest days without a raw answer", () => {
    const none = chooseDetailDates("2026-11-16", new Set());
    expect(none.slice(0, 3)).toEqual([
      "2026-11-16",
      "2026-11-15",
      "2026-11-14",
    ]);
    expect(none).toHaveLength(3 + BACKFILL_PER_FETCH);
    expect(none.at(-1)).toBe("2026-11-07");
    // days that have a raw answer are not asked again, within the 28 days
    const some = chooseDetailDates(
      "2026-11-16",
      new Set(["2026-11-13", "2026-11-12", "2026-11-16"]),
    );
    expect(some).toContain("2026-11-16");
    expect(some).not.toContain("2026-11-13");
    expect(some).not.toContain("2026-11-12");
    // fully stored: only the recent days remain
    const all = new Set(
      Array.from({ length: 28 }, (_, i) =>
        new Date(Date.parse("2026-11-16T00:00:00Z") - i * 86_400_000)
          .toISOString()
          .slice(0, 10),
      ),
    );
    expect(chooseDetailDates("2026-11-16", all)).toHaveLength(3);
  });
});

describe("review fixes (22.11.2026)", () => {
  it("reads steps, step goal, distance and floors from the movement block", () => {
    // Key shape of the first real answers; the numbers are invented.
    const values = summaryExtras({
      calendarDate: "2026-11-21",
      movement: {
        steps: { value: 8_123, goal: 7_500, distanceInMeters: 6_210.4 },
        floorsAscended: { value: 12.4, goal: 10, distanceInMeters: 37.8 },
        floorsDescended: { value: 11, distanceInMeters: 33.1 },
        pushes: {},
      },
      pulseOx: { avgAltitudeInMeters: 1231 },
    });
    expect(values).toMatchObject({
      steps: 8_123,
      step_goal: 7_500,
      distance_m: 6_210,
      floors_climbed: 12,
    });
    // Blood oxygen not measured: unknown, not 0.
    expect(values.spo2_avg_pct ?? null).toBeNull();
    // Assumed after the respiration block, once the watch measures it.
    expect(
      summaryExtras({ pulseOx: { avgValue: 96, minValue: 90 } }),
    ).toMatchObject({ spo2_avg_pct: 96, spo2_min_pct: 90 });
  });

  it("does not keep Garmin's identifiers of the person and the watch", () => {
    expect(
      rawPayload({
        userProfilePK: 123,
        userProfilePk: 123,
        uuid: "u",
        sleepNeed: { deviceId: 9, actual: 480 },
        calendarDate: "2026-11-21",
      }),
    ).toEqual({ sleepNeed: { actual: 480 }, calendarDate: "2026-11-21" });
  });

  it("notes a single-day endpoint without anything for the day, not a refused one", async () => {
    const result = await fetchDay(
      fakeGarmin({
        fitnessAge: () => new Response(null, { status: 204 }),
        readiness: () => json([]),
        spo2: () => new Response("", { status: 404 }),
      }),
    );
    const byEndpoint = new Map(
      (result.raw ?? []).map((r) => [r.endpoint, r.payload]),
    );
    expect(byEndpoint.get("fitness_age")).toEqual(EMPTY_ANSWER);
    expect(byEndpoint.get("training_readiness")).toEqual(EMPTY_ANSWER);
    expect(byEndpoint.has("spo2_acclimation")).toBe(false);
    expect(byEndpoint.get("daily_sleep")).not.toEqual(EMPTY_ANSWER);
  });

  it("reads the stored answers again into the same days as the fetch", async () => {
    const result = await fetchDay(fakeGarmin());
    expect(result.days.length).toBeGreaterThan(0);
    expect(readStoredAnswers(result.raw ?? [])).toEqual(result.days);
    // Empty markers, unknown endpoints and nothing known give no day.
    expect(
      readStoredAnswers([
        { local_date: DAY, endpoint: "fitness_age", payload: EMPTY_ANSWER },
        { local_date: DAY, endpoint: "unknown_one", payload: { steps: 5 } },
      ]),
    ).toEqual([]);
  });

  it("names its single-day endpoints for the backfill", () => {
    expect(source(fakeGarmin().fetch).detailEndpoints).toEqual([
      "daily_sleep",
      "spo2_acclimation",
      "fitness_age",
      "training_readiness",
      "training_status",
    ]);
  });
});
