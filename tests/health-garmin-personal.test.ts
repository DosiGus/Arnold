/**
 * Supplier "persönlicher Schlüssel" against invented Garmin answers only:
 * success, empty, errors, expired key, rate limit, token reuse, and that the
 * key and the token never reach a result, an error or a log line.
 */
import { inspect } from "node:util";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  chunks,
  GarminPersonalSource,
  readSleep,
} from "../src/server/health/garmin-personal";
import {
  dailyHealthStartMessage,
  describeDailyHealthConfig,
  loadDailyHealthConfig,
} from "../src/server/health/config";

const KEY = "invented-test-key-7f3a91c2";
const jwt = (expSeconds: number) =>
  [
    "eyJhbGciOiJub25lIn0",
    Buffer.from(JSON.stringify({ exp: expSeconds })).toString("base64url"),
    "sig",
  ].join(".");
const NOW = Date.parse("2026-11-16T08:00:00Z");
const TOKEN = jwt(NOW / 1000 + 24 * 3600);

const SUMMARIES = {
  data: [
    {
      calendarDate: "2026-11-14",
      heartRate: { restingValue: 52, minValue: 48 },
      stress: { avgLevel: 31, maxLevel: 90 },
      bodyBattery: { maxValue: 88, minValue: 20, endOfDayValue: 34 },
    },
    {
      calendarDate: "2026-11-15",
      heartRate: {},
      stress: { avgLevel: -1 },
      bodyBattery: null,
    },
  ],
};
const SLEEP = [
  {
    calendarDate: "2026-11-15",
    sleepTimeSeconds: 26_100,
    sleepScores: { overall: { value: 81, qualifierKey: "GOOD" } },
  },
];
const HRV = {
  hrvSummaries: [
    { calendarDate: "2026-11-15", lastNightAvg: 44, status: "BALANCED" },
  ],
};

type Route = (url: URL, init: RequestInit) => Response;
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status });

function fakeGarmin(overrides: Partial<Record<string, Route>> = {}) {
  const calls: { url: string; auth: string }[] = [];
  const routes: Record<string, Route> = {
    token: () => new Response(TOKEN, { status: 200 }),
    summaries: () => json(SUMMARIES),
    sleep: () => json(SLEEP),
    hrv: () => json(HRV),
    ...overrides,
  };
  const fetch = vi.fn(async (raw: string, init: RequestInit) => {
    const url = new URL(raw);
    const auth = (init.headers as Record<string, string>).Authorization;
    calls.push({ url: raw, auth });
    if (url.pathname.includes("personal-api-key/token"))
      return routes.token(url, init);
    if (url.pathname.includes("dailysummaries"))
      return routes.summaries(url, init);
    if (url.pathname.includes("dailySleepSummariesByDate"))
      return routes.sleep(url, init);
    if (url.pathname.startsWith("/hrv-service/")) return routes.hrv(url, init);
    return new Response("", { status: 404 });
  });
  return { fetch, calls };
}

const source = (
  fetch: ReturnType<typeof fakeGarmin>["fetch"],
  now = () => NOW,
) => new GarminPersonalSource({ apiKey: KEY, fetch, now });

afterEach(() => vi.restoreAllMocks());

