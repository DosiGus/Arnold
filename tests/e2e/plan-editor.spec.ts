/**
 * Browser coverage for the training plan editor.
 *
 * Driven entirely through what a user can see and operate — roles, labels and
 * visible text — against an isolated synthetic tracker. No real plan, workout
 * or Google file is involved.
 */
import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

// One tracker per concern, because a plan change is persistent: the editing
// tests share 8796 and clean up after themselves, while the destructive flows
// get a tracker of their own.
const PLAN_URL = "http://127.0.0.1:8796";
const EMPTY_URL = "http://127.0.0.1:8797";
const ACTIVATE_URL = "http://127.0.0.1:8798";
const CONFLICT_URL = "http://127.0.0.1:8799";

const nav = (page: Page, name: string) =>
  page
    .getByRole("navigation", { name: "Hauptnavigation" })
    .getByRole("button", { name, exact: true });

const button = (page: Page, name: string) =>
  page.getByRole("button", { name, exact: true });

/**
 * Picks an exercise inside the open picker.
 *
 * Scoped to the dialog on purpose: an exercise name also appears on the cards
 * behind it, so an unscoped match would be ambiguous.
 */
async function pickExercise(page: Page, query: string, name: RegExp) {
  await page.getByLabel("Übung suchen", { exact: true }).fill(query);
  await page
    .getByRole("dialog")
    .locator(".plan-picker-item")
    .filter({ hasText: name })
    .first()
    .click();
}

/** Opens the editor on the active plan. */
async function openEditor(page: Page, url = PLAN_URL) {
  await page.goto(`${url}/preview`);
  await nav(page, "Trainingsplan").click();
  await expect(
    page.getByRole("heading", { name: "Dein Trainingsplan." }),
  ).toBeVisible();
}

/**
 * Opens a draft derived from the active plan.
 *
 * Tolerates an existing draft, because the editor deliberately continues an
 * open draft rather than stacking up new versions.
 */
async function openDraft(page: Page, url = PLAN_URL) {
  await openEditor(page, url);
  await expect(page.getByText("Dein aktiver Trainingsplan.")).toBeVisible();
  const resume = button(page, "Entwurf weiter bearbeiten");
  await (
    (await resume.count()) ? resume : button(page, "Plan bearbeiten")
  ).click();
  await expect(
    page.getByText(/Du bearbeitest einen Entwurf\.|Der Entwurf ist geprüft/),
  ).toBeVisible();
}

/**
 * Leaves the tracker without an open draft.
 *
 * Where the editor lands afterwards depends on the tracker: back on the active
 * plan, or on the empty state when there was never an active plan. Both are
 * fine; what matters is that no draft remains.
 */
async function discardDraft(page: Page) {
  const discard = button(page, "Entwurf verwerfen");
  if (await discard.count()) {
    await discard.click();
    await expect(discard).toHaveCount(0);
  }
}

test.describe.configure({ mode: "serial" });

