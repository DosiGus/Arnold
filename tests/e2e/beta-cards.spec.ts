import {
  test,
  expect,
  type Locator,
  type Page,
  type Route,
} from "@playwright/test";
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
      "Deine Trainingspläne, Trainings und Sätze",
      "Gespeicherte Vorgänge bei Arnold",
    ],
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
  const claim = {};
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
  // The service-level confirmation stops at READY_TO_FINISH: the card that
  // offers "Einrichtung abschließen" when finishing was interrupted.
  const finishing = (
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
  const done = structuredClone(finishing);
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
      finishing,
      done,
    },
  };
}
const visuals = visualStates();
async function mockOnboarding(page: Page, state: OnboardingState) {
  await page.route("**/mcp", async (route) => {
    const name = route.request().postDataJSON()?.params?.name;
    if (name === "show_arnold_onboarding")
      return result(route, {
        onboarding_contract: ONBOARDING_CONTRACT,
        state,
        resumed: false,
        source: {
          label: "Synthetische Vorschau",
          description: "Nur Demo-Daten",
          schema_version: ONBOARDING_SCHEMA_VERSION,
        },
      });
    if (name === "get_onboarding_state") return result(route, state);
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
            `test-results/screens/${browserName}-${name}-${width}-${theme}.png`,
          ),
          fullPage: true,
        });
      };
      for (const card of ["home", "today", "progress", "history", "plan"]) {
        await openCard(
          page,
          card,
          card === "plan" ? "http://127.0.0.1:8796" : BASE,
        );
        if (card === "progress")
          await expect(page.locator(".ac-big")).toBeVisible();
        await capture(card);
        if (card === "history") {
          await page.locator(".ac-history-row").first().click();
          await expect(page.locator(".ac-history-exercises")).toBeVisible();
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
          `test-results/screens/${browserName}-plan-editor-${width}-${theme}.png`,
        ),
        fullPage: true,
      });
      const { states } = await visuals;
      for (const [name, state] of Object.entries(states)) {
        await page.unroute("**/mcp");
        await mockOnboarding(page, state);
        await page.goto(`${BASE}/preview?onboarding=1`);
        await expect(
          page.locator('main[data-card="onboarding-card"]'),
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
    if (args.confirmation_token) return result(route, { stage: "deleted" });
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
          `test-results/screens/${browserName}-account-${width}-${theme}.png`,
        ),
        fullPage: true,
        animations: "disabled",
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
  await expect(page.locator("body")).not.toContainText("Google");
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

test("numeric inputs reject invalid values and confirm unusual values before saving", async ({
  page,
  browserName,
}) => {
  await page.goto("http://127.0.0.1:8795/preview?card=today");
  // Other tests write to the same tracker: start from today's plan either way.
  await expect(
    page
      .getByRole("button", {
        name: /^(Noch ein Training eintragen|So gemacht, speichern)$/,
      })
      .first(),
  ).toBeVisible();
  const another = page.getByRole("button", {
    name: "Noch ein Training eintragen",
  });
  if (await another.isVisible()) await another.click();
  /** Opens one exercise with one value for all its sets. */
  const open = async (name: string) => {
    const row = page.locator(".ac-day-row").filter({ hasText: name });
    if (!(await row.getAttribute("data-open")))
      await row.locator(".ac-day-head").click();
    const adjust = row.getByRole("button", { name: "Anpassen", exact: true });
    if (await adjust.isVisible()) await adjust.click();
    const same = row.getByRole("button", {
      name: "Alle Sätze gleich",
      exact: true,
    });
    if (await same.isVisible()) await same.click();
    return row;
  };
  const value = (row: Locator, name: string) =>
    row.getByRole("textbox", { name: new RegExp(`^${name}( |$)`) });
  const incline = await open("Demo Schrägbankdrücken");
  await value(incline, "Gewicht je Hantel").fill("20");
  const bench = await open("Demo Bankdrücken");
  await value(bench, "Gewicht").fill("60");
  await value(bench, "Wiederholungen").fill("8,5");
  await expect(value(bench, "Wiederholungen")).toHaveAttribute(
    "aria-invalid",
    "true",
  );
  await value(bench, "Wiederholungen").fill("8");
  await expect(value(bench, "Wiederholungen")).not.toHaveAttribute(
    "aria-invalid",
    "true",
  );
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
            `test-results/screens/${browserName}-${name}-${width}-${theme}.png`,
          ),
          fullPage: true,
        });
      }
  };
  await capture("edit");
  const inputs: Record<string, unknown>[] = [];
  await page.route("**/mcp", async (route) => {
    const body = route.request().postDataJSON();
    if (body?.params?.name === "log_workout")
      inputs.push(body.params.arguments);
    await route.continue();
  });
  // Over 500 kg is almost certainly a slip: the server asks, nothing is saved.
  await value(bench, "Gewicht").fill("550");
  await page
    .getByRole("button", { name: "So gemacht, speichern", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Stimmt das?", exact: true }),
  ).toBeVisible();
  await capture("unusual-values");
  expect(inputs[0].confirm_unusual_values).toBeUndefined();
  await page
    .getByRole("button", { name: "Ja, diese Werte speichern", exact: true })
    .click();
  await expect(page.locator(".ac-training-saved")).toBeVisible();
  await expect(
    page.locator(".ac-rows > li").filter({ hasText: "Demo Bankdrücken" }),
  ).toContainText("550 kg");
  expect(inputs[1].confirm_unusual_values).toBe(true);
  expect(inputs[1].request_id).not.toBe(inputs[0].request_id);
  await capture("training-saved");
  // Leave the shared tracker without the slip for the next test.
  await page.getByRole("button", { name: "Rückgängig", exact: true }).click();
  await page
    .getByRole("button", { name: "Wirklich zurücknehmen?", exact: true })
    .click();
  await expect(page.locator(".ac").first()).toContainText("zurückgenommen");
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
        return result(route, { stage: "deleted" });
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
  // A cancelled session is listed where it belongs and opens right away.
  const cancelled = page.getByRole("button", {
    name: /^Abgebrochene Einheit .*Abgebrochen/,
  });
  await expect(cancelled).toHaveAttribute("aria-expanded", "true");
  await page
    .getByRole("button", { name: /^Freies Training / })
    .first()
    .click();
  await expect(
    page.getByRole("list", { name: "Übungen Freies Training" }).first(),
  ).toBeVisible();
  await expect(cancelled).toHaveAttribute("aria-expanded", "false");
});

test("a completed setup in a new chat opens as completed", async ({ page }) => {
  const { states } = await visuals;
  await page.route("**/mcp", async (route) => {
    const name = route.request().postDataJSON()?.params?.name;
    if (name === "show_arnold_onboarding")
      return result(route, {
        onboarding_contract: ONBOARDING_CONTRACT,
        state: states.done,
        resumed: true,
        source: {
          label: "Synthetische Vorschau",
          description: "Nur Demo-Daten",
          schema_version: ONBOARDING_SCHEMA_VERSION,
        },
      });
    await route.continue();
  });
  await page.goto(`${BASE}/preview?onboarding=1`);
  await expect(page.locator('main[data-ocard="start"]')).toBeVisible();
  await expect(page.locator("body")).not.toContainText("Google");
  await expect(page.getByRole("alert")).toHaveCount(0);
});