describe("GarminPersonalSource", () => {
  it("merges the three answers into days, unknown as null, never 0", async () => {
    const garmin = fakeGarmin();
    const result = await source(garmin.fetch).fetchDays(
      "2026-11-14",
      "2026-11-15",
    );
    expect(result).toMatchObject({
      ok: true,
      days: [
        {
          local_date: "2026-11-14",
          resting_hr_bpm: 52,
          stress_avg: 31,
          body_battery_high: 88,
          body_battery_end_of_day: 34,
          sleep_seconds: null,
          sleep_score: null,
          hrv_last_night_ms: null,
          hrv_status: null,
        },
        {
          local_date: "2026-11-15",
          resting_hr_bpm: null,
          stress_avg: null,
          body_battery_high: null,
          body_battery_end_of_day: null,
          sleep_seconds: 26_100,
          sleep_score: 81,
          hrv_last_night_ms: 44,
          hrv_status: "balanced",
        },
      ],
    });
    // Key only at the token endpoint, bearer token everywhere else.
    expect(garmin.calls[0].auth).toBe(`ApiKey ${KEY}`);
    for (const call of garmin.calls.slice(1)) {
      expect(call.auth).toBe(`Bearer ${TOKEN}`);
      expect(call.url).not.toContain(KEY);
    }
  });

  it("reports an empty answer as ok with no days (204, empty body, no data)", async () => {
    const garmin = fakeGarmin({
      summaries: () => json({ data: [] }),
      sleep: () => new Response("", { status: 200 }),
      hrv: () => new Response(null, { status: 204 }),
    });
    expect(
      await source(garmin.fetch).fetchDays("2026-11-14", "2026-11-15"),
    ).toMatchObject({ ok: true, days: [], raw: [] });
  });

  it("names a refused key as key_expired", async () => {
    for (const status of [401, 403]) {
      const garmin = fakeGarmin({
        token: () => new Response("key expired: invented detail", { status }),
      });
      expect(
        await source(garmin.fetch).fetchDays("2026-11-14", "2026-11-15"),
      ).toEqual({ ok: false, failure: "key_expired" });
    }
  });

  it("names rate limiting, server errors, broken answers and network failures", async () => {
    const cases: [Partial<Record<string, Route>>, string][] = [
      [{ token: () => new Response("", { status: 429 }) }, "rate_limited"],
      [{ summaries: () => new Response("", { status: 429 }) }, "rate_limited"],
      [
        { sleep: () => new Response("oops", { status: 500 }) },
        "upstream_error",
      ],
      [
        { hrv: () => new Response("{not json", { status: 200 }) },
        "upstream_error",
      ],
      [{ token: () => new Response("   ", { status: 200 }) }, "upstream_error"],
      [
        {
          summaries: () => {
            throw new TypeError(`fetch failed for ${KEY}`);
          },
        },
        "network_error",
      ],
    ];
    for (const [routes, failure] of cases) {
      const garmin = fakeGarmin(routes);
      expect(
        await source(garmin.fetch).fetchDays("2026-11-14", "2026-11-15"),
      ).toEqual({ ok: false, failure });
    }
  });

  it("renews the token once after a 401 on data, then calls it key_invalid", async () => {
    let tokens = 0;
    const garmin = fakeGarmin({
      token: () => {
        tokens++;
        return new Response(TOKEN, { status: 200 });
      },
      summaries: () => new Response("", { status: 401 }),
    });
    expect(
      await source(garmin.fetch).fetchDays("2026-11-14", "2026-11-15"),
    ).toEqual({ ok: false, failure: "key_invalid" });
    expect(tokens).toBe(2);
  });

  it("keeps the token in memory until shortly before it expires", async () => {
    let tokens = 0;
    let now = NOW;
    const garmin = fakeGarmin({
      token: () => {
        tokens++;
        return new Response(jwt(now / 1000 + 24 * 3600), { status: 200 });
      },
    });
    const supplier = source(garmin.fetch, () => now);
    await supplier.fetchDays("2026-11-15", "2026-11-15");
    now += 6 * 3600_000;
    await supplier.fetchDays("2026-11-15", "2026-11-15");
    expect(tokens).toBe(1);
    now += 18 * 3600_000; // within the last hour of the 24 h token
    await supplier.fetchDays("2026-11-15", "2026-11-15");
    expect(tokens).toBe(2);
  });

  it("splits long ranges: sleep in 31-day, HRV in 28-day pieces", async () => {
    const garmin = fakeGarmin();
    await source(garmin.fetch).fetchDays("2026-10-13", "2026-11-16");
    const sleep = garmin.calls.filter((c) => c.url.includes("dailySleep"));
    const hrv = garmin.calls.filter((c) => c.url.includes("/hrv-service/"));
    expect(sleep).toHaveLength(2);
    expect(hrv).toHaveLength(2);
    expect(chunks("2026-10-13", "2026-11-16", 31)).toEqual([
      ["2026-10-13", "2026-11-12"],
      ["2026-11-13", "2026-11-16"],
    ]);
  });

  it("reads an unknown sleep score shape as null, not as an error", () => {
    expect(
      readSleep([
        { calendarDate: "2026-11-15", sleepScores: { total: { value: 70 } } },
        { calendarDate: "2026-11-16", sleepScores: "n/a" },
      ]).map((d) => d.values.sleep_score),
    ).toEqual([undefined, undefined]);
  });
});

