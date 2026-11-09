/**
 * B9: the D10 confirmation rules are complete and reach the descriptions
 * ChatGPT reads.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  Client,
  StreamableHTTPClientTransport,
} from "@modelcontextprotocol/client";
import type { Server } from "node:http";
import { createHttpApp } from "../src/server/http";
import { TOOL_ACCESS } from "../src/server/auth/tool-access";
import {
  CONFIRMATION_RULES,
  CONFIRMATION_TEXT,
  UnconfirmedToolError,
  withConfirmationRule,
} from "../src/server/auth/confirmation-rules";

const rule = (tool: string) => CONFIRMATION_RULES[tool].rule;

describe("D10 confirmation rules", () => {
  it("has a rule for exactly the classified tools", () => {
    expect(Object.keys(CONFIRMATION_RULES).sort()).toEqual(
      Object.keys(TOOL_ACCESS).sort(),
    );
  });

  it("asks in the chat before discarding, cancelling and activating", () => {
    for (const tool of [
      "void_set",
      "cancel_workout",
      "archive_plan_draft",
      "activate_training_plan",
      "cancel_onboarding",
    ])
      expect(rule(tool), tool).toBe("ask_in_chat");
  });

  it("needs a card click to delete the account", () => {
    expect(rule("delete_arnold_account")).toBe("ask_and_card_click");
  });

  it("pairs a watch only after the card's click and asks before unpairing (GAR-B2-03)", () => {
    expect(rule("pair_garmin_watch")).toBe("ask_and_card_click");
    expect(rule("unpair_garmin_watch")).toBe("ask_in_chat");
    expect(rule("list_garmin_watches")).toBe("direct");
  });

  it("asks before granting or revoking the health consent (GAR-B2-07)", () => {
    expect(rule("set_garmin_health_consent")).toBe("ask_in_chat");
  });

  it("logs and reads directly", () => {
    for (const tool of [
      "start_workout",
      "log_workout_sets",
      "update_set",
      "complete_workout",
      "get_arnold_dashboard",
      "get_training_plan",
    ])
      expect(rule(tool), tool).toBe("direct");
  });

  it("refuses a tool without a rule", () => {
    expect(() => withConfirmationRule("new_tool", "x")).toThrow(
      UnconfirmedToolError,
    );
  });
});

describe("descriptions as ChatGPT sees them", () => {
  let http: Server;
  let client: Client;
  beforeAll(async () => {
    http = createHttpApp({ env: {} }).listen(0, "127.0.0.1");
    await new Promise<void>((resolve) => http.once("listening", resolve));
    client = new Client({ name: "rules", version: "1" });
    await client.connect(
      new StreamableHTTPClientTransport(
        new URL(
          `http://127.0.0.1:${(http.address() as { port: number }).port}/mcp`,
        ),
      ),
    );
  });
  afterAll(async () => {
    await client?.close();
    await new Promise<void>((resolve) => {
      http?.close(() => resolve());
      http?.closeAllConnections();
    });
  });

  it("carry the rule sentence exactly once, and only where it applies", async () => {
    const { tools } = await client.listTools();
    for (const tool of tools) {
      const text = CONFIRMATION_TEXT[rule(tool.name)];
      const description = tool.description ?? "";
      if (text) expect(description.split(text).length - 1, tool.name).toBe(1);
      else expect(description, tool.name).not.toContain("Rückfrage:");
      if (tool.annotations?.readOnlyHint)
        expect(rule(tool.name), tool.name).toBe("direct");
    }
  });
});
