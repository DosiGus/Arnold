import { afterEach, describe, expect, it } from "vitest";
import {
  Client,
  StreamableHTTPClientTransport,
  type CallToolResult,
} from "@modelcontextprotocol/client";
import type { Server } from "node:http";
import { createHttpApp } from "../src/server/http";
import { createFixtureLogging } from "../src/server/workout/fixture";
import {
  RunAnalysisResponseSchema,
  RunProfileResponseSchema,
  RunWriteResponseSchema,
} from "../src/shared/run-contract";

let client: Client | undefined, http: Server | undefined;
async function start(consent = false) {
  http = createHttpApp({
    workoutRuntime: createFixtureLogging(undefined, {
      healthConsent: async () => consent,
    }),
  }).listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => http!.once("listening", resolve));
  client = new Client({ name: "synthetic-run-tests", version: "1" });
  await client.connect(
    new StreamableHTTPClientTransport(
      new URL(
        `http://127.0.0.1:${(http.address() as { port: number }).port}/mcp`,
      ),
    ),
  );
}
afterEach(async () => {
  await client?.close();
  await new Promise<void>((resolve) => {
    http?.close(() => resolve());
    http?.closeAllConnections();
  });
});
const call = async (name: string, args: Record<string, unknown> = {}) =>
  (await client!.callTool({ name, arguments: args })) as CallToolResult;
const write = async (name: string, args: Record<string, unknown>) =>
  RunWriteResponseSchema.parse((await call(name, args)).structuredContent);
const tz = "Europe/Berlin";
const soon = (days: number) =>
  new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
const plan = (request_id: string, extra = {}) =>
  write("plan_run", {
    request_id,
    timezone: tz,
    workout_date_local: soon(3),
    run_type: "base",
    minutes: 45,
    ...extra,
  });

