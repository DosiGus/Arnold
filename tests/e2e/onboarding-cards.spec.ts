import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { callTool } from "./helpers";

/** RDS-007: Eckdaten, Module and Checkliste as small cards in the chat. */

const BASE = "http://127.0.0.1:8800";

async function openCard(page: Page, card: "person" | "modules" | "checklist") {
  await page.goto(`${BASE}/health`);
  await callTool(page, "cancel_onboarding", {
    request_id: `reset-${Math.random().toString(36).slice(2)}`,
  });
  await page.goto(`${BASE}/preview?onboarding=1&card=${card}`);
  await expect(page.locator(`main[data-ocard="${card}"]`)).toBeVisible();
}
const stored = async (page: Page) =>
  (await callTool(page, "get_onboarding_state", {})).session.profile;

test("Eckdaten: error at the field, input stays, decimal comma, Enter sends", async ({
  page,
}) => {
  await openCard(page, "person");
  const age = page.getByLabel("Alter");
  await expect(
    page.getByRole("heading", { name: "Ein paar Angaben zu dir" }),
  ).toBeVisible();
  // Focus lands on the title of the new card.
  await expect(page.locator(".oc-title")).toBeFocused();
  await age.fill("15");
  await page.getByLabel("Größe").fill("182");
  await page.getByLabel("Gewicht").fill("78,5");
  await page.getByRole("button", { name: "Weiter" }).click();
  await expect(age).toHaveAttribute("aria-invalid", "true");
  await expect(page.getByText("Alter: 16 bis 100 Jahre.")).toBeVisible();
  await expect(age).toHaveValue("15");
  await expect(page.getByLabel("Gewicht")).toHaveValue("78,5");
  await expect(age).toBeFocused();
  expect((await stored(page)).person.age_years).toBeUndefined();
  await age.fill("31");
  await page.getByRole("button", { name: "Männlich" }).click();
  await expect(page.getByRole("button", { name: "Männlich" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await page.getByLabel("Gewicht").press("Enter");
  await expect(page.getByRole("status").getByText("Gespeichert")).toBeVisible();
  const { person } = await stored(page);
  expect(person).toMatchObject({
    age_years: 31,
    height_cm: 182,
    body_weight_kg: 78.5,
    sex: "male",
  });
  await expect(page.getByLabel("Gewicht")).toHaveValue("78,5");
});

test("Module: strength fixed, morning question only with Mobility, saved", async ({
  page,
}) => {
  await openCard(page, "modules");
  const chip = (name: string) => page.getByRole("button", { name });
  await expect(chip("Krafttraining")).toHaveAttribute("aria-pressed", "true");
  await expect(chip("Laufen")).toHaveAttribute("aria-pressed", "false");
  await expect(page.getByText("Morgenroutine dazu?")).toHaveCount(0);
  await chip("Mobility").click();
  await expect(chip("Mobility")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByText("Morgenroutine dazu?")).toBeVisible();
  await chip("Ja").click();
  await expect(chip("Ja")).toHaveAttribute("aria-pressed", "true");
  await chip("Mobility").click();
  await expect(page.getByText("Morgenroutine dazu?")).toHaveCount(0);
  await chip("Mobility").click();
  await chip("Laufen").click();
  await chip("Ja").click();
  await page.getByRole("button", { name: "Weiter" }).click();
  await expect(page.getByRole("status").getByText("Gespeichert")).toBeVisible();
  expect((await stored(page)).training.modules).toEqual({
    running: true,
    mobility: true,
    morning_routine: true,
  });
});

test("Checkliste: missing comes from the server and focus reads again", async ({
  page,
}) => {
  await openCard(page, "checklist");
  const card = page.locator('main[data-ocard="checklist"]');
  await expect(
    card.getByRole("heading", { name: "Das weiß ich schon" }),
  ).toBeVisible();
  await expect(card.getByText("fehlt noch").first()).toBeVisible();
  await expect(
    card.getByText("Antippen holt den neuesten Stand."),
  ).toBeVisible();
  await expect(card.getByRole("button")).toHaveCount(0);
  // The answer arrives behind the card's back; only a reload can show it.
  await callTool(page, "update_onboarding_profile", {
    request_id: `w-${Math.random().toString(36).slice(2)}`,
    profile: {
      path: "arnold_plan",
      training: { primary_goal: "strength", experience: "beginner" },
    },
  });
  await expect(card.getByText("Stärker werden")).toHaveCount(0);
  let reads = 0;
  page.on("request", (request) => {
    if ((request.postData() ?? "").includes("get_onboarding_state")) reads += 1;
  });
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(card.getByText("Stärker werden")).toBeVisible();
  expect(reads).toBeGreaterThanOrEqual(1);
  const after = reads;
  await card.click();
  await expect.poll(() => reads).toBeGreaterThan(after);
});

for (const theme of ["light", "dark"] as const)
  for (const card of ["person", "modules", "checklist"] as const)
    test(`${card} card: 375 px without overflow, contrast (${theme})`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: 375, height: 812 });
      await page.emulateMedia({ colorScheme: theme });
      await openCard(page, card);
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
      // Targets are at least 44 px high.
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
