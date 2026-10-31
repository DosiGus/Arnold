/**
 * An expired or revoked Google grant, recognised wherever it surfaces.
 *
 * The connection service raises it while refreshing the access token, before
 * any request reaches Google. On its way up it can be wrapped by the sheet
 * reader or the write adapter, so the check follows the `cause` chain.
 *
 * Because the refresh happens before the request is sent, a reauth failure
 * proves that nothing was written. That is what lets a pending write be
 * dispatched again under the same request_id after the user reconnected.
 */
import {
  GOOGLE_REAUTH_MESSAGE,
  GOOGLE_REAUTH_REQUIRED,
  failureText,
} from "../../shared/write-recovery.js";
import { WriteError } from "../workout/infrastructure.js";

const REAUTH_CODES: ReadonlySet<unknown> = new Set([
  GOOGLE_REAUTH_REQUIRED,
  "GOOGLE_NOT_CONNECTED",
]);

export function isGoogleReauthRequired(error: unknown): boolean {
  let current = error;
  for (let depth = 0; current && depth < 8; depth++) {
    if (REAUTH_CODES.has((current as { code?: unknown }).code)) return true;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

export function googleReauthWriteError(): WriteError {
  return new WriteError(GOOGLE_REAUTH_REQUIRED, GOOGLE_REAUTH_MESSAGE, false);
}

/** The MCP result of a read or account tool whose Google grant expired. */
export function googleReauthToolResult() {
  return {
    isError: true as const,
    content: [
      {
        type: "text" as const,
        text: failureText(
          GOOGLE_REAUTH_REQUIRED,
          GOOGLE_REAUTH_MESSAGE,
          "reconnect_google",
        ),
      },
    ],
    _meta: {
      arnold: {
        code: GOOGLE_REAUTH_REQUIRED,
        retryable: false,
        recovery: "reconnect_google" as const,
      },
    },
  };
}