describe("the key stays secret", () => {
  it("never appears in results, failures, the object or log output", async () => {
    const logged: string[] = [];
    for (const method of ["log", "info", "warn", "error", "debug"] as const)
      vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
        logged.push(args.map(String).join(" "));
      });
    const outputs: unknown[] = [];
    for (const routes of [
      {},
      { token: () => new Response(`denied ${KEY}`, { status: 401 }) },
      { summaries: () => new Response(`echo ${KEY}`, { status: 500 }) },
      {
        sleep: () => {
          throw new Error(`socket closed ${KEY}`);
        },
      },
    ] as Partial<Record<string, Route>>[]) {
      const supplier = source(fakeGarmin(routes).fetch);
      outputs.push(await supplier.fetchDays("2026-11-14", "2026-11-15"));
      outputs.push(JSON.stringify(supplier), inspect(supplier, { depth: 5 }));
    }
    const config = loadDailyHealthConfig({
      GARMIN_DAILY_SOURCE: "personal",
      GARMIN_PERSONAL_API_KEY: KEY,
      GARMIN_DAILY_USER_ID: "usr_00000000-0000-4000-8000-000000000001",
    });
    outputs.push(
      describeDailyHealthConfig(config),
      dailyHealthStartMessage(config),
    );
    const text = [...outputs.map((o) => JSON.stringify(o)), ...logged].join(
      "\n",
    );
    expect(text).not.toContain(KEY);
    expect(text).not.toContain(TOKEN);
  });
});

describe("configuration", () => {
  const USER = "usr_00000000-0000-4000-8000-000000000001";
  it("is off unless switched on, and fails closed when incomplete", () => {
    expect(loadDailyHealthConfig({})).toEqual({ state: "off" });
    expect(loadDailyHealthConfig({ GARMIN_DAILY_SOURCE: "off" })).toEqual({
      state: "off",
    });
    const reason = (env: NodeJS.ProcessEnv) => {
      const c = loadDailyHealthConfig({
        GARMIN_DAILY_SOURCE: "personal",
        ...env,
      });
      return c.state === "unavailable" ? c.reason : c.state;
    };
    expect(reason({ GARMIN_DAILY_USER_ID: USER })).toBe("missing_key");
    expect(reason({ GARMIN_PERSONAL_API_KEY: KEY })).toBe("missing_user");
    expect(
      reason({ GARMIN_PERSONAL_API_KEY: KEY, GARMIN_DAILY_USER_ID: "kevin" }),
    ).toBe("invalid_user");
    expect(
      reason({
        GARMIN_PERSONAL_API_KEY: KEY,
        GARMIN_DAILY_USER_ID: USER,
        GARMIN_DAILY_REFRESH_HOURS: "0",
      }),
    ).toBe("invalid_refresh_hours");
    expect(reason({ GARMIN_DAILY_SOURCE: "starter" })).toBe("invalid_source");
    expect(
      loadDailyHealthConfig({
        GARMIN_DAILY_SOURCE: "personal",
        GARMIN_PERSONAL_API_KEY: KEY,
        GARMIN_DAILY_USER_ID: USER,
      }),
    ).toMatchObject({ state: "active", userId: USER, refreshHours: 6 });
    expect(
      dailyHealthStartMessage(
        loadDailyHealthConfig({ GARMIN_DAILY_SOURCE: "personal" }),
      ),
    ).toMatch(/AUS.*GARMIN_PERSONAL_API_KEY fehlt/);
  });
});
