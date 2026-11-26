/**
 * The per-call authorization gate for MCP tools.
 *
 * Task 007 §5 requires that write tools check their permission on *every*
 * call. That sounds obvious and is easy to get wrong in a way that is hard to
 * see: the usual mistake is to resolve identity once per connection and then
 * trust it, which turns a long-lived MCP session into a window where a
 * revoked token keeps working. So the guard here runs per invocation, and the
 * only way to get a user context is to hand it a fresh `ServerContext`.
 *
 * The guard is deliberately not a decorator that wraps handlers invisibly.
 * Each tool names its access class at its own registration site, so reading
 * `mcp-*.ts` tells you what every tool requires without chasing indirection —
 * and a tool with no access class is a type error rather than a tool that
 * silently defaults to public.
 */
import type { AuthInfo, ServerContext } from "@modelcontextprotocol/server";
import {
  requireScopes,
  type ScopeChallengeHandler,
} from "@modelcontextprotocol/server";
import { ArnoldAuthError } from "./errors.js";
import type {
  ArnoldIdentityResolver,
  AuthenticatedArnoldContext,
} from "./identity.js";
import {
  REQUIRED_SCOPES,
  missingScopes,
  requiresAuthentication,
  type ArnoldScope,
  type ToolAccessClass,
} from "./scopes.js";

/**
 * How strictly the guard behaves.
 *
 * `enforced` is the only mode that may face real users. `open` exists so the
 * pre-Task-007 demo and read-only Arnold modes keep working unchanged
 * (Task 007 §32's regression requirement) — it refuses every access class
 * above `AUTHENTICATED_READ`, so an unauthenticated deployment cannot write.
 */
export const GUARD_MODES = ["enforced", "open"] as const;
export type GuardMode = (typeof GUARD_MODES)[number];

export interface ToolGuardOptions {
  mode: GuardMode;
  resolver: ArnoldIdentityResolver;
  /**
   * The synthetic context served in `open` mode. Required in that mode and
   * forbidden in `enforced`, so a fixture identity cannot leak into a
   * deployment that believes it is authenticating.
   */
  openModeContext?: AuthenticatedArnoldContext;
  /** Audit sink. Called for every refusal and every mutating success. */
  onEvent?: (event: GuardEvent) => void;
}

export interface GuardEvent {
  kind: "granted" | "refused";
  tool: string;
  access: ToolAccessClass;
  /** Present once identity is known. Absent when the refusal preceded it. */
  userId?: string;
  actorId?: string;
  clientId?: string;
  code?: string;
  /** Operator-facing detail. Never contains token material. */
  detail?: string;
  at: string;
}

/** Reads the verified token out of a tool's context, if the transport had one. */
export function authInfoOf(ctx: ServerContext): AuthInfo | undefined {
  return ctx.http?.authInfo;
}

export class ArnoldToolGuard {
  /** Read by the server factory: sandbox writes exist only in `open`. */
  readonly mode: GuardMode;
  private readonly resolver: ArnoldIdentityResolver;
  private readonly openModeContext: AuthenticatedArnoldContext | undefined;
  private readonly onEvent: ((event: GuardEvent) => void) | undefined;

  constructor(options: ToolGuardOptions) {
    this.mode = options.mode;
    this.resolver = options.resolver;
    this.onEvent = options.onEvent;
    if (options.mode === "open") {
      if (!options.openModeContext)
        throw new Error(
          "Der offene Modus benötigt einen expliziten synthetischen Kontext.",
        );
      this.openModeContext = options.openModeContext;
    } else if (options.openModeContext) {
      throw new Error(
        "Im erzwungenen Modus darf kein synthetischer Kontext konfiguriert sein.",
      );
    }
  }

  private emit(event: Omit<GuardEvent, "at">): void {
    this.onEvent?.({ ...event, at: new Date().toISOString() });
  }

