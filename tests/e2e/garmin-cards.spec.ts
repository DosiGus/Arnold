import { test, expect, type Page, type Route } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { resolve } from "node:path";

/**
 * Garmin cards (GAR-B5-01). The watch tools exist only with a database, so the
 * tool calls are answered here; the card logic under test is the app's own.
 */
const BASE = "http://127.0.0.1:8792";
const TOKEN = "synthetic-watch-confirmation-token-only";
const ZONE = "America/New_York";
const VERSION = "2026-11-entwurf-1";

const result = (route: Route, value: unknown, meta?: object, isError = false) =>
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

const confirm = (expiresInMs = 300_000) => ({
  stage: "confirm",
  device_label: "Forerunner 255",
  user_code: "K7Q4-M2XP",
  requested_at: new Date(Date.now() - 5_000).toISOString().slice(0, 19) + "Z",
  expires_at:
    new Date(Date.now() + expiresInMs).toISOString().slice(0, 19) + "Z",
});

type Watches = {
  account_label: string;
  watches: {
    device_id: string;
    label: string;
    paired_at: string;
    last_used_at: string | null;
  }[];
  health_consent: {
    granted: boolean;
    text_version: string | null;
    current_text_version: string;
  };
};
const watches = (): Watches => ({
  account_label: "Arnold · 3f9a",
  watches: [
    {
      device_id: "wdv_0b7c3c1e-6f0a-4d7e-9f51-6a3e2d1c0b9a",
      label: "Forerunner 255",
      paired_at: "2026-11-09T18:02:00Z",
      last_used_at: "2026-11-09T19:45:00Z",
    },
  ],
  health_consent: {
    granted: false,
    text_version: null,
    current_text_version: VERSION,
  },
});

async function screens(page: Page, browserName: string, name: string) {
  for (const width of [375, 1024])
    for (const theme of ["light", "dark"] as const) {
      await page.setViewportSize({ width, height: 900 });
      await page.evaluate(
        (theme) => (document.documentElement.dataset.theme = theme),
        theme,
      );
      await page.screenshot({
        path: resolve(
          `test-results/screens/${browserName}-${name}-${width}-${theme}.png`,
        ),
        fullPage: true,
        animations: "disabled",
      });
    }
  await page.evaluate(() => (document.documentElement.dataset.theme = "light"));
}

async function noSeriousA11y(page: Page) {
  const a11y = await new AxeBuilder({ page }).include("main").analyze();
  expect(
    a11y.violations.filter((v) =>
      ["critical", "serious"].includes(v.impact ?? ""),
    ),
  ).toEqual([]);
}

