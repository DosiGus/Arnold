/**
 * B17: show_arnold_dashboard opens a card directly on one exercise or one
 * workout. Every id is checked against the caller's own data.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  Client,
  StreamableHTTPClientTransport,
  type CallToolResult,
} from "@modelcontextprotocol/client";
import type { Server } from "node:http";
import { createHttpApp } from "../src/server/http";
import { ArnoldDashboardViewSchema } from "../src/shared/arnold-view";
import { asCard } from "./fixtures/card-view";

let http: Server;
let client: Client;
let exerciseId: string;
let workoutId: string;

const call = async (args: Record<string, unknown>) =>
  asCard(
    (await client.callTool({
      name: "show_arnold_dashboard",
      arguments: args,
    })) as CallToolResult,
  );
const meta = (result: CallToolResult) =>
  (result._meta as { arnold?: Record<string, unknown> })?.arnold;

beforeAll(async () => {
  http = createHttpApp({ env: {} }).listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => http.once("listening", resolve));
  client = new Client({ name: "focus", version: "1" });
  await client.connect(
    new StreamableHTTPClientTransport(
      new URL(
        `http://127.0.0.1:${(http.address() as { port: number }).port}/mcp`,
      ),
    ),
  );
  const dashboard = ArnoldDashboardViewSchema.parse(
    asCard(
      (await client.callTool({
        name: "get_arnold_dashboard",
        arguments: {},
      })) as CallToolResult,
    ).structuredContent,
  );
  exerciseId = dashboard.exercises[0].exercise_id;
  workoutId = dashboard.recent_workouts[0].workout_id;
});
afterAll(async () => {
  await client?.close();
  await new Promise<void>((resolve) => {
    http?.close(() => resolve());
    http?.closeAllConnections();
  });
});

describe("show_arnold_dashboard focus", () => {
  it("opens progress on one exercise and metric", async () => {
    const result = await call({
      card: "progress",
      exercise_id: exerciseId,
      metric: "estimated_1rm",
    });
    expect(result.isError).toBeFalsy();
    const view = ArnoldDashboardViewSchema.parse(result.structuredContent);
    expect(view.focus).toEqual({
      card: "progress",
      exercise_id: exerciseId,
      metric: "estimated_1rm",
      workout_id: null,
    });
  });

  it("opens history on one workout", async () => {
    const result = await call({ card: "history", workout_id: workoutId });
    expect(result.isError).toBeFalsy();
    expect(
      ArnoldDashboardViewSchema.parse(result.structuredContent).focus,
    ).toMatchObject({ card: "history", workout_id: workoutId });
  });

  it("keeps the plain overview without focus", async () => {
    const view = ArnoldDashboardViewSchema.parse(
      (await call({})).structuredContent,
    );
    expect(view.focus).toBeUndefined();
  });

  it("refuses unknown ids with a clear error and no data", async () => {
    for (const [args, code] of [
      [
        { card: "progress", exercise_id: "fremde-uebung" },
        "EXERCISE_NOT_FOUND",
      ],
      [
        { card: "history", workout_id: "fremdes-training" },
        "WORKOUT_NOT_FOUND",
      ],
    ] as const) {
      const result = await call(args);
      expect(result.isError, code).toBe(true);
      expect(result.structuredContent).toBeUndefined();
      expect(meta(result)).toEqual({
        code,
        retryable: false,
        recovery: "reload_then_retry",
      });
    }
  });

  it("refuses focus arguments on the wrong card", async () => {
    for (const args of [
      { card: "week", exercise_id: exerciseId },
      { exercise_id: exerciseId },
      { card: "today", metric: "max_load" },
      { card: "progress", workout_id: workoutId },
    ]) {
      const result = await call(args);
      expect(result.isError, JSON.stringify(args)).toBe(true);
      expect(meta(result)).toMatchObject({
        code: "VALIDATION_ERROR",
        recovery: "none",
      });
    }
  });

  it("rejects an unknown metric through the schema", async () => {
    const result = await call({
      card: "progress",
      exercise_id: exerciseId,
      metric: "bizeps_umfang",
    }).catch(() => ({ isError: true }) as CallToolResult);
    expect(result.isError).toBe(true);
  });
});
