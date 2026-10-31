import { z } from "zod";
import {
  ARNOLD_SCHEMA_ID,
  ARNOLD_SCHEMA_VERSION,
  ArnoldExecutionModeSchema,
  ArnoldIdSchema,
  ArnoldLoadBasisSchema,
} from "../shared/arnold-schema-v1.js";

/**
 * Version of the calculation conventions, not of the raw data schema.
 * Bump this whenever a formula, an eligibility rule or a status mapping changes,
 * so stored or cached results stay traceable. See docs/GUIDE.md.
 */
export const METRICS_VERSION = "1.1.0";

/**
 * `valid`         result computed from complete, unambiguous data
 * `partial`       result computed, but it does not cover every contribution
 * `not_available` result cannot be computed from the data at hand
 * `invalid`       input is internally contradictory, so no result is reported
 */
export const MetricStatusSchema = z.enum([
  "valid",
  "partial",
  "not_available",
  "invalid",
]);
export type MetricStatus = z.infer<typeof MetricStatusSchema>;

/** Machine-readable reasons; every exclusion or caveat maps onto exactly one. */
export const AnalyticsReasonSchema = z.enum([
  // eligibility
  "set_voided",
  "workout_status_not_eligible",
  "set_filtered_out",
  "set_type_not_working",
  // referential defects that a validated dataset cannot contain
  "workout_reference_missing",
  "exercise_reference_missing",
  "duplicate_workout_id",
  "duplicate_set_id",
  // load semantics
  "load_missing",
  "load_not_finite",
  "load_not_positive",
  "reps_zero",
  "reps_basis_ambiguous_for_execution_mode",
  "reps_per_side_ambiguous",
  "bodyweight_total_load_unavailable",
  "assistance_load_not_volume_comparable",
  "machine_load_not_free_weight_comparable",
  "added_load_total_unavailable",
  "volume_not_finite",
  // one-rep-max
  "reps_out_of_epley_range",
  "load_basis_not_one_rm_comparable",
  "value_is_per_implement",
  "value_is_machine_specific",
  // aggregates
  "no_eligible_workouts",
  "no_eligible_sets",
  "no_computable_sets",
  "no_previous_reference_value",
  "weekly_goal_not_configured",
  "aggregate_not_finite",
  // plans
  "plan_days_per_week_not_configured",
  "plan_target_sets_not_configured",
  "no_plan_version_applicable",
  "workout_not_attributable_to_plan",
  "plan_changed_within_week",
  "working_set_not_planned",
]);
export type AnalyticsReason = z.infer<typeof AnalyticsReasonSchema>;

export const MetricUnitSchema = z.enum([
  "kg",
  "reps",
  "sets",
  "workouts",
  "days",
  "weeks",
  "ratio",
  "count",
]);
export type MetricUnit = z.infer<typeof MetricUnitSchema>;

const finite = z.number().finite();
const count = z.number().int().nonnegative();
const reasons = z.array(AnalyticsReasonSchema).readonly();

/** How many of the eligible contributions actually made it into an aggregate. */
export const CoverageSchema = z
  .strictObject({
    eligible_sets: count,
    included_sets: count,
    excluded_sets: count,
    excluded_reasons: reasons,
  })
  .readonly();
export type Coverage = z.infer<typeof CoverageSchema>;

/**
 * Every public number is wrapped: `value: null` with a status and a reason is
 * the only way to express "unknown". A genuine zero is reported as `0`/`valid`.
 */
export const MetricValueSchema = z
  .strictObject({
    metric: z.string().min(1),
    value: finite.nullable(),
    unit: MetricUnitSchema,
    status: MetricStatusSchema,
    reasons,
    coverage: CoverageSchema.nullable(),
  })
  .readonly();
export type MetricValue = z.infer<typeof MetricValueSchema>;

/** Which documentation convention a load number follows. Never mixed unlabelled. */
export const LoadReferenceSchema = z.enum([
  "total",
  "per_implement",
  "machine_display",
  "added_external",
  "assistance",
  "bodyweight",
]);
export type LoadReference = z.infer<typeof LoadReferenceSchema>;

/**
 * Volume channels are kept apart because they are not physically comparable.
 * `free_weight` is total system load, `machine_display` is device-specific and
 * `added_external` is extra load on top of an unknown body mass.
 */
export const VolumeChannelSchema = z.enum([
  "free_weight",
  "machine_display",
  "added_external",
]);
export type VolumeChannel = z.infer<typeof VolumeChannelSchema>;

