/**
 * The authenticated MCP endpoint, over real HTTP.
 *
 * The unit tests prove the verifier refuses bad tokens. This file proves the
 * refusals actually reach the wire the way a client needs them to: a `401`
 * carrying a `WWW-Authenticate` challenge that points at a discoverable
 * protected-resource document, and an `/mcp` route that cannot be reached
 * without a token.
 *
 * It runs against a real `createHttpApp` and a real (if tiny) authorization
 * server on loopback, so the JWKS fetch, the discovery validation and the
 * bearer middleware are all genuinely exercised. Nothing here is stubbed
 * except the issuer itself.
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
import type { GuardEvent } from "../src/server/auth/tool-guard.js";
import {
  jwksDocument,
  makeRsaKey,
  signJwt,
  validClaims,
} from "./fixtures/arnold-auth.js";

const key = makeRsaKey("http-rsa-1");

let issuerServer: Server;
let issuer: string;
let arnold: Server;
let base: string;
let resource: string;
let jwksRequests = 0;
const guardEvents: GuardEvent[] = [];

/** A minimal authorization server: metadata plus a JWKS, nothing else. */
function startIssuer(): Promise<Server> {
  const server = createServer((req, res) => {
    const url = req.url ?? "";
    if (url.startsWith("/.well-known/jwks.json")) {
      jwksRequests += 1;
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(jwksDocument(key)));
      return;
    }
    if (url.startsWith("/.well-known/oauth-authorization-server")) {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          issuer,
          authorization_endpoint: `${issuer}authorize`,
          token_endpoint: `${issuer}token`,
          registration_endpoint: `${issuer}register`,
          response_types_supported: ["code"],
          grant_types_supported: ["authorization_code", "refresh_token"],
          code_challenge_methods_supported: ["S256"],
        }),
      );
      return;
    }
    res.writeHead(404).end();
  });
  return new Promise((resolve, reject) => {
    server.listen(0, "127.0.0.1", () => resolve(server));
    server.once("error", reject);
  });
}

const listen = (server: Server) =>
  new Promise<void>((resolve, reject) => {
    server.once("listening", () => resolve());
    server.once("error", reject);
  });

const portOf = (server: Server) => (server.address() as { port: number }).port;

beforeAll(async () => {
  issuerServer = await startIssuer();
  issuer = `http://127.0.0.1:${portOf(issuerServer)}/`;

  // A real app, configured as a protected resource. The port is not known
  // until Arnold listens, so the resource identifier is pinned first and the
  // listener bound to the same port afterwards.
  const probe = createServer();
  probe.listen(0, "127.0.0.1");
  await listen(probe);
  const port = portOf(probe);
  await new Promise<void>((resolve) => probe.close(() => resolve()));

  base = `http://127.0.0.1:${port}`;
  resource = `${base}/mcp`;

  const config = loadAuthConfig({
    ARNOLD_ENV: "development",
    AUTH_MODE: "oidc",
    ARNOLD_PUBLIC_BASE_URL: base,
    AUTH_ISSUER: issuer,
    AUTH_JWKS_URI: `${issuer}.well-known/jwks.json`,
  } as NodeJS.ProcessEnv);

  const metadata = await fetchAuthorizationServerMetadata({ issuer });

  const auth = buildAuthSurface({
    config,
    authorizationServerMetadata: metadata,
    repository: new InMemoryIdentityRepository(),
    onGuardEvent: (event) => guardEvents.push(event),
  });

  arnold = createHttpApp({
    env: {},
    auth,
  }).listen(port, "127.0.0.1");
  await listen(arnold);
});

afterAll(async () => {
  await new Promise<void>((resolve) => {
    arnold?.close(() => resolve());
    arnold?.closeAllConnections();
  });
  await new Promise<void>((resolve) => {
    issuerServer?.close(() => resolve());
    issuerServer?.closeAllConnections();
  });
});

const bearer = (token: string) => ({ authorization: `Bearer ${token}` });

