import { test, expect, type Page, type Route } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { resolve } from "node:path";
import { createFixtureOnboarding } from "../../src/server/onboarding/fixture";
import {
  ONBOARDING_CONTRACT,
  ONBOARDING_SCHEMA_VERSION,
  type OnboardingState,
} from "../../src/shared/onboarding-contract";
import { openCard } from "./helpers";

const BASE = "http://127.0.0.1:8792";
const TOKEN = "synthetic-card-confirmation-token-only";
const confirm = () => ({
  stage: "confirm",
  summary: {
    stored_items: [
      "Dein Arnold-Konto",
      "Google-Zugang und Einrichtungsdaten",
      "Gespeicherte Vorgänge bei Arnold",
    ],
    keeps: ["Deine Google-Tabelle mit deinen Trainings"],
  },
  confirmation_token: TOKEN,
  expires_at: new Date(Date.now() + 300000).toISOString(),
});
const result = (route: Route, value: unknown, meta?: object, isError = false) =>
  route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: route.request().postDataJSON().id,
      result: {
        content: [],
        ...(value === undefined ? {} : { structuredContent: value }),
        ...(meta ? { _meta: meta } : {}),
        ...(isError ? { isError } : {}),
      },
    }),
  });

async function visualStates() {
  const runtime = createFixtureOnboarding();
  const service = runtime.onboarding;
  const started = await service.startOnboarding({
    request_id: crypto.randomUUID(),
  });
  const claim = {
    onboarding_session_id: started.state!.session.onboarding_session_id,
    session_token: started.session_token!,
  };
  const ready = (
    await service.updateProfile({
      ...claim,
      request_id: crypto.randomUUID(),
      profile: {
        path: "arnold_plan",
        training: {
          primary_goal: "strength",
          experience: "beginner",
          days_per_week: 3,
          session_minutes: 45,
          environment: "gym",
        },
      },
    })
  ).state!;
  await service.requestPlanProposal({
    ...claim,
    request_id: crypto.randomUUID(),
  });
  const brief = await service.getBrief(claim);
  const proposed = (
    await service.submitPlanProposal({
      ...claim,
      request_id: crypto.randomUUID(),
      name: "Dein Ganzkörperplan",
      origin: "ai_proposal",
      sessions: ["Training A", "Training B", "Training C"].map(
        (session_name, i) => ({
          session_name,
          exercises: [
            {
              exercise_id: brief.exercise_catalog[i].exercise_id,
              target_sets: 3,
              rep_min: 8,
              rep_max: 12,
            },
          ],
        }),
      ),
    })
  ).state!;
  const plan = proposed.plan!;
  const google = (
    await service.confirmPlan({
      ...claim,
      request_id: crypto.randomUUID(),
      confirmation: {
        plan_version_id: plan.plan_version_id,
        row_revision: plan.row_revision,
        confirmed: true,
      },
    })
  ).state!;
  const person = structuredClone(started.state!);
  person.session.profile.path = "arnold_plan";
  person.session.current_step = "profile";
  const question = structuredClone(person);
  question.session.profile.person.age_years = 30;
  const done = structuredClone(google);
  done.session.status = "COMPLETED";
  done.session.current_step = "done";
  done.handoff.status = "completed";
  done.session.handoff_status = "completed";
  return {
    claim,
    states: {
      welcome: started.state!,
      person,
      question,
      review: ready,
      proposal: proposed,
      google,
      done,
    },
  };
}
const visuals = visualStates();
async function mockOnboarding(
  page: Page,
  state: OnboardingState,
  secret: string,
) {
  await page.route("**/mcp", async (route) => {
    const name = route.request().postDataJSON()?.params?.name;
    if (name === "show_arnold_onboarding")
      return result(route, {
        onboarding_contract: ONBOARDING_CONTRACT,
        state,
        resumed: false,
        session_token: secret,
        source: {
          label: "Synthetische Vorschau",
          description: "Nur Demo-Daten",
          schema_version: ONBOARDING_SCHEMA_VERSION,
        },
      });
    if (name === "get_onboarding_state") return result(route, state);
    if (name === "finish_arnold_setup")
      return result(route, {
        spreadsheet_url:
          "https://docs.google.com/spreadsheets/d/synthetic-demo-only/edit",
        spreadsheet_name: "Arnold – Mein Training",
      });
    await route.continue();
  });
}

