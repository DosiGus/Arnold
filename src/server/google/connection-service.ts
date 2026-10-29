/**
 * The Google connection lifecycle: connect, use, refresh, reconnect,
 * disconnect.
 *
 * This is the layer that holds the invariants, so the routes above it stay
 * thin and the repository below it stays dumb. Four of those invariants are
 * worth stating because each one corresponds to a way this goes wrong.
 *
 * **The callback's user must be the user who started the flow.** The pending
 * record names a verified Arnold user; the callback arrives with its own
 * verified Arnold user. If they differ, the flow is refused. Without this
 * check a user could complete someone else's authorization and have Google
 * tokens filed against the wrong Arnold account (§8, §17).
 *
 * **An account switch is never silent.** If the user already has a Google
 * connection and completes a flow with a *different* Google subject, Arnold
 * refuses rather than overwriting. A tracker already belongs to the old
 * account; quietly repointing the connection would leave Arnold holding
 * credentials for an account that cannot reach the file it is supposed to
 * manage (§23). Switching requires having said so when starting the flow.
 *
 * **Refreshes are single-flight per user.** Concurrent MCP calls on an expired
 * token would otherwise each mint a new access token. That is wasteful, and
 * with refresh-token rotation it is worse than wasteful: parallel refreshes
 * race to store different rotated tokens and the loser's token is invalidated
 * by Google, so the connection breaks (§10).
 *
 * **`invalid_grant` is terminal, not retryable.** It means the user revoked
 * access or the refresh token expired. Arnold marks the connection as needing
 * reauthorization and stops; retrying would hammer Google with a dead
 * credential and never succeed.
 */
import { ArnoldAuthError } from "../auth/errors.js";
import type { AuthenticatedArnoldContext } from "../auth/identity.js";
import type { FetchLike, KeyResolver } from "../auth/jwks.js";
import { TokenCipher } from "./crypto.js";
import {
  toView,
  type GoogleConnectionView,
  type GoogleCredentialRepository,
} from "./credential-repository.js";
import { verifyGoogleIdToken } from "./id-token.js";
import {
  GoogleGrantRevokedError,
  PendingAuthorizationStore,
  exchangeAuthorizationCode,
  refreshAccessToken,
  revokeGoogleToken,
  startAuthorization,
  type GoogleOAuthClientConfig,
} from "./oauth-flow.js";
import { describeScopeVerdict } from "./scopes.js";

/** Refresh this far before actual expiry, so a call never races the clock. */
const EXPIRY_MARGIN_MS = 2 * 60 * 1000;

export const GOOGLE_CONNECTION_ERRORS = [
  "GOOGLE_NOT_CONNECTED",
  "GOOGLE_REAUTH_REQUIRED",
  "GOOGLE_STATE_INVALID",
  "GOOGLE_STATE_USER_MISMATCH",
  "GOOGLE_CONSENT_DECLINED",
  "GOOGLE_SCOPE_INSUFFICIENT",
  "GOOGLE_ACCOUNT_CHANGE_REQUIRES_CONFIRMATION",
  "GOOGLE_ONBOARDING_BINDING_STALE",
  "GOOGLE_UNAVAILABLE",
] as const;

export type GoogleConnectionErrorCode =
  (typeof GOOGLE_CONNECTION_ERRORS)[number];

export class GoogleConnectionError extends Error {
  constructor(
    readonly code: GoogleConnectionErrorCode,
    message: string,
    /** Operator detail. Never a token. */
    readonly detail?: string,
  ) {
    super(message);
    this.name = "GoogleConnectionError";
  }
}

interface CachedAccessToken {
  token: string;
  expiresAtMs: number;
}

export interface GoogleConnectionServiceOptions {
  config: GoogleOAuthClientConfig;
  repository: GoogleCredentialRepository;
  cipher: TokenCipher;
  /** Resolver for Google's id_token signing keys. */
  idTokenKeys: KeyResolver;
  pending?: PendingAuthorizationStore;
  fetchImpl?: FetchLike;
  now?: () => number;
  onEvent?: (event: GoogleConnectionEvent) => void;
}

export interface GoogleConnectionEvent {
  kind:
    | "connect_started"
    | "connected"
    | "connect_refused"
    | "refreshed"
    | "reauth_required"
    | "disconnected";
  userId: string;
  code?: string;
  detail?: string;
  at: string;
}

export interface StartConnectionInput {
  /** The user explicitly chose to connect a different Google account. */
  allowAccountChange?: boolean;
  /** Binding to a confirmed onboarding draft, from Task 006. */
  onboardingBinding?: string;
}

