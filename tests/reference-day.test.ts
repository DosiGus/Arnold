/**
 * UX-016: "today" of the overview comes from the user's calendar, not from
 * the UTC cut of the server clock. Synthetic data only.
 */
import { describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport } from "@modelcontextprotocol/server";
import { createArnoldMcpServer } from "../src/server/mcp-arnold.js";
import { createFixtureLogging } from "../src/server/workout/fixture.js";
import { demoHistoryDataset } from "../src/server/plan/demo-history.js";
import { isTimeZone, referenceDay } from "../src/server/reference-day.js";
import { ArnoldDashboardViewSchema } from "../src/shared/arnold-view.js";
import { asCard } from "./fixtures/card-view";
import type { CallToolResult } from "@modelcontextprotocol/client";

describe("referenceDay", () => {
  const cases: [string, string, string][] = [
    // instant (UTC), zone, local calendar day
    ["2026-11-17T22:30:00Z", "Europe/Berlin", "2026-11-17"], // 23:30 local
    ["2026-11-17T23:30:00Z", "Europe/Berlin", "2026-11-18"], // 00:30 local
    ["2026-07-17T22:30:00Z", "Europe/Berlin", "2026-07-18"], // summer time: 00:30
    ["2026-11-17T10:00:00Z", "Pacific/Kiritimati", "2026-11-18"], // UTC+14
    ["2026-11-17T09:59:00Z", "Pacific/Kiritimati", "2026-11-17"],
    ["2026-11-18T05:00:00Z", "Pacific/Pago_Pago", "2026-11-17"], // UTC-11
    ["2026-11-18T11:00:00Z", "Pacific/Pago_Pago", "2026-11-18"],
    ["2026-11-17T23:30:00Z", "UTC", "2026-11-17"],
  ];
  it.each(cases)("%s in %s is %s", (iso, zone, day) => {
    expect(referenceDay(new Date(iso), zone)).toEqual({
      date: day,
      timezone: zone,
      source: "timezone",
      recap_until: day,
    });
  });

  it("falls back to the UTC day and lets the recap look one day ahead", () => {
    const now = new Date("2026-11-17T23:30:00Z");
    for (const zone of [undefined, null, "", "Nowhere/Land"])
      expect(referenceDay(now, zone)).toEqual({
        date: "2026-11-17",
        timezone: null,
        source: "fallback",
        recap_until: "2026-11-18",
      });
  });

  it("knows IANA zones only", () => {
    expect(isTimeZone("Europe/Berlin")).toBe(true);
    expect(isTimeZone("Nowhere/Land")).toBe(false);
    expect(isTimeZone("x".repeat(65))).toBe(false);
  });
});

/** A synthetic history whose newest workout is on `day`. */
function datasetWithWorkoutOn(day: string) {
  const dataset = demoHistoryDataset(day);
  const newest = dataset.workouts
    .filter((w) => w.status === "completed")
    .sort((a, b) => (a.workout_date_local < b.workout_date_local ? -1 : 1))
    .at(-1)!;
  return {
    ...dataset,
    workouts: dataset.workouts.map((w) =>
      w.workout_id === newest.workout_id
        ? { ...w, workout_date_local: day }
        : w,
    ),
  };
}

async function open(
  instant: string,
  tool: string,
  args: Record<string, unknown>,
) {
  const runtime = createFixtureLogging(datasetWithWorkoutOn("2026-11-18"));
  const server = createArnoldMcpServer(
    runtime.source,
    "dist/views/dashboard/dashboard.html",
    () => new Date(instant),
    runtime.service,
  );
  const [a, b] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "reference-day", version: "1.0.0" });
  await Promise.all([server.connect(b), client.connect(a)]);
  try {
    const result = asCard(
      (await client.callTool({
        name: tool,
        arguments: args,
      })) as CallToolResult,
    );
    if (result.isError) throw new Error("tool error");
    return ArnoldDashboardViewSchema.parse(result.structuredContent);
  } finally {
    await client.close();
    await server.close();
  }
}

describe.each(["show_arnold_dashboard", "get_arnold_dashboard"])(
  "%s just after local midnight",
  (tool) => {
    // UTC is still 17 November; in Berlin and Kiritimati it is the 18th.
    const instant = "2026-11-17T23:30:00Z";

    it("shows the recap of a workout from today (local) although UTC is yesterday", async () => {
      for (const timezone of ["Europe/Berlin", "Pacific/Kiritimati"]) {
        const view = await open(instant, tool, { timezone });
        expect(view.reference).toEqual({
          date: "2026-11-18",
          timezone,
          source: "timezone",
        });
        expect(view.recap).not.toBeNull();
      }
    });

    it("does not show a workout of tomorrow where it is still the day before", async () => {
      const view = await open(instant, tool, { timezone: "Pacific/Pago_Pago" });
      expect(view.reference?.date).toBe("2026-11-17");
      expect(view.recap?.date).not.toBe("2026-11-18");
    });

    it("without a zone hides no real workout and marks no day as today", async () => {
      const view = await open(instant, tool, {});
      expect(view.reference).toEqual({
        date: "2026-11-17",
        timezone: null,
        source: "fallback",
      });
      expect(view.recap).not.toBeNull();
    });

    it("refuses an unknown zone", async () => {
      await expect(
        open(instant, tool, { timezone: "Nowhere/Land" }),
      ).rejects.toThrow();
    });
  },
);
