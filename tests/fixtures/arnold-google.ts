/**
 * A synthetic Google for Arnold's OAuth tests.
 *
 * Stands in for the token, revoke and JWKS endpoints, and records what it was
 * asked. Several of the properties under test are about *how many* calls
 * Arnold makes (single-flight refresh) and *what it sent* (PKCE verifier,
 * redirect URI from configuration rather than from the callback), so a fixture
 * that only returned plausible answers would not be enough.
 */
import type { AuthenticatedArnoldContext } from "../../src/server/auth/identity.js";
import type { FetchLike } from "../../src/server/auth/jwks.js";
import { StaticJwks } from "../../src/server/auth/jwks.js";
import {
  GOOGLE_REVOKE_ENDPOINT,
  GOOGLE_TOKEN_ENDPOINT,
} from "../../src/server/google/oauth-flow.js";
import { DRIVE_FILE_SCOPE } from "../../src/server/google/scopes.js";
import { makeRsaKey, signJwt, type TestKey } from "./arnold-auth.js";

export const GOOGLE_CLIENT_ID = "123456789.apps.googleusercontent.com";
export const GOOGLE_CLIENT_SECRET = "test-client-secret-not-real";
export const GOOGLE_REDIRECT_URI = "https://arnold.test/auth/google/callback";

export const googleOAuthConfig = {
  clientId: GOOGLE_CLIENT_ID,
  clientSecret: GOOGLE_CLIENT_SECRET,
  redirectUri: GOOGLE_REDIRECT_URI,
};

/** The key Google's id_tokens are signed with in these tests. */
export const googleSigningKey: TestKey = makeRsaKey("google-key-1");

export const googleIdTokenKeys = new StaticJwks([googleSigningKey.publicJwk]);

export interface IdTokenOptions {
  subject?: string;
  email?: string | null;
  nonce: string;
  audience?: string;
  issuer?: string;
  expiresInSec?: number;
  emailVerified?: boolean;
}

/** Mints a Google-shaped id_token. */
export function googleIdToken(options: IdTokenOptions): string {
  const nowSec = Math.floor(Date.now() / 1000);
  const claims: Record<string, unknown> = {
    iss: options.issuer ?? "https://accounts.google.com",
    aud: options.audience ?? GOOGLE_CLIENT_ID,
    sub: options.subject ?? "google-subject-alice",
    nonce: options.nonce,
    iat: nowSec,
    exp: nowSec + (options.expiresInSec ?? 3600),
    email_verified: options.emailVerified ?? true,
  };
  if (options.email !== null)
    claims.email = options.email ?? "alice@example.com";
  return signJwt(googleSigningKey, claims, { kid: googleSigningKey.kid });
}

export interface TokenExchangeRecord {
  grantType: string;
  code?: string;
  codeVerifier?: string;
  redirectUri?: string;
  refreshToken?: string;
  clientId?: string;
}

export interface GoogleStubOptions {
  /** Scopes the user actually granted. Defaults to the full required set. */
  grantedScopes?: string[];
  /** Whether the code exchange returns a refresh token. */
  issueRefreshToken?: boolean;
  /** Subject in the returned id_token. */
  subject?: string;
  email?: string | null;
  /** Omit the id_token entirely. */
  omitIdToken?: boolean;
  /** Fail the next refresh with this OAuth error, e.g. `invalid_grant`. */
  refreshError?: string | null;
  /** Rotate the refresh token on each refresh. */
  rotateRefreshToken?: boolean;
  /** Make the revoke endpoint fail. */
  revokeFails?: boolean;
}

/**
 * A fake Google.
 *
 * `nonceFor` is how a test learns the nonce Arnold generated, since the nonce
 * lives only in the server-side pending record. The stub reads it out of the
 * authorization URL the test itself built, which keeps the fixture honest:
 * it never invents a nonce Arnold did not send.
 */
