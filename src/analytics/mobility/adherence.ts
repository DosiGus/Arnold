/**
 * Mobility: the "Dranbleiben" figure (ARN-MOB, D-MOB-07).
 *
 * Mobility is neither a training day nor load; it gets its own figure: how
 * much of what was planned in the last `days` calendar days was done, and
 * how many days in a row the user kept it up.
 *
 * Pure and deterministic. Everything is counted by local calendar date
 * (`date_local`, YYYY-MM-DD) as the user lived it; no time stamp is ever
 * converted from UTC. Date arithmetic below only steps whole calendar days.
 * Nothing planned means the ratio is unknown (null), never 0.
 */

export type MobilityPlannedEntry = { date_local: string; session_id: string };
export type MobilityDoneEntry = {
  date_local: string;
  /** Null for a routine done without a plan (logged freely). */
  session_id: string | null;
};

export type MobilityAdherenceInput = {
  planned: readonly MobilityPlannedEntry[];
  done: readonly MobilityDoneEntry[];
  /** Today in the user's time zone, YYYY-MM-DD. */
  today: string;
  /** Window length in calendar days, today included. Default 28. */
  days?: number;
};

export type MobilityAdherence = {
  /** Distinct planned routines (date + session) in the window. */
  planned_count: number;
  /** Routines done in the window (a planned one counts once per day). */
  done_count: number;
  /** Planned routines that were done, by planned count; null without a plan. */
  ratio: number | null;
  /**
   * Days in a row, back from today and inside the window, on which mobility
   * was done and nothing planned was left out. Days with neither plan nor
   * routine are skipped (they neither count nor break the streak); today
   * never breaks it while it is still running.
   */
  streak_days: number;
  days: number;
};

export const MOBILITY_ADHERENCE_DEFAULT_DAYS = 28;
export const MOBILITY_ADHERENCE_MAX_DAYS = 366;

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const isDate = (value: string) =>
  DATE.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));

/** The calendar date `n` days before `date` (pure calendar arithmetic). */
function daysBefore(date: string, n: number): string {
  const ms = Date.parse(`${date}T00:00:00Z`) - n * 86_400_000;
  return new Date(ms).toISOString().slice(0, 10);
}

export function mobilityAdherence(
  input: MobilityAdherenceInput,
): MobilityAdherence {
  const days = input.days ?? MOBILITY_ADHERENCE_DEFAULT_DAYS;
  if (!Number.isInteger(days) || days < 1 || days > MOBILITY_ADHERENCE_MAX_DAYS)
    throw new RangeError(
      `days muss eine ganze Zahl von 1 bis ${MOBILITY_ADHERENCE_MAX_DAYS} sein.`,
    );
  if (!isDate(input.today))
    throw new RangeError("today muss ein Kalenderdatum YYYY-MM-DD sein.");
  const first = daysBefore(input.today, days - 1);
  const inWindow = (date: string) =>
    isDate(date) && date >= first && date <= input.today;

  // Planned routines, distinct by day and session.
  const plannedByDay = new Map<string, Set<string>>();
  for (const p of input.planned) {
    if (!inWindow(p.date_local)) continue;
    const set = plannedByDay.get(p.date_local) ?? new Set<string>();
    set.add(p.session_id);
    plannedByDay.set(p.date_local, set);
  }
  // Done routines: a session once per day; free routines each count.
  const doneSessions = new Map<string, Set<string>>();
  const freeDone = new Map<string, number>();
  for (const d of input.done) {
    if (!inWindow(d.date_local)) continue;
    if (d.session_id === null)
      freeDone.set(d.date_local, (freeDone.get(d.date_local) ?? 0) + 1);
    else {
      const set = doneSessions.get(d.date_local) ?? new Set<string>();
      set.add(d.session_id);
      doneSessions.set(d.date_local, set);
    }
  }

  let plannedCount = 0;
  let matched = 0;
  // Per day: is everything planned covered? A free routine stands in for one
  // planned routine of the same day that was not done by its own session.
  const covered = new Map<string, boolean>();
  for (const [date, sessions] of plannedByDay) {
    const done = doneSessions.get(date) ?? new Set<string>();
    let open = 0;
    for (const id of sessions) if (!done.has(id)) open++;
    const filled = Math.min(open, freeDone.get(date) ?? 0);
    plannedCount += sessions.size;
    matched += sessions.size - open + filled;
    covered.set(date, open - filled === 0);
  }
  let doneCount = 0;
  for (const set of doneSessions.values()) doneCount += set.size;
  for (const n of freeDone.values()) doneCount += n;

  let streak = 0;
  for (let back = 0; back < days; back++) {
    const date = daysBefore(input.today, back);
    const didSomething =
      (doneSessions.get(date)?.size ?? 0) + (freeDone.get(date) ?? 0) > 0;
    const planned = plannedByDay.has(date);
    if (planned && !covered.get(date)) {
      if (back === 0) continue; // today is not over yet
      break;
    }
    if (didSomething) streak++;
  }

  return {
    planned_count: plannedCount,
    done_count: doneCount,
    ratio: plannedCount === 0 ? null : matched / plannedCount,
    streak_days: streak,
    days,
  };
}
