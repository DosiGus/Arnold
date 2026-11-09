/**
 * Device status, unpairing and health data from the watch (UMSETZUNG §3.4,
 * §4.3; 07 D-03).
 *
 * Health data is stored only with the account's active consent; the check
 * and the write run in one transaction that holds the consent row, so a
 * revocation cannot slip in between (fail closed). A heart rate of 0 means
 * "no measurement" and is stored as a gap (null), never as a value. The
 * measurements belong to the workout's client session; until the workout has
 * arrived the answer is WORKOUT_PENDING and the watch tries again later.
 */
import { z } from "zod";
import {
  WatchDeviceDeleteResponseSchema,
  WatchDeviceResponseSchema,
  WatchHealthRequestSchema,
  WatchHealthResponseSchema,
} from "../../shared/watch-contract.js";
import type { DatabaseArnoldRuntime } from "../db/runtime.js";
import {
  WatchApiError,
  watchEnvelope,
  type WatchCall,
  type WatchRoute,
} from "./router.js";

export const HEALTH_SCOPE = "garmin_health";

const utc = (d: Date) => d.toISOString().replace(/\.\d{3}Z$/, "Z");

async function device(runtime: DatabaseArnoldRuntime, call: WatchCall) {
  const { context, deviceId } = call.principal!;
  const consent = await runtime.options.db.asUser(
    context.userId,
    async (c) =>
      (
        await c.query(
          `select 1 from arnold.health_consents
          where user_id = $1 and scope = $2 and revoked_at is null`,
          [context.userId, HEALTH_SCOPE],
        )
      ).rowCount === 1,
  );
  return {
    body: WatchDeviceResponseSchema.parse({
      ...watchEnvelope(),
      device_id: deviceId,
      paired: true,
      health_consent: consent,
      server_time_utc: utc(new Date()),
    }),
  };
}

async function unpair(runtime: DatabaseArnoldRuntime, call: WatchCall) {
  const { context, deviceId } = call.principal!;
  await runtime.options.db.asUser(context.userId, (c) =>
    c.query(
      `update arnold.watch_devices set status = 'revoked', revoked_at = now()
        where user_id = $1 and device_id = $2 and status = 'active'`,
      [context.userId, deviceId],
    ),
  );
  return {
    body: WatchDeviceDeleteResponseSchema.parse({
      ...watchEnvelope(),
      unpaired: true,
    }),
  };
}

const SessionUuid = z.uuid();

async function storeHealth(runtime: DatabaseArnoldRuntime, call: WatchCall) {
  const session = SessionUuid.safeParse(call.params.session_uuid);
  const parsed = WatchHealthRequestSchema.safeParse(call.body);
  if (!session.success || !parsed.success)
    throw new WatchApiError("VALIDATION_ERROR", 422);
  const { context } = call.principal!;
  const body = parsed.data;
  // 0 is "no measurement": a gap, never a value.
  const hr = body.hr
    ? { ...body.hr, values: body.hr.values.map((v) => (v === 0 ? null : v)) }
    : null;
  const outcome = await runtime.options.db.asUser(context.userId, async (c) => {
    // Holding the consent row: a revocation waits until this is done.
    const consent = await c.query(
      `select 1 from arnold.health_consents
          where user_id = $1 and scope = $2 and revoked_at is null for share`,
      [context.userId, HEALTH_SCOPE],
    );
    if (consent.rowCount !== 1) return "consent" as const;
    const recording = await c.query(
      `select 1 from arnold.workout_recordings
          where user_id = $1 and client_session_id = $2`,
      [context.userId, session.data],
    );
    if (recording.rowCount !== 1) return "pending" as const;
    await c.query(
      `insert into arnold.workout_health
           (user_id, client_session_id, hr, calories_kcal, before, after, extras, received_at)
         values ($1, $2, $3, $4, $5, $6, $7, now())
         on conflict (user_id, client_session_id) do update set
           hr = excluded.hr, calories_kcal = excluded.calories_kcal,
           before = excluded.before, after = excluded.after,
           extras = excluded.extras, received_at = excluded.received_at`,
      [
        context.userId,
        session.data,
        hr === null ? null : JSON.stringify(hr),
        body.calories_kcal ?? null,
        body.before ? JSON.stringify(body.before) : null,
        body.after ? JSON.stringify(body.after) : null,
        body.extras ? JSON.stringify(body.extras) : null,
      ],
    );
    return "stored" as const;
  });
  if (outcome === "consent") throw new WatchApiError("CONSENT_REQUIRED", 403);
  if (outcome === "pending")
    throw new WatchApiError("WORKOUT_PENDING", 409, true);
  return {
    body: WatchHealthResponseSchema.parse({
      ...watchEnvelope(),
      session_uuid: session.data,
      stored: true,
    }),
  };
}

export function healthRoutes(runtime: DatabaseArnoldRuntime): WatchRoute[] {
  return [
    {
      method: "GET",
      path: "/device",
      handler: (call) => device(runtime, call),
    },
    {
      method: "DELETE",
      path: "/device",
      handler: (call) => unpair(runtime, call),
    },
    {
      method: "PUT",
      path: "/workouts/:session_uuid/health",
      handler: (call) => storeHealth(runtime, call),
    },
  ];
}
