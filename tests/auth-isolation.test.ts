/**
 * Multi-user isolation and per-call authorization: Task 007 §17 and §29.
 *
 * The property under test is the one §17 states as an absolute: user A must
 * not be able to read or write anything belonging to user B. At the identity
 * layer that reduces to a narrower claim which this file proves — two
 * different verified credentials never resolve to the same Arnold user, and a
 * tool call never obtains a user context it did not earn.
 */
import { describe, expect, it, vi } from "vitest";
import type { AuthInfo, ServerContext } from "@modelcontextprotocol/server";
import {
  ArnoldIdentityResolver,
  deriveActorId,
} from "../src/server/auth/identity.js";
import {
  ArnoldToolGuard,
  scopeChallengeFor,
  type GuardEvent,
} from "../src/server/auth/tool-guard.js";
import { InMemoryIdentityRepository } from "../src/server/identity/repository.js";
import { ARNOLD_SCOPES, missingScopes } from "../src/server/auth/scopes.js";
import { isAuthError } from "../src/server/auth/errors.js";
import { TEST_AUDIENCE, TEST_ISSUER } from "./fixtures/arnold-auth.js";

/** A verified `AuthInfo` as the bearer middleware would have produced it. */
function authFor(
  subject: string,
  scopes: string[] = [ARNOLD_SCOPES.read],
  overrides: Partial<AuthInfo> & { issuer?: string; tokenId?: string } = {},
): AuthInfo {
  const { issuer = TEST_ISSUER, tokenId, ...rest } = overrides;
  return {
    token: `verified-${subject}`,
    clientId: "chatgpt-test-client",
    scopes,
    expiresAt: Math.floor(Date.now() / 1000) + 600,
    resource: new URL(TEST_AUDIENCE),
    extra: { issuer, subject, tokenId },
    ...rest,
  };
}

/** A tool context carrying a verified token, or none at all. */
const ctxWith = (auth?: AuthInfo): ServerContext =>
  ({ http: auth ? { authInfo: auth } : {} }) as unknown as ServerContext;

const resolverOver = (
  repository: InMemoryIdentityRepository,
  autoProvision = true,
) => new ArnoldIdentityResolver({ repository, autoProvision });

