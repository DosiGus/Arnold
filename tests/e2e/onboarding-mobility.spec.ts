import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import {
  openWizard,
  wizard,
  callTool,
  choose,
  next,
  setRhythm,
  storedClaim,
} from "./helpers";

/**
 * MOB-011: the button way to the mobility answer. The page follows the wishes
 * while the server lists the question as open; the chat way (the answer saved
 * through the tool) and the button way end on the same "Das habe ich
 * verstanden" card. Everything is invented; no real data.
 */
const SHOTS = resolve("test-results/screens");
mkdirSync(SHOTS, { recursive: true });

const MOBILITY_TITLE = "Mobility oder Morgenroutine dazu?";

/** The required answers of the setup, as the chat would save them. */
const REQUIRED = {
  path: "arnold_plan",
  training: {
    primary_goal: "muscle_gain",
    experience: "beginner",
    days_per_week: 3,
    session_minutes: 60,
    environment: "home",
  },
} as const;

/** Walks the setup by buttons to the mobility page (home: no weights page). */
async function toMobilityPage(page: Page) {
  const main = wizard(page);
  await openWizard(page);
  await main
    .getByRole("button", { name: /^Plan mit Arnold erstellen/ })
    .click();
  await main.getByRole("button", { name: "Überspringen", exact: true }).click();
  await choose(page, "Muskeln aufbauen");
  await next(page);
  await choose(page, "Anfänger");
  await next(page);
  await setRhythm(page, 3, 60);
  await next(page);
  await choose(page, "Zuhause");
  await next(page);
  await expect(
    main.getByRole("heading", { name: "Deine Wünsche für den Plan" }),
  ).toBeVisible();
  await main.getByRole("button", { name: "Überspringen", exact: true }).click();
  await expect(
    main.getByRole("heading", { name: MOBILITY_TITLE }),
  ).toBeVisible();
}

const group = (page: Page, name: string) =>
  wizard(page).getByRole("group", { name, exact: true });
const chip = (page: Page, groupName: string, name: string) =>
  group(page, groupName).getByRole("button", { name, exact: true });
const state = async (page: Page) =>
  callTool(page, "get_onboarding_state", await storedClaim(page));
const understood = (page: Page) =>
  wizard(page).getByRole("heading", { name: "Das habe ich verstanden" });

