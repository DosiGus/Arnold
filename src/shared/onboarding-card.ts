/**
 * Which setup card fits the server state.
 *
 * Pure: it only reads what the server already derived (`progress`, `session`,
 * `open_questions`, `plan`) and computes nothing new. `show_arnold_onboarding`
 * uses it when the model names no card, and the UI uses it for payloads saved
 * in old chats that carry none.
 *
 * `benchmarks` and `run_reference` are optional and never picked here.
 */
import type { OnboardingCard, OnboardingState } from "./onboarding-contract.js";

export function cardForState(state: OnboardingState): OnboardingCard {
  const { session, progress } = state;
  if (session.status === "COMPLETED") return "start";
  // A cancelled or expired setup, or the deferred own-plan path, has no card
  // of its own: the checklist shows what is known and what is missing.
  if (
    session.status === "CANCELLED" ||
    session.status === "EXPIRED" ||
    session.profile.path === "own_plan"
  )
    return "checklist";
  if (!progress.person_complete) return "person";
  if (!session.profile.training.modules) return "modules";
  const open =
    progress.missing_fields.length > 0 ||
    state.open_questions.some((question) => question.kind === "required") ||
    (state.run_setup.required && !state.run_setup.ready);
  if (open) return "checklist";
  if (
    session.status === "PLAN_CONFIRMED" ||
    session.status === "READY_TO_FINISH"
  )
    return "wearable";
  if (state.plan) return "plan";
  return "checklist";
}
