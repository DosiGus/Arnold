/**
 * Browser coverage for the onboarding wizard.
 *
 * Driven entirely through what a user can see and operate — roles, labels and
 * visible text — against isolated synthetic trackers. No Google account is
 * connected, no Google file is created and no real training data is touched.
 *
 * The wizard is opened with `?onboarding=1`, which is the browser preview's
 * entry point for the setup; inside ChatGPT the host opens the same app through
 * the `show_arnold_onboarding` resource.
 */
import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

// One tracker per concern, because a setup is persistent: the main flow owns
// 8800, the isolation and interruption tests own 8801, and the expiry test gets
// a server with a deliberately short session lifetime.
const ONB_URL = "http://127.0.0.1:8800/?onboarding=1";
const ONB_B_URL = "http://127.0.0.1:8801/?onboarding=1";
const ONB_SHORT_URL = "http://127.0.0.1:8802/?onboarding=1";
/** The dashboard must keep working untouched next to the new wizard. */
const DASHBOARD_URL = "http://127.0.0.1:8800";

/**
 * Everything is scoped to the wizard container.
 *
 * The dashboard's empty state carries its own "Willkommen bei Arnold" heading,
 * so an unscoped query could pass against the dashboard and hide a broken
 * entry point — which is exactly the failure this scoping prevents.
 */
const wizard = (page: Page) => page.locator(".onb-shell");

const button = (page: Page, name: string | RegExp) =>
  wizard(page).getByRole("button", { name, exact: typeof name === "string" });

const heading = (page: Page, name: string | RegExp) =>
  wizard(page).getByRole("heading", { name, exact: typeof name === "string" });

const shows = (page: Page, pattern: string | RegExp) =>
  wizard(page).getByText(pattern);

/**
 * Chooses one option inside the group with this legend.
 *
 * Clicks the visible card, which is what a user does: the radio input itself is
 * visually hidden for styling, so Playwright would never consider it actionable.
 * The input keeps focus and keyboard semantics — the keyboard test below drives
 * it directly.
 */
const choose = (page: Page, legend: string | RegExp, label: string) =>
  wizard(page)
    .getByRole("group", { name: legend })
    .locator("label.onb-choice")
    .filter({ has: page.getByText(label, { exact: true }) })
    .first()
    .click();

const radio = (page: Page, legend: string | RegExp, label: string) =>
  wizard(page)
    .getByRole("group", { name: legend })
    .getByRole("radio", { name: label, exact: true });

async function openWizard(page: Page, url = ONB_URL) {
  await page.goto(url);
  // The container itself proves the wizard mounted, not the dashboard.
  await expect(wizard(page)).toBeVisible();
  await expect(heading(page, "Willkommen bei Arnold")).toBeVisible();
}

/** Walks the six required answers and lands on the summary. */
async function fillProfile(page: Page, days = "3") {
  await button(page, /Einrichtung (starten|fortsetzen)/).click();

  await expect(heading(page, "Was möchtest du erreichen?")).toBeVisible();
  await choose(page, /Trainingsziel/, "Muskelaufbau");
  await choose(page, /Krafttraining/, "Fortgeschritten");
  await button(page, "Weiter").click();

  await expect(heading(page, /Trainingsalltag/)).toBeVisible();
  await choose(page, /Wie oft/, days);
  await choose(page, /Wie viel Zeit/, "60");
  await choose(page, /Wo trainierst du/, "Fitnessstudio");
  await button(page, "Weiter").click();

  await expect(heading(page, /eigene Vorlieben/)).toBeVisible();
  await choose(page, /Wie möchtest du starten/, "Neuer Trainingsplan");
  await button(page, "Optionale Angaben überspringen").click();

  await expect(heading(page, "Passt das so?")).toBeVisible();
}

/** The claim the app stored for the setup it currently holds. */
const storedClaim = (page: Page) =>
  page.evaluate(() =>
    JSON.parse(sessionStorage.getItem("arnold.onboarding.claim") ?? "{}"),
  );

/**
 * Calls one MCP tool from the page, the way a ChatGPT turn would.
 *
 * Deliberately not a UI interaction: the point of these calls is to prove that
 * the chat surface and the wizard act on one and the same server state.
 */
