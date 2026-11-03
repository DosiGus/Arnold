/**
 * The body weight from the setup's Person card, stored as the first entry on
 * the "Ziele" card once the setup is finished.
 */
import type { WorkoutLoggingService } from "./service.js";

/** Calendar day for a weight taken during setup; the setup carries no time zone. */
export const SETUP_TIME_ZONE = "Europe/Berlin";

/**
 * The Person card's body weight as the first body weight entry, written like
 * any other entry (request id, audit, receipt). Throws when it was refused.
 */
export async function logStartWeight(
  service: WorkoutLoggingService,
  weightKg: number,
  requestId: string,
  context: unknown,
  now = new Date(),
) {
  const response = await service.execute(
    "log_body_weight",
    {
      request_id: requestId,
      measured_on: new Intl.DateTimeFormat("en-CA", {
        timeZone: SETUP_TIME_ZONE,
      }).format(now),
      timezone: SETUP_TIME_ZONE,
      weight_kg: weightKg,
      source: "ui",
    },
    context,
  );
  if (!response.ok)
    throw new Error(
      response.error?.message ?? "Startgewicht nicht gespeichert.",
    );
}
