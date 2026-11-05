import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import {
  openWizard,
  fillProfile,
  wizard,
  storedClaim,
  callTool,
  submitProposal,
  choose,
  next,
  setRhythm,
  setupMenu,
  stepTo,
} from "./helpers";

test("question cards reach a revision-bound plan confirmation that finishes the setup", async ({
  page,
}) => {
  await openWizard(page);
  await fillProfile(page);
  await wizard(page)
    .getByRole("button", { name: "Plan erstellen", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Arnold baut deinen Plan" }),
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
  const confirmed = (await callTool(page, "get_onboarding_state", claim)).plan;
  await page
    .getByRole("button", { name: "Plan bestätigen", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Bereit für dein erstes Training" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Erstes Training starten" }),
  ).toBeEnabled();
  await expect(wizard(page)).not.toContainText("Google");
  const state = await callTool(page, "get_onboarding_state", claim);
  expect(state.session.status).toBe("COMPLETED");
  expect(state.handoff.status).toBe("completed");
  expect(state.handoff.confirmed_plan_version_id).toBe(
    confirmed.plan_version_id,
  );
  expect(state.handoff.confirmed_plan_revision).toBe(confirmed.row_revision);
});

test("optional personal questions keep decimal input exact and can be skipped individually", async ({
  page,
}) => {
  await openWizard(page);
  await page
    .getByRole("button", { name: "Plan mit Arnold erstellen", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Ein paar Angaben über dich?" }),
  ).toBeVisible();
  await page.getByLabel("Alter", { exact: true }).fill("34");
  // Height left empty: skipped on its own.
  await page.getByLabel("Gewicht", { exact: true }).fill("82,5");
  await page.getByRole("button", { name: /^Bereiche schonen/ }).click();
  await page.getByRole("button", { name: "Knie", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Knie", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await next(page);
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
    body_weight_kg: 82.5,
    protect_areas: ["knee"],
  });
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Was ist dein Ziel?" }),
  ).toBeVisible();
});

test("several goals are stored with the first as the main goal", async ({
  page,
}) => {
  await openWizard(page);
  await page
    .getByRole("button", { name: "Plan mit Arnold erstellen", exact: true })
    .click();
  await page.getByRole("button", { name: "Überspringen", exact: true }).click();
  await choose(page, "Stärker werden");
  await choose(page, "Abnehmen und straffen");
  await next(page);
  await expect(
    page.getByRole("heading", { name: "Wie lange trainierst du schon?" }),
  ).toBeVisible();
  await expect(wizard(page)).toHaveAttribute("data-profile-save", "saved");
  const training = (
    await callTool(page, "get_onboarding_state", await storedClaim(page))
  ).session.profile.training;
  expect(training.primary_goal).toBe("strength");
  expect(training.secondary_goals).toEqual(["fat_loss"]);
});

test("fixed weekdays must match the number of training days", async ({
  page,
}) => {
  await openWizard(page);
  await fillProfile(page);
  await page.getByRole("button", { name: "Wünsche ändern" }).click();
  // The first wish, fixed weekdays, opens on its own.
  await expect(
    page.getByRole("button", { name: /^Feste Trainingstage/ }),
  ).toHaveAttribute("aria-expanded", "true");
  await page.getByRole("button", { name: "Mo", exact: true }).click();
  await next(page);
  await expect(page.getByRole("alert")).toContainText("genau 3 Tage");
  await page.getByRole("button", { name: "Mi", exact: true }).click();
  await page.getByRole("button", { name: "Fr", exact: true }).click();
  await page.getByRole("button", { name: /^Sonst noch etwas/ }).click();
  await page
    .getByLabel("Sonst noch etwas für deinen Plan")
    .fill("Ich will Klimmzüge lernen.");
  await next(page);
  await expect(
    page.getByRole("heading", { name: "So wird dein Plan" }),
  ).toBeVisible();
  await expect(wizard(page)).toHaveAttribute("data-profile-save", "saved");
  const training = (
    await callTool(page, "get_onboarding_state", await storedClaim(page))
  ).session.profile.training;
  expect(training.training_days).toEqual(["mon", "wed", "fri"]);
  expect(training.days_per_week).toBe(3);
  expect(training.notes).toBe("Ich will Klimmzüge lernen.");
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
    page.getByRole("heading", { name: "Wie oft und wie lange?" }),
  ).toBeVisible();
  // The stored 4 days stay; minutes start at 60 and go down in steps of 15.
  await expect(
    wizard(page)
      .getByRole("group", { name: "Tage pro Woche", exact: true })
      .locator("output"),
  ).toHaveText("4");
  await stepTo(page, "Minuten pro Training", 45);
  await next(page);
  await expect(
    page.getByRole("heading", { name: "Wo trainierst du?" }),
  ).toBeVisible();
  await expect(wizard(page)).toHaveAttribute("data-profile-save", "saved");
  await callTool(page, "update_onboarding_profile", {
    ...claim,
    request_id: crypto.randomUUID(),
    profile: { training: { environment: "home" } },
  });
  await setupMenu(page, "Stand neu laden");
  await expect(
    page.getByRole("heading", { name: "So wird dein Plan" }),
  ).toBeVisible();
  await expect(wizard(page)).toContainText("Zuhause");
});

