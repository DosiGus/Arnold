/**
 * Account deletion, in two stages.
 *
 * The first call issues a short-lived, single-use confirmation token bound to
 * the verified user. Only the card sends it back, after an explicit click.
 * The token is never part of what the model sees (it travels in `_meta`), so
 * ChatGPT cannot complete the deletion on its own.
 *
 * Only a digest of the token is kept, in memory. A restart forgets every
 * pending confirmation, which fails closed: the user simply asks again.
 */
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

export const DELETION_TOKEN_TTL_MS = 5 * 60 * 1000;

export class DeletionConfirmationError extends Error {
  readonly code = "CONFIRMATION_INVALID" as const;
  constructor() {
    super(
      "Die Bestätigung ist ungültig oder abgelaufen. Es wurde nichts gelöscht. Bitte das Löschen in der Karte erneut anfordern.",
    );
    this.name = "DeletionConfirmationError";
  }
}

const digest = (token: string) => createHash("sha256").update(token).digest();

export class DeletionTokens {
  private pending = new Map<string, { digest: Buffer; expiresAtMs: number }>();
  constructor(private readonly now: () => number = Date.now) {}

  /** A new token for this user; an earlier one stops working. */
  issue(userId: string): { token: string; expiresAt: string } {
    const token = randomBytes(32).toString("base64url");
    const expiresAtMs = this.now() + DELETION_TOKEN_TTL_MS;
    this.pending.set(userId, { digest: digest(token), expiresAtMs });
    return { token, expiresAt: new Date(expiresAtMs).toISOString() };
  }

  /** Consumes the token. Throws unless it is this user's current, live token. */
  redeem(userId: string, token: string): void {
    const entry = this.pending.get(userId);
    const presented = digest(token);
    const valid =
      entry !== undefined &&
      entry.expiresAtMs > this.now() &&
      timingSafeEqual(entry.digest, presented);
    if (!valid) {
      // An expired token is gone either way; a wrong one leaves a live token.
      if (entry && entry.expiresAtMs <= this.now()) this.pending.delete(userId);
      throw new DeletionConfirmationError();
    }
    this.pending.delete(userId);
  }

  forget(userId: string): void {
    this.pending.delete(userId);
  }
}

/** What the confirmation card lists. German, for the user. */
export function deletionSummary(): { stored_items: string[] } {
  return {
    stored_items: [
      "Deine Arnold-Anmeldung (interne Kennung, keine E-Mail-Adresse)",
      "Deine Trainingspläne, Trainings und Sätze",
      "Dein Laufprofil, deine Läufe mit Abschnitten und Zwischenzeiten, Pulszonen und geplante Läufe",
      "Deine Ziele und Körpergewichtseinträge",
      "Dein Einrichtungsstand mit Profilangaben",
      "Das Protokoll deiner Speichervorgänge und das Änderungsprotokoll",
      "Deine gekoppelten Garmin-Uhren, ihre Trainingsaufzeichnungen und Messwerte",
    ],
  };
}
