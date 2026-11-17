/**
 * Presenter between the Arnold analytics engine and the v2 UI contract.
 *
 * This layer translates and selects; it never calculates a training metric. Every
 * number it emits is copied from an engine `MetricValue`, which is also why a
 * missing value stays `null` with its reason attached instead of collapsing to a
 * reassuring `0`. Keeping the arithmetic on the engine side is what makes the
 * dashboard and a direct engine call impossible to disagree.
 */
import {
  type ArnoldDataset,
  type ArnoldExercise,
  type ArnoldLoadBasis,
  type ArnoldPlanItem,
  type ArnoldPlanVersion,
  type ArnoldSet,
  type ArnoldWorkout,
} from "../shared/arnold-schema-v1.js";
import { recordingMetrics } from "../analytics/recording.js";
import { DEFAULT_REST_SECONDS } from "../analytics/session-duration.js";
import type { WatchRecordingData, WatchSnapshotData } from "./arnold-source.js";
import {
  buildArnoldDashboardAnalytics,
  buildHomeAnalytics,
  buildScores,
  type HomeAnalytics,
  type ScoreHealthInput,
  type Scores,
  DEFAULT_WORKOUT_STATUSES,
  METRICS_VERSION,
  type AnalyticsFilter,
  type AnalyticsOptions,
  type AnalyticsReason,
  type ArnoldDashboardAnalytics,
  type ExerciseProgress,
  type MetricValue,
  type Series,
} from "../analytics/index.js";
import { WORKOUT_STATUS_LABEL } from "../shared/arnold-format.js";
import type { ArnoldScores } from "../shared/scores-contract.js";
import {
  ARNOLD_UI_CONTRACT,
  ArnoldDashboardViewSchema,
  ArnoldExerciseProgressViewSchema,
  ArnoldWorkoutHistoryViewSchema,
  PROGRESS_METRICS,
  type ArnoldDashboardView,
  type ArnoldExerciseProgressView,
  type ArnoldHome,
  type HomeRecord,
  type ArnoldWorkoutHistoryView,
  type ProgressMetricKey,
  type ViewExerciseOption,
  type ViewMetric,
  type ViewNotice,
  type ViewRecord,
  type ViewSource,
  type ViewWatchRecording,
  type ViewWorkoutDetail,
  type ViewWorkoutSummary,
} from "../shared/arnold-view.js";

/**
 * German text for every machine reason the engine can attach. Kept exhaustive by
 * `Record<AnalyticsReason, string>`: a new reason in the engine fails the build
 * here rather than reaching the user as a raw identifier like `per_implement`.
 */
export const REASON_TEXT: Record<AnalyticsReason, string> = {
  set_voided: "Verworfene Sätze werden nicht gezählt.",
  workout_status_not_eligible:
    "Nur abgeschlossene Trainingseinheiten werden gezählt.",
  set_filtered_out: "Durch den aktuellen Filter ausgeschlossen.",
  set_type_not_working: "Kein Arbeitssatz.",
  workout_reference_missing: "Ein Satz verweist auf eine fehlende Einheit.",
  exercise_reference_missing: "Ein Satz verweist auf eine fehlende Übung.",
  duplicate_workout_id: "Doppelte Einheiten-ID in den Rohdaten.",
  duplicate_set_id: "Doppelte Satz-ID in den Rohdaten.",
  load_missing: "Für diesen Satz ist kein Gewicht erfasst.",
  load_not_finite: "Das erfasste Gewicht ist keine verwertbare Zahl.",
  load_not_positive: "Das erfasste Gewicht ist nicht positiv.",
  reps_zero: "Keine Wiederholungen erfasst.",
  reps_basis_ambiguous_for_execution_mode:
    "Wiederholungsbasis und Ausführungsart passen nicht zusammen.",
  reps_per_side_ambiguous:
    "Wiederholungen pro Seite lassen sich hier nicht eindeutig zusammenfassen.",
  bodyweight_total_load_unavailable:
    "Ohne hinterlegtes Körpergewicht ist die Gesamtlast unbekannt.",
  assistance_load_not_volume_comparable:
    "Unterstützte Übungen sind nicht mit freien Gewichten vergleichbar.",
  machine_load_not_free_weight_comparable:
    "Maschinenanzeigen sind nicht mit freien Gewichten vergleichbar.",
  added_load_total_unavailable:
    "Bei Zusatzgewicht bleibt die Gesamtlast ohne Körpergewicht unbekannt.",
  volume_not_finite: "Das Volumen ließ sich nicht verlässlich berechnen.",
  reps_out_of_epley_range:
    "Die Wiederholungszahl liegt außerhalb des sinnvollen 1RM-Bereichs.",
  load_basis_not_one_rm_comparable:
    "Diese Lastdefinition erlaubt keine 1RM-Schätzung.",
  value_is_per_implement:
    "Der Wert gilt pro Hantel und ist nicht als Gesamtlast zu lesen.",
  value_is_machine_specific: "Der Wert gilt nur für dieses Gerät.",
  no_eligible_workouts: "Im gewählten Zeitraum liegen keine Einheiten vor.",
  no_eligible_sets: "Im gewählten Zeitraum liegen keine passenden Sätze vor.",
  no_computable_sets:
    "Die vorhandenen Sätze lassen keine Berechnung dieser Kennzahl zu.",
  no_previous_reference_value: "Es gibt noch keinen Vergleichswert.",
  weekly_goal_not_configured: "Es ist noch kein Wochenziel hinterlegt.",
  aggregate_not_finite:
    "Die Summe liegt außerhalb des darstellbaren Zahlenbereichs.",
  plan_days_per_week_not_configured:
    "Im Trainingsplan sind keine Trainingstage pro Woche hinterlegt.",
  plan_target_sets_not_configured: "Im Trainingsplan fehlen Zielsätze.",
  no_plan_version_applicable: "Für diesen Zeitraum gilt kein Trainingsplan.",
  workout_not_attributable_to_plan:
    "Diese Einheit lässt sich keinem Trainingsplan zuordnen.",
  plan_changed_within_week:
    "In dieser Woche galten zwei Trainingspläne, das Wochenziel ist dadurch nicht eindeutig.",
  working_set_not_planned:
    "Einzelne Arbeitssätze gehören zu keiner geplanten Übung dieser Einheit.",
  comparison_needs_two_dates:
    "Für einen Vergleich braucht es Messwerte an mindestens zwei Tagen.",
  comparison_mixed_load_basis:
    "Die Werte stammen aus unterschiedlichen Lastarten und sind nicht vergleichbar.",
};

