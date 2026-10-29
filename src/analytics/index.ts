/**
 * Arnold Analytics Engine v1.
 *
 * Pure calculation layer on top of a validated `ArnoldDataset`. It has no
 * Google, HTTP, MCP, React, file system or clock dependency, never mutates its
 * input and returns JSON-serialisable, Zod-validated results. The calculation
 * conventions are summarised in docs/GUIDE.md and versioned by
 * `METRICS_VERSION`.
 */
export {
  buildArnoldDashboardAnalytics,
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
export { computeActivity, weekActivity, weekStreak } from "./activity.js";
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
export * from "./types.js";