describe("identity resolution", () => {
  it("gives two different subjects two different Arnold users", async () => {
    const repository = new InMemoryIdentityRepository();
    const resolver = resolverOver(repository);

    const alice = await resolver.resolve(authFor("subject-alice"));
    const bob = await resolver.resolve(authFor("subject-bob"));

    expect(alice.userId).not.toBe(bob.userId);
    expect(alice.actorId).not.toBe(bob.actorId);
    expect(repository.snapshot().users).toHaveLength(2);
  });

  it("returns the same user for repeat visits by one subject", async () => {
    const repository = new InMemoryIdentityRepository();
    const resolver = resolverOver(repository);

    const first = await resolver.resolve(authFor("subject-alice"));
    const second = await resolver.resolve(authFor("subject-alice"));

    expect(second.userId).toBe(first.userId);
    expect(first.firstSeen).toBe(true);
    expect(second.firstSeen).toBe(false);
    expect(repository.snapshot().users).toHaveLength(1);
  });

  it("creates exactly one user under concurrent first contact", async () => {
    // The race that would otherwise give one person two Arnold accounts, and
    // later two trackers with split history.
    const repository = new InMemoryIdentityRepository();
    const resolver = resolverOver(repository);

    const results = await Promise.all(
      Array.from({ length: 12 }, () =>
        resolver.resolve(authFor("subject-alice")),
      ),
    );

    const ids = new Set(results.map((r) => r.userId));
    expect(ids.size).toBe(1);
    expect(repository.snapshot().users).toHaveLength(1);
    expect(repository.snapshot().identity_connections).toHaveLength(1);
  });

  it("treats the same subject from a different issuer as a different user", async () => {
    // Subject identifiers are only unique within an issuer. Collapsing them
    // across issuers would let one identity provider mint access to another's
    // users.
    const repository = new InMemoryIdentityRepository();
    const resolver = resolverOver(repository);

    const genuine = await resolver.resolve(authFor("shared-subject"));
    const other = await resolver.resolve(
      authFor("shared-subject", [ARNOLD_SCOPES.read], {
        issuer: "https://other-idp.test/",
      }),
    );

    expect(other.userId).not.toBe(genuine.userId);
    expect(repository.snapshot().users).toHaveLength(2);
  });

  it("refuses a disabled account", async () => {
    const repository = new InMemoryIdentityRepository();
    const resolver = resolverOver(repository);

    const alice = await resolver.resolve(authFor("subject-alice"));
    await repository.setStatus(alice.userId, "DISABLED");

    const error = await resolver.resolve(authFor("subject-alice")).then(
      () => null,
      (caught: unknown) => caught,
    );
    expect(isAuthError(error, "ACCOUNT_DISABLED")).toBe(true);
  });

  it("refuses an unknown identity when auto-provisioning is off", async () => {
    const repository = new InMemoryIdentityRepository();
    const resolver = resolverOver(repository, false);

    const error = await resolver.resolve(authFor("subject-nobody")).then(
      () => null,
      (caught: unknown) => caught,
    );
    expect(isAuthError(error, "IDENTITY_UNKNOWN")).toBe(true);
    expect(repository.snapshot().users).toHaveLength(0);
  });

  it("refuses a context with no resource binding", async () => {
    const repository = new InMemoryIdentityRepository();
    const resolver = resolverOver(repository);
    const auth = { ...authFor("subject-alice"), resource: undefined };

    const error = await resolver.resolve(auth).then(
      () => null,
      (caught: unknown) => caught,
    );
    expect(isAuthError(error, "INVALID_TOKEN")).toBe(true);
  });

  it("refuses a context whose extra carries no subject", async () => {
    const repository = new InMemoryIdentityRepository();
    const resolver = resolverOver(repository);
    const auth = {
      ...authFor("subject-alice"),
      extra: { issuer: TEST_ISSUER },
    };

    await expect(resolver.resolve(auth)).rejects.toThrow();
  });

  it("derives a stable actor id that does not leak the raw subject", async () => {
    const repository = new InMemoryIdentityRepository();
    const resolver = resolverOver(repository);
    const subject = "user@example.com";

    const context = await resolver.resolve(authFor(subject));

    expect(context.actorId).toBe(deriveActorId(TEST_ISSUER, subject));
    expect(context.actorId).not.toContain(subject);
    expect(context.actorId).not.toContain("example.com");
    expect(context.actorId).toMatch(/^act_[0-9a-f]{32}$/);
  });

  it("derives an auth session id only when the issuer supplies a jti", async () => {
    const repository = new InMemoryIdentityRepository();
    const resolver = resolverOver(repository);

    const withJti = await resolver.resolve(
      authFor("subject-alice", [ARNOLD_SCOPES.read], { tokenId: "jti-123" }),
    );
    const withoutJti = await resolver.resolve(authFor("subject-bob"));

    expect(withJti.authSessionId).toMatch(/^aus_[0-9a-f]{24}$/);
    expect(withJti.authSessionId).not.toContain("jti-123");
    expect(withoutJti.authSessionId).toBeUndefined();
  });

  it("carries the acting client through to the context", async () => {
    const repository = new InMemoryIdentityRepository();
    const resolver = resolverOver(repository);
    const context = await resolver.resolve(
      authFor("subject-alice", [ARNOLD_SCOPES.read], {
        clientId: "other-client",
      }),
    );
    expect(context.clientId).toBe("other-client");
  });
});

describe("identity repository", () => {
  it("lists only the connections of the requested user", async () => {
    const repository = new InMemoryIdentityRepository();
    const alice = await repository.register(TEST_ISSUER, "subject-alice");
    await repository.register(TEST_ISSUER, "subject-bob");

    const connections = await repository.connectionsFor(alice.user.user_id);
    expect(connections).toHaveLength(1);
    expect(connections[0]?.subject).toBe("subject-alice");
  });

  it("refuses an identity with an empty subject", async () => {
    const repository = new InMemoryIdentityRepository();
    await expect(repository.register(TEST_ISSUER, "")).rejects.toThrow();
  });

  it("refuses a status change for an unknown user", async () => {
    const repository = new InMemoryIdentityRepository();
    await expect(
      repository.setStatus("usr_nope", "DISABLED"),
    ).rejects.toThrow();
  });

  it("refreshes last_seen on a repeat visit", async () => {
    const repository = new InMemoryIdentityRepository();
    const first = await repository.register(TEST_ISSUER, "subject-alice");
    const firstSeen = first.connection.last_seen_at_utc;
    await vi.waitFor(() => expect(Date.now()).toBeGreaterThan(0));
    const second = await repository.register(TEST_ISSUER, "subject-alice");
    expect(
      new Date(second.connection.last_seen_at_utc).getTime(),
    ).toBeGreaterThanOrEqual(new Date(firstSeen).getTime());
  });
});

