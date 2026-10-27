/**
 * JWS verification for Arnold's access tokens.
 *
 * Implemented on Node's own `crypto` rather than a JOSE library, for one
 * reason worth stating: Arnold needs exactly one JWS operation — verify a
 * compact-serialized token against a public JWK — and Node 22 can import a
 * JWK directly (`createPublicKey({ format: "jwk" })`). Adding a dependency to
 * reach the same primitive would widen the supply-chain surface of the one
 * module where that matters most, against Task 007 §1's instruction to choose
 * dependencies deliberately.
 *
 * The three attacks this module exists to refuse:
 *
 * 1. **`alg: none`.** A token with no signature is not a token. There is no
 *    code path here that accepts an unsigned JWS, and `none` is not in the
 *    algorithm table at all rather than being special-cased later.
 *
 * 2. **Algorithm confusion.** The classic break is handing an RS256 verifier
 *    an HS256 token so the public key gets used as an HMAC secret. Arnold
 *    refuses every symmetric algorithm outright, and additionally requires the
 *    key type to match the algorithm family — an `ES256` header cannot be
 *    verified with an RSA key even if the caller supplies one.
 *
 * 3. **Header-declared key substitution.** The header's `alg` selects a
 *    verification procedure, but it never selects a *key*: the caller passes
 *    the JWK in, resolved from the issuer's JWKS by `kid`. A token cannot
 *    nominate its own key material, embedded (`jwk`) or by reference (`jku`).
 *
 * Nothing here reads the clock or looks at claims. Signature verification and
 * claim validation are separate steps on purpose, so that neither can be
 * accidentally satisfied by the other; `token-verifier.ts` does the claims.
 */
import {
  constants,
  createPublicKey,
  verify as verifySignature,
  type JsonWebKey,
  type KeyObject,
} from "node:crypto";

/** A public JWK as it appears in a JWKS document. */
export interface PublicJwk {
  kty: string;
  kid?: string;
  alg?: string;
  use?: string;
  key_ops?: string[];
  n?: string;
  e?: string;
  crv?: string;
  x?: string;
  y?: string;
  [claim: string]: unknown;
}

/**
 * The algorithms Arnold accepts, and what each one requires.
 *
 * `kty` is the key type the algorithm demands. `crv` is the curve an EC
 * algorithm demands — ES256 is defined over P-256 only, and accepting an
 * ES256 header over a P-521 key would be a spec violation that weakens the
 * binding between the declared algorithm and the actual work done.
 */
const ALGORITHMS = {
  RS256: { kty: "RSA", hash: "sha256", padding: "pkcs1" },
  RS384: { kty: "RSA", hash: "sha384", padding: "pkcs1" },
  RS512: { kty: "RSA", hash: "sha512", padding: "pkcs1" },
  PS256: { kty: "RSA", hash: "sha256", padding: "pss" },
  PS384: { kty: "RSA", hash: "sha384", padding: "pss" },
  PS512: { kty: "RSA", hash: "sha512", padding: "pss" },
  ES256: { kty: "EC", hash: "sha256", crv: "P-256" },
  ES384: { kty: "EC", hash: "sha384", crv: "P-384" },
  ES512: { kty: "EC", hash: "sha512", crv: "P-521" },
} as const satisfies Record<
  string,
  { kty: string; hash: string; padding?: string; crv?: string }
>;

export type SupportedAlgorithm = keyof typeof ALGORITHMS;

export const SUPPORTED_ALGORITHMS = Object.keys(
  ALGORITHMS,
) as SupportedAlgorithm[];

export function isSupportedAlgorithm(alg: unknown): alg is SupportedAlgorithm {
  return typeof alg === "string" && alg in ALGORITHMS;
}

/** Raised for every malformed or unverifiable token. Carries no token bytes. */
export class JwtFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "JwtFormatError";
  }
}

export interface JwtHeader {
  alg: string;
  kid?: string;
  typ?: string;
  [claim: string]: unknown;
}

export interface JwtClaims {
  iss?: string;
  sub?: string;
  aud?: string | string[];
  exp?: number;
  nbf?: number;
  iat?: number;
  scope?: string;
  scp?: string | string[];
  client_id?: string;
  azp?: string;
  jti?: string;
  [claim: string]: unknown;
}

export interface DecodedJwt {
  header: JwtHeader;
  claims: JwtClaims;
  /** The exact ASCII bytes the signature covers: `header.payload`. */
  signingInput: Buffer;
  signature: Buffer;
}

/**
 * Strict base64url. `Buffer.from(x, "base64url")` silently tolerates padding,
 * standard-alphabet characters and outright garbage, which would let two
 * different strings decode to the same token — so the shape is checked before
 * decoding rather than trusting the decoder.
 */
const BASE64URL = /^[A-Za-z0-9_-]+$/;

function decodeSegment(segment: string, label: string): Buffer {
  if (segment.length === 0 || !BASE64URL.test(segment))
    throw new JwtFormatError(`${label} ist kein gültiges base64url-Segment.`);
  return Buffer.from(segment, "base64url");
}

