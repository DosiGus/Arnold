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
import { RunWriteResponseSchema } from "../src/shared/run-contract";
import { ArnoldDashboardViewSchema } from "../src/shared/arnold-view";
import { CONFIRMATION_RULES } from "../src/server/auth/confirmation-rules";
import { TOOL_ACCESS } from "../src/server/auth/tool-access";
import { SETUP_GATED_TOOLS } from "../src/server/onboarding/setup-gate";
import { asCard } from "./fixtures/card-view";

const GOAL_TOOLS = [
  "create_training_goal",
  "update_training_goal",
  "archive_training_goal",
  "log_body_weight",
  "void_body_weight",
];

let client: Client, http: Server;
const call = async (name: string, args: Record<string, unknown> = {}) =>
  asCard((await client.callTool({ name, arguments: args })) as CallToolResult);
const write = async (name: string, args: Record<string, unknown>) =>
  WriteResponseSchema.parse((await call(name, args)).structuredContent);
const logRun = async (args: Record<string, unknown>) =>
  RunWriteResponseSchema.parse((await call("log_run", args)).structuredContent);
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
    expect(view.home.latest_body_weight).toMatchObject({
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

  it("running goals: created, measured from logged runs, changed and ended", async () => {
    const tz = "Europe/Berlin";
    const distance = await write("create_training_goal", {
      request_id: "r1",
      kind: "run_distance",
      target_value: 10,
    });
    expect(distance.ok, distance.error?.message).toBe(true);
    const fiveK = await write("create_training_goal", {
      request_id: "r2",
      kind: "run_time_for_distance",
      run_distance_m: 5000,
      target_value: 1500,
    });
    expect(fiveK.result!.goal).toMatchObject({
      kind: "run_time_for_distance",
      run_distance_m: 5000,
      exercise_id: null,
      load_basis: null,
      start_value: null,
    });
    // A second time goal for another distance is its own goal.
    const tenK = await write("create_training_goal", {
      request_id: "r3",
      kind: "run_time_for_distance",
      run_distance_m: 10_000,
      target_value: 3300,
    });
    expect(tenK.ok).toBe(true);
    const again = await write("create_training_goal", {
      request_id: "r4",
      kind: "run_time_for_distance",
      run_distance_m: 5000,
      target_value: 1450,
    });
    expect(again.error?.code).toBe("GOAL_EXISTS");
    const duration = await write("create_training_goal", {
      request_id: "r5",
      kind: "run_duration",
      target_value: 60,
    });
    expect(duration.ok).toBe(true);

    // 5 km in 26:00 told in the chat, then 7.2 km with kilometre laps.
    expect(
      (
        await logRun({
          request_id: "run-a",
          timezone: tz,
          workout_date_local: "2026-10-12",
          environment: "outdoor",
          timer_s: 1560,
          distance_m: 5000,
        })
      ).ok,
    ).toBe(true);
    expect(
      (
        await logRun({
          request_id: "run-b",
          timezone: tz,
          workout_date_local: "2026-10-19",
          environment: "outdoor",
          timer_s: 2400,
          distance_m: 7200,
          laps: [
            { timer_s: 310, distance_m: 1000 },
            { timer_s: 300, distance_m: 1000 },
            { timer_s: 295, distance_m: 1000 },
            { timer_s: 290, distance_m: 1000 },
            { timer_s: 300, distance_m: 1000 },
            { timer_s: 335, distance_m: 1000 },
            { timer_s: 340, distance_m: 1000 },
            { timer_s: 60, distance_m: 200 },
          ],
        })
      ).ok,
    ).toBe(true);

    const view = await dashboard();
    const byKind = Object.fromEntries(
      view.home.goals.map((g) => [
        `${g.kind}${g.run_distance_m ? `-${g.run_distance_m}` : ""}`,
        g,
      ]),
    );
    expect(byKind.run_distance).toMatchObject({
      name: "Laufen: Strecke am Stück",
      unit: "km",
      current_value: 7.2,
      run_distance_m: null,
    });
    expect(byKind.run_duration).toMatchObject({
      unit: "min",
      current_value: 40,
    });
    // Laps 1–5 (310 + 300 + 295 + 290 + 300) beat the 26:00 of the first run.
    expect(byKind["run_time_for_distance-5000"]).toMatchObject({
      name: "Laufen: 5 km auf Zeit",
      unit: "s",
      current_value: 1495,
      current_date: "2026-10-19",
    });
    expect(byKind["run_time_for_distance-10000"]).toMatchObject({
      current_value: null,
      progress: null,
    });
    const records = Object.fromEntries(
      view.home.run_records.map((r) => [r.key, r]),
    );
    expect(records.longest_distance).toMatchObject({
      value: 7200,
      achieved_on: "2026-10-19",
    });
    expect(records.fastest_1k.value).toBe(290);
    expect(records.best_5k.value).toBe(1495);
    expect(records.best_10k).toMatchObject({ value: null, workout_id: null });

    const id = fiveK.result!.goal!.goal_id;
    const changed = await write("update_training_goal", {
      request_id: "r6",
      goal_id: id,
      expected_row_revision: 1,
      target_value: 1440,
    });
    expect(changed.result!.goal!).toMatchObject({
      target_value: 1440,
      run_distance_m: 5000,
    });
    const ended = await write("archive_training_goal", {
      request_id: "r7",
      goal_id: id,
      expected_row_revision: 2,
    });
    expect(ended.result!.goal!.status).toBe("archived");
    expect((await dashboard()).home.goals.some((g) => g.goal_id === id)).toBe(
      false,
    );
  });

  it("refuses running goals that do not fit together", async () => {
    const cases: [Record<string, unknown>, string][] = [
      [
        { kind: "run_time_for_distance", target_value: 1500 },
        "VALIDATION_ERROR",
      ],
      [
        { kind: "run_distance", run_distance_m: 5000, target_value: 10 },
        "VALIDATION_ERROR",
      ],
      [
        { kind: "run_distance", exercise_id: "pfx-bench", target_value: 10 },
        "VALIDATION_ERROR",
      ],
      [{ kind: "run_distance", target_value: 500 }, "VALIDATION_ERROR"],
      [
        {
          kind: "run_time_for_distance",
          run_distance_m: 5000,
          target_value: 1500.5,
        },
        "VALIDATION_ERROR",
      ],
    ];
    for (const [args, code] of cases) {
      const answer = await write("create_training_goal", {
        request_id: `x-${JSON.stringify(args)}`,
        ...args,
      });
      expect(answer.error?.code, JSON.stringify(args)).toBe(code);
    }
    expect((await dashboard()).home.goals).toEqual([]);
  });
});
