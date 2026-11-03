/**
 * Goals and body weight over real Streamable HTTP, the way ChatGPT and the
 * card call them. Synthetic fixture data only.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  Client,
  StreamableHTTPClientTransport,
  type CallToolResult,
} from "@modelcontextprotocol/client";
import type { Server } from "node:http";
import { createHttpApp } from "../src/server/http";
import { createFixtureLogging } from "../src/server/workout/fixture";
import { WriteResponseSchema } from "../src/shared/workout-contract";
import { ArnoldDashboardViewSchema } from "../src/shared/arnold-view";
import { CONFIRMATION_RULES } from "../src/server/auth/confirmation-rules";
import { TOOL_ACCESS } from "../src/server/auth/tool-access";
import { SETUP_GATED_TOOLS } from "../src/server/onboarding/setup-gate";

const GOAL_TOOLS = [
  "create_training_goal",
  "update_training_goal",
  "archive_training_goal",
  "log_body_weight",
  "void_body_weight",
];

let client: Client, http: Server;
const call = async (name: string, args: Record<string, unknown> = {}) =>
  (await client.callTool({ name, arguments: args })) as CallToolResult;
const write = async (name: string, args: Record<string, unknown>) =>
  WriteResponseSchema.parse((await call(name, args)).structuredContent);
const dashboard = async () =>
  ArnoldDashboardViewSchema.parse(
    (await call("show_arnold_dashboard")).structuredContent,
  );

beforeEach(async () => {
  http = createHttpApp({ workoutRuntime: createFixtureLogging() }).listen(
    0,
    "127.0.0.1",
  );
  await new Promise<void>((resolve, reject) => {
    http.once("listening", resolve);
    http.once("error", reject);
  });
  client = new Client({ name: "synthetic-goal-tests", version: "1" });
  await client.connect(
    new StreamableHTTPClientTransport(
      new URL(
        `http://127.0.0.1:${(http.address() as { port: number }).port}/mcp`,
      ),
    ),
  );
});
afterEach(async () => {
  await client?.close();
  await new Promise<void>((resolve) => {
    http?.close(() => resolve());
    http?.closeAllConnections();
  });
});

describe("goal tools", () => {
  it("are registered, classified, gated until setup and carry a confirmation rule", async () => {
    const { tools } = await client.listTools();
    for (const name of GOAL_TOOLS) {
      expect(
        tools.some((t) => t.name === name),
        name,
      ).toBe(true);
      expect(TOOL_ACCESS[name], name).toBe("AUTHENTICATED_WRITE");
      expect(SETUP_GATED_TOOLS.has(name), name).toBe(true);
      expect(CONFIRMATION_RULES[name], name).toBeDefined();
    }
    expect(CONFIRMATION_RULES.archive_training_goal.rule).toBe("ask_in_chat");
    expect(CONFIRMATION_RULES.void_body_weight.rule).toBe("ask_in_chat");
  });

  it("sets a body weight goal, logs a weight and shows both on the start screen", async () => {
    const created = await write("create_training_goal", {
      request_id: "g1",
      kind: "body_weight",
      target_value: 75,
    });
    expect(created.ok).toBe(true);
    expect(created.result!.goal).toMatchObject({
      start_value: null,
      status: "active",
    });
    const logged = await write("log_body_weight", {
      request_id: "w1",
      measured_on: "2026-10-20",
      timezone: "Europe/Berlin",
      weight_kg: 80.5,
    });
    expect(logged.ok).toBe(true);
    const view = await dashboard();
    expect(view.home.goals).toEqual([
      expect.objectContaining({
        name: "Körpergewicht",
        current_value: 80.5,
        target_value: 75,
        row_revision: 1,
      }),
    ]);
    expect(view.home.latest_body_weight).toEqual({
      date: "2026-10-20",
      weight_kg: 80.5,
    });
  });

  it("explains what is wrong instead of guessing", async () => {
    const missing = await write("create_training_goal", {
      request_id: "e1",
      kind: "exercise_load",
      target_value: 100,
    });
    expect(missing.error?.code).toBe("VALIDATION_ERROR");
    const unknown = await write("create_training_goal", {
      request_id: "e2",
      kind: "exercise_reps",
      exercise_id: "does-not-exist",
      target_value: 10,
    });
    expect(unknown.error?.code).toBe("EXERCISE_NOT_FOUND");
    const future = await write("log_body_weight", {
      request_id: "e3",
      measured_on: "2999-01-01",
      timezone: "Europe/Berlin",
      weight_kg: 80,
    });
    expect(future.error?.code).toBe("DATE_IN_FUTURE");
    // Refused by the tool's input schema before anything is written.
    const unrealistic = await call("log_body_weight", {
      request_id: "e4",
      measured_on: "2026-10-20",
      timezone: "Europe/Berlin",
      weight_kg: 5,
    });
    expect(unrealistic.isError).toBe(true);
    const view = await dashboard();
    expect(view.home.goals).toEqual([]);
    expect(view.home.latest_body_weight).toBeNull();
  });

  it("changes a target, refuses a stale revision and ends a goal", async () => {
    const created = await write("create_training_goal", {
      request_id: "c1",
      kind: "body_weight",
      target_value: 75,
    });
    const id = created.result!.goal!.goal_id;
    const updated = await write("update_training_goal", {
      request_id: "c2",
      goal_id: id,
      expected_row_revision: 1,
      target_value: 72.5,
    });
    expect(updated.result!.goal!.target_value).toBe(72.5);
    const stale = await write("update_training_goal", {
      request_id: "c3",
      goal_id: id,
      expected_row_revision: 1,
      target_value: 70,
    });
    expect(stale.error?.code).toBe("REVISION_CONFLICT");
    const ended = await write("archive_training_goal", {
      request_id: "c4",
      goal_id: id,
      expected_row_revision: 2,
    });
    expect(ended.result!.goal!.status).toBe("archived");
    expect((await dashboard()).home.goals).toEqual([]);
  });

  it("voids a wrong weight entry without deleting it", async () => {
    const logged = await write("log_body_weight", {
      request_id: "v1",
      measured_on: "2026-10-19",
      timezone: "Europe/Berlin",
      weight_kg: 81,
    });
    const voided = await write("void_body_weight", {
      request_id: "v2",
      body_weight_id: logged.result!.body_weight!.body_weight_id,
      expected_row_revision: 1,
    });
    expect(voided.result!.body_weight!.status).toBe("voided");
    expect((await dashboard()).home.latest_body_weight).toBeNull();
  });
});
