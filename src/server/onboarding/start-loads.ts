/**
 * Start weights in the plan a setup proposes.
 *
 * The chat model builds the plan (days, exercises, sets, reps) and leaves
 * weights it was not told empty. Before the draft is stored, Arnold fills
 * those from its own estimate (`src/analytics/start-load.ts`), so the first
 * training does not open with "Gewicht fehlt" on every exercise. A weight the
 * model was given stays exactly as it is; an exercise Arnold cannot estimate
 * stays empty and is asked for in the card.
 */
import {
  canEstimateStartLoad,
  estimateStartLoad,
  type StartLoadLevel,
} from "../../analytics/start-load.js";
import type { ArnoldExercise } from "../../shared/arnold-schema-v1.js";
import type { OnboardingProfile } from "../../shared/onboarding-contract.js";
import type {
  TrainingPlanVersion,
  TrainingSessionInput,
} from "../../shared/plan-contract.js";

type Targets = {
  exercise_id: string;
  rep_min?: number | null;
  rep_max?: number | null;
  target_load_basis?: string | null;
};

/** The estimate for one planned exercise, or null when Arnold has none. */
function estimateFor(
  profile: OnboardingProfile,
  exercise: ArnoldExercise | undefined,
  targets: Targets,
  level: StartLoadLevel,
): number | null {
  if (!exercise || !canEstimateStartLoad(exercise.exercise_id)) return null;
  if (exercise.default_load_basis === "bodyweight_only") return null;
  // The table is in the exercise's own load basis; a plan item that weighs
  // the exercise differently is left to the user.
  if (
    targets.target_load_basis &&
    targets.target_load_basis !== exercise.default_load_basis
  )
    return null;
  return estimateStartLoad({
    exercise_id: exercise.exercise_id,
    reps: targets.rep_max ?? targets.rep_min ?? null,
    sex: profile.person.sex ?? null,
    body_weight_kg: profile.person.body_weight_kg ?? null,
    age_years: profile.person.age_years ?? null,
    experience: profile.training.experience,
    known: profile.training.known_loads ?? {},
    level,
  });
}

/** The proposal's sessions with every missing, estimable weight filled in. */
export function withStartLoads(
  sessions: readonly TrainingSessionInput[],
  profile: OnboardingProfile,
  catalog: readonly ArnoldExercise[],
): TrainingSessionInput[] {
  const byId = new Map(catalog.map((e) => [e.exercise_id, e]));
  return sessions.map((session) => ({
    ...session,
    exercises: session.exercises.map((exercise) => {
      if (exercise.target_load_kg != null) return exercise;
      const kg = estimateFor(
        profile,
        byId.get(exercise.exercise_id),
        exercise,
        "normal",
      );
      return kg === null ? exercise : { ...exercise, target_load_kg: kg };
    }),
  }));
}

/** The three levels of the "Startgewichte" switch, per draft position. */
export function loadEstimates(
  plan: TrainingPlanVersion | null,
  profile: OnboardingProfile,
  catalog: readonly ArnoldExercise[],
) {
  if (!plan) return [];
  const byId = new Map(catalog.map((e) => [e.exercise_id, e]));
  return plan.sessions.flatMap((session) =>
    session.exercises.flatMap((item) => {
      const exercise = byId.get(item.exercise_id);
      const at = (level: StartLoadLevel) =>
        estimateFor(profile, exercise, item, level);
      const lighter = at("lighter");
      const normal = at("normal");
      const heavier = at("heavier");
      return lighter !== null && normal !== null && heavier !== null
        ? [{ plan_item_id: item.plan_item_id, lighter, normal, heavier }]
        : [];
    }),
  );
}
