/**
 * The Google authorization code flow: starting it, and finishing it safely.
 *
 * Everything in this file exists to make the callback trustworthy. A callback
 * is a request from the user's browser carrying attacker-influenceable query
 * parameters, arriving at a URL an attacker can also cause the browser to
 * visit. So the flow keeps its own server-side record of what it started, and
 * the callback is only honoured if it matches that record exactly.
 *
 * The pending record carries four things, each closing a specific attack:
 *
 * - **`state`** — a 256-bit value the server generated. The callback must
 *   present it, and it is consumed on first use. This is both the CSRF
 *   defence and the authorization-code replay defence: a second callback with
 *   the same `state` finds no record and is refused.
 *
 * - **PKCE verifier** — never leaves the server. Even an attacker who
 *   intercepts the authorization code cannot exchange it, because the token
 *   endpoint demands the verifier whose S256 hash was sent with the request.
 *
 * - **`userId`** — the *verified* Arnold user who started the flow. This is
 *   the one that is easy to omit and important to have: without it, a callback
 *   could be completed while a different Arnold user's session is active, and
 *   Google tokens would be filed against the wrong account (§8, §17). The
 *   callback's authenticated user must equal this.
 *
 * - **`nonce`** — echoed in Google's id_token, binding that token to this
 *   request.
 *
 * Records expire. An abandoned authorization is a dangling capability, and a
 * ten-minute window is ample for a human to finish a consent screen.
 */
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { ArnoldAuthError } from "../auth/errors.js";
import { secretEquals } from "./crypto.js";
import {
  REQUESTED_GOOGLE_SCOPES,
  parseGrantedScopes,
  verifyGrantedScopes,
  type ScopeVerdict,
} from "./scopes.js";
import type { FetchLike } from "../auth/jwks.js";

export const GOOGLE_AUTH_ENDPOINT =
  "https://accounts.google.com/o/oauth2/v2/auth";
export const GOOGLE_TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
export const GOOGLE_REVOKE_ENDPOINT = "https://oauth2.googleapis.com/revoke";

export const DEFAULT_PENDING_TTL_MS = 10 * 60 * 1000;

const b64url = (input: Buffer) => input.toString("base64url");

/** One authorization in flight. Server-side only; never sent to a browser. */
export interface PendingAuthorization {
  state: string;
  /** The verified Arnold user who started this flow. */
  userId: string;
  codeVerifier: string;
  nonce: string;
  redirectUri: string;
  createdAtMs: number;
  /**
   * Optional binding to a confirmed onboarding draft (Task 007 §6).
   *
   * Carried through so the callback can verify the plan revision it was
   * started for has not changed. Task 006's `oauthStateBinding()` produces
   * this value; Arnold stores it and compares, it does not invent it.
   */
  onboardingBinding?: string;
}

export interface StartedAuthorization {
  /** Where to send the user's browser. */
  authorizationUrl: string;
  state: string;
}

/**
 * The store of in-flight authorizations.
 *
 * In memory for now. This is explicitly a **single-instance** structure: two
 * Arnold processes would not see each other's pending records, so a callback
 * could land on the wrong instance and be refused. That is a safe failure, not
 * a security hole, but it makes the flow unreliable behind a load balancer —
 * so 007-D moves this to the database alongside the rest of the technical
 * state. Recorded here rather than discovered in staging.
 */
export class PendingAuthorizationStore {
  private readonly pending = new Map<string, PendingAuthorization>();
  private readonly ttlMs: number;
  private readonly now: () => number;

  constructor(options: { ttlMs?: number; now?: () => number } = {}) {
    this.ttlMs = options.ttlMs ?? DEFAULT_PENDING_TTL_MS;
    this.now = options.now ?? (() => Date.now());
  }

  get size(): number {
    this.evictExpired();
    return this.pending.size;
  }

  put(record: PendingAuthorization): void {
    this.evictExpired();
    this.pending.set(record.state, record);
  }

