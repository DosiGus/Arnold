/**
 * Onboarding first: tracker tools answer SETUP_REQUIRED until the account is
 * set up, and everything the onboarding itself needs stays open.
 *
 * Tested on the registration wrapper with a recording server, so the rule is
 * checked without HTTP; the connected journey covers the real path.
 */
import { describe, expect, it } from "vitest";
import type { McpServer } from "@modelcontextprotocol/server";
import {
  SETUP_GATED_TOOLS,
  gateUntilSetUp,
} from "../src/server/onboarding/setup-gate";
import type { OnboardingService } from "../src/server/onboarding/service";
import { TOOL_ACCESS } from "../src/server/auth/tool-access";

type Handler = (...args: unknown[]) => Promise<unknown>;

function recordingServer() {
  const handlers = new Map<string, Handler>();
  const server = {
    registerTool(name: string, _config: unknown, handler: Handler) {
      handlers.set(name, handler);
      return {};
    },
  };
  return { server: server as unknown as McpServer, handlers };
}

const onboardingThatSays = (required: boolean) =>
  ({ setupRequired: async () => required }) as unknown as OnboardingService;

function register(required: boolean) {
  const { server, handlers } = recordingServer();
  const gated = gateUntilSetUp(server, onboardingThatSays(required));
  for (const name of [
    "show_arnold_dashboard",
    "start_workout",
    "get_training_plan",
    "update_plan_draft",
    "show_arnold_onboarding",
    "connect_google_account",
  ])
    gated.registerTool(name, {}, async () => ({ content: [], ran: name }));
  return handlers;
}

describe("before the account is set up", () => {
  const handlers = register(true);

  it("answers tracker tools with SETUP_REQUIRED and names the way in", async () => {
    for (const name of ["show_arnold_dashboard", "start_workout"]) {
      const result = (await handlers.get(name)!()) as {
        isError: boolean;
        content: { text: string }[];
        _meta: { arnold: { code: string } };
      };
      expect(result.isError).toBe(true);
      expect(result._meta.arnold.code).toBe("SETUP_REQUIRED");
      expect(result.content[0].text).toContain("show_arnold_onboarding");
    }
  });

  it("keeps the onboarding, its plan editor and Google open", async () => {
    for (const name of [
      "get_training_plan",
      "update_plan_draft",
      "show_arnold_onboarding",
      "connect_google_account",
    ])
      expect(await handlers.get(name)!()).toMatchObject({ ran: name });
  });
});

describe("once the account is set up", () => {
  it("lets every tool through", async () => {
    const handlers = register(false);
    for (const [name, handler] of handlers)
      expect(await handler()).toMatchObject({ ran: name });
  });
});

describe("the gated list", () => {
  it("names only tools that exist and never an onboarding or plan tool", () => {
    for (const name of SETUP_GATED_TOOLS) {
      expect(TOOL_ACCESS[name], name).toBeDefined();
      expect(name).not.toMatch(/onboarding|plan|google|setup/);
    }
  });
});
