/**
 * Mobility on the watch (MOB-006, ARN-MOB): the routines of the active plan
 * (`GET /mobility/today`, `GET /mobility/:id`) and the result of a finished
 * routine (`POST /mobility`). Pattern: runs.ts.
 *
 * The routes only translate: the mobility service decides (one write through
 * commitWrite, replay by request_id, DUPLICATE_WORKOUT for a known
 * session_uuid). The user comes from the checked token, the time zone from the
 * paired device. The list holds every active routine of the plan (at most 5);
 * the watch picks today's from the weekday mask `w`. Names and cues come from
 * the catalog in the language of the request; the mark `mv` and the tags are
 * computed from what the watch shows. Logs and error reasons carry field
 * paths and codes, never values.
 */
import { createHash } from "node:crypto";
import {
  MOBILITY_LIMITS,
  MOBILITY_WATCH_BUDGET_BYTES,
  WatchMobilityRequestSchema,
  WatchMobilityRoutineSchema,
  WatchMobilityTodaySchema,
} from "../../shared/mobility-contract.js";
import { mobilityExercise } from "../../shared/mobility-catalog.js";
import { RUN_WATCH_API_VERSION } from "../../shared/run-contract.js";
import { WATCH_MIN_APP_VERSION } from "../../shared/watch-contract.js";
import type { DatabaseArnoldRuntime } from "../db/runtime.js";
import {
  isoWeekday,
  mobilityDayInputsOf,
  type MobilityDayInputs,
  type MobilityDaySession,
} from "../mobility/day.js";
import { localDayOf } from "../reference-day.js";
import { etagOf } from "./plan.js";
import { invalid, matches, userOf, withinBudget } from "./runs.js";
import { zoneForUpload } from "./workouts.js";
import {
  WatchApiError,
  type WatchCall,
  type WatchErrorCode,
  type WatchLanguage,
  type WatchReply,
  type WatchRoute,
} from "./router.js";

/** Mobility service error codes in the watch's vocabulary (§3.1). */
const ERRORS: Record<string, [WatchErrorCode, number, boolean]> = {
  DUPLICATE_WORKOUT: ["DUPLICATE_WORKOUT", 409, false],
  DUPLICATE_OPERATION: ["DUPLICATE_OPERATION", 409, false],
  REVISION_CONFLICT: ["DUPLICATE_OPERATION", 409, false],
  DATE_IN_FUTURE: ["DATE_IN_FUTURE", 422, false],
  VALIDATION_ERROR: ["VALIDATION_ERROR", 422, false],
  SETUP_REQUIRED: ["SETUP_REQUIRED", 409, false],
  PERMISSION_DENIED: ["SETUP_REQUIRED", 409, false],
  AUTH_REQUIRED: ["AUTH_REQUIRED", 401, false],
  STORAGE_UNAVAILABLE: ["STORAGE_UNAVAILABLE", 503, true],
};

/** The routines the list can hold (a plan has one morning routine and a few sessions). */
const MAX_ITEMS = MOBILITY_LIMITS.todayItems;
const NAME_MAX = 22;

const DEFAULT_NAMES: Record<
  MobilityDaySession["kind"],
  Record<WatchLanguage, string>
> = {
  morning: { de: "Morgenroutine", en: "Morning routine" },
  session: { de: "Mobility", en: "Mobility" },
};

/** Bit 0 = Monday … bit 6 = Sunday. */
const weekdayBit = (isoDay: number) => 1 << (isoDay - 1);
const weekdayMask = (days: readonly number[]) =>
  days.reduce((mask, day) => mask | weekdayBit(day), 0);

/** The name of a routine on the watch: the stored name, the default one in the watch's language, at most 22 characters. */
function nameOf(session: MobilityDaySession, lang: WatchLanguage): string {
  const name = session.session_name.trim();
  if (name === DEFAULT_NAMES[session.kind].de)
    return DEFAULT_NAMES[session.kind][lang];
  if (name.length <= NAME_MAX) return name;
  return `${name.slice(0, NAME_MAX - 1).replace(/[\ud800-\udbff]$/, "").trimEnd()}…`;
}

/** The routine as the watch loads it, in one language. */
function routineBody(session: MobilityDaySession, lang: WatchLanguage) {
  return WatchMobilityRoutineSchema.parse({
    api_version: RUN_WATCH_API_VERSION,
    min_app_version: WATCH_MIN_APP_VERSION,
    id: session.session_id,
    tot: session.template.total_s,
    ex: session.template.items.map((item) => {
      const exercise = mobilityExercise(item.exercise_id);
      // The plan only holds catalog exercises; anything else is a server fault.
      if (!exercise) throw new Error("unknown mobility exercise");
      return {
        c: item.exercise_id,
        n: lang === "de" ? exercise.name_de : exercise.name_en,
        h: lang === "de" ? exercise.cue_de : exercise.cue_en,
        s: item.sides,
        t: item.seconds_per_side,
        r: item.reps,
      };
    }),
  });
}

/** Up to 16 characters of the hash of the routine as the watch gets it: its ETag without the quotes. */
const routineTag = (session: MobilityDaySession, lang: WatchLanguage) =>
  createHash("sha256")
    .update(JSON.stringify(routineBody(session, lang)))
    .digest("hex")
    .slice(0, 16);

/** The routines of the active plan that the watch can hold. */
const watchSessions = (inputs: MobilityDayInputs) =>
  inputs.sessions.slice(0, MAX_ITEMS);

