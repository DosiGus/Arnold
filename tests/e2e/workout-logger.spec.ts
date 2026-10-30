import { test, expect, type Page, type FrameLocator } from "@playwright/test";
const URL = "http://127.0.0.1:8795";

/** The fixture's plan has one session, "Demo Push": bench press, then incline. */
async function start(page: Page | FrameLocator) {
  const card = page.locator(".ac").first();
  await expect(card).toContainText("Demo Push");
  await card.getByRole("button", { name: "Training starten" }).click();
  await expect(
    page.getByRole("heading", { name: "Demo Bankdrücken" }),
  ).toBeVisible();
}
const saved = (page: Page | FrameLocator) => page.locator(".ac-chip.done");
const button = (page: Page | FrameLocator, name: string) =>
  page.getByRole("button", { name, exact: true });

test("starts today's session, logs with plus and minus, corrects and completes", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`${URL}/preview`);
  await start(page);

  // No target weight in the plan: the first value is typed once, then reused.
  await page.getByLabel("Gewicht", { exact: true }).fill("60");
  await expect(page.getByLabel("Wiederholungen", { exact: true })).toHaveValue(
    "12",
  );
  // A double tap saves one set, not two.
  await button(page, "Satz speichern").dblclick();
  await expect(saved(page)).toHaveCount(1);
  await expect(saved(page).first()).toContainText("60 kg × 12");

  // The next set starts from the last one; plus and minus adjust it.
  await button(page, "Gewicht erhöhen").click();
  await button(page, "Wiederholungen verringern").click();
  await button(page, "Satz speichern").click();
  await expect(saved(page)).toHaveCount(2);
  await expect(saved(page).nth(1)).toContainText("62,5 kg × 11");

  // Tapping a saved set corrects it in place.
  await page.getByRole("button", { name: /^Satz 1 korrigieren/ }).click();
  await page.getByLabel("Gewicht", { exact: true }).fill("65");
  await button(page, "Korrektur speichern").click();
  await expect(saved(page).first()).toContainText("65 kg × 12");
  await expect(saved(page).first()).not.toContainText("60 kg");

  // The dumbbell exercise carries its own convention from the plan.
  await page
    .getByRole("group", { name: "Übung" })
    .getByRole("button", { name: "Demo Schrägbankdrücken" })
    .click();
  await expect(
    page.getByLabel("Gewicht pro Hantel", { exact: true }),
  ).toBeVisible();
  await page.getByLabel("Gewicht pro Hantel", { exact: true }).fill("20");
  await page
    .getByRole("group", { name: "Wie schwer war der Satz?" })
    .getByRole("button", { name: "Passt" })
    .click();
  await button(page, "Satz speichern").click();
  await expect(saved(page)).toHaveCount(1);
  await expect(saved(page).first()).toContainText("20 kg pro Hantel");

  // Finishing shows the engine's own numbers for this workout.
  await button(page, "Training beenden").click();
  const summary = page.locator(".ac").first();
  await expect(summary).toContainText("Training gespeichert");
  await expect(
    summary.locator(".ac-stat").filter({ hasText: "Arbeitssätze" }),
  ).toContainText("3");
  await button(page, "Überblick").click();
  await expect(page.locator(".ac").first()).toContainText("Zuletzt: Demo Push");
  await expect(page.locator("body")).not.toContainText("per_implement");
  expect(errors).toEqual([]);
});

test("recovers a lost response across reload with the same operation ID and no duplicate", async ({
  page,
}) => {
  await page.goto(`${URL}/preview`);
  await start(page);
  let lose = true;
  const ids: string[] = [];
  await page.route("**/mcp", async (route) => {
    const body = route.request().postDataJSON();
    if (
      body?.method === "tools/call" &&
      body.params?.name === "log_workout_sets"
    ) {
      ids.push(body.params.arguments.request_id);
      if (lose) {
        lose = false;
        await route.fetch();
        await route.abort("failed");
        return;
      }
    }
    await route.continue();
  });
  await page.getByLabel("Gewicht", { exact: true }).fill("55");
  await page.getByLabel("Wiederholungen", { exact: true }).fill("9");
  await button(page, "Satz speichern").click();
  await expect(page.getByRole("alert")).toContainText("Status unklar");
  // Nothing new can be saved while the outcome is unknown.
  await expect(button(page, "Satz speichern")).toHaveCount(0);

  // After a reload the open workout is resumed and the check is offered.
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Demo Bankdrücken" }),
  ).toBeVisible();
  await expect(page.getByRole("alert")).toContainText("nicht bestätigt");
  await button(page, "Erneut prüfen").click();
  await expect(
    page.getByRole("status").filter({ hasText: "Bereits" }),
  ).toHaveText("Bereits gespeichert · keine doppelte Änderung.");
  await expect(saved(page)).toHaveCount(1);
  await expect(saved(page).first()).toContainText("55 kg × 9");
  expect(new Set(ids).size).toBe(1);

  // Cancelling asks first, then says what happened.
  await button(page, "Training abbrechen").click();
  await button(page, "Ja, abbrechen").click();
  await expect(page.locator(".ac").first()).toContainText(
    "Das Training wurde abgebrochen.",
  );
});

test("MCP App bridge can write inside an opaque sandbox without browser storage", async ({
  page,
}) => {
  await page.goto(`${URL}/host`);
  await expect(page.locator("#host-status")).toHaveAttribute(
    "data-initialized",
    "true",
  );
  const frame = page.frameLocator("iframe");
  await start(frame);
  await frame.getByLabel("Gewicht", { exact: true }).fill("40");
  await frame.getByLabel("Wiederholungen", { exact: true }).fill("10");
  await button(frame, "Satz speichern").click();
  await expect(saved(frame)).toHaveCount(1);
});
