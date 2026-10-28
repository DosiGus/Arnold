/**
 * The Google authorization flow, and the ways it must refuse to complete.
 *
 * The callback is the dangerous surface: a browser request with
 * attacker-influenceable parameters arriving at a URL an attacker can also
 * cause the browser to visit. So most of this file is callbacks that look
 * plausible and must not be honoured — replayed `state`, a `state` belonging
 * to another Arnold user, an id_token echoing someone else's nonce, a grant
 * missing the scope Arnold needs, a silent Google account switch.
 *
 * Covers Task 007 §8, §9, §10 and the OAuth rows of §29.
 */
import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { ArnoldAuthError } from "../src/server/auth/errors.js";
import {
  GoogleConnectionError,
  GoogleConnectionService,
  type GoogleConnectionEvent,
} from "../src/server/google/connection-service.js";
import {
  InMemoryGoogleCredentialRepository,
  type GoogleCredentialRepository,
} from "../src/server/google/credential-repository.js";
import {
  PendingAuthorizationStore,
  startAuthorization,
} from "../src/server/google/oauth-flow.js";
import {
  generateEncryptionKey,
  TokenCipher,
} from "../src/server/google/crypto.js";
import { DRIVE_FILE_SCOPE } from "../src/server/google/scopes.js";
import {
  GOOGLE_CLIENT_ID,
  GOOGLE_REDIRECT_URI,
  contextFor,
  googleIdTokenKeys,
  googleOAuthConfig,
  googleStub,
} from "./fixtures/arnold-google.js";

const alice = contextFor("usr_alice");
const bob = contextFor("usr_bob");

interface Harness {
  service: GoogleConnectionService;
  repository: InMemoryGoogleCredentialRepository;
  stub: ReturnType<typeof googleStub>;
  events: GoogleConnectionEvent[];
  clock: { now: number };
  /** Runs a full successful connect for `context`. */
  connect(
    context: typeof alice,
    options?: { allowAccountChange?: boolean; onboardingBinding?: string },
  ): Promise<Awaited<ReturnType<GoogleConnectionService["complete"]>>>;
}

function harness(
  stubOptions: Parameters<typeof googleStub>[0] = {},
  repositoryOverride?: GoogleCredentialRepository,
): Harness {
  const repository =
    (repositoryOverride as InMemoryGoogleCredentialRepository) ??
    new InMemoryGoogleCredentialRepository();
  const stub = googleStub(stubOptions);
  const events: GoogleConnectionEvent[] = [];
  // Starts at real time rather than a fixed epoch, because the fixture mints
  // id_tokens with real `iat`/`exp` claims and the service verifies them
  // against this clock. The tests only ever move it forward relatively, so an
  // arbitrary origin would just put the two on different timelines.
  const clock = { now: Date.now() };
  const service = new GoogleConnectionService({
    config: googleOAuthConfig,
    repository,
    cipher: new TokenCipher(generateEncryptionKey("k1")),
    idTokenKeys: googleIdTokenKeys,
    fetchImpl: stub.fetchImpl,
    now: () => clock.now,
    onEvent: (event) => events.push(event),
  });

  return {
    service,
    repository,
    stub,
    events,
    clock,
    async connect(context, options = {}) {
      const started = service.start(context, options);
      stub.expectNonce(stub.nonceFor(started.authorizationUrl));
      return service.complete(context, {
        state: started.state,
        code: "google-auth-code",
      });
    },
  };
}

/**
 * The identifying string of a refusal.
 *
 * A `GoogleConnectionError` carries a code; an `ArnoldAuthError` carries its
 * diagnosis in `detail`, because its `message` is deliberately flat and
 * non-revealing. Reaching for `message` on the latter would assert against
 * the generic text and pass for almost any failure.
 */
async function refusalCode(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
    return "<no refusal>";
  } catch (error) {
    if (error instanceof GoogleConnectionError) return error.code;
    if (error instanceof ArnoldAuthError) return error.detail ?? error.message;
    return error instanceof Error ? error.message : String(error);
  }
}

