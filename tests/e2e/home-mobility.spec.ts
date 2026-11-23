import { test, expect, type Page, type Route } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

/**
 * MOB-013: the Morgenroutine line and the one-time offer on the start screen,
 * and mobility in the plan view. The fixture server has no mobility service,
 * so the mobility tools are answered here with invented data and the start
 * screen payload is patched; every word on screen must come from these
 * answers. The offer is stored as `wants: false` by "Nein danke" and must not
 * come back, also not after a reload.
 */
const BASE = "http://127.0.0.1:8804";
const SHOTS = resolve("test-results/screens");
mkdirSync(SHOTS, { recursive: true });

type State = "not_asked" | "no" | "yes";
type Line = {
  morning: "open" | "done" | null;
  sessions_open: number;
  adherence: {
    ratio: number | null;
    streak_days: number;
    planned_count: number;
    done_count: number;
    days: number;
  };
  line: string;
};

const openLine = (over: Partial<Line> = {}): Line => ({
  morning: "open",
  sessions_open: 0,
  adherence: {
    ratio: 0.79,
    streak_days: 3,
    planned_count: 14,
    done_count: 11,
    days: 28,
  },
  line: "Morgenroutine noch offen · 3 Tage in Folge",
  ...over,
});

const overview = (state: State) => ({
  profile: {
    state,
    preference:
      state === "not_asked"
        ? null
        : state === "no"
          ? { wants: false }
          : {
              wants: true,
              morning: { weekdays: ["mon", "wed", "fri"], minutes: 10 },
              sessions: null,
              stiff_areas: [],
            },
  },
  today: { date_local: "2026-11-23", items: [] },
  adherence: {
    planned_count: 0,
    done_count: 0,
    ratio: null,
    streak_days: 0,
    days: 28,
  },
  recent: [],
});

const json = (route: Route, structured: unknown, isError = false) =>
  route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: route.request().postDataJSON().id,
      result: {
        content: [],
        ...(structured === undefined ? {} : { structuredContent: structured }),
        ...(isError
          ? {
              isError: true,
              _meta: {
                arnold: {
                  code: "STORAGE_UNAVAILABLE",
                  retryable: true,
                  recovery: "retry_same_request",
                },
              },
            }
          : {}),
      },
    }),
  });

type Mocks = {
  /** The stored profile; "no" after "Nein danke". */
  state: { value: State };
  /** The line the start screen payload carries; absent = no mobility. */
  line?: Line;
  /** Which mobility card `show_arnold_mobility` opens. */
  card?: string;
  /** Mobility routines added to the plan context. */
  mobilitySessions?: unknown[];
  failWrite?: boolean;
};

async function mock(page: Page, mocks: Mocks) {
  const calls = {
    overview: 0,
    shown: [] as string[],
    writes: [] as { tool: string; args: Record<string, any> }[],
  };
  await page.route("**/mcp", async (route) => {
    const body = route.request().postDataJSON();
    if (body?.method !== "tools/call") return route.continue();
    const tool = body.params.name as string;
    const args = (body.params.arguments ?? {}) as Record<string, any>;
    if (tool === "get_mobility_overview") {
      calls.overview += 1;
      return json(route, overview(mocks.state.value));
    }
    if (tool === "show_arnold_mobility") {
      calls.shown.push(args.card);
      return json(route, {
        mobility_card_contract: "arnold.mobility_card/1",
        card: args.card,
        workout_id: null,
      });
    }
    if (tool === "update_mobility_profile") {
      calls.writes.push({ tool, args });
      if (mocks.failWrite) return json(route, undefined, true);
      mocks.state.value = args.preference?.wants ? "yes" : "no";
      return json(route, {
        ok: true,
        replayed: false,
        profile: overview(mocks.state.value).profile,
        error: null,
      });
    }
    const patch =
      tool === "show_arnold_dashboard" || tool === "get_arnold_dashboard"
        ? (value: any) => {
            if (mocks.line) value.home.mobility = mocks.line;
          }
        : tool === "get_plan_editor_context" && mocks.mobilitySessions
          ? (value: any) => {
              value.plan.mobility_sessions = mocks.mobilitySessions;
            }
          : undefined;
    if (!patch) return route.continue();
    const response = await route.fetch();
    const payload = await response.json();
    if (payload.result?.structuredContent)
      patch(payload.result.structuredContent);
    return route.fulfill({ response, json: payload });
  });
  return calls;
}

