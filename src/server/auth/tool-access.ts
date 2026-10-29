/**
 * The authoritative classification of every MCP tool Arnold publishes.
 *
 * One table, in one file, because the alternative — an access class written
 * next to each `registerTool` call — spreads the security model across five
 * modules and makes "what can an unauthenticated caller reach?" a question
 * you answer by grepping. Here it is a question you answer by reading.
 *
 * The table is also the enforcement point for a property worth more than the
 * classifications themselves: **a tool missing from this table cannot be
 * registered.** `guarded-server.ts` throws at registration time, so a new tool
 * whose author forgot to classify it takes the server down at startup instead
 * of quietly becoming reachable without authorization. Failing closed at boot
 * is the cheapest possible moment to find that mistake.
 *
 * Tool names are matched exactly. There is no prefix rule and no "anything
 * starting with get_ is a read" heuristic, because a naming convention is not
 * an access control and the first tool to violate the convention would inherit
 * the wrong authority silently.
 */
import type { ToolAccessClass } from "./scopes.js";

/**
 * Every tool name → the authority it requires.
 *
 * Grouped by the module that registers it. Several tools are registered only
 * under specific configuration (noted per group); they are classified here
 * regardless, so the classification does not depend on how the server happens
 * to be configured.
 */
export const TOOL_ACCESS: Readonly<Record<string, ToolAccessClass>> = {
  connect_google_account: "ACCOUNT_MANAGEMENT",
  finish_arnold_setup: "ACCOUNT_MANAGEMENT",
  get_google_connection: "ACCOUNT_MANAGEMENT",
  disconnect_google_account: "ACCOUNT_MANAGEMENT",
  // ── mcp.ts — the Task 001–003 v1 surface (demo / read-only Sheets) ──
  show_arnold_dashboard: "AUTHENTICATED_READ",
  get_dashboard_data: "AUTHENTICATED_READ",
  get_workouts: "AUTHENTICATED_READ",
  get_exercise_progress: "AUTHENTICATED_READ",
  // Registered only when storage is the synthetic JSON fixture (`isDemo`).
  // They write, but only to process-local synthetic data owned by nobody.
  log_demo_set: "SYNTHETIC_SANDBOX",
  reset_demo_data: "SYNTHETIC_SANDBOX",

  // ── mcp-arnold.ts — the v2 analytics surface ──
  get_arnold_dashboard_v2: "AUTHENTICATED_READ",
  get_arnold_workouts_v2: "AUTHENTICATED_READ",
  get_arnold_exercise_progress_v2: "AUTHENTICATED_READ",

  // ── mcp-workout.ts — Task 004 ──
  get_workout: "AUTHENTICATED_READ",
  // Registered only when a workout runtime is injected and not disabled.
  start_workout: "AUTHENTICATED_WRITE",
  log_workout_sets: "AUTHENTICATED_WRITE",
  update_set: "AUTHENTICATED_WRITE",
  void_set: "AUTHENTICATED_WRITE",
  complete_workout: "AUTHENTICATED_WRITE",
  cancel_workout: "AUTHENTICATED_WRITE",
  // A custom exercise is training content, not plan structure, so it rides
  // with the workout write scope rather than the plan one.
  create_exercise: "AUTHENTICATED_WRITE",

  // ── mcp-plan.ts — Task 005 ──
  get_training_plan: "AUTHENTICATED_READ",
  list_training_plans: "AUTHENTICATED_READ",
  get_plan_history: "AUTHENTICATED_READ",
  validate_training_plan: "AUTHENTICATED_READ",
  compare_plan_versions: "AUTHENTICATED_READ",
  get_plan_editor_context: "AUTHENTICATED_READ",
  // Plan writes are their own scope: a client allowed to log sets is not
  // therefore allowed to rewrite the plan those sets are measured against.
  clone_plan_version: "PLAN_WRITE",
  create_training_plan: "PLAN_WRITE",
  create_plan_version: "PLAN_WRITE",
  update_plan_draft: "PLAN_WRITE",
  activate_training_plan: "PLAN_WRITE",
  archive_plan_draft: "PLAN_WRITE",

  // ── mcp-onboarding.ts — Task 006 ──
  // Pre-authentication by design (§6). Authorization is delegated to
  // OnboardingAccessControl, which requires the session's own 256-bit secret.
  // Registered only when an OnboardingService is injected.
  show_arnold_onboarding: "ONBOARDING_PREVIEW",
  start_arnold_onboarding: "ONBOARDING_PREVIEW",
  get_onboarding_state: "ONBOARDING_PREVIEW",
  update_onboarding_profile: "ONBOARDING_PREVIEW",
  get_onboarding_brief: "ONBOARDING_PREVIEW",
  request_onboarding_plan: "ONBOARDING_PREVIEW",
  submit_onboarding_plan_proposal: "ONBOARDING_PREVIEW",
  get_onboarding_plan: "ONBOARDING_PREVIEW",
  confirm_onboarding_plan: "ONBOARDING_PREVIEW",
  revise_onboarding_plan: "ONBOARDING_PREVIEW",
  get_onboarding_handoff: "ONBOARDING_PREVIEW",
  cancel_onboarding: "ONBOARDING_PREVIEW",
};

export class UnclassifiedToolError extends Error {
  constructor(readonly tool: string) {
    super(
      `Das Tool "${tool}" hat keine Zugriffsklasse in TOOL_ACCESS. Jedes MCP-Tool muss klassifiziert sein, bevor es registriert werden darf. Ergänze es in src/server/auth/tool-access.ts.`,
    );
    this.name = "UnclassifiedToolError";
  }
}

/** The class for `tool`, or `undefined` when it is not classified. */
export function toolAccessFor(tool: string): ToolAccessClass | undefined {
  return Object.hasOwn(TOOL_ACCESS, tool) ? TOOL_ACCESS[tool] : undefined;
}

/** The class for `tool`, or a throw. Used at registration time. */
export function requireToolAccess(tool: string): ToolAccessClass {
  const access = toolAccessFor(tool);
  if (access === undefined) throw new UnclassifiedToolError(tool);
  return access;
}

/** Every tool in a given class. For documentation and tests. */
export function toolsWithAccess(access: ToolAccessClass): string[] {
  return Object.entries(TOOL_ACCESS)
    .filter(([, value]) => value === access)
    .map(([tool]) => tool)
    .sort();
}
