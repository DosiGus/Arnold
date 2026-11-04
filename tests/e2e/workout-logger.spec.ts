import { test, expect, type Page, type FrameLocator } from "@playwright/test";
const URL = "http://127.0.0.1:8795";

/**
 * "Training starten" shows the day's plan; anything different is changed
 * under "Anpassen". The fixture plan has one session, "Demo Push": bench press
 * (total load) and incline press (per dumbbell), 3 × 12, without target
 * weights. Other specs write to the same server, so a test may find a workout
 * saved today or values from last time; it always goes through the editor.
 */
async function openEditor(page: Page | FrameLocator) {
  const entry = page
    .getByRole("button", {
      name: /^(Noch ein Training eintragen|Werte eintragen|Anpassen)$/,
    })
    .first();
  await expect(entry).toBeVisible();
  const another = page.getByRole("button", {
    name: "Noch ein Training eintragen",
  });
  if (await another.isVisible()) await another.click();
  const fill = page.getByRole("button", { name: "Werte eintragen" });
  if (await fill.isVisible()) await fill.click();
  else await button(page, "Anpassen").click();
  await expect(
    page.getByRole("heading", { name: "Was hast du gemacht?" }),
  ).toBeVisible();
}
const exercise = (page: Page | FrameLocator, name: string) =>
  page.locator(".ac-edit-ex").filter({ hasText: name });
const button = (page: Page | FrameLocator, name: string) =>
  page.getByRole("button", { name, exact: true });
const rows = (page: Page | FrameLocator) => page.locator(".ac-rows > li");

async function fillDemoPush(
  page: Page | FrameLocator,
  bench = "60",
  incline = "20",
) {
  const benchBox = exercise(page, "Demo Bankdrücken");
  await benchBox.getByLabel("Wdh.").fill("10");
  await benchBox.getByLabel("Gewicht").fill(bench);
  await exercise(page, "Demo Schrägbankdrücken")
    .getByLabel("Gewicht")
    .fill(incline);
}

test("saves the day's plan with typed weights, edits it and takes it back", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`${URL}/preview?card=today`);
  await openEditor(page);
  await fillDemoPush(page);
  // A double tap saves one workout, not two.
  await button(page, "Speichern").dblclick();

  const card = page.locator(".ac-training-saved");
  await expect(card).toContainText("Gespeichert");
  await expect(card.getByRole("heading", { name: "Demo Push" })).toBeVisible();
  await expect(
    rows(page).filter({ hasText: "Demo Bankdrücken" }),
  ).toContainText("3 × 10 · 60 kg");
  await expect(
    rows(page).filter({ hasText: "Demo Schrägbankdrücken" }),
  ).toContainText("3 × 12 · 20 kg pro Hantel");

  // The same training again on the same day asks first and saves nothing.
  await button(page, "Noch ein Training eintragen").click();
  await button(page, "So gemacht, speichern").click();
  await expect(
    page.getByRole("heading", { name: "Schon eingetragen" }),
  ).toBeVisible();
  await button(page, "Abbrechen").click();
  await page.reload();
  await expect(card).toContainText("Gespeichert");

  // Editing replaces the saved workout in one step.
  await button(page, "Bearbeiten").click();
  await exercise(page, "Demo Bankdrücken").getByLabel("Gewicht").fill("62,5");
  await button(page, "Änderungen speichern").click();
  await expect(
    rows(page).filter({ hasText: "Demo Bankdrücken" }),
  ).toContainText("3 × 10 · 62,5 kg");

  // Taking it back needs a second tap and says what happened.
  await button(page, "Rückgängig").click();
  await button(page, "Wirklich zurücknehmen?").click();
  await expect(page.locator(".ac").first()).toContainText(
    "Das Training wurde zurückgenommen.",
  );
  expect(errors).toEqual([]);
});

