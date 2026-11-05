/** A new UI bundle gets a new resource URI; the same bundle keeps its URI. */
import { mkdtempSync, writeFileSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  bundleTag,
  dashboardResourceUri,
  onboardingResourceUri,
} from "../src/server/ui-resource";

describe("UI resource URIs", () => {
  it("follow the bundle's content", () => {
    const dir = mkdtempSync(join(tmpdir(), "arnold-ui-"));
    const file = join(dir, "dashboard.html");
    writeFileSync(file, "<div id=root>eins</div>");
    const first = dashboardResourceUri(file);
    expect(first).toMatch(/^ui:\/\/arnold\/dashboard-v2-[0-9a-f]{12}\.html$/);
    expect(dashboardResourceUri(file)).toBe(first);
    writeFileSync(file, "<div id=root>zwei</div>");
    // A later write with a new timestamp is noticed.
    utimesSync(file, new Date(), new Date(Date.now() + 5000));
    expect(dashboardResourceUri(file)).not.toBe(first);
    expect(onboardingResourceUri(file)).toMatch(
      /^ui:\/\/arnold\/onboarding-v2-[0-9a-f]{12}\.html$/,
    );
  });

  it("stays usable without a bundle", () => {
    expect(bundleTag(undefined)).toBe("dev");
    expect(bundleTag("/does/not/exist.html")).toBe("dev");
  });
});