  /**
   * Retrieves and **consumes** the record for `state`.
   *
   * Single-use by construction: the entry is deleted before it is returned, so
   * a replayed callback cannot find it even if the caller later throws.
   */
  consume(state: string): PendingAuthorization | undefined {
    this.evictExpired();
    // Constant-time lookup over the keys rather than a direct Map.get, so the
    // presence of a given state is not learnable from timing.
    const match = [...this.pending.keys()].find((candidate) =>
      secretEquals(candidate, state),
    );
    if (match === undefined) return undefined;
    const record = this.pending.get(match);
    this.pending.delete(match);
    return record;
  }

  private evictExpired(): void {
    const cutoff = this.now() - this.ttlMs;
    for (const [state, record] of this.pending)
      if (record.createdAtMs < cutoff) this.pending.delete(state);
  }
}

export interface GoogleOAuthClientConfig {
  clientId: string;
  clientSecret: string;
  /**
   * The exact redirect URI registered in Google Cloud.
   *
   * Google requires an exact match, and Arnold sends this same string in both
   * the authorization request and the token exchange. It is never taken from
   * a request parameter — a redirect URI chosen by the caller is an open
   * redirector (§27).
   */
  redirectUri: string;
}

/**
 * Begins an authorization.
 *
 * `prompt=consent` with `access_type=offline` is requested because Google only
 * returns a refresh token on the first consent for a client/user pair.
 * Re-consenting is the documented way to recover a refresh token Arnold never
 * received or has lost — the "missing refresh token" case of §10.
 */
