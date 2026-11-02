/**
 * B1: request content never reaches the server log.
 *
 * A body parser error quotes the body it could not parse. Logging
 * `error.message` therefore copied user text (set notes, plan names, tokens)
 * into Cloud Logging. Every log sink is captured here and searched for a
 * marker that only exists in the request.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Server } from "node:http";
import { createHttpApp } from "../src/server/http";
import {
  describeErrorForLog,
  logToolCall,
  safeCode,
} from "../src/server/tool-log";

const MARKER = "ZEBRA";

let http: Server;
let base: string;
const lines: string[] = [];

beforeAll(async () => {
  vi.stubEnv("ARNOLD_TOOL_LOG", "json");
  for (const method of ["log", "error", "warn", "info", "debug"] as const)
    vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
      lines.push(args.map((arg) => String(arg)).join(" "));
    });
  vi.spyOn(process.stdout, "write").mockImplementation((chunk: unknown) => {
    lines.push(String(chunk));
    return true;
  });
  vi.spyOn(process.stderr, "write").mockImplementation((chunk: unknown) => {
    lines.push(String(chunk));
    return true;
  });
  http = createHttpApp({ env: {} }).listen(0, "127.0.0.1");
  await new Promise<void>((resolve, reject) => {
    http.once("listening", resolve);
    http.once("error", reject);
  });
  base = `http://127.0.0.1:${(http.address() as { port: number }).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => {
    http?.close(() => resolve());
    http?.closeAllConnections();
  });
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

const post = (body: string) =>
  fetch(`${base}/mcp`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
    },
    body,
  });

describe("server log privacy", () => {
  it("logs broken JSON by type and status only", async () => {
    const before = lines.length;
    // V8 quotes the start of the body: Unexpected token 'Z', "{"x":ZEBRA"...
    const response = await post(`{"x":${MARKER}}`);
    expect(response.status).toBe(400);
    const text = await response.text();
    expect(text).not.toContain(MARKER);
    const written = lines.slice(before);
    expect(written.length).toBeGreaterThan(0);
    expect(written.join("\n")).not.toContain(MARKER);
    expect(written.join("\n")).toContain("entity.parse.failed");
  });

  it("keeps the marker out of the log for valid JSON with a bad tool call", async () => {
    const before = lines.length;
    await post(
      JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: {
          name: "log_workout_sets",
          arguments: { request_id: MARKER, notes: MARKER },
        },
      }),
    );
    expect(lines.slice(before).join("\n")).not.toContain(MARKER);
  });

  it("never logs an error message", () => {
    const error = Object.assign(new SyntaxError(`Unexpected token ${MARKER}`), {
      type: "entity.parse.failed",
      status: 400,
      body: MARKER,
    });
    expect(describeErrorForLog(error)).toEqual({
      type: "entity.parse.failed",
      status: 400,
    });
    expect(
      JSON.stringify(
        describeErrorForLog(new Error(`Datenbank sagt ${MARKER}`)),
      ),
    ).not.toContain(MARKER);
  });

  it("refuses free text as a tool log code", () => {
    expect(safeCode("STORAGE_UNAVAILABLE")).toBe("STORAGE_UNAVAILABLE");
    expect(safeCode(`invalid ${MARKER}`)).toBe("unlabelled");
    const before = lines.length;
    logToolCall({
      tool: "start_workout",
      access: "AUTHENTICATED_WRITE",
      outcome: "thrown",
      ms: 1,
      code: `boom ${MARKER}`,
    });
    expect(lines.slice(before).join("\n")).not.toContain(MARKER);
  });
});
