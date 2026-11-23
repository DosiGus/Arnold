import { test, expect, type Page, type Route } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

/**
 * The three mobility cards (MOB-012). The fixture server has no mobility
 * service, so the mobility tools are answered here with invented data; every
 * figure on screen must come from these answers.
 */
const BASE = "http://127.0.0.1:8792";
const SHOTS = resolve("test-results/screens");
mkdirSync(SHOTS, { recursive: true });

type Overview = ReturnType<typeof makeOverview>;

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

function makeOverview(over: Record<string, unknown> = {}) {
  return {
    profile: {
      state: "yes",
      preference: {
        wants: true,
        morning: { weekdays: ["mon", "wed", "fri"], minutes: 10 },
        sessions: null,
        stiff_areas: ["hips"],
      },
    },
    today: {
      date_local: "2026-11-23",
      items: [
        {
          session_id: "ms-morning",
          kind: "morning",
          session_name: "Morgenroutine",
          minutes: 10,
          done: false,
          template,
        },
      ],
    },
    adherence: {
      planned_count: 6,
      done_count: 4,
      ratio: 0.67,
      streak_days: 2,
      days: 14,
    },
    recent: [
      {
        workout_id: "w-1",
        date_local: "2026-11-22",
        kind: "morning",
        session_name: "Morgenroutine",
        timer_s: 612,
        exercises_done: 5,
        exercises_total: 6,
        source: "watch",
      },
    ],
    ...over,
  };
}

const reply = (route: Route, value: unknown, isError = false) =>
  route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: route.request().postDataJSON().id,
      result: {
        content: [],
        ...(value === undefined ? {} : { structuredContent: value }),
        ...(isError
          ? {
              isError: true,
              _meta: {
                arnold: {
                  code: "UNAVAILABLE",
                  retryable: true,
                  recovery: "retry_same_request",
                },
              },
            }
          : {}),
      },
    }),
  });

type Mock = {
  overview: () => Overview | undefined;
  write?: (
    tool: string,
    args: Record<string, unknown>,
    call: number,
  ) => unknown | Promise<unknown>;
};

/** Answers the mobility tools; every write is recorded. */
async function mockMobility(page: Page, card: string, mock: Mock) {
  const writes: { tool: string; args: Record<string, unknown> }[] = [];
  await page.route("**/mcp", async (route) => {
    const body = route.request().postDataJSON();
    if (body?.method !== "tools/call") return route.continue();
    const tool = body.params.name as string;
    const args = (body.params.arguments ?? {}) as Record<string, unknown>;
    if (tool === "show_arnold_mobility")
      return reply(route, {
        mobility_card_contract: "arnold.mobility_card/1",
        card,
        workout_id: args.workout_id ?? null,
      });
    if (tool === "get_mobility_overview") {
      const value = mock.overview();
      return value ? reply(route, value) : reply(route, undefined, true);
    }
    if (tool === "log_mobility" || tool === "update_mobility_profile") {
      writes.push({ tool, args });
      const out = await mock.write?.(tool, args, writes.length);
      return reply(route, out);
    }
    return route.continue();
  });
  return writes;
}

const main = (page: Page, card: string) =>
  page.locator(`main[data-card="${card}"]`);

async function open(page: Page, card: string, workout?: string) {
  await page.goto(
    `${BASE}/preview?mobility=${card}${workout ? `&workout_id=${workout}` : ""}`,
  );
  await expect(main(page, card)).toBeVisible();
}

const group = (page: Page, card: string, name: string) =>
  main(page, card).getByRole("group", { name, exact: true });
const chip = (page: Page, card: string, groupName: string, name: string) =>
  group(page, card, groupName).getByRole("button", { name, exact: true });

/* ----------------------------------------------------------------- today */

