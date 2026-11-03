/**
 * Onboarding first: the tracker stays closed until an account is set up.
 *
 * A new user who says "zeig mir mein Training" or "ich will loslegen" must land
 * in the onboarding, not in an empty dashboard. ChatGPT decides which tool it
 * calls, so this cannot be a redirect; instead every tracker tool answers a
 * not-yet-set-up account with `SETUP_REQUIRED` and names the tool to call.
 * The server instructions and the onboarding tool description say the same,
 * so the model usually opens the onboarding before it ever gets here.
 *
 * Plan tools are deliberately *not* gated: the onboarding's own plan editor
 * uses them on the draft. Onboarding and account tools are never gated.
 * Deployments without a verified account (fixture) report
 * "set up" and are unaffected; see `OnboardingService.setupRequired`.
 */
import type { McpServer } from "@modelcontextprotocol/server";
import type { OnboardingService } from "./service.js";

/** Tools that show or write training data and need a set-up account. */
export const SETUP_GATED_TOOLS: ReadonlySet<string> = new Set([
  "show_arnold_dashboard",
  "get_arnold_dashboard",
  "get_arnold_workouts",
  "get_arnold_exercise_progress",
  "get_workout",
  "start_workout",
  "log_workout_sets",
  "update_set",
  "void_set",
  "complete_workout",
  "cancel_workout",
  "create_exercise",
  "create_training_goal",
  "update_training_goal",
  "archive_training_goal",
  "log_body_weight",
  "void_body_weight",
]);

export const SETUP_REQUIRED_TEXT =
  "SETUP_REQUIRED: Arnold ist für dieses Konto noch nicht eingerichtet. Zuerst show_arnold_onboarding aufrufen: Der Nutzer wählt dort, ob Arnold seinen Plan erstellt oder er seinen eigenen übernimmt. Danach stehen Trainingsüberblick und Training zur Verfügung.";

type RegisterTool = (
  name: string,
  config: Record<string, unknown>,
  handler: (...args: unknown[]) => unknown,
) => unknown;

/**
 * Patches `registerTool` so gated tools check the setup first.
 *
 * Applied after the auth guard, so the check runs inside the verified user
 * context and an unauthenticated call is still refused by the guard first.
 */
export function gateUntilSetUp(
  server: McpServer,
  onboarding: OnboardingService,
  context?: unknown,
): McpServer {
  const original = server.registerTool.bind(server) as unknown as RegisterTool;
  const patched: RegisterTool = (name, config, handler) => {
    if (!SETUP_GATED_TOOLS.has(name)) return original(name, config, handler);
    const gated = async (...args: unknown[]) => {
      if (await onboarding.setupRequired(context))
        return {
          isError: true,
          content: [{ type: "text" as const, text: SETUP_REQUIRED_TEXT }],
          _meta: {
            arnold: {
              code: "SETUP_REQUIRED",
              retryable: false,
              recovery: "finish_setup",
            },
          },
        };
      return handler(...args);
    };
    return original(name, config, gated);
  };
  Object.defineProperty(server, "registerTool", {
    value: patched,
    configurable: true,
    writable: true,
  });
  return server;
}
