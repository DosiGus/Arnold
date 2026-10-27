import { test, expect, type Page } from "@playwright/test";
const URL = "http://127.0.0.1:8895";
function nav(page: Page, name: string) {
  return page
    .getByRole("navigation", { name: "Hauptnavigation" })
    .getByRole("button", { name, exact: true });
}
async function open(page: Page, session = "Demo Push") {
  await page.goto(`${URL}/preview`);
  await nav(page, "Training eintragen").click();
  await page.getByLabel("Trainingseinheit", { exact: true }).fill(session);
  await page
    .getByRole("button", { name: "Workout starten", exact: true })
    .click();
  await expect(
    page.getByText("Gespeichert und bestätigt.", { exact: true }),
  ).toBeVisible();
}
test("writes confirmed sets, preserves defaults, corrects, validates and completes with updated dashboard", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await open(page);
  await page
    .getByRole("combobox", { name: "Übung", exact: true })
    .selectOption("fixture-incline");
  await expect(
    page.getByRole("combobox", { name: "Gewichtsdefinition", exact: true }),
  ).toHaveValue("per_implement");
  await expect(page.getByLabel("Anzahl Geräte", { exact: true })).toHaveValue(
    "2",
  );
  await page.getByLabel("Gewicht (kg)", { exact: true }).fill("20");
  await page.getByLabel("Wiederholungen", { exact: true }).fill("10");
  await page
    .getByRole("button", { name: "Satz speichern", exact: true })
    .dblclick();
  await expect(page.locator(".confirmed-sets li")).toHaveCount(1);
  await page.getByLabel("Gewicht (kg)", { exact: true }).fill("22");
  await page.getByLabel("Wiederholungen", { exact: true }).fill("8");
  await page
    .getByRole("button", { name: "Satz speichern", exact: true })
    .click();
  await expect(page.locator(".confirmed-sets li")).toHaveCount(2);
  await page
    .getByRole("button", { name: "Satz 1 korrigieren", exact: true })
    .click();
  await page.getByLabel("Gewicht (kg)", { exact: true }).fill("25");
  await page
    .getByRole("button", { name: "Korrektur speichern", exact: true })
    .click();
  await expect(page.locator(".confirmed-sets li").first()).toContainText(
    "25 kg pro Hantel",
  );
  await expect(page.locator(".confirmed-sets li").first()).toContainText(
    "Revision 2",
  );
  await page.getByLabel("Gewicht (kg)", { exact: true }).fill("-5");
  await page.getByLabel("Wiederholungen", { exact: true }).fill("7");
  await page
    .getByRole("button", { name: "Satz speichern", exact: true })
    .click();
  expect(
    await page
      .getByLabel("Gewicht (kg)", { exact: true })
      .evaluate((el: HTMLInputElement) => el.validity.valid),
  ).toBe(false);
  await expect(page.locator(".confirmed-sets li")).toHaveCount(2);
  await page.getByLabel("Gewicht (kg)", { exact: true }).fill("20");
  await page
    .getByRole("combobox", { name: "Wiederholungsbasis", exact: true })
    .selectOption("per_side");
  await page
    .getByRole("button", { name: "Satz speichern", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText("VALIDATION_ERROR");
  await expect(page.getByLabel("Wiederholungen", { exact: true })).toHaveValue(
    "7",
  );
  await page
    .getByRole("combobox", { name: "Wiederholungsbasis", exact: true })
    .selectOption("total");
  await page
    .getByRole("button", { name: "Training abschließen", exact: true })
    .click();
  await expect(page.locator(".workout-logger")).toContainText("completed");
  await page
    .getByRole("button", { name: "Satz 1 korrigieren", exact: true })
    .click();
  await page.getByLabel("Gewicht (kg)", { exact: true }).fill("26");
  await page
    .getByLabel("Korrekturbegründung", { exact: true })
    .fill("Synthetischer Tippfehler");
  await page
    .getByRole("button", { name: "Korrektur speichern", exact: true })
    .click();
  await expect(page.locator(".confirmed-sets li").first()).toContainText(
    "26 kg pro Hantel",
  );
  await nav(page, "Übersicht").click();
  await expect(
    page.locator(".stat-card").filter({ hasText: "Trainingseinheiten" }),
  ).toContainText("1");
  expect(errors).toEqual([]);
});
test("recovers a lost response across reload with the same operation ID and no duplicate", async ({
  page,
}) => {
  await open(page, "Netzwerk Demo");
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
  await page.getByLabel("Gewicht (kg)", { exact: true }).fill("55");
  await page.getByLabel("Wiederholungen", { exact: true }).fill("9");
  await page
    .getByRole("button", { name: "Satz speichern", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText("Status unklar");
  await expect(page.getByLabel("Gewicht (kg)", { exact: true })).toHaveValue(
    "55",
  );
  await page.reload();
  await nav(page, "Training eintragen").click();
  await expect(page.getByRole("alert")).toContainText("unbestätigter Vorgang");
  await page
    .getByRole("button", {
      name: "Vorgang prüfen / erneut versuchen",
      exact: true,
    })
    .click();
  await expect(page.getByRole("status")).toHaveText(
    "Bereits gespeichert · keine doppelte Änderung.",
  );
  await expect(page.locator(".confirmed-sets li")).toHaveCount(1);
  expect(new Set(ids).size).toBe(1);
  await page
    .getByRole("button", { name: "Training abbrechen", exact: true })
    .click();
  await expect(page.locator(".workout-logger")).toContainText("cancelled");
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
  await frame
    .getByRole("navigation", { name: "Hauptnavigation" })
    .getByRole("button", { name: "Training eintragen", exact: true })
    .click();
  await frame
    .getByLabel("Trainingseinheit", { exact: true })
    .fill("Bridge Demo");
  await frame
    .getByRole("button", { name: "Workout starten", exact: true })
    .click();
  await frame.getByLabel("Gewicht (kg)", { exact: true }).fill("40");
  await frame.getByLabel("Wiederholungen", { exact: true }).fill("10");
  await frame
    .getByRole("button", { name: "Satz speichern", exact: true })
    .click();
  await expect(frame.locator(".confirmed-sets li")).toHaveCount(1);
});
