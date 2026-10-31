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

/**
 * Input of `connect_google_account` (B14).
 *
 * During setup the session claim is required: it ties the Google file to the
 * confirmed plan. Once the account is set up, reconnecting (for example after
 * the 7-day grant expired) needs no claim: the verified account is enough,
 * and only the same Google account may reconnect. Both fields or neither.
 */
export const ConnectGoogleInputSchema = z
  .strictObject({
    onboarding_session_id: z.string().min(1).optional(),
    session_token: z.string().min(1).optional(),
  })
  .refine(
    (input) =>
      (input.onboarding_session_id === undefined) ===
      (input.session_token === undefined),
    "onboarding_session_id und session_token nur gemeinsam angeben.",
  );
export type ConnectGoogleInput = z.infer<typeof ConnectGoogleInputSchema>;

/** Output of `finish_arnold_setup` (B16). */
export const FinishSetupOutputSchema = z.strictObject({
  spreadsheet_url: z.string().url(),
  /**
   * The file name as Google reported it while verifying the file; the user
   * may have renamed it. Absent when Google reported none, never invented.
   */
  spreadsheet_name: z.string().min(1).optional(),
});
export type FinishSetupOutput = z.infer<typeof FinishSetupOutputSchema>;

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

/* ------------------------------------------------------- stored data (B7) */

export const STORED_DATA_KEYS = [
  "account",
  "google_connection",
  "setup",
  "tracker_mapping",
  "write_journal",
  "audit_log",
  "setup_snapshot",
] as const;

/** One kind of data Arnold keeps on its own server about the user. */
export const StoredDataItemSchema = z.strictObject({
  key: z.enum(STORED_DATA_KEYS),
  /** German label for the user. */
  label: z.string(),
  /** What it contains, in plain German. Never the content itself. */
  contains: z.string(),
  /** Number of records, where counting makes sense. */
  count: z.number().int().nonnegative().nullable(),
  oldest_at: isoDateTime.nullable(),
  newest_at: isoDateTime.nullable(),
  /** How long it is kept, in plain German. */
  kept: z.string(),
});
export type StoredDataItem = z.infer<typeof StoredDataItemSchema>;

export const StoredDataSchema = z.strictObject({
  items: z.array(StoredDataItemSchema),
  /** The training data itself lives in the user's own Google sheet. */
  google_sheet_url: z.string().url().nullable(),
  retention_days: z.number().int().positive(),
});
export type StoredData = z.infer<typeof StoredDataSchema>;