test("shows the active plan read-only and explains what editing does", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await openEditor(page);

  // The active plan is visible with its sessions and targets.
  await expect(
    page.getByRole("heading", { name: "Push Pull Legs angepasst" }),
  ).toBeVisible();
  await expect(page.getByText("Aktiv", { exact: true }).first()).toBeVisible();
  for (const session of ["Push", "Pull", "Legs"])
    await expect(
      page.getByRole("region", { name: `Trainingseinheit ${session}` }),
    ).toBeVisible();
  await expect(page.getByText("Demo Bankdrücken").first()).toBeVisible();
  await expect(page.getByText("Ziel 75 kg").first()).toBeVisible();

  // The explanation the user needs before the first edit.
  await expect(
    page.getByText("Du bearbeitest eine neue Version deines Trainingsplans."),
  ).toBeVisible();
  await expect(
    page.getByText("Deine bisherigen Trainingsdaten bleiben erhalten."),
  ).toBeVisible();

  // An active plan offers no edit controls at all.
  await expect(button(page, "Push umbenennen")).toHaveCount(0);
  await expect(button(page, "Übung hinzufügen")).toHaveCount(0);
  await expect(button(page, "Bestätigen und aktivieren")).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("edits a draft: add, replace, reorder, retarget, rename, duplicate, remove", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await openDraft(page);
  const push = page.getByRole("region", { name: "Trainingseinheit Push" });

  // Add an exercise through the picker.
  await push.getByRole("button", { name: "Übung hinzufügen" }).click();
  await expect(
    page.getByRole("dialog", { name: "Übung hinzufügen" }),
  ).toBeVisible();
  await pickExercise(page, "Dips", /Demo Dips unterstützt/);
  await expect(
    page.getByText("Entwurf gespeichert und bestätigt."),
  ).toBeVisible();
  await expect(push.getByText("Demo Dips unterstützt")).toBeVisible();

  // Replace the barbell bench press with the dumbbell variant.
  await push
    .getByRole("button", { name: "Demo Bankdrücken austauschen" })
    .click();
  await pickExercise(page, "Kurzhantel-Bank", /Demo Kurzhantel-Bankdrücken/);
  await expect(
    page.getByText("Entwurf gespeichert und bestätigt."),
  ).toBeVisible();
  await expect(push.getByText("Demo Kurzhantel-Bankdrücken")).toBeVisible();
  await expect(push.getByText("Demo Bankdrücken", { exact: true })).toHaveCount(
    0,
  );

  // Reorder: move the lateral raise to the end.
  const names = () =>
    push.locator(".plan-exercise-text strong").allInnerTexts();
  const before = await names();
  await push
    .getByRole("button", { name: "Demo Seitheben nach unten verschieben" })
    .click();
  await expect(
    page.getByText("Entwurf gespeichert und bestätigt."),
  ).toBeVisible();
  const after = await names();
  expect(after).not.toEqual(before);
  expect(after.indexOf("Demo Seitheben")).toBeGreaterThan(
    before.indexOf("Demo Seitheben"),
  );

  // Retarget inline: three sets become four.
  await push
    .getByRole("button", { name: /^Zielwerte von Demo Seitheben bearbeiten$/ })
    .click();
  await push.getByLabel("Sätze", { exact: true }).fill("4");
  await push.getByRole("button", { name: "Zielwerte übernehmen" }).click();
  await expect(
    page.getByText("Entwurf gespeichert und bestätigt."),
  ).toBeVisible();
  await expect(push.getByText(/4 Sätze · 12–15 Wdh\./)).toBeVisible();

  // Rename the session.
  await push.getByRole("button", { name: "Push umbenennen" }).click();
  await page
    .getByLabel("Name der Trainingseinheit", { exact: true })
    .fill("Oberkörper A");
  await button(page, "Übernehmen").click();
  await expect(
    page.getByText("Entwurf gespeichert und bestätigt."),
  ).toBeVisible();
  await expect(
    page.getByRole("region", { name: "Trainingseinheit Oberkörper A" }),
  ).toBeVisible();

  // Duplicate and then remove the copy.
  await page
    .getByRole("region", { name: "Trainingseinheit Pull" })
    .getByRole("button", { name: "Pull duplizieren" })
    .click();
  await expect(
    page.getByText("Entwurf gespeichert und bestätigt."),
  ).toBeVisible();
  const copy = page.getByRole("region", {
    name: "Trainingseinheit Pull (Kopie)",
  });
  await expect(copy).toBeVisible();
  await copy
    .getByRole("button", { name: "Pull (Kopie) aus dem Entwurf entfernen" })
    .click();
  await expect(
    page.getByText("Entwurf gespeichert und bestätigt."),
  ).toBeVisible();
  await expect(
    page.getByRole("region", { name: "Trainingseinheit Pull (Kopie)" }),
  ).toHaveCount(0);
  // The original is untouched.
  await expect(
    page.getByRole("region", { name: "Trainingseinheit Pull" }),
  ).toBeVisible();
  expect(errors).toEqual([]);
  await discardDraft(page);
});

test("adds a training day and marks it unsaved until it has an exercise", async ({
  page,
}) => {
  await openDraft(page);
  await button(page, "Trainingstag hinzufügen").click();
  await page
    .getByLabel("Name der Trainingseinheit", { exact: true })
    .fill("Arme");
  await button(page, "Hinzufügen").click();

  const arme = page.getByRole("region", { name: "Trainingseinheit Arme" });
  await expect(arme).toBeVisible();
  // The schema cannot store an empty day, and the editor says so rather than
  // pretending the session was saved.
  await expect(arme.getByText("Noch nicht gespeichert")).toBeVisible();
  await expect(
    arme.getByText(/erst gespeichert, wenn sie mindestens eine Übung enthält/),
  ).toBeVisible();
  await expect(button(page, "Bestätigen und aktivieren")).toBeDisabled();

  // Giving it an exercise makes it real.
  await arme.getByRole("button", { name: "Übung hinzufügen" }).click();
  await pickExercise(page, "Bizeps", /Demo Bizepscurls/);
  await expect(
    page.getByText("Entwurf gespeichert und bestätigt."),
  ).toBeVisible();
  await expect(arme.getByText("Noch nicht gespeichert")).toHaveCount(0);
  await expect(arme.getByText("Demo Bizepscurls")).toBeVisible();
  await discardDraft(page);
});

