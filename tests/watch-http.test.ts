/**
 * GAR-B2-02: the watch API's front door against the real test Postgres.
 * Token check, strict separation from /mcp, error shape, JSON and size
 * limits, rate limits and log privacy. The routes here are test handlers on
 * real, classified paths; the product handlers come with their own tasks.
 */
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import express from "express";
import { createServer, type Server } from "node:http";
import { createHash, randomUUID } from "node:crypto";
import { createHttpApp } from "../src/server/http.js";
import {
  buildAuthSurface,
  type AuthSurface,
} from "../src/server/auth/router.js";
import { loadAuthConfig } from "../src/server/auth/config.js";
import { fetchAuthorizationServerMetadata } from "../src/server/auth/discovery.js";
import { PostgresIdentityRepository } from "../src/server/db/identity.js";
import { DatabaseArnoldRuntime } from "../src/server/db/runtime.js";
import type { Database } from "../src/server/db/database.js";
import { currentArnoldContext } from "../src/server/auth/guarded-server.js";
import { UnclassifiedWatchRouteError } from "../src/server/auth/tool-access.js";
import {
  WatchTokenVerifier,
  hashWatchToken,
  newWatchToken,
} from "../src/server/auth/watch-token.js";
import {
  MemoryRateLimiter,
  createWatchRouter,
  mountWatchApi,
  type WatchRoute,
} from "../src/server/watch/router.js";
import { WatchErrorSchema } from "../src/shared/watch-contract.js";
import { appDatabase, asOwner, newAccount } from "./fixtures/arnold-db.js";
import {
  jwksDocument,
  makeRsaKey,
  signJwt,
  validClaims,
} from "./fixtures/arnold-auth.js";

const MARKER = "ZEBRA";
const key = makeRsaKey("watch-issuer");
let issuerHttp: Server, issuer: string;
let db: Database, auth: AuthSurface, runtime: DatabaseArnoldRuntime;
const servers: Server[] = [];
let now = Date.now();
let limiter: MemoryRateLimiter;

const portOf = (server: Server) => (server.address() as { port: number }).port;
const listen = (server: Server) =>
  new Promise<void>((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
const close = (server: Server) =>
  new Promise<void>((resolve) => {
    if (!server?.listening) return resolve();
    server.close(() => resolve());
    server.closeAllConnections();
  });
const sha = (value: string) => createHash("sha256").update(value).digest();

beforeAll(async () => {
  issuerHttp = createServer((req, res) => {
    res.setHeader("content-type", "application/json");
    res.end(
      JSON.stringify(
        req.url?.includes("jwks")
          ? jwksDocument(key)
          : {
              issuer,
              authorization_endpoint: `${issuer}authorize`,
              token_endpoint: `${issuer}token`,
              response_types_supported: ["code"],
              code_challenge_methods_supported: ["S256"],
            },
      ),
    );
  }).listen(0, "127.0.0.1");
  await listen(issuerHttp);
  issuer = `http://127.0.0.1:${portOf(issuerHttp)}/`;
  db = appDatabase(10);
});
afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  await Promise.all(servers.splice(0).map(close));
});
afterAll(async () => {
  await close(issuerHttp);
  await db.close();
});

/** The real product server on a fixed base, as in db-journey. */
async function productServer() {
  const probe = createServer().listen(0, "127.0.0.1");
  await listen(probe);
  const base = `http://127.0.0.1:${portOf(probe)}`;
  await close(probe);
  const identities = new PostgresIdentityRepository(db);
  auth = buildAuthSurface({
    config: loadAuthConfig({
      ARNOLD_ENV: "development",
      AUTH_MODE: "oidc",
      ARNOLD_PUBLIC_BASE_URL: base,
      AUTH_ISSUER: issuer,
      AUTH_JWKS_URI: `${issuer}jwks`,
      IDENTITY_STORE: "postgres",
      DATABASE_URL: "postgres://injected",
    }),
    repository: identities,
    authorizationServerMetadata: await fetchAuthorizationServerMetadata({
      issuer,
    }),
  });
  runtime = new DatabaseArnoldRuntime({
    db,
    auth,
    identities,
    retentionDays: 30,
  });
  const server = createHttpApp({ auth, database: runtime }).listen(
    Number(new URL(base).port),
    "127.0.0.1",
  );
  servers.push(server);
  await listen(server);
  return base;
}

