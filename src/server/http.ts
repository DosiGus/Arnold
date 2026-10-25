import { createMcpExpressApp } from "@modelcontextprotocol/express";
import { NodeStreamableHTTPServerTransport } from "@modelcontextprotocol/node";
import type { NextFunction, Request, Response } from "express";
import { resolve } from "node:path";
import { createFitnessMcpServer } from "./mcp.js";
import type { StorageAdapter } from "./storage.js";
import { createStorage, requirePrivateBinding } from "./storage-config.js";

export interface ServerOptions {
  storage?: StorageAdapter;
  root?: string;
  allowedOrigins?: string[];
  allowedHosts?: string[];
  host?: string;
}
export function createHttpApp(options: ServerOptions = {}) {
  const root = options.root ?? process.cwd();
  const storage = options.storage ?? createStorage(root);
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
  requirePrivateBinding(storage, host, allowedHosts, allowedOrigins);
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
      app: "fitness-tracker-ai",
      synthetic: storage.mode === "demo",
      source: storage.mode === "demo" ? "local_demo" : "google_sheets",
      version: "0.3.0",
    }),
  );
  app.get("/", (_req, res) => res.redirect("/preview"));
  app.get("/preview", (_req, res) =>
    res.sendFile(resolve(root, "dist/ui/dashboard.html")),
  );
  app.get("/host", (_req, res) =>
    res.sendFile(resolve(root, "dist/host/host.html")),
  );
  app.all("/mcp", async (req, res) => {
    const server = createFitnessMcpServer(
      storage,
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
