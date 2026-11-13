import {
  RunHrZoneBoundsSchema,
  type RunSegmentTuple,
} from "../../shared/run-contract.js";

/**
 * Running plan engine, heart-rate zones (ARN-RUN, spec "Intensität"). Pure:
 * no I/O, no clock. Bump `RUN_RULES_VERSION` (version.ts) whenever a bound,
 * a threshold or a rule of the plan engine changes.
 *
 * Zones come from the Garmin profile (D-RUN-06): six ascending bounds, zone n
 * runs from bounds[n-1] to bounds[n]. Without them Garmin's default zones
 * apply: 50, 60, 70, 80, 90 and 100 percent of the maximum heart rate. With
 * neither, no beats are known: the engine then prescribes zone *numbers* and
 * the watch converts them (never an invented bpm).
 */

/** Garmin's default zone bounds in percent of the maximum heart rate. */
export const GARMIN_DEFAULT_ZONE_PERCENT = [50, 60, 70, 80, 90, 100] as const;

/** Meaning of the five zones (spec "Intensität"). */
export const HR_ZONE_MEANING = [
  "Regeneration",
  "Grundlage",
  "zügiger Dauerlauf",
  "Schwelle",
  "VO2max",
] as const;

export type HrZoneSource = "profile" | "max_hr_default" | "none";

/** Zone bounds in bpm, or no bounds at all (`bounds` null, source "none"). */
export interface HrZones {
  readonly source: HrZoneSource;
  /** Six ascending values or null. */
  readonly bounds: readonly number[] | null;
}

export interface HrZoneInput {
  /** Six bounds from the Garmin profile, if the watch sent them. */
  readonly bounds?: readonly number[] | null;
  /** Maximum heart rate, if known (then Garmin's default percentages apply). */
  readonly max_hr?: number | null;
}

/**
 * Zones from the profile bounds; if those are missing or invalid, Garmin's
 * default percentages of the maximum heart rate; if that is unknown too,
 * "none". Invalid input never produces zones.
 */
export function hrZones(input: HrZoneInput = {}): HrZones {
  if (input.bounds) {
    const parsed = RunHrZoneBoundsSchema.safeParse(input.bounds);
    if (parsed.success) return { source: "profile", bounds: parsed.data };
  }
  const max = input.max_hr;
  if (
    typeof max === "number" &&
    Number.isInteger(max) &&
    max >= 100 &&
    max <= 250
  ) {
    const bounds = GARMIN_DEFAULT_ZONE_PERCENT.map((p) =>
      Math.round((max * p) / 100),
    );
    if (RunHrZoneBoundsSchema.safeParse(bounds).success)
      return { source: "max_hr_default", bounds };
  }
  return { source: "none", bounds: null };
}

export interface HrZoneRange {
  readonly zone: number;
  /** Lowest bpm of the zone. */
  readonly low: number;
  /** Highest bpm of the zone (the upper bound is the start of the next zone). */
  readonly high: number;
}

/** Bounds of zone 1–5 in bpm, or null when no bounds are known. */
export function zoneRange(zones: HrZones, zone: number): HrZoneRange | null {
  if (!zones.bounds || !Number.isInteger(zone) || zone < 1 || zone > 5)
    return null;
  return { zone, low: zones.bounds[zone - 1], high: zones.bounds[zone] };
}

/**
 * The zone a heart rate falls in. Below the first bound: 0 (under zone 1);
 * from the last bound upwards: 5. Null when no bounds are known.
 */
export function zoneOfBpm(zones: HrZones, bpm: number): number | null {
  if (!zones.bounds || !Number.isFinite(bpm)) return null;
  if (bpm < zones.bounds[0]) return 0;
  for (let zone = 1; zone <= 4; zone += 1)
    if (bpm < zones.bounds[zone]) return zone;
  return 5;
}

/**
 * Human-readable target for a heart-rate zone target [from, to]: bpm when the
 * zones are known (health consent), else "Zone 2 laut Uhr".
 */
export function describeZoneTarget(
  zones: HrZones,
  from: number,
  to: number,
): string {
  const label = from === to ? `Zone ${from}` : `Zone ${from}–${to}`;
  const low = zoneRange(zones, from);
  const high = zoneRange(zones, to);
  if (!low || !high) return `${label} laut Uhr`;
  return `${label} (${low.low}–${high.high} Schläge)`;
}

/** The zone target of a compact segment as [from, to], or null. */
export function segmentZoneTarget(
  segment: RunSegmentTuple,
): readonly [number, number] | null {
  return segment[3] === 1 ? [segment[4], segment[5]] : null;
}
