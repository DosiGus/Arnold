import { test, expect } from "@playwright/test";
import {
  openWizard,
  wizard,
  storedClaim,
  callTool,
  submitProposal,
  setupMenu,
  stepTo,
  next,
} from "./helpers";

const save = async (
  page: import("@playwright/test").Page,
  profile: Record<string, unknown>,
) =>
  callTool(page, "update_onboarding_profile", {
    ...(await storedClaim(page)),
    request_id: crypto.randomUUID(),
    profile,
  });

test("welcome invites to tell, keeps the form as a way out and stores nothing by itself", async ({
  page,
}) => {
  await openWizard(page);
  const main = wizard(page);
  await expect(main).toContainText("Erzähl mir von dir");
  await expect(main.locator(".cc-chips li")).toHaveCount(3);
  await expect(
    main.getByRole("button", { name: "Plan mit Arnold erstellen" }),
  ).toBeVisible();
  await expect(
    main.getByRole("button", { name: "Eigenen Plan übernehmen" }),
  ).toBeVisible();
  const state = await callTool(
    page,
    "get_onboarding_state",
    await storedClaim(page),
  );
  expect(state.session.profile.path).toBeNull();
  expect(state.session.status).toBe("COLLECTING_PROFILE");
  // The way out: the form, and back to the welcome.
  await main.getByRole("button", { name: "Plan mit Arnold erstellen" }).click();
  await expect(
    main.getByRole("heading", { name: "Ein paar Angaben über dich?" }),
  ).toBeVisible();
  await main
    .getByRole("button", { name: "Zurück", exact: true })
    .first()
    .click();
  await expect(
    main.getByRole("heading", { name: "Willkommen bei Arnold" }),
  ).toBeVisible();
});

test("told in the chat: understood with a gap, gap filled, proposal, activation, status", async ({
  page,
}) => {
  await openWizard(page);
  const main = wizard(page);
  // The model saves what the user told, without the place.
  await save(page, {
    path: "arnold_plan",
    training: {
      primary_goal: "muscle_gain",
      experience: "intermediate",
      days_per_week: 3,
      session_minutes: 60,
    },
  });
  await page.reload();
  await expect(
    main.getByRole("heading", { name: "Das habe ich verstanden" }),
  ).toBeVisible();
  await expect(main).toContainText("Muskeln aufbauen");
  await expect(main).toContainText("3 Tage · 60 Min.");
  // Two gaps, and the server named both: the place (required) and the
  // optional mobility question.
  await expect(main.locator(".cc-missing")).toHaveCount(2);
  const claim = await storedClaim(page);
  const before = await callTool(page, "get_onboarding_state", claim);
  expect(before.progress.missing_fields).toEqual(["training.environment"]);
  // No plan button while something is missing.
  await expect(
    main.getByRole("button", { name: "Plan erstellen", exact: true }),
  ).toHaveCount(0);
  // Correction by tap on a row opens the existing field.
  await main.getByRole("button", { name: "Ort und Geräte ändern" }).click();
  await expect(
    main.getByRole("heading", { name: "Wo trainierst du?" }),
  ).toBeVisible();
  await main
    .getByRole("button", { name: "Zurück", exact: true })
    .first()
    .click();
  await expect(
    main.getByRole("heading", { name: "Das habe ich verstanden" }),
  ).toBeVisible();
  // Nothing was confirmed or requested by looking at it.
  const idle = await callTool(page, "get_onboarding_state", claim);
  expect(idle.session.status).toBe("COLLECTING_PROFILE");
  expect(idle.plan).toBeNull();
  // The gap is filled in the chat.
  await save(page, { training: { environment: "gym" } });
  await setupMenu(page, "Stand neu laden");
  await expect(main).toContainText("Fitnessstudio");
  // Mobility is still unanswered and shown as open, but never blocks the plan.
  await expect(main.locator(".cc-missing")).toHaveCount(1);
  await expect(
    main.getByRole("button", { name: "Mobility ändern" }),
  ).toContainText("fehlt noch");
  expect(
    (await callTool(page, "get_onboarding_state", claim)).session.status,
  ).toBe("PROFILE_READY");
  await main
    .getByRole("button", { name: "Plan erstellen", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Arnold baut deinen Plan" }),
  ).toBeVisible();
  await submitProposal(page);
  await expect(
    page.getByRole("heading", { name: "Dein Planvorschlag" }),
  ).toBeVisible();
  // A proposal alone confirms nothing.
  expect(
    (await callTool(page, "get_onboarding_state", claim)).handoff.status,
  ).toBe("not_ready");
  await page
    .getByRole("button", { name: "Plan bestätigen", exact: true })
    .click();
  expect(
    (await callTool(page, "get_onboarding_state", claim)).handoff.status,
  ).toBe("not_ready");
  await page
    .getByRole("button", { name: "Plan bestätigen", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Bereit für dein erstes Training" }),
  ).toBeVisible();
  expect(
    (await callTool(page, "get_onboarding_state", claim)).session.status,
  ).toBe("COMPLETED");
});

test("one row corrected by tap returns to the card and saves only that field", async ({
  page,
}) => {
  await openWizard(page);
  const main = wizard(page);
  await save(page, {
    path: "arnold_plan",
    training: {
      primary_goal: "strength",
      experience: "beginner",
      days_per_week: 4,
    },
  });
  await page.reload();
  await expect(main.locator(".cc-missing")).toHaveCount(2);
  await main.getByRole("button", { name: "Umfang ändern" }).click();
  await stepTo(page, "Minuten pro Training", 45);
  await next(page);
  await expect(
    main.getByRole("heading", { name: "Das habe ich verstanden" }),
  ).toBeVisible();
  await expect(main).toContainText("4 Tage · 45 Min.");
  await expect(main).toHaveAttribute("data-profile-save", "saved");
  const state = await callTool(
    page,
    "get_onboarding_state",
    await storedClaim(page),
  );
  expect(state.session.profile.training.primary_goal).toBe("strength");
  expect(state.session.profile.training.session_minutes).toBe(45);
  expect(state.session.profile.training.environment).toBeNull();
});
