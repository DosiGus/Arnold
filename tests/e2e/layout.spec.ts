import { test, expect, type FrameLocator, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { open } from "./host";

/**
 * Every screen and chat card of the views on a narrow phone (375 px), light
 * and dark: no Axe violation, nothing wider than the card, no page error. Reads
 * only, on the invented history (8850/8860) and a new account (8851/8861).
 */
test.use({ viewport: { width: 375, height: 812 } });

type App = FrameLocator;
type Case = {
  name: string;
  /** Which server: invented history or a new account. */
  server?: "new";
  query?: string;
  /** The way from the opened card to the screen. */
  go?: (app: App) => Promise<void>;
  /** Shows that the screen is there with its data. */
  ready: (app: App) => Promise<void>;
};

const heading = (name: string | RegExp) => async (app: App) =>
  await expect(app.getByRole("heading", { name }).first()).toBeVisible();
const click = (name: string | RegExp) => async (app: App) =>
  await app.getByRole("button", { name }).first().click();
const loaded = (app: App) =>
  expect(app.getByText(/wird geladen/i)).toHaveCount(0);

const screen = (
  name: string,
  button: string,
  title: string | RegExp,
): Case => ({
  name,
  go: click(button),
  ready: heading(title),
});
const card = (name: string, query: string, title: string | RegExp): Case => ({
  name,
  query,
  ready: heading(title),
});

const CASES: Case[] = [
  { name: "overview", ready: heading("Dein Überblick") },
  screen("records", "Alle Rekorde ansehen", "Rekorde"),
  screen("goals", "Ziel hinzufügen", "Ziele"),
  {
    name: "goal form",
    go: async (app) => {
      await click("Ziel hinzufügen")(app);
      // The overview has a heading "Ziele" too: wait for the goals screen.
      await expect(
        app.getByRole("textbox", { name: "Heutiges Körpergewicht" }),
      ).toBeVisible();
      await click("Ziel hinzufügen")(app);
    },
    ready: (app) =>
      expect(app.getByRole("button", { name: "Ziel speichern" })).toBeVisible(),
  },
  screen("progress", "Trainingsentwicklung ansehen", /entwicklung/i),
  screen("health", "Health Data", /Health/),
  screen("settings", "Einstellungen", "Einstellungen"),
  screen("plan", "Trainingsplan", /plan/i),
  {
    name: "training",
    query: "?card=today",
    ready: (app) => expect(app.getByRole("checkbox").first()).toBeVisible(),
  },
  card("exercise card", "?card=progress", "Übungsverlauf"),
  {
    name: "history with the set editor",
    query: "?card=history",
    go: async (app) => {
      await app.locator("button[aria-expanded]").first().click();
      await click("Satz korrigieren")(app);
    },
    ready: (app) =>
      expect(
        app.getByRole("textbox", { name: /Wiederholungen$/ }).first(),
      ).toBeVisible(),
  },
  card("plan change card", "?card=plan_change", /./),
  card("adjustment card", "?card=plan_adjustment", /Anpassung|./),
  ...["run_today", "run_week", "run_result", "run_stats", "run_setup"].map(
    (c) => card(c, `?tool=show_arnold_run&card=${c}`, /./),
  ),
  ...["mobility_today", "mobility_result", "mobility_setup"].map((c) =>
    card(c, `?tool=show_arnold_mobility&card=${c}`, /./),
  ),
  {
    name: "setup welcome",
    server: "new",
    query: "?tool=show_arnold_onboarding",
    ready: (app) =>
      expect(
        app.getByRole("button", { name: /Plan mit Arnold/ }),
      ).toBeVisible(),
  },
];

/**
 * Three colour pairs of Apps SDK UI itself stay below 4.5 : 1: the soft
 * success badge and the grey placeholder of a field or select (light), and the
 * red text of a ghost danger button on the dark chat background. They are the
 * library's tokens; every colour the views set themselves is measured.
 */
const libraryColour = (html: string, summary = "") =>
  /data-color="success"[^>]*data-variant="soft"/.test(html) ||
  /class="_TriggerText_/.test(html) ||
  /class="_Container_[^>]*data-has-end-adornment/.test(html) ||
  summary.includes("foreground color: #e02e2a, background color: #212121");

/** What sticks out of the card sideways (scrollable strips excepted). */
const tooWide = (page: Page) =>
  page.frames()[1]!.evaluate(() => {
    const out: string[] = [];
    const scrolls = (e: Element | null): boolean =>
      !!e &&
      e !== document.body &&
      (/(auto|scroll)/.test(getComputedStyle(e).overflowX) ||
        scrolls(e.parentElement));
    for (const e of document.querySelectorAll("body *")) {
      const box = e.getBoundingClientRect();
      if (!box.width || !box.height || scrolls(e.parentElement)) continue;
      if (e.closest(".sr-only, [aria-hidden='true']")) continue;
      if (box.right > innerWidth + 1 || box.left < -1)
        out.push(
          `${e.tagName} ${Math.round(box.left)}–${Math.round(box.right)}: ${(e.textContent ?? "").slice(0, 60)}`,
        );
    }
    for (const e of [
      document.documentElement,
      ...document.querySelectorAll("main"),
    ])
      if (e.scrollWidth > e.clientWidth + 1)
        out.push(`${e.tagName} scrolls sideways: ${e.scrollWidth}`);
    return out;
  });

for (const theme of ["light", "dark"] as const)
  for (const c of CASES)
    test(`${c.name} fits 375 px and passes Axe (${theme})`, async ({
      page,
    }, info) => {
      const first = info.project.name === "webkit" ? 8860 : 8850;
      const base = `http://127.0.0.1:${c.server === "new" ? first + 1 : first}`;
      await page.emulateMedia({ colorScheme: theme, reducedMotion: "reduce" });
      const query = `${c.query ?? ""}${c.query ? "&" : "?"}theme=${theme}`;
      const { app, errors } = await open(page, base, query);
      await c.go?.(app);
      await c.ready(app);
      await loaded(app);
      await expect(app.locator("html")).toHaveAttribute("data-theme", theme);
      // A card is transparent; behind it stands the chat's own background.
      await app.locator("body").evaluate((body, dark) => {
        body.style.background = dark ? "#212121" : "#ffffff";
      }, theme === "dark");
      // Let transitions end before colours are measured.
      await page.waitForTimeout(600);
      expect.soft(await tooWide(page)).toEqual([]);
      const axe = await new AxeBuilder({ page })
        .include(["iframe", "body"])
        // The card is part of the host's page: page-level rules do not apply.
        .disableRules(["region", "page-has-heading-one", "landmark-one-main"])
        .analyze();
      const found = axe.violations.flatMap((v) =>
        v.nodes
          .filter(
            (n) =>
              !(
                v.id === "color-contrast" &&
                libraryColour(n.html, n.failureSummary)
              ),
          )
          .map((n) => `${v.id}: ${n.html.slice(0, 200)} ${n.failureSummary}`),
      );
      expect(found).toEqual([]);
      expect(axe.passes.length).toBeGreaterThan(0);
      expect(errors).toEqual([]);
    });
