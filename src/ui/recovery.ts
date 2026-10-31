import {
  RecoverySchema,
  recoveryFor,
  type Recovery,
} from "../shared/write-recovery";

export type UiFailure = { code: string; recovery: Recovery; message?: string };
export const RECOVERY_COPY: Record<
  Recovery,
  { title: string; body: string; action?: string }
> = {
  none: {
    title: "Das hat noch nicht geklappt",
    body: "Prüfe deine Angaben und versuche es erneut.",
  },
  retry_same_request: {
    title: "Noch keine Bestätigung",
    body: "Deine Eingaben bleiben erhalten. Prüfe denselben Vorgang erneut, damit nichts doppelt gespeichert wird.",
    action: "Erneut prüfen",
  },
  reload_then_retry: {
    title: "Der Stand hat sich geändert",
    body: "Lade den aktuellen Stand. Prüfe ihn, bevor du deine Änderung erneut speicherst.",
    action: "Aktuellen Stand laden",
  },
  start_over: {
    title: "Bitte neu beginnen",
    body: "Dieser Vorgang ist abgelaufen. Du kannst ihn sicher neu beginnen.",
    action: "Neu beginnen",
  },
  reconnect_google: {
    title: "Google neu verbinden",
    body: "Deine Google-Freigabe ist abgelaufen. Verbinde Google erneut, um weiterzumachen.",
    action: "Google neu verbinden",
  },
  finish_setup: {
    title: "Deine Einrichtung ist noch offen",
    body: "Schließe die Einrichtung ab. Danach kannst du dein Training speichern.",
    action: "Einrichtung fortsetzen",
  },
  contact_support: {
    title: "Hier brauchst du Unterstützung",
    body: "Arnold kann gerade nicht auf deine Daten zugreifen. Bitte melde dich über den Support-Weg aus deiner Beta-Einladung.",
  },
};
export class ArnoldToolError extends Error {
  constructor(readonly failure: UiFailure) {
    super(RECOVERY_COPY[failure.recovery].body);
  }
}
export function asFailure(
  error: unknown,
  fallback: Recovery = "none",
): UiFailure {
  if (error instanceof ArnoldToolError) return error.failure;
  if (error && typeof error === "object") {
    const value = error as Record<string, unknown>;
    const recovery = RecoverySchema.safeParse(value.recovery);
    if (recovery.success) {
      const message =
        typeof value.message === "string" &&
        value.message.trim() &&
        !/[A-Z]{2,}_[A-Z_]+|request_id|row_revision|arnold\./.test(
          value.message,
        )
          ? value.message
          : undefined;
      return {
        code: String(value.code ?? "UNAVAILABLE"),
        recovery: recovery.data,
        ...(message ? { message } : {}),
      };
    }
    if (typeof value.code === "string")
      return { code: value.code, recovery: recoveryFor(value.code, false) };
  }
  return { code: "UNAVAILABLE", recovery: fallback };
}
