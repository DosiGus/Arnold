/**
 * Adjustment for a while (UX-008): the pure rules. No clock, no I/O, no IDs.
 *
 * An adjustment replaces the active plan for training on a range of local
 * calendar days, in the zone stored with it. It never changes the active
 * plan. This module answers four questions:
 *
 *   - which days a request means ("today", "this week", "this month", a
 *     range), counted in the user's zone and capped at 56 days;
 *   - which confirmed adjustment applies at an instant (`runningAdjustment`);
 *   - what the training readers see while it applies (`trainingView`, the
 *     ONE place the adjustment is laid over the active plan);
 *   - what the sessions of the adjustment look like (`adjustedSessions`):
 *     shortened to a time budget, fewer days, short full-body sessions to hold
 *     the level, exercises swapped for the equipment at hand.
 *
 * Everything else (plan list, drafts, comparison, activation, editor) keeps
 * reading the real plans and never sees a temporary version as a draft.
 */
import {
  PLAN_ADJUSTMENT_MAX_DAYS,
  type ArnoldDataset,
  type ArnoldExercise,
  type ArnoldPlanAdjustment,
  type ArnoldPlanItem,
  type ArnoldPlanVersion,
} from "../../shared/arnold-schema-v1.js";
import { exerciseBudget } from "../../shared/onboarding-profile.js";
import { addDays, weekStart } from "../../analytics/period.js";
import { estimateSessionMinutes } from "../../analytics/session-duration.js";
import { localDayOf } from "../reference-day.js";

export type AdjustmentKind = ArnoldPlanAdjustment["kind"];

export interface AdjustmentPeriod {
  start: string;
  end: string;
  /** True when the natural end lay beyond the 56-day limit. */
  capped: boolean;
}

/** Last day of the month that contains `date` (YYYY-MM-DD). */
function monthEnd(date: string): string {
  const [y, m] = date.split("-").map(Number) as [number, number];
  const next = new Date(Date.UTC(y, m, 1)); // month m (1-based) + 1, day 1
  return addDays(next.toISOString().slice(0, 10), -1);
}

/**
 * The days a request means, from the local day `today` on. `today` and
 * `week` and `month` start today; a range is taken as given and checked by
 * the caller. Every end is capped at 56 days including the first.
 */
export function adjustmentPeriod(
  kind: Exclude<AdjustmentKind, "range">,
  today: string,
): AdjustmentPeriod {
  const natural =
    kind === "today"
      ? today
      : kind === "week"
        ? addDays(weekStart(today), 6)
        : monthEnd(today);
  const limit = addDays(today, PLAN_ADJUSTMENT_MAX_DAYS - 1);
  return natural > limit
    ? { start: today, end: limit, capped: true }
    : { start: today, end: natural, capped: false };
}

/** The local calendar day of `now` in the adjustment's own zone. */
export function adjustmentDay(adjustment: ArnoldPlanAdjustment, now: Date) {
  return localDayOf(now, adjustment.timezone);
}

/** True when `now` falls on one of the adjustment's days, in its zone. */
export function appliesAt(adjustment: ArnoldPlanAdjustment, now: Date) {
  const day = adjustmentDay(adjustment, now);
  return (
    adjustment.status === "confirmed" &&
    adjustment.start_date_local <= day &&
    day <= adjustment.end_date_local
  );
}

/** The confirmed adjustment that applies at `now`, if any (at most one). */
export function runningAdjustment(
  dataset: Pick<ArnoldDataset, "planAdjustments">,
  now: Date,
): ArnoldPlanAdjustment | null {
  return (dataset.planAdjustments ?? []).find((a) => appliesAt(a, now)) ?? null;
}

/** Confirmed adjustments that have not ended yet at `now`, by start. */
export function currentAdjustments(
  dataset: Pick<ArnoldDataset, "planAdjustments">,
  now: Date,
): ArnoldPlanAdjustment[] {
  return (dataset.planAdjustments ?? [])
    .filter(
      (a) =>
        a.status === "confirmed" && adjustmentDay(a, now) <= a.end_date_local,
    )
    .sort((a, b) => (a.start_date_local < b.start_date_local ? -1 : 1));
}