for (const width of [375, 1024])
  for (const theme of ["light", "dark"] as const)
    test(`visual acceptance ${width}px ${theme}`, async ({
      page,
      browserName,
    }) => {
      test.setTimeout(90000);
      await page.setViewportSize({ width, height: width === 375 ? 812 : 900 });
      await page.emulateMedia({ colorScheme: theme, reducedMotion: "reduce" });
      const capture = async (name: string) => {
        await expect(page.locator(".ac").first()).toBeVisible();
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth + 1,
          ),
          name,
        ).toBe(true);
        const small = await page
          .locator("button:visible")
          .evaluateAll((buttons) =>
            buttons
              .filter(
                (button) =>
                  button.getBoundingClientRect().height < 43.5 ||
                  button.getBoundingClientRect().width < 43.5,
              )
              .map((button) => button.textContent),
          );
        expect(small, `${name}: touch targets`).toEqual([]);
        await page.screenshot({
          path: resolve(
            `docs/beta/screens/${browserName}-${name}-${width}-${theme}.png`,
          ),
          fullPage: true,
        });
      };
      for (const card of ["today", "week", "progress", "history", "plan"]) {
        await openCard(
          page,
          card,
          card === "plan" ? "http://127.0.0.1:8796" : BASE,
        );
        if (card === "progress")
          await expect(page.locator(".ac-big")).toBeVisible();
        await capture(card);
        if (card === "history") {
          await page.locator(".ac-training-row").first().click();
          await expect(page.locator(".workout-detail")).toBeVisible();
          await capture("history-detail");
        }
      }
      await page
        .getByRole("button", { name: "Plan bearbeiten", exact: true })
        .click();
      await expect(page.locator(".plan-editor")).toBeVisible();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
      ).toBe(true);
      await page.screenshot({
        path: resolve(
          `docs/beta/screens/${browserName}-plan-editor-${width}-${theme}.png`,
        ),
        fullPage: true,
      });
      const { states, claim } = await visuals;
      for (const [name, state] of Object.entries(states)) {
        await page.unroute("**/mcp");
        await mockOnboarding(page, state, claim.session_token);
        await page.goto(`${BASE}/preview?onboarding=1`);
        await expect(
          page.locator('main[data-card="onboarding"]'),
        ).toBeVisible();
        await capture(`setup-${name}`);
        const a11y = await new AxeBuilder({ page })
          .withTags(["wcag2a", "wcag2aa"])
          .analyze();
        expect(
          a11y.violations.filter((v) =>
            ["critical", "serious"].includes(v.impact ?? ""),
          ),
          name,
        ).toEqual([]);
      }
    });

test("account deletion sends its private confirmation only after an explicit click", async ({
  page,
  browserName,
}) => {
  const sent: Record<string, unknown>[] = [];
  await page.setViewportSize({ width: 375, height: 812 });
  await page.route("**/mcp", async (route) => {
    const body = route.request().postDataJSON();
    if (body?.params?.name !== "delete_arnold_account") return route.continue();
    const args = body.params.arguments;
    sent.push(args);
    if (args.confirmation_token)
      return result(route, {
        stage: "deleted",
        google_sheet_kept: true,
        sheet_url: null,
      });
    const full = confirm();
    const { confirmation_token: _, ...publicValue } = full;
    return result(route, publicValue, { arnold: { delete_account: full } });
  });
  await page.goto(`${BASE}/preview?account=delete`);
  await expect(
    page.getByRole("heading", { name: "Arnold-Konto löschen?" }),
  ).toBeVisible();
  expect(sent.every((args) => !args.confirmation_token)).toBe(true);
  await expect(page.locator("body")).not.toContainText(TOKEN);
  for (const width of [375, 1024])
    for (const theme of ["light", "dark"] as const) {
      await page.setViewportSize({ width, height: 900 });
      await page.evaluate(
        (theme) => (document.documentElement.dataset.theme = theme),
        theme,
      );
      await page.screenshot({
        path: resolve(
          `docs/beta/screens/${browserName}-account-${width}-${theme}.png`,
        ),
        fullPage: true,
      });
    }
  await page
    .getByRole("button", {
      name: "Arnold-Konto endgültig löschen",
      exact: true,
    })
    .click();
  await expect(
    page.getByRole("heading", { name: "Dein Arnold-Konto ist gelöscht" }),
  ).toBeVisible();
  expect(sent.filter((args) => args.confirmation_token)).toEqual([
    { confirmation_token: TOKEN },
  ]);
  await expect(
    page.getByRole("button", { name: "Google-Tabelle öffnen" }),
  ).toHaveCount(0);
});

