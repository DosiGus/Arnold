import { test, expect } from "@playwright/test";
import {
  Client,
  StreamableHTTPClientTransport,
} from "@modelcontextprotocol/client";
import AxeBuilder from "@axe-core/playwright";

test.beforeEach(async () => {
  const client = new Client({ name: "e2e-reset", version: "1" });
  await client.connect(
    new StreamableHTTPClientTransport(new URL("http://127.0.0.1:8890/mcp")),
  );
  const result = await client.callTool({
    name: "reset_demo_data",
    arguments: { confirmDemoReset: true },
  });
  expect(result.isError).not.toBe(true);
  await client.close();
});

test("preview uses real MCP, renders charts and filters history", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/preview");
  await expect(
    page.getByRole("heading", { name: "Dein Training. Dein Fortschritt." }),
  ).toBeVisible();
  await expect(
    page.locator(".stat-value").filter({ hasText: "40.021" }),
  ).toBeVisible();
  await page.getByLabel("Volumen nach Split filtern").selectOption("Push");
  await expect(
    page.getByText("10.571", { exact: false }).first(),
  ).toBeVisible();
  await page.getByRole("button", { name: "Sätze", exact: true }).click();
  await expect(page.getByRole("img", { name: /Diagramm Sätze/ })).toBeVisible();
  await page.getByRole("button", { name: /^Push Training/ }).click();
  await expect(
    page.getByRole("heading", { name: "Bankdrücken", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Workouts", exact: true }).click();
  await page.getByRole("button", { name: "Push", exact: true }).click();
  await expect(page.getByText("4 Workouts gefunden")).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Bankdrücken", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("57,5 kg", { exact: true }).first(),
  ).toBeVisible();
  expect(errors).toEqual([]);
});

test("exercise charts load through MCP with date filters and empty/error states", async ({
  page,
}) => {
  await page.goto("/preview");
  await page.getByRole("button", { name: "Fortschritt", exact: true }).click();
  await page.getByLabel("Übung für Fortschritt").selectOption("squat");
  await expect(
    page.getByRole("heading", { name: "Kniebeugen", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("47,5", { exact: false }).first()).toBeVisible();
  await page.getByRole("button", { name: /Geschätztes 1RM/ }).click();
  await expect(page.getByRole("img", { name: /Diagramm kg/ })).toBeVisible();
  await page.getByLabel("Zeitraum", { exact: true }).selectOption("custom");
  await page.getByLabel("Fortschritt von").fill("2030-01-01");
  await expect(
    page.getByText(
      "Für diesen Zeitraum sind keine Trainingseinheiten vorhanden.",
    ),
  ).toBeVisible();
  await page.getByLabel("Fortschritt bis").fill("2020-01-01");
  await expect(page.getByRole("alert")).toContainText("Startdatum");
});

test("logger saves in the backend, refreshes totals and survives a page reload", async ({
  page,
}) => {
  await page.goto("/preview");
  await page
    .getByRole("button", { name: "Training eintragen", exact: true })
    .first()
    .click();
  await page.getByLabel("Trainingsdatum").fill("2026-10-24");
  await page.getByLabel("Gewicht in kg").fill("60");
  await page.getByLabel("Wiederholungen", { exact: true }).fill("10");
  await page.getByLabel("RPE optional").fill("8");
  await page.getByRole("button", { name: "Demo-Satz speichern" }).click();
  await expect(page.getByRole("status")).toContainText("Demo-Satz gespeichert");
  await expect(
    page.getByRole("cell", { name: "60 kg", exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.locator(".stat-value").filter({ hasText: "40.621" }),
  ).toBeVisible();
  await expect(page.getByText("109", { exact: true })).toBeVisible();
  await page
    .getByRole("button", { name: "Demo zurücksetzen", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Demo zurücksetzen" })
    .click();
  await expect(
    page.locator(".stat-value").filter({ hasText: "40.021" }),
  ).toBeVisible();
});

test("official AppBridge initializes sandboxed UI and forwards tools from the app", async ({
  page,
}) => {
  const calls: string[] = [];
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("request", (request) => {
    if (request.url().endsWith("/mcp") && request.method() === "POST") {
      const body = request.postDataJSON();
      if (body.method === "tools/call") calls.push(body.params.name);
    }
  });
  await page.goto("/host");
  await expect(page.locator("#host-status")).toHaveAttribute(
    "data-initialized",
    "true",
  );
  const app = page.frameLocator("iframe");
  await expect(
    app.getByRole("heading", { name: "Dein Training. Dein Fortschritt." }),
  ).toBeVisible();
  await app.getByRole("button", { name: "Workouts", exact: true }).click();
  await expect(app.getByText("12 Workouts gefunden")).toBeVisible();
  await app.getByRole("button", { name: "Fortschritt", exact: true }).click();
  await expect(
    app.getByRole("heading", { name: "Bankdrücken", exact: true }),
  ).toBeVisible();
  await app
    .getByRole("button", { name: "Training eintragen", exact: true })
    .first()
    .click();
  await app.getByLabel("Gewicht in kg").fill("60");
  await app.getByLabel("Wiederholungen", { exact: true }).fill("10");
  await app.getByRole("button", { name: "Demo-Satz speichern" }).click();
  await expect(app.getByRole("status")).toContainText("Demo-Satz gespeichert");
  await app
    .getByRole("button", { name: "Demo zurücksetzen", exact: true })
    .click();
  await app
    .getByRole("dialog")
    .getByRole("button", { name: "Demo zurücksetzen" })
    .click();
  await expect(app.getByRole("dialog")).not.toBeVisible();
  expect(calls).toEqual(
    expect.arrayContaining([
      "show_arnold_dashboard",
      "get_workouts",
      "get_exercise_progress",
      "log_demo_set",
      "reset_demo_data",
    ]),
  );
  expect(errors).toEqual([]);
});

test("mobile navigation, layout and dark theme work", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/preview");
  await expect(
    page.getByRole("heading", { name: "Dein Training. Dein Fortschritt." }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.getByRole("button", { name: "Farbschema wechseln" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page
    .getByRole("button", { name: "Training eintragen", exact: true })
    .first()
    .click();
  await expect(
    page.getByRole("button", { name: "Demo-Satz speichern" }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

test("replayed host snapshots are reconciled with persisted backend data", async ({
  page,
}) => {
  let originalResult: unknown;
  await page.route("**/mcp", async (route) => {
    const request = route.request();
    const body =
      request.method() === "POST" ? request.postDataJSON() : undefined;
    if (
      body?.method !== "tools/call" ||
      body.params.name !== "show_arnold_dashboard"
    ) {
      await route.continue();
      return;
    }
    if (originalResult) {
      await route.fulfill({
        json: { jsonrpc: "2.0", id: body.id, result: originalResult },
      });
      return;
    }
    const response = await route.fetch();
    originalResult = (await response.json()).result;
    await route.fulfill({ response });
  });
  await page.goto("/host");
  const app = page.frameLocator("iframe");
  await expect(
    app.locator(".stat-value").filter({ hasText: /^108$/ }),
  ).toBeVisible();
  const client = new Client({ name: "external-demo-writer", version: "1" });
  await client.connect(
    new StreamableHTTPClientTransport(new URL("http://127.0.0.1:8890/mcp")),
  );
  try {
    await client.callTool({
      name: "log_demo_set",
      arguments: {
        requestId: "host-replayed-snapshot",
        date: "2026-10-24",
        exerciseId: "bench-press",
        kg: 60,
        reps: 10,
      },
    });
  } finally {
    await client.close();
  }
  await page.reload();
  await expect(
    app.locator(".stat-value").filter({ hasText: /^109$/ }),
  ).toBeVisible();
  await expect(
    app.locator(".stat-value").filter({ hasText: "40.621" }),
  ).toBeVisible();
});

test("initial dark host context reaches the app", async ({ page }) => {
  await page.goto("/host?theme=dark");
  await expect(page.locator("#host-status")).toHaveAttribute(
    "data-initialized",
    "true",
  );
  await expect(page.frameLocator("iframe").locator("html")).toHaveAttribute(
    "data-theme",
    "dark",
  );
});

test("primary screens pass automated WCAG A/AA accessibility checks", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/preview");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  for (const theme of ["light", "dark"]) {
    await page
      .locator("html")
      .evaluate((root, value) => root.setAttribute("data-theme", value), theme);
    for (const name of [
      "Übersicht",
      "Workouts",
      "Fortschritt",
      "Training eintragen",
    ]) {
      await page
        .getByRole("navigation", { name: "Hauptnavigation" })
        .getByRole("button", { name, exact: true })
        .click();
      await expect(page.locator('[aria-busy="true"]')).toHaveCount(0);
      const audit = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze();
      expect(
        audit.violations.map((v) => ({
          id: v.id,
          nodes: v.nodes.map((n) => ({
            target: n.target,
            summary: n.failureSummary,
          })),
        })),
        `${theme}: ${name}`,
      ).toEqual([]);
    }
  }
});
