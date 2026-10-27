import { expect, it, vi } from "vitest";
import {
  Client,
  StreamableHTTPClientTransport,
} from "@modelcontextprotocol/client";
import { createHttpApp } from "../src/server/http";
import { PlanWriteResponseSchema } from "../src/shared/plan-contract";
import { WorkoutContextSchema } from "../src/shared/workout-contract";

it("the documented fixture environment starts plan editor and workout logger over the same data source", async () => {
  vi.stubEnv("STORAGE_MODE", "arnold_fixture");
  vi.stubEnv("ARNOLD_WRITE_MODE", "fixture");
  const server = createHttpApp({
    allowedHosts: ["127.0.0.1"],
    allowedOrigins: [],
  }).listen(0, "127.0.0.1");
  const client = new Client({ name: "s001-runtime", version: "1" });
  try {
    await new Promise<void>((yes, no) => {
      server.once("listening", yes);
      server.once("error", no);
    });
    await client.connect(
      new StreamableHTTPClientTransport(
        new URL(
          `http://127.0.0.1:${(server.address() as { port: number }).port}/mcp`,
        ),
      ),
    );
    const names = (await client.listTools()).tools.map((t) => t.name);
    expect(names).toContain("create_training_plan");
    expect(names).toContain("start_workout");
    expect(names).toContain("abandon_rejected_write");
    const response = PlanWriteResponseSchema.parse(
      (
        await client.callTool({
          name: "create_training_plan",
          arguments: {
            request_id: "runtime-plan",
            name: "Shared runtime",
            sessions: [
              {
                session_name: "Session",
                exercises: [{ exercise_id: "plan-fx-bench" }],
              },
            ],
          },
        })
      ).structuredContent,
    );
    expect(response.ok).toBe(true);
    const context = WorkoutContextSchema.parse(
      (await client.callTool({ name: "get_workout", arguments: {} }))
        .structuredContent,
    );
    expect(
      context.plans.some(
        (p) =>
          p.plan_version_id === response.result!.plan!.version.plan_version_id,
      ),
    ).toBe(true);
    expect(context.can_write).toBe(true);
  } finally {
    await client.close();
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
      server.closeAllConnections();
    });
    vi.unstubAllEnvs();
  }
});