describe("authorization request", () => {
  it("asks Google for exactly the scopes Arnold needs", () => {
    const store = new PendingAuthorizationStore();
    const { authorizationUrl } = startAuthorization(googleOAuthConfig, store, {
      userId: "usr_alice",
    });
    const params = new URL(authorizationUrl).searchParams;

    expect(params.get("scope")?.split(" ")).toContain(DRIVE_FILE_SCOPE);
    expect(params.get("scope")).not.toContain(
      "https://www.googleapis.com/auth/drive ",
    );
    expect(params.get("scope")?.split(" ")).toContain("openid");
    expect(params.get("client_id")).toBe(GOOGLE_CLIENT_ID);
    expect(params.get("redirect_uri")).toBe(GOOGLE_REDIRECT_URI);
    expect(params.get("response_type")).toBe("code");
    expect(params.get("access_type")).toBe("offline");
    expect(params.get("include_granted_scopes")).toBe("false");
  });

  it("uses PKCE S256 with a challenge derived from the stored verifier", () => {
    const store = new PendingAuthorizationStore();
    const { authorizationUrl, state } = startAuthorization(
      googleOAuthConfig,
      store,
      { userId: "usr_alice" },
    );
    const params = new URL(authorizationUrl).searchParams;
    expect(params.get("code_challenge_method")).toBe("S256");

    const pending = store.consume(state);
    const expected = createHash("sha256")
      .update(pending!.codeVerifier, "ascii")
      .digest("base64url");
    expect(params.get("code_challenge")).toBe(expected);
  });

  it("keeps the verifier server-side, never in the redirect", () => {
    const store = new PendingAuthorizationStore();
    const { authorizationUrl, state } = startAuthorization(
      googleOAuthConfig,
      store,
      { userId: "usr_alice" },
    );
    const pending = store.consume(state);
    expect(authorizationUrl).not.toContain(pending!.codeVerifier);
  });

  it("generates a distinct state and nonce per attempt", () => {
    const store = new PendingAuthorizationStore();
    const first = startAuthorization(googleOAuthConfig, store, {
      userId: "usr_alice",
    });
    const second = startAuthorization(googleOAuthConfig, store, {
      userId: "usr_alice",
    });

    expect(first.state).not.toBe(second.state);
    expect(new URL(first.authorizationUrl).searchParams.get("nonce")).not.toBe(
      new URL(second.authorizationUrl).searchParams.get("nonce"),
    );
    expect(first.state.length).toBeGreaterThanOrEqual(43);
  });

  it("records the Arnold user who started the flow", () => {
    const store = new PendingAuthorizationStore();
    const { state } = startAuthorization(googleOAuthConfig, store, {
      userId: "usr_alice",
    });
    expect(store.consume(state)?.userId).toBe("usr_alice");
  });
});

describe("pending authorization store", () => {
  it("consumes a state exactly once", () => {
    const store = new PendingAuthorizationStore();
    const { state } = startAuthorization(googleOAuthConfig, store, {
      userId: "usr_alice",
    });

    expect(store.consume(state)).toBeDefined();
    // The replay. An authorization code is only useful with its state.
    expect(store.consume(state)).toBeUndefined();
  });

  it("expires an abandoned authorization", () => {
    const clock = { now: 1_000_000 };
    const store = new PendingAuthorizationStore({
      ttlMs: 60_000,
      now: () => clock.now,
    });
    const { state } = startAuthorization(googleOAuthConfig, store, {
      userId: "usr_alice",
      now: () => clock.now,
    });

    clock.now += 120_000;
    expect(store.consume(state)).toBeUndefined();
    expect(store.size).toBe(0);
  });

  it("returns nothing for a state it never issued", () => {
    const store = new PendingAuthorizationStore();
    expect(store.consume("fabricated-state")).toBeUndefined();
  });
});