describe("tool guard in enforced mode", () => {
  const guardWith = (
    repository = new InMemoryIdentityRepository(),
    onEvent?: (event: GuardEvent) => void,
  ) =>
    new ArnoldToolGuard({
      mode: "enforced",
      resolver: resolverOver(repository),
      onEvent,
    });

  it("lets a public tool run with no credential at all", async () => {
    const context = await guardWith().authorize(
      "arnold_public_info",
      "PUBLIC",
      ctxWith(),
    );
    // A public tool gets no user context — it has no user to act as.
    expect(context).toBeUndefined();
  });

  it("refuses an authenticated tool with no credential", async () => {
    const error = await guardWith()
      .authorize("get_arnold_dashboard", "AUTHENTICATED_READ", ctxWith())
      .then(
        () => null,
        (caught: unknown) => caught,
      );
    expect(isAuthError(error, "AUTH_REQUIRED")).toBe(true);
  });

  it("admits a read tool holding arnold.read", async () => {
    const context = await guardWith().authorize(
      "get_arnold_dashboard",
      "AUTHENTICATED_READ",
      ctxWith(authFor("subject-alice", [ARNOLD_SCOPES.read])),
    );
    expect(context?.userId).toMatch(/^usr_/);
  });

  it("refuses a write tool holding only arnold.read", async () => {
    const error = await guardWith()
      .authorize(
        "log_arnold_set",
        "AUTHENTICATED_WRITE",
        ctxWith(authFor("subject-alice", [ARNOLD_SCOPES.read])),
      )
      .then(
        () => null,
        (caught: unknown) => caught,
      );
    expect(isAuthError(error, "INSUFFICIENT_SCOPE")).toBe(true);
  });

  it("admits a write tool holding read and write", async () => {
    const context = await guardWith().authorize(
      "log_arnold_set",
      "AUTHENTICATED_WRITE",
      ctxWith(
        authFor("subject-alice", [ARNOLD_SCOPES.read, ARNOLD_SCOPES.write]),
      ),
    );
    expect(context?.scopes).toContain(ARNOLD_SCOPES.write);
  });

  it("does not let arnold.write stand in for arnold.plan", async () => {
    // No scope implies another. A client allowed to log sets is not therefore
    // allowed to rewrite the training plan those sets are measured against.
    const error = await guardWith()
      .authorize(
        "activate_arnold_plan",
        "PLAN_WRITE",
        ctxWith(
          authFor("subject-alice", [ARNOLD_SCOPES.read, ARNOLD_SCOPES.write]),
        ),
      )
      .then(
        () => null,
        (caught: unknown) => caught,
      );
    expect(isAuthError(error, "INSUFFICIENT_SCOPE")).toBe(true);
  });

  it("requires arnold.account for account management", async () => {
    const guard = guardWith();
    const refused = await guard
      .authorize(
        "disconnect_google",
        "ACCOUNT_MANAGEMENT",
        ctxWith(
          authFor("subject-alice", [
            ARNOLD_SCOPES.read,
            ARNOLD_SCOPES.write,
            ARNOLD_SCOPES.plan,
          ]),
        ),
      )
      .then(
        () => null,
        (caught: unknown) => caught,
      );
    expect(isAuthError(refused, "INSUFFICIENT_SCOPE")).toBe(true);

    const granted = await guard.authorize(
      "disconnect_google",
      "ACCOUNT_MANAGEMENT",
      ctxWith(authFor("subject-alice", [ARNOLD_SCOPES.account])),
    );
    expect(granted?.userId).toMatch(/^usr_/);
  });

  it("keeps two users' contexts apart across interleaved calls", async () => {
    const repository = new InMemoryIdentityRepository();
    const guard = guardWith(repository);
    const read = (subject: string) =>
      guard.authorize(
        "get_arnold_dashboard",
        "AUTHENTICATED_READ",
        ctxWith(authFor(subject, [ARNOLD_SCOPES.read])),
      );

    const [a1, b1, a2, b2] = await Promise.all([
      read("subject-alice"),
      read("subject-bob"),
      read("subject-alice"),
      read("subject-bob"),
    ]);

    expect(a1?.userId).toBe(a2?.userId);
    expect(b1?.userId).toBe(b2?.userId);
    expect(a1?.userId).not.toBe(b1?.userId);
  });

  it("re-checks authorization on every call, not once per session", async () => {
    // A context resolved earlier must not keep working after the account is
    // disabled; this is what makes revocation effective mid-session.
    const repository = new InMemoryIdentityRepository();
    const guard = guardWith(repository);
    const auth = authFor("subject-alice", [ARNOLD_SCOPES.read]);

    const first = await guard.authorize(
      "get_arnold_dashboard",
      "AUTHENTICATED_READ",
      ctxWith(auth),
    );
    expect(first).toBeDefined();

    await repository.setStatus(first!.userId, "DISABLED");

    const error = await guard
      .authorize("get_arnold_dashboard", "AUTHENTICATED_READ", ctxWith(auth))
      .then(
        () => null,
        (caught: unknown) => caught,
      );
    expect(isAuthError(error, "ACCOUNT_DISABLED")).toBe(true);
  });

  it("reports a refusal to the audit sink without token material", async () => {
    const events: GuardEvent[] = [];
    const guard = guardWith(new InMemoryIdentityRepository(), (event) =>
      events.push(event),
    );

    await guard
      .authorize(
        "log_arnold_set",
        "AUTHENTICATED_WRITE",
        ctxWith(authFor("subject-alice", [ARNOLD_SCOPES.read])),
      )
      .catch(() => undefined);

    expect(events).toHaveLength(1);
    const [event] = events;
    expect(event?.kind).toBe("refused");
    expect(event?.code).toBe("INSUFFICIENT_SCOPE");
    expect(event?.tool).toBe("log_arnold_set");
    expect(JSON.stringify(event)).not.toContain("verified-subject-alice");
  });

  it("reports a grant with the acting user and client", async () => {
    const events: GuardEvent[] = [];
    const guard = guardWith(new InMemoryIdentityRepository(), (event) =>
      events.push(event),
    );

    await guard.authorize(
      "get_arnold_dashboard",
      "AUTHENTICATED_READ",
      ctxWith(authFor("subject-alice", [ARNOLD_SCOPES.read])),
    );

    expect(events[0]?.kind).toBe("granted");
    expect(events[0]?.userId).toMatch(/^usr_/);
    expect(events[0]?.clientId).toBe("chatgpt-test-client");
  });

  it("rejects a synthetic context in enforced mode at construction", () => {
    expect(
      () =>
        new ArnoldToolGuard({
          mode: "enforced",
          resolver: resolverOver(new InMemoryIdentityRepository()),
          openModeContext: {
            userId: "usr_fixture",
            actorId: "act_fixture",
            scopes: [ARNOLD_SCOPES.read],
            issuer: TEST_ISSUER,
            audience: TEST_AUDIENCE,
            clientId: "fixture",
            authSessionId: undefined,
            firstSeen: false,
          },
        }),
    ).toThrow(/erzwungenen Modus/);
  });
});