export interface CompleteConnectionInput {
  /** A provisioned tracker stays bound to its original Google account. */
  expectedGoogleSubject?: string;
  state: string;
  code?: string;
  /** Google's `error` parameter, when the user declined or it failed. */
  error?: string;
  /**
   * Re-checked against the pending record's binding. Supplied by the caller
   * that knows the current confirmed plan revision (Task 006/007-C3).
   */
  expectedOnboardingBinding?: string;
}

export class GoogleConnectionService {
  private readonly options: GoogleConnectionServiceOptions;
  private readonly pending: PendingAuthorizationStore;
  /** Per-user access tokens. Keyed by Arnold user id — never global (§17). */
  private readonly accessTokens = new Map<string, CachedAccessToken>();
  /** In-flight refreshes, keyed by user id, so only one runs per user. */
  private readonly refreshes = new Map<string, Promise<string>>();
  /** Account-change consent, carried from start to callback. */
  private readonly accountChangeAllowed = new Set<string>();

  constructor(options: GoogleConnectionServiceOptions) {
    this.options = options;
    // The store must share this service's clock. Letting it default to
    // Date.now() while the service reads an injected clock gives the two a
    // different notion of "now", and every pending record is then judged
    // against a timeline it was not written on — which expires authorizations
    // the instant they are created.
    this.pending =
      options.pending ??
      new PendingAuthorizationStore({ now: () => this.now() });
  }

  private now(): number {
    return this.options.now?.() ?? Date.now();
  }

  private emit(event: Omit<GoogleConnectionEvent, "at">): void {
    this.options.onEvent?.({
      ...event,
      at: new Date(this.now()).toISOString(),
    });
  }

  /** Where to send the user's browser to authorize Google. */
  start(
    context: AuthenticatedArnoldContext,
    input: StartConnectionInput = {},
  ): { authorizationUrl: string; state: string } {
    const started = startAuthorization(this.options.config, this.pending, {
      userId: context.userId,
      onboardingBinding: input.onboardingBinding,
      now: () => this.now(),
    });
    if (input.allowAccountChange) this.accountChangeAllowed.add(started.state);
    this.emit({ kind: "connect_started", userId: context.userId });
    return started;
  }

