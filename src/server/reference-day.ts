/**
 * The calendar day "today" of the overview (UX-016).
 *
 * The day comes from the user's own time zone, never from a UTC cut of the
 * server clock: shortly after local midnight the UTC day is still yesterday,
 * and a workout saved just now would lie "in the future" for the server.
 *
 * Without a known zone the answer is honest about it: `source: "fallback"`,
 * the UTC day as the anchor and `recap_until` one day later, so a workout of
 * any calendar day on earth is never hidden. Nothing is marked "today" then.
 */
import { addDays } from "../analytics/period.js";

export type ReferenceDay = Readonly<{
  /** Anchor for the current week and the like (YYYY-MM-DD). */
  date: string;
  /** The IANA zone the day was calculated in; null in the fallback. */
  timezone: string | null;
  source: "timezone" | "fallback";
  /** Latest `workout_date_local` the recap may show. */
  recap_until: string;
}>;

/** True for a name `Intl` knows as an IANA zone (e.g. Europe/Berlin). */
export function isTimeZone(value: string): boolean {
  if (value.length === 0 || value.length > 64) return false;
  try {
    new Intl.DateTimeFormat("en", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

/** The local calendar day of an instant in a zone (YYYY-MM-DD). */
export function localDayOf(now: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone }).format(now);
}

export function referenceDay(
  now: Date,
  timezone?: string | null,
): ReferenceDay {
  if (timezone && isTimeZone(timezone)) {
    const date = localDayOf(now, timezone);
    return { date, timezone, source: "timezone", recap_until: date };
  }
  const utc = now.toISOString().slice(0, 10);
  return {
    date: utc,
    timezone: null,
    source: "fallback",
    recap_until: addDays(utc, 1),
  };
}
