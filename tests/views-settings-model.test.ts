/**
 * The settings screen's model (src/views/model/settings.ts): watch status
 * from list_garmin_watches, the confirmation tokens read only from
 * `_meta.arnold`, the second-step inputs, and plain error words.
 */
import { describe, expect, it } from "vitest";
import { DeleteAccountInputSchema } from "../src/shared/account-contract";
import { PairGarminWatchInputSchema } from "../src/shared/watch-contract";
import {
  accountErrorText,
  deleteConfirmation,
  pairConfirmInput,
  pairConfirmation,
  watchCode,
  watchStatus,
} from "../src/views/model/settings";

const consent = {
  granted: false,
  text_version: null,
  current_text_version: "v1",
};

describe("watchStatus", () => {
  it("says not connected without a watch", () => {
    expect(
      watchStatus({
        account_label: "Arnold · ab12",
        watches: [],
        health_consent: consent,
      }),
    ).toEqual({ connected: false, label: null, deviceId: null });
  });

  it("names the watches and picks the newest to disconnect", () => {
    expect(
      watchStatus({
        account_label: "Arnold · ab12",
        health_consent: consent,
        watches: [
          {
            device_id: "d1",
            label: "Forerunner 255",
            paired_at: "2026-11-01T10:00:00Z",
            last_used_at: null,
          },
          {
            device_id: "d2",
            label: "Fenix 7",
            paired_at: "2026-11-20T10:00:00Z",
            last_used_at: null,
          },
        ],
      }),
    ).toEqual({
      connected: true,
      label: "Forerunner 255, Fenix 7",
      deviceId: "d2",
    });
  });
});

describe("pairing", () => {
  it("cleans the code from the watch", () => {
    expect(watchCode(" abcd-2345 ")).toBe("ABCD-2345");
    expect(watchCode("abc")).toBeNull();
  });

  it("reads the token only from _meta and sends it back with code and zone", () => {
    const confirm = {
      stage: "confirm",
      device_label: "Forerunner 265",
      user_code: "ABCD-2345",
      requested_at: "2026-11-26T10:00:00Z",
      expires_at: "2026-11-26T10:10:00Z",
      confirmation_token: "tok-123",
      timezone: "Europe/Berlin",
    };
    const c = pairConfirmation({ pair_garmin_watch: confirm });
    expect(c?.device_label).toBe("Forerunner 265");
    const input = pairConfirmInput(c!);
    expect(input).toEqual({
      user_code: "ABCD-2345",
      timezone: "Europe/Berlin",
      confirmation_token: "tok-123",
    });
    expect(PairGarminWatchInputSchema.safeParse(input).success).toBe(true);
    expect(pairConfirmation({})).toBeNull();
    const { confirmation_token: _t, ...noToken } = confirm;
    expect(pairConfirmation({ pair_garmin_watch: noToken })).toBeNull();
  });
});

describe("account deletion", () => {
  it("reads what would be deleted and the token from _meta", () => {
    const c = deleteConfirmation({
      delete_account: {
        stage: "confirm",
        summary: { stored_items: ["Trainingspläne", "Trainings"] },
        confirmation_token: "x".repeat(32),
        expires_at: "2026-11-26T10:10:00Z",
      },
    });
    expect(c?.summary.stored_items).toEqual(["Trainingspläne", "Trainings"]);
    expect(
      DeleteAccountInputSchema.safeParse({
        confirmation_token: c!.confirmation_token,
      }).success,
    ).toBe(true);
    expect(
      deleteConfirmation({ delete_account: { stage: "deleted" } }),
    ).toBeNull();
  });

  it("explains errors in plain words", () => {
    expect(accountErrorText("VALIDATION_ERROR", "x")).toMatch(
      /Code passt nicht/,
    );
    expect(accountErrorText("CONFIRMATION_INVALID", "x")).toMatch(/abgelaufen/);
    expect(accountErrorText("OTHER", "Fallback")).toBe("Fallback");
  });
});
