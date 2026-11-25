import { test, expect, type Page, type Route } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { callTool } from "./helpers";

/**
 * RDS-010: the cards "wearable" (Garmin code) and "start". The watch tools need
 * a database, so `pair_garmin_watch` and `list_garmin_watches` are answered
 * here; the card logic under test is the app's own.
 */

const BASE = "http://127.0.0.1:8800";
const TOKEN = "synthetic-confirmation-token-only";
const rid = () => `w-${Math.random().toString(36).slice(2)}`;

const reply = (route: Route, value: unknown, meta?: object, isError = false) =>
  route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: route.request().postDataJSON().id,
      result: {
        content: [{ type: "text", text: "ok" }],
        ...(value === undefined ? {} : { structuredContent: value }),
        ...(meta ? { _meta: meta } : {}),
        ...(isError ? { isError } : {}),
      },
    }),
  });

type Mode = "ok" | "wrong" | "limited";
/** Answers the watch tools; returns the arguments of every pairing call. */
async function mockWatch(page: Page, mode: Mode, watches = 0) {
  const sent: Record<string, unknown>[] = [];
  await page.route("**/mcp", async (route) => {
    const body = route.request().postDataJSON();
    const name = body?.params?.name;
    if (name === "list_garmin_watches")
      return reply(route, {
        account_label: "Arnold · 3f9a",
        watches: Array.from({ length: watches }, (_, i) => ({
          device_id: `wdv_${i}`,
          label: "Forerunner 255",
          paired_at: "2026-11-09T18:02:00Z",
          last_used_at: null,
        })),
        health_consent: {
          granted: false,
          text_version: null,
          current_text_version: "2026-11-10",
        },
      });
    if (name !== "pair_garmin_watch") return route.continue();
    const args = body.params.arguments;
    sent.push(args);
    if (mode !== "ok")
      return reply(
        route,
        undefined,
        {
          arnold: {
            code: mode === "wrong" ? "VALIDATION_ERROR" : "RATE_LIMITED",
            retryable: false,
            recovery: "none",
          },
        },
        true,
      );
    if (args.confirmation_token)
      return reply(route, { stage: "paired", device_label: "Forerunner 255" });
    const visible = {
      stage: "confirm",
      device_label: "Forerunner 255",
      user_code: "ABCD-2345",
      requested_at: new Date().toISOString().slice(0, 19) + "Z",
      expires_at:
        new Date(Date.now() + 300_000).toISOString().slice(0, 19) + "Z",
    };
    return reply(route, visible, {
      arnold: {
        pair_garmin_watch: {
          ...visible,
          confirmation_token: TOKEN,
          timezone: args.timezone,
        },
      },
    });
  });
  return sent;
}

async function openCard(page: Page, card: "wearable" | "start") {
  await page.goto(`${BASE}/health`);
  await callTool(page, "cancel_onboarding", { request_id: rid() });
  await callTool(page, "update_onboarding_profile", {
    request_id: rid(),
    profile: {
      path: "arnold_plan",
      person: { age_years: 34, height_cm: 180 },
      training: {
        primary_goal: "muscle_gain",
        experience: "intermediate",
        days_per_week: 4,
        session_minutes: 60,
        environment: "gym",
      },
    },
  });
  await page.goto(`${BASE}/preview?onboarding=1&card=${card}`);
  await expect(page.locator(`main[data-ocard="${card}"]`)).toBeVisible();
}

const code = (page: Page) => page.getByLabel("Code von der Uhr");
const message = (page: Page) => page.locator(".oc-msg");

test("wearable: focus, sentence, one field, exactly two actions", async ({
  page,
}) => {
  await mockWatch(page, "ok");
  await openCard(page, "wearable");
  await expect(page.locator(".oc-title")).toBeFocused();
  await expect(page.locator(".oc-title")).toHaveText("Garmin verbinden");
  await expect(
    page.getByText(
      "Öffne Arnold auf deiner Uhr. Dort steht ein Code mit 8 Zeichen.",
    ),
  ).toBeVisible();
  await expect(page.locator("main input")).toHaveCount(1);
  await expect(page.locator("main .ac-actions button")).toHaveText([
    "Verbinden",
    "Später",
  ]);
  await expect(page.locator("main")).not.toContainText(/Einwilligung|Apple/);
});

for (const typed of ["ABCD-2345", "abcd2345", "abcd-2345", " AbCd 2345 "])
  test(`wearable: code "${typed}" is normalised, Enter connects, token stays out of the page`, async ({
    page,
  }) => {
    const sent = await mockWatch(page, "ok");
    await openCard(page, "wearable");
    await code(page).fill(typed);
    await code(page).press("Enter");
    await expect(
      page.getByRole("status").getByText(/Forerunner 255 ist verbunden/),
    ).toBeVisible();
    expect(sent).toHaveLength(2);
    expect(sent.map((a) => a.user_code)).toEqual(["ABCD2345", "ABCD2345"]);
    expect(sent[0].confirmation_token).toBeUndefined();
    expect(sent[1].confirmation_token).toBe(TOKEN);
    expect(typeof sent[0].timezone).toBe("string");
    await expect(page.locator("body")).not.toContainText(TOKEN);
    await expect(page.locator("main .ac-actions button:enabled")).toHaveCount(
      0,
    );
  });

