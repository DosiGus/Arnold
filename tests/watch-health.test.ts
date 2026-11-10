/**
 * GAR-B2-07: device status, unpairing and health data from the watch, on the
 * real server: real ChatGPT token verification and MCP tools, real watch
 * endpoints and the test Postgres. Only the recording row of a training is
 * set up directly; uploading it is covered in watch-workouts.
 */
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";
import express from "express";
import { createServer, type Server } from "node:http";
import { randomUUID } from "node:crypto";
import {
  Client,
  StreamableHTTPClientTransport,
  type CallToolResult,
} from "@modelcontextprotocol/client";
import { createHttpApp } from "../src/server/http.js";
import { buildAuthSurface } from "../src/server/auth/router.js";
import { loadAuthConfig } from "../src/server/auth/config.js";
import { fetchAuthorizationServerMetadata } from "../src/server/auth/discovery.js";
import { PostgresIdentityRepository } from "../src/server/db/identity.js";
import { DatabaseArnoldRuntime } from "../src/server/db/runtime.js";
import type { Database } from "../src/server/db/database.js";
import { deletionSummary } from "../src/server/account/deletion.js";
import { HEALTH_CONSENT_TEXT_VERSION } from "../src/server/mcp-watch.js";
import {
  MemoryRateLimiter,
  WATCH_RATE_LIMITS,
  mountWatchApi,
} from "../src/server/watch/router.js";
import { healthRoutes } from "../src/server/watch/health.js";
import { StoredDataSchema } from "../src/shared/account-contract.js";
import {
  ListGarminWatchesSchema,
  PairGarminWatchConfirmMetaSchema,
  SetGarminHealthConsentResponseSchema,
  WatchDeviceResponseSchema,
  WatchErrorSchema,
  WatchHealthResponseSchema,
  WatchPairStartResponseSchema,
  WatchPairTokenResponseSchema,
} from "../src/shared/watch-contract.js";
import { sha256 } from "../src/server/watch/pairing.js";
import {
  jwksDocument,
  makeRsaKey,
  signJwt,
  validClaims,
} from "./fixtures/arnold-auth.js";
import { appDatabase, asOwner } from "./fixtures/arnold-db.js";

const key = makeRsaKey("health-issuer");
const scopes = "arnold.read arnold.write arnold.plan arnold.account";
let issuerHttp: Server, issuer: string;
let http: Server, base: string;
let db: Database;
let runtime: DatabaseArnoldRuntime;
const clients: Client[] = [];
const extraServers: Server[] = [];

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
afterAll(async () => {
  await close(issuerHttp);
  await db.close();
});
beforeEach(async () => {
  const probe = createServer().listen(0, "127.0.0.1");
  await listen(probe);
  base = `http://127.0.0.1:${portOf(probe)}`;
  await close(probe);
  const identities = new PostgresIdentityRepository(db);
  const auth = buildAuthSurface({
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
  http = createHttpApp({ auth, database: runtime }).listen(
    Number(new URL(base).port),
    "127.0.0.1",
  );
  await listen(http);
});
afterEach(async () => {
  await Promise.all(clients.splice(0).map((c) => c.close()));
  await Promise.all(extraServers.splice(0).map(close));
  await close(http);
});

type Tool = (
  name: string,
  args?: Record<string, unknown>,
) => Promise<CallToolResult>;

async function chat(subject: string): Promise<Tool> {
  const client = new Client({ name: "health", version: "1" });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(`${base}/mcp`), {
      requestInit: {
        headers: {
          authorization: `Bearer ${signJwt(key, validClaims({ iss: issuer, aud: `${base}/mcp`, sub: subject, scope: scopes }))}`,
        },
      },
    }),
  );
  clients.push(client);
  return async (name, args = {}) =>
    (await client.callTool({ name, arguments: args })) as CallToolResult;
}