async function callTool(
  page: Page,
  name: string,
  args: Record<string, unknown>,
) {
  return page.evaluate(
    async ([tool, payload]) => {
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
          params: { name: tool, arguments: payload },
        }),
      });
      const body = await response.json();
      return body.result?.structuredContent ?? body;
    },
    [name, args] as const,
  );
}

/** Walks the profile, then has "ChatGPT" submit a three-day proposal. */
async function seedProposal(page: Page, url: string) {
  await openWizard(page, url);
  await fillProfile(page);
  await button(page, "Trainingsplan vorschlagen lassen").click();
  await expect(heading(page, "Jetzt entsteht dein Plan")).toBeVisible();
  const claim = await storedClaim(page);
  const brief = await callTool(page, "get_onboarding_brief", claim);
  const ids = brief.exercise_catalog
    .slice(0, 3)
    .map((entry: { exercise_id: string }) => entry.exercise_id);
  const submitted = await callTool(page, "submit_onboarding_plan_proposal", {
    request_id: `e2e-seed-${Date.now()}`,
    ...claim,
    name: "Push/Pull/Legs",
    origin: "ai_proposal",
    sessions: ["Push", "Pull", "Legs"].map((session_name, index) => ({
      session_name,
      exercises: [
        { exercise_id: ids[index], target_sets: 3, rep_min: 8, rep_max: 12 },
      ],
    })),
  });
  expect(submitted.ok).toBe(true);
  await button(page, "Nach dem Vorschlag suchen").click();
  return claim;
}

/* ------------------------------------------------------------ the main flow */

test("a new user walks the whole setup up to the Google handoff", async ({
  page,
}) => {
  await openWizard(page);

  // Step 1: the welcome names what is and is not available.
  await expect(shows(page, /Google-Verbindung nicht verfügbar/)).toBeVisible();
  await expect(shows(page, /Es wird keine Datei erstellt/)).toBeVisible();

  await fillProfile(page);

  // Step 5: the summary shows every answer back.
  await expect(shows(page, "Muskelaufbau")).toBeVisible();
  await expect(shows(page, "3 Tage pro Woche")).toBeVisible();
  await expect(shows(page, "60 Minuten je Training")).toBeVisible();
  await expect(shows(page, "Fitnessstudio")).toBeVisible();
  await expect(shows(page, "Angaben vollständig.")).toBeVisible();

  // Requesting the plan opens the honest handoff to the chat: there is no
  // button that fakes a model call.
  await button(page, "Trainingsplan vorschlagen lassen").click();
  await expect(heading(page, "Jetzt entsteht dein Plan")).toBeVisible();
  await expect(shows(page, /Wechsle in den Chat/)).toBeVisible();
  await expect(shows(page, /erfindet keine Trainingsgewichte/)).toBeVisible();
  await expect(button(page, /Plan jetzt generieren/)).toHaveCount(0);

  // The proposal arrives the way ChatGPT would send it: through the MCP tools,
  // against the same server state the wizard is reading.
  const proposal = await page.evaluate(async () => {
    const claim = JSON.parse(
      sessionStorage.getItem("arnold.onboarding.claim") ?? "{}",
    );
    const post = async (name: string, args: Record<string, unknown>) => {
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
      return payload.result?.structuredContent ?? payload;
    };
    const brief = await post("get_onboarding_brief", claim);
    const ids = brief.exercise_catalog
      .slice(0, 3)
      .map((entry: { exercise_id: string }) => entry.exercise_id);
    return post("submit_onboarding_plan_proposal", {
      request_id: `e2e-${Date.now()}`,
      ...claim,
      name: "Push/Pull/Legs",
      origin: "ai_proposal",
      sessions: ["Push", "Pull", "Legs"].map((session_name, index) => ({
        session_name,
        exercises: [
          {
            exercise_id: ids[index],
            target_sets: 3,
            rep_min: 8,
            rep_max: 12,
          },
        ],
      })),
    });
  });
  expect(proposal.ok).toBe(true);

  // The wizard picks the draft up from the server.
  await button(page, "Nach dem Vorschlag suchen").click();
  await expect(heading(page, "Dein Planvorschlag")).toBeVisible();
  await expect(shows(page, /3 Trainingseinheiten/).first()).toBeVisible();
  await expect(page.locator(".plan-draft-note")).toContainText("erst");

  // The Task 005 editor is mounted inside the wizard, not a second editor.
  await expect(page.locator(".onb-editor .plan-editor")).toBeVisible();
  await expect(
    wizard(page).getByText("Push", { exact: true }).first(),
  ).toBeVisible();

  // Confirming names the exact revision and says what it does not mean.
  await button(page, "Plan bestätigen").first().click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText(/Revision 1/)).toBeVisible();
  await expect(dialog.getByText(/noch nicht/)).toBeVisible();
  await dialog.getByRole("button", { name: "Plan bestätigen" }).click();

  // The handoff state: released, and explicitly not connected to Google.
  await expect(heading(page, "Dein Trainingsplan ist bereit.")).toBeVisible();
  await expect(shows(page, /verbinden wir dein Google-Konto/)).toBeVisible();
  await expect(shows(page, /Nächster Entwicklungsschritt/)).toBeVisible();
  // The Google button exists but cannot be used: no sham interaction.
  await expect(button(page, "Google-Konto verbinden")).toBeDisabled();
  await expect(
    shows(page, /Es wurde kein Google-Konto verbunden/),
  ).toBeVisible();
  await expect(shows(page, /Einrichtung abgeschlossen/)).toHaveCount(0);
});

