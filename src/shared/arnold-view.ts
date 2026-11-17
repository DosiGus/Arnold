/**
 * Arnold dashboard UI contract, version 2.
 *
 * This is the explicitly versioned boundary between the analytics engine and the
 * React app. It exists because the v1 `DashboardSchema` is built on a fixed
 * Push/Pull/Legs split and on bare `kg` numbers, both of which the Arnold schema
 * contradicts: a v1-shaped answer for Arnold data would have to invent a split
 * and drop the load convention. Rather than change v1 silently, Arnold mode
 * speaks this contract and says so in `ui_contract`.
 *
 * Design rules that the schemas below enforce:
 *  - every number that can be unknown is a `ViewMetric`, never a bare `0`;
 *  - the analytics engine's own result types are reused wherever they already
 *   fit, so there is exactly one analytics model in the system;
 *  - raw set fields travel unchanged, so the UI can show what the user entered
 *   and format it through `arnold-format.ts` alone.
 */
import { z } from "zod";
import {
  ArnoldExecutionModeSchema,
  ArnoldGoalKindSchema,
  ArnoldIdSchema,
  ArnoldLoadBasisSchema,
} from "./arnold-schema-v1.js";
import { DASHBOARD_CARDS } from "./dashboard-cards.js";
import { ArnoldRecapSchema } from "./recap-contract.js";
import { ArnoldScoresSchema } from "./scores-contract.js";
import { WatchDeliverySchema } from "./watch-contract.js";
import {
  AnalyticsReasonSchema,
  ComparabilitySchema,
  ExerciseVariantSchema,
  MetricStatusSchema,
  MetricUnitSchema,
  MetricValueSchema,
  PeriodSchema,
  ProgressComparisonSchema,
  SeriesSchema,
  type MetricValue,
} from "../analytics/types.js";

export const ARNOLD_UI_CONTRACT = "arnold.dashboard/2";

const isoDate = z.iso.date();
const count = z.number().int().nonnegative();

/**
 * A metric prepared for display. `value: null` means unknown and must render as
 * a placeholder plus `note`; it must never be shown as 0. `status` and `note`
 * come from the engine's `MetricValue`, so the reason a number is missing
 * survives all the way into the interface.
 */
export const ViewMetricSchema = z.object({
  key: z.string().min(1),
  label: z.string().min(1),
  value: z.number().finite().nullable(),
  unit: MetricUnitSchema,
  status: MetricStatusSchema,
  /**
   * German explanation. Present whenever the engine attached a reason — which
   * includes a correctly computed value that carries a caveat, such as a load
   * that is per implement rather than a total.
   */
  note: z.string().nullable(),
  /** Optional secondary line, e.g. what the number is based on. */
  detail: z.string().nullable(),
  /**
   * The load convention this number follows, when it is a load at all. Without
   * it a dumbbell's "20 kg" is indistinguishable from a 20 kg total.
   */
  load_basis: ArnoldLoadBasisSchema.nullable().default(null),
});
export type ViewMetric = z.infer<typeof ViewMetricSchema>;

/** Operating mode of the server; decides which tools and UI path are in play. */
export const ViewModeSchema = z.enum(["arnold"]);

/**
 * Where the numbers come from, in the user's words. `file_role` keeps the master
 * template distinguishable from a real tracker so the UI can never present the
 * shared template as a finished personal account.
 */
export const ViewSourceSchema = z.object({
  mode: ViewModeSchema,
  /** Short label, e.g. "Arnold · Mein Training". */
  label: z.string().min(1),
  /** Longer sentence for the source note. */
  description: z.string().min(1),
  synthetic: z.boolean(),
  read_only: z.boolean(),
  file_role: z.enum(["MASTER_TEMPLATE", "USER_TRACKER"]),
  tracker_id: z.string().min(1),
  schema_id: z.string().min(1),
  schema_version: z.string().min(1),
  metrics_version: z.string().min(1),
  /** When the server produced this payload. The UI uses it to flag staleness. */
  generated_at: z.iso.datetime(),
});
export type ViewSource = z.infer<typeof ViewSourceSchema>;

/**
 * Coarse state of the data behind the view, so the UI picks one screen instead
 * of inferring emptiness from array lengths.
 */
