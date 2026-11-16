/**
 * Watch part of recovery (UX-015, read by UX-009): picks from the stored
 * daily health values what the recovery score needs. Pure, no I/O, no
 * clock: the reference day comes from the caller.
 *
 *   - newest resting heart rate with its day
 *   - own median of the resting heart rate over the 28 days up to the
 *     reference day, with the number of values it rests on
 *   - newest Body Battery (high of the day) and newest sleep (duration and
 *     score), each with its day
 *
 * Anything missing is `null` ("unbekannt"), never 0. Days after the
 * reference day are ignored. Local types on purpose: the layer imports
 * nothing from the server.
 */

/** One stored local day; unknown values are null. */
export interface DailyHealthInput {
  local_date: string;
  resting_hr_bpm: number | null;
  body_battery_high: number | null;
  body_battery_end_of_day: number | null;
  sleep_seconds: number | null;
  sleep_score: number | null;
}

export interface DatedValue {
  value: number;
  local_date: string;
}

export interface DailyHealthRecovery {
  reference_date: string;
  resting_hr: DatedValue | null;
  resting_hr_median_28d: { value: number; count: number } | null;
  body_battery: {
    high: number | null;
    end_of_day: number | null;
    local_date: string;
  } | null;
  sleep: {
    seconds: number | null;
    score: number | null;
    local_date: string;
  } | null;
}

export const RESTING_HR_WINDOW_DAYS = 28;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

function shiftDate(date: string, days: number): string {
  const ms = Date.parse(`${date}T00:00:00Z`) + days * 86_400_000;
  return new Date(ms).toISOString().slice(0, 10);
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

const known = (v: number | null | undefined): v is number =>
  typeof v === "number" && Number.isFinite(v);

export function dailyHealthRecovery(
  days: readonly DailyHealthInput[],
  referenceDate: string,
): DailyHealthRecovery {
  if (!DATE.test(referenceDate))
    throw new RangeError("referenceDate must be YYYY-MM-DD");
  // Newest first, nothing after the reference day, one entry per day.
  const seen = new Set<string>();
  const usable = days
    .filter((d) => DATE.test(d.local_date) && d.local_date <= referenceDate)
    .sort((a, b) => b.local_date.localeCompare(a.local_date))
    .filter((d) => !seen.has(d.local_date) && seen.add(d.local_date));

  const restingDay = usable.find((d) => known(d.resting_hr_bpm));
  const windowStart = shiftDate(referenceDate, -(RESTING_HR_WINDOW_DAYS - 1));
  const window = usable
    .filter((d) => d.local_date >= windowStart)
    .map((d) => d.resting_hr_bpm)
    .filter(known);
  const batteryDay = usable.find(
    (d) => known(d.body_battery_high) || known(d.body_battery_end_of_day),
  );
  const sleepDay = usable.find(
    (d) => known(d.sleep_seconds) || known(d.sleep_score),
  );

  return {
    reference_date: referenceDate,
    resting_hr: restingDay
      ? { value: restingDay.resting_hr_bpm!, local_date: restingDay.local_date }
      : null,
    resting_hr_median_28d:
      window.length > 0
        ? { value: median(window), count: window.length }
        : null,
    body_battery: batteryDay
      ? {
          high: batteryDay.body_battery_high ?? null,
          end_of_day: batteryDay.body_battery_end_of_day ?? null,
          local_date: batteryDay.local_date,
        }
      : null,
    sleep: sleepDay
      ? {
          seconds: sleepDay.sleep_seconds ?? null,
          score: sleepDay.sleep_score ?? null,
          local_date: sleepDay.local_date,
        }
      : null,
  };
}
