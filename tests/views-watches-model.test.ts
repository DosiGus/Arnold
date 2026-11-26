/**
 * The watch cards (src/views/model/watches.ts) and the retry rule of the card
 * writes (src/views/model/writes.ts).
 */
import { describe, expect, it } from "vitest";
import {
  SetGarminHealthConsentInputSchema,
  type ListGarminWatches,
} from "../src/shared/watch-contract";
import {
  consentDoneText,
  consentInput,
  expired,
  watchRows,
} from "../src/views/model/watches";
import { requestIds } from "../src/views/model/writes";

const list: ListGarminWatches = {
  account_label: "Arnold · ab12",
  watches: [
    {
      device_id: "d1",
      label: "Fenix 7",
      paired_at: "2026-11-20T10:00:00Z",
      last_used_at: null,
    },
  ],
  health_consent: {
    granted: false,
    text_version: null,
    current_text_version: "v3",
  },
};

describe("watch cards", () => {
  it("names a watch that never reported", () => {
    expect(watchRows(list)[0]).toMatchObject({
      id: "d1",
      label: "Fenix 7",
      lastContact: "Noch kein Kontakt",
    });
  });

  it("grants for the text that was shown and revokes without one", () => {
    expect(consentInput(true, list)).toEqual({
      granted: true,
      text_version: "v3",
    });
    expect(consentInput(false, list)).toEqual({ granted: false });
    expect(
      SetGarminHealthConsentInputSchema.safeParse(consentInput(true, list))
        .success,
    ).toBe(true);
    expect(consentDoneText(false, 4)).toContain("4 gespeicherte");
    expect(consentDoneText(true, 0)).toContain("erteilt");
  });

  it("knows when a confirmation is over", () => {
    const at = Date.parse("2026-11-26T10:00:00Z");
    expect(expired("2026-11-26T09:59:00Z", at)).toBe(true);
    expect(expired("2026-11-26T10:01:00Z", at)).toBe(false);
  });
});

describe("requestIds", () => {
  it("keeps the id for the same input until a definite answer", () => {
    let n = 0;
    const ids = requestIds(() => `r-${++n}`);
    expect(ids.for(["a", 1])).toBe("r-1");
    expect(ids.for(["a", 1])).toBe("r-1");
    expect(ids.for(["a", 2])).toBe("r-2");
    ids.done();
    expect(ids.for(["a", 2])).toBe("r-3");
  });
});
