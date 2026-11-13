/**
 * Runs on the watch (RUN-009, spec "Uhr-Schnittstelle"): what is planned
 * (`GET /runs/upcoming`, `GET /runs/:id`), the result of a finished run
 * (`POST /runs`) and the effort sent afterwards (`PATCH /runs/:session_uuid/rpe`).
 *
 * The routes only translate: the run service decides (one write through
 * commitWrite, heart rate only with the health consent, replay by request_id).
 * The user comes from the checked token, the time zone from the paired
 * device. Heart-rate zone bounds are stored here after the result, only with
 * the consent, in the same kind of transaction as the health upload. Logs and
 * error reasons carry field paths and codes, never values.
 */
import { z } from "zod";
import {
  RUN_WATCH_BUDGET_BYTES,
  RunIdSchema,
  WatchRunRequestSchema,
  WatchRunRpeRequestSchema,
  jsonBytes,
  type WatchRunRequest,
} from "../../shared/run-contract.js";
import { prescriptionTag } from "../run/watch.js";
import type { WatchOutcome } from "../run/service.js";
import type { DatabaseArnoldRuntime } from "../db/runtime.js";
import { etagOf } from "./plan.js";
import { zoneForUpload } from "./workouts.js";
import { HEALTH_SCOPE } from "./health.js";
import {
  WatchApiError,
  type WatchCall,
  type WatchErrorCode,
  type WatchRoute,
} from "./router.js";

/** Run service error codes in the watch's vocabulary (§3.1). */
const ERRORS: Record<string, [WatchErrorCode, number, boolean]> = {
  DUPLICATE_WORKOUT: ["DUPLICATE_WORKOUT", 409, false],
  DUPLICATE_OPERATION: ["DUPLICATE_OPERATION", 409, false],
  REVISION_CONFLICT: ["DUPLICATE_OPERATION", 409, false],
  DATE_IN_FUTURE: ["DATE_IN_FUTURE", 422, false],
  VALIDATION_ERROR: ["VALIDATION_ERROR", 422, false],
  INVALID_STATUS_TRANSITION: ["VALIDATION_ERROR", 422, false],
  // The effort of a run that has not arrived yet: the watch sends it again.
  WORKOUT_NOT_FOUND: ["WORKOUT_PENDING", 409, true],
  // The account's own write guard: no finished setup.
  PERMISSION_DENIED: ["SETUP_REQUIRED", 409, false],
  AUTH_REQUIRED: ["AUTH_REQUIRED", 401, false],
  STORAGE_UNAVAILABLE: ["STORAGE_UNAVAILABLE", 503, true],
};

function refused(code: string): WatchApiError {
  const [watchCode, status, retryable] = ERRORS[code] ?? [
    "VALIDATION_ERROR",
    422,
    false,
  ];
  return new WatchApiError(watchCode, status, retryable, {}, `run.${code}`);
}

/** Unwraps a service answer or throws the error the router shows. */
function value<T>(outcome: WatchOutcome<T>): T {
  if (!outcome.ok) throw refused(outcome.error.code);
  return outcome.value;
}

/** Field paths only, never values: they are the watch's training data. */
function invalid(error: z.ZodError): WatchApiError {
  const path = error.issues[0]?.path.map(String).join(".") || "body";
  return new WatchApiError(
    "VALIDATION_ERROR",
    422,
    false,
    {},
    `schema.${path}`,
  );
}

/** What every run route needs: a finished setup and the paired zone. */
async function userOf(runtime: DatabaseArnoldRuntime, call: WatchCall) {
  const { context, deviceId } = call.principal!;
  const user = await runtime.forUser(context);
  if (await user.onboarding.setupRequired(context))
    throw new WatchApiError("SETUP_REQUIRED", 409);
  const timezone = await runtime.options.db.asUser(
    context.userId,
    async (c) =>
      (
        await c.query<{ timezone: string }>(
          "select timezone from arnold.watch_devices where user_id = $1 and device_id = $2 and status = 'active'",
          [context.userId, deviceId],
        )
      ).rows[0]?.timezone,
  );
  if (!timezone) throw new WatchApiError("AUTH_REQUIRED", 401);
  return { user, context, timezone };
}

/** A body the watch cannot hold is a server fault, never sent shortened. */
function withinBudget<T>(body: T, limit: number): T {
  if (jsonBytes(body) > limit) throw new Error("watch budget exceeded");
  return body;
}

