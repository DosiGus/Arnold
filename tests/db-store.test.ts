/**
 * The Postgres store: every value reads back unchanged, a write is all or
 * nothing, a repeated request is replayed instead of written twice, and
 * concurrent writers (also from two server instances) never collide.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import type { Database } from "../src/server/db/database";
import { PostgresArnoldStore } from "../src/server/db/store";
import { PostgresOnboardingRepository } from "../src/server/db/onboarding";
import { OnboardingService } from "../src/server/onboarding/service";
import { AuthenticatedOnboardingAccessControl } from "../src/server/onboarding/access";
import { MAX_EXTRA_TOKENS } from "../src/server/onboarding/repository";
import type { AuditEvent } from "../src/server/workout/infrastructure";
import { canonical } from "../src/server/workout/infrastructure";
import { ArnoldDatasetSchema } from "../src/shared/arnold-schema-v1";
import { WorkoutLoggingService } from "../src/server/workout/service";
import { fullDataset } from "./fixtures/arnold-dashboard";
import {
  appDatabase,
  asOwner,
  benchSet,
  logOneSet,
  newAccount,
} from "./fixtures/arnold-db";

let db: Database;
beforeAll(() => {
  db = appDatabase(10);
});
afterAll(() => db.close());

const emptyResult = { workout: null, sets: [], exercise: null, warnings: [] };

describe("PostgresArnoldStore", () => {
  it("reads every table back exactly as written, in write order", async () => {
    const account = await newAccount(db);
    const source = fullDataset();
    // Replace the account's starter catalog by the fixture: a fresh store.
    const store = new PostgresArnoldStore(
      db,
      account.userId,
      account.trackerId,
    );
    const before = await store.read();
    const rows = {
      exercises: source.exercises.filter(
        (e) => !before.exercises.some((b) => b.exercise_id === e.exercise_id),
      ),
      plans: source.plans,
      planItems: source.planItems,
      workouts: source.workouts,
      sets: source.sets,
    };
    await store.write((tx) =>
      tx.commit({
        requestId: randomUUID(),
        fingerprint: "import",
        actor: account.userId,
        changes: (Object.keys(rows) as (keyof typeof rows)[]).flatMap(
          (table) =>
            rows[table].map((after) => ({ table, before: null, after })) as {
              table: typeof table;
              before: null;
              after: never;
            }[],
        ),
        audit: [],
        result: emptyResult,
      }),
    );
    const after = await store.read();
    expect(ArnoldDatasetSchema.safeParse(after).success).toBe(true);
    for (const table of ["plans", "planItems", "workouts", "sets"] as const)
      expect(canonical(after[table]), table).toBe(canonical(source[table]));
    expect(canonical(after.exercises)).toBe(
      canonical([...before.exercises, ...rows.exercises]),
    );
    expect(after.config.tracker_id).toBe(account.trackerId);
  });

  it("stores nothing of a write that fails halfway", async () => {
    const account = await newAccount(db);
    const workout = {
      workout_id: "half-written",
      workout_date_local: "2026-10-29",
      timezone: "Europe/Berlin",
      started_at_utc: null,
      ended_at_utc: null,
      plan_version_id: null,
      session_id: null,
      session_name_snapshot: null,
      status: "in_progress" as const,
      source: "chat" as const,
      notes: null,
      created_at_utc: "2026-10-29T10:00:00Z",
      updated_at_utc: "2026-10-29T10:00:00Z",
      row_revision: 1,
    };
    // The set points at an exercise that does not exist: the whole
    // transaction is rolled back, including the workout and the receipt.
    const requestId = randomUUID();
    await expect(
      account.store.write((tx) =>
        tx.commit({
          requestId,
          fingerprint: "x",
          actor: account.userId,
          changes: [
            { table: "workouts", before: null, after: workout },
            {
              table: "sets",
              before: null,
              after: {
                set_id: "orphan",
                workout_id: workout.workout_id,
                exercise_id: "does-not-exist",
                plan_item_id: null,
                exercise_name_snapshot: "Gibt es nicht",
                exercise_order: 1,
                set_number: 1,
                set_type: "working",
                reps: 5,
                reps_basis: "total",
                load_kg: 50,
                load_basis: "total",
                implement_count: 1,
                execution_mode: "bilateral_simultaneous",
                side: "both",
                rpe: null,
                rir: null,
                notes: null,
                status: "active",
                source: "chat",
                created_at_utc: "2026-10-29T10:00:00Z",
                updated_at_utc: "2026-10-29T10:00:00Z",
                row_revision: 1,
              },
            },
          ],
          audit: [],
          result: emptyResult,
        }),
      ),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    const data = await account.store.read();
    expect(data.workouts).toEqual([]);
    expect(
      await account.store.write((tx) => tx.operation(requestId)),
    ).toBeUndefined();
  });

  it("refuses a change built on an outdated revision and keeps the stored row", async () => {
    const account = await newAccount(db);
    await logOneSet(account);
    const [set] = (await account.store.read()).sets;
    const stale = { ...set, row_revision: set.row_revision };
    const next = { ...set, reps: 12, row_revision: set.row_revision + 1 };
    await account.store.write((tx) =>
      tx.commit({
        requestId: randomUUID(),
        fingerprint: "a",
        actor: account.userId,
        changes: [{ table: "sets", before: stale, after: next }],
        audit: [],
        result: emptyResult,
      }),
    );
    await expect(
      account.store.write((tx) =>
        tx.commit({
          requestId: randomUUID(),
          fingerprint: "b",
          actor: account.userId,
          changes: [
            { table: "sets", before: stale, after: { ...next, reps: 3 } },
          ],
          audit: [],
          result: emptyResult,
        }),
      ),
    ).rejects.toMatchObject({ code: "REVISION_CONFLICT" });
    expect((await account.store.read()).sets[0].reps).toBe(12);
  });

  it("replays a repeated request instead of writing twice", async () => {
    const account = await newAccount(db);
    const started = await account.logging.execute("start_workout", {
      request_id: randomUUID(),
      workout_date_local: "2026-10-29",
      timezone: "Europe/Berlin",
      session_name: "Brust",
    });
    const input = {
      request_id: randomUUID(),
      workout_id: started.result!.workout!.workout_id,
      sets: [benchSet],
    };
    const first = await account.logging.execute("log_workout_sets", input);
    const second = await account.logging.execute("log_workout_sets", input);
    expect(first.ok && !first.replayed).toBe(true);
    expect(second.ok && second.replayed).toBe(true);
    expect(second.result).toEqual(first.result);
    expect((await account.store.read()).sets).toHaveLength(1);
    // The same id with a different payload is refused, not replayed.
    const reused = await account.logging.execute("log_workout_sets", {
      ...input,
      sets: [{ ...benchSet, reps: 3 }],
    });
    expect(reused.error?.code).toBe("DUPLICATE_OPERATION");
  });

  it("serialises concurrent writers, also across two server instances", async () => {
    const account = await newAccount(db);
    const second = appDatabase(10);
    try {
      const other = new WorkoutLoggingService({
        mode: "database",
        trackerId: account.trackerId,
        store: new PostgresArnoldStore(
          second,
          account.userId,
          account.trackerId,
        ),
        authorization: {
          authorize: async () => ({
            subject: account.userId,
            trackerId: account.trackerId,
            verified: true,
            kind: "authenticated",
            permissions: ["write", "correct_completed"],
          }),
        },
      });
      const started = await account.logging.execute("start_workout", {
        request_id: randomUUID(),
        workout_date_local: "2026-10-29",
        timezone: "Europe/Berlin",
        session_name: "Brust",
      });
      const workout_id = started.result!.workout!.workout_id;
      const results = await Promise.all(
        Array.from({ length: 12 }, (_, i) =>
          (i % 2 ? other : account.logging).execute("log_workout_sets", {
            request_id: randomUUID(),
            workout_id,
            sets: [{ ...benchSet, load_kg: 40 + i }],
          }),
        ),
      );
      expect(results.filter((r) => !r.ok).map((r) => r.error)).toEqual([]);
      const sets = (await account.store.read()).sets;
      expect(sets).toHaveLength(12);
      expect(new Set(sets.map((s) => s.set_number)).size).toBe(12);
    } finally {
      await second.close();
    }
  });

  it("stores data, audit events and receipt together", async () => {
    const account = await newAccount(db);
    await logOneSet(account);
    const totals = await asOwner(async (c) => {
      const n = async (table: string) =>
        (
          await c.query<{ n: number }>(
            `select count(*)::int as n from arnold.${table} where user_id = $1`,
            [account.userId],
          )
        ).rows[0].n;
      return {
        // starter catalog + start + log
        operations: await n("operations"),
        audit: await n("audit_events"),
      };
    });
    expect(totals.operations).toBe(3);
    expect(totals.audit).toBe(2);
  });

  it("logs a set in well under a second", async () => {
    const account = await newAccount(db);
    const started = await account.logging.execute("start_workout", {
      request_id: randomUUID(),
      workout_date_local: "2026-10-29",
      timezone: "Europe/Berlin",
      session_name: "Brust",
    });
    const begin = performance.now();
    const logged = await account.logging.execute("log_workout_sets", {
      request_id: randomUUID(),
      workout_id: started.result!.workout!.workout_id,
      sets: [benchSet],
    });
    expect(logged.ok).toBe(true);
    // Local database; this guards against accidentally reintroducing a
    // read-heavy write path, not against network latency.
    expect(performance.now() - begin).toBeLessThan(500);
  });
});

describe("retention", () => {
  it("prunes old receipts and abandoned setups, never training data or completed setups", async () => {
    const account = await newAccount(db);
    await logOneSet(account);
    await asOwner(async (c) => {
      await c.query(
        "update arnold.operations set recorded_at = now() - interval '40 days' where user_id = $1",
        [account.userId],
      );
      await c.query(
        "update arnold.audit_events set recorded_at = now() - interval '40 days' where user_id = $1",
        [account.userId],
      );
      const record = (status: string, id: string) => [
        account.userId,
        id,
        account.userId,
        status,
        0,
        new Date(Date.now() - 40 * 86_400_000),
        new Date(Date.now() - 41 * 86_400_000),
        "{}",
      ];
      for (const [status, id] of [
        ["COMPLETED", "done"],
        ["COLLECTING_PROFILE", "abandoned"],
      ])
        await c.query(
          `insert into arnold.onboarding_sessions (user_id, onboarding_session_id, owner_subject, status, revision, expires_at, updated_at, record)
           values ($1, $2, $3, $4, $5, $6, $7, $8)`,
          record(status, id),
        );
    });
    const pruned = (
      await db.query<{ operations: string; onboarding_sessions: string }>(
        "select * from arnold.prune(30)",
      )
    ).rows[0];
    expect(Number(pruned.operations)).toBeGreaterThanOrEqual(3);
    const left = await asOwner(async (c) =>
      (
        await c.query<{ onboarding_session_id: string }>(
          "select onboarding_session_id from arnold.onboarding_sessions where user_id = $1",
          [account.userId],
        )
      ).rows.map((r) => r.onboarding_session_id),
    );
    expect(left).toEqual(["done"]);
    expect((await account.store.read()).sets).toHaveLength(1);
  });
});

describe("PostgresOnboardingRepository", () => {
  async function openSetup() {
    const account = await newAccount(db);
    const repository = new PostgresOnboardingRepository(db, account.userId);
    const service = new OnboardingService({
      trackerId: account.trackerId,
      repository,
      access: new AuthenticatedOnboardingAccessControl(account.userId),
      read: () => account.store.read(),
      audit: account.store.audit,
    });
    const opened = await service.openOnboarding({ userId: account.userId });
    expect(opened.state.session.status).toBe("COLLECTING_PROFILE");
    const record = (await repository.findLatestByOwner(account.userId))!;
    return { account, repository, record };
  }

  it("stores a setup step and its audit events together or not at all", async () => {
    const { account, repository, record } = await openSetup();
    const next = {
      ...record,
      session: { ...record.session, revision: record.session.revision + 1 },
    };
    // An event the database refuses (no entity) stands for an audit write
    // that fails after the session row was already updated.
    const broken = {
      operation_id: "op-broken",
      event_type: "ONBOARDING_PROFILE_UPDATED",
      entity_id: null,
    } as unknown as AuditEvent;
    await expect(
      repository.updateSession(next, record.session.revision, [broken]),
    ).rejects.toThrow();
    expect(
      (await repository.getSession(record.session.onboarding_session_id))!
        .session.revision,
    ).toBe(record.session.revision);

    const ok = {
      ...broken,
      operation_id: "op-ok",
      entity_id: record.session.onboarding_session_id,
    } as AuditEvent;
    await repository.updateSession(next, record.session.revision, [ok]);
    const audited = await asOwner(
      async (c) =>
        (
          await c.query<{ n: number }>(
            "select count(*)::int as n from arnold.audit_events where user_id = $1 and operation_id = 'op-ok'",
            [account.userId],
          )
        ).rows[0].n,
    );
    expect(audited).toBe(1);
  });

  it("adds secrets without replacing the first, and a write cannot drop one", async () => {
    const { repository, record } = await openSetup();
    const id = record.session.onboarding_session_id;
    for (let i = 0; i < MAX_EXTRA_TOKENS + 2; i++)
      await repository.addToken(id, String(i).padStart(64, "a"));
    const withTokens = (await repository.getSession(id))!;
    expect(withTokens.token_fingerprint).toBe(record.token_fingerprint);
    expect(withTokens.extra_token_fingerprints).toHaveLength(MAX_EXTRA_TOKENS);
    expect(withTokens.session.revision).toBe(record.session.revision);

    // A write built on the read from before the new secrets keeps them.
    const stored = await repository.updateSession(
      {
        ...record,
        session: { ...record.session, revision: record.session.revision + 1 },
      },
      record.session.revision,
    );
    expect(stored.extra_token_fingerprints).toEqual(
      withTokens.extra_token_fingerprints,
    );
  });
});
