import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  Client,
  StreamableHTTPClientTransport,
  type CallToolResult,
} from "@modelcontextprotocol/client";
import { RESOURCE_MIME_TYPE } from "@modelcontextprotocol/ext-apps/server";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { request, type Server } from "node:http";
import { createHttpApp } from "../src/server/http";
import { JsonStorageAdapter } from "../src/server/storage";
import { RESOURCE_URI } from "../src/server/mcp";
import {
  DashboardSchema,
  LogOutputSchema,
  ProgressOutputSchema,
  ResetOutputSchema,
  WorkoutsOutputSchema,
} from "../src/shared/schemas";

let client: Client;
let http: Server;
let directory: string;
let base: string;
const call = (name: string, args = {}) =>
  client.callTool({ name, arguments: args }) as Promise<CallToolResult>;
beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), "arnold-mcp-"));
  http = createHttpApp({
    storage: new JsonStorageAdapter(join(directory, "demo.json")),
  }).listen(0, "127.0.0.1");
  await new Promise<void>((resolve, reject) => {
    http.once("listening", resolve);
    http.once("error", reject);
  });
  base = `http://127.0.0.1:${(http.address() as { port: number }).port}`;
  client = new Client({ name: "arnold-integration-tests", version: "1.0.0" });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(`${base}/mcp`)),
  );
});
afterAll(async () => {
  await client?.close();
  await new Promise<void>((resolve) => {
    http?.close(() => resolve());
    http?.closeAllConnections();
  });
  await rm(directory, { recursive: true, force: true });
});

describe("real Streamable HTTP MCP integration", () => {
  it("initializes and advertises all six tools with input/output schemas", async () => {
    expect(client.getServerVersion()?.name).toBe("arnold");
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([
      "get_dashboard_data",
      "get_exercise_progress",
      "get_workouts",
      "log_demo_set",
      "reset_demo_data",
      "show_arnold_dashboard",
    ]);
    tools.forEach((tool) => {
      expect(tool.inputSchema.type).toBe("object");
      expect(tool.outputSchema?.type).toBe("object");
      expect(tool.description).toBeTruthy();
    });
    expect(
      tools.find((t) => t.name === "show_arnold_dashboard")?._meta?.ui,
    ).toMatchObject({ resourceUri: RESOURCE_URI });
    expect(
      tools.find((t) => t.name === "reset_demo_data")?.annotations
        ?.destructiveHint,
    ).toBe(true);
  });
  it("registers and returns a self-contained MCP Apps resource", async () => {
    expect(
      (await client.listResources()).resources.map((r) => r.uri),
    ).toContain(RESOURCE_URI);
    const resource = (await client.readResource({ uri: RESOURCE_URI }))
      .contents[0];
    expect(resource.mimeType).toBe(RESOURCE_MIME_TYPE);
    expect("text" in resource && resource.text).toContain('<div id="root">');
    expect("text" in resource && resource.text).not.toMatch(/<script[^>]*src=/);
  });
  it("opens dashboard and returns known totals", async () => {
    const result = await call("show_arnold_dashboard");
    expect(result.isError).not.toBe(true);
    expect(DashboardSchema.parse(result.structuredContent).totals.sets).toBe(
      108,
    );
    expect(
      DashboardSchema.parse(
        (await call("get_dashboard_data")).structuredContent,
      ).totals.volume,
    ).toBe(40021);
  });
  it("filters history and exercise progress through tools", async () => {
    const history = WorkoutsOutputSchema.parse(
      (await call("get_workouts", { split: "Pull", startDate: "2026-10-01" }))
        .structuredContent,
    );
    expect(history.workouts).toHaveLength(3);
    expect(history.workouts.every((w) => w.split === "Pull")).toBe(true);
    const progress = ProgressOutputSchema.parse(
      (
        await call("get_exercise_progress", {
          exerciseId: "squat",
          endDate: "2026-10-09",
        })
      ).structuredContent,
    );
    expect(progress.points.map((p) => p.maxKg)).toEqual([40, 42.5]);
  });
  it("rejects invalid values and ranges without changing stored data", async () => {
    const bad = [
      [
        "log_demo_set",
        {
          requestId: "invalid-test",
          date: "2026-10-24",
          exerciseId: "bench-press",
          kg: -10,
          reps: 10,
        },
      ],
      ["get_workouts", { split: "Upper" }],
      ["get_workouts", { startDate: "2026-10-24", endDate: "2026-09-01" }],
      ["get_exercise_progress", { exerciseId: "unknown" }],
      ["reset_demo_data", { confirmDemoReset: false }],
    ] as const;
    for (const [name, args] of bad) {
      let rejected = false;
      try {
        rejected = (await call(name, args)).isError === true;
      } catch {
        rejected = true;
      }
      expect(rejected, name).toBe(true);
    }
    expect(
      DashboardSchema.parse(
        (await call("get_dashboard_data")).structuredContent,
      ).totals.sets,
    ).toBe(108);
  });
  it("persists through stateless requests, deduplicates retries, then resets", async () => {
    const args = {
      requestId: "mcp-integration-save",
      date: "2026-10-24",
      exerciseId: "bench-press",
      kg: 60,
      reps: 10,
    };
    const first = LogOutputSchema.parse(
      (await call("log_demo_set", args)).structuredContent,
    );
    const retry = LogOutputSchema.parse(
      (await call("log_demo_set", args)).structuredContent,
    );
    expect(first.duplicate).toBe(false);
    expect(retry.duplicate).toBe(true);
    expect(retry.set.id).toBe(first.set.id);
    expect(first.dashboard.totals).toMatchObject({
      workouts: 13,
      sets: 109,
      volume: 40621,
    });
    const reset = ResetOutputSchema.parse(
      (await call("reset_demo_data", { confirmDemoReset: true }))
        .structuredContent,
    );
    expect(reset.dashboard.totals.sets).toBe(108);
  });
  it("serves health/preview/host and rejects untrusted origins and hosts", async () => {
    expect((await (await fetch(`${base}/health`)).json()).status).toBe("ok");
    expect((await fetch(`${base}/preview`)).status).toBe(200);
    expect((await fetch(`${base}/host`)).status).toBe(200);
    expect(
      (await fetch(`${base}/.well-known/oauth-authorization-server`)).status,
    ).toBe(404);
    expect(
      (
        await fetch(`${base}/mcp`, {
          method: "OPTIONS",
          headers: { Origin: "https://untrusted.example" },
        })
      ).status,
    ).toBe(403);
    // Fetch implementations may normalize Host; raw HTTP proves the server-side check.
    const badHostStatus = await new Promise<number | undefined>(
      (resolve, reject) => {
        request(
          `${base}/health`,
          { agent: false, headers: { Host: "untrusted.example" } },
          (res) => {
            res.resume();
            res.on("end", () => resolve(res.statusCode));
          },
        )
          .on("error", reject)
          .end();
      },
    );
    expect(badHostStatus).toBe(403);
  });
});

