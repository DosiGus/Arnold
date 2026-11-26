/**
 * GAR-B2-03: pairing a watch end to end on the real server: real token
 * verification for ChatGPT, real MCP tools, real watch endpoints and the test
 * Postgres. From the code on the watch to a working watch token.
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
import {
  ListGarminWatchesSchema,
  PairGarminWatchConfirmMetaSchema,
  PairGarminWatchResponseSchema,
  WatchPairStartResponseSchema,
  WatchPairTokenResponseSchema,
} from "../src/shared/watch-contract.js";
import { newUserCode, sha256 } from "../src/server/watch/pairing.js";
import {
  jwksDocument,
  makeRsaKey,
  signJwt,
  validClaims,
} from "./fixtures/arnold-auth.js";
import { appDatabase, asOwner } from "./fixtures/arnold-db.js";
import {
  pairConfirmInput,
  pairConfirmation,
  watchCode,
  watchStatus,
} from "../src/views/model/settings.js";

const key = makeRsaKey("pairing-issuer");
const scopes = "arnold.read arnold.write arnold.plan arnold.account";
let issuerHttp: Server, issuer: string;
let http: Server, base: string;
let db: Database;
const clients: Client[] = [];

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
  const runtime = new DatabaseArnoldRuntime({
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
  await close(http);
});

async function chat(subject: string) {
  const client = new Client({ name: "pairing", version: "1" });
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
  return async (name: string, args: Record<string, unknown> = {}) =>
    (await client.callTool({ name, arguments: args })) as CallToolResult;
}

const watch = (path: string, body: unknown, token?: string) =>
  fetch(`${base}/api/watch/v1${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });

async function startPairing() {
  const response = await watch("/pair/start", {
    device_label: "Forerunner 255",
    part_number: "006-B3992-00",
    app_version: "1.0.0",
  });
  expect(response.status).toBe(201);
  return WatchPairStartResponseSchema.parse(await response.json());
}

const poll = async (deviceCode: string) =>
  WatchPairTokenResponseSchema.parse(
    await (await watch("/pair/token", { device_code: deviceCode })).json(),
  );

/** Lets the next poll through: the database refuses polls under 4 s. */
const waitPoll = (deviceCode: string) =>
  asOwner((c) =>
    c.query(
      "update arnold.watch_pairings set last_polled_at = now() - interval '5 seconds' where device_code_hash = $1",
      [sha256(deviceCode)],
    ),
  );

