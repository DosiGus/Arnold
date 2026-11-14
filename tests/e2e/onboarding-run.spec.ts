import { test, expect, type Page, type Route } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import {
  openWizard,
  fillProfile,
  wizard,
  callTool,
  choose,
  next,
  setRhythm,
  storedClaim,
  submitProposal,
} from "./helpers";

/**
 * RUN-026: the setup with the goal "Ausdauer und Laufen" and the button
 * "Ich will auch laufen". Everything on screen comes from the fixture servers
 * or from invented answers; no real data.
 */
const SHOTS = resolve("test-results/screens");
mkdirSync(SHOTS, { recursive: true });
const ACCOUNT_BASE = "http://127.0.0.1:8792";

/** Walks the setup to the run page with the goal "Ausdauer und Laufen". */
async function toRunPage(page: Page) {
  const main = wizard(page);
  await openWizard(page);
  await main
    .getByRole("button", { name: /^Plan mit Arnold erstellen/ })
    .click();
  await main.getByRole("button", { name: "Überspringen", exact: true }).click();
  await choose(page, "Ausdauer und Laufen");
  await next(page);
  await choose(page, "Fortgeschritten");
  await next(page);
  await setRhythm(page, 3, 60);
  await next(page);
  await choose(page, "Fitnessstudio");
  await next(page);
  await main.getByRole("button", { name: "Überspringen", exact: true }).click();
  await main.getByRole("button", { name: "Überspringen", exact: true }).click();
  await expect(
    main.getByRole("heading", { name: "Deine Laufangaben" }),
  ).toBeVisible();
}

const runGroup = (page: Page, name: string) =>
  wizard(page).getByRole("group", { name, exact: true });

test("setup with the goal Ausdauer und Laufen reaches the confirmed plan", async ({
  page,
}) => {
  await toRunPage(page);
  const main = wizard(page);
  // Required answers first: "Weiter" stays closed until they are there.
  await expect(
    main.getByRole("button", { name: "Weiter", exact: true }),
  ).toBeDisabled();
  await runGroup(page, "Dein Laufziel")
    .getByRole("button", { name: "10 km", exact: true })
    .click();
  await main.getByRole("textbox", { name: "Laufminuten pro Woche" }).fill("90");
  await expect(
    main.getByRole("button", { name: "Weiter", exact: true }),
  ).toBeDisabled();
  await main
    .getByRole("textbox", { name: "Längster Lauf, letzte 4 Wochen" })
    .fill("40");
  await main.getByLabel("Wunschzeit (optional, Std:Min:Sek)").fill("0:50:00");
  await main.getByLabel("Zeit (Std:Min:Sek)").fill("25:30");
  // A half-filled reference is refused in plain words.
  await expect(main).toContainText("Strecke, Zeit und Datum");
  await runGroup(page, "Strecke der Referenzzeit")
    .getByRole("button", { name: "5 km", exact: true })
    .click();
  await main.getByLabel("Wann war das?").fill("2026-10-01");
  await expect(main).not.toContainText("Strecke, Zeit und Datum");
  await next(page);
  await expect(
    main.getByRole("heading", { name: "So wird dein Plan" }),
  ).toBeVisible();
  await expect(main).toHaveAttribute("data-profile-save", "saved");
  await expect(main).toContainText("Laufen");
  await expect(main).toContainText("10 km · 3 Läufe pro Woche · 90 Min.");
  const claim = await storedClaim(page);
  const state = await callTool(page, "get_onboarding_state", claim);
  expect(state.session.profile.training.primary_goal).toBe("endurance_running");
  expect(state.session.profile.training.run).toMatchObject({
    goal: "10k",
    base_minutes_per_week: 90,
    longest_run_4w_min: 40,
    target_time_s: 3000,
    reference: { distance_m: 5000, time_s: 1530, source: "user" },
  });
  expect(state.run_setup).toEqual({ required: true, ready: true });

  await main
    .getByRole("button", { name: "Plan erstellen", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Arnold baut deinen Plan" }),
  ).toBeVisible();
  await submitProposal(page);
  await page
    .getByRole("button", { name: "Plan bestätigen", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Diesen Plan bestätigen?" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Plan bestätigen", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Bereit für dein erstes Training" }),
  ).toBeVisible();
  const done = await callTool(page, "get_onboarding_state", claim);
  expect(done.session.status).toBe("COMPLETED");
});

test("the plan cannot be asked for without the run answers, a reload keeps them", async ({
  page,
}) => {
  await toRunPage(page);
  const main = wizard(page);
  // Leave the run page unanswered by going back and forward via the review.
  await main.locator("button.ac-btn.secondary", { hasText: "Zurück" }).click();
  await expect(
    main.getByRole("heading", { name: "Deine Wünsche für den Plan" }),
  ).toBeVisible();
  await expect(main).toHaveAttribute("data-profile-save", "saved");
  const claim = await storedClaim(page);
  const state = await callTool(page, "get_onboarding_state", claim);
  expect(state.run_setup).toEqual({ required: true, ready: false });
  expect(state.progress.can_request_plan).toBe(false);
  const refused = await callTool(page, "request_onboarding_plan", {
    ...claim,
    request_id: crypto.randomUUID(),
  });
  expect(JSON.stringify(refused)).toContain("PROFILE_INCOMPLETE");
  // After a reload the setup resumes on the run page, not past it.
  await page.reload();
  await expect(
    wizard(page).getByRole("heading", { name: "Deine Laufangaben" }),
  ).toBeVisible();
});

test("without a running goal the setup is unchanged", async ({ page }) => {
  await openWizard(page);
  await fillProfile(page);
  const main = wizard(page);
  await expect(
    main.getByRole("heading", { name: "So wird dein Plan" }),
  ).toBeVisible();
  await expect(
    main.locator(".ac-review-text small", { hasText: /^Laufen$/ }),
  ).toHaveCount(0);
  const state = await callTool(
    page,
    "get_onboarding_state",
    await storedClaim(page),
  );
  expect(state.run_setup).toEqual({ required: false, ready: true });
  expect(state.session.profile.training.run).toBeUndefined();
  await expect(
    main.getByRole("button", { name: "Plan erstellen", exact: true }),
  ).toBeEnabled();
});

for (const width of [375, 1024])
  for (const theme of ["light", "dark"] as const)
    test(`run page at ${width} px in ${theme} mode is readable and accessible`, async ({
      page,
      browserName,
    }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ colorScheme: theme });
      await toRunPage(page);
      await page.evaluate(
        (theme) => (document.documentElement.dataset.theme = theme),
        theme,
      );
      const overflow = await page.evaluate(
        () =>
          document.documentElement.scrollWidth -
          document.documentElement.clientWidth,
      );
      expect(overflow).toBeLessThanOrEqual(0);
      await page.screenshot({
        path: `${SHOTS}/${browserName}-setup-run-${width}-${theme}.png`,
        fullPage: true,
        animations: "disabled",
      });
      const a11y = await new AxeBuilder({ page }).analyze();
      expect(
        a11y.violations.filter((v) =>
          ["critical", "serious"].includes(v.impact ?? ""),
        ),
      ).toEqual([]);
    });

