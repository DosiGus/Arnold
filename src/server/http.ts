import { writeModeFromEnv } from "./workout/fixture.js";
import { createFixtureOnboarding } from "./onboarding/fixture.js";
import { planFixtureDataset } from "./plan/fixture.js";
import type { WorkoutLoggingService } from "./workout/service.js";
import type { TrainingPlanService } from "./plan/service.js";
import type { OnboardingService } from "./onboarding/service.js";
import { createMcpExpressApp } from "@modelcontextprotocol/express";
import { NodeStreamableHTTPServerTransport } from "@modelcontextprotocol/node";
import type { NextFunction, Request, Response } from "express";
import { resolve } from "node:path";
import { ARNOLD_UI_CONTRACT } from "../shared/arnold-view.js";
import { createArnoldV2McpServer } from "./mcp-arnold.js";
import type { ArnoldDataSource } from "./arnold-source.js";
import {
  createArnoldSource,
  isArnoldMode,
  requireSafeArnoldBinding,
} from "./storage-config.js";
import { loadAuthConfig } from "./auth/config.js";
import { buildAuthSurface, type AuthSurface } from "./auth/router.js";
import type { ConnectedArnoldRuntime } from "./connected/runtime.js";
import type { GoogleBrowserFlow } from "./connected/google-browser.js";
import { registerGoogleTools } from "./connected/mcp-google.js";
import { withArnoldContext } from "./auth/guarded-server.js";

export interface ServerOptions {
  env?: NodeJS.ProcessEnv;
  connected?: { runtime: ConnectedArnoldRuntime; browser: GoogleBrowserFlow };
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
   * protected-resource advertisement, which is what the synthetic and
   * read-only profiles run with.
   */
  auth?: AuthSurface;
}
/**
 * With nothing configured the server runs the synthetic fixture profile:
 * invented data in memory, every tool available, no Google account involved.
 * Any explicit `STORAGE_MODE` or injected runtime is left exactly as given.
 */
function withDefaultProfile(options: ServerOptions): NodeJS.ProcessEnv {
  const env = options.env ?? process.env;
  if (
    env.STORAGE_MODE !== undefined ||
    env.ARNOLD_WRITE_MODE !== undefined ||
    options.connected ||
    options.arnoldSource ||
    options.workoutRuntime
  )
    return env;
  return {
    ...env,
    STORAGE_MODE: "arnold_fixture",
    ARNOLD_WRITE_MODE: "fixture",
  };
}
export function createHttpApp(options: ServerOptions = {}) {
  const root = options.root ?? process.cwd();
  const env = withDefaultProfile(options);
  const mode = writeModeFromEnv(env);
  if (
    options.connected &&
    (options.arnoldSource || options.workoutRuntime || mode !== "disabled")
  )
    throw new Error(
      "Arnold Connected benötigt einen eigenen Datenpfad ohne Fixture-Schreibmodus.",
    );
  const runtime: NonNullable<ServerOptions["workoutRuntime"]> | undefined =
    options.workoutRuntime ??
    (mode === "fixture" && !options.arnoldSource
      ? // The full synthetic runtime, not just the logger: a deployment wired
        // from the environment must expose the plan editor and the onboarding
        // too, or two thirds of the product are simply absent from the tool
        // list and a connected client cannot reach them.
        createFixtureOnboarding({ dataset: planFixtureDataset() })
      : undefined);
  if (runtime && options.arnoldSource)
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
  // Exactly one data path is active per process: the synthetic fixture runtime,
  // the read-only Arnold Sheets source, or the connected per-user runtime.
  const arnoldSource =
    runtime?.source ??
    options.arnoldSource ??
    (isArnoldMode(env) ? createArnoldSource(root, env) : undefined);
  if (!arnoldSource && !options.connected)
    throw new Error(
      "STORAGE_MODE muss arnold_fixture, arnold_sheets oder arnold_connected sein.",
    );
  const host = options.host ?? env.HOST ?? "127.0.0.1";
  const allowedHosts = options.allowedHosts ??
    env.ALLOWED_HOSTS?.split(",")
      .map((s) => s.trim())
      .filter(Boolean) ?? ["localhost", "127.0.0.1", "[::1]"];
  const allowedOrigins =
    options.allowedOrigins ??
    env.ALLOWED_ORIGINS?.split(",")
      .map((s) => s.trim())
      .filter(Boolean) ??
    [];
  // Built before the binding check, because whether a public address is
  // acceptable depends on whether bearer validation is actually active.
  const auth =
    options.auth ?? buildAuthSurface({ config: loadAuthConfig(env) });
  if (
    options.connected &&
    (auth.summary.mode !== "oidc" ||
      options.connected.runtime.options.auth !== auth)
  )
    throw new Error(
      "Connected-Runtime und HTTP-Endpunkt benötigen dieselbe aktive Authentifizierung.",
    );
  requireSafeArnoldBinding({
    synthetic: arnoldSource?.synthetic ?? false,
    authenticated: auth.summary.mode === "oidc",
    host,
    allowedHosts,
    allowedOrigins,
  });
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
        "Authorization, Content-Type, Mcp-Session-Id, Mcp-Protocol-Version, Last-Event-ID",
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
  if (options.connected)
    app.use("/auth/google", options.connected.browser.router);
  app.get("/health", (_req, res) =>
    res.json({
      status: "ok",
      app: "arnold",
      auth: auth.summary.mode,
      // Whether this instance serves made-up data. That is the source's own
      // answer: reporting `false` for a synthetic fixture would tell an
      // operator checking whether real training data is exposed exactly the
      // wrong thing.
      synthetic: options.connected ? false : arnoldSource!.synthetic,
      source: options.connected ? "arnold_connected" : "arnold_sheets",
      ui_contract: ARNOLD_UI_CONTRACT,
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
    const handle = async () => {
      const userRuntime = options.connected
        ? await options.connected.runtime.forUser(
            await auth.resolveRequest(req),
          )
        : runtime;
      const requestSource = userRuntime?.source ?? arnoldSource;
      const server = createArnoldV2McpServer(
        requestSource!,
        resolve(root, "dist/ui/dashboard.html"),
        undefined,
        userRuntime?.service,
        userRuntime && "actorContext" in userRuntime
          ? await userRuntime.actorContext?.(req)
          : undefined,
        userRuntime?.plans,
        userRuntime?.onboarding,
        auth.guard,
      );
      if (options.connected)
        registerGoogleTools(
          server,
          options.connected.runtime,
          options.connected.browser,
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
    };
    if (options.connected) {
      const context = await auth.resolveRequest(req);
      if (req.method === "POST")
        await options.connected.runtime.exclusive(context, handle);
      else await withArnoldContext(context, handle);
    } else await handle();
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
