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
  await openCard(page, "week");
  await page.waitForTimeout(400);
  expect(calls.length).toBeLessThanOrEqual(4);
  const before = calls.length;
  await page.getByRole("button", { name: "Verlauf", exact: true }).click();
  await expect(page.locator(".ac-training-row").first()).toBeVisible();
  await page.waitForTimeout(500);
  expect(calls.length - before).toBeLessThanOrEqual(2);
  const settled = calls.length;
  await page.waitForTimeout(800);
  expect(calls.length).toBe(settled);
});

test("T3-05: a cancelled session opens exactly that session", async ({
  page,
}) => {
  await openCard(page, "history");
  await page.getByRole("button", { name: "Alle Trainings ansehen" }).click();
  await page
    .getByRole("switch", { name: "Offene und abgebrochene Trainings zeigen" })
    .click();
  await page
    .getByRole("button", { name: /Abgebrochene Einheit am 20\. Oktober 2026/ })
    .click();
  await expect(
    page.locator(".workout-detail").getByRole("heading", { level: 2 }),
  ).toHaveText("Abgebrochene Einheit");
  await expect(page.locator(".workout-detail")).not.toContainText(
    "Freies Training",
  );
});

test("T3-06: history filters do not change the weekly card", async ({
  page,
}) => {
  await openCard(page, "week");
  const headline = await page.locator(".ac-title").innerText();
  await page.getByRole("button", { name: "Verlauf", exact: true }).click();
  await page.getByRole("button", { name: "Alle Trainings ansehen" }).click();
  await page.getByLabel("Trainings von", { exact: true }).fill("2030-01-01");
  await expect(page.locator(".ac-training-row")).toHaveCount(0);
  await page.getByRole("button", { name: "Zurück", exact: true }).click();
  await expect(page.locator(".ac-title")).toHaveText(headline);
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