test("any stored answer can be corrected without repeating the questionnaire", async ({
  page,
}) => {
  await openWizard(page);
  await fillProfile(page);
  await page
    .getByRole("button", { name: "Wie oft und wie lange ändern" })
    .click();
  await setRhythm(page, 4, 60);
  await next(page);
  await expect(
    page.getByRole("heading", { name: "So wird dein Plan" }),
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
}, testInfo) => {
  // Its own tracker per browser: this test activates its plan at the end.
  await openWizard(
    page,
    testInfo.project.name === "webkit"
      ? "http://127.0.0.1:8803"
      : "http://127.0.0.1:8801",
  );
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
    page.getByRole("heading", { name: "Bereit für dein erstes Training" }),
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
  await choose(page, "Muskeln aufbauen");
  await next(page);
  await expect(page.getByRole("alert")).toContainText(
    "Deine Eingaben bleiben erhalten",
  );
  await page.reload();
  await page
    .getByRole("button", { name: "Erneut versuchen", exact: true })
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
    .getByRole("button", { name: "Plan mit Arnold erstellen", exact: true })
    .click();
  await setupMenu(page, "Einrichtung abbrechen");
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
  const goal = page.getByRole("checkbox", { name: /^Stärker werden/ });
  await goal.focus();
  await page.keyboard.press("Space");
  await expect(goal).toBeChecked();
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

test("the plan proposal starts with Arnold's weights, a switch and the user's own", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await openWizard(page, "http://127.0.0.1:8806");
  await fillProfile(page, { bench: "80" });
  const main = wizard(page);
  await expect(main).toContainText("Bankdrücken 80 kg");
  await main
    .getByRole("button", { name: "Plan erstellen", exact: true })
    .click();
  // The chat leaves every weight empty; Arnold fills them when the draft is stored.
  const claim = await storedClaim(page);
  const submitted = await callTool(page, "submit_onboarding_plan_proposal", {
    ...claim,
    request_id: crypto.randomUUID(),
    name: "Ganzkörper",
    origin: "ai_proposal",
    sessions: ["A", "B", "C"].map((session_name) => ({
      session_name,
      exercises: [
        { exercise_id: "bench-press", target_sets: 3, rep_min: 8, rep_max: 10 },
        {
          exercise_id: "lat-pulldown",
          target_sets: 3,
          rep_min: 8,
          rep_max: 10,
        },
        { exercise_id: "pull-up", target_sets: 3, rep_min: 6, rep_max: 8 },
      ],
    })),
  });
  expect(submitted.ok).toBe(true);
  await main.getByRole("button", { name: "Nach dem Vorschlag suchen" }).click();
  await expect(
    page.getByRole("heading", { name: "Dein Planvorschlag" }),
  ).toBeVisible();

  const row = (name: string) =>
    main.locator(".ac-day-row").filter({ hasText: name }).first();
  const passt = main.getByRole("button", { name: "Passt", exact: true });
  await expect(passt).toHaveAttribute("aria-pressed", "true");
  await expect(row("Bankdrücken")).toContainText(/≈ \d/);
  await expect(row("Klimmzüge")).toContainText("Körpergewicht");
  const weight = async (name: string) =>
    Number(
      ((await row(name).locator("strong").textContent()) ?? "")
        .replace(/[^\d,]/g, "")
        .replace(",", "."),
    );
  const before = await weight("Latzug");

  // The switch moves every estimate at once.
  await main.getByRole("button", { name: "Leichter", exact: true }).click();
  await expect(
    main.getByRole("button", { name: "Leichter", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  expect(await weight("Latzug")).toBeLessThan(before);

  // A weight set by hand is the user's and stays when the switch moves.
  await row("Bankdrücken").locator(".ac-day-head").click();
  await row("Bankdrücken")
    .getByRole("textbox", { name: /^Gewicht/ })
    .fill("77,5");
  await row("Bankdrücken")
    .getByRole("button", { name: "Fertig", exact: true })
    .click();
  await expect(row("Bankdrücken")).toContainText("Von dir angepasst");
  await expect(row("Bankdrücken")).toContainText("77,5 kg");
  await main.getByRole("button", { name: "Schwerer", exact: true }).click();
  await expect(
    main.getByRole("button", { name: "Schwerer", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(row("Bankdrücken")).toContainText("77,5 kg");
  expect(await weight("Latzug")).toBeGreaterThan(before);

  // What the card shows is what the plan holds.
  const state = await callTool(page, "get_onboarding_state", claim);
  const bench = state.plan.sessions[0].exercises.find(
    (e: { exercise_id: string }) => e.exercise_id === "bench-press",
  );
  expect(bench.target_load_kg).toBe(77.5);
  const accessibility = await new AxeBuilder({ page })
    .include('main[data-card="onboarding"]')
    .analyze();
  expect(accessibility.violations).toEqual([]);
  expect(errors).toEqual([]);
});
