import {
  addDays,
  compareDate,
  daysBetween,
  isCalendarDate,
} from "../period.js";

/**
 * VDOT and training paces (ARN-RUN, spec "Intensität"). Pure, no clock: the
 * caller passes today's date.
 *
 * Sources
 * - Daniels, J. T. & Gilbert, J. R. (1979): Oxygen Power. The equations below
 *   (oxygen cost of running and the fraction of VO2max a runner sustains for a
 *   given time).
 * - Daniels, J. (Daniels' Running Formula, Human Kinetics): the VDOT tables
 *   and the intensity definitions of the pace zones (E 59–74 %, T about
 *   88 %, I 95–100 %, R 105–120 % of the VDOT velocity; M = marathon pace of
 *   the VDOT). tests/analytics-running-plan-vdot.test.ts checks the results
 *   against published VDOT table values (VDOT 30/40/50/60/70/80).
 *
 * Unknown stays unknown: without a usable reference performance
 * `referenceVdot` returns a reason and no pace is ever made up.
 */

/** Calendar days a reference performance counts (12 weeks, spec). */
export const REFERENCE_MAX_AGE_DAYS = 84;
/**
 * Reference distances (spec: 3 to 21.1 km). The upper bound allows 2 % for
 * GPS measurement of a half marathon.
 */
export const REFERENCE_MIN_METERS = 3000;
export const REFERENCE_MAX_METERS = 21_500;
/** The VDOT range of the published tables; the engine prescribes paces only inside. */
export const VDOT_MIN = 30;
export const VDOT_MAX = 85;

export const RACE_DISTANCES_M = {
  "5k": 5000,
  "10k": 10_000,
  half_marathon: 21_097.5,
  marathon: 42_195,
} as const;

/** Oxygen cost of running at velocity v (m/min), ml/kg/min. */
function oxygenCost(v: number): number {
  return -4.6 + 0.182258 * v + 0.000104 * v * v;
}

/** Fraction of VO2max that can be sustained for t minutes. */
function sustainedFraction(t: number): number {
  return (
    0.8 +
    0.1894393 * Math.exp(-0.012778 * t) +
    0.2989558 * Math.exp(-0.1932605 * t)
  );
}

/** VDOT of a performance (distance in metres, time in seconds), unrounded. */
export function vdotOf(distance_m: number, time_s: number): number {
  const minutes = time_s / 60;
  return oxygenCost(distance_m / minutes) / sustainedFraction(minutes);
}

/** Velocity (m/min) at which running costs `fraction` of the VDOT. */
function velocityAtFraction(vdot: number, fraction: number): number {
  const a = 0.000104;
  const b = 0.182258;
  const c = -(4.6 + fraction * vdot);
  return (-b + Math.sqrt(b * b - 4 * a * c)) / (2 * a);
}

const paceOfVelocity = (metersPerMinute: number) => 60_000 / metersPerMinute;

/**
 * Race time in seconds a runner with this VDOT achieves over a distance;
 * inverse of `vdotOf` (bisection, VDOT falls as the time grows).
 */
export function predictRaceTime(vdot: number, distance_m: number): number {
  let low = 60;
  let high = 36_000 * 2;
  for (let i = 0; i < 80; i += 1) {
    const mid = (low + high) / 2;
    if (vdotOf(distance_m, mid) > vdot) low = mid;
    else high = mid;
  }
  return (low + high) / 2;
}

/** Why no VDOT (and so no pace) can be derived. */
export const VDOT_REASONS = [
  "reference_missing",
  "reference_source_invalid",
  "reference_distance_out_of_range",
  "reference_time_invalid",
  "reference_date_invalid",
  "reference_in_future",
  "reference_too_old",
  "vdot_below_table",
  "vdot_above_table",
] as const;
export type VdotReason = (typeof VDOT_REASONS)[number];

export type VdotResult =
  | { readonly value: number; readonly reason: null }
  | { readonly value: null; readonly reason: VdotReason };

export interface RunReference {
  readonly distance_m: number | null;
  readonly time_s: number | null;
  /** Local calendar day of the performance. */
  readonly date: string | null;
  readonly source: "test" | "race" | "user" | null;
}

/**
 * VDOT from a reference performance. Valid: a test, a race or the user's own
 * statement (never a normal training run), 3 to 21.1 km, not older than 12
 * weeks, not in the future, VDOT inside the table range. Otherwise the reason.
 */
