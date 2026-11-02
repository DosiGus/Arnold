import { test, expect } from "@playwright/test";
import { callTool, openWizard, storedClaim, wizard } from "./helpers";

test("questions remain responsive during an outstanding MCP write; plan creation waits for every answer", async ({
  page,
}) => {
  await openWizard(page);
  let release!: () => void;
  let started!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const arrived = new Promise<void>((resolve) => {
    started = resolve;
  });
  const writes: Record<string, unknown>[] = [];
  let requestedPlan = false;
  let arrivedAt = 0;
  await page.route("**/mcp", async (route) => {
    const payload = route.request().postDataJSON();
    if (payload?.params?.name === "update_onboarding_profile") {
      writes.push(payload.params.arguments);
      if (!arrivedAt) arrivedAt = Date.now();
      started();
      await gate;
    }
    if (payload?.params?.name === "request_onboarding_plan")
      requestedPlan = true;
    await route.continue();
  });

  await page
    .getByRole("button", { name: "Plan mit Arnold erstellen", exact: true })
    .click();
  await expect(
    page.getByRole("heading", {
      name: "Möchtest du etwas über dich angeben?",
      exact: true,
    }),
  ).toBeVisible({ timeout: 500 });
  await page.getByRole("button", { name: "Überspringen", exact: true }).click();

  await page
    .getByRole("button", { name: "Muskeln aufbauen", exact: true })
    .click();
  await page.getByRole("button", { name: "Weiter", exact: true }).click();
  await expect(
    page.getByRole("heading", {
      name: "Wie lange trainierst du schon?",
      exact: true,
    }),
  ).toBeVisible({ timeout: 500 });
  // Hold the real transport open, rather than just delaying the test runner.
  await arrived;
  const began = Date.now();
  for (const [answer, next] of [
    ["Fortgeschritten", "Wie oft möchtest du pro Woche trainieren?"],
    ["3", "Wie viel Zeit hast du pro Training?"],
    ["60 Min.", "Wo trainierst du?"],
    ["Fitnessstudio", "Passt das so für deinen Plan?"],
  ]) {
    await page.getByRole("button", { name: answer, exact: true }).click();
    await page.getByRole("button", { name: "Weiter", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: next, exact: true }),
    ).toBeVisible({ timeout: 500 });
  }
  expect(Date.now() - began).toBeLessThan(2000);
  expect(writes).toHaveLength(1);
  const before = await callTool(
    page,
    "get_onboarding_state",
    await storedClaim(page),
  );
  expect(before.session.profile.training.primary_goal).toBeNull();
  await expect(wizard(page)).toContainText(
    "noch nicht auf dem Server bestätigt",
  );

  await page
    .getByRole("button", { name: "Plan erstellen", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Plan erstellen", exact: true }),
  ).toBeDisabled();
  expect(requestedPlan).toBe(false);
  // Match the measured host delay: keep the transport blocked for at least
  // three seconds, while all remaining questions are already usable.
  await new Promise((resolve) =>
    setTimeout(resolve, Math.max(0, 3000 - (Date.now() - arrivedAt))),
  );
  expect(requestedPlan).toBe(false);
  release();
  await expect(
    page.getByRole("heading", {
      name: "Jetzt entsteht dein Plan",
      exact: true,
    }),
  ).toBeVisible();
  expect(requestedPlan).toBe(true);
  const after = await callTool(
    page,
    "get_onboarding_state",
    await storedClaim(page),
  );
  expect(after.session.profile.training).toMatchObject({
    primary_goal: "muscle_gain",
    experience: "intermediate",
    days_per_week: 3,
    session_minutes: 60,
    environment: "gym",
  });
  expect(writes).toHaveLength(2);
});

test("answers entered before the background batch starts survive a page reload", async ({
  page,
}) => {
  await openWizard(page);
  await page
    .getByRole("button", { name: "Plan mit Arnold erstellen", exact: true })
    .click();
  await page.getByRole("button", { name: "Überspringen", exact: true }).click();
  await page
    .getByRole("button", { name: "Stärker werden", exact: true })
    .click();
  await page.getByRole("button", { name: "Weiter", exact: true }).click();
  await expect(
    page.getByRole("heading", {
      name: "Wie lange trainierst du schon?",
      exact: true,
    }),
  ).toBeVisible({ timeout: 500 });
  await page.reload();
  await expect(
    page.getByRole("heading", {
      name: "Wie lange trainierst du schon?",
      exact: true,
    }),
  ).toBeVisible();
  await expect(wizard(page)).toHaveAttribute("data-profile-save", "saved");
  const state = await callTool(
    page,
    "get_onboarding_state",
    await storedClaim(page),
  );
  expect(state.session.profile.training.primary_goal).toBe("strength");
});
