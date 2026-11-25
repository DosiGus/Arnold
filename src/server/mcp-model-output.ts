/**
 * D-20: no tool result shows the model an internal id, schema marker or
 * bookkeeping timestamp. Like the auth guard, this intercepts
 * `McpServer.registerTool`, so every tool — also those added through
 * `registerAppTool` or after the server was built (account, watch) — is
 * covered without each one remembering to strip its output.
 *
 * The advertised `outputSchema` loses the hidden keys; the result's
 * `structuredContent` loses them too, and the card gets them back in
 * `_meta.arnold.internal` (see `src/shared/model-output-contract.ts`).
 */
import type { McpServer } from "@modelcontextprotocol/server";
import type { z } from "zod";
import {
  modelVisibleSchema,
  splitModelOutput,
} from "../shared/model-output-contract.js";

type RegisterTool = (
  name: string,
  config: Record<string, unknown>,
  handler: (...args: unknown[]) => unknown,
) => unknown;

type ToolResult = {
  structuredContent?: unknown;
  _meta?: Record<string, unknown>;
  [key: string]: unknown;
};

/** Takes the hidden keys out of one tool result. */
export function hideInternals<T>(result: T): T {
  if (!result || typeof result !== "object") return result;
  const value = result as ToolResult;
  if (value.structuredContent === undefined) return result;
  const { visible, internal } = splitModelOutput(value.structuredContent);
  if (internal === undefined) return result;
  const arnold = (value._meta?.arnold ?? {}) as Record<string, unknown>;
  return {
    ...value,
    structuredContent: visible,
    _meta: { ...value._meta, arnold: { ...arnold, internal } },
  } as T;
}

/** Patches `registerTool` so no later registration leaks internals. */
export function hideModelInternals(server: McpServer): McpServer {
  const original = server.registerTool.bind(server) as unknown as RegisterTool;
  const patched: RegisterTool = (name, config, handler) =>
    original(
      name,
      config.outputSchema
        ? {
            ...config,
            outputSchema: modelVisibleSchema(config.outputSchema as z.ZodType),
          }
        : config,
      async (...args: unknown[]) => hideInternals(await handler(...args)),
    );
  Object.defineProperty(server, "registerTool", {
    value: patched,
    configurable: true,
    writable: true,
  });
  return server;
}