export function startAuthorization(
  config: GoogleOAuthClientConfig,
  store: PendingAuthorizationStore,
  input: { userId: string; onboardingBinding?: string; now?: () => number },
): StartedAuthorization {
  const state = b64url(randomBytes(32));
  const codeVerifier = b64url(randomBytes(32));
  const nonce = b64url(randomBytes(32));
  const challenge = b64url(
    createHash("sha256").update(codeVerifier, "ascii").digest(),
  );

  store.put({
    state,
    userId: input.userId,
    codeVerifier,
    nonce,
    redirectUri: config.redirectUri,
    createdAtMs: input.now?.() ?? Date.now(),
    onboardingBinding: input.onboardingBinding,
  });

  const url = new URL(GOOGLE_AUTH_ENDPOINT);
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("redirect_uri", config.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", REQUESTED_GOOGLE_SCOPES.join(" "));
  url.searchParams.set("state", state);
  url.searchParams.set("nonce", nonce);
  url.searchParams.set("code_challenge", challenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("include_granted_scopes", "false");

  return { authorizationUrl: url.toString(), state };
}

export interface GoogleTokenResponse {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  scope?: string;
  token_type: string;
  id_token?: string;
}

export interface ExchangedCode {
  accessToken: string;
  accessTokenExpiresAtMs: number;
  refreshToken: string | null;
  idToken: string;
  scopeVerdict: ScopeVerdict;
}

/**
 * Exchanges an authorization code for tokens.
 *
 * Runs server-side with the client secret, over the back channel. Nothing in
 * this function's result may reach the MCP app's browser bundle (§8).
 */
export async function exchangeAuthorizationCode(
  config: GoogleOAuthClientConfig,
  pending: PendingAuthorization,
  code: string,
  options: { fetchImpl?: FetchLike; now?: () => number } = {},
): Promise<ExchangedCode> {
  const fetchImpl =
    options.fetchImpl ?? (globalThis.fetch as unknown as FetchLike);
  const body = new URLSearchParams({
    code,
    client_id: config.clientId,
    client_secret: config.clientSecret,
    // The same string that was sent with the authorization request, from the
    // server's own record — not from the callback.
    redirect_uri: pending.redirectUri,
    grant_type: "authorization_code",
    code_verifier: pending.codeVerifier,
  });

  const response = await fetchImpl(GOOGLE_TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  if (!response.ok) {
    // Google's error body can name the client id; it never reaches the user.
    throw new ArnoldAuthError(
      "INVALID_TOKEN",
      `Google-Token-Endpunkt antwortete mit ${response.status}.`,
    );
  }

  const payload = (await response.json()) as GoogleTokenResponse;
  if (typeof payload.access_token !== "string")
    throw new ArnoldAuthError(
      "INVALID_TOKEN",
      "Google-Antwort enthält kein access_token.",
    );
  if (typeof payload.id_token !== "string")
    throw new ArnoldAuthError(
      "INVALID_TOKEN",
      "Google-Antwort enthält kein id_token; ohne id_token ist das Konto nicht identifizierbar.",
    );

  const now = options.now?.() ?? Date.now();
  const expiresInMs =
    (typeof payload.expires_in === "number" ? payload.expires_in : 3600) * 1000;

  return {
    accessToken: payload.access_token,
    accessTokenExpiresAtMs: now + expiresInMs,
    refreshToken:
      typeof payload.refresh_token === "string" ? payload.refresh_token : null,
    idToken: payload.id_token,
    scopeVerdict: verifyGrantedScopes(parseGrantedScopes(payload.scope)),
  };
}

export interface RefreshedAccessToken {
  accessToken: string;
  accessTokenExpiresAtMs: number;
  /** Present only when Google rotated the refresh token. */
  rotatedRefreshToken: string | null;
}

/** Distinguishes "Google refuses this grant" from "the call failed". */
export class GoogleGrantRevokedError extends Error {
  constructor(readonly errorCode: string) {
    super(`Google hat die Berechtigung widerrufen: ${errorCode}`);
    this.name = "GoogleGrantRevokedError";
  }
}

/**
 * Mints a new access token from a refresh token.
 *
 * `invalid_grant` is singled out because it is the one error that must not be
 * retried: it means the user revoked access in their Google account, or the
 * refresh token expired. Retrying would hammer Google with a dead credential;
 * the connection has to be marked as needing reauthorization instead (§10).
 */
export async function refreshAccessToken(
  config: GoogleOAuthClientConfig,
  refreshToken: string,
  options: { fetchImpl?: FetchLike; now?: () => number } = {},
): Promise<RefreshedAccessToken> {
  const fetchImpl =
    options.fetchImpl ?? (globalThis.fetch as unknown as FetchLike);
  const body = new URLSearchParams({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    refresh_token: refreshToken,
    grant_type: "refresh_token",
  });

  const response = await fetchImpl(GOOGLE_TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  const payload = (await response.json().catch(() => ({}))) as Partial<
    GoogleTokenResponse & { error: string }
  >;

  if (!response.ok) {
    const error = typeof payload.error === "string" ? payload.error : "unknown";
    if (error === "invalid_grant") throw new GoogleGrantRevokedError(error);
    throw new ArnoldAuthError(
      "VERIFICATION_UNAVAILABLE",
      `Google-Refresh fehlgeschlagen (${response.status}/${error}).`,
    );
  }

  if (typeof payload.access_token !== "string")
    throw new ArnoldAuthError(
      "VERIFICATION_UNAVAILABLE",
      "Google-Refresh-Antwort enthält kein access_token.",
    );

  const now = options.now?.() ?? Date.now();
  return {
    accessToken: payload.access_token,
    accessTokenExpiresAtMs:
      now +
      (typeof payload.expires_in === "number" ? payload.expires_in : 3600) *
        1000,
    rotatedRefreshToken:
      typeof payload.refresh_token === "string" ? payload.refresh_token : null,
  };
}

/**
 * Asks Google to revoke a token.
 *
 * Best-effort by design: a revoke that fails must not block Arnold from
 * forgetting the credential locally. Leaving a token in Arnold's database
 * because Google was briefly unreachable would be the worse outcome of the
 * two (§10).
 */
export async function revokeGoogleToken(
  token: string,
  options: { fetchImpl?: FetchLike } = {},
): Promise<boolean> {
  const fetchImpl =
    options.fetchImpl ?? (globalThis.fetch as unknown as FetchLike);
  try {
    const response = await fetchImpl(GOOGLE_REVOKE_ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token }).toString(),
    });
    return response.ok;
  } catch {
    return false;
  }
}

/** A correlation id for one connect attempt, safe to show and to log. */
export function newFlowId(): string {
  return `gfl_${randomUUID()}`;
}
