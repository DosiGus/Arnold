/**
 * `mark_recap_seen` for a run (UX-014): same tool, no new arguments. An own,
 * completed run is marked once; a planned or unknown one is refused.
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
import { demoHistoryDataset } from "../src/server/plan/demo-history";
import {
  ArnoldDatasetSchema,
  type ArnoldDataset,
} from "../src/shared/arnold-schema-v1";
import { MarkRecapSeenOutputSchema } from "../src/shared/recap-contract";

const STAMP = "2026-11-03T08:00:00Z";
const tech = { created_at_utc: STAMP, updated_at_utc: STAMP, row_revision: 1 };
const workout = (id: string, status: "completed" | "planned") => ({
  workout_id: id,
  workout_date_local: "2026-11-03",
  timezone: "Europe/Berlin",
  started_at_utc: status === "completed" ? STAMP : null,
  ended_at_utc: status === "completed" ? STAMP : null,
  plan_version_id: null,
  session_id: null,
  session_name_snapshot: null,
  status,
  source: "chat" as const,
  notes: null,
  activity_type: "run" as const,
  ...tech,
});
const run = (id: string, done: boolean) => ({
  workout_id: id,
  run_type: "base" as const,
  environment: "outdoor" as const,
  prescription: null,
  rationale: null,
  rules_version: null,
  timer_s: done ? 2700 : null,
  elapsed_s: done ? 2800 : null,
  distance_m: done ? 7000 : null,
  distance_source: done ? ("manual" as const) : null,
  ascent_m: null,
  descent_m: null,
  cadence_spm: null,
  calories_kcal: null,
  te_aerobic: null,
  te_anaerobic: null,
  rpe: null,
  splits_100m: null,
  pause_count: null,
  result_source: done ? ("chat" as const) : null,
  hr_status: done ? ("not_provided" as const) : null,
  hr_avg_bpm: null,
  hr_max_bpm: null,
  hr_zone_seconds: null,
  ...tech,
});
const base = demoHistoryDataset("2026-11-03");
const dataset: ArnoldDataset = ArnoldDatasetSchema.parse({
  ...base,
  workouts: [
    ...base.workouts,
    workout("run-done", "completed"),
    workout("run-plan", "planned"),
  ],
  runs: [...base.runs, run("run-done", true), run("run-plan", false)],
});

let client: Client, http: Server;
const mark = async (workout_id: string) =>
  MarkRecapSeenOutputSchema.parse(
    (
      (await client.callTool({
        name: "mark_recap_seen",
        arguments: { workout_id },
      })) as CallToolResult
    ).structuredContent,
  );

beforeEach(async () => {
  http = createHttpApp({
    workoutRuntime: createFixtureLogging(dataset),
  }).listen(0, "127.0.0.1");
  await new Promise<void>((resolve, reject) => {
    http.once("listening", resolve);
    http.once("error", reject);
  });
  client = new Client({ name: "synthetic-run-recap-tests", version: "1" });
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

describe("mark_recap_seen with a run", () => {
  it("marks a completed run once, then replays", async () => {
    expect(await mark("run-done")).toMatchObject({
      ok: true,
      replayed: false,
    });
    expect(await mark("run-done")).toMatchObject({ ok: true, replayed: true });
  });

  it("refuses a planned run and a stranger's id", async () => {
    expect(await mark("run-plan")).toMatchObject({
      ok: false,
      error: { code: "INVALID_STATUS_TRANSITION" },
    });
    expect(await mark("run-of-someone-else")).toMatchObject({
      ok: false,
      error: { code: "WORKOUT_NOT_FOUND" },
    });
  });
});
