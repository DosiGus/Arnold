/**
 * B10: every tool tells the client whether it only reads, whether it can
 * destroy something and whether it reaches outside Arnold. A missing hint
 * fails here, in every server profile.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  Client,
  StreamableHTTPClientTransport,
} from "@modelcontextprotocol/client";
import type { Server } from "node:http";
import { createHttpApp } from "../src/server/http";
import { TOOL_ACCESS } from "../src/server/auth/tool-access";
import { missingHints } from "./fixtures/tool-hints";

let http: Server;
let client: Client;

beforeAll(async () => {
  http = createHttpApp({ env: {} }).listen(0, "127.0.0.1");
  await new Promise<void>((resolve, reject) => {
    http.once("listening", resolve);
    http.once("error", reject);
  });
  client = new Client({ name: "annotations", version: "1" });
  await client.connect(
    new StreamableHTTPClientTransport(
      new URL(
        `http://127.0.0.1:${(http.address() as { port: number }).port}/mcp`,
      ),
    ),
  );
});
afterAll(async () => {
  await client?.close();
  await new Promise<void>((resolve) => {
    http?.close(() => resolve());
    http?.closeAllConnections();
  });
});

describe("tool safety hints (default profile)", () => {
  it("sets readOnlyHint, destructiveHint and openWorldHint on every tool", async () => {
    const { tools } = await client.listTools();
    expect(tools.length).toBeGreaterThan(20);
    expect(missingHints(tools)).toEqual([]);
  });

  it("never marks a read-only tool as destructive", async () => {
    const { tools } = await client.listTools();
    for (const tool of tools)
      if (tool.annotations?.readOnlyHint)
        expect(tool.annotations.destructiveHint, tool.name).toBe(false);
  });

  it("covers every classified tool somewhere", async () => {
    const { tools } = await client.listTools();
    const listed = new Set(tools.map((tool) => tool.name));
    // The account tools exist only in the database profile.
    const connectedOnly = ["delete_arnold_account", "get_arnold_stored_data"];
    expect(
      Object.keys(TOOL_ACCESS).filter(
        (name) => !listed.has(name) && !connectedOnly.includes(name),
      ),
    ).toEqual([]);
  });
});