  /**
   * Finishes an authorization.
   *
   * `context` is the *currently authenticated* Arnold user, from the verified
   * MCP/session credential — not from the callback's parameters.
   */
  async complete(
    context: AuthenticatedArnoldContext,
    input: CompleteConnectionInput,
  ): Promise<GoogleConnectionView> {
    const pending = this.pending.consume(input.state);
    const allowAccountChange = this.accountChangeAllowed.delete(input.state);

    if (!pending) {
      // Unknown, expired, or already-used state. All three are the same
      // refusal, which is also what blocks authorization-code replay.
      this.emit({
        kind: "connect_refused",
        userId: context.userId,
        code: "GOOGLE_STATE_INVALID",
      });
      throw new GoogleConnectionError(
        "GOOGLE_STATE_INVALID",
        "Dieser Verbindungsversuch ist abgelaufen oder wurde bereits verwendet. Bitte erneut starten.",
      );
    }

    if (pending.userId !== context.userId) {
      this.emit({
        kind: "connect_refused",
        userId: context.userId,
        code: "GOOGLE_STATE_USER_MISMATCH",
        detail: `Pending gehört zu ${pending.userId}.`,
      });
      throw new GoogleConnectionError(
        "GOOGLE_STATE_USER_MISMATCH",
        "Dieser Verbindungsversuch gehört zu einem anderen Arnold-Konto.",
      );
    }

    if (
      pending.onboardingBinding !== undefined &&
      pending.onboardingBinding !== input.expectedOnboardingBinding
    ) {
      // The confirmed plan changed between starting and finishing the flow.
      throw new GoogleConnectionError(
        "GOOGLE_ONBOARDING_BINDING_STALE",
        "Der bestätigte Trainingsplan hat sich geändert. Bitte die Bestätigung wiederholen.",
      );
    }

    if (input.error || !input.code) {
      const declined = input.error === "access_denied";
      this.emit({
        kind: "connect_refused",
        userId: context.userId,
        code: "GOOGLE_CONSENT_DECLINED",
        detail: input.error,
      });
      throw new GoogleConnectionError(
        "GOOGLE_CONSENT_DECLINED",
        declined
          ? "Die Google-Freigabe wurde abgebrochen. Ohne sie kann Arnold keine Trainingsdatei anlegen."
          : "Die Google-Verbindung ist fehlgeschlagen. Bitte erneut versuchen.",
        input.error,
      );
    }

    const exchanged = await exchangeAuthorizationCode(
      this.options.config,
      pending,
      input.code,
      { fetchImpl: this.options.fetchImpl, now: () => this.now() },
    );

    if (!exchanged.scopeVerdict.usable) {
      this.emit({
        kind: "connect_refused",
        userId: context.userId,
        code: "GOOGLE_SCOPE_INSUFFICIENT",
        detail: `missing=${exchanged.scopeVerdict.missing.join(",")} excessive=${exchanged.scopeVerdict.excessive.join(",")}`,
      });
      // No credential is stored, so nothing claims a half-working connection.
      throw new GoogleConnectionError(
        "GOOGLE_SCOPE_INSUFFICIENT",
        describeScopeVerdict(exchanged.scopeVerdict),
      );
    }

    const identity = await verifyGoogleIdToken({
      idToken: exchanged.idToken,
      clientId: this.options.config.clientId,
      keys: this.options.idTokenKeys,
      expectedNonce: pending.nonce,
      now: () => this.now(),
    });

    const existing = await this.options.repository.findByUser(context.userId);
    if (
      input.expectedGoogleSubject &&
      input.expectedGoogleSubject !== identity.subject
    )
      throw new GoogleConnectionError(
        "GOOGLE_ACCOUNT_CHANGE_REQUIRES_CONFIRMATION",
        "Bitte dasselbe Google-Konto verbinden, dem deine Trainingsdatei gehört.",
      );
    if (
      existing &&
      existing.google_subject !== identity.subject &&
      !allowAccountChange
    ) {
      this.emit({
        kind: "connect_refused",
        userId: context.userId,
        code: "GOOGLE_ACCOUNT_CHANGE_REQUIRES_CONFIRMATION",
      });
      throw new GoogleConnectionError(
        "GOOGLE_ACCOUNT_CHANGE_REQUIRES_CONFIRMATION",
        "Dieses Arnold-Konto ist bereits mit einem anderen Google-Konto verbunden. Ein Wechsel muss ausdrücklich bestätigt werden, weil die bestehende Trainingsdatei beim alten Konto liegt.",
      );
    }

    // The AAD binds to the verified Google subject, which is known here and
    // never changes — so the token is sealed once, before the insert, with no
    // dependence on an id the store has not assigned yet.
    const sealed =
      exchanged.refreshToken === null
        ? null
        : this.options.cipher.seal(exchanged.refreshToken, {
            userId: context.userId,
            accountRef: identity.subject,
            field: "refresh_token",
          });

    const { connection } = await this.options.repository.upsert({
      userId: context.userId,
      googleSubject: identity.subject,
      googleEmail: identity.email,
      grantedScopes: [...exchanged.scopeVerdict.granted],
      refreshToken: sealed,
    });

    this.accessTokens.set(context.userId, {
      token: exchanged.accessToken,
      expiresAtMs: exchanged.accessTokenExpiresAtMs,
    });

    if (exchanged.refreshToken === null) {
      // Google only issues a refresh token on first consent. Without one
      // Arnold cannot act later, so the connection is honest about that
      // rather than appearing healthy until the access token lapses.
      await this.options.repository.markStatus(
        context.userId,
        "REAUTH_REQUIRED",
        "NO_REFRESH_TOKEN",
      );
      this.emit({
        kind: "reauth_required",
        userId: context.userId,
        code: "NO_REFRESH_TOKEN",
      });
    } else {
      this.emit({ kind: "connected", userId: context.userId });
    }

    const stored = await this.options.repository.findByUser(context.userId);
    return toView(stored ?? connection);
  }

  /** The connection as the user may see it. Never includes token material. */
  async status(
    context: AuthenticatedArnoldContext,
  ): Promise<GoogleConnectionView | null> {
    const connection = await this.options.repository.findByUser(context.userId);
    return connection ? toView(connection) : null;
  }

  /**
   * A usable access token for this user, refreshing if needed.
   *
   * The only way the rest of Arnold reaches Google. Callers get a string and
   * never see the refresh token.
   */
  async accessTokenFor(context: AuthenticatedArnoldContext): Promise<string> {
    const cached = this.accessTokens.get(context.userId);
    if (cached && cached.expiresAtMs - EXPIRY_MARGIN_MS > this.now())
      return cached.token;

    const inFlight = this.refreshes.get(context.userId);
    if (inFlight) return inFlight;

    const refresh = this.performRefresh(context).finally(() => {
      this.refreshes.delete(context.userId);
    });
    this.refreshes.set(context.userId, refresh);
    return refresh;
  }

