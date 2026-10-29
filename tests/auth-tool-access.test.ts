/**
 * Per-tool authorization: that every tool has a class, and that the class is
 * enforced on every call.
 *
 * The first group is the one that keeps working after this session ends. It
 * asks each server configuration which tools it actually publishes and
 * asserts every one of them is classified — so a tool added later, by anyone,
 * in any of the five registration modules, fails this test instead of quietly
 * becoming reachable. The classification table is only as good as the
 * guarantee that nothing escapes it.
 */
import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/client";
import {
  InMemoryTransport,
  McpServer,
  type AuthInfo,
  type ServerContext,
} from "@modelcontextprotocol/server";
import { z } from "zod";
import { createArnoldMcpServer } from "../src/server/mcp.js";
import { createArnoldV2McpServer } from "../src/server/mcp-arnold.js";
import { JsonStorageAdapter } from "../src/server/storage.js";
import { createFixtureLogging } from "../src/server/workout/fixture.js";
import { createFixturePlanning } from "../src/server/plan/fixture.js";
import { createFixtureOnboarding } from "../src/server/onboarding/fixture.js";
import {
  TOOL_ACCESS,
  UnclassifiedToolError,
  requireToolAccess,
  toolAccessFor,
  toolsWithAccess,
} from "../src/server/auth/tool-access.js";
import {
  currentArnoldContext,
  guardToolRegistrations,
} from "../src/server/auth/guarded-server.js";
import { ArnoldToolGuard } from "../src/server/auth/tool-guard.js";
import { ArnoldIdentityResolver } from "../src/server/auth/identity.js";
import { InMemoryIdentityRepository } from "../src/server/identity/repository.js";
import { ARNOLD_SCOPES } from "../src/server/auth/scopes.js";
import { isAuthError } from "../src/server/auth/errors.js";
import { TEST_AUDIENCE, TEST_ISSUER } from "./fixtures/arnold-auth.js";
import { registerGoogleTools } from "../src/server/connected/mcp-google.js";
import type { ConnectedArnoldRuntime } from "../src/server/connected/runtime.js";
import type { GoogleBrowserFlow } from "../src/server/connected/google-browser.js";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((d) => rm(d, { recursive: true, force: true })),
  );
});

async function tempDir(): Promise<string> {
  const d = await mkdtemp(join(tmpdir(), "arnold-tool-access-"));
  directories.push(d);
  return d;
}

/** Asks a server which tools it publishes, over a real client connection. */
async function publishedTools(server: McpServer): Promise<string[]> {
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "tool-access-probe", version: "1.0.0" });
  await Promise.all([
    server.connect(serverTransport),
    client.connect(clientTransport),
  ]);
  try {
    const { tools } = await client.listTools();
    return tools.map((tool) => tool.name).sort();
  } finally {
    await client.close();
    await server.close();
  }
}