/** Joins the reasons behind a metric into one short sentence, or `null`. */
export function reasonNote(
  value: Pick<MetricValue, "status" | "reasons">,
): string | null {
  if (value.status === "valid" && !value.reasons.length) return null;
  const texts = [...new Set(value.reasons.map((r) => REASON_TEXT[r]))];
  if (!texts.length)
    return value.status === "valid"
      ? null
      : "Diese Kennzahl ist mit den vorliegenden Daten nicht berechenbar.";
  return texts.join(" ");
}

/** Projects an engine metric onto the compact display metric. */
export function viewMetric(
  key: string,
  label: string,
  value: MetricValue,
  detail: string | null = null,
  loadBasis: ArnoldLoadBasis | null = null,
): ViewMetric {
  return {
    key,
    label,
    value: value.value,
    unit: value.unit,
    status: value.status,
    note: reasonNote(value),
    detail,
    load_basis: loadBasis,
  };
}

export type ArnoldModeInfo = {
  readonly mode: "arnold";
  readonly label: string;
  readonly description: string;
};

/** `generated_at` is injected so a presenter result stays reproducible in tests. */
export type PresenterContext = {
  readonly generatedAt: string;
  readonly mode?: ArnoldModeInfo;
  /**
   * Watch values for the recovery score (UX-009), read by the server with
   * the caller's consent. Absent: no consent, so only the training part.
   */
  readonly scoreHealth?: ScoreHealthInput;
};

const WEEKDAY = new Intl.DateTimeFormat("de-DE", {
  day: "2-digit",
  month: "short",
  timeZone: "UTC",
});
const weekLabel = (date: string) =>
  WEEKDAY.format(new Date(`${date}T12:00:00Z`));

function sourceOf(
  analytics: ArnoldDashboardAnalytics,
  context: PresenterContext,
): ViewSource {
  const template = analytics.metadata.file_role === "MASTER_TEMPLATE";
  return {
    mode: "arnold",
    label:
      context.mode?.label ??
      (template ? "Master-Vorlage · Arnold" : "Arnold · Mein Training"),
    description:
      context.mode?.description ??
      (template
        ? "Gelesen wird die gemeinsame Arnold-Master-Vorlage. Sie enthält bewusst keine persönlichen Trainingsdaten."
        : "Deine Trainingsdaten, ausgewertet auf dem Arnold-Server."),
    synthetic: false,
    read_only: true,
    file_role: analytics.metadata.file_role,
    tracker_id: analytics.metadata.tracker_id,
    schema_id: analytics.metadata.schema_id,
    schema_version: analytics.metadata.schema_version,
    metrics_version: analytics.metadata.metrics_version,
    generated_at: context.generatedAt,
  };
}

/**
 * Whether a workout falls inside the selected view.
 *
 * The overview's lists used to be built from the unfiltered dataset, so a
 * selection covering January 2030 still listed five sessions from 2026. Status
 * is deliberately not part of this: the dashboard filter has no status
 * dimension, and a cancelled session is still something that happened in the
 * period.
 */
function withinSelection(
  workout: ArnoldWorkout,
  filter: AnalyticsFilter,
  setsOf: (id: string) => readonly ArnoldSet[],
): boolean {
  const date = workout.workout_date_local;
  if (filter.from && date < filter.from) return false;
  if (filter.to && date > filter.to) return false;
  if (filter.workout_ids && !filter.workout_ids.includes(workout.workout_id))
    return false;
  if (
    filter.plan_version_ids &&
    (workout.plan_version_id === null ||
      !filter.plan_version_ids.includes(workout.plan_version_id))
  )
    return false;
  if (
    filter.session_ids &&
    (workout.session_id === null ||
      !filter.session_ids.includes(workout.session_id))
  )
    return false;
  if (filter.exercise_ids) {
    const sets = setsOf(workout.workout_id);
    if (
      !sets.some(
        (set) =>
          set.status === "active" &&
          filter.exercise_ids!.includes(set.exercise_id),
      )
    )
      return false;
  }
  return true;
}

/** Name recorded with the sets, so history survives catalog and plan changes. */
function workoutTitle(
  workout: ArnoldWorkout,
  sets: readonly ArnoldSet[],
): string {
  if (workout.session_name_snapshot?.trim())
    return workout.session_name_snapshot.trim();
  const names = [...new Set(sets.map((s) => s.exercise_name_snapshot.trim()))];
  if (names.length === 1) return names[0];
  if (names.length > 1) return "Freies Training";
  return "Trainingseinheit";
}

function planLabel(plan: ArnoldPlanVersion | undefined) {
  return plan ? { name: plan.name, version_no: plan.version_no } : null;
}

/**
 * Per-workout summary. Volume comes from the engine's `volume.per_workout`;
 * workouts the engine excluded carry `counts_towards_metrics: false` and no
 * volume, rather than a zero that would read as "trained nothing".
 */
function summarize(
  workout: ArnoldWorkout,
  sets: readonly ArnoldSet[],
  analytics: ArnoldDashboardAnalytics,
  plans: ReadonlyMap<string, ArnoldPlanVersion>,
): ViewWorkoutSummary {
  const perWorkout = analytics.volume.per_workout.find(
    (entry) => entry.workout_id === workout.workout_id,
  );
  const active = sets.filter((s) => s.status === "active");
  const plan =
    workout.plan_version_id === null
      ? null
      : planLabel(plans.get(workout.plan_version_id));
  return {
    workout_id: workout.workout_id,
    date: workout.workout_date_local,
    title: workoutTitle(workout, active),
    plan_version_id: workout.plan_version_id,
    plan_name: plan?.name ?? null,
    plan_version_no: plan?.version_no ?? null,
    session_id: workout.session_id,
    status: workout.status,
    status_label: WORKOUT_STATUS_LABEL[workout.status],
    counts_towards_metrics: perWorkout !== undefined,
    exercise_count: new Set(active.map((s) => s.exercise_id)).size,
    set_count: active.length,
    working_set_count: active.filter((s) => s.set_type === "working").length,
    nominal_volume: perWorkout?.nominal_volume.value ?? null,
    nominal_volume_status: perWorkout?.nominal_volume.status ?? "not_available",
    from_watch: !!workout.client_session_id,
  };
}

