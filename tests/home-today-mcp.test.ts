/**
 * "Heute" per kind over real Streamable HTTP: planned runs, trained days and
 * mobility routines of the dashboard, and that logging a routine shows up on
 * the next read. Synthetic data only.
 */
import type { Server } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import {
  Client,
  StreamableHTTPClientTransport,
  type CallToolResult,
} from "@modelcontextprotocol/client";
import { createHttpApp } from "../src/server/http";
import {
  createFixturePlanning,
  planFixtureDataset,
} from "../src/server/plan/fixture";
import { ArnoldDashboardViewSchema } from "../src/shared/arnold-view";
import { MobilityOverviewSchema } from "../src/shared/mobility-contract";
import { PlanWriteResponseSchema } from "../src/shared/plan-contract";
import { RunWeekResponseSchema } from "../src/shared/run-contract";
import { dashboardModel } from "../src/views/model/dashboard";
import {
  firstOpen,
  logMobilityInput,
  routinesOf,
} from "../src/views/model/mobility";
import { runLines } from "../src/views/model/plan-runs";
import { asCard } from "./fixtures/card-view";

const tz = "Europe/Berlin";
const today = new Date().toLocaleDateString("sv", { timeZone: tz });
const weekday = ((new Date(`${today}T12:00:00Z`).getUTCDay() + 6) % 7) + 1;

let client: Client | undefined, http: Server | undefined;
afterEach(async () => {
  await client?.close();
  await new Promise<void>((resolve) => {
    http?.close(() => resolve());
    http?.closeAllConnections();
  });
});

async function start() {
  http = createHttpApp({
    workoutRuntime: createFixturePlanning(planFixtureDataset("active_ppl")),
    allowedHosts: ["127.0.0.1", "localhost"],
  }).listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => http!.once("listening", resolve));
  client = new Client({ name: "synthetic-home-today-tests", version: "1" });
  await client.connect(
    new StreamableHTTPClientTransport(
      new URL(
        `http://127.0.0.1:${(http.address() as { port: number }).port}/mcp`,
      ),
    ),
  );
  return async (name: string, args: Record<string, unknown> = {}) =>
    asCard(
      (await client!.callTool({ name, arguments: args })) as CallToolResult,
    );
}

type Call = Awaited<ReturnType<typeof start>>;

/** A new active plan version with one run session and a morning routine. */
async function activate(call: Call) {
  await call("update_run_profile", {
    request_id: "ht-profile",
    goal: "10k",
    running_experience_months: 30,
    runs_per_week: 3,
    base_minutes_per_week: 180,
  });
  const write = async (name: string, args: Record<string, unknown>) => {
    const response = PlanWriteResponseSchema.parse(
      (await call(name, args)).structuredContent,
    );
    expect(response.ok, JSON.stringify(response.error)).toBe(true);
    return response.result!.plan!.version;
  };
  const draft = await write("create_plan_version", {
    request_id: "ht-create",
    source_plan_version_id: "pfx-v2",
  });
  const version = await write("update_plan_draft", {
    request_id: "ht-edit",
    plan_version_id: draft.plan_version_id,
    expected_row_revision: draft.row_revision,
    edits: [
      {
        type: "add_run_session",
        session_name: "Grundlage",
        run_type: "base",
        preferred_weekday: weekday,
      },
      {
        type: "add_mobility_session",
        kind: "morning",
        session_name: "Morgenroutine",
        minutes: 10,
        weekdays: [1, 2, 3, 4, 5, 6, 7],
        exercise_ids: [
          "mob_neck_rolls",
          "mob_neck_side",
          "mob_shoulder_circles",
          "mob_arm_circles",
          "mob_doorway_chest",
        ],
      },
    ],
  });
  await write("activate_training_plan", {
    request_id: "ht-activate",
    plan_version_id: version.plan_version_id,
    expected_row_revision: version.row_revision,
    confirmation: {
      confirmed: true,
      plan_version_id: version.plan_version_id,
      row_revision: version.row_revision,
    },
  });
  await call("update_mobility_profile", {
    request_id: "ht-mobility",
    preference: {
      wants: true,
      morning: {
        weekdays: ["mon", "tue", "wed", "thu", "fri", "sat", "sun"],
        minutes: 10,
      },
      sessions: null,
      stiff_areas: [],
    },
  });
}

const dashboard = async (call: Call) =>
  ArnoldDashboardViewSchema.parse(
    (await call("get_arnold_dashboard", { timezone: tz })).structuredContent,
  );

describe("today per kind over real Streamable HTTP", () => {
  it("shows a planned run, the open routine and, once logged, both as done", async () => {
    const call = await start();
    await activate(call);
    const before = await dashboard(call);
    expect(before.home.today).toMatchObject({
      date: today,
      has_run_plan: true,
      planned_runs: [],
    });
    expect(dashboardModel(before).todayNote?.action?.label).toBe(
      "Laufwoche planen",
    );

    // The run is told in the chat, then it counts as done today by name.
    const logged = await call("log_run", {
      request_id: "ht-run",
      workout_date_local: today,
      timezone: tz,
      run_type: "base",
      environment: "outdoor",
      timer_s: 1860,
      distance_m: 5200,
    });
    expect(logged.isError, JSON.stringify(logged.content)).toBeFalsy();
    const overview = MobilityOverviewSchema.parse(
      (await call("get_mobility_overview", { timezone: tz })).structuredContent,
    );
    const routine = firstOpen(routinesOf(overview, "morning"))!;
    const input = logMobilityInput(overview, routine, {
      requestId: "ht-routine",
      timezone: tz,
    });
    expect((await call("log_mobility", input)).isError).toBeFalsy();
    // The same request again is the same write.
    expect((await call("log_mobility", input)).structuredContent).toMatchObject(
      { ok: true, replayed: true },
    );

    const after = await dashboard(call);
    expect(after.home.today!.done).toMatchObject([
      { kind: "run", distance_m: 5200, timer_s: 1860 },
    ]);
    expect(after.home.mobility!.today).toMatchObject([
      { kind: "morning", name: "Morgenroutine", done: true },
    ]);
    const model = dashboardModel(after);
    expect(model.today.map((t) => [t.kind, t.state])).toEqual([
      ["strength", "next"],
      ["run", "done"],
      ["morning", "done"],
    ]);
    expect(model.today[1]!.sub).toBe("5,2 km · 31:00");
    expect(model.week.days.find((d) => d.today)!.session?.title).toBeTruthy();
  });

  it("gives the plan screen a day for a run session", async () => {
    const call = await start();
    await activate(call);
    const week = RunWeekResponseSchema.parse(
      (await call("get_run_week", { timezone: tz })).structuredContent,
    );
    const lines = [...runLines(week).values()];
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/^Vorschlag \(noch nicht gespeichert\): /);
  });
});
