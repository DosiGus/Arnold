import { test, expect } from "@playwright/test";
import { openCard } from "./helpers";

test("T3-02: navigating and refreshing settle instead of looping", async ({
  page,
}) => {
  const calls: string[] = [];
  page.on("request", (r) => {
    if (r.url().endsWith("/mcp") && r.method() === "POST") {
      const body = r.postDataJSON();
      if (body?.method === "tools/call") calls.push(body.params.name);
    }
  });
  await openCard(page, "home");
  await page.waitForTimeout(400);
  // Two more than before: the card asks once with its time zone, and the
  // refreshed view reloads the workout context (UX-016).
  expect(calls.length).toBeLessThanOrEqual(6);
  const before = calls.length;
  await page
    .getByRole("button", { name: /^Plan (ansehen|bearbeiten)$/ })
    .click();
  await expect(
    page.locator('main[data-card="plan"] .ac').first(),
  ).toBeVisible();
  await page.waitForTimeout(500);
  expect(calls.length - before).toBeLessThanOrEqual(2);
  const settled = calls.length;
  await page.waitForTimeout(800);
  expect(calls.length).toBe(settled);
});

test("T3-06: the workout list does not change the start screen", async ({
  page,
}) => {
  await openCard(page, "home");
  const headline = await page.locator(".ac-dashboard-head h2").innerText();
  const status = await page
    .locator(".ac-widget-week-total .ac-widget-ring")
    .getAttribute("aria-label");
  // Start screen → Rekorde → the record's training, opened in the list.
  await page.getByRole("button", { name: /^Rekorde/ }).click();
  await page.getByRole("button", { name: /^Alle Rekorde ansehen/ }).click();
  await page.getByRole("button", { name: "Training ansehen" }).click();
  await expect(
    page.locator('.ac-history-row[aria-expanded="true"]'),
  ).toHaveCount(1);
  await page.getByRole("button", { name: "Zurück zur Übersicht" }).click();
  await page.getByRole("button", { name: "Zurück zur Übersicht" }).click();
  await expect(page.locator(".ac-dashboard-head h2")).toHaveText(headline);
  await expect(
    page.locator(".ac-widget-week-total .ac-widget-ring"),
  ).toHaveAttribute("aria-label", status!);
  // The start screen leads to the list as well.
  await page.getByRole("button", { name: /^Woche/ }).click();
  await page
    .getByRole("button", { name: "Alle Einheiten", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Deine Einheiten" }),
  ).toBeVisible();
});

test("T3-04/T3-09: one comparison class stays legible with enlarged text", async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await openCard(page, "progress");
  await page
    .getByRole("button", { name: "Übung wechseln", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Testrudern einarmig", exact: true })
    .click();
  await expect(page.locator(".ac")).toContainText("kg pro Hantel");
  await expect(page.locator(".ac")).toContainText(/Links|Rechts/);
  await page.addStyleTag({ content: "html { font-size: 200%; }" });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  ).toBe(true);
});