describe("completing an authorization", () => {
  it("stores a usable connection and reports it", async () => {
    const h = harness();
    const view = await h.connect(alice);

    expect(view.status).toBe("CONNECTED");
    expect(view.google_subject).toBe("google-subject-alice");
    expect(view.google_email).toBe("alice@example.com");
    expect(view.has_refresh_token).toBe(true);
    expect(view.granted_scopes).toContain(DRIVE_FILE_SCOPE);
    expect(h.events.map((e) => e.kind)).toContain("connected");
  });

  it("sends the PKCE verifier and the configured redirect URI to Google", async () => {
    const h = harness();
    await h.connect(alice);

    const exchange = h.stub.exchanges.find(
      (e) => e.grantType === "authorization_code",
    );
    expect(exchange?.codeVerifier).toBeTruthy();
    // From Arnold's own record, never from the callback — a caller-chosen
    // redirect URI is an open redirector.
    expect(exchange?.redirectUri).toBe(GOOGLE_REDIRECT_URI);
    expect(exchange?.code).toBe("google-auth-code");
  });

  it("never exposes the refresh token in the returned view", async () => {
    const h = harness();
    const view = await h.connect(alice);
    expect(JSON.stringify(view)).not.toContain("google-refresh-token-1");
  });

  it("refuses a replayed callback", async () => {
    const h = harness();
    const started = h.service.start(alice);
    h.stub.expectNonce(h.stub.nonceFor(started.authorizationUrl));
    await h.service.complete(alice, {
      state: started.state,
      code: "google-auth-code",
    });

    expect(
      await refusalCode(
        h.service.complete(alice, {
          state: started.state,
          code: "google-auth-code",
        }),
      ),
    ).toBe("GOOGLE_STATE_INVALID");
  });

  it("refuses a fabricated state", async () => {
    const h = harness();
    expect(
      await refusalCode(
        h.service.complete(alice, { state: "made-up", code: "c" }),
      ),
    ).toBe("GOOGLE_STATE_INVALID");
  });

  it("refuses a callback completed by a different Arnold user", async () => {
    // Without this check Bob could finish Alice's authorization and Google
    // tokens would be filed against Bob's account.
    const h = harness();
    const started = h.service.start(alice);
    h.stub.expectNonce(h.stub.nonceFor(started.authorizationUrl));

    expect(
      await refusalCode(
        h.service.complete(bob, {
          state: started.state,
          code: "google-auth-code",
        }),
      ),
    ).toBe("GOOGLE_STATE_USER_MISMATCH");
    expect(await h.repository.findByUser("usr_bob")).toBeUndefined();
    expect(await h.repository.findByUser("usr_alice")).toBeUndefined();
  });

  it("refuses a declined consent and stores nothing", async () => {
    const h = harness();
    const started = h.service.start(alice);

    expect(
      await refusalCode(
        h.service.complete(alice, {
          state: started.state,
          error: "access_denied",
        }),
      ),
    ).toBe("GOOGLE_CONSENT_DECLINED");
    // No half-finished connection may be left claiming to work.
    expect(await h.repository.findByUser("usr_alice")).toBeUndefined();
  });

  it("refuses a callback with neither code nor error", async () => {
    const h = harness();
    const started = h.service.start(alice);
    expect(
      await refusalCode(h.service.complete(alice, { state: started.state })),
    ).toBe("GOOGLE_CONSENT_DECLINED");
  });

  it("refuses a grant missing drive.file and stores nothing", async () => {
    const h = harness({ grantedScopes: ["openid", "email"] });
    expect(await refusalCode(h.connect(alice))).toBe(
      "GOOGLE_SCOPE_INSUFFICIENT",
    );
    expect(await h.repository.findByUser("usr_alice")).toBeUndefined();
  });

  it("refuses a grant that is broader than Arnold asked for", async () => {
    const h = harness({
      grantedScopes: [
        "openid",
        DRIVE_FILE_SCOPE,
        "https://www.googleapis.com/auth/drive",
      ],
    });
    expect(await refusalCode(h.connect(alice))).toBe(
      "GOOGLE_SCOPE_INSUFFICIENT",
    );
    expect(await h.repository.findByUser("usr_alice")).toBeUndefined();
  });

  it("refuses a response with no id_token", async () => {
    // Without an id_token there is no verified account subject, so there is
    // nothing to key the connection on.
    const h = harness({ omitIdToken: true });
    expect(await refusalCode(h.connect(alice))).toMatch(/id_token/);
  });

  it("refuses an id_token echoing a different nonce", async () => {
    const h = harness();
    const started = h.service.start(alice);
    // The stub signs a token for a nonce Arnold never issued — an id_token
    // captured from another flow and replayed into Arnold's callback.
    h.stub.expectNonce("some-other-flows-nonce");

    expect(
      await refusalCode(
        h.service.complete(alice, {
          state: started.state,
          code: "google-auth-code",
        }),
      ),
    ).toMatch(/nonce|Replay|Anmeldung/);
    expect(await h.repository.findByUser("usr_alice")).toBeUndefined();
  });

  it("marks a connection without a refresh token as needing reauthorization", async () => {
    // Google only issues a refresh token on first consent. A connection
    // without one cannot act later, so it says so now rather than looking
    // healthy until the access token lapses.
    const h = harness({ issueRefreshToken: false });
    const view = await h.connect(alice);

    expect(view.status).toBe("REAUTH_REQUIRED");
    expect(view.last_error_code).toBe("NO_REFRESH_TOKEN");
    expect(h.events.map((e) => e.kind)).toContain("reauth_required");
  });

  it("refuses a stale onboarding binding", async () => {
    const h = harness();
    const started = h.service.start(alice, {
      onboardingBinding: "binding-for-revision-3",
    });
    h.stub.expectNonce(h.stub.nonceFor(started.authorizationUrl));

    expect(
      await refusalCode(
        h.service.complete(alice, {
          state: started.state,
          code: "google-auth-code",
          expectedOnboardingBinding: "binding-for-revision-4",
        }),
      ),
    ).toBe("GOOGLE_ONBOARDING_BINDING_STALE");
  });

  it("accepts a matching onboarding binding", async () => {
    const h = harness();
    const started = h.service.start(alice, {
      onboardingBinding: "binding-for-revision-3",
    });
    h.stub.expectNonce(h.stub.nonceFor(started.authorizationUrl));

    const view = await h.service.complete(alice, {
      state: started.state,
      code: "google-auth-code",
      expectedOnboardingBinding: "binding-for-revision-3",
    });
    expect(view.status).toBe("CONNECTED");
  });
});

