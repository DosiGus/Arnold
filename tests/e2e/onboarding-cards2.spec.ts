import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { callTool } from "./helpers";

/** RDS-008: Richtwerte Kraft (benchmarks) and Laufreferenz (run_reference). */

const BASE = "http://127.0.0.1:8800";
type Card = "benchmarks" | "run_reference";

async function openCard(page: Page, card: Card, withRun = true) {
  await page.goto(`${BASE}/health`);
  await callTool(page, "cancel_onboarding", {
    request_id: `reset-${Math.random().toString(36).slice(2)}`,
  });
  await page.goto(`${BASE}/preview?onboarding=1&card=${card}`);
  await expect(page.locator(`main[data-ocard="${card}"]`)).toBeVisible();
  await callTool(page, "update_onboarding_profile", {
    request_id: `w-${Math.random().toString(36).slice(2)}`,
    profile: {
      path: "arnold_plan",
      training: {
        environment: "gym",
        primary_goal: "strength",
        modules: { running: true, mobility: false, morning_routine: false },
        ...(withRun
          ? {
              run: {
                runs_per_week: 3,
                base_minutes_per_week: 90,
                longest_run_4w_min: 40,
                preferred_environment: "outdoor",
              },
            }
          : {}),
      },
    },
  });
  // The card was open before the answers: a focus reads them.
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
}
const stored = async (page: Page) =>
  (await callTool(page, "get_onboarding_state", {})).session.profile;

test("Richtwerte: error at the field, decimal comma, Weiß ich nicht, Enter saves", async ({
  page,
}) => {
  await openCard(page, "benchmarks");
  const kg = page.getByLabel("Gewicht");
  await expect(kg).toHaveCount(3);
  await expect(page.locator(".oc-title")).toBeFocused();
  await kg.first().fill("62,5");
  await page.getByRole("button", { name: "Weiter" }).click();
  await expect(page.getByText(/Wiederholungen: 1 bis 12/)).toBeVisible();
  await expect(kg.first()).toHaveValue("62,5");
  await page.getByLabel("Wiederholungen").first().fill("13");
  await page.getByRole("button", { name: "Weiter" }).click();
  await expect(page.getByText(/Wiederholungen: 1 bis 12/)).toBeVisible();
  await page.getByLabel("Wiederholungen").first().fill("8");
  const unknown = page.getByRole("button", { name: "Weiß ich nicht" });
  await unknown.nth(1).click();
  await expect(unknown.nth(1)).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByLabel("Gewicht").nth(1)).toBeDisabled();
  await page.getByLabel("Wiederholungen").first().press("Enter");
  await expect(page.getByRole("status").getByText("Gespeichert")).toBeVisible();
  const loads = (await stored(page)).training.known_loads;
  expect(Object.values(loads)).toEqual([{ kg: 62.5, reps: 8 }]);
});

test("Richtwerte: skipping writes nothing", async ({ page }) => {
  await openCard(page, "benchmarks");
  await page.getByRole("button", { name: "Überspringen" }).click();
  expect((await stored(page)).training.known_loads).toBeUndefined();
});

test("Laufreferenz: errors at the fields, saves, skip possible", async ({
  page,
}) => {
  await openCard(page, "run_reference");
  await expect(page.getByLabel("Zeit", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Weiter" }).click();
  await expect(page.getByText("Wähl eine Strecke.")).toBeVisible();
  await expect(page.getByLabel("Zeit", { exact: true })).toHaveAttribute(
    "aria-invalid",
    "true",
  );
  await page.getByRole("button", { name: "Andere Strecke" }).click();
  await expect(
    page.getByRole("button", { name: "Andere Strecke" }),
  ).toHaveAttribute("aria-pressed", "true");
  await page.getByLabel("Strecke in km").fill("7,5");
  await page.getByLabel("Zeit", { exact: true }).fill("0:41:30");
  await page.getByLabel("Ungefähres Datum").fill("2026-10-01");
  await page.getByLabel("Zeit", { exact: true }).press("Enter");
  await expect(page.getByRole("status").getByText("Gespeichert")).toBeVisible();
  const ref = (await stored(page)).training.run.reference;
  expect(ref).toMatchObject({
    distance_m: 7500,
    time_s: 2490,
    date: "2026-10-01",
  });
  await expect(
    page.getByRole("button", { name: "Überspringen" }),
  ).toBeVisible();
});

test("Laufreferenz: without run details only a hint and skip", async ({
  page,
}) => {
  await openCard(page, "run_reference", false);
  await expect(
    page.getByText(/Erst brauche ich deine Laufangaben/),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Überspringen" }),
  ).toBeVisible();
  await expect(page.getByLabel("Zeit", { exact: true })).toHaveCount(0);
});

for (const theme of ["light", "dark"] as const)
  for (const card of ["benchmarks", "run_reference"] as const)
    test(`${card}: 375 px without overflow, contrast, targets (${theme})`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: 375, height: 812 });
      await page.emulateMedia({ colorScheme: theme });
      await openCard(page, card);
      await expect(
        page.getByRole("button", { name: "Überspringen" }),
      ).toBeVisible();
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
        .locator("main button, main input")
        .evaluateAll(
          (els) =>
            els
              .map((el) => el.getBoundingClientRect())
              .filter((r) => r.height > 0 && r.height < 44).length,
        );
      expect(small).toBe(0);
    });
