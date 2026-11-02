/**
 * When ChatGPT must ask before calling a tool (decision D10).
 *
 * - Reading and normal logging run directly.
 * - Discarding, cancelling, activating and disconnecting need a question in
 *   the chat and a clear yes.
 * - Deleting the account additionally needs a click in the card.
 *
 * Like TOOL_ACCESS, every tool must have a rule: the guard appends the rule's
 * sentence to the tool description at registration and refuses a tool
 * without one, so a new tool cannot silently skip the decision.
 */
export type ConfirmationRule = "direct" | "ask_in_chat" | "ask_and_card_click";

export interface ConfirmationEntry {
  rule: ConfirmationRule;
  /** Why, in one German sentence (documented in docs/beta/handoff-B.md). */
  reason: string;
}

const read: ConfirmationEntry = {
  rule: "direct",
  reason: "Nur lesen, nichts ändert sich.",
};
const log: ConfirmationEntry = {
  rule: "direct",
  reason: "Normales Loggen; jede Änderung ist korrigierbar.",
};
const draft: ConfirmationEntry = {
  rule: "direct",
  reason: "Ändert nur einen Entwurf, der aktive Plan bleibt unverändert.",
};
const setup: ConfirmationEntry = {
  rule: "direct",
  reason: "Schritt der Einrichtung, den der Nutzer selbst anstößt.",
};

export const CONFIRMATION_RULES: Readonly<Record<string, ConfirmationEntry>> = {
  // Account
  finish_arnold_setup: setup,
  delete_arnold_account: {
    rule: "ask_and_card_click",
    reason: "Nicht umkehrbar: alle Arnold-Daten des Nutzers werden gelöscht.",
  },
  get_arnold_stored_data: read,

  // Dashboard and analytics
  show_arnold_dashboard: read,
  get_arnold_dashboard: read,
  get_arnold_workouts: read,
  get_arnold_exercise_progress: read,

  // Workout
  get_workout: read,
  start_workout: log,
  log_workout_sets: log,
  update_set: log,
  complete_workout: log,
  create_exercise: log,
  void_set: {
    rule: "ask_in_chat",
    reason: "Verwirft einen gespeicherten Satz.",
  },
  cancel_workout: {
    rule: "ask_in_chat",
    reason: "Bricht ein Training ab; es zählt danach nicht mehr.",
  },

  // Plan
  get_training_plan: read,
  list_training_plans: read,
  get_plan_history: read,
  validate_training_plan: read,
  compare_plan_versions: read,
  get_plan_editor_context: read,
  clone_plan_version: draft,
  create_training_plan: draft,
  create_plan_version: draft,
  update_plan_draft: draft,
  activate_training_plan: {
    rule: "ask_in_chat",
    reason: "Ersetzt den aktiven Plan; künftige Trainings richten sich danach.",
  },
  archive_plan_draft: {
    rule: "ask_in_chat",
    reason: "Verwirft einen Planentwurf.",
  },

  // Onboarding
  show_arnold_onboarding: read,
  start_arnold_onboarding: setup,
  get_onboarding_state: read,
  update_onboarding_profile: setup,
  get_onboarding_brief: read,
  request_onboarding_plan: setup,
  submit_onboarding_plan_proposal: setup,
  get_onboarding_plan: read,
  confirm_onboarding_plan: {
    rule: "direct",
    reason:
      "Die Bestätigung ist selbst die Rückfrage: der Nutzer bestätigt den Plan in Karte oder Chat.",
  },
  revise_onboarding_plan: setup,
  get_onboarding_handoff: read,
  cancel_onboarding: {
    rule: "ask_in_chat",
    reason: "Bricht die Einrichtung ab; eine Planbestätigung verfällt.",
  },
};

export const CONFIRMATION_TEXT: Readonly<Record<ConfirmationRule, string>> = {
  direct: "",
  ask_in_chat:
    "Rückfrage: Vor dem Aufruf im Chat kurz nachfragen und nur nach einem klaren Ja ausführen.",
  ask_and_card_click:
    "Rückfrage: Vor dem Aufruf im Chat nachfragen. Ausgeführt wird erst nach einem Klick des Nutzers in der Karte.",
};

export class UnconfirmedToolError extends Error {
  constructor(readonly tool: string) {
    super(
      `Das Tool "${tool}" hat keine Bestätigungsregel in CONFIRMATION_RULES (src/server/auth/confirmation-rules.ts).`,
    );
    this.name = "UnconfirmedToolError";
  }
}

/** The description with the tool's confirmation sentence appended. */
export function withConfirmationRule(
  tool: string,
  description: string | undefined,
): string {
  const entry = Object.hasOwn(CONFIRMATION_RULES, tool)
    ? CONFIRMATION_RULES[tool]
    : undefined;
  if (!entry) throw new UnconfirmedToolError(tool);
  const text = CONFIRMATION_TEXT[entry.rule];
  const base = description ?? "";
  if (!text || base.includes(text)) return base;
  return base ? `${base} ${text}` : text;
}