export const SetBucketSchema = z.enum(["warmup", "working", "supplemental"]);
export type SetBucket = z.infer<typeof SetBucketSchema>;

/** The dimensions a personal record must not be compared across. */
export const ComparabilitySchema = z
  .strictObject({
    key: z.string().min(1),
    exercise_id: ArnoldIdSchema,
    load_basis: ArnoldLoadBasisSchema,
    execution_mode: ArnoldExecutionModeSchema,
    implement_count: z.number().int().positive(),
    side: z.enum(["both", "left", "right", "alternating"]).nullable(),
  })
  .readonly();
export type Comparability = z.infer<typeof ComparabilitySchema>;

const isoDate = z.iso.date();

export const SeriesPointSchema = z
  .strictObject({ date: isoDate, value: finite })
  .readonly();

/** Chart-ready series. `aggregation` states how same-day workouts were merged. */
export const SeriesSchema = z
  .strictObject({
    exercise_id: ArnoldIdSchema.nullable(),
    metric: z.string().min(1),
    unit: MetricUnitSchema,
    load_reference: LoadReferenceSchema.nullable(),
    aggregation: z.enum(["max", "sum", "mean", "last"]),
    status: MetricStatusSchema,
    reasons,
    points: z.array(SeriesPointSchema).readonly(),
  })
  .readonly();
export type Series = z.infer<typeof SeriesSchema>;

export const PeriodSchema = z
  .strictObject({
    from: isoDate.nullable(),
    to: isoDate.nullable(),
    weeks: count,
    /** Anchor for "current week" and "current month"; null when the dataset carries no training date. */
    reference_date: isoDate.nullable(),
  })
  .readonly();
export type Period = z.infer<typeof PeriodSchema>;

export const WeekBucketSchema = z
  .strictObject({
    week_start: isoDate,
    iso_year: z.number().int(),
    iso_week: z.number().int().positive(),
    is_current_week: z.boolean(),
    workouts: count,
    training_days: count,
  })
  .readonly();

export const WeekStreakSchema = z
  .strictObject({
    weekly_goal_training_days: z.number().int().positive().nullable(),
    completed_weeks_streak: MetricValueSchema,
    longest_streak: MetricValueSchema,
    current_week_training_days: count,
    current_week_goal_met: z.boolean().nullable(),
    includes_current_week: z.boolean(),
  })
  .readonly();

export const ActivitySchema = z
  .strictObject({
    /** Workouts in the selection; a `workout_statuses` filter widens this. */
    workouts: MetricValueSchema,
    /** Workouts that are actually `completed`, whatever the status filter admits. */
    completed_workouts: MetricValueSchema,
    training_days: MetricValueSchema,
    completed_training_days: MetricValueSchema,
    average_workouts_per_week: MetricValueSchema,
    average_training_days_per_week: MetricValueSchema,
    training_days_current_month: MetricValueSchema,
    current_month: z
      .string()
      .regex(/^\d{4}-\d{2}$/)
      .nullable(),
    first_training_date: isoDate.nullable(),
    last_training_date: isoDate.nullable(),
    weeks: z.array(WeekBucketSchema).readonly(),
    week_streak: WeekStreakSchema,
  })
  .readonly();

const volumeBreakdown = {
  nominal_volume: MetricValueSchema,
  by_channel: z.record(VolumeChannelSchema, MetricValueSchema),
  by_bucket: z.record(SetBucketSchema, MetricValueSchema),
  sets: count,
  reps: MetricValueSchema,
} as const;

export const VolumeSchema = z
  .strictObject({
    nominal_volume: MetricValueSchema,
    comparable_free_weight_volume: MetricValueSchema,
    by_channel: z.record(VolumeChannelSchema, MetricValueSchema),
    by_bucket: z.record(SetBucketSchema, MetricValueSchema),
    per_exercise: z
      .array(
        z
          .strictObject({ exercise_id: ArnoldIdSchema, ...volumeBreakdown })
          .readonly(),
      )
      .readonly(),
    per_workout: z
      .array(
        z
          .strictObject({
            workout_id: ArnoldIdSchema,
            date: isoDate,
            ...volumeBreakdown,
          })
          .readonly(),
      )
      .readonly(),
    per_week: z
      .array(
        z
          .strictObject({
            week_start: isoDate,
            iso_year: z.number().int(),
            iso_week: z.number().int().positive(),
            ...volumeBreakdown,
          })
          .readonly(),
      )
      .readonly(),
  })
  .readonly();

