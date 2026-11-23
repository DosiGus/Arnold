/**
 * MOB-005: the mobility tools over real Streamable HTTP. Synthetic data only.
 */
import { randomUUID } from "node:crypto";
import type { Server } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import {
  Client,
  StreamableHTTPClientTransport,
  type CallToolResult,
} from "@modelcontextprotocol/client";
import { createHttpApp } from "../src/server/http";
import { createFixtureLogging } from "../src/server/workout/fixture";
import { TOOL_ACCESS } from "../src/server/auth/tool-access";
import {
  LogMobilityResponseSchema,
  MobilityCardViewSchema,
  MobilityOverviewSchema,
  UpdateMobilityProfileResponseSchema,
} from "../src/shared/mobility-contract";

let client: Client | undefined, http: Server | undefined;
async function start() {
  http = createHttpApp({ workoutRuntime: createFixtureLogging() }).listen(
    0,
    "127.0.0.1",
  );
  await new Promise<void>((resolve) => http!.once("listening", resolve));
  client = new Client({ name: "synthetic-mobility-tests", version: "1" });
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
const TZ = "Europe/Berlin";
const rid = () => randomUUID();

const WANTS = {
  wants: true,
  morning: { weekdays: ["mon", "tue", "wed", "thu", "fri"], minutes: 10 },
  sessions: null,
  stiff_areas: ["hips"],
};

describe("mobility tools over real Streamable HTTP", () => {
  it("lists the four tools with their access classes and safety hints", async () => {
    await start();
    const { tools } = await client!.listTools();
    const classes: Record<string, string> = {
      get_mobility_overview: "AUTHENTICATED_READ",
      show_arnold_mobility: "AUTHENTICATED_READ",
      update_mobility_profile: "AUTHENTICATED_WRITE",
      log_mobility: "AUTHENTICATED_WRITE",
    };
    for (const [name, access] of Object.entries(classes)) {
      const tool = tools.find((t) => t.name === name);
      expect(tool, name).toBeTruthy();
      expect(TOOL_ACCESS[name], name).toBe(access);
      expect(tool!.annotations?.readOnlyHint, name).toBe(
        access.endsWith("READ"),
      );
      expect(tool!.annotations?.destructiveHint, name).toBe(false);
      expect(tool!.annotations?.openWorldHint, name).toBe(false);
    }
  });

  it("describes logging without coaching, the pain rule and the plan change", async () => {
    await start();
    const { tools } = await client!.listTools();
    const text = (name: string) =>
      tools.find((t) => t.name === name)!.description!;
    expect(text("log_mobility")).toContain("sofort");
    expect(text("log_mobility")).toContain("ohne Coaching");
    expect(text("log_mobility")).toContain("Schmerzen");
    expect(text("log_mobility")).toContain("keine Diagnose");
    expect(text("update_mobility_profile")).toContain("update_plan_draft");
    expect(text("get_mobility_overview")).toContain("timezone");
  });

  it("overview: not asked, then yes with the answer, then no", async () => {
    await start();
    const overview = async () =>
      MobilityOverviewSchema.parse(
        (await call("get_mobility_overview", { timezone: TZ }))
          .structuredContent,
      );
    const first = await overview();
    expect(first.profile).toEqual({ state: "not_asked", preference: null });
    expect(first.adherence).toMatchObject({ planned_count: 0, ratio: null });
    expect(first.today.items).toEqual([]);

    const yes = UpdateMobilityProfileResponseSchema.parse(
      (
        await call("update_mobility_profile", {
          request_id: rid(),
          preference: WANTS,
        })
      ).structuredContent,
    );
    expect(yes).toMatchObject({ ok: true, replayed: false });
    expect((await overview()).profile.state).toBe("yes");

    await call("update_mobility_profile", {
      request_id: rid(),
      preference: { wants: false },
    });
    expect((await overview()).profile).toEqual({
      state: "no",
      preference: { wants: false },
    });
  });

  it("update_mobility_profile: a repeated request_id is replayed", async () => {
    await start();
    const request_id = rid();
    const args = { request_id, preference: WANTS };
    const first = await call("update_mobility_profile", args);
    const again = await call("update_mobility_profile", args);
    expect(first.isError).toBe(false);
    expect(
      UpdateMobilityProfileResponseSchema.parse(again.structuredContent),
    ).toMatchObject({
      ok: true,
      replayed: true,
    });
    expect((again.content[0] as { text: string }).text).toContain(
      "Bereits bestätigt",
    );
    const other = await call("update_mobility_profile", {
      request_id,
      preference: { wants: false },
    });
    expect(other.isError).toBe(true);
    expect(
      UpdateMobilityProfileResponseSchema.parse(other.structuredContent).error
        ?.code,
    ).toBe("DUPLICATE_OPERATION");
  });

  it("log_mobility: saves at once, replays, asks before a duplicate, then allows it", async () => {
    await start();
    const request_id = rid();
    const args = { request_id, kind: "morning", timezone: TZ, minutes: 8 };
    const first = LogMobilityResponseSchema.parse(
      (await call("log_mobility", args)).structuredContent,
    );
    expect(first).toMatchObject({ ok: true, replayed: false });
    const replay = LogMobilityResponseSchema.parse(
      (await call("log_mobility", args)).structuredContent,
    );
    expect(replay).toMatchObject({
      ok: true,
      replayed: true,
      workout_id: first.workout_id,
    });

    const second = await call("log_mobility", { ...args, request_id: rid() });
    expect(second.isError).toBe(true);
    const refused = LogMobilityResponseSchema.parse(second.structuredContent);
    expect(refused.error).toMatchObject({
      code: "DUPLICATE_MOBILITY",
      details: [first.workout_id],
    });
    expect((second.content[0] as { text: string }).text).toContain(
      "DUPLICATE_MOBILITY",
    );

    const confirmed = LogMobilityResponseSchema.parse(
      (
        await call("log_mobility", {
          ...args,
          request_id: rid(),
          confirm_duplicate: true,
        })
      ).structuredContent,
    );
    expect(confirmed.ok).toBe(true);
    const overview = MobilityOverviewSchema.parse(
      (await call("get_mobility_overview", { timezone: TZ })).structuredContent,
    );
    expect(overview.recent).toHaveLength(2);
    expect(overview.recent[0]).toMatchObject({
      kind: "morning",
      source: "chat",
      timer_s: 480,
    });
  });

  it("log_mobility: a date in the future is refused and nothing is saved", async () => {
    await start();
    const future = new Date(Date.now() + 3 * 86_400_000)
      .toISOString()
      .slice(0, 10);
    const result = await call("log_mobility", {
      request_id: rid(),
      kind: "session",
      timezone: TZ,
      workout_date_local: future,
    });
    expect(result.isError).toBe(true);
    expect(
      LogMobilityResponseSchema.parse(result.structuredContent).error?.code,
    ).toBe("DATE_IN_FUTURE");
    const overview = MobilityOverviewSchema.parse(
      (await call("get_mobility_overview", { timezone: TZ })).structuredContent,
    );
    expect(overview.recent).toEqual([]);
  });

  it("takes no user or tracker id from arguments", async () => {
    await start();
    for (const [name, args] of [
      ["get_mobility_overview", { user_id: "u1" }],
      [
        "update_mobility_profile",
        { request_id: rid(), preference: WANTS, user_id: "u1" },
      ],
      [
        "log_mobility",
        { request_id: rid(), kind: "session", tracker_id: "t1" },
      ],
    ] as const) {
      const failed = await client!
        .callTool({ name, arguments: args })
        .then((r) => (r as CallToolResult).isError === true)
        .catch(() => true);
      expect(failed, name).toBe(true);
    }
  });

  it("an unknown zone fails with a text the model can act on", async () => {
    await start();
    const failed = await client!
      .callTool({
        name: "get_mobility_overview",
        arguments: { timezone: "Mars/Olympus" },
      })
      .then((r) => (r as CallToolResult).isError === true)
      .catch(() => true);
    expect(failed).toBe(true);
  });

  it("show_arnold_mobility opens a card and reads nothing", async () => {
    await start();
    const { tools } = await client!.listTools();
    const tool = tools.find((t) => t.name === "show_arnold_mobility")!;
    expect(JSON.stringify(tool._meta)).toContain("ui://");
    for (const card of [
      "mobility_today",
      "mobility_result",
      "mobility_setup",
    ]) {
      const view = MobilityCardViewSchema.parse(
        (await call("show_arnold_mobility", { card })).structuredContent,
      );
      expect(view).toMatchObject({ card, workout_id: null });
    }
    const withId = MobilityCardViewSchema.parse(
      (
        await call("show_arnold_mobility", {
          card: "mobility_result",
          workout_id: "w-1",
        })
      ).structuredContent,
    );
    expect(withId.workout_id).toBe("w-1");
    const bad = await client!
      .callTool({ name: "show_arnold_mobility", arguments: { card: "nope" } })
      .then((r) => (r as CallToolResult).isError === true)
      .catch(() => true);
    expect(bad).toBe(true);
  });

  it("is published by the default fixture profile as well", async () => {
    http = createHttpApp({ env: {} }).listen(0, "127.0.0.1");
    await new Promise<void>((resolve) => http!.once("listening", resolve));
    client = new Client({ name: "default-profile", version: "1" });
    await client.connect(
      new StreamableHTTPClientTransport(
        new URL(
          `http://127.0.0.1:${(http.address() as { port: number }).port}/mcp`,
        ),
      ),
    );
    const names = (await client.listTools()).tools.map((t) => t.name);
    for (const name of [
      "get_mobility_overview",
      "update_mobility_profile",
      "log_mobility",
      "show_arnold_mobility",
    ])
      expect(names).toContain(name);
  });
});
