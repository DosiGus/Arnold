/**
 * Helpers for tests against the real test Postgres (tests/setup/postgres.ts).
 * Every helper creates fresh, random users, so tests never share data.
 */
import { randomUUID } from "node:crypto";
import pg from "pg";
import { inject } from "vitest";
import { Database } from "../../src/server/db/database";
import { PostgresIdentityRepository } from "../../src/server/db/identity";
import { PostgresArnoldStore } from "../../src/server/db/store";
import { ensureStarterCatalog } from "../../src/server/db/runtime";
import { WorkoutLoggingService } from "../../src/server/workout/service";
import { TrainingPlanService } from "../../src/server/plan/service";
import type { AuthorizationGuard } from "../../src/server/workout/infrastructure";

export const TEST_ISSUER = "https://issuer.arnold.test/";

export function appDatabase(maxConnections = 5) {
  return new Database({ url: inject("databaseUrl"), maxConnections });
}

/** The owner connection; bypasses row level security. For inspection only. */
export async function asOwner<T>(work: (client: pg.Client) => Promise<T>) {
  const client = new pg.Client({
    connectionString: inject("databaseAdminUrl"),
  });
  await client.connect();
  try {
    return await work(client);
  } finally {
    await client.end();
  }
}

/** A fresh account with the starter catalog, and services acting for it. */
export async function newAccount(db: Database) {
  const identities = new PostgresIdentityRepository(db);
  const subject = `subject-${randomUUID()}`;
  const { user } = await identities.register(TEST_ISSUER, subject);
  const trackerId = (await identities.trackerId(user.user_id))!;
  const store = new PostgresArnoldStore(db, user.user_id, trackerId);
  await ensureStarterCatalog(store, trackerId, user.user_id);
  const authorization: AuthorizationGuard = {
    authorize: async () => ({
      subject: user.user_id,
      trackerId,
      verified: true,
      kind: "authenticated",
      permissions: ["write", "correct_completed"],
    }),
  };
  return {
    userId: user.user_id,
    subject,
    trackerId,
    store,
    identities,
    logging: new WorkoutLoggingService({
      mode: "database",
      trackerId,
      store,
      authorization,
    }),
    plans: new TrainingPlanService({
      mode: "database",
      trackerId,
      store,
      authorization,
    }),
  };
}

export const benchSet = {
  exercise_id: "bench-press",
  set_type: "working",
  reps: 10,
  reps_basis: "total",
  load_kg: 60,
  load_basis: "total",
  implement_count: 1,
  execution_mode: "bilateral_simultaneous",
  side: "both",
} as const;

/** Starts a workout and logs one set; returns the stored workout id. */
export async function logOneSet(
  account: Awaited<ReturnType<typeof newAccount>>,
  load_kg = 60,
) {
  const started = await account.logging.execute("start_workout", {
    request_id: randomUUID(),
    workout_date_local: "2026-10-29",
    timezone: "Europe/Berlin",
    session_name: "Testeinheit",
  });
  if (!started.ok) throw new Error(started.error!.message);
  const workoutId = started.result!.workout!.workout_id;
  const logged = await account.logging.execute("log_workout_sets", {
    request_id: randomUUID(),
    workout_id: workoutId,
    sets: [{ ...benchSet, load_kg }],
  });
  if (!logged.ok) throw new Error(logged.error!.message);
  return workoutId;
}
