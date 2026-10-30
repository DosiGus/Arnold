/**
 * Session isolation, credentials, persistence and retention.
 *
 * The rule under test throughout: **a session id submitted by a client is not a
 * permission.** Before Task 007 a setup session is anonymous, so an id alone
 * must be worthless — otherwise anyone who guessed one could read someone
 * else's answers.
 *
 * The persistence tests cover the other half of §11: a setup must survive a
 * server restart to be resumable at all, and an abandoned one must not be kept
 * forever.
 */
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import {
  DenyOnboardingAccessControl,
  FixtureOnboardingAccessControl,
  createSessionToken,
  fingerprintToken,
  oauthStateBinding,
  tokenMatches,
} from "../src/server/onboarding/access";
import {
  FileOnboardingRepository,
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
const temporary: string[] = [];

afterEach(async () => {
  for (const path of temporary.splice(0))
    await rm(path, { recursive: true, force: true });
});

async function tempDir() {
  const dir = await mkdtemp(join(tmpdir(), "arnold-onb-"));
  temporary.push(dir);
  return dir;
}

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

  it("match only the token they were derived from", () => {
    const token = createSessionToken();
    const stored = fingerprintToken(token);
    expect(tokenMatches(stored, token)).toBe(true);
    expect(tokenMatches(stored, createSessionToken())).toBe(false);
    expect(tokenMatches(stored, "")).toBe(false);
    expect(tokenMatches(stored, `${token}x`)).toBe(false);
  });
});

describe("the fixture access guard", () => {
  const guard = new FixtureOnboardingAccessControl();

  it("accepts the right token", async () => {
    const token = createSessionToken();
    const principal = await guard.authorize(
      record("onb-1", { token }),
      token,
      undefined,
    );
    expect(principal.verified).toBe(true);
    expect(principal.kind).toBe("fixture");
  });

  it("refuses a wrong or absent token", async () => {
    const stored = record("onb-1");
    await expect(
      guard.authorize(stored, createSessionToken(), undefined),
    ).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
    await expect(guard.authorize(stored, "", undefined)).rejects.toMatchObject({
      code: "AUTH_REQUIRED",
    });
  });

  it("refuses a session owned by another subject", async () => {
    const token = createSessionToken();
    const foreign = {
      ...record("onb-1", { token }),
      owner_subject: "someone-else",
    };
    await expect(
      guard.authorize(foreign, token, undefined),
    ).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
  });
});

describe("the production guard", () => {
  it("refuses everything until Task 007", async () => {
    const guard = new DenyOnboardingAccessControl();
    expect(guard.mode).toBe("production");
    await expect(guard.establish(undefined)).rejects.toMatchObject({
      code: "AUTH_REQUIRED",
    });
    const token = createSessionToken();
    await expect(
      guard.authorize(record("onb-1", { token }), token, undefined),
    ).rejects.toMatchObject({ code: "AUTH_REQUIRED" });
  });
});

/* -------------------------------------------------------------- isolation */