/** A confirmed adjustment sharing at least one day with [start, end]. */
export function overlapping(
  dataset: Pick<ArnoldDataset, "planAdjustments">,
  start: string,
  end: string,
  exceptId?: string,
): ArnoldPlanAdjustment | null {
  return (
    (dataset.planAdjustments ?? []).find(
      (a) =>
        a.status === "confirmed" &&
        a.plan_adjustment_id !== exceptId &&
        a.start_date_local <= end &&
        start <= a.end_date_local,
    ) ?? null
  );
}

/**
 * THE one place an adjustment is laid over the active plan.
 *
 * While a confirmed adjustment applies at `now`, the training readers (next
 * session, today's proposals, the watch, the overview) see its temporary
 * version as the active plan and the real active plan as retired. Pure: the
 * stored data is untouched, so the day after the last day this returns the
 * dataset unchanged and the normal plan applies again without any write.
 * Never pass the result to a write or to the plan service.
 */
export function trainingView<T extends ArnoldDataset>(
  dataset: T,
  now: Date,
): T {
  const running = runningAdjustment(dataset, now);
  if (!running) return dataset;
  const since = running.confirmed_at_utc!;
  const plans = dataset.plans.map((plan): ArnoldPlanVersion => {
    if (plan.plan_version_id === running.plan_version_id)
      return { ...plan, status: "active", activated_at_utc: since };
    if (plan.status === "active")
      return {
        ...plan,
        status: "archived",
        retired_at_utc:
          plan.activated_at_utc && plan.activated_at_utc > since
            ? plan.activated_at_utc
            : since,
      };
    return plan;
  });
  return Object.freeze({ ...dataset, plans: Object.freeze(plans) });
}

/* ---------------------------------------------------------------- content */

/** Movement families that count as basic (multi-joint) exercises. */
const BASIC_FAMILIES = new Set([
  "squat",
  "hinge",
  "press",
  "pull",
  "row",
  "lunge",
]);

export function isBasicExercise(exercise: ArnoldExercise | undefined) {
  return !!exercise && BASIC_FAMILIES.has(exercise.family_key);
}

/** One position of an adjusted session, built from a position of the base plan. */
export interface AdjustedItem {
  source: ArnoldPlanItem;
  exercise_id: string;
  target_sets: number | null;
  rest_seconds: number | null;
  /** True when the exercise was swapped: the planned load no longer applies. */
  replaced: boolean;
}

export interface AdjustedSession {
  session_id: string;
  session_name: string;
  items: AdjustedItem[];
}

const minutesOf = (items: readonly AdjustedItem[]) =>
  estimateSessionMinutes(
    items.map((i) => ({ sets: i.target_sets, rest_seconds: i.rest_seconds })),
  );

/**
 * Basic exercises first, then the rest, each in plan order. The order of
 * the plan already puts the main lifts first; the family makes it explicit.
 */
function byImportance(
  items: readonly AdjustedItem[],
  exercises: ReadonlyMap<string, ArnoldExercise>,
): AdjustedItem[] {
  return [...items].sort(
    (a, b) =>
      Number(isBasicExercise(exercises.get(b.exercise_id))) -
        Number(isBasicExercise(exercises.get(a.exercise_id))) ||
      a.source.exercise_order - b.source.exercise_order,
  );
}

/**
 * A session cut to `minutes`: at most `exerciseBudget(minutes).max`
 * exercises (the same rule as the plan check of UX-012), basic exercises
 * kept first, fewer sets and shorter rests, then exercises and sets dropped
 * until the estimate (analytics/session-duration) fits. An unknown set count
 * stays unknown. The result keeps plan order.
 */
