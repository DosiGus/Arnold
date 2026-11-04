/**
 * Reusable building blocks of the training plan editor.
 *
 * These components render finished server data and raise intent upwards. None
 * of them computes a plan rule, versions anything, or decides what is valid:
 * that all lives in `TrainingPlanService`, so the editor and a ChatGPT turn can
 * never disagree about what a plan is.
 *
 * Three UI rules are enforced here rather than left to each call site:
 *   - a technical id is never a primary label; it appears only as fine print;
 *   - a planned weight is always named as a target and always carries its load
 *     convention, so "70 kg" can never be mistaken for a logged lift;
 *   - every action is a real `<button>` inside a list with an accessible name,
 *     so the whole editor is reachable by keyboard and screen reader.
 */
export { PLAN_STATUS_LABEL, targetLoadText, targetSummary } from "./format";
export { PlanDialog } from "./dialog";
export { ExercisePicker } from "./exercise-picker";
export {
  draftFromExercise,
  targetsFromDraft,
  type TargetDraft,
} from "./targets";
export { ExerciseSettingsPanel } from "./exercise-settings";
export { PlannedExerciseRow, type ExerciseRowActions } from "./exercise-row";
export { TrainingSessionCard, type SessionActions } from "./session-card";
export { PlanOverview, PlanVersionHistory } from "./overview";
export {
  PlanActivationDialog,
  PlanChangeSummary,
  PlanValidationPanel,
} from "./review";
