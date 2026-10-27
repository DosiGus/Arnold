/**
 * From a verified token to "which Arnold user is this, and what may they do".
 *
 * `AuthenticatedArnoldContext` is the only object the rest of Arnold should
 * accept as proof of identity. Every field in it is derived from a verified
 * credential; none of it can be supplied by a caller. That is the whole
 * contract, and it is why the type has no constructor taking a `userId` —
 * the only way to obtain one is to go through a resolver holding a verified
 * `AuthInfo`.
 *
 * The shape follows Task 007 §5's sketch, with `clientId` added: knowing
 * *which* OAuth client is acting for a user matters for audit, because "Alice
 * via ChatGPT" and "Alice via some other client" are different events even
 * though the user is the same.
 */
import type { AuthInfo } from "@modelcontextprotocol/server";
import { createHash } from "node:crypto";
import { ArnoldAuthError } from "./errors.js";
import { verifiedSubject } from "./token-verifier.js";
import type { IdentityRepository } from "../identity/repository.js";

export interface AuthenticatedArnoldContext {
  /** Arnold's own stable user id. The key for every per-user lookup. */
  readonly userId: string;
  /**
   * Who is acting, as an opaque stable handle derived from the verified
   * issuer and subject. Appears in audit events; never a raw email address.
   */
  readonly actorId: string;
  readonly scopes: readonly string[];
  readonly issuer: string;
  readonly audience: string;
  /** The OAuth client acting for the user, from the token's `client_id`. */
  readonly clientId: string;
  /**
   * A per-token handle for correlating several calls from one session without
   * storing the token. Derived from `jti` when the issuer supplies one.
   */
  readonly authSessionId: string | undefined;
  /** True when this request created the Arnold user row. */
  readonly firstSeen: boolean;
}

export interface IdentityResolverOptions {
  repository: IdentityRepository;
  /**
   * Whether a verified identity with no Arnold user yet gets one created.
   *
   * Default `true`. A `users` row holds no personal data — it is an id, a
   * status and two timestamps — so creating one on first verified contact is
   * not the "durable storage of personal onboarding state" that Task 007 §6
   * gates behind authentication; it is the thing that *provides* the
   * authenticated context that gate requires. Set `false` for endpoints that
   * must only ever read an existing account.
   */
  autoProvision?: boolean;
}

/**
 * Derives the opaque actor handle.
 *
 * Hashed rather than concatenated so that a subject identifier — which some
 * issuers derive from an email address or an internal account id — does not
 * end up in log lines and audit rows in recoverable form.
 */
export function deriveActorId(issuer: string, subject: string): string {
  const digest = createHash("sha256")
    .update(`arnold.actor/1 ${issuer} ${subject}`)
    .digest("hex");
  return `act_${digest.slice(0, 32)}`;
}

function deriveAuthSessionId(auth: AuthInfo): string | undefined {
  const tokenId = auth.extra?.tokenId;
  if (typeof tokenId !== "string" || tokenId.length === 0) return undefined;
  const digest = createHash("sha256")
    .update(`arnold.authsession/1 ${tokenId}`)
    .digest("hex");
  return `aus_${digest.slice(0, 24)}`;
}

export class ArnoldIdentityResolver {
  private readonly repository: IdentityRepository;
  private readonly autoProvision: boolean;

  constructor(options: IdentityResolverOptions) {
    this.repository = options.repository;
    this.autoProvision = options.autoProvision ?? true;
  }

  /**
   * Resolves a verified `AuthInfo` into an Arnold user context.
   *
   * Throws rather than returning a nullable context: a caller that forgets to
   * check a null is a caller that runs an authenticated operation
   * unauthenticated.
   */
  async resolve(auth: AuthInfo): Promise<AuthenticatedArnoldContext> {
    const { issuer, subject } = verifiedSubject(auth);

    const resolved = this.autoProvision
      ? await this.repository.register(issuer, subject)
      : await this.repository.find(issuer, subject);

    if (!resolved)
      throw new ArnoldAuthError(
        "IDENTITY_UNKNOWN",
        `Kein Arnold-Konto für ${deriveActorId(issuer, subject)}.`,
      );

    if (resolved.user.status !== "ACTIVE")
      throw new ArnoldAuthError(
        "ACCOUNT_DISABLED",
        `Konto ${resolved.user.user_id} hat den Status ${resolved.user.status}.`,
      );

    if (auth.resource === undefined)
      throw new ArnoldAuthError(
        "INVALID_TOKEN",
        "Verifizierter Kontext ohne Resource-Bindung.",
      );

    return {
      userId: resolved.user.user_id,
      actorId: deriveActorId(issuer, subject),
      scopes: [...auth.scopes],
      issuer,
      audience: auth.resource.toString(),
      clientId: auth.clientId,
      authSessionId: deriveAuthSessionId(auth),
      firstSeen: resolved.created,
    };
  }
}