describe("pairing a watch (GAR-B2-03)", () => {
  it("pairs from the code on the watch to a working token, only after the card's click", async () => {
    const alice = await chat(`alice-${randomUUID()}`);
    const started = await startPairing();
    expect(started.user_code).toMatch(
      /^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{4}-[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{4}$/,
    );
    expect(started).toMatchObject({ expires_in: 600, interval: 5 });
    expect(await poll(started.device_code)).toMatchObject({
      status: "pending",
    });
    // Too fast: slow_down.
    expect(await poll(started.device_code)).toMatchObject({
      status: "slow_down",
    });

    // Stage 1: the card, the token only in _meta.
    const first = await alice("pair_garmin_watch", {
      user_code: started.user_code.toLowerCase(),
      timezone: "Europe/Berlin",
    });
    expect(first.isError, JSON.stringify(first.content)).toBeFalsy();
    const card = PairGarminWatchResponseSchema.parse(first.structuredContent);
    expect(card).toMatchObject({
      stage: "confirm",
      device_label: "Forerunner 255",
      user_code: started.user_code,
    });
    expect(JSON.stringify(first.structuredContent)).not.toContain(
      "confirmation_token",
    );
    const meta = PairGarminWatchConfirmMetaSchema.parse(
      (first._meta as { arnold: { pair_garmin_watch: unknown } }).arnold
        .pair_garmin_watch,
    );
    await waitPoll(started.device_code);
    expect(await poll(started.device_code)).toMatchObject({
      status: "pending",
    });

    // A token for another time zone does not pair.
    const wrongZone = await alice("pair_garmin_watch", {
      user_code: started.user_code,
      timezone: "Europe/London",
      confirmation_token: meta.confirmation_token,
    });
    expect(wrongZone.isError).toBe(true);
    expect(JSON.stringify(wrongZone.content)).toContain("CONFIRMATION_INVALID");

    const again = await alice("pair_garmin_watch", {
      user_code: started.user_code,
      timezone: "Europe/Berlin",
    });
    const token = PairGarminWatchConfirmMetaSchema.parse(
      (again._meta as { arnold: { pair_garmin_watch: unknown } }).arnold
        .pair_garmin_watch,
    ).confirmation_token;
    const paired = await alice("pair_garmin_watch", {
      user_code: started.user_code,
      timezone: "Europe/Berlin",
      confirmation_token: token,
    });
    expect(paired.structuredContent).toEqual({
      stage: "paired",
      device_label: "Forerunner 255",
    });

    await waitPoll(started.device_code);
    const issued = await poll(started.device_code);
    expect("access_token" in issued).toBe(true);
    const access = issued as {
      access_token: string;
      device_id: string;
      account_label: string;
    };
    expect(access.account_label).toMatch(/^Arnold · .{4}$/);
    // Exactly once.
    await waitPoll(started.device_code);
    expect(await poll(started.device_code)).toMatchObject({
      status: "expired",
    });
    // The token is a watch token: it opens the watch API, not /mcp.
    const plan = await fetch(`${base}/api/watch/v1/plan`, {
      headers: { authorization: `Bearer ${access.access_token}` },
    });
    expect(plan.status).toBe(409); // set-up still missing, but authenticated
    const timezone = await asOwner(
      async (c) =>
        (
          await c.query(
            "select timezone from arnold.watch_devices where device_id = $1",
            [access.device_id],
          )
        ).rows[0].timezone,
    );
    expect(timezone).toBe("Europe/Berlin");

    // Listed, then unpaired: the token stops working at once.
    const listed = ListGarminWatchesSchema.parse(
      (await alice("list_garmin_watches")).structuredContent,
    );
    expect(listed.watches.map((w) => w.device_id)).toEqual([access.device_id]);
    const unpaired = await alice("unpair_garmin_watch", {
      device_id: access.device_id,
    });
    expect(unpaired.structuredContent).toEqual({
      device_id: access.device_id,
      unpaired: true,
    });
    expect(
      (
        await fetch(`${base}/api/watch/v1/plan`, {
          headers: { authorization: `Bearer ${access.access_token}` },
        })
      ).status,
    ).toBe(401);
  });

  it("lets the settings card pair, list and unpair with its own model", async () => {
    const alice = await chat(`alice-${randomUUID()}`);
    const started = await startPairing();
    const first = await alice("pair_garmin_watch", {
      user_code: watchCode(` ${started.user_code.toLowerCase()} `)!,
      timezone: "Europe/Berlin",
    });
    const confirm = pairConfirmation(
      (first._meta as { arnold: Record<string, unknown> }).arnold,
    );
    expect(confirm?.device_label).toBe("Forerunner 255");
    const paired = await alice("pair_garmin_watch", pairConfirmInput(confirm!));
    expect(paired.structuredContent).toEqual({
      stage: "paired",
      device_label: "Forerunner 255",
    });
    // The watch appears once it has fetched its token.
    await waitPoll(started.device_code);
    expect("access_token" in (await poll(started.device_code))).toBe(true);
    const list = ListGarminWatchesSchema.parse(
      (await alice("list_garmin_watches", {})).structuredContent,
    );
    const status = watchStatus(list);
    expect(status).toMatchObject({ connected: true, label: "Forerunner 255" });
    const gone = await alice("unpair_garmin_watch", {
      device_id: status.deviceId!,
    });
    expect(gone.structuredContent).toMatchObject({ unpaired: true });
    expect(
      watchStatus(
        ListGarminWatchesSchema.parse(
          (await alice("list_garmin_watches", {})).structuredContent,
        ),
      ).connected,
    ).toBe(false);
  });

  it("gives the card its time zone only in _meta and the account card the watch's label (GAR-B5-01)", async () => {
    const alice = await chat(`alice-${randomUUID()}`);
    const started = await startPairing();
    const first = await alice("pair_garmin_watch", {
      user_code: started.user_code,
      timezone: "America/New_York",
    });
    expect(JSON.stringify(first.structuredContent)).not.toContain(
      "America/New_York",
    );
    const meta = PairGarminWatchConfirmMetaSchema.parse(
      (first._meta as { arnold: { pair_garmin_watch: unknown } }).arnold
        .pair_garmin_watch,
    );
    expect(meta.timezone).toBe("America/New_York");
    // The card sends back exactly what it was given, and that pairs.
    const paired = await alice("pair_garmin_watch", {
      user_code: meta.user_code,
      timezone: meta.timezone,
      confirmation_token: meta.confirmation_token,
    });
    expect(paired.structuredContent).toMatchObject({ stage: "paired" });
    await waitPoll(started.device_code);
    const issued = (await poll(started.device_code)) as {
      account_label: string;
    };
    const listed = ListGarminWatchesSchema.parse(
      (await alice("list_garmin_watches")).structuredContent,
    );
    expect(listed.account_label).toBe(issued.account_label);
    expect(listed.account_label).toMatch(/^Arnold · .{4}$/);
    expect(listed.watches).toHaveLength(1);
  });

  it("never lets another account use the confirmation or see the watch", async () => {
    const alice = await chat(`alice-${randomUUID()}`);
    const bob = await chat(`bob-${randomUUID()}`);
    const started = await startPairing();
    const first = await alice("pair_garmin_watch", {
      user_code: started.user_code,
      timezone: "Europe/Berlin",
    });
    const token = PairGarminWatchConfirmMetaSchema.parse(
      (first._meta as { arnold: { pair_garmin_watch: unknown } }).arnold
        .pair_garmin_watch,
    ).confirmation_token;
    const stolen = await bob("pair_garmin_watch", {
      user_code: started.user_code,
      timezone: "Europe/Berlin",
      confirmation_token: token,
    });
    expect(stolen.isError).toBe(true);
    expect(JSON.stringify(stolen.content)).toContain("CONFIRMATION_INVALID");
    await alice("pair_garmin_watch", {
      user_code: started.user_code,
      timezone: "Europe/Berlin",
      confirmation_token: token,
    });
    await waitPoll(started.device_code);
    const issued = (await poll(started.device_code)) as { device_id: string };
    expect(
      ListGarminWatchesSchema.parse(
        (await bob("list_garmin_watches")).structuredContent,
      ).watches,
    ).toEqual([]);
    const foreign = await bob("unpair_garmin_watch", {
      device_id: issued.device_id,
    });
    expect(foreign.structuredContent).toMatchObject({ unpaired: false });
    expect(
      ListGarminWatchesSchema.parse(
        (await alice("list_garmin_watches")).structuredContent,
      ).watches,
    ).toHaveLength(1);
  });

  it("locks an account after five wrong codes in an hour", async () => {
    const alice = await chat(`alice-${randomUUID()}`);
    const started = await startPairing();
    for (let i = 0; i < 5; i++) {
      const wrong = await alice("pair_garmin_watch", {
        user_code: i === 0 ? "not-a-code" : newUserCode(),
        timezone: "Europe/Berlin",
      });
      expect(wrong.isError).toBe(true);
      expect(JSON.stringify(wrong.content)).toContain("VALIDATION_ERROR");
    }
    const locked = await alice("pair_garmin_watch", {
      user_code: started.user_code,
      timezone: "Europe/Berlin",
    });
    expect(locked.isError).toBe(true);
    expect(JSON.stringify(locked.content)).toContain("RATE_LIMITED");
  });

  it("refuses broken pairing requests and unknown device codes", async () => {
    expect((await watch("/pair/start", { device_label: "x" })).status).toBe(
      422,
    );
    expect(await poll("A".repeat(43))).toMatchObject({ status: "expired" });
  });
});
