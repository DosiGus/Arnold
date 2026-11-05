import {
  test,
  expect,
  type FrameLocator,
  type Locator,
  type Page,
} from "@playwright/test";
const URL = "http://127.0.0.1:8795";
/** A writable tracker of its own for the plan change from the card. */
const PLAN_URL = "http://127.0.0.1:8805";

/**
 * "Training starten" lists the day's exercises; a row opens in place to
 * adjust its values or switch the exercise. The fixture plan has one session,
 * "Demo Push": bench press (total load) and incline press (per dumbbell),
 * 3 × 12, without target weights. Other specs write to the same server, so a
 * test may find a workout saved today or values from last time; it always
 * types the values it checks.
 */
type Surface = Page | FrameLocator | Locator;

const button = (page: Surface, name: string) =>
  page.getByRole("button", { name, exact: true });
const rows = (page: Surface) => page.locator(".ac-rows > li");
const row = (page: Surface, name: string) =>
  page.locator(".ac-day-row").filter({ hasText: name });
/** A typed value; the accessible name carries the unit, e.g. "Gewicht kg". */
const field = (scope: ReturnType<typeof row>, name: string) =>
  scope.getByRole("textbox", { name: new RegExp(`^${name}( |$)`) });

/** Today's card with the plan, never a workout saved earlier. */
async function startToday(page: Surface) {
  const entry = page
    .getByRole("button", {
      name: /^(Noch ein Training eintragen|So gemacht, speichern)$/,
    })
    .first();
  await expect(entry).toBeVisible();
  const another = button(page, "Noch ein Training eintragen");
  if (await another.isVisible()) await another.click();
  await expect(button(page, "So gemacht, speichern")).toBeVisible();
}

/** Opens one exercise with its values ready to type, one value for all sets. */
async function openValues(page: Surface, name: string) {
  const scope = row(page, name);
  if (!(await scope.getAttribute("data-open")))
    await scope.locator(".ac-day-head").click();
  const adjust = button(scope, "Anpassen");
  if (await adjust.isVisible()) await adjust.click();
  const same = button(scope, "Alle Sätze gleich");
  if (await same.isVisible()) await same.click();
  return scope;
}

async function fillDemoPush(page: Surface, bench = "60", incline = "20") {
  const benchRow = await openValues(page, "Demo Bankdrücken");
  await field(benchRow, "Wiederholungen").fill("10");
  await field(benchRow, "Gewicht").fill(bench);
  const inclineRow = await openValues(page, "Demo Schrägbankdrücken");
  await field(inclineRow, "Wiederholungen").fill("12");
  await field(inclineRow, "Gewicht je Hantel").fill(incline);
}

test("saves the day's plan with typed weights, edits it and takes it back", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`${URL}/preview?card=today`);
  await startToday(page);
  await fillDemoPush(page);
  // The row says what will be saved, before saving.
  await expect(row(page, "Demo Bankdrücken")).toContainText("60 kg");
  await expect(row(page, "Demo Bankdrücken")).toContainText("3 × 10");
  // A double tap saves one workout, not two.
  await button(page, "So gemacht, speichern").dblclick();

  const card = page.locator(".ac-training-saved");
  await expect(card).toContainText("Gespeichert");
  await expect(card.getByRole("heading", { name: "Demo Push" })).toBeVisible();
  await expect(
    rows(page).filter({ hasText: "Demo Bankdrücken" }),
  ).toContainText("3 × 10 · 60 kg");
  await expect(
    rows(page).filter({ hasText: "Demo Schrägbankdrücken" }),
  ).toContainText("3 × 12 · 20 kg pro Hantel");

  // The start screen says today is done: the button opens the saved
  // workout, the small link goes straight to the plan for another one.
  await page.goto(`${URL}/preview`);
  await expect(page.getByText("Heute erledigt")).toBeVisible();
  await expect(button(page, "Training starten")).toHaveCount(0);
  await button(page, "Training ansehen").click();
  await expect(card).toContainText("Gespeichert");
  await page.goto(`${URL}/preview`);
  await button(page, "Noch ein Training").click();
  await expect(button(page, "So gemacht, speichern")).toBeVisible();
  await page.goto(`${URL}/preview?card=today`);
  await expect(card).toContainText("Gespeichert");

  // The same training again on the same day asks first and saves nothing.
  await button(page, "Noch ein Training eintragen").click();
  // Unchanged, it is the plan with last time's values: one tap.
  await expect(row(page, "Demo Bankdrücken")).toContainText("60 kg");
  await button(page, "So gemacht, speichern").click();
  await expect(
    page.getByRole("heading", { name: "Schon eingetragen" }),
  ).toBeVisible();
  await button(page, "Werte ändern").click();
  await page.reload();
  await expect(card).toContainText("Gespeichert");

  // Editing replaces the saved workout in one step.
  await button(page, "Bearbeiten").click();
  await page
    .locator(".ac-edit-ex")
    .filter({ hasText: "Demo Bankdrücken" })
    .getByLabel("Gewicht")
    .fill("62,5");
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

