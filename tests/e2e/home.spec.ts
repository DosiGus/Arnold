/**
 * The start screen and the views behind its tiles, on a writable tracker with
 * invented history (port 8804). Chromium only: the goal flows write, and the
 * tracker is shared by every run of this file.
 */
import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { callTool } from "./helpers";

const BASE = "http://127.0.0.1:8804";
const main = (page: import("@playwright/test").Page) => page.locator("main");

test("Arnold opens on the monochrome widget overview", async ({ page }) => {
  await page.goto(`${BASE}/preview`);
  await expect(page.locator('main[data-card="home"]')).toBeVisible();
  await expect(
    page.getByRole("heading", {
      name: "Dein Überblick",
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.locator(".ac-home-tile")).toHaveCount(4);
  await expect(
    page.getByRole("region", { name: "Dein Training", exact: true }),
  ).toBeVisible();
  for (const name of ["Woche", "Scores", "Ziele", "Rekorde"])
    await expect(
      page.getByRole("button", { name: new RegExp(`^${name}`) }),
    ).toBeVisible();
  // The invented history may hold a workout today: then the tile opens it.
  await expect(
    page
      .getByRole("region", { name: "Dein Training", exact: true })
      .getByRole("button", {
        name: /^(Training bearbeiten|Training ansehen)$/,
      }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Plan bearbeiten", exact: true }),
  ).toBeVisible();
});

test("every tile opens its view and the back button returns", async ({
  page,
}) => {
  await page.goto(`${BASE}/preview`);
  await page
    .getByRole("button", { name: "Trainingsentwicklung ansehen" })
    .click();
  await expect(main(page)).toHaveAttribute("data-card", "stats");
  await expect(page.getByText("am Stück trainiert")).toBeVisible();
  await page.getByRole("button", { name: "Sätze/Woche" }).click();
  await expect(page.getByText(/Arbeitssätze pro Woche/)).toBeVisible();
  await page.getByRole("button", { name: "Zurück zur Übersicht" }).click();
  await expect(main(page)).toHaveAttribute("data-card", "home");

  await page.getByRole("button", { name: /^Rekorde/ }).click();
  await page.getByRole("button", { name: /^Alle Rekorde ansehen/ }).click();
  await expect(main(page)).toHaveAttribute("data-card", "records");
  await expect(
    page.getByRole("heading", { name: /\d+ Rekorde?/ }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Nach Übung" }).click();
  await page.getByRole("button", { name: "Zurück zur Übersicht" }).click();

  await page
    .getByRole("region", { name: "Dein Training", exact: true })
    .getByRole("button", { name: /Training (bearbeiten|ansehen)/ })
    .click();
  await expect(main(page)).toHaveAttribute("data-card", "today");
  await page
    .getByRole("button", { name: "Zurück zur Übersicht", exact: true })
    .click();

  await page
    .getByRole("button", { name: "Plan bearbeiten", exact: true })
    .click();
  await expect(main(page)).toHaveAttribute("data-card", "plan");
});

test("a goal set in the card is stored and shown everywhere", async ({
  page,
}) => {
  await page.goto(`${BASE}/preview?card=goals`);
  await expect(
    page.getByRole("heading", { name: "Deine Ziele" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Ziel hinzufügen" }).click();
  await page.getByRole("button", { name: /Eine Übung/ }).click();
  const first = page.locator(".ac-option").first();
  const exercise = (await first.locator("strong").textContent())!.trim();
  await first.click();
  await expect(
    page.getByRole("heading", { name: `${exercise}: dein Ziel` }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Zielwert erhöhen" }).click();
  await page.getByRole("button", { name: "Ziel speichern" }).click();
  await expect(page.getByRole("status")).toContainText(
    `Ziel gespeichert: ${exercise}`,
  );
  await expect(
    page.getByRole("button", { name: new RegExp(`^${exercise}:`) }),
  ).toBeVisible();
  // The server has it, the way ChatGPT reads it.
  const view = await callTool(page, "show_arnold_dashboard", { card: "goals" });
  expect(
    (view.home.goals as { name: string }[]).some((g) => g.name === exercise),
  ).toBe(true);
});

test("body weight is entered from the goal and moves the bar", async ({
  page,
}) => {
  await page.goto(`${BASE}/preview?card=goals`);
  await page.getByRole("button", { name: /^Körpergewicht:/ }).click();
  await page.getByRole("button", { name: "Gewicht eintragen" }).click();
  const input = page.getByRole("textbox", { name: "Dein Gewicht heute" });
  await input.fill("81,3");
  await input.blur();
  await page.getByRole("button", { name: "Speichern" }).click();
  await expect(page.locator(".ac-goal-number strong")).toContainText("81,3");
  const view = await callTool(page, "show_arnold_dashboard", {});
  expect(view.home.latest_body_weight.weight_kg).toBe(81.3);
});

test("start screen and its views stay accessible and fit 375px", async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 812 });
  for (const theme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: theme, reducedMotion: "reduce" });
    for (const card of ["home", "stats", "goals", "records"]) {
      await page.goto(`${BASE}/preview?card=${card}`);
      await expect(
        page.locator(`main[data-card="${card}"] .ac`).first(),
      ).toBeVisible();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
        `${card}/${theme} overflows`,
      ).toBe(true);
      const results = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa"])
        .analyze();
      expect(
        results.violations.map((v) => `${card}/${theme}: ${v.id}`),
      ).toEqual([]);
    }
  }
});

test("start screen and its views fit narrow phones without sideways scrolling", async ({
  page,
}) => {
  for (const width of [300, 340, 360]) {
    await page.setViewportSize({ width, height: 800 });
    for (const card of ["home", "stats", "goals", "records"]) {
      await page.goto(`${BASE}/preview?card=${card}`);
      await expect(
        page.locator(`main[data-card="${card}"] .ac`).first(),
      ).toBeVisible();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
        `${card}@${width} overflows`,
      ).toBe(true);
    }
  }
});