test("swaps and leaves out exercises for this day only", async ({ page }) => {
  await page.goto(`${URL}/preview?card=today`);
  await openEditor(page);
  const incline = exercise(page, "Demo Schrägbankdrücken");
  await incline.getByRole("button", { name: "Tauschen" }).click();
  await incline.getByLabel("Statt Demo Schrägbankdrücken").selectOption({
    label: "Demo Klimmzüge",
  });
  // Bodyweight: no weight to enter, the planned volume stays.
  await expect(exercise(page, "Demo Klimmzüge")).toContainText(
    "statt Demo Schrägbankdrücken",
  );
  await exercise(page, "Demo Bankdrücken").getByLabel("Gewicht").fill("60");
  await button(page, "Speichern").click();
  await expect(rows(page).filter({ hasText: "Demo Klimmzüge" })).toContainText(
    "Körpergewicht",
  );
  await expect(
    rows(page).filter({ hasText: "Demo Schrägbankdrücken" }),
  ).toHaveCount(0);
  await button(page, "Rückgängig").click();
  await button(page, "Wirklich zurücknehmen?").click();
  await expect(page.locator(".ac").first()).toContainText("zurückgenommen");
});

test("recovers a lost response across reload with the same operation ID and no duplicate", async ({
  page,
}) => {
  await page.goto(`${URL}/preview?card=today`);
  await openEditor(page);
  let lose = true;
  const ids: string[] = [];
  await page.route("**/mcp", async (route) => {
    const body = route.request().postDataJSON();
    if (body?.method === "tools/call" && body.params?.name === "log_workout") {
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
  await fillDemoPush(page, "55");
  await button(page, "Speichern").click();
  await expect(page.getByRole("alert")).toContainText(
    "Deine Eingaben bleiben erhalten",
  );
  // Nothing new can be saved while the outcome is unknown.
  await expect(button(page, "Erneut prüfen")).toBeVisible();

  // After a reload the saved workout shows up and the check is offered.
  await page.reload();
  await expect(button(page, "Erneut prüfen")).toBeVisible();
  await button(page, "Erneut prüfen").click();
  await expect(page.locator(".ac-training-saved")).toBeVisible();
  await expect(button(page, "Erneut prüfen")).toHaveCount(0);
  await expect(
    rows(page).filter({ hasText: "Demo Bankdrücken" }),
  ).toContainText("55 kg");
  expect(new Set(ids).size).toBe(1);
  await button(page, "Rückgängig").click();
  await button(page, "Wirklich zurücknehmen?").click();
  await expect(page.locator(".ac").first()).toContainText("zurückgenommen");
});

test("MCP App bridge saves in a sandbox and tells the chat once", async ({
  page,
}) => {
  await page.goto(`${URL}/host?card=today`);
  await expect(page.locator("#host-status")).toHaveAttribute(
    "data-initialized",
    "true",
  );
  const frame = page.frameLocator("iframe");
  const context = page.locator("#host-context");
  const messages = page.locator("#host-messages li");

  // Today's plan reaches the model with the IDs log_workout needs.
  await expect(context).toContainText("Trainingstag „Demo Push“");
  await expect(context).toContainText("session_id");
  await openEditor(frame);
  await fillDemoPush(frame, "40");
  await expect(messages).toHaveCount(0);
  await button(frame, "Speichern").click();

  // Saving posts exactly one message, with the engine's numbers.
  await expect(messages).toHaveCount(1);
  await expect(messages.first()).toHaveText(
    /^Training gespeichert: Demo Push · 2 Übungen, 6 Arbeitssätze, (\d[\d.]*|–) kg Volumen( · neuer Rekord: .+)?\.$/,
  );
  await expect(context).toContainText("gespeichertes Training");
  await expect(context).toContainText("set_id");
  await page.waitForTimeout(500);
  await expect(messages).toHaveCount(1);
  // Leave the shared tracker without this workout for the next tests.
  await button(frame, "Rückgängig").click();
  await button(frame, "Wirklich zurücknehmen?").click();
  await expect(frame.locator(".ac").first()).toContainText("zurückgenommen");
});
