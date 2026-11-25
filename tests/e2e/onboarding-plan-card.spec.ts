import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { callTool } from "./helpers";

/** RDS-009: the plan card (tiles, confirm) and "Selbst bearbeiten" in fullscreen. */

const BASE = "http://127.0.0.1:8800";
const rid = () => `p-${Math.random().toString(36).slice(2)}`;

/** A setup with a stored plan draft: barbell, dumbbell, machine, bodyweight. */
async function openPlanCard(page: Page, withPlan = true) {
  await page.goto(`${BASE}/health`);
  await callTool(page, "cancel_onboarding", { request_id: rid() });
  await page.goto(`${BASE}/preview?onboarding=1&card=plan`);
  await expect(page.locator('main[data-ocard="plan"]')).toBeVisible();
  if (!withPlan) return;
  await callTool(page, "update_onboarding_profile", {
    request_id: rid(),
    profile: {
      path: "arnold_plan",
      training: {
        primary_goal: "muscle_gain",
        experience: "intermediate",
        days_per_week: 4,
        session_minutes: 60,
        environment: "gym",
      },
    },
  });
  await callTool(page, "request_onboarding_plan", { request_id: rid() });
  const brief = await callTool(page, "get_onboarding_brief", {});
  const pick = (label: string) =>
    brief.exercise_catalog.find(
      (e: { equipment?: string }) => e.equipment === label,
    ).exercise_id;
  const result = await callTool(page, "submit_onboarding_plan_proposal", {
    request_id: rid(),
    name: "Testplan",
    origin: "ai_proposal",
    sessions: [
      ["Push", "Langhantel"],
      ["Pull", "Kurzhantel"],
      ["Beine", "Maschine"],
      ["Körper", "Körpergewicht"],
    ].map(([session_name, label]) => ({
      session_name,
      exercises: [
        {
          exercise_id: pick(label),
          target_sets: 3,
          rep_min: 8,
          rep_max: 12,
          ...(label === "Körpergewicht" ? {} : { target_load_kg: 60 }),
        },
      ],
    })),
  });
  expect(result.ok, JSON.stringify(result.error)).toBe(true);
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(page.getByRole("button", { name: /^Push/ })).toBeVisible();
}
const planState = async (page: Page) =>
  (await callTool(page, "get_onboarding_state", {})).plan;

test("tiles from the server, tap opens the exercises, exactly two actions", async ({
  page,
}) => {
  await openPlanCard(page);
  await expect(page.locator(".oc-title")).toBeFocused();
  await expect(page.locator(".oc-title")).toHaveText(
    "Dein Plan: 4 Tage, je 60 Min.",
  );
  await expect(page.locator(".oc-tile")).toHaveCount(4);
  await expect(page.locator("main .ac-actions button")).toHaveCount(2);
  await expect(
    page.getByRole("button", { name: "Plan bestätigen" }),
  ).toBeEnabled();
  await expect(page.getByText("Morgenroutine")).toHaveCount(0);
  await expect(
    page.getByText("Oder sag mir einfach, was ich ändern soll."),
  ).toBeVisible();
  const push = page.getByRole("button", { name: /^Push/ });
  await expect(push).toHaveAttribute("aria-expanded", "false");
  await push.focus();
  await page.keyboard.press("Enter");
  await expect(push).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByRole("list", { name: "Übungen Push" })).toContainText(
    "60 kg",
  );
  await push.press("Enter");
  await expect(push).toHaveAttribute("aria-expanded", "false");
});