describe("switching Google account", () => {
  it("refuses a silent switch and leaves the old connection intact", async () => {
    const h = harness();
    await h.connect(alice);

    h.stub.set({ subject: "google-subject-someone-else" });
    expect(await refusalCode(h.connect(alice))).toBe(
      "GOOGLE_ACCOUNT_CHANGE_REQUIRES_CONFIRMATION",
    );

    const stored = await h.repository.findByUser("usr_alice");
    expect(stored?.google_subject).toBe("google-subject-alice");
  });

  it("accepts a switch the user confirmed when starting the flow", async () => {
    const h = harness();
    await h.connect(alice);

    h.stub.set({ subject: "google-subject-someone-else" });
    const view = await h.connect(alice, { allowAccountChange: true });

    expect(view.google_subject).toBe("google-subject-someone-else");
  });

  it("does not treat reconnecting the same account as a switch", async () => {
    const h = harness();
    await h.connect(alice);
    const again = await h.connect(alice);
    expect(again.status).toBe("CONNECTED");
  });

  it("does not let confirmation leak to a later flow", async () => {
    // The consent is bound to the state it was given with, so a second,
    // unconfirmed attempt is refused again.
    const h = harness();
    await h.connect(alice);

    h.stub.set({ subject: "google-subject-second" });
    await h.connect(alice, { allowAccountChange: true });

    h.stub.set({ subject: "google-subject-third" });
    expect(await refusalCode(h.connect(alice))).toBe(
      "GOOGLE_ACCOUNT_CHANGE_REQUIRES_CONFIRMATION",
    );
  });
});

