/**
 * The authentication half of Task 007 §29.
 *
 * Every test here is an attempt to get a verified identity out of Arnold
 * without being entitled to one. They are written as attacks rather than as
 * "verifier returns AuthInfo" happy paths, because the happy path is one
 * assertion and the refusals are the actual security property.
 */
import { describe, expect, it } from "vitest";
import { OAuthError } from "@modelcontextprotocol/server";
import {
  ArnoldTokenVerifier,
  canonicalResource,
  verifiedSubject,
} from "../src/server/auth/token-verifier.js";
import { JwksCache, StaticJwks } from "../src/server/auth/jwks.js";
import { decodeJwt } from "../src/server/auth/jwt.js";
import {
  TEST_AUDIENCE,
  TEST_ISSUER,
  jwksDocument,
  jwksServer,
  makeEcKey,
  makeRsaKey,
  signJwt,
  tamperClaims,
  tamperSignature,
  validClaims,
} from "./fixtures/arnold-auth.js";

const rsa = makeRsaKey();
const ec = makeEcKey("ec-1", "ES256");

const verifierFor = (
  keys: ConstructorParameters<typeof StaticJwks>[0],
  overrides: Partial<ConstructorParameters<typeof ArnoldTokenVerifier>[0]> = {},
) =>
  new ArnoldTokenVerifier({
    issuer: TEST_ISSUER,
    audience: TEST_AUDIENCE,
    keys: new StaticJwks(keys),
    ...overrides,
  });

/** Asserts the call was refused as an OAuth error with the given code. */
async function refuses(
  promise: Promise<unknown>,
  code: "invalid_token" | "insufficient_scope" | "temporarily_unavailable",
) {
  const error = await promise.then(
    () => null,
    (caught: unknown) => caught,
  );
  expect(error, "expected a refusal, got success").toBeInstanceOf(OAuthError);
  expect((error as OAuthError).code).toBe(code);
}

