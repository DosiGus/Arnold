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
  responses = new Map<string, () => ToolResult>();
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

describe("replayed tool results on reopening a chat", () => {
  it("revalidates against the server instead of trusting chat history", async () => {
    const stale = v2Payload("2026-10-01T08:00:00Z");
    const fresh = v2Payload("2026-10-25T09:00:00Z");
    fake.responses.set("get_arnold_dashboard_v2", () => okResult(fresh));
    const { client, payloads, staleFlags } = await bootClient();
    await client.connect();

    // The host replays the result the conversation was originally opened with.
    fake.ontoolresult!(okResult(stale));
    await vi.waitFor(() => expect(payloads.length).toBe(1));

    // What reached the interface is the server's answer, not the replay.
    expect(fake.calls.map((c) => c.name)).toEqual(["get_arnold_dashboard_v2"]);
    expect(payloads[0].contract).toBe("v2");
    expect(asV2(payloads[0]).source.generated_at).toBe("2026-10-25T09:00:00Z");
    expect(staleFlags.at(-1)).toBe(false);
  });

  it("falls back to the replayed payload only while marking it stale", async () => {
    const stale = v2Payload("2026-10-01T08:00:00Z");
    fake.responses.set("get_arnold_dashboard_v2", () => {
      throw new Error("Google Sheets ist vorübergehend nicht verfügbar.");
    });
    const { client, payloads, errors, staleFlags } = await bootClient();
    await client.connect();

    fake.ontoolresult!(okResult(stale));
    await vi.waitFor(() => expect(payloads.length).toBe(1));

    // The old payload is shown — there is nothing else — but never as current.
    expect(asV2(payloads[0]).source.generated_at).toBe("2026-10-01T08:00:00Z");
    expect(staleFlags.at(-1)).toBe(true);
    expect(errors.join(" ")).toContain("Aktualisierung fehlgeschlagen");
  });

  it("clears the stale marking once a later refresh succeeds", async () => {
    const stale = v2Payload("2026-10-01T08:00:00Z");
    const fresh = v2Payload("2026-10-25T09:00:00Z");
    let reachable = false;
    fake.responses.set("get_arnold_dashboard_v2", () => {
      if (!reachable) throw new Error("Google Sheets nicht erreichbar.");
      return okResult(fresh);
    });
    const { client, payloads, staleFlags } = await bootClient();
    await client.connect();

    fake.ontoolresult!(okResult(stale));
    await vi.waitFor(() => expect(staleFlags.at(-1)).toBe(true));

    // The user presses "Aktualisieren" once the source is reachable again; the
    // banner must disappear rather than outlive the problem it described.
    reachable = true;
    await client.call("get_arnold_dashboard_v2");
    expect(staleFlags.at(-1)).toBe(false);
    expect(asV2(payloads.at(-1)!).source.generated_at).toBe(
      "2026-10-25T09:00:00Z",
    );
  });

  it("applies the guard only to the first result, not to later ones", async () => {
    const first = v2Payload("2026-10-01T08:00:00Z");
    const second = v2Payload("2026-10-25T10:00:00Z");
    fake.responses.set("get_arnold_dashboard_v2", () =>
      okResult(v2Payload("2026-10-25T09:00:00Z")),
    );
    const { client, payloads } = await bootClient();
    await client.connect();

    fake.ontoolresult!(okResult(first));
    await vi.waitFor(() => expect(payloads.length).toBe(1));

    // A later result is a live answer to a live call and is published directly.
    fake.ontoolresult!(okResult(second));
    await vi.waitFor(() => expect(payloads.length).toBe(2));
    expect(asV2(payloads[1]).source.generated_at).toBe("2026-10-25T10:00:00Z");
    // Still exactly one revalidation call.
    expect(fake.calls).toHaveLength(1);
  });

  it("surfaces a replayed error result instead of re-asking", async () => {
    const { client, errors } = await bootClient();
    await client.connect();
    fake.ontoolresult!({
      content: [{ type: "text", text: "Google-Anmeldung fehlt." }],
      isError: true,
    });
    await vi.waitFor(() => expect(errors.length).toBe(1));
    expect(errors[0]).toContain("Google-Anmeldung fehlt.");
    expect(fake.calls).toHaveLength(0);
  });
});

describe("host lifecycle", () => {
  it("adopts the host theme on connect and on change", async () => {
    const { client } = await bootClient();
    const themes: string[] = [];
    client.onTheme = (theme) => themes.push(theme);
    await client.connect();
    expect(themes).toEqual(["light"]);
    fake.onhostcontextchanged!({ theme: "dark" });
    expect(themes).toEqual(["light", "dark"]);
  });

  it("reports a cancelled tool call to the interface", async () => {
    const { client, errors } = await bootClient();
    await client.connect();
    fake.ontoolcancelled!({ reason: "Vom Nutzer abgebrochen." });
    expect(errors).toEqual(["Vom Nutzer abgebrochen."]);
  });

  it("detaches its callbacks on teardown", async () => {
    const { client } = await bootClient();
    await client.connect();
    await fake.onteardown!();
    expect(client.onPayload).toBeUndefined();
    expect(client.onTheme).toBeUndefined();
  });

  it("ignores a payload that matches neither contract", async () => {
    const { client, payloads, errors } = await bootClient();
    await client.connect();
    fake.ontoolresult!(okResult({ unexpected: true }));
    expect(payloads).toEqual([]);
    expect(errors).toEqual([]);
  });
});
