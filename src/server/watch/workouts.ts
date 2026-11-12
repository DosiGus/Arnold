/**
 * POST /workouts: a training from the watch (UMSETZUNG §3.3, 07 D-08, D-10).
 *
 * The request maps onto log_workout and goes through WorkoutLoggingService
 * and commitWrite with the watch's request_id, so a repeated upload is a
 * replay, never a second workout. Every exercise carries its sets explicitly;
 * plan positions the watch does not mention are skipped, so nothing depends on
 * the proposal at upload time. Grams become kilograms here and nowhere else.
 * The router runs this inside exclusive() for the user.
 */
import { strengthTrainingView } from "../../shared/arnold-schema-v1.js";
import type { ArnoldDataset } from "../../shared/arnold-schema-v1.js";
import {
  WatchWorkoutRequestSchema,
  WatchWorkoutResponseSchema,
  type WatchWorkoutRequest,
} from "../../shared/watch-contract.js";
import type { WriteErrorCode } from "../../shared/workout-contract.js";
import type { WatchSetTiming } from "../plan/commit.js";
import { prepareAnalyticsInput } from "../../analytics/eligibility.js";
import { computeRecords } from "../../analytics/records.js";
import { proposeExercise, sessionItems } from "../workout/proposal.js";
import type { DatabaseArnoldRuntime } from "../db/runtime.js";
import { loadText } from "./i18n.js";
import {
  WatchApiError,
  watchEnvelope,
  type WatchCall,
  type WatchErrorCode,
  type WatchLanguage,
  type WatchRoute,
} from "./router.js";

const ALL = {
  from: null,
  to: null,
  exercise_ids: null,
  plan_version_ids: null,
  session_ids: null,
  workout_ids: null,
  set_types: null,
  workout_statuses: null,
} as const;

/** "+01:00" style offset of `timeZone` at `instant`, in minutes. */
export function offsetMinutes(timeZone: string, instant: Date): number {
  const name =
    new Intl.DateTimeFormat("en-US", {
      timeZone,
      timeZoneName: "longOffset",
    })
      .formatToParts(instant)
      .find((p) => p.type === "timeZoneName")?.value ?? "GMT";
  const match = /GMT([+-])(\d{2}):(\d{2})/.exec(name);
  if (!match) return 0;
  const minutes = Number(match[2]) * 60 + Number(match[3]);
  return match[1] === "-" ? -minutes : minutes;
}

/**
 * 07 D-10: the zone stored at pairing when the watch's offset matches it on
 * that day; else Etc/GMT±H for whole hours; else refused.
 */
export function zoneForUpload(
  pairedZone: string,
  offsetMin: number,
  instant: Date,
): string {
  if (offsetMinutes(pairedZone, instant) === offsetMin) return pairedZone;
  if (offsetMin % 60 === 0 && offsetMin >= -720 && offsetMin <= 840) {
    const hours = offsetMin / 60;
    // POSIX sign: Etc/GMT-1 is one hour ahead of UTC.
    return hours === 0
      ? "Etc/GMT"
      : `Etc/GMT${hours > 0 ? "-" : "+"}${Math.abs(hours)}`;
  }
  throw new WatchApiError("VALIDATION_ERROR", 422, false, {}, "zone_offset");
}

const iso = (epochSeconds: number) =>
  new Date(epochSeconds * 1000).toISOString().replace(".000Z", "Z");

/**
 * The log_workout input and the set timings, in the order the workout will
 * be saved: plan positions in plan order (skips left out), then extra
 * exercises in the order the watch sent them.
 */