describe("run tools over real Streamable HTTP", () => {
  it("lists the run tools with their classes and tells ChatGPT not to prescribe", async () => {
    await start();
    const { tools } = await client!.listTools();
    for (const name of [
      "get_run_profile",
      "update_run_profile",
      "plan_run",
      "update_planned_run",
      "cancel_planned_run",
      "log_run",
      "rate_run",
    ])
      expect(
        tools.find((t) => t.name === name),
        name,
      ).toBeTruthy();
    expect(tools.find((t) => t.name === "plan_run")!.description).toContain(
      "NIE selbst Tempi",
    );
  });

  it("profile: created, read with derived values, changed with a revision", async () => {
    await start();
    const empty = RunProfileResponseSchema.parse(
      (await call("get_run_profile")).structuredContent,
    );
    expect(empty.profile).toBeNull();
    expect(empty.missing).toContain("run_profile");
    const made = await write("update_run_profile", {
      request_id: "p1",
      goal: "10k",
      running_experience_months: 30,
      base_minutes_per_week: 300,
      reference: {
        distance_m: 5000,
        time_s: 1500,
        date: new Date().toISOString().slice(0, 10),
        source: "race",
      },
    });
    expect(made.ok).toBe(true);
    const got = RunProfileResponseSchema.parse(
      (await call("get_run_profile")).structuredContent,
    );
    expect(got.profile).toMatchObject({ running_experience_months: 30 });
    expect(got.derived.experience).toBe("advanced");
    expect(got.derived.reference_valid).toBe(true);
    const stale = await write("update_run_profile", {
      request_id: "p2",
      expected_row_revision: 99,
      runs_per_week: 4,
    });
    expect(stale.error?.code).toBe("REVISION_CONFLICT");
  });

  it("plan_run: Arnold prescribes, replay is identical, other content is DUPLICATE_OPERATION", async () => {
    await start();
    const first = await plan("r1");
    expect(first.error).toBeNull();
    expect(first.result!.run!.status).toBe("planned");
    expect(first.result!.run!.planned!.total_s).toBeGreaterThan(0);
    expect(first.result!.rationale.length).toBeGreaterThan(0);
    const again = await plan("r1");
    expect(again.replayed).toBe(true);
    expect(again.result).toEqual(first.result);
    const other = await plan("r1", { minutes: 30 });
    expect(other.error?.code).toBe("DUPLICATE_OPERATION");
    const twin = await plan("r2");
    expect(twin.error?.code).toBe("DUPLICATE_WORKOUT");
    expect((await plan("r3", { confirm_duplicate: true })).ok).toBe(true);
  });

  it("plan_run: invalid input and a past date are refused", async () => {
    await start();
    const both = await call("plan_run", {
      request_id: "v1",
      timezone: tz,
      run_type: "base",
      minutes: 5,
      meters: 1000,
    });
    expect(both.isError).toBe(true);
    expect(
      (await plan("v2", { workout_date_local: "2020-01-01" })).error?.code,
    ).toBe("VALIDATION_ERROR");
    expect(
      (await plan("v3", { run_type: "hills", environment: "treadmill" })).ok,
    ).toBeDefined();
  });

  it("update and cancel a planned run (revision checked)", async () => {
    await start();
    const run = (await plan("u1")).result!.run!;
    const moved = await write("update_planned_run", {
      request_id: "u2",
      workout_id: run.workout_id,
      expected_row_revision: run.row_revision,
      timezone: tz,
      workout_date_local: soon(4),
    });
    expect(moved.ok).toBe(true);
    expect(moved.result!.replaced_workout_id).toBe(run.workout_id);
    const old = await write("cancel_planned_run", {
      request_id: "u3",
      workout_id: run.workout_id,
      expected_row_revision: run.row_revision,
    });
    expect(old.error?.code).toBe("REVISION_CONFLICT");
    const next = moved.result!.run!;
    const cancelled = await write("cancel_planned_run", {
      request_id: "u4",
      workout_id: next.workout_id,
      expected_row_revision: next.row_revision,
    });
    expect(cancelled.result!.run!.status).toBe("cancelled");
  });

  it("log_run: future date, missing environment, free run, rate_run", async () => {
    await start();
    const base = {
      timezone: tz,
      timer_s: 2700,
      distance_m: 7000,
      environment: "outdoor",
    };
    expect(
      (
        await write("log_run", {
          request_id: "l1",
          workout_date_local: "2099-01-05",
          ...base,
        })
      ).error?.code,
    ).toBe("DATE_IN_FUTURE");
    const noEnv = await write("log_run", {
      request_id: "l2",
      workout_date_local: "2026-01-05",
      timezone: tz,
      timer_s: 2700,
      distance_m: 7000,
    });
    expect(noEnv.error?.code).toBe("VALIDATION_ERROR");
    const done = await write("log_run", {
      request_id: "l3",
      workout_date_local: "2026-01-05",
      ...base,
      laps: [{ timer_s: 390, distance_m: 1000 }],
    });
    expect(done.ok).toBe(true);
    expect(done.result!.run!.status).toBe("completed");
    expect(done.result!.run!.result!.pace_s_per_km).toBe(386);
    expect(done.result!.run!.result!.lap_count).toBe(1);
    expect(done.result!.run!.unknown.map((u) => u.field)).toContain("rpe");
    const rated = await write("rate_run", {
      request_id: "l4",
      workout_id: done.result!.run!.workout_id,
      rpe: 4,
    });
    expect(rated.result!.run!.result!.rpe).toBe(4);
    const dup = await write("log_run", {
      request_id: "l5",
      workout_date_local: "2026-01-05",
      ...base,
    });
    expect(dup.error?.code).toBe("DUPLICATE_WORKOUT");
  });

  it("log_run completes a planned run and drops heart rate without consent", async () => {
    await start(false);
    const day = new Date().toISOString().slice(0, 10);
    const planned = (await plan("c1", { workout_date_local: day })).result!
      .run!;
    const done = await write("log_run", {
      request_id: "c2",
      timezone: "UTC",
      workout_date_local: day,
      planned_workout_id: planned.workout_id,
      timer_s: 2700,
      distance_m: 7000,
      hr_avg_bpm: 140,
      hr_max_bpm: 160,
    });
    expect(done.ok).toBe(true);
    expect(done.result!.run!.workout_id).toBe(planned.workout_id);
    expect(done.result!.run!.status).toBe("completed");
    expect(done.result!.hr_discarded).toBe(true);
    expect(done.result!.run!.result!.hr_status).toBe("no_consent");
    expect(done.result!.run!.result!.hr_avg_bpm).toBeNull();
  });

  it("log_run stores heart rate with consent", async () => {
    await start(true);
    const done = await write("log_run", {
      request_id: "h1",
      timezone: tz,
      workout_date_local: "2026-01-05",
      environment: "outdoor",
      timer_s: 2700,
      distance_m: 7000,
      hr_avg_bpm: 140,
      hr_max_bpm: 160,
    });
    expect(done.result!.hr_discarded).toBe(false);
    expect(done.result!.run!.result!.hr_avg_bpm).toBe(140);
  });
  it("get_run_analysis: run, week and four weeks; unknown stays unknown with a reason", async () => {
    await start();
    const day = soon(-1);
    const done = await write("log_run", {
      request_id: "a1",
      timezone: tz,
      workout_date_local: day,
      environment: "outdoor",
      timer_s: 2700,
      distance_m: 7000,
    });
    const id = done.result!.run!.workout_id;
    const one = RunAnalysisResponseSchema.parse(
      (
        await call("get_run_analysis", {
          view: "run",
          workout_id: id,
          timezone: tz,
        })
      ).structuredContent,
    );
    expect(one.run!.view.workout_id).toBe(id);
    const m = one.run!.metrics as Record<string, any>;
    expect(m.pace_s_per_km.value).toBeCloseTo(385.71, 1);
    // no rpe, no heart rate: unknown with a reason, never 0
    expect(m.load.srpe.value).toBeNull();
    expect(m.load.srpe.reason).toBe("rpe_missing");
    expect(m.decoupling.value).toBeNull();
    const week = RunAnalysisResponseSchema.parse(
      (
        await call("get_run_analysis", {
          view: "week",
          date: day,
          timezone: tz,
        })
      ).structuredContent,
    );
    expect(week.weeks).toHaveLength(1);
    const running = week.weeks[0]!.running as Record<string, any>;
    expect(running.run_count).toBe(1);
    expect(running.distance_m.value).toBe(7000);
    expect(running.load_srpe).toMatchObject({
      value: null,
      known: 0,
      total: 1,
    });
    expect(week.weeks[0]!.strength).toEqual({ workouts: 0, working_sets: 0 });
    expect(week.load_ratio).toMatchObject({ value: null });
    const four = RunAnalysisResponseSchema.parse(
      (await call("get_run_analysis", { view: "four_weeks", timezone: tz }))
        .structuredContent,
    );
    expect(four.weeks).toHaveLength(4);
    expect(four.run).toBeNull();
  });

  it("get_run_analysis: missing id is refused, unknown run is not found", async () => {
    await start();
    expect(
      (await call("get_run_analysis", { view: "run", timezone: tz })).isError,
    ).toBe(true);
    const missing = await call("get_run_analysis", {
      view: "run",
      workout_id: "01900000-0000-7000-8000-000000000000",
      timezone: tz,
    });
    expect(missing.isError).toBe(true);
    expect(JSON.stringify(missing.content)).toContain("WORKOUT_NOT_FOUND");
  });
  it("void_workout covers a completed run and the analysis then skips it", async () => {
    await start();
    const done = await write("log_run", {
      request_id: "vw1",
      timezone: tz,
      workout_date_local: soon(-2),
      environment: "outdoor",
      timer_s: 1800,
      distance_m: 5000,
    });
    const run = done.result!.run!;
    const voided = await call("void_workout", {
      request_id: "vw2",
      workout_id: run.workout_id,
      expected_row_revision: run.row_revision,
      correction_reason: "Doppelt erfasst",
    });
    expect(voided.isError).toBeFalsy();
    const week = RunAnalysisResponseSchema.parse(
      (
        await call("get_run_analysis", {
          view: "week",
          date: soon(-2),
          timezone: tz,
        })
      ).structuredContent,
    );
    expect((week.weeks[0]!.running as Record<string, any>).run_count).toBe(0);
  });
  it("log_run replaces a saved run (revision needed); the old one is voided", async () => {
    await start();
    const base = {
      timezone: tz,
      workout_date_local: soon(-3),
      environment: "outdoor",
    };
    const first = (
      await write("log_run", {
        request_id: "rp1",
        ...base,
        timer_s: 1800,
        distance_m: 5000,
      })
    ).result!.run!;
    const noRevision = await call("log_run", {
      request_id: "rp2",
      ...base,
      timer_s: 1900,
      distance_m: 5100,
      replaces_workout_id: first.workout_id,
    });
    expect(noRevision.isError).toBe(true);
    const fixed = await write("log_run", {
      request_id: "rp3",
      ...base,
      timer_s: 1900,
      distance_m: 5100,
      replaces_workout_id: first.workout_id,
      expected_row_revision: first.row_revision,
    });
    expect(fixed.ok).toBe(true);
    expect(fixed.result!.replaced_workout_id).toBe(first.workout_id);
    const week = RunAnalysisResponseSchema.parse(
      (
        await call("get_run_analysis", {
          view: "week",
          date: base.workout_date_local,
          timezone: tz,
        })
      ).structuredContent,
    );
    expect((week.weeks[0]!.running as Record<string, any>).run_count).toBe(1);
  });
});
