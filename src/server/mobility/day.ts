/**
 * What the plan and the history say about mobility on a given day (ARN-MOB).
 *
 * Pure: nothing here reads a store or a clock. `mobilityDayInputsOf` reduces a
 * complete dataset to the few plain facts the overview, the start screen and
 * the "Dranbleiben" figure need; the functions after it answer for one local
 * calendar day. Every day is a local calendar date (`workout_date_local`,
 * YYYY-MM-DD): the weekday of a date is the weekday of that date, and no
 * instant is ever cut at UTC midnight except the activation instant of a plan
 * when no zone is known.
 */
import {
  mobilityAdherence,
  MOBILITY_ADHERENCE_DEFAULT_DAYS,
  type MobilityAdherence,
  type MobilityDoneEntry,
  type MobilityPlannedEntry,
} from "../../analytics/mobility/adherence.js";
import {
  isMobilityWorkout,
  isStrengthWorkout,
  type ArnoldDataset,
} from "../../shared/arnold-schema-v1.js";
import type {
  MobilityKind,
  MobilityTemplate,
} from "../../shared/mobility-contract.js";
import { localDayOf } from "../reference-day.js";

/** One active mobility routine of the active plan. */
export type MobilityDaySession = Readonly<{
  session_id: string;
  kind: MobilityKind;
  session_name: string;
  session_order: number;
  minutes: number;
  placement: "own_day" | "after_strength";
  /** ISO weekdays, 1 = Monday; empty after strength. */
  weekdays: readonly number[];
  after_session_id: string | null;
  template: MobilityTemplate;
}>;

export type MobilityDoneRoutine = Readonly<{
  workout_id: string;
  date_local: string;
  /** Null for a routine done without a plan. */
  session_id: string | null;
}>;

/** The plain facts, small enough to travel with a dataset. */
export type MobilityDayInputs = Readonly<{
  /** Null: the question was never asked. */
  wants: boolean | null;
  plan_activated_at_utc: string | null;
  sessions: readonly MobilityDaySession[];
  /** The strength session that comes next in the active plan; null if none. */
  next_strength_session_id: string | null;
  /** Completed strength workouts of the sessions mobility follows. */
  strength_done: readonly Readonly<{
    date_local: string;
    session_id: string;
  }>[];
  done: readonly MobilityDoneRoutine[];
}>;

/** A dataset that carries the mobility facts next to its strength view. */
export type DatasetWithMobility = ArnoldDataset &
  Readonly<{ mobilityDay?: MobilityDayInputs }>;

const DAY_MS = 86_400_000;

/** The calendar date `n` days after `date` (n may be negative). */
export function addCalendarDays(date: string, n: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + n * DAY_MS)
    .toISOString()
    .slice(0, 10);
}

/** ISO weekday of a calendar date: 1 = Monday … 7 = Sunday. */
export function isoWeekday(date: string): number {
  const day = new Date(Date.parse(`${date}T00:00:00Z`)).getUTCDay();
  return day === 0 ? 7 : day;
}

/** The plan that applies now: the latest activated active version. */
function activePlan(dataset: ArnoldDataset) {
  return [...dataset.plans]
    .filter((p) => p.status === "active" && p.activated_at_utc !== null)
    .sort((a, b) => b.activated_at_utc!.localeCompare(a.activated_at_utc!))[0];
}

export function mobilityDayInputsOf(dataset: ArnoldDataset): MobilityDayInputs {
  const profile = dataset.mobilityProfiles?.[0];
  const plan = activePlan(dataset);
  const sessions: MobilityDaySession[] = plan
    ? (dataset.planMobilitySessions ?? [])
        .filter(
          (s) =>
            s.plan_version_id === plan.plan_version_id && s.status === "active",
        )
        .sort((a, b) => a.session_order - b.session_order)
        .map((s) => ({
          session_id: s.session_id,
          kind: s.kind,
          session_name: s.session_name,
          session_order: s.session_order,
          minutes: s.minutes,
          placement: s.placement,
          weekdays: [...s.weekdays],
          after_session_id: s.after_session_id,
          template: s.template,
        }))
    : [];

  // The next strength session, like the start screen names it.
  let next: string | null = null;
  const anchors = new Set(
    sessions.flatMap((s) => (s.after_session_id ? [s.after_session_id] : [])),
  );
  let strengthDone: { date_local: string; session_id: string }[] = [];
  if (plan) {
    const order = new Map<string, number>();
    for (const item of dataset.planItems)
      if (
        item.plan_version_id === plan.plan_version_id &&
        item.status === "active"
      )
        order.set(
          item.session_id,
          Math.min(order.get(item.session_id) ?? Infinity, item.session_order),
        );
    const ordered = [...order.entries()].sort(
      ([a, x], [b, y]) => x - y || (a < b ? -1 : 1),
    );
    const completed = dataset.workouts.filter(
      (w) => isStrengthWorkout(w) && w.status === "completed" && w.session_id,
    );
    const last = completed
      .filter((w) => w.plan_version_id === plan.plan_version_id)
      .sort(
        (a, b) =>
          a.workout_date_local.localeCompare(b.workout_date_local) ||
          a.created_at_utc.localeCompare(b.created_at_utc),
      )
      .at(-1);
    if (ordered.length) {
      const index = last
        ? ordered.findIndex(([id]) => id === last.session_id)
        : -1;
      next = ordered[(index + 1) % ordered.length]![0];
    }
    strengthDone = completed
      .filter((w) => anchors.has(w.session_id!))
      .map((w) => ({
        date_local: w.workout_date_local,
        session_id: w.session_id!,
      }));
  }

  return {
    wants: profile ? profile.wants : null,
    plan_activated_at_utc: plan?.activated_at_utc ?? null,
    sessions,
    next_strength_session_id: next,
    strength_done: strengthDone,
    done: dataset.workouts
      .filter((w) => isMobilityWorkout(w) && w.status === "completed")
      .map((w) => ({
        workout_id: w.workout_id,
        date_local: w.workout_date_local,
        session_id: w.session_id,
      })),
  };
}

