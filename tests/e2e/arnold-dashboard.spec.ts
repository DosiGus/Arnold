import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { openCard } from "./helpers";

test("the weekly card leads to compact history and progress without an app frame", async ({
  page,
}) => {
  await openCard(page, "week");
  const card = page.locator(".ac").first();
  await expect(card).toContainText("Trainingstag");
  await expect(card.locator(".ac-actions button")).toHaveCount(2);
  await expect(page.getByRole("navigation")).toHaveCount(0);
  await expect(page.locator("h1")).toHaveCount(0);
  await card.getByRole("button", { name: "Verlauf", exact: true }).click();
  await expect(page.getByText(/Trainings gefunden/)).toBeVisible();
  await expect(page.locator("table:not(.visually-hidden)")).toHaveCount(0);
  await page.getByRole("button", { name: "Zurück", exact: true }).click();
  await page.getByRole("button", { name: "Fortschritt", exact: true }).click();
  await expect(page.locator(".ac-big")).toBeVisible();
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

test("history details keep raw load, side and set type readable without a table", async ({
  page,
}) => {
  await openCard(page, "history");
  await page
    .getByRole("button", { name: /Oberkörper A am 5\. Oktober 2026/ })
    .click();
  const detail = page.locator(".workout-detail");
  await expect(detail).toContainText("75 kg");
  await expect(detail).toContainText("20 kg pro Hantel");
  await expect(detail).toContainText("Links");
  await expect(detail).toContainText("Rechts");
  await expect(detail.locator("table")).toHaveCount(0);
  await expect(detail).not.toContainText("per_implement");
});

test("the full history retains period and plan filters", async ({ page }) => {
  await openCard(page, "history");
  await page.getByRole("button", { name: "Alle Trainings ansehen" }).click();
  await page
    .getByRole("group", { name: "Trainingsplan auswählen" })
    .getByRole("button", { name: /Version 1/ })
    .click();
  await expect(page.getByText("2 Trainings gefunden")).toBeVisible();
  await page.getByLabel("Trainings von", { exact: true }).fill("2030-01-01");
  await page.getByLabel("Trainings bis", { exact: true }).fill("2030-01-31");
  await expect(
    page.getByText(/Keine Trainings in dieser Auswahl/),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Auswahl zurücksetzen", exact: true })
    .click();
  await expect(page.locator(".ac-training-row").first()).toBeVisible();
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
  await openCard(page, "week", "http://127.0.0.1:8793");
  await expect(page.locator(".ac")).toContainText("Willkommen bei Arnold");
  await expect(page.locator(".ac-week")).toHaveCount(0);
  await page.goto("http://127.0.0.1:8794/preview");
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Erneut prüfen", exact: true }),
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
    for (const card of ["today", "week", "history", "progress", "plan"]) {
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
  await openCard(page, "week");
  const button = page.getByRole("button", { name: "Verlauf", exact: true });
  await button.focus();
  expect(
    await button.evaluate((el) => getComputedStyle(el).outlineStyle),
  ).not.toBe("none");
  await page.keyboard.press("Enter");
  await expect(page.locator('main[data-card="history"]')).toBeVisible();
});

test("the sandboxed host keeps model context current without chat spam", async ({
  page,
}) => {
  await page.goto("http://127.0.0.1:8792/host?card=week");
  const app = page.frameLocator("iframe");
  await expect(app.locator(".ac").first()).toBeVisible();
  await expect(page.locator("#host-context")).toContainText("Wochenkarte");
  await app.getByRole("button", { name: "Fortschritt", exact: true }).click();
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