const echo: WatchRoute["handler"] = async (call) => ({
  body: {
    user: call.principal?.context.userId,
    device: call.principal?.deviceId,
    als: currentArnoldContext()?.userId,
    lang: call.lang,
  },
});
const testRoutes: WatchRoute[] = [
  { method: "POST", path: "/pair/start", handler: async () => ({ body: {} }) },
  { method: "GET", path: "/device", handler: echo },
  { method: "POST", path: "/workouts", handler: echo },
  {
    method: "GET",
    path: "/plan",
    handler: async () => {
      throw new Error(`database said ${MARKER}`);
    },
  },
];

/** The watch router alone with test handlers, a test clock and limiter. */
async function watchServer(verifier?: WatchTokenVerifier) {
  if (!runtime) await productServer();
  limiter = new MemoryRateLimiter(() => now);
  const app = express();
  app.use(express.json());
  mountWatchApi(app, { runtime, routes: testRoutes, limiter, verifier });
  const server = app.listen(0, "127.0.0.1");
  servers.push(server);
  await listen(server);
  return `http://127.0.0.1:${portOf(server)}/api/watch/v1`;
}

/** A paired watch for a fresh account, through the 003 functions. */
async function pairedWatch() {
  const account = await newAccount(db);
  const deviceCode = sha(randomUUID()),
    userCode = sha(randomUUID());
  await db.query("select * from arnold.start_watch_pairing($1,$2,$3,600)", [
    deviceCode,
    userCode,
    "Forerunner 255",
  ]);
  await db.asUser(account.userId, (c) =>
    c.query("select * from arnold.approve_watch_pairing($1,$2)", [
      userCode,
      "Europe/Berlin",
    ]),
  );
  const token = newWatchToken(),
    deviceId = `wdv_${randomUUID()}`;
  const redeemed = await db.query(
    "select * from arnold.redeem_watch_pairing($1,$2,$3)",
    [deviceCode, hashWatchToken(token), deviceId],
  );
  expect(redeemed.rows[0].result).toBe("issued");
  return { userId: account.userId, token, deviceId };
}

const get = (
  url: string,
  token?: string,
  headers: Record<string, string> = {},
) =>
  fetch(url, {
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
  });
