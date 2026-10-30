/**
 * Arnold's `OAuthTokenVerifier`: turns a bearer string into a verified
 * `AuthInfo`, or refuses it.
 *
 * This is the only place in Arnold that decides a caller's identity. Every
 * authenticated tool reads the result of this function and nothing else — in
 * particular, no tool reads a user id from its own arguments. That asymmetry
 * is the whole point of Task 007 §5: an MCP tool argument is attacker-chosen
 * data, and a verified token claim is not.
 *
 * Order of checks matters and is deliberate: cheap structural checks, then the
 * signature, then claims. Claim validation never runs on an unverified token,
 * so a forged `iss` can never be read as if it were trustworthy — not even
 * into a log line.
 *
 * Audience handling is the subtle part. RFC 8707 resource indicators are what
 * stop a token minted for some *other* MCP server from working here, which is
 * a real risk once a single authorization server fronts several resources.
 * The SDK compares `AuthInfo.resource` against its configured
 * `expectedResource`, so this verifier's job is to populate that field
 * honestly from `aud` — and to refuse a token whose `aud` does not name
 * Arnold at all, rather than passing it along for someone else to check.
 */
import type { AuthInfo } from "@modelcontextprotocol/server";
import { ArnoldAuthError, asAuthError } from "./errors.js";
import type { KeyResolver } from "./jwks.js";
import { decodeJwt, verifyJwtSignature, type JwtClaims } from "./jwt.js";

export interface TokenVerifierOptions {
  /** The exact `iss` Arnold accepts. Compared as an opaque string. */
  issuer: string;
  /**
   * Arnold's RFC 8707 resource identifier — its canonical MCP URL. A token
   * must name this in `aud` to be accepted.
   */
  audience: string;
  keys: KeyResolver;
  /**
   * Tolerance for clock drift between Arnold and the issuer, in seconds.
   * Applied to `exp`, `nbf` and `iat`. Kept small: a generous skew window is
   * an expired token that still works.
   */
  clockToleranceSec?: number;
  /**
   * Hard ceiling on token lifetime, in seconds. A token whose `exp - iat`
   * exceeds this is refused even if the signature is good, so a
   * misconfigured authorization server handing out year-long access tokens
   * cannot silently become Arnold's problem. `null` disables the check.
   */
  maxLifetimeSec?: number | null;
  now?: () => number;
  /**
   * A namespaced claim (`urn:arnold:scopes`) to read Arnold's scopes from
   * instead of `scope`/`scp`. When set, only this claim counts: the standard
   * claim then holds the issuer's own scopes (`openid email …`), and mixing
   * the two would let one source quietly widen the other.
   */
  scopeClaim?: string;
}

export const DEFAULT_CLOCK_TOLERANCE_SEC = 60;
export const DEFAULT_MAX_LIFETIME_SEC = 24 * 60 * 60;

/** Normalizes a URL for comparison: drops the fragment and one trailing slash. */
export function canonicalResource(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return value;
  }
  url.hash = "";
  const text = url.toString();
  return text.endsWith("/") ? text.slice(0, -1) : text;
}

/** `aud` is a string or an array of strings; both normalize to a list. */
function audienceList(aud: JwtClaims["aud"]): string[] {
  if (typeof aud === "string") return [aud];
  if (Array.isArray(aud))
    return aud.filter((v): v is string => typeof v === "string");
  return [];
}

/**
 * Scopes may arrive as the space-delimited `scope` of RFC 8693, or as `scp`
 * (string or array), which several widely deployed issuers use instead.
 */
function scopeList(claims: JwtClaims, scopeClaim?: string): string[] {
  if (scopeClaim !== undefined) {
    const value = (claims as Record<string, unknown>)[scopeClaim];
    if (typeof value === "string") return value.split(" ").filter(Boolean);
    if (Array.isArray(value))
      return value.filter((v): v is string => typeof v === "string");
    return [];
  }
  if (typeof claims.scope === "string")
    return claims.scope.split(" ").filter(Boolean);
  if (typeof claims.scp === "string")
    return claims.scp.split(" ").filter(Boolean);
  if (Array.isArray(claims.scp))
    return claims.scp.filter((v): v is string => typeof v === "string");
  return [];
}

function requireNumber(value: unknown, claim: string): number {
  if (typeof value !== "number" || !Number.isFinite(value))
    throw new ArnoldAuthError(
      "INVALID_TOKEN",
      `Token-Claim ${claim} fehlt oder ist keine Zahl.`,
    );
  return value;
}

/**
 * The verifier passed to `requireBearerAuth` / `verifyBearerToken`.
 *
 * Implements the SDK's `OAuthTokenVerifier` interface, which is intentionally
 * narrow: a resource server verifies tokens, it does not issue them. Arnold
 * runs no authorization server of its own (Task 007 §5), so there is no
 * token-minting code in this repository at all outside the test fixtures.
 */
export class ArnoldTokenVerifier {
  private readonly issuer: string;
  private readonly audience: string;
  private readonly keys: KeyResolver;
  private readonly clockToleranceSec: number;
  private readonly maxLifetimeSec: number | null;
  private readonly now: () => number;
  private readonly scopeClaim: string | undefined;