describe("Arnold access token verification", () => {
  it("accepts a well-formed RS256 token and reports the verified subject", async () => {
    const verifier = verifierFor([rsa.publicJwk]);
    const auth = await verifier.verifyAccessToken(
      signJwt(rsa, validClaims({ sub: "subject-alice" })),
    );

    expect(auth.clientId).toBe("chatgpt-test-client");
    expect(auth.scopes).toEqual(["arnold.profile", "arnold.read"]);
    expect(auth.expiresAt).toBeGreaterThan(Math.floor(Date.now() / 1000));
    expect(auth.resource?.toString()).toBe(TEST_AUDIENCE);
    expect(verifiedSubject(auth)).toEqual({
      issuer: TEST_ISSUER,
      subject: "subject-alice",
    });
  });

  it("accepts ES256 when the key is on the matching curve", async () => {
    const verifier = verifierFor([ec.publicJwk]);
    const auth = await verifier.verifyAccessToken(
      signJwt(ec, validClaims(), { alg: "ES256", kid: ec.kid }),
    );
    expect(verifiedSubject(auth).subject).toBe("subject-alice");
  });

  describe("refuses structurally invalid credentials", () => {
    it("an empty token", async () => {
      await refuses(
        verifierFor([rsa.publicJwk]).verifyAccessToken(""),
        "invalid_token",
      );
    });

    it("a token that is not three segments", async () => {
      await refuses(
        verifierFor([rsa.publicJwk]).verifyAccessToken("not.a.jwt.at.all"),
        "invalid_token",
      );
    });

    it("a segment that is not base64url", async () => {
      await refuses(
        verifierFor([rsa.publicJwk]).verifyAccessToken("abc!.def.ghi"),
        "invalid_token",
      );
    });

    it("an opaque (non-JWT) bearer string", async () => {
      await refuses(
        verifierFor([rsa.publicJwk]).verifyAccessToken("opaque-token-value"),
        "invalid_token",
      );
    });
  });

  describe("refuses signature attacks", () => {
    it("alg: none — an unsigned token is not a token", async () => {
      await refuses(
        verifierFor([rsa.publicJwk]).verifyAccessToken(
          signJwt(rsa, validClaims(), { alg: "none" }),
        ),
        "invalid_token",
      );
    });

    it("HS256 signed with the public key (algorithm confusion)", async () => {
      // The canonical break: if Arnold trusted the header's `alg`, it would
      // HMAC-verify this with the RSA public key it already holds and accept.
      const attack = signJwt(rsa, validClaims({ sub: "attacker" }), {
        alg: "HS256",
      });
      await refuses(
        verifierFor([rsa.publicJwk]).verifyAccessToken(attack),
        "invalid_token",
      );
    });

    it("a flipped signature byte", async () => {
      await refuses(
        verifierFor([rsa.publicJwk]).verifyAccessToken(
          tamperSignature(signJwt(rsa, validClaims())),
        ),
        "invalid_token",
      );
    });

    it("claims swapped under a valid signature", async () => {
      const honest = signJwt(rsa, validClaims({ sub: "subject-alice" }));
      const forged = tamperClaims(
        honest,
        validClaims({ sub: "subject-bob", scope: "arnold.read arnold.write" }),
      );
      await refuses(
        verifierFor([rsa.publicJwk]).verifyAccessToken(forged),
        "invalid_token",
      );
    });

    it("an ES256 header verified against an RSA key", async () => {
      // Declaring a curve algorithm while the resolved key is RSA must fail on
      // the key/alg compatibility check, before any crypto runs.
      const token = signJwt(rsa, validClaims(), { alg: "ES256", kid: rsa.kid });
      await refuses(
        verifierFor([{ ...rsa.publicJwk, alg: undefined }]).verifyAccessToken(
          token,
        ),
        "invalid_token",
      );
    });

    it("a token signed by a key the issuer does not publish", async () => {
      const foreign = makeRsaKey("rsa-foreign");
      await refuses(
        verifierFor([rsa.publicJwk]).verifyAccessToken(
          signJwt(foreign, validClaims(), { kid: rsa.kid }),
        ),
        "invalid_token",
      );
    });

    it("an unknown kid", async () => {
      await refuses(
        verifierFor([rsa.publicJwk]).verifyAccessToken(
          signJwt(rsa, validClaims(), { kid: "rotated-away" }),
        ),
        "invalid_token",
      );
    });

    it("a kid-less token when the issuer publishes several keys", async () => {
      const second = makeRsaKey("rsa-2");
      const token = signJwt(rsa, validClaims(), { kid: undefined });
      await refuses(
        verifierFor([rsa.publicJwk, second.publicJwk]).verifyAccessToken(token),
        "invalid_token",
      );
    });

    it("a key published for a different algorithm", async () => {
      const token = signJwt(rsa, validClaims(), { alg: "PS256" });
      await refuses(
        // The JWK pins alg: RS256, so PS256 must not borrow it.
        verifierFor([rsa.publicJwk]).verifyAccessToken(token),
        "invalid_token",
      );
    });

    it("a key marked for encryption rather than signing", async () => {
      await refuses(
        verifierFor([{ ...rsa.publicJwk, use: "enc" }]).verifyAccessToken(
          signJwt(rsa, validClaims()),
        ),
        "invalid_token",
      );
    });
  });

  describe("refuses claim-level failures", () => {
    const nowSec = Math.floor(Date.now() / 1000);

    it("a wrong issuer", async () => {
      await refuses(
        verifierFor([rsa.publicJwk]).verifyAccessToken(
          signJwt(rsa, validClaims({ iss: "https://evil.test/" })),
        ),
        "invalid_token",
      );
    });

    it("a missing subject", async () => {
      await refuses(
        verifierFor([rsa.publicJwk]).verifyAccessToken(
          signJwt(rsa, validClaims({ sub: undefined })),
        ),
        "invalid_token",
      );
    });

    it("an expired token", async () => {
      await refuses(
        verifierFor([rsa.publicJwk]).verifyAccessToken(
          signJwt(rsa, validClaims({ iat: nowSec - 7200, exp: nowSec - 3600 })),
        ),
        "invalid_token",
      );
    });

    it("a token with no exp at all", async () => {
      await refuses(
        verifierFor([rsa.publicJwk]).verifyAccessToken(
          signJwt(rsa, validClaims({ exp: undefined })),
        ),
        "invalid_token",
      );
    });

    it("a not-yet-valid token", async () => {
      await refuses(
        verifierFor([rsa.publicJwk]).verifyAccessToken(
          signJwt(rsa, validClaims({ nbf: nowSec + 3600 })),
        ),
        "invalid_token",
      );
    });

    it("a token issued in the future", async () => {
      await refuses(
        verifierFor([rsa.publicJwk]).verifyAccessToken(
          signJwt(rsa, validClaims({ iat: nowSec + 3600, exp: nowSec + 7200 })),
        ),
        "invalid_token",
      );
    });

    it("a token whose lifetime exceeds the configured ceiling", async () => {
      await refuses(
        verifierFor([rsa.publicJwk]).verifyAccessToken(
          signJwt(
            rsa,
            validClaims({ iat: nowSec, exp: nowSec + 90 * 24 * 3600 }),
          ),
        ),
        "invalid_token",
      );
    });

    it("a missing audience", async () => {
      await refuses(
        verifierFor([rsa.publicJwk]).verifyAccessToken(
          signJwt(rsa, validClaims({ aud: undefined })),
        ),
        "invalid_token",
      );
    });

    it("an audience naming a different MCP server (RFC 8707)", async () => {
      // The cross-resource replay: a valid token from the same issuer, minted
      // for another resource behind the same authorization server.
      await refuses(
        verifierFor([rsa.publicJwk]).verifyAccessToken(
          signJwt(rsa, validClaims({ aud: "https://other-mcp.test/mcp" })),
        ),
        "invalid_token",
      );
    });

    it("an ID token presented as an access token", async () => {
      await refuses(
        verifierFor([rsa.publicJwk]).verifyAccessToken(
          signJwt(rsa, validClaims(), { typ: "JWT+ID" }),
        ),
        "invalid_token",
      );
    });
  });

  describe("accepts legitimate variation", () => {
    it("an aud array that includes Arnold", async () => {
      const auth = await verifierFor([rsa.publicJwk]).verifyAccessToken(
        signJwt(
          rsa,
          validClaims({ aud: ["https://other.test/mcp", TEST_AUDIENCE] }),
        ),
      );
      expect(auth.resource?.toString()).toBe(TEST_AUDIENCE);
    });

    it("a trailing slash difference in aud", async () => {
      const auth = await verifierFor([rsa.publicJwk]).verifyAccessToken(
        signJwt(rsa, validClaims({ aud: `${TEST_AUDIENCE}/` })),
      );
      expect(auth.resource?.toString()).toBe(TEST_AUDIENCE);
    });

    it("scopes delivered as scp array instead of scope string", async () => {
      const auth = await verifierFor([rsa.publicJwk]).verifyAccessToken(
        signJwt(
          rsa,
          validClaims({
            scope: undefined,
            scp: ["arnold.read", "arnold.write"],
          }),
        ),
      );
      expect(auth.scopes).toEqual(["arnold.read", "arnold.write"]);
    });

    it("a clock skew of a few seconds either way", async () => {
      const nowSec = Math.floor(Date.now() / 1000);
      const auth = await verifierFor([rsa.publicJwk]).verifyAccessToken(
        signJwt(rsa, validClaims({ exp: nowSec - 5 })),
      );
      expect(auth.expiresAt).toBe(nowSec - 5);
    });

    it("azp as the client id when client_id is absent", async () => {
      const auth = await verifierFor([rsa.publicJwk]).verifyAccessToken(
        signJwt(rsa, validClaims({ client_id: undefined, azp: "azp-client" })),
      );
      expect(auth.clientId).toBe("azp-client");
    });
  });

  it("never echoes token material into the refusal", async () => {
    const token = signJwt(rsa, validClaims({ iss: "https://evil.test/" }));
    const error = await verifierFor([rsa.publicJwk])
      .verifyAccessToken(token)
      .then(
        () => null,
        (caught: unknown) => caught as OAuthError,
      );
    expect(error).toBeInstanceOf(OAuthError);
    // Neither the token nor the rejected issuer may appear in what the caller
    // is told; the detail belongs in the audit event instead.
    expect(error?.message ?? "").not.toContain(token);
    expect(error?.message ?? "").not.toContain("evil.test");
  });
});

