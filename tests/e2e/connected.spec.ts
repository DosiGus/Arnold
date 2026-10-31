import { test, expect } from "@playwright/test";

/** Real browser + MCP + OIDC verification; Google endpoints and training data are synthetic. */
test("onboarding, Google consent, personal tracker, first set, and browser reload", async ({
  page,
  context,
  request,
}) => {
  const base = "http://127.0.0.1:8803";
  const { token } = await (await request.get(`${base}/__test/token`)).json();
  // Opening the dashboard is slowed down as on a loaded CI runner, so a tap
  // that lands while the card is still switching is caught deterministically
  // (B19: a second tap used to hit the old "Erstes Training starten" button).
  let dashboardOpens = 0;
  await context.route(`${base}/mcp`, async (route) => {
    if (route.request().postData()?.includes('"show_arnold_dashboard"')) {
      dashboardOpens += 1;
      await new Promise((resolve) => setTimeout(resolve, 400));
    }
    await route.continue({
      headers: {
        ...route.request().headers(),
        authorization: `Bearer ${token}`,
      },
    });
  });
  // Consent is intercepted before any Google network call. The backend still
  // checks state, browser cookie, PKCE, nonce, Google signature and scope.
  await context.route(`${base}/auth/google/launch?**`, async (route) => {
    const response = await route.fetch({ maxRedirects: 0 });
    const { callback } = await (
      await request.get(
        `${base}/__test/consent?${new URLSearchParams({ authorization: response.headers().location })}`,
      )
    ).json();
    await route.fulfill({
      status: 303,
      headers: { ...response.headers(), location: callback },
      body: "",
    });
  });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`${base}/preview?onboarding=1`);
  const wizard = page.locator('main[data-card="onboarding"]');
  await expect(
    wizard.getByRole("heading", { name: "Willkommen bei Arnold" }),
  ).toBeVisible();
  // Supply the same tools a ChatGPT turn uses, then continue in the real UI.
  await page.evaluate(async () => {
    const claim = JSON.parse(
      sessionStorage.getItem("arnold.onboarding.claim")!,
    );
    const call = async (name: string, args: Record<string, unknown>) => {
      const response = await fetch("/mcp", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: Math.floor(Math.random() * 1e9),
          method: "tools/call",
          params: { name, arguments: args },
        }),
      });
      const payload = await response.json();
      if (!payload.result?.structuredContent)
        throw new Error(JSON.stringify(payload));
      return payload.result.structuredContent;
    };
    await call("update_onboarding_profile", {
      ...claim,
      request_id: "browser-profile",
      profile: {
        path: "arnold_plan",
        training: {
          primary_goal: "strength",
          experience: "intermediate",
          days_per_week: 3,
          session_minutes: 60,
          environment: "gym",
        },
      },
    });
    await call("request_onboarding_plan", {
      ...claim,
      request_id: "browser-request",
    });
    await call("submit_onboarding_plan_proposal", {
      ...claim,
      request_id: "browser-proposal",
      name: "Mein Browserplan",
      origin: "manual",
      sessions: ["bench-press", "lat-pulldown", "squat"].map(
        (exercise_id, index) => ({
          session_name: `Einheit ${index + 1}`,
          exercises: [{ exercise_id, target_sets: 3, rep_min: 8, rep_max: 12 }],
        }),
      ),
    });
  });
  await page.reload();
  await expect(
    wizard.getByRole("heading", { name: "Dein Planvorschlag" }),
  ).toBeVisible();
  await wizard
    .getByRole("button", { name: "Plan bestätigen", exact: true })
    .first()
    .click();
  await wizard
    .getByRole("button", { name: "Plan bestätigen", exact: true })
    .click();
  await expect(
    wizard.getByRole("button", { name: "Google-Konto verbinden", exact: true }),
  ).toBeEnabled();
  const popupReady = context.waitForEvent("page");
  await wizard
    .getByRole("button", { name: "Google-Konto verbinden", exact: true })
    .click();
  const popup = await popupReady;
  await expect(popup.locator("body")).toContainText(
    "deine Trainingsdatei ist eingerichtet",
  );
  await popup.close();
  await wizard
    .getByRole("button", { name: "Einrichtung prüfen und abschließen" })
    .click();
  await expect(
    wizard.getByRole("heading", {
      name: "Bereit für dein erstes Training",
    }),
  ).toBeVisible();
  await wizard.getByRole("button", { name: "Erstes Training starten" }).click();
  // The new plan's first day is waiting on today's card.
  await page.getByRole("button", { name: "Training starten" }).click();
  await expect(page.locator(".ac-steppers")).toBeVisible();
  await page.getByLabel("Gewicht", { exact: true }).fill("40");
  await page.getByLabel("Wiederholungen", { exact: true }).fill("10");
  await page
    .getByRole("button", { name: "Satz speichern", exact: true })
    .click();
  await expect(page.locator(".ac-chip.done")).toHaveCount(1);
  // One tap, one dashboard: the switch never fires twice.
  expect(dashboardOpens).toBe(1);
  // A reload resumes the open workout with its saved set.
  await page.goto(`${base}/preview`);
  await expect(page.locator(".ac-chip.done")).toHaveCount(1);
  await page.screenshot({
    path: "test-results/connected-logger.png",
    fullPage: true,
  });
  expect(errors).toEqual([]);
});