export function googleStub(options: GoogleStubOptions = {}) {
  const exchanges: TokenExchangeRecord[] = [];
  const revocations: string[] = [];
  let refreshCalls = 0;
  let rotation = 0;
  const state: GoogleStubOptions = {
    grantedScopes: options.grantedScopes ?? [
      "openid",
      "email",
      DRIVE_FILE_SCOPE,
    ],
    issueRefreshToken: options.issueRefreshToken ?? true,
    subject: options.subject ?? "google-subject-alice",
    email: options.email === undefined ? "alice@example.com" : options.email,
    omitIdToken: options.omitIdToken ?? false,
    refreshError: options.refreshError ?? null,
    rotateRefreshToken: options.rotateRefreshToken ?? false,
    revokeFails: options.revokeFails ?? false,
  };

  /** The nonce Arnold put in a given authorization URL. */
  const nonceFor = (authorizationUrl: string): string =>
    new URL(authorizationUrl).searchParams.get("nonce") ?? "";

  let nonceForNextExchange = "";

  const fetchImpl: FetchLike = async (url, init) => {
    const body = new URLSearchParams(init?.body ?? "");

    if (url === GOOGLE_TOKEN_ENDPOINT) {
      const grantType = body.get("grant_type") ?? "";

      if (grantType === "authorization_code") {
        exchanges.push({
          grantType,
          code: body.get("code") ?? undefined,
          codeVerifier: body.get("code_verifier") ?? undefined,
          redirectUri: body.get("redirect_uri") ?? undefined,
          clientId: body.get("client_id") ?? undefined,
        });
        return {
          ok: true,
          status: 200,
          json: async () => ({
            access_token: "google-access-token-1",
            expires_in: 3600,
            token_type: "Bearer",
            scope: state.grantedScopes!.join(" "),
            ...(state.issueRefreshToken
              ? { refresh_token: "google-refresh-token-1" }
              : {}),
            ...(state.omitIdToken
              ? {}
              : {
                  id_token: googleIdToken({
                    nonce: nonceForNextExchange,
                    subject: state.subject,
                    email: state.email ?? null,
                  }),
                }),
          }),
        };
      }

      if (grantType === "refresh_token") {
        refreshCalls += 1;
        exchanges.push({
          grantType,
          refreshToken: body.get("refresh_token") ?? undefined,
          clientId: body.get("client_id") ?? undefined,
        });
        if (state.refreshError) {
          const error = state.refreshError;
          return {
            ok: false,
            status: error === "invalid_grant" ? 400 : 503,
            json: async () => ({ error }),
          };
        }
        rotation += 1;
        return {
          ok: true,
          status: 200,
          json: async () => ({
            access_token: `google-access-token-refreshed-${rotation}`,
            expires_in: 3600,
            token_type: "Bearer",
            ...(state.rotateRefreshToken
              ? { refresh_token: `google-refresh-token-rotated-${rotation}` }
              : {}),
          }),
        };
      }
    }

    if (url === GOOGLE_REVOKE_ENDPOINT) {
      revocations.push(body.get("token") ?? "");
      return {
        ok: !state.revokeFails,
        status: state.revokeFails ? 400 : 200,
        json: async () => ({}),
      };
    }

    return { ok: false, status: 404, json: async () => ({}) };
  };

  return {
    fetchImpl,
    exchanges,
    revocations,
    get refreshCalls() {
      return refreshCalls;
    },
    nonceFor,
    /** Tell the stub which nonce the next id_token must echo. */
    expectNonce(nonce: string) {
      nonceForNextExchange = nonce;
    },
    set(next: Partial<GoogleStubOptions>) {
      Object.assign(state, next);
    },
  };
}

/** A verified Arnold context, as the tool guard would have produced it. */
export function contextFor(
  userId: string,
  scopes: string[] = ["arnold.read", "arnold.account"],
): AuthenticatedArnoldContext {
  return {
    userId,
    actorId: `act_${userId}`,
    scopes,
    issuer: "https://auth.arnold.test/",
    audience: "https://arnold.test/mcp",
    clientId: "chatgpt-test-client",
    authSessionId: `aus_${userId}`,
    firstSeen: false,
  };
}