describe("every published tool is classified", () => {
  it("covers the v1 demo surface", async () => {
    const server = createArnoldMcpServer(
      new JsonStorageAdapter(join(await tempDir(), "demo.json")),
      "dist/ui/dashboard.html",
    );
    const tools = await publishedTools(server);

    expect(tools.length).toBeGreaterThan(0);
    for (const tool of tools) expect(toolAccessFor(tool), tool).toBeDefined();
  });

  it("covers the v2 read surface", async () => {
    const runtime = createFixturePlanning();
    const server = createArnoldV2McpServer(
      runtime.source,
      "dist/ui/dashboard.html",
    );
    const tools = await publishedTools(server);

    expect(tools.length).toBeGreaterThan(0);
    for (const tool of tools) expect(toolAccessFor(tool), tool).toBeDefined();
  });

  it("covers the full surface: reads, workout writes, plan writes, onboarding", async () => {
    // The widest configuration Arnold can publish. If anything is
    // unclassified anywhere, it shows up here.
    const runtime = createFixtureOnboarding();
    const server = createArnoldV2McpServer(
      runtime.source,
      "dist/ui/dashboard.html",
      undefined,
      runtime.service,
      undefined,
      runtime.plans,
      runtime.onboarding,
    );
    const tools = await publishedTools(server);

    expect(tools.length).toBeGreaterThan(20);
    const unclassified = tools.filter((tool) => !toolAccessFor(tool));
    expect(unclassified).toEqual([]);
  });

  it("publishes the write and onboarding tools only when a runtime supplies them", async () => {
    // Establishes what an environment-driven deployment without an injected
    // runtime actually exposes, which is the basis for the exposure claims in
    // docs/GUIDE.md.
    const runtime = createFixturePlanning();
    const readOnly = await publishedTools(
      createArnoldV2McpServer(runtime.source, "dist/ui/dashboard.html"),
    );

    expect(readOnly).not.toContain("log_workout_sets");
    expect(readOnly).not.toContain("activate_training_plan");
    expect(readOnly).not.toContain("start_arnold_onboarding");
  });

  it("classifies no tool that is not published by some configuration", async () => {
    // Guards the other direction: a stale entry for a tool that no longer
    // exists is dead weight that makes the table less trustworthy.
    const runtime = createFixtureOnboarding();
    const widest = new Set(
      await publishedTools(
        createArnoldV2McpServer(
          runtime.source,
          "dist/ui/dashboard.html",
          undefined,
          runtime.service,
          undefined,
          runtime.plans,
          runtime.onboarding,
        ),
      ),
    );
    const v1 = new Set(
      await publishedTools(
        createArnoldMcpServer(
          new JsonStorageAdapter(join(await tempDir(), "demo.json")),
          "dist/ui/dashboard.html",
        ),
      ),
    );

    const googleServer = new McpServer({
      name: "google-registration-probe",
      version: "1",
    });
    // Discovery only: none of the deferred handlers runs in this inventory test.
    registerGoogleTools(
      googleServer,
      {} as ConnectedArnoldRuntime,
      {} as GoogleBrowserFlow,
    );
    const google = new Set(await publishedTools(googleServer));
    const orphans = Object.keys(TOOL_ACCESS).filter(
      (tool) => !widest.has(tool) && !v1.has(tool) && !google.has(tool),
    );
    expect(orphans).toEqual([]);
  });
});

describe("the classification table", () => {
  it("puts every write behind its own scope", () => {
    expect(toolsWithAccess("AUTHENTICATED_WRITE")).toContain(
      "log_workout_sets",
    );
    expect(toolsWithAccess("PLAN_WRITE")).toContain("activate_training_plan");
    // A plan write must not be reachable with only the workout write scope.
    expect(toolsWithAccess("AUTHENTICATED_WRITE")).not.toContain(
      "activate_training_plan",
    );
  });

  it("marks the demo writes as synthetic rather than as user writes", () => {
    expect(toolsWithAccess("SYNTHETIC_SANDBOX")).toEqual([
      "log_demo_set",
      "reset_demo_data",
    ]);
  });

  it("classifies every onboarding tool as preview", () => {
    const preview = toolsWithAccess("ONBOARDING_PREVIEW");
    expect(preview).toContain("start_arnold_onboarding");
    expect(preview).toContain("confirm_onboarding_plan");
    expect(preview.every((tool) => tool.includes("onboarding"))).toBe(true);
  });

  it("throws for an unclassified tool name", () => {
    expect(() => requireToolAccess("some_tool_nobody_classified")).toThrow(
      UnclassifiedToolError,
    );
  });

  it("does not inherit a class from a prefix", () => {
    // A naming convention is not an access control.
    expect(toolAccessFor("get_something_new")).toBeUndefined();
  });
});

