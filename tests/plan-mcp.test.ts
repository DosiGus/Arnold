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
  PLAN_CONTRACT,
  PlanContextSchema,
  PlanHistorySchema,
  PlanValidationResultSchema,
  PlanVersionComparisonSchema,
  PlanWriteInputs,
  PlanWriteResponseSchema,
  TrainingPlanListSchema,
  type PlanWriteResponse,
} from "../src/shared/plan-contract";
import { ArnoldDashboardViewSchema } from "../src/shared/arnold-view";

let client: Client;
let http: Server;
let runtime: ReturnType<typeof createFixturePlanning>;

const call = async (name: string, args: Record<string, unknown> = {}) =>
  (await client.callTool({ name, arguments: args })) as CallToolResult;

/** First text block of a tool result, which is where every message lands. */
const textOf = (result: CallToolResult) => {
  const block = result.content[0];
  return block && block.type === "text" ? block.text : "";
};

const write = async (
  name: string,
  args: Record<string, unknown>,
): Promise<PlanWriteResponse> =>
  PlanWriteResponseSchema.parse((await call(name, args)).structuredContent);

async function listen(
  shape: Parameters<typeof planFixtureDataset>[0] = "active_ppl",
) {
  runtime = createFixturePlanning(planFixtureDataset(shape));
  http = createHttpApp({
    workoutRuntime: runtime,
    allowedHosts: ["127.0.0.1", "localhost"],
  }).listen(0, "127.0.0.1");
  await new Promise<void>((resolve, reject) => {
    http.once("listening", resolve);
    http.once("error", reject);
  });
  client = new Client({ name: "synthetic-plan-tests", version: "1" });
  await client.connect(
    new StreamableHTTPClientTransport(
      new URL(
        `http://127.0.0.1:${(http.address() as { port: number }).port}/mcp`,
      ),
    ),
  );
}

beforeEach(() => listen());
afterEach(async () => {
  await client.close();
  await new Promise<void>((resolve) => http.close(() => resolve()));
});

/** A fresh draft via MCP, ready to be edited. */
async function draftViaMcp() {
  const response = await write("create_plan_version", {
    request_id: "mcp-cv",
    source_plan_version_id: "pfx-v2",
  });
  expect(response.ok).toBe(true);
  return response.result!.plan!.version;
}