describe("tool guard in open mode", () => {
  const openContext = {
    userId: "usr_open_mode",
    actorId: "act_open_mode",
    scopes: [ARNOLD_SCOPES.read],
    issuer: "arnold.local",
    audience: TEST_AUDIENCE,
    clientId: "local",
    authSessionId: undefined,
    firstSeen: false,
  } as const;

  const openGuard = () =>
    new ArnoldToolGuard({
      mode: "open",
      resolver: resolverOver(new InMemoryIdentityRepository()),
      openModeContext: { ...openContext },
    });

  it("still serves read tools, so the demo mode keeps working", async () => {
    const context = await openGuard().authorize(
      "get_arnold_dashboard",
      "AUTHENTICATED_READ",
      ctxWith(),
    );
    expect(context?.userId).toBe("usr_open_mode");
  });

  it("refuses every write class, even without a configured store", async () => {
    const guard = openGuard();
    for (const access of [
      "AUTHENTICATED_WRITE",
      "PLAN_WRITE",
      "ACCOUNT_MANAGEMENT",
    ] as const) {
      const error = await guard
        .authorize("some_write_tool", access, ctxWith())
        .then(
          () => null,
          (caught: unknown) => caught,
        );
      expect(isAuthError(error, "AUTH_REQUIRED"), access).toBe(true);
    }
  });

  it("requires an explicit synthetic context", () => {
    expect(
      () =>
        new ArnoldToolGuard({
          mode: "open",
          resolver: resolverOver(new InMemoryIdentityRepository()),
        }),
    ).toThrow(/synthetischen Kontext/);
  });
});

describe("scope vocabulary", () => {
  it("reports exactly the scopes that are missing", () => {
    expect(
      missingScopes(
        [ARNOLD_SCOPES.read],
        [ARNOLD_SCOPES.read, ARNOLD_SCOPES.write],
      ),
    ).toEqual([ARNOLD_SCOPES.write]);
  });

  it("builds an SDK scope challenge for every non-public class", () => {
    expect(scopeChallengeFor("PUBLIC")).toBeUndefined();
    expect(scopeChallengeFor("AUTHENTICATED_READ")).toBeTypeOf("function");
    expect(scopeChallengeFor("AUTHENTICATED_WRITE")).toBeTypeOf("function");
    expect(scopeChallengeFor("ACCOUNT_MANAGEMENT")).toBeTypeOf("function");
  });
});