describe("access tokens", () => {
  it("serves the token from the exchange without calling Google again", async () => {
    const h = harness();
    await h.connect(alice);

    expect(await h.service.accessTokenFor(alice)).toBe("google-access-token-1");
    expect(h.stub.refreshCalls).toBe(0);
  });

  it("refreshes once the cached token nears expiry", async () => {
    const h = harness();
    await h.connect(alice);

    h.clock.now += 59 * 60 * 1000;
    const token = await h.service.accessTokenFor(alice);

    expect(token).toBe("google-access-token-refreshed-1");
    expect(h.stub.refreshCalls).toBe(1);
  });

  it("coalesces concurrent refreshes into one call to Google", async () => {
    // With refresh-token rotation, parallel refreshes race to store different
    // rotated tokens and the loser's is invalidated by Google — so this is a
    // correctness property, not just an efficiency one.
    const h = harness({ rotateRefreshToken: true });
    await h.connect(alice);
    h.clock.now += 59 * 60 * 1000;

    const tokens = await Promise.all([
      h.service.accessTokenFor(alice),
      h.service.accessTokenFor(alice),
      h.service.accessTokenFor(alice),
      h.service.accessTokenFor(alice),
    ]);

    expect(h.stub.refreshCalls).toBe(1);
    expect(new Set(tokens).size).toBe(1);
  });

  it("stores a rotated refresh token and uses it next time", async () => {
    const h = harness({ rotateRefreshToken: true });
    await h.connect(alice);

    h.clock.now += 59 * 60 * 1000;
    await h.service.accessTokenFor(alice);
    h.clock.now += 59 * 60 * 1000;
    await h.service.accessTokenFor(alice);

    const refreshes = h.stub.exchanges.filter(
      (e) => e.grantType === "refresh_token",
    );
    expect(refreshes[0]?.refreshToken).toBe("google-refresh-token-1");
    expect(refreshes[1]?.refreshToken).toBe("google-refresh-token-rotated-1");
  });

  it("keeps two users' access tokens apart", async () => {
    const h = harness();
    await h.connect(alice);
    h.stub.set({ subject: "google-subject-bob", email: "bob@example.com" });
    await h.connect(bob);

    const aliceConnection = await h.repository.findByUser("usr_alice");
    const bobConnection = await h.repository.findByUser("usr_bob");
    expect(aliceConnection?.google_subject).toBe("google-subject-alice");
    expect(bobConnection?.google_subject).toBe("google-subject-bob");

    // Each refresh uses that user's own credential.
    h.clock.now += 59 * 60 * 1000;
    await h.service.accessTokenFor(alice);
    await h.service.accessTokenFor(bob);
    expect(h.stub.refreshCalls).toBe(2);
  });

  it("refuses to mint a token for a user with no connection", async () => {
    const h = harness();
    expect(await refusalCode(h.service.accessTokenFor(alice))).toBe(
      "GOOGLE_NOT_CONNECTED",
    );
  });
});

describe("revoked and failing grants", () => {
  it("treats invalid_grant as terminal and asks for reauthorization", async () => {
    const h = harness();
    await h.connect(alice);
    h.stub.set({ refreshError: "invalid_grant" });
    h.clock.now += 59 * 60 * 1000;

    expect(await refusalCode(h.service.accessTokenFor(alice))).toBe(
      "GOOGLE_REAUTH_REQUIRED",
    );

    const stored = await h.repository.findByUser("usr_alice");
    expect(stored?.status).toBe("REAUTH_REQUIRED");
    expect(stored?.last_error_code).toBe("invalid_grant");
    // The dead credential is dropped rather than retried forever.
    expect(stored?.refresh_token).toBeNull();
  });

  it("does not retry a revoked grant on the next call", async () => {
    const h = harness();
    await h.connect(alice);
    h.stub.set({ refreshError: "invalid_grant" });
    h.clock.now += 59 * 60 * 1000;

    await refusalCode(h.service.accessTokenFor(alice));
    const afterFirst = h.stub.refreshCalls;
    await refusalCode(h.service.accessTokenFor(alice));

    expect(h.stub.refreshCalls).toBe(afterFirst);
  });

  it("treats a Google outage as temporary and keeps the credential", async () => {
    // A 503 is not a revocation. Dropping the refresh token here would log the
    // user out over a transient failure.
    const h = harness();
    await h.connect(alice);
    h.stub.set({ refreshError: "backend_error" });
    h.clock.now += 59 * 60 * 1000;

    expect(await refusalCode(h.service.accessTokenFor(alice))).toBe(
      "GOOGLE_UNAVAILABLE",
    );
    const stored = await h.repository.findByUser("usr_alice");
    expect(stored?.status).toBe("CONNECTED");
    expect(stored?.refresh_token).not.toBeNull();
  });

  it("recovers once Google is reachable again", async () => {
    const h = harness();
    await h.connect(alice);
    h.stub.set({ refreshError: "backend_error" });
    h.clock.now += 59 * 60 * 1000;
    await refusalCode(h.service.accessTokenFor(alice));

    h.stub.set({ refreshError: null });
    expect(await h.service.accessTokenFor(alice)).toMatch(/refreshed/);
  });

  it("allows reconnecting after a revocation", async () => {
    const h = harness();
    await h.connect(alice);
    h.stub.set({ refreshError: "invalid_grant" });
    h.clock.now += 59 * 60 * 1000;
    await refusalCode(h.service.accessTokenFor(alice));

    h.stub.set({ refreshError: null });
    const view = await h.connect(alice);
    expect(view.status).toBe("CONNECTED");
    expect(view.has_refresh_token).toBe(true);
  });
});