/**
 * Claims aimed at *this* deployment.
 *
 * The shared fixture defaults to its own synthetic issuer and audience, which
 * are not the ones this suite boots. Pinning both here means each test below
 * fails for the reason it names rather than incidentally on `iss`.
 */
const claimsFor = (overrides: Record<string, unknown> = {}) =>
  validClaims({ iss: issuer, aud: resource, ...overrides });

describe("protected resource discovery", () => {
  it("serves RFC 9728 protected resource metadata", async () => {
    const response = await fetch(
      `${base}/.well-known/oauth-protected-resource/mcp`,
    );
    expect(response.status).toBe(200);
    const document = (await response.json()) as {
      resource: string;
      authorization_servers?: string[];
      scopes_supported?: string[];
    };
    expect(document.resource).toBe(resource);
    expect(document.authorization_servers).toContain(issuer);
    expect(document.scopes_supported).toContain("arnold.read");
    expect(document.scopes_supported).toContain("arnold.account");
  });

  it("serves RFC 8414 authorization server metadata for legacy probes", async () => {
    const response = await fetch(
      `${base}/.well-known/oauth-authorization-server`,
    );
    expect(response.status).toBe(200);
    const document = (await response.json()) as {
      issuer: string;
      code_challenge_methods_supported?: string[];
    };
    expect(document.issuer).toBe(issuer);
    expect(document.code_challenge_methods_supported).toContain("S256");
  });

  it("reports the authentication mode on /health without naming the issuer", async () => {
    const response = await fetch(`${base}/health`);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body.auth).toBe("oidc");
    expect(JSON.stringify(body)).not.toContain("jwks");
  });
});

