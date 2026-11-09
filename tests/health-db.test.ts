import { afterAll, afterEach, beforeAll, expect, it, vi } from "vitest";
import EmbeddedPostgres from "embedded-postgres";
import { randomBytes } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer, type Server } from "node:net";
import type { Server as HttpServer } from "node:http";
import { Database } from "../src/server/db/database.js";
import { migrate, setAppPassword } from "../src/server/db/migrate.js";
import { PostgresIdentityRepository } from "../src/server/db/identity.js";
import { DatabaseArnoldRuntime } from "../src/server/db/runtime.js";
import { buildAuthSurface } from "../src/server/auth/router.js";
import { loadAuthConfig } from "../src/server/auth/config.js";
import { createHttpApp } from "../src/server/http.js";
let postgres: EmbeddedPostgres, directory: string, url: string;
const databases: Database[] = [],
  servers: HttpServer[] = [];
const close = (server: Server | HttpServer) =>
  new Promise<void>((resolve, reject) =>
    server.close((e) => (e ? reject(e) : resolve())),
  );
const listen = (server: Server | HttpServer) =>
  new Promise<void>((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), "arnold-health-pg-"));
  const portProbe = createServer().listen(0, "127.0.0.1");
  await listen(portProbe);
  const port = (portProbe.address() as { port: number }).port;
  await close(portProbe);
  const password = randomBytes(24).toString("hex");
  postgres = new EmbeddedPostgres({
    databaseDir: join(directory, "data"),
    user: "postgres",
    password,
    port,
    persistent: false,
    onLog: () => {},
    onError: () => {},
  });
  await postgres.initialise();
  await postgres.start();
  const admin = `postgres://postgres:${password}@127.0.0.1:${port}/postgres`;
  await migrate(admin);
  await setAppPassword(admin, password);
  url = `postgres://arnold_app:${password}@127.0.0.1:${port}/postgres`;
});
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(servers.splice(0).map(close));
  await Promise.all(databases.splice(0).map((d) => d.close()));
});
afterAll(async () => {
  await postgres.stop().catch(() => {});
  await rm(directory, { recursive: true, force: true });
});
const database = () => {
  const db = new Database({ url, maxConnections: 1 });
  databases.push(db);
  return db;
};
async function endpoint(db?: Database) {
  const issuer = "https://issuer.example.test/";
  const config = loadAuthConfig({
    ARNOLD_ENV: "development",
    AUTH_MODE: "oidc",
    ARNOLD_PUBLIC_BASE_URL: "http://127.0.0.1:9000",
    AUTH_ISSUER: issuer,
    AUTH_JWKS_URI: `${issuer}jwks`,
    IDENTITY_STORE: "postgres",
    DATABASE_URL: "postgres://injected",
  });
  const identities = db ? new PostgresIdentityRepository(db) : undefined;
  const auth = db
    ? buildAuthSurface({
        config,
        repository: identities,
        authorizationServerMetadata: {
          issuer,
          authorization_endpoint: `${issuer}authorize`,
          token_endpoint: `${issuer}token`,
          response_types_supported: ["code"],
        },
      })
    : undefined;
  const runtime = db
    ? new DatabaseArnoldRuntime({
        db,
        auth: auth!,
        identities: identities!,
        retentionDays: 30,
      })
    : undefined;
  const server = createHttpApp({
    env: { ARNOLD_ENV: "development", ARNOLD_RELEASE: "health-test" },
    ...(runtime ? { auth, database: runtime } : {}),
  }).listen(0, "127.0.0.1");
  servers.push(server);
  await listen(server);
  return `http://127.0.0.1:${(server.address() as { port: number }).port}/health`;
}
it("reports a real arnold_app database without a user context and keeps release/auth/source", async () => {
  const db = database();
  expect(
    (await db.query("select current_user, arnold.current_user_id() as caller"))
      .rows[0],
  ).toEqual({ current_user: "arnold_app", caller: null });
  const response = await fetch(await endpoint(db));
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({
    status: "ok",
    database: "ok",
    release: "health-test",
    auth: "oidc",
    source: "arnold_database",
    synthetic: false,
  });
});
it("keeps fixture health available with database not_configured", async () => {
  const response = await fetch(await endpoint());
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({
    status: "ok",
    database: "not_configured",
    release: "health-test",
    auth: "open",
    source: "arnold_fixture",
    synthetic: true,
  });
});
it("coalesces concurrent checks and expires cached results after ten seconds", async () => {
  const db = database(),
    query = vi.spyOn(db.pool, "query");
  let now = Date.now();
  vi.spyOn(Date, "now").mockImplementation(() => now);
  expect(
    await Promise.all(Array.from({ length: 30 }, () => db.ping())),
  ).toEqual(Array(30).fill(true));
  expect(query).toHaveBeenCalledTimes(1);
  now += 9999;
  expect(await db.ping()).toBe(true);
  expect(query).toHaveBeenCalledTimes(1);
  now += 2;
  expect(await db.ping()).toBe(true);
  expect(query).toHaveBeenCalledTimes(2);
});
it("bounds a saturated real Postgres pool to two seconds without launching another query", async () => {
  const db = database(),
    held = await db.pool.connect(),
    query = vi.spyOn(db.pool, "query");
  try {
    const start = performance.now();
    const result = await Promise.all(
      Array.from({ length: 20 }, () => db.ping()),
    );
    expect(result).toEqual(Array(20).fill(false));
    expect(performance.now() - start).toBeLessThan(2800);
    expect(query).toHaveBeenCalledTimes(1);
    expect(await db.ping()).toBe(false);
    expect(query).toHaveBeenCalledTimes(1);
  } finally {
    held.release();
  }
});
it("reports 503 with a generic body when the private embedded database is stopped", async () => {
  const db = database(),
    health = await endpoint(db);
  await postgres.stop();
  const response = await fetch(health);
  expect(response.status).toBe(503);
  const body = await response.json();
  expect(body).toMatchObject({
    status: "error",
    database: "unavailable",
    release: "health-test",
    auth: "oidc",
    source: "arnold_database",
  });
  expect(Object.keys(body).sort()).toEqual([
    "app",
    "auth",
    "database",
    "release",
    "source",
    "status",
    "synthetic",
    "ui_contract",
    "version",
  ]);
  expect(JSON.stringify(body)).not.toMatch(
    /postgres|127\.0\.0\.1|password|ECONN|Error/,
  );
});
