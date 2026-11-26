/**
 * The only way a view talks to Arnold: one tool call through the host bridge
 * (Skybridge `useCallTool`), no network of its own.
 *
 * Every answer is read the same way:
 * 1. D-20: the server keeps ids and bookkeeping timestamps out of what the
 *    model sees and hands them to the card in `_meta.arnold.internal`. They
 *    are merged back once, before anything reads the result.
 * 2. The merged result is checked against the tool's own Zod contract. A
 *    result that does not fit is an error, never shown half-read.
 * 3. A tool error carries Arnold's code in `_meta.arnold` (or the text).
 */
import { useCallback, useMemo, useState } from "react";
import { useCallTool, useToolInfo } from "skybridge/web";
import type { z } from "zod";
import { mergeModelOutput } from "../shared/model-output-contract.js";

export type ToolMeta = Record<string, unknown> | undefined;

/** A failed call: Arnold's error code when the server sent one. */
export class ArnoldCallError extends Error {
  constructor(
    readonly tool: string,
    readonly code: string,
    message: string,
    readonly retryable = false,
  ) {
    super(message);
    this.name = "ArnoldCallError";
  }
}

const arnoldMeta = (meta: ToolMeta) =>
  (meta?.arnold ?? undefined) as Record<string, unknown> | undefined;

/** Visible result plus `_meta.arnold.internal`, as the card needs it. */
export function withInternals(structured: unknown, meta: ToolMeta): unknown {
  return mergeModelOutput(structured, arnoldMeta(meta)?.internal);
}

function textOf(content: unknown): string {
  if (!Array.isArray(content)) return "";
  return content
    .map((c) =>
      c && typeof c === "object" && "text" in c ? String(c.text) : "",
    )
    .join(" ")
    .trim();
}

/** Reads one tool answer: error → throw, else merge internals and parse. */
export function readResult<S extends z.ZodType>(
  tool: string,
  schema: S,
  res: {
    structuredContent?: unknown;
    isError?: boolean;
    meta?: ToolMeta;
    content?: unknown;
  },
): z.infer<S> {
  if (res.isError) {
    const m = arnoldMeta(res.meta);
    throw new ArnoldCallError(
      tool,
      typeof m?.code === "string" ? m.code : "TOOL_ERROR",
      textOf(res.content) || "Das hat nicht geklappt.",
      m?.retryable === true,
    );
  }
  const parsed = schema.safeParse(
    withInternals(res.structuredContent, res.meta),
  );
  if (!parsed.success)
    throw new ArnoldCallError(
      tool,
      "CONTRACT_MISMATCH",
      "Die Antwort passt nicht zum erwarteten Format.",
    );
  return parsed.data;
}

/**
 * One Arnold tool, typed by its contract. `call` resolves with the parsed
 * result or rejects with an {@link ArnoldCallError}; `pending` is true while
 * a call of this hook runs.
 */
export function useArnoldTool<S extends z.ZodType>(name: string, schema: S) {
  const tool = useCallTool<Record<string, unknown>>(name);
  const [pending, setPending] = useState(0);
  const call = useCallback(
    async (args: Record<string, unknown> = {}): Promise<z.infer<S>> => {
      setPending((n) => n + 1);
      try {
        const res = await tool.callToolAsync(args);
        return readResult(name, schema, res);
      } finally {
        setPending((n) => n - 1);
      }
    },
    // `tool` changes identity per render; only name and schema matter.
    [name, schema],
  );
  return useMemo(() => ({ call, pending: pending > 0 }), [call, pending]);
}

/**
 * The result of the tool that opened this view, read like any other answer.
 * `data` is undefined while the host has not delivered it yet.
 */
export function useOpeningResult<S extends z.ZodType>(
  tool: string,
  schema: S,
):
  | { status: "pending" }
  | { status: "ok"; data: z.infer<S> }
  | { status: "error"; error: ArnoldCallError } {
  const info = useToolInfo<{
    input: Record<string, unknown>;
    output: Record<string, unknown>;
    responseMetadata: Record<string, unknown>;
  }>();
  return useMemo(() => {
    if (info.isPending) return { status: "pending" as const };
    try {
      return {
        status: "ok" as const,
        data: readResult(tool, schema, {
          structuredContent: info.output,
          meta: info.responseMetadata,
        }),
      };
    } catch (e) {
      return {
        status: "error" as const,
        error:
          e instanceof ArnoldCallError
            ? e
            : new ArnoldCallError(tool, "TOOL_ERROR", String(e)),
      };
    }
  }, [info.isPending, info.output, info.responseMetadata, tool, schema]);
}
