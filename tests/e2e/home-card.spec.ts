import { test, expect, type Page, type Route } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { callTool } from "./helpers";
import type { ArnoldDashboardView } from "../../src/shared/arnold-view";
import { berlinToday } from "../fixtures/berlin-today";

/**
 * The start card: header line, four tiles whose detail opens in the card, and
 * four action buttons that send one fixed sentence into the chat. Read-only
 * on the fixture with history (8804) and the empty one (8793).
 */
const BASE = "http://127.0.0.1:8804";
const EMPTY = "http://127.0.0.1:8793";
const SENTENCES = {
  "Nächstes Training": "Zeig mir mein nächstes Training.",
  "Plan ändern": "Ich möchte meinen Plan ändern.",
  "Urlaub oder Ausnahme": "Ich habe eine Ausnahme, zum Beispiel Urlaub.",
  "Ziel anpassen": "Ich möchte ein Ziel anpassen.",
} as const;
const tile = (page: Page, name: string) =>
  page.getByRole("button", { name: new RegExp(`^${name}`) });
const main = (page: Page) => page.locator("main");
const today = () => berlinToday();

const reply = (route: Route, value: unknown) =>
  route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: route.request().postDataJSON().id,
      result: { content: [], structuredContent: value },
    }),
  });
const derived = {
  experience: "beginner",
  reference_valid: false,
  reference_reason: "reference_missing",
  reference_valid_until: null,
  vdot: null,
  pace_zones: null,
};
async function runProfile(page: Page, hasProfile: boolean) {
  const opened: unknown[] = [];
  await page.route("**/mcp", async (route) => {
    const body = route.request().postDataJSON();
    if (body?.method !== "tools/call") return route.continue();
    if (body.params.name === "get_run_profile")
      return reply(route, {
        profile: hasProfile
          ? {
              run_profile_id: "rp-1",
              row_revision: 2,
              goal: "10k",
              race_date: null,
              target_time_s: null,
              reference: null,
              running_experience_months: null,
              runs_per_week: 3,
              long_run_weekday: null,
              preferred_environment: "outdoor",
              base_minutes_per_week: null,
              longest_run_4w_min: null,
              alarm_settings: null,
            }
          : null,
        derived,
        missing: [],
      });
    if (body.params.name === "show_arnold_run") {
      opened.push(body.params.arguments);
      return reply(route, {
        run_card_contract: "arnold.run_card/1",
        card: "run_setup",
        workout_id: null,
      });
    }
    return route.continue();
  });
  return opened;
}

test("a tile opens its detail in the same card, only one at a time", async ({
  page,
}) => {
  await page.goto(`${BASE}/preview?card=home`);
  const view = (await callTool(
    page,
    "get_arnold_dashboard",
    {},
  )) as ArnoldDashboardView;
  const names = ["Woche", "Scores", "Ziele", "Rekorde"];
  for (const name of names) {
    await expect(tile(page, name)).toHaveAttribute("aria-expanded", "false");
    await expect(tile(page, name)).toHaveAttribute("aria-controls", /.+/);
  }
  await tile(page, "Woche").click();
  await expect(tile(page, "Woche")).toHaveAttribute("aria-expanded", "true");
  await expect(main(page)).toHaveAttribute("data-card", "home");
  await expect(
    page.getByRole("region", { name: "Woche im Detail" }),
  ).toContainText("Sag zum Beispiel");
  await tile(page, "Rekorde").click();
  await expect(tile(page, "Woche")).toHaveAttribute("aria-expanded", "false");
  await expect(tile(page, "Rekorde")).toHaveAttribute("aria-expanded", "true");
  await expect(page.locator(".ac-home-detail")).toHaveCount(1);
  const records = page.getByRole("region", { name: "Rekorde im Detail" });
  // Only what the view delivers: names, lifts and dates, nothing computed.
  for (const r of view.home.records.slice(0, 3))
    await expect(records).toContainText(r.exercise_name);
  await tile(page, "Rekorde").click();
  await expect(page.locator(".ac-home-detail")).toHaveCount(0);
  await tile(page, "Scores").click();
  const scores = page.getByRole("region", { name: "Scores im Detail" });
  await expect(scores).toContainText("Konstanz");
  await tile(page, "Ziele").click();
  await expect(
    page.getByRole("region", { name: "Ziele im Detail" }),
  ).toBeVisible();
});

