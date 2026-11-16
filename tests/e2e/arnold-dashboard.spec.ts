import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { openCard } from "./helpers";

test("the start screen leads to the plan and progress without an app frame", async ({
  page,
}) => {
  await openCard(page, "home");
  const card = page.locator(".ac").first();
  await expect(
    page.getByRole("region", { name: "Deine Woche", exact: true }),
  ).toContainText("Trainingstag");
  await expect(page.getByRole("navigation")).toHaveCount(0);
  await expect(page.locator("h1")).toHaveCount(0);
  await card
    .getByRole("button", { name: /^Plan (ansehen|bearbeiten)$/ })
    .click();
  await expect(page.locator('main[data-card="plan"]')).toBeVisible();
  await expect(page.locator("table:not(.visually-hidden)")).toHaveCount(0);
  await page
    .getByRole("button", { name: "Zurück zur Übersicht", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Trainingsentwicklung ansehen" })
    .click();
  await expect(page.locator('main[data-card="stats"]')).toBeVisible();
});

test("an older chat asking for the week card gets the start screen", async ({
  page,
}) => {
  await page.goto("http://127.0.0.1:8792/preview?card=week");
  await expect(page.locator('main[data-card="home"]')).toBeVisible();
  await expect(page.locator(".ac-home-tile")).toHaveCount(4);
});

test("a read-only today card never offers an unavailable write", async ({
  page,
}) => {
  await openCard(page, "today");
  await expect(page.locator(".ac")).toContainText("Heute");
  await expect(
    page.getByRole("button", { name: "Training starten", exact: true }),
  ).toHaveCount(0);
  await expect(page.locator(".ac")).toContainText("Nur Ansicht");
});

test("all workouts by week open in place with readable loads", async ({
  page,
}) => {
  await openCard(page, "history");
  await expect(page.locator(".ac-history-week h3").first()).toBeVisible();
  await page.getByRole("button", { name: /^Oberkörper A .*5\. Okt\./ }).click();
  const exercises = page.getByRole("list", { name: "Übungen Oberkörper A" });
  await expect(exercises).toContainText("75 kg");
  await expect(exercises).toContainText("20 kg");
  await expect(exercises).toContainText("1 × 10");
  await expect(exercises.locator("table")).toHaveCount(0);
  await expect(exercises).not.toContainText("per_implement");
});

test("exercise switching keeps the selected comparison class beside the headline", async ({
  page,
}) => {
  await openCard(page, "progress");
  await page
    .getByRole("button", { name: "Übung wechseln", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Testrudern einarmig", exact: true })
    .click();
  await expect(page.locator(".ac")).toContainText("kg pro Hantel");
  await expect(page.locator(".ac")).toContainText(/Links|Rechts/);
  await page
    .getByRole("button", { name: "Andere Kennzahl", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Geschätztes Maximum", exact: true })
    .click();
  await expect(page.locator(".ac")).toContainText(
    "Kein getestetes Maximalgewicht",
  );
  await expect(page.locator(".ac")).not.toContainText("per_implement");
});

test("empty and failed reads never turn into example numbers", async ({
  page,
}) => {
  await openCard(page, "home", "http://127.0.0.1:8793");
  await expect(page.locator(".ac-dashboard")).toContainText(
    "Dein erstes Training ist der Anfang.",
  );
  await page.getByRole("button", { name: /^Woche/ }).click();
  await expect(page.locator(".ac-widget-week-days .done")).toHaveCount(0);
  await page.goto("http://127.0.0.1:8794/preview");
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Erneut versuchen", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".ac-big")).toHaveCount(0);
  await expect(page.locator("body")).not.toContainText("Demo");
});

test("cards inherit light and dark and remain accessible at 375px", async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 812 });
  for (const theme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: theme, reducedMotion: "reduce" });
    for (const card of [
      "home",
      "today",
      "history",
      "progress",
      "plan",
      "stats",
      "goals",
      "records",
    ]) {
      await openCard(page, card);
      await expect(page.locator(".ac").first()).toBeVisible();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
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

test("keyboard focus is visible and operates card navigation", async ({
  page,
}) => {
  await openCard(page, "home");
  const button = page.getByRole("button", {
    name: "Trainingsentwicklung ansehen",
  });
  await button.focus();
  expect(
    await button.evaluate((el) => getComputedStyle(el).outlineStyle),
  ).not.toBe("none");
  await page.keyboard.press("Enter");
  await expect(page.locator('main[data-card="stats"]')).toBeVisible();
});

test("the sandboxed host keeps model context current without chat spam", async ({
  page,
}) => {
  await page.goto("http://127.0.0.1:8792/host?card=week");
  const app = page.frameLocator("iframe");
  await expect(app.locator(".ac").first()).toBeVisible();
  await expect(page.locator("#host-context")).toContainText("Startansicht");
  await page.goto("http://127.0.0.1:8792/host?card=progress");
  await expect(app.locator(".ac").first()).toBeVisible();
  await expect(page.locator("#host-context")).toContainText("Fortschritt für");
  await app
    .getByRole("button", { name: "Übung wechseln", exact: true })
    .click();
  await app
    .getByRole("button", { name: "Testrudern einarmig", exact: true })
    .click();
  await expect(page.locator("#host-context")).toContainText(
    "Testrudern einarmig",
  );
  await expect(page.locator("#host-messages li")).toHaveCount(0);
});
