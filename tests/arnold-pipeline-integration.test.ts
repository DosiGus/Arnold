/**
 * The real pipeline, end to end, with only Google itself replaced.
 *
 * This is the test that was missing. Every other Arnold test substitutes
 * `StaticArnoldDataSource`, which replaces the *source* and therefore skips the
 * source→adapter boundary entirely. That is how a configuration bug could make
 * the production mode unstartable while 366 tests stayed green.
 *
 * Here the seam is one level lower: the injectable
 * `ArnoldSheetsReadTransport` — the same seam Task 001 built for exactly this
 * purpose. Everything above it is the real code path:
 *
 *   createArnoldSource / ArnoldSheetsDataSource
 *     -> ArnoldSheetsReadAdapter (strict option schema, grid parsing, Zod)
 *     -> ArnoldDataset
 *     -> analytics engine
 *     -> presenter
 *     -> MCP tools over Streamable HTTP
 *
 * No network, no credentials, no real file.
 */
import { afterEach, describe, expect, it } from "vitest";
import {
  Client,
  StreamableHTTPClientTransport,
  type CallToolResult,
} from "@modelcontextprotocol/client";
import { type Server } from "node:http";
import { createHttpApp } from "../src/server/http";
import { createArnoldSource } from "../src/server/storage-config";
import {
  ArnoldSheetsDataSource,
  ArnoldSourceError,
} from "../src/server/arnold-source";
import { ArnoldDashboardViewSchema } from "../src/shared/arnold-view";
import {
  emptyHistory,
  FakeArnoldSheets,
  fixtureFileId,
  setConfig,
  templateTables,
} from "./fixtures/arnold-v1";

const ENV = {
  STORAGE_MODE: "arnold_sheets",
  MCP_ACCESS: "private",
  ARNOLD_SPREADSHEET_ID: fixtureFileId,
} as unknown as NodeJS.ProcessEnv;

let http: Server | undefined;
afterEach(async () => {
  if (http) {
    const server = http;
    http = undefined;
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
      server.closeAllConnections();
    });
  }
});