it("offers only four read tools for Google Sheets and refreshes the underlying source", async () => {
  const { GoogleSheetsStorageAdapter } =
    await import("../src/server/google-sheets-storage");
  const { config, FakeSheets } = await import("./fixtures/sheets");
  const fake = new FakeSheets();
  const local = createHttpApp({
    storage: new GoogleSheetsStorageAdapter(config, fake),
    allowedHosts: ["127.0.0.1"],
    allowedOrigins: [],
  }).listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => local.once("listening", resolve));
  const url = `http://127.0.0.1:${(local.address() as { port: number }).port}`;
  const reader = new Client({ name: "sheets-read-only-test", version: "1" });
  try {
    await reader.connect(
      new StreamableHTTPClientTransport(new URL(`${url}/mcp`)),
    );
    const { tools } = await reader.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([
      "get_dashboard_data",
      "get_exercise_progress",
      "get_workouts",
      "show_arnold_dashboard",
    ]);
    expect(tools.every((t) => t.annotations?.readOnlyHint === true)).toBe(true);
    const first = DashboardSchema.parse(
      (await reader.callTool({ name: "show_arnold_dashboard", arguments: {} }))
        .structuredContent,
    );
    expect(first).toMatchObject({
      source: "google_sheets",
      synthetic: false,
      totals: { sets: 3, volume: 780 },
    });
    fake.rows.inputRows[1][4] = 11;
    const fresh = DashboardSchema.parse(
      (await reader.callTool({ name: "get_dashboard_data", arguments: {} }))
        .structuredContent,
    );
    expect(fresh.totals.volume).toBe(800);
    const history = WorkoutsOutputSchema.parse(
      (await reader.callTool({ name: "get_workouts", arguments: {} }))
        .structuredContent,
    );
    expect(history.synthetic).toBe(false);
    const progress = ProgressOutputSchema.parse(
      (
        await reader.callTool({
          name: "get_exercise_progress",
          arguments: { exerciseId: first.exercises[0].id },
        })
      ).structuredContent,
    );
    expect(progress.synthetic).toBe(false);
    expect(
      (
        await fetch(`${url}/mcp`, {
          method: "OPTIONS",
          headers: { Origin: "https://untrusted.example" },
        })
      ).status,
    ).toBe(403);
  } finally {
    await reader.close();
    await new Promise<void>((resolve) => {
      local.close(() => resolve());
      local.closeAllConnections();
    });
  }
});