/* ------------------------------------------------- "Ich will auch laufen" */

const CONFIRM = {
  stage: "confirm",
  summary: { stored_items: ["Dein Arnold-Konto", "Deine Trainingspläne"] },
  confirmation_token: "synthetic-card-confirmation-token-only",
  expires_at: new Date(Date.now() + 300000).toISOString(),
};
const reply = (route: Route, value: unknown, meta?: object) =>
  route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: route.request().postDataJSON().id,
      result: {
        content: [],
        structuredContent: value,
        ...(meta ? { _meta: meta } : {}),
      },
    }),
  });
const profile = {
  run_profile_id: "rp-1",
  row_revision: 1,
  goal: "10k",
  race_date: null,
  target_time_s: null,
  reference: null,
  running_experience_months: null,
  runs_per_week: 3,
  long_run_weekday: null,
  preferred_environment: "outdoor",
  base_minutes_per_week: 90,
  longest_run_4w_min: 40,
  alarm_settings: null,
};
const derived = {
  experience: "beginner",
  reference_valid: false,
  reference_reason: "reference_missing",
  reference_valid_until: null,
  vdot: null,
  pace_zones: null,
};

async function mockAccount(page: Page, hasProfile: boolean) {
  const opened: Record<string, unknown>[] = [];
  const reads = { count: 0 };
  await page.route("**/mcp", async (route) => {
    const body = route.request().postDataJSON();
    if (body?.method !== "tools/call") return route.continue();
    const tool = body.params.name as string;
    if (tool === "delete_arnold_account") {
      const { confirmation_token: _, ...publicValue } = CONFIRM;
      return reply(route, publicValue, { arnold: { delete_account: CONFIRM } });
    }
    if (tool === "get_run_profile") {
      reads.count += 1;
      return reply(route, {
        profile: hasProfile ? profile : null,
        derived,
        missing: hasProfile ? [] : ["run_profile"],
      });
    }
    if (tool === "show_arnold_run") {
      opened.push(body.params.arguments);
      return reply(route, {
        run_card_contract: "arnold.run_card/1",
        card: "run_setup",
        workout_id: null,
      });
    }
    return route.continue();
  });
  return { opened, reads };
}

for (const theme of ["light", "dark"] as const)
  test(`"Ich will auch laufen" opens the run setup, ${theme}, 375 px`, async ({
    page,
    browserName,
  }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.emulateMedia({ colorScheme: theme });
    const { opened } = await mockAccount(page, false);
    await page.goto(`${ACCOUNT_BASE}/preview?account=delete`);
    const button = page.getByRole("button", {
      name: "Ich will auch laufen",
      exact: true,
    });
    await expect(button).toBeVisible();
    await page.evaluate(
      (theme) => (document.documentElement.dataset.theme = theme),
      theme,
    );
    await page.screenshot({
      path: `${SHOTS}/${browserName}-account-run-${theme}.png`,
      fullPage: true,
      animations: "disabled",
    });
    const a11y = await new AxeBuilder({ page }).analyze();
    expect(
      a11y.violations.filter((v) =>
        ["critical", "serious"].includes(v.impact ?? ""),
      ),
    ).toEqual([]);
    await button.click();
    await expect.poll(() => opened).toEqual([{ card: "run_setup" }]);
  });

test(`"Ich will auch laufen" is hidden when a run profile exists`, async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 812 });
  const { reads } = await mockAccount(page, true);
  await page.goto(`${ACCOUNT_BASE}/preview?account=delete`);
  await expect(
    page.getByRole("heading", { name: "Arnold-Konto löschen?" }),
  ).toBeVisible();
  // The profile read must have answered before an absence means anything.
  await expect.poll(() => reads.count).toBeGreaterThan(0);
  await page.waitForTimeout(300);
  await expect(
    page.getByRole("button", { name: "Ich will auch laufen" }),
  ).toHaveCount(0);
});