/**
 * Acceptance scenario 1, continued: the user edits the proposal in the editor,
 * the change raises the revision, and the confirmation that follows is bound to
 * the *new* revision. The old one can no longer be confirmed unnoticed.
 */
test("editing the proposal rebinds the confirmation to the new revision", async ({
  page,
}) => {
  const claim = await seedProposal(page, ONB_B_URL);
  await expect(heading(page, "Dein Planvorschlag")).toBeVisible();
  expect(
    (await callTool(page, "get_onboarding_plan", claim)).plan.row_revision,
  ).toBe(1);

  // Replace an exercise through the Task 005 editor mounted in the wizard.
  await page
    .getByRole("button", { name: /austauschen$/ })
    .first()
    .click();
  const picker = page.getByRole("dialog");
  await expect(picker).toBeVisible();
  await picker.getByLabel("Übung suchen", { exact: true }).fill("Beinpresse");
  await picker.locator(".plan-picker-item").first().click();

  // The draft moved on, so the wizard now shows a higher revision.
  await expect(page.locator(".onb-editor")).toContainText("Demo Beinpresse");
  expect(
    (await callTool(page, "get_onboarding_plan", claim)).plan.row_revision,
  ).toBe(2);

  // The lifecycle controls belong to the setup, not to the embedded editor.
  await expect(
    page.getByRole("button", { name: "Bestätigen und aktivieren" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Entwurf verwerfen" }),
  ).toHaveCount(0);

  // A confirmation for the superseded revision 1 is refused by the server.
  const stale = await callTool(page, "confirm_onboarding_plan", {
    request_id: `e2e-stale-confirm-${Date.now()}`,
    ...claim,
    confirmation: {
      plan_version_id: (await callTool(page, "get_onboarding_plan", claim)).plan
        .plan_version_id,
      row_revision: 1,
      confirmed: true,
    },
  });
  expect(stale.ok).toBe(false);
  expect(stale.error.code).toBe("STALE_CONFIRMATION");

  // Confirming what is on screen works and reaches the handoff.
  await button(page, "Plan bestätigen").first().click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText(/Revision 2/).first()).toBeVisible();
  await dialog.getByRole("button", { name: "Plan bestätigen" }).click();
  await expect(heading(page, "Dein Trainingsplan ist bereit.")).toBeVisible();
  expect(
    (await callTool(page, "get_onboarding_state", claim)).handoff
      .confirmed_plan_revision,
  ).toBe(2);
});

/**
 * Acceptance scenario 2: the user already has a routine. It is structured into
 * a draft, reviewed, and reaches the same safe handoff state.
 */
test("an existing routine reaches the same handoff state", async ({ page }) => {
  await openWizard(page, ONB_B_URL);
  await button(page, /Einrichtung (starten|fortsetzen)/).click();
  await choose(page, /Trainingsziel/, "Kraftaufbau");
  await choose(page, /Krafttraining/, "Erfahren");
  await button(page, "Weiter").click();
  await choose(page, /Wie oft/, "3");
  await choose(page, /Wie viel Zeit/, "75");
  await choose(page, /Wo trainierst du/, "Fitnessstudio");
  await button(page, "Weiter").click();

  await choose(page, /Wie möchtest du starten/, "Ich habe schon einen Plan");
  // The path is explained rather than left to guesswork.
  await expect(shows(page, /Deinen Plan übernehmen/)).toBeVisible();
  await expect(shows(page, /Push\/Pull\/Legs/)).toBeVisible();
  await button(page, "Optionale Angaben überspringen").click();
  await button(page, "Trainingsplan vorschlagen lassen").click();

  // The routine arrives structured, flagged as a takeover rather than a
  // generated plan.
  const claim = await storedClaim(page);
  const brief = await callTool(page, "get_onboarding_brief", claim);
  expect(brief.starting_point).toBe("existing_plan");
  const ids = brief.exercise_catalog
    .slice(0, 3)
    .map((entry: { exercise_id: string }) => entry.exercise_id);
  const submitted = await callTool(page, "submit_onboarding_plan_proposal", {
    request_id: `e2e-existing-${Date.now()}`,
    ...claim,
    name: "Mein Push/Pull/Legs",
    origin: "existing_routine",
    // The user named exercises but not every set count: what they did not say
    // stays empty instead of being invented.
    sessions: ["Push", "Pull", "Legs"].map((session_name, index) => ({
      session_name,
      exercises: [
        { exercise_id: ids[index], target_sets: 3, rep_min: 8, rep_max: 12 },
      ],
    })),
  });
  expect(submitted.ok).toBe(true);

  await button(page, "Nach dem Vorschlag suchen").click();
  await expect(heading(page, "Dein Planvorschlag")).toBeVisible();
  await expect(shows(page, /Mein Push\/Pull\/Legs/).first()).toBeVisible();

  await button(page, "Plan bestätigen").first().click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Plan bestätigen" })
    .click();

  // The same safe handoff, by the other route.
  await expect(heading(page, "Dein Trainingsplan ist bereit.")).toBeVisible();
  await expect(button(page, "Google-Konto verbinden")).toBeDisabled();
  const handoff = await callTool(page, "get_onboarding_handoff", claim);
  expect(handoff.handoff.status).toBe("ready_for_google_connection");
  expect(handoff.handoff.google_connection_pending).toBe(true);
});

/* ------------------------------------------------------- navigating back */

test("going back to an earlier step keeps every answer", async ({ page }) => {
  await openWizard(page, ONB_B_URL);
  await button(page, /Einrichtung (starten|fortsetzen)/).click();

  await choose(page, /Trainingsziel/, "Kraftaufbau");
  await choose(page, /Krafttraining/, "Anfänger");
  await button(page, "Weiter").click();

  await choose(page, /Wie oft/, "4");
  await choose(page, /Wie viel Zeit/, "45");
  await choose(page, /Wo trainierst du/, "Zuhause");

  // Back one step: the earlier answers must still be selected.
  await button(page, /^Zurück/).click();
  await expect(heading(page, "Was möchtest du erreichen?")).toBeVisible();
  await expect(radio(page, /Trainingsziel/, "Kraftaufbau")).toBeChecked();
  await expect(radio(page, /Krafttraining/, "Anfänger")).toBeChecked();

  // Forward again: the later answers survived too.
  await button(page, "Weiter").click();
  await expect(radio(page, /Wie oft/, "4")).toBeChecked();
  await expect(radio(page, /Wie viel Zeit/, "45")).toBeChecked();
});

test("a required answer is reported at the question that is missing it", async ({
  page,
}) => {
  await openWizard(page, ONB_B_URL);
  await button(page, /Einrichtung (starten|fortsetzen)/).click();

  // Continue without answering: the wizard must not advance.
  await button(page, "Weiter").click();
  await expect(heading(page, "Was möchtest du erreichen?")).toBeVisible();
  const alerts = wizard(page).getByRole("alert");
  await expect(alerts.first()).toBeVisible();
  await expect(shows(page, /Trainingsziel fehlt noch/)).toBeVisible();

  // Answering clears the way.
  await choose(page, /Trainingsziel/, "Muskelaufbau");
  await choose(page, /Krafttraining/, "Fortgeschritten");
  await button(page, "Weiter").click();
  await expect(heading(page, /Trainingsalltag/)).toBeVisible();
});

test("a summary row jumps back to the step that owns it", async ({ page }) => {
  await openWizard(page, ONB_B_URL);
  await fillProfile(page);

  await button(page, "Trainingstage pro Woche ändern").click();
  await expect(heading(page, /Trainingsalltag/)).toBeVisible();
  await choose(page, /Wie oft/, "5");
  await button(page, "Weiter").click();
  await expect(heading(page, /eigene Vorlieben/)).toBeVisible();
  await button(page, "Optionale Angaben überspringen").click();
  // The change is reflected, which means it reached the server.
  await expect(shows(page, "5 Tage pro Woche")).toBeVisible();
});

/* ------------------------------------------------------------ interruption */

test("closing and reopening the app resumes the stored setup", async ({
  page,
}) => {
  await openWizard(page, ONB_B_URL);
  await fillProfile(page);
  await expect(shows(page, "Angaben vollständig.")).toBeVisible();

  // A reload stands in for closing the panel and coming back to it.
  await page.reload();
  // The wizard resumes on the stored step rather than at the welcome screen.
  await expect(heading(page, "Passt das so?")).toBeVisible();
  await expect(shows(page, "Muskelaufbau")).toBeVisible();
  await expect(shows(page, "60 Minuten je Training")).toBeVisible();
  await expect(shows(page, "Angaben vollständig.")).toBeVisible();
});

test("a setup without its credential starts fresh instead of leaking one", async ({
  page,
}) => {
  await openWizard(page, ONB_B_URL);
  await fillProfile(page);

  // Keep the session id, drop the secret: the id alone must be worthless.
  await page.evaluate(() => {
    const claim = JSON.parse(
      sessionStorage.getItem("arnold.onboarding.claim") ?? "{}",
    );
    sessionStorage.setItem(
      "arnold.onboarding.claim",
      JSON.stringify({ onboarding_session_id: claim.onboarding_session_id }),
    );
  });
  await page.reload();

  // A brand-new setup, with none of the previous answers.
  await expect(heading(page, "Willkommen bei Arnold")).toBeVisible();
  await button(page, /Einrichtung (starten|fortsetzen)/).click();
  await expect(radio(page, /Trainingsziel/, "Muskelaufbau")).not.toBeChecked();
});

test("an expired setup offers a controlled restart", async ({ page }) => {
  await openWizard(page, ONB_SHORT_URL);
  await button(page, /Einrichtung (starten|fortsetzen)/).click();
  await choose(page, /Trainingsziel/, "Muskelaufbau");

  // The server's session lifetime on this port is deliberately short.
  await page.waitForTimeout(2000);
  await page.reload();

  await expect(shows(page, /abgelaufen/).first()).toBeVisible();
  await expect(shows(page, /nicht mehr abrufbar/)).toBeVisible();
  const restart = button(page, "Neue Einrichtung starten");
  await expect(restart).toBeEnabled();
  await restart.click();
  // A real restart, not a dead end.
  await expect(
    heading(page, /Willkommen bei Arnold|Was möchtest du erreichen\?/),
  ).toBeVisible();
});

/* -------------------------------------------------------- the error surface */

test("a refused write shows the reason and keeps the stored state", async ({
  page,
}) => {
  await openWizard(page, ONB_B_URL);
  await fillProfile(page);

  // A stale revision is the realistic case: the chat changed something while
  // this screen was open.
  const refusal = await page.evaluate(async () => {
    const claim = JSON.parse(
      sessionStorage.getItem("arnold.onboarding.claim") ?? "{}",
    );
    const response = await fetch("/mcp", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: {
          name: "update_onboarding_profile",
          arguments: {
            request_id: `e2e-stale-${Date.now()}`,
            ...claim,
            expected_revision: 1,
            profile: { days_per_week: 2 },
          },
        },
      }),
    });
    const payload = await response.json();
    return payload.result?.structuredContent;
  });
  expect(refusal.ok).toBe(false);
  expect(refusal.error.code).toBe("REVISION_CONFLICT");

  // The screen still shows the answers that actually stand.
  await page.reload();
  await expect(shows(page, "Angaben vollständig.")).toBeVisible();
  await expect(shows(page, "2 Tage pro Woche")).toHaveCount(0);
});

