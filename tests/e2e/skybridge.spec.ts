import { test, expect, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { callTool } from "./helpers";

/**
 * The Skybridge views, the default interface, in the local test host (official
 * AppBridge, sandboxed iframe, no network): overview, its screens, one chat
 * card each for run, mobility and plan change, and the setup. Invented data.
 */
const DEMO = "http://127.0.0.1:8850";
const NEW = "http://127.0.0.1:8851";
const SHOTS = resolve("test-results/skybridge");
mkdirSync(SHOTS, { recursive: true });

test.use({ viewport: { width: 420, height: 900 } });

/** Opens the card a tool would open; returns the card's document. */
async function open(page: Page, base: string, query = "") {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`${base}/host${query}`);
  await expect(page.locator("#host-status")).toHaveAttribute(
    "data-initialized",
    "true",
  );
  return { app: page.frameLocator("iframe"), errors };
}
const shot = (page: Page, name: string) =>
  page
    .locator("iframe")
    .screenshot({ path: `${SHOTS}/${name}.png`, animations: "disabled" });

async function overview(page: Page) {
  const opened = await open(page, DEMO);
  await expect(
    opened.app.getByRole("heading", { name: "Dein Überblick" }),
  ).toBeVisible();
  return opened;
}

test("overview shows week, goals and records", async ({ page }) => {
  const { app, errors } = await overview(page);
  await expect(app.getByRole("heading", { name: "Diese Woche" })).toBeVisible();
  await expect(app.getByRole("heading", { name: "Ziele" })).toBeVisible();
  await expect(app.getByRole("heading", { name: "Rekorde" })).toBeVisible();
  await shot(page, "overview");
  expect(errors).toEqual([]);
});

test("records show strength and running", async ({ page }) => {
  const { app, errors } = await overview(page);
  await app.getByRole("button", { name: "Alle Rekorde ansehen" }).click();
  await expect(app.getByRole("heading", { name: "Rekorde" })).toBeVisible();
  await expect(app.getByText("Demo Bankdrücken").first()).toBeVisible();
  await expect(app.getByText(/5 km/).first()).toBeVisible();
  await shot(page, "records");
  expect(errors).toEqual([]);
});

test("a new goal is stored and listed", async ({ page }) => {
  const { app, errors } = await overview(page);
  await app.getByRole("button", { name: "Ziel hinzufügen" }).click();
  await expect(app.getByRole("heading", { name: "Ziele" })).toBeVisible();
  await app.getByRole("button", { name: "Ziel hinzufügen" }).click();
  await app.getByText("Übung, Körpergewicht oder Laufen wählen").click();
  await app.getByRole("option", { name: "Laufen", exact: true }).click();
  await app.getByRole("radio", { name: "10 km" }).click();
  await app.getByRole("textbox", { name: "Zielwert" }).fill("52:00");
  await shot(page, "goals-new");
  await app.getByRole("button", { name: "Ziel speichern" }).click();
  await expect(app.getByRole("button", { name: /10 km.*52:00/ })).toBeVisible();
  await shot(page, "goals");
  expect(errors).toEqual([]);
});

test("progress shows strength and running series", async ({ page }) => {
  const { app, errors } = await overview(page);
  await app
    .getByRole("button", { name: "Trainingsentwicklung ansehen" })
    .click();
  await expect(app.getByText(/geschätztes 1RM/)).toBeVisible();
  const series = app.getByRole("radiogroup", { name: "Auswertung" });
  await series.getByRole("radio", { name: "km", exact: true }).click();
  await expect(app.getByText("Laufkilometer pro Woche")).toBeVisible();
  await shot(page, "progress-run-distance");
  await series.getByRole("radio", { name: "Tempo" }).click();
  await expect(app.getByText("Lauftempo (Wochenschnitt)")).toBeVisible();
  await expect(app.getByText(/\d:\d\d \/km/).first()).toBeVisible();
  await shot(page, "progress-run-pace");
  expect(errors).toEqual([]);
});

test("health data shows the watch values", async ({ page }) => {
  const { app, errors } = await overview(page);
  await app.getByRole("button", { name: "Health Data" }).click();
  await expect(app.getByRole("heading", { name: /Health/ })).toBeVisible();
  await shot(page, "health");
  expect(errors).toEqual([]);
});

test("settings open and go back", async ({ page }) => {
  const { app, errors } = await overview(page);
  await app.getByRole("button", { name: "Einstellungen" }).click();
  await expect(
    app.getByRole("heading", { name: "Einstellungen" }),
  ).toBeVisible();
  await shot(page, "settings");
  expect(errors).toEqual([]);
});

test("run chat card opens on today's run", async ({ page }) => {
  const { app, errors } = await open(
    page,
    DEMO,
    "?tool=show_arnold_run&card=run_today",
  );
  await expect(app.getByRole("heading").first()).toContainText(/lauf/i);
  await shot(page, "card-run");
  expect(errors).toEqual([]);
});

test("mobility chat card opens", async ({ page }) => {
  const { app, errors } = await open(
    page,
    DEMO,
    "?tool=show_arnold_mobility&card=mobility_today",
  );
  await expect(
    app.getByRole("heading", { name: "Mobility heute" }),
  ).toBeVisible();
  await shot(page, "card-mobility");
  expect(errors).toEqual([]);
});

