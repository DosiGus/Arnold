/**
 * The plan for the watch in parts (07 D-22, UMSETZUNG §3.2).
 *
 * GET /plan is a directory (plan version, next day, per day id, name,
 * exercise count, minutes and the ETag of that day). GET /plan/sessions/{id}
 * is one day: every exercise once in a catalog, items point at it by index,
 * sets run-length encoded. GET /plan/recent lists up to ten recently trained
 * exercises for "add exercise".
 *
 * Nothing is computed here: proposals come from proposeSession (progression,
 * else last time, else plan), the next day from nextSession, alternatives
 * from similarExercises, steps from weightStep. Unknown values stay unknown
 * (null, and named in `x`), never 0.
 */
import { createHash } from "node:crypto";
import type {
  ArnoldDataset,
  ArnoldExercise,
  ArnoldPlanItem,
} from "../../shared/arnold-schema-v1.js";
import type {
  ProposedExercise,
  ProposedSet,
  SessionProposal,
} from "../../shared/workout-contract.js";
import {
  WatchPlanDirectorySchema,
  WatchPlanRecentSchema,
  WatchPlanSessionSchema,
  type WatchCatalogEntry,
  type WatchPlanDirectory,
  type WatchPlanSession,
} from "../../shared/watch-contract.js";
import { prepareAnalyticsInput } from "../../analytics/eligibility.js";
import { nextSession } from "../../analytics/home.js";
import { similarExercises } from "../../analytics/alternatives.js";
import { weightStep } from "../../analytics/progression.js";
import { estimateSessionMinutes } from "../../analytics/session-duration.js";
import {
  pastSessions,
  proposeActivePlan,
  proposeExercise,
} from "../workout/proposal.js";
import type { DatabaseArnoldRuntime } from "../db/runtime.js";
import { LOAD_SUFFIX, lastTimeText, progressionHint } from "./i18n.js";
import {
  WatchApiError,
  watchEnvelope,
  type WatchCall,
  type WatchLanguage,
  type WatchReply,
  type WatchRoute,
} from "./router.js";

/** Rest when the plan names none, as in the plan editor. */
export const DEFAULT_REST_S = 120;
export const MAX_ALTERNATIVES = 3;
export const MAX_RECENT = 10;

type SetRun = WatchCatalogEntry["s"][number];

const grams = (kg: number) => Math.round(kg * 1000);

/** [count, reps, load_g, side?]; side is left out for "both" (D-22). */
export function encodeRuns(
  sets: readonly ProposedSet[],
  repsUnknown: boolean,
): SetRun[] {
  const runs: SetRun[] = [];
  let key = "";
  for (const set of sets) {
    const reps = repsUnknown ? null : set.reps;
    const load = set.load_kg === null ? null : grams(set.load_kg);
    const next = JSON.stringify([reps, load, set.side]);
    const last = runs.at(-1);
    if (last && next === key) {
      last[0] += 1;
      continue;
    }
    key = next;
    runs.push(
      set.side === "both"
        ? [1, reps, load]
        : ([1, reps, load, set.side] as unknown as SetRun),
    );
  }
  return runs;
}

function catalogEntry(
  exercise: ArnoldExercise,
  proposal: ProposedExercise,
  lang: WatchLanguage,
): WatchCatalogEntry {
  const { load_basis, reps_basis } = proposal.conventions;
  const suffix = LOAD_SUFFIX[lang][load_basis];
  return {
    id: exercise.exercise_id,
    n: (lang === "en" ? exercise.name_en : null) ?? exercise.name_de,
    g: grams(weightStep(exercise.equipment, load_basis)),
    l: { b: load_basis, ...(suffix ? { s: suffix } : {}) },
    ...(reps_basis === "per_side" ? { rb: "per_side" as const } : {}),
    s: encodeRuns(proposal.sets, proposal.missing.includes("reps")),
  };
}