test("reviews an invalid draft, fixes it, then confirms and activates", async ({
  page,
}) => {
  // Own tracker: this flow archives the previously active version.
  await openDraft(page, ACTIVATE_URL);
  const push = page.getByRole("region", { name: "Trainingseinheit Push" });

  // Make the plan invalid through the settings dialog: min above max.
  await push
    .getByRole("button", { name: "Weitere Einstellungen für Demo Bankdrücken" })
    .click();
  const dialog = page.getByRole("dialog", { name: "Demo Bankdrücken" });
  await dialog.getByLabel("Wiederholungen von", { exact: true }).fill("12");
  await dialog.getByLabel("Wiederholungen bis", { exact: true }).fill("8");
  await dialog.getByRole("button", { name: "Übernehmen" }).click();
  // The server refuses it outright and names the reason.
  await expect(
    page.getByText(/INVALID_REP_RANGE|Wiederholungsminimum/),
  ).toBeVisible();

  // Review shows the difference to the active plan.
  await button(page, "Änderungen prüfen").click();
  await expect(
    page.getByRole("region", { name: "Prüfergebnis" }),
  ).toBeVisible();
  await expect(page.getByText("Plan ist gültig")).toBeVisible();
  await expect(
    page.getByRole("region", { name: "Änderungsübersicht" }),
  ).toBeVisible();

  // Confirm and activate.
  await button(page, "Bestätigen und aktivieren").click();
  const confirm = page.getByRole("dialog", {
    name: "Trainingsplan aktivieren",
  });
  await expect(confirm).toBeVisible();
  await expect(confirm.getByText(/Revision \d+/)).toBeVisible();
  await expect(confirm.getByText(/archiviert und bleibt lesbar/)).toBeVisible();
  await confirm
    .getByRole("button", { name: "Bestätigen und aktivieren" })
    .click();

  await expect(
    page.getByText("Trainingsplan aktiviert und bestätigt."),
  ).toBeVisible();
  await expect(page.getByText("Trainingsplan ist aktiv.")).toBeVisible();
  // The newly active version is shown and the confirmation stays on screen;
  // editing it directly is not offered, only a new version.
  await expect(button(page, "Plan bearbeiten")).toBeVisible();
  await expect(page.getByText("Aktiv", { exact: true }).first()).toBeVisible();
  await expect(button(page, "Entwurf verwerfen")).toHaveCount(0);

  // The dashboard picks up the newly activated plan.
  await nav(page, "Übersicht").click();
  await expect(
    page.getByRole("heading", { name: "Dein Training. Dein Fortschritt." }),
  ).toBeVisible();
  await expect(
    page.getByText("Push Pull Legs angepasst").first(),
  ).toBeVisible();
});