test("an expired delete confirmation restarts without reusing the private token", async ({
  page,
}) => {
  let calls = 0;
  await page.route("**/mcp", async (route) => {
    const body = route.request().postDataJSON();
    if (body?.params?.name !== "delete_arnold_account") return route.continue();
    calls++;
    const full = confirm();
    if (calls === 1) full.expires_at = "2020-01-01T00:00:00Z";
    expect(body.params.arguments.confirmation_token).toBeUndefined();
    const { confirmation_token: _, ...publicValue } = full;
    return result(route, publicValue, { arnold: { delete_account: full } });
  });
  await page.goto(`${BASE}/preview?account=delete`);
  await page.getByRole("button", { name: "Neu beginnen", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Arnold-Konto löschen?" }),
  ).toBeVisible();
  expect(calls).toBe(2);
});

test("Google reconnect works in a new chat without a setup claim and restores the previous card", async ({
  page,
  context,
  browserName,
}) => {
  let refused = false;
  let connected = false;
  await context.route("**/__beta-google-consent", async (route) => {
    connected = true;
    await route.fulfill({
      contentType: "text/html",
      body: "<p>Freigabe abgeschlossen.</p>",
    });
  });
  await page.route("**/mcp", async (route) => {
    const body = route.request().postDataJSON();
    const name = body?.params?.name;
    if (name === "get_arnold_exercise_progress" && !refused) {
      refused = true;
      return result(
        route,
        undefined,
        {
          arnold: {
            code: "GOOGLE_REAUTH_REQUIRED",
            retryable: true,
            recovery: "reconnect_google",
          },
        },
        true,
      );
    }
    if (name === "connect_google_account") {
      expect(body.params.arguments).toEqual({});
      return result(route, {
        authorization_url: `${BASE}/__beta-google-consent`,
      });
    }
    if (name === "get_google_connection")
      return result(route, {
        connection: { status: connected ? "CONNECTED" : "REAUTH_REQUIRED" },
      });
    await route.continue();
  });
  await page.goto(`${BASE}/preview?card=progress`);
  await expect(
    page.getByRole("heading", { name: "Google neu verbinden", exact: true }),
  ).toBeVisible();
  for (const width of [375, 1024])
    for (const theme of ["light", "dark"] as const) {
      await page.setViewportSize({ width, height: 900 });
      await page.evaluate(
        (theme) => (document.documentElement.dataset.theme = theme),
        theme,
      );
      await page.screenshot({
        path: resolve(
          `docs/beta/screens/${browserName}-reconnect-${width}-${theme}.png`,
        ),
        fullPage: true,
      });
    }
  const popupReady = context.waitForEvent("page");
  await page
    .getByRole("button", { name: "Google neu verbinden", exact: true })
    .click();
  const popup = await popupReady;
  await popup.waitForLoadState();
  await popup.close();
  const check = page.getByRole("button", {
    name: "Verbindung prüfen",
    exact: true,
  });
  if (await check.isVisible()) await check.click();
  await expect(
    page.locator('main[data-card="progress"] .ac-big'),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Testbankdrücken", exact: true }),
  ).toBeVisible();
});

test("numeric inputs reject invalid values and confirm unusual values before saving", async ({
  page,
  browserName,
}) => {
  await page.goto("http://127.0.0.1:8795/preview");
  await page
    .getByRole("button", { name: "Training starten", exact: true })
    .click();
  await page.getByLabel("Gewicht", { exact: true }).fill("60");
  await page.getByLabel("Wiederholungen", { exact: true }).fill("8,5");
  await expect(
    page.getByLabel("Wiederholungen", { exact: true }),
  ).toHaveAttribute("aria-invalid", "true");
  await expect(
    page.getByRole("button", { name: "Satz speichern", exact: true }),
  ).toBeDisabled();
  await page.getByLabel("Wiederholungen", { exact: true }).fill("8");
  const capture = async (name: string) => {
    for (const width of [375, 1024])
      for (const theme of ["light", "dark"] as const) {
        await page.setViewportSize({ width, height: 900 });
        await page.evaluate(
          (theme) => (document.documentElement.dataset.theme = theme),
          theme,
        );
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth + 1,
          ),
        ).toBe(true);
        await page.screenshot({
          path: resolve(
            `docs/beta/screens/${browserName}-${name}-${width}-${theme}.png`,
          ),
          fullPage: true,
        });
      }
  };
  await capture("set");
  let first = true;
  const inputs: Record<string, unknown>[] = [];
  await page.route("**/mcp", async (route) => {
    const body = route.request().postDataJSON();
    if (body?.params?.name === "log_workout_sets") {
      inputs.push(body.params.arguments);
      if (first) {
        first = false;
        return result(
          route,
          undefined,
          {
            arnold: {
              code: "CONFIRMATION_REQUIRED",
              retryable: false,
              recovery: "none",
            },
          },
          true,
        );
      }
    }
    await route.continue();
  });
  await page.getByLabel("Gewicht", { exact: true }).fill("550");
  await page
    .getByRole("button", { name: "Satz speichern", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Stimmt das?", exact: true }),
  ).toBeVisible();
  await capture("unusual-values");
  expect(inputs[0].confirm_unusual_values).toBeUndefined();
  await page
    .getByRole("button", { name: "Ja, diese Werte speichern", exact: true })
    .click();
  await expect(page.locator(".ac-chip.done")).toHaveCount(1);
  expect(inputs[1].confirm_unusual_values).toBe(true);
  expect(inputs[1].request_id).not.toBe(inputs[0].request_id);
  await page
    .getByRole("button", { name: "Training beenden", exact: true })
    .click();
  await expect(
    page.locator(".ac-label").filter({ hasText: "Training gespeichert" }),
  ).toBeVisible();
  await capture("training-summary");
});