  constructor(options: TokenVerifierOptions) {
    this.scopeClaim = options.scopeClaim;
    this.issuer = options.issuer;
    this.audience = canonicalResource(options.audience);
    this.keys = options.keys;
    this.clockToleranceSec =
      options.clockToleranceSec ?? DEFAULT_CLOCK_TOLERANCE_SEC;
    this.maxLifetimeSec =
      options.maxLifetimeSec === undefined
        ? DEFAULT_MAX_LIFETIME_SEC
        : options.maxLifetimeSec;
    this.now = options.now ?? (() => Date.now());
  }

  async verifyAccessToken(token: string): Promise<AuthInfo> {
    try {
      return await this.verify(token);
    } catch (error) {
      // Everything that escapes becomes a flat OAuth refusal. The specific
      // reason stays in `detail` for the audit trail.
      throw asAuthError(error).toOAuthError();
    }
  }

  private async verify(token: string): Promise<AuthInfo> {
    const decoded = decodeJwt(token);

    // An `at+jwt` token must not be confused with an ID token. When the
    // issuer types its access tokens, Arnold honours the type.
    const typ = decoded.header.typ;
    if (typeof typ === "string" && typ.toLowerCase() === "jwt+id")
      throw new ArnoldAuthError(
        "INVALID_TOKEN",
        "ID-Token statt Access-Token vorgelegt.",
      );

    const key = await this.keys.resolve(decoded.header.kid);
    verifyJwtSignature(decoded, key);

    // Only past this line are claims trustworthy.
    const claims = decoded.claims;
    const nowSec = Math.floor(this.now() / 1000);
    const skew = this.clockToleranceSec;

    if (claims.iss !== this.issuer)
      throw new ArnoldAuthError(
        "INVALID_TOKEN",
        `Issuer ${String(claims.iss)} ist nicht der konfigurierte Issuer.`,
      );

    if (typeof claims.sub !== "string" || claims.sub.length === 0)
      throw new ArnoldAuthError(
        "INVALID_TOKEN",
        "Token-Claim sub fehlt; ohne stabiles Subject gibt es keine Identität.",
      );

    // `exp` is mandatory: the SDK's bearer helpers reject an AuthInfo without
    // `expiresAt`, and a token that never expires is not something Arnold
    // should be the first component to accept.
    const exp = requireNumber(claims.exp, "exp");
    if (exp + skew <= nowSec)
      throw new ArnoldAuthError("INVALID_TOKEN", "Token ist abgelaufen.");

    if (claims.nbf !== undefined) {
      const nbf = requireNumber(claims.nbf, "nbf");
      if (nbf - skew > nowSec)
        throw new ArnoldAuthError(
          "INVALID_TOKEN",
          "Token ist noch nicht gültig.",
        );
    }

    if (claims.iat !== undefined) {
      const iat = requireNumber(claims.iat, "iat");
      if (iat - skew > nowSec)
        throw new ArnoldAuthError(
          "INVALID_TOKEN",
          "Token wurde in der Zukunft ausgestellt.",
        );
      if (this.maxLifetimeSec !== null && exp - iat > this.maxLifetimeSec)
        throw new ArnoldAuthError(
          "INVALID_TOKEN",
          `Token-Lebensdauer ${exp - iat}s übersteigt das Maximum von ${this.maxLifetimeSec}s.`,
        );
    }

    // RFC 8707 resource binding. A token that does not name Arnold is refused
    // here; the SDK then re-checks `resource` against its own
    // `expectedResource`, which is a second, independent gate on the same
    // property.
    const audiences = audienceList(claims.aud).map(canonicalResource);
    if (audiences.length === 0)
      throw new ArnoldAuthError(
        "INVALID_TOKEN",
        "Token-Claim aud fehlt; ohne Zielgruppe ist keine Resource-Bindung prüfbar.",
      );
    if (!audiences.includes(this.audience))
      throw new ArnoldAuthError(
        "INVALID_TOKEN",
        `Token ist für ${audiences.join(", ")} ausgestellt, nicht für ${this.audience}.`,
      );

    const scopes = scopeList(claims, this.scopeClaim);
    const clientId =
      typeof claims.client_id === "string"
        ? claims.client_id
        : typeof claims.azp === "string"
          ? claims.azp
          : "unknown";

    return {
      token,
      clientId,
      scopes,
      expiresAt: exp,
      resource: new URL(this.audience),
      extra: {
        issuer: this.issuer,
        subject: claims.sub,
        // `jti` lets an audit event name a specific token without storing it.
        tokenId: typeof claims.jti === "string" ? claims.jti : undefined,
      },
    };
  }
}

/**
 * Reads the verified subject back out of an `AuthInfo`.
 *
 * `AuthInfo.extra` is typed `Record<string, unknown>`, so the narrowing has to
 * happen somewhere; doing it in one exported helper means no caller invents
 * its own, looser version.
 */
export function verifiedSubject(auth: AuthInfo): {
  issuer: string;
  subject: string;
} {
  const issuer = auth.extra?.issuer;
  const subject = auth.extra?.subject;
  if (typeof issuer !== "string" || typeof subject !== "string")
    throw new ArnoldAuthError(
      "INVALID_TOKEN",
      "Verifizierter Kontext enthält kein issuer/subject-Paar.",
    );
  return { issuer, subject };
}