export const PersonalRecordSchema = z
  .strictObject({
    metric: z.enum([
      "max_load",
      "max_reps_at_load",
      "estimated_1rm",
      "exercise_workout_volume",
    ]),
    exercise_id: ArnoldIdSchema,
    comparability: ComparabilitySchema,
    load_reference: LoadReferenceSchema,
    channel: VolumeChannelSchema.nullable(),
    value: finite,
    unit: MetricUnitSchema,
    at_load_kg: finite.nullable(),
    reps: count.nullable(),
    achieved_on: isoDate,
    workout_id: ArnoldIdSchema,
    set_id: ArnoldIdSchema.nullable(),
    previous_value: finite.nullable(),
    improvement: finite.nullable(),
    kind: z.enum(["initial", "improvement"]),
    occurrences: z.number().int().positive(),
    status: MetricStatusSchema,
    reasons,
  })
  .readonly();
export type PersonalRecord = z.infer<typeof PersonalRecordSchema>;

export const RecordsSchema = z
  .strictObject({
    status: MetricStatusSchema,
    reasons,
    max_load: z.array(PersonalRecordSchema).readonly(),
    max_reps_at_load: z.array(PersonalRecordSchema).readonly(),
    estimated_1rm: z.array(PersonalRecordSchema).readonly(),
    exercise_workout_volume: z.array(PersonalRecordSchema).readonly(),
    events_in_period: z.array(PersonalRecordSchema).readonly(),
  })
  .readonly();

export const ExerciseVariantSchema = z
  .strictObject({
    comparability: ComparabilitySchema,
    load_reference: LoadReferenceSchema,
    working_sets: count,
    max_load: MetricValueSchema,
    best_estimated_1rm: MetricValueSchema,
  })
  .readonly();

export const ExerciseProgressSchema = z
  .strictObject({
    exercise_id: ArnoldIdSchema,
    exercise_known: z.boolean(),
    name_de: z.string().nullable(),
    status: MetricStatusSchema,
    reasons,
    first_training_date: isoDate.nullable(),
    last_training_date: isoDate.nullable(),
    workouts: MetricValueSchema,
    working_sets: MetricValueSchema,
    warmup_sets: MetricValueSchema,
    last_working_load: MetricValueSchema,
    last_working_load_reference: LoadReferenceSchema.nullable(),
    max_comparable_load: MetricValueSchema,
    max_comparable_load_comparability: ComparabilitySchema.nullable(),
    best_estimated_1rm: MetricValueSchema,
    best_estimated_1rm_comparability: ComparabilitySchema.nullable(),
    nominal_volume: MetricValueSchema,
    variants: z.array(ExerciseVariantSchema).readonly(),
    series: z.array(SeriesSchema).readonly(),
  })
  .readonly();
export type ExerciseProgress = z.infer<typeof ExerciseProgressSchema>;

export const WeeklyTrendSchema = z
  .strictObject({
    week_start: isoDate,
    iso_year: z.number().int(),
    iso_week: z.number().int().positive(),
    is_current_week: z.boolean(),
    workouts: count,
    training_days: count,
    /** Days of this week with a completed session, ascending. */
    trained_dates: z.array(isoDate).readonly(),
    working_sets: count,
    nominal_volume: MetricValueSchema,
    volume_change_vs_previous_week: MetricValueSchema,
  })
  .readonly();

export const MonthlyTrendSchema = z
  .strictObject({
    month: z.string().regex(/^\d{4}-\d{2}$/),
    workouts: count,
    training_days: count,
    working_sets: count,
    nominal_volume: MetricValueSchema,
    volume_change_vs_previous_month: MetricValueSchema,
  })
  .readonly();

export const TrendsSchema = z
  .strictObject({
    weekly: z.array(WeeklyTrendSchema).readonly(),
    monthly: z.array(MonthlyTrendSchema).readonly(),
  })
  .readonly();

export const PlanWindowSchema = z
  .strictObject({
    plan_version_id: ArnoldIdSchema,
    plan_family_id: ArnoldIdSchema,
    version_no: z.number().int().positive(),
    name: z.string().min(1),
    status: z.enum(["draft", "active", "archived"]),
    days_per_week: z.number().int().positive().nullable(),
    applicable_week_starts: z.array(isoDate).readonly(),
    planned_sessions: MetricValueSchema,
    completed_attributable_workouts: count,
  })
  .readonly();

