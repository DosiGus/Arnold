/**
 * Account tools: what Arnold stores about a user and how it is deleted.
 *
 * `delete_arnold_account` runs in two stages. The first call returns a
 * summary and a short-lived confirmation token; only the card sends the token
 * back, after an explicit click. ChatGPT never sends it on its own.
 *
 * Where the token travels: the card reads the full first-stage answer
 * (`DeleteAccountConfirmSchema`) from `_meta.arnold.delete_account`, which the
 * model does not see. `structuredContent`, which the model sees, is the same
 * answer without the token (`DeleteAccountConfirmPublicSchema`).
 */
import { z } from "zod";

const isoDateTime = z.string().datetime({ offset: true });

export const DeleteAccountInputSchema = z.strictObject({
  confirmation_token: z.string().min(16).max(256).optional(),
});
export type DeleteAccountInput = z.infer<typeof DeleteAccountInputSchema>;

/** First stage: what would be deleted and what stays. Nothing is deleted yet. */
export const DeleteAccountConfirmSchema = z.strictObject({
  stage: z.literal("confirm"),
  summary: z.strictObject({
    /** German labels of everything Arnold stores about this user. */
    stored_items: z.array(z.string()),
    /** German labels of what stays with the user (the Google sheet). */
    keeps: z.array(z.string()),
  }),
  confirmation_token: z.string().min(16),
  expires_at: isoDateTime,
});

/** Second stage: everything Arnold stored is gone; the sheet stays. */
export const DeleteAccountDeletedSchema = z.strictObject({
  stage: z.literal("deleted"),
  google_sheet_kept: z.literal(true),
  /** Link to the user's own sheet, or null when none was ever created. */
  sheet_url: z.string().url().nullable(),
});

export const DeleteAccountResponseSchema = z.discriminatedUnion("stage", [
  DeleteAccountConfirmSchema,
  DeleteAccountDeletedSchema,
]);
export type DeleteAccountResponse = z.infer<typeof DeleteAccountResponseSchema>;

/** The first stage as the model sees it: no token. */
export const DeleteAccountConfirmPublicSchema = DeleteAccountConfirmSchema.omit(
  { confirmation_token: true },
);

/** `structuredContent` of `delete_arnold_account`. */
export const DeleteAccountPublicResponseSchema = z.discriminatedUnion("stage", [
  DeleteAccountConfirmPublicSchema,
  DeleteAccountDeletedSchema,
]);

export const DELETE_ACCOUNT_ERROR_CODES = [
  /** The token is unknown, already used, belongs to someone else or expired. */
  "CONFIRMATION_INVALID",
  "GOOGLE_REAUTH_REQUIRED",
  "STORAGE_UNAVAILABLE",
] as const;