  /** A definite Google 401 invalidates only this user's cached access token. */
  invalidateAccessToken(context: AuthenticatedArnoldContext): void {
    this.accessTokens.delete(context.userId);
  }

  private async performRefresh(
    context: AuthenticatedArnoldContext,
  ): Promise<string> {
    const connection = await this.options.repository.findByUser(context.userId);
    if (!connection)
      throw new GoogleConnectionError(
        "GOOGLE_NOT_CONNECTED",
        "Für dieses Konto ist kein Google-Zugriff verbunden.",
      );
    if (connection.status === "REAUTH_REQUIRED" || !connection.refresh_token)
      throw new GoogleConnectionError(
        "GOOGLE_REAUTH_REQUIRED",
        "Die Google-Verbindung muss erneuert werden. Bitte Arnold erneut mit Google verbinden.",
        connection.last_error_code ?? undefined,
      );

    const refreshToken = this.options.cipher.open(connection.refresh_token, {
      userId: context.userId,
      accountRef: connection.google_subject,
      field: "refresh_token",
    });

    try {
      const refreshed = await refreshAccessToken(
        this.options.config,
        refreshToken,
        { fetchImpl: this.options.fetchImpl, now: () => this.now() },
      );

      if (refreshed.rotatedRefreshToken) {
        await this.options.repository.replaceRefreshToken(
          context.userId,
          this.options.cipher.seal(refreshed.rotatedRefreshToken, {
            userId: context.userId,
            accountRef: connection.google_subject,
            field: "refresh_token",
          }),
        );
      }

      this.accessTokens.set(context.userId, {
        token: refreshed.accessToken,
        expiresAtMs: refreshed.accessTokenExpiresAtMs,
      });
      await this.options.repository.markSuccess(context.userId);
      this.emit({ kind: "refreshed", userId: context.userId });
      return refreshed.accessToken;
    } catch (error) {
      if (error instanceof GoogleGrantRevokedError) {
        // Terminal. Mark and stop; do not retry a dead credential.
        this.accessTokens.delete(context.userId);
        await this.options.repository.markStatus(
          context.userId,
          "REAUTH_REQUIRED",
          error.errorCode,
        );
        this.emit({
          kind: "reauth_required",
          userId: context.userId,
          code: error.errorCode,
        });
        throw new GoogleConnectionError(
          "GOOGLE_REAUTH_REQUIRED",
          "Der Google-Zugriff wurde widerrufen. Bitte Arnold erneut mit Google verbinden.",
          error.errorCode,
        );
      }
      if (error instanceof ArnoldAuthError)
        throw new GoogleConnectionError(
          "GOOGLE_UNAVAILABLE",
          "Google ist derzeit nicht erreichbar. Bitte später erneut versuchen.",
          error.detail,
        );
      throw error;
    }
  }

  /**
   * Disconnects Google.
   *
   * Four steps, in this order and for this reason: forget locally *last*, so
   * a failure anywhere earlier does not leave Arnold without the credential it
   * would need to retry the revoke. The user's Google file is never touched —
   * disconnecting is not deleting (§10).
   */
  async disconnect(
    context: AuthenticatedArnoldContext,
  ): Promise<{ removed: boolean; revokedAtGoogle: boolean }> {
    const connection = await this.options.repository.findByUser(context.userId);
    if (!connection) return { removed: false, revokedAtGoogle: false };

    let revokedAtGoogle = false;
    if (connection.refresh_token) {
      try {
        const refreshToken = this.options.cipher.open(
          connection.refresh_token,
          {
            userId: context.userId,
            accountRef: connection.google_subject,
            field: "refresh_token",
          },
        );
        revokedAtGoogle = await revokeGoogleToken(refreshToken, {
          fetchImpl: this.options.fetchImpl,
        });
      } catch {
        // Best effort. A revoke Arnold cannot perform must not stop it from
        // forgetting the credential.
        revokedAtGoogle = false;
      }
    }

    this.accessTokens.delete(context.userId);
    const removed = await this.options.repository.remove(context.userId);
    this.emit({ kind: "disconnected", userId: context.userId });
    return { removed, revokedAtGoogle };
  }

  /** Visible for tests: how many authorizations are in flight. */
  get pendingCount(): number {
    return this.pending.size;
  }
}
