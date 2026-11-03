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
const saved = (page: Page | FrameLocator) => page.locator(".ac-set.done");
const button = (page: Page | FrameLocator, name: string) =>
  page.getByRole("button", { name, exact: true });
/** The save button names the set it saves: "Satz 2 speichern". */
const saveSet = (page: Page | FrameLocator) =>
  page.getByRole("button", { name: /^Satz \d+ speichern$/ });
/** After a set the card shows what was saved and the rest timer. */
const savedNotice = (page: Page | FrameLocator, n: number) =>
  page.getByRole("status").filter({ hasText: `Satz ${n} gespeichert` });
/** Rarer actions sit behind the "more" button. */
async function menu(page: Page | FrameLocator, entry: string) {
  await button(page, "Weitere Aktionen").click();
  await button(page, entry).click();
}

test("starts today's session, logs with plus and minus, corrects and completes", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`${URL}/preview?card=today`);
  await start(page);

  // No target weight in the plan: the first value is typed once, then reused.
  await page.getByLabel("Gewicht", { exact: true }).fill("60");
  await page.getByLabel("Wiederholungen", { exact: true }).fill("12");
  // A double tap saves one set, not two; then the rest timer runs.
  await saveSet(page).dblclick();
  await expect(savedNotice(page, 1)).toContainText("60 kg × 12");
  await expect(page.getByRole("timer")).toBeVisible();
  await button(page, "Pause überspringen").click();
  await expect(saved(page)).toHaveCount(1);
  await expect(saved(page).first()).toHaveAccessibleName(/60 kg × 12/);

  // The next set starts from the last one; plus and minus adjust it.
  await button(page, "Gewicht erhöhen").click();
  await button(page, "Wiederholungen verringern").click();
  await button(page, "Satz 2 speichern").click();
  await button(page, "Pause überspringen").click();
  await expect(saved(page)).toHaveCount(2);
  await expect(saved(page).nth(1)).toHaveAccessibleName(/62,5 kg × 11/);

  // Tapping a saved set corrects it in place.
  await page.getByRole("button", { name: /^Satz 1 korrigieren/ }).click();
  await page.getByLabel("Gewicht", { exact: true }).fill("65");
  await button(page, "Korrektur speichern").click();
  await expect(saved(page).first()).toHaveAccessibleName(/65 kg × 12/);
  await expect(saved(page).first()).not.toHaveAccessibleName(/60 kg/);

  // The dumbbell exercise carries its own convention from the plan.
  await menu(page, "Übung wechseln");
  await page.getByRole("button", { name: /^Demo Schrägbankdrücken/ }).click();
  await expect(
    page.getByLabel("Gewicht pro Hantel", { exact: true }),
  ).toBeVisible();
  await page.getByLabel("Gewicht pro Hantel", { exact: true }).fill("20");
  await saveSet(page).click();
  await expect(savedNotice(page, 1)).toContainText("20 kg pro Hantel");
  // How the set felt is asked during the rest and stored on that set.
  const feel = page
    .getByRole("group", { name: "Wie viele wären noch gegangen?" })
    .getByRole("button", { name: "2 mehr", exact: true });
  await feel.click();
  await expect(feel).toHaveAttribute("aria-pressed", "true");

  // Finishing shows the engine's own numbers for this workout.
  await menu(page, "Training beenden");
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
  await page.goto(`${URL}/preview?card=today`);
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
  await saveSet(page).click();
  await expect(page.getByRole("alert")).toContainText(
    "Deine Eingaben bleiben erhalten",
  );
  // Nothing new can be saved while the outcome is unknown.
  await expect(saveSet(page)).toHaveCount(0);

  // After a reload the open workout is resumed and the check is offered.
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Demo Bankdrücken" }),
  ).toBeVisible();
  await expect(page.getByRole("alert")).toContainText(
    "Deine Eingaben bleiben erhalten",
  );
  await button(page, "Erneut prüfen").click();
  await expect(
    page.getByRole("status").filter({ hasText: "Satz gespeichert" }),
  ).toHaveText("Satz gespeichert.");
  await expect(saved(page)).toHaveCount(1);
  await expect(saved(page).first()).toHaveAccessibleName(/55 kg × 9/);
  expect(new Set(ids).size).toBe(1);

  // Cancelling asks first, then says what happened.
  await menu(page, "Training abbrechen");
  await button(page, "Ja, abbrechen").click();
  await expect(page.locator(".ac").first()).toContainText(
    "Das Training wurde abgebrochen.",
  );
});

test("MCP App bridge writes in a sandbox and tells the chat what happened", async ({
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

  // Today's card is described to the model without starting a chat turn.
  await expect(context).toContainText("Heute-Karte");
  await expect(context).toContainText("Demo Push");
  await start(frame);
  // Writes go through the bridge, with no browser storage in the sandbox.
  await frame.getByLabel("Gewicht", { exact: true }).fill("40");
  await frame.getByLabel("Wiederholungen", { exact: true }).fill("10");
  await saveSet(frame).click();
  await expect(savedNotice(frame, 1)).toContainText("40 kg × 10");

  // A saved set reaches the model with its id, so the chat can correct it.
  await expect(context).toContainText("laufendes Training");
  await expect(context).toContainText("Demo Bankdrücken: Satz 1 40 kg × 10");
  await expect(context).toContainText("set_id");
  // Logging stays in the card: no chat message per set.
  await expect(messages).toHaveCount(0);

  // Finishing posts exactly one message, with the engine's numbers.
  await menu(frame, "Training beenden");
  await expect(messages).toHaveCount(1);
  await expect(messages.first()).toHaveText(
    // Volume is the engine's: a number, or "–" when it calls it unknown.
    /^Training beendet: Demo Push · 1 Übung, 1 Arbeitssatz, (\d[\d.]*|–) kg Volumen( · neuer Rekord: .+)?\.$/,
  );
  await expect(context).toContainText("abgeschlossenes Training");
  await page.waitForTimeout(500);
  await expect(messages).toHaveCount(1);
});
