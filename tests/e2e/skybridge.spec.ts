import { test, expect, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { callTool } from "./helpers";
import { open } from "./host";
import { berlinToday } from "../fixtures/berlin-today";

/**
 * The card views (Skybridge web runtime) in the local test host (official
 * AppBridge, sandboxed iframe, no network): overview, its screens, one chat
 * card each for run, mobility and plan change, and the setup. Invented data.
 */
/** Each browser project has its own servers: a test's writes stay its own. */
let DEMO = "";
let NEW = "";
let PLAN = "";
test.beforeEach(({}, info) => {
  const port = info.project.name === "webkit" ? 8860 : 8850;
  [DEMO, NEW, PLAN] = [0, 1, 2].map((n) => `http://127.0.0.1:${port + n}`) as [
    string,
    string,
    string,
  ];
});
const SHOTS = resolve("test-results/skybridge");
mkdirSync(SHOTS, { recursive: true });

test.use({ viewport: { width: 420, height: 900 } });

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
  // The overview has a heading "Ziele" too: wait for the goals screen.
  await expect(
    app.getByRole("textbox", { name: "Heutiges Körpergewicht" }),
  ).toBeVisible();
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
  // The recap of this training stays until the user dismisses it.
  const recap = app.getByRole("region", {
    name: "Rückblick auf dein Training",
  });
  await expect(recap).toContainText(`Geschafft: ${session}`);
  await shot(page, "after-training");
  await recap.getByRole("button", { name: "Verstanden" }).click();
  await expect(recap).toHaveCount(0);
  await expect
    .poll(
      async () =>
        (
          (await callTool(page, "get_arnold_dashboard", {})) as {
            recap?: unknown;
          }
        ).recap ?? null,
    )
    .toBeNull();
  expect(errors).toEqual([]);
});

type Proposals = {
  proposals: {
    plan_version_id: string;
    session_id: string;
    session_name: string;
  }[];
};
const today = (page: Page) =>
  callTool(page, "get_workout", {}) as Promise<unknown> as Promise<Proposals>;
const savedToday = () => ({
  request_id: crypto.randomUUID(),
  workout_date_local: berlinToday(),
  timezone: "Europe/Berlin",
});

test("an unusual value and a second training are asked about", async ({
  page,
}) => {
  const { app, errors } = await open(page, DEMO, "?card=today");
  // An exercise that is trained with a weight, not with bodyweight.
  const weights = app.getByRole("textbox", { name: /Satz 1 Gewicht$/ });
  await expect(weights.first()).toBeVisible();
  const values = await weights.evaluateAll((inputs) =>
    inputs.map((i) => (i as HTMLInputElement).value),
  );
  const found = weights.nth(values.findIndex((v) => v !== ""));
  const set = (await found.getAttribute("aria-label"))!.replace(
    / Gewicht$/,
    "",
  );
  const weight = app.getByRole("textbox", { name: `${set} Gewicht` });
  const finish = app.getByRole("button", { name: "Training beenden" });
  await weight.fill("800");
  await app.getByRole("textbox", { name: `${set} Wiederholungen` }).fill("5");
  await app
    .locator("li")
    .filter({
      has: app.getByRole("textbox", { name: `${set} Gewicht` }),
    })
    .getByRole("checkbox")
    .click();
  await finish.click();
  await expect(app.getByText(/Ungewöhnlich hoch: 800 kg/)).toBeVisible();
  await shot(page, "ask-unusual");
  await app.getByRole("button", { name: "Wert ändern" }).click();
  await weight.fill("100");
  // The chat saves the same session meanwhile.
  const shown = await app
    .getByRole("heading", { level: 2 })
    .first()
    .innerText();
  const next = (await today(page)).proposals.find(
    (p) => p.session_name === shown,
  );
  await callTool(page, "log_workout", {
    ...savedToday(),
    plan_version_id: next!.plan_version_id,
    session_id: next!.session_id,
    confirm_duplicate: true,
  });
  await finish.click();
  await expect(app.getByText(/ist für heute schon gespeichert/)).toBeVisible();
  await shot(page, "ask-duplicate");
  await expect(
    app.getByRole("button", { name: "Zusätzlich speichern" }),
  ).toBeVisible();
  await app.getByRole("button", { name: "Gespeichertes ersetzen" }).click();
  await expect(app.getByText("Training gespeichert.")).toBeVisible();
  expect(errors).toEqual([]);
});