export const ViewStateSchema = z.enum([
  /** Usable training history present. */
  "ready",
  /** Catalog and tables exist, no workouts yet — the first-run case. */
  "empty_history",
  /** Not even an exercise catalog. */
  "empty_catalog",
  /** Reading the shared master template, which never holds personal data. */
  "master_template",
]);

/**
 * A condition the user has to know about. These are additive to `ViewState`:
 * data can be `ready` and still be partially invalid.
 */
export const ViewNoticeSchema = z.object({
  code: z.enum([
    "partial_data",
    "retired_exercises_in_use",
    "removed_plan_items_in_use",
    "no_plan_configured",
    "weekly_goal_missing",
    "master_template",
    "filter_empty",
  ]),
  severity: z.enum(["info", "warning"]),
  title: z.string().min(1),
  message: z.string().min(1),
});
export type ViewNotice = z.infer<typeof ViewNoticeSchema>;

/** One bar/point of the weekly development chart. */
export const ViewWeekSchema = z.object({
  week_start: isoDate,
  label: z.string().min(1),
  iso_year: z.number().int(),
  iso_week: z.number().int().positive(),
  is_current_week: z.boolean(),
  /** Sessions in the week. */
  workouts: count,
  /** Distinct calendar days with training; the weekly goal compares this. */
  training_days: count,
  /**
   * Every calendar day of the week with a completed session, ascending, from
   * workout_date_local. Not limited to `recent_workouts`.
   */
  trained_dates: z.array(isoDate),
  working_sets: count,
  /** Nominal volume; null when no eligible set in the week had a usable load. */
  nominal_volume: z.number().finite().nullable(),
  nominal_volume_status: MetricStatusSchema,
});

/** Summary row for a training session in the overview and the history list. */
export const ViewWorkoutSummarySchema = z.object({
  workout_id: ArnoldIdSchema,
  date: isoDate,
  /** The session name as recorded at the time, never rebuilt from today's plan. */
  title: z.string().min(1),
  plan_version_id: ArnoldIdSchema.nullable(),
  plan_name: z.string().nullable(),
  plan_version_no: z.number().int().positive().nullable(),
  session_id: ArnoldIdSchema.nullable(),
  status: z.enum([
    "planned",
    "in_progress",
    "completed",
    "cancelled",
    "voided",
  ]),
  status_label: z.string().min(1),
  /** False for a workout the analytics engine leaves out of its aggregates. */
  counts_towards_metrics: z.boolean(),
  exercise_count: count,
  set_count: count,
  working_set_count: count,
  nominal_volume: z.number().finite().nullable(),
  nominal_volume_status: MetricStatusSchema,
  /** Recorded on the Garmin watch (it keeps its client session id). */
  from_watch: z.boolean().default(false),
});
export type ViewWorkoutSummary = z.infer<typeof ViewWorkoutSummarySchema>;

const nullableNumber = z.number().finite().nullable();
const ViewWatchSnapshotSchema = z.object({
  body_battery: nullableNumber,
  stress: nullableNumber,
  resting_hr: nullableNumber,
});

/**
 * What the watch recorded for one workout, with the metrics from
 * `src/analytics/recording.ts`. The card shows these values and computes
 * nothing. `health` is null without stored health data (no consent).
 */
export const ViewWatchRecordingSchema = z.object({
  started_at_utc: z.string().min(1),
  ended_at_utc: z.string().min(1),
  duration_s: z.number().int().nonnegative().nullable(),
  rest: z.object({
    measured_pauses: count,
    planned_s: nullableNumber,
    actual_s: nullableNumber,
    delta_s: nullableNumber,
    ratio_pct: nullableNumber,
  }),
  health: z
    .object({
      heart_rate: z
        .object({
          average_bpm: nullableNumber,
          max_bpm: nullableNumber,
          measured_seconds: count,
          missing_seconds: count,
        })
        .nullable(),
      /**
       * Raw samples for the small curve, at most 120 evenly picked from the
       * recording; a gap stays null.
       */
      heart_rate_curve: z.array(z.number().int().positive().nullable()),
      calories_kcal: nullableNumber,
      before: ViewWatchSnapshotSchema.nullable(),
      after: ViewWatchSnapshotSchema.nullable(),
      /** After minus before; null unless both are known. */
      differences: ViewWatchSnapshotSchema,
    })
    .nullable(),
});
export type ViewWatchRecording = z.infer<typeof ViewWatchRecordingSchema>;