test("Selbst bearbeiten: steps per device, floor, version +1, marked row, back to the card", async ({
  page,
}) => {
  await openPlanCard(page);
  await page.getByRole("button", { name: "Selbst bearbeiten" }).click();
  await expect(page.locator('main[data-ocard="plan-edit"]')).toBeVisible();
  const version = page.getByTestId("plan-version");
  const before = Number(
    ((await version.textContent()) ?? "")
      .replace(/\D+/g, " ")
      .trim()
      .split(" ")[0],
  );
  const row = (name: string) =>
    page.locator(".oc-edit-row").filter({ hasText: name });
  const rows = page.locator(".oc-edit-row");
  await expect(rows).toHaveCount(4);
  // The bodyweight row has no buttons.
  await expect(rows.nth(3).getByRole("button")).toHaveCount(0);
  await expect(rows.nth(3)).toContainText("Körpergewicht");
  const load = (i: number) => rows.nth(i).getByTestId("plan-load");
  // Barbell 2,5 kg, dumbbell 2 kg, machine 5 kg.
  await rows.nth(0).getByRole("button", { name: /mehr$/ }).click();
  await expect(load(0)).toContainText("62,5");
  await rows.nth(1).getByRole("button", { name: /mehr$/ }).click();
  await expect(load(1)).toContainText("62");
  await rows.nth(2).getByRole("button", { name: /mehr$/ }).click();
  await expect(load(2)).toContainText("65");
  await expect(rows.nth(0)).toContainText("Noch nicht gespeichert");
  // Plenty of minus taps stop at each device's lowest weight.
  for (let i = 0; i < 30; i++)
    if (
      await rows
        .nth(2)
        .getByRole("button", { name: /weniger$/ })
        .isEnabled()
    )
      await rows
        .nth(2)
        .getByRole("button", { name: /weniger$/ })
        .click();
  await expect(load(2)).toContainText("5 kg");
  await expect(
    rows.nth(2).getByRole("button", { name: /weniger$/ }),
  ).toBeDisabled();
  await rows.nth(2).getByRole("button", { name: /mehr$/ }).click();
  for (let i = 0; i < 40; i++)
    if (
      await rows
        .nth(0)
        .getByRole("button", { name: /weniger$/ })
        .isEnabled()
    )
      await rows
        .nth(0)
        .getByRole("button", { name: /weniger$/ })
        .click();
  await expect(load(0)).toContainText("20 kg");
  await expect(
    rows.nth(0).getByRole("button", { name: /weniger$/ }),
  ).toBeDisabled();
  await rows.nth(0).getByRole("button", { name: /mehr$/ }).click();
  await expect(load(0)).toContainText("22,5");
  await page.getByRole("button", { name: "Speichern" }).click();
  await expect(page.getByRole("status").getByText("Gespeichert")).toBeVisible();
  await expect(version).toHaveText(`Version ${before + 1}`);
  await expect(rows.nth(0)).toContainText("Von dir angepasst");
  await expect(row("Körpergewicht")).not.toContainText("Von dir angepasst");
  await expect(page.getByRole("button", { name: "Speichern" })).toBeDisabled();
  const plan = await planState(page);
  expect(plan.row_revision).toBe(before + 1);
  expect(
    plan.sessions.map(
      (s: { exercises: { target_load_kg: number | null }[] }) =>
        s.exercises[0].target_load_kg,
    ),
  ).toEqual([22.5, 62, 10, null]);
  await page.getByRole("button", { name: "Zurück zum Chat" }).click();
  await expect(page.locator('main[data-ocard="plan"]')).toBeVisible();
  await page.getByRole("button", { name: /^Push/ }).click();
  await expect(page.getByRole("list", { name: "Übungen Push" })).toContainText(
    "22,5 kg",
  );
});

test("Plan bestätigen confirms exactly the shown version and locks the card", async ({
  page,
}) => {
  await openPlanCard(page);
  const shown = await planState(page);
  await page.getByRole("button", { name: "Plan bestätigen" }).click();
  await expect(
    page.getByRole("status").getByText("Plan bestätigt"),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Plan bestätigen" }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Selbst bearbeiten" }),
  ).toBeDisabled();
  const state = await callTool(page, "get_onboarding_state", {});
  expect(state.plan.plan_version_id).toBe(shown.plan_version_id);
  expect(state.plan.editable).toBe(false);
});

test("without a plan: hint and two disabled buttons", async ({ page }) => {
  await openPlanCard(page, false);
  await expect(page.getByText(/Der Vorschlag ist noch nicht da/)).toBeVisible();
  await expect(page.locator("main .ac-actions button")).toHaveCount(2);
  await expect(page.locator("main .ac-actions button:enabled")).toHaveCount(0);
});

for (const theme of ["light", "dark"] as const)
  for (const mode of ["card", "editor"] as const)
    test(`plan ${mode}: 375 px without overflow, contrast, targets (${theme})`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: 375, height: 812 });
      await page.emulateMedia({ colorScheme: theme });
      await openPlanCard(page);
      if (mode === "editor")
        await page.getByRole("button", { name: "Selbst bearbeiten" }).click();
      else await page.getByRole("button", { name: /^Push/ }).click();
      await expect(page.locator("main button").first()).toBeVisible();
      const overflow = await page.evaluate(
        () =>
          document.documentElement.scrollWidth -
          document.documentElement.clientWidth,
      );
      expect(overflow).toBeLessThanOrEqual(0);
      const results = await new AxeBuilder({ page })
        .include('main[data-card="onboarding-card"]')
        .analyze();
      expect(results.violations).toEqual([]);
      const small = await page
        .locator("main button")
        .evaluateAll(
          (els) =>
            els
              .map((el) => el.getBoundingClientRect())
              .filter((r) => r.height > 0 && (r.height < 44 || r.width < 44))
              .length,
        );
      expect(small).toBe(0);
    });
