/**
 * The invented history around midnight UTC (DATE-001).
 *
 * Berlin is ahead of UTC, so for an hour the user's day ("today") is already
 * the next one while the UTC day is not. The history has a body weight and a
 * workout on every Monday; those of today must never carry a timestamp later
 * than the clock, or a second weight on the same day (it replaces the first)
 * fails with "updated_at_utc liegt vor created_at_utc".
 */
import { afterEach, describe, expect, it } from "vitest";
import {
  Client,
  StreamableHTTPClientTransport,
  type CallToolResult,
} from "@modelcontextprotocol/client";
import type { Server } from "node:http";
import { createHttpApp } from "../src/server/http";
import { createFixturePlanning } from "../src/server/plan/fixture";
import { demoHistoryDataset } from "../src/server/plan/demo-history";
import { WriteResponseSchema } from "../src/shared/workout-contract";
import { berlinToday } from "./fixtures/berlin-today";
import { asCard } from "./fixtures/card-view";

// 23 Nov 2026 is a Monday: the day with a weight and a legs workout.
const CLOCKS = [
  "2026-11-22T23:30:00Z", // Berlin: 00:30 on the 23rd, UTC still the 22nd
  "2026-11-23T00:30:00Z", // Berlin: 01:30, UTC the 23rd as well
  "2026-11-23T06:59:00Z", // just before the 07:00 UTC stamp
  "2026-11-23T12:00:00Z",
  "2026-11-23T21:00:00Z", // after every fixed stamp: nothing is clamped
];

describe.each(CLOCKS)("clock at %s", (instant) => {
  const now = new Date(instant);
  const today = berlinToday(now);
  const data = demoHistoryDataset(today, now);
  let http: Server | undefined;
  let client: Client | undefined;
  afterEach(async () => {
    await client?.close();
    const server = http;
    if (server)
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
      });
    client = undefined;
    http = undefined;
  });

  it("stamps nothing later than the clock and keeps the order of its rows", () => {
    expect(today).toBe("2026-11-23");
    const stamps = [
      ...data.workouts.flatMap((w) => [
        w.started_at_utc,
        w.ended_at_utc,
        w.created_at_utc,
        w.updated_at_utc,
      ]),
      ...data.sets.flatMap((s) => [s.created_at_utc, s.updated_at_utc]),
      ...data.bodyWeights.flatMap((b) => [b.created_at_utc, b.updated_at_utc]),
      ...data.goals.flatMap((g) => [g.created_at_utc, g.updated_at_utc]),
    ].filter((s): s is string => typeof s === "string");
    // The base fixture's own rows are dated in the past; only the history
    // reaches "today".
    for (const stamp of stamps) expect(stamp <= now.toISOString()).toBe(true);
    for (const w of data.workouts)
      if (w.started_at_utc && w.ended_at_utc)
        expect(w.ended_at_utc >= w.started_at_utc).toBe(true);
    expect(data.bodyWeights.some((b) => b.measured_on === today)).toBe(true);
  });

  it("replaces today's body weight with a new one and shows it as the latest", async () => {
    const runtime = createFixturePlanning(data, { clock: () => now });
    http = createHttpApp({ workoutRuntime: runtime }).listen(0, "127.0.0.1");
    await new Promise<void>((resolve, reject) => {
      http!.once("listening", resolve);
      http!.once("error", reject);
    });
    client = new Client({ name: "synthetic-midnight-tests", version: "1" });
    await client.connect(
      new StreamableHTTPClientTransport(
        new URL(
          `http://127.0.0.1:${(http.address() as { port: number }).port}/mcp`,
        ),
      ),
    );
    const result = asCard(
      (await client.callTool({
        name: "log_body_weight",
        arguments: {
          request_id: "midnight-1",
          measured_on: today,
          timezone: "Europe/Berlin",
          weight_kg: 81.3,
        },
      })) as CallToolResult,
    );
    const response = WriteResponseSchema.parse(result.structuredContent);
    expect(response.error).toBeNull();
    expect(response.ok).toBe(true);
    const view = asCard(
      (await client.callTool({
        name: "get_arnold_dashboard",
        arguments: { timezone: "Europe/Berlin" },
      })) as CallToolResult,
    );
    const home = (view.structuredContent as { home: Record<string, unknown> })
      .home;
    expect(home.latest_body_weight).toEqual({ date: today, weight_kg: 81.3 });
  });
});
