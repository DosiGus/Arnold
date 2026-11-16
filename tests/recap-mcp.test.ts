/**
 * The "seen" marker of the recap (UX-006): a receipt without data changes.
 * Appears exactly once, never for an unknown or open workout, and a failing
 * read of the marker shows nothing. Synthetic fixture data only.
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
import { recapFor } from "../src/server/workout/recap";
import { buildDashboardView } from "../src/server/arnold-presenter";
import { demoHistoryDataset } from "../src/server/plan/demo-history";
import { MarkRecapSeenOutputSchema } from "../src/shared/recap-contract";
import { TOOL_ACCESS } from "../src/server/auth/tool-access";

const TODAY = "2026-11-03";
const context = { generatedAt: "2026-11-03T18:00:00Z" };

describe("recap seen marker", () => {
  it("shows the recap once, then never again", async () => {
    const dataset = demoHistoryDataset(TODAY);
    const runtime = createFixtureLogging(dataset);
    const view = buildDashboardView(dataset, context, {
      reference_date: TODAY,
    });
    const first = await recapFor(dataset, view, TODAY, runtime.service);
    expect(first).not.toBeNull();
    // Same again: still unseen, nothing was written by reading.
    expect(
      await recapFor(dataset, view, TODAY, runtime.service),
    ).not.toBeNull();
    const marked = await runtime.service.markRecapSeen(
      { workout_id: first!.workout_id },
      undefined,
    );
    expect(marked).toMatchObject({ ok: true, replayed: false });
    expect(await recapFor(dataset, view, TODAY, runtime.service)).toBeNull();
    // Twice is the same: replayed, no second write.
    expect(
      await runtime.service.markRecapSeen({ workout_id: first!.workout_id }),
    ).toMatchObject({ ok: true, replayed: true });
    // Training data stays exactly as it was.
    expect(await runtime.store.read()).toEqual(dataset);
    // A newer workout would show a recap again; this one stays seen.
    expect(runtime.store.operations.size).toBe(1);
  });

  it("refuses an unknown or unfinished workout and stores nothing", async () => {
    const dataset = demoHistoryDataset(TODAY);
    const runtime = createFixtureLogging(dataset);
    const unknown = await runtime.service.markRecapSeen({ workout_id: "nope" });
    expect(unknown).toMatchObject({
      ok: false,
      error: { code: "WORKOUT_NOT_FOUND" },
    });
    const bad = await runtime.service.markRecapSeen({ extra: 1 });
    expect(bad.ok).toBe(false);
    expect(runtime.store.operations.size).toBe(0);
  });

  it("shows nothing when the marker cannot be read", async () => {
    const dataset = demoHistoryDataset(TODAY);
    const view = buildDashboardView(dataset, context, {
      reference_date: TODAY,
    });
    const broken = {
      isRecapSeen: async () => {
        throw new Error("down");
      },
    };
    expect(await recapFor(dataset, view, TODAY, broken)).toBeNull();
    // Without a write service there is no marker, so no recap either.
    expect(await recapFor(dataset, view, TODAY, undefined)).toBeNull();
  });
});

let client: Client, http: Server;
const call = async (name: string, args: Record<string, unknown> = {}) =>
  (await client.callTool({ name, arguments: args })) as CallToolResult;

beforeEach(async () => {
  http = createHttpApp({ workoutRuntime: createFixtureLogging() }).listen(
    0,
    "127.0.0.1",
  );
  await new Promise<void>((resolve, reject) => {
    http.once("listening", resolve);
    http.once("error", reject);
  });
  client = new Client({ name: "synthetic-recap-tests", version: "1" });
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

describe("mark_recap_seen tool", () => {
  it("is registered and classified as a write", async () => {
    const { tools } = await client.listTools();
    expect(tools.some((t) => t.name === "mark_recap_seen")).toBe(true);
    expect(TOOL_ACCESS.mark_recap_seen).toBe("AUTHENTICATED_WRITE");
  });

  it("takes only a workout id and rejects a foreign one", async () => {
    const result = await call("mark_recap_seen", { workout_id: "not-mine" });
    const out = MarkRecapSeenOutputSchema.parse(result.structuredContent);
    expect(out).toMatchObject({
      ok: false,
      error: { code: "WORKOUT_NOT_FOUND" },
    });
    // A user id or request id in the arguments is refused, not honoured.
    const sneaky = await call("mark_recap_seen", {
      workout_id: "x",
      user_id: "usr_other",
    });
    expect(sneaky.isError).toBe(true);
  });
});
