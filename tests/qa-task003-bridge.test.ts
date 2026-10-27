/**
 * Regression tests for the MCP Apps bridge lifecycle.
 *
 * The behaviour protected here was a real bug: when a ChatGPT conversation is
 * reopened, the host replays the original `show_arnold_dashboard` result from
 * chat history. Mounting that payload as the current state showed data from
 * days ago as if it were live. The fix is in `ArnoldClient.ontoolresult`: the
 * first replayed result is never published directly — the client re-asks the
 * server first, and only falls back to the replayed payload if that fails, in
 * which case it marks it as stale so the interface can say so.
 *
 * These tests drive that logic through a fake `App` bridge, so they fail if the
 * guard is removed, if it is applied to the wrong contract, or if a fallback
 * ever happens silently.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildDashboardView } from "../src/server/arnold-presenter";
import { fullDataset } from "./fixtures/arnold-dashboard";
import type { ArnoldPayload } from "../src/ui/client";

type ToolResult = {
  structuredContent?: unknown;
  content: { type: "text"; text: string }[];
  isError?: boolean;
};

/** Stand-in for the official MCP Apps bridge; records every server call. */
class FakeApp {
  ontoolresult?: (result: ToolResult) => void;
  ontoolcancelled?: (payload: { reason?: string }) => void;
  onhostcontextchanged?: (context: { theme?: "light" | "dark" }) => void;
  onteardown?: () => Promise<unknown>;
  onerror?: (error: Error) => void;
  readonly calls: { name: string; arguments: unknown }[] = [];
  /** Replies queued per tool name; a thrown value simulates a failing call. */
  responses = new Map<string, () => ToolResult | Promise<ToolResult>>();
  connect = vi.fn(async () => {});
  close = vi.fn(async () => {});
  getHostContext = () => ({ theme: "light" as const });
  async callServerTool(request: { name: string; arguments: unknown }) {
    this.calls.push(request);
    const handler = this.responses.get(request.name);
    if (!handler) throw new Error(`Unerwarteter Tool-Aufruf: ${request.name}`);
    return handler();
  }
}

let fake: FakeApp;

vi.mock("@modelcontextprotocol/ext-apps", () => ({
  App: class {
    constructor() {
      return fake as unknown as object;
    }
  },
}));

/** Narrows a published payload to the v2 contract so its fields are typed. */
function asV2(payload: ArnoldPayload) {
  if (payload.contract !== "v2")
    throw new Error(
      `Erwartet wurde der v2-Vertrag, erhalten: ${payload.contract}`,
    );
  return payload.dashboard;
}
const okResult = (content: unknown): ToolResult => ({
  structuredContent: content,
  content: [{ type: "text", text: "ok" }],
});

/** A v2 payload with a distinguishable workout count and timestamp. */
function v2Payload(generatedAt: string) {
  return buildDashboardView(fullDataset(), { generatedAt });
}

/** A v1 demo payload, to prove the guard is contract-aware. */
const v1Payload = {
  synthetic: true,
  source: "local_demo" as const,
  totals: {
    workouts: 1,
    sets: 1,
    volume: 100,
    daysPerWeek: 1,
    trainingDays: 1,
  },
  period: { start: "2026-10-01", end: "2026-10-01" },
  exercises: [{ id: "bench-press", name: "Bankdrücken", split: "Push" }],
  workouts: [],
  weeks: [],
  records: [],
};

async function bootClient() {
  // Imported lazily so the mocked bridge is in place first.
  const { ArnoldClient } = await import("../src/ui/client");
  const client = new ArnoldClient();
  const payloads: ArnoldPayload[] = [];
  const errors: string[] = [];
  const staleFlags: boolean[] = [];
  client.onPayload = (payload) => payloads.push(payload);
  client.onError = (message) => errors.push(message);
  client.onStale = (stale) => staleFlags.push(stale);
  return { client, payloads, errors, staleFlags };
}

beforeEach(() => {
  fake = new FakeApp();
  vi.stubGlobal("window", { parent: {} });
  vi.resetModules();
});

describe("independent Task 003 stale-response race", () => {
  it("T3-08 a slow first revalidation cannot overwrite a newer host payload", async () => {
    const historical = v2Payload("2026-10-01T08:00:00Z");
    const earlierRead = v2Payload("2026-10-25T09:00:00Z");
    const newer = v2Payload("2026-10-25T10:00:00Z");
    let complete!: (result: ToolResult) => void;
    fake.responses.set(
      "get_arnold_dashboard_v2",
      () =>
        new Promise((resolve) => {
          complete = resolve;
        }),
    );
    const { client, payloads, staleFlags } = await bootClient();
    await client.connect();
    fake.ontoolresult!(okResult(historical));
    fake.ontoolresult!(okResult(newer));
    expect(asV2(payloads.at(-1)!).source.generated_at).toBe(
      "2026-10-25T10:00:00Z",
    );
    complete(okResult(earlierRead));
    // A superseded response is suppressed completely, not re-published.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(payloads).toHaveLength(1);
    expect(staleFlags.at(-1)).toBe(false);
    expect(asV2(payloads.at(-1)!).source.generated_at).toBe(
      "2026-10-25T10:00:00Z",
    );
  });
});