/** Groups a workout's sets into exercise cards, preserving the stored order. */
function detail(
  workout: ArnoldWorkout,
  sets: readonly ArnoldSet[],
  analytics: ArnoldDashboardAnalytics,
  // Built once per request by the caller: indexing the whole dataset per
  // workout would re-scan the entire set table up to `limit` times.
  catalog: ReadonlyMap<string, ArnoldExercise>,
  plans: ReadonlyMap<string, ArnoldPlanVersion>,
): ViewWorkoutDetail {
  const active = sets.filter((s) => s.status === "active");
  const order = new Map<string, number>();
  for (const set of sets)
    order.set(
      set.exercise_id,
      Math.min(order.get(set.exercise_id) ?? Infinity, set.exercise_order),
    );
  const grouped = new Map<string, ArnoldSet[]>();
  for (const set of sets) {
    const bucket = grouped.get(set.exercise_id);
    if (bucket) bucket.push(set);
    else grouped.set(set.exercise_id, [set]);
  }
  const exercises = [...grouped.entries()]
    .sort((a, b) => (order.get(a[0]) ?? 0) - (order.get(b[0]) ?? 0))
    .map(([exercise_id, entries]) => {
      const catalogEntry = catalog.get(exercise_id);
      // The snapshot wins over the catalog: an exercise later renamed, retired or
      // dropped from the plan must still appear under the name it was logged with.
      const snapshot = entries.find((s) =>
        s.exercise_name_snapshot.trim(),
      )?.exercise_name_snapshot;
      const ordered = [...entries].sort(
        (a, b) =>
          a.set_number - b.set_number ||
          (a.created_at_utc < b.created_at_utc ? -1 : 1),
      );
      return {
        exercise_id,
        name: snapshot?.trim() || catalogEntry?.name_de || "Unbekannte Übung",
        exercise_order: order.get(exercise_id) ?? 1,
        in_current_catalog: catalogEntry !== undefined,
        retired: catalogEntry?.status === "retired",
        mixed_load_basis: new Set(ordered.map((s) => s.load_basis)).size > 1,
        sets: ordered.map((set) => ({
          set_id: set.set_id,
          set_number: set.set_number,
          set_type: set.set_type,
          reps: set.reps,
          reps_basis: set.reps_basis,
          load_kg: set.load_kg,
          load_basis: set.load_basis,
          implement_count: set.implement_count,
          execution_mode: set.execution_mode,
          side: set.side,
          rpe: set.rpe,
          rir: set.rir,
          notes: set.notes,
          voided: set.status === "voided",
        })),
      };
    });
  return {
    ...summarize(workout, active, analytics, plans),
    timezone: workout.timezone,
    notes: workout.notes,
    source: workout.source,
    exercises,
    watch: null,
  };
}

/** Points of the small heart-rate curve; raw samples, never averaged. */
export const HEART_RATE_CURVE_POINTS = 120;

/**
 * What the watch recorded for one workout. The metrics come from
 * `src/analytics/recording.ts`; this only matches each pause with the rest the
 * watch counted down before it: the plan position of the previous set, else
 * the default the watch uses (DEFAULT_REST_SECONDS).
 */
export function watchRecordingView(
  sets: readonly ArnoldSet[],
  planItems: ReadonlyMap<string, ArnoldPlanItem>,
  recording: WatchRecordingData,
): ViewWatchRecording {
  const restAt = (exerciseOrder: number) => {
    const set = sets.find(
      (s) => s.status === "active" && s.exercise_order === exerciseOrder,
    );
    const item = set?.plan_item_id ? planItems.get(set.plan_item_id) : null;
    return item?.rest_seconds ?? DEFAULT_REST_SECONDS;
  };
  const pauses = recording.set_timings.slice(1).map((timing, i) => ({
    planned_s: restAt(recording.set_timings[i].exercise_order),
    actual_s: timing.rest_before_s,
  }));
  const health = recording.health;
  // 0 is a gap for the analytics, like on the watch.
  const hr = health?.hr
    ? { ...health.hr, values: health.hr.values.map((v) => v ?? 0) }
    : null;
  const metrics = recordingMetrics(
    { hr, before: health?.before ?? null, after: health?.after ?? null },
    pauses,
    // No personal zone bounds are known: no zones, never invented ones.
    undefined,
    recording,
  );
  const values = health?.hr?.values ?? [];
  const step = Math.max(1, values.length / HEART_RATE_CURVE_POINTS);
  const curve = Array.from(
    { length: Math.min(values.length, HEART_RATE_CURVE_POINTS) },
    (_, i) => values[Math.floor(i * step)] || null,
  );
  const snapshot = (value: WatchSnapshotData | null) =>
    value
      ? {
          body_battery: value.body_battery ?? null,
          stress: value.stress ?? null,
          resting_hr: value.resting_hr ?? null,
        }
      : null;
  const heart = metrics.heart_rate;
  return {
    started_at_utc: recording.started_at_utc,
    ended_at_utc: recording.ended_at_utc,
    duration_s: metrics.duration_s,
    rest: {
      measured_pauses: metrics.rest.measured_pauses,
      planned_s: metrics.rest.planned_s,
      actual_s: metrics.rest.actual_s,
      delta_s: metrics.rest.delta_s,
      ratio_pct: metrics.rest.ratio_pct,
    },
    health: health
      ? {
          heart_rate: heart
            ? {
                average_bpm: heart.average_bpm,
                max_bpm: heart.max_bpm,
                measured_seconds: heart.measured_seconds,
                missing_seconds: heart.missing_seconds,
              }
            : null,
          heart_rate_curve: curve,
          calories_kcal: health.calories_kcal,
          before: snapshot(health.before),
          after: snapshot(health.after),
          differences: metrics.differences,
        }
      : null,
  };
}

/**
 * Adds what the watch recorded to a page of history. Separate from
 * buildWorkoutHistoryView so only the page's own recordings are read.
 */
