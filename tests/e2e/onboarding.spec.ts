import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import {
  openWizard,
  fillProfile,
  wizard,
  storedClaim,
  callTool,
  submitProposal,
} from "./helpers";

test("question cards reach a revision-bound plan confirmation and an honest Google handoff", async ({
  page,
}) => {
  await openWizard(page);
  await fillProfile(page);
  await wizard(page)
    .getByRole("button", { name: "Plan erstellen", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Jetzt entsteht dein Plan" }),
  ).toBeVisible();
  const claim = await submitProposal(page);
  await expect(
    page.getByRole("heading", { name: "Dein Planvorschlag" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Plan bestätigen", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Diesen Plan bestätigen?" }),
  ).toBeVisible();
  expect(
    (await callTool(page, "get_onboarding_state", claim)).handoff.status,
  ).toBe("not_ready");
  await page
    .getByRole("button", { name: "Plan bestätigen", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Dein Trainingsplan ist bereit" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Google-Konto verbinden" }),
  ).toBeDisabled();
  await expect(wizard(page)).not.toContainText("Google ist verbunden");
  expect(
    (await callTool(page, "get_onboarding_handoff", claim)).handoff.status,
  ).toBe("ready_for_google_connection");
});

test("optional personal questions keep decimal input exact and can be skipped individually", async ({
  page,
}) => {
  await openWizard(page);
  await page
    .getByRole("button", { name: "Plan mit Arnold erstellen", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Persönliche Angaben ergänzen" })
    .click();
  await page.getByLabel("Alter", { exact: true }).fill("34");
  await page.getByRole("button", { name: "Weiter", exact: true }).click();
  await page.getByRole("button", { name: "Überspringen", exact: true }).click();
  await page.getByLabel("Größe", { exact: true }).fill("181");
  await page.getByRole("button", { name: "Weiter", exact: true }).click();
  await page.getByLabel("Gewicht", { exact: true }).fill("82,5");
  await page.getByRole("button", { name: "Weiter", exact: true }).click();
  await page.getByRole("checkbox", { name: "Knie", exact: true }).check();
  await page.getByRole("button", { name: "Weiter", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Was ist dein Ziel?" }),
  ).toBeVisible();
  await expect(wizard(page)).toHaveAttribute("data-profile-save", "saved");
  const state = await callTool(
    page,
    "get_onboarding_state",
    await storedClaim(page),
  );
  expect(state.session.profile.person).toEqual({
    age_years: 34,
    height_cm: 181,
    body_weight_kg: 82.5,
    protect_areas: ["knee"],
  });
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Was ist dein Ziel?" }),
  ).toBeVisible();
});

test("resumes at the next unanswered question and adopts answers from chat", async ({
  page,
}) => {
  await openWizard(page);
  const claim = await storedClaim(page);
  await callTool(page, "update_onboarding_profile", {
    ...claim,
    request_id: crypto.randomUUID(),
    profile: {
      path: "arnold_plan",
      training: {
        primary_goal: "strength",
        experience: "beginner",
        days_per_week: 4,
      },
    },
  });
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Wie viel Zeit hast du pro Training?" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "45 Min.", exact: true }).click();
  await page.getByRole("button", { name: "Weiter", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Wo trainierst du?" }),
  ).toBeVisible();
  await expect(wizard(page)).toHaveAttribute("data-profile-save", "saved");
  await callTool(page, "update_onboarding_profile", {
    ...claim,
    request_id: crypto.randomUUID(),
    profile: { training: { environment: "home" } },
  });
  await page
    .getByRole("button", { name: "Aktualisieren", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Passt das so für deinen Plan?" }),
  ).toBeVisible();
  await expect(wizard(page)).toContainText("Zuhause");
});

test("any stored answer can be corrected without repeating the questionnaire", async ({
  page,
}) => {
  await openWizard(page);
  await fillProfile(page);
  await page.getByRole("button", { name: "Angaben ändern" }).click();
  await page
    .getByRole("button", { name: "Trainingstage", exact: true })
    .click();
  await page.getByRole("button", { name: "4", exact: true }).click();
  await page.getByRole("button", { name: "Weiter", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Passt das so für deinen Plan?" }),
  ).toBeVisible();
  await expect(wizard(page)).toHaveAttribute("data-profile-save", "saved");
  expect(
    (await callTool(page, "get_onboarding_state", await storedClaim(page)))
      .session.profile.training.days_per_week,
  ).toBe(4);
});

test("own-plan entry hands off to chat and reaches the same confirmation", async ({
  page,
}) => {
  await openWizard(page);
  await page.getByRole("button", { name: "Eigenen Plan übernehmen" }).click();
  await expect(
    page.getByRole("heading", { name: "Deinen Plan übernehmen" }),
  ).toBeVisible();
  await expect(wizard(page)).toContainText("Foto");
  await submitProposal(page, "existing_routine");
  await page.getByRole("button", { name: "Nach dem Plan suchen" }).click();
  await expect(
    page.getByRole("heading", { name: "Dein Planvorschlag" }),
  ).toBeVisible();
});

test("plan edits invalidate an earlier revision before confirmation", async ({
  page,
}) => {
  await openWizard(page);
  await fillProfile(page);
  await page
    .getByRole("button", { name: "Plan erstellen", exact: true })
    .click();
  const claim = await submitProposal(page);
  const before = (await callTool(page, "get_onboarding_state", claim)).plan;
  await page
    .getByRole("button", { name: "Plan ansehen und bearbeiten" })
    .click();
  await page
    .getByRole("button", { name: /austauschen$/ })
    .first()
    .click();
  const picker = page.getByRole("dialog");
  await picker.getByLabel("Übung suchen", { exact: true }).fill("Beinpresse");
  await picker.locator(".plan-picker-item").first().click();
  await expect(page.locator(".plan-editor")).toContainText("Demo Beinpresse");
  await page.getByRole("button", { name: "Zum Planvorschlag" }).click();
  const refused = await callTool(page, "confirm_onboarding_plan", {
    ...claim,
    request_id: crypto.randomUUID(),
    confirmation: {
      plan_version_id: before.plan_version_id,
      row_revision: before.row_revision,
      confirmed: true,
    },
  });
  expect(refused.error.code).toBe("STALE_CONFIRMATION");
  await page
    .getByRole("button", { name: "Plan bestätigen", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Plan bestätigen", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Dein Trainingsplan ist bereit" }),
  ).toBeVisible();
  expect(
    (await callTool(page, "get_onboarding_state", claim)).handoff
      .confirmed_plan_revision,
  ).toBeGreaterThan(before.row_revision);
});

test("an unconfirmed profile write survives reload and retries the same request", async ({
  page,
}) => {
  await openWizard(page);
  await page
    .getByRole("button", { name: "Plan mit Arnold erstellen", exact: true })
    .click();
  await page.getByRole("button", { name: "Überspringen", exact: true }).click();
  const ids: string[] = [];
  let lose = true;
  await page.route("**/mcp", async (route) => {
    const payload = route.request().postDataJSON();
    if (payload?.params?.name === "update_onboarding_profile") {
      ids.push(payload.params.arguments.request_id);
      if (lose) {
        lose = false;
        await route.fetch();
        await route.abort("failed");
        return;
      }
    }
    await route.continue();
  });
  await page
    .getByRole("button", { name: "Muskeln aufbauen", exact: true })
    .click();
  await page.getByRole("button", { name: "Weiter", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText(
    "Deine Eingaben bleiben erhalten",
  );
  await page.reload();
  await page
    .getByRole("button", { name: "Erneut prüfen", exact: true })
    .click();
  expect(new Set(ids).size).toBe(1);
  await expect(
    page.getByRole("heading", { name: "Wie lange trainierst du schon?" }),
  ).toBeVisible();
});

test("cancellation is explicit and offers a controlled restart", async ({
  page,
}) => {
  await openWizard(page);
  await page
    .getByRole("button", { name: "Einrichtung abbrechen", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Einrichtung abbrechen?" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Ja, abbrechen", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Einrichtung abgebrochen" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Neue Einrichtung starten" }).click();
  await expect(
    page.getByRole("heading", { name: "Willkommen bei Arnold" }),
  ).toBeVisible();
});

test("expiry and a missing session secret never reveal another setup", async ({
  page,
}) => {
  await openWizard(page, "http://127.0.0.1:8802");
  await page
    .getByRole("button", { name: "Plan mit Arnold erstellen", exact: true })
    .click();
  await page.waitForTimeout(2000);
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Deine Einrichtung ist abgelaufen" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Neue Einrichtung starten" }).click();
  await expect(
    page.getByRole("heading", { name: "Willkommen bei Arnold" }),
  ).toBeVisible();
  await page.evaluate(() =>
    sessionStorage.setItem(
      "arnold.onboarding.claim",
      JSON.stringify({ onboarding_session_id: "missing-secret" }),
    ),
  );
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Willkommen bei Arnold" }),
  ).toBeVisible();
});

test("question cards are operable by keyboard and pass accessibility checks", async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await openWizard(page);
  await page
    .getByRole("button", { name: "Plan mit Arnold erstellen", exact: true })
    .focus();
  await page.keyboard.press("Enter");
  await page.getByRole("button", { name: "Überspringen", exact: true }).click();
  await page
    .getByRole("button", { name: "Stärker werden", exact: true })
    .focus();
  await page.keyboard.press("Space");
  await expect(
    page.getByRole("button", { name: "Stärker werden", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa"])
    .analyze();
  expect(results.violations).toEqual([]);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