/**
 * One set, exactly as stored. Nothing is merged, converted or rounded here, so
 * "20 kg pro Hantel × 10 pro Seite" keeps every part of its meaning.
 */
export const ViewSetSchema = z.object({
  set_id: ArnoldIdSchema,
  set_number: z.number().int().positive(),
  set_type: z.enum(["warmup", "working", "drop", "failure", "other"]),
  reps: count,
  reps_basis: z.enum(["total", "per_side"]),
  load_kg: z.number().finite().nullable(),
  load_basis: ArnoldLoadBasisSchema,
  implement_count: z.number().int().positive(),
  execution_mode: ArnoldExecutionModeSchema,
  side: z.enum(["both", "left", "right", "alternating"]),
  rpe: z.number().finite().nullable(),
  rir: count.nullable(),
  notes: z.string().nullable(),
  voided: z.boolean(),
});
export type ViewSet = z.infer<typeof ViewSetSchema>;

/**
 * An exercise inside one workout. `name` is the snapshot stored with the sets,
 * which is why a workout stays readable after the exercise leaves the plan or
 * the catalog. `in_current_catalog` only drives a hint, never the name.
 */
export const ViewExerciseBlockSchema = z.object({
  exercise_id: ArnoldIdSchema,
  name: z.string().min(1),
  exercise_order: z.number().int().positive(),
  in_current_catalog: z.boolean(),
  retired: z.boolean(),
  /** True when several load conventions appear within this one block. */
  mixed_load_basis: z.boolean(),
  sets: z.array(ViewSetSchema),
});

export const ViewWorkoutDetailSchema = ViewWorkoutSummarySchema.extend({
  timezone: z.string().min(1),
  notes: z.string().nullable(),
  source: z.enum(["chat", "ui", "manual_import", "sync"]),
  exercises: z.array(ViewExerciseBlockSchema),
  /** Only with a database and a recording from the watch. */
  watch: ViewWatchRecordingSchema.nullable().default(null),
});
export type ViewWorkoutDetail = z.infer<typeof ViewWorkoutDetailSchema>;

/** A personal record, kept inside one comparability class. */
export const ViewRecordSchema = z.object({
  metric: z.enum([
    "max_load",
    "max_reps_at_load",
    "estimated_1rm",
    "exercise_workout_volume",
  ]),
  metric_label: z.string().min(1),
  exercise_id: ArnoldIdSchema,
  exercise_name: z.string().min(1),
  value: z.number().finite(),
  unit: MetricUnitSchema,
  /** The load convention this record is expressed in; never mixed with another. */
  load_basis: ArnoldLoadBasisSchema.nullable(),
  execution_mode: ArnoldExecutionModeSchema.nullable(),
  side: z.enum(["both", "left", "right", "alternating"]).nullable(),
  implement_count: z.number().int().positive().nullable(),
  at_load_kg: z.number().finite().nullable(),
  reps: count.nullable(),
  achieved_on: isoDate,
  workout_id: ArnoldIdSchema,
  kind: z.enum(["initial", "improvement"]),
  previous_value: z.number().finite().nullable(),
  improvement: z.number().finite().nullable(),
  comparability: ComparabilitySchema.nullable(),
});
export type ViewRecord = z.infer<typeof ViewRecordSchema>;

/** Active plan, plus the history needed to read old workouts correctly. */
export const ViewPlanSchema = z.object({
  plan_version_id: ArnoldIdSchema,
  plan_family_id: ArnoldIdSchema,
  version_no: z.number().int().positive(),
  name: z.string().min(1),
  status: z.enum(["draft", "active", "archived"]),
  days_per_week: z.number().int().positive().nullable(),
  session_count: count,
  sessions: z.array(
    z.object({
      session_id: ArnoldIdSchema,
      session_name: z.string().min(1),
      session_order: z.number().int().positive(),
      exercise_count: count,
    }),
  ),
});
export type ViewPlan = z.infer<typeof ViewPlanSchema>;