async function connect(source: ArnoldSheetsDataSource) {
  http = createHttpApp({ arnoldSource: source }).listen(0, "127.0.0.1");
  await new Promise<void>((resolve, reject) => {
    http!.once("listening", resolve);
    http!.once("error", reject);
  });
  const port = (http.address() as { port: number }).port;
  const client = new Client({ name: "arnold-pipeline", version: "1.0.0" });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`)),
  );
  return client;
}

describe("source construction with the documented configuration", () => {
  it("builds the production source from the documented environment", () => {
    // T3-01: this threw ArnoldDataError/OPTIONS before any Google call, because
    // source options were forwarded into the adapter's strict schema.
    expect(() => createArnoldSource(process.cwd(), ENV)).not.toThrow();
    const source = createArnoldSource(process.cwd(), ENV);
    expect(source.mode).toBe("arnold_sheets");
  });

  it("accepts every documented source option alongside the adapter's own", () => {
    expect(
      () =>
        new ArnoldSheetsDataSource({
          spreadsheetId: fixtureFileId,
          expectedFileRole: "USER_TRACKER",
          expectedTrackerId: "tracker-under-test",
          cacheTtlMs: 0,
          label: "Arnold · Test",
          description: "Beschreibung",
          now: () => 0,
          transport: new FakeArnoldSheets(),
        }),
    ).not.toThrow();
  });

  it("still rejects a genuinely invalid file id", () => {
    expect(
      () => new ArnoldSheetsDataSource({ spreadsheetId: "zu-kurz" }),
    ).toThrow();
  });

  it("honours the environment's cache TTL and identity guards", () => {
    expect(() =>
      createArnoldSource(process.cwd(), {
        ...ENV,
        ARNOLD_CACHE_TTL_MS: "0",
        ARNOLD_EXPECTED_FILE_ROLE: "USER_TRACKER",
        ARNOLD_EXPECTED_TRACKER_ID: "tracker-under-test",
      } as unknown as NodeJS.ProcessEnv),
    ).not.toThrow();
  });
});

describe("full pipeline from the sheets transport to the MCP tools", () => {
  it("reads a tracker through the real adapter and serves the dashboard", async () => {
    const transport = new FakeArnoldSheets();
    const source = new ArnoldSheetsDataSource({
      spreadsheetId: fixtureFileId,
      cacheTtlMs: 0,
      transport,
    });
    const client = await connect(source);
    const result = (await client.callTool({
      name: "get_arnold_dashboard_v2",
      arguments: {},
    })) as CallToolResult;
    expect(result.isError).not.toBe(true);
    const view = ArnoldDashboardViewSchema.parse(result.structuredContent);
    // The numbers came out of the grid the transport served.
    expect(view.source.schema_id).toBe("arnold.training_raw");
    expect(view.state).toBe("ready");
    expect(view.kpis.find((k) => k.key === "workouts")!.value).toBeGreaterThan(
      0,
    );
    // The adapter really did talk to the transport.
    expect(transport.calls.length).toBeGreaterThan(0);
    await client.close();
  });

  it("serves the empty-tracker state through the same path", async () => {
    const transport = new FakeArnoldSheets();
    transport.tables = emptyHistory();
    const client = await connect(
      new ArnoldSheetsDataSource({
        spreadsheetId: fixtureFileId,
        cacheTtlMs: 0,
        transport,
      }),
    );
    const view = ArnoldDashboardViewSchema.parse(
      (
        (await client.callTool({
          name: "show_arnold_dashboard",
          arguments: {},
        })) as CallToolResult
      ).structuredContent,
    );
    expect(view.state).toBe("empty_history");
    expect(view.recent_workouts).toEqual([]);
    await client.close();
  });

  it("recognises the master template through the same path", async () => {
    const transport = new FakeArnoldSheets();
    transport.tables = templateTables();
    const client = await connect(
      new ArnoldSheetsDataSource({
        spreadsheetId: fixtureFileId,
        cacheTtlMs: 0,
        transport,
      }),
    );
    const view = ArnoldDashboardViewSchema.parse(
      (
        (await client.callTool({
          name: "get_arnold_dashboard_v2",
          arguments: {},
        })) as CallToolResult
      ).structuredContent,
    );
    expect(view.state).toBe("master_template");
    expect(view.source.file_role).toBe("MASTER_TEMPLATE");
    await client.close();
  });

  it("reports a Google failure as a tool error, never as demo data", async () => {
    const transport = new FakeArnoldSheets();
    transport.failure = { response: { status: 503 } };
    const client = await connect(
      new ArnoldSheetsDataSource({
        spreadsheetId: fixtureFileId,
        cacheTtlMs: 0,
        transport,
      }),
    );
    const result = (await client.callTool({
      name: "get_arnold_dashboard_v2",
      arguments: {},
    })) as CallToolResult;
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toBeUndefined();
    const text = result.content
      .map((c) => (c.type === "text" ? c.text : ""))
      .join(" ");
    expect(text).not.toMatch(/Demo|synthetisch/i);
    await client.close();
  });

  it("rejects a file whose schema version does not match", async () => {
    const transport = new FakeArnoldSheets();
    setConfig(transport.tables, "schema_version", "2.0.0");
    const source = new ArnoldSheetsDataSource({
      spreadsheetId: fixtureFileId,
      cacheTtlMs: 0,
      transport,
    });
    await expect(source.load()).rejects.toBeInstanceOf(ArnoldSourceError);
    await source.load().catch((error: ArnoldSourceError) => {
      expect(error.failure.code).toBe("schema_incompatible");
      expect(error.failure.retryable).toBe(false);
    });
  });

  it("rejects a tracker whose identity does not match the expectation", async () => {
    const source = new ArnoldSheetsDataSource({
      spreadsheetId: fixtureFileId,
      expectedTrackerId: "ein-anderer-tracker",
      cacheTtlMs: 0,
      transport: new FakeArnoldSheets(),
    });
    await expect(source.load()).rejects.toBeInstanceOf(ArnoldSourceError);
  });
});

describe("caching behaviour of the real source", () => {
  it("shares one in-flight read instead of asking Google twice", async () => {
    const transport = new FakeArnoldSheets();
    const source = new ArnoldSheetsDataSource({
      spreadsheetId: fixtureFileId,
      cacheTtlMs: 60_000,
      transport,
    });
    const [a, b] = await Promise.all([source.load(), source.load()]);
    expect(a.dataset).toBe(b.dataset);
    const afterFirst = transport.calls.length;
    await source.load();
    // Served from the cache; no further transport traffic.
    expect(transport.calls.length).toBe(afterFirst);
  });

  it("goes back to the transport after an invalidation", async () => {
    const transport = new FakeArnoldSheets();
    const source = new ArnoldSheetsDataSource({
      spreadsheetId: fixtureFileId,
      cacheTtlMs: 60_000,
      transport,
    });
    await source.load();
    const afterFirst = transport.calls.length;
    source.invalidate();
    await source.load();
    expect(transport.calls.length).toBeGreaterThan(afterFirst);
  });

  it("does not let a read that started before an invalidation refill the cache", async () => {
    // T3-07: the regression that would make a later write tool show stale data.
    const transport = new FakeArnoldSheets();
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let reads = 0;
    const slow = {
      async get<T>(path: string, params: Readonly<Record<string, string>>) {
        // Only the very first grid read is held back.
        if (reads++ === 1) await gate;
        return transport.get<T>(path, params);
      },
    };
    const source = new ArnoldSheetsDataSource({
      spreadsheetId: fixtureFileId,
      cacheTtlMs: 60_000,
      transport: slow,
    });
    const inFlight = source.load();
    await new Promise((resolve) => setTimeout(resolve, 10));
    source.invalidate();
    release!();
    await inFlight;
    // Task 004 strengthens this contract: the original caller already waits
    // for the fresh read, so the following load can reuse that fresh cache.
    expect(transport.calls).toHaveLength(14);
    await source.load();
    expect(transport.calls).toHaveLength(14);
  });
});