test("the page appears after the wishes with the defaults and saves both wishes", async ({
  page,
}) => {
  await toMobilityPage(page);
  const main = wizard(page);
  // Nothing is asked beyond the first question until it is answered.
  await expect(group(page, MOBILITY_TITLE).getByRole("button")).toHaveCount(4);
  await expect(group(page, "Tage der Morgenroutine")).toHaveCount(0);
  await chip(page, MOBILITY_TITLE, "Beides").click();
  // The defaults: all seven days, 10 minutes, Arnold decides.
  for (const day of ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"])
    await expect(chip(page, "Tage der Morgenroutine", day)).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  await expect(
    chip(page, "Länge der Morgenroutine", "10 Min."),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(
    chip(page, "Lage der Mobility-Einheiten", "Arnold entscheidet"),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(main).toContainText("Sag zum Beispiel");
  // Weekend off, 5 minutes, after the strength training, two stiff areas.
  await chip(page, "Tage der Morgenroutine", "Sa").click();
  await chip(page, "Tage der Morgenroutine", "So").click();
  await chip(page, "Länge der Morgenroutine", "5 Min.").click();
  await chip(
    page,
    "Lage der Mobility-Einheiten",
    "Nach dem Krafttraining",
  ).click();
  await chip(page, "Steife Bereiche", "Hüfte").click();
  await chip(page, "Steife Bereiche", "Nacken").click();
  await next(page);
  await expect(
    main.getByRole("heading", { name: "So wird dein Plan" }),
  ).toBeVisible();
  await expect(main).toHaveAttribute("data-profile-save", "saved");
  const stored = await state(page);
  expect(stored.session.profile.training.mobility).toEqual({
    wants: true,
    morning: { weekdays: ["mon", "tue", "wed", "thu", "fri"], minutes: 5 },
    sessions: { placement: "after_strength", per_week: 2, minutes: 20 },
    stiff_areas: ["neck", "hips"],
  });
  expect(stored.open_questions.map((q: { id: string }) => q.id)).toEqual([]);
  // The card after a reload names the answer in words.
  await page.reload();
  await expect(understood(page)).toBeVisible();
  await expect(main).toContainText("Mo, Di, Mi, Do, Fr · 5 Min.");
  await expect(main).toContainText(
    "Nach dem Krafttraining · 2× pro Woche · 20 Min.",
  );
  await expect(main).toContainText("Nacken, Hüfte");
  await expect(main.locator(".cc-missing")).toHaveCount(0);
});

test('"Nein danke" stores wants=false and the card says so', async ({
  page,
}) => {
  await toMobilityPage(page);
  const main = wizard(page);
  await chip(page, MOBILITY_TITLE, "Nein danke").click();
  // Nothing else is asked after "Nein danke".
  await expect(group(page, "Tage der Morgenroutine")).toHaveCount(0);
  await expect(group(page, "Steife Bereiche")).toHaveCount(0);
  await next(page);
  await expect(
    main.getByRole("heading", { name: "So wird dein Plan" }),
  ).toBeVisible();
  await expect(main).toHaveAttribute("data-profile-save", "saved");
  const stored = await state(page);
  expect(stored.session.profile.training.mobility).toEqual({ wants: false });
  expect(stored.open_questions).toEqual([]);
  await page.reload();
  await expect(understood(page)).toBeVisible();
  await expect(main).toContainText("nicht gewünscht");
  await expect(main.locator(".cc-missing")).toHaveCount(0);
});

test("skipping stores nothing, the card shows it as open and never blocks the plan", async ({
  page,
}) => {
  await toMobilityPage(page);
  const main = wizard(page);
  await main.getByRole("button", { name: "Überspringen", exact: true }).click();
  await expect(
    main.getByRole("heading", { name: "So wird dein Plan" }),
  ).toBeVisible();
  const stored = await state(page);
  expect(stored.session.profile.training.mobility).toBeUndefined();
  expect(stored.open_questions.map((q: { id: string }) => q.id)).toEqual([
    "mobility",
  ]);
  await page.reload();
  await expect(understood(page)).toBeVisible();
  // The gap is visible, named by the server, and the plan can still be asked for.
  const gap = main.getByRole("listitem").filter({ hasText: "fehlt noch" });
  await expect(gap).toHaveCount(1);
  await expect(gap).toContainText("Mobility");
  await expect(
    main.getByRole("button", { name: "Plan erstellen", exact: true }),
  ).toBeVisible();
  // Screen readers hear the gap: the row is "Mobility ändern", described by it.
  await expect(
    main.getByRole("button", { name: "Mobility ändern", exact: true }),
  ).toHaveAccessibleDescription("fehlt noch");
  // A tap on the row opens the page; "Zurück" returns to the card.
  await main.getByRole("button", { name: "Mobility ändern" }).click();
  await expect(
    main.getByRole("heading", { name: MOBILITY_TITLE }),
  ).toBeVisible();
  await main
    .getByRole("button", { name: "Zurück", exact: true })
    .first()
    .click();
  await expect(understood(page)).toBeVisible();
});

test("only the stiff areas are asked while only those are open", async ({
  page,
}) => {
  await openWizard(page);
  const main = wizard(page);
  const claim = await storedClaim(page);
  await callTool(page, "update_onboarding_profile", {
    ...claim,
    request_id: crypto.randomUUID(),
    profile: {
      ...REQUIRED,
      training: {
        ...REQUIRED.training,
        mobility: {
          wants: true,
          morning: { weekdays: ["mon", "wed", "fri"], minutes: 5 },
          sessions: null,
          stiff_areas: [],
        },
      },
    },
  });
  await page.reload();
  await expect(understood(page)).toBeVisible();
  await expect(main).toContainText("Mo, Mi, Fr · 5 Min.");
  const gap = main.getByRole("listitem").filter({ hasText: "fehlt noch" });
  await expect(gap).toHaveCount(1);
  await expect(gap).toContainText("Steif");
  await main.getByRole("button", { name: "Formular öffnen" }).click();
  // The details question only: no wish buttons, just the areas.
  await expect(
    main.getByRole("heading", { name: "Wo fühlst du dich steif?", level: 2 }),
  ).toBeVisible();
  await expect(group(page, MOBILITY_TITLE)).toHaveCount(0);
  await chip(page, "Steife Bereiche", "Unterer Rücken").click();
  await next(page);
  await expect(
    main.getByRole("heading", { name: "So wird dein Plan" }),
  ).toBeVisible();
  const stored = await state(page);
  expect(stored.session.profile.training.mobility).toMatchObject({
    wants: true,
    morning: { weekdays: ["mon", "wed", "fri"], minutes: 5 },
    stiff_areas: ["lower_back"],
  });
  expect(stored.open_questions).toEqual([]);
});

test("the page is skipped when the server lists nothing open", async ({
  page,
}) => {
  await openWizard(page);
  const main = wizard(page);
  const claim = await storedClaim(page);
  await callTool(page, "update_onboarding_profile", {
    ...claim,
    request_id: crypto.randomUUID(),
    profile: {
      ...REQUIRED,
      training: { ...REQUIRED.training, mobility: { wants: false } },
    },
  });
  await page.reload();
  await expect(understood(page)).toBeVisible();
  await main.getByRole("button", { name: "Formular öffnen" }).click();
  // Everything is answered: the form goes straight to the review.
  await expect(
    main.getByRole("heading", { name: "So wird dein Plan" }),
  ).toBeVisible();
  await expect(main.getByRole("heading", { name: MOBILITY_TITLE })).toHaveCount(
    0,
  );
});

test("chat way and button way end on the same understood card", async ({
  page,
  context,
}) => {
  // Button way.
  await toMobilityPage(page);
  const main = wizard(page);
  await chip(page, MOBILITY_TITLE, "Morgenroutine").click();
  await chip(page, "Tage der Morgenroutine", "Sa").click();
  await chip(page, "Tage der Morgenroutine", "So").click();
  await chip(page, "Steife Bereiche", "Hüfte").click();
  await next(page);
  await expect(
    main.getByRole("heading", { name: "So wird dein Plan" }),
  ).toBeVisible();
  await expect(main).toHaveAttribute("data-profile-save", "saved");
  await page.reload();
  await expect(understood(page)).toBeVisible();
  const byButtons = await main.locator(".ac-rows").innerText();

  // Chat way: the same answers saved through the tool in a second tab.
  const chat = await context.newPage();
  await openWizard(chat);
  await callTool(chat, "update_onboarding_profile", {
    ...(await storedClaim(chat)),
    request_id: crypto.randomUUID(),
    profile: {
      ...REQUIRED,
      training: {
        ...REQUIRED.training,
        mobility: {
          wants: true,
          morning: {
            weekdays: ["mon", "tue", "wed", "thu", "fri"],
            minutes: 10,
          },
          sessions: null,
          stiff_areas: ["hips"],
        },
      },
    },
  });
  await chat.reload();
  await expect(understood(chat)).toBeVisible();
  const byChat = await wizard(chat).locator(".ac-rows").innerText();
  expect(byButtons).toContain("Mo, Di, Mi, Do, Fr · 10 Min.");
  expect(byChat).toBe(byButtons);
  const left = await state(page);
  const right = await state(chat);
  expect(left.session.profile.training.mobility).toEqual(
    right.session.profile.training.mobility,
  );
  expect(left.open_questions).toEqual(right.open_questions);
});

test("the whole page works with the keyboard alone", async ({ page }) => {
  await toMobilityPage(page);
  const main = wizard(page);
  /** Tabs until the focused element has this name (or fails after 60 tabs). */
  const tabTo = async (name: string) => {
    for (let i = 0; i < 60; i++) {
      await page.keyboard.press("Tab");
      const focused = await page.evaluate(() => {
        const el = document.activeElement as HTMLElement | null;
        return el?.getAttribute("aria-label") ?? el?.textContent?.trim() ?? "";
      });
      if (focused === name) return;
    }
    throw new Error(`Focus never reached "${name}".`);
  };
  await tabTo("Beides");
  await page.keyboard.press("Space");
  await expect(chip(page, MOBILITY_TITLE, "Beides")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await tabTo("Mo");
  await page.keyboard.press("Space");
  await expect(chip(page, "Tage der Morgenroutine", "Mo")).toHaveAttribute(
    "aria-pressed",
    "false",
  );
  await tabTo("15 Min.");
  await page.keyboard.press("Enter");
  await tabTo("Eigene Tage");
  await page.keyboard.press("Space");
  await tabTo("Handgelenke");
  await page.keyboard.press("Space");
  await tabTo("Weiter");
  await page.keyboard.press("Enter");
  await expect(
    main.getByRole("heading", { name: "So wird dein Plan" }),
  ).toBeVisible();
  await expect(main).toHaveAttribute("data-profile-save", "saved");
  expect((await state(page)).session.profile.training.mobility).toEqual({
    wants: true,
    morning: {
      weekdays: ["tue", "wed", "thu", "fri", "sat", "sun"],
      minutes: 15,
    },
    sessions: { placement: "own_days", per_week: 2, minutes: 20 },
    stiff_areas: ["wrists"],
  });
});

for (const width of [375, 720])
  for (const theme of ["light", "dark"] as const)
    test(`mobility page and understood card at ${width} px in ${theme} mode are readable and accessible`, async ({
      page,
      browserName,
    }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ colorScheme: theme });
      await toMobilityPage(page);
      await page.evaluate(
        (theme) => (document.documentElement.dataset.theme = theme),
        theme,
      );
      await chip(page, MOBILITY_TITLE, "Beides").click();
      await chip(page, "Steife Bereiche", "Waden/Sprunggelenke").click();
      const check = async (name: string) => {
        const overflow = await page.evaluate(
          () =>
            document.documentElement.scrollWidth -
            document.documentElement.clientWidth,
        );
        expect(overflow).toBeLessThanOrEqual(0);
        await page.screenshot({
          path: `${SHOTS}/${browserName}-setup-mobility-${name}-${width}-${theme}.png`,
          fullPage: true,
          animations: "disabled",
        });
        const a11y = await new AxeBuilder({ page }).analyze();
        expect(
          a11y.violations.filter((v) =>
            ["critical", "serious"].includes(v.impact ?? ""),
          ),
        ).toEqual([]);
      };
      await check("page");
      // The card with a stored answer and the open question.
      await wizard(page)
        .getByRole("button", { name: "Überspringen", exact: true })
        .click();
      await expect(wizard(page)).toContainText("So wird dein Plan");
      await page.reload();
      await expect(understood(page)).toBeVisible();
      await expect(wizard(page).locator(".cc-missing")).toHaveCount(1);
      await check("card");
    });