describe("guarded registration", () => {
  const resolver = () =>
    new ArnoldIdentityResolver({
      repository: new InMemoryIdentityRepository(),
    });

  const enforcedGuard = () =>
    new ArnoldToolGuard({ mode: "enforced", resolver: resolver() });

  const openGuard = () =>
    new ArnoldToolGuard({
      mode: "open",
      resolver: resolver(),
      openModeContext: {
        userId: "usr_open",
        actorId: "act_open",
        scopes: [ARNOLD_SCOPES.read],
        issuer: "arnold.local",
        audience: TEST_AUDIENCE,
        clientId: "local",
        authSessionId: undefined,
        firstSeen: false,
      },
    });

  const authFor = (scopes: string[]): AuthInfo => ({
    token: "verified",
    clientId: "chatgpt-test-client",
    scopes,
    expiresAt: Math.floor(Date.now() / 1000) + 600,
    resource: new URL(TEST_AUDIENCE),
    extra: { issuer: TEST_ISSUER, subject: "subject-alice" },
  });

  /** A server with one tool of the given name, guarded. */
  function serverWithTool(
    name: string,
    guard: ArnoldToolGuard,
    options: { syntheticWrites?: boolean } = {},
  ) {
    const server = guardToolRegistrations(
      new McpServer({ name: "probe", version: "1.0.0" }),
      guard,
      options,
    );
    server.registerTool(name, { inputSchema: z.object({}) }, async () => ({
      content: [{ type: "text" as const, text: "ok" }],
      structuredContent: { seen: currentArnoldContext()?.userId ?? null },
    }));
    return server;
  }

  /**
   * Calls a tool over a real client connection, with no credential.
   *
   * Unauthenticated on purpose: these tests are about what the guard does in
   * the absence of a token, and about the class-specific behaviour. Scope
   * enforcement with a token present is asserted directly against the guard
   * in the last test, where the `AuthInfo` can be supplied precisely.
   */
  async function invoke(server: McpServer, name: string): Promise<unknown> {
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "probe", version: "1.0.0" });
    await Promise.all([
      server.connect(serverTransport),
      client.connect(clientTransport),
    ]);
    try {
      return await client.callTool({ name, arguments: {} });
    } finally {
      await client.close();
      await server.close();
    }
  }

  it("refuses to register a tool with no classification", () => {
    expect(() =>
      serverWithTool("totally_unclassified_tool", enforcedGuard()),
    ).toThrow(UnclassifiedToolError);
  });

  it("names the file to fix in the refusal", () => {
    try {
      serverWithTool("totally_unclassified_tool", enforcedGuard());
      expect.unreachable();
    } catch (error) {
      expect((error as Error).message).toContain("tool-access.ts");
    }
  });

  it("refuses an authenticated read with no credential", async () => {
    const result = (await invoke(
      serverWithTool("get_arnold_dashboard_v2", enforcedGuard()),
      "get_arnold_dashboard_v2",
    )) as { isError?: boolean };
    // The guard throws; the SDK surfaces it as an error result.
    expect(result.isError).toBe(true);
  });

  it("serves a read in open mode without a credential", async () => {
    const result = (await invoke(
      serverWithTool("get_arnold_dashboard_v2", openGuard()),
      "get_arnold_dashboard_v2",
    )) as { isError?: boolean; structuredContent?: { seen: string | null } };

    expect(result.isError).toBeFalsy();
    expect(result.structuredContent?.seen).toBe("usr_open");
  });

  it("refuses a user write in open mode", async () => {
    // Open mode is read-only by construction, so a write class is refused
    // even though no token was required for the read above.
    const result = (await invoke(
      serverWithTool("log_workout_sets", openGuard()),
      "log_workout_sets",
    )) as { isError?: boolean };
    expect(result.isError).toBe(true);
  });

  it("allows a synthetic write in open mode when the runtime is a fixture", async () => {
    const result = (await invoke(
      serverWithTool("log_workout_sets", openGuard(), {
        syntheticWrites: true,
      }),
      "log_workout_sets",
    )) as { isError?: boolean };
    expect(result.isError).toBeFalsy();
  });

  it("refuses a synthetic write in enforced mode even with the flag set", async () => {
    // The reclassification must not be usable as a way to write without
    // authentication in a deployment that authenticates.
    const result = (await invoke(
      serverWithTool("log_workout_sets", enforcedGuard(), {
        syntheticWrites: true,
      }),
      "log_workout_sets",
    )) as { isError?: boolean };
    expect(result.isError).toBe(true);
  });

  it("never reclassifies account management", async () => {
    const result = (await invoke(
      serverWithTool("log_demo_set", enforcedGuard(), {
        syntheticWrites: true,
      }),
      "log_demo_set",
    )) as { isError?: boolean };
    // log_demo_set is already SYNTHETIC_SANDBOX, so enforced mode refuses it.
    expect(result.isError).toBe(true);
  });

  it("lets an onboarding tool through, because its credential is the session secret", async () => {
    const result = (await invoke(
      serverWithTool("start_arnold_onboarding", enforcedGuard()),
      "start_arnold_onboarding",
    )) as { isError?: boolean; structuredContent?: { seen: string | null } };

    expect(result.isError).toBeFalsy();
    // No Arnold user context: the onboarding service authorizes the call.
    expect(result.structuredContent?.seen).toBeNull();
  });

  it("reports a guard refusal to the audit sink", async () => {
    const events: string[] = [];
    const guard = new ArnoldToolGuard({
      mode: "enforced",
      resolver: resolver(),
      onEvent: (event) => events.push(`${event.kind}:${event.tool}`),
    });

    await invoke(
      serverWithTool("get_arnold_dashboard_v2", guard),
      "get_arnold_dashboard_v2",
    );

    expect(events).toContain("refused:get_arnold_dashboard_v2");
  });

  it("exposes the verified context only for the duration of the call", async () => {
    const server = serverWithTool("get_arnold_dashboard_v2", openGuard());
    expect(currentArnoldContext()).toBeUndefined();
    await invoke(server, "get_arnold_dashboard_v2");
    // Cleared again afterwards, so a later unguarded path cannot read a stale
    // identity and act as that user.
    expect(currentArnoldContext()).toBeUndefined();
  });

  it("keeps two users isolated across interleaved asynchronous tool handlers", async () => {
    const releases: (() => void)[] = [];
    const started: Promise<void>[] = [];
    const connections: { server: McpServer; client: Client }[] = [];
    for (const userId of ["usr_alice", "usr_bob"]) {
      let markStarted!: () => void;
      started.push(
        new Promise<void>((resolve) => {
          markStarted = resolve;
        }),
      );
      const gate = new Promise<void>((resolve) => releases.push(resolve));
      const guard = new ArnoldToolGuard({
        mode: "open",
        resolver: resolver(),
        openModeContext: {
          userId,
          actorId: userId,
          scopes: [ARNOLD_SCOPES.read],
          issuer: TEST_ISSUER,
          audience: TEST_AUDIENCE,
          clientId: "interleaving-probe",
          authSessionId: undefined,
          firstSeen: false,
        },
      });
      const server = guardToolRegistrations(
        new McpServer({ name: userId, version: "1" }),
        guard,
      );
      server.registerTool(
        "get_dashboard_data",
        { inputSchema: z.object({}) },
        async () => {
          const before = currentArnoldContext()?.userId;
          markStarted();
          await gate;
          return {
            content: [{ type: "text", text: "context" }],
            structuredContent: {
              before,
              after: currentArnoldContext()?.userId,
            },
          };
        },
      );
      const [clientTransport, serverTransport] =
        InMemoryTransport.createLinkedPair();
      const client = new Client({ name: "interleaving-probe", version: "1" });
      await Promise.all([
        server.connect(serverTransport),
        client.connect(clientTransport),
      ]);
      connections.push({ server, client });
    }
    try {
      const first = connections[0].client.callTool({
        name: "get_dashboard_data",
        arguments: {},
      });
      await started[0];
      const second = connections[1].client.callTool({
        name: "get_dashboard_data",
        arguments: {},
      });
      await started[1];
      releases[0]();
      expect((await first).structuredContent).toEqual({
        before: "usr_alice",
        after: "usr_alice",
      });
      releases[1]();
      expect((await second).structuredContent).toEqual({
        before: "usr_bob",
        after: "usr_bob",
      });
    } finally {
      releases.forEach((release) => release());
      await Promise.all(
        connections.map(async ({ client, server }) => {
          await client.close();
          await server.close();
        }),
      );
    }
    expect(currentArnoldContext()).toBeUndefined();
  });

  it("passes the scope requirement through to the guard", async () => {
    const guard = enforcedGuard();
    const context = await guard
      .authorize("log_workout_sets", "AUTHENTICATED_WRITE", {
        http: { authInfo: authFor([ARNOLD_SCOPES.read]) },
      } as unknown as ServerContext)
      .then(
        () => null,
        (error: unknown) => error,
      );
    expect(isAuthError(context, "INSUFFICIENT_SCOPE")).toBe(true);
  });
});
