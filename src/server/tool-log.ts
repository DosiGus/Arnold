/**
 * One log line per MCP tool call, for operating a hosted Arnold.
 *
 * Off unless `ARNOLD_TOOL_LOG=json`; Cloud Run sets it. The line is a JSON
 * object on stdout, which Cloud Logging turns into a structured entry with a
 * severity. It carries the tool name, the access class, the outcome, an error
 * code and the duration — never arguments, results, names, e-mail addresses
 * or training content. The only identifier is Arnold's internal user id, so
 * one user's calls can be followed without knowing who they are.
 */
export interface ToolLogEvent {
  tool: string;
  access: string;
  outcome: "ok" | "error" | "refused" | "thrown";
  ms: number;
  user?: string;
  code?: string;
  /** Onboarding status and step after the call, when the result has them. */
  onboarding?: { status?: string; step?: string };
}

export const toolLogEnabled = () => process.env.ARNOLD_TOOL_LOG === "json";

/**
 * A log-safe label for a code: identifier characters only, bounded length.
 * Anything else (a message, a URL, request text) becomes "unlabelled".
 */
export function safeCode(value: unknown): string {
  return typeof value === "string" &&
    /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/.test(value)
    ? value
    : "unlabelled";
}

/**
 * What may be logged about an error: its type and HTTP status. Never the
 * message, which can quote request bodies, database values or user text.
 */
export function describeErrorForLog(error: unknown): {
  type: string;
  status?: number;
} {
  const value = error as { type?: unknown; status?: unknown; code?: unknown };
  const type =
    typeof value?.type === "string"
      ? safeCode(value.type)
      : typeof value?.code === "string"
        ? safeCode(value.code)
        : error instanceof Error
          ? safeCode(error.name)
          : "unknown";
  return {
    type,
    ...(typeof value?.status === "number" && Number.isInteger(value.status)
      ? { status: value.status }
      : {}),
  };
}

/** One structured error line without user content. Always on. */
export function logServerError(where: string, error: unknown): void {
  console.error(
    JSON.stringify({
      severity: "ERROR",
      message: where,
      ...describeErrorForLog(error),
    }),
  );
}

export function logToolCall(event: ToolLogEvent): void {
  if (!toolLogEnabled()) return;
  if (event.code !== undefined)
    event = { ...event, code: safeCode(event.code) };
  const severity =
    event.outcome === "ok"
      ? "INFO"
      : event.outcome === "thrown"
        ? "ERROR"
        : "WARNING";
  console.log(
    JSON.stringify({ severity, message: `tool ${event.tool}`, ...event }),
  );
}

/** Reads the error code and onboarding position out of a tool result. */
export function describeResult(result: unknown): {
  isError: boolean;
  code?: string;
  onboarding?: { status?: string; step?: string };
} {
  const value = result as {
    isError?: boolean;
    _meta?: { arnold?: { code?: unknown } };
    structuredContent?: {
      ok?: boolean;
      error?: { code?: unknown };
      code?: unknown;
      state?: { session?: { status?: unknown; current_step?: unknown } };
      session?: { status?: unknown; current_step?: unknown };
    };
  };
  const content = value?.structuredContent;
  // Tool failures carry their code in `_meta.arnold.code` and have no
  // structured content; onboarding results carry it in `error.code`.
  const rawCode =
    value?._meta?.arnold?.code ?? content?.error?.code ?? content?.code;
  const session = content?.state?.session ?? content?.session;
  const status =
    typeof session?.status === "string" ? session.status : undefined;
  const step =
    typeof session?.current_step === "string"
      ? session.current_step
      : undefined;
  return {
    isError: value?.isError === true || content?.ok === false,
    ...(typeof rawCode === "string" ? { code: rawCode } : {}),
    ...(status || step ? { onboarding: { status, step } } : {}),
  };
}

/**
 * Which protocol step the host took: listing tools or resources, and which
 * UI template it read. Only the method and an `ui://arnold/…` address are
 * logged, so a deploy can be checked for the host picking up the new UI.
 */
export function logProtocolStep(body: unknown): void {
  if (!toolLogEnabled()) return;
  const value = body as { method?: unknown; params?: { uri?: unknown } };
  const method = value?.method;
  if (
    method !== "tools/list" &&
    method !== "resources/list" &&
    method !== "resources/read"
  )
    return;
  const uri =
    typeof value.params?.uri === "string" &&
    /^ui:\/\/arnold\/[a-z0-9-]{1,60}\.html$/.test(value.params.uri)
      ? value.params.uri
      : undefined;
  console.log(
    JSON.stringify({
      severity: "INFO",
      message: `mcp ${method}`,
      ...(uri ? { uri } : {}),
    }),
  );
}
