/**
 * The hosted test instance behind a login: synthetic data, one sandbox per
 * user, Arnold's scopes carried in a namespaced claim (WorkOS AuthKit style).
 *
 * Runs a real `createHttpApp` against a tiny issuer on loopback, so discovery,
 * the JWKS fetch, the bearer gate and the per-call guard are all exercised.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import {
  Client,
  StreamableHTTPClientTransport,
} from "@modelcontextprotocol/client";
import { createHttpApp } from "../src/server/http.js";
import { loadAuthConfig } from "../src/server/auth/config.js";
import { buildAuthSurface } from "../src/server/auth/router.js";
import { fetchAuthorizationServerMetadata } from "../src/server/auth/discovery.js";
import { InMemoryIdentityRepository } from "../src/server/identity/repository.js";
import { FixtureSandboxes } from "../src/server/fixture-sandboxes.js";
import {
  jwksDocument,
  makeRsaKey,
  signJwt,
  validClaims,
} from "./fixtures/arnold-auth.js";

const key = makeRsaKey("sandbox-rsa-1");
const SCOPE_CLAIM = "urn:arnold:scopes";
const ISSUER_SCOPES = ["email", "offline_access", "openid", "profile"];

let issuerServer: Server;
let issuer: string;
let arnold: Server;
let resource: string;
let base: string;

const portOf = (server: Server) => (server.address() as { port: number }).port;
const listen = (server: Server) =>
  new Promise<void>((resolve, reject) => {
    server.once("listening", () => resolve());
    server.once("error", reject);
  });
const close = (server: Server | undefined) =>
  new Promise<void>((resolve) => {
    if (!server) return resolve();
    server.close(() => resolve());
    server.closeAllConnections();
  });

beforeAll(async () => {
  issuerServer = createServer((req, res) => {
    const url = req.url ?? "";
    if (url.startsWith("/oauth2/jwks")) {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(jwksDocument(key)));
      return;
    }
    if (url.startsWith("/.well-known/oauth-authorization-server")) {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          issuer,
          authorization_endpoint: `${issuer}/oauth2/authorize`,
          token_endpoint: `${issuer}/oauth2/token`,
          registration_endpoint: `${issuer}/oauth2/register`,
          response_types_supported: ["code"],
          grant_types_supported: ["authorization_code", "refresh_token"],
          code_challenge_methods_supported: ["S256"],
          scopes_supported: ISSUER_SCOPES,
        }),
      );
      return;
    }
    res.writeHead(404).end();
  }).listen(0, "127.0.0.1");
  await listen(issuerServer);
  // AuthKit issuers have no trailing slash; the test mirrors that.
  issuer = `http://127.0.0.1:${portOf(issuerServer)}`;

  const probe = createServer().listen(0, "127.0.0.1");
  await listen(probe);
  const port = portOf(probe);
  await close(probe);
  base = `http://127.0.0.1:${port}`;
  resource = `${base}/mcp`;

  const config = loadAuthConfig({
    ARNOLD_ENV: "development",
    AUTH_MODE: "oidc",
    ARNOLD_PUBLIC_BASE_URL: base,
    AUTH_ISSUER: issuer,
    AUTH_JWKS_URI: `${issuer}/oauth2/jwks`,
    AUTH_SCOPE_CLAIM: SCOPE_CLAIM,
  } as NodeJS.ProcessEnv);
  const auth = buildAuthSurface({
    config,
    authorizationServerMetadata: await fetchAuthorizationServerMetadata({
      issuer,
    }),
    repository: new InMemoryIdentityRepository(),
  });
  arnold = createHttpApp({ env: {}, auth }).listen(port, "127.0.0.1");
  await listen(arnold);
});

afterAll(async () => {
  await close(arnold);
  await close(issuerServer);
});

const ALL = "arnold.read arnold.write arnold.plan";

async function clientFor(subject: string, claims: Record<string, unknown>) {
  const token = signJwt(
    key,
    validClaims({
      iss: issuer,
      aud: resource,
      sub: subject,
      scope: "openid profile email offline_access",
      ...claims,
    }),
  );
  const client = new Client({ name: "arnold-sandbox-tests", version: "1" });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(resource), {
      requestInit: { headers: { authorization: `Bearer ${token}` } },
    }),
  );
  return client;
}

type Structured = {
  ok?: boolean;
  result?: { workout?: { workout_id: string } };
  error?: { message?: string };
};

async function startWorkout(client: Client) {
  return (await client.callTool({
    name: "start_workout",
    arguments: {
      request_id: "sandbox-first",
      workout_date_local: "2026-10-30",
      timezone: "Europe/Berlin",
      session_name: "Einheit 1",
    },
  })) as { isError?: boolean; structuredContent?: Structured };
}

describe("discovery with a separate scope claim", () => {
  it("advertises the issuer's own scopes, which it can actually grant", async () => {
    const document = (await (
      await fetch(`${base}/.well-known/oauth-protected-resource/mcp`)
    ).json()) as { scopes_supported?: string[] };
    expect(document.scopes_supported).toEqual(ISSUER_SCOPES);
  });

  it("still reports synthetic data and oidc on /health", async () => {
    const health = await (await fetch(`${base}/health`)).json();
    expect(health.auth).toBe("oidc");
    expect(health.synthetic).toBe(true);
  });
});

describe("one synthetic sandbox per signed-in user", () => {
  it("lets a user with the template scopes read and write", async () => {
    const alice = await clientFor("subject-alice", { [SCOPE_CLAIM]: ALL });
    const dashboard = await alice.callTool({
      name: "get_arnold_dashboard",
      arguments: {},
    });
    expect(dashboard.isError).toBeFalsy();
    const started = await startWorkout(alice);
    expect(started.isError).toBeFalsy();
    expect(started.structuredContent?.ok).toBe(true);
    await alice.close();
  });

  it("keeps one user's writes out of another user's sandbox", async () => {
    const alice = await clientFor("subject-alice-2", { [SCOPE_CLAIM]: ALL });
    const bob = await clientFor("subject-bob", { [SCOPE_CLAIM]: ALL });
    const started = await startWorkout(alice);
    const id = started.structuredContent!.result!.workout!.workout_id;

    const own = await alice.callTool({
      name: "get_workout",
      arguments: { workout_id: id },
    });
    expect(own.isError).toBeFalsy();

    const foreign = (await bob.callTool({
      name: "get_workout",
      arguments: { workout_id: id },
    })) as { isError?: boolean; structuredContent?: Structured };
    expect(
      foreign.isError === true || foreign.structuredContent?.ok === false,
    ).toBe(true);
    await alice.close();
    await bob.close();
  });

  it("refuses a write when the template grants only reading", async () => {
    const reader = await clientFor("subject-reader", {
      [SCOPE_CLAIM]: "arnold.read",
    });
    const result = await startWorkout(reader).catch(() => ({
      isError: true,
    }));
    expect(result.isError).toBe(true);
    await reader.close();
  });

  it("ignores Arnold scopes in the standard claim once a scope claim is configured", async () => {
    const sneaky = await clientFor("subject-sneaky", { scope: ALL });
    const result = (await sneaky
      .callTool({ name: "get_arnold_dashboard", arguments: {} })
      .catch(() => ({ isError: true }))) as { isError?: boolean };
    expect(result.isError).toBe(true);
    await sneaky.close();
  });

  it("refuses /mcp without a token", async () => {
    const response = await fetch(resource, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    });
    expect(response.status).toBe(401);
  });
});

describe("AUTH_SCOPE_CLAIM configuration", () => {
  const oidcEnv = {
    ARNOLD_ENV: "development",
    AUTH_MODE: "oidc",
    AUTH_ISSUER: "https://auth.example.test",
    AUTH_JWKS_URI: "https://auth.example.test/oauth2/jwks",
  };

  it.each(["scope", "arnold_scopes", "urn:", "urn:arnold", "https://x/y"])(
    "refuses AUTH_SCOPE_CLAIM=%s",
    (value) => {
      expect(() =>
        loadAuthConfig({ ...oidcEnv, AUTH_SCOPE_CLAIM: value }),
      ).toThrow(/AUTH_SCOPE_CLAIM/);
    },
  );

  it("refuses a scope claim while authentication is off", () => {
    expect(() =>
      loadAuthConfig({
        ARNOLD_ENV: "development",
        AUTH_MODE: "open",
        AUTH_SCOPE_CLAIM: SCOPE_CLAIM,
      }),
    ).toThrow(/AUTH_SCOPE_CLAIM/);
  });

  it("accepts a namespaced claim", () => {
    expect(
      loadAuthConfig({ ...oidcEnv, AUTH_SCOPE_CLAIM: SCOPE_CLAIM }).oidc
        ?.scopeClaim,
    ).toBe(SCOPE_CLAIM);
  });
});

describe("FixtureSandboxes", () => {
  const auth = buildAuthSurface({
    config: loadAuthConfig({
      ARNOLD_ENV: "development",
      AUTH_MODE: "oidc",
      AUTH_ISSUER: "https://auth.example.test",
      AUTH_JWKS_URI: "https://auth.example.test/oauth2/jwks",
    }),
    authorizationServerMetadata: {
      issuer: "https://auth.example.test",
      authorization_endpoint: "https://auth.example.test/authorize",
      token_endpoint: "https://auth.example.test/token",
      response_types_supported: ["code"],
      code_challenge_methods_supported: ["S256"],
    },
  });
  const contextFor = (userId: string) =>
    ({ userId }) as Parameters<FixtureSandboxes["forUser"]>[0];
  const active = { ...auth, assertActive: async () => {} };

  it("refuses to exist without a login", () => {
    const open = buildAuthSurface({
      config: loadAuthConfig({ ARNOLD_ENV: "development" }),
    });
    expect(() => new FixtureSandboxes(open)).toThrow(/AUTH_MODE=oidc/);
  });

  it("drops the least recently used sandbox beyond the limit", async () => {
    const sandboxes = new FixtureSandboxes(active, 2);
    const a = await sandboxes.forUser(contextFor("usr_a"));
    const b = await sandboxes.forUser(contextFor("usr_b"));
    expect(await sandboxes.forUser(contextFor("usr_a"))).toBe(a);
    await sandboxes.forUser(contextFor("usr_c"));
    expect(sandboxes.size).toBe(2);
    // a was used more recently than b, so b went first.
    expect(await sandboxes.forUser(contextFor("usr_a"))).toBe(a);
    expect(await sandboxes.forUser(contextFor("usr_b"))).not.toBe(b);
    expect(sandboxes.size).toBe(2);
  });
});
