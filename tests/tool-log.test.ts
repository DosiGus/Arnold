/**
 * The per-call operations log: off by default, one JSON line per call, and
 * nothing from the arguments or the result except codes and the onboarding
 * position.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { describeResult, logToolCall } from "../src/server/tool-log";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("logToolCall", () => {
  it("stays silent unless ARNOLD_TOOL_LOG=json", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    logToolCall({
      tool: "get_workout",
      access: "AUTHENTICATED_READ",
      outcome: "ok",
      ms: 3,
    });
    expect(log).not.toHaveBeenCalled();
  });

  it("writes one structured line with a severity", () => {
    vi.stubEnv("ARNOLD_TOOL_LOG", "json");
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    logToolCall({
      tool: "start_workout",
      access: "AUTHENTICATED_WRITE",
      outcome: "refused",
      ms: 1,
      code: "AUTH_REQUIRED",
    });
    const line = JSON.parse(String(log.mock.calls[0]?.[0]));
    expect(line).toMatchObject({
      severity: "WARNING",
      tool: "start_workout",
      outcome: "refused",
      code: "AUTH_REQUIRED",
    });
  });
});

describe("describeResult", () => {
  it("reads the error code and the onboarding position, nothing else", () => {
    const described = describeResult({
      structuredContent: {
        ok: false,
        error: { code: "REVISION_CONFLICT", message: "Persönlicher Text" },
        state: {
          session: {
            status: "COLLECTING_PROFILE",
            current_step: "goal",
            profile: { primary_goal: "muscle_gain" },
          },
        },
      },
    });
    expect(described).toEqual({
      isError: true,
      code: "REVISION_CONFLICT",
      onboarding: { status: "COLLECTING_PROFILE", step: "goal" },
    });
    expect(JSON.stringify(described)).not.toContain("Persönlicher");
    expect(JSON.stringify(described)).not.toContain("muscle_gain");
  });

  it("reads the code of a tool failure from _meta.arnold", () => {
    const described = describeResult({
      isError: true,
      content: [{ type: "text", text: "Persönlicher Text" }],
      _meta: {
        arnold: { code: "STORAGE_UNAVAILABLE", retryable: true },
      },
    });
    expect(described).toEqual({ isError: true, code: "STORAGE_UNAVAILABLE" });
  });

  it("treats a plain result as ok", () => {
    expect(describeResult({ content: [] })).toEqual({ isError: false });
  });
});
