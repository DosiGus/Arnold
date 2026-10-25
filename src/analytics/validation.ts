import { z } from "zod";
import { compareDate, isCalendarDate } from "./period.js";
import {
  AnalyticsFilterSchema,
  type AnalyticsFilter,
  type AnalyticsReason,
  type Coverage,
  type MetricStatus,
  type MetricUnit,
  type MetricValue,
} from "./types.js";

/** Controlled error for a rejected filter; never thrown for a filter that merely matches nothing. */
export class AnalyticsFilterError extends Error {
  constructor(readonly issues: readonly string[]) {
    super(`Ungültiger Analysefilter: ${issues.join("; ")}`);
    this.name = "AnalyticsFilterError";
  }
}

/**
 * Trims float noise from kg multiplications without ever producing a non-finite
 * number: scaling an already extreme value would overflow, so such a value is
 * returned unrounded and the finiteness checks downstream decide what to do.
 */
export function round(value: number): number {
  if (!Number.isFinite(value)) return value;
  const scaled = Math.round(value * 1e6);
  return Number.isFinite(scaled) ? scaled / 1e6 : value;
}

const calendarDate = z
  .string()
  .refine(
    isCalendarDate,
    "Datum muss ein echtes Kalenderdatum YYYY-MM-DD sein.",
  );
const idList = z
  .array(z.string().min(1))
  .min(1, "Eine ID-Liste darf nicht leer sein.");

const filterInputSchema = z
  .strictObject({
    from: calendarDate.nullish(),
    to: calendarDate.nullish(),
    exercise_ids: idList.nullish(),
    plan_version_ids: idList.nullish(),
    session_ids: idList.nullish(),
    workout_ids: idList.nullish(),
    set_types: z
      .array(z.enum(["warmup", "working", "drop", "failure", "other"]))
      .min(1)
      .nullish(),
    workout_statuses: z
      .array(
        z.enum(["planned", "in_progress", "completed", "cancelled", "voided"]),
      )
      .min(1)
      .nullish(),
  })
  .partial();
export type AnalyticsFilterInput = z.input<typeof filterInputSchema>;

function unique<T>(
  values: readonly T[] | null | undefined,
): readonly T[] | null {
  if (!values) return null;
  return Object.freeze([...new Set(values)]);
}

/**
 * Validates and normalises a filter. IDs are the technical selectors; names are
 * never accepted, so renaming a session or an exercise cannot break a saved view.
 * Bounds are inclusive.
 */
export function parseAnalyticsFilter(
  input: AnalyticsFilterInput = {},
): AnalyticsFilter {
  const parsed = filterInputSchema.safeParse(input);
  if (!parsed.success)
    throw new AnalyticsFilterError(
      parsed.error.issues.map(
        (issue) => `${issue.path.join(".") || "filter"}: ${issue.message}`,
      ),
    );
  const data = parsed.data;
  if (data.from && data.to && compareDate(data.from, data.to) > 0)
    throw new AnalyticsFilterError([
      "from: Startdatum liegt nach dem Enddatum.",
    ]);
  return AnalyticsFilterSchema.parse({
    from: data.from ?? null,
    to: data.to ?? null,
    exercise_ids: unique(data.exercise_ids),
    plan_version_ids: unique(data.plan_version_ids),
    session_ids: unique(data.session_ids),
    workout_ids: unique(data.workout_ids),
    set_types: unique(data.set_types),
    workout_statuses: unique(data.workout_statuses),
  });
}

/** Reasons are deduplicated and ordered so results stay byte-stable. */
export function freezeReasons(
  reasons: Iterable<AnalyticsReason>,
): readonly AnalyticsReason[] {
  return Object.freeze([...new Set(reasons)].sort());
}

export function coverage(
  eligible: number,
  included: number,
  reasons: Iterable<AnalyticsReason>,
): Coverage {
  return Object.freeze({
    eligible_sets: eligible,
    included_sets: included,
    excluded_sets: eligible - included,
    excluded_reasons: freezeReasons(reasons),
  });
}

export function metric(
  name: string,
  value: number | null,
  unit: MetricUnit,
  status: MetricStatus,
  reasons: Iterable<AnalyticsReason> = [],
  cover: Coverage | null = null,
): MetricValue {
  const usable = value !== null && Number.isFinite(value);
  return Object.freeze({
    metric: name,
    value: usable ? value : null,
    unit,
    status: usable ? status : status === "valid" ? "not_available" : status,
    reasons: freezeReasons(reasons),
    coverage: cover,
  });
}

/** A plain, fully known number. */
export function exact(
  name: string,
  value: number,
  unit: MetricUnit,
  cover: Coverage | null = null,
): MetricValue {
  return metric(name, value, unit, "valid", [], cover);
}

export function unavailable(
  name: string,
  unit: MetricUnit,
  reasons: Iterable<AnalyticsReason>,
  cover: Coverage | null = null,
): MetricValue {
  return metric(name, null, unit, "not_available", reasons, cover);
}

/**
 * Sum of contributions that could be computed.
 *
 * Nothing eligible at all is a genuine zero: no training means no volume.
 * Eligible contributions that are all uncomputable are *unknown*, never zero,
 * so the value stays `null`. A partially covered sum is marked `partial` and
 * carries the reasons for everything it had to leave out.
 */
export function coveredSum(
  name: string,
  unit: MetricUnit,
  values: readonly (number | null)[],
  excluded: Iterable<AnalyticsReason>,
  caveats: Iterable<AnalyticsReason> = [],
): MetricValue {
  const included = values.filter((value): value is number => value !== null);
  const sum = included.reduce((total, value) => total + value, 0);
  const excludedReasons = freezeReasons(excluded);
  const cover = coverage(values.length, included.length, excludedReasons);
  if (values.length && !included.length)
    return metric(name, null, unit, "not_available", excludedReasons, cover);
  if (!Number.isFinite(sum))
    return metric(name, null, unit, "invalid", ["volume_not_finite"], cover);
  return metric(
    name,
    round(sum),
    unit,
    excludedReasons.length ? "partial" : "valid",
    [...excludedReasons, ...caveats],
    cover,
  );
}

export function tally<K extends string>(
  counters: ReadonlyMap<K, number>,
): Record<K, number> {
  return Object.fromEntries(
    [...counters].sort(([a], [b]) => (a < b ? -1 : 1)),
  ) as Record<K, number>;
}

export function bump<K>(counters: Map<K, number>, key: K, by = 1): void {
  counters.set(key, (counters.get(key) ?? 0) + by);
}

/** Controlled error for analytics options outside their documented range. */
export class AnalyticsOptionsError extends Error {
  constructor(readonly issues: readonly string[]) {
    super(`Ungültige Analyseoptionen: ${issues.join("; ")}`);
    this.name = "AnalyticsOptionsError";
  }
}
