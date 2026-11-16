import { test, expect, type Page } from "@playwright/test";

const URL = "http://127.0.0.1:8792/preview?kit=1";

async function open(page: Page) {
  await page.goto(URL);
  await expect(page.locator('main[data-card="kit"]')).toBeVisible();
}
const card = (page: Page, name: string) =>
  page.getByRole("region", { name, exact: true });

for (const theme of ["light", "dark"] as const) {
  test(`kit renders without horizontal scroll at 375px (${theme})`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.emulateMedia({ colorScheme: theme });
    await open(page);
    const overflow = await page.evaluate(
      () =>
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
    await expect(card(page, "Verstanden mit Lücke")).toBeVisible();
  });

  test(`only grays plus the green and warning tokens are used (${theme})`, async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: theme });
    await open(page);
    const allowed = await page.evaluate(() => {
      const probe = document.createElement("i");
      document.body.append(probe);
      const resolve = (token: string) => {
        probe.style.color = `var(${token})`;
        return getComputedStyle(probe).color;
      };
      const out = [
        "--ac-ok-text",
        "--ac-ok-fill",
        "--ac-warn-text",
        "--ac-warn-fill",
      ].map(resolve);
      probe.remove();
      return out;
    });
    const colored = await page.locator("main").evaluate((root, ok) => {
      const bad: string[] = [];
      for (const el of [root, ...root.querySelectorAll("*")]) {
        if (!el.getClientRects().length) continue;
        const css = getComputedStyle(el);
        for (const p of [
          "color",
          "background-color",
          "border-top-color",
          "fill",
          "stroke",
        ]) {
          const v = css.getPropertyValue(p);
          const m = v.match(/^rgba?\((\d+)[, ]+(\d+)[, ]+(\d+)/);
          if (m && (m[1] !== m[2] || m[2] !== m[3]) && !ok.includes(v))
            bad.push(`${el.tagName}.${el.getAttribute("class")}: ${p} ${v}`);
        }
      }
      return [...new Set(bad)];
    }, allowed);
    expect(colored).toEqual([]);
    // The accent really is used: success and warning lines are not gray.
    expect(allowed.length).toBe(4);
  });
}

test("a missing value is named for screen readers", async ({ page }) => {
  await open(page);
  const rows = card(page, "Verstanden mit Lücke").getByRole("list", {
    name: "Verstanden",
  });
  const gap = rows.getByRole("listitem").filter({ hasText: "fehlt noch" });
  await expect(gap).toHaveCount(1);
  await expect(gap).toHaveText(/Minuten pro Training\s*fehlt noch/);
  await expect(
    rows.getByRole("listitem").filter({ hasText: "Tage pro Woche" }),
  ).not.toContainText("fehlt noch");
});

test("a change reads vorher … jetzt … and says the rest stays", async ({
  page,
}) => {
  await open(page);
  const change = card(page, "Änderung");
  const row = change.getByRole("listitem").first();
  await expect(row).toHaveText(/Kniebeugevorher 60 kg\s*jetzt 55 kg/);
  const old = row.locator("del");
  await expect(old).toHaveCSS("text-decoration-line", "line-through");
  await expect(change).toContainText("Alles andere bleibt gleich.");
});

test("Bestätigt appears only after the server reports success", async ({
  page,
}) => {
  await open(page);
  const live = card(page, "Bestätigen live");
  const main = live.getByRole("button", { name: "Änderung übernehmen" });
  await expect(live.getByText("Bestätigt")).toHaveCount(0);
  await main.click();
  // Clicking is not success: the button is busy, nothing is confirmed.
  await expect(live.getByText("Bestätigt")).toHaveCount(0);
  await expect(
    live.getByRole("button", { name: "Einen Moment …" }),
  ).toBeDisabled();
  await live.getByRole("button", { name: "Server meldet Fehler" }).click();
  await expect(live.getByRole("alert")).toContainText("nicht geklappt");
  await expect(live.getByText("Bestätigt")).toHaveCount(0);
  await live.getByRole("button", { name: "Server meldet Erfolg" }).click();
  await expect(live.getByRole("status")).toHaveText("Bestätigt");
  await expect(
    live.getByRole("button", { name: "Änderung übernehmen" }),
  ).toHaveCount(0);
  await live.getByRole("button", { name: "Zurücksetzen" }).click();
  await live.getByRole("button", { name: "Nicht jetzt" }).click();
  await expect(live.getByRole("status")).toHaveText("Nicht übernommen");
});