const post = (
  url: string,
  body: string,
  token?: string,
  type = "application/json",
) =>
  fetch(url, {
    method: "POST",
    headers: {
      "content-type": type,
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body,
  });

describe("watch API front door (GAR-B2-02)", () => {
  it("is mounted only with a database and AUTH_MODE=oidc", async () => {
    const base = await productServer();
    const mounted = await post(`${base}/api/watch/v1/pair/start`, "{");
    expect(mounted.status).toBe(400);
    expect(WatchErrorSchema.parse(await mounted.json()).error.code).toBe(
      "VALIDATION_ERROR",
    );
    const fixture = createHttpApp({ env: {} }).listen(0, "127.0.0.1");
    servers.push(fixture);
    await listen(fixture);
    const plain = await post(
      `http://127.0.0.1:${portOf(fixture)}/api/watch/v1/pair/start`,
      "{",
    );
    expect(plain.status).toBe(400);
    expect(await plain.json()).toEqual({ error: "Ungültiger JSON-Request." });
  });

  it("refuses to build a router with an unclassified route", async () => {
    if (!runtime) await productServer();
    expect(() =>
      createWatchRouter({
        runtime,
        routes: [{ method: "GET", path: "/admin", handler: async () => ({}) }],
      }),
    ).toThrow(UnclassifiedWatchRouteError);
    expect(() =>
      createWatchRouter({
        runtime,
        routes: [
          { method: "POST", path: "/device", handler: async () => ({}) },
        ],
      }),
    ).toThrow(UnclassifiedWatchRouteError);
  });

  it("answers missing, malformed, unknown, revoked and disabled tokens with the same 401", async () => {
    const api = await watchServer();
    const revoked = await pairedWatch(),
      disabled = await pairedWatch();
    await db.asUser(revoked.userId, (c) =>
      c.query(
        "update arnold.watch_devices set status='revoked', revoked_at=now() where device_id=$1",
        [revoked.deviceId],
      ),
    );
    await asOwner((c) =>
      c.query("update arnold.users set status='DISABLED' where user_id=$1", [
        disabled.userId,
      ]),
    );
    const bodies = [];
    for (const header of [
      undefined,
      "Bearer",
      "Basic abc",
      `Bearer arn_w_short`,
      `Bearer ${newWatchToken()}`,
      `Bearer ${revoked.token}`,
      `Bearer ${disabled.token}`,
      `bearer ${newWatchToken()}`,
    ]) {
      const response = await fetch(`${api}/device`, {
        headers: header ? { authorization: header } : {},
      });
      expect(response.status).toBe(401);
      bodies.push(await response.text());
    }
    expect(new Set(bodies).size).toBe(1);
    const parsed = WatchErrorSchema.parse(JSON.parse(bodies[0]!));
    expect(parsed.error).toEqual({
      code: "AUTH_REQUIRED",
      retryable: false,
      message: "Watch is not connected. Please connect again.",
    });
  });

  it("keeps the two credentials apart: WorkOS JWT not on the watch, watch token not on /mcp", async () => {
    const base = await productServer();
    const watch = await pairedWatch();
    const jwt = signJwt(
      key,
      validClaims({
        iss: issuer,
        aud: `${base}/mcp`,
        sub: `alice-${randomUUID()}`,
        scope: "arnold.read arnold.write arnold.account",
      }),
    );
    const api = await watchServer();
    const onWatch = await get(`${api}/device`, jwt);
    expect(onWatch.status).toBe(401);
    expect(WatchErrorSchema.parse(await onWatch.json()).error.code).toBe(
      "AUTH_REQUIRED",
    );
    const onMcp = await fetch(`${base}/mcp`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${watch.token}`,
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/list",
        params: {},
      }),
    });
    expect(onMcp.status).toBe(401);
  });

  it("acts only for the token's own account, also when two watches alternate", async () => {
    const api = await watchServer();
    const alice = await pairedWatch(),
      bob = await pairedWatch();
    for (const [watch, write] of [
      [alice, false],
      [bob, true],
      [alice, true],
      [bob, false],
    ] as const) {
      const response = write
        ? await post(`${api}/workouts`, "{}", watch.token)
        : await get(`${api}/device`, watch.token, {
            "accept-language": "de-DE",
          });
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        user: watch.userId,
        device: watch.deviceId,
        als: watch.userId,
        lang: write ? "en" : "de",
      });
    }
  });

  it("answers 503 STORAGE_UNAVAILABLE, never a pass, when the token lookup fails", async () => {
    if (!runtime) await productServer();
    const watch = await pairedWatch();
    const down = new WatchTokenVerifier({
      db: { query: () => Promise.reject(new Error("ECONNREFUSED 127.0.0.1")) },
      auth,
    });
    let api = await watchServer(down);
    let response = await get(`${api}/device`, watch.token);
    expect(response.status).toBe(503);
    const body = await response.text();
    expect(body).not.toMatch(/ECONN|127\.0\.0\.1/);
    expect(WatchErrorSchema.parse(JSON.parse(body)).error).toMatchObject({
      code: "STORAGE_UNAVAILABLE",
      retryable: true,
    });
    const accountDown = new WatchTokenVerifier({
      db,
      auth: { assertActive: () => Promise.reject(new Error("pool timeout")) },
    });
    api = await watchServer(accountDown);
    response = await get(`${api}/device`, watch.token);
    expect(response.status).toBe(503);
  });

  it("accepts only JSON bodies up to 64 KB", async () => {
    const api = await watchServer();
    const watch = await pairedWatch();
    expect(
      (await post(`${api}/workouts`, "x=1", watch.token, "text/plain")).status,
    ).toBe(415);
    expect(
      (
        await fetch(`${api}/workouts`, {
          method: "POST",
          headers: { authorization: `Bearer ${watch.token}` },
        })
      ).status,
    ).toBe(415);
    const big = (bytes: number) => JSON.stringify({ pad: "a".repeat(bytes) });
    expect(
      (await post(`${api}/workouts`, big(60_000), watch.token)).status,
    ).toBe(200);
    const over = await post(`${api}/workouts`, big(70_000), watch.token);
    expect(over.status).toBe(413);
    expect(WatchErrorSchema.parse(await over.json()).error.code).toBe(
      "VALIDATION_ERROR",
    );
    // Beyond the global parser limit the parser refuses before the router.
    expect(
      (await post(`${api}/workouts`, big(200_000), watch.token)).status,
    ).toBe(413);
  });

  it("limits pairing starts per address and calls per device, with Retry-After", async () => {
    const api = await watchServer();
    for (let i = 0; i < 10; i++)
      expect((await post(`${api}/pair/start`, "{}")).status).toBe(200);
    const limited = await post(`${api}/pair/start`, "{}");
    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get("retry-after"))).toBeGreaterThan(3500);
    expect(WatchErrorSchema.parse(await limited.json()).error).toMatchObject({
      code: "RATE_LIMITED",
      retryable: true,
    });
    now += 3_600_001;
    expect((await post(`${api}/pair/start`, "{}")).status).toBe(200);

    const watch = await pairedWatch(),
      other = await pairedWatch();
    for (let i = 0; i < 120; i++)
      expect((await get(`${api}/device`, watch.token)).status).toBe(200);
    const tooMany = await get(`${api}/device`, watch.token);
    expect(tooMany.status).toBe(429);
    expect(Number(tooMany.headers.get("retry-after"))).toBeGreaterThan(0);
    expect((await get(`${api}/device`, other.token)).status).toBe(200);
  });

  it("logs route, status, user and code, never tokens, bodies or error text", async () => {
    vi.stubEnv("ARNOLD_TOOL_LOG", "json");
    const lines: string[] = [];
    for (const method of ["log", "error", "warn", "info"] as const)
      vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
        lines.push(args.map(String).join(" "));
      });
    const api = await watchServer();
    const watch = await pairedWatch();
    await post(
      `${api}/workouts`,
      JSON.stringify({ note: MARKER }),
      watch.token,
    );
    const crashed = await get(`${api}/plan`, watch.token);
    expect(crashed.status).toBe(503);
    expect(await crashed.text()).not.toContain(MARKER);
    // A token that differs in its last character, never the real one (M048).
    const last = watch.token.endsWith("A") ? "B" : "A";
    await get(`${api}/device`, `${watch.token.slice(0, -1)}${last}`);
    await new Promise((resolve) => setTimeout(resolve, 20));
    const log = lines.join("\n");
    expect(log).toContain('"message":"watch POST /workouts"');
    expect(log).toContain(`"user":"${watch.userId}"`);
    expect(log).toContain('"outcome":"thrown"');
    expect(log).toContain('"code":"AUTH_REQUIRED"');
    expect(log).not.toContain(MARKER);
    expect(log).not.toContain("arn_w_");
    expect(log).not.toContain(watch.token.slice(6, 20));
  });
});
