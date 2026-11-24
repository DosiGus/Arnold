/**
 * Access control for onboarding sessions.
 *
 * The rule this module exists to enforce: **the caller's verified identity is
 * the only key to a setup** (D-11). No tool takes a setup id or a session
 * secret; the service looks up the open setup of the principal established
 * here, and checks the stored owner against it once more before acting.
 *
 * Production fails closed. `DenyOnboardingAccessControl` refuses every call
 * with `AUTH_REQUIRED`, and `AuthenticatedOnboardingAccessControl` grants only
 * the verified account it was built for. The fixture guard grants one fixed
 * synthetic subject: the local single-user demo without a login. Behind a
 * login, fixture deployments run one sandbox per account (fixture-sandboxes).
 *
 * A setup still stores the hash of a random secret (`token_fingerprint`): the
 * column predates D-11 and stays without a migration. The secret is never
 * handed out and opens nothing.
 */
import { createHash, randomBytes } from "node:crypto";
import type { OnboardingErrorCode } from "../../shared/onboarding-contract.js";
import type { OnboardingRecord } from "./repository.js";
import { currentArnoldContext } from "../auth/guarded-server.js";
import type { AuthenticatedArnoldContext } from "../auth/identity.js";

export class OnboardingAccessError extends Error {
  constructor(
    readonly code: OnboardingErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "OnboardingAccessError";
  }
}

/**
 * Who is acting.
 *
 * `kind: "fixture"` is a synthetic local subject with no relation to a real
 * person. `kind: "authenticated"` requires Task 007 and does not occur yet.
 */
export interface OnboardingPrincipal {
  subject: string;
  kind: "fixture" | "authenticated";
  verified: true;
}

export interface OnboardingAccessControl {
  readonly mode: "fixture" | "production";
  /**
   * True when the principal is a verified account. Then a setup belongs to
   * that account: there is at most one open setup per user, it is found again
   * in any new chat without the secret, and a completed setup is never started
   * again. False for anonymous guards, where a shared subject must never be
   * enough to find someone else's session.
   */
  readonly perOwner: boolean;
  /** The principal allowed to create a new session, or a refusal. */
  establish(context: unknown): Promise<OnboardingPrincipal>;
  /**
   * The principal allowed to act on an existing session, or a refusal:
   * ownership is "this record was created by the verified caller".
   */
  authorize(
    record: OnboardingRecord,
    context: unknown,
  ): Promise<OnboardingPrincipal>;
}

/** A 256-bit URL-safe secret. Only its hash is stored; it is never handed out. */
export const createSessionToken = () => randomBytes(32).toString("base64url");

export const fingerprintToken = (token: string) =>
  createHash("sha256").update(token).digest("hex");

/**
 * The local guard: one fixed synthetic subject, no login.
 *
 * Every caller is the same subject, so there is one setup per deployment.
 * That is the single-user local demo; behind a login each account gets its
 * own fixture sandbox and with it its own guard.
 */
export class FixtureOnboardingAccessControl implements OnboardingAccessControl {
  readonly mode = "fixture" as const;
  readonly perOwner = false;
  constructor(private subject = "synthetic-onboarding-fixture") {}

  private principal(): OnboardingPrincipal {
    return { subject: this.subject, kind: "fixture", verified: true };
  }

  async establish(_context?: unknown) {
    return this.principal();
  }

  async authorize(record: OnboardingRecord, _context?: unknown) {
    if (record.owner_subject !== this.subject)
      throw new OnboardingAccessError(
        "PERMISSION_DENIED",
        "Diese Einrichtung ist nicht zugänglich.",
      );
    return this.principal();
  }
}

/**
 * The production guard: refuses everything.
 *
 * Not a placeholder to be filled in later by accident — it is the safe default
 * for a mode without an identity binding. Real accounts use
 * `AuthenticatedOnboardingAccessControl`; a deployment that flips the mode
 * without one gets a clear refusal instead of an anonymous session surface.
 */
export class DenyOnboardingAccessControl implements OnboardingAccessControl {
  readonly mode = "production" as const;
  readonly perOwner = false;
  private deny(): never {
    throw new OnboardingAccessError(
      "AUTH_REQUIRED",
      "Produktive Einrichtungssitzungen benötigen eine geprüfte Nutzeridentität.",
    );
  }
  async establish(_context?: unknown): Promise<OnboardingPrincipal> {
    this.deny();
  }
  async authorize(
    _record: OnboardingRecord,
    _context?: unknown,
  ): Promise<OnboardingPrincipal> {
    this.deny();
  }
}

/** A verified Arnold account; it may act only on setups it created. */
export class AuthenticatedOnboardingAccessControl implements OnboardingAccessControl {
  readonly mode = "production" as const;
  readonly perOwner = true;
  constructor(private userId: string) {}
  async establish(context?: unknown): Promise<OnboardingPrincipal> {
    const caller = (context ?? currentArnoldContext()) as
      AuthenticatedArnoldContext | undefined;
    if (!caller || caller.userId !== this.userId)
      throw new OnboardingAccessError(
        "AUTH_REQUIRED",
        "Verifizierte Anmeldung für dieses Konto erforderlich.",
      );
    return { subject: caller.userId, kind: "authenticated", verified: true };
  }
  async authorize(record: OnboardingRecord, context?: unknown) {
    const principal = await this.establish(context);
    if (record.owner_subject !== principal.subject)
      throw new OnboardingAccessError(
        "PERMISSION_DENIED",
        "Diese Einrichtungssitzung ist nicht zugänglich.",
      );
    return principal;
  }
}
