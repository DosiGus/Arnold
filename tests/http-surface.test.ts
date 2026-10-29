/**
 * The HTTP surface of a server started with no configuration at all.
 *
 * With nothing set, Arnold runs the synthetic fixture profile: invented data in
 * memory, every tool registered, no Google account involved. These tests pin
 * that default, the routes around `/mcp`, and the host/origin protection that
 * every deployment relies on.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  Client,
  StreamableHTTPClientTransport,
} from "@modelcontextprotocol/client";
import { RESOURCE_MIME_TYPE } from "@modelcontextprotocol/ext-apps/server";
import { request, type Server } from "node:http";
import { createHttpApp } from "../src/server/http";

let client: Client;
let http: Server;
let base: string;

beforeAll(async () => {
  http = createHttpApp({ env: {} }).listen(0, "127.0.0.1");
  await new Promise<void>((resolve, reject) => {
    http.once("listening", resolve);
    http.once("error", reject);
  });
  base = `http://127.0.0.1:${(http.address() as { port: number }).port}`;
  client = new Client({ name: "arnold-http-surface", version: "1.0.0" });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(`${base}/mcp`)),
  );
});
afterAll(async () => {
  await client?.close();
  await new Promise<void>((resolve) => {
    http?.close(() => resolve());
    http?.closeAllConnections();
  });
});

describe("default synthetic profile", () => {
  it("reports itself as synthetic", async () => {
    const health = await (await fetch(`${base}/health`)).json();
    expect(health.status).toBe("ok");
    expect(health.synthetic).toBe(true);
  });

  it("registers the dashboard, workout, plan and onboarding tools", async () => {
    const names = (await client.listTools()).tools.map((tool) => tool.name);
    for (const name of [
      "show_arnold_dashboard",
      "get_arnold_dashboard",
      "start_workout",
      "log_workout_sets",
      "create_training_plan",
      "start_arnold_onboarding",
    ])
      expect(names).toContain(name);
    expect(names).not.toContain("log_demo_set");
    expect(names).not.toContain("reset_demo_data");
  });

  it("serves the dashboard as a self-contained MCP Apps resource", async () => {
    const tool = (await client.listTools()).tools.find(
      (t) => t.name === "show_arnold_dashboard",
    );
    const uri = (tool?._meta?.ui as { resourceUri?: string } | undefined)
      ?.resourceUri;
    expect(uri).toBeTruthy();
    const resource = (await client.readResource({ uri: uri! })).contents[0]!;
    expect(resource.mimeType).toBe(RESOURCE_MIME_TYPE);
    expect("text" in resource && resource.text).toContain("<html");
  });
});

describe("routes and request protection", () => {
  it("serves health, preview and host", async () => {
    expect((await fetch(`${base}/preview`)).status).toBe(200);
    expect((await fetch(`${base}/host`)).status).toBe(200);
    expect(
      (await fetch(`${base}/.well-known/oauth-authorization-server`)).status,
    ).toBe(404);
  });

  it("rejects untrusted origins", async () => {
    const response = await fetch(`${base}/mcp`, {
      method: "OPTIONS",
      headers: { Origin: "https://untrusted.example" },
    });
    expect(response.status).toBe(403);
  });

  it("rejects untrusted hosts", async () => {
    // Fetch implementations may normalize Host; raw HTTP proves the server-side check.
    const status = await new Promise<number | undefined>((resolve, reject) => {
      request(
        `${base}/health`,
        { agent: false, headers: { Host: "untrusted.example" } },
        (res) => {
          res.resume();
          res.on("end", () => resolve(res.statusCode));
        },
      )
        .on("error", reject)
        .end();
    });
    expect(status).toBe(403);
  });
});

describe("removed profiles", () => {
  it.each(["demo", "google_sheets"])("refuses STORAGE_MODE=%s", (mode) => {
    expect(() => createHttpApp({ env: { STORAGE_MODE: mode } })).toThrow(
      /arnold_fixture, arnold_sheets oder arnold_connected/,
    );
  });
});
