/**
 * `list_garmin_watches` → the watch card, and the consent for watch health
 * data. Mapping only.
 */
import type { ListGarminWatches } from "../../shared/watch-contract.js";

/**
 * The consent text approved by the owner (GAR-B7-01, 03 M077), version
 * HEALTH_CONSENT_TEXT_VERSION. Shown before the user grants, so the click
 * refers to this text. The English text is on the privacy page
 * (/datenschutz#garmin-watch). Do not reword without a new text version.
 */
export const HEALTH_CONSENT_TEXT =
  "Mit deiner Einwilligung speichert Arnold zu jedem Training von der Uhr deine Messwerte: Puls, Kalorien, Body Battery, Stress und Ruhepuls. Das sind Gesundheitsdaten. Arnold nutzt sie nur, um sie dir zu deinen Trainings zu zeigen. Die Einwilligung ist freiwillig, Arnold funktioniert auch ohne sie. Du kannst sie jederzeit hier widerrufen; Arnold löscht dann sofort alle gespeicherten Messwerte.";

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
