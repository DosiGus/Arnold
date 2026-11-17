/**
 * UX-008: the four tools of an adjustment for a while over MCP, against the
 * synthetic plan fixture with a fixed clock (Tuesday, 17 November 2026).
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  Client,
  StreamableHTTPClientTransport,
  type CallToolResult,
} from "@modelcontextprotocol/client";
import type { Server } from "node:http";
import { createHttpApp } from "../src/server/http";
import {
  createFixturePlanning,
  planFixtureDataset,
} from "../src/server/plan/fixture";
import {
  PlanAdjustmentListSchema,
  PlanAdjustmentWriteResponseSchema,
} from "../src/shared/plan-adjustment-contract";
import { TOOL_ACCESS } from "../src/server/auth/tool-access";
import { CONFIRMATION_RULES } from "../src/server/auth/confirmation-rules";

const NOW = "2026-11-17T09:00:00Z";
let client: Client;
let http: Server;

const call = async (name: string, args: Record<string, unknown> = {}) =>
  (await client.callTool({ name, arguments: args })) as CallToolResult;
const textOf = (result: CallToolResult) => {
  const block = result.content[0];
  return block && block.type === "text" ? block.text : "";
};

beforeEach(async () => {
  let n = 0;
  const runtime = createFixturePlanning(planFixtureDataset("active_ppl"), {
    clock: () => new Date(NOW),
    id: () => `gen-${++n}`,
  });
  http = createHttpApp({
    workoutRuntime: runtime,
    allowedHosts: ["127.0.0.1", "localhost"],
  }).listen(0, "127.0.0.1");
  await new Promise<void>((resolve, reject) => {
    http.once("listening", resolve);
    http.once("error", reject);
  });
  client = new Client({ name: "synthetic-adjustment-tests", version: "1" });
  await client.connect(
    new StreamableHTTPClientTransport(
      new URL(
        `http://127.0.0.1:${(http.address() as { port: number }).port}/mcp`,
      ),
    ),
  );
});
afterEach(async () => {
  await client.close();
  await new Promise<void>((resolve) => http.close(() => resolve()));
});

describe("adjustment tools over MCP", () => {
  it("are published with an access class and a confirmation rule", async () => {
    const tools = (await client.listTools()).tools;
    for (const name of [
      "get_plan_adjustments",
      "create_plan_adjustment",
      "confirm_plan_adjustment",
      "cancel_plan_adjustment",
    ]) {
      const tool = tools.find((t) => t.name === name);
      expect(tool, name).toBeDefined();
      expect(TOOL_ACCESS[name], name).toBeDefined();
      expect(CONFIRMATION_RULES[name], name).toBeDefined();
    }
    expect(CONFIRMATION_RULES.create_plan_adjustment.rule).toBe("direct");
    expect(CONFIRMATION_RULES.confirm_plan_adjustment.rule).toBe(
      "ask_in_chat",
    );
    expect(CONFIRMATION_RULES.cancel_plan_adjustment.rule).toBe("ask_in_chat");
    const create = tools.find((t) => t.name === "create_plan_adjustment")!;
    expect(create.description).toContain("ENTWURF");
    expect(create.description).toContain("Ich habe heute nur 20 Minuten");
    expect(create.description).toContain("plan_adjustment");
  });

  it("creates a draft, confirms it and lists it as running", async () => {
    const created = await call("create_plan_adjustment", {
      request_id: "mcp-1",
      timezone: "Europe/Berlin",
      kind: "today",
      minutes_per_session: 20,
    });
    expect(created.isError).toBeFalsy();
    const draft = PlanAdjustmentWriteResponseSchema.parse(
      created.structuredContent,
    );
    expect(draft.result!.plan_adjustment.adjustment.status).toBe("draft");
    expect(textOf(created)).toContain("Noch nicht wirksam");
    expect(textOf(created)).toContain(
      "Ab Mi. 18.11. gilt wieder dein normaler Plan.",
    );

    const listed = PlanAdjustmentListSchema.parse(
      (await call("get_plan_adjustments")).structuredContent,
    );
    expect(listed.running).toBeNull();
    expect(listed.adjustments).toHaveLength(1);

    const a = draft.result!.plan_adjustment.adjustment;
    const confirmed = await call("confirm_plan_adjustment", {
      request_id: "mcp-2",
      plan_adjustment_id: a.plan_adjustment_id,
      expected_row_revision: a.row_revision,
    });
    expect(confirmed.isError).toBeFalsy();
    expect(textOf(confirmed)).toContain("Anpassung gilt");
    const running = PlanAdjustmentListSchema.parse(
      (await call("get_plan_adjustments")).structuredContent,
    );
    expect(running.running?.adjustment.plan_adjustment_id).toBe(
      a.plan_adjustment_id,
    );
    expect(textOf(await call("get_plan_adjustments"))).toContain(
      "ab Mi. 18.11. gilt wieder der normale Plan.",
    );

    const cancelled = await call("cancel_plan_adjustment", {
      request_id: "mcp-3",
      plan_adjustment_id: a.plan_adjustment_id,
      expected_row_revision: a.row_revision + 1,
    });
    expect(cancelled.isError).toBeFalsy();
    expect(textOf(cancelled)).toContain("normale Plan");
  });

  it("answers a refusal as an MCP error with code and text", async () => {
    const refused = await call("create_plan_adjustment", {
      request_id: "mcp-4",
      timezone: "Europe/Berlin",
      kind: "week",
    });
    expect(refused.isError).toBe(true);
    const payload = PlanAdjustmentWriteResponseSchema.parse(
      refused.structuredContent,
    );
    expect(payload.error?.code).toBe("VALIDATION_ERROR");
    expect(textOf(refused)).toContain("Minuten pro Einheit");
    const noZone = await call("create_plan_adjustment", {
      request_id: "mcp-5",
      kind: "today",
      minutes_per_session: 20,
    });
    expect(noZone.isError).toBe(true);
  });
});