test("an open training is discarded after a second tap", async ({ page }) => {
  await open(page, DEMO, "?card=today");
  const [next] = (await today(page)).proposals;
  await callTool(page, "start_workout", {
    ...savedToday(),
    session_name: next!.session_name,
    plan_version_id: next!.plan_version_id,
    session_id: next!.session_id,
  });
  const { app, errors } = await open(page, DEMO, "?card=today");
  await app.getByRole("button", { name: "Offenes verwerfen" }).click();
  await shot(page, "discard-open");
  await app.getByRole("button", { name: "Wirklich verwerfen?" }).click();
  await expect(app.getByRole("textbox").first()).toBeVisible();
  await expect(app.getByText(/offenes Training/)).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("a stored set is corrected and discarded in the history", async ({
  page,
}) => {
  const { app, errors } = await open(page, DEMO, "?card=history");
  await app.locator("button[aria-expanded]").first().click();
  await app.getByRole("button", { name: "Satz korrigieren" }).click();
  const editor = app.getByRole("group", { name: /korrigieren$/ });
  const reps = editor.getByRole("textbox", { name: /Wiederholungen$/ });
  await expect(reps.first()).toBeVisible();
  const count = await reps.count();
  await reps.first().fill("3");
  await shot(page, "set-edit");
  await editor.getByRole("button", { name: /speichern$/ }).click();
  await expect(editor.getByRole("button", { name: /speichern$/ })).toHaveCount(
    0,
  );
  await expect(reps.first()).toHaveValue("3");
  const discard = editor.getByRole("button", { name: /verwerfen$/ }).last();
  await discard.click();
  await expect(reps).toHaveCount(count);
  await editor.getByRole("button", { name: /wirklich verwerfen\?$/ }).click();
  await expect(reps).toHaveCount(count - 1);
  expect(errors).toEqual([]);
});

test("a body weight entry is discarded after a second tap", async ({
  page,
}) => {
  const { app, errors } = await overview(page);
  await app.getByRole("button", { name: "Ziel hinzufügen" }).click();
  await app.getByRole("textbox", { name: "Heutiges Körpergewicht" }).fill("99");
  await app.getByRole("button", { name: "Eintragen" }).click();
  await expect(app.getByText(/99 kg/).first()).toBeVisible();
  await app.getByRole("button", { name: "Letzten Eintrag verwerfen" }).click();
  await app.getByRole("button", { name: "Wirklich verwerfen?" }).click();
  await expect(app.getByText(/99 kg/)).toHaveCount(0);
  await shot(page, "weight-discarded");
  expect(errors).toEqual([]);
});

test("the overview names a running adjustment and opens it", async ({
  page,
}) => {
  // A page of the same origin without a card, to call tools from.
  await page.goto(`${PLAN}/health`);
  const created = (await callTool(page, "create_plan_adjustment", {
    request_id: "sky-adjust",
    timezone: "Europe/Berlin",
    kind: "range",
    start_date_local: berlinToday(),
    end_date_local: berlinToday(),
    sessions_per_week: 1,
    minutes_per_session: 30,
    reason: "Urlaub",
  })) as {
    result: {
      plan_adjustment: {
        adjustment: { plan_adjustment_id: string; row_revision: number };
      };
    };
  };
  const { adjustment } = created.result.plan_adjustment;
  const confirmed = (await callTool(page, "confirm_plan_adjustment", {
    request_id: "sky-adjust-yes",
    plan_adjustment_id: adjustment.plan_adjustment_id,
    expected_row_revision: adjustment.row_revision,
  })) as { ok: boolean };
  expect(confirmed.ok).toBe(true);

  const { app, errors } = await open(page, PLAN);
  await expect(app.getByText(/^Anpassung auf Zeit bis /)).toBeVisible();
  await shot(page, "overview-adjustment");
  await app.getByRole("button", { name: "Anpassung ansehen" }).click();
  await expect(app.getByRole("heading", { name: "Urlaub" })).toBeVisible();
  await expect(app.getByRole("button", { name: "Absagen" })).toBeVisible();
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

// Last in the file: it moves another session to the front of the plan.
test("a bodyweight exercise has no weight field and is stored", async ({
  page,
}) => {
  await open(page, DEMO);
  type Ctx = {
    active_plan_version_id: string;
    plan: {
      row_revision: number;
      sessions: { session_id: string; items?: unknown }[];
    };
  };
  const context = (id?: string) =>
    callTool(
      page,
      "get_plan_editor_context",
      id ? { plan_version_id: id } : {},
    ) as Promise<Ctx>;
  // The session with the pull-ups becomes the one the card proposes.
  const { proposals } = (await callTool(page, "get_workout", {})) as {
    proposals: {
      session_id: string;
      exercises: { conventions: { load_basis: string } }[];
    }[];
  };
  const pull = proposals.find((p) =>
    p.exercises.some((e) => e.conventions.load_basis === "bodyweight_only"),
  )!.session_id;
  const created = (await callTool(page, "create_plan_version", {
    request_id: "sky-bw-draft",
    source_plan_version_id: (await context()).active_plan_version_id,
  })) as { result: { plan: { version: { plan_version_id: string } } } };
  const draftId = created.result.plan.version.plan_version_id;
  const draft = (await context(draftId)).plan;
  const ids = draft.sessions.map((s) => s.session_id);
  await callTool(page, "update_plan_draft", {
    request_id: "sky-bw-order",
    plan_version_id: draftId,
    expected_row_revision: draft.row_revision,
    edits: [
      {
        type: "reorder_sessions",
        session_ids: [pull, ...ids.filter((id) => id !== pull)],
      },
    ],
  });
  const { app, errors } = await open(page, DEMO, "?card=plan_change");
  const apply = app.getByRole("button", { name: "Übernehmen", exact: true });
  await apply.click();
  await expect(apply).toHaveCount(0);

  await open(page, DEMO, "?card=today");
  const reps = app.getByRole("textbox", {
    name: /Klimmzüge Satz 1 Wiederholungen$/,
  });
  await expect(reps).toBeVisible();
  await expect(
    app.getByRole("textbox", { name: /Klimmzüge Satz \d+ Gewicht$/ }),
  ).toHaveCount(0);
  await reps.fill("8");
  await app.locator("li").filter({ has: reps }).getByRole("checkbox").click();
  await shot(page, "bodyweight-set");
  await app.getByRole("button", { name: "Training beenden" }).click();
  // After an earlier test this session is already saved today.
  const stored = app.getByText("Training gespeichert.");
  const again = app.getByRole("button", { name: "Zusätzlich speichern" });
  await expect(stored.or(again)).toBeVisible();
  if (await again.isVisible()) await again.click();
  await expect(stored).toBeVisible();
  expect(errors).toEqual([]);
});