const training = (page: Page) =>
  page.getByRole("region", { name: "Dein Training", exact: true });
const offer = (page: Page) =>
  page.getByRole("region", { name: "Mobility dazunehmen" });
const line = (page: Page) =>
  training(page).getByRole("button", { name: /^Morgenroutine:/ });

async function openHome(page: Page) {
  await page.goto(`${BASE}/preview?card=home`);
  await expect(page.locator('main[data-card="home"]')).toBeVisible();
}
async function noOverflow(page: Page) {
  const overflow = await page.evaluate(
    () =>
      document.documentElement.scrollWidth -
      document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
}
const settle = async (page: Page, calls: { overview: number }) => {
  await expect.poll(() => calls.overview).toBeGreaterThan(0);
  await page.waitForTimeout(200);
};

test("the offer appears only for a profile that was never asked", async ({
  page,
}) => {
  const state = { value: "not_asked" as State };
  const calls = await mock(page, { state });
  await openHome(page);
  await expect(offer(page)).toBeVisible();
  await expect(
    offer(page).getByText("Mobility oder Morgenroutine dazunehmen?"),
  ).toBeVisible();
  await expect(offer(page).getByRole("button", { name: "Ja" })).toBeVisible();
  await expect(
    offer(page).getByRole("button", { name: "Nein danke" }),
  ).toBeVisible();
  await expect(line(page)).toHaveCount(0);

  // "no": asked before, no offer.
  const second = await page.context().newPage();
  const noState = { value: "no" as State };
  const noCalls = await mock(second, { state: noState });
  await openHome(second);
  await settle(second, noCalls);
  await expect(offer(second)).toHaveCount(0);
  await expect(second.getByText("Morgenroutine")).toHaveCount(0);

  // "yes" with a line: the line, no offer, not even a read.
  const third = await page.context().newPage();
  const yesState = { value: "yes" as State };
  const yesCalls = await mock(third, {
    state: yesState,
    line: openLine(),
  });
  await openHome(third);
  await expect(line(third)).toBeVisible();
  await expect(offer(third)).toHaveCount(0);
  expect(yesCalls.overview).toBe(0);
  expect(calls.writes).toEqual([]);
});

test("a failed profile read shows no offer", async ({ page }) => {
  await page.route("**/mcp", async (route) => {
    const body = route.request().postDataJSON();
    if (
      body?.method === "tools/call" &&
      body.params.name === "get_mobility_overview"
    )
      return json(route, undefined, true);
    return route.continue();
  });
  await openHome(page);
  await page.waitForTimeout(400);
  await expect(offer(page)).toHaveCount(0);
});

test("'Nein danke' stores wants:false and the offer stays away after a reload", async ({
  page,
}) => {
  const state = { value: "not_asked" as State };
  const calls = await mock(page, { state });
  await openHome(page);
  await offer(page).getByRole("button", { name: "Nein danke" }).click();
  await expect(offer(page)).toHaveCount(0);
  expect(calls.writes).toHaveLength(1);
  expect(calls.writes[0].tool).toBe("update_mobility_profile");
  expect(calls.writes[0].args.preference).toEqual({ wants: false });
  expect(typeof calls.writes[0].args.request_id).toBe("string");
  expect(calls.writes[0].args.request_id.length).toBeGreaterThan(0);
  const reads = calls.overview;
  await page.reload();
  await expect(page.locator('main[data-card="home"]')).toBeVisible();
  await expect.poll(() => calls.overview).toBeGreaterThan(reads);
  await page.waitForTimeout(200);
  await expect(offer(page)).toHaveCount(0);
  expect(calls.writes).toHaveLength(1);
});

test("a failed 'Nein danke' says so, keeps the offer and can be repeated", async ({
  page,
}) => {
  const state = { value: "not_asked" as State };
  const mocks: Mocks = { state, failWrite: true };
  const calls = await mock(page, mocks);
  await openHome(page);
  await offer(page).getByRole("button", { name: "Nein danke" }).click();
  await expect(offer(page).getByRole("alert")).toBeVisible();
  await expect(offer(page)).toBeVisible();
  mocks.failWrite = false;
  await offer(page).getByRole("button", { name: "Nein danke" }).click();
  await expect(offer(page)).toHaveCount(0);
  // The retry keeps the request_id: nothing is stored twice.
  expect(calls.writes).toHaveLength(2);
  expect(calls.writes[1].args.request_id).toBe(calls.writes[0].args.request_id);
});

test("'Ja' without a chat opens the setup card", async ({ page }) => {
  const state = { value: "not_asked" as State };
  const calls = await mock(page, { state });
  await openHome(page);
  await offer(page).getByRole("button", { name: "Ja" }).click();
  await expect.poll(() => calls.shown).toEqual(["mobility_setup"]);
  // Nothing was stored by "Ja".
  expect(calls.writes).toEqual([]);
});

test("the Morgenroutine line shows open and done, and opens the card", async ({
  page,
}) => {
  const state = { value: "yes" as State };
  const calls = await mock(page, { state, line: openLine() });
  await openHome(page);
  await expect(line(page)).toContainText("Heute noch offen");
  await expect(line(page)).toContainText(
    "Dranbleiben: 11 von 14 Routinen in 28 Tagen, 3 Tage in Folge.",
  );
  await line(page).click();
  await expect.poll(() => calls.shown).toEqual(["mobility_today"]);

  const second = await page.context().newPage();
  await mock(second, {
    state,
    line: openLine({ morning: "done" }),
  });
  await openHome(second);
  const done = line(second);
  await expect(done).toContainText("Heute erledigt");
  await expect(done).toHaveAccessibleName(/heute erledigt/);
  // Keyboard: Enter on the focused line opens the card.
  const third = await page.context().newPage();
  const keyCalls = await mock(third, { state, line: openLine() });
  await openHome(third);
  await line(third).focus();
  await third.keyboard.press("Enter");
  await expect.poll(() => keyCalls.shown).toEqual(["mobility_today"]);
});

test("without a plan the line says 'noch kein Plan', never 0", async ({
  page,
}) => {
  await mock(page, {
    state: { value: "yes" },
    line: openLine({
      morning: null,
      adherence: {
        ratio: null,
        streak_days: 0,
        planned_count: 0,
        done_count: 0,
        days: 28,
      },
      line: "Mobility ist eingerichtet.",
    }),
  });
  await openHome(page);
  const row = training(page).getByRole("button", { name: /^Mobility:/ });
  await expect(row).toContainText("Dranbleiben: noch kein Plan.");
  await expect(row).not.toContainText(/\b0 von\b|\b0 Routinen/);
});

test("mobility does not count as a training day", async ({ page }) => {
  const state = { value: "yes" as State };
  await mock(page, { state });
  await openHome(page);
  const before = await page
    .getByRole("button", { name: /^Woche/ })
    .locator(".ac-widget-ring")
    .getAttribute("aria-label");
  const second = await page.context().newPage();
  await mock(second, { state, line: openLine({ morning: "done" }) });
  await openHome(second);
  await expect(
    second.getByRole("button", { name: /^Woche/ }).locator(".ac-widget-ring"),
  ).toHaveAttribute("aria-label", before!);
});

for (const theme of ["light", "dark"] as const)
  for (const width of [375, 720] as const)
    test(`start screen with the line and the offer (${theme}, ${width} px)`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ colorScheme: theme, reducedMotion: "reduce" });
      // Line and offer together only to look at both; a real user has one.
      await page.route("**/mcp", async (route) => {
        const body = route.request().postDataJSON();
        if (body?.method === "tools/call") {
          const tool = body.params.name as string;
          if (tool === "get_mobility_overview")
            return json(route, overview("not_asked"));
          if (
            tool === "show_arnold_dashboard" ||
            tool === "get_arnold_dashboard"
          ) {
            const response = await route.fetch();
            const payload = await response.json();
            if (payload.result?.structuredContent)
              payload.result.structuredContent.home.mobility = openLine({
                morning: "done",
              });
            return route.fulfill({ response, json: payload });
          }
        }
        return route.continue();
      });
      await openHome(page);
      await expect(line(page)).toBeVisible();
      await noOverflow(page);
      await page.screenshot({
        path: `${SHOTS}/home-mobility-${theme}-${width}.png`,
        fullPage: true,
      });
      const scan = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa"])
        .analyze();
      expect(scan.violations).toEqual([]);
    });

