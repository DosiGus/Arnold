import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { RecoverySchema } from "../src/shared/write-recovery";
import { RecoveryCard } from "../src/ui/components/recovery";
import { ArnoldToolError, asFailure } from "../src/ui/recovery";

describe("actionable recovery cards", () => {
  for (const recovery of RecoverySchema.options)
    it(`explains ${recovery} without exposing a technical code`, () => {
      const html = renderToStaticMarkup(
        <RecoveryCard recovery={recovery} onAction={() => {}} />,
      );
      expect(html).toContain("ac-title");
      expect(html).not.toContain(recovery);
      expect(html).not.toContain("request_id");
      expect((html.match(/<button/g) ?? []).length).toBeLessThanOrEqual(1);
    });
  it("keeps the next step supplied by a failed read", () => {
    const failure = {
      code: "GOOGLE_REAUTH_REQUIRED",
      recovery: "reconnect_google" as const,
    };
    expect(asFailure(new ArnoldToolError(failure))).toEqual(failure);
    expect(new ArnoldToolError(failure).message).not.toContain(failure.code);
  });
});