export function mapUpload(
  request: WatchWorkoutRequest,
  data: Pick<ArnoldDataset, "planItems">,
  timezone: string,
) {
  const items = sessionItems(data, request.plan_version_id, request.session_id);
  const mentioned = new Set(
    request.exercises.flatMap((e) => (e.plan_item_id ? [e.plan_item_id] : [])),
  );
  const exercises = [
    ...request.exercises.map((e) =>
      "skip" in e
        ? { plan_item_id: e.plan_item_id, skip: true as const }
        : {
            ...(e.plan_item_id ? { plan_item_id: e.plan_item_id } : {}),
            exercise_id: e.exercise_id,
            sets: e.sets.map((s) => ({
              reps: s.reps,
              ...(s.load_g === null ? {} : { load_kg: s.load_g / 1000 }),
              side: s.side,
            })),
          },
    ),
    // Not done on the watch is not done: never the proposal instead.
    ...items
      .filter((i) => !mentioned.has(i.plan_item_id))
      .map((i) => ({ plan_item_id: i.plan_item_id, skip: true as const })),
  ];
  const performed = request.exercises.filter(
    (e): e is Extract<typeof e, { sets: unknown }> => "sets" in e,
  );
  const position = (planItemId: string | undefined) =>
    planItemId ? items.findIndex((i) => i.plan_item_id === planItemId) : -1;
  const ordered = [
    ...performed
      .filter((e) => position(e.plan_item_id) >= 0)
      .sort((a, b) => position(a.plan_item_id) - position(b.plan_item_id)),
    ...performed.filter((e) => position(e.plan_item_id) < 0),
  ];
  const chronological = ordered
    .flatMap((exercise, index) => {
      const perSide = new Map<string, number>();
      return exercise.sets.map((set) => {
        const number = (perSide.get(set.side) ?? 0) + 1;
        perSide.set(set.side, number);
        return { set, exercise_order: index + 1, set_number: number };
      });
    })
    .sort((a, b) => a.set.t0 - b.set.t0);
  const timings: WatchSetTiming[] = chronological.map((entry, i) => {
    const previous = chronological[i - 1]?.set;
    const rest = previous ? entry.set.t0 - previous.t1 : null;
    return {
      exercise_order: entry.exercise_order,
      set_number: entry.set_number,
      side: entry.set.side,
      started_at_utc: iso(entry.set.t0),
      ended_at_utc: iso(entry.set.t1),
      rest_before_s: rest !== null && rest >= 0 ? rest : null,
    };
  });
  return {
    input: {
      request_id: request.request_id,
      workout_date_local: request.workout_date_local,
      timezone,
      plan_version_id: request.plan_version_id,
      session_id: request.session_id,
      exercises,
      started_at_utc: request.started_at_utc,
      ended_at_utc: request.ended_at_utc,
      ...(request.confirm_duplicate ? { confirm_duplicate: true } : {}),
      ...(request.confirm_unusual_values
        ? { confirm_unusual_values: true }
        : {}),
    },
    timings,
  };
}

/** Write errors in the watch's vocabulary (§3.1). */
const ERRORS: Partial<
  Record<WriteErrorCode, [WatchErrorCode, number, boolean]>
> = {
  DUPLICATE_WORKOUT: ["DUPLICATE_WORKOUT", 409, false],
  DUPLICATE_OPERATION: ["DUPLICATE_OPERATION", 409, false],
  // Stored once already under another request id (unique client session):
  // not a case the frozen outbox produces, so it is kept for clarification.
  REVISION_CONFLICT: ["DUPLICATE_OPERATION", 409, false],
  CONFIRMATION_REQUIRED: ["CONFIRMATION_REQUIRED", 422, false],
  SCHEMA_MISMATCH: ["SCHEMA_MISMATCH", 409, false],
  DATE_IN_FUTURE: ["DATE_IN_FUTURE", 422, false],
  VALIDATION_ERROR: ["VALIDATION_ERROR", 422, false],
  EXERCISE_NOT_FOUND: ["VALIDATION_ERROR", 422, false],
  INVALID_STATUS_TRANSITION: ["VALIDATION_ERROR", 422, false],
  // The account's own write guard: no finished setup.
  PERMISSION_DENIED: ["SETUP_REQUIRED", 409, false],
  AUTH_REQUIRED: ["AUTH_REQUIRED", 401, false],
  STORAGE_UNAVAILABLE: ["STORAGE_UNAVAILABLE", 503, true],
};

const TEXT = {
  de: {
    maxLoad: (name: string, load: string) => `Neuer Rekord: ${name} ${load}`,
    maxReps: (name: string, reps: number, load: string) =>
      `Neuer Rekord: ${name} ${reps} Wdh. mit ${load}`,
    next: (load: string, reps: number) => `Nächstes Mal ${load} × ${reps}`,
  },
  en: {
    maxLoad: (name: string, load: string) => `New record: ${name} ${load}`,
    maxReps: (name: string, reps: number, load: string) =>
      `New record: ${name} ${reps} reps at ${load}`,
    next: (load: string, reps: number) => `Next time ${load} × ${reps}`,
  },
} as const;