for (const theme of ["light", "dark"] as const)
  for (const width of [375, 720] as const)
    test(`the offer (${theme}, ${width} px)`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ colorScheme: theme, reducedMotion: "reduce" });
      await mock(page, { state: { value: "not_asked" } });
      await openHome(page);
      await expect(offer(page)).toBeVisible();
      await noOverflow(page);
      await page.screenshot({
        path: `${SHOTS}/mobility-offer-${theme}-${width}.png`,
        fullPage: true,
      });
      const scan = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa"])
        .analyze();
      expect(scan.violations).toEqual([]);
      // Keyboard: both buttons are reachable and show a focus ring.
      await offer(page).getByRole("button", { name: "Ja" }).focus();
      await page.keyboard.press("Tab");
      await expect(
        offer(page).getByRole("button", { name: "Nein danke" }),
      ).toBeFocused();
    });

const template = {
  catalog_version: "mob-1",
  rules_version: "r-1",
  exercise_ids: ["mob_neck_rolls", "mob_shoulder_circles"],
  items: [
    {
      exercise_id: "mob_neck_rolls",
      sides: 2,
      seconds_per_side: 30,
      reps: null,
    },
    {
      exercise_id: "mob_shoulder_circles",
      sides: 1,
      seconds_per_side: 45,
      reps: null,
    },
  ],
  total_s: 135,
};
const planSessions = [
  {
    plan_mobility_session_id: "pm-1",
    session_id: "ms-1",
    session_name: "Morgenroutine",
    session_order: 1,
    kind: "morning",
    placement: "own_day",
    weekdays: [1, 2, 3, 4, 5],
    after_session_id: null,
    minutes: 10,
    template,
    status: "active",
    row_revision: 1,
  },
  {
    plan_mobility_session_id: "pm-2",
    session_id: "ms-2",
    session_name: "Hüfte lösen",
    session_order: 2,
    kind: "session",
    placement: "own_day",
    weekdays: [7],
    after_session_id: null,
    minutes: 20,
    template,
    status: "active",
    row_revision: 1,
  },
];

