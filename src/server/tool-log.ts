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

export function logToolCall(event: ToolLogEvent): void {
  if (!toolLogEnabled()) return;
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
    structuredContent?: {
      ok?: boolean;
      error?: { code?: unknown };
      code?: unknown;
      state?: { session?: { status?: unknown; current_step?: unknown } };
      session?: { status?: unknown; current_step?: unknown };
    };
  };
  const content = value?.structuredContent;
  const rawCode = content?.error?.code ?? content?.code;
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