/** New records of this workout and next time's proposal, from src/analytics. */
export function summaryFor(
  data: ArnoldDataset,
  workoutId: string,
  lang: WatchLanguage,
) {
  const text = TEXT[lang];
  const exercises = new Map(data.exercises.map((e) => [e.exercise_id, e]));
  const name = (id: string) => {
    const e = exercises.get(id);
    return (lang === "en" ? e?.name_en : null) ?? e?.name_de ?? id;
  };
  const records = computeRecords(prepareAnalyticsInput(data, ALL));
  const lines = [
    ...records.max_load
      .filter((r) => r.workout_id === workoutId && r.kind === "improvement")
      .map((r) =>
        text.maxLoad(name(r.exercise_id), loadText(r.value, "total", lang)),
      ),
    ...records.max_reps_at_load
      .filter((r) => r.workout_id === workoutId && r.kind === "improvement")
      .map((r) =>
        text.maxReps(
          name(r.exercise_id),
          r.value,
          loadText(r.at_load_kg, "total", lang),
        ),
      ),
  ].slice(0, 5);
  const sets = data.sets.filter(
    (s) => s.workout_id === workoutId && s.status === "active",
  );
  const next = [...new Set(sets.map((s) => s.exercise_id))].flatMap((id) => {
    const exercise = exercises.get(id);
    const planItemId = sets.find((s) => s.exercise_id === id)?.plan_item_id;
    const item = data.planItems.find((i) => i.plan_item_id === planItemId);
    if (!exercise) return [];
    const proposed = proposeExercise(data, exercise, item);
    const first = proposed.sets[0];
    if (!first || proposed.missing.length) return [];
    return [
      {
        exercise_id: id,
        message: text.next(
          loadText(first.load_kg, proposed.conventions.load_basis, lang),
          first.reps,
        ),
      },
    ];
  });
  return { records: lines, next };
}

/** App version from `X-Arnold-Watch: <app-version>/<part-number>`. */
function appVersion(header: string | string[] | undefined): string {
  const value = Array.isArray(header) ? header[0] : header;
  const version = value?.split("/")[0]?.trim();
  return version && /^\d+\.\d+\.\d+$/.test(version) ? version : "unknown";
}

async function upload(runtime: DatabaseArnoldRuntime, call: WatchCall) {
  const parsed = WatchWorkoutRequestSchema.safeParse(call.body);
  if (!parsed.success) {
    // Field paths only, never values: they are the watch's training data.
    const path = parsed.error.issues[0]?.path.map(String).join(".") ?? "body";
    throw new WatchApiError(
      "VALIDATION_ERROR",
      422,
      false,
      {},
      `schema.${path}`,
    );
  }
  const request = parsed.data;
  const { context, deviceId } = call.principal!;
  const user = await runtime.forUser(context);
  if (await user.onboarding.setupRequired(context))
    throw new WatchApiError("SETUP_REQUIRED", 409);
  const paired = await runtime.options.db.asUser(
    context.userId,
    async (c) =>
      (
        await c.query<{ timezone: string }>(
          "select timezone from arnold.watch_devices where user_id = $1 and device_id = $2 and status = 'active'",
          [context.userId, deviceId],
        )
      ).rows[0]?.timezone,
  );
  if (!paired) throw new WatchApiError("AUTH_REQUIRED", 401);
  const timezone = zoneForUpload(
    paired,
    request.utc_offset_min,
    new Date(request.started_at_utc),
  );
  const { input, timings } = mapUpload(
    request,
    strengthTrainingView(await user.store.read()),
    timezone,
  );
  const response = await user.service.logWatchWorkout(
    input,
    {
      client_session_id: request.session_uuid,
      device_id: deviceId,
      app_version: appVersion(call.headers["x-arnold-watch"]),
      set_timings: timings,
    },
    context,
  );
  if (!response.ok || !response.result?.workout) {
    const [code, status, retryable] = ERRORS[
      response.error?.code ?? "STORAGE_UNAVAILABLE"
    ] ?? ["VALIDATION_ERROR", 422, false];
    throw new WatchApiError(
      code,
      status,
      retryable,
      {},
      `write.${response.error?.code ?? "unknown"}`,
    );
  }
  const workoutId = response.result.workout.workout_id;
  return {
    status: response.replayed ? 200 : 201,
    body: WatchWorkoutResponseSchema.parse({
      ...watchEnvelope(),
      workout_id: workoutId,
      replayed: response.replayed,
      summary: summaryFor(
        strengthTrainingView(await user.store.read()),
        workoutId,
        call.lang,
      ),
    }),
  };
}

export function workoutRoutes(runtime: DatabaseArnoldRuntime): WatchRoute[] {
  return [
    {
      method: "POST",
      path: "/workouts",
      handler: (call) => upload(runtime, call),
    },
  ];
}