/** Catalog entry for selectors; `logged_sets` lets the UI mark untrained ones. */
export const ViewExerciseOptionSchema = z.object({
  exercise_id: ArnoldIdSchema,
  name: z.string().min(1),
  equipment: z.string().nullable(),
  primary_muscle: z.string().nullable(),
  default_load_basis: ArnoldLoadBasisSchema.nullable(),
  default_execution_mode: ArnoldExecutionModeSchema.nullable(),
  /** False for an exercise that only exists in history, not in today's catalog. */
  in_current_catalog: z.boolean(),
  retired: z.boolean(),
  logged_sets: count,
  last_trained_on: isoDate.nullable(),
});
export type ViewExerciseOption = z.infer<typeof ViewExerciseOptionSchema>;

/** Condensed data-quality report; the full engine object stays server-side. */
export const ViewDataQualitySchema = z.object({
  analyzable: z.boolean(),
  status: MetricStatusSchema,
  eligible_workouts: count,
  eligible_sets: count,
  computable_sets: count,
  excluded_sets: count,
  /** Human-readable, already translated exclusion reasons. */
  notes: z.array(z.string()),
});

/** Which series a progress chart may draw, with its German label and unit. */
export const PROGRESS_METRICS = [
  { key: "max_load", label: "Maximale vergleichbare Last", unit: "kg" },
  { key: "estimated_1rm", label: "Geschätztes 1RM", unit: "kg" },
  { key: "nominal_volume", label: "Nominales Trainingsvolumen", unit: "kg" },
  { key: "total_reps", label: "Wiederholungen", unit: "Wdh." },
  {
    key: "mean_reps_per_working_set",
    label: "Ø Wiederholungen pro Arbeitssatz",
    unit: "Wdh.",
  },
] as const;
export const ProgressMetricKeySchema = z.enum([
  "max_load",
  "estimated_1rm",
  "nominal_volume",
  "total_reps",
  "mean_reps_per_working_set",
]);
export type ProgressMetricKey = z.infer<typeof ProgressMetricKeySchema>;

/**
 * The start screen: four tiles (training, progress, goals, records) and the
 * three views behind them. Every number comes from `src/analytics/home.ts`;
 * the UI formats, it does not compute.
 */
const finiteNumber = z.number().finite();

export const HomeRecordSchema = z.object({
  key: z.string().min(1),
  exercise_id: ArnoldIdSchema,
  exercise_name: z.string().min(1),
  muscle_group: z.string().min(1),
  metric: z.enum(["max_load", "max_reps_at_load", "max_reps_bodyweight"]),
  /** kg for max_load, repetitions otherwise. */
  value: finiteNumber,
  previous_value: finiteNumber,
  load_kg: finiteNumber.nullable(),
  reps: count.nullable(),
  load_basis: ArnoldLoadBasisSchema,
  achieved_on: isoDate,
  workout_id: ArnoldIdSchema,
});
export type HomeRecord = z.infer<typeof HomeRecordSchema>;

export const HomeGoalSchema = z.object({
  goal_id: ArnoldIdSchema,
  /** Needed to change or end the goal. */
  row_revision: z.number().int().positive(),
  kind: ArnoldGoalKindSchema,
  exercise_id: ArnoldIdSchema.nullable(),
  /** "Körpergewicht" or the exercise name. */
  name: z.string().min(1),
  unit: z.enum(["kg", "reps"]),
  load_basis: ArnoldLoadBasisSchema.nullable(),
  target_value: finiteNumber,
  start_value: finiteNumber.nullable(),
  current_value: finiteNumber.nullable(),
  current_date: isoDate.nullable(),
  /** 0 to 1; null while nothing is measured. */
  progress: z.number().min(0).max(1).nullable(),
  achieved: z.boolean(),
  rate_per_week: finiteNumber.nullable(),
  eta_weeks: z.number().int().positive().nullable(),
  points: z.array(z.object({ date: isoDate, value: finiteNumber })),
});
export type HomeGoal = z.infer<typeof HomeGoalSchema>;