test("no sham success message appears anywhere in the flow", async ({
  page,
}) => {
  await openWizard(page);
  const body = page.locator("body");
  await expect(body).not.toContainText("Einrichtung abgeschlossen");
  await expect(body).not.toContainText("Tracker erstellt");
  await expect(body).not.toContainText("Plan aktiviert");
  await expect(body).not.toContainText("Google-Konto verbunden.");
});

/* ------------------------------------------------- responsive and themes */

test("the wizard works on a phone-sized screen", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openWizard(page, ONB_B_URL);
  await button(page, /Einrichtung (starten|fortsetzen)/).click();
  await expect(heading(page, "Was möchtest du erreichen?")).toBeVisible();

  // Nothing may overflow horizontally in a narrow app panel.
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
  await choose(page, /Trainingsziel/, "Muskelaufbau");
  await expect(radio(page, /Trainingsziel/, "Muskelaufbau")).toBeChecked();
});

for (const theme of ["light", "dark"] as const)
  test(`the wizard renders in the ${theme} theme`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: theme });
    await openWizard(page, ONB_B_URL);
    await expect(heading(page, "Willkommen bei Arnold")).toBeVisible();
    const applied = await page.evaluate(
      () => document.documentElement.dataset.theme,
    );
    expect(applied).toBe(theme);
    // The card must paint its own background in both themes.
    const background = await page
      .locator(".onb")
      .first()
      .evaluate((node) => getComputedStyle(node).backgroundColor);
    expect(background).not.toBe("rgba(0, 0, 0, 0)");
  });