export function shortenSession(
  items: readonly AdjustedItem[],
  exercises: ReadonlyMap<string, ArnoldExercise>,
  minutes: number,
): AdjustedItem[] {
  const short = minutes < 30;
  const maxSets = short ? 2 : 3;
  const maxRest = short ? 60 : 90;
  const ranked = byImportance(items, exercises)
    .slice(0, exerciseBudget(minutes).max)
    .map((item) => ({
      ...item,
      target_sets:
        item.target_sets === null ? null : Math.min(item.target_sets, maxSets),
      rest_seconds: Math.min(item.rest_seconds ?? maxRest, maxRest),
    }));
  const fits = () => {
    const estimate = minutesOf(ranked);
    return estimate === null || estimate <= minutes;
  };
  while (!fits()) {
    // Drop the least important exercise while more than two remain, then
    // take a set from the exercise with the most sets (last one first).
    if (ranked.length > 2) {
      ranked.pop();
      continue;
    }
    const most = [...ranked]
      .reverse()
      .find(
        (i) =>
          i.target_sets !== null &&
          i.target_sets ===
            Math.max(...ranked.map((r) => r.target_sets ?? 0)) &&
          i.target_sets > 1,
      );
    if (!most) break;
    most.target_sets = most.target_sets! - 1;
  }
  return ranked.sort(
    (a, b) => a.source.exercise_order - b.source.exercise_order,
  );
}

export interface AdjustmentRequest {
  kind: AdjustmentKind;
  /** Minutes per session; shortens every session. */
  minutes_per_session: number | null;
  /** Training days per week; fewer sessions. */
  sessions_per_week: number | null;
  /** Equipment at hand: swap an exercise of the plan for another. */
  replacements: readonly { from_exercise_id: string; to_exercise_id: string }[];
  /** Leave these exercises out (e.g. no machine on holiday). */
  remove_exercise_ids: readonly string[];
}

/** The sessions of a plan version as positions, in session order. */
export function sessionsOfVersion(
  planItems: readonly ArnoldPlanItem[],
  planVersionId: string,
): AdjustedSession[] {
  const groups = new Map<string, ArnoldPlanItem[]>();
  for (const item of planItems) {
    if (item.plan_version_id !== planVersionId || item.status !== "active")
      continue;
    const bucket = groups.get(item.session_id);
    if (bucket) bucket.push(item);
    else groups.set(item.session_id, [item]);
  }
  return [...groups.values()]
    .sort(
      (a, b) =>
        a[0]!.session_order - b[0]!.session_order ||
        (a[0]!.session_id < b[0]!.session_id ? -1 : 1),
    )
    .map((items) => ({
      session_id: items[0]!.session_id,
      session_name: items[0]!.session_name,
      items: items
        .sort((a, b) => a.exercise_order - b.exercise_order)
        .map((source) => ({
          source,
          exercise_id: source.exercise_id,
          target_sets: source.target_sets,
          rest_seconds: source.rest_seconds,
          replaced: false,
        })),
    }));
}

/** Swaps and removals for the equipment at hand, applied to every session. */
function withEquipment(
  sessions: AdjustedSession[],
  request: AdjustmentRequest,
): AdjustedSession[] {
  const swap = new Map(
    request.replacements.map((r) => [r.from_exercise_id, r.to_exercise_id]),
  );
  const removed = new Set(request.remove_exercise_ids);
  return sessions
    .map((session) => ({
      ...session,
      items: session.items
        .filter((item) => !removed.has(item.exercise_id))
        .map((item) => {
          const to = swap.get(item.exercise_id);
          return to ? { ...item, exercise_id: to, replaced: true } : item;
        }),
    }))
    .filter((session) => session.items.length > 0);
}

/** `sessions` rotated so that `firstId` comes first (the next one due). */
function fromNext(sessions: AdjustedSession[], firstId: string | null) {
  const at = sessions.findIndex((s) => s.session_id === firstId);
  return at <= 0 ? sessions : [...sessions.slice(at), ...sessions.slice(0, at)];
}