const matches = (header: string | string[] | undefined, tag: string) =>
  (Array.isArray(header) ? header.join(",") : (header ?? ""))
    .split(",")
    .some((candidate) => candidate.trim().replace(/^W\//, "") === tag);

async function upcoming(runtime: DatabaseArnoldRuntime, call: WatchCall) {
  const { user, context, timezone } = await userOf(runtime, call);
  const body = withinBudget(
    await user.runs.upcoming(context, timezone),
    RUN_WATCH_BUDGET_BYTES.upcoming,
  );
  const tag = etagOf(body);
  const headers = { ETag: tag };
  return matches(call.headers["if-none-match"], tag)
    ? { status: 304, headers }
    : { body, headers };
}

async function detail(runtime: DatabaseArnoldRuntime, call: WatchCall) {
  const id = RunIdSchema.safeParse(call.params.id);
  const { user, context, timezone } = await userOf(runtime, call);
  // A stranger's or malformed id looks like a missing one.
  const found = id.success
    ? await user.runs.detail(context, id.data, timezone)
    : null;
  if (!found) throw new WatchApiError("VALIDATION_ERROR", 404, false, {}, "id");
  const body = withinBudget(found, RUN_WATCH_BUDGET_BYTES.prescription);
  // The tag in the upcoming list is the tag of this prescription.
  const tag = `"${prescriptionTag(found.p)}"`;
  const headers = { ETag: tag };
  return matches(call.headers["if-none-match"], tag)
    ? { status: 304, headers }
    : { body, headers };
}

/**
 * Zone bounds of the watch's Garmin profile, only with the consent: the check
 * and the write run in one transaction that holds the consent row, so a
 * revocation cannot slip in between (and the table's own trigger refuses
 * anyway). One row per run; a repeat changes nothing.
 */
async function storeZones(
  runtime: DatabaseArnoldRuntime,
  call: WatchCall,
  request: WatchRunRequest,
  workoutId: string,
): Promise<void> {
  const zones = request.hr?.zones;
  if (!zones) return;
  const { context } = call.principal!;
  await runtime.options.db.asUser(context.userId, async (c) => {
    const consent = await c.query(
      `select 1 from arnold.health_consents
        where user_id = $1 and scope = $2 and revoked_at is null for share`,
      [context.userId, HEALTH_SCOPE],
    );
    if (consent.rowCount !== 1) return;
    await c.query(
      `insert into arnold.run_hr_zones
         (user_id, zones_id, sport, bounds, recorded_at_utc, workout_id)
       values ($1, $2, $3, $4, $5, $6)
       on conflict (user_id, zones_id) do nothing`,
      [
        context.userId,
        request.session_uuid,
        request.hr?.zones_sport ?? "generic",
        zones,
        request.started_at_utc,
        workoutId,
      ],
    );
  });
}

async function save(runtime: DatabaseArnoldRuntime, call: WatchCall) {
  const parsed = WatchRunRequestSchema.safeParse(call.body);
  if (!parsed.success) throw invalid(parsed.error);
  const request = parsed.data;
  const { user, context, timezone: paired } = await userOf(runtime, call);
  const timezone = zoneForUpload(
    paired,
    request.utc_offset_min,
    new Date(request.started_at_utc),
  );
  const response = value(
    await user.runs.saveWatchRun(request, context, timezone),
  );
  await storeZones(runtime, call, request, response.workout_id);
  return { status: response.replayed ? 200 : 201, body: response };
}

async function rate(runtime: DatabaseArnoldRuntime, call: WatchCall) {
  const session = z.uuid().safeParse(call.params.session_uuid);
  const parsed = WatchRunRpeRequestSchema.safeParse(call.body);
  if (!session.success || !parsed.success)
    throw new WatchApiError("VALIDATION_ERROR", 422, false, {}, "schema");
  const { user, context } = await userOf(runtime, call);
  return {
    body: value(
      await user.runs.setWatchRpe(session.data, parsed.data, context),
    ),
  };
}

export function runRoutes(runtime: DatabaseArnoldRuntime): WatchRoute[] {
  return [
    // Before /runs/:id, so "upcoming" is not read as an id.
    {
      method: "GET",
      path: "/runs/upcoming",
      handler: (call) => upcoming(runtime, call),
    },
    {
      method: "GET",
      path: "/runs/:id",
      handler: (call) => detail(runtime, call),
    },
    { method: "POST", path: "/runs", handler: (call) => save(runtime, call) },
    {
      method: "PATCH",
      path: "/runs/:session_uuid/rpe",
      handler: (call) => rate(runtime, call),
    },
  ];
}
