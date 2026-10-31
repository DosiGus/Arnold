/**
 * Plan-domain failures.
 *
 * The plan service keeps its own error vocabulary rather than widening the
 * workout logger's: a caller of `update_plan_draft` should never have to
 * reason about `SET_NOT_FOUND`. The infrastructure it shares with Task 004
 * still throws `WriteError`, so `toPlanError` translates at the boundary and
 * preserves the two properties a client depends on — the code and whether a
 * retry with the same request_id is meaningful.
 */
import { isGoogleReauthRequired } from "../google/reauth.js";
import {
  GOOGLE_REAUTH_MESSAGE,
  GOOGLE_REAUTH_REQUIRED,
} from "../../shared/write-recovery.js";
import { z } from "zod";
import {
  PlanErrorCodeSchema,
  type PlanErrorCode,
} from "../../shared/plan-contract.js";
import { WriteError } from "../workout/infrastructure.js";

export class PlanError extends Error {
  constructor(
    readonly code: PlanErrorCode,
    message: string,
    readonly retryable = false,
    readonly details: string[] = [],
  ) {
    super(message);
    this.name = "PlanError";
  }
}

export const planError = (
  code: PlanErrorCode,
  message: string,
  details: string[] = [],
) => new PlanError(code, message, false, details);

/** Normalises anything thrown during a plan write into a `PlanError`. */
export function toPlanError(error: unknown): PlanError {
  if (error instanceof PlanError) return error;
  if (isGoogleReauthRequired(error))
    return new PlanError(GOOGLE_REAUTH_REQUIRED, GOOGLE_REAUTH_MESSAGE, false);
  if (error instanceof WriteError) {
    // Most infrastructure codes exist verbatim in the plan vocabulary. The
    // workout-only ones cannot arise here, so they fall back rather than leak.
    const mapped = PlanErrorCodeSchema.safeParse(error.code);
    return new PlanError(
      mapped.success ? mapped.data : "VALIDATION_ERROR",
      error.message,
      error.retryable,
      error.details,
    );
  }
  if (error instanceof z.ZodError)
    return new PlanError(
      "VALIDATION_ERROR",
      "Eingaben sind nicht eindeutig oder ungültig.",
      false,
      error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`),
    );
  return new PlanError(
    "STORAGE_UNAVAILABLE",
    "Die Planverwaltung ist derzeit nicht verfügbar.",
    true,
  );
}
