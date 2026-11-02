import { logServerError } from "./tool-log.js";
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
import { createArnoldMcpServer } from "./mcp-arnold.js";
import type { ArnoldDataSource } from "./arnold-source.js";
import { requireSafeArnoldBinding } from "./storage-config.js";
import { loadAuthConfig } from "./auth/config.js";
import { buildAuthSurface, type AuthSurface } from "./auth/router.js";
import type { DatabaseArnoldRuntime } from "./db/runtime.js";
import { registerAccountTools } from "./account/mcp-account.js";
import { withArnoldContext } from "./auth/guarded-server.js";
import { FixtureSandboxes } from "./fixture-sandboxes.js";

export interface ServerOptions {
  env?: NodeJS.ProcessEnv;
  /** Signed-in users with their data in Postgres (`arnold_database`). */
  database?: DatabaseArnoldRuntime;
  /** A fixed read-only source; for tests. */
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
 * invented data in memory, every tool available, no account involved.
 * Any explicit `STORAGE_MODE` or injected runtime is left exactly as given.
 */
function withDefaultProfile(options: ServerOptions): NodeJS.ProcessEnv {
  const env = options.env ?? process.env;
  if (
    env.STORAGE_MODE !== undefined ||
    env.ARNOLD_WRITE_MODE !== undefined ||
    options.database ||
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
/**
 * How many reverse proxies in front of Arnold may set `X-Forwarded-*`.
 *
 * Behind a TLS-terminating platform (Cloud Run, a load balancer) the request
 * reaches Node as plain HTTP, so without this the same-origin check below
 * compares `https://…` from the browser against `http://…` and refuses the
 * server's own preview. Off by default: trusting forwarded headers on a
 * directly exposed process would let any client claim to be HTTPS. Anything
 * but a small whole number stops the start.
 */
export function parseTrustProxy(value: string | undefined): number {
  if (value === undefined || value === "") return 0;
  if (!/^\d+$/.test(value) || Number(value) > 10)
    throw new Error(
      "TRUST_PROXY muss die Zahl der vorgeschalteten Proxys sein (0 bis 10, Cloud Run: 1).",
    );
  return Number(value);
}
/** Fixed routes to fixed files; nothing from the request picks a path. */
export const LEGAL_PAGES: Readonly<Record<string, string>> = Object.freeze({
  "/datenschutz": "datenschutz.html",
  "/bedingungen": "bedingungen.html",
  "/support": "support.html",
});

/** The release id for /health. A malformed value stops the start. */
export function releaseFrom(env: NodeJS.ProcessEnv): string | null {
  const raw = env.ARNOLD_RELEASE;
  if (raw === undefined || raw === "") return null;
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(raw))
    throw new Error(
      "ARNOLD_RELEASE darf nur Buchstaben, Ziffern, Punkt, Bindestrich und Unterstrich enthalten (höchstens 64 Zeichen).",
    );
  return raw;
}

export function createHttpApp(options: ServerOptions = {}) {
  const root = options.root ?? process.cwd();
  const env = withDefaultProfile(options);
  const release = releaseFrom(env);
  const mode = writeModeFromEnv(env);
  if (
    options.database &&
    (options.arnoldSource || options.workoutRuntime || mode !== "disabled")
  )
    throw new Error(
      "Arnold mit Datenbank benötigt einen eigenen Datenpfad ohne Fixture-Schreibmodus.",
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
  // Exactly one data path is active per process: the synthetic fixture
  // runtime, a fixed test source, or the per-user database runtime.
  const arnoldSource = runtime?.source ?? options.arnoldSource;
  if (!arnoldSource && !options.database)
    throw new Error(
      "STORAGE_MODE muss arnold_fixture oder arnold_database sein.",
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
    options.database &&
    (auth.summary.mode !== "oidc" || options.database.options.auth !== auth)
  )
    throw new Error(
      "Datenbank-Runtime und HTTP-Endpunkt benötigen dieselbe aktive Authentifizierung.",
    );
  // A synthetic fixture behind a login: one invented dataset per user rather
  // than one shared by everyone who signs in. Only for the fixture this file
  // built itself; an injected runtime is used exactly as given.
  const sandboxes =
    auth.summary.mode === "oidc" &&
    !options.workoutRuntime &&
    !options.database &&
    runtime?.service.mode === "fixture"
      ? new FixtureSandboxes(auth)
      : undefined;
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
  const trustProxy = parseTrustProxy(env.TRUST_PROXY);
  if (trustProxy > 0) app.set("trust proxy", trustProxy);
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
  app.get("/health", (_req, res) =>
    res.json({
      status: "ok",
      app: "arnold",
      auth: auth.summary.mode,
      // Whether this instance serves made-up data. That is the source's own
      // answer: reporting `false` for a synthetic fixture would tell an
      // operator checking whether real training data is exposed exactly the
      // wrong thing.
      synthetic: options.database ? false : arnoldSource!.synthetic,
      source: options.database ? "arnold_database" : "arnold_fixture",
      ui_contract: ARNOLD_UI_CONTRACT,
      version: "0.5.0",
      // The deployed commit, set by the deploy (ARNOLD_RELEASE); null locally.
      release,
    }),
  );
  // Privacy notice, terms and support for the beta. Content comes from
  // public/legal/ (owned by operations); a missing file is a 404, never a
  // placeholder. Static HTML only: no scripts, no external resources.
  for (const [path, file] of Object.entries(LEGAL_PAGES))
    app.get(path, (_req, res) => {
      res.setHeader(
        "Content-Security-Policy",
        "default-src 'none'; style-src 'unsafe-inline'; img-src 'self' data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
      );
      res.sendFile(
        resolve(root, "public/legal", file),
        {
          dotfiles: "allow",
          headers: { "Cache-Control": "public, max-age=300" },
        },
        (error) => {
          if (!error) return;
          if (!res.headersSent)
            res
              .status(404)
              .type("text/plain; charset=utf-8")
              .send("Diese Seite ist noch nicht verfügbar.");
        },
      );
    });
  // The query string is carried across the redirect: the preview selects its
  // entry point from it (`?onboarding=1` opens the setup wizard), and dropping
  // it here would silently send every such visit to the dashboard instead.
  app.get("/", (req, res) => {
    const query = req.originalUrl.slice(req.path.length);
    res.redirect(`/preview${query}`);
  });
  // Only these two fixed files are ever sent. `dotfiles: "allow"` is needed
  // because the checkout itself may sit under a hidden directory (a worktree
  // in `.codex/…`), which `sendFile` would otherwise refuse as a dotfile path.
  app.get("/preview", (_req, res) =>
    res.sendFile(resolve(root, "dist/ui/dashboard.html"), {
      dotfiles: "allow",
    }),
  );
  app.get("/host", (_req, res) =>
    res.sendFile(resolve(root, "dist/host/host.html"), { dotfiles: "allow" }),
  );
  app.all("/mcp", auth.bearerGate, async (req, res) => {
    const handle = async () => {
      const userRuntime = options.database
        ? await options.database.forUser(await auth.resolveRequest(req))
        : sandboxes
          ? await sandboxes.forUser(await auth.resolveRequest(req))
          : runtime;
      const requestSource = userRuntime?.source ?? arnoldSource;
      const server = createArnoldMcpServer(
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
      if (options.database) registerAccountTools(server, options.database);
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
        logServerError("mcp request failed", error);
        if (!res.headersSent)
          res.status(500).json({
            jsonrpc: "2.0",
            id: null,
            error: { code: -32603, message: "Interner MCP-Fehler." },
          });
      }
    };
    const perUser = options.database ?? sandboxes;
    if (perUser) {
      const context = await auth.resolveRequest(req);
      if (req.method === "POST") await perUser.exclusive(context, handle);
      else await withArnoldContext(context, handle);
    } else await handle();
  });
  app.use((_req, res) => res.status(404).json({ error: "Nicht gefunden." }));
  app.use((error: Error, _req: Request, res: Response, _next: NextFunction) => {
    // Type and status only: a body-parser message quotes the request body.
    logServerError("http request failed", error);
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
