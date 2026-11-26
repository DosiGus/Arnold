/**
 * A fixture Arnold server over real Streamable HTTP for the chat card models:
 * answers are read the way a view reads them (structured result plus
 * `_meta.arnold.internal`, checked against the tool's contract). Synthetic
 * data only.
 */
import type { Server } from "node:http";
import {
  Client,
  StreamableHTTPClientTransport,
  type CallToolResult,
} from "@modelcontextprotocol/client";
import type { z } from "zod";
import { createHttpApp } from "../../src/server/http";
import { createFixturePlanning } from "../../src/server/plan/fixture";
import { readResult } from "../../src/views/arnold-client";

export async function cardServer(
  runtime: ReturnType<typeof createFixturePlanning> = createFixturePlanning(),
) {
  const http: Server = createHttpApp({ workoutRuntime: runtime }).listen(
    0,
    "127.0.0.1",
  );
  await new Promise<void>((resolve) => http.once("listening", resolve));
  const client = new Client({ name: "synthetic-card-tests", version: "1" });
  await client.connect(
    new StreamableHTTPClientTransport(
      new URL(
        `http://127.0.0.1:${(http.address() as { port: number }).port}/mcp`,
      ),
    ),
  );
  const raw = async (name: string, args: Record<string, unknown> = {}) =>
    (await client.callTool({ name, arguments: args })) as CallToolResult;
  return {
    raw,
    async read<S extends z.ZodType>(
      name: string,
      schema: S,
      args: Record<string, unknown> = {},
    ): Promise<z.infer<S>> {
      const res = await raw(name, args);
      return readResult(name, schema, { ...res, meta: res._meta });
    },
    async close() {
      await client.close();
      await new Promise<void>((resolve) => {
        http.close(() => resolve());
        http.closeAllConnections();
      });
    },
  };
}
export type CardServer = Awaited<ReturnType<typeof cardServer>>;
