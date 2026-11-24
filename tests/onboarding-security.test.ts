/**
 * Session isolation, identity binding, persistence and retention.
 *
 * The rule under test throughout (D-11): **the verified identity is the only
 * key to a setup.** No tool takes a setup id or a secret; whatever a client
 * sends in their place is ignored and selects nothing. Another account never
 * reaches a setup it did not create, and every failure is closed and coded.
 *
 * The persistence tests cover the other half of §11: a setup must survive a
 * server restart to be resumable at all, and an abandoned one must not be kept
 * forever.
 */
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  AuthenticatedOnboardingAccessControl,
  DenyOnboardingAccessControl,
  FixtureOnboardingAccessControl,
  createSessionToken,
  fingerprintToken,
} from "../src/server/onboarding/access";
import type { AuthenticatedArnoldContext } from "../src/server/auth/identity";
import {
  InMemoryOnboardingRepository,
  ONBOARDING_RETENTION_MS,
  OnboardingRecordSchema,
  RepositoryConflictError,
  isExpired,
  type OnboardingRecord,
} from "../src/server/onboarding/repository";
import { createFixtureOnboarding } from "../src/server/onboarding/fixture";
import { ONBOARDING_SCHEMA_VERSION } from "../src/shared/onboarding-contract";

const rid = () => randomUUID();

const TRAINING = {
  primary_goal: "muscle_gain",
  experience: "intermediate",
  days_per_week: 3,
  session_minutes: 60,
  environment: "gym",
} as const;
const COMPLETE = { path: "arnold_plan", training: TRAINING } as const;

/** A synthetic stored record, for the repository tests. */
function record(
  id: string,
  overrides: {
    token?: string;
    expiresAt?: string;
    revision?: number;
  } = {},
): OnboardingRecord {
  const token = overrides.token ?? createSessionToken();
  return OnboardingRecordSchema.parse({
    session: {
      onboarding_session_id: id,
      status: "COLLECTING_PROFILE",
      current_step: "welcome",
      schema_version: ONBOARDING_SCHEMA_VERSION,
      created_at_utc: "2026-05-01T10:00:00Z",
      updated_at_utc: "2026-05-01T10:00:00Z",
      expires_at_utc: overrides.expiresAt ?? "2026-05-02T10:00:00Z",
      revision: overrides.revision ?? 1,
      profile: {
        path: null,
        person: {},
        training: {
          primary_goal: null,
          experience: null,
          days_per_week: null,
          session_minutes: null,
          environment: null,
        },
        revision: 0,
        updated_at_utc: null,
      },
      plan_draft_reference: null,
      confirmed_plan_reference: null,
      handoff_status: "not_ready",
      last_error: null,
      tracker_id: "arnold-plan-fixture-tracker",
    },
    token_fingerprint: fingerprintToken(token),
    owner_subject: "synthetic-onboarding-fixture",
    applied: {},
  });
}

/* ----------------------------------------------------------- the credential */

describe("session tokens", () => {
  it("are long, random and distinct", () => {
    const tokens = new Set(
      Array.from({ length: 50 }, () => createSessionToken()),
    );
    expect(tokens.size).toBe(50);
    for (const token of tokens) {
      expect(token.length).toBeGreaterThanOrEqual(32);
      expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
    }
  });

  it("are stored only as a hash", () => {
    const token = createSessionToken();
    const stored = fingerprintToken(token);
    expect(stored).toHaveLength(64);
    expect(stored).not.toContain(token);
    // Deterministic for the same token, different for another.
    expect(fingerprintToken(token)).toBe(stored);
    expect(fingerprintToken(createSessionToken())).not.toBe(stored);
  });
});

const account = (userId: string) =>
  ({ userId }) as unknown as AuthenticatedArnoldContext;

describe("the fixture access guard", () => {
  const guard = new FixtureOnboardingAccessControl();

  it("accepts a setup of its own subject without any secret", async () => {
    const principal = await guard.authorize(record("onb-1"));
    expect(principal.verified).toBe(true);
    expect(principal.kind).toBe("fixture");
  });

  it("refuses a session owned by another subject", async () => {
    const foreign = { ...record("onb-1"), owner_subject: "someone-else" };
    await expect(guard.authorize(foreign)).rejects.toMatchObject({
      code: "PERMISSION_DENIED",
    });
  });
});