describe("the /mcp gate", () => {
  it("refuses an unauthenticated request with a discoverable challenge", async () => {
    const response = await fetch(`${resource}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    });

    expect(response.status).toBe(401);
    const challenge = response.headers.get("www-authenticate") ?? "";
    expect(challenge).toMatch(/^Bearer/);
    // Without the pointer a client cannot find out how to authenticate.
    expect(challenge).toContain("resource_metadata=");
    expect(challenge).toContain("/.well-known/oauth-protected-resource");
  });

  it("refuses a garbage bearer token", async () => {
    const response = await fetch(`${resource}`, {
      method: "POST",
      headers: { "content-type": "application/json", ...bearer("not-a-jwt") },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    });
    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toContain("invalid_token");
  });

  it("refuses a token minted for a different resource", async () => {
    // Same issuer, same signing key, different resource — the cross-resource
    // replay that RFC 8707 exists to stop.
    const token = signJwt(
      key,
      claimsFor({ aud: "https://someone-elses-mcp.test/mcp" }),
    );
    const response = await fetch(`${resource}`, {
      method: "POST",
      headers: { "content-type": "application/json", ...bearer(token) },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    });
    expect(response.status).toBe(401);
  });

  it("refuses a token from a different issuer", async () => {
    const token = signJwt(key, claimsFor({ iss: "https://evil.test/" }));
    const response = await fetch(`${resource}`, {
      method: "POST",
      headers: { "content-type": "application/json", ...bearer(token) },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    });
    expect(response.status).toBe(401);
  });

  it("refuses an expired token", async () => {
    const nowSec = Math.floor(Date.now() / 1000);
    const token = signJwt(
      key,
      claimsFor({ iat: nowSec - 7200, exp: nowSec - 3600 }),
    );
    const response = await fetch(`${resource}`, {
      method: "POST",
      headers: { "content-type": "application/json", ...bearer(token) },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    });
    expect(response.status).toBe(401);
  });

  it("admits a valid token and completes an MCP session", async () => {
    const token = signJwt(
      key,
      claimsFor({ scope: "arnold.profile arnold.read" }),
    );
    const client = new Client({ name: "arnold-auth-tests", version: "1.0.0" });
    await client.connect(
      new StreamableHTTPClientTransport(new URL(resource), {
        requestInit: { headers: bearer(token) },
      }),
    );

    const { tools } = await client.listTools();
    expect(tools.length).toBeGreaterThan(0);

    await client.close();
  });

  it("fetched the issuer's JWKS rather than trusting configuration", () => {
    // Proof the key material came from the issuer over the network, which is
    // what makes rotation possible at all.
    expect(jwksRequests).toBeGreaterThan(0);
  });

  it("runs each tool call through the per-call guard", async () => {
    // Both gates together, end to end: the transport admits the token, and
    // the guard then authorizes the individual tool and resolves a user.
    const token = signJwt(key, claimsFor({ scope: "arnold.read" }));
    const client = new Client({ name: "arnold-auth-tests", version: "1.0.0" });
    await client.connect(
      new StreamableHTTPClientTransport(new URL(resource), {
        requestInit: { headers: bearer(token) },
      }),
    );

    const before = guardEvents.length;
    await client.callTool({ name: "get_arnold_dashboard_v2", arguments: {} });
    await client.close();

    const granted = guardEvents
      .slice(before)
      .find((event) => event.tool === "get_arnold_dashboard_v2");
    expect(granted?.kind).toBe("granted");
    expect(granted?.access).toBe("AUTHENTICATED_READ");
    expect(granted?.userId).toMatch(/^usr_/);
  });

  it("refuses a tool whose scope the token does not carry", async () => {
    // The token authenticates fine at the transport, so this refusal comes
    // from the authorization layer rather than the gate.
    const token = signJwt(key, claimsFor({ scope: "arnold.profile" }));
    const client = new Client({ name: "arnold-auth-tests", version: "1.0.0" });
    await client.connect(
      new StreamableHTTPClientTransport(new URL(resource), {
        requestInit: { headers: bearer(token) },
      }),
    );

    const before = guardEvents.length;
    const result = (await client
      .callTool({ name: "get_arnold_dashboard_v2", arguments: {} })
      .catch((error: unknown) => ({ thrown: error }))) as {
      isError?: boolean;
      thrown?: unknown;
    };
    await client.close();

    expect(result.isError ?? result.thrown !== undefined).toBe(true);

    // Documents where the refusal came from, which is not where one might
    // assume. The SDK's registered scope challenge rejects an under-scoped
    // call *before* the handler runs — the protocol-correct behaviour, since
    // it answers with an insufficient_scope challenge a client can act on by
    // fetching a better token.
    //
    // The consequence is an observability gap, recorded here rather than
    // discovered in production: because the handler never runs, Arnold's own
    // guard never sees the call and emits no audit event. Scope refusals are
    // therefore visible to the client but absent from the audit sink that
    // §26 asks to monitor. Closing it needs the challenge path reported too.
    expect(guardEvents.slice(before)).toEqual([]);
  });
});

describe("open mode keeps the pre-Task-007 profiles working", () => {
  let openServer: Server;
  let openBase: string;

  beforeAll(async () => {
    const config = loadAuthConfig({
      ARNOLD_ENV: "development",
    } as NodeJS.ProcessEnv);
    const auth = buildAuthSurface({
      config,
      repository: new InMemoryIdentityRepository(),
    });
    openServer = createHttpApp({
      env: {},
      auth,
    }).listen(0, "127.0.0.1");
    await listen(openServer);
    openBase = `http://127.0.0.1:${portOf(openServer)}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => {
      openServer?.close(() => resolve());
      openServer?.closeAllConnections();
    });
  });

  it("serves /mcp with no token at all", async () => {
    const client = new Client({ name: "arnold-open-tests", version: "1.0.0" });
    await client.connect(
      new StreamableHTTPClientTransport(new URL(`${openBase}/mcp`)),
    );
    const { tools } = await client.listTools();
    expect(tools.length).toBeGreaterThan(0);
    await client.close();
  });

  it("advertises no protected resource document, because it protects nothing", async () => {
    const response = await fetch(
      `${openBase}/.well-known/oauth-protected-resource/mcp`,
    );
    expect(response.status).toBe(404);
  });

  it("reports open mode on /health", async () => {
    const body = (await (await fetch(`${openBase}/health`)).json()) as {
      auth: string;
    };
    expect(body.auth).toBe("open");
  });
});
