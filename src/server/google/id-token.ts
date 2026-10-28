/**
 * Verification of Google's OIDC id_token.
 *
 * Arnold needs one thing from it: the stable `sub` that keys the Google
 * account (Task 007 §8). The email address is read too, but only to show the
 * user which account is connected — never as the key, because an address can
 * be changed or reassigned by a Workspace administrator and either would
 * silently re-point an account.
 *
 * The id_token is verified rather than decoded. It arrives over TLS from
 * Google's token endpoint, so decoding it unverified is *nearly* safe — and
 * "nearly" is the wrong standard for the value that decides which Google
 * account a tracker belongs to. Verifying also means the same code path works
 * if an id_token ever reaches Arnold by a less trustworthy route.
 *
 * The JWS machinery is the one from 007-A: same algorithm allowlist, same
 * algorithm-confusion defences, same JWKS cache with rotation. Google rotates
 * its signing keys on roughly a daily cadence, so the cache earns its keep
 * here more than anywhere else.
 */
import { ArnoldAuthError } from "../auth/errors.js";
import type { KeyResolver } from "../auth/jwks.js";
import { decodeJwt, verifyJwtSignature } from "../auth/jwt.js";
import { secretEquals } from "./crypto.js";

/** Google's JWKS endpoint for id_token signing keys. */
export const GOOGLE_JWKS_URI = "https://www.googleapis.com/oauth2/v3/certs";

/**
 * Google issues `iss` in two spellings and both are current. Accepting a set
 * is correct here; it is not a loosening of the issuer check, because the set
 * is closed and hard-coded.
 */
export const GOOGLE_ISSUERS: readonly string[] = [
  "https://accounts.google.com",
  "accounts.google.com",
];

export interface GoogleIdentity {
  /** The stable OIDC subject. The account key. */
  subject: string;
  /** Display only; null when the user did not grant the `email` scope. */
  email: string | null;
  emailVerified: boolean;
}

export interface VerifyIdTokenOptions {
  idToken: string;
  /** Arnold's Google OAuth client id — the expected `aud`. */
  clientId: string;
  keys: KeyResolver;
  /**
   * The nonce Arnold put in the authorization request.
   *
   * Required. Checking it is what binds this id_token to *this* authorization
   * request, so an id_token captured from another flow cannot be replayed
   * into Arnold's callback.
   */
  expectedNonce: string;
  clockToleranceSec?: number;
  now?: () => number;
}

export async function verifyGoogleIdToken(
  options: VerifyIdTokenOptions,
): Promise<GoogleIdentity> {
  const skew = options.clockToleranceSec ?? 60;
  const nowSec = Math.floor((options.now?.() ?? Date.now()) / 1000);

  const decoded = decodeJwt(options.idToken);
  const key = await options.keys.resolve(decoded.header.kid);
  verifyJwtSignature(decoded, key);

  const claims = decoded.claims;

  if (typeof claims.iss !== "string" || !GOOGLE_ISSUERS.includes(claims.iss))
    throw new ArnoldAuthError(
      "INVALID_TOKEN",
      `id_token nennt den Issuer ${String(claims.iss)}, erwartet wird Google.`,
    );

  // `aud` must be Arnold's own client id. A token minted for another Google
  // client is not evidence about Arnold's user.
  const audiences =
    typeof claims.aud === "string"
      ? [claims.aud]
      : Array.isArray(claims.aud)
        ? claims.aud.filter(
            (value): value is string => typeof value === "string",
          )
        : [];
  if (!audiences.includes(options.clientId))
    throw new ArnoldAuthError(
      "INVALID_TOKEN",
      "id_token ist für einen anderen Google-OAuth-Client ausgestellt.",
    );

  if (typeof claims.exp !== "number" || claims.exp + skew <= nowSec)
    throw new ArnoldAuthError("INVALID_TOKEN", "id_token ist abgelaufen.");

  if (typeof claims.iat === "number" && claims.iat - skew > nowSec)
    throw new ArnoldAuthError(
      "INVALID_TOKEN",
      "id_token wurde in der Zukunft ausgestellt.",
    );

  const nonce = claims.nonce;
  if (typeof nonce !== "string" || !secretEquals(nonce, options.expectedNonce))
    throw new ArnoldAuthError(
      "INVALID_TOKEN",
      "id_token-nonce passt nicht zur Autorisierungsanfrage. Möglicher Replay.",
    );

  if (typeof claims.sub !== "string" || claims.sub.length === 0)
    throw new ArnoldAuthError(
      "INVALID_TOKEN",
      "id_token enthält kein sub. Ohne stabiles Subject gibt es keine Kontozuordnung.",
    );

  return {
    subject: claims.sub,
    email: typeof claims.email === "string" ? claims.email : null,
    emailVerified: claims.email_verified === true,
  };
}
