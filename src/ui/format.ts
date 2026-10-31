/**
 * Display helpers for the v2 dashboard.
 *
 * All load and execution wording comes from `shared/arnold-format`; this module
 * only adds date formatting and the rule for rendering a `ViewMetric`. No
 * component formats a weight on its own.
 */
import {
  formatNumber,
  LOAD_BASIS_LABEL,
  UNKNOWN,
} from "../shared/arnold-format";
import type { ViewMetric } from "../shared/arnold-view";

export {
  describeSet,
  EXECUTION_MODE_LABEL,
  formatExecution,
  formatLoad,
  formatNumber,
  formatReps,
  formatSetLine,
  LOAD_BASIS_LABEL,
  REPS_BASIS_LABEL,
  SET_TYPE_LABEL,
  SIDE_LABEL,
  UNKNOWN,
  WORKOUT_STATUS_LABEL,
} from "../shared/arnold-format";

const SHORT = new Intl.DateTimeFormat("de-DE", {
  day: "numeric",
  month: "short",
  timeZone: "UTC",
});
const LONG = new Intl.DateTimeFormat("de-DE", {
  day: "numeric",
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});

/** Midday UTC keeps a date-only value on its own calendar day in every zone. */
export function dateLabel(date: string, long = false): string {
  const parsed = new Date(`${date}T12:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return date;
  return (long ? LONG : SHORT).format(parsed);
}

export function dateTimeLabel(iso: string): string {
  const parsed = new Date(iso);
  return Number.isNaN(parsed.getTime())
    ? iso
    : parsed.toLocaleString("de-DE", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
}

export const UNIT_LABEL: Record<string, string> = {
  kg: "kg",
  reps: "Wdh.",
  sets: "Sätze",
  workouts: "Einheiten",
  days: "Tage",
  weeks: "Wochen",
  ratio: "%",
  count: "",
};

/**
 * A metric as it appears on screen. An unknown value becomes the neutral
 * placeholder, never `0`, and the unit is dropped with it so "– kg" cannot be
 * mistaken for a measurement of zero kilograms.
 */
export function metricDisplay(metric: ViewMetric): {
  value: string;
  unit: string;
  known: boolean;
} {
  if (metric.value === null) return { value: UNKNOWN, unit: "", known: false };
  const digits = metric.unit === "kg" || metric.unit === "ratio" ? 1 : 0;
  const value =
    metric.unit === "ratio"
      ? formatNumber(metric.value * 100, 0)
      : formatNumber(metric.value, digits);
  return { value, unit: UNIT_LABEL[metric.unit] ?? "", known: true };
}

/** Full sentence for assistive technology, including the reason when unknown. */
export function metricAriaLabel(metric: ViewMetric): string {
  const shown = metricDisplay(metric);
  if (!shown.known)
    return `${metric.label}: nicht verfügbar. ${metric.note ?? ""}`.trim();
  const basis =
    metric.load_basis && metric.load_basis !== "total"
      ? ` ${LOAD_BASIS_LABEL[metric.load_basis]}`
      : "";
  return `${metric.label}: ${shown.value} ${shown.unit}${basis}`.trim();
}