/** One routine that is due on a day. */
export type MobilityDueToday = Readonly<{
  session: MobilityDaySession;
  done: boolean;
}>;

/**
 * The routines due on `today`: the morning routine and own-day sessions by
 * weekday; a session after strength only when its strength session is the next
 * one (or was done today, so the routine can still follow it), otherwise not.
 */
export function mobilityDueToday(
  inputs: MobilityDayInputs,
  today: string,
): MobilityDueToday[] {
  const weekday = isoWeekday(today);
  const doneToday = new Set(
    inputs.done
      .filter((d) => d.date_local === today && d.session_id !== null)
      .map((d) => d.session_id),
  );
  const trainedToday = new Set(
    inputs.strength_done
      .filter((d) => d.date_local === today)
      .map((d) => d.session_id),
  );
  return inputs.sessions
    .filter((s) =>
      s.placement === "own_day"
        ? s.weekdays.includes(weekday)
        : s.after_session_id !== null &&
          (s.after_session_id === inputs.next_strength_session_id ||
            trainedToday.has(s.after_session_id)),
    )
    .map((session) => ({ session, done: doneToday.has(session.session_id) }));
}

/** The local day a plan was activated; the UTC day when no zone is known. */
function activatedDay(inputs: MobilityDayInputs, timezone: string | null) {
  if (!inputs.plan_activated_at_utc) return null;
  return timezone
    ? localDayOf(new Date(inputs.plan_activated_at_utc), timezone)
    : inputs.plan_activated_at_utc.slice(0, 10);
}

/**
 * Planned routines of the last `days` days up to `today`, counted from the day
 * the plan was activated. Today's routines count only once they are done: a
 * morning routine still open at 07:00 is not yet a miss.
 */
export function mobilityPlannedEntries(
  inputs: MobilityDayInputs,
  today: string,
  timezone: string | null,
  days = MOBILITY_ADHERENCE_DEFAULT_DAYS,
): MobilityPlannedEntry[] {
  const from = activatedDay(inputs, timezone);
  if (from === null) return [];
  const first = addCalendarDays(today, -(days - 1));
  const start = from > first ? from : first;
  const doneToday = new Set(
    inputs.done
      .filter((d) => d.date_local === today && d.session_id !== null)
      .map((d) => d.session_id),
  );
  const entries: MobilityPlannedEntry[] = [];
  const push = (date_local: string, session_id: string) => {
    if (date_local < start || date_local > today) return;
    if (date_local === today && !doneToday.has(session_id)) return;
    entries.push({ date_local, session_id });
  };
  for (const s of inputs.sessions) {
    if (s.placement === "own_day") {
      for (let date = start; date <= today; date = addCalendarDays(date, 1))
        if (s.weekdays.includes(isoWeekday(date))) push(date, s.session_id);
    } else
      for (const d of inputs.strength_done)
        if (d.session_id === s.after_session_id)
          push(d.date_local, s.session_id);
  }
  return entries;
}

export function mobilityAdherenceOf(
  inputs: MobilityDayInputs,
  today: string,
  timezone: string | null,
): MobilityAdherence {
  const done: MobilityDoneEntry[] = inputs.done.map((d) => ({
    date_local: d.date_local,
    session_id: d.session_id,
  }));
  return mobilityAdherence({
    planned: mobilityPlannedEntries(inputs, today, timezone),
    done,
    today,
  });
}