export function withWatchRecordings(
  view: ArnoldWorkoutHistoryView,
  dataset: ArnoldDataset,
  recordings: readonly WatchRecordingData[],
): ArnoldWorkoutHistoryView {
  if (!recordings.length) return view;
  const bySession = new Map(recordings.map((r) => [r.client_session_id, r]));
  const workouts = new Map(dataset.workouts.map((w) => [w.workout_id, w]));
  const planItems = new Map(dataset.planItems.map((i) => [i.plan_item_id, i]));
  return ArnoldWorkoutHistoryViewSchema.parse({
    ...view,
    workouts: view.workouts.map((detail) => {
      const session = workouts.get(detail.workout_id)?.client_session_id;
      const recording = session ? bySession.get(session) : undefined;
      if (!recording) return detail;
      const sets = dataset.sets.filter(
        (s) => s.workout_id === detail.workout_id,
      );
      return {
        ...detail,
        watch: watchRecordingView(sets, planItems, recording),
      };
    }),
  });
}

/** Client sessions of the workouts on a history page, for the recordings. */
export function watchSessionsOf(
  view: ArnoldWorkoutHistoryView,
  dataset: ArnoldDataset,
): string[] {
  const ids = new Set(view.workouts.map((w) => w.workout_id));
  return dataset.workouts.flatMap((w) =>
    ids.has(w.workout_id) && w.client_session_id ? [w.client_session_id] : [],
  );
}

function qualityNotes(analytics: ArnoldDashboardAnalytics): string[] {
  const quality = analytics.data_quality;
  const reasons = new Set<AnalyticsReason>([
    ...(Object.keys(quality.set_exclusions) as AnalyticsReason[]),
    ...(Object.keys(quality.integrity_defects) as AnalyticsReason[]),
  ]);
  // Routine, expected exclusions are not defects and would only add noise.
  reasons.delete("set_type_not_working");
  reasons.delete("set_filtered_out");
  return [...reasons].map((reason) => REASON_TEXT[reason]);
}

function noticesFor(
  analytics: ArnoldDashboardAnalytics,
  activePlan: ArnoldPlanVersion | undefined,
): ViewNotice[] {
  const notices: ViewNotice[] = [];
  if (analytics.metadata.file_role === "MASTER_TEMPLATE")
    notices.push({
      code: "master_template",
      severity: "info",
      title: "Master-Vorlage",
      message:
        "Dies ist die gemeinsame Arnold-Vorlage, kein persönlicher Tracker. Sie enthält keine echten Trainingsdaten.",
    });
  if (analytics.data_quality.retired_exercises_in_use.length)
    notices.push({
      code: "retired_exercises_in_use",
      severity: "info",
      title: "Nicht mehr aktive Übungen in der Historie",
      message: `${analytics.data_quality.retired_exercises_in_use.length} Übung(en) sind im Katalog beendet, bleiben in alten Einheiten aber erhalten.`,
    });
  if (analytics.data_quality.removed_plan_items_in_use.length)
    notices.push({
      code: "removed_plan_items_in_use",
      severity: "info",
      title: "Entfernte Planpositionen in der Historie",
      message:
        "Einzelne Einheiten verweisen auf Planpositionen, die inzwischen entfernt wurden. Die erfassten Sätze bleiben unverändert.",
    });
  const notes = qualityNotes(analytics);
  if (notes.length)
    notices.push({
      code: "partial_data",
      severity: "warning",
      title: "Teilweise nicht auswertbare Daten",
      message: notes.join(" "),
    });
  if (!activePlan)
    notices.push({
      code: "no_plan_configured",
      severity: "info",
      title: "Kein aktiver Trainingsplan",
      message:
        "Ohne aktiven Plan werden Einheiten weiterhin ausgewertet, aber nicht auf Planerfüllung geprüft.",
    });
  if (analytics.activity.week_streak.weekly_goal_training_days === null)
    notices.push({
      code: "weekly_goal_missing",
      severity: "info",
      title: "Kein Wochenziel hinterlegt",
      message:
        "Sobald ein Wochenziel hinterlegt ist, zeigt Arnold deine Serie erreichter Wochen.",
    });
  return notices;
}

/** The exercise catalog plus the history-only exercises, for every selector. */
function exerciseOptions(dataset: ArnoldDataset): ViewExerciseOption[] {
  const logged = new Map<string, { sets: number; last: string | null }>();
  const dates = new Map<string, string>(
    dataset.workouts.map((w) => [w.workout_id, w.workout_date_local]),
  );
  for (const set of dataset.sets) {
    if (set.status !== "active") continue;
    const entry = logged.get(set.exercise_id) ?? { sets: 0, last: null };
    const date = dates.get(set.workout_id) ?? null;
    logged.set(set.exercise_id, {
      sets: entry.sets + 1,
      last: date && (!entry.last || date > entry.last) ? date : entry.last,
    });
  }
  const names = new Map<string, string>();
  for (const set of dataset.sets)
    if (!names.has(set.exercise_id) && set.exercise_name_snapshot.trim())
      names.set(set.exercise_id, set.exercise_name_snapshot.trim());
  const options: ViewExerciseOption[] = dataset.exercises.map((exercise) => ({
    exercise_id: exercise.exercise_id,
    name: exercise.name_de,
    equipment: exercise.equipment,
    primary_muscle: exercise.primary_muscle,
    default_load_basis: exercise.default_load_basis,
    default_execution_mode: exercise.default_execution_mode,
    in_current_catalog: true,
    retired: exercise.status === "retired",
    logged_sets: logged.get(exercise.exercise_id)?.sets ?? 0,
    last_trained_on: logged.get(exercise.exercise_id)?.last ?? null,
  }));
  const known = new Set(options.map((o) => o.exercise_id));
  // An exercise that only survives in history is still selectable; otherwise its
  // progress would silently disappear the moment it leaves the catalog.
  for (const [exercise_id, entry] of logged)
    if (!known.has(exercise_id))
      options.push({
        exercise_id,
        name: names.get(exercise_id) ?? "Unbekannte Übung",
        equipment: null,
        primary_muscle: null,
        default_load_basis: null,
        default_execution_mode: null,
        in_current_catalog: false,
        retired: false,
        logged_sets: entry.sets,
        last_trained_on: entry.last,
      });
  return options.sort((a, b) => a.name.localeCompare(b.name, "de"));
}

