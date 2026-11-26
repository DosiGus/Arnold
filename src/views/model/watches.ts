/**
 * `list_garmin_watches` → the watch card, and the consent for watch health
 * data. Mapping only.
 */
import type { ListGarminWatches } from "../../shared/watch-contract.js";

const STAMP = new Intl.DateTimeFormat("de-DE", {
  dateStyle: "medium",
  timeStyle: "short",
});

export type WatchRow = {
  id: string;
  label: string;
  since: string;
  lastContact: string;
};

export function watchRows(list: ListGarminWatches): WatchRow[] {
  return list.watches.map((w) => ({
    id: w.device_id,
    label: w.label,
    since: STAMP.format(new Date(w.paired_at)),
    lastContact: w.last_used_at
      ? STAMP.format(new Date(w.last_used_at))
      : "Noch kein Kontakt",
  }));
}

export const consentInput = (
  granted: boolean,
  list: ListGarminWatches,
): Record<string, unknown> =>
  granted
    ? { granted, text_version: list.health_consent.current_text_version }
    : { granted };

export function consentDoneText(
  granted: boolean,
  deletedRecords: number,
): string {
  if (granted)
    return "Einwilligung erteilt: Arnold speichert ab jetzt Messwerte zu deinen Uhr-Trainings.";
  return deletedRecords > 0
    ? `Einwilligung widerrufen. ${deletedRecords} gespeicherte Messwert-Datensätze sind gelöscht.`
    : "Einwilligung widerrufen. Arnold speichert keine Messwerte mehr.";
}

/** The confirmation is only usable until it expires. */
export const expired = (expiresAt: string, now: number) =>
  Date.parse(expiresAt) <= now;
