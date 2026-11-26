import express from "express";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { createServer as createViteServer } from "vite";
import { loadAuthConfig } from "../src/server/auth/config.js";
import { fetchAuthorizationServerMetadata } from "../src/server/auth/discovery.js";
import { buildAuthSurface } from "../src/server/auth/router.js";
import { Database } from "../src/server/db/database.js";
import { PostgresIdentityRepository } from "../src/server/db/identity.js";
import { DatabaseArnoldRuntime } from "../src/server/db/runtime.js";
import { createHttpApp } from "../src/server/http.js";

const host = "127.0.0.1";
const port = Number(process.env.PORT ?? 8788);
if (!Number.isInteger(port) || port < 1 || port > 65535)
  throw new Error("PORT muss zwischen 1 und 65535 liegen.");

const origin = new URL(process.env.ARNOLD_PREVIEW_URL ?? "");
if (origin.protocol !== "https:" || origin.href !== `${origin.origin}/`)
  throw new Error("ARNOLD_PREVIEW_URL muss ein HTTPS-Origin sein.");

const userId = process.env.ARNOLD_PREVIEW_USER_ID;
if (
  !userId ||
  !/^usr_[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(userId)
)
  throw new Error("Die Vorschau benötigt genau ein ARNOLD_PREVIEW_USER_ID.");

const resourceUrl = new URL("/mcp", origin).href;
const env: NodeJS.ProcessEnv = {
  ...process.env,
  ARNOLD_ENV: "staging",
  AUTH_MODE: "oidc",
  IDENTITY_STORE: "postgres",
  ARNOLD_PUBLIC_BASE_URL: origin.origin,
  ARNOLD_MCP_RESOURCE_URL: resourceUrl,
  AUTH_AUDIENCE: resourceUrl,
  STORAGE_MODE: "arnold_database",
  ARNOLD_WRITE_MODE: "disabled",
  ARNOLD_RELEASE: undefined,
};
const config = loadAuthConfig(env);
if (config.identityStore.kind !== "postgres" || !config.oidc)
  throw new Error("Die Vorschau benötigt WorkOS und Postgres.");
const metadata = await fetchAuthorizationServerMetadata({
  issuer: config.oidc.authorizationServer,
});
const db = new Database({
  url: config.identityStore.url,
  caCert: env.DATABASE_CA_CERT,
  maxConnections: 2,
  readOnly: true,
});
await db.assertReady();
const identities = new PostgresIdentityRepository(db, userId);
if ((await identities.byId(userId))?.status !== "ACTIVE")
  throw new Error("Das konfigurierte Arnold-Konto ist nicht aktiv.");
const auth = buildAuthSurface({
  config,
  authorizationServerMetadata: metadata,
  repository: identities,
  readOnly: true,
});
const database = new DatabaseArnoldRuntime({
  db,
  auth,
  identities,
  retentionDays: 30,
});

const app = express();
app.disable("x-powered-by");
const server = createServer(app);
const root = resolve("src/views");
const assetPrefix = "/_arnold_preview/";
const vite = await createViteServer({
  configFile: false,
  appType: "custom",
  root,
  base: assetPrefix,
  cacheDir: resolve("node_modules/.vite-arnold-preview"),
  publicDir: false,
  envDir: false,
  envPrefix: "ARNOLD_PREVIEW_CLIENT_",
  define: { "import.meta.env.ARNOLD_PREVIEW_CLIENT_READ_ONLY": "true" },
  plugins: [react(), tailwindcss()],
  resolve: { dedupe: ["react", "react-dom"] },
  optimizeDeps: {
    entries: ["dashboard.html", "onboarding.html"],
    include: ["react", "react-dom/client", "react/jsx-runtime"],
  },
  server: {
    host,
    port,
    origin: origin.origin,
    allowedHosts: [origin.hostname],
    middlewareMode: true,
    ws: {
      server,
      protocol: "wss",
      host: origin.hostname,
      clientPort: 443,
    },
    cors: {
      origin: [
        /^null$/,
        /^https:\/\/[a-z0-9-]+\.web-sandbox\.oaiusercontent\.com$/,
      ],
      methods: ["GET", "HEAD", "OPTIONS"],
    },
    fs: {
      allow: [root, resolve("src/shared"), resolve("node_modules")],
    },
  },
});
// Only Vite's namespace reaches its development middleware. OAuth discovery
// and MCP still go through Arnold's existing HTTP and bearer guards.
app.use((req, res, next) => {
  if (req.path.startsWith(assetPrefix)) return vite.middlewares(req, res, next);
  next();
});
app.use(
  createHttpApp({
    env,
    auth,
    database,
    host,
    allowedHosts: [host, "localhost", origin.hostname],
    previewUi: {
      origin: origin.origin,
      async render(kind) {
        const html = await readFile(resolve(root, `${kind}.html`), "utf8");
        const transformed = await vite.transformIndexHtml(
          `${assetPrefix}${kind}.html`,
          html,
        );
        // In a ChatGPT iframe root-relative entry URLs point at the sandbox.
        return transformed
          .replaceAll(
            /((?:src=|from\s+)["'])(\/_arnold_preview\/)/g,
            `$1${origin.origin}$2`,
          )
          .replace(
            `src="./${kind}/main.tsx"`,
            `src="${origin.origin}${assetPrefix}${kind}/main.tsx"`,
          );
      },
    },
  }),
);

server.listen(port, host, () => {
  console.log(`Arnold Vorschau · ${resourceUrl} · Kontozugriff nur lesend`);
});
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    server.close();
    void Promise.all([vite.close(), db.close()]).finally(() => process.exit(0));
  });
}