export const PlanDeviationSchema = z
  .strictObject({
    kind: z.enum([
      "missing_planned_exercise",
      "unplanned_exercise",
      "set_count_deviation",
    ]),
    workout_id: ArnoldIdSchema,
    date: isoDate,
    plan_version_id: ArnoldIdSchema.nullable(),
    session_id: ArnoldIdSchema.nullable(),
    exercise_id: ArnoldIdSchema,
    planned_working_sets: count.nullable(),
    actual_working_sets: count,
    deviation: z.number().int().nullable(),
  })
  .readonly();

export const PlanAdherenceSchema = z
  .strictObject({
    status: MetricStatusSchema,
    reasons,
    plan_windows: z.array(PlanWindowSchema).readonly(),
    weeks_without_plan: z.array(isoDate).readonly(),
    planned_sessions: MetricValueSchema,
    completed_attributable_workouts: MetricValueSchema,
    unattributed_workouts: MetricValueSchema,
    session_adherence_rate: MetricValueSchema,
    planned_working_sets: MetricValueSchema,
    /** Only working sets of an active planned position of that session. */
    completed_attributable_working_sets: MetricValueSchema,
    /** Working sets inside a planned session that the plan does not ask for. */
    unplanned_working_sets: MetricValueSchema,
    set_adherence_rate: MetricValueSchema,
    deviations: z.array(PlanDeviationSchema).readonly(),
  })
  .readonly();

export const DataQualitySchema = z
  .strictObject({
    analyzable: z.boolean(),
    status: MetricStatusSchema,
    reasons,
    data_first_date: isoDate.nullable(),
    data_last_date: isoDate.nullable(),
    workouts_by_status: z.record(z.string(), count),
    sets_by_status: z.record(z.string(), count),
    sets_by_type: z.record(z.string(), count),
    eligible_workouts: count,
    eligible_sets: count,
    computable_sets: count,
    set_exclusions: z.partialRecord(AnalyticsReasonSchema, count),
    set_caveats: z.partialRecord(AnalyticsReasonSchema, count),
    integrity_defects: z.partialRecord(AnalyticsReasonSchema, count),
    retired_exercises_in_use: z.array(ArnoldIdSchema).readonly(),
    removed_plan_items_in_use: z.array(ArnoldIdSchema).readonly(),
  })
  .readonly();

export const AnalyticsFilterSchema = z
  .strictObject({
    from: isoDate.nullable(),
    to: isoDate.nullable(),
    exercise_ids: z.array(ArnoldIdSchema).readonly().nullable(),
    plan_version_ids: z.array(ArnoldIdSchema).readonly().nullable(),
    session_ids: z.array(ArnoldIdSchema).readonly().nullable(),
    workout_ids: z.array(ArnoldIdSchema).readonly().nullable(),
    set_types: z
      .array(z.enum(["warmup", "working", "drop", "failure", "other"]))
      .readonly()
      .nullable(),
    workout_statuses: z
      .array(
        z.enum(["planned", "in_progress", "completed", "cancelled", "voided"]),
      )
      .readonly()
      .nullable(),
  })
  .readonly();
export type AnalyticsFilter = z.infer<typeof AnalyticsFilterSchema>;

export const AnalyticsMetadataSchema = z
  .strictObject({
    metrics_version: z.literal(METRICS_VERSION),
    schema_id: z.literal(ARNOLD_SCHEMA_ID),
    schema_version: z.literal(ARNOLD_SCHEMA_VERSION),
    tracker_id: ArnoldIdSchema,
    file_role: z.enum(["MASTER_TEMPLATE", "USER_TRACKER"]),
    period: PeriodSchema,
    filter: AnalyticsFilterSchema,
    week_starts_on: z.literal("monday"),
    unit_mass: z.literal("kg"),
    dataset_counts: z
      .strictObject({
        exercises: count,
        plans: count,
        plan_items: count,
        workouts: count,
        sets: count,
      })
      .readonly(),
  })
  .readonly();

/** The single public output of the analytics engine. JSON-serialisable throughout. */
export const ArnoldDashboardAnalyticsSchema = z
  .strictObject({
    metadata: AnalyticsMetadataSchema,
    activity: ActivitySchema,
    volume: VolumeSchema,
    records: RecordsSchema,
    exercise_progress: z.array(ExerciseProgressSchema).readonly(),
    weekly_trends: TrendsSchema,
    plan_adherence: PlanAdherenceSchema,
    data_quality: DataQualitySchema,
  })
  .readonly();
export type ArnoldDashboardAnalytics = z.infer<
  typeof ArnoldDashboardAnalyticsSchema
>;
