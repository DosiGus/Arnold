import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { callTool } from "./helpers";
import { berlinToday } from "../fixtures/berlin-today";

/**
 * UX-008, the card "Anpassung auf Zeit" (card "plan_adjustment") and the hint
 * in the overview. A writable synthetic tracker per browser project; every
 * test cancels what it created. The period starts on the Berlin day of the
 * run, so the result does not depend on the time of day.
 */
const baseFor = (project: string) =>
  project === "webkit" ? "http://127.0.0.1:8835" : "http://127.0.0.1:8834";

type View = {
  adjustment: {
    plan_adjustment_id: string;
    row_revision: number;
    status: string;
  };
};
let n = 0;
const rid = () => `ux008-${Date.now()}-${n++}`;

const plusDays = (date: string, days: number) => {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

async function cancelAll(page: Page) {
  const list = (await callTool(page, "get_plan_adjustments")) as {
    adjustments: View[];
  };
  for (const { adjustment } of list.adjustments)
    await callTool(page, "cancel_plan_adjustment", {
      request_id: rid(),
      plan_adjustment_id: adjustment.plan_adjustment_id,
      expected_row_revision: adjustment.row_revision,
    });
}

/** A draft for two weeks from today, made like the model does. */
async function draft(page: Page) {
  const today = berlinToday();
  const created = (await callTool(page, "create_plan_adjustment", {
    request_id: rid(),
    timezone: "Europe/Berlin",
    kind: "range",
    start_date_local: today,
    end_date_local: plusDays(today, 13),
    sessions_per_week: 2,
    minutes_per_session: 30,
    reason: "Urlaub",
  })) as { ok: boolean; error?: unknown };
  expect(created.ok, JSON.stringify(created.error)).toBe(true);
  return today;
}

async function open(page: Page, base: string) {
  await page.goto(`${base}/preview?card=plan_adjustment`);
  await expect(page.locator('main[data-card="plan_adjustment"]')).toBeVisible();
}
const confirmButton = (page: Page) =>
  page.getByRole("button", { name: "Bestätigen", exact: true });

test.describe("card Anpassung auf Zeit", () => {
  test.beforeEach(async ({ page }, info) => {
    await page.goto(`${baseFor(info.project.name)}/preview?card=home`);
    await cancelAll(page);
  });

  test("shows period, sessions, old → new and the way back; only the click makes it apply", async ({
    page,
  }, info) => {
    const base = baseFor(info.project.name);
    await draft(page);
    await open(page, base);
    const card = page.locator("main");
    await expect(card.getByText("Anpassung auf Zeit").first()).toBeVisible();
    await expect(card.getByRole("heading", { name: "Urlaub" })).toBeVisible();
    await expect(card.getByText(/ bis /).first()).toBeVisible();
    await expect(
      card.getByText(/^Ab .+ gilt wieder dein normaler Plan\.$/),
    ).toBeVisible();
    await expect(
      card.getByRole("list", { name: "Das ändert sich" }).getByRole("listitem"),
    ).not.toHaveCount(0);
    // Looking at the card changes nothing.
    expect(
      ((await callTool(page, "get_plan_adjustments")) as { running: unknown })
        .running,
    ).toBeNull();
    await confirmButton(page).click();
    await expect(page.getByText("Gilt jetzt")).toBeVisible();
    await expect(page.getByText("Gespeichert")).toBeVisible();
    expect(
      ((await callTool(page, "get_plan_adjustments")) as { running: unknown })
        .running,
    ).not.toBeNull();

    // The overview names it while it runs, with the way back.
    await page.goto(`${base}/preview?card=home`);
    const hint = page
      .getByRole("note")
      .filter({ hasText: "Anpassung auf Zeit" });
    await expect(hint).toContainText("gilt wieder dein normaler Plan");
    await hint.getByRole("button", { name: "Ansehen" }).click();
    await expect(
      page.locator('main[data-card="plan_adjustment"]'),
    ).toBeVisible();

    // Cancelling applies at once; the hint is gone.
    await page.getByRole("button", { name: "Absagen" }).click();
    await expect(
      page.getByText("Abgesagt. Es gilt wieder dein normaler Plan."),
    ).toBeVisible();
    await page.goto(`${base}/preview?card=home`);
    await expect(
      page.getByRole("note").filter({ hasText: "Anpassung auf Zeit" }),
    ).toHaveCount(0);
  });

  test("declining a draft keeps the normal plan", async ({ page }, info) => {
    const base = baseFor(info.project.name);
    await draft(page);
    await open(page, base);
    await page.getByRole("button", { name: "Absagen" }).click();
    await expect(
      page.getByText("Abgesagt. Es gilt wieder dein normaler Plan."),
    ).toBeVisible();
    expect(
      ((await callTool(page, "get_plan_adjustments")) as { adjustments: [] })
        .adjustments,
    ).toHaveLength(0);
  });

  test("without an adjustment the normal plan applies", async ({
    page,
  }, info) => {
    await open(page, baseFor(info.project.name));
    await expect(page.getByText("Es gilt dein normaler Plan")).toBeVisible();
    await expect(confirmButton(page)).toHaveCount(0);
  });

  for (const scheme of ["light", "dark"] as const)
    test(`no accessibility violations, ${scheme}`, async ({ page }, info) => {
      const base = baseFor(info.project.name);
      await page.emulateMedia({ colorScheme: scheme });
      await draft(page);
      await open(page, base);
      await expect(confirmButton(page)).toBeVisible();
      const result = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa"])
        .analyze();
      expect(result.violations.map((v) => v.id)).toEqual([]);
      if (info.project.name === "chromium" && process.env.UX008_SHOTS) {
        const dir = join(
          homedir(),
          "Library/Application Support/Claude/side-session-notes/arn-ux",
        );
        mkdirSync(dir, { recursive: true });
        await page.setViewportSize({ width: 420, height: 760 });
        await page.locator("main").screenshot({
          path: join(
            dir,
            `UX-008-${scheme === "light" ? "hell" : "dunkel"}.png`,
          ),
        });
      }
    });
});
