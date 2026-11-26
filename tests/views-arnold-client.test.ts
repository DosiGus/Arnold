/**
 * How a view reads a tool answer (src/views/arnold-client.ts): a failed write
 * keeps Arnold's error code from the result, so the card can explain it.
 */
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { ArnoldCallError, readResult } from "../src/views/arnold-client";

describe("readResult", () => {
  it("takes the error code of a failed write from its result", () => {
    let caught: unknown;
    try {
      readResult("create_training_goal", z.unknown(), {
        isError: true,
        structuredContent: {
          ok: false,
          error: {
            code: "GOAL_EXISTS",
            message: "Dafür gibt es schon ein aktives Ziel.",
            recovery: "ask_user",
            details: [],
          },
        },
        content: [{ type: "text", text: "GOAL_EXISTS: … Details: …" }],
      });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(ArnoldCallError);
    expect(caught).toMatchObject({
      code: "GOAL_EXISTS",
      message: "Dafür gibt es schon ein aktives Ziel.",
      retryable: false,
    });
  });

  it("prefers the code in _meta.arnold and falls back to the text", () => {
    expect(() =>
      readResult("x", z.unknown(), {
        isError: true,
        meta: { arnold: { code: "AUTH_REQUIRED", retryable: true } },
        content: [{ type: "text", text: "Bitte anmelden." }],
      }),
    ).toThrow(
      expect.objectContaining({
        code: "AUTH_REQUIRED",
        message: "Bitte anmelden.",
        retryable: true,
      }),
    );
  });
});