function activePlan(dataset: ArnoldDataset) {
  const plan = dataset.plans.find((p) => p.status === "active");
  const proposals = plan ? proposeActivePlan(dataset) : [];
  if (!plan || !proposals.length)
    throw new WatchApiError("NO_ACTIVE_PLAN", 404);
  return { plan, proposals };
}

function sessionBody(
  dataset: ArnoldDataset,
  proposal: SessionProposal,
  lang: WatchLanguage,
): WatchPlanSession {
  const exercises = new Map(dataset.exercises.map((e) => [e.exercise_id, e]));
  const items = new Map<string, ArnoldPlanItem>(
    dataset.planItems.map((i) => [i.plan_item_id, i]),
  );
  const cat: WatchCatalogEntry[] = [];
  const index = new Map<string, number>();
  const add = (exercise: ArnoldExercise, proposed: ProposedExercise) => {
    const known = index.get(exercise.exercise_id);
    if (known !== undefined) return known;
    index.set(exercise.exercise_id, cat.length);
    cat.push(catalogEntry(exercise, proposed, lang));
    return cat.length - 1;
  };
  const planned = proposal.exercises.flatMap((proposed) => {
    const exercise = exercises.get(proposed.exercise_id);
    const item = proposed.plan_item_id
      ? items.get(proposed.plan_item_id)
      : undefined;
    return exercise && item ? [{ proposed, exercise, item }] : [];
  });
  // Planned exercises first, with their own proposal; an exercise that is
  // also someone's alternative must not get the alternative's proposal. An
  // exercise planned twice on one day keeps its first position's proposal.
  const main = planned.map(({ exercise, proposed }) => add(exercise, proposed));
  const sessionItems = planned.map(({ proposed, exercise, item }, i) => {
    const alternatives = similarExercises(
      dataset.exercises,
      exercise.exercise_id,
    )
      .slice(0, MAX_ALTERNATIVES)
      .map((alt) => add(alt, proposeExercise(dataset, alt, undefined)));
    const last = pastSessions(dataset, exercise.exercise_id)[0];
    const hint = progressionHint(proposed.progression, lang);
    const lastText = last
      ? lastTimeText(last.sets, proposed.conventions.load_basis, lang)
      : undefined;
    const lo = item.rep_min ?? item.rep_max,
      hi = item.rep_max ?? item.rep_min;
    return {
      id: item.plan_item_id,
      c: main[i]!,
      r: item.rest_seconds ?? DEFAULT_REST_S,
      rr: lo !== null && hi !== null ? ([lo, hi] as [number, number]) : null,
      ...(proposed.missing.length ? { x: proposed.missing } : {}),
      ...(hint ? { h: hint } : {}),
      ...(lastText ? { l: lastText } : {}),
      ...(item.notes?.trim() ? { n: item.notes.trim() } : {}),
      ...(alternatives.length ? { a: alternatives } : {}),
    };
  });
  return WatchPlanSessionSchema.parse({
    ...watchEnvelope(),
    p: proposal.plan_version_id,
    id: proposal.session_id,
    n: proposal.session_name,
    cat,
    items: sessionItems,
  });
}

/** One day of the active plan. */
export function buildSession(
  dataset: ArnoldDataset,
  sessionId: string,
  lang: WatchLanguage,
): WatchPlanSession {
  const { proposals } = activePlan(dataset);
  const proposal = proposals.find((p) => p.session_id === sessionId);
  // A day that is no longer in the plan: the watch reloads the directory.
  if (!proposal) throw new WatchApiError("VALIDATION_ERROR", 404);
  return sessionBody(dataset, proposal, lang);
}

/** A strong ETag over the exact response bytes. */
export function etagOf(body: unknown): string {
  return `"${createHash("sha256").update(JSON.stringify(body)).digest("hex")}"`;
}

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