const RECORD_METRIC_LABEL = {
  max_load: "Maximale Last",
  max_reps_at_load: "Meiste Wiederholungen bei gleicher Last",
  estimated_1rm: "Geschätztes 1RM",
  exercise_workout_volume: "Höchstes Übungsvolumen",
} as const;

function recordView(
  record: ArnoldDashboardAnalytics["records"]["max_load"][number],
  names: ReadonlyMap<string, string>,
): ViewRecord {
  return {
    metric: record.metric,
    metric_label: RECORD_METRIC_LABEL[record.metric],
    exercise_id: record.exercise_id,
    exercise_name: names.get(record.exercise_id) ?? "Unbekannte Übung",
    value: record.value,
    unit: record.unit,
    load_basis: record.comparability?.load_basis ?? null,
    execution_mode: record.comparability?.execution_mode ?? null,
    side: record.comparability?.side ?? null,
    implement_count: record.comparability?.implement_count ?? null,
    at_load_kg: record.at_load_kg,
    reps: record.reps,
    achieved_on: record.achieved_on,
    workout_id: record.workout_id,
    kind: record.kind,
    previous_value: record.previous_value,
    improvement: record.improvement,
    comparability: record.comparability,
  };
}

/** Snapshot-first name lookup, used for records and progress headings. */
function exerciseNames(dataset: ArnoldDataset): ReadonlyMap<string, string> {
  const names = new Map<string, string>();
  for (const exercise of dataset.exercises)
    names.set(exercise.exercise_id, exercise.name_de);
  for (const set of dataset.sets)
    if (!names.has(set.exercise_id) && set.exercise_name_snapshot.trim())
      names.set(set.exercise_id, set.exercise_name_snapshot.trim());
  return names;
}

/**
 * How many working sets were recorded.
 *
 * This is a count of sets, not a sum of volume, and the two must not be
 * conflated: `coverage.included_sets` counts the sets that contributed to the
 * volume *total*, so a perfectly valid bodyweight set — whose load is unknown —
 * dropped out of it and the dashboard reported one set fewer than the history.
 * `eligible_sets` is the count of working sets the engine admitted, which is
 * the number being asked for here and stays correct when a load is unknown.
 */
function workingSetKpi(analytics: ArnoldDashboardAnalytics): ViewMetric {
  const bucket = analytics.volume.by_bucket.working;
  const counted = bucket?.coverage?.eligible_sets ?? null;
  const computable = bucket?.coverage?.included_sets ?? null;
  return {
    key: "working_sets",
    label: "Gültige Arbeitssätze",
    value: counted,
    unit: "sets",
    // The count itself is exact even when no volume could be derived from it.
    status: counted === null ? "not_available" : "valid",
    note:
      counted !== null && computable !== null && computable < counted
        ? `Bei ${counted - computable} dieser Sätze ließ sich kein Trainingsvolumen berechnen; gezählt werden sie trotzdem.`
        : null,
    detail: "Sätze, die in die Kennzahlen eingehen",
    load_basis: null,
  };
}

/**
 * The start screen. Copies the engine's figures and adds what only the data
 * knows: exercise names and muscle groups. Nothing is recomputed here.
 */
function homeView(
  dataset: ArnoldDataset,
  names: ReadonlyMap<string, string>,
  home: HomeAnalytics,
): ArnoldHome {
  const muscle = new Map(
    dataset.exercises.map((e) => [e.exercise_id, e.primary_muscle.trim()]),
  );
  const record = (r: HomeAnalytics["records"][number]): HomeRecord => ({
    key: r.key,
    exercise_id: r.exercise_id,
    exercise_name: names.get(r.exercise_id) ?? "Unbekannte Übung",
    muscle_group: muscle.get(r.exercise_id) || "Sonstiges",
    metric: r.metric,
    value: r.value,
    previous_value: r.previous_value,
    load_kg: r.load_kg,
    reps: r.reps,
    load_basis: r.load_basis,
    achieved_on: r.achieved_on,
    workout_id: r.workout_id,
  });
  const revisions = new Map(
    dataset.goals.map((g) => [g.goal_id, g.row_revision]),
  );
  const year = Number(
    (
      home.reference_date ??
      home.streak.weeks.at(-1)?.week_start ??
      "1970"
    ).slice(0, 4),
  );
  return {
    next_session: home.next_session,
    streak: {
      ...home.streak,
      weeks: home.streak.weeks.map((w) => ({ ...w })),
    },
    year,
    workouts_this_year: home.workouts_this_year,
    strength_change: { ...home.strength_change },
    best_month: home.best_month ? { ...home.best_month } : null,
    muscle_groups: home.muscle_groups.map((g) => ({ ...g })),
    records: home.records.map(record),
    records_by_exercise: home.records_by_exercise.map((entry) => ({
      exercise_id: entry.exercise_id,
      exercise_name: names.get(entry.exercise_id) ?? "Unbekannte Übung",
      muscle_group: muscle.get(entry.exercise_id) || "Sonstiges",
      count: entry.count,
      latest: record(entry.latest),
      history: entry.history.map(record),
    })),
    goals: home.goals.map((goal) => ({
      goal_id: goal.goal_id,
      row_revision: revisions.get(goal.goal_id) ?? 1,
      kind: goal.kind,
      exercise_id: goal.exercise_id,
      name:
        goal.exercise_id === null
          ? "Körpergewicht"
          : (names.get(goal.exercise_id) ?? "Unbekannte Übung"),
      unit: goal.unit,
      load_basis: goal.load_basis,
      target_value: goal.target_value,
      start_value: goal.start_value,
      current_value: goal.current_value,
      current_date: goal.current_date,
      progress: goal.progress,
      achieved: goal.achieved,
      rate_per_week: goal.rate_per_week,
      eta_weeks: goal.eta_weeks,
      points: goal.points.map((p) => ({ ...p })),
    })),
    exercise_bests: home.exercise_bests.map((b) => ({ ...b })),
    latest_body_weight: home.latest_body_weight
      ? { ...home.latest_body_weight }
      : null,
  };
}

