import { expect, type Page } from "@playwright/test";
export async function openCard(
  page: Page,
  card: string,
  base = "http://127.0.0.1:8792",
) {
  await page.goto(`${base}/preview?card=${card}`);
  await expect(page.locator(`main[data-card="${card}"]`)).toBeVisible();
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