describe("resource canonicalization", () => {
  it("drops a fragment and one trailing slash", () => {
    expect(canonicalResource("https://a.test/mcp/#x")).toBe(
      "https://a.test/mcp",
    );
    expect(canonicalResource("https://a.test/mcp")).toBe("https://a.test/mcp");
  });

  it("leaves a non-URL untouched rather than throwing", () => {
    expect(canonicalResource("not-a-url")).toBe("not-a-url");
  });

  it("does not treat a different host as equivalent", () => {
    expect(canonicalResource("https://a.test/mcp")).not.toBe(
      canonicalResource("https://b.test/mcp"),
    );
  });
});

describe("JWKS cache", () => {
  const jwksUri = "https://auth.arnold.test/.well-known/jwks.json";

  it("fetches once and serves the cached keys afterwards", async () => {
    const server = jwksServer(jwksDocument(rsa));
    const cache = new JwksCache({ jwksUri, fetchImpl: server.fetch });

    await cache.resolve(rsa.kid);
    await cache.resolve(rsa.kid);
    await cache.resolve(rsa.kid);

    expect(server.calls).toBe(1);
    expect(cache.state.count).toBe(1);
  });

  it("coalesces concurrent misses into a single request", async () => {
    const server = jwksServer(jwksDocument(rsa));
    const cache = new JwksCache({ jwksUri, fetchImpl: server.fetch });

    await Promise.all([
      cache.resolve(rsa.kid),
      cache.resolve(rsa.kid),
      cache.resolve(rsa.kid),
      cache.resolve(rsa.kid),
    ]);

    expect(server.calls).toBe(1);
  });

  it("refetches once when a kid is unknown, picking up a rotated key", async () => {
    const rotated = makeRsaKey("rsa-rotated");
    const server = jwksServer(jwksDocument(rsa));
    const cache = new JwksCache({ jwksUri, fetchImpl: server.fetch });

    await cache.resolve(rsa.kid);
    expect(server.calls).toBe(1);

    server.serve(jwksDocument(rsa, rotated));
    const key = await cache.resolve(rotated.kid);

    expect(key.kid).toBe(rotated.kid);
    expect(server.calls).toBe(2);
  });

  it("rate-limits rotation refetches so unknown kids cannot be a DoS lever", async () => {
    const server = jwksServer(jwksDocument(rsa));
    let clock = 1_000_000;
    const cache = new JwksCache({
      jwksUri,
      fetchImpl: server.fetch,
      minRefetchIntervalMs: 30_000,
      now: () => clock,
    });

    await cache.resolve(rsa.kid);
    expect(server.calls).toBe(1);

    // The first unknown kid is allowed one rotation probe — that is the
    // legitimate case this mechanism exists for. The other 24 must be absorbed
    // by the cooldown, so 25 unknown kids cost one request, not 25.
    for (let i = 0; i < 25; i += 1) {
      clock += 100;
      await cache.resolve(`unknown-${i}`).catch(() => undefined);
    }
    expect(server.calls).toBe(2);

    // Past the cooldown, exactly one further probe is allowed.
    clock += 31_000;
    await cache.resolve("unknown-final").catch(() => undefined);
    expect(server.calls).toBe(3);
  });

  it("keeps serving cached keys through a transient JWKS outage", async () => {
    const server = jwksServer(jwksDocument(rsa));
    let clock = 2_000_000;
    const cache = new JwksCache({
      jwksUri,
      fetchImpl: server.fetch,
      ttlMs: 1_000,
      staleTtlMs: 600_000,
      now: () => clock,
    });

    await cache.resolve(rsa.kid);

    clock += 5_000; // past the TTL, so a refresh is attempted
    server.failNext(503);
    const key = await cache.resolve(rsa.kid);
    expect(key.kid).toBe(rsa.kid);
  });

  it("gives up once cached keys are past the stale window", async () => {
    const server = jwksServer(jwksDocument(rsa));
    let clock = 3_000_000;
    const cache = new JwksCache({
      jwksUri,
      fetchImpl: server.fetch,
      ttlMs: 1_000,
      staleTtlMs: 10_000,
      now: () => clock,
    });

    await cache.resolve(rsa.kid);
    clock += 60_000;
    server.failNext(503);

    await expect(cache.resolve(rsa.kid)).rejects.toThrow();
  });

  it("refuses a JWKS document with no usable keys", async () => {
    const empty = {
      fetch: async () => ({
        ok: true,
        status: 200,
        json: async () => ({ keys: [] }),
      }),
    };
    const cache = new JwksCache({ jwksUri, fetchImpl: empty.fetch });
    await expect(cache.resolve("any")).rejects.toThrow();
  });

  it("verifies a real token end to end through the cache", async () => {
    const server = jwksServer(jwksDocument(rsa));
    const verifier = new ArnoldTokenVerifier({
      issuer: TEST_ISSUER,
      audience: TEST_AUDIENCE,
      keys: new JwksCache({ jwksUri, fetchImpl: server.fetch }),
    });

    const auth = await verifier.verifyAccessToken(signJwt(rsa, validClaims()));
    expect(verifiedSubject(auth).subject).toBe("subject-alice");
  });
});

describe("JWT decoding", () => {
  it("exposes the exact signing input rather than a re-serialization", () => {
    const token = signJwt(rsa, validClaims());
    const decoded = decodeJwt(token);
    const [header, payload] = token.split(".");
    expect(decoded.signingInput.toString("ascii")).toBe(`${header}.${payload}`);
  });

  it("rejects a payload that is a JSON array rather than an object", () => {
    const header = Buffer.from(JSON.stringify({ alg: "RS256" })).toString(
      "base64url",
    );
    const payload = Buffer.from(JSON.stringify([1, 2, 3])).toString(
      "base64url",
    );
    expect(() => decodeJwt(`${header}.${payload}.AAAA`)).toThrow();
  });
});