test("the sandbox host never receives a deletion token in model context", async ({
  page,
}) => {
  let confirmations = 0;
  await page.route("**/mcp", async (route) => {
    const body = route.request().postDataJSON();
    if (body?.method === "tools/list") {
      const response = await route.fetch();
      const value = await response.json();
      const opening = value.result.tools.find(
        (tool: { name: string }) => tool.name === "show_arnold_dashboard",
      );
      value.result.tools.push({
        ...opening,
        name: "delete_arnold_account",
        outputSchema: { type: "object", additionalProperties: true },
        inputSchema: {
          type: "object",
          properties: { confirmation_token: { type: "string" } },
        },
      });
      return route.fulfill({ response, json: value });
    }
    if (body?.params?.name === "delete_arnold_account") {
      if (body.params.arguments.confirmation_token) {
        confirmations++;
        return result(route, {
          stage: "deleted",
          google_sheet_kept: true,
          sheet_url: null,
        });
      }
      const full = confirm();
      const { confirmation_token: _, ...publicValue } = full;
      return result(route, publicValue, { arnold: { delete_account: full } });
    }
    await route.continue();
  });
  await page.goto(`${BASE}/host?tool=delete_arnold_account`);
  const frame = page.frameLocator("iframe");
  await expect(
    frame.getByRole("heading", { name: "Arnold-Konto löschen?" }),
  ).toBeVisible();
  await expect(page.locator("#host-context")).toContainText(
    "ausdrückliche Klick",
  );
  await expect(page.locator("#host-context")).not.toContainText(TOKEN);
  expect(confirmations).toBe(0);
  await frame.getByRole("button", { name: "Abbrechen", exact: true }).click();
  await expect(
    frame.getByRole("heading", { name: "Löschung abgebrochen" }),
  ).toBeVisible();
  expect(confirmations).toBe(0);
});

test("a chat-selected exercise and metric survive host revalidation", async ({
  page,
}) => {
  await page.goto(
    `${BASE}/host?card=progress&exercise_id=ex-test-row-single&metric=estimated_1rm`,
  );
  const frame = page.frameLocator("iframe");
  await expect(
    frame.getByRole("heading", { name: "Testrudern einarmig", exact: true }),
  ).toBeVisible();
  await expect(frame.locator(".ac")).toContainText(
    "Kein getestetes Maximalgewicht",
  );
  await expect(page.locator("#host-context")).toContainText(
    "Testrudern einarmig",
  );
  await expect(frame.locator(".ac")).toContainText("kg pro Hantel");
});

test("chat-selected history opens the requested session and still lets another session open", async ({
  page,
}) => {
  await page.goto(`${BASE}/preview?card=history&workout_id=w-test-6`);
  await expect(
    page
      .locator(".workout-detail")
      .getByRole("heading", { name: "Abgebrochene Einheit", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Zur Trainingsliste", exact: true })
    .click();
  await page.getByRole("button", { name: /Freies Training am/ }).click();
  await expect(
    page
      .locator(".workout-detail")
      .getByRole("heading", { name: "Freies Training", exact: true }),
  ).toBeVisible();
});

test("a completed setup in a new chat restores its sheet link without the old secret", async ({
  page,
}) => {
  const { states } = await visuals;
  await page.route("**/mcp", async (route) => {
    const name = route.request().postDataJSON()?.params?.name;
    if (name === "show_arnold_onboarding")
      return result(route, {
        onboarding_contract: ONBOARDING_CONTRACT,
        state: states.done,
        resumed: true,
        session_token: null,
        source: {
          label: "Synthetische Vorschau",
          description: "Nur Demo-Daten",
          schema_version: ONBOARDING_SCHEMA_VERSION,
        },
      });
    if (name === "get_arnold_stored_data")
      return result(route, {
        items: [],
        google_sheet_url:
          "https://docs.google.com/spreadsheets/d/synthetic-demo-only/edit",
        retention_days: 30,
      });
    await route.continue();
  });
  await page.goto(`${BASE}/preview?onboarding=1`);
  await expect(
    page.getByRole("heading", {
      name: "Bereit für dein erstes Training",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Google-Tabelle öffnen", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);
});
