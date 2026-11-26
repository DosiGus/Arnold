/**
 * Arnold's history → the progress screen ("Trainingsentwicklung").
 *
 * All series come from the server: the estimated 1RM of the most trained
 * exercise (`get_arnold_exercise_progress`, its first-to-last comparison
 * comes from the analytics engine within one comparability class), weekly
 * volume and training days (dashboard `weeks`), weekly running distance and
 * average pace (`get_run_analysis`, four weeks per call). The change next to
 * the weekly charts is `firstLastChange` from src/analytics. Unknown weeks
 * stay gaps, never 0. A series without anything to show is left out.
 */
import { firstLastChange, valueRange } from "../../analytics/series-change.js";
import type {
  ArnoldDashboardView,
  ArnoldExerciseProgressView,
} from "../../shared/arnold-view.js";
import type { RunAnalysisResponse } from "../../shared/run-contract.js";
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
  /** Pace: values are seconds per km, shown as m:ss; lower is faster. */
  pace?: true;
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

const weekAxis = (starts: string[], currentWeek: string | null) => {
  const label = (start: string) =>
    start === currentWeek ? "diese Woche" : `Woche ab ${shortDate(start)}`;
  return { from: label(starts[0]!), to: label(starts[starts.length - 1]!) };
};

const seriesOf = (
  key: string,
  label: string,
  title: string,
  unit: string,
  points: (number | null)[],
  axis: LiveSeries["axis"],
): LiveSeries => ({
  key,
  label,
  title,
  unit,
  points,
  delta: firstLastChange(points)?.delta ?? null,
  axis,
  range: valueRange(points),
});

/** Something to draw: at least one known value above zero. */
const hasValues = (s: LiveSeries) => s.points.some((v) => v !== null && v > 0);

export function weeklySeries(
  view: ArnoldDashboardView,
  range: StatsRange,
): LiveSeries[] {
  const weeks = weeksIn(view, range);
  if (!weeks.length) return [];
  const axis = weekAxis(
    weeks.map((w) => w.week_start),
    weeks.find((w) => w.is_current_week)?.week_start ?? null,
  );
  const volume = seriesOf(
    "volume",
    "Volumen",
    "Wochenvolumen",
    "kg",
    weeks.map((w) => w.nominal_volume),
    axis,
  );
  const days = seriesOf(
    "days",
    "Tage",
    "Trainingstage",
    "",
    weeks.map((w) => w.training_days),
    axis,
  );
  // Without strength training there is no volume to speak of.
  return hasValues(volume) ? [volume, days] : [days];
}

/**
 * The `date` of each `get_run_analysis` call (view `four_weeks`) that
 * together cover the weeks on screen, newest block first.
 */
export function runQueryDates(
  view: ArnoldDashboardView,
  range: StatsRange,
): string[] {
  const starts = weeksIn(view, range).map((w) => w.week_start);
  const dates: string[] = [];
  for (let end = starts.length - 1; end >= 0; end -= 4)
    dates.push(starts[end]!);
  return dates;
}

/** A weekly figure of the run analysis; a partly known sum is unknown. */
function runValue(source: Record<string, unknown>, key: string) {
  const m = (source[key] ?? {}) as {
    value?: unknown;
    known?: unknown;
    total?: unknown;
  };
  if (typeof m.value !== "number") return null;
  if (typeof m.total === "number" && m.known !== m.total) return null;
  return m.value;
}

/** Running distance and pace per week; empty without any run on screen. */
export function runSeries(
  view: ArnoldDashboardView,
  range: StatsRange,
  analyses: readonly RunAnalysisResponse[],
): LiveSeries[] {
  const weeks = weeksIn(view, range);
  const byStart = new Map(
    analyses.flatMap((a) => a.weeks.map((w) => [w.week_start, w.running])),
  );
  const starts = weeks.map((w) => w.week_start);
  if (!starts.length || !starts.every((s) => byStart.has(s))) return [];
  if (!starts.some((s) => Number(byStart.get(s)!.run_count) > 0)) return [];
  const axis = weekAxis(
    starts,
    weeks.find((w) => w.is_current_week)?.week_start ?? null,
  );
  const distance = seriesOf(
    "run_distance",
    "Lauf-km",
    "Laufkilometer pro Woche",
    "km",
    starts.map((s) => {
      const metres = runValue(byStart.get(s)!, "distance_m");
      return metres === null ? null : metres / 1000;
    }),
    axis,
  );
  const pace: LiveSeries = {
    ...seriesOf(
      "run_pace",
      "Tempo",
      "Lauftempo (Wochenschnitt)",
      "/km",
      starts.map((s) => runValue(byStart.get(s)!, "pace_s_per_km")),
      axis,
    ),
    pace: true,
  };
  return [distance, pace].filter(hasValues);
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