/** True when the active plan has mobility the watch has to load (what a plan without it never asks for). */
export const hasWatchMobility = (inputs: MobilityDayInputs) =>
  watchSessions(inputs).length > 0;

/**
 * The mobility mark: 16 hex over what the watch loads of the plan's mobility,
 * the routines with their weekdays and timing, without names and cues, so the
 * language of the watch does not change it. A new plan or an edited routine does.
 */
export function mobilityMark(inputs: MobilityDayInputs): string {
  return createHash("sha256")
    .update(
      JSON.stringify(
        watchSessions(inputs).map((s) => [
          s.session_id,
          s.kind,
          s.minutes,
          s.placement,
          [...s.weekdays].sort((a, b) => a - b),
          s.after_session_id,
          s.template.items.map((i) => [
            i.exercise_id,
            i.sides,
            i.seconds_per_side,
            i.reps,
          ]),
        ]),
      ),
    )
    .digest("hex")
    .slice(0, 16);
}

/** The list: every routine of the plan, the day in the user's calendar, the mark. */
export function todayBody(
  inputs: MobilityDayInputs,
  today: string,
  lang: WatchLanguage,
) {
  const doneToday = new Set(
    inputs.done
      .filter((d) => d.date_local === today && d.session_id !== null)
      .map((d) => d.session_id),
  );
  const items = watchSessions(inputs).map((s) => ({
    id: s.session_id,
    k: s.kind === "morning" ? "m" : "s",
    n: nameOf(s, lang),
    m: s.minutes,
    // After strength there is no weekday: the routine follows its training, so today's bit.
    w:
      s.placement === "after_strength"
        ? weekdayBit(isoWeekday(today))
        : weekdayMask(s.weekdays),
    a: s.placement === "after_strength" ? s.after_session_id : null,
    dn: doneToday.has(s.session_id),
    tag: routineTag(s, lang),
  }));
  return WatchMobilityTodaySchema.parse({
    api_version: RUN_WATCH_API_VERSION,
    min_app_version: WATCH_MIN_APP_VERSION,
    d: today,
    mv: mobilityMark(inputs),
    items,
  });
}

function refused(code: string): WatchApiError {
  const [watchCode, status, retryable] = ERRORS[code] ?? [
    "VALIDATION_ERROR",
    422,
    false,
  ];
  return new WatchApiError(watchCode, status, retryable, {}, `mobility.${code}`);
}

/** The user's mobility facts, after the same setup gate as the other routes. */
async function inputsOf(runtime: DatabaseArnoldRuntime, call: WatchCall) {
  const { user, timezone } = await userOf(runtime, call);
  const now = runtime.options.now
    ? new Date(runtime.options.now())
    : new Date();
  return {
    user,
    timezone,
    today: localDayOf(now, timezone),
    inputs: mobilityDayInputsOf(await user.store.read()),
  };
}

async function today(
  runtime: DatabaseArnoldRuntime,
  call: WatchCall,
): Promise<WatchReply> {
  const { today: day, inputs } = await inputsOf(runtime, call);
  const body = withinBudget(
    todayBody(inputs, day, call.lang),
    MOBILITY_WATCH_BUDGET_BYTES.today,
  );
  const tag = etagOf(body);
  const headers = { ETag: tag, Vary: "Accept-Language" };
  return matches(call.headers["if-none-match"], tag)
    ? { status: 304, headers }
    : { body, headers };
}

async function detail(
  runtime: DatabaseArnoldRuntime,
  call: WatchCall,
): Promise<WatchReply> {
  const { inputs } = await inputsOf(runtime, call);
  // A stranger's or malformed id looks like a missing one.
  const session = watchSessions(inputs).find(
    (s) => s.session_id === call.params.id,
  );
  if (!session)
    throw new WatchApiError("VALIDATION_ERROR", 404, false, {}, "id");
  const body = withinBudget(
    routineBody(session, call.lang),
    MOBILITY_WATCH_BUDGET_BYTES.routine,
  );
  const tag = `"${routineTag(session, call.lang)}"`;
  const headers = { ETag: tag, Vary: "Accept-Language" };
  return matches(call.headers["if-none-match"], tag)
    ? { status: 304, headers }
    : { body, headers };
}

async function save(
  runtime: DatabaseArnoldRuntime,
  call: WatchCall,
): Promise<WatchReply> {
  const parsed = WatchMobilityRequestSchema.safeParse(call.body);
  if (!parsed.success) throw invalid(parsed.error);
  const request = parsed.data;
  const { user, context, timezone: paired } = await userOf(runtime, call);
  const timezone = zoneForUpload(
    paired,
    request.utc_offset_min,
    new Date(request.started_at_utc),
  );
  const outcome = await user.mobility.saveWatchMobility(
    request,
    context,
    timezone,
  );
  if (!outcome.ok) throw refused(outcome.error.code);
  return {
    status: outcome.value.replayed ? 200 : 201,
    body: outcome.value,
  };
}

export function mobilityRoutes(runtime: DatabaseArnoldRuntime): WatchRoute[] {
  return [
    {
      method: "GET",
      path: "/mobility/today",
      handler: (call) => today(runtime, call),
    },
    {
      method: "GET",
      path: "/mobility/:id",
      handler: (call) => detail(runtime, call),
    },
    {
      method: "POST",
      path: "/mobility",
      handler: (call) => save(runtime, call),
    },
  ];
}