  /**
   * Authorizes one call, returning the user context it may act as.
   *
   * `PUBLIC` returns `undefined`: a public tool has no user, and giving it a
   * context would invite it to read per-user data it has no business reading.
   */
  async authorize(
    tool: string,
    access: ToolAccessClass,
    ctx: ServerContext,
  ): Promise<AuthenticatedArnoldContext | undefined> {
    try {
      const context = await this.resolveFor(tool, access, ctx);
      if (context)
        this.emit({
          kind: "granted",
          tool,
          access,
          userId: context.userId,
          actorId: context.actorId,
          clientId: context.clientId,
        });
      return context;
    } catch (error) {
      const authError =
        error instanceof ArnoldAuthError
          ? error
          : new ArnoldAuthError("INVALID_TOKEN", String(error));
      this.emit({
        kind: "refused",
        tool,
        access,
        code: authError.code,
        detail: authError.detail,
      });
      throw authError;
    }
  }

  private async resolveFor(
    tool: string,
    access: ToolAccessClass,
    ctx: ServerContext,
  ): Promise<AuthenticatedArnoldContext | undefined> {
    // Writes to synthetic demo data are allowed only where that data is all
    // there is. In an enforcing deployment this class must not exist at all,
    // so it is refused rather than quietly downgraded.
    if (access === "SYNTHETIC_SANDBOX") {
      if (this.mode !== "open")
        throw new ArnoldAuthError(
          "AUTH_REQUIRED",
          `${tool} schreibt synthetische Demo-Daten und ist in einem authentifizierenden Betrieb nicht verfügbar.`,
        );
      return this.openModeContext;
    }

    // Task 006's setup flow authorizes itself with the session secret, so the
    // Arnold token is not the credential for these calls. The onboarding
    // service refuses the call if the secret is absent or wrong.
    if (access === "ONBOARDING_PREVIEW") return undefined;

    if (!requiresAuthentication(access)) return undefined;

    if (this.mode === "open") {
      // An unauthenticated deployment may read synthetic data and must never
      // write. Refusing here rather than at the storage layer means a new
      // write tool is safe by default even if its author forgets.
      if (access !== "AUTHENTICATED_READ")
        throw new ArnoldAuthError(
          "AUTH_REQUIRED",
          `${tool} verlangt ${access}; der offene Modus erlaubt nur lesenden Zugriff.`,
        );
      return this.openModeContext;
    }

    const auth = authInfoOf(ctx);
    if (!auth)
      throw new ArnoldAuthError(
        "AUTH_REQUIRED",
        `${tool} ohne verifizierten Bearer-Kontext aufgerufen.`,
      );

    const context = await this.resolver.resolve(auth);
    this.requireScopesFor(tool, access, context.scopes);
    return context;
  }

  private requireScopesFor(
    tool: string,
    access: ToolAccessClass,
    granted: readonly string[],
  ): void {
    const required: readonly ArnoldScope[] = REQUIRED_SCOPES[access];
    const missing = missingScopes(granted, required);
    if (missing.length > 0)
      throw new ArnoldAuthError(
        "INSUFFICIENT_SCOPE",
        `${tool} verlangt ${required.join(", ")}; fehlt: ${missing.join(", ")}.`,
      );
  }
}

/**
 * The SDK-level scope challenge for an access class.
 *
 * Registering this on a tool makes the server answer an under-scoped call with
 * a protocol-correct `insufficient_scope` challenge *before* the handler runs,
 * which is what lets a client go and get a better token. The guard's own check
 * then repeats the same test inside the handler — not redundancy for its own
 * sake, but because the challenge is advisory plumbing and the guard is the
 * actual gate. A tool registered without a challenge is still safe; a tool
 * relying only on the challenge would not be.
 */
export function scopeChallengeFor(
  access: ToolAccessClass,
): ScopeChallengeHandler | undefined {
  const required = REQUIRED_SCOPES[access];
  if (required.length === 0) return undefined;
  return requireScopes(...(required as [ArnoldScope, ...ArnoldScope[]]));
}
