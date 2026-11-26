import { expect, type Page } from "@playwright/test";

/** Opens the card a tool would open in the test host; returns its document. */
export async function open(page: Page, base: string, query = "") {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`${base}/host${query}`);
  await expect(page.locator("#host-status")).toHaveAttribute(
    "data-initialized",
    "true",
  );
  return { app: page.frameLocator("iframe"), errors };
}
