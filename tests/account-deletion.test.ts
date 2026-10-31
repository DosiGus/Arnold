/** B6: the confirmation token of delete_arnold_account. */
import { describe, expect, it } from "vitest";
import {
  DELETION_TOKEN_TTL_MS,
  DeletionConfirmationError,
  DeletionTokens,
  deletionSummary,
} from "../src/server/connected/account-deletion";

describe("deletion confirmation token", () => {
  it("works once, for its own user, before it expires", () => {
    let now = 1_000_000;
    const tokens = new DeletionTokens(() => now);
    const { token, expiresAt } = tokens.issue("usr_a");
    expect(Date.parse(expiresAt)).toBe(now + DELETION_TOKEN_TTL_MS);
    expect(() => tokens.redeem("usr_b", token)).toThrow(
      DeletionConfirmationError,
    );
    tokens.redeem("usr_a", token);
    expect(() => tokens.redeem("usr_a", token)).toThrow(
      DeletionConfirmationError,
    );
  });

  it("refuses an expired token", () => {
    let now = 1_000_000;
    const tokens = new DeletionTokens(() => now);
    const { token } = tokens.issue("usr_a");
    now += DELETION_TOKEN_TTL_MS;
    expect(() => tokens.redeem("usr_a", token)).toThrow(
      DeletionConfirmationError,
    );
    now -= 1;
    expect(() => tokens.redeem("usr_a", token)).toThrow(
      DeletionConfirmationError,
    );
  });

  it("replaces an earlier token when a new one is issued", () => {
    const tokens = new DeletionTokens(() => 0);
    const first = tokens.issue("usr_a").token;
    const second = tokens.issue("usr_a").token;
    expect(() => tokens.redeem("usr_a", first)).toThrow(
      DeletionConfirmationError,
    );
    tokens.redeem("usr_a", second);
  });

  it("refuses a token of a different length without throwing a crypto error", () => {
    const tokens = new DeletionTokens(() => 0);
    tokens.issue("usr_a");
    expect(() => tokens.redeem("usr_a", "short-but-long-enough")).toThrow(
      DeletionConfirmationError,
    );
  });
});

describe("deletion summary", () => {
  it("names the Google grant only when one exists and always keeps the sheet", () => {
    const connected = deletionSummary({
      googleConnected: true,
      sheetExists: true,
    });
    expect(connected.stored_items.join(" ")).toContain("Google-Freigabe");
    expect(connected.keeps).toHaveLength(1);
    const fresh = deletionSummary({
      googleConnected: false,
      sheetExists: false,
    });
    expect(fresh.stored_items.join(" ")).not.toContain("Google-Freigabe");
    expect(fresh.keeps).toEqual([]);
  });
});