describe("plan MCP tools", () => {
  it("registers every documented plan tool", async () => {
    const names = (await client.listTools()).tools.map((tool) => tool.name);
    for (const expected of [
      "create_training_plan",
      "get_training_plan",
      "list_training_plans",
      "create_plan_version",
      "update_plan_draft",
      "validate_training_plan",
      "compare_plan_versions",
      "activate_training_plan",
      "archive_plan_draft",
      "get_plan_history",
      "clone_plan_version",
      "get_plan_editor_context",
    ])
      expect(names, `missing ${expected}`).toContain(expected);
  });

  it("keeps the existing dashboard and workout tools working", async () => {
    const names = (await client.listTools()).tools.map((tool) => tool.name);
    for (const expected of [
      "show_arnold_dashboard",
      "get_arnold_dashboard",
      "get_arnold_workouts",
      "get_arnold_exercise_progress",
      "get_workout",
      "start_workout",
      "log_workout_sets",
    ])
      expect(names, `missing ${expected}`).toContain(expected);
    const dashboard = ArnoldDashboardViewSchema.parse(
      (await call("get_arnold_dashboard")).structuredContent,
    );
    expect(dashboard.active_plan!.plan_version_id).toBe("pfx-v2");
  });

  it("publishes Zod input and output schemas for every write tool", async () => {
    const tools = (await client.listTools()).tools;
    for (const operation of Object.keys(PlanWriteInputs)) {
      const tool = tools.find((t) => t.name === operation)!;
      expect(tool.inputSchema, operation).toBeDefined();
      expect(tool.outputSchema, operation).toBeDefined();
      expect(tool.inputSchema.required, operation).toContain("request_id");
      expect(tool.description!.length, operation).toBeGreaterThan(80);
      expect(tool.annotations?.idempotentHint, operation).toBe(true);
      expect(tool.annotations?.readOnlyHint, operation).toBe(false);
    }
  });

  it("marks activation and discarding as the operations needing confirmation", async () => {
    const tools = (await client.listTools()).tools;
    const destructive = Object.fromEntries(
      tools
        .filter((t) => t.annotations && t.annotations.readOnlyHint === false)
        .map((t) => [t.name, t.annotations!.destructiveHint]),
    );
    expect(destructive.activate_training_plan).toBe(true);
    expect(destructive.archive_plan_draft).toBe(true);
    expect(destructive.create_training_plan).toBe(false);
    expect(destructive.update_plan_draft).toBe(false);
  });

  it("marks every read tool as read-only", async () => {
    const tools = (await client.listTools()).tools;
    for (const name of [
      "get_training_plan",
      "list_training_plans",
      "get_plan_history",
      "validate_training_plan",
      "compare_plan_versions",
      "get_plan_editor_context",
    ]) {
      const tool = tools.find((t) => t.name === name)!;
      expect(tool.annotations?.readOnlyHint, name).toBe(true);
      expect(tool.annotations?.destructiveHint, name).toBe(false);
    }
  });

  it("loads the active plan with structured content", async () => {
    const result = await call("get_training_plan");
    expect(result.isError).toBeFalsy();
    const payload = result.structuredContent as Record<string, unknown>;
    const plan = payload.plan as Record<string, unknown>;
    expect(plan.plan_version_id).toBe("pfx-v2");
    expect(plan.status).toBe("active");
    expect(plan.editable).toBe(false);
    expect((plan.sessions as unknown[]).length).toBe(3);
    // An active plan carries no draft validation.
    expect(payload.validation).toBeNull();
    expect(textOf(result).length).toBeGreaterThan(0);
  });

  it("loads a specific version including removed positions", async () => {
    const result = await call("get_training_plan", {
      plan_version_id: "pfx-v1",
      include_removed: true,
    });
    const plan = (result.structuredContent as Record<string, unknown>)
      .plan as Record<string, unknown>;
    expect(plan.status).toBe("archived");
    expect(plan.version_no).toBe(1);
  });

  it("lists plans and the history", async () => {
    const list = TrainingPlanListSchema.parse(
      (await call("list_training_plans")).structuredContent,
    );
    expect(list.plan_contract).toBe(PLAN_CONTRACT);
    expect(list.active_plan_version_id).toBe("pfx-v2");
    const history = PlanHistorySchema.parse(
      (await call("get_plan_history")).structuredContent,
    );
    expect(history.entries.map((e) => e.version.version_no)).toEqual([2, 1]);
  });

  it("validates a draft through the tool", async () => {
    const version = await draftViaMcp();
    const validation = PlanValidationResultSchema.parse(
      (
        await call("validate_training_plan", {
          plan_version_id: version.plan_version_id,
        })
      ).structuredContent,
    );
    expect(validation.valid).toBe(true);
    expect(validation.activatable).toBe(true);
    expect(validation.schema_version).toBe("1.0.0");
  });

  it("compares two versions through the tool", async () => {
    const comparison = PlanVersionComparisonSchema.parse(
      (
        await call("compare_plan_versions", {
          from_plan_version_id: "pfx-v1",
          to_plan_version_id: "pfx-v2",
        })
      ).structuredContent,
    );
    expect(comparison.summary.total).toBeGreaterThan(0);
    expect(comparison.headline.length).toBeGreaterThan(0);
  });

  it("serves the editor context in one call", async () => {
    const context = PlanContextSchema.parse(
      (await call("get_plan_editor_context")).structuredContent,
    );
    expect(context.plan_contract).toBe(PLAN_CONTRACT);
    expect(context.can_write).toBe(true);
    expect(context.write_mode).toBe("fixture");
    expect(context.active_plan_version_id).toBe("pfx-v2");
    expect(context.exercises.length).toBeGreaterThan(5);
    // Retired catalog entries are not offered in the picker.
    expect(context.exercises.map((e) => e.exercise_id)).not.toContain(
      "plan-fx-retired",
    );
    expect(context.families).toHaveLength(1);
  });

  it("runs the whole edit, review and activation flow over MCP", async () => {
    const version = await draftViaMcp();
    const push = version.sessions.find((s) => s.session_name === "Push")!;
    const bench = push.exercises.find(
      (e) => e.exercise_id === "plan-fx-bench",
    )!;

    // An unknown edit type is rejected by the published input schema rather
    // than silently ignored. The SDK enforces it at the protocol boundary, so
    // the call never reaches the service.
    const rejected = await call("update_plan_draft", {
      request_id: "mcp-edit",
      plan_version_id: version.plan_version_id,
      expected_row_revision: version.row_revision,
      edits: [{ type: "no_such_edit_type" }],
    });
    expect(rejected.isError).toBe(true);
    expect(textOf(rejected)).toMatch(/Invalid discriminator value/);
    expect(rejected.structuredContent).toBeUndefined();
    // Nothing was written.
    expect(
      (await runtime.repository.read()).plans.find(
        (p) => p.plan_version_id === version.plan_version_id,
      )!.row_revision,
    ).toBe(version.row_revision);

    const real = await write("update_plan_draft", {
      request_id: "mcp-edit-2",
      plan_version_id: version.plan_version_id,
      expected_row_revision: version.row_revision,
      edits: [
        {
          type: "replace_plan_exercise",
          plan_item_id: bench.plan_item_id,
          new_exercise_id: "plan-fx-db-bench",
        },
        {
          type: "add_session",
          session_name: "Arme",
          exercises: [
            {
              exercise_id: "plan-fx-curl",
              target_sets: 3,
              rep_min: 10,
              rep_max: 12,
            },
          ],
        },
      ],
    });
    expect(real.ok).toBe(true);
    const draft = real.result!.plan!.version;
    expect(draft.sessions.map((s) => s.session_name)).toEqual([
      "Push",
      "Pull",
      "Legs",
      "Arme",
    ]);
    // The change summary is part of the write result, ready for a review step.
    expect(real.result!.changes.map((c) => c.kind)).toContain(
      "exercise_replaced",
    );
    expect(real.result!.changes.map((c) => c.kind)).toContain("session_added");
    expect(real.result!.validation!.activatable).toBe(true);

    const activated = await write("activate_training_plan", {
      request_id: "mcp-activate",
      plan_version_id: draft.plan_version_id,
      expected_row_revision: draft.row_revision,
      confirmation: {
        plan_version_id: draft.plan_version_id,
        row_revision: draft.row_revision,
        confirmed: true,
      },
    });
    expect(activated.ok).toBe(true);
    expect(activated.result!.activation!.archived_plan_version_id).toBe(
      "pfx-v2",
    );

    // The dashboard immediately reflects the new active plan.
    const dashboard = ArnoldDashboardViewSchema.parse(
      (await call("get_arnold_dashboard")).structuredContent,
    );
    expect(dashboard.active_plan!.plan_version_id).toBe(draft.plan_version_id);
    expect(dashboard.active_plan!.session_count).toBe(4);
  });

  it("reports a write failure as an MCP error with its code", async () => {
    const result = await call("update_plan_draft", {
      request_id: "mcp-bad",
      plan_version_id: "pfx-v2",
      expected_row_revision: 1,
      edits: [{ type: "update_plan_metadata", name: "Direkt am aktiven Plan" }],
    });
    expect(result.isError).toBe(true);
    const payload = PlanWriteResponseSchema.parse(result.structuredContent);
    expect(payload.ok).toBe(false);
    expect(payload.error!.code).toBe("PLAN_NOT_EDITABLE");
    expect(textOf(result)).toMatch(/PLAN_NOT_EDITABLE/);
  });

  it("reports a read failure as an MCP error", async () => {
    const result = await call("get_training_plan", {
      plan_version_id: "ghost",
    });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toMatch(/PLAN_VERSION_NOT_FOUND/);
  });

  it("creates a plan through clone_plan_version as an alias", async () => {
    const response = await write("clone_plan_version", {
      request_id: "mcp-clone",
      source_plan_version_id: "pfx-v1",
    });
    expect(response.ok).toBe(true);
    expect(response.result!.plan!.version.status).toBe("draft");
    expect(response.result!.plan!.based_on_plan_version_id).toBe("pfx-v1");
  });

  it("replays a repeated write over MCP", async () => {
    const input = {
      request_id: "mcp-repeat",
      source_plan_version_id: "pfx-v2",
    };
    const first = await write("create_plan_version", input);
    const second = await write("create_plan_version", input);
    expect(first.replayed).toBe(false);
    expect(second.replayed).toBe(true);
    expect(second.result!.plan!.version.plan_version_id).toBe(
      first.result!.plan!.version.plan_version_id,
    );
  });
});