test("today shows the routine with its exercises and logs once after asking", async ({
  page,
}) => {
  let done = false;
  const data = () =>
    makeOverview({
      today: {
        date_local: "2026-11-23",
        items: [
          {
            session_id: "ms-morning",
            kind: "morning",
            session_name: "Morgenroutine",
            minutes: 10,
            done,
            template,
          },
        ],
      },
    });
  const writes = await mockMobility(page, "mobility_today", {
    overview: data,
    write: async () => {
      // Slow enough that a second click would overlap the first write.
      await new Promise((r) => setTimeout(r, 400));
      done = true;
      return { ok: true, replayed: false, workout_id: "w-new", error: null };
    },
  });
  await open(page, "mobility_today");
  const card = main(page, "mobility_today");
  await expect(card).toContainText("Morgenroutine · 10 Min.");
  await expect(card).toContainText("Nackenkreisen");
  await expect(card).toContainText("2 Seiten · 30 s");
  await expect(card).toContainText("Offen");
  // "Erledigt" asks first and writes nothing.
  await card.getByRole("button", { name: "Erledigt: Morgenroutine" }).click();
  await expect(
    card.getByRole("group", { name: "Erledigt eintragen?" }),
  ).toBeVisible();
  expect(writes).toHaveLength(0);
  // A double click on the confirmation writes exactly once.
  await card.getByRole("button", { name: "Ja, eintragen" }).dblclick();
  await expect(card.getByText("Erledigt", { exact: true })).toBeVisible();
  expect(writes).toHaveLength(1);
  expect(writes[0].tool).toBe("log_mobility");
  expect(writes[0].args).toMatchObject({
    kind: "morning",
    session_id: "ms-morning",
  });
  expect(typeof writes[0].args.request_id).toBe("string");
  await expect(
    card.getByRole("button", { name: "Erledigt: Morgenroutine" }),
  ).toHaveCount(0);
});

test("a refused log keeps the card and says why; Abbrechen writes nothing", async ({
  page,
}) => {
  const writes = await mockMobility(page, "mobility_today", {
    overview: () => makeOverview(),
    write: () => ({
      ok: false,
      replayed: false,
      error: {
        code: "DUPLICATE_MOBILITY",
        message: "Diese Routine ist heute schon gespeichert.",
        recovery: "none",
        retryable: false,
        details: [],
      },
    }),
  });
  await open(page, "mobility_today");
  const card = main(page, "mobility_today");
  await card.getByRole("button", { name: "Erledigt: Morgenroutine" }).click();
  await card.getByRole("button", { name: "Abbrechen" }).click();
  await expect(
    card.getByRole("group", { name: "Erledigt eintragen?" }),
  ).toHaveCount(0);
  expect(writes).toHaveLength(0);
  await card.getByRole("button", { name: "Erledigt: Morgenroutine" }).click();
  await card.getByRole("button", { name: "Ja, eintragen" }).click();
  await expect(card.getByRole("alert")).toContainText("schon gespeichert");
  await expect(card).toContainText("Offen");
  expect(writes).toHaveLength(1);
});

test("without a routine today the card is calm and offers the setup", async ({
  page,
}) => {
  await mockMobility(page, "mobility_today", {
    overview: () =>
      makeOverview({
        profile: { state: "not_asked", preference: null },
        today: { date_local: "2026-11-23", items: [] },
      }),
  });
  await open(page, "mobility_today");
  const card = main(page, "mobility_today");
  await expect(card).toContainText("Heute steht keine Mobility an");
  await expect(card).toContainText("Sag zum Beispiel");
  await card.getByRole("button", { name: "Mobility einrichten" }).click();
  await expect(main(page, "mobility_setup")).toBeVisible();
});

test("a failed read shows a notice and no figures", async ({ page }) => {
  await mockMobility(page, "mobility_today", { overview: () => undefined });
  await page.goto(`${BASE}/preview?mobility=mobility_today`);
  await expect(
    page.getByRole("button", { name: /erneut|Noch einmal/i }),
  ).toBeVisible();
  await expect(main(page, "mobility_today")).toHaveCount(0);
});

/* ---------------------------------------------------------------- result */

test("the result shows duration, exercises and the stay-with-it sentence", async ({
  page,
}) => {
  await mockMobility(page, "mobility_result", {
    overview: () => makeOverview(),
  });
  await open(page, "mobility_result");
  const card = main(page, "mobility_result");
  await expect(card).toContainText("10 Min.");
  await expect(card).toContainText("5 von 6");
  await expect(card).toContainText(
    "Dranbleiben: 4 von 6 Routinen in 14 Tagen, 2 Tage in Folge.",
  );
});