test("the scores tile shows the server's values, each with its sentence", async ({
  page,
}) => {
  await page.goto(`${BASE}/preview?card=home`);
  const view = (await callTool(
    page,
    "get_arnold_dashboard",
    {},
  )) as ArnoldDashboardView;
  const s = view.scores!;
  const shown = [s.consistency, s.progress, s.recovery].map((x) =>
    x.value === null ? "–" : String(x.value),
  );
  await expect(tile(page, "Scores")).toContainText(shown.join(" · "));
  await expect(tile(page, "Scores")).toContainText(
    "Konstanz · Fortschritt · Erholung",
  );
  await tile(page, "Scores").click();
  const detail = page.getByRole("region", { name: "Scores im Detail" });
  const items = detail.getByRole("listitem");
  await expect(items).toHaveCount(3);
  await expect(items.nth(0)).toContainText("Konstanz:");
  await expect(items.nth(1)).toContainText("Fortschritt:");
  await expect(items.nth(2)).toContainText("Erholung:");
  if (s.consistency.status === "ok")
    await expect(items.nth(0)).toContainText(
      `In ${s.consistency.weeks_goal_met} von ${s.consistency.weeks_counted} Wochen Wochenziel erreicht.`,
    );
  // The fixture has no watch: recovery is estimated from training only.
  if (s.recovery.status === "ok")
    await expect(items.nth(2)).toContainText(
      "Nur aus deinem Training geschätzt.",
    );
  await expect(detail).not.toContainText(/Demo-|NaN|undefined|null/);
});

test("a new account sees too little data in the scores, never 0", async ({
  page,
}) => {
  await page.goto(`${EMPTY}/preview?card=home`);
  await expect(tile(page, "Scores")).toContainText("– · – · –");
  await tile(page, "Scores").click();
  const detail = page.getByRole("region", { name: "Scores im Detail" });
  await expect(detail.getByText("zu wenig Daten", { exact: true })).toHaveCount(
    3,
  );
  await expect(detail).toContainText(
    "Noch zu wenig Daten: Es gibt noch kein Training.",
  );
  await expect(detail).not.toContainText(/\b0 von 100|Demo-/);
});

test("tiles work by keyboard and show a focus ring", async ({ page }) => {
  await page.goto(`${BASE}/preview?card=home`);
  const woche = tile(page, "Woche");
  await woche.focus();
  expect(
    await woche.evaluate((el) => getComputedStyle(el).outlineStyle),
  ).not.toBe("none");
  await page.keyboard.press("Enter");
  await expect(woche).toHaveAttribute("aria-expanded", "true");
  await page.keyboard.press("Space");
  await expect(woche).toHaveAttribute("aria-expanded", "false");
});

test("record and goal rows keep their exact identity through navigation", async ({
  page,
}) => {
  await page.goto(`${BASE}/preview?card=home`);
  const view = (await callTool(
    page,
    "get_arnold_dashboard",
    {},
  )) as ArnoldDashboardView;
  await tile(page, "Rekorde").click();
  await page
    .getByRole("region", { name: "Rekorde im Detail" })
    .locator("li")
    .nth(1)
    .getByRole("button", { name: /^Training ansehen/ })
    .click();
  await expect(main(page)).toHaveAttribute("data-card", "history");
  const expected = view.recent_workouts.find(
    (w) => w.workout_id === view.home.records[1].workout_id,
  );
  if (expected)
    await expect(
      page.locator('.ac-history-row[aria-expanded="true"]'),
    ).toContainText(expected.title);
  await page.goto(`${BASE}/preview?card=home`);
  await tile(page, "Ziele").click();
  const goal = view.home.goals[0];
  await page
    .getByRole("region", { name: "Ziele im Detail" })
    .getByRole("button", { name: new RegExp(`^${goal.name}:`) })
    .click();
  await expect(
    page.getByRole("region", { name: `Ziel ${goal.name}`, exact: true }),
  ).toBeVisible();
});

test("each action button sends exactly its sentence, once", async ({
  page,
}) => {
  await page.goto(`${BASE}/host?card=home`);
  const app = page.frameLocator("iframe");
  await expect(app.locator(".ac-home-tile").first()).toBeVisible();
  const messages = page.locator("#host-messages li");
  await expect(messages).toHaveCount(0);
  let sent = 0;
  for (const [label, sentence] of Object.entries(SENTENCES)) {
    const button = app.getByRole("button", { name: label, exact: true });
    await button.dblclick();
    sent += 1;
    await expect(messages).toHaveCount(sent);
    await expect(messages.nth(sent - 1)).toHaveText(sentence);
    await expect(button).toBeDisabled();
  }
  await expect(messages).toHaveCount(4);
});

