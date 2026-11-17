import { loadAuthConfig } from "./auth/config.js";
import { fetchAuthorizationServerMetadata } from "./auth/discovery.js";
import { buildAuthSurface } from "./auth/router.js";
import { createHttpApp, type ServerOptions } from "./http.js";
import { Database } from "./db/database.js";
import { PostgresIdentityRepository } from "./db/identity.js";
import { DatabaseArnoldRuntime } from "./db/runtime.js";
import { retentionDaysFrom, scheduleRetention } from "./account/retention.js";
import { logServerError } from "./tool-log.js";
import {
  dailyHealthStartMessage,
  describeDailyHealthConfig,
  loadDailyHealthConfig,
} from "./health/config.js";
import { GarminPersonalSource } from "./health/garmin-personal.js";
import { DailyHealthSync } from "./health/sync.js";

/**
 * Builds the app from the environment. Async because the login provider's
 * metadata is fetched, and in the database profile the database is checked
 * before the first request is accepted.
 */
export async function createConfiguredHttpApp(
  options: Pick<ServerOptions, "root" | "host"> = {},
  env: NodeJS.ProcessEnv = process.env,
) {
  const config = loadAuthConfig(env);
  const metadata = config.oidc
    ? await fetchAuthorizationServerMetadata({
        issuer: config.oidc.authorizationServer,
      })
    : undefined;
  if (env.STORAGE_MODE !== "arnold_database") {
    const auth = buildAuthSurface({
      config,
      authorizationServerMetadata: metadata,
    });
    return createHttpApp({ ...options, env, auth });
  }

  // Real accounts: a login is required and the identity store is the
  // database. Anything else stops the start (fail closed).
  if (config.mode !== "oidc" || config.identityStore.kind !== "postgres")
    throw new Error(
      "arnold_database benötigt AUTH_MODE=oidc und IDENTITY_STORE=postgres.",
    );
  if ((env.ARNOLD_WRITE_MODE ?? "disabled") !== "disabled")
    throw new Error(
      "Das Datenbankprofil schaltet Schreibzugriffe pro Nutzer selbst frei. ARNOLD_WRITE_MODE muss disabled bleiben.",
    );
  const db = new Database({
    url: config.identityStore.url,
    maxConnections: databaseConnectionsFrom(env),
    caCert: env.DATABASE_CA_CERT || undefined,
  });
  await db.assertReady();
  const identities = new PostgresIdentityRepository(db);
  const auth = buildAuthSurface({
    config,
    authorizationServerMetadata: metadata,
    repository: identities,
  });
  const retentionDays = retentionDaysFrom(env);
  // Daily health values (UX-015): off unless fully configured; the start
  // message says which, never the key.
  const health = loadDailyHealthConfig(env);
  console.log(dailyHealthStartMessage(health));
  const dailyHealth =
    health.state === "active"
      ? new DailyHealthSync({
          db,
          config: health,
          source: new GarminPersonalSource({ apiKey: health.apiKey }),
        })
      : undefined;
  const runtime = new DatabaseArnoldRuntime({
    db,
    auth,
    identities,
    retentionDays,
    dailyHealth,
    dailyHealthStatus: describeDailyHealthConfig(health),
  });
  scheduleRetention(() =>
    runtime.applyRetention(retentionDays).catch((error: unknown) => {
      logServerError("retention failed", error);
    }),
  );
  return createHttpApp({ ...options, env, auth, database: runtime });
}

/** Connections per instance. Fails closed on anything but a small integer. */
function databaseConnectionsFrom(env: NodeJS.ProcessEnv): number {
  const raw = env.DATABASE_MAX_CONNECTIONS;
  if (raw === undefined || raw === "") return 10;
  const value = Number(raw);
  if (!/^\d+$/.test(raw) || value < 1 || value > 50)
    throw new Error("DATABASE_MAX_CONNECTIONS muss zwischen 1 und 50 liegen.");
  return value;
}
