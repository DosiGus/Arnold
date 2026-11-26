/**
 * `get_arnold_workouts` and `get_arnold_exercise_progress` → the history and
 * the exercise card. Mapping and wording only: comparisons and records come
 * from the analytics engine; an unknown value is "–", never 0.
 */
import {
  EXECUTION_MODE_LABEL,
  formatNumber,
  formatSetLine,
  formatShortDay,
  LOAD_BASIS_LABEL,
  SIDE_LABEL,
  UNKNOWN,
} from "../../shared/arnold-format.js";
import type {
  ArnoldDashboardView,
  ArnoldExerciseProgressView,
  ArnoldWorkoutHistoryView,
  ProgressMetricKey,
  ViewWorkoutDetail,
} from "../../shared/arnold-view.js";
import { clock, shortDate } from "./dashboard.js";

type Block = ViewWorkoutDetail["exercises"][number];

/** The working sets of one exercise: "3 × 62,5 kg × 8"; undefined when none. */
export function setsLine(block: Block): string | undefined {
  const groups: { text: string; count: number }[] = [];
  for (const set of block.sets) {
    if (set.voided || set.set_type !== "working") continue;
    const text = formatSetLine(set);
    const last = groups[groups.length - 1];
    if (last?.text === text) last.count += 1;
    else groups.push({ text, count: 1 });
  }
  if (!groups.length) return undefined;
  return groups
    .map((g) => (g.count > 1 ? `${g.count} × (${g.text})` : g.text))
    .join(", ");
}

/** What the watch recorded; only known values appear. */
export function watchSummary(workout: ViewWorkoutDetail): string[] {
  const watch = workout.watch;
  if (!watch) return [];
  const heart = watch.health?.heart_rate;
  const calories = watch.health?.calories_kcal;
  return [
    watch.duration_s === null ? null : `Dauer ${clock(watch.duration_s)}`,
    heart?.average_bpm != null
      ? `Puls Ø ${formatNumber(heart.average_bpm, 0)}`
      : null,
    heart?.max_bpm != null
      ? `Puls max. ${formatNumber(heart.max_bpm, 0)}`
      : null,
    calories != null ? `${formatNumber(calories, 0)} kcal` : null,
  ].filter((v): v is string => v !== null);
}

export type HistoryEntry = {
  id: string;
  title: string;
  date: string;
  meta: string;
  fromWatch: boolean;
  record: boolean;
  watch: string[];
  exercises: { key: string; name: string; line: string; record: boolean }[];
};

export function historyEntry(
  workout: ViewWorkoutDetail,
  records: ArnoldDashboardView["home"]["records"] = [],
): HistoryEntry {
  const mine = records.filter((r) => r.workout_id === workout.workout_id);
  return {
    id: workout.workout_id,
    title: workout.title,
    date: formatShortDay(workout.date),
    meta: [
      `${workout.exercise_count} ${workout.exercise_count === 1 ? "Übung" : "Übungen"}`,
      `${workout.working_set_count} ${workout.working_set_count === 1 ? "Satz" : "Sätze"}`,
      workout.status === "completed" ? null : workout.status_label,
    ]
      .filter(Boolean)
      .join(" · "),
    fromWatch: workout.from_watch,
    record: mine.length > 0,
    watch: watchSummary(workout),
    exercises: workout.exercises.flatMap((b) => {
      const line = setsLine(b);
      return line
        ? [
            {
              key: String(b.exercise_order),
              name: b.name,
              line,
              record: mine.some((r) => r.exercise_id === b.exercise_id),
            },
          ]
        : [];
    }),
  };
}

/** Adds the next page below the rows already shown, without duplicates. */
export function appendWorkouts(
  shown: ViewWorkoutDetail[],
  page: ArnoldWorkoutHistoryView["workouts"],
): ViewWorkoutDetail[] {
  const known = new Set(shown.map((w) => w.workout_id));
  return [...shown, ...page.filter((w) => !known.has(w.workout_id))];
}

/* -------------------------------------------------------- one exercise */

