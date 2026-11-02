import { expect, type Page } from "@playwright/test";
export const wizard = (page: Page) =>
  page.locator('main[data-card="onboarding"]');
export async function openCard(
  page: Page,
  card: string,
  base = "http://127.0.0.1:8792",
) {
  await page.goto(`${base}/preview?card=${card}`);
  await expect(page.locator(`main[data-card="${card}"]`)).toBeVisible();
}
export async function openWizard(page: Page, base = "http://127.0.0.1:8800") {
  await page.goto(`${base}/preview?onboarding=1`);
  await expect(
    wizard(page).getByRole("heading", { name: "Willkommen bei Arnold" }),
  ).toBeVisible();
}
export async function callTool(
  page: Page,
  name: string,
  args: Record<string, unknown> = {},
) {
  return page.evaluate(
    async ({ name, args }) => {
      const response = await fetch("/mcp", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json, text/event-stream",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: Math.floor(Math.random() * 1e9),
          method: "tools/call",
          params: { name, arguments: args },
        }),
      });
      const payload = await response.json();
      return payload.result?.structuredContent;
    },
    { name, args },
  );
}
export const storedClaim = (page: Page) =>
  page.evaluate(() =>
    JSON.parse(sessionStorage.getItem("arnold.onboarding.claim") ?? "{}"),
  );
export async function fillProfile(page: Page) {
  const main = wizard(page);
  await main
    .getByRole("button", { name: "Plan mit Arnold erstellen", exact: true })
    .click();
  await main.getByRole("button", { name: "Überspringen", exact: true }).click();
  for (const [title, answer] of [
    ["Was ist dein Ziel?", "Muskeln aufbauen"],
    ["Wie lange trainierst du schon?", "Fortgeschritten"],
    ["Wie oft möchtest du pro Woche trainieren?", "3"],
    ["Wie viel Zeit hast du pro Training?", "60 Min."],
    ["Wo trainierst du?", "Fitnessstudio"],
  ]) {
    await expect(
      main.getByRole("heading", { name: title, exact: true }),
    ).toBeVisible();
    await main.getByRole("button", { name: answer, exact: true }).click();
    await main.getByRole("button", { name: "Weiter", exact: true }).click();
  }
  await expect(
    main.getByRole("heading", { name: "Passt das so für deinen Plan?" }),
  ).toBeVisible();
  await expect(main).toHaveAttribute("data-profile-save", "saved");
}
export async function submitProposal(page: Page, origin = "ai_proposal") {
  await expect(wizard(page)).toHaveAttribute("data-profile-save", "saved");
  const claim = await storedClaim(page);
  const brief = await callTool(page, "get_onboarding_brief", claim);
  const result = await callTool(page, "submit_onboarding_plan_proposal", {
    ...claim,
    request_id: crypto.randomUUID(),
    name: "Mein Testplan",
    origin,
    sessions: ["Push", "Pull", "Beine"].map((session_name, i) => ({
      session_name,
      exercises: [
        {
          exercise_id: brief.exercise_catalog[i].exercise_id,
          target_sets: 3,
          rep_min: 8,
          rep_max: 12,
        },
      ],
    })),
  });
  expect(result.ok).toBe(true);
  return claim;
}
