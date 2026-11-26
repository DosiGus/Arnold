/**
 * The settings screen's watch and account parts on Arnold's account tools:
 * `list_garmin_watches`, `pair_garmin_watch` / `unpair_garmin_watch` and
 * `delete_arnold_account`.
 *
 * Pairing and deleting are two steps. The first call shows what would
 * happen; its confirmation token travels only in `_meta.arnold`, never to
 * the model. The card sends it back only after the user's click. Mapping
 * only, nothing is computed.
 */
import {
  DeleteAccountConfirmSchema,
  type DeleteAccountResponse,
} from "../../shared/account-contract.js";
import {
  PairGarminWatchConfirmMetaSchema,
  type ListGarminWatches,
  type PairGarminWatchConfirmMeta,
} from "../../shared/watch-contract.js";

export type WatchStatus = {
  connected: boolean;
  /** "Forerunner 265", or several joined; null without a watch. */
  label: string | null;
  /** The watch to disconnect; the newest one when there are several. */
  deviceId: string | null;
};

export function watchStatus(list: ListGarminWatches): WatchStatus {
  const newest = list.watches[list.watches.length - 1];
  return {
    connected: list.watches.length > 0,
    label: list.watches.length
      ? list.watches.map((w) => w.label).join(", ")
      : null,
    deviceId: newest?.device_id ?? null,
  };
}

/** The code as the watch shows it, cleaned; null when it cannot be one. */
export function watchCode(text: string): string | null {
  const t = text.trim().toUpperCase().replace(/\s+/g, "");
  return t.length >= 8 && t.length <= 12 ? t : null;
}

/** The first step's confirmation, read from `_meta.arnold`. */
export function pairConfirmation(
  arnold: Record<string, unknown>,
): PairGarminWatchConfirmMeta | null {
  const parsed = PairGarminWatchConfirmMetaSchema.safeParse(
    arnold.pair_garmin_watch,
  );
  return parsed.success ? parsed.data : null;
}

/** Second step: the same code and time zone, with the card's token. */
export const pairConfirmInput = (c: PairGarminWatchConfirmMeta) => ({
  user_code: c.user_code,
  timezone: c.timezone,
  confirmation_token: c.confirmation_token,
});

export type DeleteConfirmation = Extract<
  DeleteAccountResponse,
  { stage: "confirm" }
>;

/** The first step's confirmation, read from `_meta.arnold`. */
export function deleteConfirmation(
  arnold: Record<string, unknown>,
): DeleteConfirmation | null {
  const parsed = DeleteAccountConfirmSchema.safeParse(arnold.delete_account);
  return parsed.success ? parsed.data : null;
}

/** Plain words for the errors of the account tools. */
export function accountErrorText(code: string, fallback: string): string {
  switch (code) {
    case "VALIDATION_ERROR":
      return "Der Code passt nicht oder ist abgelaufen. Öffne Arnold auf der Uhr für einen neuen Code.";
    case "RATE_LIMITED":
      return "Zu viele falsche Codes. Bitte versuch es in einer Stunde noch einmal.";
    case "CONFIRMATION_INVALID":
      return "Die Bestätigung ist abgelaufen. Bitte noch einmal von vorn.";
    default:
      return fallback;
  }
}