describe("two separate setups", () => {
  it("cannot read each other even with a known id", async () => {
    const runtime = createFixtureOnboarding();
    const service = runtime.onboarding;

    const a = await service.startOnboarding({ request_id: rid() });
    const b = await service.startOnboarding({ request_id: rid() });
    const claimA = {
      onboarding_session_id: a.state!.session.onboarding_session_id,
      session_token: a.session_token!,
    };
    const claimB = {
      onboarding_session_id: b.state!.session.onboarding_session_id,
      session_token: b.session_token!,
    };
    expect(claimA.onboarding_session_id).not.toBe(claimB.onboarding_session_id);
    expect(claimA.session_token).not.toBe(claimB.session_token);

    // The id of A with the token of B: refused. The bare id is worthless.
    await expect(
      service.getOnboardingState({
        onboarding_session_id: claimA.onboarding_session_id,
        session_token: claimB.session_token,
      }),
    ).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
  });

  it("keeps their answers apart", async () => {
    const service = createFixtureOnboarding().onboarding;
    const a = await service.startOnboarding({ request_id: rid() });
    const b = await service.startOnboarding({ request_id: rid() });
    const claimA = {
      onboarding_session_id: a.state!.session.onboarding_session_id,
      session_token: a.session_token!,
    };
    const claimB = {
      onboarding_session_id: b.state!.session.onboarding_session_id,
      session_token: b.session_token!,
    };

    await service.updateProfile({
      request_id: rid(),
      ...claimA,
      profile: { ...COMPLETE, training: { ...TRAINING, days_per_week: 3 } },
    });
    await service.updateProfile({
      request_id: rid(),
      ...claimB,
      profile: {
        ...COMPLETE,
        training: { ...TRAINING, days_per_week: 6, primary_goal: "strength" },
      },
    });

    const stateA = await service.getOnboardingState(claimA);
    const stateB = await service.getOnboardingState(claimB);
    expect(stateA.session.profile.training.days_per_week).toBe(3);
    expect(stateA.session.profile.training.primary_goal).toBe("muscle_gain");
    expect(stateB.session.profile.training.days_per_week).toBe(6);
    expect(stateB.session.profile.training.primary_goal).toBe("strength");
  });

  it("keeps their plan drafts apart", async () => {
    const runtime = createFixtureOnboarding();
    const service = runtime.onboarding;
    const claims = [];
    for (const _ of [0, 1]) {
      const started = await service.startOnboarding({ request_id: rid() });
      const claim = {
        onboarding_session_id: started.state!.session.onboarding_session_id,
        session_token: started.session_token!,
      };
      await service.updateProfile({
        request_id: rid(),
        ...claim,
        profile: COMPLETE,
      });
      await service.requestPlanProposal({ request_id: rid(), ...claim });
      const brief = await service.getBrief(claim);
      await service.submitPlanProposal({
        request_id: rid(),
        ...claim,
        name: `Plan ${claims.length + 1}`,
        origin: "ai_proposal",
        sessions: [
          {
            session_name: "Ganzkörper",
            exercises: [{ exercise_id: brief.exercise_catalog[0].exercise_id }],
          },
        ],
      });
      claims.push(claim);
    }
    const first = await service.getOnboardingState(claims[0]);
    const second = await service.getOnboardingState(claims[1]);
    expect(first.plan!.plan_version_id).not.toBe(second.plan!.plan_version_id);
    expect(first.plan!.name).toBe("Plan 1");
    expect(second.plan!.name).toBe("Plan 2");
  });

  it("refuses an unknown session reference", async () => {
    const service = createFixtureOnboarding().onboarding;
    await expect(
      service.getOnboardingState({
        onboarding_session_id: "onb-made-up",
        session_token: createSessionToken(),
      }),
    ).rejects.toMatchObject({ code: "SESSION_NOT_FOUND" });
  });

  it("never echoes the session secret in a state payload", async () => {
    const service = createFixtureOnboarding().onboarding;
    const started = await service.startOnboarding({ request_id: rid() });
    const claim = {
      onboarding_session_id: started.state!.session.onboarding_session_id,
      session_token: started.session_token!,
    };
    const state = await service.getOnboardingState(claim);
    const serialized = JSON.stringify(state);
    expect(serialized).not.toContain(claim.session_token);
    expect(serialized).not.toContain("token_fingerprint");
    expect(serialized).not.toContain("owner_subject");
  });

  it("hands out the secret exactly once, on creation", async () => {
    const service = createFixtureOnboarding().onboarding;
    const started = await service.startOnboarding({ request_id: rid() });
    const claim = {
      onboarding_session_id: started.state!.session.onboarding_session_id,
      session_token: started.session_token!,
    };
    expect(started.session_token).toBeTruthy();
    const update = await service.updateProfile({
      request_id: rid(),
      ...claim,
      profile: { training: { days_per_week: 3 } },
    });
    expect(update.session_token).toBeNull();
    const resumed = await service.startOnboarding({
      request_id: rid(),
      resume_session: claim,
    });
    expect(resumed.session_token).toBeNull();
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

describe("the file repository", () => {
  it("reports local durability", async () => {
    const path = join(await tempDir(), "sessions.json");
    expect(new FileOnboardingRepository(path).durability).toBe("local");
  });

  it("survives a new repository instance over the same file", async () => {
    const path = join(await tempDir(), "sessions.json");
    const first = new FileOnboardingRepository(path);
    await first.createSession(record("onb-1"));

    // A new instance stands in for a restarted server process.
    const second = new FileOnboardingRepository(path);
    const read = await second.getSession("onb-1");
    expect(read?.session.onboarding_session_id).toBe("onb-1");
  });

  it("resumes a setup after a simulated server restart", async () => {
    const path = join(await tempDir(), "sessions.json");
    const first = createFixtureOnboarding({ storeFile: path });
    const started = await first.onboarding.startOnboarding({
      request_id: rid(),
    });
    const claim = {
      onboarding_session_id: started.state!.session.onboarding_session_id,
      session_token: started.session_token!,
    };
    await first.onboarding.updateProfile({
      request_id: rid(),
      ...claim,
      profile: COMPLETE,
    });

    // A brand-new runtime over the same journal: the answers are still there.
    const second = createFixtureOnboarding({ storeFile: path });
    const resumed = await second.onboarding.getOnboardingState(claim);
    expect(resumed.session.profile.training.days_per_week).toBe(3);
    expect(resumed.session.profile.training.primary_goal).toBe("muscle_gain");
    expect(resumed.progress.profile_complete).toBe(true);
    expect(resumed.resume.durable).toBe(true);
    // Still never promised across devices: that needs a verified identity.
    expect(resumed.resume.cross_device).toBe(false);
  });

  it("still refuses a wrong token after a restart", async () => {
    const path = join(await tempDir(), "sessions.json");
    const first = createFixtureOnboarding({ storeFile: path });
    const started = await first.onboarding.startOnboarding({
      request_id: rid(),
    });
    const id = started.state!.session.onboarding_session_id;

    const second = createFixtureOnboarding({ storeFile: path });
    await expect(
      second.onboarding.getOnboardingState({
        onboarding_session_id: id,
        session_token: createSessionToken(),
      }),
    ).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
  });

  it("writes no plaintext secret to disk", async () => {
    const path = join(await tempDir(), "sessions.json");
    const runtime = createFixtureOnboarding({ storeFile: path });
    const started = await runtime.onboarding.startOnboarding({
      request_id: rid(),
    });
    const token = started.session_token!;
    const contents = await readFile(path, "utf8");
    expect(contents).not.toContain(token);
    expect(contents).toContain("token_fingerprint");
  });
});

/* ---------------------------------------------------------- oauth binding */

describe("the OAuth state binding", () => {
  it("is stable for one confirmed revision and differs across revisions", () => {
    const stored = record("onb-1");
    const first = oauthStateBinding(stored, 1);
    expect(oauthStateBinding(stored, 1)).toBe(first);
    expect(oauthStateBinding(stored, 2)).not.toBe(first);
  });

  it("differs between two sessions", () => {
    expect(oauthStateBinding(record("onb-1"), 1)).not.toBe(
      oauthStateBinding(record("onb-2"), 1),
    );
  });

  it("does not reveal the session secret", () => {
    const token = createSessionToken();
    const stored = record("onb-1", { token });
    const binding = oauthStateBinding(stored, 1);
    expect(binding).toHaveLength(64);
    expect(binding).not.toContain(token);
    expect(binding).not.toContain(stored.token_fingerprint);
  });
});
