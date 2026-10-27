/**
 * Synthetic authorization server for Arnold's auth tests.
 *
 * This mints tokens, which is exactly what production Arnold must never do —
 * so it lives in `tests/` and nothing under `src/` imports it. Keys are
 * generated per test run and exist only in memory: there is no fixture
 * private key checked into the repository that could be mistaken for a real
 * one, and no test can accidentally pass because it reused a key a previous
 * run left on disk.
 *
 * The signer is deliberately low-level — it takes a raw header and raw claims
 * and does not validate them — because most of the tests here are about
 * malformed, hostile or subtly wrong tokens. A helpful signer that filled in
 * sensible defaults would make those tests impossible to write.
 */
import {
  createHmac,
  generateKeyPairSync,
  sign as signBytes,
  constants,
  type JsonWebKey,
  type KeyObject,
} from "node:crypto";
import type { PublicJwk } from "../../src/server/auth/jwt.js";

export const TEST_ISSUER = "https://auth.arnold.test/";
export const TEST_AUDIENCE = "https://arnold.test/mcp";

const b64url = (input: Buffer | string): string =>
  Buffer.from(input).toString("base64url");

export interface TestKey {
  kid: string;
  privateKey: KeyObject;
  publicJwk: PublicJwk;
  /** PEM of the public key — used only to mount the alg-confusion attack. */
  publicPem: string;
}

function toPublicJwk(
  publicKey: KeyObject,
  kid: string,
  alg: string,
): PublicJwk {
  const jwk = publicKey.export({ format: "jwk" }) as JsonWebKey;
  return { ...jwk, kid, alg, use: "sig" } as PublicJwk;
}

/** An RSA key, for the RSA-based algorithms (RS256/384/512, PS256/384/512). */
export function makeRsaKey(kid = "rsa-1", alg = "RS256"): TestKey {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
  });
  return {
    kid,
    privateKey,
    publicJwk: toPublicJwk(publicKey, kid, alg),
    publicPem: publicKey.export({ type: "spki", format: "pem" }).toString(),
  };
}

/** An EC key on the curve the given ES* algorithm requires. */
export function makeEcKey(
  kid = "ec-1",
  alg: "ES256" | "ES384" = "ES256",
): TestKey {
  const namedCurve = alg === "ES256" ? "prime256v1" : "secp384r1";
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve });
  return {
    kid,
    privateKey,
    publicJwk: toPublicJwk(publicKey, kid, alg),
    publicPem: publicKey.export({ type: "spki", format: "pem" }).toString(),
  };
}

const HASH_FOR: Record<string, string> = {
  RS256: "sha256",
  RS384: "sha384",
  RS512: "sha512",
  PS256: "sha256",
  PS384: "sha384",
  PS512: "sha512",
  ES256: "sha256",
  ES384: "sha384",
  ES512: "sha512",
};

/**
 * Signs `header`/`claims` into a compact JWS.
 *
 * `alg` comes from the header, so a test can declare one algorithm and sign
 * with another — which is precisely the confusion attack under test.
 */
export function signJwt(
  key: TestKey,
  claims: Record<string, unknown>,
  header: Record<string, unknown> = {},
): string {
  const fullHeader = { alg: "RS256", kid: key.kid, typ: "at+jwt", ...header };
  const alg = String(fullHeader.alg);
  const signingInput = `${b64url(JSON.stringify(fullHeader))}.${b64url(
    JSON.stringify(claims),
  )}`;

  if (alg === "none") return `${signingInput}.`;

  // The attack: sign with HMAC over the *public* key, as a server that
  // naively trusts the header's `alg` would verify it.
  if (alg.startsWith("HS")) {
    const mac = createHmac(HASH_FOR[alg] ?? "sha256", key.publicPem)
      .update(signingInput)
      .digest();
    return `${signingInput}.${b64url(mac)}`;
  }

  const hash = HASH_FOR[alg] ?? "sha256";
  const keyInput = alg.startsWith("ES")
    ? { key: key.privateKey, dsaEncoding: "ieee-p1363" as const }
    : alg.startsWith("PS")
      ? {
          key: key.privateKey,
          padding: constants.RSA_PKCS1_PSS_PADDING,
          saltLength: constants.RSA_PSS_SALTLEN_DIGEST,
        }
      : { key: key.privateKey, padding: constants.RSA_PKCS1_PADDING };
  const signature = signBytes(
    hash,
    Buffer.from(signingInput, "ascii"),
    keyInput,
  );
  return `${signingInput}.${b64url(signature)}`;
}

export interface ClaimOverrides extends Record<string, unknown> {
  iss?: string;
  sub?: string;
  aud?: string | string[];
  exp?: number;
  iat?: number;
  nbf?: number;
  scope?: string;
}

/**
 * A well-formed set of claims for a token that should pass, with room to
 * break exactly one thing per test.
 */
export function validClaims(
  overrides: ClaimOverrides = {},
  nowSec = Math.floor(Date.now() / 1000),
): Record<string, unknown> {
  return {
    iss: TEST_ISSUER,
    sub: "subject-alice",
    aud: TEST_AUDIENCE,
    iat: nowSec,
    exp: nowSec + 600,
    scope: "arnold.profile arnold.read",
    client_id: "chatgpt-test-client",
    jti: `jti-${nowSec}-${Math.random().toString(36).slice(2, 8)}`,
    ...overrides,
  };
}

/** Flips one base64url character in the signature, leaving the shape valid. */
export function tamperSignature(token: string): string {
  const parts = token.split(".");
  const sig = parts[2] ?? "";
  const first = sig[0] === "A" ? "B" : "A";
  return `${parts[0]}.${parts[1]}.${first}${sig.slice(1)}`;
}

/** Replaces the payload with `claims`, keeping the original signature. */
export function tamperClaims(
  token: string,
  claims: Record<string, unknown>,
): string {
  const parts = token.split(".");
  return `${parts[0]}.${b64url(JSON.stringify(claims))}.${parts[2]}`;
}

/** A minimal JWKS document around the given keys. */
export function jwksDocument(...keys: TestKey[]): { keys: PublicJwk[] } {
  return { keys: keys.map((key) => key.publicJwk) };
}

/**
 * A `FetchLike` that serves a JWKS document and counts requests, so tests can
 * assert caching and single-flight behaviour rather than just correctness.
 */
export function jwksServer(initial: { keys: PublicJwk[] }) {
  let document = initial;
  let calls = 0;
  let failWith: number | null = null;
  return {
    get calls() {
      return calls;
    },
    serve(next: { keys: PublicJwk[] }) {
      document = next;
    },
    failNext(status: number | null) {
      failWith = status;
    },
    fetch: async () => {
      calls += 1;
      if (failWith !== null) {
        const status = failWith;
        failWith = null;
        return {
          ok: false,
          status,
          json: async () => ({}),
        };
      }
      return { ok: true, status: 200, json: async () => document };
    },
  };
}
