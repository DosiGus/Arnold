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
  /** Finish the Arnold setup first (SETUP_REQUIRED). */
  "finish_setup",
  /** The user cannot fix this alone. */
  "contact_support",
]);
export type Recovery = z.infer<typeof RecoverySchema>;

/**
 * The error object of every write tool:
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
    case "SETUP_REQUIRED":
      return "finish_setup";
    case "REVISION_CONFLICT":
    case "STALE_CONFIRMATION":
    case "VERSION_NUMBER_CONFLICT":
    case "ACTIVE_PLAN_CONFLICT":
      return "reload_then_retry";
    case "DUPLICATE_OPERATION":
      // Retryable only when two identical requests raced; then the same id
      // replays. An id reused for a different payload needs a new id instead.
      return retryable ? "retry_same_request" : "none";
    case "SESSION_EXPIRED":
    case "SESSION_CANCELLED":
    case "CONFIRMATION_INVALID":
    case "HANDOFF_SUPERSEDED":
      return "start_over";
    case "SCHEMA_MISMATCH":
    case "TEMPLATE_WRITE_FORBIDDEN":
    case "PERMISSION_DENIED":
      return "contact_support";
    default:
      return retryable ? "retry_same_request" : "none";
  }
}

/** One German sentence for ChatGPT: what to do next. Empty for "none". */
export const RECOVERY_HINT: Record<Recovery, string> = {
  none: "",
  retry_same_request:
    "Nächster Schritt: dieselbe Anfrage erneut senden; bei Schreibvorgängen mit derselben request_id, nie mit einer neuen.",
  reload_then_retry:
    "Nächster Schritt: aktuellen Stand neu laden, dem Nutzer die Änderung zeigen und dann neu versuchen.",
  start_over: "Nächster Schritt: den Vorgang neu beginnen.",
  finish_setup:
    "Nächster Schritt: zuerst die Einrichtung abschließen (show_arnold_onboarding).",
  contact_support:
    "Nächster Schritt: Das kann der Nutzer nicht selbst lösen. Nicht wiederholen, sondern auf den Support verweisen.",
};

/** The text line of a failed tool call: code, message and next step. */
export function failureText(
  code: string,
  message: string,
  recovery: Recovery,
): string {
  const hint = RECOVERY_HINT[recovery];
  return hint ? `${code}: ${message} ${hint}` : `${code}: ${message}`;
}
