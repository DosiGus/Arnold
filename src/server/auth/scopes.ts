/**
 * Arnold's OAuth scope vocabulary and the tool access classes of Task 007 §5.
 *
 * Two rules shape this file.
 *
 * First, a scope names a *capability*, never a user. "Which user" is answered
 * by the verified token subject (see `identity.ts`); "may this call do that"
 * is answered here. Keeping them apart is what stops a caller from widening
 * its own reach by passing someone else's id in a tool argument.
 *
 * Second, the classes are ordered by blast radius, and every write class
 * includes the read scope. A client that may append a set can always also read
 * the tracker it appends to, so a token that grants the write but not the read
 * is a misconfiguration rather than a useful narrowing.
 */

/**
 * The scopes Arnold understands. Advertised in Protected Resource Metadata as
 * `scopes_supported`, so an authorization server and a client can discover
 * them without reading this file.
 */
export const ARNOLD_SCOPES = {
  /** Read the caller's own account and setup state. Never training content. */
  profile: "arnold.profile",
  /** Read the caller's own training data: workouts, sets, plans, analytics. */
  read: "arnold.read",
  /** Append or correct the caller's own workouts and sets. */
  write: "arnold.write",
  /** Create, edit and activate the caller's own training plans. */
  plan: "arnold.plan",
  /** Connect or disconnect Google, and act on deletion requests. */
  account: "arnold.account",
} as const;

export type ArnoldScope = (typeof ARNOLD_SCOPES)[keyof typeof ARNOLD_SCOPES];

export const ALL_ARNOLD_SCOPES: readonly ArnoldScope[] =
  Object.values(ARNOLD_SCOPES);

/**
 * How much authority a tool needs.
 *
 * Three classes run without an Arnold token, and each is narrow for a reason
 * rather than being a convenience escape hatch:
 *
 * - `PUBLIC` may only return information identical for every caller.
 *
 * - `SYNTHETIC_SANDBOX` writes, but only to process-local synthetic demo data
 *   with no user association. These are the Task 001–003 demo tools, which
 *   exist only when storage is the synthetic JSON fixture. The guard refuses
 *   this class outright in `enforced` mode, so it cannot become a way to write
 *   without authentication in a real deployment.
 *
 * - `ONBOARDING_PREVIEW` is Task 006's deliberately pre-authentication setup
 *   flow (§6's unauthenticated preview). Authorization is not absent here, it
 *   is *delegated*: `OnboardingAccessControl` requires the 256-bit session
 *   secret the setup was created with, and compares it in constant time. This
 *   class says "the Arnold token is not the credential for this call", not
 *   "there is no credential".
 */
export const TOOL_ACCESS_CLASSES = [
  "PUBLIC",
  "SYNTHETIC_SANDBOX",
  "ONBOARDING_PREVIEW",
  "AUTHENTICATED_READ",
  "AUTHENTICATED_WRITE",
  "PLAN_WRITE",
  "ACCOUNT_MANAGEMENT",
] as const;

export type ToolAccessClass = (typeof TOOL_ACCESS_CLASSES)[number];

/**
 * The exact scope set each class demands.
 *
 * `PUBLIC` is deliberately an empty tuple: it is not "any scope will do", it
 * is "this call carries no user authority at all".
 */
export const REQUIRED_SCOPES: Record<ToolAccessClass, readonly ArnoldScope[]> =
  {
    PUBLIC: [],
    SYNTHETIC_SANDBOX: [],
    ONBOARDING_PREVIEW: [],
    AUTHENTICATED_READ: [ARNOLD_SCOPES.read],
    AUTHENTICATED_WRITE: [ARNOLD_SCOPES.read, ARNOLD_SCOPES.write],
    PLAN_WRITE: [ARNOLD_SCOPES.read, ARNOLD_SCOPES.plan],
    ACCOUNT_MANAGEMENT: [ARNOLD_SCOPES.account],
  };

/** Classes for which the Arnold access token is the credential. */
export function requiresAuthentication(access: ToolAccessClass): boolean {
  return (
    access === "AUTHENTICATED_READ" ||
    access === "AUTHENTICATED_WRITE" ||
    access === "PLAN_WRITE" ||
    access === "ACCOUNT_MANAGEMENT"
  );
}

/** Classes that may change stored user state. Used by audit and rate limits. */
export function isMutating(access: ToolAccessClass): boolean {
  return (
    access === "AUTHENTICATED_WRITE" ||
    access === "PLAN_WRITE" ||
    access === "ACCOUNT_MANAGEMENT" ||
    access === "SYNTHETIC_SANDBOX"
  );
}

/**
 * The scopes in `required` that `granted` does not cover.
 *
 * Exact string comparison only. Arnold does not implement scope hierarchies or
 * wildcards: `arnold.write` never implies `arnold.plan`, and no scope implies
 * another, because an inherited-authority rule is the kind of thing that is
 * easy to get subtly wrong and hard to notice.
 */
export function missingScopes(
  granted: readonly string[],
  required: readonly ArnoldScope[],
): ArnoldScope[] {
  const held = new Set(granted);
  return required.filter((scope) => !held.has(scope));
}
