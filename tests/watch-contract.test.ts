import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import * as contract from "../src/shared/watch-contract.js";
const env = { api_version: 1, min_app_version: "1.0.0" };
const fixture = (name: string) =>
  JSON.parse(
    readFileSync(
      new URL(`./fixtures/watch/${name}.json`, import.meta.url),
      "utf8",
    ),
  );
const uuid = "00000000-0000-4000-8000-000000000001";
const at = "2026-11-09T17:02:11Z";
const workout = {
  request_id: `gw_${uuid}`,
  session_uuid: uuid,
  plan_version_id: `plv_${uuid}`,
  session_id: `s_${uuid}`,
  workout_date_local: "2026-11-09",
  utc_offset_min: 60,
  started_at_utc: at,
  ended_at_utc: "2026-11-09T18:00:00Z",
  exercises: [
    {
      exercise_id: `exc_${uuid}`,
      sets: [
        {
          reps: 8,
          load_g: 62500,
          side: "both",
          t0: 1794243731,
          t1: 1794243771,
        },
      ],
    },
  ],
};
const roundtrip = (schema: z.ZodType, value: unknown) => {
  const parsed = schema.parse(value);
  expect(schema.parse(JSON.parse(JSON.stringify(parsed)))).toEqual(value);
};
describe("watch v1 wire contract (GAR-B1-01, D-22)", () => {
  it.each([
    [
      "directory",
      contract.WatchPlanDirectorySchema,
      contract.WATCH_PLAN_BUDGET_BYTES.directory,
    ],
    [
      "typical-day",
      contract.WatchPlanSessionSchema,
      contract.WATCH_PLAN_BUDGET_BYTES.typical,
    ],
    [
      "extreme-day",
      contract.WatchPlanSessionSchema,
      contract.WATCH_PLAN_BUDGET_BYTES.extreme,
    ],
  ] as const)(
    "roundtrips %s within its UTF-8 budget with UUIDs and umlauts",
    (name, schema, budget) => {
      const data = fixture(name);
      roundtrip(schema, data);
      expect(
        Buffer.byteLength(JSON.stringify(data), "utf8"),
      ).toBeLessThanOrEqual(budget);
      expect(JSON.stringify(data)).toMatch(/[ÄÖÜäöü]/);
      const ids: string[] =
        data.cat?.map((e: { id: string }) => e.id) ??
        data.days.map((d: { id: string }) => d.id);
      ids.forEach((id) => expect(id).toMatch(/_[0-9a-f-]{36}$/));
    },
  );
  it("contains the exact required size scenarios", () => {
    const normal = fixture("typical-day"),
      extreme = fixture("extreme-day");
    expect(fixture("directory").days).toHaveLength(7);
    expect(normal.items).toHaveLength(6);
    normal.items.forEach((i: { c: number; a: number[] }) => {
      expect(i.a).toHaveLength(1);
      expect(normal.cat[i.c].s).toEqual([[4, 8, 60000]]);
    });
    expect(extreme.items).toHaveLength(8);
    extreme.items.forEach(
      (i: { c: number; a: number[]; h: string; l: string; n: string }) => {
        expect(i.a).toHaveLength(3);
        expect(extreme.cat[i.c].s).toHaveLength(5);
        for (const t of [i.h, i.l, i.n]) expect(t).toHaveLength(60);
      },
    );
  });
  it("roundtrips pairing, device and mutation replies", () => {
    roundtrip(contract.WatchPairStartRequestSchema, {
      device_label: "Forerunner 255",
      part_number: "006-B3990-00",
      app_version: "1.0.0",
    });
    roundtrip(contract.WatchPairStartResponseSchema, {
      ...env,
      device_code: "a".repeat(43),
      user_code: "K7Q4-M2XP",
      expires_in: 600,
      interval: 5,
    });
    roundtrip(contract.WatchPairTokenRequestSchema, {
      device_code: "a".repeat(43),
    });
    for (const status of ["pending", "slow_down", "expired"])
      roundtrip(contract.WatchPairTokenResponseSchema, { ...env, status });
    roundtrip(contract.WatchPairTokenResponseSchema, {
      ...env,
      access_token: `arn_w_${"a".repeat(43)}`,
      device_id: `wdv_${uuid}`,
      account_label: "Demo",
    });
    roundtrip(contract.WatchDeviceResponseSchema, {
      ...env,
      device_id: `wdv_${uuid}`,
      paired: true,
      health_consent: false,
      server_time_utc: at,
    });
    roundtrip(contract.WatchDeviceDeleteResponseSchema, {
      ...env,
      unpaired: true,
    });
    roundtrip(contract.WatchWorkoutRequestSchema, workout);
    roundtrip(contract.WatchWorkoutResponseSchema, {
      ...env,
      workout_id: `wkt_${uuid}`,
      replayed: true,
      summary: { records: [], next: [] },
    });
    roundtrip(contract.WatchHealthResponseSchema, {
      ...env,
      session_uuid: uuid,
      stored: true,
    });
    for (const code of contract.WatchErrorCodeSchema.options)
      roundtrip(contract.WatchErrorSchema, {
        ...env,
        error: { code, retryable: false, message: "Bitte erneut versuchen." },
      });
  });
  it("preserves missing load and heart rate gaps, and limits recent exercises", () => {
    roundtrip(contract.WatchSetRunSchema, [4, null, null]);
    roundtrip(contract.WatchHealthRequestSchema, {
      hr: { interval_s: 5, start_utc: at, values: [92, 0, 118] },
      before: { at_utc: at, body_battery: null },
    });
    const recent = { ...env, cat: fixture("extreme-day").cat.slice(0, 10) };
    roundtrip(contract.WatchPlanRecentSchema, recent);
    expect(Buffer.byteLength(JSON.stringify(recent))).toBeLessThanOrEqual(
      contract.WATCH_PLAN_BUDGET_BYTES.recent,
    );
    expect(
      contract.WatchPlanRecentSchema.safeParse({
        ...recent,
        cat: [...recent.cat, recent.cat[0]],
      }).success,
    ).toBe(false);
  });
  it("rejects invalid indices, ambiguous runs, fractional grams, reversed times and caller identity", () => {
    const day = fixture("typical-day");
    expect(
      contract.WatchPlanSessionSchema.safeParse({
        ...day,
        items: [{ ...day.items[0], c: day.cat.length }],
      }).success,
    ).toBe(false);
    for (const run of [
      [0, 8, 60000],
      [1, 8, 60000.5],
      [1, 8, 60000, "both", "left"],
    ])
      expect(contract.WatchSetRunSchema.safeParse(run).success).toBe(false);
    for (const patch of [
      { source: "sync" },
      { user_id: "usr_other" },
      { utc_offset_min: 60.5 },
      { ended_at_utc: "2026-11-08T00:00:00Z" },
    ])
      expect(
        contract.WatchWorkoutRequestSchema.safeParse({ ...workout, ...patch })
          .success,
      ).toBe(false);
    expect(
      contract.WatchWorkoutRequestSchema.safeParse({
        ...workout,
        exercises: [{ plan_item_id: "pli_1", skip: true, sets: [] }],
      }).success,
    ).toBe(false);
  });
});