test("without a plan or a known duration the result says so instead of 0", async ({
  page,
}) => {
  await mockMobility(page, "mobility_result", {
    overview: () =>
      makeOverview({
        adherence: {
          planned_count: 0,
          done_count: 0,
          ratio: null,
          streak_days: 0,
          days: 14,
        },
        recent: [
          {
            workout_id: "w-2",
            date_local: "2026-11-21",
            kind: "session",
            session_name: null,
            timer_s: null,
            exercises_done: 0,
            exercises_total: 0,
            source: "chat",
          },
        ],
      }),
  });
  await open(page, "mobility_result", "w-2");
  const card = main(page, "mobility_result");
  await expect(card).toContainText("Dranbleiben: noch kein Plan.");
  await expect(
    card.getByRole("listitem").filter({ hasText: "Dauer" }),
  ).toHaveText(/Dauer\s*–/);
  await expect(card).not.toContainText(/\b0 (Min\.|von)/);
});

/* ----------------------------------------------------------------- setup */

test("the setup card saves wants=false and wants=true through update_mobility_profile", async ({
  page,
}) => {
  const writes = await mockMobility(page, "mobility_setup", {
    overview: () =>
      makeOverview({ profile: { state: "not_asked", preference: null } }),
    write: (_tool, args) => {
      const preference = args.preference as { wants: boolean };
      return {
        ok: true,
        replayed: false,
        profile: {
          state: preference.wants ? "yes" : "no",
          preference,
        },
        error: null,
      };
    },
  });
  await open(page, "mobility_setup");
  const card = main(page, "mobility_setup");
  const title = "Mobility oder Morgenroutine dazu?";
  // Nothing chosen: no write, a plain hint.
  await card.getByRole("button", { name: "Speichern" }).click();
  await expect(card.getByRole("alert")).toContainText(
    "Wähle eine Antwort aus.",
  );
  expect(writes).toHaveLength(0);
  // "Nein danke".
  await chip(page, "mobility_setup", title, "Nein danke").click();
  await card.getByRole("button", { name: "Speichern" }).click();
  await expect(card).toContainText("Es kommt keine Mobility dazu.");
  expect(writes).toHaveLength(1);
  expect(writes[0].args.preference).toEqual({ wants: false });
  expect(typeof writes[0].args.request_id).toBe("string");
  await expect(card).not.toContainText("Bau mir die Morgenroutine");
  // "Beides" with the defaults of the setup page.
  await chip(page, "mobility_setup", title, "Beides").click();
  for (const day of ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"])
    await expect(
      chip(page, "mobility_setup", "Tage der Morgenroutine", day),
    ).toHaveAttribute("aria-pressed", "true");
  await expect(
    chip(page, "mobility_setup", "Länge der Morgenroutine", "10 Min."),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(
    chip(
      page,
      "mobility_setup",
      "Lage der Mobility-Einheiten",
      "Arnold entscheidet",
    ),
  ).toHaveAttribute("aria-pressed", "true");
  await chip(page, "mobility_setup", "Steife Bereiche", "Hüfte").click();
  await card.getByRole("button", { name: "Speichern" }).click();
  await expect(card).toContainText("Mobility ist eingerichtet.");
  await expect(card).toContainText("Bau mir die Morgenroutine in den Plan.");
  expect(writes).toHaveLength(2);
  expect(writes[1].args.preference).toEqual({
    wants: true,
    morning: {
      weekdays: ["mon", "tue", "wed", "thu", "fri", "sat", "sun"],
      minutes: 10,
    },
    sessions: { placement: "arnold_decides", per_week: 2, minutes: 20 },
    stiff_areas: ["hips"],
  });
  expect(writes[1].args.request_id).not.toBe(writes[0].args.request_id);
});

test("a refused save keeps the answers and does not claim it saved", async ({
  page,
}) => {
  await mockMobility(page, "mobility_setup", {
    overview: () =>
      makeOverview({ profile: { state: "not_asked", preference: null } }),
    write: () => ({
      ok: false,
      replayed: false,
      error: {
        code: "VALIDATION_ERROR",
        message: "Das konnte ich nicht speichern.",
        recovery: "start_over",
        retryable: false,
        details: [],
      },
    }),
  });
  await open(page, "mobility_setup");
  const card = main(page, "mobility_setup");
  await chip(
    page,
    "mobility_setup",
    "Mobility oder Morgenroutine dazu?",
    "Morgenroutine",
  ).click();
  await card.getByRole("button", { name: "Speichern" }).click();
  await expect(card.getByRole("alert")).toContainText("nicht speichern");
  await expect(card).not.toContainText("Gespeichert.");
  await expect(
    chip(
      page,
      "mobility_setup",
      "Mobility oder Morgenroutine dazu?",
      "Morgenroutine",
    ),
  ).toHaveAttribute("aria-pressed", "true");
});

/* -------------------------------------------------------------- keyboard */

test("every card works with the keyboard alone", async ({ page }) => {
  let done = false;
  const writes = await mockMobility(page, "mobility_today", {
    overview: () =>
      makeOverview({
        today: {
          date_local: "2026-11-23",
          items: [
            {
              session_id: "ms-morning",
              kind: "morning",
              session_name: "Morgenroutine",
              minutes: 10,
              done,
              template,
            },
          ],
        },
      }),
    write: () => {
      done = true;
      return { ok: true, replayed: false, workout_id: "w-new", error: null };
    },
  });
  await open(page, "mobility_today");
  const tabTo = async (name: string) => {
    for (let i = 0; i < 30; i++) {
      await page.keyboard.press("Tab");
      const focused = await page.evaluate(() => {
        const el = document.activeElement as HTMLElement | null;
        return el?.getAttribute("aria-label") ?? el?.textContent?.trim() ?? "";
      });
      if (focused === name) return;
    }
    throw new Error(`Focus never reached "${name}".`);
  };
  await tabTo("Erledigt: Morgenroutine");
  await page.keyboard.press("Enter");
  await tabTo("Ja, eintragen");
  await page.keyboard.press("Enter");
  await expect(
    main(page, "mobility_today").getByText("Erledigt", { exact: true }),
  ).toBeVisible();
  expect(writes).toHaveLength(1);
  // The setup card: choose and save by keys.
  await page.unroute("**/mcp");
  const setupWrites = await mockMobility(page, "mobility_setup", {
    overview: () =>
      makeOverview({ profile: { state: "not_asked", preference: null } }),
    write: () => ({
      ok: true,
      replayed: false,
      profile: { state: "no", preference: { wants: false } },
      error: null,
    }),
  });
  await open(page, "mobility_setup");
  await tabTo("Nein danke");
  await page.keyboard.press("Space");
  await tabTo("Speichern");
  await page.keyboard.press("Enter");
  await expect(main(page, "mobility_setup")).toContainText("Gespeichert.");
  expect(setupWrites[0].args.preference).toEqual({ wants: false });
});

/* --------------------------------------------------------- look and a11y */

for (const width of [375, 720])
  for (const theme of ["light", "dark"] as const)
    test(`the mobility cards at ${width} px in ${theme} mode are readable and accessible`, async ({
      page,
      browserName,
    }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ colorScheme: theme });
      await mockMobility(page, "mobility_today", {
        overview: () => makeOverview(),
      });
      for (const card of [
        "mobility_today",
        "mobility_result",
        "mobility_setup",
      ]) {
        await page.unroute("**/mcp");
        await mockMobility(page, card, {
          overview: () =>
            makeOverview(
              card === "mobility_setup"
                ? { profile: { state: "not_asked", preference: null } }
                : {},
            ),
        });
        await open(page, card);
        await page.evaluate(
          (theme) => (document.documentElement.dataset.theme = theme),
          theme,
        );
        if (card === "mobility_setup")
          await chip(
            page,
            card,
            "Mobility oder Morgenroutine dazu?",
            "Beides",
          ).click();
        const overflow = await page.evaluate(
          () =>
            document.documentElement.scrollWidth -
            document.documentElement.clientWidth,
        );
        expect(overflow).toBeLessThanOrEqual(0);
        await page.screenshot({
          path: `${SHOTS}/${browserName}-${card}-${width}-${theme}.png`,
          fullPage: true,
          animations: "disabled",
        });
        const a11y = await new AxeBuilder({ page }).analyze();
        expect(
          a11y.violations.filter((v) =>
            ["critical", "serious"].includes(v.impact ?? ""),
          ),
        ).toEqual([]);
      }
    });