test("each static confirm state shows its own text, one main button", async ({
  page,
}) => {
  await open(page);
  await expect(
    card(page, "Bestätigen Bereit").getByRole("button", {
      name: "Plan übernehmen",
    }),
  ).toBeEnabled();
  await expect(
    card(page, "Bestätigen Läuft").getByRole("button", {
      name: "Einen Moment …",
    }),
  ).toBeDisabled();
  await expect(card(page, "Bestätigen Bestätigt")).toContainText("Bestätigt");
  await expect(card(page, "Bestätigen Nicht übernommen")).toContainText(
    "Nicht übernommen",
  );
  await expect(
    card(page, "Bestätigen Fehler").getByRole("alert"),
  ).toBeVisible();
  for (const name of ["Bereit", "Fehler"])
    await expect(
      card(page, `Bestätigen ${name}`).locator(".ac-btn.primary"),
    ).toHaveCount(1);
});

test("status lines: saved needs saved, watch lines never lie", async ({
  page,
}) => {
  await open(page);
  const s = (n: number) => card(page, `Status ${n}`);
  await expect(s(1)).toContainText("Gespeichert");
  await expect(s(1)).toContainText("Auf deiner Uhr angekommen");
  await expect(s(2)).toContainText("Gespeichert");
  await expect(s(2)).toContainText("Noch nicht auf deiner Uhr");
  await expect(s(2)).not.toContainText("angekommen");
  for (const n of [3, 4]) {
    await expect(s(n)).toContainText("Gespeichert");
    await expect(s(n)).not.toContainText("angekommen");
    await expect(s(n)).not.toContainText("Uhr");
  }
  // Not saved and no watch information: no status lines at all.
  await expect(s(5).getByRole("status")).toHaveCount(0);
  await expect(s(5)).not.toContainText("Gespeichert");
  await expect(page.getByText("Auf deiner Uhr angekommen")).toHaveCount(1);
  await expect(s(1).getByRole("status", { name: "Status" })).toBeVisible();
});

test("keyboard reaches the buttons and focus is visible", async ({
  page,
  browserName,
}) => {
  await open(page);
  const live = card(page, "Bestätigen live");
  const main = live.getByRole("button", { name: "Änderung übernehmen" });
  await main.focus();
  await expect(main).toBeFocused();
  const outline = await main.evaluate((el) => {
    const css = getComputedStyle(el);
    return { w: css.outlineWidth, s: css.outlineStyle };
  });
  // Safari skips buttons with plain Tab by default; Tab order is checked in Chromium.
  if (browserName === "chromium") {
    await page.keyboard.press("Tab");
    await expect(
      live.getByRole("button", { name: "Nicht jetzt" }),
    ).toBeFocused();
    await page.keyboard.press("Shift+Tab");
    await expect(main).toBeFocused();
  }
  expect(outline.s).not.toBe("none");
  expect(parseFloat(outline.w)).toBeGreaterThanOrEqual(2);
  await page.keyboard.press("Enter");
  await expect(
    live.getByRole("button", { name: "Einen Moment …" }),
  ).toBeDisabled();
});

test("reduced motion: no animation on kit elements", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await open(page);
  const moving = await page.locator("main").evaluate(
    (root) =>
      [...root.querySelectorAll("*")].filter((el) => {
        const css = getComputedStyle(el);
        return css.animationName !== "none" && css.animationDuration !== "0s";
      }).length,
  );
  expect(moving).toBe(0);
  await expect(
    page.getByText("Sag zum Beispiel: „45 Minuten pro Training“"),
  ).toBeVisible();
});