/** The engine's scores as plain data; nothing is recomputed (UX-009). */
function scoresView(scores: Scores): ArnoldScores {
  const { progress, recovery } = scores;
  return {
    consistency: { ...scores.consistency },
    progress: { ...progress, runs: progress.runs.map((r) => ({ ...r })) },
    recovery: {
      ...recovery,
      parts: recovery.parts.map((p) => ({ ...p })),
      strongest_deduction: recovery.strongest_deduction
        ? { ...recovery.strongest_deduction }
        : null,
      best: recovery.best ? { ...recovery.best } : null,
    },
  };
}

/**
 * Builds the overview payload.
 *
 * `recentLimit` keeps the aggregate small: full workout detail is a separate
 * call, so opening the dashboard costs one bounded response no matter how many
 * years of history exist.
 */
export function buildDashboardView(
  dataset: ArnoldDataset,
  context: PresenterContext,
  options: AnalyticsOptions = {},
  recentLimit = 5,
): ArnoldDashboardView {
  const analytics = buildArnoldDashboardAnalytics(dataset, options);
  const plans = new Map(dataset.plans.map((p) => [p.plan_version_id, p]));
  const setsByWorkout = new Map<string, ArnoldSet[]>();
  for (const set of dataset.sets) {
    const bucket = setsByWorkout.get(set.workout_id);
    if (bucket) bucket.push(set);
    else setsByWorkout.set(set.workout_id, [set]);
  }
  const activePlan = dataset.plans.find((p) => p.status === "active");
  const names = exerciseNames(dataset);
  const activity = analytics.activity;
  const kpis: ViewMetric[] = [
    viewMetric(
      "workouts",
      "Trainingseinheiten",
      activity.workouts,
      "Abgeschlossene Einheiten im Zeitraum",
    ),
    viewMetric(
      "training_days",
      "Trainingstage",
      activity.training_days,
      "Tage mit mindestens einer Einheit",
    ),
    viewMetric(
      "training_days_per_week",
      "Trainingstage pro Woche",
      activity.average_training_days_per_week,
      `Über ${analytics.metadata.period.weeks} Kalenderwoche(n)`,
    ),
    viewMetric(
      "workouts_per_week",
      "Einheiten pro Woche",
      activity.average_workouts_per_week,
      null,
    ),
    workingSetKpi(analytics),
    viewMetric(
      "nominal_volume",
      "Nominales Trainingsvolumen",
      analytics.volume.nominal_volume,
      "Summe aus Last × Wiederholungen, je Lastdefinition",
    ),
    viewMetric(
      "comparable_volume",
      "Vergleichbares Volumen (freie Gewichte)",
      analytics.volume.comparable_free_weight_volume,
      "Ohne Maschinen- und Unterstützungslasten",
    ),
  ];
  const view: ArnoldDashboardView = {
    ui_contract: ARNOLD_UI_CONTRACT,
    state:
      analytics.metadata.file_role === "MASTER_TEMPLATE"
        ? "master_template"
        : !dataset.exercises.length
          ? "empty_catalog"
          : !dataset.workouts.length
            ? "empty_history"
            : "ready",
    source: sourceOf(analytics, context),
    period: analytics.metadata.period,
    notices: noticesFor(analytics, activePlan),
    kpis,
    weeks: analytics.weekly_trends.weekly.map((week) => ({
      week_start: week.week_start,
      label: weekLabel(week.week_start),
      iso_year: week.iso_year,
      iso_week: week.iso_week,
      is_current_week: week.is_current_week,
      workouts: week.workouts,
      training_days: week.training_days,
      trained_dates: [...week.trained_dates],
      working_sets: week.working_sets,
      nominal_volume: week.nominal_volume.value,
      nominal_volume_status: week.nominal_volume.status,
    })),
    recent_workouts: dataset.workouts
      .filter((workout) =>
        withinSelection(
          workout,
          analytics.metadata.filter,
          (id) => setsByWorkout.get(id) ?? [],
        ),
      )
      .sort((a, b) =>
        a.workout_date_local === b.workout_date_local
          ? a.workout_id < b.workout_id
            ? 1
            : -1
          : a.workout_date_local < b.workout_date_local
            ? 1
            : -1,
      )
      .slice(0, recentLimit)
      .map((workout) =>
        summarize(
          workout,
          setsByWorkout.get(workout.workout_id) ?? [],
          analytics,
          plans,
        ),
      ),
    records: [...analytics.records.max_load, ...analytics.records.estimated_1rm]
      .slice(0, 12)
      .map((record) => recordView(record, names)),
    active_plan: activePlan
      ? {
          plan_version_id: activePlan.plan_version_id,
          plan_family_id: activePlan.plan_family_id,
          version_no: activePlan.version_no,
          name: activePlan.name,
          status: activePlan.status,
          days_per_week: activePlan.days_per_week,
          session_count: new Set(
            dataset.planItems
              .filter(
                (item) =>
                  item.plan_version_id === activePlan.plan_version_id &&
                  item.status === "active",
              )
              .map((item) => item.session_id),
          ).size,
          sessions: [
            ...new Map(
              dataset.planItems
                .filter(
                  (item) =>
                    item.plan_version_id === activePlan.plan_version_id &&
                    item.status === "active",
                )
                .map((item) => [
                  item.session_id,
                  {
                    session_id: item.session_id,
                    session_name: item.session_name,
                    session_order: item.session_order,
                    exercise_count: 0,
                  },
                ]),
            ).values(),
          ]
            .map((session) => ({
              ...session,
              exercise_count: new Set(
                dataset.planItems
                  .filter(
                    (item) =>
                      item.plan_version_id === activePlan.plan_version_id &&
                      item.session_id === session.session_id &&
                      item.status === "active",
                  )
                  .map((item) => item.exercise_id),
              ).size,
            }))
            .sort((a, b) => a.session_order - b.session_order),
        }
      : null,
    plan_history: [...dataset.plans]
      .sort(
        (a, b) =>
          a.plan_family_id.localeCompare(b.plan_family_id) ||
          a.version_no - b.version_no,
      )
      .map((plan) => ({
        plan_version_id: plan.plan_version_id,
        name: plan.name,
        version_no: plan.version_no,
        status: plan.status,
        workouts: dataset.workouts.filter(
          (w) => w.plan_version_id === plan.plan_version_id,
        ).length,
      })),
    exercises: exerciseOptions(dataset),
    session_names: [
      ...new Set(
        dataset.workouts
          .filter((workout) =>
            withinSelection(
              workout,
              analytics.metadata.filter,
              (id) => setsByWorkout.get(id) ?? [],
            ),
          )
          .flatMap((workout) => {
            const title = workoutTitle(
              workout,
              (setsByWorkout.get(workout.workout_id) ?? []).filter(
                (s) => s.status === "active",
              ),
            );
            return title ? [title] : [];
          }),
      ),
    ].sort((a, b) => a.localeCompare(b, "de")),
    data_quality: {
      analyzable: analytics.data_quality.analyzable,
      status: analytics.data_quality.status,
      eligible_workouts: analytics.data_quality.eligible_workouts,
      eligible_sets: analytics.data_quality.eligible_sets,
      computable_sets: analytics.data_quality.computable_sets,
      excluded_sets: Object.values(
        analytics.data_quality.set_exclusions,
      ).reduce((total, n) => total + (n ?? 0), 0),
      notes: qualityNotes(analytics),
    },
    home: homeView(
      dataset,
      names,
      buildHomeAnalytics(dataset, {
        reference_date: options.reference_date ?? null,
        // The weekly goal is the plan's training days (server instructions).
        weekly_goal_training_days: activePlan?.days_per_week ?? null,
      }),
    ),
    // Copied, not computed: every figure comes from src/analytics/scores.ts.
    scores: scoresView(
      buildScores(dataset, {
        reference_date: options.reference_date ?? null,
        weekly_goal_training_days: activePlan?.days_per_week ?? null,
        health: context.scoreHealth ?? { status: "no_consent" },
      }),
    ),
    totals: {
      workouts_in_history: dataset.workouts.length,
      workouts_in_period: analytics.data_quality.eligible_workouts,
      sets_in_period: analytics.data_quality.eligible_sets,
    },
  };
  return ArnoldDashboardViewSchema.parse(view);
}

