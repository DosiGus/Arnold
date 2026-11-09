import { test, expect } from "@playwright/test";
import { callTool, openCard } from "./helpers";
import type { ArnoldDashboardView } from "../../src/shared/arnold-view";
import type { WorkoutContext } from "../../src/shared/workout-contract";

const BASE = "http://127.0.0.1:8804";

test("demo scores are explicitly illustrative and never write training data", async ({
  page,
}) => {
  const writes: string[] = [];
  page.on("request", (request) => {
    if (!request.url().endsWith("/mcp") || request.method() !== "POST") return;
    const name = request.postDataJSON()?.params?.name;
    if (name && !/^(get_|show_|ui\/)/.test(name)) writes.push(name);
  });
  await openCard(page, "home", BASE);
  const scores = page.getByRole("region", { name: "Demo-Scores", exact: true });
  await expect(scores.getByRole("img")).toHaveCount(3);
  await expect(scores.getByText("Demo", { exact: true })).toHaveCount(3);
  await scores.getByRole("button", { name: "Über die Demo-Scores" }).click();
  await expect(scores).toContainText("frei gewählte Demo-Werte");
  await expect(scores).toContainText("kein Health-Gerät angebunden");
  await expect(
    page
      .getByRole("region", { name: "Deine Woche", exact: true })
      .getByRole("button", { name: "Alle Einheiten" }),
  ).toBeVisible();
  expect(writes).toEqual([]);
});

test("the overview reads the same next-session proposals as the training editor", async ({
  page,
}) => {
  await openCard(page, "home", BASE);
  const data = (await callTool(page, "get_workout", {})) as WorkoutContext;
  const view = (await callTool(
    page,
    "get_arnold_dashboard",
    {},
  )) as ArnoldDashboardView;
  const proposal = data.proposals.find(
    (p) => p.session_id === view.home.next_session?.session_id,
  );
  expect(proposal).toBeDefined();
  const training = page.getByRole("region", {
    name: "Dein Training",
    exact: true,
  });
  // A finished workout is shown as finished, never mislabelled as the next one.
  if (
    await training.getByText("Training gespeichert", { exact: true }).count()
  ) {
    await expect(
      training.getByRole("button", { name: "Training ansehen" }),
    ).toBeVisible();
  } else {
    for (const exercise of proposal!.exercises.slice(0, 4))
      await expect(
        training.getByRole("list", { name: "Nächstes Training" }),
      ).toContainText(exercise.exercise_name);
  }
  await training
    .getByRole("button", { name: /^Training (bearbeiten|ansehen)$/ })
    .click();
  await expect(page.locator('main[data-card="today"]')).toBeVisible();
  await expect(page.locator(".ac-widget-grid")).toHaveCount(0);
  await page
    .getByRole("button", { name: "Zurück zur Übersicht", exact: true })
    .click();
  await expect(page.locator(".ac-widget")).toHaveCount(5);
});

test("record arrows preserve the exact server record and open its own workout", async ({
  page,
}) => {
  await openCard(page, "home", BASE);
  const view = (await callTool(
    page,
    "get_arnold_dashboard",
    {},
  )) as ArnoldDashboardView;
  const records = view.home.records.slice(0, 3);
  expect(records.length).toBe(3);
  const card = page.getByRole("region", { name: "Deine Rekorde", exact: true });
  await card.getByRole("button", { name: "Nächster Rekord" }).click();
  await expect(card.locator(".ac-widget-record-name")).toHaveText(
    records[1].exercise_name,
  );
  await expect(card).toContainText("2 / 3");
  await card.getByRole("button", { name: "Vorheriger Rekord" }).click();
  await expect(card.locator(".ac-widget-record-name")).toHaveText(
    records[0].exercise_name,
  );
  await card.getByRole("button", { name: "Training ansehen" }).click();
  await expect(page.locator('main[data-card="history"]')).toBeVisible();
  const expanded = page.locator('.ac-history-row[aria-expanded="true"]');
  await expect(expanded).toHaveCount(1);
  const expected = view.recent_workouts.find(
    (w) => w.workout_id === records[0].workout_id,
  );
  if (expected) await expect(expanded).toContainText(expected.title);
});

test("dashboard goals open their selected server goal and the add action opens creation", async ({
  page,
}) => {
  await openCard(page, "home", BASE);
  const view = (await callTool(
    page,
    "get_arnold_dashboard",
    {},
  )) as ArnoldDashboardView;
  const goal = view.home.goals[0];
  expect(goal).toBeDefined();
  await page.locator(".ac-widget-goal").first().click();
  await expect(
    page.getByRole("region", { name: `Ziel ${goal.name}`, exact: true }),
  ).toBeVisible();
  await page.goto(`${BASE}/preview?card=home`);
  await page
    .getByRole("button", { name: "Ziel hinzufügen", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Was willst du erreichen?" }),
  ).toBeVisible();
});

test("all cards and setup controls use neutral colors in both host themes", async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 812 });
  for (const theme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: theme });
    for (const card of [
      "home",
      "today",
      "goals",
      "records",
      "history",
      "progress",
      "plan",
    ]) {
      await openCard(page, card);
      await expect(page.locator("main .ac").first()).toBeVisible();
      const colored = await page.locator("main").evaluate((root) => {
        const violations: string[] = [];
        for (const el of [root, ...root.querySelectorAll("*")]) {
          if (!(el instanceof Element) || !el.getClientRects().length) continue;
          const css = getComputedStyle(el);
          for (const property of [
            "color",
            "background-color",
            "border-top-color",
            "fill",
            "stroke",
          ]) {
            const value = css.getPropertyValue(property),
              rgb = value.match(/^rgba?\((\d+)[, ]+(\d+)[, ]+(\d+)/);
            if (rgb && (rgb[1] !== rgb[2] || rgb[2] !== rgb[3]))
              violations.push(
                `${el.tagName}.${el.getAttribute("class") ?? ""}: ${property} ${value}`,
              );
          }
        }
        return [...new Set(violations)];
      });
      expect(colored, `${card}/${theme}`).toEqual([]);
    }
  }
});
