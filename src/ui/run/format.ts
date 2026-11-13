/**
 * Wording and number formatting for the run cards. Nothing here computes a
 * figure: seconds, metres and paces arrive from Arnold's run tools and are only
 * written out in German. A missing value is "–" with its reason, never 0.
 */
import { UNKNOWN, formatNumber } from "../format";
import type { RunType } from "../../shared/run-contract";

export { UNKNOWN };

export const RUN_TYPE_LABEL: Record<RunType, string> = {
  recovery: "Regenerationslauf",
  base: "Grundlagenlauf",
  long: "Langer Lauf",
  progression: "Steigerungslauf",
  tempo: "Tempodauerlauf",
  threshold_intervals: "Schwellenintervalle",
  intervals: "Intervalle",
  repetitions: "Kurze Wiederholungen",
  strides: "Steigerungen",
  hills: "Bergläufe",
  fartlek: "Fahrtspiel",
  run_walk: "Lauf-Geh",
  test: "Test oder Wettkampf",
  free: "Freier Lauf",
};
export const ENVIRONMENT_LABEL = {
  outdoor: "Draußen",
  treadmill: "Laufband",
  track: "Bahn",
} as const;

export const WEEKDAY_LONG = [
  "Montag",
  "Dienstag",
  "Mittwoch",
  "Donnerstag",
  "Freitag",
  "Samstag",
  "Sonntag",
];

/** Minutes as the user says them: "45 Min." or "1 Std. 20 Min.". */
export function minutesLabel(minutes: number | null | undefined): string {
  if (minutes === null || minutes === undefined) return UNKNOWN;
  const whole = Math.round(minutes);
  return whole >= 60
    ? `${Math.floor(whole / 60)} Std.${whole % 60 ? ` ${whole % 60} Min.` : ""}`
    : `${whole} Min.`;
}

/** A time of the run: "52:10" or "1:05:30". */
export function clockLabel(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined) return UNKNOWN;
  const total = Math.round(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const two = (n: number) => String(n).padStart(2, "0");
  return h ? `${h}:${two(m)}:${two(s)}` : `${m}:${two(s)}`;
}

export function secondsAsMinutes(seconds: number | null | undefined) {
  return seconds === null || seconds === undefined
    ? UNKNOWN
    : minutesLabel(seconds / 60);
}

export function distanceLabel(meters: number | null | undefined): string {
  if (meters === null || meters === undefined) return UNKNOWN;
  return `${formatNumber(meters / 1000, meters >= 10_000 ? 1 : 2)} km`;
}

export function paceLabel(secondsPerKm: number | null | undefined): string {
  if (secondsPerKm === null || secondsPerKm === undefined) return UNKNOWN;
  return `${clockLabel(secondsPerKm)} /km`;
}

export function percentLabel(share: number | null | undefined): string {
  return share === null || share === undefined
    ? UNKNOWN
    : `${formatNumber(share * 100, 0)} %`;
}

/** Why Arnold does not know a value, in everyday German. */
const REASON: Record<string, string> = {
  run_not_completed: "Der Lauf ist noch nicht gelaufen.",
  timer_missing: "Keine Zeit gespeichert.",
  timer_zero: "Keine Zeit gespeichert.",
  distance_missing: "Keine Distanz gespeichert.",
  distance_zero: "Keine Distanz gespeichert.",
  distance_not_measured: "Die Distanz ist nicht per GPS gemessen.",
  no_splits: "Keine Kilometerzeiten gespeichert.",
  splits_invalid: "Die Kilometerzeiten sind nicht verwertbar.",
  distance_not_covered: "Der Lauf ist dafür zu kurz.",
  treadmill_no_bests: "Auf dem Laufband zählt Arnold keine Bestzeiten.",
  treadmill_estimated_distance: "Die Laufband-Distanz ist nur geschätzt.",
  no_segments: "Keine Abschnitte gespeichert.",
  segment_skipped: "Ein Abschnitt wurde übersprungen.",
  no_target: "Kein Zielbereich vorgegeben.",
  hr_no_consent:
    "Ohne deine Einwilligung für Gesundheitsdaten nutzt Arnold keinen Puls.",
  hr_no_sensor: "Kein Pulssensor verbunden.",
  hr_not_provided: "Kein Puls angegeben.",
  hr_consent_revoked: "Die Einwilligung für den Puls ist widerrufen.",
  hr_not_recorded: "Kein Puls aufgezeichnet.",
  zone_seconds_missing: "Keine Zeit in den Pulszonen gespeichert.",
  zone_seconds_empty: "Keine Zeit in den Pulszonen gespeichert.",
  hr_samples_missing: "Keine Pulsverlaufsdaten.",
  hr_samples_insufficient: "Zu wenige Pulswerte.",
  shorter_than_45_min: "Gilt erst ab 45 Minuten.",
  rpe_missing: "Anstrengung fehlt.",
  no_load_known: "Belastung nicht bekannt.",
  no_runs: "Noch keine Läufe.",
  no_run_time: "Keine Laufzeit.",
  no_pace_data: "Kein Tempo bekannt.",
  no_zone2_runs: "Noch kein Lauf in Zone 2.",
  nothing_due: "Noch nichts fällig.",
  history_too_short: "Noch zu wenige Tage Verlauf (28 nötig).",
  chronic_load_zero: "Im Vergleichszeitraum keine Belastung.",
  unclassified_run_type: "Lauftyp nicht eingeordnet.",
  not_given: "Nicht angegeben.",
  not_provided: "Nicht angegeben.",
};
export const reasonText = (reason: string | null | undefined) =>
  (reason && REASON[reason]) || "Noch nicht bekannt.";

/** Does the reason mean heart-rate data is missing for lack of consent or sensor? */
export const isHrReason = (reason: string | null | undefined) =>
  !!reason && /^hr_|^zone_seconds|^heart_rate/.test(reason);

/**
 * A metric the server delivers as `{ value, reason }`. Anything that does not
 * look like that is unknown, so a malformed field can never become a number.
 */
export type Metric = { value: unknown; reason: string | null };
export function readMetric(source: unknown, key: string): Metric {
  const raw =
    source && typeof source === "object"
      ? (source as Record<string, unknown>)[key]
      : undefined;
  if (raw && typeof raw === "object" && "value" in raw) {
    const m = raw as { value: unknown; reason?: unknown };
    return {
      value: m.value ?? null,
      reason: typeof m.reason === "string" ? m.reason : null,
    };
  }
  return { value: null, reason: null };
}
export const num = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

/** A sum over several runs: `known` of `total` runs contributed. */
export type Sum = {
  value: number | null;
  known: number;
  total: number;
  reason: string | null;
};
export function readSum(source: unknown, key: string): Sum {
  const raw =
    source && typeof source === "object"
      ? (source as Record<string, unknown>)[key]
      : undefined;
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<
    string,
    unknown
  >;
  return {
    value: num(r.value),
    known: num(r.known) ?? 0,
    total: num(r.total) ?? 0,
    reason: typeof r.reason === "string" ? r.reason : null,
  };
}

/**
 * "aus 3 von 4 Läufen" when only some runs contributed to a sum; empty when
 * all did or there were none. The counts come from the server, never from here.
 */
export function partialNote(sum: Sum): string {
  return sum.total > 0 && sum.known < sum.total
    ? `aus ${sum.known} von ${sum.total} ${sum.total === 1 ? "Lauf" : "Läufen"}`
    : "";
}

/** Heart-rate zone sentence of a run: Arnold's own, else "laut Uhr". */
export const ZONE_BY_WATCH = "Zone 2 laut Uhr";