export const ArnoldHomeSchema = z.object({
  next_session: z
    .object({
      plan_version_id: ArnoldIdSchema,
      session_id: ArnoldIdSchema,
      session_name: z.string().min(1),
      exercise_count: count,
    })
    .nullable(),
  streak: z.object({
    weekly_goal: z.number().int().positive().nullable(),
    current: count.nullable(),
    longest: count.nullable(),
    is_best: z.boolean(),
    current_week_training_days: count,
    weeks: z.array(
      z.object({
        week_start: isoDate,
        training_days: count,
        goal_met: z.boolean(),
        is_current_week: z.boolean(),
      }),
    ),
  }),
  year: z.number().int(),
  workouts_this_year: count,
  strength_change: z.object({
    percent: finiteNumber.nullable(),
    since: isoDate.nullable(),
    exercises: count,
  }),
  best_month: z
    .object({
      month: z.string().regex(/^\d{4}-\d{2}$/),
      workouts: count,
    })
    .nullable(),
  muscle_groups: z.array(
    z.object({
      name: z.string().min(1),
      strength_change_pct: finiteNumber.nullable(),
      records: count,
      sets_per_week: finiteNumber,
    }),
  ),
  records: z.array(HomeRecordSchema),
  records_by_exercise: z.array(
    z.object({
      exercise_id: ArnoldIdSchema,
      exercise_name: z.string().min(1),
      muscle_group: z.string().min(1),
      count: count,
      latest: HomeRecordSchema,
      history: z.array(HomeRecordSchema),
    }),
  ),
  goals: z.array(HomeGoalSchema),
  /** Best sets per exercise, for choosing a new goal. */
  exercise_bests: z.array(
    z.object({
      exercise_id: ArnoldIdSchema,
      best_load_kg: finiteNumber.nullable(),
      best_load_reps: count.nullable(),
      load_basis: ArnoldLoadBasisSchema,
      best_reps: count.nullable(),
    }),
  ),
  latest_body_weight: z
    .object({ date: isoDate, weight_kg: finiteNumber })
    .nullable(),
});
export type ArnoldHome = z.infer<typeof ArnoldHomeSchema>;

/**
 * Payload of `get_arnold_dashboard` and of `show_arnold_dashboard` in Arnold
 * mode. Aggregated on purpose: workout details and exercise series are fetched
 * separately so this stays small as history grows.
 */
export const ArnoldDashboardViewSchema = z.object({
  ui_contract: z.literal(ARNOLD_UI_CONTRACT),
  state: ViewStateSchema,
  source: ViewSourceSchema,
  period: PeriodSchema,
  notices: z.array(ViewNoticeSchema),
  kpis: z.array(ViewMetricSchema),
  weeks: z.array(ViewWeekSchema),
  recent_workouts: z.array(ViewWorkoutSummarySchema),
  records: z.array(ViewRecordSchema),
  active_plan: ViewPlanSchema.nullable(),
  plan_history: z.array(
    z.object({
      plan_version_id: ArnoldIdSchema,
      name: z.string().min(1),
      version_no: z.number().int().positive(),
      status: z.enum(["draft", "active", "archived"]),
      workouts: count,
    }),
  ),
  exercises: z.array(ViewExerciseOptionSchema),
  /** Distinct session names present in history; drives the history filter. */
  session_names: z.array(z.string().min(1)),
  data_quality: ViewDataQualitySchema,
  /** Start screen and its three detail views. */
  home: ArnoldHomeSchema,
  /**
   * Rückblick auf das neue Training (UX-006). Only set when there is a real,
   * not yet seen workout; absent or null otherwise.
   */
  recap: ArnoldRecapSchema.nullable().optional(),
  /**
   * Konstanz, Fortschritt, Erholung (UX-009), from `src/analytics/scores.ts`.
   * Additive: absent in payloads from before UX-009.
   */
  scores: ArnoldScoresSchema.optional(),
  /**
   * Which calendar day "today" is for this view (UX-016). `timezone` when the
   * request named the user's zone; `fallback` (UTC day, no "today" marker)
   * when it did not. The UI never works out the day itself.
   */
  reference: z
    .object({
      date: z.iso.date(),
      timezone: z.string().nullable(),
      source: z.enum(["timezone", "fallback"]),
    })
    .optional(),
  /**
   * Whether the current plan is on the user's watch (UX-007). Only set by a
   * database source; absent means unknown. The UI shows a line only for
   * delivered and pending.
   */
  watch_delivery: WatchDeliverySchema.optional(),
  /**
   * The adjustment for a while that applies today (UX-008), for the hint in
   * the overview. Absent or null when the normal plan applies.
   */
  adjustment: z
    .object({
      plan_adjustment_id: ArnoldIdSchema,
      kind: z.enum(["today", "week", "month", "range"]),
      start_date_local: z.iso.date(),
      end_date_local: z.iso.date(),
      /** First day on which the normal plan applies again. */
      normal_from: z.iso.date(),
      reason: z.string().nullable(),
    })
    .nullable()
    .optional(),
  totals: z.object({
    workouts_in_history: count,
    workouts_in_period: count,
    sets_in_period: count,
  }),
  /**
   * What `show_arnold_dashboard` was asked to open, after the server checked
   * every id against the user's own data (B17). Absent for a plain overview.
   */
  focus: z
    .object({
      card: z.enum(DASHBOARD_CARDS),
      exercise_id: ArnoldIdSchema.nullable(),
      metric: ProgressMetricKeySchema.nullable(),
      workout_id: ArnoldIdSchema.nullable(),
    })
    .optional(),
});
export type ArnoldDashboardView = z.infer<typeof ArnoldDashboardViewSchema>;