/**
 * Short full-body sessions that hold the level ("diesen Monat keine Zeit"):
 * `count` sessions, each with up to the time budget's exercises, picking
 * basic exercises first and a new muscle group first, so each session covers
 * the body and the sessions differ where the plan allows.
 */
function maintenanceSessions(
  sessions: AdjustedSession[],
  exercises: ReadonlyMap<string, ArnoldExercise>,
  count: number,
  minutes: number,
): AdjustedSession[] {
  const seen = new Set<string>();
  const pool = byImportance(
    sessions.flatMap((s) => s.items),
    exercises,
  ).filter((item) => {
    if (seen.has(item.exercise_id)) return false;
    seen.add(item.exercise_id);
    return true;
  });
  const budget = exerciseBudget(minutes).max;
  const used = new Set<string>();
  const result: AdjustedSession[] = [];
  for (let k = 0; k < count; k++) {
    const picked: AdjustedItem[] = [];
    const groups = new Set<string>();
    const muscle = (i: AdjustedItem) =>
      exercises.get(i.exercise_id)?.primary_muscle ?? i.exercise_id;
    // New exercise of a new group, then any of a new group, then anything.
    for (const pass of [0, 1, 2] as const)
      for (const item of pool) {
        if (picked.length >= budget) break;
        if (picked.includes(item)) continue;
        if (pass < 2 && groups.has(muscle(item))) continue;
        if (pass === 0 && used.has(item.exercise_id)) continue;
        picked.push(item);
        groups.add(muscle(item));
      }
    picked.forEach((item) => used.add(item.exercise_id));
    if (!picked.length) break;
    result.push({
      session_id: `full-body-${k + 1}`,
      session_name: `Ganzkörper kurz ${String.fromCharCode(65 + k)}`,
      items: shortenSession(
        picked.map((item, i) => ({
          ...item,
          source: { ...item.source, exercise_order: i + 1 },
        })),
        exercises,
        minutes,
      ),
    });
  }
  return result;
}

export type AdjustmentContentError =
  "NO_SESSION_TODAY" | "NOTHING_TO_ADJUST" | "NO_SESSION_LEFT";

/**
 * The sessions of an adjustment, from the base plan's sessions.
 *
 * today: the next session due, shortened to the minutes.
 * week:  the next `sessions_per_week` sessions (or all), each shortened.
 * month: `sessions_per_week` (default 2) short full-body sessions of
 *        `minutes_per_session` (default 30) that hold the level.
 * range: the plan with fewer days and/or shorter sessions, as asked.
 * Equipment swaps and removals apply first in every case.
 */
export function adjustedSessions(
  base: AdjustedSession[],
  exercises: ReadonlyMap<string, ArnoldExercise>,
  request: AdjustmentRequest,
  nextSessionId: string | null,
): AdjustedSession[] | AdjustmentContentError {
  const sessions = withEquipment(fromNext(base, nextSessionId), request);
  if (!sessions.length) return "NO_SESSION_LEFT";
  const shorten = (list: AdjustedSession[]) =>
    request.minutes_per_session === null
      ? list
      : list.map((s) => ({
          ...s,
          items: shortenSession(
            s.items,
            exercises,
            request.minutes_per_session!,
          ),
        }));
  if (request.kind === "today") {
    if (!nextSessionId || sessions[0]!.session_id !== nextSessionId)
      return "NO_SESSION_TODAY";
    return shorten([sessions[0]!]);
  }
  if (request.kind === "month")
    return maintenanceSessions(
      sessions,
      exercises,
      Math.min(request.sessions_per_week ?? 2, sessions.length),
      request.minutes_per_session ?? 30,
    );
  const changed =
    request.minutes_per_session !== null ||
    request.sessions_per_week !== null ||
    request.replacements.length > 0 ||
    request.remove_exercise_ids.length > 0;
  if (!changed) return "NOTHING_TO_ADJUST";
  return shorten(
    request.sessions_per_week === null
      ? sessions
      : sessions.slice(0, request.sessions_per_week),
  );
}