describe("the production guard", () => {
  it("refuses everything without an identity binding", async () => {
    const guard = new DenyOnboardingAccessControl();
    expect(guard.mode).toBe("production");
    await expect(guard.establish(undefined)).rejects.toMatchObject({
      code: "AUTH_REQUIRED",
    });
    await expect(guard.authorize(record("onb-1"))).rejects.toMatchObject({
      code: "AUTH_REQUIRED",
    });
  });
});

describe("the account guard", () => {
  const guard = new AuthenticatedOnboardingAccessControl("user-1");

  it("refuses a caller that is not its verified account", async () => {
    await expect(guard.establish(account("user-2"))).rejects.toMatchObject({
      code: "AUTH_REQUIRED",
    });
    await expect(guard.establish(undefined)).rejects.toMatchObject({
      code: "AUTH_REQUIRED",
    });
  });

  it("refuses a setup another account created", async () => {
    const foreign = { ...record("onb-1"), owner_subject: "user-2" };
    await expect(
      guard.authorize(foreign, account("user-1")),
    ).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
    const own = { ...record("onb-2"), owner_subject: "user-1" };
    await expect(
      guard.authorize(own, account("user-1")),
    ).resolves.toMatchObject({ subject: "user-1", kind: "authenticated" });
  });
});

/* -------------------------------------------------------------- isolation */

/** Two accounts on one store, each behind its own guard, as in production. */
function twoAccounts(
  options: { clock?: () => Date; sessionTtlMs?: number } = {},
) {
  const repository = new InMemoryOnboardingRepository();
  const runtime = (userId: string) =>
    createFixtureOnboarding({
      ...options,
      repository,
      access: new AuthenticatedOnboardingAccessControl(userId),
    }).onboarding;
  return {
    repository,
    one: runtime("user-1"),
    two: runtime("user-2"),
    ctx1: account("user-1"),
    ctx2: account("user-2"),
  };
}

describe("binding by identity", () => {
  it("works without a setup id or a secret", async () => {
    const { one, ctx1 } = twoAccounts();
    const started = await one.startOnboarding({ request_id: rid() }, ctx1);
    expect(started.ok).toBe(true);
    const saved = await one.updateProfile(
      { request_id: rid(), profile: COMPLETE },
      ctx1,
    );
    expect(saved.ok).toBe(true);
    const state = await one.getOnboardingState({}, ctx1);
    expect(state.session.profile.training.days_per_week).toBe(3);
  });

  it("finds nothing for an account without a setup", async () => {
    const { two, ctx2 } = twoAccounts();
    await expect(two.getOnboardingState({}, ctx2)).rejects.toMatchObject({
      code: "SESSION_NOT_FOUND",
    });
    const write = await two.updateProfile(
      { request_id: rid(), profile: COMPLETE },
      ctx2,
    );
    expect(write.ok).toBe(false);
    expect(write.error?.code).toBe("SESSION_NOT_FOUND");
  });

  it("never reaches another account's setup, whatever the client sends", async () => {
    const { repository, one, two, ctx1, ctx2 } = twoAccounts();
    await one.startOnboarding({ request_id: rid() }, ctx1);
    await one.updateProfile({ request_id: rid(), profile: COMPLETE }, ctx1);
    const stored = (await repository.findLatestByOwner("user-1"))!;

    // Legacy fields naming user 1's setup are stripped and select nothing.
    const legacy = {
      onboarding_session_id: stored.session.onboarding_session_id,
      session_token: "x".repeat(43),
    };
    await expect(two.getOnboardingState(legacy, ctx2)).rejects.toMatchObject({
      code: "SESSION_NOT_FOUND",
    });
    const write = await two.updateProfile(
      {
        request_id: rid(),
        ...legacy,
        profile: { training: { days_per_week: 6 } },
      },
      ctx2,
    );
    expect(write.ok).toBe(false);
    expect(write.error?.code).toBe("SESSION_NOT_FOUND");
    // User 2's guard with user 1's identity is refused outright.
    await expect(two.getOnboardingState({}, ctx1)).rejects.toMatchObject({
      code: "AUTH_REQUIRED",
    });
    // User 1's answers are untouched.
    const own = await one.getOnboardingState({}, ctx1);
    expect(own.session.profile.training.days_per_week).toBe(3);
  });

  it("keeps the answers of two accounts apart", async () => {
    const { one, two, ctx1, ctx2 } = twoAccounts();
    await one.startOnboarding({ request_id: rid() }, ctx1);
    await two.startOnboarding({ request_id: rid() }, ctx2);
    await one.updateProfile({ request_id: rid(), profile: COMPLETE }, ctx1);
    await two.updateProfile(
      {
        request_id: rid(),
        profile: {
          ...COMPLETE,
          training: { ...TRAINING, days_per_week: 5, primary_goal: "strength" },
        },
      },
      ctx2,
    );
    const a = await one.getOnboardingState({}, ctx1);
    const b = await two.getOnboardingState({}, ctx2);
    expect(a.session.profile.training.primary_goal).toBe("muscle_gain");
    expect(b.session.profile.training.days_per_week).toBe(5);
    expect(b.session.profile.training.primary_goal).toBe("strength");
  });

  it("fails closed on an expired setup", async () => {
    let now = new Date("2026-05-01T10:00:00Z");
    const { one, ctx1 } = twoAccounts({
      clock: () => now,
      sessionTtlMs: 60_000,
    });
    await one.startOnboarding({ request_id: rid() }, ctx1);
    now = new Date("2026-05-01T11:00:00Z");
    await expect(one.getOnboardingState({}, ctx1)).rejects.toMatchObject({
      code: "SESSION_EXPIRED",
    });
    const write = await one.updateProfile(
      { request_id: rid(), profile: COMPLETE },
      ctx1,
    );
    expect(write.error?.code).toBe("SESSION_EXPIRED");
  });

  it("fails closed on a cancelled setup", async () => {
    const { one, ctx1 } = twoAccounts();
    await one.startOnboarding({ request_id: rid() }, ctx1);
    const cancelled = await one.cancelOnboarding({ request_id: rid() }, ctx1);
    expect(cancelled.ok).toBe(true);
    await expect(one.getOnboardingState({}, ctx1)).rejects.toMatchObject({
      code: "SESSION_CANCELLED",
    });
    const write = await one.updateProfile(
      { request_id: rid(), profile: COMPLETE },
      ctx1,
    );
    expect(write.error?.code).toBe("SESSION_CANCELLED");
  });

  it("never echoes internals in a state payload", async () => {
    const service = createFixtureOnboarding().onboarding;
    await service.startOnboarding({ request_id: rid() });
    const serialized = JSON.stringify(await service.getOnboardingState({}));
    expect(serialized).not.toContain("session_token");
    expect(serialized).not.toContain("token_fingerprint");
    expect(serialized).not.toContain("owner_subject");
    expect(serialized).not.toContain("onb-");
  });
});

