import { createFixtureLogging, writeModeFromEnv } from "./workout/fixture.js";
import type { WorkoutLoggingService } from "./workout/service.js";
import type { TrainingPlanService } from "./plan/service.js";
import type { OnboardingService } from "./onboarding/service.js";
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
import { loadAuthConfig } from "./auth/config.js";
import { buildAuthSurface, type AuthSurface } from "./auth/router.js";

export interface ServerOptions {
  storage?: StorageAdapter;
  /** Arnold schema v1 read source; selects the v2 dashboard mode. */
  arnoldSource?: ArnoldDataSource;
  workoutRuntime?: {
    source: ArnoldDataSource;
    service: WorkoutLoggingService;
    /** Task 005 plan management over the same source; omitted leaves plans read-only. */
    plans?: TrainingPlanService;
    /** Task 006 onboarding over the same source; omitted publishes no onboarding. */
    onboarding?: OnboardingService;
    actorContext?: (request: Request) => Promise<unknown>;
  };
  root?: string;
  allowedOrigins?: string[];
  allowedHosts?: string[];
  host?: string;
  /**
   * Task 007 identity surface. Built from the environment when omitted, which
   * in development means `AUTH_MODE=open` — no bearer validation and no
   * protected-resource advertisement, so the demo and read-only profiles of
   * Tasks 001–003 behave exactly as before.
   */
  auth?: AuthSurface;
}
export function createHttpApp(options: ServerOptions = {}) {
  const root = options.root ?? process.cwd();
  const mode = writeModeFromEnv();
  const runtime: NonNullable<ServerOptions["workoutRuntime"]> | undefined =
    options.workoutRuntime ??
    (mode === "fixture" && !options.storage && !options.arnoldSource
      ? createFixtureLogging()
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
  const auth =
    options.auth ?? buildAuthSurface({ config: loadAuthConfig(process.env) });
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
  // Discovery first: an unauthenticated client must be able to read the
  // protected-resource document in order to learn how to authenticate.
  if (auth.metadataRouter) app.use(auth.metadataRouter);
  app.get("/health", (_req, res) =>
    res.json({
      status: "ok",
      app: "arnold",
      auth: auth.summary.mode,
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
  // The query string is carried across the redirect: the preview selects its
  // entry point from it (`?onboarding=1` opens the setup wizard), and dropping
  // it here would silently send every such visit to the dashboard instead.
  app.get("/", (req, res) => {
    const query = req.originalUrl.slice(req.path.length);
    res.redirect(`/preview${query}`);
  });
  app.get("/preview", (_req, res) =>
    res.sendFile(resolve(root, "dist/ui/dashboard.html")),
  );
  app.get("/host", (_req, res) =>
    res.sendFile(resolve(root, "dist/host/host.html")),
  );
  app.all("/mcp", auth.bearerGate, async (req, res) => {
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
          runtime?.onboarding,
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