export type WorkoutQuery = {
  readonly filter?: AnalyticsOptions["filter"];
  readonly statuses?: readonly ArnoldWorkout["status"][] | null;
  readonly session_name?: string | null;
  readonly limit?: number;
  readonly offset?: number;
};

/**
 * Builds a page of workout history.
 *
 * Date, plan, session and status narrowing all happen here on the server, so a
 * filtered view never transfers the whole history to the client.
 */
export function buildWorkoutHistoryView(
  dataset: ArnoldDataset,
  context: PresenterContext,
  query: WorkoutQuery = {},
): ArnoldWorkoutHistoryView {
  const limit = Math.min(Math.max(query.limit ?? 20, 1), 200);
  const offset = Math.max(query.offset ?? 0, 0);
  // The listing may widen the statuses it shows, but the metrics inside it stay
  // on the engine's own eligibility rules. Running the engine with the widened
  // statuses would make a cancelled workout look like it counted, so the
  // analytics pass deliberately keeps the default eligibility.
  const analytics = buildArnoldDashboardAnalytics(dataset, {
    filter: { ...(query.filter ?? {}), workout_statuses: null },
  });
  const filter: AnalyticsFilter = analytics.metadata.filter;
  const plans = new Map(dataset.plans.map((p) => [p.plan_version_id, p]));
  const catalog = new Map(
    dataset.exercises.map((exercise) => [exercise.exercise_id, exercise]),
  );
  const setsByWorkout = new Map<string, ArnoldSet[]>();
  for (const set of dataset.sets) {
    const bucket = setsByWorkout.get(set.workout_id);
    if (bucket) bucket.push(set);
    else setsByWorkout.set(set.workout_id, [set]);
  }
  const statuses =
    query.statuses ??
    query.filter?.workout_statuses ??
    DEFAULT_WORKOUT_STATUSES;
  const matched = dataset.workouts
    .filter((workout) => {
      const date = workout.workout_date_local;
      if (filter.from && date < filter.from) return false;
      if (filter.to && date > filter.to) return false;
      if (statuses && !statuses.includes(workout.status)) return false;
      if (
        filter.plan_version_ids &&
        (workout.plan_version_id === null ||
          !filter.plan_version_ids.includes(workout.plan_version_id))
      )
        return false;
      if (
        filter.session_ids &&
        (workout.session_id === null ||
          !filter.session_ids.includes(workout.session_id))
      )
        return false;
      if (
        filter.workout_ids &&
        !filter.workout_ids.includes(workout.workout_id)
      )
        return false;
      if (filter.exercise_ids) {
        const sets = setsByWorkout.get(workout.workout_id) ?? [];
        if (
          !sets.some(
            (set) =>
              set.status === "active" &&
              filter.exercise_ids!.includes(set.exercise_id),
          )
        )
          return false;
      }
      if (query.session_name) {
        const title = workoutTitle(
          workout,
          (setsByWorkout.get(workout.workout_id) ?? []).filter(
            (s) => s.status === "active",
          ),
        );
        if (title !== query.session_name) return false;
      }
      return true;
    })
    .sort((a, b) =>
      a.workout_date_local === b.workout_date_local
        ? a.workout_id < b.workout_id
          ? 1
          : -1
        : a.workout_date_local < b.workout_date_local
          ? 1
          : -1,
    );
  const page = matched.slice(offset, offset + limit);
  const notices: ViewNotice[] = [];
  if (!matched.length)
    notices.push({
      code: "filter_empty",
      severity: "info",
      title: "Keine Einheiten gefunden",
      message:
        "Für die gewählten Filter liegen keine Trainingseinheiten vor. Zeitraum, Plan oder Einheit anpassen.",
    });
  return ArnoldWorkoutHistoryViewSchema.parse({
    ui_contract: ARNOLD_UI_CONTRACT,
    source: sourceOf(analytics, context),
    total: matched.length,
    offset,
    limit,
    has_more: offset + page.length < matched.length,
    workouts: page.map((workout) =>
      detail(
        workout,
        setsByWorkout.get(workout.workout_id) ?? [],
        analytics,
        catalog,
        plans,
      ),
    ),
    notices,
  } satisfies ArnoldWorkoutHistoryView);
}

