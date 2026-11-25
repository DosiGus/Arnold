/**
 * D-20: a tool result as the card reads it. The server keeps ids and
 * bookkeeping timestamps out of `structuredContent` (the model's view) and
 * hands them to the card in `_meta.arnold.internal`; `src/ui/client.ts` merges
 * them back. Tests of the card contract read the result the same way.
 */
import type { CallToolResult } from "@modelcontextprotocol/client";
import { mergeModelOutput } from "../../src/shared/model-output-contract";

export function asCard<T extends CallToolResult>(result: T): T {
  const internal = (result._meta?.arnold as Record<string, unknown> | undefined)
    ?.internal;
  if (internal === undefined || result.structuredContent === undefined)
    return result;
  return {
    ...result,
    structuredContent: mergeModelOutput(result.structuredContent, internal),
  } as T;
}
