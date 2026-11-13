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
  // ── account/mcp-account.ts ──
  // Two stages; the second needs the token only the card sends (B6).
  delete_arnold_account: "ACCOUNT_MANAGEMENT",
  // Read only, but about the account itself (B7).
  get_arnold_stored_data: "ACCOUNT_MANAGEMENT",
  show_arnold_dashboard: "AUTHENTICATED_READ",

  // ── mcp-watch.ts — Garmin watch (UMSETZUNG §5) ──
  // Pairing, listing and unpairing change what may act for the account.
  pair_garmin_watch: "ACCOUNT_MANAGEMENT",
  list_garmin_watches: "ACCOUNT_MANAGEMENT",
  unpair_garmin_watch: "ACCOUNT_MANAGEMENT",
  set_garmin_health_consent: "ACCOUNT_MANAGEMENT",

  // ── mcp-arnold.ts — the v2 analytics surface ──
  get_arnold_dashboard: "AUTHENTICATED_READ",
  get_arnold_workouts: "AUTHENTICATED_READ",
  get_arnold_exercise_progress: "AUTHENTICATED_READ",

  // ── mcp-run.ts — RUN-007 ──
  get_run_profile: "AUTHENTICATED_READ",
  get_run_analysis: "AUTHENTICATED_READ",
  // Registered only when a run service is injected and not disabled.
  update_run_profile: "AUTHENTICATED_WRITE",
  plan_run: "AUTHENTICATED_WRITE",
  update_planned_run: "AUTHENTICATED_WRITE",
  cancel_planned_run: "AUTHENTICATED_WRITE",
  log_run: "AUTHENTICATED_WRITE",
  rate_run: "AUTHENTICATED_WRITE",
  // RUN-008: week view and the two-step week planning.
  get_run_week: "AUTHENTICATED_READ",
  schedule_run_week: "AUTHENTICATED_WRITE",

  // ── mcp-workout.ts — Task 004 ──
  get_workout: "AUTHENTICATED_READ",
  // Registered only when a workout runtime is injected and not disabled.
  start_workout: "AUTHENTICATED_WRITE",
  log_workout_sets: "AUTHENTICATED_WRITE",
  update_set: "AUTHENTICATED_WRITE",
  void_set: "AUTHENTICATED_WRITE",
  complete_workout: "AUTHENTICATED_WRITE",
  cancel_workout: "AUTHENTICATED_WRITE",
  log_workout: "AUTHENTICATED_WRITE",
  void_workout: "AUTHENTICATED_WRITE",
  // A custom exercise is training content, not plan structure, so it rides
  // with the workout write scope rather than the plan one.
  create_exercise: "AUTHENTICATED_WRITE",
  // Goals and body weight are the user's own training data, like sets.
  create_training_goal: "AUTHENTICATED_WRITE",
  update_training_goal: "AUTHENTICATED_WRITE",
  archive_training_goal: "AUTHENTICATED_WRITE",
  log_body_weight: "AUTHENTICATED_WRITE",
  void_body_weight: "AUTHENTICATED_WRITE",

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
  // Activates the confirmed plan; behind a login it needs arnold.plan.
  finish_arnold_setup: "ONBOARDING_PREVIEW",
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

/**
 * The watch API's routes (`/api/watch/v1`, UMSETZUNG §5), classified like the
 * tools above. The watch router registers a route only through
 * `requireWatchRouteAccess`, so an unclassified route stops the start.
 *
 * - `WATCH_PAIRING`: no credential yet; rate-limited, and the pairing secret
 *   itself is checked by the database functions.
 * - `WATCH_READ` / `WATCH_WRITE`: an `arn_w_` watch token with the scope.
 */
export type WatchRouteAccess = "WATCH_PAIRING" | "WATCH_READ" | "WATCH_WRITE";

export const WATCH_ROUTE_ACCESS: Readonly<Record<string, WatchRouteAccess>> = {
  "POST /pair/start": "WATCH_PAIRING",
  "POST /pair/token": "WATCH_PAIRING",
  "GET /device": "WATCH_READ",
  "DELETE /device": "WATCH_WRITE",
  "GET /plan": "WATCH_READ",
  "GET /plan/sessions/:session_id": "WATCH_READ",
  "GET /plan/recent": "WATCH_READ",
  "POST /workouts": "WATCH_WRITE",
  "PUT /workouts/:session_uuid/health": "WATCH_WRITE",
  "GET /runs/upcoming": "WATCH_READ",
  "GET /runs/:id": "WATCH_READ",
  "POST /runs": "WATCH_WRITE",
  "PATCH /runs/:session_uuid/rpe": "WATCH_WRITE",
};

export class UnclassifiedWatchRouteError extends Error {
  constructor(readonly route: string) {
    super(
      `Die Uhr-Route "${route}" hat keine Zugriffsklasse in WATCH_ROUTE_ACCESS. Ergänze sie in src/server/auth/tool-access.ts.`,
    );
    this.name = "UnclassifiedWatchRouteError";
  }
}

/** The class for `METHOD path`, or a throw. Used when the router is built. */
export function requireWatchRouteAccess(
  method: string,
  path: string,
): WatchRouteAccess {
  const route = `${method.toUpperCase()} ${path}`;
  if (!Object.hasOwn(WATCH_ROUTE_ACCESS, route))
    throw new UnclassifiedWatchRouteError(route);
  return WATCH_ROUTE_ACCESS[route]!;
}
