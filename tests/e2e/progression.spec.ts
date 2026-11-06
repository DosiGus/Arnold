import { test, expect } from "@playwright/test";

/**
 * Arnold's recommendation on the training card: last time under the name,
 * today's values on the right, and a switch to last time's values. Uses the
 * start screen server with weeks of invented history; nothing is saved.
 */
const URL = "http://127.0.0.1:8804";

test("the card tells Arnold's values from last time's and switches between them", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`${URL}/preview?card=today`);
  const another = page.getByRole("button", {
    name: "Noch ein Training eintragen",
    exact: true,
  });
  const save = page.getByRole("button", {
    name: "So gemacht, speichern",
    exact: true,
  });
  await expect(another.or(save).first()).toBeVisible();
  if (await another.isVisible()) await another.click();
  await expect(save).toBeVisible();

  const choice = page.getByRole("group", { name: "Welche Werte" });
  const recommended = choice.getByRole("button", { name: "Arnolds Vorschlag" });
  const lastTime = choice.getByRole("button", { name: "Wie letztes Mal" });
  await expect(recommended).toHaveAttribute("aria-pressed", "true");

  const rowWithLast = page
    .locator(".ac-day-row")
    .filter({ has: page.locator(".ac-day-last") })
    .first();
  const lastLine = await rowWithLast.locator(".ac-day-last").innerText();
  expect(lastLine).toMatch(/^Zuletzt .+ · .+/);
  const name = await rowWithLast
    .locator(".ac-day-name > span")
    .first()
    .innerText();
  // What changed carries an arrow, named for screen readers.
  await expect(
    page
      .locator(".ac-day-values")
      .getByText(/mehr als zuletzt|weniger als zuletzt/)
      .first(),
  ).toBeAttached();

  await lastTime.click();
  await expect(lastTime).toHaveAttribute("aria-pressed", "true");
  const same = page.locator(".ac-day-row").filter({ hasText: name }).first();
  await expect(same.locator(".ac-day-last")).toHaveCount(0);
  await expect(page.locator(".ac-day-trend")).toHaveCount(0);
  // The row now shows exactly what the "Zuletzt" line said.
  const [load, reps] = lastLine.replace(/^Zuletzt /, "").split(" · ");
  const values = same.locator(".ac-day-values");
  await expect(values).toContainText(load);
  await expect(values).toContainText(reps.replace(/^\d+ × /, ""));

  await recommended.click();
  await expect(same.locator(".ac-day-last")).toHaveText(lastLine);
  expect(errors).toEqual([]);
});
