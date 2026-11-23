import { test, expect, type Page } from "@playwright/test";
import { callTool } from "./helpers";
import type { ArnoldDashboardView } from "../../src/shared/arnold-view";

/**
 * The start screen around midnight UTC (DATE-001). Berlin is one hour ahead,
 * so for an hour the UTC day is still yesterday. The server clock and the
 * browser clock are both fixed: 22 Nov 23:30 UTC (00:30 in Berlin, already the
 * 23rd) and 23 Nov 00:30 UTC. The cases must behave the same as at noon.
 * Chromium only: the weight flow writes.
 */
const CASES = [
  {
    name: "23:30 UTC",
    port: 8840,
    now: "2026-11-22T23:30:00Z",
    day: "2026-11-23",
  },
  {
    name: "00:30 UTC",
    port: 8841,
    now: "2026-11-23T00:30:00Z",
    day: "2026-11-23",
  },
] as const;

const tile = (page: Page, name: string) =>
  page.getByRole("button", { name: new RegExp(`^${name}`) });

for (const c of CASES) {
  const BASE = `http://127.0.0.1:${c.port}`;
  test.describe(`at ${c.name}`, () => {
    test.beforeEach(async ({ page }) => {
      await page.clock.install({ time: new Date(c.now) });
    });

    test("the scores tile shows the server's values for the user's day", async ({
      page,
    }, info) => {
      test.skip(info.project.name !== "chromium");
      await page.goto(`${BASE}/preview?card=home`);
      const view = (await callTool(page, "get_arnold_dashboard", {
        timezone: "Europe/Berlin",
      })) as ArnoldDashboardView;
      expect(view.reference?.date).toBe(c.day);
      const s = view.scores!;
      const shown = [s.consistency, s.progress, s.recovery].map((x) =>
        x.value === null ? "–" : String(x.value),
      );
      await expect(tile(page, "Scores")).toContainText(shown.join(" · "));
    });

    test("without a zone the server anchors on the UTC day, never silently on another", async ({
      page,
    }, info) => {
      test.skip(info.project.name !== "chromium");
      await page.goto(`${BASE}/preview?card=home`);
      const view = (await callTool(
        page,
        "get_arnold_dashboard",
        {},
      )) as ArnoldDashboardView;
      expect(view.reference?.source).toBe("fallback");
      expect(view.reference?.date).toBe(c.now.slice(0, 10));
    });

    test("body weight entered now is the latest one", async ({
      page,
    }, info) => {
      test.skip(info.project.name !== "chromium");
      await page.goto(`${BASE}/preview?card=goals`);
      await page.getByRole("button", { name: /^Körpergewicht:/ }).click();
      await page.getByRole("button", { name: "Gewicht eintragen" }).click();
      const input = page.getByRole("textbox", { name: "Dein Gewicht heute" });
      await input.fill("81,3");
      await input.blur();
      await page.getByRole("button", { name: "Speichern" }).click();
      await expect(page.locator(".ac-goal-number strong")).toContainText(
        "81,3",
      );
      const view = await callTool(page, "show_arnold_dashboard", {
        timezone: "Europe/Berlin",
      });
      expect(view.home.latest_body_weight.date).toBe(c.day);
      expect(view.home.latest_body_weight.weight_kg).toBe(81.3);
    });
  });
}
