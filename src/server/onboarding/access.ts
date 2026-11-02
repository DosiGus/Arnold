/**
 * Access control for onboarding sessions.
 *
 * The rule this module exists to enforce: **a session id submitted by a client
 * is not a permission.** Without a login a setup session is anonymous — and
 * an anonymous resource addressed by a guessable id would be readable by
 * anyone who guessed it. Three mechanisms prevent that.
 *
 * First, a session is created with a 256-bit secret. The client keeps it; the
 * server stores only its SHA-256. A stolen database holds no usable tokens, and
 * the secret never appears in a log line or a tool's text output.
 *
 * Second, the comparison is constant-time. A timing oracle on a session token
 * is a real way to brute-force one.
 *
 * Third, production fails closed. `ProductionOnboardingAccessControl` refuses
 * every call with `AUTH_REQUIRED` until a verified identity provider is wired
 * in, so switching the mode on cannot accidentally expose anonymous sessions.
 * The fixture guard is the only one that grants anything, and it only ever
 * grants its own synthetic subject.
 */
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
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
   * The principal allowed to act on an existing session, or a refusal.
   *
   * Receives the stored record *and* the presented secret, because ownership is
   * exactly "this caller holds the secret this session was created with".
   */
  authorize(
    record: OnboardingRecord,
    presentedToken: string,
    context: unknown,
  ): Promise<OnboardingPrincipal>;
}

/** A 256-bit URL-safe secret. Returned to the client once and never stored. */
export const createSessionToken = () => randomBytes(32).toString("base64url");

export const fingerprintToken = (token: string) =>
  createHash("sha256").update(token).digest("hex");

/** Constant-time comparison of two hex fingerprints. */
export function tokenMatches(fingerprint: string, presented: string): boolean {
  const expected = Buffer.from(fingerprint, "hex");
  const actual = Buffer.from(fingerprintToken(presented), "hex");
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

/**
 * The local test guard.
 *
 * Grants one fixed synthetic subject, and only when the presented secret
 * matches the one the session was created with. Two sessions created by this
 * guard therefore still cannot read each other — which is the isolation
 * property Task 006 §22-E asks for, and it holds even though both share a
 * subject.
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

  async authorize(
    record: OnboardingRecord,
    presentedToken: string,
    _context?: unknown,
  ) {
    if (!presentedToken)
      throw new OnboardingAccessError(
        "AUTH_REQUIRED",
        "Für diese Einrichtungssitzung fehlt der Sitzungsnachweis.",
      );
    if (!tokenMatches(record.token_fingerprint, presentedToken))
      // Deliberately the same wording as an unknown session: whether an id
      // exists is itself information a caller without the secret may not have.
      throw new OnboardingAccessError(
        "PERMISSION_DENIED",
        "Diese Einrichtungssitzung ist nicht zugänglich.",
      );
    if (record.owner_subject !== this.subject)
      throw new OnboardingAccessError(
        "PERMISSION_DENIED",
        "Diese Einrichtungssitzung gehört zu einem anderen Kontext.",
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
    _presentedToken: string,
    _context?: unknown,
  ): Promise<OnboardingPrincipal> {
    this.deny();
  }
}

/** A verified Arnold account plus the existing session secret are both required. */
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
  async authorize(record: OnboardingRecord, token: string, context?: unknown) {
    const principal = await this.establish(context);
    if (
      record.owner_subject !== principal.subject ||
      !tokenMatches(record.token_fingerprint, token)
    )
      throw new OnboardingAccessError(
        "PERMISSION_DENIED",
        "Diese Einrichtungssitzung ist nicht zugänglich.",
      );
    return principal;
  }
}

/**
 * An opaque name for "this session with this confirmed revision".
 *
 * Derived from the session id, the confirmed revision and the stored token
 * fingerprint, so it is stable for one confirmed plan, changes when the plan
 * changes, and cannot be inverted back into the session secret. It is a
 * *binding*, not a credential.
 */
export function setupBinding(
  record: OnboardingRecord,
  confirmedRevision: number,
): string {
  return createHash("sha256")
    .update(
      [
        "arnold.onboarding.oauth-binding/1",
        record.session.onboarding_session_id,
        String(confirmedRevision),
        record.token_fingerprint,
      ].join("|"),
    )
    .digest("hex");
}
