import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
const origin = "http://127.0.0.1:8892";

test("T3-09 mobile progress variants do not overflow the page", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${origin}/preview`);
  await page
    .getByRole("navigation", { name: "Hauptnavigation" })
    .getByRole("button", { name: "Fortschritt", exact: true })
    .click();
  await page
    .getByLabel("Übung", { exact: true })
    .selectOption("ex-test-row-single");
  await expect(
    page.getByRole("heading", { name: "Testrudern einarmig", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Ausführungsarten", exact: true }),
  ).toBeVisible();
  const sizes = await page.evaluate(() => ({
    page: document.body.scrollWidth,
    viewport: innerWidth,
  }));
  await test.info().attach("mobile-width", {
    body: JSON.stringify(sizes),
    contentType: "application/json",
  });
  await page.screenshot({
    path: "test-results/qa-task003-mobile.png",
    fullPage: true,
  });
  expect(sizes.page).toBeLessThanOrEqual(sizes.viewport + 1);
});

test("additional dark-theme accessibility control covers all Arnold views", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(`${origin}/preview`);
  await expect(page.locator(".stat-card").first()).toBeVisible();
  await page.evaluate(() => {
    document.documentElement.dataset.theme = "dark";
  });
  for (const name of ["Übersicht", "Workouts", "Fortschritt"]) {
    await page
      .getByRole("navigation", { name: "Hauptnavigation" })
      .getByRole("button", { name, exact: true })
      .click();
    await expect(page.locator('[aria-busy="true"]')).toHaveCount(0);
    await page.waitForTimeout(200);
    const result = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa"])
      .analyze();
    expect(
      result.violations.map((v) => ({
        view: name,
        id: v.id,
        nodes: v.nodes.map((n) => n.target),
      })),
    ).toEqual([]);
  }
});