test("navigation alone never activates a plan", async ({ page }) => {
  await openDraft(page);
  await button(page, "Änderungen prüfen").click();
  await expect(page.getByText("Plan ist gültig")).toBeVisible();

  // Opening the dialog and navigating away must not activate anything.
  await button(page, "Bestätigen und aktivieren").click();
  await expect(
    page.getByRole("dialog", { name: "Trainingsplan aktivieren" }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("dialog", { name: "Trainingsplan aktivieren" }),
  ).toHaveCount(0);
  await nav(page, "Übersicht").click();
  await nav(page, "Trainingsplan").click();

  // Nothing was activated: the editor is back on the unchanged active plan and
  // the draft is still waiting, offered explicitly rather than applied.
  await expect(page.getByText("Dein aktiver Trainingsplan.")).toBeVisible();
  await expect(page.getByText("Aktiv", { exact: true }).first()).toBeVisible();
  await expect(page.getByText(/offenen Entwurf|offene Entwürfe/)).toBeVisible();
  await expect(button(page, "Entwurf weiter bearbeiten")).toBeVisible();

  await button(page, "Entwurf weiter bearbeiten").click();
  await expect(
    page.getByText(/Du bearbeitest einen Entwurf\.|Der Entwurf ist geprüft/),
  ).toBeVisible();
  await discardDraft(page);
});

test("shows the version history and reuses an archived version", async ({
  page,
}) => {
  await openEditor(page);
  await button(page, "Frühere Versionen").click();
  const history = page.getByRole("region", { name: "Planhistorie" });
  await expect(history).toBeVisible();
  await expect(history.getByText("Version 1")).toBeVisible();
  await expect(history.getByText("Version 2")).toBeVisible();
  // Discarded drafts are archived too, so there may be several of these.
  await expect(history.getByText("Archiviert").first()).toBeVisible();
  await expect(
    history.getByText("Aktiv", { exact: true }).first(),
  ).toBeVisible();

  // Reusing the archived version produces a new editable draft.
  await history
    .locator("li", { hasText: "Version 1" })
    .getByRole("button", { name: "Wieder verwenden" })
    .click();
  await expect(
    page.getByText("Entwurf gespeichert und bestätigt."),
  ).toBeVisible();
  // Version 1 had two Push exercises; the draft reproduces that structure.
  const push = page.getByRole("region", { name: "Trainingseinheit Push" });
  await expect(push.getByText("2 Übungen")).toBeVisible();
  await discardDraft(page);
});

test("creates a first plan on an empty tracker", async ({ page }) => {
  await openEditor(page, EMPTY_URL);
  await expect(
    page.getByText("Noch kein Trainingsplan", { exact: true }),
  ).toBeVisible();
  await button(page, "Trainingsplan anlegen").click();

  const dialog = page.getByRole("dialog", {
    name: "Neuen Trainingsplan anlegen",
  });
  await dialog
    .getByLabel("Name des Trainingsplans", { exact: true })
    .fill("Ganzkörper");
  await dialog
    .getByLabel("Erste Trainingseinheit", { exact: true })
    .fill("Ganzkörper A");
  await dialog
    .getByRole("button", { name: "Weiter: erste Übung wählen" })
    .click();

  await pickExercise(page, "Kniebeugen", /Demo Kniebeugen/);
  await expect(
    page.getByText("Entwurf gespeichert und bestätigt."),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Ganzkörper", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("region", { name: "Trainingseinheit Ganzkörper A" }),
  ).toBeVisible();
  // A new plan is a draft; it is never activated as a side effect.
  await expect(
    page.getByText("Entwurf", { exact: true }).first(),
  ).toBeVisible();
  await expect(button(page, "Bestätigen und aktivieren")).toBeEnabled();
  await discardDraft(page);
});

test("is operable by keyboard", async ({ page }) => {
  await openDraft(page);
  const push = page.getByRole("region", { name: "Trainingseinheit Push" });

  // Reach the rename control by keyboard and operate it with Enter.
  await push.getByRole("button", { name: "Push umbenennen" }).focus();
  await expect(
    push.getByRole("button", { name: "Push umbenennen" }),
  ).toBeFocused();
  await page.keyboard.press("Enter");
  const field = page.getByLabel("Name der Trainingseinheit", { exact: true });
  await expect(field).toBeVisible();
  await field.fill("Oberkörper");
  await page.keyboard.press("Enter");
  await expect(
    page.getByText("Entwurf gespeichert und bestätigt."),
  ).toBeVisible();
  await expect(
    page.getByRole("region", { name: "Trainingseinheit Oberkörper" }),
  ).toBeVisible();

  // A dialog takes focus and Escape closes it without saving.
  await page
    .getByRole("region", { name: "Trainingseinheit Oberkörper" })
    .getByRole("button", { name: "Übung hinzufügen" })
    .click();
  await expect(page.getByLabel("Übung suchen", { exact: true })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("dialog", { name: "Übung hinzufügen" }),
  ).toHaveCount(0);
  await discardDraft(page);
});

test("works on a narrow mobile viewport", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openDraft(page);
  const push = page.getByRole("region", { name: "Trainingseinheit Push" });
  await expect(push).toBeVisible();
  await expect(push.getByText("Demo Bankdrücken")).toBeVisible();

  // The page must not scroll sideways.
  const overflow = await page.evaluate(
    () =>
      document.documentElement.scrollWidth -
      document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(1);

  // Controls stay operable at this width.
  await push.getByRole("button", { name: "Übung hinzufügen" }).click();
  await expect(
    page.getByRole("dialog", { name: "Übung hinzufügen" }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await discardDraft(page);
});

test("renders in the dark theme", async ({ page }) => {
  await openDraft(page);
  await page.getByRole("button", { name: "Farbschema wechseln" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  const card = page.getByRole("region", { name: "Trainingseinheit Push" });
  await expect(card).toBeVisible();
  // The card paints its own background rather than inheriting the page's.
  const background = await card.evaluate(
    (node) => getComputedStyle(node).backgroundColor,
  );
  expect(background).not.toBe("rgba(0, 0, 0, 0)");
  await discardDraft(page);
});

test("surfaces a revision conflict instead of overwriting", async ({
  page,
  context,
}) => {
  // Own tracker: two tabs deliberately race on the same draft.
  await openDraft(page, CONFLICT_URL);

  const other = await context.newPage();
  await openEditor(other, CONFLICT_URL);
  await other
    .getByRole("button", { name: "Entwurf weiter bearbeiten" })
    .click();
  await expect(
    other.getByText(/Du bearbeitest einen Entwurf\.|Der Entwurf ist geprüft/),
  ).toBeVisible();
  const otherPush = other.getByRole("region", {
    name: "Trainingseinheit Push",
  });
  await otherPush
    .getByRole("button", { name: "Demo Seitheben aus dem Entwurf entfernen" })
    .click();
  await expect(
    other.getByText("Entwurf gespeichert und bestätigt."),
  ).toBeVisible();

  // The first tab still holds the old revision; its write must be refused.
  const push = page.getByRole("region", { name: "Trainingseinheit Push" });
  await push
    .getByRole("button", { name: "Demo Bankdrücken aus dem Entwurf entfernen" })
    .click();
  await expect(page.getByText(/REVISION_CONFLICT/)).toBeVisible();
  await expect(
    page.getByText("Es gibt einen offenen oder konkurrierenden Vorgang."),
  ).toBeVisible();

  // The other tab's change survived; it was not overwritten.
  await expect(push.getByText("Demo Seitheben")).toHaveCount(0);
  await expect(push.getByText("Demo Bankdrücken")).toBeVisible();
  await other.close();
});

test("discards a draft without touching the active plan", async ({ page }) => {
  await openDraft(page);
  await button(page, "Entwurf verwerfen").click();
  // Back on the active plan, unchanged.
  await expect(page.getByText("Dein aktiver Trainingsplan.")).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Push Pull Legs angepasst" }),
  ).toBeVisible();
  await expect(page.getByText("Aktiv", { exact: true }).first()).toBeVisible();
  await expect(button(page, "Plan bearbeiten")).toBeVisible();
});

test("passes automated WCAG A/AA checks while viewing, editing and confirming", async ({
  page,
}) => {
  const audit = async (label: string) => {
    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa"])
      .analyze();
    expect(
      results.violations.map((v) => `${label}: ${v.id} (${v.nodes.length})`),
    ).toEqual([]);
  };

  await openEditor(page);
  await audit("aktiver Plan");

  await openDraft(page);
  await audit("Entwurf");

  // The validation panel and the change summary.
  await button(page, "Änderungen prüfen").click();
  await expect(
    page.getByRole("region", { name: "Prüfergebnis" }),
  ).toBeVisible();
  await audit("Prüfergebnis");

  // A modal dialog on screen.
  await page
    .getByRole("region", { name: "Trainingseinheit Push" })
    .getByRole("button", { name: "Übung hinzufügen" })
    .click();
  await expect(
    page.getByRole("dialog", { name: "Übung hinzufügen" }),
  ).toBeVisible();
  await audit("Übungsauswahl");
  await page.keyboard.press("Escape");

  // The confirmation dialog.
  await button(page, "Bestätigen und aktivieren").click();
  await expect(
    page.getByRole("dialog", { name: "Trainingsplan aktivieren" }),
  ).toBeVisible();
  await audit("Aktivierungsdialog");
  await page.keyboard.press("Escape");

  // The history section.
  await button(page, "Frühere Versionen").click();
  await expect(
    page.getByRole("region", { name: "Planhistorie" }),
  ).toBeVisible();
  await audit("Planhistorie");

  await discardDraft(page);
});
