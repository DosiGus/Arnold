import { z } from "zod";
/** Explicit recovery decision, independent of the domain error code. */
export const WriteRecoverySchema = z.enum([
  "none",
  "retry_same_request",
  "retry_or_new_request",
]);
export type WriteRecovery = z.infer<typeof WriteRecoverySchema>;

/** Cancels only an intent whose storage rejection is durably proven. */
export const AbandonWriteInputSchema = z.strictObject({
  request_id: z.string().min(1).max(128),
});
export const AbandonWriteResponseSchema = z.strictObject({
  ok: z.boolean(),
  request_id: z.string(),
  abandoned: z.boolean(),
  error: z.strictObject({ code: z.string(), message: z.string() }).nullable(),
});
export type AbandonWriteResponse = z.infer<typeof AbandonWriteResponseSchema>;
