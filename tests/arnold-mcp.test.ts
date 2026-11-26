import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  Client,
  StreamableHTTPClientTransport,
  type CallToolResult,
} from "@modelcontextprotocol/client";
import { RESOURCE_MIME_TYPE } from "@modelcontextprotocol/ext-apps/server";
import { type Server } from "node:http";
import { createHttpApp } from "../src/server/http";
import { ARNOLD_RESOURCE_URI } from "../src/server/mcp-arnold";
import {
  StaticArnoldDataSource,
  type ArnoldDataSource,
} from "../src/server/arnold-source";
import {
  ARNOLD_UI_CONTRACT,
  ArnoldDashboardViewSchema,
  ArnoldExerciseProgressViewSchema,
  ArnoldWorkoutHistoryViewSchema,
} from "../src/shared/arnold-view";
import {
  EXERCISES,
  emptyTrackerDataset,
  fullDataset,
  masterTemplateDataset,
  singleSetDataset,
} from "./fixtures/arnold-dashboard";
import { asCard } from "./fixtures/card-view";
import { HealthDataSchema } from "../src/shared/health-contract";

let client: Client;
let http: Server;
let source: StaticArnoldDataSource;
const call = (name: string, args = {}) =>
  client
    .callTool({ name, arguments: args })
    .then((result) => asCard(result as CallToolResult));
const dashboard = async (args = {}) =>
  ArnoldDashboardViewSchema.parse(
    (await call("get_arnold_dashboard", args)).structuredContent,
  );
const history = async (args = {}) =>
  ArnoldWorkoutHistoryViewSchema.parse(
    (await call("get_arnold_workouts", args)).structuredContent,
  );
const progress = async (args: Record<string, unknown>) =>
  ArnoldExerciseProgressViewSchema.parse(
    (await call("get_arnold_exercise_progress", args)).structuredContent,
  );

