/**
 * Applies Arnold's authorization to every tool a server registers.
 *
 * This intercepts `McpServer.registerTool` rather than asking each tool to
 * guard itself, for two reasons.
 *
 * The first is coverage. Arnold's tools are registered across five modules,
 * some inside loops over a contract's keys (`WriteInputs`, `PlanWriteInputs`),
 * and some through `registerAppTool`, which delegates to `registerTool`
 * internally. A per-call-site guard would have to be added in each of those
 * places and remembered in each future one. Interception covers all of them,
 * including registrations in code that knows nothing about authentication.
 *
 * The second is the failure mode. An unclassified tool throws **at
 * registration time**, so the server refuses to start rather than publishing a
 * tool with no authority requirement. A forgotten classification becomes a
 * boot failure in development instead of an unauthenticated write path in
 * production — which is the difference between a typo and an incident.
 *
 * What this does *not* do is replace the handler's own checks. The domain
 * services from Tasks 004–006 keep their idempotency, revision and ownership
 * logic; this layer only answers "may this caller invoke this tool at all",
 * and hands the handler a verified user context to work from.
 */
import type { McpServer, ServerContext } from "@modelcontextprotocol/server";
import { requireToolAccess } from "./tool-access.js";
import { scopeChallengeFor, type ArnoldToolGuard } from "./tool-guard.js";
import type { AuthenticatedArnoldContext } from "./identity.js";
import { AsyncLocalStorage } from "node:async_hooks";

/**
 * The verified context for the call currently being handled.
 *
 * Handlers registered before Task 007 take only their own input, so there is
 * no parameter to pass a context through. Rather than rewrite every signature
 * in Tasks 001–006, the guard records the resolved context here for the
 * duration of the call and `currentArnoldContext()` reads it back.
 *
 * AsyncLocalStorage carries that context across awaits without sharing it
 * with another request. A module-level variable is unsafe even on one Node
 * thread: another handler can run while the first is awaiting storage.
 */
const activeContext = new AsyncLocalStorage<
  AuthenticatedArnoldContext | undefined
>();

/** The verified user for the in-flight tool call, if the class provides one. */
export function currentArnoldContext(): AuthenticatedArnoldContext | undefined {
  return activeContext.getStore();
}

/** Trusted HTTP callback paths use the same isolated context as MCP handlers. */
export function withArnoldContext<T>(
  context: AuthenticatedArnoldContext,
  action: () => T,
): T {
  return activeContext.run(context, action);
}

type RegisterTool = McpServer["registerTool"];

export interface GuardRegistrationOptions {
  /**
   * Treat the write classes as `SYNTHETIC_SANDBOX` for this server.
   *
   * The same tool name means different things depending on what it writes to.
   * `log_workout_sets` against a user's Google tracker is a write to personal
   * data and needs `arnold.write`; the identical tool against Task 004's
   * synthetic fixture runtime touches process-local invented data owned by
   * nobody. Classifying by name alone cannot express that, so the runtime says
   * which case it is.
   *
   * Only legitimate when the write runtime's mode is `fixture`. Setting it
   * wrongly cannot open a hole: the guard refuses `SYNTHETIC_SANDBOX` outright
   * in `enforced` mode, so a mistake here denies writes rather than permitting
   * them. `ACCOUNT_MANAGEMENT` is never reclassified.
   */
  syntheticWrites?: boolean;
  authenticatedOnboarding?: boolean;
}

/**
 * Wraps `server` so every subsequent `registerTool` is classified and guarded.
 *
 * Must be called before any tool is registered — the patch applies to later
 * registrations, not to ones already made. Returns the same instance.
 */
export function guardToolRegistrations(
  server: McpServer,
  guard: ArnoldToolGuard,
  options: GuardRegistrationOptions = {},
): McpServer {
  const original = server.registerTool.bind(server) as RegisterTool;

  const patched = ((
    name: string,
    config: Record<string, unknown>,
    handler: (...args: unknown[]) => unknown,
  ) => {
    // Throws for an unclassified tool, taking the server down at startup.
    const declared = requireToolAccess(name);
    const access =
      options.syntheticWrites &&
      (declared === "AUTHENTICATED_WRITE" || declared === "PLAN_WRITE")
        ? "SYNTHETIC_SANDBOX"
        : options.authenticatedOnboarding && declared === "ONBOARDING_PREVIEW"
          ? "PLAN_WRITE"
          : declared;

    const challenge = scopeChallengeFor(access);
    const guardedConfig = {
      ...config,
      // Lets the server answer an under-scoped call with a protocol-correct
      // insufficient_scope challenge before the handler runs. Advisory
      // plumbing; the guard below is the gate.
      ...(challenge && config.scopeChallenge === undefined
        ? { scopeChallenge: challenge }
        : {}),
    };

    // Handlers come in two shapes: `(input, ctx)` for tools with an input
    // schema, and `(ctx)` for tools without one. The context is always the
    // last argument, so it is read from the end rather than by position.
    const guardedHandler = async (...args: unknown[]) => {
      const ctx = args[args.length - 1] as ServerContext;
      const context = await guard.authorize(name, access, ctx);
      return activeContext.run(context, () => handler(...args));
    };

    return (original as unknown as (...a: unknown[]) => unknown)(
      name,
      guardedConfig,
      guardedHandler,
    );
  }) as unknown as RegisterTool;

  Object.defineProperty(server, "registerTool", {
    value: patched,
    configurable: true,
    writable: true,
  });

  return server;
}