describe("plan tools on a read-only connection", () => {
  afterEach(async () => {
    await client.close();
    await new Promise<void>((resolve) => http.close(() => resolve()));
  });

  it("publishes no plan write tools when plan management is absent", async () => {
    await client.close();
    await new Promise<void>((resolve) => http.close(() => resolve()));
    const base = createFixturePlanning(planFixtureDataset());
    // The same source and workout logger, but no plan service wired in.
    http = createHttpApp({
      workoutRuntime: { source: base.source, service: base.service },
      allowedHosts: ["127.0.0.1", "localhost"],
    }).listen(0, "127.0.0.1");
    await new Promise<void>((resolve, reject) => {
      http.once("listening", resolve);
      http.once("error", reject);
    });
    client = new Client({ name: "synthetic-plan-readonly", version: "1" });
    await client.connect(
      new StreamableHTTPClientTransport(
        new URL(
          `http://127.0.0.1:${(http.address() as { port: number }).port}/mcp`,
        ),
      ),
    );
    const names = (await client.listTools()).tools.map((tool) => tool.name);
    for (const operation of Object.keys(PlanWriteInputs))
      expect(names, operation).not.toContain(operation);
    expect(names).not.toContain("get_training_plan");
    // The dashboard still works.
    expect(names).toContain("get_arnold_dashboard");
  });
});