function parseJson<T>(raw: Buffer, label: string): T {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.toString("utf8"));
  } catch {
    throw new JwtFormatError(`${label} ist kein gültiges JSON.`);
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed))
    throw new JwtFormatError(`${label} ist kein JSON-Objekt.`);
  return parsed as T;
}

/**
 * Splits and parses a compact JWS without verifying anything.
 *
 * Returns the signing input as bytes so the verifier signs over exactly what
 * arrived on the wire — re-serializing the parsed header would change the
 * bytes whenever the issuer's key ordering or whitespace differs from ours,
 * and a verifier that re-encodes its input is a verifier that can be fooled.
 */
export function decodeJwt(token: string): DecodedJwt {
  if (typeof token !== "string" || token.length === 0)
    throw new JwtFormatError("Kein Token übergeben.");
  const parts = token.split(".");
  if (parts.length !== 3)
    throw new JwtFormatError(
      "Token ist kein kompaktes JWS mit drei Segmenten.",
    );
  const [headerPart, payloadPart, signaturePart] = parts as [
    string,
    string,
    string,
  ];
  const header = parseJson<JwtHeader>(
    decodeSegment(headerPart, "Token-Header"),
    "Token-Header",
  );
  const claims = parseJson<JwtClaims>(
    decodeSegment(payloadPart, "Token-Payload"),
    "Token-Payload",
  );
  if (typeof header.alg !== "string")
    throw new JwtFormatError("Token-Header enthält kein alg.");
  return {
    header,
    claims,
    signingInput: Buffer.from(`${headerPart}.${payloadPart}`, "ascii"),
    signature: decodeSegment(signaturePart, "Token-Signatur"),
  };
}

/**
 * Imports a JWK and checks it is usable for `alg`.
 *
 * The compatibility check is the algorithm-confusion defence: the algorithm
 * named in the token header must match the key Arnold resolved for it, or the
 * token is refused before any cryptography runs.
 */
function importKey(jwk: PublicJwk, alg: SupportedAlgorithm): KeyObject {
  const spec = ALGORITHMS[alg];
  if (jwk.kty !== spec.kty)
    throw new JwtFormatError(
      `Schlüsseltyp ${jwk.kty} passt nicht zum Algorithmus ${alg}.`,
    );
  if ("crv" in spec && jwk.crv !== spec.crv)
    throw new JwtFormatError(
      `Kurve ${String(jwk.crv)} passt nicht zum Algorithmus ${alg}.`,
    );
  // A JWKS entry may pin its own algorithm. When it does, it wins: a key
  // published for RS256 must not be pressed into service for PS256.
  if (typeof jwk.alg === "string" && jwk.alg !== alg)
    throw new JwtFormatError(
      `Schlüssel ist für ${jwk.alg} veröffentlicht, Token nutzt ${alg}.`,
    );
  if (jwk.use !== undefined && jwk.use !== "sig")
    throw new JwtFormatError("Schlüssel ist nicht zum Signieren bestimmt.");
  if (jwk.key_ops !== undefined && !jwk.key_ops.includes("verify"))
    throw new JwtFormatError("Schlüssel erlaubt kein verify.");
  try {
    return createPublicKey({ key: jwk as JsonWebKey, format: "jwk" });
  } catch (error) {
    throw new JwtFormatError(
      `Schlüssel konnte nicht importiert werden: ${
        error instanceof Error ? error.message : "unbekannt"
      }`,
    );
  }
}

/**
 * Verifies `decoded`'s signature against `jwk`.
 *
 * Returns nothing and throws on failure, rather than returning a boolean — a
 * boolean return is the shape that gets accidentally ignored at a call site.
 */
export function verifyJwtSignature(decoded: DecodedJwt, jwk: PublicJwk): void {
  const alg = decoded.header.alg;
  if (!isSupportedAlgorithm(alg))
    throw new JwtFormatError(
      `Algorithmus ${alg} ist nicht zugelassen. Erlaubt: ${SUPPORTED_ALGORITHMS.join(", ")}.`,
    );
  const spec = ALGORITHMS[alg];
  const key = importKey(jwk, alg);

  // ECDSA in JWS is the fixed-width R||S concatenation of RFC 7518, not the
  // DER sequence Node defaults to, so the encoding has to be named. An EC
  // signature of the wrong length is rejected here rather than inside OpenSSL.
  const keyInput =
    spec.kty === "EC"
      ? { key, dsaEncoding: "ieee-p1363" as const }
      : spec.padding === "pss"
        ? {
            key,
            padding: constants.RSA_PKCS1_PSS_PADDING,
            saltLength: constants.RSA_PSS_SALTLEN_DIGEST,
          }
        : { key, padding: constants.RSA_PKCS1_PADDING };

  let valid: boolean;
  try {
    valid = verifySignature(
      spec.hash,
      decoded.signingInput,
      keyInput,
      decoded.signature,
    );
  } catch {
    // A malformed signature makes OpenSSL throw rather than return false.
    // Both mean the same thing to Arnold.
    valid = false;
  }
  if (!valid) throw new JwtFormatError("Token-Signatur ist ungültig.");
}