test("wearable: invalid code stays at the field and sends nothing", async ({
  page,
}) => {
  const sent = await mockWatch(page, "ok");
  await openCard(page, "wearable");
  await code(page).fill("ABC");
  await page.getByRole("button", { name: "Verbinden" }).click();
  await expect(message(page)).toContainText("Der Code hat 8 Zeichen");
  await expect(code(page)).toHaveAttribute("aria-invalid", "true");
  await expect(code(page)).toBeFocused();
  await expect(message(page)).toHaveAttribute("aria-live", "polite");
  expect(sent).toHaveLength(0);
  await code(page).fill("ABCD-2345");
  await expect(message(page)).toBeEmpty();
});

test("wearable: wrong code and rate limit are explained at the field", async ({
  page,
}) => {
  await mockWatch(page, "wrong");
  await openCard(page, "wearable");
  await code(page).fill("ABCD2345");
  await page.getByRole("button", { name: "Verbinden" }).click();
  await expect(message(page)).toContainText(
    "kenne ich nicht oder er ist abgelaufen",
  );
  await expect(page.locator("main")).not.toContainText("VALIDATION_ERROR");
  await expect(page.getByRole("button", { name: "Verbinden" })).toBeEnabled();

  const limited = await page.context().newPage();
  await mockWatch(limited, "limited");
  await openCard(limited, "wearable");
  await code(limited).fill("ABCD2345");
  await code(limited).press("Enter");
  await expect(message(limited)).toContainText("Zu viele falsche Codes");
  await expect(message(limited)).not.toContainText("RATE_LIMITED");
});

test("wearable: Später writes nothing and sends one follow-up", async ({
  page,
}) => {
  const sent = await mockWatch(page, "ok");
  const writes: string[] = [];
  page.on("request", (req) => {
    const body = req.postDataJSON?.() as
      { params?: { name?: string } } | undefined;
    const name = body?.params?.name;
    if (req.method() === "POST" && name) writes.push(name);
  });
  await openCard(page, "wearable");
  const before = (await callTool(page, "get_onboarding_state", {})).session
    .revision;
  writes.length = 0;
  await page.getByRole("button", { name: "Später" }).click();
  await expect(page.getByRole("status")).toContainText("später");
  await expect(page.locator("main .ac-actions button:enabled")).toHaveCount(0);
  expect(sent).toHaveLength(0);
  expect(
    writes.filter((n) => /pair_|update_|confirm_|finish_/.test(n)),
  ).toEqual([]);
  const after = (await callTool(page, "get_onboarding_state", {})).session
    .revision;
  expect(after).toBe(before);
});

test("start: server values only, estimated, two actions, unknown is open", async ({
  page,
}) => {
  await mockWatch(page, "ok", 1);
  await openCard(page, "start");
  await expect(page.locator(".oc-title")).toBeFocused();
  await expect(page.locator(".oc-title")).toHaveText("Arnold ist bereit");
  await expect(page.locator("main .ac-actions button")).toHaveText([
    "Einheit ansehen",
    "Plan öffnen",
  ]);
  await expect(
    page.getByText("Verbunden. Öffne Arnold auf der Uhr."),
  ).toBeVisible();
  await expect(page.getByText(/Nächste Einheit:/)).toBeVisible();
  await expect(page.getByText("Richtwerte (geschätzt)")).toBeVisible();
  await expect(page.getByText("noch offen, Arnold schätzt sie")).toBeVisible();
  await expect(page.locator("main")).not.toContainText(
    /Rekord|auf die Uhr spielen|\b0 kg/,
  );
});

test("start: no watch gives a short hint", async ({ page }) => {
  await mockWatch(page, "ok", 0);
  await openCard(page, "start");
  await expect(page.getByText(/Noch nicht verbunden/)).toBeVisible();
  await expect(page.locator("main")).not.toContainText(
    "Öffne Arnold auf der Uhr",
  );
});

for (const theme of ["light", "dark"] as const)
  for (const card of ["wearable", "start"] as const)
    test(`${card}: 375 px without overflow, contrast, targets (${theme})`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: 375, height: 812 });
      await page.emulateMedia({ colorScheme: theme });
      await mockWatch(page, "ok", 1);
      await openCard(page, card);
      if (card === "wearable") {
        await code(page).fill("ABC");
        await page.getByRole("button", { name: "Verbinden" }).click();
        await expect(message(page)).toContainText("Der Code hat 8 Zeichen");
      }
      await expect(page.locator("main button").first()).toBeVisible();
      const overflow = await page.evaluate(
        () =>
          document.documentElement.scrollWidth -
          document.documentElement.clientWidth,
      );
      expect(overflow).toBeLessThanOrEqual(0);
      const results = await new AxeBuilder({ page })
        .include('main[data-card="onboarding-card"]')
        .analyze();
      expect(results.violations).toEqual([]);
      const small = await page
        .locator("main button, main input")
        .evaluateAll(
          (els) =>
            els
              .map((el) => el.getBoundingClientRect())
              .filter((r) => r.height > 0 && (r.height < 44 || r.width < 44))
              .length,
        );
      expect(small).toBe(0);
    });