describe("disconnecting", () => {
  it("revokes at Google and forgets the credential", async () => {
    const h = harness();
    await h.connect(alice);

    const result = await h.service.disconnect(alice);

    expect(result).toEqual({ removed: true, revokedAtGoogle: true });
    expect(h.stub.revocations).toContain("google-refresh-token-1");
    expect(await h.repository.findByUser("usr_alice")).toBeUndefined();
    expect(h.events.map((e) => e.kind)).toContain("disconnected");
  });

  it("still forgets the credential when Google's revoke fails", async () => {
    // Leaving a token in Arnold's database because Google was briefly
    // unreachable is the worse of the two outcomes.
    const h = harness({ revokeFails: true });
    await h.connect(alice);

    const result = await h.service.disconnect(alice);

    expect(result).toEqual({ removed: true, revokedAtGoogle: false });
    expect(await h.repository.findByUser("usr_alice")).toBeUndefined();
  });

  it("is harmless for a user who never connected", async () => {
    const h = harness();
    expect(await h.service.disconnect(alice)).toEqual({
      removed: false,
      revokedAtGoogle: false,
    });
  });

  it("does not touch another user's connection", async () => {
    const h = harness();
    await h.connect(alice);
    h.stub.set({ subject: "google-subject-bob" });
    await h.connect(bob);

    await h.service.disconnect(alice);

    expect(await h.repository.findByUser("usr_alice")).toBeUndefined();
    expect(await h.repository.findByUser("usr_bob")).toBeDefined();
  });

  it("stops serving access tokens afterwards", async () => {
    const h = harness();
    await h.connect(alice);
    await h.service.disconnect(alice);

    expect(await refusalCode(h.service.accessTokenFor(alice))).toBe(
      "GOOGLE_NOT_CONNECTED",
    );
  });
});

describe("connection status", () => {
  it("reports nothing before a connection exists", async () => {
    const h = harness();
    expect(await h.service.status(alice)).toBeNull();
  });

  it("reports the connected account without token material", async () => {
    const h = harness();
    await h.connect(alice);

    const status = await h.service.status(alice);
    expect(status?.status).toBe("CONNECTED");
    expect(status?.google_email).toBe("alice@example.com");
    expect(status?.has_refresh_token).toBe(true);
    expect(JSON.stringify(status)).not.toContain("google-refresh-token");
    expect(JSON.stringify(status)).not.toContain("google-access-token");
  });

  it("reports only the asking user's connection", async () => {
    const h = harness();
    await h.connect(alice);
    expect(await h.service.status(bob)).toBeNull();
  });
});

describe("audit events", () => {
  it("never carries token material", async () => {
    const h = harness();
    await h.connect(alice);
    h.clock.now += 59 * 60 * 1000;
    await h.service.accessTokenFor(alice);
    await h.service.disconnect(alice);

    const serialized = JSON.stringify(h.events);
    expect(serialized).not.toContain("google-refresh-token");
    expect(serialized).not.toContain("google-access-token");
    expect(serialized).not.toContain("google-auth-code");
  });

  it("records a refused connect with its reason", async () => {
    const h = harness();
    await h.service
      .complete(alice, { state: "nope", code: "x" })
      .catch(() => undefined);

    const refusal = h.events.find((e) => e.kind === "connect_refused");
    expect(refusal?.code).toBe("GOOGLE_STATE_INVALID");
    expect(refusal?.userId).toBe("usr_alice");
  });
});