export function referenceVdot(
  reference: RunReference | null | undefined,
  today: string,
): VdotResult {
  const no = (reason: VdotReason): VdotResult => ({ value: null, reason });
  if (!reference) return no("reference_missing");
  const { distance_m, time_s, date, source } = reference;
  if (
    distance_m === null &&
    time_s === null &&
    date === null &&
    source === null
  )
    return no("reference_missing");
  if (source !== "test" && source !== "race" && source !== "user")
    return no("reference_source_invalid");
  if (
    distance_m === null ||
    !Number.isFinite(distance_m) ||
    distance_m < REFERENCE_MIN_METERS ||
    distance_m > REFERENCE_MAX_METERS
  )
    return no("reference_distance_out_of_range");
  if (time_s === null || !Number.isFinite(time_s) || time_s <= 0)
    return no("reference_time_invalid");
  if (date === null || !isCalendarDate(date) || !isCalendarDate(today))
    return no("reference_date_invalid");
  if (compareDate(date, today) > 0) return no("reference_in_future");
  if (daysBetween(date, today) > REFERENCE_MAX_AGE_DAYS)
    return no("reference_too_old");
  const vdot = vdotOf(distance_m, time_s);
  if (!Number.isFinite(vdot) || vdot < VDOT_MIN) return no("vdot_below_table");
  if (vdot > VDOT_MAX) return no("vdot_above_table");
  return { value: vdot, reason: null };
}

/** Last day a reference of `date` still counts. */
export const referenceValidUntil = (date: string) =>
  addDays(date, REFERENCE_MAX_AGE_DAYS);

/** A pace band in whole seconds per km: `fast` < `slow`. */
export interface PaceBand {
  readonly fast_s_per_km: number;
  readonly slow_s_per_km: number;
}

/** Tempo zones of a VDOT: easy, marathon, threshold, interval, repetition. */
export interface TempoZones {
  readonly vdot: number;
  readonly e: PaceBand;
  readonly m: PaceBand;
  readonly t: PaceBand;
  readonly i: PaceBand;
  readonly r: PaceBand;
}

/** Intensity bands as fractions of the VDOT velocity (Daniels). */
export const PACE_INTENSITY = {
  /** Easy: 59–74 % (Daniels' published E range). */
  e: [0.59, 0.74],
  /** Threshold: 88 % ± 1 point around Daniels' T intensity. */
  t: [0.87, 0.89],
  /** Interval: 95–100 % (published I range). */
  i: [0.95, 1.0],
  /** Repetition: 105–120 % (published R range). */
  r: [1.05, 1.2],
} as const;
/** Marathon band: marathon pace of the VDOT ± this share of the velocity. */
export const MARATHON_BAND_SHARE = 0.02;

const MIN_PACE = 120; // schema bound of a pace target, s/km
const MAX_PACE = 1200;

function band(fastVelocity: number, slowVelocity: number): PaceBand {
  const clamp = (value: number) =>
    Math.min(MAX_PACE, Math.max(MIN_PACE, Math.round(value)));
  const fast = clamp(paceOfVelocity(fastVelocity));
  const slow = Math.max(fast + 1, clamp(paceOfVelocity(slowVelocity)));
  return { fast_s_per_km: fast, slow_s_per_km: slow };
}

/** Tempo zones E/M/T/I/R for a VDOT inside the table range, else null. */
export function tempoZones(vdot: number): TempoZones | null {
  if (!Number.isFinite(vdot) || vdot < VDOT_MIN || vdot > VDOT_MAX) return null;
  const at = (f: number) => velocityAtFraction(vdot, f);
  const byFraction = ([low, high]: readonly [number, number]) =>
    band(at(high), at(low));
  const marathon =
    RACE_DISTANCES_M.marathon /
    (predictRaceTime(vdot, RACE_DISTANCES_M.marathon) / 60);
  return {
    vdot,
    e: byFraction(PACE_INTENSITY.e),
    m: band(
      marathon * (1 + MARATHON_BAND_SHARE),
      marathon * (1 - MARATHON_BAND_SHARE),
    ),
    t: byFraction(PACE_INTENSITY.t),
    i: byFraction(PACE_INTENSITY.i),
    r: byFraction(PACE_INTENSITY.r),
  };
}

/** Tempo zones from a reference performance, or the reason there are none. */
export function referenceTempoZones(
  reference: RunReference | null | undefined,
  today: string,
):
  | { readonly value: TempoZones; readonly reason: null }
  | { readonly value: null; readonly reason: VdotReason } {
  const vdot = referenceVdot(reference, today);
  if (vdot.value === null) return { value: null, reason: vdot.reason };
  const zones = tempoZones(vdot.value);
  // inside the table range by construction
  return zones
    ? { value: zones, reason: null }
    : { value: null, reason: "vdot_below_table" };
}

/** Middle of a band in seconds per km. */
export const paceMid = (band: PaceBand) =>
  Math.round((band.fast_s_per_km + band.slow_s_per_km) / 2);

/** "4:35" for 275 seconds. */
export function formatPace(secondsPerKm: number): string {
  const total = Math.round(secondsPerKm);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}