/* ---------------------------------------------------------- accessibility */

test("the wizard is keyboard operable", async ({ page }) => {
  await openWizard(page, ONB_B_URL);

  // Reach and press the start control with the keyboard alone.
  await page.keyboard.press("Tab");
  for (let step = 0; step < 12; step++) {
    const onStart = await page.evaluate(() =>
      document.activeElement?.textContent?.includes("Einrichtung"),
    );
    if (onStart) break;
    await page.keyboard.press("Tab");
  }
  await page.keyboard.press("Enter");
  await expect(heading(page, "Was möchtest du erreichen?")).toBeVisible();

  // Tab into the first option group, exactly as a keyboard user arrives there.
  const focusedLabel = () =>
    page.evaluate(() => document.activeElement?.getAttribute("aria-label"));
  for (let step = 0; step < 15; step++) {
    if ((await focusedLabel()) === "Muskelaufbau") break;
    await page.keyboard.press("Tab");
  }
  expect(await focusedLabel()).toBe("Muskelaufbau");

  // Space selects the focused option, the standard radio activation. Awaited,
  // because the selection round-trips through the server before the controlled
  // input reflects it.
  await page.keyboard.press("Space");
  await expect(radio(page, /Trainingsziel/, "Muskelaufbau")).toBeChecked();

  // Arrow keys move the selection within the group.
  await page.keyboard.press("ArrowDown");
  await expect(radio(page, /Trainingsziel/, "Kraftaufbau")).toBeChecked();
  await expect(radio(page, /Trainingsziel/, "Muskelaufbau")).not.toBeChecked();
});

test("the wizard has no serious accessibility violations", async ({ page }) => {
  await openWizard(page, ONB_B_URL);
  await button(page, /Einrichtung (starten|fortsetzen)/).click();
  await expect(heading(page, "Was möchtest du erreichen?")).toBeVisible();
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa"])
    .analyze();
  expect(
    results.violations.filter((violation) =>
      ["serious", "critical"].includes(violation.impact ?? ""),
    ),
  ).toEqual([]);
});

/* ------------------------------------------------- the existing dashboard */

test("the existing dashboard still opens and shows no onboarding", async ({
  page,
}) => {
  await page.goto(DASHBOARD_URL);
  await expect(
    page.getByRole("navigation", { name: "Hauptnavigation" }),
  ).toBeVisible();
  // The empty state deliberately carries no onboarding affordance, and the
  // wizard must not mount on the dashboard route at all. (The dashboard's own
  // "Willkommen bei Arnold" empty-state heading predates Task 006 and stays.)
  await expect(
    page.getByRole("button", { name: /Onboarding|Jetzt starten|Einrichten/ }),
  ).toHaveCount(0);
  await expect(wizard(page)).toHaveCount(0);
  await expect(page.getByRole("progressbar")).toHaveCount(0);
});