/**
 * Progress KPIs, each load-bearing one tagged with the convention it follows.
 *
 * Without the tag the interface shows "20 kg" for a dumbbell held in each hand
 * and for a 20 kg barbell alike, which is the one confusion the whole load
 * model exists to prevent.
 */
function progressKpis(progress: ExerciseProgress): ViewMetric[] {
  const maxBasis =
    progress.max_comparable_load_comparability?.load_basis ?? null;
  const oneRmBasis =
    progress.best_estimated_1rm_comparability?.load_basis ?? null;
  return [
    viewMetric("workouts", "Einheiten mit dieser Übung", progress.workouts),
    viewMetric("working_sets", "Arbeitssätze", progress.working_sets),
    viewMetric(
      "max_comparable_load",
      "Maximale vergleichbare Last",
      progress.max_comparable_load,
      null,
      maxBasis,
    ),
    viewMetric(
      "best_estimated_1rm",
      "Bestes geschätztes 1RM",
      progress.best_estimated_1rm,
      null,
      oneRmBasis,
    ),
    viewMetric(
      "last_working_load",
      "Letzte Arbeitslast",
      progress.last_working_load,
      null,
      LOAD_REFERENCE_BASIS[progress.last_working_load_reference ?? "total"] ??
        null,
    ),
    viewMetric("nominal_volume", "Nominales Volumen", progress.nominal_volume),
  ];
}

/** The engine's load *reference* mapped onto the schema's load basis. */
const LOAD_REFERENCE_BASIS: Partial<Record<string, ArnoldLoadBasis>> = {
  total: "total",
  per_implement: "per_implement",
  machine_display: "machine_display",
  added_external: "added",
  assistance: "assistance",
  bodyweight: "bodyweight_only",
};

/**
 * Builds the progress payload for exactly one exercise.
 *
 * The engine is asked only for this exercise (`progress_exercise_ids`), so the
 * cost of the view does not grow with the size of the catalog.
 */
export function buildExerciseProgressView(
  dataset: ArnoldDataset,
  context: PresenterContext,
  exerciseId: string,
  metric: ProgressMetricKey = "max_load",
  options: AnalyticsOptions = {},
): ArnoldExerciseProgressView {
  const analytics = buildArnoldDashboardAnalytics(dataset, {
    ...options,
    progress_exercise_ids: [exerciseId],
    include_series: true,
  });
  const progress = analytics.exercise_progress.find(
    (entry) => entry.exercise_id === exerciseId,
  );
  const names = exerciseNames(dataset);
  const catalogEntry = dataset.exercises.find(
    (e) => e.exercise_id === exerciseId,
  );
  const series: readonly Series[] = progress?.series ?? [];
  const selected = series.find((entry) => entry.metric === metric) ?? null;
  const notices: ViewNotice[] = [];
  const hasPoints = (selected?.points.length ?? 0) > 0;
  if (!progress || progress.status === "not_available")
    notices.push({
      code: "filter_empty",
      severity: "info",
      title: "Noch keine Daten für diese Übung",
      message:
        "Für diese Übung liegen im gewählten Zeitraum keine gezählten Sätze vor.",
    });
  else if (!hasPoints) {
    // The exercise was trained, but this particular metric has nothing to plot —
    // a bodyweight exercise has no comparable load, for instance. An empty chart
    // without a reason would read as a data error.
    const why = reasonNote({
      status: selected?.status ?? "not_available",
      reasons: selected?.reasons ?? progress.reasons,
    });
    notices.push({
      code: "partial_data",
      severity: "info",
      title: "Für diese Kennzahl keine Messpunkte",
      message: `Diese Übung wurde geloggt, liefert für die gewählte Kennzahl aber keine vergleichbaren Messpunkte.${why ? ` ${why}` : ""}`,
    });
  }
  if ((progress?.variants.length ?? 0) > 1)
    notices.push({
      code: "partial_data",
      severity: "info",
      title: "Mehrere Ausführungsarten",
      message:
        "Diese Übung wurde in mehreren Ausführungen geloggt. Lasten werden nur innerhalb derselben Ausführung verglichen.",
    });
  return ArnoldExerciseProgressViewSchema.parse({
    ui_contract: ARNOLD_UI_CONTRACT,
    source: sourceOf(analytics, context),
    period: analytics.metadata.period,
    exercise_id: exerciseId,
    exercise_name:
      progress?.name_de ?? names.get(exerciseId) ?? "Unbekannte Übung",
    exercise_known: progress?.exercise_known ?? catalogEntry !== undefined,
    in_current_catalog: catalogEntry !== undefined,
    empty: !selected || !selected.points.length,
    status: progress?.status ?? "not_available",
    reasons: progress ? [...progress.reasons] : ["no_eligible_sets"],
    first_training_date: progress?.first_training_date ?? null,
    last_training_date: progress?.last_training_date ?? null,
    variants: progress ? [...progress.variants] : [],
    max_comparable_load_comparability:
      progress?.max_comparable_load_comparability ?? null,
    best_estimated_1rm_comparability:
      progress?.best_estimated_1rm_comparability ?? null,
    kpis: progress
      ? progressKpis(progress)
      : PROGRESS_METRICS.map((entry) => ({
          key: entry.key,
          label: entry.label,
          value: null,
          unit: entry.unit === "kg" ? "kg" : "reps",
          status: "not_available" as const,
          note: "Für diese Übung liegen noch keine Daten vor.",
          detail: null,
          load_basis: null,
        })),
    selected_metric: metric,
    selected_series: selected,
    // B18: the engine's comparisons, passed on unchanged.
    comparisons: progress ? [...progress.comparisons] : [],
    selected_comparison:
      progress?.comparisons.find((entry) => entry.metric === metric) ?? null,
    available_metrics: PROGRESS_METRICS.map((entry) => {
      const match = series.find((s) => s.metric === entry.key);
      return {
        key: entry.key,
        label: entry.label,
        unit: entry.unit,
        point_count: match?.points.length ?? 0,
        status: match?.status ?? "not_available",
      };
    }),
    notices,
  } satisfies ArnoldExerciseProgressView);
}

export { DEFAULT_WORKOUT_STATUSES, METRICS_VERSION };
