/**
 * Arnold's authentication and authorization failures, and their mapping onto
 * the OAuth error codes the MCP bearer-auth helpers understand.
 *
 * Why a separate error type at all, when the SDK already ships `OAuthError`?
 * Because Arnold has to distinguish failures the OAuth vocabulary collapses.
 * "This token is not valid" and "this token is valid but belongs to nobody
 * Arnold knows" are both `invalid_token` on the wire — they must be, because a
 * client can do nothing useful with the difference — but they mean different
 * things in an audit log and need different operator responses. So the
 * internal code is richer than the wire code, and `toOAuthError()` is the one
 * place the two meet.
 *
 * The messages here are deliberately dull. An authentication error is the
 * wrong place to explain *why* a token failed: "signature invalid" versus
 * "issuer mismatch" tells an attacker which half of a forged token to fix.
 * The detail goes to the audit event; the caller gets a flat refusal.
 */
import { OAuthError, OAuthErrorCode } from "@modelcontextprotocol/server";

export const AUTH_ERROR_CODES = [
  /** No credential was presented where one is required. */
  "AUTH_REQUIRED",
  /** A credential was presented and did not verify. */
  "INVALID_TOKEN",
  /** Verified, but lacking a scope this operation requires. */
  "INSUFFICIENT_SCOPE",
  /** Verified, but the subject maps to no Arnold user. */
  "IDENTITY_UNKNOWN",
  /** Verified and known, but the account is administratively disabled. */
  "ACCOUNT_DISABLED",
  /** Verified and permitted in principle, but not for this resource. */
  "FORBIDDEN",
  /** The server cannot currently verify tokens at all (JWKS unreachable). */
  "VERIFICATION_UNAVAILABLE",
] as const;

export type AuthErrorCode = (typeof AUTH_ERROR_CODES)[number];

/**
 * The flat, non-revealing text a caller sees per code.
 *
 * German, matching the rest of Arnold's user-facing strings.
 */
const PUBLIC_MESSAGES: Record<AuthErrorCode, string> = {
  AUTH_REQUIRED:
    "Für diesen Zugriff ist eine Anmeldung erforderlich. Verbinde Arnold in ChatGPT erneut.",
  INVALID_TOKEN:
    "Die Anmeldung ist nicht mehr gültig. Verbinde Arnold in ChatGPT erneut.",
  INSUFFICIENT_SCOPE:
    "Diese Aktion ist von der aktuellen Verbindung nicht freigegeben.",
  IDENTITY_UNKNOWN:
    "Zu dieser Anmeldung existiert kein Arnold-Konto. Schließe die Einrichtung ab.",
  ACCOUNT_DISABLED: "Dieses Arnold-Konto ist deaktiviert.",
  FORBIDDEN: "Dieser Zugriff ist nicht erlaubt.",
  VERIFICATION_UNAVAILABLE:
    "Die Anmeldung kann derzeit nicht geprüft werden. Bitte später erneut versuchen.",
};

/**
 * Which OAuth code goes on the wire for each internal code.
 *
 * `IDENTITY_UNKNOWN` and `ACCOUNT_DISABLED` both answer `invalid_token`
 * rather than something more specific, so that probing Arnold with a valid
 * token from another tenant cannot be used to enumerate which subjects have
 * Arnold accounts.
 */
const WIRE_CODES: Record<AuthErrorCode, OAuthErrorCode> = {
  AUTH_REQUIRED: OAuthErrorCode.InvalidToken,
  INVALID_TOKEN: OAuthErrorCode.InvalidToken,
  INSUFFICIENT_SCOPE: OAuthErrorCode.InsufficientScope,
  IDENTITY_UNKNOWN: OAuthErrorCode.InvalidToken,
  ACCOUNT_DISABLED: OAuthErrorCode.InvalidToken,
  FORBIDDEN: OAuthErrorCode.AccessDenied,
  VERIFICATION_UNAVAILABLE: OAuthErrorCode.TemporarilyUnavailable,
};

export class ArnoldAuthError extends Error {
  readonly code: AuthErrorCode;
  /**
   * Operator-facing detail. Goes to audit events and server logs, never into
   * a response body. Must not contain token material.
   */
  readonly detail: string | undefined;

  constructor(code: AuthErrorCode, detail?: string) {
    super(PUBLIC_MESSAGES[code]);
    this.name = "ArnoldAuthError";
    this.code = code;
    this.detail = detail;
  }

  /** The message safe to return to a caller. */
  get publicMessage(): string {
    return PUBLIC_MESSAGES[this.code];
  }

  /**
   * The SDK-shaped error. `requireBearerAuth` and `verifyBearerToken` turn
   * this into a `401`/`403` with the right `WWW-Authenticate` challenge and
   * the `resource_metadata` pointer, so Arnold never hand-builds that header.
   */
  toOAuthError(): OAuthError {
    return new OAuthError(WIRE_CODES[this.code], this.publicMessage);
  }
}

/** True when `error` is an Arnold auth failure with the given code. */
export function isAuthError(
  error: unknown,
  code?: AuthErrorCode,
): error is ArnoldAuthError {
  return (
    error instanceof ArnoldAuthError &&
    (code === undefined || error.code === code)
  );
}

/**
 * Normalizes anything thrown inside the auth path into an `ArnoldAuthError`.
 *
 * Unknown failures become `INVALID_TOKEN` rather than leaking a stack or a
 * library message to the caller, and the original text is kept in `detail`
 * for the audit trail.
 */
export function asAuthError(error: unknown): ArnoldAuthError {
  if (error instanceof ArnoldAuthError) return error;
  const detail = error instanceof Error ? error.message : String(error);
  return new ArnoldAuthError("INVALID_TOKEN", detail);
}