test("pairing sends its private confirmation only after the click, with the bound time zone", async ({
  page,
  browserName,
}) => {
  const sent: Record<string, unknown>[] = [];
  await page.setViewportSize({ width: 375, height: 812 });
  await page.route("**/mcp", async (route) => {
    const body = route.request().postDataJSON();
    if (body?.params?.name !== "pair_garmin_watch") return route.continue();
    const args = body.params.arguments;
    sent.push(args);
    if (args.confirmation_token)
      return result(route, { stage: "paired", device_label: "Forerunner 255" });
    const visible = confirm();
    return result(route, visible, {
      arnold: {
        pair_garmin_watch: {
          ...visible,
          confirmation_token: TOKEN,
          timezone: ZONE,
        },
      },
    });
  });
  await page.goto(`${BASE}/preview?garmin=pair&code=k7q4m2xp&tz=${ZONE}`);
  await expect(
    page.getByRole("heading", { name: "Forerunner 255 verbinden?" }),
  ).toBeVisible();
  await expect(page.getByText("K7Q4-M2XP")).toBeVisible();
  await expect(page.getByText("Gültig bis")).toBeVisible();
  expect(sent.every((args) => !args.confirmation_token)).toBe(true);
  await expect(page.locator("body")).not.toContainText(TOKEN);
  await noSeriousA11y(page);
  await screens(page, browserName, "garmin-pair");
  await page
    .getByRole("button", { name: "Uhr verbinden", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Forerunner 255 ist verbunden" }),
  ).toBeVisible();
  expect(sent.filter((args) => args.confirmation_token)).toEqual([
    { user_code: "K7Q4-M2XP", timezone: ZONE, confirmation_token: TOKEN },
  ]);
});

test("a cancelled pairing sends nothing, an expired one never reuses the token", async ({
  page,
}) => {
  const sent: Record<string, unknown>[] = [];
  let calls = 0;
  await page.route("**/mcp", async (route) => {
    const body = route.request().postDataJSON();
    if (body?.params?.name !== "pair_garmin_watch") return route.continue();
    calls++;
    sent.push(body.params.arguments);
    const visible = confirm(calls === 1 ? -1_000 : 300_000);
    return result(route, visible, {
      arnold: {
        pair_garmin_watch: {
          ...visible,
          confirmation_token: TOKEN,
          timezone: ZONE,
        },
      },
    });
  });
  await page.goto(`${BASE}/preview?garmin=pair&code=K7Q4-M2XP&tz=${ZONE}`);
  await expect(
    page.getByRole("heading", { name: "Bestätigung abgelaufen" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Neu beginnen", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Forerunner 255 verbinden?" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Abbrechen", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Kopplung abgebrochen" }),
  ).toBeVisible();
  expect(calls).toBe(2);
  expect(sent.every((args) => !args.confirmation_token)).toBe(true);
});

test("the account card shows the watch, grants consent with the text version and confirms unpairing", async ({
  page,
  browserName,
}) => {
  const state = watches();
  const sent: { name: string; args: Record<string, unknown> }[] = [];
  await page.setViewportSize({ width: 375, height: 812 });
  await page.route("**/mcp", async (route) => {
    const body = route.request().postDataJSON();
    const name = body?.params?.name as string | undefined;
    if (
      !name ||
      ![
        "list_garmin_watches",
        "set_garmin_health_consent",
        "unpair_garmin_watch",
      ].includes(name)
    )
      return route.continue();
    const args = body.params.arguments ?? {};
    sent.push({ name, args });
    if (name === "set_garmin_health_consent") {
      state.health_consent = {
        granted: args.granted,
        text_version: args.granted ? VERSION : null,
        current_text_version: VERSION,
      };
      return result(route, {
        granted: args.granted,
        text_version: VERSION,
        deleted_health_records: args.granted ? 0 : 3,
      });
    }
    if (name === "unpair_garmin_watch") {
      state.watches = state.watches.filter(
        (w) => w.device_id !== args.device_id,
      );
      return result(route, { device_id: args.device_id, unpaired: true });
    }
    return result(route, structuredClone(state));
  });
  await page.goto(`${BASE}/preview?garmin=watches`);
  await expect(page.getByText("Dein Konto · Arnold · 3f9a")).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Forerunner 255" }),
  ).toBeVisible();
  await expect(page.getByText("Letzter Kontakt")).toBeVisible();
  await expect(page.getByText("Nicht erteilt")).toBeVisible();
  await noSeriousA11y(page);
  await screens(page, browserName, "garmin-account");

  // Granting shows the hint first and sends the current text version.
  await page
    .getByRole("button", { name: "Messwerte speichern", exact: true })
    .click();
  await expect(page.getByText("Das sind Gesundheitsdaten.")).toBeVisible();
  expect(sent.some((s) => s.name === "set_garmin_health_consent")).toBe(false);
  await page.getByRole("button", { name: "Einwilligen", exact: true }).click();
  await expect(page.getByText("Erteilt", { exact: true })).toBeVisible();
  expect(
    sent.find((s) => s.name === "set_garmin_health_consent")?.args,
  ).toEqual({ granted: true, text_version: VERSION });

  // Revoking asks first and says what is deleted.
  await page
    .getByRole("button", { name: "Messwerte nicht mehr speichern" })
    .click();
  await page
    .getByRole("button", { name: "Einwilligung widerrufen", exact: true })
    .click();
  await expect(
    page.getByText("3 gespeicherte Messwert-Datensätze"),
  ).toBeVisible();
  expect(
    sent.filter((s) => s.name === "set_garmin_health_consent").at(-1)?.args,
  ).toEqual({ granted: false });

  // Unpairing asks first; cancel sends nothing.
  await page.getByRole("button", { name: "Uhr trennen", exact: true }).click();
  await page.getByRole("button", { name: "Abbrechen", exact: true }).click();
  expect(sent.some((s) => s.name === "unpair_garmin_watch")).toBe(false);
  await page.getByRole("button", { name: "Uhr trennen", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Forerunner 255 trennen?" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Uhr trennen", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Keine Garmin-Uhr verbunden" }),
  ).toBeVisible();
  expect(sent.filter((s) => s.name === "unpair_garmin_watch")).toEqual([
    {
      name: "unpair_garmin_watch",
      args: { device_id: "wdv_0b7c3c1e-6f0a-4d7e-9f51-6a3e2d1c0b9a" },
    },
  ]);
});