test("plan change card activates only on the click", async ({ page }) => {
  await page.goto(`${DEMO}/host`);
  type Ctx = {
    active_plan_version_id: string;
    plan: {
      row_revision: number;
      sessions: { session_id: string }[];
    };
  };
  const context = (id?: string) =>
    callTool(
      page,
      "get_plan_editor_context",
      id ? { plan_version_id: id } : {},
    ) as Promise<Ctx>;
  const before = (await context()).active_plan_version_id;
  const created = (await callTool(page, "create_plan_version", {
    request_id: "sky-draft",
    source_plan_version_id: before,
  })) as { result: { plan: { version: { plan_version_id: string } } } };
  const draftId = created.result.plan.version.plan_version_id;
  const draft = (await context(draftId)).plan;
  const ids = draft.sessions.map((s) => s.session_id);
  const updated = (await callTool(page, "update_plan_draft", {
    request_id: "sky-reorder",
    plan_version_id: draftId,
    expected_row_revision: draft.row_revision,
    edits: [{ type: "reorder_sessions", session_ids: [...ids].reverse() }],
  })) as { ok: boolean };
  expect(updated.ok).toBe(true);

  const { app, errors } = await open(page, DEMO, "?card=plan_change");
  const apply = app.getByRole("button", { name: "Übernehmen", exact: true });
  await expect(apply).toBeVisible();
  await shot(page, "card-plan-change");
  expect((await context()).active_plan_version_id).toBe(before);
  await apply.click();
  await expect(apply).toHaveCount(0);
  await expect
    .poll(async () => (await context()).active_plan_version_id)
    .toBe(draftId);
  expect(errors).toEqual([]);
});

test("a finished training stays on screen and counts for today", async ({
  page,
}) => {
  const { app, errors } = await open(page, DEMO, "?card=today");
  const title = app.getByRole("heading", { level: 2 }).first();
  await expect(app.getByRole("textbox").first()).toBeVisible();
  const session = await title.innerText();
  await app.getByRole("textbox").first().fill("100");
  await app.getByRole("textbox").nth(1).fill("5");
  await app.getByRole("checkbox").first().click();
  await app.getByRole("button", { name: "Training beenden" }).click();
  await expect(app.getByText("Training gespeichert.")).toBeVisible();
  await page.waitForTimeout(500);
  await expect(title).toHaveText(session);
  // The overview was read again; the card still names the saved session.
  await app.getByRole("button", { name: "Dashboard" }).click();
  await expect(app.getByText("Krafttraining · 1 Arbeitssatz")).toBeVisible();
  await expect(app.getByText(session, { exact: true })).toBeVisible();
  await shot(page, "after-training");
  expect(errors).toEqual([]);
});

test("the setup starts on a new account", async ({ page }) => {
  const { app, errors } = await open(page, NEW, "?tool=show_arnold_onboarding");
  await shot(page, "setup-welcome");
  await app.getByRole("button", { name: /Plan mit Arnold/ }).click();
  await expect(
    app.getByRole("heading", { name: "Erzähl mir von deinem Training" }),
  ).toBeVisible();
  await expect(app.getByText("1 von 6")).toBeVisible();
  await app.getByRole("radio", { name: "3", exact: true }).click();
  await expect(app.getByText("2 von 6")).toBeVisible();
  await shot(page, "setup-profile");
  expect(errors).toEqual([]);
});

test("running goals stay selected and open while profile saves are queued", async ({
  page,
}) => {
  const { app, errors } = await open(page, NEW, "?tool=show_arnold_onboarding");
  const start = app.getByRole("button", { name: /Plan mit Arnold/ });
  if (await start.isVisible()) await start.click();
  const running = app.getByRole("checkbox", { name: "Laufen", exact: true });
  await expect(running).not.toBeChecked();

  let releaseModuleSave!: () => void;
  let releaseGoalsSave!: () => void;
  const moduleSave = new Promise<void>((resolve) => {
    releaseModuleSave = resolve;
  });
  const goalsSave = new Promise<void>((resolve) => {
    releaseGoalsSave = resolve;
  });
  let moduleSent = false;
  let goalsSent = false;
  await page.route(`${NEW}/mcp`, async (route) => {
    if (route.request().method() === "POST") {
      const { params } = route.request().postDataJSON() ?? {};
      if (params?.name === "update_onboarding_profile") {
        const training = params.arguments?.profile?.training;
        if (training?.modules?.running) {
          moduleSent = true;
          await moduleSave;
        }
        if (training?.run?.aims) {
          goalsSent = true;
          await goalsSave;
        }
      }
    }
    await route.continue();
  });

  try {
    await running.check();
    await expect.poll(() => moduleSent).toBe(true);
    const fit = app
      .getByRole("group", { name: "Hauptziel Laufen" })
      .getByRole("button", { name: "Fit bleiben" });
    await fit.click();
    await expect(fit).toHaveAttribute("aria-pressed", "true");
    // Let the goal's debounced save queue behind the still-blocked module save.
    await page.waitForTimeout(400);
    releaseModuleSave();
    await expect.poll(() => goalsSent).toBe(true);
    expect(await fit.getAttribute("aria-pressed")).toBe("true");

    await app.getByRole("heading", { name: "Trainingstage pro Woche" }).click();
    await expect(fit).toBeVisible();
    releaseGoalsSave();
    await expect
      .poll(async () => {
        const state = await callTool(page, "get_onboarding_state");
        return state?.session.profile.training.run?.aims;
      })
      .toEqual(["fitness"]);
    await expect(fit).toHaveAttribute("aria-pressed", "true");
    expect(errors).toEqual([]);
  } finally {
    releaseModuleSave();
    releaseGoalsSave();
  }
});