/** Payload of `get_arnold_workouts`; a page of history plus its detail blocks. */
export const ArnoldWorkoutHistoryViewSchema = z.object({
  ui_contract: z.literal(ARNOLD_UI_CONTRACT),
  source: ViewSourceSchema,
  /** Total matches before `limit`/`offset`, so the UI can page honestly. */
  total: count,
  offset: count,
  limit: z.number().int().positive(),
  has_more: z.boolean(),
  workouts: z.array(ViewWorkoutDetailSchema),
  notices: z.array(ViewNoticeSchema),
});
export type ArnoldWorkoutHistoryView = z.infer<
  typeof ArnoldWorkoutHistoryViewSchema
>;

/**
 * Payload of `get_arnold_exercise_progress`.
 *
 * Every number here is taken from the engine's own `ExerciseProgress` — this is
 * a projection of that result, not a second progress model. The engine types are
 * reused for the parts that travel structurally (`variants`, `selected_series`);
 * its `MetricValue`s are projected onto the compact `ViewMetric` in `kpis`,
 * because embedding the whole result would repeat the 40-value reason enum about
 * twenty times and inflate this tool's advertised schema threefold.
 */
export const ArnoldExerciseProgressViewSchema = z.object({
  ui_contract: z.literal(ARNOLD_UI_CONTRACT),
  source: ViewSourceSchema,
  period: PeriodSchema,
  exercise_id: ArnoldIdSchema,
  exercise_name: z.string().min(1),
  exercise_known: z.boolean(),
  in_current_catalog: z.boolean(),
  /** True when the exercise has no eligible set in the selected period. */
  empty: z.boolean(),
  status: MetricStatusSchema,
  reasons: z.array(AnalyticsReasonSchema),
  first_training_date: isoDate.nullable(),
  last_training_date: isoDate.nullable(),
  /** Execution variants kept apart, so incomparable loads stay separate. */
  variants: z.array(ExerciseVariantSchema),
  /** Comparability class the headline max load belongs to. */
  max_comparable_load_comparability: ComparabilitySchema.nullable(),
  /** Comparability class the headline 1RM estimate belongs to. */
  best_estimated_1rm_comparability: ComparabilitySchema.nullable(),
  kpis: z.array(ViewMetricSchema),
  /** The series the caller asked for; `points` are real measurements only. */
  selected_metric: ProgressMetricKeySchema,
  selected_series: SeriesSchema.nullable(),
  /**
   * First against last measurement per metric, from the analytics engine
   * (B18). Within one comparability class, or `status: "not_available"` with
   * a reason. The UI shows these values and computes nothing.
   */
  comparisons: z.array(ProgressComparisonSchema),
  /** The comparison of `selected_metric`; null when the exercise has none. */
  selected_comparison: ProgressComparisonSchema.nullable(),
  available_metrics: z.array(
    z.object({
      key: ProgressMetricKeySchema,
      label: z.string().min(1),
      unit: z.string().min(1),
      point_count: count,
      status: MetricStatusSchema,
    }),
  ),
  notices: z.array(ViewNoticeSchema),
});
export type ArnoldExerciseProgressView = z.infer<
  typeof ArnoldExerciseProgressViewSchema
>;

export type { MetricValue };
export { MetricValueSchema };
