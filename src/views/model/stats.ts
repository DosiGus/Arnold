/**
 * Arnold's history → the progress screen ("Trainingsentwicklung").
 *
 * Three series, all from the server: the estimated 1RM of the most trained
 * exercise (`get_arnold_exercise_progress`, its first-to-last comparison
 * comes from the analytics engine within one comparability class), weekly
 * volume and training days (dashboard `weeks`). The change next to the
 * weekly charts is `firstLastChange` from src/analytics. Unknown weeks stay
 * gaps, never 0.
 */
import { firstLastChange, valueRange } from "../../analytics/series-change.js";
import type {
  ArnoldDashboardView,
  ArnoldExerciseProgressView,
} from "../../shared/arnold-view.js";
import { shortDate } from "./dashboard.js";

export const STATS_RANGES = ["4", "8", "12"] as const;
export type StatsRange = (typeof STATS_RANGES)[number];

export type LiveSeries = {
  key: string;
  /** Short name for the switch. */
  label: string;
  /** Heading above the value; the label when absent. */
  title?: string;
  unit: string;
  /** In time order; null is an unknown value, drawn as a gap. */
  points: (number | null)[];
  /** First against last value on screen; null when it cannot be given. */
  delta: number | null;
  /** What the left and right end of the curve stand for; null when empty. */
  axis: { from: string; to: string } | null;
  /** The scale: lowest and highest value on screen; null when unknown. */
  range: { low: number; high: number } | null;
};

/** The weeks on screen: the last `range` weeks up to the current one. */
function weeksIn(view: ArnoldDashboardView, range: StatsRange) {
  const end = view.weeks.findIndex((w) => w.is_current_week);
  const upto = end === -1 ? view.weeks.length : end + 1;
  return view.weeks.slice(Math.max(0, upto - Number(range)), upto);
}

/** First calendar day on screen, for the exercise call's `from`. */
export function rangeStart(
  view: ArnoldDashboardView,
  range: StatsRange,
): string | null {
  return weeksIn(view, range)[0]?.week_start ?? null;
}

/** Exercises with a strength curve: most logged sets first, then name. */
export function statsExercises(
  view: ArnoldDashboardView,
): { id: string; name: string }[] {
  return view.exercises
    .filter((e) => e.logged_sets > 0)
    .sort(
      (a, b) =>
        b.logged_sets - a.logged_sets || a.name.localeCompare(b.name, "de"),
    )
    .map((e) => ({ id: e.exercise_id, name: e.name }));
}

export function weeklySeries(
  view: ArnoldDashboardView,
  range: StatsRange,
): LiveSeries[] {
  const weeks = weeksIn(view, range);
  if (!weeks.length) return [];
  const weekLabel = (w: (typeof weeks)[number]) =>
    w.is_current_week ? "diese Woche" : `Woche ab ${shortDate(w.week_start)}`;
  const axis = {
    from: weekLabel(weeks[0]!),
    to: weekLabel(weeks[weeks.length - 1]!),
  };
  const series = (
    key: string,
    label: string,
    unit: string,
    points: (number | null)[],
  ): LiveSeries => ({
    key,
    label,
    unit,
    points,
    delta: firstLastChange(points)?.delta ?? null,
    axis,
    range: valueRange(points),
  });
  return [
    series(
      "volume",
      "Wochenvolumen",
      "kg",
      weeks.map((w) => w.nominal_volume),
    ),
    series(
      "days",
      "Trainingstage",
      "",
      weeks.map((w) => w.training_days),
    ),
  ];
}

/** One point per measured training day, so the ends carry its dates. */
export function exerciseSeries(
  progress: ArnoldExerciseProgressView,
): LiveSeries {
  const c = progress.selected_comparison;
  const measured = progress.selected_series?.points ?? [];
  const points = measured.map((p) => p.value);
  const first = measured[0];
  const last = measured[measured.length - 1];
  return {
    key: "e1rm",
    label: "Kraft",
    title: `${progress.exercise_name} · geschätztes 1RM`,
    unit: "kg",
    points,
    delta: c && c.status === "valid" ? c.delta : null,
    axis:
      first && last
        ? { from: shortDate(first.date), to: shortDate(last.date) }
        : null,
    range: valueRange(points),
  };
}