beforeAll(async () => {
  source = new StaticArnoldDataSource(fullDataset());
  http = createHttpApp({ arnoldSource: source }).listen(0, "127.0.0.1");
  await new Promise<void>((resolve, reject) => {
    http.once("listening", resolve);
    http.once("error", reject);
  });
  const port = (http.address() as { port: number }).port;
  client = new Client({ name: "arnold-mcp-tests", version: "1.0.0" });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`)),
  );
});
afterAll(async () => {
  await client?.close();
  await new Promise<void>((resolve) => {
    http?.close(() => resolve());
    http?.closeAllConnections();
  });
});
beforeEach(() => {
  source.setFailure(undefined);
  source.setDataset(fullDataset());
});

describe("Arnold v2 MCP surface", () => {
  it("advertises the versioned tools with input and output schemas", async () => {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([
      "get_arnold_dashboard",
      "get_arnold_exercise_progress",
      "get_arnold_workouts",
      "get_health_data",
      "get_workout",
      "show_arnold_dashboard",
    ]);
    for (const tool of tools) {
      expect(tool.inputSchema.type, tool.name).toBe("object");
      expect(tool.outputSchema?.type, tool.name).toBe("object");
      expect(tool.description, tool.name).toBeTruthy();
    }
    // Every Arnold-mode tool is read-only; no write tool is exposed.
    expect(tools.every((t) => t.annotations?.readOnlyHint === true)).toBe(true);
    expect(tools.map((t) => t.name)).not.toContain("log_demo_set");
    expect(tools.map((t) => t.name)).not.toContain("reset_demo_data");
  });

  it("keeps show_arnold_dashboard as the app opener with a resource link", async () => {
    const { tools } = await client.listTools();
    const uri = (
      tools.find((t) => t.name === "show_arnold_dashboard")?._meta?.ui as {
        resourceUri: string;
      }
    ).resourceUri;
    // The URI names this bundle, so a new UI is never served from a cache.
    expect(uri).toMatch(
      /^ui:\/\/arnold\/dashboard-v2-([0-9a-f]{12}|dev)\.html$/,
    );
    const listed = (await client.listResources()).resources.map((r) => r.uri);
    expect(listed).toContain(uri);
    // Cards stored in older chats keep opening.
    expect(listed).toContain(ARNOLD_RESOURCE_URI);
    // ChatGPT keeps the URI of the previous deploy until it reloads the tool
    // list; that older hash must still open the current UI, not fail.
    const previous = "ui://arnold/dashboard-v2-a9c0db0b4b9e.html";
    expect(listed).not.toContain(previous);
    for (const address of [uri, ARNOLD_RESOURCE_URI, previous]) {
      const resource = (await client.readResource({ uri: address }))
        .contents[0];
      expect(resource.mimeType).toBe(RESOURCE_MIME_TYPE);
      expect("text" in resource && resource.text).toContain('<div id="root">');
      // The app must be self-contained: no external script may be loaded.
      expect("text" in resource && resource.text).not.toMatch(
        /<script[^>]*src=/,
      );
    }
  });

  it("opens the dashboard on a valid initial state", async () => {
    const result = await call("show_arnold_dashboard");
    expect(result.isError).not.toBe(true);
    const view = ArnoldDashboardViewSchema.parse(result.structuredContent);
    expect(view.ui_contract).toBe(ARNOLD_UI_CONTRACT);
    expect(view.state).toBe("ready");
    expect(view.source.read_only).toBe(true);
    expect(view.source.synthetic).toBe(false);
  });

  it("lets the model pick a card, and only a card the app knows", async () => {
    const { tools } = await client.listTools();
    const schema = tools.find((t) => t.name === "show_arnold_dashboard")
      ?.inputSchema as { properties?: { card?: { enum?: string[] } } };
    expect(schema.properties?.card?.enum).toEqual([
      "home",
      "today",
      "week",
      "progress",
      "history",
      "plan",
      "plan_change",
      "plan_adjustment",
      "stats",
      "goals",
      "records",
    ]);
    const week = await call("show_arnold_dashboard", { card: "week" });
    expect(week.isError).not.toBe(true);
    const unknown = await call("show_arnold_dashboard", { card: "settings" });
    expect(unknown.isError).toBe(true);
  });
});

describe("dashboard DTO over MCP", () => {
  it("delivers engine metrics, weekly development, records and plan info", async () => {
    const view = await dashboard();
    const kpi = (key: string) => view.kpis.find((k) => k.key === key)!;
    // Five completed workouts; the cancelled one does not count.
    expect(kpi("workouts").value).toBe(5);
    expect(kpi("training_days").value).toBe(5);
    expect(kpi("working_sets").value).toBeGreaterThan(0);
    expect(view.weeks.length).toBeGreaterThan(0);
    expect(view.records.length).toBeGreaterThan(0);
    expect(view.active_plan?.plan_version_id).toBe("pv-test-2");
    expect(view.plan_history.map((p) => p.plan_version_id)).toEqual([
      "pv-test-1",
      "pv-test-2",
    ]);
    expect(view.data_quality.analyzable).toBe(true);
  });

  it("never mixes incomparable load definitions in a record", async () => {
    const view = await dashboard();
    for (const record of view.records) {
      expect(record.load_basis, record.exercise_name).not.toBeNull();
      // A per-implement record must say so, so it is not read as a total load.
      if (record.exercise_id === EXERCISES.row)
        expect(record.load_basis).toBe("per_implement");
    }
    const machine = view.records.filter(
      (r) => r.exercise_id === EXERCISES.press,
    );
    for (const record of machine)
      expect(record.load_basis).toBe("machine_display");
  });

  it("applies date and plan filters on the server", async () => {
    const windowed = await dashboard({ from: "2026-10-01", to: "2026-10-31" });
    expect(windowed.kpis.find((k) => k.key === "workouts")!.value).toBe(3);
    expect(windowed.period.from).toBe("2026-10-01");
    const byPlan = await dashboard({ plan_version_ids: ["pv-test-1"] });
    expect(byPlan.kpis.find((k) => k.key === "workouts")!.value).toBe(2);
  });

  it("reports a missing weekly goal instead of assuming one", async () => {
    expect((await dashboard()).notices.map((n) => n.code)).toContain(
      "weekly_goal_missing",
    );
    const withGoal = await dashboard({ weekly_goal_training_days: 3 });
    expect(withGoal.notices.map((n) => n.code)).not.toContain(
      "weekly_goal_missing",
    );
  });

  it("exposes history-only exercises so their progress stays reachable", async () => {
    const view = await dashboard();
    const retired = view.exercises.find(
      (e) => e.exercise_id === EXERCISES.retired,
    )!;
    expect(retired.retired).toBe(true);
    expect(retired.logged_sets).toBe(1);
  });
});

describe("workout history over MCP", () => {
  it("returns dynamic session names with no fixed split", async () => {
    const page = await history();
    expect(page.workouts.map((w) => w.title)).toEqual([
      "Freies Training",
      "Unterkörper B",
      "Oberkörper A",
      "Oberkörper A",
      "Oberkörper A",
    ]);
  });

  it("builds exercise cards that keep left/right and per-implement loads", async () => {
    const page = await history({ workout_statuses: ["completed"] });
    const workout = page.workouts.find((w) => w.workout_id === "w-test-3")!;
    const rowBlock = workout.exercises.find(
      (e) => e.exercise_id === EXERCISES.row,
    )!;
    expect(rowBlock.name).toBe("Testrudern einarmig");
    expect(rowBlock.sets.map((s) => [s.side, s.load_kg, s.reps])).toEqual([
      ["right", 20, 10],
      ["left", 20, 10],
    ]);
    expect(rowBlock.sets.every((s) => s.load_basis === "per_implement")).toBe(
      true,
    );
    // The bench block in the same workout keeps its own total-load convention.
    const benchBlock = workout.exercises.find(
      (e) => e.exercise_id === EXERCISES.bench,
    )!;
    expect(benchBlock.sets.every((s) => s.load_basis === "total")).toBe(true);
    expect(benchBlock.exercise_order).toBeLessThan(rowBlock.exercise_order);
  });

  it("shows the sets of one workout exactly as entered, in order", async () => {
    const page = await history({ from: "2026-09-07", to: "2026-09-07" });
    const block = page.workouts[0].exercises.find(
      (e) => e.exercise_id === EXERCISES.bench,
    )!;
    expect(block.sets.map((s) => [s.set_number, s.load_kg, s.reps])).toEqual([
      [1, 60, 10],
      [2, 70, 8],
      [3, 70, 7],
    ]);
  });

  it("keeps a removed plan exercise in the workout it was logged in", async () => {
    const page = await history({ from: "2026-09-07", to: "2026-09-07" });
    const block = page.workouts[0].exercises.find(
      (e) => e.exercise_id === EXERCISES.retired,
    )!;
    expect(block.name).toBe("Testfliegende (beendet)");
    expect(block.retired).toBe(true);
    // The current plan no longer contains it, yet the history still does.
    const view = await dashboard();
    expect(
      view.active_plan?.sessions.flatMap((s) => s.session_id),
    ).not.toContain(EXERCISES.retired);
  });

  it("marks voided sets without letting them reach the metrics", async () => {
    const page = await history({ from: "2026-10-19", to: "2026-10-19" });
    const voided = page.workouts[0].exercises
      .flatMap((e) => e.sets)
      .find((s) => s.set_id === "s-test-14")!;
    expect(voided.voided).toBe(true);
    // 999 kg would dominate every record if it were counted.
    const view = await dashboard();
    expect(view.records.every((r) => r.value < 999)).toBe(true);
  });

  it("distinguishes cancelled workouts from counted ones", async () => {
    const page = await history({
      workout_statuses: ["completed", "cancelled"],
    });
    const cancelled = page.workouts.find((w) => w.workout_id === "w-test-6")!;
    expect(cancelled.status).toBe("cancelled");
    expect(cancelled.status_label).toBe("Abgebrochen");
    expect(cancelled.counts_towards_metrics).toBe(false);
    expect(
      page.workouts.find((w) => w.workout_id === "w-test-3")!
        .counts_towards_metrics,
    ).toBe(true);
  });

  it("filters by session name, plan version and exercise", async () => {
    expect(
      (await history({ session_name: "Oberkörper A" })).workouts,
    ).toHaveLength(3);
    expect(
      (await history({ plan_version_ids: ["pv-test-1"] })).workouts.map(
        (w) => w.workout_id,
      ),
    ).toEqual(["w-test-2", "w-test-1"]);
    expect(
      (await history({ exercise_ids: [EXERCISES.row] })).workouts.map(
        (w) => w.workout_id,
      ),
    ).toEqual(["w-test-3"]);
  });

  it("pages results and reports the true total", async () => {
    const first = await history({ limit: 2 });
    expect(first.workouts).toHaveLength(2);
    expect(first.total).toBe(5);
    expect(first.has_more).toBe(true);
    const second = await history({ limit: 2, offset: 2 });
    expect(second.workouts.map((w) => w.workout_id)).not.toEqual(
      first.workouts.map((w) => w.workout_id),
    );
  });

  it("returns an empty filter result as a notice, not an error", async () => {
    const page = await history({ from: "2030-01-01" });
    expect(page.workouts).toEqual([]);
    expect(page.total).toBe(0);
    expect(page.notices.map((n) => n.code)).toContain("filter_empty");
  });
});

describe("exercise progress over MCP", () => {
  it("returns real, chronologically sorted measurement points", async () => {
    const view = await progress({
      exercise_id: EXERCISES.bench,
      metric: "max_load",
    });
    expect(view.selected_series!.points).toEqual([
      { date: "2026-09-07", value: 70 },
      { date: "2026-09-14", value: 70 },
      { date: "2026-10-05", value: 75 },
    ]);
    expect(view.selected_series!.aggregation).toBe("max");
  });

  it("serves each supported metric from the engine", async () => {
    for (const metric of [
      "max_load",
      "estimated_1rm",
      "nominal_volume",
      "total_reps",
      "mean_reps_per_working_set",
    ] as const) {
      const view = await progress({
        exercise_id: EXERCISES.bench,
        metric,
      });
      expect(view.selected_metric, metric).toBe(metric);
      expect(view.selected_series, metric).not.toBeNull();
    }
  });

  it("filters the series by period on the server", async () => {
    const view = await progress({
      exercise_id: EXERCISES.bench,
      from: "2026-10-01",
    });
    expect(view.selected_series!.points).toEqual([
      { date: "2026-10-05", value: 75 },
    ]);
  });

  it("renders a single logged set as one point", async () => {
    source.setDataset(singleSetDataset());
    const view = await progress({ exercise_id: EXERCISES.bench });
    expect(view.empty).toBe(false);
    expect(view.selected_series!.points).toHaveLength(1);
  });

  it("reports a never-logged exercise as an empty state", async () => {
    const view = await progress({
      exercise_id: EXERCISES.pullup,
      metric: "max_load",
    });
    // A bodyweight exercise has no comparable load to chart.
    expect(view.empty).toBe(true);
    expect(view.selected_series?.points ?? []).toEqual([]);
    expect(view.notices.length).toBeGreaterThan(0);
  });

  it("keeps a per-implement exercise in its own comparability class", async () => {
    const view = await progress({ exercise_id: EXERCISES.row });
    // Left and right are deliberately separate classes, so one side's load is
    // never compared against the other's.
    expect(view.variants).toHaveLength(2);
    expect(
      view.variants.every(
        (v) =>
          v.comparability.load_basis === "per_implement" &&
          v.comparability.execution_mode === "unilateral",
      ),
    ).toBe(true);
    expect(view.variants.map((v) => v.comparability.side).sort()).toEqual([
      "left",
      "right",
    ]);
  });

  it("explains a missing 1RM for an assisted exercise", async () => {
    const view = await progress({
      exercise_id: EXERCISES.dip,
      metric: "estimated_1rm",
    });
    const oneRm = view.kpis.find((k) => k.key === "best_estimated_1rm")!;
    expect(oneRm.value).toBeNull();
    expect(oneRm.note).toBeTruthy();
    expect(oneRm.note).not.toMatch(/assistance|load_basis/);
  });
});

describe("empty tracker and master template over MCP", () => {
  it("opens an empty tracker without inventing workouts", async () => {
    source.setDataset(emptyTrackerDataset());
    const view = await dashboard();
    expect(view.state).toBe("empty_history");
    expect(view.recent_workouts).toEqual([]);
    expect(view.records).toEqual([]);
    expect(view.totals.workouts_in_history).toBe(0);
    // The catalog is still offered, so the UI can show what is available.
    expect(view.exercises.length).toBeGreaterThan(0);
    expect((await history()).workouts).toEqual([]);
  });

  it("flags the master template rather than treating it as a user account", async () => {
    source.setDataset(masterTemplateDataset());
    const view = await dashboard();
    expect(view.state).toBe("master_template");
    expect(view.source.file_role).toBe("MASTER_TEMPLATE");
    expect(view.notices.map((n) => n.code)).toContain("master_template");
  });
});

describe("failure handling over MCP", () => {
  it("reports a storage outage as an error without falling back to demo data", async () => {
    source.setFailure({
      code: "unavailable",
      message: "Die Datenbank ist vorübergehend nicht verfügbar.",
      retryable: true,
    });
    const result = await call("get_arnold_dashboard");
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toBeUndefined();
    const text = result.content
      .map((c) => (c.type === "text" ? c.text : ""))
      .join(" ");
    expect(text).toContain("nicht verfügbar");
    // No synthetic substitute may be served in place of real data.
    expect(text).not.toMatch(/Demo|synthetisch/i);
  });

  it("reports an incompatible schema as its own failure code", async () => {
    source.setFailure({
      code: "schema_incompatible",
      message:
        "Die Arnold-Datei passt nicht zum erwarteten Schema v1. Struktur und Spalten der sechs Tabellen prüfen.",
      retryable: false,
    });
    const result = await call("get_arnold_workouts");
    expect(result.isError).toBe(true);
    expect(
      (result._meta as { arnold?: { failure?: { code?: string } } })?.arnold
        ?.failure?.code,
    ).toBe("schema_incompatible");
  });

  it("rejects contradictory filters without inventing a result", async () => {
    const result = await call("get_arnold_dashboard", {
      from: "2026-10-20",
      to: "2026-09-01",
    });
    expect(result.isError).toBe(true);
  });
});

describe("get_health_data (Health Data card, app only)", () => {
  const health = async () =>
    HealthDataSchema.parse(
      (await call("get_health_data", { timezone: "Europe/Berlin" }))
        .structuredContent,
    );
  const withHealth = (fn: ArnoldDataSource["healthDays"]) =>
    Object.assign(source, { healthDays: fn });
  afterAll(() => Object.assign(source, { healthDays: undefined }));

  it("is for the card only, not for the model", async () => {
    const { tools } = await client.listTools();
    const tool = tools.find((t) => t.name === "get_health_data")!;
    expect(tool._meta?.ui).toEqual({ visibility: ["app"] });
  });

  it("shows no value without a source of watch values", async () => {
    withHealth(undefined);
    expect(await health()).toEqual({
      status: "not_connected",
      summary: null,
    });
  });

  it("shows no value without consent", async () => {
    withHealth(async () => ({ status: "no_consent" }));
    expect(await health()).toEqual({ status: "no_consent", summary: null });
  });

  it("asks for the seven local days up to today and summarises them", async () => {
    const asked: string[][] = [];
    withHealth(async (from, to) => {
      asked.push([from, to]);
      return { status: "consented", days: [] };
    });
    const data = await health();
    expect(data.status).toBe("consented");
    const [from, to] = asked[0]!;
    expect(data.summary!.reference_date).toBe(to);
    expect(data.summary!.latest_date).toBeNull();
    expect(data.summary!.avg7.resting_hr_bpm).toBeNull();
    expect(Date.parse(to!) - Date.parse(from!)).toBe(6 * 86_400_000);
  });

  it("reports a failed read as an error, never as empty values", async () => {
    withHealth(async () => {
      throw new Error("boom");
    });
    const result = await call("get_health_data", {});
    expect(result.isError).toBe(true);
  });
});