export const PROGRESS_METRICS = [
  { value: "max_load", label: "Gewicht" },
  { value: "total_reps", label: "Wdh." },
  { value: "mean_reps_per_working_set", label: "Ø Wdh." },
  { value: "estimated_1rm", label: "1RM" },
  { value: "nominal_volume", label: "Volumen" },
] as const satisfies readonly { value: ProgressMetricKey; label: string }[];

/** Exercises with saved sets first; the chat's choice wins. */
export function progressChoices(view: ArnoldDashboardView) {
  return [...view.exercises]
    .sort(
      (a, b) =>
        Number(b.logged_sets > 0) - Number(a.logged_sets > 0) ||
        a.name.localeCompare(b.name, "de"),
    )
    .map((e) => ({ value: e.exercise_id, label: e.name }));
}

export type ProgressModel = {
  name: string;
  /** The newest comparable value with its unit; "–" when unknown. */
  value: string;
  /** What the value is; includes the date when known. */
  caption: string;
  /** "+2,5 kg seit 3. Nov."; null without a comparison. */
  change: string | null;
  comparison: string | null;
  notes: string[];
  points: (number | null)[];
  unit: string;
  range: string | null;
};

const KPI_KEY: Record<ProgressMetricKey, string> = {
  max_load: "max_comparable_load",
  estimated_1rm: "best_estimated_1rm",
  total_reps: "total_reps",
  nominal_volume: "nominal_volume",
  mean_reps_per_working_set: "mean_reps_per_working_set",
};

export function progressModel(view: ArnoldExerciseProgressView): ProgressModel {
  const metric = view.selected_metric;
  const label = PROGRESS_METRICS.find((m) => m.value === metric)!.label;
  const reps =
    metric === "total_reps" || metric === "mean_reps_per_working_set";
  const unit = reps ? "Wdh." : "kg";
  const kpi = view.kpis.find((k) => k.key === KPI_KEY[metric]);
  const c = view.selected_comparison;
  const valid = c?.status === "valid" ? c : null;
  const points = view.selected_series?.points ?? [];
  const latest = valid?.to_value ?? null;
  const shown = latest ?? kpi?.value ?? null;
  const comparable =
    metric === "estimated_1rm"
      ? view.best_estimated_1rm_comparability
      : metric === "max_load"
        ? view.max_comparable_load_comparability
        : null;
  const first = points[0]?.date;
  const last = points[points.length - 1]?.date;
  return {
    name: view.exercise_name,
    value: shown === null ? UNKNOWN : `${formatNumber(shown, 1)} ${unit}`,
    caption:
      latest !== null && valid?.to_date
        ? `${label} am ${shortDate(valid.to_date)}`
        : (kpi?.label ?? label),
    change:
      valid?.delta != null && valid.from_date
        ? valid.delta === 0
          ? `Unverändert seit ${shortDate(valid.from_date)}`
          : `${valid.delta > 0 ? "+" : "−"}${formatNumber(Math.abs(valid.delta), 1)} ${unit} seit ${shortDate(valid.from_date)}`
        : null,
    comparison: comparable
      ? [
          LOAD_BASIS_LABEL[comparable.load_basis],
          EXECUTION_MODE_LABEL[comparable.execution_mode],
          comparable.side ? SIDE_LABEL[comparable.side] : null,
        ]
          .filter(Boolean)
          .join(" · ")
      : null,
    notes: [
      shown === null
        ? (kpi?.note ??
          view.notices[0]?.message ??
          "Für diese Kennzahl liegen noch keine vergleichbaren Werte vor.")
        : (kpi?.note ?? null),
      metric === "estimated_1rm"
        ? "Aus deinen Sätzen geschätzt, kein getestetes Maximalgewicht."
        : null,
      ...view.notices
        .filter((n) => n.severity === "warning")
        .map((n) => n.message),
    ].filter((n, i, all): n is string => !!n && all.indexOf(n) === i),
    points: points.map((p) => p.value),
    unit,
    range: first && last ? `${shortDate(first)} bis ${shortDate(last)}` : null,
  };
}
