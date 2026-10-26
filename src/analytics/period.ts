/**
 * Calendar helpers for the analytics engine.
 *
 * Every function works on `YYYY-MM-DD` local calendar dates taken verbatim from
 * `workout_date_local`. UTC timestamps are never converted into calendar dates,
 * because the stored local date is authoritative for the user's training day.
 * `Date.UTC` is used only as integer date arithmetic, never as a timezone.
 */

const DAY_MS = 86_400_000;
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

/** True for a real calendar date in `YYYY-MM-DD`; rejects 2026-02-30 and 2026-13-01. */
export function isCalendarDate(value: string): boolean {
  const match = DATE_PATTERN.exec(value);
  if (!match) return false;
  const [year, month, day] = match.slice(1).map(Number);
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  const stamp = Date.UTC(year, month - 1, day);
  const date = new Date(stamp);
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

function stampOf(date: string): number {
  const match = DATE_PATTERN.exec(date);
  if (!match) throw new RangeError(`Kein Kalenderdatum: ${date}`);
  const [year, month, day] = match.slice(1).map(Number);
  return Date.UTC(year, month - 1, day);
}

function dateOf(stamp: number): string {
  return new Date(stamp).toISOString().slice(0, 10);
}

/** ISO date strings sort lexicographically, so plain comparison is the ordering. */
export function compareDate(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function addDays(date: string, days: number): string {
  return dateOf(stampOf(date) + days * DAY_MS);
}

export function daysBetween(from: string, to: string): number {
  return Math.round((stampOf(to) - stampOf(from)) / DAY_MS);
}

/** Monday of the week containing `date`; the week start doubles as the stable week key. */
export function weekStart(date: string): string {
  const stamp = stampOf(date);
  const weekday = new Date(stamp).getUTCDay();
  return dateOf(stamp - ((weekday + 6) % 7) * DAY_MS);
}

/**
 * ISO-8601 week label. The Thursday of a week decides its ISO year, so the
 * label stays correct across a year boundary (2026-12-31 is 2026-W53, and
 * 2026-01-01 belongs to 2026-W01 whose Monday is 2025-12-29).
 */
export function isoWeek(date: string): { iso_year: number; iso_week: number } {
  const thursday = addDays(weekStart(date), 3);
  const iso_year = Number(thursday.slice(0, 4));
  const firstWeek = weekStart(`${iso_year}-01-04`);
  return {
    iso_year,
    iso_week: 1 + daysBetween(firstWeek, weekStart(date)) / 7,
  };
}

/** Every Monday from the week of `from` through the week of `to`, inclusive. */
export function weekStartsBetween(from: string, to: string): string[] {
  if (compareDate(from, to) > 0) return [];
  const last = weekStart(to);
  const weeks: string[] = [];
  for (
    let week = weekStart(from);
    compareDate(week, last) <= 0;
    week = addDays(week, 7)
  )
    weeks.push(week);
  return weeks;
}

export function monthKey(date: string): string {
  return date.slice(0, 7);
}

/**
 * Every month touched by `from..to`, inclusive. Derived from the period itself,
 * never from the Monday of its first week: a February selection whose first
 * week starts on 26 January must not report a January bucket.
 */
export function monthsBetween(from: string, to: string): string[] {
  if (compareDate(from, to) > 0) return [];
  const months: string[] = [];
  let year = Number(from.slice(0, 4));
  let month = Number(from.slice(5, 7));
  const last = monthKey(to);
  for (;;) {
    const key = `${year}-${String(month).padStart(2, "0")}`;
    months.push(key);
    if (key >= last) break;
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
  }
  return months;
}
