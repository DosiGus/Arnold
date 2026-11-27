import type { Page } from "@playwright/test";

/** One tool call from the test host's page, past the card. */
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