for (const theme of ["light", "dark"] as const)
  for (const width of [375, 720] as const)
    test(`the plan view lists mobility (${theme}, ${width} px)`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ colorScheme: theme, reducedMotion: "reduce" });
      await mock(page, {
        state: { value: "yes" },
        mobilitySessions: planSessions,
      });
      await page.goto(`${BASE}/preview?card=plan`);
      await expect(page.locator('main[data-card="plan"]')).toBeVisible();
      const rows = page.getByRole("list", { name: "Mobility" });
      await expect(rows).toBeVisible();
      await expect(rows).toContainText("Morgenroutine");
      await expect(rows).toContainText("10 Min. · Mo, Di, Mi, Do, Fr");
      await expect(rows).toContainText("Mobility-Einheit");
      await expect(rows).toContainText("20 Min. · Sonntag");
      await expect(rows).toContainText("Nackenkreisen");
      // Editing stays with the existing button and the chat.
      await expect(
        page.getByRole("button", { name: /Plan bearbeiten|Training ansehen/ }),
      ).toBeVisible();
      await noOverflow(page);
      await page.screenshot({
        path: `${SHOTS}/plan-mobility-${theme}-${width}.png`,
        fullPage: true,
      });
      const scan = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa"])
        .analyze();
      expect(scan.violations).toEqual([]);
    });

test("a plan without mobility is unchanged", async ({ page }) => {
  await mock(page, { state: { value: "not_asked" } });
  await page.goto(`${BASE}/preview?card=plan`);
  await expect(page.locator('main[data-card="plan"]')).toBeVisible();
  await expect(page.getByRole("list", { name: "Mobility" })).toHaveCount(0);
  await expect(page.getByText("Morgenroutine")).toHaveCount(0);
  await expect(page.getByText("Mobility-Einheit")).toHaveCount(0);
  await expect(page.getByRole("list", { name: "Trainingstage" })).toBeVisible();
});
