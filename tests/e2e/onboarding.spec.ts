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

/** The card toggle, named by its title and current summary. */
const card = (page: Page, title: "Person" | "Training") =>
  wizard(page).getByRole("button", { name: new RegExp(`^${title}`) });

/** Chooses "Plan mit Arnold" and opens the Training card. */
async function startArnoldPlan(page: Page) {
  await button(page, /Plan mit Arnold erstellen/).click();
  await expect(heading(page, "Erzähl Arnold von dir")).toBeVisible();
  await card(page, "Training").click();
  await expect(card(page, "Training")).toHaveAttribute("aria-expanded", "true");
}

/** Fills the five required training answers. */
async function fillProfile(page: Page, days = "3") {
  await startArnoldPlan(page);
  await choose(page, /Was ist dein Ziel/, "Muskeln aufbauen");
  await expect(
    radio(page, /Was ist dein Ziel/, "Muskeln aufbauen"),
  ).toBeChecked();
  await choose(page, /Wie lange trainierst du/, "Fortgeschritten");
  await expect(
    radio(page, /Wie lange trainierst du/, "Fortgeschritten"),
  ).toBeChecked();
  await choose(page, /Wie oft pro Woche/, days);
  await expect(radio(page, /Wie oft pro Woche/, days)).toBeChecked();
  await choose(page, /Wie viel Zeit/, "60");
  await expect(radio(page, /Wie viel Zeit/, "60")).toBeChecked();
  await choose(page, /Wo trainierst du/, "Fitnessstudio");
  await expect(button(page, "Plan erstellen")).toBeEnabled();
  // Picks stay local until the card closes; closing saves them in one write.
  await card(page, "Training").click();
  await expect(shows(page, "Angaben vollständig.")).toBeVisible();
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
  await button(page, "Plan erstellen").click();
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

  // The welcome: who Arnold is, the two ways in, and what is not available.
  await expect(shows(page, /Trainingsbegleiter/).first()).toBeVisible();
  await expect(button(page, /Plan mit Arnold erstellen/)).toBeVisible();
  await expect(button(page, /Eigenen Plan übernehmen/)).toBeVisible();
  await expect(shows(page, /Google-Verbindung nicht verfügbar/)).toBeVisible();

  await fillProfile(page);

  // The finished Training card summarises the answers; Person stays optional.
  await expect(card(page, "Training")).toContainText("Muskeln aufbauen");
  await expect(card(page, "Training")).toContainText("3 × pro Woche");
  await expect(card(page, "Person")).toContainText("freiwillig");
  await expect(shows(page, "Angaben vollständig.")).toBeVisible();

  // "Plan erstellen" hands over to the chat: there is no button that fakes a
  // model call.
  await button(page, "Plan erstellen").click();
  await expect(heading(page, "Jetzt entsteht dein Plan")).toBeVisible();
  await expect(shows(page, /arbeitet im Chat/)).toBeVisible();
  await expect(shows(page, /erfindet keine Trainingsgewichte/)).toBeVisible();
  await expect(button(page, /Plan jetzt generieren/)).toHaveCount(0);

  // The proposal arrives the way ChatGPT would send it: through the MCP tools,
  // against the same server state the wizard is reading.
  const claim = await storedClaim(page);
  const brief = await callTool(page, "get_onboarding_brief", claim);
  expect(brief.path).toBe("arnold_plan");
  const ids = brief.exercise_catalog
    .slice(0, 3)
    .map((entry: { exercise_id: string }) => entry.exercise_id);
  const proposal = await callTool(page, "submit_onboarding_plan_proposal", {
    request_id: `e2e-${Date.now()}`,
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
  expect(proposal.ok).toBe(true);

  // The wizard picks the draft up from the server.
  await button(page, "Nach dem Vorschlag suchen").click();
  await expect(heading(page, "Dein Planvorschlag")).toBeVisible();
  await expect(shows(page, /3 Trainingseinheiten/).first()).toBeVisible();
  await expect(page.locator(".plan-draft-note")).toContainText("erst");

  // The plan editor is mounted inside the wizard, not a second editor.
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
  await expect(button(page, "Google-Konto verbinden")).toBeDisabled();
  await expect(
    shows(page, /Es wurde kein Google-Konto verbunden/),
  ).toBeVisible();
  await expect(shows(page, /Einrichtung abgeschlossen/)).toHaveCount(0);
});

/**
 * The user edits the proposal in the editor, the change raises the revision,
 * and the confirmation that follows is bound to the *new* revision. The old
 * one can no longer be confirmed unnoticed.
 */
test("editing the proposal rebinds the confirmation to the new revision", async ({
  page,
}) => {
  const claim = await seedProposal(page, ONB_B_URL);
  await expect(heading(page, "Dein Planvorschlag")).toBeVisible();
  expect(
    (await callTool(page, "get_onboarding_plan", claim)).plan.row_revision,
  ).toBe(1);

  // Replace an exercise through the editor mounted in the wizard.
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
 * The user already has a plan. One tap on the welcome screen, the plan comes
 * through the chat, and it reaches the same safe handoff state.
 */
test("an own plan reaches the same handoff state", async ({ page }) => {
  await openWizard(page, ONB_B_URL);
  await button(page, /Eigenen Plan übernehmen/).click();

  // No questionnaire: the screen says the plan comes through the chat.
  await expect(heading(page, "Deinen Plan übernehmen")).toBeVisible();
  await expect(shows(page, /Foto/).first()).toBeVisible();
  await expect(button(page, "Im Chat weitermachen")).toBeVisible();

  // The plan arrives transcribed, flagged as a takeover.
  const claim = await storedClaim(page);
  const brief = await callTool(page, "get_onboarding_brief", claim);
  expect(brief.path).toBe("own_plan");
  const ids = brief.exercise_catalog
    .slice(0, 3)
    .map((entry: { exercise_id: string }) => entry.exercise_id);
  const submitted = await callTool(page, "submit_onboarding_plan_proposal", {
    request_id: `e2e-existing-${Date.now()}`,
    ...claim,
    name: "Mein Push/Pull/Legs",
    origin: "existing_routine",
    sessions: ["Push", "Pull", "Legs"].map((session_name, index) => ({
      session_name,
      exercises: [
        { exercise_id: ids[index], target_sets: 3, rep_min: 8, rep_max: 12 },
      ],
    })),
  });
  expect(submitted.ok).toBe(true);

  await button(page, "Nach dem Plan suchen").click();
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

test("going back to the welcome keeps every answer", async ({ page }) => {
  await openWizard(page, ONB_B_URL);
  await startArnoldPlan(page);
  await choose(page, /Was ist dein Ziel/, "Stärker werden");
  await expect(
    radio(page, /Was ist dein Ziel/, "Stärker werden"),
  ).toBeChecked();
  await choose(page, /Wie oft pro Woche/, "4");
  await expect(radio(page, /Wie oft pro Woche/, "4")).toBeChecked();

  // Back to the two buttons, then the same way in again.
  await button(page, /^Zurück/).click();
  await expect(heading(page, "Willkommen bei Arnold")).toBeVisible();
  await button(page, /Plan mit Arnold erstellen/).click();
  await card(page, "Training").click();
  await expect(
    radio(page, /Was ist dein Ziel/, "Stärker werden"),
  ).toBeChecked();
  await expect(radio(page, /Wie oft pro Woche/, "4")).toBeChecked();
});

test("'Plan erstellen' waits until the Training card is complete", async ({
  page,
}) => {
  await openWizard(page, ONB_B_URL);
  await startArnoldPlan(page);

  // Nothing answered yet: the button is there but cannot be used, and the
  // screen names what is missing.
  await expect(button(page, "Plan erstellen")).toBeDisabled();
  await expect(shows(page, /Für deinen Plan fehlt noch/)).toBeVisible();
  await expect(shows(page, /Trainingsziel/).first()).toBeVisible();

  // The Person card is optional: the plan does not wait for it.
  await choose(page, /Was ist dein Ziel/, "Muskeln aufbauen");
  await choose(page, /Wie lange trainierst du/, "Anfänger");
  await choose(page, /Wie oft pro Woche/, "2");
  await choose(page, /Wie viel Zeit/, "45");
  await choose(page, /Wo trainierst du/, "Fitnessstudio");
  await expect(button(page, "Plan erstellen")).toBeEnabled();
});

test("fixed weekdays set the number of days", async ({ page }) => {
  await openWizard(page, ONB_B_URL);
  await startArnoldPlan(page);
  const days = wizard(page).getByRole("group", { name: /An welchen Tagen/ });
  for (const day of ["Mo", "Mi", "Fr"]) {
    await days.locator("label.onb-chip").filter({ hasText: day }).click();
    await expect(days.getByRole("checkbox", { name: day })).toBeChecked();
  }
  await expect(radio(page, /Wie oft pro Woche/, "3")).toBeChecked();
});

test("the Person card takes numbers, a decimal comma included", async ({
  page,
}) => {
  await openWizard(page, ONB_B_URL);
  await button(page, /Plan mit Arnold erstellen/).click();
  await card(page, "Person").click();
  await wizard(page).getByLabel("Alter").fill("34");
  await wizard(page).getByLabel("Größe").fill("181");
  await wizard(page).getByLabel("Gewicht").fill("82,5");
  // Shown at once, saved when the card closes.
  await expect(card(page, "Person")).toContainText("181 cm");
  await card(page, "Person").click();
  await expect(card(page, "Person")).toHaveAttribute("aria-expanded", "false");
  await expect(card(page, "Person")).toContainText("34 Jahre");
  await expect(card(page, "Person")).toContainText("82.5 kg");
  const claim = await storedClaim(page);
  await expect
    .poll(
      async () =>
        (await callTool(page, "get_onboarding_state", claim)).session.profile
          .person,
    )
    .toMatchObject({ age_years: 34, height_cm: 181, body_weight_kg: 82.5 });
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
  // The wizard resumes on the cards rather than at the welcome screen.
  await expect(heading(page, "Erzähl Arnold von dir")).toBeVisible();
  await expect(card(page, "Training")).toContainText("Muskeln aufbauen");
  await expect(card(page, "Training")).toContainText("60 Min.");
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
  await startArnoldPlan(page);
  await expect(
    radio(page, /Was ist dein Ziel/, "Muskeln aufbauen"),
  ).not.toBeChecked();
});

test("an expired setup offers a controlled restart", async ({ page }) => {
  await openWizard(page, ONB_SHORT_URL);
  await button(page, /Plan mit Arnold erstellen/).click();
  await expect(heading(page, "Erzähl Arnold von dir")).toBeVisible();

  // The server's session lifetime on this port is deliberately short.
  await page.waitForTimeout(2000);
  await page.reload();

  await expect(shows(page, /abgelaufen/).first()).toBeVisible();
  await expect(shows(page, /nicht mehr abrufbar/)).toBeVisible();
  const restart = button(page, "Neue Einrichtung starten");
  await expect(restart).toBeEnabled();
  await restart.click();
  // A real restart, not a dead end.
  await expect(heading(page, "Willkommen bei Arnold")).toBeVisible();
});

/* -------------------------------------------------------- the error surface */

test("a refused write shows the reason and keeps the stored state", async ({
  page,
}) => {
  await openWizard(page, ONB_B_URL);
  await fillProfile(page);

  // A stale revision is the realistic case: the chat changed something while
  // this screen was open.
  const claim = await storedClaim(page);
  const refusal = await callTool(page, "update_onboarding_profile", {
    request_id: `e2e-stale-${Date.now()}`,
    ...claim,
    expected_revision: 1,
    profile: { training: { days_per_week: 2 } },
  });
  expect(refusal.ok).toBe(false);
  expect(refusal.error.code).toBe("REVISION_CONFLICT");

  // The screen still shows the answers that actually stand.
  await page.reload();
  await expect(shows(page, "Angaben vollständig.")).toBeVisible();
  await expect(card(page, "Training")).toContainText("3 × pro Woche");
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
  await startArnoldPlan(page);

  // Nothing may overflow horizontally in a narrow app panel.
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
  await choose(page, /Was ist dein Ziel/, "Muskeln aufbauen");
  await expect(
    radio(page, /Was ist dein Ziel/, "Muskeln aufbauen"),
  ).toBeChecked();
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

  // Reach and press "Plan mit Arnold erstellen" with the keyboard alone.
  await page.keyboard.press("Tab");
  for (let step = 0; step < 12; step++) {
    const onStart = await page.evaluate(() =>
      document.activeElement?.textContent?.includes("Plan mit Arnold"),
    );
    if (onStart) break;
    await page.keyboard.press("Tab");
  }
  await page.keyboard.press("Enter");
  await expect(heading(page, "Erzähl Arnold von dir")).toBeVisible();

  // Open the Training card from the keyboard.
  await card(page, "Training").focus();
  await page.keyboard.press("Enter");
  await expect(card(page, "Training")).toHaveAttribute("aria-expanded", "true");

  // Tab into the first option group, exactly as a keyboard user arrives there.
  const focusedLabel = () =>
    page.evaluate(() => document.activeElement?.getAttribute("aria-label"));
  for (let step = 0; step < 15; step++) {
    if ((await focusedLabel()) === "Muskeln aufbauen") break;
    await page.keyboard.press("Tab");
  }
  expect(await focusedLabel()).toBe("Muskeln aufbauen");

  // Space selects the focused option; arrow keys move within the group.
  await page.keyboard.press("Space");
  await expect(
    radio(page, /Was ist dein Ziel/, "Muskeln aufbauen"),
  ).toBeChecked();
  await page.keyboard.press("ArrowDown");
  await expect(
    radio(page, /Was ist dein Ziel/, "Stärker werden"),
  ).toBeChecked();
});

test("the wizard has no serious accessibility violations", async ({ page }) => {
  await openWizard(page, ONB_B_URL);
  await startArnoldPlan(page);
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
