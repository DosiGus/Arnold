import { writeModeFromEnv } from "./workout/fixture.js";
import type { WorkoutLoggingService } from "./workout/service.js";
import type { TrainingPlanService } from "./plan/service.js";
import { createFixturePlanning } from "./plan/fixture.js";
import { createMcpExpressApp } from "@modelcontextprotocol/express";
import { NodeStreamableHTTPServerTransport } from "@modelcontextprotocol/node";
import type { NextFunction, Request, Response } from "express";
import { resolve } from "node:path";
import { ARNOLD_UI_CONTRACT } from "../shared/arnold-view.js";
import { createArnoldMcpServer } from "./mcp.js";
import { createArnoldV2McpServer } from "./mcp-arnold.js";
import type { StorageAdapter } from "./storage.js";
import type { ArnoldDataSource } from "./arnold-source.js";
import {
  createArnoldSource,
  createStorage,
  isArnoldMode,
  requireLoopbackOnly,
  requirePrivateBinding,
} from "./storage-config.js";

export interface ServerOptions {
  storage?: StorageAdapter;
  /** Arnold schema v1 read source; selects the v2 dashboard mode. */
  arnoldSource?: ArnoldDataSource;
  workoutRuntime?: {
    source: ArnoldDataSource;
    service: WorkoutLoggingService;
    /** Task 005 plan management over the same source; omitted leaves plans read-only. */
    plans?: TrainingPlanService;
    actorContext?: (request: Request) => Promise<unknown>;
  };
  root?: string;
  allowedOrigins?: string[];
  allowedHosts?: string[];
  host?: string;
}
export function createHttpApp(options: ServerOptions = {}) {
  const root = options.root ?? process.cwd();
  const mode = writeModeFromEnv();
  const runtime: NonNullable<ServerOptions["workoutRuntime"]> | undefined =
    options.workoutRuntime ??
    (mode === "fixture" && !options.storage && !options.arnoldSource
      ? createFixturePlanning()
      : undefined);
  if (runtime && (options.storage || options.arnoldSource))
    throw new Error(
      "Workout-Runtime muss denselben Lese- und Schreibpfad besitzen.",
    );
  if (
    runtime?.service.mode === "test_sheet" &&
    !("actorContext" in runtime && runtime.actorContext)
  )
    throw new Error(
      "Test-Sheet benötigt einen geprüften Request-Authentifizierer.",
    );
  // Exactly one of the two data paths is active per process: the legacy demo /
  // Sheets storage, or the Arnold schema v1 source behind the v2 tools.
  const arnoldSource =
    runtime?.source ??
    options.arnoldSource ??
    (options.storage === undefined && isArnoldMode()
      ? createArnoldSource(root)
      : undefined);
  const storage = arnoldSource
    ? undefined
    : (options.storage ?? createStorage(root));
  const host = options.host ?? process.env.HOST ?? "127.0.0.1";
  const allowedHosts = options.allowedHosts ??
    process.env.ALLOWED_HOSTS?.split(",")
      .map((s) => s.trim())
      .filter(Boolean) ?? ["localhost", "127.0.0.1", "[::1]"];
  const allowedOrigins =
    options.allowedOrigins ??
    process.env.ALLOWED_ORIGINS?.split(",")
      .map((s) => s.trim())
      .filter(Boolean) ??
    [];
  if (arnoldSource) requireLoopbackOnly(host, allowedHosts, allowedOrigins);
  else requirePrivateBinding(storage!, host, allowedHosts, allowedOrigins);
  const app = createMcpExpressApp({
    host,
    allowedHosts,
    allowedOrigins: [
      ...new Set([
        ...allowedHosts,
        ...allowedOrigins.map((origin) => new URL(origin).hostname),
      ]),
    ],
  });
  app.disable("x-powered-by");
  app.use((req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Cache-Control", "no-store");
    const origin = req.get("origin");
    // MCP clients without Origin (Inspector, ChatGPT server-to-server) are supported.
    // Browser mutations are limited to same-origin or explicitly allowed local hosts.
    if (
      origin &&
      origin !== `${req.protocol}://${req.get("host")}` &&
      !allowedOrigins.includes(origin)
    ) {
      res.status(403).json({
        error:
          "Origin nicht erlaubt. Für lokale Test-Hosts ALLOWED_ORIGINS konfigurieren.",
      });
      return;
    }
    if (origin) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Vary", "Origin");
      res.setHeader(
        "Access-Control-Allow-Methods",
        "GET, POST, DELETE, OPTIONS",
      );
      res.setHeader(
        "Access-Control-Allow-Headers",
        "Content-Type, Mcp-Session-Id, Mcp-Protocol-Version, Last-Event-ID",
      );
      res.setHeader(
        "Access-Control-Expose-Headers",
        "Mcp-Session-Id, Mcp-Protocol-Version",
      );
    }
    if (req.method === "OPTIONS") {
      res.sendStatus(204);
      return;
    }
    next();
  });
  app.get("/health", (_req, res) =>
    res.json({
      status: "ok",
      app: "arnold",
      synthetic: storage?.mode === "demo",
      source: arnoldSource
        ? "arnold_sheets"
        : storage?.mode === "demo"
          ? "local_demo"
          : "google_sheets",
      ui_contract: arnoldSource ? ARNOLD_UI_CONTRACT : "arnold.dashboard/1",
      version: "0.5.0",
    }),
  );
  app.get("/", (_req, res) => res.redirect("/preview"));
  app.get("/preview", (_req, res) =>
    res.sendFile(resolve(root, "dist/ui/dashboard.html"), {
      dotfiles: "allow",
    }),
  );
  app.get("/host", (_req, res) =>
    res.sendFile(resolve(root, "dist/host/host.html"), { dotfiles: "allow" }),
  );
  app.all("/mcp", async (req, res) => {
    const server = arnoldSource
      ? createArnoldV2McpServer(
          arnoldSource,
          resolve(root, "dist/ui/dashboard.html"),
          undefined,
          runtime?.service,
          runtime && "actorContext" in runtime
            ? await runtime.actorContext?.(req)
            : undefined,
          runtime?.plans,
        )
      : createArnoldMcpServer(
          storage!,
          resolve(root, "dist/ui/dashboard.html"),
        );
    const transport = new NodeStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    res.on("close", () => {
      void transport.close().catch(() => {});
      void server.close().catch(() => {});
    });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (error) {
      console.error(
        "MCP request failed:",
        error instanceof Error ? error.message : "Unknown error",
      );
      if (!res.headersSent)
        res.status(500).json({
          jsonrpc: "2.0",
          id: null,
          error: { code: -32603, message: "Interner MCP-Fehler." },
        });
    }
  });
  app.use((_req, res) => res.status(404).json({ error: "Nicht gefunden." }));
  app.use((error: Error, _req: Request, res: Response, _next: NextFunction) => {
    console.error(error.message);
    const bodyError = error as Error & { status?: number; type?: string };
    if (!res.headersSent && bodyError.type === "entity.parse.failed") {
      res.status(400).json({ error: "Ungültiger JSON-Request." });
      return;
    }
    if (!res.headersSent && bodyError.status === 413) {
      res.status(413).json({ error: "Request zu groß." });
      return;
    }
    if (!res.headersSent)
      res
        .status(500)
        .json({ error: "Serverfehler. Build und Serverprotokoll prüfen." });
  });
  return app;
}