/* ------------------------------------------------------------- persistence */

describe("the in-memory repository", () => {
  it("round-trips a session", async () => {
    const repository = new InMemoryOnboardingRepository();
    const stored = await repository.createSession(record("onb-1"));
    const read = await repository.getSession("onb-1");
    expect(read?.session.onboarding_session_id).toBe("onb-1");
    expect(read?.session.revision).toBe(stored.session.revision);
  });

  it("refuses a duplicate session id", async () => {
    const repository = new InMemoryOnboardingRepository();
    await repository.createSession(record("onb-1"));
    await expect(repository.createSession(record("onb-1"))).rejects.toThrow(
      RepositoryConflictError,
    );
  });

  it("refuses a write built on a stale revision", async () => {
    const repository = new InMemoryOnboardingRepository();
    const stored = await repository.createSession(record("onb-1"));
    const next = {
      ...stored,
      session: { ...stored.session, revision: stored.session.revision + 1 },
    };
    await repository.updateSession(next, stored.session.revision);
    // A second write claiming the original revision must not overwrite.
    await expect(
      repository.updateSession(next, stored.session.revision),
    ).rejects.toThrow(RepositoryConflictError);
  });

  it("refuses to swap the credential of an existing session", async () => {
    const repository = new InMemoryOnboardingRepository();
    const stored = await repository.createSession(record("onb-1"));
    const hijacked = {
      ...stored,
      token_fingerprint: fingerprintToken(createSessionToken()),
    };
    // Session fixation: replacing the secret on a live session is refused.
    await expect(
      repository.updateSession(hijacked, stored.session.revision),
    ).rejects.toThrow(RepositoryConflictError);
  });

  it("refuses to change the owner of an existing session", async () => {
    const repository = new InMemoryOnboardingRepository();
    const stored = await repository.createSession(record("onb-1"));
    await expect(
      repository.updateSession(
        { ...stored, owner_subject: "attacker" },
        stored.session.revision,
      ),
    ).rejects.toThrow(RepositoryConflictError);
  });

  it("expires a session idempotently", async () => {
    const repository = new InMemoryOnboardingRepository();
    await repository.createSession(record("onb-1"));
    const first = await repository.expireSession("onb-1");
    expect(first?.session.status).toBe("EXPIRED");
    const second = await repository.expireSession("onb-1");
    expect(second?.session.status).toBe("EXPIRED");
    expect(await repository.expireSession("onb-missing")).toBeUndefined();
  });

  it("serialises concurrent updates instead of interleaving them", async () => {
    const repository = new InMemoryOnboardingRepository();
    const stored = await repository.createSession(record("onb-1"));
    const bump = (revision: number) => ({
      ...stored,
      session: { ...stored.session, revision },
    });
    // Both claim the same base revision; exactly one may win.
    const results = await Promise.allSettled([
      repository.updateSession(bump(2), 1),
      repository.updateSession(bump(2), 1),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((r) => r.status === "rejected")).toHaveLength(1);
  });
});

describe("retention", () => {
  it("keeps a session inside its retention window", async () => {
    const repository = new InMemoryOnboardingRepository();
    await repository.createSession(
      record("onb-1", { expiresAt: "2026-05-02T10:00:00Z" }),
    );
    const purged = await repository.purge(new Date("2026-05-03T10:00:00Z"));
    expect(purged).toBe(0);
    expect(await repository.getSession("onb-1")).toBeTruthy();
  });

  it("collects a session once the window has passed", async () => {
    const repository = new InMemoryOnboardingRepository();
    const expiresAt = "2026-05-02T10:00:00Z";
    await repository.createSession(record("onb-1", { expiresAt }));
    const after = new Date(
      Date.parse(expiresAt) + ONBOARDING_RETENTION_MS + 1000,
    );
    expect(await repository.purge(after)).toBe(1);
    expect(await repository.getSession("onb-1")).toBeUndefined();
  });

  it("does not let abandoned setups pile up", async () => {
    const repository = new InMemoryOnboardingRepository();
    for (let index = 0; index < 5; index++)
      await repository.createSession(
        record(`onb-${index}`, { expiresAt: "2026-05-02T10:00:00Z" }),
      );
    expect(repository.size).toBe(5);
    await repository.purge(
      new Date(
        Date.parse("2026-05-02T10:00:00Z") + ONBOARDING_RETENTION_MS + 1,
      ),
    );
    expect(repository.size).toBe(0);
  });

  it("recognises an expired session by its timestamp", () => {
    const stored = record("onb-1", { expiresAt: "2026-05-02T10:00:00Z" });
    expect(isExpired(stored.session, new Date("2026-05-01T10:00:00Z"))).toBe(
      false,
    );
    expect(isExpired(stored.session, new Date("2026-05-03T10:00:00Z"))).toBe(
      true,
    );
  });
});

describe("a restarted server", () => {
  // A new runtime over the same session store stands in for a restarted
  // process; in production that store is Postgres (src/server/db).
  it("resumes a setup with the answers already given", async () => {
    const repository = new InMemoryOnboardingRepository();
    const first = createFixtureOnboarding({ repository });
    const started = await first.onboarding.startOnboarding({
      request_id: rid(),
    });
    const claim = {};
    await first.onboarding.updateProfile({
      request_id: rid(),
      ...claim,
      profile: COMPLETE,
    });

    const second = createFixtureOnboarding({ repository });
    const resumed = await second.onboarding.getOnboardingState(claim);
    expect(resumed.session.profile.training.days_per_week).toBe(3);
    expect(resumed.session.profile.training.primary_goal).toBe("muscle_gain");
    expect(resumed.progress.profile_complete).toBe(true);
    // Never promised across devices without a verified identity.
    expect(resumed.resume.cross_device).toBe(false);
  });

  it("finds nothing for another subject on the same store", async () => {
    const repository = new InMemoryOnboardingRepository();
    const first = createFixtureOnboarding({ repository });
    await first.onboarding.startOnboarding({ request_id: rid() });

    const second = createFixtureOnboarding({
      repository,
      access: new FixtureOnboardingAccessControl("another-synthetic-subject"),
    });
    await expect(
      second.onboarding.getOnboardingState({}),
    ).rejects.toMatchObject({ code: "SESSION_NOT_FOUND" });
  });

  it("stores only a fingerprint and hands out no secret", async () => {
    const repository = new InMemoryOnboardingRepository();
    const runtime = createFixtureOnboarding({ repository });
    const started = await runtime.onboarding.startOnboarding({
      request_id: rid(),
    });
    expect(JSON.stringify(started)).not.toContain("token");
    const stored = await repository.findLatestByOwner(
      "synthetic-onboarding-fixture",
    );
    expect(stored!.token_fingerprint).toHaveLength(64);
  });
});