test("adjusts with plus and minus, swaps and leaves out for this day only", async ({
  page,
}) => {
  const inputs: Record<string, unknown>[] = [];
  page.on("request", (request) => {
    try {
      const body = request.postDataJSON();
      if (body?.params?.name === "log_workout")
        inputs.push(body.params.arguments);
    } catch {
      /* not JSON */
    }
  });
  await page.goto(`${URL}/preview?card=today`);
  await startToday(page);
  await fillDemoPush(page, "60");

  // Plus and minus change every set at once.
  const bench = await openValues(page, "Demo Bankdrücken");
  await button(bench, "Gewicht mehr").click();
  await button(bench, "Sätze weniger").click();
  await expect(bench).toContainText("62,5 kg");
  await expect(bench).toContainText("2 × 10");
  await expect(bench).toContainText("Heute angepasst");

  // Switching offers the other exercises; a bodyweight one needs no weight.
  const incline = row(page, "Demo Schrägbankdrücken");
  await incline.locator(".ac-day-head").click();
  await button(incline, "Wechseln").click();
  await incline.getByRole("button", { name: /^Demo Klimmzüge/ }).click();
  await expect(incline).toContainText(
    "Demo Schrägbankdrücken → Demo Klimmzüge",
  );
  await button(incline, "Nur heute").click();
  const pullUps = row(page, "Demo Klimmzüge");
  await expect(pullUps).toContainText(
    "Nur heute · statt Demo Schrägbankdrücken",
  );
  await expect(pullUps).toContainText("Körpergewicht");

  // Reset brings the planned exercise back.
  await pullUps.locator(".ac-day-head").click();
  await button(pullUps, "Zurücksetzen").click();
  await expect(row(page, "Demo Schrägbankdrücken")).toBeVisible();

  // Left out today: struck through, not saved.
  const back = row(page, "Demo Schrägbankdrücken");
  await button(back, "Heute auslassen").click();
  await expect(back).toContainText("Heute ausgelassen");

  await button(page, "So gemacht, speichern").click();
  await expect(page.locator(".ac-training-saved")).toBeVisible();
  await expect(
    rows(page).filter({ hasText: "Demo Bankdrücken" }),
  ).toContainText("2 × 10 · 62,5 kg");
  await expect(
    rows(page).filter({ hasText: "Demo Schrägbankdrücken" }),
  ).toHaveCount(0);
  const sent = inputs.at(-1)!.exercises as Record<string, unknown>[];
  expect(sent.filter((e) => e.skip)).toHaveLength(1);
  await button(page, "Rückgängig").click();
  await button(page, "Wirklich zurücknehmen?").click();
  await expect(page.locator(".ac").first()).toContainText("zurückgenommen");
});

test("replaces an exercise in the plan for good and back again", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`${PLAN_URL}/preview?card=today`);
  await startToday(page);
  // The Pull day: one-arm rows become lat pulldowns.
  await button(page, "Anderer Tag").click();
  await button(page, "Pull").click();
  await expect(page.getByRole("heading", { name: "Pull" })).toBeVisible();
  const rowing = row(page, "Demo Rudern einarmig");
  await rowing.locator(".ac-day-head").click();
  await button(rowing, "Wechseln").click();
  // Exercises already on the day are not offered again.
  await expect(
    rowing.getByRole("button", { name: /^Demo Klimmzüge/ }),
  ).toHaveCount(0);
  await rowing.getByRole("button", { name: /^Demo Latzug/ }).click();
  await button(rowing, "Dauerhaft im Plan").click();

  // The new plan version is active; the day stays and asks for the weight.
  const pulldown = row(page, "Demo Latzug");
  await expect(pulldown).toContainText(
    "Im Plan · ersetzt Demo Rudern einarmig",
  );
  await expect(page.getByRole("heading", { name: "Pull" })).toBeVisible();
  await expect(pulldown).toContainText("Gewicht fehlt");
  await expect(button(page, "So gemacht, speichern")).toBeDisabled();
  await page.reload();
  await button(page, "Anderer Tag").click();
  await button(page, "Pull").click();
  await expect(row(page, "Demo Latzug")).toBeVisible();
  await expect(row(page, "Demo Rudern einarmig")).toHaveCount(0);

  // And back, so the tracker ends as it started.
  // A gap opens straight to the values; tapping the row again offers both.
  const again = row(page, "Demo Latzug");
  if (await again.getAttribute("data-open"))
    await again.locator(".ac-day-head").click();
  await again.locator(".ac-day-head").click();
  await button(again, "Wechseln").click();
  await again.getByRole("button", { name: /^Demo Rudern einarmig/ }).click();
  await button(again, "Dauerhaft im Plan").click();
  await expect(row(page, "Demo Rudern einarmig")).toBeVisible();
  expect(errors).toEqual([]);
});

test("recovers a lost response across reload with the same operation ID and no duplicate", async ({
  page,
}) => {
  await page.goto(`${URL}/preview?card=today`);
  await startToday(page);
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
  await button(page, "So gemacht, speichern").click();
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
  await startToday(frame);
  await fillDemoPush(frame, "40");
  await expect(messages).toHaveCount(0);
  await button(frame, "So gemacht, speichern").click();

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
