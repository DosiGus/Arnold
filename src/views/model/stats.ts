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
import { firstLastChange } from "../../analytics/series-change.js";
import type {
  ArnoldDashboardView,
  ArnoldExerciseProgressView,
} from "../../shared/arnold-view.js";

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

/** The exercise the strength curve shows: most logged sets, then name. */
export function statsExercise(
  view: ArnoldDashboardView,
): { id: string; name: string } | null {
  const best = view.exercises
    .filter((e) => e.logged_sets > 0)
    .sort(
      (a, b) =>
        b.logged_sets - a.logged_sets || a.name.localeCompare(b.name, "de"),
    )[0];
  return best ? { id: best.exercise_id, name: best.name } : null;
}

export function weeklySeries(
  view: ArnoldDashboardView,
  range: StatsRange,
): LiveSeries[] {
  const weeks = weeksIn(view, range);
  if (!weeks.length) return [];
  const volume = weeks.map((w) => w.nominal_volume);
  const days = weeks.map((w) => w.training_days);
  return [
    {
      key: "volume",
      label: "Wochenvolumen",
      unit: "kg",
      points: volume,
      delta: firstLastChange(volume)?.delta ?? null,
    },
    {
      key: "days",
      label: "Trainingstage",
      unit: "",
      points: days,
      delta: firstLastChange(days)?.delta ?? null,
    },
  ];
}

export function exerciseSeries(
  progress: ArnoldExerciseProgressView,
): LiveSeries {
  const c = progress.selected_comparison;
  return {
    key: "e1rm",
    label: "Kraft",
    title: `${progress.exercise_name} · geschätztes 1RM`,
    unit: "kg",
    points: (progress.selected_series?.points ?? []).map((p) => p.value),
    delta: c && c.status === "valid" ? c.delta : null,
  };
}