test("without a chat the buttons take the card way, vacation shows a hint", async ({
  page,
}) => {
  await page.goto(`${BASE}/preview?card=home`);
  await page.getByRole("button", { name: "Plan ändern", exact: true }).click();
  await expect(main(page)).toHaveAttribute("data-card", "plan");
  await page.goto(`${BASE}/preview?card=home`);
  await page
    .getByRole("button", { name: "Ziel anpassen", exact: true })
    .click();
  await expect(main(page)).toHaveAttribute("data-card", "goals");
  await page.goto(`${BASE}/preview?card=home`);
  await page
    .getByRole("button", { name: "Nächstes Training", exact: true })
    .click();
  await expect(main(page)).toHaveAttribute("data-card", "today");
  await page.goto(`${BASE}/preview?card=home`);
  await page
    .getByRole("button", { name: "Urlaub oder Ausnahme", exact: true })
    .click();
  await expect(main(page)).toHaveAttribute("data-card", "home");
  await expect(page.getByRole("status").last()).toContainText("im Chat");
});

test("a new account sees honest empty states", async ({ page }) => {
  await page.goto(`${EMPTY}/preview?card=home`);
  await expect(
    page.getByText("Dein erstes Training ist der Anfang."),
  ).toBeVisible();
  await expect(tile(page, "Rekorde")).toContainText("Noch keine Rekorde");
  await expect(tile(page, "Ziele")).toContainText("Noch keine Ziele");
  await expect(tile(page, "Woche")).toContainText("0");
  await tile(page, "Rekorde").click();
  await expect(
    page.getByRole("region", { name: "Rekorde im Detail" }),
  ).toContainText("Noch keine Rekorde");
  await expect(page.locator("main")).not.toContainText(/NaN|undefined|null/);
});

test("after today's workout the card shows the saved state", async ({
  page,
}) => {
  await page.route("**/mcp", async (route) => {
    const body = route.request().postDataJSON();
    if (
      body?.params?.name !== "show_arnold_dashboard" &&
      body?.params?.name !== "get_arnold_dashboard"
    )
      return route.continue();
    const response = await route.fetch();
    const json = await response.json();
    const recent = json.result?.structuredContent?.recent_workouts;
    if (recent?.length) {
      recent[0].date = today();
      recent[0].status = "completed";
    }
    await route.fulfill({ response, json });
  });
  await page.goto(`${BASE}/preview?card=home`);
  await expect(
    page.getByRole("region", { name: "Dein Training", exact: true }),
  ).toContainText("Training gespeichert");
});

test("'Ich will auch laufen' appears only without a run profile", async ({
  page,
}) => {
  const opened = await runProfile(page, false);
  await page.goto(`${BASE}/preview?card=home`);
  const link = page.getByRole("button", { name: "Ich will auch laufen" });
  await expect(link).toBeVisible();
  await link.click();
  await expect.poll(() => opened.length).toBe(1);
  expect(opened[0]).toEqual({ card: "run_setup" });
  const second = await page.context().newPage();
  await runProfile(second, true);
  await second.goto(`${BASE}/preview?card=home`);
  await expect(second.locator(".ac-home-tile").first()).toBeVisible();
  await expect(
    second.getByRole("button", { name: "Ich will auch laufen" }),
  ).toHaveCount(0);
});

for (const theme of ["light", "dark"] as const) {
  test(`open detail fits 375 px and stays accessible (${theme})`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.emulateMedia({ colorScheme: theme, reducedMotion: "reduce" });
    for (const name of ["Woche", "Scores", "Ziele", "Rekorde"]) {
      await page.goto(`${BASE}/preview?card=home`);
      await tile(page, name).click();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
        `${name}/${theme} overflows`,
      ).toBe(true);
      const results = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa"])
        .analyze();
      expect(results.violations.map((v) => `${name}: ${v.id}`)).toEqual([]);
    }
    if (process.env.UX_SHOTS) {
      const dir = join(
        homedir(),
        "Library/Application Support/Claude/side-session-notes/arn-ux",
      );
      mkdirSync(dir, { recursive: true });
      await page.goto(`${BASE}/preview?card=home`);
      await tile(page, "Rekorde").click();
      await page.screenshot({
        path: join(dir, `UX-002-${theme === "light" ? "hell" : "dunkel"}.png`),
        fullPage: true,
      });
      await page.goto(`${BASE}/preview?card=home`);
      await tile(page, "Scores").click();
      await page.screenshot({
        path: join(dir, `UX-009-${theme === "light" ? "hell" : "dunkel"}.png`),
        fullPage: true,
      });
    }
  });
}
