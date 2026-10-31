/**
 * What the user (or ChatGPT) should do after a failed tool call.
 *
 * The error code says *what* went wrong; `recovery` says *what to do next*.
 * Keeping the two apart lets the card and the chat react to the next step
 * without knowing every domain code of every service.
 */
import { z } from "zod";

export const RecoverySchema = z.enum([
  /** Nothing to do, only inform. */
  "none",
  /** Send the same request again with the same request_id. */
  "retry_same_request",
  /** Reload the current state (stale revision), then try again. */
  "reload_then_retry",
  /** Start the operation from the beginning. */
  "start_over",
  /** The Google authorization expired or was revoked: reconnect Google. */
  "reconnect_google",
  /** Finish the Arnold setup first (SETUP_REQUIRED). */
  "finish_setup",
  /** The user cannot fix this alone. */
  "contact_support",
]);
export type Recovery = z.infer<typeof RecoverySchema>;

/** Error code for an expired or revoked Google authorization. */
export const GOOGLE_REAUTH_REQUIRED = "GOOGLE_REAUTH_REQUIRED" as const;

/** The sentence ChatGPT and the card show for an expired Google grant. */
export const GOOGLE_REAUTH_MESSAGE =
  "Die Google-Freigabe ist abgelaufen. Bitte über die Karte neu verbinden.";

/**
 * The error object of every write or Google tool:
 * `{ code, message, retryable, details, recovery }`.
 */
export function toolErrorSchema<Code extends z.ZodType<string>>(code: Code) {
  return z.strictObject({
    code,
    message: z.string(),
    retryable: z.boolean(),
    details: z.array(z.string()),
    recovery: RecoverySchema,
  });
}

/**
 * The machine-readable part of a failed read tool, in `_meta.arnold`.
 * Read tools answer with `isError` and text; this tells the card what to do.
 */
export const ToolFailureMetaSchema = z.object({
  code: z.string().min(1),
  retryable: z.boolean(),
  recovery: RecoverySchema,
});
export type ToolFailureMeta = z.infer<typeof ToolFailureMetaSchema>;

/**
 * The default next step for a code.
 *
 * Services may choose a more specific recovery; this is the fallback that
 * keeps every error actionable.
 */
export function recoveryFor(code: string, retryable: boolean): Recovery {
  switch (code) {
    case GOOGLE_REAUTH_REQUIRED:
    case "GOOGLE_NOT_CONNECTED":
      return "reconnect_google";
    case "SETUP_REQUIRED":
      return "finish_setup";
    case "REVISION_CONFLICT":
    case "STALE_CONFIRMATION":
    case "VERSION_NUMBER_CONFLICT":
    case "ACTIVE_PLAN_CONFLICT":
      return "reload_then_retry";
    case "COMMIT_STATUS_UNKNOWN":
    case "DUPLICATE_OPERATION":
      return "retry_same_request";
    case "SESSION_EXPIRED":
    case "SESSION_CANCELLED":
    case "HANDOFF_SUPERSEDED":
      return "start_over";
    case "SCHEMA_MISMATCH":
    case "TEMPLATE_WRITE_FORBIDDEN":
    case "PERMISSION_DENIED":
    case "SHEET_CAPACITY_EXCEEDED":
      return "contact_support";
    default:
      return retryable ? "retry_same_request" : "none";
  }
}