const watch = (
  method: string,
  path: string,
  token?: string,
  body?: unknown,
  url = `${base}/api/watch/v1`,
) =>
  fetch(`${url}${path}`, {
    method,
    headers: {
      ...(body === undefined ? {} : { "content-type": "application/json" }),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

/** Lets the next poll through: the database refuses polls under 4 s. */
const waitPoll = (deviceCode: string) =>
  asOwner((c) =>
    c.query(
      "update arnold.watch_pairings set last_polled_at = now() - interval '5 seconds' where device_code_hash = $1",
      [sha256(deviceCode)],
    ),
  );

/** A signed-in user with a watch paired through ChatGPT, like a real one. */
async function athlete(name: string) {
  const tool = await chat(`${name}-${randomUUID()}`);
  const started = WatchPairStartResponseSchema.parse(
    await (
      await watch("POST", "/pair/start", undefined, {
        device_label: "Forerunner 255",
        part_number: "006-B3992-00",
        app_version: "1.0.0",
      })
    ).json(),
  );
  const args = { user_code: started.user_code, timezone: "Europe/Berlin" };
  const card = await tool("pair_garmin_watch", args);
  const { confirmation_token } = PairGarminWatchConfirmMetaSchema.parse(
    (card._meta as { arnold: { pair_garmin_watch: unknown } }).arnold
      .pair_garmin_watch,
  );
  const paired = await tool("pair_garmin_watch", {
    ...args,
    confirmation_token,
  });
  expect(paired.isError, JSON.stringify(paired.content)).toBeFalsy();
  await waitPoll(started.device_code);
  const issued = WatchPairTokenResponseSchema.parse(
    await (
      await watch("POST", "/pair/token", undefined, {
        device_code: started.device_code,
      })
    ).json(),
  ) as { access_token: string; device_id: string };
  const userId = await asOwner(
    async (c) =>
      (
        await c.query(
          "select user_id from arnold.watch_devices where device_id = $1",
          [issued.device_id],
        )
      ).rows[0].user_id as string,
  );
  return {
    tool,
    userId,
    token: issued.access_token,
    deviceId: issued.device_id,
  };
}
type Athlete = Awaited<ReturnType<typeof athlete>>;

/** The recording a watch upload leaves behind (GAR-B2-05/06). */
async function recorded(a: Athlete) {
  const session = randomUUID();
  await asOwner((c) =>
    c.query(
      `insert into arnold.workout_recordings
         (user_id, client_session_id, device_id, started_at_utc, ended_at_utc, set_timings, app_version)
       values ($1, $2, $3, '2026-11-08T17:00:00Z', '2026-11-08T18:00:00Z', '[]', '1.0.0')`,
      [a.userId, session, a.deviceId],
    ),
  );
  return session;
}

const healthRows = (userId: string) =>
  asOwner(
    async (c) =>
      (
        await c.query(
          "select client_session_id, hr, calories_kcal, before, after, extras from arnold.workout_health where user_id = $1",
          [userId],
        )
      ).rows,
  );

const consent = async (a: Athlete, granted: boolean) => {
  const result = await a.tool("set_garmin_health_consent", {
    granted,
    ...(granted ? { text_version: HEALTH_CONSENT_TEXT_VERSION } : {}),
  });
  expect(result.isError, JSON.stringify(result.content)).toBeFalsy();
  return SetGarminHealthConsentResponseSchema.parse(result.structuredContent);
};

const deviceStatus = async (a: Athlete) => {
  const response = await watch("GET", "/device", a.token);
  expect(response.status).toBe(200);
  return WatchDeviceResponseSchema.parse(await response.json());
};

const errorOf = async (response: Response) =>
  WatchErrorSchema.parse(await response.json()).error;

const health = {
  hr: {
    interval_s: 5,
    start_utc: "2026-11-08T17:00:00Z",
    values: [92, 95, 0, 118, 0],
  },
  calories_kcal: 312,
  before: { at_utc: "2026-11-08T16:59:00Z", body_battery: 64, stress: null },
  after: { at_utc: "2026-11-08T18:01:00Z", body_battery: 48 },
  extras: { training_effect_aerobic: 2.1 },
};

describe("health data from the watch (GAR-B2-07)", () => {
  it("refuses health data without consent and stores nothing", async () => {
    const alice = await athlete("alice");
    const session = await recorded(alice);
    const status = await deviceStatus(alice);
    expect(status).toMatchObject({
      device_id: alice.deviceId,
      paired: true,
      health_consent: false,
    });
    expect(
      Math.abs(Date.parse(status.server_time_utc) - Date.now()),
    ).toBeLessThan(5_000);
    const refused = await watch(
      "PUT",
      `/workouts/${session}/health`,
      alice.token,
      health,
    );
    expect(refused.status).toBe(403);
    expect(await errorOf(refused)).toMatchObject({
      code: "CONSENT_REQUIRED",
      retryable: false,
    });
    expect(await healthRows(alice.userId)).toEqual([]);

    // Consent only to the current text; an old version changes nothing.
    const outdated = await alice.tool("set_garmin_health_consent", {
      granted: true,
      text_version: "alt",
    });
    expect(outdated.isError).toBe(true);
    expect(JSON.stringify(outdated.content)).toContain(
      HEALTH_CONSENT_TEXT_VERSION,
    );
    const missing = await alice.tool("set_garmin_health_consent", {
      granted: true,
    });
    expect(missing.isError).toBe(true);
    expect((await deviceStatus(alice)).health_consent).toBe(false);
    expect(
      (await watch("PUT", `/workouts/${session}/health`, alice.token, health))
        .status,
    ).toBe(403);
  });

  it("stores with consent: pending first, gaps stay gaps, a resend replaces, a revocation deletes", async () => {
    const alice = await athlete("alice");
    expect(await consent(alice, true)).toEqual({
      granted: true,
      text_version: HEALTH_CONSENT_TEXT_VERSION,
      deleted_health_records: 0,
    });
    expect((await deviceStatus(alice)).health_consent).toBe(true);

    // The training has not arrived yet.
    const session = randomUUID();
    const early = await watch(
      "PUT",
      `/workouts/${session}/health`,
      alice.token,
      health,
    );
    expect(early.status).toBe(409);
    expect(await errorOf(early)).toMatchObject({
      code: "WORKOUT_PENDING",
      retryable: true,
    });
    expect(await healthRows(alice.userId)).toEqual([]);

    await asOwner((c) =>
      c.query(
        `insert into arnold.workout_recordings
           (user_id, client_session_id, device_id, started_at_utc, ended_at_utc, set_timings, app_version)
         values ($1, $2, $3, '2026-11-08T17:00:00Z', '2026-11-08T18:00:00Z', '[]', '1.0.0')`,
        [alice.userId, session, alice.deviceId],
      ),
    );
    const stored = await watch(
      "PUT",
      `/workouts/${session}/health`,
      alice.token,
      health,
    );
    expect(stored.status).toBe(200);
    expect(WatchHealthResponseSchema.parse(await stored.json())).toMatchObject({
      session_uuid: session,
      stored: true,
    });
    const [row] = await healthRows(alice.userId);
    // 0 is no measurement: stored as a gap, never as a value.
    expect(row.hr).toEqual({
      interval_s: 5,
      start_utc: "2026-11-08T17:00:00Z",
      values: [92, 95, null, 118, null],
    });
    expect(row.calories_kcal).toBe(312);
    // Missing values stay missing, null stays null; nothing becomes 0.
    expect(row.before).toEqual({
      at_utc: "2026-11-08T16:59:00Z",
      body_battery: 64,
      stress: null,
    });
    expect(row.after).toEqual({
      at_utc: "2026-11-08T18:01:00Z",
      body_battery: 48,
    });

    // Upsert: a resend replaces everything, still one row.
    const resend = await watch(
      "PUT",
      `/workouts/${session}/health`,
      alice.token,
      {
        hr: { interval_s: 5, start_utc: "2026-11-08T17:00:00Z", values: [100] },
      },
    );
    expect(resend.status).toBe(200);
    const rows = await healthRows(alice.userId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      hr: { values: [100] },
      calories_kcal: null,
      before: null,
      after: null,
      extras: null,
    });

    // Invalid input stores nothing.
    for (const [path, body] of [
      [`/workouts/not-a-uuid/health`, health],
      [`/workouts/${session}/health`, { ...health, steps: 1 }],
      [`/workouts/${session}/health`, { calories_kcal: -1 }],
    ] as const) {
      const bad = await watch("PUT", path, alice.token, body);
      expect(bad.status, path).toBe(422);
    }
    expect((await healthRows(alice.userId))[0].hr.values).toEqual([100]);

    // Revocation deletes the stored values; the training stays.
    expect(await consent(alice, false)).toEqual({
      granted: false,
      text_version: HEALTH_CONSENT_TEXT_VERSION,
      deleted_health_records: 1,
    });
    expect(await healthRows(alice.userId)).toEqual([]);
    expect((await deviceStatus(alice)).health_consent).toBe(false);
    const recordings = await asOwner(
      async (c) =>
        (
          await c.query(
            "select count(*)::int as n from arnold.workout_recordings where user_id = $1",
            [alice.userId],
          )
        ).rows[0].n,
    );
    expect(recordings).toBe(1);
    const after = await watch(
      "PUT",
      `/workouts/${session}/health`,
      alice.token,
      health,
    );
    expect(after.status).toBe(403);
    expect(await healthRows(alice.userId)).toEqual([]);
  });

  it("keeps accounts apart: another watch, consent or revocation never touches them", async () => {
    const alice = await athlete("alice");
    const bob = await athlete("bob");
    await consent(alice, true);
    await consent(bob, true);
    const session = await recorded(alice);
    expect(
      (await watch("PUT", `/workouts/${session}/health`, alice.token, health))
        .status,
    ).toBe(200);

    // Bob's watch cannot attach values to Alice's training.
    const foreign = await watch(
      "PUT",
      `/workouts/${session}/health`,
      bob.token,
      { calories_kcal: 1 },
    );
    expect(foreign.status).toBe(409);
    expect(await errorOf(foreign)).toMatchObject({ code: "WORKOUT_PENDING" });
    expect(await healthRows(bob.userId)).toEqual([]);
    expect((await healthRows(alice.userId))[0].calories_kcal).toBe(312);

    // Bob revoking deletes nothing of Alice's, and her consent stays.
    expect((await consent(bob, false)).deleted_health_records).toBe(0);
    expect(await healthRows(alice.userId)).toHaveLength(1);
    expect((await deviceStatus(alice)).health_consent).toBe(true);
    expect((await deviceStatus(bob)).health_consent).toBe(false);
  });

  it("shows the consent in the watch list for the account card (GAR-B5-01)", async () => {
    const alice = await athlete("alice");
    const listed = async () =>
      ListGarminWatchesSchema.parse(
        (await alice.tool("list_garmin_watches")).structuredContent,
      ).health_consent;
    expect(await listed()).toEqual({
      granted: false,
      text_version: null,
      current_text_version: HEALTH_CONSENT_TEXT_VERSION,
    });
    await consent(alice, true);
    expect(await listed()).toEqual({
      granted: true,
      text_version: HEALTH_CONSENT_TEXT_VERSION,
      current_text_version: HEALTH_CONSENT_TEXT_VERSION,
    });
    await consent(alice, false);
    expect((await listed()).granted).toBe(false);
  });

  it("lets the watch sign itself out with DELETE /device", async () => {
    const alice = await athlete("alice");
    const removed = await watch("DELETE", "/device", alice.token);
    expect(removed.status).toBe(200);
    expect(await removed.json()).toMatchObject({ unpaired: true });
    const again = await watch("GET", "/device", alice.token);
    expect(again.status).toBe(401);
    expect(await errorOf(again)).toMatchObject({ code: "AUTH_REQUIRED" });
    const listed = ListGarminWatchesSchema.parse(
      (await alice.tool("list_garmin_watches")).structuredContent,
    );
    expect(listed.watches).toEqual([]);
  });

  it("names watches, recordings and health data in stored data and the deletion summary", async () => {
    const alice = await athlete("alice");
    await consent(alice, true);
    const session = await recorded(alice);
    await watch("PUT", `/workouts/${session}/health`, alice.token, health);
    const data = StoredDataSchema.parse(
      (await alice.tool("get_arnold_stored_data")).structuredContent,
    );
    const byKey = Object.fromEntries(data.items.map((i) => [i.key, i]));
    expect(byKey.garmin_watches).toMatchObject({
      label: "Gekoppelte Uhren",
      count: 1,
    });
    expect(byKey.watch_recordings).toMatchObject({
      label: "Uhr-Aufzeichnungen",
      count: 1,
    });
    expect(byKey.watch_health).toMatchObject({
      label: "Messwerte von der Uhr",
      count: 1,
    });
    expect(byKey.watch_health!.newest_at).not.toBeNull();
    expect(deletionSummary().stored_items.join(" ")).toMatch(
      /Garmin-Uhren.*Trainingsaufzeichnungen.*Messwerte/,
    );
  });
});

describe("failed watch token checks per address (M037)", () => {
  it("answers 429 after 60 failed checks a minute and lets the address through again later", async () => {
    const alice = await athlete("alice");
    let now = 1_000_000;
    const limiter = new MemoryRateLimiter(() => now);
    const app = express();
    app.use(express.json());
    mountWatchApi(app, { runtime, routes: healthRoutes(runtime), limiter });
    const server = app.listen(0, "127.0.0.1");
    extraServers.push(server);
    await listen(server);
    const url = `http://127.0.0.1:${portOf(server)}/api/watch/v1`;
    const wrong = `arn_w_${"A".repeat(43)}`;

    // A working token does not count towards the limit.
    expect(
      (await watch("GET", "/device", alice.token, undefined, url)).status,
    ).toBe(200);
    for (let i = 0; i < WATCH_RATE_LIMITS.failedAuthPerIpMinute; i++)
      expect(
        (
          await watch(
            "GET",
            "/device",
            i % 2 ? wrong : undefined,
            undefined,
            url,
          )
        ).status,
      ).toBe(401);
    const limited = await watch("GET", "/device", wrong, undefined, url);
    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get("retry-after"))).toBeGreaterThan(0);
    expect(await errorOf(limited)).toMatchObject({
      code: "RATE_LIMITED",
      retryable: true,
    });
    // The address is held before the database is asked, for every token.
    expect(
      (await watch("GET", "/device", alice.token, undefined, url)).status,
    ).toBe(429);

    now += 60_001;
    expect(
      (await watch("GET", "/device", alice.token, undefined, url)).status,
    ).toBe(200);
    expect((await watch("GET", "/device", wrong, undefined, url)).status).toBe(
      401,
    );
  });
});
