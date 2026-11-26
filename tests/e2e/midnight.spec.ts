import { test, expect } from "@playwright/test";
import { callTool } from "./helpers";
import { open } from "./host";
import type { ArnoldDashboardView } from "../../src/shared/arnold-view";

/**
 * The overview around midnight UTC (DATE-001). Berlin is one hour ahead, so
 * for an hour the UTC day is still yesterday. The server clock and the browser
 * clock are both fixed: 22 Nov 23:30 UTC (00:30 in Berlin, already the 23rd)
 * and 23 Nov 00:30 UTC. The cases must behave the same as at noon.
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

for (const c of CASES) {
  const BASE = `http://127.0.0.1:${c.port}`;
  test.describe(`at ${c.name}`, () => {
    test.beforeEach(async ({ page }) => {
      await page.clock.install({ time: new Date(c.now) });
    });

    test("the overview shows the server's values for the user's day", async ({
      page,
    }) => {
      const { app } = await open(page, BASE);
      const view = (await callTool(page, "get_arnold_dashboard", {
        timezone: "Europe/Berlin",
      })) as ArnoldDashboardView;
      expect(view.reference?.date).toBe(c.day);
      for (const [name, score] of [
        ["Konstanz", view.scores!.consistency],
        ["Fortschritt", view.scores!.progress],
        ["Erholung", view.scores!.recovery],
      ] as const)
        await expect(
          app.getByRole("button", {
            name: new RegExp(`^${name} ${score.value ?? "unbekannt"}\\.`),
          }),
        ).toBeVisible();
      // The 23rd is a Monday: the week on screen is the user's, not UTC's.
      await expect(app.getByLabel(/^Mo, heute|^Mo, trainiert/)).toBeVisible();
    });

    test("without a zone the server anchors on the UTC day, never silently on another", async ({
      page,
    }) => {
      await page.goto(`${BASE}/host`);
      const view = (await callTool(
        page,
        "get_arnold_dashboard",
        {},
      )) as ArnoldDashboardView;
      expect(view.reference?.source).toBe("fallback");
      expect(view.reference?.date).toBe(c.now.slice(0, 10));
    });

    test("body weight entered now is the latest one", async ({ page }) => {
      const { app } = await open(page, BASE, "?card=goals");
      await app
        .getByRole("textbox", { name: "Heutiges Körpergewicht" })
        .fill("81,3");
      await app.getByRole("button", { name: "Eintragen" }).click();
      await expect(app.getByText(/^81,3 kg/).first()).toBeVisible();
      const view = (await callTool(page, "get_arnold_dashboard", {
        timezone: "Europe/Berlin",
      })) as ArnoldDashboardView;
      expect(view.home.latest_body_weight?.date).toBe(c.day);
      expect(view.home.latest_body_weight?.weight_kg).toBe(81.3);
    });
  });
}
