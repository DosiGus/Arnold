/**
 * B0: the shared contracts between server and card.
 *
 * Worker A builds against these shapes, so a change here is a breaking change
 * for the UI and must be deliberate.
 */
import { describe, expect, it } from "vitest";
import {
  DeleteAccountInputSchema,
  DeleteAccountResponseSchema,
} from "../src/shared/account-contract.js";
import { ViewWeekSchema } from "../src/shared/arnold-view.js";
import { OnboardingResponseSchema } from "../src/shared/onboarding-contract.js";
import {
  PlanErrorCodeSchema,
  PlanWriteResponseSchema,
} from "../src/shared/plan-contract.js";
import {
  WriteErrorCodeSchema,
  WriteResponseSchema,
} from "../src/shared/workout-contract.js";
import {
  GOOGLE_REAUTH_MESSAGE,
  GOOGLE_REAUTH_REQUIRED,
  RecoverySchema,
  ToolFailureMetaSchema,
  recoveryFor,
} from "../src/shared/write-recovery.js";

const reauthError = {
  code: GOOGLE_REAUTH_REQUIRED,
  message: GOOGLE_REAUTH_MESSAGE,
  retryable: false,
  details: [],
  recovery: "reconnect_google",
} as const;

describe("recovery field", () => {
  it("has exactly the seven agreed values", () => {
    expect(RecoverySchema.options).toEqual([
      "none",
      "retry_same_request",
      "reload_then_retry",
      "start_over",
      "reconnect_google",
      "finish_setup",
      "contact_support",
    ]);
  });

  it("is required on workout write errors", () => {
    const base = {
      ok: false,
      operation: "log_workout_sets",
      request_id: "req_1",
      replayed: false,
      result: null,
    };
    expect(
      WriteResponseSchema.safeParse({ ...base, error: reauthError }).success,
    ).toBe(true);
    const { recovery: _omitted, ...withoutRecovery } = reauthError;
    expect(
      WriteResponseSchema.safeParse({ ...base, error: withoutRecovery })
        .success,
    ).toBe(false);
    expect(
      WriteResponseSchema.safeParse({
        ...base,
        error: { ...reauthError, recovery: "guess" },
      }).success,
    ).toBe(false);
  });

  it("is required on plan write errors", () => {
    const base = {
      ok: false,
      operation: "update_plan_draft",
      request_id: "req_1",
      replayed: false,
      result: null,
    };
    expect(
      PlanWriteResponseSchema.safeParse({ ...base, error: reauthError })
        .success,
    ).toBe(true);
    const { recovery: _omitted, ...withoutRecovery } = reauthError;
    expect(
      PlanWriteResponseSchema.safeParse({ ...base, error: withoutRecovery })
        .success,
    ).toBe(false);
  });

  it("is required on onboarding errors", () => {
    const base = {
      ok: false,
      operation: "confirm_onboarding_plan",
      request_id: "req_1",
      replayed: false,
      state: null,
      session_token: null,
    };
    expect(
      OnboardingResponseSchema.safeParse({ ...base, error: reauthError })
        .success,
    ).toBe(true);
    const { recovery: _omitted, ...withoutRecovery } = reauthError;
    expect(
      OnboardingResponseSchema.safeParse({ ...base, error: withoutRecovery })
        .success,
    ).toBe(false);
  });

  it("describes read-tool failures in _meta.arnold", () => {
    expect(
      ToolFailureMetaSchema.safeParse({
        code: "SETUP_REQUIRED",
        retryable: false,
        recovery: "finish_setup",
      }).success,
    ).toBe(true);
    expect(
      ToolFailureMetaSchema.safeParse({ code: "X", retryable: false }).success,
    ).toBe(false);
  });

  it("maps the shared codes to their default next step", () => {
    expect(recoveryFor(GOOGLE_REAUTH_REQUIRED, false)).toBe("reconnect_google");
    expect(recoveryFor("SETUP_REQUIRED", false)).toBe("finish_setup");
    expect(recoveryFor("REVISION_CONFLICT", false)).toBe("reload_then_retry");
    expect(recoveryFor("COMMIT_STATUS_UNKNOWN", true)).toBe(
      "retry_same_request",
    );
    expect(recoveryFor("SESSION_EXPIRED", false)).toBe("start_over");
    expect(recoveryFor("SHEET_CAPACITY_EXCEEDED", false)).toBe(
      "contact_support",
    );
    expect(recoveryFor("STORAGE_UNAVAILABLE", true)).toBe("retry_same_request");
    expect(recoveryFor("VALIDATION_ERROR", false)).toBe("none");
  });
});

describe("GOOGLE_REAUTH_REQUIRED", () => {
  it("is a code of the workout and plan write tools", () => {
    expect(WriteErrorCodeSchema.options).toContain(GOOGLE_REAUTH_REQUIRED);
    expect(PlanErrorCodeSchema.options).toContain(GOOGLE_REAUTH_REQUIRED);
  });

  it("tells ChatGPT to reconnect through the card", () => {
    expect(GOOGLE_REAUTH_MESSAGE).toBe(
      "Die Google-Freigabe ist abgelaufen. Bitte über die Karte neu verbinden.",
    );
  });
});

describe("trained_dates", () => {
  const week = {
    week_start: "2026-10-26",
    label: "KW 44",
    iso_year: 2026,
    iso_week: 44,
    is_current_week: true,
    workouts: 3,
    training_days: 2,
    trained_dates: ["2026-10-26", "2026-10-28"],
    working_sets: 12,
    nominal_volume: null,
    nominal_volume_status: "not_available",
  };

  it("is part of every week", () => {
    expect(ViewWeekSchema.safeParse(week).success).toBe(true);
    const { trained_dates: _omitted, ...withoutDates } = week;
    expect(ViewWeekSchema.safeParse(withoutDates).success).toBe(false);
  });

  it("holds calendar dates only", () => {
    expect(
      ViewWeekSchema.safeParse({
        ...week,
        trained_dates: ["2026-10-26T10:00:00Z"],
      }).success,
    ).toBe(false);
  });
});

describe("delete_arnold_account", () => {
  it("accepts a call without and with a token", () => {
    expect(DeleteAccountInputSchema.safeParse({}).success).toBe(true);
    expect(
      DeleteAccountInputSchema.safeParse({
        confirmation_token: "x".repeat(43),
      }).success,
    ).toBe(true);
    expect(
      DeleteAccountInputSchema.safeParse({ user_id: "someone" }).success,
    ).toBe(false);
  });

  it("answers the first stage with a summary and a token", () => {
    expect(
      DeleteAccountResponseSchema.safeParse({
        stage: "confirm",
        summary: {
          stored_items: ["Anmeldung bei Arnold"],
          keeps: ["Deine Google-Tabelle"],
        },
        confirmation_token: "x".repeat(43),
        expires_at: "2026-10-31T12:05:00.000Z",
      }).success,
    ).toBe(true);
  });

  it("answers the second stage with the kept sheet", () => {
    expect(
      DeleteAccountResponseSchema.safeParse({
        stage: "deleted",
        google_sheet_kept: true,
        sheet_url: "https://docs.google.com/spreadsheets/d/abc/edit",
      }).success,
    ).toBe(true);
    expect(
      DeleteAccountResponseSchema.safeParse({
        stage: "deleted",
        google_sheet_kept: false,
        sheet_url: null,
      }).success,
    ).toBe(false);
  });
});
