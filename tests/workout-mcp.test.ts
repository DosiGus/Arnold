import { beforeEach, afterEach, describe, expect, it } from "vitest";
import {
  Client,
  StreamableHTTPClientTransport,
  type CallToolResult,
} from "@modelcontextprotocol/client";
import type { Server } from "node:http";
import { createHttpApp } from "../src/server/http";
import { createFixtureLogging } from "../src/server/workout/fixture";
import {
  WorkoutContextSchema,
  WriteInputs,
  WriteResponseSchema,
} from "../src/shared/workout-contract";
import { ArnoldDashboardViewSchema } from "../src/shared/arnold-view";
const setInput = (extra = {}) => ({
  exercise_id: "fixture-bench",
  set_type: "working",
  reps: 10,
  reps_basis: "total",
  load_kg: 70,
  load_basis: "total",
  implement_count: 1,
  execution_mode: "bilateral_simultaneous",
  side: "both",
  ...extra,
});

let client: Client, http: Server;
const call = async (name: string, args: Record<string, unknown> = {}) =>
  (await client.callTool({ name, arguments: args })) as CallToolResult;
const write = async (name: string, args: Record<string, unknown>) =>
  WriteResponseSchema.parse((await call(name, args)).structuredContent);
async function start(request_id = "start") {
  const r = await write("start_workout", {
    request_id,
    workout_date_local: "2026-10-20",
    timezone: "Europe/Berlin",
    session_name: "Demo Push",
  });
  expect(r.ok).toBe(true);
  return r.result!.workout!;
}
beforeEach(async () => {
  http = createHttpApp({ workoutRuntime: createFixtureLogging() }).listen(
    0,
    "127.0.0.1",
  );
  await new Promise<void>((resolve, reject) => {
    http.once("listening", resolve);
    http.once("error", reject);
  });
  client = new Client({ name: "synthetic-workout-tests", version: "1" });
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

describe("workout tools over real Streamable HTTP", () => {
  it("advertises seven narrow writing tools and read schemas without range/credential parameters", async () => {
    const { tools } = await client.listTools();
    for (const name of Object.keys(WriteInputs)) {
      const tool = tools.find((t) => t.name === name)!;
      expect(tool.inputSchema.type).toBe("object");
      expect(tool.outputSchema?.type).toBe("object");
      expect(tool.annotations).toMatchObject({
        readOnlyHint: false,
        idempotentHint: true,
      });
      expect(Object.keys(tool.inputSchema.properties ?? {})).not.toContain(
        "spreadsheet_id",
      );
    }
    const context = WorkoutContextSchema.parse(
      (await call("get_workout")).structuredContent,
    );
    expect(context.can_write).toBe(true);
    expect(context.write_mode).toBe("fixture");
  });
  it("start -> three sets -> read -> complete -> refreshed analytics, retrying without duplicates", async () => {
    const w = await start();
    const input = {
      request_id: "batch",
      workout_id: w.workout_id,
      sets: [
        setInput({ load_kg: 60 }),
        setInput({ load_kg: 70, reps: 8 }),
        setInput({ load_kg: 70, reps: 7 }),
      ],
    };
    expect((await write("log_workout_sets", input)).ok).toBe(true);
    expect((await write("log_workout_sets", input)).replayed).toBe(true);
    const context = WorkoutContextSchema.parse(
      (await call("get_workout", { workout_id: w.workout_id }))
        .structuredContent,
    );
    expect(context.sets).toHaveLength(3);
    expect(
      (
        await write("complete_workout", {
          request_id: "done",
          workout_id: w.workout_id,
          expected_row_revision: 1,
        })
      ).ok,
    ).toBe(true);
    const view = ArnoldDashboardViewSchema.parse(
      (await call("get_arnold_dashboard")).structuredContent,
    );
    expect(view.totals.workouts_in_period).toBe(1);
    expect(view.kpis.find((k) => k.key === "nominal_volume")?.value).toBe(1650);
  });
  it("reports domain errors as structured results and preserves entity revisions", async () => {
    const missing = await call("log_workout_sets", {
      request_id: "bad",
      workout_id: "missing",
      sets: [setInput()],
    });
    expect(missing.isError).toBe(true);
    expect(
      WriteResponseSchema.parse(missing.structuredContent).error?.code,
    ).toBe("WORKOUT_NOT_FOUND");
    const w = await start(),
      saved = await write("log_workout_sets", {
        request_id: "sets",
        workout_id: w.workout_id,
        sets: [setInput()],
      });
    const set = saved.result!.sets[0];
    expect(
      (
        await write("update_set", {
          request_id: "update",
          set_id: set.set_id,
          expected_row_revision: 1,
          changes: { load_kg: 75 },
        })
      ).result?.sets[0].row_revision,
    ).toBe(2);
    expect(
      (
        await write("void_set", {
          request_id: "stale",
          set_id: set.set_id,
          expected_row_revision: 1,
        })
      ).error?.code,
    ).toBe("REVISION_CONFLICT");
    expect(
      (
        await write("void_set", {
          request_id: "void",
          set_id: set.set_id,
          expected_row_revision: 2,
        })
      ).result?.sets[0].status,
    ).toBe("voided");
  });
  it("validates invalid execution semantically and rejects invalid scalar inputs via SDK", async () => {
    const w = await start();
    const invalid = await write("log_workout_sets", {
      request_id: "ambiguous",
      workout_id: w.workout_id,
      sets: [setInput({ reps_basis: "per_side" })],
    });
    expect(invalid.error?.code).toBe("VALIDATION_ERROR");
    expect(
      (
        await call("log_workout_sets", {
          request_id: "negative",
          workout_id: w.workout_id,
          sets: [setInput({ load_kg: -5 })],
        })
      ).isError,
    ).toBe(true);
  });
  it("cancels and creates catalog variants without modifying plans", async () => {
    const w = await start();
    expect(
      (
        await write("cancel_workout", {
          request_id: "cancel",
          workout_id: w.workout_id,
          expected_row_revision: 1,
        })
      ).result?.workout?.status,
    ).toBe("cancelled");
    const result = await write("create_exercise", {
      request_id: "exercise",
      name_de: "Synthetic row variant",
      family_key: "row",
      variant_key: "different",
      equipment: "machine",
      primary_muscle: "back",
      default_load_basis: "machine_display",
      default_execution_mode: "bilateral_simultaneous",
      default_implement_count: 1,
    });
    expect(result.result?.exercise?.row_revision).toBe(1);
  });
});