/** The directory: every day with its own ETag, and the next day. */
export function buildDirectory(
  dataset: ArnoldDataset,
  lang: WatchLanguage,
): WatchPlanDirectory {
  const { plan, proposals } = activePlan(dataset);
  const next = nextSession(prepareAnalyticsInput(dataset, ALL));
  const days = proposals.map((proposal) => ({
    id: proposal.session_id,
    n: proposal.session_name,
    c: proposal.exercises.length,
    // 07 D-27; unknown set counts make it null, never a guess.
    m: estimateSessionMinutes(
      proposal.exercises.map((exercise) => ({
        sets: exercise.missing.includes("sets") ? null : exercise.sets.length,
        rest_seconds:
          dataset.planItems.find(
            (i) => i.plan_item_id === exercise.plan_item_id,
          )?.rest_seconds ?? null,
      })),
    ),
    tag: etagOf(sessionBody(dataset, proposal, lang)),
  }));
  return WatchPlanDirectorySchema.parse({
    ...watchEnvelope(),
    p: plan.plan_version_id,
    next:
      next && days.some((d) => d.id === next.session_id)
        ? next.session_id
        : days[0]!.id,
    days,
  });
}

/** Up to ten recently trained exercises with last time's sets. */
export function buildRecent(dataset: ArnoldDataset, lang: WatchLanguage) {
  const exercises = new Map(dataset.exercises.map((e) => [e.exercise_id, e]));
  const workouts = dataset.workouts
    .filter((w) => w.status === "completed")
    .sort(
      (a, b) =>
        b.workout_date_local.localeCompare(a.workout_date_local) ||
        b.created_at_utc.localeCompare(a.created_at_utc),
    );
  const ids: string[] = [];
  for (const workout of workouts) {
    for (const set of dataset.sets
      .filter(
        (s) =>
          s.workout_id === workout.workout_id &&
          s.status === "active" &&
          s.set_type === "working",
      )
      .sort((a, b) => a.exercise_order - b.exercise_order))
      if (
        !ids.includes(set.exercise_id) &&
        exercises.get(set.exercise_id)?.status === "active"
      )
        ids.push(set.exercise_id);
    if (ids.length >= MAX_RECENT) break;
  }
  return WatchPlanRecentSchema.parse({
    ...watchEnvelope(),
    cat: ids.slice(0, MAX_RECENT).map((id) => {
      const exercise = exercises.get(id)!;
      return catalogEntry(
        exercise,
        proposeExercise(dataset, exercise, undefined),
        lang,
      );
    }),
  });
}

/** The user's data, after the same setup gate the tools use. */
async function dataFor(runtime: DatabaseArnoldRuntime, call: WatchCall) {
  const context = call.principal!.context;
  const user = await runtime.forUser(context);
  if (await user.onboarding.setupRequired(context))
    throw new WatchApiError("SETUP_REQUIRED", 409);
  return user.store.read();
}

/** 304 when the watch already has exactly this body. */
function withETag(call: WatchCall, body: unknown): WatchReply {
  const tag = etagOf(body);
  const headers = { ETag: tag, Vary: "Accept-Language" };
  const sent = call.headers["if-none-match"];
  return sent === tag ? { status: 304, headers } : { body, headers };
}

export function planRoutes(runtime: DatabaseArnoldRuntime): WatchRoute[] {
  return [
    {
      method: "GET",
      path: "/plan",
      handler: async (call) =>
        withETag(call, buildDirectory(await dataFor(runtime, call), call.lang)),
    },
    {
      method: "GET",
      path: "/plan/sessions/:session_id",
      handler: async (call) =>
        withETag(
          call,
          buildSession(
            await dataFor(runtime, call),
            call.params.session_id ?? "",
            call.lang,
          ),
        ),
    },
    {
      method: "GET",
      path: "/plan/recent",
      handler: async (call) =>
        withETag(call, buildRecent(await dataFor(runtime, call), call.lang)),
    },
  ];
}
