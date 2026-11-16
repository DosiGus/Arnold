/**
 * Arnold Analytics Engine v1.
 *
 * Pure calculation layer on top of a validated `ArnoldDataset`. It has no
 * database, HTTP, MCP, React, file system or clock dependency, never mutates its
 * input and returns JSON-serialisable, Zod-validated results. The calculation
 * conventions are summarised in docs/GUIDE.md and versioned by
 * `METRICS_VERSION`.
 */
export {
  buildArnoldDashboardAnalytics,
  buildHomeAnalytics,
  prepareAnalytics,
  type AnalyticsOptions,
} from "./dashboard.js";
export {
  AnalyticsFilterError,
  AnalyticsOptionsError,
  parseAnalyticsFilter,
  type AnalyticsFilterInput,
} from "./validation.js";
export {
  analyzeSetLoad,
  comparabilityOf,
  setBucket,
  EPLEY_MAX_REPS,
  EPLEY_MIN_REPS,
  type SetLoadAnalysis,
} from "./load.js";
export {
  DEFAULT_WORKOUT_STATUSES,
  prepareAnalyticsInput,
  type PreparedInput,
  type PreparedWorkout,
} from "./eligibility.js";
export {
  computeActivity,
  runTrainingDates,
  weekActivity,
  weekStreak,
  type DatasetWithRunDays,
} from "./activity.js";
export { computeVolume, volumeBreakdown } from "./volume.js";
export { computeRecords } from "./records.js";
export { computeExerciseProgress } from "./progress.js";
export { computeTrends } from "./trends.js";
export { computePlanAdherence, planVersionAt } from "./plans.js";
export { computeDataQuality } from "./quality.js";
export {
  addDays,
  compareDate,
  daysBetween,
  isCalendarDate,
  isoWeek,
  monthKey,
  weekStart,
  weekStartsBetween,
} from "./period.js";
export {
  currentGoalValue,
  goalPoints,
  goalProgress,
  type GoalPoint,
  type GoalProgress,
  type GoalTarget,
} from "./goals.js";
export { computeHome, type HomeAnalytics } from "./home.js";
export {
  PROGRESSION_VERSION,
  ProgressionSchema,
  recommendProgression,
  weightStep,
  type Progression,
  type ProgressionResult,
} from "./progression.js";
export * from "./types.js";
export {
  dailyHealthRecovery,
  RESTING_HR_WINDOW_DAYS,
  type DailyHealthInput,
  type DailyHealthRecovery,
  type DatedValue,
} from "./health-daily.js";
